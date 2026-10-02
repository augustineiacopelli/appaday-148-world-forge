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
  var GX = new Float64Array(12), GY = new Float64Array(12);
  for (var gq = 0; gq < 12; gq++) { GX[gq] = GRAD[gq][0]; GY[gq] = GRAD[gq][1]; }
  var F2 = 0.36602540378443864676, G2 = 0.21132486540518711775; // (sqrt(3) - 1) / 2 and (3 - sqrt(3)) / 6
  function simplex(seed) {
    var r = rng(seed), base = [], i;
    for (i = 0; i < 256; i++) base.push(i);
    base = r.shuffle(base);
    var perm = new Uint8Array(512), pm12 = new Uint8Array(512);
    for (i = 0; i < 512; i++) { perm[i] = base[i & 255]; pm12[i] = perm[i] % 12; }
    // The three corner contributions are written out in place (same arithmetic, same order as a corner helper would
    // do it), with the gradient components in flat tables, because this is the hottest function in the generator.
    function noise2(xin, yin) {
      var s = (xin + yin) * F2, i0 = Math.floor(xin + s), j0 = Math.floor(yin + s), t = (i0 + j0) * G2;
      var x0 = xin - (i0 - t), y0 = yin - (j0 - t), i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
      var x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
      var ii = i0 & 255, jj = j0 & 255, g, n0 = 0, n1 = 0, n2 = 0;
      var t0 = 0.5 - x0 * x0 - y0 * y0;
      if (t0 >= 0) { g = pm12[ii + perm[jj]]; t0 *= t0; n0 = t0 * t0 * (GX[g] * x0 + GY[g] * y0); }
      var t1 = 0.5 - x1 * x1 - y1 * y1;
      if (t1 >= 0) { g = pm12[ii + i1 + perm[jj + j1]]; t1 *= t1; n1 = t1 * t1 * (GX[g] * x1 + GY[g] * y1); }
      var t2 = 0.5 - x2 * x2 - y2 * y2;
      if (t2 >= 0) { g = pm12[ii + 1 + perm[jj + 1]]; t2 *= t2; n2 = t2 * t2 * (GX[g] * x2 + GY[g] * y2); }
      return 70 * (n0 + n1 + n2);
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

  // ---------------------------------------------------------------- overworld (Phase 3)
  // Continents, climate, regions, gates, and site stamps, drawn around a progression graph already proven solvable.
  // build(spec) -> overworld. spec: {seed, settings (world.settings), graph (Phase 2), minutes {chp: target minutes},
  // palette (palette(art, table) below), paint (optional painted cells, see paint below)}. Pure: the art arrives as
  // plain data and nothing outside the spec is read.
  //
  // Movement is four way. A cell's walkability comes from its tile flags (bit 1 passable, bit 4 swim), except that a
  // gate cell (overlay) is walkable exactly when every key it requires is held, and a site's entrance is never walked
  // through on the overworld (it leads into the interior, which needs the site's chapter key).
  // Structural cells: 1 wall (ridge, ring, lock side), 2 gate, 3 stamp, 4 stamp entrance.
  var OW_DEFAULTS = { landFraction: 0.36, mountainShare: 0.12, highShare: 0.35, ruggedness: 0.35, siteSpacing: 8, attempts: 6, continents: {} };
  var ST_FREE = 0, ST_WALL = 1, ST_GATE = 2, ST_STAMP = 3, ST_DOOR = 4;
  var CLS_WATER = 0, CLS_STRIP = 1, CLS_INNER = 2;
  function num(v, d, a, b) { v = v == null || v === '' ? NaN : Number(v); return isFinite(v) ? clamp(v, a, b) : d; }
  function owSettings(s) {
    s = s || {};
    var o = s.overworld || {}, ms = s.mapSize || {}, nz = s.noise || {}, th = s.thresholds || {}, conts = {};
    each(o.continents, function (v, k) {
      if (!v || typeof v !== 'object') return;
      conts[k] = { radius: num(v.radius, 1, 0.4, 1.8), ruggedness: num(v.ruggedness, NaN, 0, 1), mountains: num(v.mountains, NaN, 0, 0.45) };
    });
    function cuts(a) { return Array.isArray(a) && a.length === 4 ? a.map(function (v) { return num(v, 0.5, 0.01, 0.99); }) : [0.2, 0.4, 0.6, 0.8]; }
    return {
      landFraction: num(o.landFraction, OW_DEFAULTS.landFraction, 0.15, 0.6),
      mountainShare: num(o.mountainShare, OW_DEFAULTS.mountainShare, 0, 0.45),
      highShare: num(o.highShare, OW_DEFAULTS.highShare, 0, 0.9),
      ruggedness: num(o.ruggedness, OW_DEFAULTS.ruggedness, 0, 1),
      siteSpacing: Math.floor(num(o.siteSpacing, OW_DEFAULTS.siteSpacing, 3, 24)),
      attempts: Math.floor(num(o.attempts, OW_DEFAULTS.attempts, 1, 12)),
      continents: conts,
      mapSize: { base: Math.floor(num(ms.base, 96, 16, 1024)), perContinent: Math.floor(num(ms.perContinent, 32, 0, 256)), max: Math.floor(num(ms.max, 256, 32, 1024)) },
      noise: { octaves: Math.floor(num(nz.octaves, 5, 1, 8)), lacunarity: num(nz.lacunarity, 2, 1.2, 4), gain: num(nz.gain, 0.5, 0.1, 0.9), scale: num(nz.scale, 28, 4, 256) },
      thresholds: { temp: cuts(th.temp), moist: cuts(th.moist) },
      featureCoverage: num(s.featureCoverage, 0.35, 0, 1)
    };
  }
  // Side of the square overworld: base plus perContinent cells per continent, capped at max.
  function owSize(n, ms) { ms = ms || {}; return clamp(Math.floor((ms.base || 96) + (ms.perContinent == null ? 32 : ms.perContinent) * Math.max(1, n)), 32, ms.max || 256); }

  // palette(art, table): what the generator draws with, read from the art as plain data. The ocean comes from the
  // climate table; walls use the mountain biome directly (its box is elevation 4 and it is not passable), never the
  // table, because a cold peak looks up as a passable snowfield. Stamps use interior:<kind>, falling back to the
  // dungeon set for caves and castles and to whichever interior exists for towns.
  function owPalette(art, table) {
    var recs = art && art.records && art.records.til_ || {}, flags = {}, problems = [], biomes = {};
    table.order.forEach(function (id) { var t = recs[id]; if (t) { flags[id] = Number(t.flags) | 0; biomes[id] = { key: t.key || null, climate: t.climate || null }; } });
    var ocean = table.cells[cIndex(2, 2, 0)], mountain = null, lowland = null;
    table.order.forEach(function (id) {
      var c = biomes[id].climate, f = flags[id];
      if (!c || c.feature) return;
      var wall = c.elev && c.elev[0] === 4 && c.elev[1] === 4 && !(f & 1) && !(f & 4);
      if (wall && (!mountain || biomes[id].key === 'mountain' && biomes[mountain].key !== 'mountain')) mountain = id;
      if (!lowland && (f & 1) && !(f & 4) && !(f & 8) && c.elev && c.elev[0] <= 2 && c.elev[1] >= 2) lowland = id;
    });
    if (!ocean || !(flags[ocean] & 4)) problems.push({ code: 'no-ocean', message: 'No biome tileset at elevation 0 carries the swim flag, so there is no sea.' });
    if (!mountain) problems.push({ code: 'no-wall', message: 'No biome tileset has an elevation 4 box without the passable flag, so ridges and rings cannot be walls.' });
    if (!lowland) problems.push({ code: 'no-lowland', message: 'No passable lowland biome tileset exists to carve paths with.' });
    var ins = {};
    keys(recs).forEach(function (id) { var t = recs[id]; if (t && t.kind === 'interior' && t.subject && typeof t.subject.ref === 'string' && t.subject.ref.indexOf('interior:') === 0) { var k = t.subject.ref.slice(9); if (!ins[k]) ins[k] = t; } });
    var sets = { dungeon: ins.dungeon || ins.town || null };
    sets.town = ins.town || sets.dungeon; sets.cave = ins.cave || sets.dungeon; sets.castle = ins.castle || sets.dungeon;
    if (!sets.dungeon) problems.push({ code: 'no-interior', message: 'No interior tileset exists to stamp towns and dungeons on the map.' });
    var stamps = {};
    each(sets, function (til, kind) {
      if (!til) return;
      var has = {};
      (til.tiles || []).forEach(function (it) { if (it && it.key) { has[it.key] = 1; flags[til.id + ':' + it.key] = Number(it.flags) | 0; } });
      function ref(k) { return has[k] ? til.id + ':' + k : null; }
      var wall = ref('wall'), door = kind === 'cave' && ref('stairs') ? ref('stairs') : ref('door') || ref('stairs') || ref('floor');
      if (!wall || !door || !(flags[door] & 1)) { problems.push({ code: 'stamp', message: 'Interior tileset ' + til.id + ' needs a wall tile and a passable door for the ' + kind + ' stamp.' }); return; }
      var over = kind === 'town' ? ref('lintel') : kind === 'cave' && door === ref('stairs') ? null : ref('arch');
      if (over && !(flags[over] & 1)) over = null;
      var w = kind === 'castle' ? 5 : 3, h = kind === 'castle' ? 3 : 2, cells = [], ex = w >> 1, ey = h - 1;
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var g = x === ex && y === ey ? door : wall, d = x === ex && y === ey ? over : null;
        if (kind === 'castle' && y === ey && (x === 0 || x === w - 1) && ref('pillar')) g = ref('pillar');
        if (kind === 'castle' && y === ey && (x === 1 || x === w - 2) && ref('torch')) d = ref('torch');
        cells.push({ dx: x, dy: y, g: g, d: d });
      }
      stamps[kind] = { til: til.id, w: w, h: h, cells: cells, entrance: [ex, ey] };
    });
    return { ocean: ocean, mountain: mountain, lowland: lowland, flags: flags, biomes: biomes, table: table, features: table.features,
      stamps: stamps, problems: problems, digest: digest([table.digest, ocean, mountain, lowland].concat(keys(stamps).map(function (k) { return k + '=' + stamps[k].til + '/' + stamps[k].cells.map(function (c) { return c.g + '+' + c.d; }).join(','); }))) };
  }

  // ---------------------------------------------------------------- grid helpers (four way)
  function bfs(w, h, sources, ok) {
    var n = w * h, d = new Int32Array(n), q = new Int32Array(n), qh = 0, qt = 0, i;
    for (i = 0; i < n; i++) d[i] = -1;
    for (i = 0; i < sources.length; i++) { var s = sources[i]; if (d[s] < 0) { d[s] = 0; q[qt++] = s; } }
    while (qh < qt) {
      var c = q[qh++], x = c % w, y = (c - x) / w, nd = d[c] + 1;
      if (x > 0 && d[c - 1] < 0 && ok(c - 1)) { d[c - 1] = nd; q[qt++] = c - 1; }
      if (x < w - 1 && d[c + 1] < 0 && ok(c + 1)) { d[c + 1] = nd; q[qt++] = c + 1; }
      if (y > 0 && d[c - w] < 0 && ok(c - w)) { d[c - w] = nd; q[qt++] = c - w; }
      if (y < h - 1 && d[c + w] < 0 && ok(c + w)) { d[c + w] = nd; q[qt++] = c + w; }
    }
    return d;
  }
  // Four way neighbors of cell i, in a fixed order (left, right, up, down), inside the grid.
  function nb4(i, w, h) { var x = i % w, y = (i - x) / w, out = []; if (x > 0) out.push(i - 1); if (x < w - 1) out.push(i + 1); if (y > 0) out.push(i - w); if (y < h - 1) out.push(i + w); return out; }
  // Connected components of cells where ok(i): returns {label Int32Array (-1 outside), sizes []}.
  function components(w, h, ok) {
    var n = w * h, lab = new Int32Array(n), q = new Int32Array(n), sizes = [], i;
    for (i = 0; i < n; i++) lab[i] = -1;
    for (i = 0; i < n; i++) {
      if (lab[i] >= 0 || !ok(i)) continue;
      var id = sizes.length, qh = 0, qt = 0;
      lab[i] = id; q[qt++] = i;
      while (qh < qt) {
        var c = q[qh++], x = c % w, y = (c - x) / w;
        if (x > 0 && lab[c - 1] < 0 && ok(c - 1)) { lab[c - 1] = id; q[qt++] = c - 1; }
        if (x < w - 1 && lab[c + 1] < 0 && ok(c + 1)) { lab[c + 1] = id; q[qt++] = c + 1; }
        if (y > 0 && lab[c - w] < 0 && ok(c - w)) { lab[c - w] = id; q[qt++] = c - w; }
        if (y < h - 1 && lab[c + w] < 0 && ok(c + w)) { lab[c + w] = id; q[qt++] = c + w; }
      }
      sizes.push(qt);
    }
    return { label: lab, sizes: sizes };
  }
  // Largest component only (cheaper than labeling everything twice): returns a Uint8Array mask.
  function largest(w, h, ok, within) {
    var c = components(w, h, ok), best = -1, bs = 0, n = w * h, m = new Uint8Array(n);
    c.sizes.forEach(function (s, k) { if (s > bs) { bs = s; best = k; } });
    for (var i = 0; i < n; i++) if (c.label[i] === best && best >= 0) m[i] = 1;
    return { mask: m, size: bs, count: c.sizes.length };
  }
  // Noise on a lattice step cells apart, filled in bilinearly. Kept out of the attempt's closure so its loop variables
  // stay local (much faster), like the other hot loops below.
  function lattice(gen, fn, o, w, h, step, sc) {
    var lw = Math.floor((w - 1) / step) + 2, lh = Math.floor((h - 1) / step) + 2, lat = new Float64Array(lw * lh), out = new Float64Array(w * h), lx, ly, xx, yy;
    for (ly = 0; ly < lh; ly++) for (lx = 0; lx < lw; lx++) lat[ly * lw + lx] = fn(gen, lx * step / sc, ly * step / sc, o);
    for (yy = 0; yy < h; yy++) {
      var gy = Math.floor(yy / step), fy = (yy - gy * step) / step;
      for (xx = 0; xx < w; xx++) {
        var gx = Math.floor(xx / step), fx = (xx - gx * step) / step, a = gy * lw + gx;
        var top = lat[a] + (lat[a + 1] - lat[a]) * fx, bot = lat[a + lw] + (lat[a + lw + 1] - lat[a + lw]) * fx;
        out[yy * w + xx] = top + (bot - top) * fy;
      }
    }
    return out;
  }
  // Strongest mask per cell; a close contest, the border margin, or no positive mask leaves water (-1).
  function maskOwners(conts, MN, w, h) {
    var owner = new Int16Array(w * h), K = conts.length, cx = new Float64Array(K), cy = new Float64Array(K), cr = new Float64Array(K), cg = new Float64Array(K), x, y, k;
    for (k = 0; k < K; k++) { cx[k] = conts[k].x; cy[k] = conts[k].y; cr[k] = conts[k].r; cg[k] = conts[k].rug; }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      // Near the map edge every mask is pulled down, so coasts curve away from the border instead of being sliced by it.
      var i = y * w + x, b1 = -Infinity, b2 = -Infinity, bi = -1, m = MN[i], ed = x + 0.5, edgePen = 0;
      if (y + 0.5 < ed) ed = y + 0.5; if (w - x - 0.5 < ed) ed = w - x - 0.5; if (h - y - 0.5 < ed) ed = h - y - 0.5;
      if (ed < 12) edgePen = (12 - ed) / 12 * 0.9;
      for (k = 0; k < K; k++) {
        var dx = x + 0.5 - cx[k], dy = y + 0.5 - cy[k], d2 = dx * dx + dy * dy, rm = cr[k] * (1 + cg[k]);
        if (d2 >= rm * rm) continue;
        var v = 1 - Math.sqrt(d2) / cr[k] + cg[k] * m - edgePen;
        if (v > b1) { b2 = b1; b1 = v; bi = k; } else if (v > b2) b2 = v;
      }
      owner[i] = b1 > 0 && !(b2 > 0 && b1 - b2 < 0.08) && x >= 3 && y >= 3 && x < w - 3 && y < h - 3 ? bi : -1;
    }
    return owner;
  }
  // Land within two cells (Chebyshev) of another continent's land becomes water: a 5 by 5 running minimum and maximum
  // of the owner (water ignored) differs from the cell's own owner exactly when another continent is that close.
  function cutStraits(owner, w, h) {
    var n = w * h, BIG = 32767, rmin = new Int16Array(n), rmax = new Int16Array(n), cut = new Uint8Array(n), x, y, q;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var mn = BIG, mx = -1, x0 = x - 2 < 0 ? 0 : x - 2, x1 = x + 2 > w - 1 ? w - 1 : x + 2;
      for (q = x0; q <= x1; q++) { var o = owner[y * w + q]; if (o >= 0) { if (o < mn) mn = o; if (o > mx) mx = o; } }
      rmin[y * w + x] = mn; rmax[y * w + x] = mx;
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var i = y * w + x, me = owner[i];
      if (me < 0) continue;
      var mn2 = BIG, mx2 = -1, y0 = y - 2 < 0 ? 0 : y - 2, y1 = y + 2 > h - 1 ? h - 1 : y + 2;
      for (q = y0; q <= y1; q++) { var j = q * w + x; if (rmin[j] < mn2) mn2 = rmin[j]; if (rmax[j] > mx2) mx2 = rmax[j]; }
      if (mn2 !== me || mx2 !== me) cut[i] = 1;
    }
    for (x = 0; x < n; x++) if (cut[x]) owner[x] = -1;
  }
  // Raw temperature (falls with latitude and height) and moisture (rises toward water) for every cell.
  function climateRaw(elev, waterDist, TN, MO, w, h) {
    var n = w * h, traw = new Float64Array(n), mraw = new Float64Array(n), half = h / 2;
    for (var i = 0; i < n; i++) {
      var y = (i - i % w) / w, lat = (y + 0.5 - half) / half, e = elev[i], wd = waterDist[i];
      if (lat < 0) lat = -lat;
      traw[i] = (1 - lat) * 0.7 + 0.3 * TN[i] - (e === 3 ? 0.06 : e === 4 ? 0.15 : 0);
      mraw[i] = 0.6 * (1 - (wd < 10 ? wd : 10) / 10) + 0.4 * MO[i];
    }
    return { t: traw, m: mraw };
  }
  function byScoreDesc(score) { return function (a, b) { return score[b] - score[a] || a - b; }; }

  // ---------------------------------------------------------------- one attempt
  function owAttempt(spec, attempt) {
    var S = owSettings(spec.settings), pal = spec.palette, g = spec.graph, master = Number(spec.seed) >>> 0, P = pal.problems.slice();
    function sk(name) { return subSeed(master, 'overworld|' + name + (attempt ? '|' + attempt : '')); }
    var R = rng(sk('layout'));
    // Continents in order of first appearance, each with the regions (chapters) it holds in story order.
    var regs = g.regions.map(function (r) { return { key: r.key, chapter: r.chapter, index: r.index, continent: r.continent, label: r.label, entry: r.entry, part: r.part, minutes: Math.max(1, Number(spec.minutes && spec.minutes[r.chapter]) || 60) }; });
    var conts = [], cBy = {};
    regs.forEach(function (r) {
      if (!cBy[r.continent]) { cBy[r.continent] = { slug: r.continent, label: r.label, minutes: 0, regs: [] }; conts.push(cBy[r.continent]); }
      cBy[r.continent].minutes += r.minutes; cBy[r.continent].regs.push(r);
    });
    var N = owSize(conts.length, S.mapSize), w = N, h = N, n = w * h, i, x, y;
    var oNoise = { octaves: S.noise.octaves, lacunarity: S.noise.lacunarity, gain: S.noise.gain };
    // Smooth layers are sampled on a coarser lattice (step cells apart) and filled in bilinearly, which looks the same at
    // these scales and costs a fraction of sampling every cell. Plain arithmetic, so it is as deterministic as the noise.
    function nf(name, scaleMul, octs, ridge, step) {
      return lattice(W.noise.simplex(sk(name)), ridge ? W.noise.ridge : W.noise.fbm, { octaves: Math.min(octs, oNoise.octaves), lacunarity: oNoise.lacunarity, gain: oNoise.gain }, w, h, step || 2, S.noise.scale * scaleMul);
    }

    // 1. Continent centers by seeded rejection sampling with a minimum separation, radii weighted by target minutes.
    var totMin = conts.reduce(function (a, c) { return a + c.minutes; }, 0), landArea = S.landFraction * n;
    conts.forEach(function (c) {
      var ov = S.continents[c.slug] || {}, r = Math.sqrt(landArea * c.minutes / totMin / 3.141592653589793) * (ov.radius || 1);
      c.r = clamp(r, 8, N * 0.42);
      c.rug = isFinite(ov.ruggedness) ? ov.ruggedness : S.ruggedness;
      c.mountains = isFinite(ov.mountains) ? ov.mountains : S.mountainShare;
      var lo = 4 + c.r * 0.85, hi = N - 4 - c.r * 0.85;
      if (hi < lo) lo = hi = N / 2;
      var best = null, bs = -Infinity;
      for (var t = 0; t < 120; t++) {
        var cx = R.float(lo, hi), cy = R.float(lo, hi), sc = Infinity;
        conts.forEach(function (o) { if (o === c || o.x == null) return; var dx = cx - o.x, dy = cy - o.y, s = Math.sqrt(dx * dx + dy * dy) - (c.r + o.r); if (s < sc) sc = s; });
        if (sc >= 6) { best = [cx, cy]; break; }
        if (sc > bs) { bs = sc; best = [cx, cy]; }
      }
      c.x = best[0]; c.y = best[1];
    });

    // 2. Masks: distance falloff plus fractal noise. A cell belongs to the strongest mask; close contests, the border
    // margin, and any land within two cells of another continent become ocean, so straits are at least two cells wide.
    var owner = maskOwners(conts, nf('mask', 1.6, 4), w, h);
    cutStraits(owner, w, h);
    // Each continent keeps its largest landmass, so every chapter's ground is one walkable piece before walls go up.
    conts.forEach(function (c, k) {
      var L = largest(w, h, function (j) { return owner[j] === k; });
      c.cells = L.size;
      for (var j = 0; j < n; j++) if (owner[j] === k && !L.mask[j]) owner[j] = -1;
      if (L.size < 60) P.push({ code: 'continent-lost', message: 'Continent ' + c.label + ' came out too small (' + L.size + ' cells).' });
    });

    // 3. Sea (water joined to the map edge), lakes, and distances.
    var seaSrc = [];
    for (i = 0; i < n; i++) { x = i % w; y = (i - x) / w; if (owner[i] < 0 && (x === 0 || y === 0 || x === w - 1 || y === h - 1)) seaSrc.push(i); }
    var seaD0 = bfs(w, h, seaSrc, function (j) { return owner[j] < 0; }), sea = new Uint8Array(n), seaCells = [], waterCells = [];
    for (i = 0; i < n; i++) { if (seaD0[i] >= 0) { sea[i] = 1; seaCells.push(i); } if (owner[i] < 0) waterCells.push(i); }
    var all = function () { return true; }, seaDist = bfs(w, h, seaCells, all), waterDist = bfs(w, h, waterCells, all);

    // 4. Elevation: coast within one or two cells of water, mountains from ridge noise on inland ground, high and low
    // ground from the shape of the land and noise. Shares are per continent so every continent gets its mountains.
    var EN = W.quantize.normalize(nf('elev', 1, 4)), RN = W.quantize.normalize(nf('ridge', 1.2, 3, true)), elev = new Uint8Array(n), hs = new Float64Array(n), ms = new Float64Array(n);
    for (i = 0; i < n; i++) {
      if (owner[i] < 0) { elev[i] = 0; continue; }
      var wd = waterDist[i];
      if (wd === 1 || wd === 2 && EN[i] < 0.5) { elev[i] = 1; continue; }
      elev[i] = 2;
      hs[i] = 0.55 * Math.min(wd, 16) / 16 + 0.45 * EN[i];
      ms[i] = 0.65 * RN[i] + 0.35 * hs[i];
    }
    conts.forEach(function (c, k) {
      var mc = [], hc = [];
      for (var j = 0; j < n; j++) if (owner[j] === k && elev[j] === 2) { if (seaDist[j] >= 4 && waterDist[j] >= 3) mc.push(j); }
      mc.sort(byScoreDesc(ms));
      var mN = Math.floor(mc.length * c.mountains);
      for (var q = 0; q < mN; q++) elev[mc[q]] = 4;
      for (j = 0; j < n; j++) if (owner[j] === k && elev[j] === 2) hc.push(j);
      hc.sort(byScoreDesc(hs));
      var hN = Math.floor(hc.length * S.highShare);
      for (q = 0; q < hN; q++) elev[hc[q]] = 3;
    });

    // 5. Temperature falls with latitude and elevation; moisture rises toward water. Each is cut into five bands at
    // the fractions held in world.settings.thresholds, measured over the land, and the biome comes from the table.
    var TN = W.quantize.normalize(nf('temp', 2.5, 2, false, 4)), MO = W.quantize.normalize(nf('moist', 1.4, 3));
    var raw = climateRaw(elev, waterDist, TN, MO, w, h), traw = raw.t, mraw = raw.m, landT = [], landM = [];
    for (i = 0; i < n; i++) if (owner[i] >= 0) { landT.push(traw[i]); landM.push(mraw[i]); }
    var tCut = W.quantize.quantile(landT, S.thresholds.temp), mCut = W.quantize.quantile(landM, S.thresholds.moist);
    var temp = new Uint8Array(n), moist = new Uint8Array(n), ground = new Array(n), deco = new Array(n), tb = pal.table;
    for (i = 0; i < n; i++) {
      temp[i] = W.quantize.band(traw[i], tCut); moist[i] = owner[i] < 0 ? 2 : W.quantize.band(mraw[i], mCut);
      ground[i] = climateLookup(tb, temp[i], moist[i], elev[i]); deco[i] = null;
    }
    var flags = pal.flags;
    function fl(ref) { return flags[ref] | 0; }

    // 6. Regions: a continent shared by several chapters is cut into bands across a seeded direction, each band's share
    // weighted by its chapter's minutes, with a noisy edge. Stray pieces join the band they touch.
    var region = new Int16Array(n), regIdx = {};
    for (i = 0; i < n; i++) region[i] = -1;
    regs.forEach(function (r, k) { regIdx[r.key] = k; });
    var RG = nf('regions', 1.5, 2, false, 4);
    conts.forEach(function (c, k) {
      var cells = [];
      for (var j = 0; j < n; j++) if (owner[j] === k) cells.push(j);
      if (c.regs.length === 1) { cells.forEach(function (j) { region[j] = regIdx[c.regs[0].key]; }); return; }
      var dx = 0, dy = 0, len = 0, Rk = rng(sk('split|' + c.slug));
      while (len < 0.2) { dx = Rk.float(-1, 1); dy = Rk.float(-1, 1); len = Math.sqrt(dx * dx + dy * dy); }
      dx /= len; dy /= len;
      var p = new Float64Array(n), amp = 0.22 * c.r;
      cells.forEach(function (j) { var cx = j % w, cy = (j - cx) / w; p[j] = cx * dx + cy * dy + amp * RG[j]; });
      cells.sort(function (a, b) { return p[a] - p[b] || a - b; });
      var tot = c.regs.reduce(function (a, r) { return a + r.minutes; }, 0), acc = 0, ri = 0, lim = c.regs[0].minutes / tot * cells.length;
      cells.forEach(function (j, q) { while (q >= lim && ri < c.regs.length - 1) { ri++; acc += c.regs[ri - 1].minutes; lim = (acc + c.regs[ri].minutes) / tot * cells.length; } region[j] = regIdx[c.regs[ri].key]; });
      c.regs.forEach(function (r) {
        var me = regIdx[r.key], L = largest(w, h, function (j) { return region[j] === me; });
        for (var j = 0; j < n; j++) if (region[j] === me && !L.mask[j]) region[j] = -2;
      });
      var src = cells.filter(function (j) { return region[j] >= 0; });
      var q = src.slice(), qh = 0;
      while (qh < q.length) { var cc = q[qh++]; nb4(cc, w, h).forEach(function (j) { if (region[j] === -2) { region[j] = region[cc]; q.push(j); } }); }
      cells.forEach(function (j) { if (region[j] === -2) region[j] = -1; });
    });
    regs.forEach(function (r, k) { var cnt = 0; for (var j = 0; j < n; j++) if (region[j] === k) cnt++; r.cells = cnt; if (cnt < 80) P.push({ code: 'region-small', message: 'Region for chapter ' + r.chapter + ' came out too small (' + cnt + ' cells).' }); });

    // 7. Rings and ridges. After the ship arrives, every later region that touches the sea is ringed: the ring is its
    // land three steps from the sea (which every four way path from the shore inland must cross), the strip outside
    // it is the beach. Every boundary between two regions is a two cell mountain ridge.
    var shipIdx = g.vehicles && g.vehicles.ship ? g.chapters.indexOf(g.vehicles.ship.chapter) : -1;
    var st = new Uint8Array(n), cls = new Uint8Array(n);
    regs.forEach(function (r, k) {
      var touches = false;
      for (var j = 0; j < n; j++) if (region[j] === k && seaDist[j] === 1) { touches = true; break; }
      r.ringed = shipIdx >= 0 && r.index > shipIdx && touches;
      if (r.entry === 'landing' && !touches) P.push({ code: 'landing-no-coast', message: 'Region for chapter ' + r.chapter + ' is entered by sea but has no coast.' });
    });
    for (i = 0; i < n; i++) {
      if (owner[i] < 0) { cls[i] = CLS_WATER; continue; }
      var rr = region[i] >= 0 ? regs[region[i]] : null;
      if (rr && rr.ringed && seaDist[i] <= 2) cls[i] = CLS_STRIP;
      else { cls[i] = CLS_INNER; if (rr && rr.ringed && seaDist[i] === 3) st[i] = ST_WALL; }
    }
    for (i = 0; i < n; i++) {
      if (region[i] < 0) continue;
      var nbs = nb4(i, w, h);
      for (var q2 = 0; q2 < nbs.length; q2++) { var j2 = nbs[q2]; if (region[j2] >= 0 && region[j2] !== region[i]) { st[i] = ST_WALL; break; } }
    }
    function walk(j) { return st[j] === ST_FREE && (fl(ground[j]) & 1) === 1; }
    function inner(j, k) { return region[j] === k && cls[j] === CLS_INNER && st[j] === ST_FREE; }

    // 8. Gates. A pass is a two cell gap in the ridge between consecutive chapters; a landing (or, for a ringed region
    // entered over a pass, a seawall) is one cell of the ring. Gate cells stay mountain; the overlay opens them.
    var gates = [], anchors = {}, need = {};
    regs.forEach(function (r, k) { need[k] = []; });
    (g.gates || []).forEach(function (gt) {
      if (gt.kind !== 'pass') return;
      var a = regIdx[gt.from], b = regIdx[gt.to], good = [], any = [];
      for (var j = 0; j < n; j++) {
        if (region[j] !== a || st[j] !== ST_WALL) continue;
        var jx = j % w, jy = (j - jx) / w;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          var bx = jx + d[0], by = jy + d[1], c1x = jx - d[0], c1y = jy - d[1], c2x = bx + d[0], c2y = by + d[1];
          if (c1x < 0 || c1y < 0 || c2x < 0 || c2y < 0 || c1x >= w || c2x >= w || c1y >= h || c2y >= h) return;
          var bj = by * w + bx, c1 = c1y * w + c1x, c2 = c2y * w + c2x;
          if (region[bj] !== b || st[bj] !== ST_WALL || !inner(c1, a) || !inner(c2, b)) return;
          var cand = [j, bj, c1, c2];
          any.push(cand);
          if (walk(c1) && walk(c2)) good.push(cand);
        });
      }
      var pick = good.length ? R.pick(good) : R.pick(any);
      if (!pick) { P.push({ code: 'no-pass', message: 'No place for the pass from chapter ' + regs[a].chapter + ' to ' + regs[b].chapter + '.' }); return; }
      st[pick[0]] = ST_GATE; st[pick[1]] = ST_GATE;
      gates.push({ key: 'pass|' + gt.from + '|' + gt.to, gate: gt.key, kind: 'pass', requires: gt.requires.slice(), from: gt.from, region: gt.to, cells: [pick[0], pick[1]] });
      need[a].push(pick[2]); anchors[b] = pick[3];
    });
    regs.forEach(function (r, k) {
      if (!r.ringed) return;
      var gt = (g.gates || []).filter(function (x2) { return x2.to === r.key && x2.kind === 'landing'; })[0] || null, good = [], any = [];
      for (var j = 0; j < n; j++) {
        if (region[j] !== k || st[j] !== ST_WALL || seaDist[j] !== 3) continue;
        var ns = nb4(j, w, h), beach = -1, land = -1;
        ns.forEach(function (q3) { if (region[q3] === k && cls[q3] === CLS_STRIP && st[q3] === ST_FREE && seaDist[q3] === 2 && walk(q3)) beach = q3; if (seaDist[q3] === 4 && inner(q3, k)) land = q3; });
        if (beach < 0 || land < 0) continue;
        any.push([j, land, beach]);
        if (walk(land)) good.push([j, land, beach]);
      }
      var pick = good.length ? R.pick(good) : R.pick(any);
      if (!pick) { P.push({ code: 'no-ring-pass', message: 'No place for the landing into chapter ' + r.chapter + '.' }); return; }
      st[pick[0]] = ST_GATE;
      var req = gt ? gt.requires.slice() : ['chapter:' + r.chapter];
      gates.push({ key: (gt ? 'landing|' : 'seawall|') + r.key, gate: gt ? gt.key : 'chapter:' + r.chapter, kind: gt ? 'landing' : 'seawall', requires: req, from: gt ? gt.from : null, region: r.key, cells: [pick[0]], beach: pick[2] });
      if (anchors[k] == null) anchors[k] = pick[1]; else need[k].push(pick[1]);
    });

    // 9. Feature biomes (volcanic) last among the terrain: an extra noise layer ranks the inland cells inside the
    // biome's own climate box, and the top share up to featureCoverage takes the feature.
    var feat = new Uint8Array(n);
    (pal.features || []).forEach(function (f) {
      var el = [], FN = nf('feature|' + f.id, 0.6, 2);
      for (var j = 0; j < n; j++) if (owner[j] >= 0 && cls[j] === CLS_INNER && st[j] === ST_FREE && W.climate.inBox(f, temp[j], moist[j], elev[j])) el.push(j);
      el.sort(byScoreDesc(FN));
      var cnt = Math.floor(el.length * S.featureCoverage);
      for (var q4 = 0; q4 < cnt; q4++) { ground[el[q4]] = f.id; feat[el[q4]] = 1; }
    });

    // Carving: joins every required point of a region to the anchor's ground, turning blocked cells on the shortest
    // path into passable lowland. Returns false when no path exists inside the region.
    function carveCell(j) {
      if (fl(ground[j]) & 1) return;
      var lk = climateLookup(tb, temp[j], moist[j], 2), f = fl(lk);
      ground[j] = (f & 1) && !(f & 4) && !(f & 8) ? lk : pal.lowland;
      elev[j] = 2; feat[j] = 0;
    }
    function joinAll(k, anchor, points) {
      if (anchor == null) return true;
      if (!walk(anchor)) carveCell(anchor);
      var main = new Uint8Array(n), ok = true;
      function grow(from) { var d = bfs(w, h, [from], function (j) { return inner(j, k) && walk(j); }); for (var j = 0; j < n; j++) if (d[j] >= 0) main[j] = 1; }
      grow(anchor);
      // The anchor joins the region's largest walkable ground first, so sites have room around it.
      var L = largest(w, h, function (j) { return inner(j, k) && walk(j); }), rep = -1;
      for (var j0 = 0; j0 < n && rep < 0; j0++) if (L.mask[j0]) rep = j0;
      (rep >= 0 ? [rep] : []).concat(points).forEach(function (pt) {
        if (main[pt]) return;
        if (!inner(pt, k)) { ok = false; return; }
        var prev = new Int32Array(n), hit = -1;
        for (var j = 0; j < n; j++) prev[j] = -2;
        prev[pt] = -1;
        var q5 = [pt], qh2 = 0;
        while (qh2 < q5.length && hit < 0) {
          var c5 = q5[qh2++];
          if (main[c5]) { hit = c5; break; }
          nb4(c5, w, h).forEach(function (j) { if (prev[j] === -2 && inner(j, k)) { prev[j] = c5; q5.push(j); } });
        }
        if (hit < 0) { ok = false; return; }
        for (var c6 = hit; c6 >= 0; c6 = prev[c6]) carveCell(c6);
        grow(pt);
      });
      return ok;
    }

    // 10. Sites. Each region's anchor is where the player arrives (the pass or landing), or for the first chapter the
    // middle of its largest ground. Start towns sit near the anchor, key dungeons midway, boss dungeons far away, and
    // optional sites anywhere, all on low or high ground (never coast, mountain, or feature) with spacing between them.
    var sites = [], placed = [], start = null;
    function siteOrder(a, b) { var o = { start: 0, key: 1, boss: 2 }; return (o[a.role] == null ? 3 : o[a.role]) - (o[b.role] == null ? 3 : o[b.role]); }
    regs.forEach(function (r, k) {
      if (anchors[k] == null) {
        var L = largest(w, h, function (j) { return inner(j, k) && walk(j); }), sx = 0, sy = 0, cnt = 0, best = -1, bd = Infinity;
        for (var j = 0; j < n; j++) if (L.mask[j]) { sx += j % w; sy += (j - j % w) / w; cnt++; }
        for (j = 0; j < n; j++) if (L.mask[j]) { var ddx = j % w - sx / cnt, ddy = (j - j % w) / w - sy / cnt, dd = ddx * ddx + ddy * ddy; if (dd < bd) { bd = dd; best = j; } }
        anchors[k] = best >= 0 ? best : null;
      }
      if (anchors[k] == null) { P.push({ code: 'no-anchor', message: 'Region for chapter ' + r.chapter + ' has no walkable ground.' }); return; }
      if (!joinAll(k, anchors[k], need[k])) P.push({ code: 'carve', message: 'A gate of chapter ' + r.chapter + ' cannot be joined to its region.' });
      var nodes = g.nodes.filter(function (nd) { return nd.region === r.key && (nd.kind === 'twn' || nd.kind === 'dgn'); }).slice().sort(function (a, b) { return siteOrder(a, b) || g.nodes.indexOf(a) - g.nodes.indexOf(b); });
      var dist = bfs(w, h, [anchors[k]], function (j) { return inner(j, k) && walk(j); });
      // Good ground for a stamp zone, kept current as stamps go down, and the region's bounding box for the search.
      var goodCell = new Uint8Array(n), bx0 = w, by0 = h, bx1 = -1, by1 = -1;
      for (var j1 = 0; j1 < n; j1++) {
        if (region[j1] !== k) continue;
        var x1a = j1 % w, y1a = (j1 - x1a) / w;
        if (x1a < bx0) bx0 = x1a; if (x1a > bx1) bx1 = x1a; if (y1a < by0) by0 = y1a; if (y1a > by1) by1 = y1a;
        goodCell[j1] = inner(j1, k) && walk(j1) && !feat[j1] && (elev[j1] === 2 || elev[j1] === 3) ? 1 : 0;
      }
      var BW = bx1 - bx0 + 1, BH = by1 - by0 + 1;
      nodes.forEach(function (nd) {
        var kind = nd.interior === 'castle' ? 'castle' : nd.interior === 'cave' ? 'cave' : nd.interior === 'town' ? 'town' : 'dungeon', stp = pal.stamps[kind];
        if (!stp) { P.push({ code: 'no-stamp', message: 'No stamp for ' + kind + '.' }); return; }
        var boss = nd.role === 'boss', ex = stp.entrance[0], ey = stp.entrance[1];
        // Summed area table of good ground for the zone test.
        if (BW <= 0 || BH <= 0) return;
        var good = new Int32Array((BW + 1) * (BH + 1));
        for (var yy2 = 0; yy2 < BH; yy2++) for (var xx2 = 0; xx2 < BW; xx2++) {
          good[(yy2 + 1) * (BW + 1) + xx2 + 1] = goodCell[(yy2 + by0) * w + xx2 + bx0] + good[yy2 * (BW + 1) + xx2 + 1] + good[(yy2 + 1) * (BW + 1) + xx2] - good[yy2 * (BW + 1) + xx2];
        }
        // rect in map coordinates; anything outside the box counts as bad ground.
        function rect(x0, y0, x1, y1) {
          x0 -= bx0; x1 -= bx0; y0 -= by0; y1 -= by0;
          if (x0 < 0 || y0 < 0 || x1 >= BW || y1 >= BH) return -1;
          return good[(y1 + 1) * (BW + 1) + x1 + 1] - good[y0 * (BW + 1) + x1 + 1] - good[(y1 + 1) * (BW + 1) + x0] + good[y0 * (BW + 1) + x0];
        }
        var zx0 = -1, zy0 = -1, zx1 = stp.w, zy1 = stp.h + 1 + (boss ? 1 : 0), cands = [];
        for (var sy2 = Math.max(1, by0 + 1); sy2 + zy1 < h - 1 && sy2 <= by1; sy2++) for (var sx2 = Math.max(1, bx0 + 1); sx2 + zx1 < w - 1 && sx2 <= bx1; sx2++) {
          var x0 = sx2 + zx0, y0 = sy2 + zy0, x1 = sx2 + zx1, y1 = sy2 + zy1;
          if (rect(x0, y0, x1, y1) !== (x1 - x0 + 1) * (y1 - y0 + 1)) continue;
          var front = (sy2 + ey + 1) * w + sx2 + ex, reach = boss ? front + w : front;
          if (dist[reach] < 0) continue;
          cands.push({ x: sx2, y: sy2, d: dist[reach] });
        }
        cands.sort(function (a, b) { return a.d - b.d || a.y - b.y || a.x - b.x; });
        var L2 = cands.length, lo = 0, hi = L2;
        if (nd.role === 'start') hi = Math.max(1, Math.floor(L2 * 0.2));
        else if (nd.role === 'key') { lo = Math.floor(L2 * 0.4); hi = Math.max(lo + 1, Math.floor(L2 * 0.65)); }
        else if (boss) lo = Math.min(Math.max(0, L2 - 1), Math.floor(L2 * 0.85));
        function spaced(list, a0, a1, sp0) {
          var outp = [];
          if (a1 > list.length) a1 = list.length;
          for (var q8 = a0; q8 < a1; q8++) {
            var c7 = list[q8], cx7 = c7.x + stp.w / 2, cy7 = c7.y + stp.h / 2, okp = true;
            for (var p8 = 0; p8 < placed.length && okp; p8++) { var ax = placed[p8][0] - cx7, ay = placed[p8][1] - cy7; if ((ax < 0 ? -ax : ax) < sp0 && (ay < 0 ? -ay : ay) < sp0) okp = false; }
            if (okp) outp.push(c7);
          }
          return outp;
        }
        var pick = null;
        for (var sp = S.siteSpacing; sp >= 3 && !pick; sp -= 2) {
          var pool = spaced(cands, lo, hi, sp);
          if (!pool.length && sp - 2 < 3 && lo > 0) pool = spaced(cands, 0, cands.length, 3);
          if (pool.length) pick = R.pick(pool);
        }
        if (!pick) { P.push({ code: 'no-site-room', message: 'No room for ' + nd.key + '.' }); return; }
        stp.cells.forEach(function (c8) { var j = (pick.y + c8.dy) * w + pick.x + c8.dx; ground[j] = c8.g; deco[j] = c8.d; st[j] = c8.dx === ex && c8.dy === ey ? ST_DOOR : ST_STAMP; elev[j] = 2; });
        var ent = (pick.y + ey) * w + pick.x + ex, fr = ent + w, site = { key: nd.key, record: nd.record || null, kind: nd.kind, role: nd.role, chapter: nd.chapter, region: r.key,
          interior: nd.interior, stamp: kind, x: pick.x, y: pick.y, w: stp.w, h: stp.h, entrance: ent, front: fr, golden: !!nd.golden };
        if (boss) {
          // The lock: the cell in front of the boss entrance is a gate needing the chapter key and its seal, with walls on
          // both sides, so the only way to the door is through it.
          var lockNode = g.nodes.filter(function (x9) { return x9.region === r.key && x9.role === 'lock'; })[0];
          st[fr] = ST_GATE; st[fr - 1] = ST_WALL; st[fr + 1] = ST_WALL; ground[fr - 1] = pal.mountain; ground[fr + 1] = pal.mountain; elev[fr - 1] = 4; elev[fr + 1] = 4;
          site.approach = fr + w;
          gates.push({ key: 'lock|' + r.chapter, gate: lockNode ? lockNode.key : 'gate|' + r.chapter + '|lock', kind: 'lock', requires: lockNode ? lockNode.requires.slice() : ['chapter:' + r.chapter, 'item:seal:' + r.chapter], from: null, region: r.key, cells: [fr] });
          need[k].push(site.approach);
        } else need[k].push(fr);
        for (var zy = pick.y + zy0; zy <= pick.y + zy1; zy++) for (var zx = pick.x + zx0; zx <= pick.x + zx1; zx++) goodCell[zy * w + zx] = 0;
        if (nd.role === 'start' && r.index === 0) start = fr;
        placed.push([pick.x + stp.w / 2, pick.y + stp.h / 2]);
        sites.push(site);
      });
      if (!joinAll(k, anchors[k], need[k])) P.push({ code: 'carve', message: 'A site of chapter ' + r.chapter + ' cannot be joined to its region.' });
    });

    // 11. Walls take the mountain biome directly; gates in ridges and rings stay mountain (the overlay opens them).
    for (i = 0; i < n; i++) if (st[i] === ST_WALL || st[i] === ST_GATE && owner[i] >= 0 && !gates.some(function (gq) { return gq.kind === 'lock' && gq.cells[0] === i; })) { ground[i] = pal.mountain; elev[i] = 4; feat[i] = 0; }
    var gateAt = new Int16Array(n);
    for (i = 0; i < n; i++) gateAt[i] = -1;
    gates.forEach(function (gq, k) { gq.cells.forEach(function (c9) { gateAt[c9] = k; }); });
    if (start == null) P.push({ code: 'no-start', message: 'The first chapter has no start town on the map.' });

    var ow = { version: 1, attempt: attempt, seed: master, w: w, h: h, ground: ground, deco: deco, elev: elev, temp: temp, moist: moist, owner: owner, region: region, cls: cls, st: st, sea: sea,
      gateAt: gateAt, gates: gates, sites: sites, start: start, shipIndex: shipIdx,
      continents: conts.map(function (c) { return { slug: c.slug, label: c.label, x: c.x, y: c.y, r: c.r, cells: c.cells, regions: c.regs.map(function (r) { return r.key; }) }; }),
      regions: regs.map(function (r, k) { return { key: r.key, chapter: r.chapter, index: r.index, continent: r.continent, entry: r.entry, ringed: !!r.ringed, cells: r.cells, anchor: anchors[k] == null ? null : anchors[k] }; }),
      flags: flags, problems: P };
    if (!P.length) owCheck(ow, g).forEach(function (p) { P.push(p); });
    ow.ok = !P.length;
    ow.digest = mapDigest(ow);
    return ow;
  }
  // A cheap digest of a built map: refs become small codes (in order of first appearance) hashed as integers, then the
  // code table, gates, and sites are hashed as text.
  function mapDigest(ow) {
    var codes = {}, list = [], h = 0x811c9dc5, n = ow.ground.length;
    var lastR = null, lastC = 0;
    function code(r) { r = r || '-'; if (r === lastR) return lastC; if (codes[r] === undefined) { codes[r] = list.length; list.push(r); } lastR = r; lastC = codes[r]; return lastC; }
    for (var i = 0; i < n; i++) { h = Math.imul(h ^ code(ow.ground[i]), 0x01000193); h = Math.imul(h ^ code(ow.deco[i]), 0x01000193); }
    var tail = digest(list.concat(ow.gates.map(function (gq) { return gq.key + '@' + gq.cells.join('/'); }), ow.sites.map(function (s) { return s.key + '@' + s.entrance; })));
    return ('0000000' + (h >>> 0).toString(16)).slice(-8) + '-' + tail;
  }
  function owBuild(spec) {
    var S = owSettings(spec.settings), last = null;
    if (!spec.graph || !Array.isArray(spec.graph.regions) || !spec.graph.regions.length) throw new Error('overworld.build needs a laid out progression graph.');
    for (var a = 0; a < S.attempts; a++) {
      last = owAttempt(spec, a);
      if (last.ok) break;
    }
    last.attempts = last.attempt + 1;
    return spec.paint && last.ok ? owPaint(last, spec.paint, spec.graph) : last;
  }

  // ---------------------------------------------------------------- painted cells (Phase 7)
  // paint(ow, cells, graph) -> a copy of a built map with sparse ground overrides: cells {'x,y': biome tileset ID}, the
  // shape of world.overrides.cells. Only free land may be painted (owned by a continent, not a wall, gate, stamp, or
  // door, no decoration), and only with a biome of the palette that is not water, because painting sea onto land
  // would change what the sea and the lakes are. Cells apply in sorted key order. If the painted map fails the
  // progression check, each cell is tried in that order and kept only while the check still passes, so a paint can
  // never break sequence. The copy carries painted [cell index], skipped [{at [x, y], biome, code, message}], and
  // unpainted (the map as built). A map with nothing to paint, or one that failed its own checks, is returned as is.
  function owPaint(ow, cells, g) {
    var ks = keys(cells || {});
    if (!ks.length || !ow.ok) return ow;
    // Where play stands still: the start, every site's front, and every boss approach. These may only take passable
    // ground, because the walk seeds from the start and treats a front as a goal, so a wall there would not show up as
    // a broken walk (Phase 6's flag check would catch it, later).
    var stand = {};
    if (ow.start != null) stand[ow.start] = 1;
    ow.sites.forEach(function (s) { stand[s.front] = 1; if (s.approach != null) stand[s.approach] = 1; });
    var good = [], skipped = [];
    ks.forEach(function (k) {
      var m = /^(\d+),(\d+)$/.exec(k), id = cells[k];
      function skip(code, msg) { skipped.push({ at: m ? [Number(m[1]), Number(m[2])] : k, biome: id, code: code, message: msg }); }
      if (!m) return skip('paint-key', 'Painted cell ' + k + ' is not written as x,y.');
      var x = Number(m[1]), y = Number(m[2]), i = y * ow.w + x;
      if (x >= ow.w || y >= ow.h) return skip('paint-bounds', 'Painted cell ' + k + ' lies outside the ' + ow.w + ' by ' + ow.h + ' map.');
      if (typeof id !== 'string' || id.indexOf(':') >= 0 || ow.flags[id] === undefined) return skip('paint-biome', 'Cell ' + k + ' is painted with ' + id + ', which is not a biome tileset of this art.');
      if (ow.owner[i] < 0) return skip('paint-water', 'Cell ' + k + ' is sea or lake; only land can be painted.');
      if (ow.st[i] !== ST_FREE || ow.deco[i]) return skip('paint-structure', 'Cell ' + k + ' belongs to a ridge, sea ring, gate, or site, which the world needs as generated.');
      if ((ow.flags[id] | 0) & 4) return skip('paint-swim', 'Cell ' + k + ' cannot be painted with ' + id + ': water cannot be painted onto land.');
      if (stand[i] && !((ow.flags[id] | 0) & 1)) return skip('paint-front', 'Cell ' + k + ' is where play starts or stands before a site, so it can only take walkable ground.');
      good.push({ k: k, i: i, id: id });
    });
    function make(list) {
      var o = {}, gr = ow.ground.slice();
      keys(ow).forEach(function (f) { o[f] = ow[f]; });
      list.forEach(function (c) { gr[c.i] = c.id; });
      o.ground = gr; o.painted = list.map(function (c) { return c.i; }); o.unpainted = ow;
      return o;
    }
    var out = make(good), bad = good.length ? owCheck(out, g) : [];
    if (bad.length) {
      var kept = [];
      good.forEach(function (c) {
        var p = owCheck(make(kept.concat([c])), g);
        if (p.length) skipped.push({ at: [c.i % ow.w, Math.floor(c.i / ow.w)], biome: c.id, code: 'paint-blocks', message: 'Painting cell ' + c.k + ' with ' + c.id + ' would break the walk: ' + p[0].message });
        else kept.push(c);
      });
      out = make(kept);
    }
    out.skipped = skipped;
    out.digest = mapDigest(out);
    return out;
  }

  // ---------------------------------------------------------------- walking the map
  // reach(ow, held, opts) -> Uint8Array of cells a party standing at ow.start can walk to while holding the keys in
  // held ({key: true} or an array). opts.ship: sea cells (water joined to the map edge) count as walkable too.
  function owWalkable(ow, i, held, ship) {
    var gi = ow.gateAt[i];
    if (gi >= 0) return ow.gates[gi].requires.every(function (k) { return held[k]; });
    if (ow.st[i] === ST_WALL || ow.st[i] === ST_STAMP || ow.st[i] === ST_DOOR) return false;
    var d = ow.deco[i], f = d ? ow.flags[d] | 0 : ow.flags[ow.ground[i]] | 0;
    return (f & 1) === 1 || !!(ship && ow.sea[i]);
  }
  function owReach(ow, held, opts) {
    var h2 = {};
    (Array.isArray(held) ? held : keys(held).filter(function (k) { return held[k]; })).forEach(function (k) { h2[k] = true; });
    var ship = !!(opts && opts.ship || h2['vehicle:ship']), out = new Uint8Array(ow.w * ow.h);
    if (ow.start == null) return out;
    var d = bfs(ow.w, ow.h, [ow.start], function (j) { return owWalkable(ow, j, h2, ship); });
    for (var i = 0; i < d.length; i++) if (d[i] >= 0) out[i] = 1;
    return out;
  }
  // The geometric progression check. For each chapter n, holding what chapters before it granted (chapter n's key, the
  // earlier seals, vehicles): every non boss site front and the boss lock's approach are reachable while the lock is
  // not; with chapter n's own seal the lock opens; and no inner ground of any later region is reachable. The airship is
  // left out on purpose: it reaches any land, and every site entrance already needs its chapter key.
  function owCheck(ow, g) {
    var out = [], idx = {};
    g.chapters.forEach(function (c, k) { idx[c] = k; });
    g.chapters.forEach(function (chp, k) {
      var held = {};
      (g.start || []).forEach(function (s) { held[s] = true; });
      g.nodes.forEach(function (nd) { if (idx[nd.chapter] < k) nd.grants.forEach(function (gk) { if (gk !== 'vehicle:airship') held[gk] = true; }); });
      var A = owReach(ow, held), mine = ow.sites.filter(function (s) { return s.chapter === chp; });
      mine.forEach(function (s) {
        if (s.role === 'boss') {
          if (!A[s.approach]) out.push({ code: 'unreachable', chapter: chp, message: 'The way to ' + s.key + ' cannot be reached in its chapter.' });
          if (A[s.front]) out.push({ code: 'lock-open', chapter: chp, message: 'The lock before ' + s.key + ' opens without the seal.' });
        } else if (!A[s.front]) out.push({ code: 'unreachable', chapter: chp, message: s.key + ' cannot be reached in its chapter.' });
      });
      held['item:seal:' + chp] = true;
      var B = owReach(ow, held);
      mine.forEach(function (s) { if (s.role === 'boss' && !B[s.front]) out.push({ code: 'unreachable', chapter: chp, message: 'The lock before ' + s.key + ' stays shut with the seal.' }); });
      for (var i = 0; i < B.length; i++) {
        if (!B[i] || ow.region[i] < 0 || ow.cls[i] !== CLS_INNER) continue;
        var rk = ow.regions[ow.region[i]];
        if (rk && rk.index > k && ow.st[i] !== ST_GATE) { out.push({ code: 'early', chapter: chp, message: 'Chapter ' + rk.chapter + ' ground can be reached during chapter ' + chp + '.' }); break; }
      }
    });
    return out;
  }
  // Refs of a site stamp, for a caller that wants to draw a marker without rebuilding.
  W.overworld = { DEFAULTS: OW_DEFAULTS, ST: { FREE: ST_FREE, WALL: ST_WALL, GATE: ST_GATE, STAMP: ST_STAMP, DOOR: ST_DOOR }, CLS: { WATER: CLS_WATER, STRIP: CLS_STRIP, INNER: CLS_INNER },
    settings: owSettings, size: owSize, palette: owPalette, build: owBuild, paint: owPaint, reach: owReach, walkable: owWalkable, check: owCheck,
    grid: { bfs: bfs, components: components, largest: largest, nb4: nb4 } };

  // ---------------------------------------------------------------- interiors (Phase 4)
  // Three pure generators, each taking a seed and parameters and returning maps with exits: towns (a Dragon Quest style
  // single map cutaway), built dungeons and castles (binary space partitioning), and caves (cellular automaton). Like the
  // overworld, the art arrives as plain data (interiors.palette below) and nothing outside the spec is read.
  //
  // build(spec) -> site. spec: {seed (the site's sub seed), key (structural site key), kind 'town' | 'dungeon' |
  //   'castle' | 'cave', role (start, town, key, boss, cave...), settings (world.settings), palette, outdoor (the biome
  //   tileset of the overworld cell in front of the site, for town ground), archetypes (NPC archetypes the art has
  //   sprites for), prize (the gate key a key dungeon's last chest holds), troop (a boss node's troop), grants, finale}.
  // site: {key, kind, style, floors [floor], npcs [npc], ok, problems, attempts, digest}.
  // floor: {floor (1 based), w, h, ground [ref], deco [ref or null], exits [{kind 'overworld' | 'up' | 'down', at, arrive,
  //   toFloor}], features [{kind 'chest' | 'lock' | 'boss' | 'stairs', at, ...}], npcs [slot names], buildings, rooms,
  //   stats, digest}. Cells are row major indexes; at is the tile itself and arrive is where a party stands on arrival.
  //
  // Gate keys follow the world's local scheme: a dungeon's own small key is item:key:<site key>; the lock feature needs
  // it, the key chest holds it. Locks are world layer state, like the overworld's gates: the door tile itself reads
  // passable (flag 33 with its arch), and only the feature list says it is shut.
  //
  // NPC slots are named by role, never by seed (inn, shop:item, church, guard1, resident3), and their number depends only
  // on the site's role and settings, so npc_ IDs survive a reroll exactly as map_ IDs do.
  var IN_DEFAULTS = {
    town: { w: 34, h: 28, smallW: 30, smallH: 24, residents: 6, smallResidents: 4, houses: 3, smallHouses: 2 },
    dungeon: { w: 40, h: 30, minLeaf: 7, keyFloors: 1, bossFloors: 2 },
    castle: { w: 46, h: 36, minLeaf: 8, floors: 2 },
    cave: { w: 44, h: 32, fill: 0.45, steps: 5, floors: 1 },
    attempts: 8
  };
  var ARCHETYPES = ['elder', 'child', 'merchant', 'guard', 'worker', 'scholar', 'healer', 'traveler', 'noble', 'innkeeper'];
  // Residents are drawn by weight; innkeepers, merchants, the priest (a healer), and guards have fixed posts.
  var RESIDENT_WEIGHTS = [['elder', 2], ['child', 3], ['merchant', 1], ['worker', 3], ['scholar', 2], ['healer', 1], ['traveler', 2], ['noble', 1]];
  // Building footprints, walls included. The door is on the bottom wall at column dx.
  var BUILDINGS = {
    inn: { w: 9, h: 6, dx: 4 }, shop: { w: 6, h: 5, dx: 2 }, church: { w: 7, h: 7, dx: 3 }, house: { w: 5, h: 5, dx: 2 }
  };
  var SHOP_KINDS = ['item', 'weapon', 'armor'];

  function inSettings(s) {
    s = s || {};
    var o = s.interiors || {}, t = o.town || {}, d = o.dungeon || {}, c = o.castle || {}, v = o.cave || {}, D = IN_DEFAULTS;
    function n(x, def, a, b) { x = x == null || x === '' ? NaN : Number(x); return isFinite(x) ? clamp(Math.floor(x), a, b) : def; }
    function f(x, def, a, b) { x = x == null || x === '' ? NaN : Number(x); return isFinite(x) ? clamp(x, a, b) : def; }
    return {
      town: { w: n(t.w, D.town.w, 26, 64), h: n(t.h, D.town.h, 22, 64), smallW: n(t.smallW, D.town.smallW, 24, 64), smallH: n(t.smallH, D.town.smallH, 20, 64),
        residents: n(t.residents, D.town.residents, 0, 16), smallResidents: n(t.smallResidents, D.town.smallResidents, 0, 16),
        houses: n(t.houses, D.town.houses, 0, 8), smallHouses: n(t.smallHouses, D.town.smallHouses, 0, 8) },
      dungeon: { w: n(d.w, D.dungeon.w, 24, 96), h: n(d.h, D.dungeon.h, 20, 96), minLeaf: n(d.minLeaf, D.dungeon.minLeaf, 6, 16),
        keyFloors: n(d.keyFloors, D.dungeon.keyFloors, 1, 5), bossFloors: n(d.bossFloors, D.dungeon.bossFloors, 1, 5) },
      castle: { w: n(c.w, D.castle.w, 28, 96), h: n(c.h, D.castle.h, 24, 96), minLeaf: n(c.minLeaf, D.castle.minLeaf, 6, 16), floors: n(c.floors, D.castle.floors, 1, 5) },
      cave: { w: n(v.w, D.cave.w, 24, 96), h: n(v.h, D.cave.h, 20, 96), fill: f(v.fill, D.cave.fill, 0.3, 0.6), steps: n(v.steps, D.cave.steps, 1, 10), floors: n(v.floors, D.cave.floors, 1, 5) },
      attempts: n(o.attempts, D.attempts, 1, 16)
    };
  }

  // palette(art): the interior sets and the biomes a town stands on, as plain data. A set falls back exactly as the
  // overworld's stamps do: castles and caves to the dungeon set, towns to whichever interior exists. A tile key a set
  // lacks falls back to the same key in the dungeon set, then the town set. sets[kind].refs maps tile key -> ref.
  var IN_KEYS = ['floor', 'wall', 'door', 'stairs', 'counter', 'table', 'barrel', 'bed', 'shelf', 'rug', 'plant', 'lintel', 'pillar', 'torch', 'chest', 'arch'];
  function inPalette(art) {
    var recs = art && art.records && art.records.til_ || {}, flags = {}, ins = {}, biomes = [], problems = [];
    keys(recs).forEach(function (id) {
      var t = recs[id];
      if (!t) return;
      if (t.kind === 'biome') { flags[id] = Number(t.flags) | 0; biomes.push({ id: id, key: t.key || null, flags: flags[id], climate: t.climate || null }); }
      if (t.kind === 'interior' && t.subject && typeof t.subject.ref === 'string' && t.subject.ref.indexOf('interior:') === 0) { var k = t.subject.ref.slice(9); if (!ins[k]) ins[k] = t; }
    });
    function tileKeys(til) { var has = {}; (til && til.tiles || []).forEach(function (it) { if (it && it.key) { has[it.key] = it; flags[til.id + ':' + it.key] = Number(it.flags) | 0; } }); return has; }
    var dun = ins.dungeon || ins.town || null, town = ins.town || dun, own = {
      town: town, dungeon: dun, cave: ins.cave || dun, castle: ins.castle || dun
    }, sets = {};
    var hasD = tileKeys(dun), hasT = tileKeys(town);
    each(own, function (til, kind) {
      if (!til) return;
      var has = tileKeys(til), refs = {};
      IN_KEYS.forEach(function (k) {
        refs[k] = has[k] ? til.id + ':' + k : hasD[k] && dun ? dun.id + ':' + k : hasT[k] && town ? town.id + ':' + k : null;
      });
      if (!refs.wall || !refs.floor || !refs.door || !(flags[refs.door] & 1) || !(flags[refs.floor] & 1) || (flags[refs.wall] & 1)) problems.push({ code: 'set', message: 'Interior tileset ' + til.id + ' needs a passable floor, a passable door, and a wall that blocks, for the ' + kind + ' maps.' });
      sets[kind] = { til: til.id, own: til.id, refs: refs };
    });
    if (!dun) problems.push({ code: 'no-interior', message: 'No interior tileset exists, so no town or dungeon can be built.' });
    // The church altar borrows the dungeon set's counter (Day 147 labels it Altar) when there is one.
    var altar = hasD.counter && dun ? dun.id + ':counter' : sets.town ? sets.town.refs.counter : null;
    // Town ground: passable dry biomes. The path is the desert biome when there is one.
    var dry = biomes.filter(function (bm) { return (bm.flags & 1) && !(bm.flags & 4) && !(bm.flags & 8) && bm.climate && !bm.climate.feature; });
    var desert = dry.filter(function (bm) { return bm.key === 'desert'; })[0] || null;
    var low = dry.filter(function (bm) { var e = bm.climate.elev; return e && e[0] <= 2 && e[1] >= 2; }), pref = ['grassland', 'steppe', 'forest'];
    low.sort(function (x, y) { var px = pref.indexOf(x.key), py = pref.indexOf(y.key); return (px < 0 ? 9 : px) - (py < 0 ? 9 : py) || (x.id < y.id ? -1 : 1); });
    var lowland = low[0] || dry[0] || null;
    return { sets: sets, flags: flags, altar: altar, desert: desert ? desert.id : null, lowland: lowland ? lowland.id : null, dry: dry.map(function (bm) { return bm.id; }), problems: problems,
      digest: digest([altar, desert ? desert.id : '-', lowland ? lowland.id : '-'].concat(keys(sets).map(function (k) { return k + '=' + sets[k].til + '/' + IN_KEYS.map(function (q) { return sets[k].refs[q] || '-'; }).join(','); }))) };
  }

  // ---------------------------------------------------------------- shared helpers
  function grid(w, h, fill) { var g = new Array(w * h); for (var i = 0; i < g.length; i++) g[i] = fill; return g; }
  function flagOf(pal, ref) { return ref ? pal.flags[ref] | 0 : 0; }
  function cellFlags(pal, fl, i) { var d = fl.deco[i]; return d ? flagOf(pal, d) : flagOf(pal, fl.ground[i]); }
  // Walkable cells of a floor: passable flags, minus locks the party has no key for.
  function inWalk(pal, fl, held) {
    var shut = {};
    fl.features.forEach(function (ft) { if (ft.kind === 'lock' && !(held && held[ft.requires[0]])) shut[ft.at] = 1; });
    return function (i) { return !shut[i] && (cellFlags(pal, fl, i) & 1) === 1; };
  }
  function reachFrom(pal, fl, from, held) { return bfs(fl.w, fl.h, [from], inWalk(pal, fl, held)); }
  function floorDigest(fl) {
    var parts = [fl.w, fl.h];
    for (var i = 0; i < fl.ground.length; i++) parts.push((fl.ground[i] || '-') + '|' + (fl.deco[i] || '-'));
    fl.features.forEach(function (ft) { parts.push(ft.kind + '@' + ft.at); });
    fl.exits.forEach(function (ex) { parts.push(ex.kind + '@' + ex.at + '>' + ex.arrive); });
    return digest(parts);
  }
  function nbOpen(fl, i, ok) { return nb4(i, fl.w, fl.h).filter(ok); }
  function setDeco(fl, i, ref) { if (ref) fl.deco[i] = ref; }

  // ---------------------------------------------------------------- towns
  // A single map cutaway: a ring of town wall with a two cell gate in the bottom row, a plaza of path tiles, a street
  // from the plaza to the gate, then prefab buildings placed around the plaza in seeded order, each door joined to the
  // plaza by an L shaped path (a shortest path when both L shapes are blocked). Outdoor ground is the biome of the
  // site's overworld cell; building floors are the town set's floor (flag 1), so nothing triggers inside a town.
  function genTown(spec, S, pal, R, attempt) {
    var small = spec.role !== 'start', T = S.town, set = pal.sets.town, t = set.refs;
    var w = (small ? T.smallW : T.w) + attempt * 2, h = (small ? T.smallH : T.h) + attempt * 2, n = w * h;
    var outdoor = spec.outdoor && pal.dry.indexOf(spec.outdoor) >= 0 ? spec.outdoor : pal.lowland || t.floor;
    var path = pal.desert && pal.desert !== outdoor ? pal.desert : t.floor;
    var fl = { w: w, h: h, ground: grid(w, h, outdoor), deco: grid(w, h, null), exits: [], features: [], npcList: [], buildings: [], rooms: [], stats: {} };
    var P = [], occ = new Int16Array(n), x, y, i;
    for (i = 0; i < n; i++) occ[i] = -1;
    // Ring wall and gate.
    for (x = 0; x < w; x++) { fl.ground[x] = t.wall; fl.ground[(h - 1) * w + x] = t.wall; }
    for (y = 0; y < h; y++) { fl.ground[y * w] = t.wall; fl.ground[y * w + w - 1] = t.wall; }
    var gx = (w >> 1) - 1;
    [gx, gx + 1].forEach(function (cx) { var c = (h - 1) * w + cx; fl.ground[c] = path; fl.exits.push({ kind: 'overworld', at: c, arrive: c - w, toFloor: null }); });
    // Plaza and street. Reserved cells (ring, plaza, street, plus a one cell margin) never hold a building.
    var pw = 6, ph = 4, px = (w >> 1) - 3, py = Math.floor(h * 0.5) - 1, reserved = new Uint8Array(n);
    function reserve(x0, y0, x1, y1) { for (var yy = y0; yy <= y1; yy++) for (var xx = x0; xx <= x1; xx++) if (xx >= 0 && yy >= 0 && xx < w && yy < h) reserved[yy * w + xx] = 1; }
    for (y = py; y < py + ph; y++) for (x = px; x < px + pw; x++) fl.ground[y * w + x] = path;
    for (y = py + ph; y < h - 1; y++) { fl.ground[y * w + gx] = path; fl.ground[y * w + gx + 1] = path; }
    reserve(px - 1, py - 1, px + pw, py + ph); reserve(gx - 1, py + ph, gx + 2, h - 1);
    for (x = 0; x < w; x++) { reserved[w + x] = 1; reserved[(h - 2) * w + x] = 1; }
    for (y = 0; y < h; y++) { reserved[y * w + 1] = 1; reserved[y * w + w - 2] = 1; }
    for (i = 0; i < n; i++) if (fl.ground[i] === t.wall) reserved[i] = 1;
    var pcx = px + (pw >> 1), pcy = py + (ph >> 1);
    // Buildings, essentials first. The rect plus a one cell margin must be clear; the door's front cell stays outdoors.
    var plan = [['inn', 'inn']].concat((small ? ['item'] : SHOP_KINDS).map(function (k) { return ['shop', 'shop:' + k]; }), [['church', 'church']]);
    for (var hq = 1; hq <= (small ? T.smallHouses : T.houses); hq++) plan.push(['house', 'house' + hq]);
    function fits(bx, by, bw, bh) {
      if (bx < 2 || by < 2 || bx + bw > w - 2 || by + bh > h - 3) return false;
      for (var yy = by - 1; yy <= by + bh; yy++) for (var xx = bx - 1; xx <= bx + bw; xx++) { var c = yy * w + xx; if (occ[c] >= 0) return false; if (yy >= by && yy < by + bh && xx >= bx && xx < bx + bw && reserved[c]) return false; }
      return true;
    }
    plan.forEach(function (pl) {
      var B = BUILDINGS[pl[0]], cands = [];
      for (var by = 2; by + B.h <= h - 3; by++) for (var bx = 2; bx + B.w <= w - 2; bx++) {
        if (!fits(bx, by, B.w, B.h)) continue;
        var dxp = bx + B.dx, dyp = by + B.h, score = pl[0] === 'house' ? R() * 40 : Math.abs(dxp - pcx) + Math.abs(dyp - pcy) + R() * 6;
        cands.push({ x: bx, y: by, s: score });
      }
      cands.sort(function (a, b) { return a.s - b.s || a.y - b.y || a.x - b.x; });
      // Houses may be dropped only after three attempts at growing the map for them.
      if (!cands.length) { if (pl[0] !== 'house' || attempt < 3) P.push({ code: 'town-room', message: 'No room for the ' + pl[1] + ' in ' + spec.key + '.' }); return; }
      var pick = R.pick(cands.slice(0, Math.min(6, cands.length))), k = fl.buildings.length;
      for (var yy = pick.y; yy < pick.y + B.h; yy++) for (var xx = pick.x; xx < pick.x + B.w; xx++) occ[yy * w + xx] = k;
      fl.buildings.push({ kind: pl[0], slot: pl[1], x: pick.x, y: pick.y, w: B.w, h: B.h, door: (pick.y + B.h - 1) * w + pick.x + B.dx, front: (pick.y + B.h) * w + pick.x + B.dx });
    });
    // Draw each building and its furnishings; record the fixed NPC posts.
    var posts = [];
    fl.buildings.forEach(function (bd) {
      function at(dx, dy) { return (bd.y + dy) * w + bd.x + dx; }
      for (var dy = 0; dy < bd.h; dy++) for (var dx = 0; dx < bd.w; dx++) fl.ground[at(dx, dy)] = dy === 0 || dx === 0 || dy === bd.h - 1 || dx === bd.w - 1 ? t.wall : t.floor;
      fl.ground[bd.door] = t.door; setDeco(fl, bd.door, t.lintel);
      bd.counters = [];
      function counter(dx, dy, ref) { var c = at(dx, dy); fl.ground[c] = ref || t.counter; bd.counters.push(c); }
      if (bd.kind === 'inn') {
        counter(1, 2); counter(2, 2); counter(3, 2);
        setDeco(fl, at(4, 1), t.shelf); setDeco(fl, at(5, 1), t.bed); setDeco(fl, at(6, 1), t.bed); setDeco(fl, at(7, 1), t.bed);
        setDeco(fl, at(1, 4), t.barrel); setDeco(fl, at(4, 4), t.rug);
        posts.push({ slot: 'inn', archetype: 'innkeeper', role: 'innkeeper', at: at(2, 1), facing: 'down', wander: false, building: bd.slot, counter: at(2, 2) });
      } else if (bd.kind === 'shop') {
        for (var cx2 = 1; cx2 <= 4; cx2++) counter(cx2, 2);
        setDeco(fl, at(1, 1), t.shelf); setDeco(fl, at(3, 1), t.shelf); setDeco(fl, at(4, 1), t.barrel);
        posts.push({ slot: bd.slot, archetype: 'merchant', role: bd.slot, at: at(2, 1), facing: 'down', wander: false, building: bd.slot, counter: at(2, 2) });
      } else if (bd.kind === 'church') {
        counter(2, 2, pal.altar); counter(3, 2, pal.altar); counter(4, 2, pal.altar);
        setDeco(fl, at(1, 1), t.plant); setDeco(fl, at(5, 1), t.plant);
        setDeco(fl, at(1, 4), t.table); setDeco(fl, at(2, 4), t.table); setDeco(fl, at(4, 4), t.table); setDeco(fl, at(5, 4), t.table);
        setDeco(fl, at(3, 4), t.rug); setDeco(fl, at(3, 5), t.rug);
        posts.push({ slot: 'church', archetype: 'healer', role: 'priest', at: at(3, 1), facing: 'down', wander: false, building: bd.slot, counter: at(3, 2) });
      } else {
        setDeco(fl, at(1, 1), t.bed); setDeco(fl, at(3, 1), t.table); setDeco(fl, at(3, 3), t.barrel);
        bd.home = at(2, 2);
      }
    });
    // Paths from every door front to the plaza: an L shape when one is clear, else a shortest path over open ground.
    function outdoorCell(c) { return occ[c] < 0 && fl.ground[c] !== t.wall; }
    function clampTo(v, a, b) { return v < a ? a : v > b ? b : v; }
    fl.buildings.forEach(function (bd) {
      var fx = bd.front % w, fy = (bd.front - fx) / w, tx = clampTo(fx, px, px + pw - 1), ty = clampTo(fy, py, py + ph - 1), cells;
      function lPath(horizFirst) {
        var out = [], xx = fx, yy = fy;
        out.push(yy * w + xx);
        if (horizFirst) { while (xx !== tx) { xx += xx < tx ? 1 : -1; out.push(yy * w + xx); } while (yy !== ty) { yy += yy < ty ? 1 : -1; out.push(yy * w + xx); } }
        else { while (yy !== ty) { yy += yy < ty ? 1 : -1; out.push(yy * w + xx); } while (xx !== tx) { xx += xx < tx ? 1 : -1; out.push(yy * w + xx); } }
        return out.every(outdoorCell) ? out : null;
      }
      var first = R.chance(0.5);
      cells = lPath(first) || lPath(!first);
      if (!cells) {
        var d = bfs(w, h, [ty * w + tx], outdoorCell);
        if (d[bd.front] < 0) { P.push({ code: 'town-path', message: 'The ' + bd.slot + ' door cannot be joined to the plaza in ' + spec.key + '.' }); return; }
        cells = [bd.front];
        var c = bd.front;
        while (d[c] > 0) { c = nb4(c, w, h).filter(function (q) { return d[q] === d[c] - 1; })[0]; cells.push(c); }
      }
      cells.forEach(function (q) { fl.ground[q] = path; });
      bd.path = cells.length;
    });
    // Planters on open ground away from every path, door, and the gate, each kept only if nothing is cut off.
    var walk = inWalk(pal, fl, null), arrive = fl.exits[0].arrive;
    function reachCount() { var d = bfs(w, h, [arrive], walk), k = 0; for (var q = 0; q < n; q++) if (d[q] >= 0) k++; return k; }
    var openSpots = [];
    for (i = 0; i < n; i++) {
      if (fl.ground[i] !== outdoor || occ[i] >= 0 || reserved[i] || fl.deco[i]) continue;
      var near = false;
      for (var dy3 = -1; dy3 <= 1 && !near; dy3++) for (var dx3 = -1; dx3 <= 1 && !near; dx3++) { var q3 = i + dy3 * w + dx3; if (q3 >= 0 && q3 < n && (fl.ground[q3] === path || occ[q3] >= 0)) near = true; }
      if (!near) openSpots.push(i);
    }
    var base = reachCount(), planters = 0;
    R.shuffle(openSpots).slice(0, 10).forEach(function (c) {
      if (planters >= 6 || !t.plant) return;
      fl.deco[c] = t.plant;
      if (reachCount() !== base - 1) fl.deco[c] = null; else { base--; planters++; }
    });
    // People: fixed posts, two gate guards, then residents (one at home per house, the rest outdoors).
    var dist = bfs(w, h, [arrive], walk), taken = {};
    posts.forEach(function (p) { taken[p.at] = 1; });
    [[gx - 1, h - 2, 'guard1'], [gx + 2, h - 2, 'guard2']].forEach(function (gd) {
      var c = gd[1] * w + gd[0];
      if (dist[c] < 0) c = nb4(c, w, h).concat([c - w]).filter(function (q) { return dist[q] >= 0 && !taken[q]; })[0];
      if (c == null) { P.push({ code: 'town-guard', message: 'No post for ' + gd[2] + ' in ' + spec.key + '.' }); return; }
      taken[c] = 1;
      posts.push({ slot: gd[2], archetype: 'guard', role: 'guard', at: c, facing: 'down', wander: false, building: null });
    });
    var allowed = RESIDENT_WEIGHTS.filter(function (rw) { return !spec.archetypes || spec.archetypes.indexOf(rw[0]) >= 0; });
    if (!allowed.length) allowed = RESIDENT_WEIGHTS;
    var homes = fl.buildings.filter(function (bd) { return bd.home != null; }), gates = {};
    fl.exits.forEach(function (ex) { gates[ex.arrive] = 1; gates[ex.at] = 1; });
    var spots = [];
    for (i = 0; i < n; i++) if (dist[i] >= 0 && occ[i] < 0 && !taken[i] && !gates[i] && fl.ground[i] !== t.door && i % w > 2 && i % w < w - 3 && Math.floor(i / w) < h - 3) spots.push(i);
    spots = R.shuffle(spots);
    var fronts = {};
    fl.buildings.forEach(function (bd) { fronts[bd.front] = 1; });
    var residents = small ? T.smallResidents : T.residents;
    for (var rq = 1; rq <= residents; rq++) {
      var arch = allowed[R.weighted(allowed.map(function (rw) { return rw[1]; }))][0], home = homes[rq - 1], c4 = null;
      if (home && !taken[home.home]) c4 = home.home;
      while (c4 == null && spots.length) { var sp = spots.pop(); if (!taken[sp] && !fronts[sp]) c4 = sp; }
      if (c4 == null) { P.push({ code: 'town-people', message: 'No room for resident ' + rq + ' in ' + spec.key + '.' }); continue; }
      taken[c4] = 1;
      posts.push({ slot: 'resident' + rq, archetype: arch, role: 'resident', at: c4, facing: 'down', wander: !home || c4 !== home.home, building: home && c4 === home.home ? home.slot : null });
    }
    fl.npcList = posts;
    fl.stats = { buildings: fl.buildings.length, houses: fl.buildings.filter(function (bd) { return bd.kind === 'house'; }).length, planters: planters, outdoor: outdoor, path: path };
    fl.plaza = [px, py, pw, ph];
    return { floors: [fl], problems: P };
  }

  // ---------------------------------------------------------------- built dungeons and castles
  // Binary space partitioning to a minimum leaf, one room per leaf (inset one cell, at least 3 by 3), siblings joined by
  // L corridors between their nearest rooms, every other cell wall. Floor 1 opens on the bottom edge through an arched
  // door; deeper floors are joined by stairs (down in the room farthest from the arrival, up in the room nearest where
  // the stairs above stood). The last floor holds, in breadth first order from the arrival, the key chest (in the
  // farthest room reachable while the lock is shut), the locked door (the single way into the goal room, other entries
  // walled up), and the goal: the boss, or the prize chest of a key dungeon. Dead end rooms may hold treasure chests.
  function bspSplit(R, root, ml) {
    var leaves = [], tree = [];
    function split(nd) {
      var canV = nd.w >= 2 * ml, canH = nd.h >= 2 * ml;
      if (!canV && !canH || nd.w < 3 * ml && nd.h < 3 * ml && R.chance(0.2)) { nd.leaf = leaves.length; leaves.push(nd); return nd; }
      var vert = canV && canH ? (nd.w > nd.h * 1.2 ? true : nd.h > nd.w * 1.2 ? false : R.chance(0.5)) : canV;
      var cut = vert ? R.range(ml, nd.w - ml) : R.range(ml, nd.h - ml);
      nd.a = split(vert ? { x: nd.x, y: nd.y, w: cut, h: nd.h } : { x: nd.x, y: nd.y, w: nd.w, h: cut });
      nd.b = split(vert ? { x: nd.x + cut, y: nd.y, w: nd.w - cut, h: nd.h } : { x: nd.x, y: nd.y + cut, w: nd.w, h: nd.h - cut });
      tree.push(nd);
      return nd;
    }
    split(root);
    return { leaves: leaves, root: root };
  }
  function roomCenter(r, w) { return (r.y + (r.h >> 1)) * w + r.x + (r.w >> 1); }
  function inRoom(r, i, w) { var x = i % w, y = (i - x) / w; return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h; }
  function genBuiltFloor(spec, S, pal, R, attempt, fi, nFloors, prevStairs) {
    var style = spec.kind === 'castle' ? 'castle' : 'dungeon', C = style === 'castle' ? S.castle : S.dungeon, set = pal.sets[style] || pal.sets.dungeon, t = set.refs;
    var w = C.w + attempt * 2, h = C.h + attempt * 2, n = w * h, ml = C.minLeaf, P = [];
    var fl = { w: w, h: h, ground: grid(w, h, t.wall), deco: grid(w, h, null), exits: [], features: [], npcList: [], buildings: [], rooms: [], stats: {} };
    var tree = bspSplit(R, { x: 0, y: 0, w: w, h: h }, ml);
    tree.leaves.forEach(function (lf) {
      var maxW = lf.w - 2, maxH = lf.h - 2, rw = R.range(Math.max(3, Math.floor(maxW * 0.6)), maxW), rh = R.range(Math.max(3, Math.floor(maxH * 0.6)), maxH);
      var r = { x: lf.x + 1 + R.int(maxW - rw + 1), y: lf.y + 1 + R.int(maxH - rh + 1), w: rw, h: rh, leaf: [lf.x, lf.y, lf.w, lf.h] };
      fl.rooms.push(r);
      for (var y = r.y; y < r.y + r.h; y++) for (var x = r.x; x < r.x + r.w; x++) fl.ground[y * w + x] = t.floor;
    });
    // Corridors: at every split, the nearest pair of rooms across it is joined by an L.
    function roomsUnder(nd) { return nd.leaf != null ? [nd.leaf] : roomsUnder(nd.a).concat(roomsUnder(nd.b)); }
    function carve(a, b) {
      var ax = a % w, ay = (a - ax) / w, bx = b % w, by = (b - bx) / w, x = ax, y = ay;
      function put() { if (fl.ground[y * w + x] !== t.floor) fl.ground[y * w + x] = t.floor; }
      if (R.chance(0.5)) { while (x !== bx) { x += x < bx ? 1 : -1; put(); } while (y !== by) { y += y < by ? 1 : -1; put(); } }
      else { while (y !== by) { y += y < by ? 1 : -1; put(); } while (x !== bx) { x += x < bx ? 1 : -1; put(); } }
    }
    var links = 0;
    (function join(nd) {
      if (nd.leaf != null) return;
      join(nd.a); join(nd.b);
      var A = roomsUnder(nd.a), B = roomsUnder(nd.b), best = null, bd = Infinity;
      A.forEach(function (ia) { B.forEach(function (ib) { var ca = roomCenter(fl.rooms[ia], w), cb = roomCenter(fl.rooms[ib], w), d = Math.abs(ca % w - cb % w) + Math.abs(Math.floor(ca / w) - Math.floor(cb / w)); if (d < bd) { bd = d; best = [ca, cb]; } }); });
      carve(best[0], best[1]); links++;
    })(tree.root);
    var isFloor = function (i) { return fl.ground[i] === t.floor; };
    // Arrival: floor 1 through a door in the bottom edge, deeper floors by up stairs.
    var arrival, arrRoom;
    if (fi === 1) {
      arrRoom = fl.rooms.map(function (r, k) { return k; }).sort(function (a, b) { var ra = fl.rooms[a], rb = fl.rooms[b]; return (h - ra.y - ra.h) - (h - rb.y - rb.h) || Math.abs(ra.x + (ra.w >> 1) - (w >> 1)) - Math.abs(rb.x + (rb.w >> 1) - (w >> 1)) || a - b; })[0];
      var er = fl.rooms[arrRoom], ex = er.x + (er.w >> 1);
      for (var yy = er.y + er.h; yy < h - 1; yy++) fl.ground[yy * w + ex] = t.floor;
      var door = (h - 1) * w + ex;
      fl.ground[door] = t.door; setDeco(fl, door, t.arch);
      arrival = door - w;
      fl.exits.push({ kind: 'overworld', at: door, arrive: arrival, toFloor: null });
    } else {
      var px0 = prevStairs % w, py0 = (prevStairs - px0) / w;
      arrRoom = fl.rooms.map(function (r, k) { return k; }).sort(function (a, b) { var ca = roomCenter(fl.rooms[a], w), cb = roomCenter(fl.rooms[b], w); return Math.abs(ca % w - px0) + Math.abs(Math.floor(ca / w) - py0) - (Math.abs(cb % w - px0) + Math.abs(Math.floor(cb / w) - py0)) || a - b; })[0];
      var up = roomCenter(fl.rooms[arrRoom], w);
      fl.ground[up] = t.stairs;
      arrival = up + w;
      fl.exits.push({ kind: 'up', at: up, arrive: arrival, toFloor: fi - 1 });
      fl.features.push({ kind: 'stairs', at: up, dir: 'up' });
    }
    var dist = bfs(w, h, [arrival], function (i) { return (flagOf(pal, fl.ground[i]) & 1) === 1; });
    var order = fl.rooms.map(function (r, k) { return k; }).filter(function (k) { return k !== arrRoom; }).sort(function (a, b) { return dist[roomCenter(fl.rooms[b], w)] - dist[roomCenter(fl.rooms[a], w)] || a - b; });
    if (!order.length) return { fl: fl, problems: [{ code: 'rooms', message: spec.key + ' floor ' + fi + ' has a single room.' }] };
    var used = {};
    used[arrival] = 1;
    fl.exits.forEach(function (ex2) { used[ex2.at] = 1; });
    function entries(r) {
      var out = [];
      for (var y = r.y - 1; y <= r.y + r.h; y++) for (var x = r.x - 1; x <= r.x + r.w; x++) {
        var i = y * w + x;
        if (x < 0 || y < 0 || x >= w || y >= h || inRoom(r, i, w) || !isFloor(i) && fl.ground[i] !== t.door) continue;
        if ((x >= r.x && x < r.x + r.w) || (y >= r.y && y < r.y + r.h)) out.push(i);
      }
      return out;
    }
    // A chest against a wall inside a room, whose outer neighbors are wall, kept only when every other floor cell stays
    // reachable from the arrival.
    function placeChest(r, held, extra) {
      var cand = [], k;
      for (var y = r.y; y < r.y + r.h; y++) for (var x = r.x; x < r.x + r.w; x++) {
        var i = y * w + x, edge = y === r.y || x === r.x || x === r.x + r.w - 1;
        if (!edge || used[i] || fl.ground[i] !== t.floor || fl.deco[i]) continue;
        if (nb4(i, w, h).some(function (q) { return !inRoom(r, q, w) && fl.ground[q] !== t.wall; })) continue;
        cand.push(i);
      }
      cand.sort(function (a, b) { var ay = Math.floor(a / w), by = Math.floor(b / w); return ay - by || Math.abs(a % w - (r.x + (r.w >> 1))) - Math.abs(b % w - (r.x + (r.w >> 1))) || a - b; });
      for (k = 0; k < cand.length; k++) {
        var c = cand[k], before = 0, after = 0, d0 = reachFrom(pal, fl, arrival, held), q;
        for (q = 0; q < n; q++) if (d0[q] >= 0) before++;
        fl.deco[c] = t.chest;
        var d1 = reachFrom(pal, fl, arrival, held);
        for (q = 0; q < n; q++) if (d1[q] >= 0) after++;
        if (after === before - 1 && nb4(c, w, h).some(function (q2) { return d1[q2] >= 0; })) { used[c] = 1; var ft = { kind: 'chest', at: c }; keys(extra || {}).forEach(function (kk) { ft[kk] = extra[kk]; }); fl.features.push(ft); return ft; }
        fl.deco[c] = null;
      }
      return null;
    }
    var deadEnds = function () { return order.filter(function (k) { return entries(fl.rooms[k]).length === 1; }); };
    if (fi < nFloors) {
      // Down stairs in the farthest room.
      var dr = order[0], down = roomCenter(fl.rooms[dr], w);
      fl.ground[down] = t.stairs;
      fl.exits.push({ kind: 'down', at: down, arrive: down + w, toFloor: fi + 1 });
      fl.features.push({ kind: 'stairs', at: down, dir: 'down' });
      used[down] = 1; used[down + w] = 1;
      var de = deadEnds().filter(function (k) { return k !== dr; });
      if (de.length) placeChest(fl.rooms[de[0]], null, { item: null, treasure: true });
    } else {
      // The goal room: the farthest room that can be given exactly one way in.
      var lockKey = 'item:key:' + spec.key, goal = null, lock = null;
      for (var gi = 0; gi < order.length && goal == null; gi++) {
        var r = fl.rooms[order[gi]], E = entries(r);
        if (!E.length) continue;
        E.sort(function (a, b) { return (dist[a] < 0 ? 1e9 : dist[a]) - (dist[b] < 0 ? 1e9 : dist[b]) || a - b; });
        var keep = E[0], sealed = E.slice(1), saved = sealed.map(function (c) { return fl.ground[c]; });
        sealed.forEach(function (c) { fl.ground[c] = t.wall; });
        // With the kept entry shut, every floor cell outside the goal room must still be reachable from the arrival
        // (orphaned corridor stubs are walled up); with it open, the goal room must be reachable.
        var shutWalk = function (i) { return i !== keep && (flagOf(pal, fl.ground[i]) & 1) === 1; };
        var d2 = bfs(w, h, [arrival], shutWalk), ok = true, stubs = [];
        for (var q = 0; q < n && ok; q++) {
          if (!isFloor(q) || d2[q] >= 0 || q === keep || inRoom(r, q, w)) continue;
          if (fl.rooms.some(function (rr, kk) { return inRoom(rr, q, w); })) ok = false; else stubs.push(q);
        }
        if (ok && d2[keep] < 0 && !nb4(keep, w, h).some(function (q4) { return d2[q4] >= 0; })) ok = false;
        if (!ok || order[gi] === arrRoom) { sealed.forEach(function (c, k2) { fl.ground[c] = saved[k2]; }); continue; }
        stubs.forEach(function (c) { fl.ground[c] = t.wall; });
        goal = order[gi]; lock = keep;
      }
      if (goal == null) return { fl: fl, problems: [{ code: 'goal', message: 'No room on the last floor of ' + spec.key + ' can be locked.' }] };
      fl.ground[lock] = t.door; setDeco(fl, lock, t.arch);
      used[lock] = 1;
      fl.features.push({ kind: 'lock', at: lock, requires: [lockKey], room: goal });
      var gr = fl.rooms[goal];
      // The key chest: the farthest room reachable while the lock is shut.
      var dShut = reachFrom(pal, fl, arrival, null);
      var keyRooms = order.filter(function (k) { return k !== goal && dShut[roomCenter(fl.rooms[k], w)] >= 0; }).concat([arrRoom]);
      var keyChest = null;
      for (var kr = 0; kr < keyRooms.length && !keyChest; kr++) keyChest = placeChest(fl.rooms[keyRooms[kr]], null, { item: lockKey, opens: lock });
      if (!keyChest) return { fl: fl, problems: [{ code: 'key', message: 'No place for the key chest in ' + spec.key + '.' }] };
      var held = {};
      held[lockKey] = true;
      if (spec.role === 'boss' || spec.kind === 'castle') {
        var bc = roomCenter(gr, w);
        used[bc] = 1;
        var bossF = { kind: 'boss', at: bc, troop: spec.troop || null, grants: (spec.grants || []).slice(), finale: !!spec.finale };
        fl.features.push(bossF);
      } else {
        var prize = placeChest(gr, held, { item: spec.prize || null, prize: true });
        if (!prize) return { fl: fl, problems: [{ code: 'prize', message: 'No place for the prize chest in ' + spec.key + '.' }] };
      }
      var de2 = deadEnds().filter(function (k) { return k !== goal && fl.rooms[k] && !fl.features.some(function (ft2) { return ft2.kind === 'chest' && inRoom(fl.rooms[k], ft2.at, w); }); });
      if (de2.length) placeChest(fl.rooms[de2[0]], held, { item: null, treasure: true });
    }
    // Torches on north walls, and pillars in the inset corners of large castle rooms; each kept only if nothing is cut off.
    var walkAll = function () { var hh = {}; hh['item:key:' + spec.key] = true; return reachFrom(pal, fl, arrival, hh); };
    var base = 0, d5 = walkAll(), q5;
    for (q5 = 0; q5 < n; q5++) if (d5[q5] >= 0) base++;
    fl.rooms.forEach(function (r2) {
      if (t.torch) for (var x = r2.x + 1; x < r2.x + r2.w - 1; x += 3) { var c = (r2.y - 1) * w + x; if (r2.y > 0 && fl.ground[c] === t.wall && !fl.deco[c]) fl.deco[c] = t.torch; }
      if (style === 'castle' && t.pillar && r2.w >= 5 && r2.h >= 5) {
        [[1, 1], [r2.w - 2, 1], [1, r2.h - 2], [r2.w - 2, r2.h - 2]].forEach(function (o) {
          var c = (r2.y + o[1]) * w + r2.x + o[0];
          if (used[c] || fl.ground[c] !== t.floor || fl.deco[c] || fl.features.some(function (ft3) { return ft3.at === c || nb4(ft3.at, w, h).indexOf(c) >= 0; })) return;
          fl.ground[c] = t.pillar;
          var d6 = walkAll(), cnt = 0;
          for (var q6 = 0; q6 < n; q6++) if (d6[q6] >= 0) cnt++;
          if (cnt !== base - 1) fl.ground[c] = t.floor; else base--;
        });
      }
    });
    fl.stats = { rooms: fl.rooms.length, links: links, leaves: tree.leaves.map(function (lf) { return [lf.w, lf.h]; }) };
    fl.arrival = arrival;
    return { fl: fl, problems: P };
  }

  // ---------------------------------------------------------------- caves
  // Random fill near 45 percent inside a wall border, then the 4-5 rule (a cell becomes wall when five or more of the nine
  // cells around and including it are wall) for a few steps. The largest open region is the cave; each stranded pocket of
  // three or more cells is tunneled to its nearest main region cell, pockets taken in order of their first cell; smaller
  // pockets are filled. Stairs lead in near the bottom; the farthest corner holds a treasure chest.
  function genCaveFloor(spec, S, pal, R, attempt, fi, nFloors, prevStairs) {
    var C = S.cave, set = pal.sets.cave || pal.sets.dungeon, t = set.refs, w = C.w + attempt * 2, h = C.h + attempt * 2, n = w * h, x, y, i;
    var fl = { w: w, h: h, ground: grid(w, h, t.wall), deco: grid(w, h, null), exits: [], features: [], npcList: [], buildings: [], rooms: [], stats: {} };
    var wall = new Uint8Array(n), seeded = 0, interior = (w - 2) * (h - 2);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { i = y * w + x; wall[i] = x === 0 || y === 0 || x === w - 1 || y === h - 1 || R.chance(C.fill) ? 1 : 0; if (wall[i] && x > 0 && y > 0 && x < w - 1 && y < h - 1) seeded++; }
    for (var step = 0; step < C.steps; step++) {
      var nx = new Uint8Array(n);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { nx[i] = 1; continue; }
        var c = 0;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) c += wall[i + dy * w + dx];
        nx[i] = c >= 5 ? 1 : 0;
      }
      wall = nx;
    }
    var comp = components(w, h, function (q) { return !wall[q]; }), best = -1, bs = 0;
    comp.sizes.forEach(function (s2, k) { if (s2 > bs) { bs = s2; best = k; } });
    if (best < 0 || bs < interior * 0.2) return { fl: fl, problems: [{ code: 'cave-small', message: 'The cave of ' + spec.key + ' came out too small.' }] };
    var main = new Uint8Array(n), first = [], tunnels = 0, filled = 0;
    for (i = 0; i < n; i++) { var lb = comp.label[i]; if (lb === best) main[i] = 1; else if (lb >= 0 && first[lb] == null) first[lb] = i; }
    first.forEach(function (start, k) {
      if (start == null || k === best) return;
      if (comp.sizes[k] < 3) { for (var q = 0; q < n; q++) if (comp.label[q] === k) wall[q] = 1; filled++; return; }
      var src = [];
      for (var q2 = 0; q2 < n; q2++) if (comp.label[q2] === k) src.push(q2);
      var d = bfs(w, h, src, function (j) { var jx = j % w, jy = (j - jx) / w; return jx > 0 && jy > 0 && jx < w - 1 && jy < h - 1; }), target = -1, td = Infinity;
      for (var q3 = 0; q3 < n; q3++) if (main[q3] && d[q3] >= 0 && d[q3] < td) { td = d[q3]; target = q3; }
      if (target < 0) return;
      var c2 = target;
      while (d[c2] > 0) { wall[c2] = 0; main[c2] = 1; c2 = nb4(c2, w, h).filter(function (j) { return d[j] === d[c2] - 1; })[0]; }
      src.forEach(function (j) { main[j] = 1; });
      tunnels++;
    });
    for (i = 0; i < n; i++) if (!wall[i] && main[i]) fl.ground[i] = t.floor; else fl.ground[i] = t.wall;
    var isF = function (q) { return fl.ground[q] === t.floor; };
    // Stairs in: floor 1 near the bottom middle, deeper floors near where the stairs above stood.
    var tx = fi === 1 ? w >> 1 : prevStairs % w, ty = fi === 1 ? h - 1 : Math.floor(prevStairs / w), sIn = -1, sd = Infinity;
    for (i = 0; i < n; i++) {
      if (!isF(i)) continue;
      var ix = i % w, iy = (i - ix) / w, dd = Math.abs(ix - tx) * 2 + Math.abs(iy - ty) * 3;
      if (dd < sd && nb4(i, w, h).filter(isF).length >= 2) { sd = dd; sIn = i; }
    }
    if (sIn < 0) return { fl: fl, problems: [{ code: 'cave-stairs', message: 'No place for the stairs in ' + spec.key + '.' }] };
    var arr = nb4(sIn, w, h).filter(isF).sort(function (a, b) { return (b - sIn === -w ? 1 : 0) - (a - sIn === -w ? 1 : 0) || a - b; })[0];
    fl.ground[sIn] = t.stairs;
    fl.exits.push(fi === 1 ? { kind: 'overworld', at: sIn, arrive: arr, toFloor: null } : { kind: 'up', at: sIn, arrive: arr, toFloor: fi - 1 });
    fl.features.push({ kind: 'stairs', at: sIn, dir: fi === 1 ? 'out' : 'up' });
    var dist = reachFrom(pal, fl, arr, null), far = [];
    for (i = 0; i < n; i++) if (dist[i] > 0 && i !== sIn) far.push(i);
    far.sort(function (a, b) { return dist[b] - dist[a] || a - b; });
    if (fi < nFloors) {
      var down = -1;
      for (var k3 = 0; k3 < far.length && down < 0; k3++) { var cd = far[k3]; var o = nb4(cd, w, h).filter(function (q) { return isF(q) && q !== sIn; }); if (o.length >= 1) down = cd; }
      if (down < 0) return { fl: fl, problems: [{ code: 'cave-stairs', message: 'No place for the stairs down in ' + spec.key + '.' }] };
      var darr = nb4(down, w, h).filter(isF)[0];
      fl.ground[down] = t.stairs;
      fl.exits.push({ kind: 'down', at: down, arrive: darr, toFloor: fi + 1 });
      fl.features.push({ kind: 'stairs', at: down, dir: 'down' });
    }
    // The treasure chest: the farthest cell whose chest cuts nothing off.
    var walk = inWalk(pal, fl, null), total = 0, d0 = bfs(w, h, [arr], walk);
    for (i = 0; i < n; i++) if (d0[i] >= 0) total++;
    var stairsAt = {};
    fl.exits.forEach(function (ex) { stairsAt[ex.at] = 1; stairsAt[ex.arrive] = 1; });
    for (var k4 = 0; k4 < far.length && k4 < 200; k4++) {
      var c3 = far[k4];
      if (stairsAt[c3] || !isF(c3)) continue;
      fl.deco[c3] = t.chest;
      var d1 = bfs(w, h, [arr], inWalk(pal, fl, null)), cnt = 0;
      for (i = 0; i < n; i++) if (d1[i] >= 0) cnt++;
      if (cnt === total - 1) { fl.features.push({ kind: 'chest', at: c3, item: null, treasure: true }); break; }
      fl.deco[c3] = null;
    }
    var open = 0;
    for (i = 0; i < n; i++) if (isF(i)) open++;
    fl.stats = { seededFill: seeded / interior, open: open / interior, pockets: comp.sizes.length - 1, tunnels: tunnels, filled: filled };
    fl.arrival = arr;
    return { fl: fl, problems: [] };
  }

  // ---------------------------------------------------------------- build, check
  function siteFloors(spec, S) {
    if (spec.kind === 'town') return 1;
    if (spec.kind === 'castle') return S.castle.floors;
    if (spec.kind === 'cave') return S.cave.floors;
    return spec.role === 'boss' ? S.dungeon.bossFloors : S.dungeon.keyFloors;
  }
  function inAttempt(spec, S, pal, attempt) {
    var P = [], floors = [];
    function R(fi) { return rng(hashStr((spec.seed >>> 0) + '|' + attempt + '|' + fi)); }
    if (spec.kind === 'town') {
      var tr = genTown(spec, S, pal, R(1), attempt);
      floors = tr.floors; P = tr.problems;
    } else {
      var nF = siteFloors(spec, S), prev = null;
      for (var fi = 1; fi <= nF && !P.length; fi++) {
        var r = spec.kind === 'cave' ? genCaveFloor(spec, S, pal, R(fi), attempt, fi, nF, prev) : genBuiltFloor(spec, S, pal, R(fi), attempt, fi, nF, prev);
        r.problems.forEach(function (p) { P.push(p); });
        floors.push(r.fl);
        var dn = r.fl.exits.filter(function (ex) { return ex.kind === 'down'; })[0];
        prev = dn ? dn.at : null;
      }
    }
    floors.forEach(function (fl, k) { fl.floor = k + 1; });
    var site = { key: spec.key, kind: spec.kind, role: spec.role || null, style: spec.kind, attempt: attempt, floors: floors, problems: P };
    site.npcs = [];
    floors.forEach(function (fl) { fl.npcList.forEach(function (p) { site.npcs.push({ slot: p.slot, archetype: p.archetype, role: p.role, floor: fl.floor, at: p.at, facing: p.facing, wander: p.wander, building: p.building, counter: p.counter == null ? null : p.counter }); }); fl.npcs = fl.npcList.map(function (p) { return p.slot; }); delete fl.npcList; });
    if (!P.length) inCheck(site, pal).forEach(function (p) { P.push(p); });
    site.ok = !P.length;
    floors.forEach(function (fl) { fl.digest = floorDigest(fl); });
    site.digest = digest(floors.map(function (fl) { return fl.digest; }).concat(site.npcs.map(function (p) { return p.slot + '@' + p.floor + ':' + p.at + ':' + p.archetype; })));
    return site;
  }
  function inBuild(spec) {
    var S = inSettings(spec.settings), pal = spec.palette, last = null;
    if (!pal || !pal.sets || !pal.sets.dungeon) throw new Error('interiors.build needs interiors.palette(art) with at least one interior tileset.');
    if (['town', 'dungeon', 'castle', 'cave'].indexOf(spec.kind) < 0) throw new Error('Unknown interior kind: ' + spec.kind);
    for (var a = 0; a < S.attempts; a++) { last = inAttempt(spec, S, pal, a); if (last.ok) break; }
    last.attempts = last.attempt + 1;
    return last;
  }
  // The walking check of one site. For each floor: every exit's arrival is reachable from the floor's first arrival
  // (holding every key); stairs pair up between floors; on a locked floor the key chest and the lock's near side are
  // reachable while the lock is shut, the goal is not, and with the key it is; every chest has a reachable side; every
  // other floor cell is reachable with the key (nothing walled off by accident). Towns: every door, counter front, and
  // the plaza are reachable from the gate, and every fixed NPC post stands on a floor or behind its counter.
  function inCheck(site, pal) {
    var out = [];
    site.floors.forEach(function (fl, k) {
      var w = fl.w, h = fl.h, n = w * h, first = fl.exits[0];
      if (!first) { out.push({ code: 'no-exit', message: site.key + ' floor ' + fl.floor + ' has no way in.' }); return; }
      var all = {}, lock = fl.features.filter(function (ft) { return ft.kind === 'lock'; })[0];
      if (lock) all[lock.requires[0]] = true;
      var dAll = reachFrom(pal, fl, first.arrive, all);
      fl.exits.forEach(function (ex) {
        if (dAll[ex.arrive] < 0) out.push({ code: 'exit', message: site.key + ' floor ' + fl.floor + ': the ' + ex.kind + ' exit cannot be reached.' });
        if (ex.toFloor != null) {
          var other = site.floors[ex.toFloor - 1];
          if (!other || !other.exits.some(function (e2) { return e2.toFloor === fl.floor && e2.kind === (ex.kind === 'down' ? 'up' : 'down'); })) out.push({ code: 'stairs', message: site.key + ' floor ' + fl.floor + ': its ' + ex.kind + ' stairs have no partner.' });
        }
      });
      function sideReach(d, c) { return nb4(c, w, h).some(function (q) { return d[q] >= 0; }); }
      fl.features.forEach(function (ft) { if (ft.kind === 'chest' && !sideReach(dAll, ft.at)) out.push({ code: 'chest', message: site.key + ' floor ' + fl.floor + ': a chest cannot be reached.' }); });
      var built = (site.kind === 'dungeon' || site.kind === 'castle') && k === site.floors.length - 1;
      if (built && !lock) out.push({ code: 'no-lock', message: site.key + ': the last floor has no locked door.' });
      if (lock) {
        var dShut = reachFrom(pal, fl, first.arrive, null), kc = fl.features.filter(function (ft) { return ft.kind === 'chest' && ft.item === lock.requires[0]; })[0];
        var goal = fl.features.filter(function (ft) { return ft.kind === 'boss' || ft.kind === 'chest' && ft.prize; })[0];
        if (!kc || !sideReach(dShut, kc.at)) out.push({ code: 'key-after-lock', message: site.key + ': the key chest cannot be reached before the lock.' });
        if (!sideReach(dShut, lock.at)) out.push({ code: 'lock', message: site.key + ': the locked door cannot be reached.' });
        if (!goal) out.push({ code: 'goal', message: site.key + ': the last floor has no goal.' });
        else {
          var gAt = goal.at;
          if (goal.kind === 'boss' ? dShut[gAt] >= 0 : sideReach(dShut, gAt)) out.push({ code: 'lock-open', message: site.key + ': the goal can be reached without the key.' });
          if (goal.kind === 'boss' ? dAll[gAt] < 0 : !sideReach(dAll, gAt)) out.push({ code: 'goal', message: site.key + ': the goal cannot be reached even with the key.' });
        }
      }
      if (site.kind === 'town') {
        (fl.buildings || []).forEach(function (bd) {
          if (dAll[bd.front] < 0 || dAll[bd.door] < 0 || dAll[bd.door - w] < 0) out.push({ code: 'door', message: site.key + ': the ' + bd.slot + ' cannot be entered.' });
          (bd.counters || []).forEach(function (c) { if (dAll[c + w] < 0) out.push({ code: 'counter', message: site.key + ': a counter in the ' + bd.slot + ' cannot be reached.' }); });
        });
        var pz = fl.plaza;
        if (pz && dAll[(pz[1] + 1) * w + pz[0] + 1] < 0) out.push({ code: 'plaza', message: site.key + ': the plaza cannot be reached from the gate.' });
      } else {
        for (var i = 0; i < n; i++) if ((flagOf(pal, fl.ground[i]) & 1) && !fl.deco[i] && dAll[i] < 0) { out.push({ code: 'orphan', message: site.key + ' floor ' + fl.floor + ' has floor that cannot be reached.' }); break; }
      }
    });
    site.npcs.forEach(function (p) {
      var fl = site.floors[p.floor - 1], f = fl ? cellFlags(pal, fl, p.at) : 0;
      if (!(f & 1)) out.push({ code: 'npc', message: site.key + ': ' + p.slot + ' stands on a wall.' });
    });
    return out;
  }
  // The NPC slots a site will have, from its kind, role, and settings alone (never the seed), so callers can name records
  // before building.
  function inSlots(spec) {
    if (spec.kind !== 'town') return [];
    var S = inSettings(spec.settings), small = spec.role !== 'start', out = ['inn'].concat((small ? ['item'] : SHOP_KINDS).map(function (k) { return 'shop:' + k; }), ['church', 'guard1', 'guard2']);
    for (var r = 1; r <= (small ? S.town.smallResidents : S.town.residents); r++) out.push('resident' + r);
    return out;
  }
  W.interiors = { DEFAULTS: IN_DEFAULTS, ARCHETYPES: ARCHETYPES, RESIDENT_WEIGHTS: RESIDENT_WEIGHTS, BUILDINGS: BUILDINGS, KEYS: IN_KEYS,
    settings: inSettings, palette: inPalette, floors: function (spec) { return siteFloors(spec, inSettings(spec.settings)); }, slots: inSlots,
    build: inBuild, check: inCheck, walk: function (pal, fl, held) { return inWalk(pal, fl, held); }, reach: reachFrom };

  // ---------------------------------------------------------------- encounter zones (Phase 5)
  // Encounter tables for the overworld and every dungeon, castle, and cave floor, plus the boss and guardian encounters
  // and the side quest givers. Pure: the bundle arrives as plain data (the WORLD side builds the spec) and nothing outside
  // the spec is read.
  //
  // Field zones are keyed by continent slug, chapter, and biome key (zone|field|<continent>|<chp>|<biome key>) and are
  // built only from overworld cells whose ground carries flag 2. DECISION: the chapter is part of the key because troops
  // belong to chapters, so a continent shared by two chapters has one table per chapter and biome (the cell's region
  // names its chapter). Interior zones are one per floor map (zone|<site key>|<floor>). Towns have none. Every key is
  // structural, so a reroll moves cells between zones but never renames one.
  //
  // A table fills four slots in FF6's pattern, weights in sixteenths 5, 5, 5, 1: the rare slot holds the strongest
  // non boss troop of the chapter, the three common slots cycle through the others in an order shuffled by the zone key
  // (not the seed), so different biomes of one chapter draw different mixes and a reroll keeps every table's troops.
  // Duplicate slots merge their weights. A rate in 256ths per step comes from the biome (or interior kind), scaled up
  // through the chapters and down the floors of a dungeon.
  var ZN_DEFAULTS = {
    slots: [5, 5, 5, 1],
    rates: { grassland: 8, steppe: 8, coast: 6, forest: 12, rainforest: 14, swamp: 14, desert: 12, tundra: 10, snow: 12, volcanic: 16, mountain: 6, default: 10 },
    interiorRates: { dungeon: 12, castle: 10, cave: 14 },
    chapterScale: 0.5, floorScale: 0.15
  };
  // Weather keywords matched against a wth_ record's name and realWorld text, tried in order; the first wth_ is the fallback.
  var WEATHER_HINTS = {
    snow: ['snow', 'blizzard', 'frost', 'ice', 'hail'], tundra: ['snow', 'frost', 'cold', 'wind'], mountain: ['wind', 'snow', 'clear'],
    rainforest: ['rain', 'storm', 'mist', 'fog'], swamp: ['fog', 'mist', 'rain'], forest: ['mist', 'rain', 'clear'],
    desert: ['sand', 'dust', 'heat', 'sun', 'clear'], volcanic: ['ash', 'ember', 'smoke', 'heat'], steppe: ['wind', 'dust', 'clear'],
    coast: ['wind', 'fog', 'rain', 'clear'], ocean: ['storm', 'rain', 'wind'], grassland: ['clear', 'sun', 'fair'],
    interior: ['clear', 'calm', 'still', 'none'], default: ['clear', 'fair', 'sun']
  };
  function znNum(v, d, a, b) { v = v == null || v === '' ? NaN : Number(v); return isFinite(v) ? clamp(v, a, b) : d; }
  function znSettings(s) {
    var z = s && s.zones || {}, rates = {}, ir = {}, sl = Array.isArray(z.slots) && z.slots.length === 4 ? z.slots.map(function (v) { return Math.floor(znNum(v, 0, 0, 16)); }) : ZN_DEFAULTS.slots.slice();
    each(ZN_DEFAULTS.rates, function (v, k) { rates[k] = v; });
    each(z.rates, function (v, k) { rates[k] = Math.floor(znNum(v, rates[k] == null ? ZN_DEFAULTS.rates.default : rates[k], 0, 255)); });
    each(ZN_DEFAULTS.interiorRates, function (v, k) { ir[k] = v; });
    each(z.interiorRates, function (v, k) { ir[k] = Math.floor(znNum(v, ir[k] == null ? ZN_DEFAULTS.interiorRates.dungeon : ir[k], 0, 255)); });
    return { slots: sl, rates: rates, interiorRates: ir, chapterScale: znNum(z.chapterScale, ZN_DEFAULTS.chapterScale, 0, 4), floorScale: znNum(z.floorScale, ZN_DEFAULTS.floorScale, 0, 2) };
  }
  function fieldKey(continent, chapter, biomeKey) { return 'zone|field|' + continent + '|' + chapter + '|' + biomeKey; }
  function interiorKey(siteKey, floor) { return 'zone|' + siteKey + '|' + floor; }
  function round(v) { return Math.floor(v + 0.5); }

  // A troop's strength: the sum of its members' levels (tier x 5 when a level is missing), then hit points to break ties.
  function troopPower(trp, enm) {
    var lv = 0, hp = 0;
    ((trp && trp.members) || []).forEach(function (m) {
      var e = enm && m && enm[m.enm];
      if (!e) return;
      lv += Number(e.level) > 0 ? Number(e.level) : (Number(e.tier) > 0 ? Number(e.tier) * 5 : 1);
      hp += Number(e.stats && e.stats.hp) > 0 ? Number(e.stats.hp) : 0;
    });
    return lv * 100000 + Math.min(hp, 99999);
  }
  function troopIsBoss(trp, enm) { return ((trp && trp.members) || []).some(function (m) { return !!(enm && m && enm[m.enm] && enm[m.enm].isBoss); }); }
  function byPower(a, b) { return b.power - a.power || (a.troop < b.troop ? -1 : a.troop > b.troop ? 1 : 0); }

  // slots(troops [{troop, power}], key, settings) -> {slots [4 troop IDs], troops [{troop, weight}], rare}.
  function znSlots(troops, key, S) {
    S = S || znSettings({});
    var list = (troops || []).slice().sort(byPower);
    if (!list.length) return { slots: [], troops: [], rare: null };
    var rare = list[0].troop, pool = list.slice(1).map(function (t) { return t.troop; }).sort();
    if (!pool.length) pool = [rare];
    var order = rng(hashStr('zone|' + key)).shuffle(pool), slots = [];
    for (var k = 0; k < 3; k++) slots.push(order[k % order.length]);
    slots.push(rare);
    var weights = {}, seen = [];
    slots.forEach(function (t, k) { if (weights[t] == null) { weights[t] = 0; seen.push(t); } weights[t] += S.slots[k]; });
    return { slots: slots, troops: seen.map(function (t) { return { troop: t, weight: weights[t] }; }).filter(function (x) { return x.weight > 0; }), rare: rare };
  }
  // weatherFor(hintKey, weather [{weather, name, text}]) -> wth_ ID or null.
  function weatherFor(hint, weather) {
    weather = weather || [];
    if (!weather.length) return null;
    var words = WEATHER_HINTS[hint] || WEATHER_HINTS.default;
    for (var k = 0; k < words.length; k++) {
      for (var j = 0; j < weather.length; j++) {
        var hay = (String(weather[j].name || '') + ' ' + String(weather[j].text || '')).toLowerCase();
        if (hay.indexOf(words[k]) >= 0) return weather[j].weather;
      }
    }
    return weather[0].weather;
  }
  // The field zone a cell of a built overworld belongs to, or null when it carries no flag 2 (water, walls, stamps).
  // biomes: {tileset ID: biome key}. Day 150 uses this at run time to find the table for the cell a party steps on.
  function znCellKey(ow, i, biomes) {
    var g = ow.ground[i];
    if (!g || String(g).indexOf(':') >= 0 || !((ow.flags[g] | 0) & 2)) return null;
    var r = ow.region[i];
    if (r == null || r < 0 || !ow.regions[r]) return null;
    var reg = ow.regions[r];
    return fieldKey(reg.continent, reg.chapter, biomes && biomes[g] || g);
  }
  // Field zone tallies of a built overworld: [{key, continent, chapter, region (region key), biome, biomeKey, cells}].
  function znFieldCells(ow, biomes) {
    var tally = {}, n = ow.ground.length;
    for (var i = 0; i < n; i++) {
      var k = znCellKey(ow, i, biomes);
      if (!k) continue;
      var z = tally[k];
      if (!z) { var reg = ow.regions[ow.region[i]]; z = tally[k] = { key: k, continent: reg.continent, chapter: reg.chapter, region: reg.key, biome: ow.ground[i], biomeKey: biomes && biomes[ow.ground[i]] || ow.ground[i], cells: 0 }; }
      z.cells++;
    }
    return keys(tally).map(function (k) { return tally[k]; });
  }
  // Cells of an interior floor that carry flag 2 (the decoration's flags when there is one, as the walk does).
  function znFloorCells(fl, flags) {
    var c = 0;
    for (var i = 0; i < fl.ground.length; i++) { var r = fl.deco[i] || fl.ground[i]; if (r && ((flags[r] | 0) & 2)) c++; }
    return c;
  }

  // build(spec) -> {field [zone], interior [zone], bosses [encounter], warnings, digest}.
  // spec: {settings (world.settings), chapters [{chapter, continent, troops [{troop, power}] (non boss), bosses [trp_]}]
  //   in story order, field (fieldCells output, plus region (the reg_ ID) and ref (biome:<key>)), interiors [{key (site
  //   key), site, map, kind, chapter, floor, floors, cells, ref (interior:<kind> of the tileset drawn with)}],
  //   backgrounds {subject ref: bgd_}, weather [{weather, name, text}] in rules order, bossSites [{site, map, at, troop,
  //   chapter, ref, finale}], spareSlots [{chapter, site, map, at, ref, kind}] in preference order, overrides {zone key:
  //   {rate, weights {trp_: n}}}}.
  // zone: {key, kind 'field' | 'interior', continent, chapter, region, biome, biomeKey, site, map, floor, cells, rate,
  //   baseRate, slots, troops [{troop, weight}], rare, background, weather, music 'battle', empty, overridden}.
  function znBuild(spec) {
    var S = znSettings(spec.settings), chap = {}, N = (spec.chapters || []).length, warnings = [], bg = spec.backgrounds || {}, ov = spec.overrides || {};
    (spec.chapters || []).forEach(function (c, k) { chap[c.chapter] = { index: k, c: c }; });
    function scale(chapter) { var ci = chap[chapter]; return 1 + S.chapterScale * (ci && N > 1 ? ci.index / (N - 1) : 0); }
    function zone(base, kind, hint, rateBase, floor) {
      var ci = chap[base.chapter], troops = ci ? ci.c.troops || [] : [], sl = znSlots(troops, base.key, S);
      var rate = clamp(round(rateBase * scale(base.chapter) * (1 + S.floorScale * ((floor || 1) - 1))), 0, 255);
      var bgd = bg[base.ref] || null;
      if (!bgd && kind === 'interior' && bg['interior:dungeon']) bgd = bg['interior:dungeon'];
      var z = { key: base.key, kind: kind, continent: base.continent || (ci ? ci.c.continent : null), chapter: base.chapter, region: base.region || null,
        biome: base.biome || null, biomeKey: base.biomeKey || null, site: base.site || null, map: base.map || null, floor: floor || null,
        cells: base.cells | 0, rate: rate, baseRate: rateBase, slots: sl.slots, troops: sl.troops, rare: sl.rare, background: bgd,
        weather: weatherFor(hint, spec.weather), music: 'battle', empty: !sl.troops.length, overridden: false };
      var o = ov[base.key];
      if (o && typeof o === 'object') {
        if (o.rate != null && isFinite(Number(o.rate))) { z.rate = clamp(Math.floor(Number(o.rate)), 0, 255); z.overridden = true; }
        if (o.weights && typeof o.weights === 'object') {
          z.troops = z.troops.map(function (t) { var w = o.weights[t.troop]; return w == null || !isFinite(Number(w)) ? t : { troop: t.troop, weight: clamp(Math.floor(Number(w)), 0, 255) }; });
          z.overridden = true;
        }
      }
      if (!ci) warnings.push({ code: 'no-chapter', zone: z.key, message: 'Zone ' + z.key + ' belongs to no chapter of the Charter.' });
      else if (z.empty) warnings.push({ code: 'no-troops', zone: z.key, chapter: z.chapter, message: 'Chapter ' + z.chapter + ' has no troop without a boss for zone ' + z.key + ', so it never triggers a battle. Add troops in Saga Forge (Day 146).' });
      if (!z.background) warnings.push({ code: 'no-background', zone: z.key, message: 'No battle background has the role ' + base.ref + ' for zone ' + z.key + '.' });
      return z;
    }
    var field = (spec.field || []).slice().sort(function (a, b) { return a.key < b.key ? -1 : 1; }).map(function (f) {
      var r = S.rates[f.biomeKey]; return zone(f, 'field', WEATHER_HINTS[f.biomeKey] ? f.biomeKey : 'default', r == null ? S.rates.default : r, null);
    });
    var interior = (spec.interiors || []).map(function (m) {
      var r = S.interiorRates[m.kind]; return zone({ key: interiorKey(m.key, m.floor), chapter: m.chapter, site: m.site, map: m.map, cells: m.cells, ref: m.ref }, 'interior', 'interior', r == null ? S.interiorRates.dungeon : r, m.floor);
    }).sort(function (a, b) { return a.key < b.key ? -1 : 1; });
    // Bosses: each boss feature keeps its troop. Spare boss troops of a chapter (more than one) guard its optional caves'
    // treasure, then its key dungeon's prize, in the order the slots arrive.
    var bosses = [], used = {};
    (spec.bossSites || []).forEach(function (s) {
      if (s.troop) used[s.troop] = 1;
      bosses.push({ role: 'boss', site: s.site, map: s.map, at: s.at, troop: s.troop || null, chapter: s.chapter, background: bg[s.ref] || bg['interior:dungeon'] || null, music: 'boss', finale: !!s.finale });
    });
    (spec.chapters || []).forEach(function (c) {
      var spare = (c.bosses || []).filter(function (t) { return !used[t]; }).sort();
      var slots = (spec.spareSlots || []).filter(function (s) { return s.chapter === c.chapter; });
      spare.forEach(function (t, k) {
        var s = slots[k];
        if (!s) { warnings.push({ code: 'spare-boss', chapter: c.chapter, troop: t, message: 'Boss troop ' + t + ' of chapter ' + c.chapter + ' has nowhere to stand: the chapter has no free cave or key dungeon chest to guard.' }); return; }
        used[t] = 1;
        bosses.push({ role: 'guardian', site: s.site, map: s.map, at: s.at, troop: t, chapter: c.chapter, background: bg[s.ref] || bg['interior:dungeon'] || null, music: 'boss', finale: false, guards: s.kind });
      });
    });
    var parts = [];
    field.concat(interior).forEach(function (z) { parts.push(z.key, z.rate, z.background || '-', z.weather || '-', z.troops.map(function (t) { return t.troop + '*' + t.weight; }).join(',')); });
    bosses.forEach(function (x) { parts.push(x.role, x.site, x.map, String(x.at), x.troop || '-'); });
    return { field: field, interior: interior, bosses: bosses, warnings: warnings, digest: digest(parts) };
  }

  // givers(spec) -> {assign {sdq_: npc_}, warnings}. spec: {chapters [chp_ in story order], quests [{quest, chapter,
  //   keep (an npc_ to leave in place, or null)}], people [{npc, chapter, town (order of its town), slot, role}]}.
  // Each quest takes a person in a town of its own chapter, residents first, then anyone but innkeepers, merchants,
  // and the priest, then anyone; within those, the person giving the fewest quests so far, then the earliest town and
  // slot. A chapter with no townsfolk borrows the nearest chapter's, earlier first. Quests go in ID order.
  function slotCmp(a, b) {
    var ma = /^(.*?)(\d+)$/.exec(a), mb = /^(.*?)(\d+)$/.exec(b);
    if (ma && mb && ma[1] === mb[1]) return Number(ma[2]) - Number(mb[2]);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  var POSTED = { innkeeper: 1, priest: 1 };
  function tier(p) { return p.role === 'resident' ? 0 : POSTED[p.role] || /^shop:/.test(p.role || '') ? 2 : 1; }
  function znGivers(spec) {
    var order = spec.chapters || [], at = {}, people = (spec.people || []).slice(), count = {}, assign = {}, warnings = [];
    order.forEach(function (c, k) { at[c] = k; });
    people.sort(function (a, b) { return tier(a) - tier(b) || (a.town | 0) - (b.town | 0) || slotCmp(String(a.slot), String(b.slot)) || (a.npc < b.npc ? -1 : 1); });
    people.forEach(function (p) { count[p.npc] = 0; });
    (spec.quests || []).forEach(function (q) { if (q.keep && count[q.keep] != null) count[q.keep]++; });
    function poolFor(ch) {
      var own = people.filter(function (p) { return p.chapter === ch; });
      if (own.length || at[ch] == null) return own;
      for (var d = 1; d < order.length; d++) {
        var e = order[at[ch] - d], l = order[at[ch] + d];
        var pe = e ? people.filter(function (p) { return p.chapter === e; }) : [], pl = l ? people.filter(function (p) { return p.chapter === l; }) : [];
        if (pe.length) return pe;
        if (pl.length) return pl;
      }
      return [];
    }
    (spec.quests || []).slice().sort(function (a, b) { return a.quest < b.quest ? -1 : 1; }).forEach(function (q) {
      if (q.keep) return;
      var ch = q.chapter && at[q.chapter] != null ? q.chapter : order[0];
      if (ch !== q.chapter) warnings.push({ code: 'quest-chapter', quest: q.quest, message: 'Side quest ' + q.quest + ' names no chapter of the Charter, so its giver stands in the first chapter.' });
      var pool = poolFor(ch);
      if (!pool.length) { warnings.push({ code: 'no-giver', quest: q.quest, message: 'No town has anyone to give side quest ' + q.quest + '.' }); return; }
      if (pool[0].chapter !== ch) warnings.push({ code: 'borrowed-giver', quest: q.quest, message: 'Chapter ' + ch + ' has no townsfolk, so side quest ' + q.quest + ' is given in chapter ' + pool[0].chapter + '.' });
      var best = null;
      pool.forEach(function (p) { if (!best || tier(p) < tier(best) || tier(p) === tier(best) && count[p.npc] < count[best.npc]) best = p; });
      assign[q.quest] = best.npc; count[best.npc]++;
    });
    return { assign: assign, warnings: warnings };
  }

  W.zones = { DEFAULTS: ZN_DEFAULTS, WEATHER_HINTS: WEATHER_HINTS, settings: znSettings, fieldKey: fieldKey, interiorKey: interiorKey,
    power: troopPower, isBoss: troopIsBoss, slots: znSlots, weatherFor: weatherFor, cellKey: znCellKey, fieldCells: znFieldCells,
    floorCells: znFloorCells, build: znBuild, givers: znGivers };

  // ---------------------------------------------------------------- checks (Phase 6)
  // The world's proofs, run before a Final export and reusable by Day 150 at load time. Pure: the bundle arrives as plain
  // data, the render engine is passed in where tiles are read, and nothing outside the spec is read. Every check returns
  // {ok, problems, ...detail}; a problem is {check, code, level ('error' | 'broken' | 'warning'), message, record (an ID
  // or 'world'), field, id (the missing ID for a broken reference), map, at}.
  //
  // progression(spec): a four way flood fill over the overworld once per chapter, holding what the chapters before it
  //   granted. The ship lets the party sail sea water and step ashore on passable land; the airship lands on any open,
  //   passable land cell that is not a gate, so it reaches every land cell, never a site: every site's entrance still
  //   needs its own chapter key. Proven for each chapter: every non boss site front is reachable and can be entered; the
  //   boss lock's approach is reachable while the lock stays shut, and the lock opens with the chapter's seal; inside each
  //   site the key chest comes before the lock, the goal sits behind it, and the key dungeon's prize is the chapter's
  //   seal while the boss grants what the graph says. Then, holding everything up to and including the chapter's seal but
  //   not its boss, no site of a later chapter can be entered (a golden key there is an early-key error), and, the airship
  //   aside, no inner ground of a later region can be walked to.
  // flags(spec): every tile of every map resolves through the render engine and carries the flags play depends on.
  // refs(spec): every reference the world holds points at something that exists.
  var CK_LEVEL = { error: 1, broken: 1, warning: 1 };
  function ckItem(check, code, level, message, extra) {
    var o = { check: check, code: code, level: CK_LEVEL[level] ? level : 'error', message: message, record: 'world', field: check };
    each(extra || {}, function (v, k) { o[k] = v; });
    return o;
  }
  function heldOf(list) { var h = {}; (list || []).forEach(function (k) { h[k] = true; }); return h; }
  function heldList(h) { return keys(h).filter(function (k) { return h[k]; }); }
  function covers(req, h) { return (req || []).every(function (k) { return h[k]; }); }

  // Cells a party can reach holding h. Without the airship this is overworld.reach; with it, every open passable land cell
  // that is not a gate is a landing place as well, and the party walks (and sails, with the ship) on from each one.
  function ckLandable(ow, i) {
    return ow.owner[i] >= 0 && ow.st[i] === ST_FREE && ow.gateAt[i] < 0 && !ow.sea[i] && owWalkable(ow, i, {}, false);
  }
  function ckReach(ow, h, airship) {
    if (!airship) return owReach(ow, h);
    var ship = !!h['vehicle:ship'], seeds = [], out = new Uint8Array(ow.w * ow.h), n = ow.w * ow.h, i;
    if (ow.start != null) seeds.push(ow.start);
    for (i = 0; i < n; i++) if (ckLandable(ow, i)) seeds.push(i);
    if (!seeds.length) return out;
    var d = bfs(ow.w, ow.h, seeds, function (j) { return owWalkable(ow, j, h, ship); });
    for (i = 0; i < n; i++) if (d[i] >= 0) out[i] = 1;
    return out;
  }
  function ckCount(a) { var c = 0; for (var i = 0; i < a.length; i++) c += a[i]; return c; }

  // The walking proof inside one site, beyond interiors.check: the golden item is where the graph puts it.
  function ckInterior(site, nd, pal, chp) {
    var out = [], rec = nd.record || 'world';
    if (!site) return [ckItem('progression', 'no-interior', 'error', 'The interior of ' + nd.key + ' was not built.', { record: rec, chapter: chp })];
    inCheck(site, pal).forEach(function (p) { out.push(ckItem('progression', 'interior-' + p.code, 'error', p.message, { record: rec, chapter: chp })); });
    var last = site.floors[site.floors.length - 1], feats = last ? last.features : [];
    if (nd.role === 'key') {
      var seal = (nd.grants || [])[0] || null, prize = feats.filter(function (ft) { return ft.kind === 'chest' && ft.prize; })[0];
      if (!prize || prize.item !== seal) out.push(ckItem('progression', 'seal-missing', 'error', 'The key dungeon ' + nd.key + ' does not hold ' + (seal || 'its seal') + ' behind its lock.', { record: rec, chapter: chp }));
    }
    if (nd.role === 'boss') {
      var boss = feats.filter(function (ft) { return ft.kind === 'boss'; })[0];
      if (!boss) out.push(ckItem('progression', 'boss-missing', 'error', 'The boss dungeon ' + nd.key + ' has no boss room.', { record: rec, chapter: chp }));
      else if ((boss.grants || []).join('|') !== (nd.grants || []).join('|')) out.push(ckItem('progression', 'boss-grants', 'error', 'The boss of ' + nd.key + ' grants ' + ((boss.grants || []).join(', ') || 'nothing') + ', not ' + ((nd.grants || []).join(', ') || 'nothing') + '.', { record: rec, chapter: chp }));
    }
    return out;
  }

  // spec: {ow (overworld.build output), graph (Phase 2, site nodes carrying record), sites {site key: interiors.build
  // output} (optional: without it only the overworld is proven), palette (interiors.palette(art), with sites)}.
  function ckProgression(spec) {
    var ow = spec.ow, g = spec.graph, sites = spec.sites || null, pal = spec.palette || null, problems = [], chapters = [], byKey = {}, idx = {};
    if (!ow || !g || !Array.isArray(g.chapters)) return { ok: false, problems: [ckItem('progression', 'no-map', 'error', 'There is no overworld to walk.')], chapters: [] };
    g.chapters.forEach(function (c, k) { idx[c] = k; });
    g.nodes.forEach(function (nd) { byKey[nd.key] = nd; });
    var later = {};
    ow.sites.forEach(function (s) { (later[s.chapter] = later[s.chapter] || []).push(s); });
    g.chapters.forEach(function (chp, k) {
      var h = heldOf(g.start);
      g.nodes.forEach(function (nd) { if (idx[nd.chapter] < k) nd.grants.forEach(function (gk) { h[gk] = true; }); });
      var air = !!h['vehicle:airship'], A = ckReach(ow, h, air), seal = 'item:seal:' + chp, h2 = heldOf(heldList(h).concat([seal])), B = ckReach(ow, h2, air);
      var mine = ow.sites.filter(function (s) { return s.chapter === chp; }), rows = [], before = problems.length;
      var report = { chapter: chp, index: k, held: heldList(h), ship: !!h['vehicle:ship'], airship: air, reach: ckCount(A), sites: rows, lock: null, sealed: true };
      mine.forEach(function (s) {
        var nd = byKey[s.key] || { key: s.key, requires: [], grants: [], role: s.role }, rec = s.record || nd.record || 'world', row = { key: s.key, record: rec, role: s.role, golden: !!nd.golden, ok: true, why: [] };
        function fail(code, msg) { row.ok = false; row.why.push(msg); problems.push(ckItem('progression', code, 'error', msg, { record: rec, chapter: chp, at: s.front })); }
        if (s.role === 'boss') {
          var shut = !A[s.front], opens = !!B[s.front];
          report.lock = { site: s.key, shut: shut, opens: opens, approach: !!A[s.approach] };
          if (!A[s.approach]) fail('unreachable', 'The way to ' + s.key + ' cannot be reached in chapter ' + chp + '.');
          if (!shut) fail('lock-open', 'The lock before ' + s.key + ' opens without the seal ' + seal + '.');
          if (!opens) fail('lock-shut', 'The lock before ' + s.key + ' stays shut even with the seal ' + seal + '.');
          if (!covers(nd.requires, h2)) fail('sealed-site', s.key + ' needs ' + nd.requires.filter(function (q) { return !h2[q]; }).join(', ') + ', which chapter ' + chp + ' never holds.');
        } else {
          if (!A[s.front]) fail('unreachable', s.key + ' cannot be reached in chapter ' + chp + '.');
          if (!covers(nd.requires, h)) fail('sealed-site', s.key + ' needs ' + nd.requires.filter(function (q) { return !h[q]; }).join(', ') + ', which chapter ' + chp + ' does not hold on arrival.');
        }
        if (sites) ckInterior(sites[s.key], nd, pal, chp).forEach(function (p) { row.ok = false; row.why.push(p.message); problems.push(p); });
        rows.push(row);
      });
      // Nothing of a later chapter may open while this one is still being played (seal held, boss not yet beaten).
      ow.sites.forEach(function (s) {
        var j = idx[s.chapter], nd = byKey[s.key];
        if (!(j > k) || !nd) return;
        if (B[s.role === 'boss' ? s.approach : s.front] && covers(nd.requires, h2)) {
          report.sealed = false;
          var gold = nd.golden || s.role === 'key' || s.role === 'boss';
          problems.push(ckItem('progression', gold ? 'early-key' : 'early-site', 'error',
            (gold ? 'The golden key in ' + s.key + ' (chapter ' + s.chapter + ')' : s.key + ' (chapter ' + s.chapter + ')') + ' can be reached and entered during chapter ' + chp + '.', { record: nd.record || s.record || 'world', chapter: chp, at: s.front }));
        }
      });
      // Walking (and sailing) alone never reaches a later region's inner ground. The airship flies anywhere by design.
      var G = air ? ckReach(ow, heldOf(heldList(h2).filter(function (q) { return q !== 'vehicle:airship'; })), false) : B;
      for (var i = 0; i < G.length; i++) {
        if (!G[i] || ow.region[i] < 0 || ow.cls[i] !== CLS_INNER || ow.st[i] === ST_GATE) continue;
        var rk = ow.regions[ow.region[i]];
        if (rk && rk.index > k) {
          report.sealed = false;
          problems.push(ckItem('progression', 'early-ground', 'error', 'Chapter ' + rk.chapter + ' ground can be walked to during chapter ' + chp + ' without the airship.', { record: 'world', chapter: chp, at: i }));
          break;
        }
      }
      report.ok = problems.length === before;
      chapters.push(report);
    });
    return { ok: !problems.length, problems: problems, chapters: chapters, interiors: !!sites };
  }

  // spec: {ow, sites {key: site}, kinds {key: kind}, art (plain), render (ENGINE_RENDER)}. Rules, by what play needs:
  // errors change where a party can walk (water that is walkable, a wall or ridge that is, a door, floor, exit, lock
  // cell, or person's cell that is not, a tile the art lacks); warnings change only drawing or triggering (a wall that
  // does not autotile, a door with no layer above, a dungeon floor without the encounter flag, a building floor with it,
  // a counter without the counter flag, a chest that can be walked through).
  function ckFlags(spec) {
    var R = spec.render, art = spec.art, problems = [], stats = { maps: 0, cells: 0, walls: 0, doors: 0, counters: 0, floors: 0 };
    if (!R || !R.tiles) return { ok: false, problems: [ckItem('flags', 'no-render', 'error', 'The render engine is not available, so no tile can be read.')], stats: stats };
    var T = R.tiles, memoRef = {};
    function res(ref) { if (memoRef[ref] === undefined) memoRef[ref] = ref ? T.resolve(art, ref) : null; return memoRef[ref]; }
    function tally(map, record) {
      var got = {};
      return {
        add: function (code, level, msg, at) { var k = code + '|' + level; if (!got[k]) got[k] = { code: code, level: level, msg: msg, n: 0, at: at }; got[k].n++; },
        flush: function () {
          keys(got).forEach(function (k) {
            var t = got[k];
            problems.push(ckItem('flags', t.code, t.level, t.msg + (t.n > 1 ? ' (' + t.n + ' cells)' : ''), { record: record || 'world', map: map, at: t.at, count: t.n }));
          });
        }
      };
    }
    var ow = spec.ow;
    if (ow) {
      var om = { w: ow.w, h: ow.h, ground: ow.ground, deco: ow.deco }, tl = tally('overworld', spec.overworldRecord), n = ow.w * ow.h, lockCell = {};
      ow.gates.forEach(function (gq) { if (gq.kind === 'lock') lockCell[gq.cells[0]] = 1; });
      stats.maps++;
      for (var i = 0; i < n; i++) {
        stats.cells++;
        var gref = ow.ground[i], dref = ow.deco[i];
        if (!res(gref)) { tl.add('missing-tile', 'broken', 'The overworld uses ' + gref + ', a tile the art does not have.', i); continue; }
        if (dref && !res(dref)) { tl.add('missing-tile', 'broken', 'The overworld uses ' + dref + ', a tile the art does not have.', i); continue; }
        var f = T.flagsAt(art, om, i % ow.w, (i - i % ow.w) / ow.w), st = ow.st[i];
        if (ow.owner[i] < 0) {
          if (f & 1) tl.add('water-walkable', 'error', 'Water on the overworld can be walked on, so the ship is not needed to cross it.', i);
          if (ow.sea[i] && !(f & 4)) tl.add('sea-not-sailable', 'error', 'Sea on the overworld does not carry the swim flag, so the ship cannot sail it.', i);
        } else if (st === ST_WALL || st === ST_GATE && !lockCell[i]) {
          stats.walls++;
          if (f & 5) tl.add('wall-open', 'error', 'A ridge or ring cell of the overworld can be ' + (f & 1 ? 'walked' : 'sailed') + ' over, so a gate could be bypassed.', i);
        } else if (lockCell[i]) {
          if (!(f & 1)) tl.add('lock-blocked', 'error', 'A boss lock cell on the overworld blocks even when open.', i);
        } else if (st === ST_STAMP) {
          if (f & 1) tl.add('stamp-open', 'error', 'A site wall on the overworld can be walked through.', i);
        } else if (st === ST_DOOR) {
          stats.doors++;
          if (!(f & 1)) tl.add('door-blocked', 'error', 'A site entrance on the overworld cannot be walked into.', i);
        }
      }
      if (ow.start != null && !(T.flagsAt(art, om, ow.start % ow.w, (ow.start - ow.start % ow.w) / ow.w) & 1)) tl.add('start-blocked', 'error', 'The start cell of the overworld cannot be stood on.', ow.start);
      ow.sites.forEach(function (s) {
        if (s.stamp === 'cave') return;
        var e = s.entrance, fe = T.flagsAt(art, om, e % ow.w, (e - e % ow.w) / ow.w);
        if (!(fe & 32)) tl.add('door-layer', 'warning', 'A town or dungeon entrance on the overworld has no lintel or arch drawn above the party.', e);
      });
      tl.flush();
    }
    each(spec.sites || {}, function (site, key) {
      var kind = (spec.kinds || {})[key] || site.kind, rec = (spec.records || {})[key] || 'world';
      site.floors.forEach(function (fl) {
        var map = { w: fl.w, h: fl.h, ground: fl.ground, deco: fl.deco }, tl2 = tally(key + '|' + fl.floor, rec), w = fl.w, N = fl.w * fl.h, grid2 = { w: fl.w, h: fl.h, cells: fl.ground };
        stats.maps++;
        function F(c) { return T.flagsAt(art, map, c % w, (c - c % w) / w); }
        for (var c = 0; c < N; c++) {
          stats.cells++;
          var gr = fl.ground[c], dc = fl.deco[c], rg = res(gr);
          if (!rg) { tl2.add('missing-tile', 'broken', key + ' floor ' + fl.floor + ' uses ' + gr + ', a tile the art does not have.', c); continue; }
          if (dc && !res(dc)) { tl2.add('missing-tile', 'broken', key + ' floor ' + fl.floor + ' uses ' + dc + ', a tile the art does not have.', c); continue; }
          var fa = F(c), gk = rg.key, dk = dc ? res(dc).key : null;
          if (gk === 'wall') {
            stats.walls++;
            if (rg.flags & 1) tl2.add('wall-open', 'error', key + ' floor ' + fl.floor + ' has a wall that can be walked through.', c);
            var bi = T.blobIndex(T.mask8(grid2, c % w, (c - c % w) / w, function (a, b2) { return a === b2; }));
            if (!rg.autotile || !(bi >= 0 && bi < 47)) tl2.add('wall-autotile', 'warning', key + ' floor ' + fl.floor + ' has a wall that does not autotile.', c);
          } else if (gk === 'counter') {
            stats.counters++;
            if (fa & 1) tl2.add('counter-open', 'error', key + ' floor ' + fl.floor + ' has a counter that can be walked over.', c);
            if (!(fa & 16)) tl2.add('counter-flag', 'warning', key + ' floor ' + fl.floor + ' has a counter without the counter flag, so no one can be spoken to across it.', c);
          } else if (gk === 'floor' && !dc) {
            stats.floors++;
            if (!(fa & 1)) tl2.add('floor-blocked', 'error', key + ' floor ' + fl.floor + ' has floor that cannot be walked on.', c);
            if (kind === 'town' && (fa & 2)) tl2.add('town-encounter', 'warning', key + ' has building floor carrying the encounter flag (building floors are flag 1).', c);
            if (kind !== 'town' && !(fa & 2)) tl2.add('floor-encounter', 'warning', key + ' floor ' + fl.floor + ' has floor without the encounter flag, so its zone never triggers there.', c);
          }
          if (dk === 'lintel' || dk === 'arch') {
            stats.doors++;
            if (!(fa & 1)) tl2.add('door-blocked', 'error', key + ' floor ' + fl.floor + ' has a door that cannot be walked through.', c);
            if (!(fa & 32)) tl2.add('door-layer', 'warning', key + ' floor ' + fl.floor + ' has a door whose ' + dk + ' is not drawn above the party.', c);
          }
          if (dk === 'chest' && (fa & 1)) tl2.add('chest-open', 'warning', key + ' floor ' + fl.floor + ' has a chest that can be walked through.', c);
        }
        fl.exits.forEach(function (ex) {
          if (!(F(ex.at) & 1)) tl2.add('exit-blocked', 'error', key + ' floor ' + fl.floor + ' has a ' + ex.kind + ' exit that cannot be stood on.', ex.at);
          if (!(F(ex.arrive) & 1)) tl2.add('arrive-blocked', 'error', key + ' floor ' + fl.floor + ' has an arrival cell that cannot be stood on.', ex.arrive);
        });
        fl.features.forEach(function (ft) { if (ft.kind === 'lock' && !(F(ft.at) & 1)) tl2.add('lock-blocked', 'error', key + ' floor ' + fl.floor + ' has a locked door that blocks even when unlocked.', ft.at); });
        site.npcs.forEach(function (p) { if (p.floor === fl.floor && !(F(p.at) & 1)) tl2.add('npc-blocked', 'error', key + ': ' + p.slot + ' stands on a cell that cannot be stood on.', p.at); });
        tl2.flush();
      });
    });
    return { ok: !problems.some(function (p) { return p.level !== 'warning'; }), problems: problems, stats: stats };
  }

  // spec: plain data gathered from the bundle:
  //   records {map_, reg_, npc_, twn_, dgn_: {id: record}}, chapters [chp ids], troops {trp_: {boss}}, tilesets {til_:
  //   kind}, interiorSets {town, dungeon, cave, castle: til_ id} (interiors.palette sets), backgrounds {bgd_: 1}, music
  //   {role ref: mus_} (subject refs such as music:battle), weather {wth_: 1}, sprites {spr_: subject ref}, quests {sdq_: 1},
  //   zones (world.zones or null), graph (world.progression or null), archetypes [names].
  // A missing ID is 'broken'; a missing role or sprite the world needs is an 'error'; anything only cosmetic is a warning.
  function ckRefs(spec) {
    var out = [], R = spec.records || {}, chap = heldOf(spec.chapters), trp = spec.troops || {}, til = spec.tilesets || {}, bg = spec.backgrounds || {};
    var mus = spec.music || {}, wth = spec.weather || {}, spr = spec.sprites || {}, sdq = spec.quests || {}, sets = spec.interiorSets || {}, arch = heldOf(spec.archetypes);
    function has(id) { var p = typeof id === 'string' ? id.slice(0, 4) : ''; return !!(R[p] && R[p][id]); }
    function broken(rec, field, id, what) { out.push(ckItem('refs', 'missing-' + what, 'broken', (rec === 'world' ? 'The world' : rec) + ' refers to ' + what + ' ' + id + ', which does not exist.', { record: rec, field: field, id: id })); }
    function need(rec, field, id, what) { if (id && !has(id)) broken(rec, field, id, what); }
    function needTroop(rec, field, id) { if (id && !trp[id]) broken(rec, field, id, 'troop'); }
    function needChapter(rec, field, id) { if (id && !chap[id]) broken(rec, field, id, 'chapter'); }
    var used = { town: false, dungeon: false, battle: false, boss: false, field: {} };
    each(R.reg_, function (r, id) {
      (r.sites || []).forEach(function (s, k) { need(id, 'sites[' + k + ']', s, 'site'); });
      need(id, 'next', r.next, 'region');
    });
    ['twn_', 'dgn_'].forEach(function (p) {
      each(R[p], function (r, id) {
        need(id, 'region', r.region, 'region');
        if (r.interior) {
          if (['town', 'dungeon', 'cave', 'castle'].indexOf(r.interior) < 0) out.push(ckItem('refs', 'interior-key', 'error', id + ' asks for an interior kind ' + r.interior + ', which no generator makes.', { record: id, field: 'interior' }));
          else if (!sets[r.interior]) out.push(ckItem('refs', 'interior-key', 'error', id + ' is a ' + r.interior + ', but the art has no interior tileset to build it with. Add interior:' + r.interior + ' or interior:dungeon in Art and Audio Forge (Day 147).', { record: id, field: 'interior' }));
          if (r.interior === 'town') used.town = true; else used.dungeon = true;
        }
        if (r.troop) {
          needTroop(id, 'troop', r.troop);
          if (trp[r.troop] && !trp[r.troop].boss) out.push(ckItem('refs', 'boss-not-boss', 'warning', id + ' sets troop ' + r.troop + ' as its boss, but no member of that troop is a boss.', { record: id, field: 'troop' }));
          used.boss = true;
        }
        (r.spareBosses || []).forEach(function (t, k) { needTroop(id, 'spareBosses[' + k + ']', t); });
        (r.maps || []).forEach(function (m, k) { need(id, 'maps[' + k + ']', m, 'map'); });
        (r.people || []).forEach(function (m, k) { need(id, 'people[' + k + ']', m, 'person'); });
        if (r.entrance) need(id, 'entrance.map', r.entrance.map, 'map');
        if (r.overworld) need(id, 'overworld.map', r.overworld.map, 'map');
      });
    });
    each(R.map_, function (m, id) {
      if (m.kind === 'overworld') {
        (m.continents || []).forEach(function (c, k) {
          (c.regions || []).forEach(function (r, q) { need(id, 'continents[' + k + '].regions[' + q + ']', r, 'region'); });
          if (c.continent && (c.regions || []).length) used.field[c.continent] = true;
        });
        (m.regions || []).forEach(function (r, k) { need(id, 'regions[' + k + ']', r.region, 'region'); needChapter(id, 'regions[' + k + '].chapter', r.chapter); });
        (m.sites || []).forEach(function (s, k) {
          need(id, 'sites[' + k + ']', s.site, 'site'); need(id, 'sites[' + k + '].region', s.region, 'region'); needChapter(id, 'sites[' + k + '].chapter', s.chapter);
          if (s.enter) need(id, 'sites[' + k + '].enter.map', s.enter.map, 'map');
        });
        (m.gates || []).forEach(function (gq, k) { need(id, 'gates[' + k + '].region', gq.region, 'region'); need(id, 'gates[' + k + '].from', gq.from, 'region'); });
        ((m.stats || {}).biomes || []).forEach(function (bm, k) {
          if (!til[bm.biome]) broken(id, 'stats.biomes[' + k + ']', bm.biome, 'biome');
          else if (til[bm.biome] !== 'biome') out.push(ckItem('refs', 'not-biome', 'error', id + ' paints ground with ' + bm.biome + ', which is not a biome tileset.', { record: id, field: 'stats.biomes' }));
        });
      } else {
        need(id, 'site', m.site, 'site');
        if (m.tileset) { if (!til[m.tileset]) broken(id, 'tileset', m.tileset, 'tileset'); else if (til[m.tileset] !== 'interior') out.push(ckItem('refs', 'not-interior', 'error', id + ' is drawn with ' + m.tileset + ', which is not an interior tileset.', { record: id, field: 'tileset' })); }
        if (m.outdoor && !til[m.outdoor]) broken(id, 'outdoor', m.outdoor, 'biome');
        if (m.path && !til[String(m.path).split(':')[0]]) broken(id, 'path', m.path, 'tileset');
        (m.exits || []).forEach(function (ex, k) { if (!ex.to) out.push(ckItem('refs', 'exit-nowhere', 'error', id + ' has a ' + ex.kind + ' exit that leads nowhere.', { record: id, field: 'exits[' + k + ']' })); else need(id, 'exits[' + k + '].to.map', ex.to.map, 'map'); });
        (m.people || []).forEach(function (p, k) { need(id, 'people[' + k + ']', p, 'person'); });
        (m.features || []).forEach(function (ft, k) { if (ft.troop) needTroop(id, 'features[' + k + '].troop', ft.troop); });
      }
    });
    each(R.npc_, function (p, id) {
      need(id, 'site', p.site, 'site'); need(id, 'map', p.map, 'map');
      if (p.archetype && spec.archetypes && !arch[p.archetype]) out.push(ckItem('refs', 'archetype', 'warning', id + ' is a ' + p.archetype + ', which is not one of the ten NPC archetypes.', { record: id, field: 'archetype' }));
      // The archetype's sprite is what draws a person: the record's own sprite, else the art's npc:<archetype> role.
      var roleHas = keys(spr).some(function (sid) { return spr[sid] === 'npc:' + p.archetype; });
      if (!p.sprite && !roleHas) out.push(ckItem('refs', 'no-sprite', 'error', (p.name || id) + (p.archetype ? ' has no field sprite: the art has none for the ' + p.archetype + ' archetype. Add an npc:' + p.archetype + ' sprite in Art and Audio Forge (Day 147).' : ' has neither a sprite nor an archetype, so nothing can draw them.'), { record: id, field: 'sprite' }));
      else if (p.sprite && !spr[p.sprite]) broken(id, 'sprite', p.sprite, 'sprite');
      else if (p.sprite && spr[p.sprite] !== 'npc:' + p.archetype) out.push(ckItem('refs', 'sprite-archetype', 'warning', id + ' is a ' + p.archetype + ' drawn with ' + p.sprite + ', whose role is ' + spr[p.sprite] + '.', { record: id, field: 'sprite' }));
      (p.quests || []).forEach(function (q, k) { if (!sdq[q]) broken(id, 'quests[' + k + ']', q, 'side quest'); });
    });
    var z = spec.zones;
    if (z && Array.isArray(z.field)) {
      var fire = function (q) { return !q.empty && (q.rate | 0) > 0 && (q.troops || []).length > 0; };
      z.field.concat(z.interior || []).forEach(function (q) {
        var at = 'zones.' + q.key;
        needChapter('world', at + '.chapter', q.chapter);
        if (q.biome && !til[q.biome]) broken('world', at + '.biome', q.biome, 'biome');
        if (q.region) need('world', at + '.region', q.region, 'region');
        if (q.map) need('world', at + '.map', q.map, 'map');
        if (q.site) need('world', at + '.site', q.site, 'site');
        (q.troops || []).forEach(function (t) { needTroop('world', at + '.troops', t.troop); if (trp[t.troop] && trp[t.troop].boss) out.push(ckItem('refs', 'boss-in-table', 'error', 'Zone ' + q.key + ' draws boss troop ' + t.troop + ' at random.', { record: 'world', field: at })); });
        if (q.background && !bg[q.background]) broken('world', at + '.background', q.background, 'battle background');
        if (!q.background && fire(q)) out.push(ckItem('refs', 'no-background', 'error', 'Zone ' + q.key + ' can start a battle, but no battle background has its role. Add one in Art and Audio Forge (Day 147).', { record: 'world', field: at }));
        if (q.weather && !wth[q.weather]) broken('world', at + '.weather', q.weather, 'weather state');
        if (fire(q)) used.battle = true;
      });
      (z.bosses || []).forEach(function (x, k) {
        var at = 'zones.bosses[' + k + ']';
        need('world', at + '.map', x.map, 'map');
        if (x.site) need('world', at + '.site', x.site, 'site');
        if (x.troop) { needTroop('world', at + '.troop', x.troop); used.boss = true; }
        if (x.background && !bg[x.background]) broken('world', at + '.background', x.background, 'battle background');
        if (!x.background && x.troop) out.push(ckItem('refs', 'no-background', 'error', 'The ' + x.role + ' on ' + x.map + ' has no battle background. Add an interior:dungeon background in Art and Audio Forge (Day 147).', { record: 'world', field: at }));
      });
      if (!keys(wth).length && z.field.length) out.push(ckItem('refs', 'no-weather', 'warning', 'The rules hold no weather states, so every zone plays under no weather.', { record: 'world', field: 'zones' }));
      each(z.givers || {}, function (n, q) { if (!sdq[q]) broken('world', 'zones.givers.' + q, q, 'side quest'); need('world', 'zones.givers.' + q, n, 'person'); });
    }
    var gr = spec.graph;
    if (gr && Array.isArray(gr.nodes)) {
      (gr.chapters || []).forEach(function (c, k) { needChapter('world', 'progression.chapters[' + k + ']', c); });
      gr.nodes.forEach(function (nd) { if (nd.troop) needTroop('world', 'progression.' + nd.key + '.troop', nd.troop); if (nd.record) need('world', 'progression.' + nd.key, nd.record, 'site'); });
    }
    // Music the world plays: each continent's field theme, towns, dungeons, random battles, and bosses.
    function role(r, why) { if (!mus[r]) out.push(ckItem('refs', 'no-music', 'error', 'The world plays music role ' + r + ' ' + why + ', but no music track has that role. Add it in Art and Audio Forge (Day 147).', { record: 'world', field: 'music', id: r })); }
    keys(used.field).forEach(function (c) { role('music:field:' + c, 'on continent ' + c); });
    if (used.town) role('music:town', 'in towns');
    if (used.dungeon) role('music:dungeon', 'in dungeons and caves');
    if (used.battle) role('music:battle', 'in random battles');
    if (used.boss) role('music:boss', 'in boss battles');
    return { ok: !out.some(function (p) { return p.level !== 'warning'; }), problems: out, used: { town: used.town, dungeon: used.dungeon, battle: used.battle, boss: used.boss, field: keys(used.field) } };
  }

  W.checks = { progression: ckProgression, flags: ckFlags, refs: ckRefs, reach: ckReach, landable: ckLandable };

  // ---------------------------------------------------------------- bake (Phase 8)
  // An optional cache of built tile layers, so Day 150 can draw a map without generating it. Every map stays the product
  // of its seed: the bake is only ever a copy, and it is used only when it provably is one.
  //
  // bake.encode(maps, version) -> baked. maps: [{id, w, h, ground, deco, paramHash}] (any order; they are stored by ID).
  //   baked = {format: 'rle1', generatorVersion, palette [ref], maps {id: {w, h, paramHash, cells, ground, deco}}}.
  //   The palette lists every tile ref the maps use, sorted, once; a layer is a run length string over palette codes,
  //   code 0 for an empty cell and n for palette[n - 1], each run 'c' or 'c*len' in base 36 joined by '.'. cells is the
  //   digest of both layers as refs, so a decoded map is checked against what was baked, cell by cell.
  // bake.decode(baked, id, want) -> {w, h, ground, deco} or null. want = {paramHash, generatorVersion}. Null unless the
  //   format is known, the generator version equals want.generatorVersion (default this engine's version), the entry's
  //   paramHash equals want.paramHash, both layers decode to w * h cells, and the cells digest agrees. bake.why(...) takes
  //   the same arguments and names the first reason a decode would refuse, or null.
  // bake.load(bundle, mapId) -> the decoded map or null: reads bundle.world.baked and the map_ record's paramHash, so the
  //   caller (Day 150) regenerates from the seed whenever this returns null.
  var BAKE_FORMAT = 'rle1';
  function bakeCells(ground, deco) {
    var parts = [], n = ground.length;
    for (var i = 0; i < n; i++) parts.push((ground[i] || '-') + '|' + (deco[i] || '-'));
    return digest(parts);
  }
  function rleEncode(layer, code) {
    var out = [], n = layer.length, i = 0;
    while (i < n) {
      var c = layer[i] ? code[layer[i]] : 0, j = i + 1;
      while (j < n && (layer[j] ? code[layer[j]] : 0) === c) j++;
      out.push(c.toString(36) + (j - i > 1 ? '*' + (j - i).toString(36) : ''));
      i = j;
    }
    return out.join('.');
  }
  function rleDecode(text, palette, n) {
    var out = [], runs = text ? String(text).split('.') : [];
    for (var r = 0; r < runs.length; r++) {
      var p = runs[r].split('*'), c = parseInt(p[0], 36), len = p.length > 1 ? parseInt(p[1], 36) : 1;
      if (!(c >= 0) || !(len >= 1) || c > palette.length || out.length + len > n) return null;
      var v = c ? palette[c - 1] : null;
      for (var q = 0; q < len; q++) out.push(v);
    }
    return out.length === n ? out : null;
  }
  function bakeEncode(maps, version) {
    var seen = {}, byId = {};
    (maps || []).forEach(function (m) {
      byId[m.id] = m;
      for (var i = 0; i < m.ground.length; i++) { if (m.ground[i]) seen[m.ground[i]] = 1; if (m.deco[i]) seen[m.deco[i]] = 1; }
    });
    var palette = keys(seen), code = {}, out = {};
    palette.forEach(function (ref, k) { code[ref] = k + 1; });
    each(byId, function (m, id) {
      out[id] = { w: m.w, h: m.h, paramHash: m.paramHash, cells: bakeCells(m.ground, m.deco), ground: rleEncode(m.ground, code), deco: rleEncode(m.deco, code) };
    });
    return { format: BAKE_FORMAT, generatorVersion: version || W.version, palette: palette, maps: out };
  }
  function bakeWhy(baked, id, want) {
    want = want || {};
    if (!baked || typeof baked !== 'object' || !baked.maps) return 'Nothing is baked.';
    if (baked.format !== BAKE_FORMAT) return 'The bake format ' + baked.format + ' is not ' + BAKE_FORMAT + '.';
    var ver = want.generatorVersion || W.version;
    if (baked.generatorVersion !== ver) return 'The bake was made by generator ' + baked.generatorVersion + ', not ' + ver + '.';
    var e = baked.maps[id];
    if (!e) return 'Map ' + id + ' is not baked.';
    if (!want.paramHash || e.paramHash !== want.paramHash) return 'Map ' + id + ' was baked from other parameters than it has now.';
    var n = (e.w | 0) * (e.h | 0), pal = Array.isArray(baked.palette) ? baked.palette : [];
    var g = rleDecode(e.ground, pal, n), d = g && rleDecode(e.deco, pal, n);
    if (!g || !d) return 'Map ' + id + ' does not decode to ' + e.w + ' by ' + e.h + ' cells.';
    if (bakeCells(g, d) !== e.cells) return 'Map ' + id + ' does not decode to the cells that were baked.';
    return null;
  }
  function bakeDecode(baked, id, want) {
    if (bakeWhy(baked, id, want)) return null;
    var e = baked.maps[id], n = e.w * e.h;
    return { id: id, w: e.w, h: e.h, paramHash: e.paramHash, ground: rleDecode(e.ground, baked.palette, n), deco: rleDecode(e.deco, baked.palette, n), baked: true };
  }
  function bakeLoad(bundle, mapId) {
    var w = bundle && bundle.world, rec = w && w.records && w.records.map_ && w.records.map_[mapId];
    if (!rec) return null;
    return bakeDecode(w.baked, mapId, { paramHash: rec.paramHash, generatorVersion: W.version });
  }
  W.bake = { FORMAT: BAKE_FORMAT, encode: bakeEncode, decode: bakeDecode, why: bakeWhy, load: bakeLoad, cells: bakeCells };

  // ---------------------------------------------------------------- later phases insert sections above this line
  function freeze(o) { Object.freeze(o); keys(o).forEach(function (k) { var v = o[k]; if (v && (typeof v === 'object' || typeof v === 'function') && !Object.isFrozen(v)) freeze(v); }); return o; }
  return freeze(W);
})();
// === ENGINE:WORLD END ===
