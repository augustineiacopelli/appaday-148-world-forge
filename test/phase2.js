// Phase 2 acceptance: the progression graph before geometry. The engine builds a golden path per chapter (start town,
// key dungeon, lock, boss dungeon, exit), grants the ship and airship, adds optional branches, and the page turns the
// graph into one reg_ per chapter and a twn_ or dgn_ per site. Every fixture must be solvable by a topological walk,
// every key must precede its lock, chapter n's key must sit in chapter n - 1, and the records must round trip through
// Days 146 and 147 with no new errors.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { boot148, ROOT, wait } = require('./world');
const { in146, in147 } = require('./compat');
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); }
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const PRIOR = ['charter', 'codex', 'rules', 'art'];
const OUT = path.join(__dirname, 'out');
const engFile = fs.readFileSync(path.join(ROOT, 'engine-world.js'), 'utf8');
function context() { const box = vm.createContext({}); vm.runInContext(engFile, box, { filename: 'engine-world.js' }); return box; }
const ch = (id, cont, bosses) => ({ chapter: 'chp_' + id, name: id, continent: cont, label: cont, minutes: 60, bosses: bosses || ['trp_' + id + '_boss'] });

// Synthetic layouts beside the two real fixtures: the cases the Charter allows that the fixtures do not cover.
const SYNTH = {
  one: [ch('a', 'w')],
  oneContinent: [ch('a', 'w'), ch('b', 'w'), ch('c', 'w'), ch('d', 'w')],
  returns: [ch('a', 'w'), ch('b', 'e'), ch('c', 'w'), ch('d', 'n'), ch('e', 'e')],
  everyNew: [ch('a', 'w'), ch('b', 'e'), ch('c', 'n'), ch('d', 's'), ch('e', 'x'), ch('f', 'y')],
  long: 'abcdefghijkl'.split('').map((k, i) => ch(k, ['w', 'w', 'w', 'e', 'e', 'n', 'n', 'n', 's', 's', 'w', 'x'][i], i % 3 ? undefined : [])),
  noBosses: [ch('a', 'w', []), ch('b', 'e', [])]
};
const SETTINGS = [{}, { airshipAt: 0 }, { airshipAt: 1 }, { cavesPerChapter: 0, secondTownInChapterOne: false }, { cavesPerChapter: 3 }, { airshipAt: 0.2 }];

