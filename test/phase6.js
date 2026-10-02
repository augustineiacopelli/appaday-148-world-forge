// Phase 6 tests: validation. The engine's three proofs (progression, flags, refs) are checked on their own (identical in
// two vm contexts and the plain context; clean on every fixture and many seeds; the ship and airship rules; each kind
// of fault caught with the right code and level), then the page (the four validators, the decisions on empty tables
// and missing backgrounds, the Final gate for an incomplete or stale world, jump links, the Validation tab, the manifest,
// and the Final bundle in Days 146 and 147). Run from test/: node phase6.js
'use strict';
const fs = require('fs');
const path = require('path');
const { boot148, wait } = require('./world');
const { in146, in147 } = require('./compat');
const { worldFor, context, fast, fixture, OUT } = require('./worldspec');
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); }
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const plain = (o) => JSON.parse(JSON.stringify(o));
const PRIOR = ['charter', 'codex', 'rules', 'art'];
const codes = (r) => r.problems.map((p) => p.code);
const errs = (r) => r.problems.filter((p) => p.level !== 'warning');

function proofs(ctx, b, W) {
  const sites = {}, kinds = {};
  W.sites.forEach((x) => { sites[x.s.key] = x.site; kinds[x.s.key] = x.sp.kind; });
  const P = ctx.E.checks.progression({ ow: W.ow, graph: W.g, sites, palette: W.pal });
  const F = ctx.E.checks.flags({ ow: W.ow, sites, kinds, art: b.art, render: ctx.R });
  return { P, F, sites, kinds };
}

