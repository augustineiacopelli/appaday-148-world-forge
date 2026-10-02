  // ---------------------------------------------------------------- progression graph (Phase 2)
  // The progression graph is laid out before any geometry, so the overworld is drawn around a path already proven
  // solvable. It uses no randomness and never reads the seed: a reroll moves terrain, never the order of the story.
  //
  // build(spec, settings) -> graph.
  //   spec.chapters: [{chapter (chp_ ID), name, continent (slug), label, minutes, bosses [trp_ IDs, sorted]}], in story order.
  //   settings: {airshipAt 0.67, cavesPerChapter 1, secondTownInChapterOne true}.
  // Gate keys are world local strings Day 149 binds to flg_ and itm_ records later:
  //   chapter:<chp ID>   held from the moment the chapter opens (chapter 1's is held at the start)
  //   item:seal:<chp ID> the key dungeon's prize, which opens that chapter's lock
  //   vehicle:ship, vehicle:airship
  // Golden path, per chapter: start town, key dungeon, lock, boss dungeon, exit. The exit of chapter n is the pass or
  // landing into chapter n + 1 and needs chapter n + 1's key, which chapter n's boss grants, so the key for chapter n is
  // always placed in chapter n - 1. The lock and the exit are gates, not sites; towns and dungeons become twn_ and dgn_.
  // Structural keys use the chapter ID (twn|<chp>|start), so reordering or inserting chapters never renames a site.
  var PROG_DEFAULTS = { airshipAt: 0.67, cavesPerChapter: 1, secondTownInChapterOne: true };
  function gateChapter(c) { return 'chapter:' + c; }
  function gateSeal(c) { return 'item:seal:' + c; }
  var SHIP = 'vehicle:ship', AIRSHIP = 'vehicle:airship';
  function progSettings(s) {
    s = s || {};
    var a = s.airshipAt == null ? PROG_DEFAULTS.airshipAt : Number(s.airshipAt);
    return {
      airshipAt: isFinite(a) ? clamp(a, 0, 1) : PROG_DEFAULTS.airshipAt,
      cavesPerChapter: clamp(Math.floor(s.cavesPerChapter == null ? PROG_DEFAULTS.cavesPerChapter : Number(s.cavesPerChapter) || 0), 0, 4),
      secondTownInChapterOne: s.secondTownInChapterOne == null ? PROG_DEFAULTS.secondTownInChapterOne : !!s.secondTownInChapterOne
    };
  }
  function progBuild(spec, settings) {
    var st = progSettings(settings), chs = (spec && spec.chapters || []).filter(function (c) { return c && c.chapter; });
    var N = chs.length, nodes = [], gates = [], regions = [], warnings = [], seen = {}, firstNew = -1, i;
    // Which chapters open a continent for the first time; the first of those after chapter 1 needs the ship. A chapter
    // on a different continent from the one before it arrives by sea (a landing), even when it returns to a continent
    // seen earlier; the ship is held by then, because every change of continent comes at or after the first new one.
    var opens = chs.map(function (c, k) { var o = !seen[c.continent]; seen[c.continent] = 1; if (o && k > 0 && firstNew < 0) firstNew = k; return o; });
    var lands = chs.map(function (c, k) { return k > 0 && c.continent !== chs[k - 1].continent; });
    // The ship arrives with the boss of the chapter before the first new continent. The airship arrives with the boss of
    // chapter round(airshipAt * N), only when that is later than the ship (or there is no ship) and before the finale.
    var shipAt = firstNew > 0 ? firstNew - 1 : -1;
    var airAt = st.airshipAt > 0 && N >= 2 ? clamp(Math.round(st.airshipAt * N), 1, N - 1) - 1 : -1;
    if (airAt >= 0 && airAt <= shipAt) airAt = -1;
    var perCont = {};
    function node(c, k, kind, role, extra) {
      var n = {
        key: kind + '|' + c.chapter + '|' + role, kind: kind, role: role, chapter: c.chapter, index: k, continent: c.continent,
        region: 'reg|' + c.chapter, golden: role === 'start' || role === 'key' || role === 'boss' || role === 'lock' || role === 'exit',
        requires: [gateChapter(c.chapter)], grants: [], troop: null, interior: null
      };
      each(extra || {}, function (v, f) { n[f] = v; });
      nodes.push(n);
      return n;
    }
    for (i = 0; i < N; i++) {
      var c = chs[i], last = i === N - 1, next = last ? null : chs[i + 1];
      perCont[c.continent] = (perCont[c.continent] || 0) + 1;
      regions.push({ key: 'reg|' + c.chapter, chapter: c.chapter, index: i, continent: c.continent, label: c.label || c.continent,
        part: perCont[c.continent], opensContinent: opens[i], entry: i === 0 ? 'start' : lands[i] ? 'landing' : 'pass' });
      node(c, i, 'twn', 'start', { interior: 'town' });
      node(c, i, 'dgn', 'key', { interior: 'dungeon', grants: [gateSeal(c.chapter)] });
      node(c, i, 'gate', 'lock', { requires: [gateChapter(c.chapter), gateSeal(c.chapter)] });
      var bosses = Array.isArray(c.bosses) ? c.bosses.slice().sort() : [];
      if (!bosses.length) warnings.push({ chapter: c.chapter, code: 'no-boss', message: 'Chapter ' + (c.name || c.chapter) + ' has no boss troop, so its boss dungeon has an empty troop slot for Day 149 to fill.' });
      var bg = next ? [gateChapter(next.chapter)] : [];
      if (i === shipAt) bg.push(SHIP);
      if (i === airAt) bg.push(AIRSHIP);
      node(c, i, 'dgn', 'boss', { interior: last ? 'castle' : 'dungeon', requires: [gateChapter(c.chapter), gateSeal(c.chapter)], grants: bg, troop: bosses[0] || null, spareBosses: bosses.slice(1), finale: last });
      if (next) {
        // The exit sits on chapter n's side and leads into chapter n + 1's region. A landing also needs the ship.
        var landing = lands[i + 1], req = [gateChapter(next.chapter)];
        if (landing) req.push(SHIP);
        node(c, i, 'gate', 'exit', { requires: req, to: 'reg|' + next.chapter, via: landing ? 'landing' : 'pass' });
        gates.push({ key: gateChapter(next.chapter), kind: landing ? 'landing' : 'pass', from: 'reg|' + c.chapter, to: 'reg|' + next.chapter,
          continent: next.continent, requires: req.slice() });
      }
    }
    // Optional branches, added after the golden path. They need only their chapter's key and never hold a golden key.
    for (i = 0; i < N; i++) {
      for (var v = 1; v <= st.cavesPerChapter; v++) node(chs[i], i, 'dgn', 'cave' + (st.cavesPerChapter > 1 ? v : ''), { interior: 'cave', optional: true });
      if (i === 0 && st.secondTownInChapterOne) node(chs[i], i, 'twn', 'town', { interior: 'town', optional: true });
    }
    nodes.forEach(function (n) { n.optional = !!n.optional; });
    var vehicles = {
      ship: shipAt >= 0 ? { chapter: chs[shipAt].chapter, node: 'dgn|' + chs[shipAt].chapter + '|boss' } : null,
      airship: airAt >= 0 ? { chapter: chs[airAt].chapter, node: 'dgn|' + chs[airAt].chapter + '|boss' } : null
    };
    var g = { version: 1, settings: st, start: N ? [gateChapter(chs[0].chapter)] : [], chapters: chs.map(function (c) { return c.chapter; }),
      regions: regions, nodes: nodes, gates: gates, vehicles: vehicles, warnings: warnings };
    g.digest = digest(nodes.map(function (n) { return n.key + '>' + n.requires.join(',') + '>' + n.grants.join(','); }).concat(gates.map(function (x) { return x.key + '@' + x.kind; })));
    return g;
  }
  // Walks the graph the way a player would: from the start keys, visit every node whose requirements are all held,
  // collect what it grants, and repeat until nothing new opens. Ties go in graph order, so the walk is deterministic.
  // Returns {ok, order [node keys], held [gate keys], stuck [node keys], grantedAt {gate: order index}, openedAt {node: index}}.
  function progWalk(g) {
    var held = {}, done = {}, order = [], grantedAt = {}, openedAt = {}, moved = true;
    (g.start || []).forEach(function (k) { held[k] = 1; grantedAt[k] = -1; });
    while (moved) {
      moved = false;
      for (var i = 0; i < g.nodes.length; i++) {
        var n = g.nodes[i];
        if (done[n.key] || !n.requires.every(function (r) { return held[r]; })) continue;
        done[n.key] = 1; openedAt[n.key] = order.length; order.push(n.key); moved = true;
        n.grants.forEach(function (k) { if (!held[k]) { held[k] = 1; grantedAt[k] = openedAt[n.key]; } });
        break;
      }
    }
    var stuck = g.nodes.filter(function (n) { return !done[n.key]; }).map(function (n) { return n.key; });
    return { ok: !stuck.length, order: order, held: keys(held), stuck: stuck, grantedAt: grantedAt, openedAt: openedAt };
  }
  // Structural problems a graph must never have. Returns a list of {code, message, node}; empty when sound.
  function progCheck(g) {
    var out = [], w = progWalk(g), byKey = {}, chIndex = {};
    g.chapters.forEach(function (c, k) { chIndex[c] = k; });
    g.nodes.forEach(function (n) { byKey[n.key] = n; });
    if (!w.ok) w.stuck.forEach(function (k) { out.push({ code: 'unreachable', node: k, message: 'No path opens ' + k + '.' }); });
    // Every key is granted before the first node that needs it opens.
    g.nodes.forEach(function (n) {
      n.requires.forEach(function (r) {
        if (!(r in w.grantedAt)) out.push({ code: 'never-granted', node: n.key, message: n.key + ' needs ' + r + ', which nothing grants.' });
        else if (n.key in w.openedAt && w.grantedAt[r] >= w.openedAt[n.key]) out.push({ code: 'key-after-lock', node: n.key, message: r + ' is granted after ' + n.key + ' opens.' });
      });
      // Golden keys live on the golden path only, and chapter n's key is granted in chapter n - 1.
      n.grants.forEach(function (k) {
        if (n.optional) out.push({ code: 'optional-golden', node: n.key, message: 'Optional ' + n.key + ' grants ' + k + '.' });
        if (k.indexOf('chapter:') === 0 && chIndex[k.slice(8)] !== n.index + 1) out.push({ code: 'key-chapter', node: n.key, message: k + ' is granted in chapter ' + (n.index + 1) + ', not the chapter before it.' });
        if (k.indexOf('item:seal:') === 0 && k.slice(10) !== n.chapter) out.push({ code: 'seal-chapter', node: n.key, message: k + ' is granted outside its chapter.' });
      });
      // No golden site of a chapter opens without that chapter's key, so neither a vehicle nor a pass breaks sequence.
      if (n.kind !== 'gate' && n.requires.indexOf(gateChapter(n.chapter)) < 0) out.push({ code: 'ungated', node: n.key, message: n.key + ' does not need its chapter key.' });
    });
    return out;
  }
  W.progression = { DEFAULTS: PROG_DEFAULTS, settings: progSettings, build: progBuild, walk: progWalk, check: progCheck,
    gate: { chapter: gateChapter, seal: gateSeal, SHIP: SHIP, AIRSHIP: AIRSHIP } };
