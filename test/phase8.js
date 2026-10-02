// Phase 8 tests: export and ship, and the definition of done for Day 148.
// 1. The bake engine on its own: run length round trip, one sorted palette, identical bytes in two vm contexts, and every
//    reason a decode refuses (format, generator version, parameters, length, cells).
// 2. The page, for the demo and the four continent fixture: the bundle imports cleanly; one seed grows an identical world
//    in two separate pages; every map renders (every ref resolves) and flags correctly; every check passes; prior
//    namespaces are unchanged (the side quest givers aside); the bake toggle never makes anything stale; a Final export
//    with baking on carries a bake that matches every map, and with baking off carries none; the manifest names the bake
//    and has nothing unresolved; the exported engine-world.js is the repository's file under its hash line.
// 3. Day 150's reading: a fresh vm context holding only the exported engine-world.js and engine-render.js and the Final
//    bundle regenerates every map from the seed with the record's digest, and bake.load returns the same cells.
// 4. Days 146 and 147 open both Final bundles with every namespace identical, 0 errors, 0 broken references.
// Run from test/.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { boot148, wait } = require('./world');
const { in146, in147 } = require('./compat');
const { worldFor, context, fixture, ROOT, OUT } = require('./worldspec');
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); }
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const PRIOR = ['charter', 'codex', 'rules', 'art'];
const noGivers = (r) => { const c = JSON.parse(JSON.stringify(r)); Object.keys(c.sdq_ || {}).forEach((k) => { delete c.sdq_[k].giver; }); return c; };
const timings = {};

// A whole world in a page: load the fixture, set the seed, generate everything. Returns the page and its bundle.
async function grow(key, seed, bake) {
  const page = await boot148();
  const { WORLD, Kit } = page.win;
  WORLD.loadFixture(key); await wait(20);
  const b = Kit.bundle.current(), orig = JSON.parse(JSON.stringify(b));
  b.world.seed = seed;
  if (bake) WORLD.bake.set(b, true);
  const t0 = Date.now();
  WORLD.zones.apply();
  timings[key + '-generate-ms'] = Date.now() - t0;
  return { page, WORLD, Kit, b, orig };
}
// Day 150's reading of an exported bundle: nothing but the two engine files and the JSON.
function day150(engineText, bundle) {
  const box = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'engine-render.js'), 'utf8'), box);
  vm.runInContext(engineText, box, { filename: 'engine-world.js' });
  const ctx = { E: box.ENGINE_WORLD, R: box.ENGINE_RENDER };
  const W = worldFor(ctx, bundle, bundle.world.seed, bundle.world.settings);
  return { ctx, W };
}

