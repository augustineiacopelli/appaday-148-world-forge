// Phase 1 acceptance: the deterministic core in ENGINE:WORLD. Seeded generators, string hashing for sub seeds, sorted
// iteration, seeded simplex noise, fractal octaves, quantizing to five bands, seed independent IDs, and the climate
// table cached from the render engine's own matchClimate. Identical seeds must give identical output in two separate
// vm contexts (and in the page), different seeds must differ, and a static scan keeps the fence free of Math.random,
// for in, unsorted Object.keys, host globals, and transcendental Math whose last bits can vary between browsers.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { boot148, ROOT, wait } = require('./world');
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); }
const OUT = path.join(__dirname, 'out');
const engFile = fs.readFileSync(path.join(ROOT, 'engine-world.js'), 'utf8');
const renderFile = fs.readFileSync(path.join(ROOT, 'engine-render.js'), 'utf8');
const demo = JSON.parse(fs.readFileSync(path.join(OUT, 'demo147-bundle.json'), 'utf8'));
const four = JSON.parse(fs.readFileSync(path.join(OUT, 'four147-bundle.json'), 'utf8'));

function context(withRender) {
  const box = vm.createContext({});
  if (withRender) vm.runInContext(renderFile, box, { filename: 'engine-render.js' });
  vm.runInContext(engFile, box, { filename: 'engine-world.js' });
  return box;
}
// Everything the core can produce for one seed, reduced to digests. Runs inside a context so nothing is shared.
const PROBE = `(function (seed) {
  var W = ENGINE_WORLD, D = W.util.digest, out = {};
  var r = W.rng(seed), draws = []; for (var i = 0; i < 2000; i++) draws.push(r());
  out.rng = D(draws);
  var r2 = W.rng(seed); out.helpers = D([r2.int(10), r2.range(3, 9), r2.float(-2, 2), r2.chance(0.5) ? 1 : 0, r2.pick(['a', 'b', 'c']), r2.weighted([5, 5, 5, 1])].concat(r2.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])));
  out.hash = D(['', 'a', 'map|overworld', 'dgn|ch2|boss', seed + ''].map(W.hash.str));
  out.sub = D(['map|overworld', 'twn|chp_x|start', 'dgn|chp_x|boss'].map(function (k) { return W.hash.seed(seed, k); }));
  var g = W.noise.simplex(seed), pts = [];
  for (var y = 0; y < 40; y++) for (var x = 0; x < 40; x++) pts.push(g.noise2(x * 0.173 - 3.1, y * 0.211 + 7.7));
  out.simplex = D(pts);
  var f = W.noise.field(64, 48, seed, { octaves: 5, lacunarity: 2, gain: 0.5, scale: 18 });
  out.fbm = D(f);
  out.ridge = D(W.noise.field(64, 48, W.hash.seed(seed, 'ridge'), { octaves: 4, scale: 12, ridge: true }));
  var th = W.quantize.quantile(f, [0.2, 0.4, 0.6, 0.8]);
  out.thresholds = D(th);
  out.bands = D(W.quantize.bands(f, th));
  out.norm = D(W.quantize.normalize(f));
  return out;
})`;
function probe(box, seed) { return vm.runInContext(PROBE, box)(seed); }

