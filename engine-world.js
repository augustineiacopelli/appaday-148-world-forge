/* World Forge ENGINE:WORLD, engine version 1.0.0
 * Forge 148 (AppADay 148). Declares one global, ENGINE_WORLD. No dependencies; reads no host global. */
// === ENGINE:WORLD BEGIN ===
// World Forge generators (AppADay 148). Declares one global, ENGINE_WORLD, and reads no host global: the render engine
// is passed in by the caller wherever it is needed, so Day 150 can load this file beside engine-render.js unchanged.
// Determinism rules for everything in this fence, checked by test/phase1.js:
//   every random choice comes from a seeded generator (never Math.random);
//   every object is walked through util.keys, which sorts (never for in, never an unsorted Object.keys);
//   arithmetic only: no Math.sin, cos, tan, exp, log, pow, or atan, whose last bits may differ between browsers.
//   Math.sqrt, Math.floor, Math.abs, Math.imul, and the four basic operations are exact by the IEEE 754 standard.
var ENGINE_WORLD = (function () {
  'use strict';
  var W = { version: '1.0.0' };

  // ---------------------------------------------------------------- util
  function keys(o) { return o && typeof o === 'object' ? Object.keys(o).sort() : []; }
  function each(o, fn) { var k = keys(o); for (var i = 0; i < k.length; i++) fn(o[k[i]], k[i], i); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  // FNV-1a over numbers (rounded to 1e-9) or strings, for comparing fields and tables cheaply.
  function digest(a) {
    var h = 0x811c9dc5, n = a ? a.length : 0;
    for (var i = 0; i < n; i++) {
      var v = a[i], s = typeof v === 'number' ? String(Math.round(v * 1e9)) : String(v);
      for (var j = 0; j < s.length; j++) { h ^= s.charCodeAt(j); h = Math.imul(h, 0x01000193); }
      h ^= 44; h = Math.imul(h, 0x01000193);
    }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8) + ':' + n;
  }
  W.util = { keys: keys, each: each, clamp: clamp, digest: digest };

  // ---------------------------------------------------------------- hashing and seeded generators
  // xmur3: a string hash whose successive outputs seed generators. hash.str(s) is its first output.
  function xmur3(str) {
    str = String(str);
    for (var i = 0, h = 1779033703 ^ str.length; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return function () { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
  }
  function hashStr(s) { return xmur3(s)(); }
  // A map's sub seed: the master seed mixed with the structural key, so a reroll moves every map and no map moves
  // when another map's key appears or disappears.
  function subSeed(master, key) { return hashStr((Number(master) >>> 0) + '|' + String(key)); }
  W.hash = { xmur3: xmur3, str: hashStr, seed: subSeed };

  // mulberry32: 32 bit state, period 2^32, returns floats in [0, 1).
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // rng(seed) -> a generator function with helpers. Every helper draws from the same stream.
  function rng(seed) {
    var next = mulberry32(seed);
    var r = function () { return next(); };
    r.seed = seed >>> 0;
    r.int = function (n) { return Math.floor(next() * n); };
    r.range = function (a, b) { return a + Math.floor(next() * (b - a + 1)); };
    r.float = function (a, b) { return a + next() * (b - a); };
    r.chance = function (p) { return next() < p; };
    r.pick = function (arr) { return arr.length ? arr[Math.floor(next() * arr.length)] : undefined; };
    // Fisher-Yates on a copy.
    r.shuffle = function (arr) { var a = arr.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(next() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
    // Weighted pick: items [{w}] or numbers; returns the index.
    r.weighted = function (ws) {
      var tot = 0, i;
      for (i = 0; i < ws.length; i++) tot += Math.max(0, Number(typeof ws[i] === 'object' ? ws[i].w : ws[i]) || 0);
      if (tot <= 0) return -1;
      var x = next() * tot;
      for (i = 0; i < ws.length; i++) { x -= Math.max(0, Number(typeof ws[i] === 'object' ? ws[i].w : ws[i]) || 0); if (x < 0) return i; }
      return ws.length - 1;
    };
    return r;
  }
  W.rng = rng;
  W.mulberry32 = mulberry32;

  // ---------------------------------------------------------------- seed independent IDs
  // A world ID is derived from a structural key (for example 'dgn|ch2|boss'), never from the seed and never random, so
  // a reroll keeps every ID that Day 149 may have written. The suffix is four base 36 characters of the key's hash.
  // The result always matches KIT:CORE's ID_RE: three letters, underscore, [a-z0-9_], ending in a letter or digit.
  var ID_PREFIXES = ['map_', 'reg_', 'npc_', 'twn_', 'dgn_'];
  function slugKey(key, max) {
    var s = String(key).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return s.slice(0, max || 40).replace(/_+$/, '');
  }
  function structuralId(prefix, key) {
    var p = String(prefix).toLowerCase();
    if (p.length === 3) p += '_';
    if (ID_PREFIXES.indexOf(p) < 0) throw new Error('Not a world prefix: ' + prefix);
    var suf = ('0000' + (hashStr(p + key) % 1679616).toString(36)).slice(-4), s = slugKey(key);
    return p + (s ? s + '_' : '') + suf;
  }
  W.ids = { PREFIXES: ID_PREFIXES, slug: slugKey, structural: structuralId };

  // ---------------------------------------------------------------- simplex noise
  // 2D simplex noise (Gustavson's formulation), its permutation shuffled by a seeded generator. Output in about [-1, 1].
  var GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0, 1], [0, -1]];
  var F2 = 0.36602540378443864676, G2 = 0.21132486540518711775; // (sqrt(3) - 1) / 2 and (3 - sqrt(3)) / 6
  function simplex(seed) {
    var r = rng(seed), base = [], i;
    for (i = 0; i < 256; i++) base.push(i);
    base = r.shuffle(base);
    var perm = new Uint8Array(512), pm12 = new Uint8Array(512);
    for (i = 0; i < 512; i++) { perm[i] = base[i & 255]; pm12[i] = perm[i] % 12; }
    function corner(gi, x, y) {
      var t = 0.5 - x * x - y * y;
      if (t < 0) return 0;
      t *= t;
      return t * t * (GRAD[gi][0] * x + GRAD[gi][1] * y);
    }
    function noise2(xin, yin) {
      var s = (xin + yin) * F2, i0 = Math.floor(xin + s), j0 = Math.floor(yin + s), t = (i0 + j0) * G2;
      var x0 = xin - (i0 - t), y0 = yin - (j0 - t), i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
      var x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
      var ii = i0 & 255, jj = j0 & 255;
      return 70 * (corner(pm12[ii + perm[jj]], x0, y0) + corner(pm12[ii + i1 + perm[jj + j1]], x1, y1) + corner(pm12[ii + 1 + perm[jj + 1]], x2, y2));
    }
    return { seed: seed >>> 0, noise2: noise2 };
  }
  // Fractal sampling. o: {octaves 4, lacunarity 2, gain 0.5, frequency 1}. Each octave is offset so octaves do not
  // line up at the origin. fbm is normalized back to about [-1, 1]; ridge folds each octave to (1 - |n|), in [0, 1].
  function octaves(gen, x, y, o, fold) {
    o = o || {};
    var n = clamp(Math.floor(Number(o.octaves) || 4), 1, 10), lac = Number(o.lacunarity) || 2, gain = o.gain == null ? 0.5 : Number(o.gain);
    var f = Number(o.frequency) || 1, amp = 1, sum = 0, norm = 0;
    for (var k = 0; k < n; k++) {
      var v = gen.noise2(x * f + k * 19.19, y * f - k * 7.31);
      if (fold) { v = 1 - Math.abs(v); v *= v; }
      sum += v * amp; norm += amp; amp *= gain; f *= lac;
    }
    return norm ? sum / norm : 0;
  }
  function fbm(gen, x, y, o) { return octaves(gen, x, y, o, false); }
  function ridge(gen, x, y, o) { return octaves(gen, x, y, o, true); }
  // field(w, h, seed, o) -> Float64Array of w*h samples, row major. o.scale is cells per noise unit (default 32);
  // o.ridge true samples ridge instead of fbm.
  function field(w, h, seed, o) {
    o = o || {};
    var gen = simplex(seed), sc = Number(o.scale) || 32, out = new Float64Array(w * h), fn = o.ridge ? ridge : fbm;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) out[y * w + x] = fn(gen, x / sc, y / sc, o);
    return out;
  }
  W.noise = { simplex: simplex, fbm: fbm, ridge: ridge, field: field };

  // ---------------------------------------------------------------- quantizing to the five climate bands
  // band(v, thresholds): thresholds are four ascending cut points; the result is how many of them v reaches (0 to 4).
  function band(v, th) {
    var n = 0;
    for (var i = 0; i < th.length && i < 4; i++) if (v >= th[i]) n++;
    return n;
  }
  function bands(arr, th) { var out = new Uint8Array(arr.length); for (var i = 0; i < arr.length; i++) out[i] = band(arr[i], th); return out; }
  // Cut points that split a field into bands holding the given cumulative fractions (four values in (0, 1)), so a band
  // share holds whatever the noise does. Ties go to the higher band. NaN is never produced from finite input.
  function quantile(arr, fractions) {
    var s = Array.prototype.slice.call(arr).sort(function (a, b) { return a - b; }), n = s.length;
    return (fractions || [0.2, 0.4, 0.6, 0.8]).map(function (f) { return n ? s[clamp(Math.floor(clamp(f, 0, 1) * n), 0, n - 1)] : 0; });
  }
  // Rescale a field to [0, 1] by its own min and max (a flat field becomes all zero).
  function normalize(arr) {
    var lo = Infinity, hi = -Infinity, i, out = new Float64Array(arr.length);
    for (i = 0; i < arr.length; i++) { if (arr[i] < lo) lo = arr[i]; if (arr[i] > hi) hi = arr[i]; }
    var d = hi - lo;
    for (i = 0; i < arr.length; i++) out[i] = d > 0 ? (arr[i] - lo) / d : 0;
    return out;
  }
  W.quantize = { band: band, bands: bands, quantile: quantile, normalize: normalize, BANDS: 5 };

  // ---------------------------------------------------------------- climate lookup table
  // The 125 cells of temperature, moisture, and elevation (each 0 to 4) resolved once to a biome tileset by the render
  // engine's own matchClimate, called over the biomes in prioList order so ties resolve the same way every time. The
  // engine stays the authority: a box edit in Day 147 changes the table, not a copy of the rules here.
  // table(art, render) -> {order, cells[125], exact[125], exactCount, nearestCount, features, keys, digest}.
  // Index: t * 25 + m * 5 + e. Feature biomes (volcanic) never match a cell; they are listed for the placement pass.
  function cIndex(t, m, e) { return t * 25 + m * 5 + e; }
  function inBox(c, t, m, e) {
    function inb(r, v) { return Array.isArray(r) && v >= r[0] && v <= r[1]; }
    return !!c && inb(c.temp, t) && inb(c.moist, m) && inb(c.elev, e);
  }
  function climateTable(art, render) {
    if (!render || !render.tiles || typeof render.tiles.matchClimate !== 'function') throw new Error('climate.table needs the render engine from engine-render.js passed in as its second argument.');
    var recs = art && art.records && art.records.til_ ? art.records.til_ : {};
    var order = render.tiles.prioList(art).filter(function (id) { return recs[id] && recs[id].kind === 'biome'; });
    var tils = order.map(function (id) { return recs[id]; });
    var cells = [], exact = [], ex = 0, keyOf = {};
    tils.forEach(function (t) { keyOf[t.id] = t.key || null; });
    for (var t = 0; t < 5; t++) for (var m = 0; m < 5; m++) for (var e = 0; e < 5; e++) {
      var til = render.tiles.matchClimate(tils, t, m, e), hit = !!til && inBox(til.climate, t, m, e);
      cells.push(til ? til.id : null); exact.push(hit); if (hit) ex++;
    }
    var features = tils.filter(function (x) { return x.climate && x.climate.feature; }).map(function (x) {
      return { id: x.id, key: x.key || null, feature: x.climate.feature, temp: x.climate.temp.slice(), moist: x.climate.moist.slice(), elev: x.climate.elev.slice() };
    });
    return { order: order, cells: cells, exact: exact, exactCount: ex, nearestCount: cells.length - ex, features: features, keys: keyOf, digest: digest(cells.concat(order)) };
  }
  function climateLookup(table, t, m, e) { return table.cells[cIndex(clamp(t | 0, 0, 4), clamp(m | 0, 0, 4), clamp(e | 0, 0, 4))]; }
  W.climate = { index: cIndex, inBox: inBox, table: climateTable, lookup: climateLookup };

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

  // ---------------------------------------------------------------- later phases insert sections above this line
  function freeze(o) { Object.freeze(o); keys(o).forEach(function (k) { var v = o[k]; if (v && (typeof v === 'object' || typeof v === 'function') && !Object.isFrozen(v)) freeze(v); }); return o; }
  return freeze(W);
})();
// === ENGINE:WORLD END ===