(async () => {
  // ---------------------------------------------------------------- 1. the bake engine
  const C1 = context(), C2 = context(), demo = fixture('demo');
  const A = worldFor(C1, demo, 42, {}), B = worldFor(C2, demo, 42, {});
  const mapsOf = (W) => [{ id: 'map_ow', w: W.ow.w, h: W.ow.h, ground: W.ow.ground, deco: W.ow.deco, paramHash: 'h-ow' }].concat(W.sites.reduce((a, x) => a.concat(x.site.floors.map((fl) => ({ id: 'map_' + x.s.key.replace(/[^a-z0-9]+/g, '_') + '_' + fl.floor, w: fl.w, h: fl.h, ground: fl.ground, deco: fl.deco, paramHash: 'h-' + x.s.key + fl.floor }))), []));
  const mA = mapsOf(A), kA = C1.E.bake.encode(mA), kB = C2.E.bake.encode(mapsOf(B));
  check('ENGINE_WORLD.bake is exported, frozen, and format rle1', C1.E.bake && Object.isFrozen(C1.E.bake) && C1.E.bake.FORMAT === 'rle1' && kA.format === 'rle1' && kA.generatorVersion === C1.E.version);
  check('the same world bakes the same bytes in two vm contexts', JSON.stringify(kA) === JSON.stringify(kB), JSON.stringify(kA).length);
  const pal = kA.palette;
  check('one palette, sorted, each ref once, holding every ref the maps use', pal.every((r, i) => !i || pal[i - 1] < r) && new Set(pal).size === pal.length &&
    mA.every((m) => m.ground.concat(m.deco).every((r) => !r || pal.indexOf(r) >= 0)));
  let rt = 0;
  mA.forEach((m) => { const d = C2.E.bake.decode(kA, m.id, { paramHash: m.paramHash }); if (d && d.w === m.w && d.h === m.h && canon(d.ground) === canon(m.ground.map((x) => x || null)) && canon(d.deco) === canon(m.deco.map((x) => x || null))) rt++; });
  check('every map decodes cell for cell (decoded in the other context)', rt === mA.length, { rt, of: mA.length });
  const rawOw = mA[0].w * mA[0].h * 2, ow0 = kA.maps.map_ow;
  check('run length encoding is compact: the overworld\'s two layers take far fewer runs than cells', ow0.ground.split('.').length + ow0.deco.split('.').length < rawOw / 4, { runs: ow0.ground.split('.').length + ow0.deco.split('.').length, cells: rawOw });
  const E = C1.E, id0 = 'map_ow';
  const bad = (k, want) => E.bake.decode(k, id0, want) === null && typeof E.bake.why(k, id0, want) === 'string';
  const clone = () => JSON.parse(JSON.stringify(kA));
  const kF = clone(); kF.format = 'rle0';
  const kV = clone(); kV.generatorVersion = '0.9.0';
  const kL = clone(); kL.maps[id0].w += 1;
  const kC = clone(); kC.maps[id0].cells = 'deadbeef:1';
  const kG = clone(); const runs = kG.maps[id0].ground.split('.'); const ri = runs.findIndex((r) => !/\*/.test(r)); runs[ri] = runs[ri] === '1' ? '2' : '1'; kG.maps[id0].ground = runs.join('.');
  check('decode refuses an unknown format, another generator version, other parameters, a wrong size, a cells digest that disagrees, and a corrupted run',
    bad(kF, { paramHash: 'h-ow' }) && bad(kV, { paramHash: 'h-ow' }) && bad(kA, { paramHash: 'h-other' }) && bad(kA, {}) && bad(kL, { paramHash: 'h-ow' }) && bad(kC, { paramHash: 'h-ow' }) && bad(kG, { paramHash: 'h-ow' }) &&
    E.bake.decode(kA, 'map_nope', { paramHash: 'x' }) === null && E.bake.decode(null, id0, { paramHash: 'h-ow' }) === null && E.bake.why(kA, id0, { paramHash: 'h-ow' }) === null,
    [E.bake.why(kF, id0, { paramHash: 'h-ow' }), E.bake.why(kV, id0, { paramHash: 'h-ow' }), E.bake.why(kG, id0, { paramHash: 'h-ow' })]);
  check('a version named by the caller is honored (Day 150 can pin the version it ships)', E.bake.decode(kV, id0, { paramHash: 'h-ow', generatorVersion: '0.9.0' }) !== null);
  const fakeB = { world: { baked: kA, records: { map_: { map_ow: { id: 'map_ow', paramHash: 'h-ow' } } } } };
  check('bake.load reads a bundle: the map when the record\'s paramHash matches, null when it does not or the record is gone',
    E.bake.load(fakeB, 'map_ow') && E.bake.load(fakeB, 'map_ow').baked === true && (fakeB.world.records.map_.map_ow.paramHash = 'h2', E.bake.load(fakeB, 'map_ow') === null) && E.bake.load(fakeB, 'map_gone') === null && E.bake.load({}, 'map_ow') === null);
  const eng = fs.readFileSync(path.join(ROOT, 'engine-world.js'), 'utf8'), fenceSrc = eng.slice(eng.indexOf('// === ENGINE:WORLD BEGIN ==='));
  const bakeSrc = fenceSrc.slice(fenceSrc.indexOf('// ---------------------------------------------------------------- bake (Phase 8)'), fenceSrc.indexOf('// ---------------------------------------------------------------- later phases'));
  check('the bake section keeps the determinism rules: no Math.random, no for in, no Object.keys, no host global', bakeSrc.length > 500 && !/Math\.random|for \(var \w+ in |Object\.keys|window\.|document\.|localStorage/.test(bakeSrc));

  // ---------------------------------------------------------------- 2. the page
  const out = {};
  for (const key of ['demo', 'four']) {
    const G = await grow(key, 42, true), { WORLD, Kit, b, orig, page } = G;
    const H = await grow(key, 42, true);
    check(key + ': the fixture imports cleanly (ready, no errors before generation)', WORLD.readiness(H.b) === true && !page.errors.length);
    check(key + ': one seed grows an identical world in two separate pages (records, progression, zones)',
      canon(b.world.records) === canon(H.b.world.records) && canon(b.world.progression) === canon(H.b.world.progression) && canon(b.world.zones) === canon(H.b.world.zones));
    H.page.win.close();
    const res = Kit.refreshValidation(), wk = WORLD.checks.walks(b);
    check(key + ': every check passes (0 errors, 0 broken, progression and flags proven, no Final block)', !res.errors.length && !res.broken.length && wk.progression.ok && wk.flags.ok && WORLD.finalBlock(b) === null,
      { e: res.errors.slice(0, 3).map((x) => x.message), why: WORLD.finalBlock(b) });
    // Every map renders: every ref of every map resolves through the render engine.
    const R = page.win.ENGINE_RENDER, maps = WORLD.bake.collect(b), recs = WORLD.records.list('map_', b);
    let unres = 0;
    maps.forEach((m) => { for (let i = 0; i < m.ground.length; i++) { if (!m.ground[i] || !R.tiles.resolve(b.art, m.ground[i])) unres++; if (m.deco[i] && !R.tiles.resolve(b.art, m.deco[i])) unres++; } });
    check(key + ': every map record has its layers, and every ground and decoration cell resolves to a tile', maps.length === recs.length && maps.length > 10 && unres === 0, { maps: maps.length, recs: recs.length, unres });
    check(key + ': prior namespaces are unchanged, the side quest givers aside', PRIOR.filter((k) => k !== 'rules').every((k) => canon(b[k]) === canon(orig[k])) && canon(noGivers(b.rules)) === canon(noGivers(orig.rules)));
    const ph = WORLD.overworld.paramHash(b);
    WORLD.bake.set(b, false); const offStale = WORLD.overworld.stale(b) || WORLD.interiors.stale(b) || WORLD.zones.stale(b) || WORLD.progression.stale(b) || WORLD.overworld.paramHash(b) !== ph;
    WORLD.bake.set(b, true); const onStale = WORLD.overworld.stale(b) || WORLD.interiors.stale(b) || WORLD.zones.stale(b) || WORLD.progression.stale(b);
    check(key + ': turning baking off and on never makes the progression, overworld, interiors, or zones stale', !offStale && !onStale);

    // Final with baking on.
    let fin = null, err = null; try { fin = Kit.buildExport('final'); } catch (e) { err = e.message; }
    check(key + ': Final exports with baking on (bundle, manifest, engine-world.js)', fin && fin.files.length === 3 && fin.files.map((f) => f.key).join() === 'bundle,manifest,engine-world', err);
    if (!fin) continue;
    const fb = JSON.parse(fin.files[0].text), man = JSON.parse(fin.files[1].text), engOut = fin.files[2].text;
    const st = WORLD.bake.status(b);
    check(key + ': the bake holds every map, every one current, and the manifest says so', fb.world.baked.format === 'rle1' && Object.keys(fb.world.baked.maps).length === recs.length &&
      st.fresh === recs.length && !st.stale.length && man.bake && man.bake.maps === recs.length && man.bake.fresh === recs.length && man.bake.on === true, man.bake);
    let same = 0;
    maps.forEach((m) => { const r = WORLD.bake.map(m.id, b); if (r.map && canon(r.map.ground) === canon(m.ground.map((x) => x || null)) && canon(r.map.deco) === canon(m.deco.map((x) => x || null))) same++; });
    check(key + ': every baked map reads back through WORLD.bake.map equal to the generated layers', same === maps.length, { same, of: maps.length });
    check(key + ': the manifest: forge 148, the bundle hash, generator version, created IDs, nothing unresolved, validation clean, world opened',
      man.forge === 148 && man.bundleHash === fin.hash && man.generator.version === '1.0.0' && man.created.length === WORLD.count(b) && !man.unresolved.length &&
      !man.validation.errors && !man.validation.broken && man.worldOpened && man.checks.progression.ok && man.checks.flags.ok, { unresolved: man.unresolved, v: man.validation });
    check(key + ': forge stamps: 148 final, 146 and 147 untouched; world opened', fb.kit.forges['148'].status === 'final' && canon(fb.kit.forges['146']) === canon(orig.kit.forges['146']) &&
      canon(fb.kit.forges['147']) === canon(orig.kit.forges['147']) && fb.kit.opened.indexOf('world') >= 0);
    const repoEng = fs.readFileSync(path.join(ROOT, 'engine-world.js'), 'utf8');
    check(key + ': the exported engine-world.js is the repository file plus its bundle hash line', engOut === repoEng.replace(/(Reads no host global\. \*\/\n|reads no host global\. \*\/\n)/, '$1/* Bundle hash ' + fin.hash + ' */\n'));
    // Determinism of the export itself: exporting again changes nothing but the timestamps.
    const fin2 = Kit.buildExport('final'), fb2 = JSON.parse(fin2.files[0].text);
    check(key + ': exporting again bakes the same bytes and the same world', canon(fb2.world) === canon(fb.world));

    // Day 150's reading of the Final bundle.
    const t0 = Date.now(), D = day150(engOut, fb);
    timings[key + '-regenerate-ms'] = Date.now() - t0;
    const owRec = Object.values(fb.world.records.map_).find((m) => m.kind === 'overworld');
    check(key + ': a fresh context with only the exported engines regenerates the overworld from the bundle with the record\'s digest', D.W.ow.digest === owRec.digest, [D.W.ow.digest, owRec.digest]);
    let flOk = 0, flN = 0;
    D.W.sites.forEach((x) => x.site.floors.forEach((fl) => { flN++; const id = D.ctx.E.ids.structural('map_', 'map|' + x.s.key + '|' + fl.floor), r = fb.world.records.map_[id]; if (r && r.digest === fl.digest) flOk++; }));
    check(key + ': and every interior floor with its record\'s digest', flN === recs.length - 1 && flOk === flN, { flOk, flN });
    const t1 = Date.now();
    let loadOk = 0;
    Object.keys(fb.world.records.map_).sort().forEach((id) => { const m = D.ctx.E.bake.load(fb, id); if (m) loadOk++; });
    timings[key + '-bake-load-ms'] = Date.now() - t1;
    const lo = D.ctx.E.bake.load(fb, owRec.id);
    check(key + ': bake.load returns every map there, and the baked overworld equals the regenerated one', loadOk === recs.length && canon(lo.ground) === canon(D.W.ow.ground.map((x) => x || null)) && canon(lo.deco) === canon(D.W.ow.deco.map((x) => x || null)));
    const fbS = JSON.parse(JSON.stringify(fb)); fbS.world.seed = (fbS.world.seed + 1) >>> 0; fbS.world.records.map_[owRec.id].paramHash = 'changed';
    check(key + ': a bake whose map no longer matches is refused, so Day 150 regenerates', D.ctx.E.bake.load(fbS, owRec.id) === null);

    // Days 146 and 147 open the baked Final.
    const f146 = await in146(fin.files[0].text, (w, K, rr) => ({ fwd: rr.forward.length, diff: PRIOR.concat(['world']).filter((k) => canon(K.bundle.current()[k]) !== canon(fb[k])) }));
    check(key + ': Day 146 opens the baked Final with every namespace identical, 0 errors, 0 broken, 0 forward', f146.matches && !f146.diff.length && !f146.summary.errors && !f146.summary.broken && !f146.fwd, f146);
    const f147 = await in147(fin.files[0].text, (w, K) => ({ diff: PRIOR.concat(['world']).filter((k) => canon(K.bundle.current()[k]) !== canon(fb[k])) }));
    check(key + ': Day 147 opens the baked Final with every namespace identical, 0 errors, 0 broken', f147.matches && !f147.diff.length && !f147.summary.errors && !f147.summary.broken, f147.summary);

    // Baking off: the export carries no bake, and a stale bake is a warning only.
    WORLD.bake.set(b, false);
    const off = Kit.buildExport('final'), fbo = JSON.parse(off.files[0].text), mo = JSON.parse(off.files[1].text);
    check(key + ': with baking off the Final carries no bake and the manifest says off', canon(fbo.world.baked) === '{}' && mo.bake.on === false && mo.bake.maps === 0);
    const o146 = await in146(off.files[0].text, (w, K, rr) => ({ fwd: rr.forward.length }));
    check(key + ': Day 146 opens the unbaked Final with 0 errors, 0 broken, 0 forward', o146.matches && !o146.summary.errors && !o146.summary.broken && !o146.fwd);
    b.world.baked = JSON.parse(JSON.stringify(fb.world.baked)); b.world.baked.generatorVersion = '0.0.1'; WORLD.bake.set(b, true);
    let r2 = Kit.refreshValidation();
    check(key + ': a bake from another generator version is a warning that never blocks Final', r2.warnings.some((x) => x.fieldPath === 'baked' && /no longer match/.test(x.message)) && !r2.errors.length && WORLD.finalBlock(b) === null);
    Kit.buildExport('draft'); r2 = Kit.refreshValidation();
    check(key + ': the next export bakes again and the warning is gone', WORLD.bake.status(b).fresh === recs.length && !r2.warnings.some((x) => x.fieldPath === 'baked'));
    out[key] = { maps: recs.length, bakeBytes: st.bytes, bundleBytes: fin.files[0].text.length, unbakedBytes: off.files[0].text.length, palette: st.palette, size: WORLD.size(b) };
    check(key + ': the baked bundle stays under the storage budget', fin.files[0].text.length < page.win.WORLD.LIMIT * 0.9, out[key]);
    check(key + ': no page errors', !page.errors.length, page.errors.slice(0, 3));
    page.win.close();
  }

  // ---------------------------------------------------------------- 3. the Export tab
  {
    const { win, errors } = await boot148(); const { WORLD, Kit } = win;
    WORLD.loadFixture('demo'); await wait(20);
    const b = Kit.bundle.current(); b.world.seed = 42; WORLD.zones.apply();
    Kit.go('export'); await wait(40);
    const ws = win.document.getElementById('ws'), sw = Array.prototype.find.call(ws.querySelectorAll('label.switch'), (l) => /Bake the maps/.test(l.textContent));
    const note = () => (ws.querySelector('.w8-bake-note') || {}).textContent || '';
    check('Export tab: a Bake the maps switch, off by default, whose note gives the size baking would add', sw && !sw.querySelector('input').checked && /Baking is off/.test(note()) && /would add about/.test(note()), note());
    sw.querySelector('input').checked = true; sw.querySelector('input').dispatchEvent(new win.Event('change'));
    check('turning it on writes world.settings.bake and the note explains when Day 150 uses a baked map', b.world.settings.bake === true && /Baking is on/.test(note()) && /regenerates it from the seed/.test(note()));
    Kit.rerender(); await wait(30);
    const kvText = ws.textContent;
    check('the manifest preview has a Baked row', /Baked/.test(kvText) && /bakes at export/.test(kvText));
    const dl = []; win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
    const ex = WORLD.exportNow('final'); await wait(1200);
    Kit.rerender(); await wait(30);
    check('Download (Final) bakes, and the preview then counts every map current', ex && /maps current/.test(ws.textContent) && WORLD.bake.status(b).fresh === WORLD.records.list('map_', b).length);
    const real = errors.filter((e) => !/Not implemented: navigation/.test(e));
    check('no page errors on the Export tab (jsdom cannot follow a download link, which is not a page error)', !real.length, real.slice(0, 3));
    win.close();
  }

  const n = results.filter((x) => x.ok).length;
  results.forEach((x) => console.log((x.ok ? 'PASS ' : 'FAIL ') + x.name + (x.ok ? '' : '  ' + String(JSON.stringify(x.detail)).slice(0, 700))));
  console.log('sizes', JSON.stringify(out));
  console.log('timings', JSON.stringify(timings));
  fs.writeFileSync(path.join(OUT, 'phase8-report.json'), JSON.stringify({ when: new Date().toISOString(), pass: n, total: results.length, sizes: out, timings, results }, null, 2));
  console.log('\n' + n + ' of ' + results.length + ' passed');
  process.exit(n === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
