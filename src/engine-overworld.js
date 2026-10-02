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