(async () => {
  const C1 = context(), C2 = context(), FAST = fast(), E = FAST.E, R = FAST.R, demo = fixture('demo'), four = fixture('four');

  // 1. Determinism: the same proofs in two vm contexts and the plain context.
  const W42 = worldFor(FAST, four, 42, {}), base = proofs(FAST, four, W42);
  const v1 = proofs(C1, four, worldFor(C1, four, 42, {})), v2 = proofs(C2, four, worldFor(C2, four, 42, {}));
  check('the progression and flag proofs are identical in two vm contexts and the plain context (four, seed 42)',
    canon(plain(v1.P)) === canon(plain(v2.P)) && canon(plain(v1.P)) === canon(plain(base.P)) && canon(plain(v1.F)) === canon(plain(base.F)) && canon(plain(v2.F)) === canon(plain(base.F)));
  check('the engine exposes checks {progression, flags, refs, reach, landable} and stays frozen', ['progression', 'flags', 'refs', 'reach', 'landable'].every((k) => typeof E.checks[k] === 'function') && Object.isFrozen(E.checks));

  // 2. Clean on every fixture and many seeds.
  let cleanBad = [], walked = 0, flagCells = 0, tP = 0, tF = 0;
  for (const [name, b] of [['demo', demo], ['four', four]]) {
    for (const seed of [1, 7, 42, 99, 1234, 31337, 2026, 777]) {
      const W = worldFor(FAST, b, seed, {}), t0 = Date.now(), sites = {}, kinds = {};
      W.sites.forEach((x) => { sites[x.s.key] = x.site; kinds[x.s.key] = x.sp.kind; });
      const P = E.checks.progression({ ow: W.ow, graph: W.g, sites, palette: W.pal }), t1 = Date.now();
      const F = E.checks.flags({ ow: W.ow, sites, kinds, art: b.art, render: R }); tP += t1 - t0; tF += Date.now() - t1;
      walked += P.chapters.length; flagCells += F.stats.cells;
      if (!P.ok || F.problems.length || P.chapters.some((c) => !c.ok || !c.sealed || !c.lock || !c.lock.shut || !c.lock.opens)) cleanBad.push({ name, seed, p: P.problems.slice(0, 2).map((x) => x.message), f: F.problems.slice(0, 2).map((x) => x.message) });
    }
  }
  check('16 worlds (demo and four, 8 seeds each, ' + walked + ' chapter walks, ' + flagCells + ' cells) prove clean: every site reached and entered, every lock shut then opened by its seal, every later chapter sealed, no flag problem, not even a warning', !cleanBad.length, cleanBad.slice(0, 3));
  check('the proofs take ' + Math.round(tP / 16) + ' ms (walk) and ' + Math.round(tF / 16) + ' ms (flags) per world in the plain context', tP / 16 < 400 && tF / 16 < 400, { tP, tF });
  const P42 = base.P;
  check('every chapter of the four fixture reports its held keys, vehicles, sites, lock, and sealed state',
    P42.chapters.length === 6 && P42.chapters.every((c) => Array.isArray(c.held) && c.sites.length >= 4 && c.lock && c.ok && c.sealed) && P42.interiors === true);

  // 3. The ship and airship rules.
  const ow = W42.ow, sea = (A) => { let n = 0; for (let i = 0; i < A.length; i++) if (A[i] && ow.sea[i]) n++; return n; };
  const shipAt = P42.chapters.findIndex((c) => c.ship), airAt = P42.chapters.findIndex((c) => c.airship);
  const before = E.checks.reach(ow, P42.chapters[shipAt - 1].held, false), after = E.checks.reach(ow, P42.chapters[shipAt].held, false);
  check('before the ship no sea cell is reached; with it the party sails (' + sea(after) + ' sea cells) and steps ashore on another continent', shipAt > 0 && sea(before) === 0 && sea(after) > 1000 && P42.chapters[shipAt].reach > P42.chapters[shipAt - 1].reach * 3);
  const heldAir = {}; P42.chapters[airAt].held.forEach((k) => { heldAir[k] = true; });
  const withAir = E.checks.reach(ow, heldAir, true), noAir = E.checks.reach(ow, Object.assign({}, heldAir, { 'vehicle:airship': false }), false);
  let landable = 0, landed = 0, gateLanded = 0;
  for (let i = 0; i < ow.ground.length; i++) { if (E.checks.landable(ow, i)) { landable++; if (withAir[i]) landed++; } if (ow.gateAt[i] >= 0 && withAir[i] && !E.overworld.walkable(ow, i, heldAir, true)) gateLanded++; }
  check('the airship (chapter ' + (airAt + 1) + ') reaches every one of ' + landable + ' landable cells and never lands on a shut gate; without it less is reached', airAt > shipAt && landed === landable && !gateLanded && ckCount(withAir) > ckCount(noAir));
  function ckCount(A) { let n = 0; for (let i = 0; i < A.length; i++) n += A[i]; return n; }
  const laterSites = ow.sites.filter((s) => W42.g.chapters.indexOf(s.chapter) > airAt);
  check('even with the airship every later chapter site front is reached but none can be entered, so the chapter stays sealed', laterSites.length > 0 && laterSites.some((s) => withAir[s.front]) && P42.chapters[airAt].sealed);
  const offW = worldFor(FAST, four, 42, { airshipAt: 0 }), offP = proofs(FAST, four, offW).P;
  check('with the airship disabled (airshipAt 0) no chapter holds it and the walk is still clean', offP.ok && offP.chapters.every((c) => !c.airship));

  // 4. Progression faults are caught.
  function mutate(fn, undo) { fn(); const P = E.checks.progression({ ow: W42.ow, graph: W42.g, sites: base.sites, palette: W42.pal }); undo(); return P; }
  const pass = ow.gates.find((g) => g.kind === 'pass'), lock = ow.gates.find((g) => g.kind === 'lock'), landing = ow.gates.filter((g) => g.kind === 'landing' || g.kind === 'seawall').pop();
  const passReq = pass.requires.slice(), lockReq = lock.requires.slice(), landReq = landing.requires.slice();
  let P = mutate(() => { pass.requires.length = 0; }, () => { passReq.forEach((k) => pass.requires.push(k)); });
  check('an open pass is caught: later ground walked to early (early-ground)', !P.ok && codes(P).includes('early-ground'), codes(P).slice(0, 4));
  P = mutate(() => { landing.requires.length = 0; }, () => { landReq.forEach((k) => landing.requires.push(k)); });
  check('a keyless landing or seawall on a later continent is caught (early-ground: the ship reaches its inland early)', !P.ok && codes(P).includes('early-ground'), codes(P).slice(0, 4));
  P = mutate(() => { lock.requires.length = 0; lock.requires.push(lockReq[0]); }, () => { lock.requires.length = 0; lockReq.forEach((k) => lock.requires.push(k)); });
  check('a boss lock that does not need the seal is caught (lock-open)', codes(P).includes('lock-open'));
  P = mutate(() => { lock.requires.push('item:nowhere'); }, () => { lock.requires.pop(); });
  check('a boss lock no key in the game opens is caught (lock-shut)', codes(P).includes('lock-shut'));
  const ch2 = W42.g.chapters[1], keyNode = W42.g.nodes.find((n) => n.chapter === ch2 && n.role === 'key'), keyReq = keyNode.requires.slice();
  P = mutate(() => { pass.requires.length = 0; keyNode.requires.length = 0; keyNode.requires.push('chapter:' + W42.g.chapters[0]); }, () => { passReq.forEach((k) => pass.requires.push(k)); keyNode.requires.length = 0; keyReq.forEach((k) => keyNode.requires.push(k)); });
  const ek = P.problems.find((p) => p.code === 'early-key');
  check('a later golden key that opens early is an error naming the chapter it leaks into (early-key)', ek && ek.level === 'error' && ek.chapter === W42.g.chapters[0] && /golden key/.test(ek.message) && ek.record === keyNode.record, ek);
  P = mutate(() => { keyNode.requires.push('item:never'); }, () => { keyNode.requires.pop(); });
  check('a site whose entrance needs a key its chapter never holds is caught (sealed-site)', codes(P).includes('sealed-site'));
  const keySite = base.sites[keyNode.key], kLast = keySite.floors[keySite.floors.length - 1], prize = kLast.features.find((f) => f.prize), sealItem = prize.item;
  P = mutate(() => { prize.item = null; }, () => { prize.item = sealItem; });
  check('a key dungeon whose prize is not its seal is caught (seal-missing)', codes(P).includes('seal-missing'));
  const bossNode = W42.g.nodes.find((n) => n.chapter === ch2 && n.role === 'boss'), bSite = base.sites[bossNode.key], bF = bSite.floors[bSite.floors.length - 1].features.find((f) => f.kind === 'boss'), bGr = bF.grants.slice();
  P = mutate(() => { bF.grants.length = 0; }, () => { bGr.forEach((k) => bF.grants.push(k)); });
  check('a boss that grants other than the graph says is caught (boss-grants)', codes(P).includes('boss-grants'));
  const lockF = bSite.floors[bSite.floors.length - 1].features, li = lockF.findIndex((f) => f.kind === 'lock'), lockFt = lockF[li];
  P = mutate(() => { lockF.splice(li, 1); }, () => { lockF.splice(li, 0, lockFt); });
  check('an interior that lost its locked door is caught through the walking proof (interior-no-lock)', codes(P).includes('interior-no-lock'));
  P = E.checks.progression({ ow: W42.ow, graph: W42.g, sites: Object.assign({}, base.sites, { [keyNode.key]: undefined }), palette: W42.pal });
  check('a site whose interior was not built is caught (no-interior); without any interiors only the overworld is proven', codes(P).includes('no-interior') && E.checks.progression({ ow: W42.ow, graph: W42.g }).ok && E.checks.progression({ ow: W42.ow, graph: W42.g }).interiors === false);
  check('every progression problem names its check, chapter, and record', mutate(() => { lock.requires.push('item:nowhere'); }, () => { lock.requires.pop(); }).problems.every((p) => p.check === 'progression' && p.chapter && p.record && p.level === 'error'));

  // 5. Flag faults are caught, by editing a copy of the art the maps were drawn with.
  function artWith(fn) { const a = plain(four.art); fn(a.records.til_); return a; }
  function flagsOn(art) { return E.checks.flags({ ow: W42.ow, sites: base.sites, kinds: base.kinds, art, render: R }); }
  const dun = Object.keys(four.art.records.til_).find((k) => /dungeon/.test(k)), town = Object.keys(four.art.records.til_).find((k) => /town/.test(k));
  const tile = (t, id, key) => t[id].tiles.find((x) => x.key === key);
  let F = flagsOn(artWith((t) => { tile(t, dun, 'wall').flags = 1; }));
  check('a dungeon wall that can be walked through is an error (wall-open)', F.problems.some((p) => p.code === 'wall-open' && p.level === 'error' && p.count > 100) && !F.ok);
  F = flagsOn(artWith((t) => { tile(t, dun, 'floor').flags = 1; }));
  check('a dungeon floor without the encounter flag is only a warning (floor-encounter), one per floor with a count', F.ok && F.problems.length > 0 && F.problems.every((p) => p.code === 'floor-encounter' && p.level === 'warning' && p.count > 0));
  F = flagsOn(artWith((t) => { tile(t, town, 'floor').flags = 3; }));
  check('a building floor carrying the encounter flag is a warning (town-encounter)', F.ok && F.problems.some((p) => p.code === 'town-encounter'));
  F = flagsOn(artWith((t) => { tile(t, town, 'counter').flags = 0; }));
  check('a counter without the counter flag is a warning (counter-flag); one that can be walked over is an error', F.problems.some((p) => p.code === 'counter-flag' && p.level === 'warning') &&
    flagsOn(artWith((t) => { tile(t, town, 'counter').flags = 17; })).problems.some((p) => p.code === 'counter-open' && p.level === 'error'));
  F = flagsOn(artWith((t) => { tile(t, town, 'lintel').flags = 1; }));
  check('a lintel not drawn above the party is a warning (door-layer)', F.ok && F.problems.some((p) => p.code === 'door-layer'));
  const oceanId = Object.keys(four.art.records.til_).find((k) => four.art.records.til_[k].key === 'ocean'), mtnId = Object.keys(four.art.records.til_).find((k) => four.art.records.til_[k].key === 'mountain');
  F = flagsOn(artWith((t) => { t[oceanId].flags = 5; }));
  check('walkable sea is an error (water-walkable)', F.problems.some((p) => p.code === 'water-walkable' && p.level === 'error'));
  F = flagsOn(artWith((t) => { t[oceanId].flags = 0; }));
  check('sea the ship cannot sail is an error (sea-not-sailable)', F.problems.some((p) => p.code === 'sea-not-sailable' && p.level === 'error'));
  F = flagsOn(artWith((t) => { t[mtnId].flags = 1; }));
  check('a passable mountain ridge is an error, since a gate could be walked around (wall-open on the overworld)', F.problems.some((p) => p.code === 'wall-open' && p.map === 'overworld'));
  F = flagsOn(artWith((t) => { t[dun].tiles = t[dun].tiles.filter((x) => x.key !== 'torch'); }));
  check('a tile the art no longer has is a broken reference with its map named (missing-tile)', F.problems.some((p) => p.code === 'missing-tile' && p.level === 'broken' && /torch/.test(p.message)));
  const tsite = W42.sites.find((x) => x.sp.kind === 'town').site, guy = tsite.npcs[0], at0 = guy.at, wallAt = tsite.floors[0].ground.findIndex((g) => /:wall$/.test(g));
  guy.at = wallAt; F = flagsOn(four.art); guy.at = at0;
  check('a person standing in a wall is an error (npc-blocked)', F.problems.some((p) => p.code === 'npc-blocked' && p.level === 'error'));
  check('without the render engine the flag check says so instead of crashing', E.checks.flags({ ow: W42.ow, art: four.art }).problems[0].code === 'no-render');

  // 6. The page.
  const { win } = await boot148();
  const pageErr = []; win.addEventListener('error', (e) => pageErr.push(e.message));
  const { Kit, WORLD } = win, d = win.document;
  check('the four Phase 6 validators are registered beside the earlier ones', ['world.refs', 'world.progression', 'world.flags', 'world.zones', 'world.graph', 'world.overworld', 'world.interiors', 'world.envelope'].every((n) => Kit.validate.list().indexOf(n) >= 0));
  WORLD.loadFixture('four'); await wait(20);
  let b = Kit.bundle.current(); b.world.seed = 42;
  const orig = plain({ charter: b.charter, codex: b.codex, rules: b.rules, art: b.art });
  let res = Kit.refreshValidation();
  check('before generation the geometric checks wait (no walk) and the references of an empty world pass', !WORLD.checks.walks(b) && !res.errors.length && !res.broken.length);
  WORLD.overworld.apply(); Kit.bundle.touch('t');
  let why = WORLD.finalBlock(b);
  check('with only the overworld, Final is blocked for want of interiors, with a readable reason', /no interiors yet/.test(why || ''), why);
  const owOnly = WORLD.checks.walks(b);
  check('the overworld alone is already walked (interiors not yet part of the proof)', owOnly && owOnly.progression.ok && !owOnly.interiors);
  WORLD.interiors.apply(); why = WORLD.finalBlock(b);
  check('with interiors but no zones, Final is blocked for want of encounter zones', /no encounter zones yet/.test(why || ''), why);
  WORLD.zones.apply();
  res = Kit.refreshValidation();
  check('the generated four fixture validates with no errors, no broken references, and only the Marches boss warning', !res.errors.length && !res.broken.length && res.warnings.length === 1 && /Marches/.test(res.warnings[0].message), { s: Kit.validate.summary(res), w: res.warnings.map((x) => x.message).slice(0, 3), e: res.errors.concat(res.broken).slice(0, 3).map((x) => x.message) });
  const wk = WORLD.checks.walks(b);
  check('the page proves exactly what the engine proves from the fixture alone (progression and flags identical)', canon(plain(wk.progression)) === canon(plain(base.P)) && canon(plain(wk.flags)) === canon(plain(base.F)));
  check('Final is not blocked and the summary says every chapter passed', WORLD.finalBlock(b) === null && WORLD.checks.summary(b).progression.chapters.every((c) => c.ok && c.sealed));
  const wk2 = WORLD.checks.walks(b);
  check('the walks are memoized: a second call returns the same object without walking again', wk2 === wk);

  // References: each kind of missing thing, at the decided level, blocking Final, then restored.
  function refsNow() { return WORLD.checks.refs(b).problems; }
  const dg = WORLD.records.list('dgn_').find((r) => r.role === 'boss' && r.troop), troop0 = dg.troop;
  dg.troop = 'trp_missing_zz99';
  let rp = refsNow(), brk = rp.find((p) => p.code === 'missing-troop' && p.record === dg.id);
  res = Kit.refreshValidation();
  check('a missing troop is a broken reference naming the record, field, and ID, and it blocks Final', brk && brk.level === 'broken' && brk.field === 'troop' && brk.id === 'trp_missing_zz99' && res.broken.some((x) => x.recordId === dg.id && x.id === 'trp_missing_zz99') && /blocked/.test(WORLD.finalBlock(b) || ''));
  dg.troop = troop0;
  const cave = WORLD.records.list('dgn_').find((r) => r.interior === 'dungeon'), int0 = cave.interior;
  cave.interior = 'lair';
  check('an interior kind no generator makes is an error (interior-key)', refsNow().some((p) => p.code === 'interior-key' && p.record === cave.id && p.level === 'error'));
  cave.interior = int0;
  const owr = WORLD.overworld.record(b), bm0 = owr.stats.biomes[0].biome;
  owr.stats.biomes[0].biome = 'til_gone_zz99';
  check('a biome the overworld paints with that the art lacks is broken (missing-biome)', refsNow().some((p) => p.code === 'missing-biome' && p.id === 'til_gone_zz99'));
  owr.stats.biomes[0].biome = bm0;
  const im = WORLD.interiors.maps(b)[0], ts0 = im.tileset;
  im.tileset = 'til_gone_zz99';
  check('an interior map drawn with a missing tileset is broken (missing-tileset)', refsNow().some((p) => p.code === 'missing-tileset' && p.record === im.id));
  im.tileset = ts0;
  const mus = b.art.records.mus_, westMus = Object.keys(mus).find((k) => mus[k].subject && mus[k].subject.ref === 'music:field:westland'), wm = mus[westMus];
  delete mus[westMus];
  rp = refsNow();
  check('a continent with no field:<slug> music role is an error naming the role (no-music)', rp.some((p) => p.code === 'no-music' && p.id === 'music:field:westland' && p.level === 'error'));
  mus[westMus] = wm;
  const bossMus = Object.keys(mus).find((k) => mus[k].subject && mus[k].subject.ref === 'music:boss'), bmr = mus[bossMus];
  delete mus[bossMus];
  check('boss battles with no music:boss role are an error too', refsNow().some((p) => p.code === 'no-music' && p.id === 'music:boss'));
  mus[bossMus] = bmr;
  const spr = b.art.records.spr_, elderIds = Object.keys(spr).filter((k) => spr[k].subject && spr[k].subject.ref === 'npc:elder'), elders = elderIds.map((k) => spr[k]);
  const anElder = WORLD.records.list('npc_').find((p) => p.archetype === 'elder');
  elderIds.forEach((k) => { delete spr[k]; });
  rp = refsNow();
  check('a person whose sprite is gone is broken (missing-sprite)', rp.some((p) => p.code === 'missing-sprite' && p.record === anElder.id && p.level === 'broken'));
  const sp0 = anElder.sprite; anElder.sprite = null;
  check('a person with no sprite whose archetype has none in the art is an error (no-sprite); with the role restored the record may leave its own sprite empty',
    refsNow().some((p) => p.code === 'no-sprite' && p.record === anElder.id && p.level === 'error') && (() => { elderIds.forEach((k, i) => { spr[k] = elders[i]; }); return !refsNow().some((p) => p.record === anElder.id); })());
  anElder.sprite = sp0;
  const bg = b.art.records.bgd_, grassBg = Object.keys(bg).find((k) => bg[k].subject && bg[k].subject.ref === 'biome:grassland'), gbg = bg[grassBg];
  delete bg[grassBg];
  rp = refsNow();
  check('a zone naming a battle background that was deleted is broken (missing-battle background)', rp.some((p) => p.code === 'missing-battle background' && p.id === grassBg));
  res = Kit.refreshValidation();
  check('deleting the background also makes the zones out of date, and Final names that', WORLD.zones.stale(b) && /encounter zones are out of date/.test(WORLD.checks.finalBlock(b) || ''));
  WORLD.zones.apply();
  rp = refsNow();
  const nb = rp.filter((p) => p.code === 'no-background');
  check('DECISION: once regenerated, a grassland zone that can start a battle with no background is an error (no-background); the engine warning is not repeated', nb.length > 0 && nb.every((p) => p.level === 'error') && !Kit.refreshValidation().warnings.some((x) => /No battle background/.test(x.message)));
  const grassZones = b.world.zones.field.filter((z) => !z.background);
  b.world.zones.field.forEach((z) => { if (!z.background) { z.empty = true; z.troops = []; } });
  check('DECISION: a zone with no background that can never start a battle (empty) passes', !refsNow().some((p) => p.code === 'no-background') && grassZones.length === nb.length);
  bg[grassBg] = gbg; WORLD.zones.apply();
  // Chapter one loses its ordinary troops (moved to chapter two for the moment), so its tables come out empty.
  const trp = b.rules.trp_, ch1 = WORLD.chapters(b)[0].id, ch2id = WORLD.chapters(b)[1].id, moved = Object.keys(trp).filter((k) => trp[k].chapter === ch1 && !win.ENGINE_WORLD.zones.isBoss(trp[k], b.rules.enm_));
  moved.forEach((k) => { trp[k].chapter = ch2id; });
  WORLD.zones.apply(); res = Kit.refreshValidation();
  const emptyW = res.warnings.filter((x) => /never triggers a battle/.test(x.message));
  check('DECISION: an empty table stays a warning (it never starts a battle) and does not block Final', emptyW.length > 0 && !res.errors.length && !res.broken.length && WORLD.finalBlock(b) === null, { w: emptyW.length, e: res.errors.slice(0, 2).map((x) => x.message), why: WORLD.finalBlock(b) });
  moved.forEach((k) => { trp[k].chapter = ch1; }); WORLD.zones.apply();
  const wth = b.rules.wth_, wthSaved = plain(wth);
  Object.keys(wth).forEach((k) => delete wth[k]);
  check('a zone naming a weather state that was deleted is broken; with no weather at all the zones carry a single warning once regenerated',
    refsNow().some((p) => p.code === 'missing-weather state') && (() => { WORLD.zones.apply(); const r2 = refsNow(); return r2.filter((p) => p.code === 'no-weather' && p.level === 'warning').length === 1 && !r2.some((p) => p.level !== 'warning'); })());
  Object.assign(wth, wthSaved); WORLD.zones.apply();

  // Tile flags edited in the art reach the page's walk (the memo is keyed by flags too) and block Final.
  const dunId = Object.keys(b.art.records.til_).find((k) => /dungeon/.test(k)), wallTile = b.art.records.til_[dunId].tiles.find((x) => x.key === 'wall'), wf0 = wallTile.flags;
  wallTile.flags = 1;
  res = Kit.refreshValidation();
  check('a dungeon wall made passable in the art turns up as flag errors and progression errors (the lock can be walked around) without regenerating, and blocks Final',
    !WORLD.interiors.stale(b) && res.errors.some((x) => x.check === 'flags' && x.code === 'wall-open') && res.errors.some((x) => x.check === 'progression' && /lock-open|interior-/.test(x.code)) && /blocked by/.test(WORLD.finalBlock(b) || ''),
    res.errors.slice(0, 3).map((x) => x.code));
  wallTile.flags = wf0;
  res = Kit.refreshValidation();
  check('restoring the flag clears them again', !res.errors.length && !res.broken.length && res.warnings.length === 1);
  check('the charter, codex, rules, and art are back as they came (only the givers were written outside world)', PRIOR.filter((k) => k !== 'rules').every((k) => canon(b[k]) === canon(orig[k])) &&
    Object.keys(b.rules).every((ns) => ns === 'sdq_' || canon(b.rules[ns]) === canon(orig.rules[ns])));

  // Staleness blocks Final until regenerated.
  b.world.seed = 43; Kit.bundle.touch('seed');
  why = WORLD.finalBlock(b); res = Kit.refreshValidation();
  check('after a reroll Final is blocked (the overworld is out of date) while validation only warns; the walks wait', /overworld is out of date/.test(why || '') && !res.errors.length && !WORLD.checks.walks(b), why);
  WORLD.zones.apply();
  check('generating again clears the block and the new world proves clean', WORLD.finalBlock(b) === null && WORLD.checks.walks(b).progression.ok && WORLD.checks.walks(b).flags.ok);
  b.world.seed = 42; WORLD.zones.apply();

  // Jump links.
  const someDg = WORLD.records.list('dgn_').find((r) => r.role === 'boss');
  Kit.jump(someDg.id);
  await wait(20);
  check('Jump on a dungeon record opens the Sites tab on that site', d.querySelector('[role=tab][aria-selected=true]') && /Sites/.test(d.querySelector('[role=tab][aria-selected=true]').textContent) && WORLD.sitesUi.site === someDg.key);
  const anNpc = WORLD.records.list('npc_')[0];
  Kit.jump(anNpc.id); await wait(20);
  check('Jump on a person opens the Sites tab on the site they live in', WORLD.sitesUi.site === WORLD.records.get(anNpc.site).key);
  Kit.jump(WORLD.records.list('reg_')[0].id); await wait(20);
  check('Jump on a region opens the World tab', /World/.test(d.querySelector('[role=tab][aria-selected=true]').textContent));
  Kit.jump('world', 'zones'); await wait(20);
  const tabNow = () => d.querySelector('[role=tab][aria-selected=true]').textContent;
  const toEnc = /Encounters/.test(tabNow());
  Kit.jump('world', 'progression'); await wait(20);
  check('Jump on the world routes by field: zones to Encounters, progression to Validation', toEnc && /Validation/.test(tabNow()));

  // The Validation tab.
  Kit.go('validation'); Kit.rerender(); await wait(40);
  const ws = () => d.getElementById('ws');
  const cards = ws().querySelectorAll('.w8-vcard');
  check('the Validation tab shows six check cards, all passing, and says the world is ready for a Final export',
    cards.length === 6 && Array.prototype.every.call(cards, (c) => /Pass/.test(c.textContent)) && /Ready for a Final export/.test(ws().textContent), ws().textContent.slice(0, 300));
  const zoneCard = Array.prototype.find.call(cards, (c) => c.dataset.check === 'zones');
  const progCard = Array.prototype.find.call(cards, (c) => c.dataset.check === 'progression');
  check('the Marches warning sits on the Progression card (a graph warning) and nowhere else', /Marches/.test(progCard.textContent) && !/Marches/.test(zoneCard.textContent) && progCard.querySelectorAll('.w8-vitem').length === 1);
  const rows = ws().querySelectorAll('.w8-walk-tbl tbody tr');
  check('the walk table has a row per chapter, each passing, with the ship and airship shown where they are held', rows.length === 6 && Array.prototype.every.call(rows, (r) => /Pass/.test(r.textContent)) && /Ship/.test(rows[2].textContent) && /Airship/.test(rows[4].textContent) && /Shut, opens with the seal/.test(rows[0].textContent));
  check('the flag line reports what was read', /The flag check read \d+ cells on 32 maps/.test(ws().textContent));
  dg.troop = 'trp_missing_zz99'; Kit.bundle.touch('t'); Kit.rerender(); await wait(30);
  const refCard = Array.prototype.find.call(ws().querySelectorAll('.w8-vcard'), (c) => c.dataset.check === 'refs');
  const jb = refCard.querySelector('.w8-jump');
  check('a fault shows Fail on its card with the message and a Jump button, and the head names the block', /Fail/.test(refCard.textContent) && /trp_missing_zz99/.test(refCard.textContent) && jb && /blocked/.test(ws().querySelector('.msg-error').textContent));
  jb.click(); await wait(20);
  check('that Jump button opens the site with the broken reference', WORLD.sitesUi.site === dg.key);
  dg.troop = troop0; Kit.bundle.touch('t');

  // 7. Export: the manifest carries the proof; the Final opens in Days 146 and 147.
  const draft = Kit.buildExport('draft'), dman = JSON.parse(draft.files[1].text);
  check('the Draft manifest carries checks: refs clean, progression and flags ok with every chapter, no Final block', dman.checks && dman.checks.refs.error === 0 && dman.checks.refs.broken === 0 && dman.checks.progression.ok && dman.checks.progression.chapters.length === 6 && dman.checks.flags.ok && dman.checks.finalBlock === null && !dman.unresolved.length);
  let finErr = null, fin = null; try { fin = Kit.buildExport('final'); } catch (e) { finErr = e.message; }
  const fb = fin && JSON.parse(fin.files[0].text), fman = fin && JSON.parse(fin.files[1].text);
  check('Final is allowed, opens world, and its manifest records the passing checks', !finErr && fb.kit.opened.indexOf('world') >= 0 && fman.worldOpened && fman.checks.progression.ok && fb.kit.forges['148'].status === 'final', finErr);
  if (fin) {
    const db = fb;
    const f146 = await in146(fin.files[0].text, (w, K, r) => ({ blocked: (() => { try { K.buildExport('final'); return null; } catch (e) { return e.message; } })(), fwd: r.forward.length, diff: PRIOR.concat(['world']).filter((k) => canon(K.bundle.current()[k]) !== canon(db[k])) }));
    check('Day 146 opens the 148 Final with every namespace identical, 0 broken, 0 forward, and its own Final still allowed', f146.matches && !f146.diff.length && !f146.summary.broken && !f146.summary.errors && !f146.fwd && !f146.blocked, f146);
    const f147 = await in147(fin.files[0].text, (w, K) => ({ diff: PRIOR.concat(['world']).filter((k) => canon(K.bundle.current()[k]) !== canon(db[k])) }));
    check('Day 147 opens the 148 Final with every namespace identical, 0 errors, and 0 broken', f147.matches && !f147.diff.length && !f147.summary.errors && !f147.summary.broken, f147.summary);
  }
  // A hand made overworld (no paramHash) is not held to the completeness rule.
  Kit.bundle.load(win.WORLD_DEMO.fixture('demo')); await wait(20);
  b = Kit.bundle.current();
  WORLD.records.put(WORLD.envelope('map_', 'map|overworld', 'Overworld', { kind: 'overworld', w: 0, h: 0 }));
  check('a hand made overworld with no paramHash is not blocked by the completeness rule and is not walked', WORLD.checks.finalBlock(b) === null && !WORLD.checks.walks(b));
  check('no page errors', !pageErr.length, pageErr.slice(0, 3));

  const n = results.filter((x) => x.ok).length;
  results.forEach((x) => console.log((x.ok ? 'PASS ' : 'FAIL ') + x.name + (x.ok ? '' : '  ' + String(JSON.stringify(x.detail)).slice(0, 700))));
  fs.writeFileSync(path.join(OUT, 'phase6-report.json'), JSON.stringify({ when: new Date().toISOString(), pass: n, total: results.length, walkMs: Math.round(tP / 16), flagMs: Math.round(tF / 16), results }, null, 2));
  console.log('\n' + n + ' of ' + results.length + ' passed');
  process.exit(n === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
