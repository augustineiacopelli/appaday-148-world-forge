// Phase 0 acceptance: scaffold and compatibility proof. Boots World Forge, checks the static contract (fences, verbatim
// KIT:CORE, vendored engines), the world skeleton and Codex types, the import gate, the export and manifest, the open
// policy with the sdq_.giver forward field, own storage keys with the IndexedDB fallback, and the round trip: a bundle
// imported here and exported as a Draft reopens in Day 146 and Day 147 with every prior namespace canonically identical
// and no new errors.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { boot148, ROOT, wait } = require('./world');
const { in146, in147, stamp } = require('./compat');
const dir147 = require('../day147');
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); }
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const PRIOR = ['charter', 'codex', 'rules', 'art'];
function sameNs(a, b, keys) { return (keys || PRIOR).filter((k) => canon(a[k]) !== canon(b[k])); }
const OUT = path.join(__dirname, 'out');
const demoText = fs.readFileSync(path.join(OUT, 'demo147-bundle.json'), 'utf8');
const fourText = fs.readFileSync(path.join(OUT, 'four147-bundle.json'), 'utf8');

(async () => {
  // 0. Static contract.
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const nonAscii = []; html.split('\n').forEach((l, i) => { if (/[^\x00-\x7e]/.test(l)) nonAscii.push(i + 1); });
  check('index.html is pure ASCII', !nonAscii.length, nonAscii.slice(0, 5));
  const s0 = html.lastIndexOf('<script>'), script = html.slice(s0 + 8, html.lastIndexOf('</script>'));
  let syntaxOk = true; try { new Function(script); } catch (e) { syntaxOk = e.message; }
  check('inline script parses', syntaxOk === true, syntaxOk);
  const fences = ['KIT:CORE', 'WORLD:STORE', 'WORLD:DEMO', 'ENGINE:WORLD', 'WS:WORLD148', 'APP:BOOT'];
  const at = fences.map((f) => script.indexOf('// === ' + f + ' BEGIN ==='));
  check('script fences in order: KIT:CORE, WORLD:STORE, WORLD:DEMO, ENGINE:WORLD, WS:WORLD148, APP:BOOT', at.every((x, i) => x >= 0 && (i === 0 || x > at[i - 1])), at);
  check('every fence opens and closes exactly once', fences.every((f) => script.split('// === ' + f + ' BEGIN ===').length === 2 && script.split('// === ' + f + ' END ===').length === 2));
  check('CSS fences KIT:CORE CSS then WORLD:SHELL CSS', html.indexOf('/* === KIT:CORE CSS BEGIN === */') >= 0 && html.indexOf('/* === WORLD:SHELL CSS BEGIN === */') > html.indexOf('/* === KIT:CORE CSS END === */'));
  const k146 = fs.readFileSync(require('../day146'), 'utf8');
  const cut = (t, a, z) => t.slice(t.indexOf(a), t.indexOf(z) + z.length);
  check('KIT:CORE JS and CSS byte for byte equal to Day 146', cut(html, '// === KIT:CORE BEGIN ===', '// === KIT:CORE END ===') === cut(k146, '// === KIT:CORE BEGIN ===', '// === KIT:CORE END ===') &&
    cut(html, '/* === KIT:CORE CSS BEGIN === */', '/* === KIT:CORE CSS END === */') === cut(k146, '/* === KIT:CORE CSS BEGIN === */', '/* === KIT:CORE CSS END === */'));
  const vend = ['engine-render.js', 'engine-audio.js'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8') === fs.readFileSync(path.join(dir147, f), 'utf8'));
  check('vendored engine-render.js and engine-audio.js byte equal to Day 147', vend.every(Boolean), vend);
  check('page loads both vendored engines by relative script tags before the inline script', /<script src="engine-render\.js"><\/script>\s*<script src="engine-audio\.js"><\/script>\s*<script>/.test(html));
  check('backlink appears in header and footer', html.split('href="https://augustineiacopelli.github.io/appaday/"').length === 3);
  check('no forbidden APIs (roundRect, ellipse, confirm, bare remove)', !/\.roundRect\(|\.ellipse\(|window\.confirm|\bconfirm\(\s*['"]|[^a-zA-Z.]remove\(\)|\)\.remove\(\)/.test(script.replace(/\/\/.*$/gm, '')));
  const engFile = fs.readFileSync(path.join(ROOT, 'engine-world.js'), 'utf8');
  const engFence = cut(script, '// === ENGINE:WORLD BEGIN ===', '// === ENGINE:WORLD END ===') + '\n';
  check('engine-world.js is the ENGINE:WORLD fence byte for byte under its header', engFile.endsWith(engFence) && /^\/\* World Forge ENGINE:WORLD, engine version 1\.0\.0\n/.test(engFile));
  const box = vm.createContext({}); let vmErr = null;
  try { vm.runInContext(engFile, box); } catch (e) { vmErr = e.message; }
  check('engine-world.js loads alone in a bare context and declares one frozen global', !vmErr && Object.keys(box).join() === 'ENGINE_WORLD' && Object.isFrozen(box.ENGINE_WORLD) && box.ENGINE_WORLD.version === '1.0.0', vmErr || Object.keys(box));

  // 1. Boot.
  let { win, errors } = await boot148();
  let Kit = win.Kit, WORLD = win.WORLD, d = win.document;
  check('boots with no page errors', !errors.length, errors.slice(0, 2));
  check('ENGINE_RENDER and ENGINE_AUDIO present from the vendored files', win.ENGINE_RENDER && win.ENGINE_RENDER.version === '1.0.0' && win.ENGINE_AUDIO && !!win.ENGINE_WORLD);
  const tabs = Array.from(d.querySelectorAll('#tabs .tab')).map((t) => t.dataset.ws + (t.classList.contains('locked') ? '(locked)' : ''));
  check('tabs mounted: start, world, sites, encounters, validation, export, dev; all but start and dev locked without a bundle', tabs.join(' ') === 'start world(locked) sites(locked) encounters(locked) validation(locked) export(locked) dev', tabs.join(' '));
  check('active tab is start', Kit.active() === 'start');
  const fresh = Kit.bundle.current().world;
  check('fresh bundle gets a world skeleton', fresh.version === '1.0.0' && fresh.generator.name === 'appaday-148-world' && fresh.generator.version === '1.0.0' && fresh.seed === fresh.seed >>> 0 &&
    ['map_', 'reg_', 'npc_', 'twn_', 'dgn_'].every((p) => fresh.records[p] && !Object.keys(fresh.records[p]).length) && ['progression', 'zones', 'overrides', 'baked'].every((k) => fresh[k] && typeof fresh[k] === 'object') &&
    fresh.settings.mapSize.base === 96 && fresh.settings.mapSize.perContinent === 32 && fresh.settings.mapSize.max === 256, fresh);
  check('five world prefixes reserved by KIT:CORE for forge 148 in namespace world', WORLD.PREFIXES.every((p) => Kit.codex.prefixInfo(p).forge === 148 && Kit.codex.prefixInfo(p).ns === 'world'));
  const sid = WORLD.envelope('dgn_', 'dgn|ch2|boss', 'Boss dungeon').id;
  check('structural IDs are valid KIT IDs and seed independent', Kit.ids.isValid(sid) && /^dgn_dgn_ch2_boss_[a-z0-9]{4}$/.test(sid) && sid === win.ENGINE_WORLD.ids.structural('dgn', 'dgn|ch2|boss'), sid);

  // 2. The import gate.
  const day146demo = JSON.parse(demoText); delete day146demo.art; day146demo.art = {}; day146demo.kit.forges = { '146': day146demo.kit.forges['146'] }; day146demo.kit.opened = ['charter', 'rules'];
  const unlocked = JSON.parse(demoText); unlocked.charter.locked = false;
  const noInterior = JSON.parse(demoText); Object.keys(noInterior.art.records.til_).forEach((k) => { if (noInterior.art.records.til_[k].kind === 'interior') delete noInterior.art.records.til_[k]; });
  const noChapters = JSON.parse(demoText); noChapters.charter.sections.chapters = [];
  const gate = (b) => { try { Kit.bundle.importText(typeof b === 'string' ? b : JSON.stringify(b)); return 'accepted'; } catch (e) { return e.message; } };
  const titleBefore = Kit.bundle.current().kit.title;
  const g = { notJson: gate('{nope'), notSaga: gate({ hello: 1 }), noArt: gate(day146demo), unlocked: gate(unlocked), noInterior: gate(noInterior), noChapters: gate(noChapters) };
  check('import refuses a Day 146 bundle without art, with a readable reason', /no Day 147 art/.test(g.noArt), g.noArt);
  check('import refuses an unlocked Charter, a bundle with no chapters, no interiors, non bundles, and bad JSON', /no locked Charter/.test(g.unlocked) && /no chapters/.test(g.noChapters) && /no interior tilesets/.test(g.noInterior) && /not a Saga Forge bundle/.test(g.notSaga) && /not valid JSON/.test(g.notJson), g);
  check('a refused import leaves the draft untouched', Kit.bundle.current().kit.title === titleBefore);
  const imp = Kit.bundle.importText(demoText);
  await wait(20);
  let b = Kit.bundle.current();
  const src = JSON.parse(demoText);
  check('a Day 147 Final export imports with its hash verified', imp.matches === true && b.kit.title === 'Demo Saga');
  check('import leaves charter, codex, rules, and art canonically identical', !sameNs(b, src).length, sameNs(b, src));
  check('import adds the world skeleton and nothing else', canon(Object.keys(b).sort()) === canon(Object.keys(src).sort()) && b.world.version === '1.0.0' && WORLD.count(b) === 0);
  let res = Kit.refreshValidation();
  check('the demo validates with no errors or broken references here', !res.errors.length && !res.broken.length, Kit.validate.summary(res));
  check('the four continent fixture imports too', gate(fourText) === 'accepted' && Kit.bundle.current().charter.sections.chapters.length === 6);
  Kit.go('start'); await wait(20);
  const startText = d.getElementById('ws').textContent;
  check('Start lists four continents, shared labels, and the chapter with no boss troop', /4 continents: Westland \(2\), Eastland \(1\), Northreach \(1\), Southmere \(2\)/.test(startText) && /The Marches.*none yet/.test(startText), startText.slice(0, 200));
  check('Start shows the climate table: 109 exact cells and 16 nearest for the default biomes', /109 of 125 climate cells/.test(startText) && /other 16 take the nearest/.test(startText) && d.querySelectorAll('.w8-cgrid span').length === 125);
  check('later tabs unlock once a ready bundle is loaded', !d.querySelectorAll('#tabs .tab.locked').length);

  // 3. Records, validation, and the open policy.
  Kit.bundle.importText(demoText); await wait(10); b = Kit.bundle.current();
  const chp = b.charter.sections.chapters[0].id;
  const twn = WORLD.records.put(WORLD.envelope('twn_', 'twn|' + chp + '|start', 'Start town', { chapter: chp, role: 'start' }));
  const npc = WORLD.records.put(WORLD.envelope('npc_', 'npc|' + chp + '|start|innkeeper', 'Innkeeper', { chapter: chp, town: twn.id, archetype: 'innkeeper' }));
  Kit.bundle.touch('test');
  let idx = Kit.index();
  check('world records are indexed by KIT:CORE', idx.byId[twn.id] && idx.byId[npc.id] && idx.byId[twn.id].path.indexOf('world.records.twn_') === 0, idx.byId[twn.id] && idx.byId[twn.id].path);
  res = Kit.refreshValidation();
  check('world records validate with the envelope types (chapter refs resolve)', !res.errors.length && !res.broken.length, Kit.validate.summary(res));
  let bad = false; try { WORLD.records.put({ id: 'chr_nope_ab12', name: 'x' }); } catch (e) { bad = true; }
  check('WORLD.records.put refuses non world prefixes', bad);
  b.world.records.twn_[twn.id].key = 'twn|something|else'; Kit.bundle.touch('test');
  res = Kit.refreshValidation();
  check('a record whose key no longer derives its ID is a warning', res.warnings.some((w) => w.recordId === twn.id && /structural key/.test(w.message)), res.warnings.map((w) => w.message));
  b.world.records.twn_[twn.id].key = 'twn|' + chp + '|start'; Kit.bundle.touch('test');

  // 4. Draft export and the manifest.
  let draft = Kit.buildExport('draft');
  let db = JSON.parse(draft.files[0].text), man = JSON.parse(draft.files[1].text);
  check('Draft export: three files (bundle, world manifest, engine-world.js)', draft.files.map((f) => f.name).join(' ') === 'demo-saga-bundle.json demo-saga-world-manifest.json engine-world.js', draft.files.map((f) => f.name));
  check('Draft stamps forge 148 and leaves forges 146 and 147 untouched', db.kit.forges['148'].status === 'draft' && db.kit.forges['148'].generatorVersion === '1.0.0' && canon(db.kit.forges['146']) === canon(src.kit.forges['146']) && canon(db.kit.forges['147']) === canon(src.kit.forges['147']), db.kit.forges);
  check('Draft leaves world out of kit.opened', db.kit.opened.join() === 'charter,rules,art', db.kit.opened);
  check('manifest hash equals the bundle hash and lists the created world IDs', man.bundleHash === db.kit.contentHash && man.forge === 148 && canon(man.created) === canon([npc.id, twn.id].sort()) && !man.unresolved.length && man.referenced.indexOf(chp) >= 0, man);
  const engOut = draft.files[2].text;
  check('exported engine-world.js is the page fence under a header carrying the bundle hash', engOut.endsWith(engFence) && engOut.indexOf('Bundle hash ' + draft.hash) > 0);
  let finalErr = null; try { Kit.buildExport('final'); } catch (e) { finalErr = e.message; }
  check('Final is refused until the world is generated, with a readable reason', /not been generated/.test(finalErr || ''), finalErr);

  // 5. Round trip into Day 146 and Day 147: prior namespaces identical, no new errors, world kept.
  const base146 = await in146(demoText), base147 = await in147(demoText);
  const draftText = draft.files[0].text;
  const r146 = await in146(draftText, (w, K) => {
    const cb = K.bundle.current();
    const out = K.buildExport('draft');
    const re = JSON.parse(out.files[0].text);
    let blocked = null; try { K.buildExport('final'); } catch (e) { blocked = e.message; }
    return { diff: sameNs(cb, db, PRIOR.concat(['world'])), reWorld: canon(re.world) === canon(db.world), reForge148: canon(re.kit.forges['148']) === canon(db.kit.forges['148']), blocked, reText: out.files[0].text };
  });
  check('Day 146 opens the 148 Draft: hash verified, prior namespaces and world identical', r146.matches && !r146.diff.length, r146.diff);
  check('Day 146 sees no new errors, broken, or forward references', canon(r146.summary) === canon(base146.summary) && canon(r146.errors) === canon(base146.errors), { now: r146.summary, before: base146.summary });
  check('Day 146 re-export keeps world and forge 148 untouched, and Day 146 Final stays allowed', r146.reWorld && r146.reForge148 && !r146.blocked, r146.blocked);
  const r147 = await in147(draftText, (w, K) => {
    const cb = K.bundle.current();
    const out = K.buildExport('draft', { engines: false });
    const re = JSON.parse(out.files[0].text);
    return { diff: sameNs(cb, db, PRIOR.concat(['world'])), reWorld: canon(re.world) === canon(db.world), reForge148: canon(re.kit.forges['148']) === canon(db.kit.forges['148']), reText: out.files[0].text, cov: w.ART.coverage.compute(cb).green };
  });
  check('Day 147 opens the 148 Draft: hash verified, prior namespaces and world identical, coverage still green', r147.matches && !r147.diff.length && r147.cov, r147.diff);
  check('Day 147 sees no new errors, broken, or forward references', canon(r147.summary) === canon(base147.summary) && canon(r147.errors) === canon(base147.errors), { now: r147.summary, before: base147.summary });
  check('Day 147 re-export keeps world and forge 148 untouched', r147.reWorld && r147.reForge148);
  // ... and back into 148 from each.
  for (const [k, t] of [['146', r146.reText], ['147', r147.reText]]) {
    const r = Kit.bundle.importText(t); await wait(10);
    const cb = Kit.bundle.current();
    check('148 reopens the Day ' + k + ' re-export: hash verified, every namespace identical to the 148 Draft', r.matches && !sameNs(cb, db, PRIOR.concat(['world'])).length && WORLD.records.get(twn.id) && WORLD.records.get(npc.id), sameNs(cb, db, PRIOR.concat(['world'])));
  }

  // 6. The forward field: sdq_.giver. Day 146 reads it as forward while world is closed.
  Kit.bundle.importText(fourText); await wait(10); b = Kit.bundle.current();
  const sdq = Object.keys(b.rules.sdq_).sort();
  const c1 = b.charter.sections.chapters[0].id;
  const giver = WORLD.records.put(WORLD.envelope('npc_', 'npc|' + c1 + '|start|elder', 'Elder', { chapter: c1, archetype: 'elder' }));
  b.rules.sdq_[sdq[0]].giver = giver.id;
  b.rules.sdq_[sdq[1]].giver = 'npc_missing_zz99';
  Kit.bundle.touch('test');
  check('forward refs: one resolving giver, one missing; world cannot open', WORLD.forwardRefs(b).map((f) => f.ok).join() === 'true,false' && !WORLD.canOpen(b));
  res = Kit.refreshValidation();
  check('with world closed both givers read as forward here, never broken', !res.broken.length && res.forward.filter((f) => f.owedBy === 148).length === 2, Kit.validate.summary(res));
  draft = Kit.buildExport('draft'); db = JSON.parse(draft.files[0].text); man = JSON.parse(draft.files[1].text);
  check('Draft keeps world closed and the manifest lists the missing giver as unresolved', db.kit.opened.indexOf('world') < 0 && man.unresolved.indexOf('npc_missing_zz99') >= 0 && man.forward.length === 2, man.unresolved);
  const fw146 = await in146(draft.files[0].text, (w, K, r) => ({ forward: r.forward.map((x) => x.id).sort() }));
  check('Day 146 imports it: 0 broken, both givers forward and owed by 148', fw146.matches && !fw146.summary.broken && canon(fw146.forward) === canon([giver.id, 'npc_missing_zz99'].sort()), fw146);
  // Resolve the giver and stand in a generated overworld so Final is allowed (Phase 3 makes the real one).
  b.rules.sdq_[sdq[1]].giver = giver.id;
  WORLD.records.put(WORLD.envelope('map_', 'map|overworld', 'Overworld', { kind: 'overworld', w: 0, h: 0 }));
  Kit.bundle.touch('test');
  const fin = Kit.buildExport('final');
  const fb = JSON.parse(fin.files[0].text), fman = JSON.parse(fin.files[1].text);
  check('Final opens world, stamps forge 148 final, leaves 146 and 147 alone', fb.kit.opened.indexOf('world') >= 0 && fb.kit.forges['148'].status === 'final' && fb.kit.forges['146'].status === 'final' && fb.kit.forges['147'].status === 'final' && fman.worldOpened && !fman.unresolved.length, fb.kit.opened);
  const fin146 = await in146(fin.files[0].text, (w, K, r) => { let blocked = null; try { K.buildExport('final'); } catch (e) { blocked = e.message; } return { blocked, forward: r.forward.length }; });
  check('Day 146 opens the 148 Final: givers resolve, 0 broken, 0 forward, its own Final still allowed', fin146.matches && !fin146.summary.broken && !fin146.summary.errors && !fin146.forward && !fin146.blocked, fin146);
  const fin147 = await in147(fin.files[0].text);
  check('Day 147 opens the 148 Final with 0 errors and 0 broken', fin147.matches && !fin147.summary.errors && !fin147.summary.broken, fin147.summary);
  // Opened world with a dangling giver is exactly what the policy prevents: Day 146 would call it broken.
  const leak = JSON.parse(fin.files[0].text); leak.rules.sdq_[sdq[1]].giver = 'npc_missing_zz99';
  const leak146 = await in146(await stamp(leak));
  check('control: an opened world with a missing giver is broken in Day 146 (why world opens only on Final)', leak146.summary.broken === 1, leak146.summary);

  // 7. Own storage keys: Day 146 and Day 147 drafts are never opened automatically; Start offers the Day 147 draft.
  ({ win, errors } = await boot148({ storage: { 'kit:draft': demoText, 'art147:draft': fourText, 'kit:ui': JSON.stringify({ tab: 'export' }) } }));
  const offer = Array.prototype.some.call(win.document.querySelectorAll('#ws button'), (x) => /Day 147 draft/.test(x.textContent));
  check('148 keeps its own draft and offers the Day 147 draft on Start', win.Kit.bundle.current().kit.title === 'Untitled Saga' && win.Kit.active() === 'start' && offer && !errors.length, { title: win.Kit.bundle.current().kit.title, active: win.Kit.active(), offer });
  await win.WORLD.openDay147Draft(); await wait(20);
  check('Open the Day 147 draft copies it in and leaves art147:draft and kit:draft untouched', win.Kit.bundle.current().kit.title === 'Four Continents' && win.localStorage.getItem('art147:draft') === fourText && win.localStorage.getItem('kit:draft') === demoText && JSON.parse(win.localStorage.getItem('world148:draft')).kit.title === 'Four Continents');
  // Storage banner on a refused save with no IndexedDB (jsdom has none by default).
  const SP = win.Storage.prototype, orig = SP.setItem;
  SP.setItem = function (k, v) { if (k === 'world148:draft') throw new Error('QuotaExceededError'); return orig.call(this, k, v); };
  win.Kit.bundle.save();
  const shown = !win.document.getElementById('storeBanner').hidden;
  SP.setItem = orig; win.Kit.bundle.save();
  check('storage banner shows on a refused save and clears on success', shown && win.document.getElementById('storeBanner').hidden);
  // IndexedDB fallback: the draft moves to IndexedDB and a second boot restores it from there.
  const fi = require(path.join(__dirname, 'node_modules', 'fake-indexeddb'));
  const factory = new fi.IDBFactory();
  const store = {};
  ({ win, errors } = await boot148({ indexedDB: factory }));
  win.Kit.bundle.importText(demoText); await wait(10);
  const SP2 = win.Storage.prototype, orig2 = SP2.setItem;
  SP2.setItem = function (k, v) { if (k === 'world148:draft') throw new Error('QuotaExceededError'); return orig2.call(this, k, v); };
  win.Kit.bundle.save();
  await wait(60);
  const where = win.WORLD.storage.where('kit:draft');
  for (let i = 0; i < win.localStorage.length; i++) { const k = win.localStorage.key(i); store[k] = win.localStorage.getItem(k); }
  SP2.setItem = orig2;
  check('a refused localStorage save moves the draft to IndexedDB with a marker', where === 'idb' && store['world148:where:world148:draft'] === '1' && !store['world148:draft'] && win.document.getElementById('storeBanner').hidden, { where, keys: Object.keys(store) });
  const again = await boot148({ indexedDB: factory, storage: store });
  check('the next boot restores the draft from IndexedDB', again.win.Kit.bundle.current().kit.title === 'Demo Saga' && !again.errors.length, again.win.Kit.bundle.current().kit.title);

  // 8. Dev tab fixtures.
  ({ win, errors } = await boot148());
  check('WORLD_DEMO fixtures are the Day 147 exports, verbatim', canon(win.WORLD_DEMO.fixture('demo')) === canon(JSON.parse(demoText)) && canon(win.WORLD_DEMO.fixture('four')) === canon(JSON.parse(fourText)));
  await win.WORLD.loadFixture('four'); await wait(10);
  check('Dev loads a fixture into a fresh draft', win.Kit.bundle.current().kit.title === 'Four Continents' && !errors.length);

  const pass = results.filter((r) => r.ok).length;
  results.forEach((r) => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.detail).slice(0, 600))));
  console.log('\n' + pass + ' of ' + results.length + ' passed');
  fs.writeFileSync(path.join(OUT, 'phase0-report.json'), JSON.stringify({ results }, null, 2));
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