(async () => {
  const C1 = context(), C2 = context(), P = C1.ENGINE_WORLD.progression;

  // 1. Page: the specs the real fixtures produce.
  const { win, errors } = await boot148();
  const Kit = win.Kit, WORLD = win.WORLD, d = win.document;
  const specs = {};
  for (const key of ['demo', 'four']) { Kit.bundle.load(win.WORLD_DEMO.fixture(key)); await wait(10); specs[key] = JSON.parse(JSON.stringify(WORLD.progression.spec())); }
  check('the demo spec reads 2 chapters on 2 continents; the four fixture 6 chapters on 4', specs.demo.chapters.length === 2 && specs.four.chapters.length === 6 &&
    canon(specs.four.chapters.map((c) => c.continent)) === canon(['westland', 'westland', 'eastland', 'northreach', 'southmere', 'southmere']), specs.four.chapters.map((c) => c.continent));
  check('boss troops are found by enm_.isBoss and filed by chapter', specs.demo.chapters[0].bosses.length === 0 && canon(specs.demo.chapters[1].bosses) === canon(['trp_the_warden_n1yb']) &&
    specs.four.chapters.filter((c) => !c.bosses.length).map((c) => c.name).join() === 'The Marches', specs.four.chapters.map((c) => c.bosses));

  // 2. Every fixture under every setting: solvable, keys before locks, chapter keys one chapter early, nothing optional golden.
  const all = Object.assign({ demo: specs.demo.chapters, four: specs.four.chapters }, SYNTH);
  const failures = [], graphs = {};
  Object.keys(all).forEach((name) => SETTINGS.forEach((st, si) => {
    const g = P.build({ chapters: all[name] }, st), w = P.walk(g), probs = P.check(g);
    if (si === 0) graphs[name] = g;
    if (!w.ok || probs.length) failures.push({ name, si, stuck: w.stuck.slice(0, 3), probs: probs.slice(0, 3) });
  }));
  check('every fixture under six settings is solvable by topological walk with no structural problems (' + Object.keys(all).length * SETTINGS.length + ' graphs)', !failures.length, failures.slice(0, 3));
  let keyFail = [];
  Object.keys(graphs).forEach((name) => {
    const g = graphs[name], w = P.walk(g);
    g.nodes.forEach((n) => n.requires.forEach((r) => { if (!(w.grantedAt[r] < w.openedAt[n.key])) keyFail.push(name + ' ' + n.key + ' ' + r); }));
  });
  check('every key is granted strictly before the first node that needs it opens', !keyFail.length, keyFail.slice(0, 4));
  const chainFail = [];
  Object.keys(graphs).forEach((name) => {
    const g = graphs[name];
    g.chapters.forEach((c, k) => {
      const givers = g.nodes.filter((n) => n.grants.indexOf('chapter:' + c) >= 0);
      if (k === 0 ? givers.length || g.start.join() !== 'chapter:' + c : givers.length !== 1 || givers[0].index !== k - 1 || givers[0].role !== 'boss') chainFail.push(name + ' ' + c);
      const seal = g.nodes.filter((n) => n.grants.indexOf('item:seal:' + c) >= 0);
      if (seal.length !== 1 || seal[0].role !== 'key' || seal[0].chapter !== c) chainFail.push(name + ' seal ' + c);
    });
  });
  check('chapter n\'s key is granted only by chapter n - 1\'s boss; each seal only by its own key dungeon', !chainFail.length, chainFail.slice(0, 4));
  const goldenFail = [];
  Object.keys(graphs).forEach((name) => graphs[name].nodes.forEach((n) => {
    if (n.optional && n.grants.length) goldenFail.push(name + ' ' + n.key);
    if (n.kind !== 'gate' && n.requires.indexOf('chapter:' + n.chapter) < 0) goldenFail.push(name + ' ungated ' + n.key);
  }));
  check('optional branches grant nothing, and every site needs its own chapter\'s key (no vehicle breaks sequence)', !goldenFail.length, goldenFail.slice(0, 4));
  const path5 = Object.keys(graphs).every((name) => graphs[name].regions.every((r, k, rs) => {
    const roles = graphs[name].nodes.filter((n) => n.region === r.key && n.golden).map((n) => n.role).join();
    return roles === (k === rs.length - 1 ? 'start,key,lock,boss' : 'start,key,lock,boss,exit');
  }));
  check('each chapter\'s golden path is start town, key dungeon, lock, boss dungeon, exit (the finale has no exit)', path5);

  // 3. Vehicles and gates.
  const G4 = graphs.four;
  check('four: ship with The Marches\' boss (before Eastland, the first new continent); airship with chapter 4 (round(0.67 x 6))',
    G4.vehicles.ship.chapter === 'chp_the_marches_m4r2' && G4.vehicles.airship.chapter === 'chp_the_frost_reach_f7k1', G4.vehicles);
  check('four: gates are pass, landing, landing, landing, pass, and every landing needs the ship',
    G4.gates.map((x) => x.kind).join() === 'pass,landing,landing,landing,pass' && G4.gates.every((x) => (x.kind === 'landing') === (x.requires.indexOf('vehicle:ship') >= 0)), G4.gates.map((x) => x.kind));
  const GD = graphs.demo;
  check('demo: ship after The Lowlands, no airship (round(0.67 x 2) is not later than the ship)', GD.vehicles.ship.chapter === specs.demo.chapters[0].chapter && GD.vehicles.airship === null, GD.vehicles);
  const GR = graphs.returns;
  check('a chapter returning to an earlier continent arrives by landing and needs the ship', GR.gates.map((x) => x.kind).join() === 'landing,landing,landing,landing' && GR.regions[2].entry === 'landing' && !GR.regions[2].opensContinent, GR.gates.map((x) => x.kind));
  const G1 = graphs.oneContinent;
  check('one continent: no ship, all passes, airship with chapter 3 of 4', G1.vehicles.ship === null && G1.gates.every((x) => x.kind === 'pass') && G1.vehicles.airship.chapter === 'chp_c', G1.vehicles);
  check('a single chapter has no gates, no vehicles, and a castle finale', graphs.one.gates.length === 0 && graphs.one.vehicles.ship === null && graphs.one.vehicles.airship === null &&
    graphs.one.nodes.filter((n) => n.role === 'boss')[0].interior === 'castle');
  const gOff = P.build({ chapters: all.four }, { airshipAt: 0 }), gLate = P.build({ chapters: all.four }, { airshipAt: 1 });
  check('airshipAt 0 disables the airship; airshipAt 1 still grants it before the finale', gOff.vehicles.airship === null && gLate.vehicles.airship.chapter === 'chp_the_sunken_coast_s2c9', [gOff.vehicles, gLate.vehicles]);
  const gC = P.build({ chapters: all.four }, { cavesPerChapter: 3, secondTownInChapterOne: false }), gN = P.build({ chapters: all.four }, { cavesPerChapter: 0 });
  check('optional branch settings: three caves per chapter and no second town; or no caves at all',
    gC.nodes.filter((n) => /^cave/.test(n.role)).length === 18 && !gC.nodes.some((n) => n.role === 'town') && gN.nodes.filter((n) => n.optional).map((n) => n.role).join() === 'town');

  // 4. Bosses.
  check('a chapter with no boss troop gets one warning and an empty boss slot; the rest attach their boss troop',
    G4.warnings.length === 1 && G4.warnings[0].code === 'no-boss' && G4.warnings[0].chapter === 'chp_the_marches_m4r2' &&
    G4.nodes.filter((n) => n.role === 'boss').map((n) => n.troop === null ? '-' : n.troop.slice(0, 8)).join() === 'trp_slim,-,trp_the_,trp_fros,trp_tide,trp_holl', G4.nodes.filter((n) => n.role === 'boss').map((n) => n.troop));
  check('the long fixture warns once per bossless chapter and is still solvable', graphs.long.warnings.length === 4 && P.walk(graphs.long).ok);

  // 5. The checker catches broken graphs.
  function broken(fn) { const g = JSON.parse(JSON.stringify(G4)); fn(g); return P.check(g).map((p) => p.code); }
  const mNoGrant = broken((g) => { g.nodes.filter((n) => n.role === 'key')[1].grants = []; });
  const mOptional = broken((g) => { const cave = g.nodes.filter((n) => n.optional && n.kind === 'dgn')[0]; cave.grants = ['item:seal:' + cave.chapter]; });
  const mEarly = broken((g) => { g.nodes.filter((n) => n.role === 'boss')[0].grants.push('chapter:chp_the_far_shore_izf4'); });
  const mUngated = broken((g) => { g.nodes.filter((n) => n.role === 'boss')[2].requires = ['item:seal:chp_the_far_shore_izf4']; });
  check('the checker catches a missing grant, a golden key in an optional cave, a chapter key two chapters early, and an ungated site',
    mNoGrant.indexOf('unreachable') >= 0 && mOptional.indexOf('optional-golden') >= 0 && mEarly.indexOf('key-chapter') >= 0 && mUngated.indexOf('ungated') >= 0, { mNoGrant, mOptional, mEarly, mUngated });

  // 6. Determinism: identical graphs in two contexts and in the page.
  const twoCtx = Object.keys(all).every((name) => JSON.stringify(C1.ENGINE_WORLD.progression.build({ chapters: all[name] }, {})) === JSON.stringify(C2.ENGINE_WORLD.progression.build({ chapters: all[name] }, {})));
  const inPage = JSON.stringify(win.ENGINE_WORLD.progression.build(specs.four, {})) === JSON.stringify(G4);
  check('every graph is identical in two vm contexts and in the page', twoCtx && inPage);
  const frozen = Object.isFrozen(C1.ENGINE_WORLD.progression) && Object.isFrozen(C1.ENGINE_WORLD.progression.gate);
  check('ENGINE_WORLD.progression is frozen with the rest of the engine', frozen);

  // 7. Records in the page.
  Kit.bundle.load(win.WORLD_DEMO.fixture('four')); await wait(10);
  let b = Kit.bundle.current();
  const before = JSON.parse(JSON.stringify(b));
  const r1 = WORLD.progression.apply();
  const cnt = (p) => Object.keys(b.world.records[p]).length;
  check('four: 6 reg_, 7 twn_ (6 start towns and a second town), 18 dgn_ (key, boss, cave per chapter)', cnt('reg_') === 6 && cnt('twn_') === 7 && cnt('dgn_') === 18 && cnt('map_') === 0 && cnt('npc_') === 0, ['reg_', 'twn_', 'dgn_'].map(cnt));
  const recs = [].concat(...['reg_', 'twn_', 'dgn_'].map((p) => WORLD.records.list(p)));
  check('every record ID derives from its structural key and every record is generated', recs.every((r) => win.ENGINE_WORLD.ids.structural(win.Kit.ids.prefixOf(r.id), r.key) === r.id && r.origin === 'generated'), recs.slice(0, 2).map((r) => r.id));
  const bossRec = WORLD.records.get(r1.graph.nodes.filter((n) => n.role === 'boss' && n.index === 2)[0].record);
  check('a site record carries chapter, continent, region, role, gate requirements and grants, and its boss troop',
    bossRec && bossRec.chapter === 'chp_the_far_shore_izf4' && bossRec.continent === 'eastland' && /^reg_/.test(bossRec.region) && bossRec.role === 'boss' && bossRec.troop === 'trp_the_warden_n1yb' &&
    canon(bossRec.grants) === canon(['chapter:chp_the_frost_reach_f7k1']) && bossRec.requires.indexOf('item:seal:chp_the_far_shore_izf4') >= 0, bossRec);
  const regs = WORLD.records.list('reg_').sort((a, c) => a.order - c.order);
  check('regions: one per chapter, Westland and Southmere split in two parts, each listing its sites and the next region',
    regs.map((r) => r.continent + r.part).join() === 'westland1,westland2,eastland1,northreach1,southmere1,southmere2' &&
    regs.every((r, k) => r.sites.length >= 3 && r.sites.every((s) => WORLD.records.get(s)) && (k === 5 ? r.next === null && r.exitGate === null : r.next === regs[k + 1].id && r.exitGate.gate === 'chapter:' + regs[k + 1].chapter)), regs.map((r) => r.continent + r.part));
  check('the progression graph names each site\'s record and holds no field named id', r1.graph.nodes.every((n) => n.kind === 'gate' ? !!n.regionRecord : !!WORLD.records.get(n.record)) && !/"id"\s*:/.test(JSON.stringify(b.world.progression)));
  check('charter, codex, rules, and art are untouched by laying out the graph', PRIOR.every((k) => canon(b[k]) === canon(before[k])));
  let idx = Kit.index();
  check('KIT:CORE indexes every site and region record, and no graph node', recs.every((r) => idx.byId[r.id]) && !Object.keys(idx.byId).some((k) => idx.byId[k].path && idx.byId[k].path.indexOf('world.progression') === 0));
  let res = Kit.refreshValidation();
  const graphMsgs = res.errors.concat(res.warnings).filter((x) => x.fieldPath === 'progression').map((x) => x.message);
  check('the four fixture validates with no errors or broken references; the only graph message is the Marches boss warning', !res.errors.length && !res.broken.length && graphMsgs.length === 1 && /The Marches/.test(graphMsgs[0]), { s: Kit.validate.summary(res), graphMsgs, e: res.errors.slice(0, 3).map((x) => x.message) });

  // 8. Laying out again is idempotent, survives a reroll, keeps user records, and removes what the Charter dropped.
  const snap = JSON.stringify(b.world.records), gsnap = JSON.stringify(b.world.progression);
  const seed0 = b.world.seed; b.world.seed = (seed0 + 12345) >>> 0;
  const r2 = WORLD.progression.apply();
  check('laying out again after a seed reroll rewrites identical records and an identical graph', JSON.stringify(b.world.records) === snap && JSON.stringify(b.world.progression) === gsnap && r2.removed === 0);
  const cave = WORLD.records.list('dgn_').filter((r) => r.role === 'cave')[0];
  cave.origin = 'user'; cave.name = 'The Drowned Grotto';
  const last = b.charter.sections.chapters.pop();
  check('removing a chapter marks the graph stale', WORLD.progression.stale());
  const r3 = WORLD.progression.apply();
  check('after the Charter drops a chapter: its 4 generated sites and its region are removed, the user cave is kept with its edits',
    r3.removed === 5 && !WORLD.records.list('dgn_').concat(WORLD.records.list('twn_'), WORLD.records.list('reg_')).some((r) => r.chapter === last.id) && WORLD.records.get(cave.id).name === 'The Drowned Grotto' && r3.kept.indexOf(cave.id) >= 0 && !WORLD.progression.stale(), { removed: r3.removed, kept: r3.kept });
  b.charter.sections.chapters.push(last); WORLD.records.get(cave.id).origin = 'generated';
  WORLD.progression.apply();
  check('restoring the chapter brings back the same IDs', JSON.stringify(Object.keys(b.world.records.dgn_).sort()) === JSON.stringify(Object.keys(JSON.parse(snap).dgn_).sort()));

  // 9. Draft export and round trip through Day 146 and Day 147 with the graph laid out.
  Kit.bundle.load(win.WORLD_DEMO.fixture('four')); await wait(10);
  const fourText = JSON.stringify(Kit.bundle.current());
  WORLD.progression.apply(); b = Kit.bundle.current();
  const draft = Kit.buildExport('draft'), db = JSON.parse(draft.files[0].text), man = JSON.parse(draft.files[1].text);
  check('Draft manifest lists 31 created world IDs, the referenced chapters and troops, and nothing unresolved',
    man.created.length === 31 && !man.unresolved.length && man.referenced.indexOf('trp_the_warden_n1yb') >= 0 && man.referenced.indexOf('chp_the_marches_m4r2') >= 0, { created: man.created.length, unresolved: man.unresolved });
  check('Draft keeps world out of kit.opened', db.kit.opened.indexOf('world') < 0);
  const base146 = await in146(fourText), base147 = await in147(fourText);
  const r146 = await in146(draft.files[0].text, (w, K) => ({ diff: PRIOR.concat(['world']).filter((k) => canon(K.bundle.current()[k]) !== canon(db[k])) }));
  check('Day 146 opens the Draft with every namespace identical and no new errors, broken, or forward references', r146.matches && !r146.diff.length && canon(r146.summary) === canon(base146.summary) && canon(r146.errors) === canon(base146.errors), { diff: r146.diff, now: r146.summary, before: base146.summary });
  const r147 = await in147(draft.files[0].text, (w, K) => ({ diff: PRIOR.concat(['world']).filter((k) => canon(K.bundle.current()[k]) !== canon(db[k])), cov: w.ART.coverage.compute(K.bundle.current()).green }));
  check('Day 147 opens the Draft with every namespace identical, coverage green, and no new errors', r147.matches && !r147.diff.length && r147.cov && canon(r147.summary) === canon(base147.summary) && canon(r147.errors) === canon(base147.errors), { diff: r147.diff, now: r147.summary, before: base147.summary });

  // 10. The Start card.
  Kit.bundle.load(win.WORLD_DEMO.fixture('demo')); await wait(10);
  Kit.go('start'); await wait(20);
  const card = () => Array.prototype.find.call(d.querySelectorAll('#ws .w8-prog'), Boolean);
  const c0 = card();
  const layBtn = c0 && Array.prototype.find.call(c0.querySelectorAll('button'), (x) => /Lay out progression/.test(x.textContent));
  check('Start shows a Progression card with a Lay out button before the graph exists', !!layBtn);
  layBtn.click(); await wait(30);
  const c1 = card(), txt = c1 ? c1.textContent : '';
  check('after Lay out: solvable chip, ship chip, two region rows with their golden paths, and the boss warning for The Lowlands',
    /Solvable in 12 steps/.test(txt) && /Ship after The Lowlands/.test(txt) && c1.querySelectorAll('tbody tr').length === 2 && c1.querySelectorAll('.w8-path .chip').length === 9 && /The Lowlands has no boss troop/.test(txt), txt.slice(0, 300));
  check('the demo lays out 3 twn_, 6 dgn_, 2 reg_', WORLD.records.list('twn_').length === 3 && WORLD.records.list('dgn_').length === 6 && WORLD.records.list('reg_').length === 2);
  check('no page errors', !errors.length, errors.slice(0, 3));

  const pass = results.filter((x) => x.ok).length;
  results.forEach((x) => console.log((x.ok ? 'PASS ' : 'FAIL ') + x.name + (x.ok ? '' : '  ' + String(JSON.stringify(x.detail)).slice(0, 700))));
  console.log('\nfour fixture walk: ' + P.walk(G4).order.length + ' steps; graph digest ' + G4.digest);
  console.log('\n' + pass + ' of ' + results.length + ' passed');
  fs.writeFileSync(path.join(OUT, 'phase2-report.json'), JSON.stringify({ results, fourDigest: G4.digest, fourWalk: P.walk(G4).order, gates: G4.gates, vehicles: G4.vehicles }, null, 2));
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