(async () => {
  // 0. Static scan of the fence (comments stripped, so the rules may be written down in prose).
  const fence = engFile.slice(engFile.indexOf('// === ENGINE:WORLD BEGIN ==='));
  const code = fence.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  check('no Math.random in ENGINE:WORLD', !/Math\.random/.test(code));
  check('no for in loops in ENGINE:WORLD', !/for\s*\([^;)]*\bin\b/.test(code), (code.match(/for\s*\([^;)]*\bin\b[^)]*\)/g) || []).slice(0, 3));
  const ok = (code.match(/Object\.keys\([^)]*\)/g) || []).length, sorted = (code.match(/Object\.keys\([^)]*\)\.sort\(\)/g) || []).length;
  check('every Object.keys is sorted, and it appears only in the keys helper', ok === sorted && ok === 1, { all: ok, sorted });
  check('no host globals (window, document, self, globalThis, Kit, WORLD, ENGINE_RENDER, ENGINE_AUDIO, localStorage)', !/\b(window|document|globalThis|localStorage|Kit|WORLD|ENGINE_RENDER|ENGINE_AUDIO)\b|\bself\./.test(code), (code.match(/\b(window|document|globalThis|localStorage|Kit|WORLD|ENGINE_RENDER|ENGINE_AUDIO)\b/g) || []).slice(0, 5));
  check('no transcendental Math (sin, cos, tan, asin, acos, atan, exp, log, pow, hypot, cbrt)', !/Math\.(sin|cos|tan|asin|acos|atan2?|exp|expm1|log|log2|log10|log1p|pow|hypot|cbrt|sinh|cosh|tanh)\b/.test(code));
  check('no Date or performance clocks', !/\bDate\b|performance\./.test(code));

  // 1. Two separate contexts, same seeds, identical output; and the page agrees.
  const A = context(false), B = context(false);
  const seeds = [0, 1, 42, 148, 4294967295, 2654435769];
  const same = seeds.map((s) => JSON.stringify(probe(A, s)) === JSON.stringify(probe(B, s)));
  check('identical output for identical seeds across two vm contexts (rng, helpers, hashes, sub seeds, simplex, fbm, ridge, thresholds, bands)', same.every(Boolean), same);
  const { win, errors } = await boot148();
  const inPage = win.eval(PROBE)(42);
  check('the page computes the same digests as a bare vm context', JSON.stringify(inPage) === JSON.stringify(probe(A, 42)) && !errors.length, errors.slice(0, 2));
  const p42 = probe(A, 42), p43 = probe(A, 43);
  const differ = Object.keys(p42).filter((k) => p42[k] === p43[k]);
  check('different seeds give different output in every probe', !differ.length, differ);
  const W = A.ENGINE_WORLD;
  check('sub seeds: same master and key agree; the key or the master changes them', W.hash.seed(7, 'map|overworld') === W.hash.seed(7, 'map|overworld') && W.hash.seed(7, 'map|overworld') !== W.hash.seed(8, 'map|overworld') && W.hash.seed(7, 'map|overworld') !== W.hash.seed(7, 'map|ch1'));
  check('engine is frozen, version 1.0.0, one global', Object.isFrozen(W) && Object.isFrozen(W.noise) && W.version === '1.0.0' && Object.keys(A).join() === 'ENGINE_WORLD');

  // 2. Generators behave.
  const r = W.rng(99), buckets = new Array(10).fill(0); let lo = 1, hi = 0;
  for (let i = 0; i < 50000; i++) { const v = r(); buckets[Math.floor(v * 10)]++; if (v < lo) lo = v; if (v > hi) hi = v; }
  check('mulberry32 stays in [0, 1) and fills ten buckets evenly (within 4 percent)', lo >= 0 && hi < 1 && buckets.every((n) => Math.abs(n - 5000) < 200), buckets);
  const r3 = W.rng(5);
  const ints = Array.from({ length: 2000 }, () => r3.range(2, 6));
  const sh = r3.shuffle([...Array(20).keys()]);
  check('rng.range is inclusive and complete; shuffle is a permutation on a copy', Math.min(...ints) === 2 && Math.max(...ints) === 6 && new Set(ints).size === 5 && sh.slice().sort((a, b) => a - b).join() === [...Array(20).keys()].join() && sh.join() !== [...Array(20).keys()].join());
  const wc = [0, 0, 0, 0], r4 = W.rng(11);
  for (let i = 0; i < 16000; i++) wc[r4.weighted([5, 5, 5, 1])]++;
  check('weighted picks follow 5, 5, 5, 1 (FF6 sixteenths) within 5 percent', wc.every((n, i) => Math.abs(n / 16000 - [5, 5, 5, 1][i] / 16) < 0.05 * [5, 5, 5, 1][i] / 16 + 0.01) && W.rng(1).weighted([0, 0]) === -1, wc);
  const g = W.noise.simplex(3); let smin = 9, smax = -9, ssum = 0, n = 0;
  for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) { const v = g.noise2(x * 0.0937, y * 0.0811); smin = Math.min(smin, v); smax = Math.max(smax, v); ssum += v; n++; }
  check('simplex stays inside [-1, 1], spans most of it, and centers near 0', smin >= -1 && smax <= 1 && smin < -0.75 && smax > 0.75 && Math.abs(ssum / n) < 0.05, { smin, smax, mean: ssum / n });
  check('simplex is continuous (neighboring samples a hundredth apart differ by under 0.1)', (() => { for (let i = 0; i < 2000; i++) { const x = i * 0.37, y = i * 0.11; if (Math.abs(g.noise2(x, y) - g.noise2(x + 0.01, y)) > 0.1) return false; } return true; })());
  const f = W.noise.field(96, 96, 7, { octaves: 5, scale: 24 }), rg = W.noise.field(96, 96, 7, { octaves: 4, scale: 24, ridge: true });
  check('fbm field stays in [-1, 1]; ridge field stays in [0, 1]', Math.min(...f) >= -1 && Math.max(...f) <= 1 && Math.min(...rg) >= 0 && Math.max(...rg) <= 1, { f: [Math.min(...f), Math.max(...f)], rg: [Math.min(...rg), Math.max(...rg)] });
  const o1 = W.noise.field(32, 32, 7, { octaves: 1, scale: 24 }), o5 = W.noise.field(32, 32, 7, { octaves: 5, scale: 24 });
  check('octaves add detail: the 5 octave field differs from the 1 octave field, lacunarity and gain change it again', W.util.digest(o1) !== W.util.digest(o5) && W.util.digest(W.noise.field(32, 32, 7, { octaves: 5, scale: 24, lacunarity: 3 })) !== W.util.digest(o5) && W.util.digest(W.noise.field(32, 32, 7, { octaves: 5, scale: 24, gain: 0.7 })) !== W.util.digest(o5));
  // Quantizing.
  check('band() counts the thresholds reached: 0 to 4, monotone', [-1, 0.1, 0.2, 0.39, 0.4, 0.6, 0.8, 5].map((v) => W.quantize.band(v, [0.2, 0.4, 0.6, 0.8])).join() === '0,0,1,1,2,3,4,4');
  const th = W.quantize.quantile(f, [0.2, 0.4, 0.6, 0.8]), bd = W.quantize.bands(f, th), share = [0, 0, 0, 0, 0];
  bd.forEach((v) => share[v]++);
  check('quantile cut points split a field into five near equal bands', share.every((c) => Math.abs(c / bd.length - 0.2) < 0.01), share.map((c) => (c / bd.length).toFixed(3)));
  const nm = W.quantize.normalize(f);
  check('normalize maps a field onto [0, 1]; a flat field becomes zeros', Math.min(...nm) === 0 && Math.max(...nm) === 1 && W.quantize.normalize([3, 3, 3]).every((v) => v === 0));
  // Sorted iteration.
  const seen = []; W.util.each({ b: 2, a: 1, c: 3 }, (v, k) => seen.push(k));
  check('util.keys and util.each walk keys in sorted order', W.util.keys({ z: 1, a: 1, m: 1 }).join() === 'a,m,z' && seen.join() === 'a,b,c' && W.util.keys(null).length === 0);

  // 3. Seed independent IDs.
  const RE = /^[a-z]{3}_[a-z0-9_]*[a-z0-9]$/, rk = W.rng(8), weird = [];
  for (let i = 0; i < 1500; i++) { let s = ''; const len = rk.range(0, 30); for (let j = 0; j < len; j++) s += String.fromCharCode(rk.range(32, 126)); weird.push(s); }
  const ids = weird.map((k, i) => W.ids.structural(['map', 'reg_', 'npc', 'twn_', 'dgn'][i % 5], k));
  check('structural IDs match KIT:CORE ID_RE for 1500 arbitrary keys (empty, symbols, long)', ids.every((x) => RE.test(x)), ids.filter((x) => !RE.test(x)).slice(0, 3));
  check('structural IDs depend only on prefix and key', W.ids.structural('twn_', 'twn|chp_a|start') === context(false).ENGINE_WORLD.ids.structural('twn', 'twn|chp_a|start') && W.ids.structural('twn_', 'twn|chp_a|start') !== W.ids.structural('dgn_', 'twn|chp_a|start'));
  let refused = null; try { W.ids.structural('chr_', 'x'); } catch (e) { refused = e.message; }
  check('structural IDs refuse a prefix outside world', /Not a world prefix/.test(refused || ''), refused);
  const keysFour = [];
  four.charter.sections.chapters.forEach((c) => ['start', 'key', 'lock', 'boss', 'exit', 'cave1', 'town2'].forEach((role) => keysFour.push('dgn|' + c.id + '|' + role)));
  const idsFour = keysFour.map((k) => W.ids.structural('dgn', k));
  check('no ID collisions across every structural key of the four continent fixture', new Set(idsFour).size === keysFour.length);

  // 4. The climate table is matchClimate, cached.
  const C1 = context(true), C2 = context(true);
  check('climate.table refuses to run without the render engine passed in', (() => { try { C1.ENGINE_WORLD.climate.table(demo.art); return false; } catch (e) { return /needs the render engine/.test(e.message); } })());
  const T1 = C1.ENGINE_WORLD.climate.table(demo.art, C1.ENGINE_RENDER), T2 = C2.ENGINE_WORLD.climate.table(demo.art, C2.ENGINE_RENDER);
  check('climate table: 125 cells, identical in two contexts', T1.cells.length === 125 && T1.exact.length === 125 && JSON.stringify(T1) === JSON.stringify(T2), T1.digest + ' ' + T2.digest);
  const ER = C1.ENGINE_RENDER, til = demo.art.records.til_, order = ER.tiles.prioList(demo.art), tils = order.map((id) => til[id]);
  let mism = 0;
  for (let t = 0; t < 5; t++) for (let m = 0; m < 5; m++) for (let e = 0; e < 5; e++) {
    const want = ER.tiles.matchClimate(tils, t, m, e);
    if ((want ? want.id : null) !== T1.cells[t * 25 + m * 5 + e] || C1.ENGINE_WORLD.climate.lookup(T1, t, m, e) !== T1.cells[t * 25 + m * 5 + e]) mism++;
  }
  check('every cell equals ENGINE_RENDER.tiles.matchClimate over the biomes in prioList order', !mism && JSON.stringify(T1.order) === JSON.stringify(order), mism);
  const keyOf = (id) => til[id].key;
  check('default biomes: 109 exact, 16 nearest, as Day 147 reported', T1.exactCount === 109 && T1.nearestCount === 16, { exact: T1.exactCount });
  check('volcanic is listed as a feature biome and never fills a cell', T1.features.length === 1 && T1.features[0].key === 'volcanic' && T1.cells.every((id) => keyOf(id) !== 'volcanic'), T1.features);
  // Elevation 4 at temperature 0 is snowfield, not mountain: the snow box (one temperature step, elevation 2 to 4) is
  // tighter than the mountain box, and snowfield is passable. Phase 3 must place walls with the mountain biome directly.
  check('elevation 0 is ocean everywhere; elevation 4 is mountains except snowfield at temperature 0', [0, 1, 2, 3, 4].every((t) => [0, 1, 2, 3, 4].every((m) => keyOf(T1.cells[t * 25 + m * 5]) === 'ocean' && keyOf(T1.cells[t * 25 + m * 5 + 4]) === (t === 0 ? 'snow' : 'mountain'))));
  const nearKeys = T1.cells.map((id, i) => T1.exact[i] ? null : keyOf(id) + '@' + Math.floor(i / 25) + Math.floor(i / 5) % 5 + (i % 5)).filter(Boolean);
  // The engine is the authority: change a box in the art and the table follows.
  const art2 = JSON.parse(JSON.stringify(demo.art));
  const grass = Object.values(art2.records.til_).find((t) => t.key === 'grassland');
  grass.climate.temp = [0, 4]; grass.climate.moist = [0, 4]; grass.climate.elev = [1, 3];
  const T3 = C1.ENGINE_WORLD.climate.table(art2, C1.ENGINE_RENDER);
  check('editing a biome box in the art changes the table (the render engine stays authoritative)', T3.digest !== T1.digest && T3.exactCount === 125 && T3.cells.filter((id) => id === grass.id).length > T1.cells.filter((id) => id === grass.id).length, { exact: T3.exactCount });
  const art3 = JSON.parse(JSON.stringify(demo.art)); Object.keys(art3.records.til_).forEach((k) => { if (art3.records.til_[k].key === 'forest') delete art3.records.til_[k]; });
  const T4 = C1.ENGINE_WORLD.climate.table(art3, C1.ENGINE_RENDER);
  check('a deleted biome falls back to the nearest box, never to nothing', T4.cells.every(Boolean) && T4.order.length === 11, T4.order.length);
  const T5 = C1.ENGINE_WORLD.climate.table(four.art, C1.ENGINE_RENDER);
  check('the four continent fixture resolves every cell to the same biome keys as the demo (same boxes, same order)', JSON.stringify(T5.cells.map((id) => four.art.records.til_[id].key)) === JSON.stringify(T1.cells.map(keyOf)));
  const pageTable = win.ENGINE_WORLD.climate.table(win.WORLD_DEMO.fixture('demo').art, win.ENGINE_RENDER);
  check('the page builds the same table from the vendored render engine', JSON.stringify(pageTable) === JSON.stringify(T1));

  // 5. Speed: a full 256 by 256 overworld layer.
  const t0 = process.hrtime.bigint();
  W.noise.field(256, 256, 1, { octaves: 5, scale: 28 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const t1 = process.hrtime.bigint();
  for (let i = 0; i < 20; i++) C1.ENGINE_WORLD.climate.table(demo.art, C1.ENGINE_RENDER);
  const cms = Number(process.hrtime.bigint() - t1) / 1e6 / 20;
  check('a 256 by 256 five octave field takes under 400 ms here; the climate table under 20 ms', ms < 400 && cms < 20, { fieldMs: ms.toFixed(1), tableMs: cms.toFixed(2) });

  const pass = results.filter((x) => x.ok).length;
  results.forEach((x) => console.log((x.ok ? 'PASS ' : 'FAIL ') + x.name + (x.ok ? '' : '  ' + String(JSON.stringify(x.detail)).slice(0, 600))));
  console.log('\nNearest cells (biome@temp moist elev):', nearKeys.join(' '));
  console.log('256x256 field ' + ms.toFixed(1) + ' ms; climate table ' + cms.toFixed(2) + ' ms; seed 42 digests ' + JSON.stringify(p42));
  console.log('\n' + pass + ' of ' + results.length + ' passed');
  fs.writeFileSync(path.join(OUT, 'phase1-report.json'), JSON.stringify({ results, nearest: nearKeys, fieldMs: ms, tableMs: cms, digests42: p42 }, null, 2));
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
