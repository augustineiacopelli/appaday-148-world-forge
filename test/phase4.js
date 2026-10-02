// Phase 4 acceptance: interiors. Three pure generators (towns, built dungeons and castles, caves) take a seed and
// parameters and return maps with exits. Towns are single map cutaways with an inn, shops, a church, and houses joined to
// a plaza by L shaped paths, and people from the ten archetypes at their posts; dungeons and castles split by binary
// space partitioning, with the key chest before the locked door to the goal in breadth first order; caves grown by
// cellular automaton with every pocket tunneled in. Every interior writes a map_ per floor and an npc_ per person, and
// exits link both ways to the overworld. The bundle still round trips through Days 146 and 147.
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
const renFile = fs.readFileSync(path.join(ROOT, 'engine-render.js'), 'utf8');
function context() { const box = vm.createContext({}); vm.runInContext(renFile, box); vm.runInContext(engFile, box, { filename: 'engine-world.js' }); return { E: box.ENGINE_WORLD, R: box.ENGINE_RENDER }; }
const FAST = { E: new Function(engFile + '\nreturn ENGINE_WORLD;')(), R: new Function(renFile + '\nreturn ENGINE_RENDER;')() };
const fixture = (k) => JSON.parse(fs.readFileSync(path.join(OUT, k + '147-bundle.json'), 'utf8'));
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'default';
const xy = (i, w) => [i % w, Math.floor(i / w)];

// The overworld and every site spec the page would hand the engine, built here from a fixture without the page.
function worldFor(ctx, b, seed) {
  const { E, R } = ctx, enm = b.rules.enm_ || {}, trp = b.rules.trp_ || {}, boss = {}, minutes = {};
  Object.keys(trp).sort().forEach((k) => { const t = trp[k]; if (t.chapter && (t.members || []).some((m) => enm[m.enm] && enm[m.enm].isBoss)) (boss[t.chapter] = boss[t.chapter] || []).push(t.id); });
  const chapters = b.charter.sections.chapters.map((c) => { minutes[c.id] = Number(c.targetMinutes) || 60; return { chapter: c.id, name: c.name, continent: slug(c.continentLabel), label: c.continentLabel || 'Default', minutes: minutes[c.id], bosses: (boss[c.id] || []).sort() }; });
  const g = E.progression.build({ chapters }, {});
  g.nodes.forEach((n) => { if (n.kind !== 'gate') n.record = E.ids.structural(n.kind + '_', n.key); });
  g.regions.forEach((r) => { r.record = E.ids.structural('reg_', r.key); });
  const ow = E.overworld.build({ seed, settings: {}, graph: g, minutes, palette: E.overworld.palette(b.art, E.climate.table(b.art, R)) });
  const pal = E.interiors.palette(b.art), arch = [], byKey = {};
  Object.keys(b.art.records.spr_).sort().forEach((k) => { const s = b.art.records.spr_[k]; if (s.subject && s.subject.kind === 'role' && /^npc:/.test(s.subject.ref) && arch.indexOf(s.subject.ref.slice(4)) < 0) arch.push(s.subject.ref.slice(4)); });
  arch.sort();
  g.nodes.forEach((nd) => { byKey[nd.key] = nd; });
  const specs = ow.sites.map((s) => {
    const nd = byKey[s.key] || {}, gr = ow.ground[s.front];
    return { seed: E.hash.seed(seed, 'interior|' + s.key), key: s.key, kind: s.interior, role: s.role, settings: {}, palette: pal, outdoor: String(gr).indexOf(':') < 0 ? gr : null,
      archetypes: arch, prize: s.role === 'key' ? nd.grants[0] : null, troop: nd.troop || null, grants: nd.grants.slice(), finale: !!nd.finale, site: s };
  });
  return { g, ow, pal, specs };
}
const build = (ctx, sp) => ctx.E.interiors.build(Object.assign({}, sp, { site: undefined }));

(async () => {
  const C1 = context(), C2 = context(), E = FAST.E, R = FAST.R, demo = fixture('demo'), four = fixture('four');

  // 1. Determinism and seed independent names.
  const w42 = worldFor(FAST, four, 42), w42a = worldFor(C1, four, 42), w42b = worldFor(C2, four, 42);
  const d42 = w42.specs.map((sp) => build(FAST, sp).digest);
  check('one seed gives identical interiors for all ' + d42.length + ' sites of the four fixture in two vm contexts and the plain context',
    d42.length === 25 && w42a.specs.every((sp, k) => build(C1, sp).digest === d42[k]) && w42b.specs.every((sp, k) => build(C2, sp).digest === d42[k]));
  const w43 = worldFor(FAST, four, 43), d43 = w43.specs.map((sp) => build(FAST, sp).digest);
  check('another seed gives a different interior for every site', d43.every((d, k) => d !== d42[k]));
  const names = (w) => w.specs.map((sp) => { const s = build(FAST, sp); return sp.key + ':' + s.floors.length + ':' + s.npcs.map((p) => p.slot).join(','); }).sort().join('|');
  check('floor counts and NPC slot names never depend on the seed, so map_ and npc_ IDs survive a reroll', names(w42) === names(w43) && w42.specs.every((sp) => canon(E.interiors.slots(sp)) === canon(build(FAST, sp).npcs.map((p) => p.slot))));
  check('each site has its own sub seed from the master seed and its structural key', new Set(w42.specs.map((sp) => sp.seed)).size === 25 && w42.specs.every((sp) => sp.seed === E.hash.seed(42, 'interior|' + sp.key)));

  // 2. Every site of both fixtures on many seeds, and every kind on its own, walks clean.
  let total = 0, okN = 0, firstTry = 0;
  const failures = [];
  for (const [nm, b] of [['demo', demo], ['four', four]]) for (let s = 1; s <= 8; s++) {
    const W = worldFor(FAST, b, s * 101);
    W.specs.forEach((sp) => { const site = build(FAST, sp); total++; if (site.ok) okN++; else failures.push(nm + ' ' + s + ' ' + sp.key + ' ' + site.problems[0].message); if (site.attempts === 1) firstTry++; });
  }
  check('every interior of demo and four on 8 seeds each walks clean (' + okN + ' of ' + total + ', ' + firstTry + ' on the first attempt)', okN === total, failures.slice(0, 4));
  const pal = E.interiors.palette(demo.art), KINDS = [['town', 'start'], ['town', 'town'], ['dungeon', 'key'], ['dungeon', 'boss'], ['castle', 'boss'], ['cave', 'cave']];
  const solo = (kind, role, seed, extra) => E.interiors.build(Object.assign({ seed, key: kind + '|chp_t|' + role, kind, role, settings: {}, palette: pal, outdoor: 'til_grassland_rcre', archetypes: E.interiors.ARCHETYPES, prize: 'item:seal:chp_t', troop: 'trp_t', grants: ['chapter:chp_u'] }, extra || {}));
  let soloBad = [];
  KINDS.forEach(([k, r]) => { for (let s = 1; s <= 40; s++) { const site = solo(k, r, s * 7919); if (!site.ok) soloBad.push(k + '/' + r + '/' + s + ': ' + site.problems[0].message); } });
  check('each of the six site shapes builds clean on 40 seeds (240 sites)', !soloBad.length, soloBad.slice(0, 4));
  const many = solo('dungeon', 'boss', 5, { settings: { interiors: { dungeon: { bossFloors: 4, w: 30, h: 24 } } } }), tiny = solo('town', 'start', 5, { settings: { interiors: { town: { w: 26, h: 22, houses: 6 } } } });
  check('settings take effect: a four floor boss dungeon on 30 by 24 floors, and a town too small at first grows on a later attempt', many.ok && many.floors.length === 4 && many.floors[0].w === 30 && tiny.ok && tiny.floors[0].w >= 26, { many: many.problems, tiny: [tiny.attempts, tiny.floors[0].w] });

  // 3. Tiles and flags through the render engine, for every floor of the four fixture at seed 42.
  const art = four.art, all42 = w42.specs.map((sp) => ({ sp, site: build(FAST, sp) }));
  let wallBad = 0, wallN = 0, refBad = 0, counterN = 0, counterBad = 0, overN = 0, overBad = 0, dFloorN = 0, dFloorBad = 0, bFloorN = 0, bFloorBad = 0, outBad = 0;
  all42.forEach(({ sp, site }) => site.floors.forEach((fl) => {
    const map = { w: fl.w, h: fl.h, ground: fl.ground, deco: fl.deco };
    for (let i = 0; i < fl.ground.length; i++) {
      const g = fl.ground[i], d = fl.deco[i], x = i % fl.w, y = Math.floor(i / fl.w), key = String(g).split(':')[1], dk = d ? String(d).split(':')[1] : null;
      if (!R.tiles.resolve(art, g) || (d && !R.tiles.resolve(art, d))) refBad++;
      const fa = R.tiles.flagsAt(art, map, x, y);
      if (key === 'wall') {
        wallN++;
        const rr = R.tiles.resolve(art, g), m = R.tiles.mask8({ w: fl.w, h: fl.h, cells: fl.ground }, x, y, (c) => c === g), bi = R.tiles.blobIndex(m);
        if (!rr || !rr.autotile || (rr.flags & 1) || !(bi >= 0 && bi < 47)) wallBad++;
      }
      if (key === 'counter') { counterN++; if (fa !== 16) counterBad++; }
      if (dk === 'lintel' || dk === 'arch') { overN++; if (fa !== 33) overBad++; }
      if (key === 'floor' && !d) {
        if (sp.kind === 'town') { bFloorN++; if (fa !== 1) bFloorBad++; } else { dFloorN++; if (fa !== 3) dFloorBad++; }
      }
      if (sp.kind === 'town' && String(g).indexOf(':') < 0 && g !== fl.stats.outdoor && g !== fl.stats.path) outBad++;
    }
  }));
  check('every ground and decoration ref of every floor resolves through tiles.resolve', refBad === 0, refBad);
  check('every wall (' + wallN + ' cells) resolves as an autotiled, blocking tile with a valid blobIndex of its 8 neighbor mask', wallN > 10000 && wallBad === 0, wallBad);
  check('every counter and altar reads flag 16 through flagsAt (' + counterN + ' cells)', counterN > 0 && counterBad === 0, counterBad);
  check('every lintel and arch reads flag 33 through flagsAt (' + overN + ' doors)', overN > 0 && overBad === 0, overBad);
  check('dungeon, castle, and cave floors read flag 3 (' + dFloorN + ' cells); building floors read flag 1 (' + bFloorN + ')', dFloorN > 0 && bFloorN > 0 && dFloorBad === 0 && bFloorBad === 0, { dFloorBad, bFloorBad });
  check('town outdoor ground is the biome in front of the site or the path', outBad === 0 && all42.filter((x) => x.sp.kind === 'town').every((x) => x.site.floors[0].stats.outdoor === x.sp.outdoor), outBad);

  // 4. Built dungeons and castles: leaves, rooms, and the key before the lock.
  let bspBad = [];
  all42.filter((x) => x.sp.kind === 'dungeon' || x.sp.kind === 'castle').forEach(({ sp, site }) => {
    const ml = sp.kind === 'castle' ? 8 : 7;
    site.floors.forEach((fl) => fl.rooms.forEach((r) => {
      const [lx, ly, lw, lh] = r.leaf;
      if (lw < ml || lh < ml || r.w < 3 || r.h < 3 || r.x < lx + 1 || r.y < ly + 1 || r.x + r.w > lx + lw - 1 || r.y + r.h > ly + lh - 1) bspBad.push(sp.key + ' room ' + JSON.stringify(r));
    }));
  });
  check('every leaf is at least the minimum leaf (7, castles 8) and every room is at least 3 by 3, inset inside its leaf', !bspBad.length, bspBad.slice(0, 2));
  let lockBad = [];
  all42.filter((x) => x.sp.kind === 'dungeon' || x.sp.kind === 'castle').forEach(({ sp, site }) => {
    const last = site.floors[site.floors.length - 1], lock = last.features.filter((f) => f.kind === 'lock')[0];
    const key = last.features.filter((f) => f.kind === 'chest' && f.item === (lock && lock.requires[0]))[0];
    const goal = last.features.filter((f) => f.kind === 'boss' || f.prize)[0], arr = last.exits[0].arrive, w = last.w;
    if (!lock || !key || !goal) { lockBad.push(sp.key + ' missing'); return; }
    const shut = E.interiors.reach(w42.pal, last, arr, null), held = {}; held[lock.requires[0]] = true;
    const open = E.interiors.reach(w42.pal, last, arr, held), side = (d, c) => [c - 1, c + 1, c - w, c + w].some((q) => d[q] >= 0);
    const ks = Math.min(...[key.at - 1, key.at + 1, key.at - w, key.at + w].map((q) => shut[q] >= 0 ? shut[q] : 1e9));
    const ok = lock.requires[0] === 'item:key:' + sp.key && side(shut, key.at) && side(shut, lock.at) && shut[lock.at] < 0 &&
      (goal.kind === 'boss' ? shut[goal.at] < 0 && open[goal.at] >= 0 : !side(shut, goal.at) && side(open, goal.at)) && ks < 1e9 &&
      (sp.role === 'key' ? goal.kind === 'chest' && goal.item === sp.prize : goal.kind === 'boss' && goal.troop === sp.troop && canon(goal.grants) === canon(sp.grants));
    if (!ok) lockBad.push(sp.key);
  });
  check('in every dungeon and castle the key chest and the lock are reachable while the lock is shut, the goal is not, and with the key it is; the key dungeon\'s prize is its seal, the boss carries its troop and grants', !lockBad.length, lockBad.slice(0, 3));
  const castle = all42.filter((x) => x.sp.kind === 'castle')[0];
  check('the finale castle has pillars and torches and a boss marked finale', castle && castle.site.floors.some((fl) => fl.ground.some((g) => /:pillar$/.test(g))) && castle.site.floors.some((fl) => fl.deco.some((d) => /:torch$/.test(d || ''))) &&
    castle.site.floors[castle.site.floors.length - 1].features.some((f) => f.kind === 'boss' && f.finale));
  let stairBad = 0;
  all42.forEach(({ site }) => site.floors.forEach((fl) => fl.exits.forEach((ex) => {
    if (ex.toFloor == null) return;
    const o = site.floors[ex.toFloor - 1], back = o && o.exits.filter((e2) => e2.toFloor === fl.floor)[0];
    if (!back || back.kind !== (ex.kind === 'down' ? 'up' : 'down') || !/:stairs$/.test(fl.ground[ex.at]) || !/:stairs$/.test(o.ground[back.at])) stairBad++;
  })));
  check('stairs pair up between floors in both directions, on stairs tiles', stairBad === 0 && all42.some(({ site }) => site.floors.length > 1), stairBad);

  // 5. Caves.
  const caves = [];
  for (let s = 1; s <= 30; s++) caves.push(solo('cave', 'cave', s * 31337));
  const fills = caves.map((c) => c.floors[0].stats.seededFill), comps = caves.map((c) => { const fl = c.floors[0]; return E.overworld.grid.components(fl.w, fl.h, (i) => (pal.flags[fl.deco[i] || fl.ground[i]] & 1) === 1 || /:chest$/.test(fl.deco[i] || '')).sizes.length; });
  check('caves seed near 45 percent fill (' + Math.min(...fills).toFixed(3) + ' to ' + Math.max(...fills).toFixed(3) + ')', fills.every((f) => f > 0.4 && f < 0.5));
  check('every cave is one connected region after tunneling (30 seeds), and pockets were tunneled', comps.every((n) => n === 1) && caves.some((c) => c.floors[0].stats.tunnels > 0), { comps: comps.slice(0, 10), tunnels: caves.map((c) => c.floors[0].stats.tunnels).slice(0, 10) });
  check('every cave is lit by stairs in, a treasure chest at its far end, and at least a fifth of it is open', caves.every((c) => { const fl = c.floors[0]; return /:stairs$/.test(fl.ground[fl.exits[0].at]) && fl.features.some((f) => f.kind === 'chest' && f.treasure) && fl.stats.open >= 0.2; }));

  // 6. Towns.
  const towns = all42.filter((x) => x.sp.kind === 'town');
  const big = towns.filter((x) => x.sp.role === 'start'), small = towns.filter((x) => x.sp.role !== 'start');
  const kinds = (t) => t.site.floors[0].buildings.map((bd) => bd.slot).filter((s) => !/^house/.test(s)).sort().join(',');
  check('start towns have an inn, three shops, and a church; the second town an inn, an item shop, and a church; houses around them',
    big.length === 6 && small.length === 1 && big.every((t) => kinds(t) === 'church,inn,shop:armor,shop:item,shop:weapon' && t.site.floors[0].stats.houses >= 2) && small.every((t) => kinds(t) === 'church,inn,shop:item'), towns.map(kinds));
  let postBad = [];
  towns.forEach(({ sp, site }) => {
    const fl = site.floors[0], w = fl.w, map = { w, h: fl.h, ground: fl.ground, deco: fl.deco };
    site.npcs.forEach((p) => {
      if (E.interiors.ARCHETYPES.indexOf(p.archetype) < 0) postBad.push(p.slot + ' archetype');
      if (p.counter != null && (R.tiles.flagsAt(art, map, ...xy(p.counter, w)) !== 16 || p.counter !== p.at + w)) postBad.push(sp.key + ' ' + p.slot + ' counter');
    });
    const inn = site.npcs.filter((p) => p.slot === 'inn')[0], church = site.npcs.filter((p) => p.slot === 'church')[0];
    if (!inn || inn.archetype !== 'innkeeper' || inn.building !== 'inn') postBad.push(sp.key + ' innkeeper');
    if (!church || church.archetype !== 'healer' || !/dungeon.*:counter$/.test(fl.ground[church.counter])) postBad.push(sp.key + ' altar');
    site.npcs.filter((p) => /^shop:/.test(p.slot)).forEach((p) => { if (p.archetype !== 'merchant' || p.building !== p.slot) postBad.push(sp.key + ' ' + p.slot); });
    if (site.npcs.filter((p) => p.role === 'guard').length !== 2) postBad.push(sp.key + ' guards');
    if (!fl.buildings.filter((bd) => bd.kind === 'inn').every((bd) => fl.deco.filter((d, i) => /:bed$/.test(d || '') && i >= bd.y * w && i < (bd.y + bd.h) * w).length >= 3)) postBad.push(sp.key + ' beds');
  });
  check('the innkeeper stands behind the inn counter, merchants behind their shop counters, the priest behind the altar (the dungeon set\'s counter), two gate guards, beds in the inn, archetypes from the ten', !postBad.length, postBad.slice(0, 4));
  let pathBad = [];
  towns.forEach(({ sp, site }) => {
    const fl = site.floors[0], w = fl.w, h = fl.h, path = fl.stats.path, pz = fl.plaza;
    const onPath = (i) => fl.ground[i] === path || fl.ground[i].endsWith(':door');
    const fromPlaza = E.overworld.grid.bfs(w, h, [(pz[1] + 1) * w + pz[0] + 1], (i) => fl.ground[i] === path);
    fl.buildings.forEach((bd) => { if (fromPlaza[bd.front] < 0) pathBad.push(sp.key + ' ' + bd.slot); });
    if (!fl.exits.every((ex) => fromPlaza[ex.at] >= 0 && Math.floor(ex.at / w) === h - 1)) pathBad.push(sp.key + ' gate');
  });
  check('in every town each door\'s front is joined to the plaza by path tiles, and the plaza runs to the two exit cells on the bottom edge', !pathBad.length, pathBad.slice(0, 4));

  // 7. The checker catches broken interiors.
  const bossD = solo('dungeon', 'boss', 11), lf = bossD.floors[1];
  const caught = (mut) => { const s = JSON.parse(JSON.stringify(bossD)); mut(s); return E.interiors.check(s, pal).map((p) => p.code); };
  const noLock = caught((s) => { s.floors[1].features = s.floors[1].features.filter((f) => f.kind !== 'lock'); });
  const noKey = caught((s) => { s.floors[1].features = s.floors[1].features.filter((f) => !(f.kind === 'chest' && /^item:key:/.test(f.item || ''))); });
  const orphan = caught((s) => { const fl = s.floors[0]; for (let i = fl.w + 1; i < fl.ground.length; i++) if (/:wall$/.test(fl.ground[i]) && fl.ground.slice(i - fl.w - 1, i - fl.w + 2).every((g) => /:wall$/.test(g)) && fl.ground.slice(i + fl.w - 1, i + fl.w + 2).every((g) => /:wall$/.test(g)) && /:wall$/.test(fl.ground[i - 1]) && /:wall$/.test(fl.ground[i + 1])) { fl.ground[i] = fl.ground[fl.exits[0].arrive]; break; } });
  const lonely = caught((s) => { s.floors[0].exits = s.floors[0].exits.filter((e) => e.kind !== 'down'); });
  check('the walking check catches a missing lock, a missing key chest, a stray floor cell, and stairs without a partner',
    noLock.indexOf('no-lock') >= 0, { noLock, noKey, orphan, lonely });
  check('... the key chest, the orphan, and the stairs each by their own code', noKey.indexOf('key-after-lock') >= 0 && orphan.indexOf('orphan') >= 0 && lonely.indexOf('stairs') >= 0, { noKey, orphan, lonely });

  // 8. Speed, in a plain context.
  const t0 = Date.now(); w43.specs.forEach((sp) => build(FAST, Object.assign({}, sp, { seed: sp.seed + 1 }))); const ms = Date.now() - t0;
  check('all 25 interiors of the four fixture build in ' + ms + ' ms in a plain context (under 1500)', ms < 1500, ms);

  // 9. The page.
  const { win, errors } = await boot148();
  const Kit = win.Kit, WORLD = win.WORLD, d = win.document, EW = win.ENGINE_WORLD;
  Kit.bundle.load(win.WORLD_DEMO.fixture('four')); await wait(10);
  let b = Kit.bundle.current();
  b.world.seed = 42;
  const before = JSON.parse(JSON.stringify(b));
  check('nothing is generated before apply', !WORLD.interiors.generated() && !WORLD.interiors.stale());
  const r1 = WORLD.interiors.apply();
  const maps = WORLD.interiors.maps(), npcs = WORLD.records.list('npc_'), owRec = WORLD.overworld.record();
  check('apply generates the overworld first, then writes 31 interior map_ records and 87 npc_ records for 25 sites', r1.sites === 25 && r1.floors === 31 && r1.people === 87 && maps.length === 31 && npcs.length === 87 && owRec && owRec.paramHash, r1);
  check('map_ and npc_ IDs derive from map|<site key>|<floor> and npc|<site key>|<slot>', maps.every((m) => m.id === EW.ids.structural('map_', m.key) && /^map\|(twn|dgn)\|chp_[^|]+\|[a-z0-9]+\|\d+$/.test(m.key)) && npcs.every((p) => p.id === EW.ids.structural('npc_', p.key) && p.key === 'npc|' + p.key.slice(4, p.key.lastIndexOf('|')) + '|' + p.slot));
  const pageDig = {}; maps.forEach((m) => { pageDig[m.key] = m.digest; });
  const engDig = {}; all42.forEach(({ sp, site }) => site.floors.forEach((fl) => { engDig['map|' + sp.key + '|' + fl.floor] = fl.digest; }));
  check('the page builds the very floors the engine builds outside it (all 31 digests match at seed 42)', canon(pageDig) === canon(engDig));
  check('records hold kind, site, chapter, floor, size, seed, version, hash, digest, tileset, exits, features, and people, and no tile arrays',
    maps.every((m) => m.site && WORLD.records.get(m.site) && m.chapter && m.floor >= 1 && m.w && m.h && m.paramHash && m.digest && m.generatorVersion === EW.version && b.art.records.til_[m.tileset] && Array.isArray(m.exits) && Array.isArray(m.features) && !('ground' in m) && !('deco' in m)) &&
    JSON.stringify(b.world.records).length < 400000, JSON.stringify(b.world.records).length);
  check('every person names its map, cell, slot, archetype, and a Day 147 field sprite for that archetype', npcs.every((p) => WORLD.records.get(p.map) && Array.isArray(p.at) && p.slot && p.archetype && b.art.records.spr_[p.sprite] && b.art.records.spr_[p.sprite].subject.ref === 'npc:' + p.archetype));
  // Two way links.
  let linkBad = [];
  (owRec.sites || []).forEach((s) => {
    const site = WORLD.records.get(s.site), m1 = WORLD.records.get(s.enter && s.enter.map);
    if (!m1 || m1.floor !== 1 || m1.site !== s.site) { linkBad.push(s.key + ' enter'); return; }
    const out = m1.exits.filter((e) => e.kind === 'overworld');
    if (!out.length || !out.every((e) => e.to.map === owRec.id && canon(e.to.at) === canon(s.front))) linkBad.push(s.key + ' out');
    if (!out.some((e) => canon(e.arrive) === canon(s.enter.at))) linkBad.push(s.key + ' arrive');
    if (!site || canon(site.entrance) !== canon(s.enter) || canon(site.overworld) !== canon({ map: owRec.id, at: s.front }) || site.maps[0] !== m1.id) linkBad.push(s.key + ' record');
  });
  maps.forEach((m) => m.exits.filter((e) => e.kind !== 'overworld').forEach((e) => {
    const o = WORLD.records.get(e.to.map), back = o && o.exits.filter((x) => x.to.map === m.id)[0];
    if (!o || !back || canon(back.arrive) !== canon(e.to.at) || canon(e.arrive) !== canon(back.to.at)) linkBad.push(m.key + ' stairs');
  }));
  check('exits link both ways: every overworld site enters floor 1 at a cell whose way out leads back to the cell in front of the site, the site record holds both ends, and stairs name each other\'s arrival', !linkBad.length, linkBad.slice(0, 4));
  check('site records list their maps and people', WORLD.records.list('twn_').every((t) => t.maps.length === 1 && t.people.length >= 9 && t.people.every((p) => WORLD.records.get(p))) && WORLD.records.list('dgn_').every((x) => x.maps.length >= 1 && x.maps.every((m) => WORLD.records.get(m))));
  check('no field named id inside any world record', ['map_', 'npc_', 'twn_', 'dgn_'].every((p) => WORLD.records.list(p).every((r) => !/"id"\s*:/.test(JSON.stringify(Object.assign({}, r, { id: undefined }))))));
  check('charter, codex, rules, and art are untouched; sdq_ givers are left for Phase 5', PRIOR.every((k) => canon(b[k]) === canon(before[k])));
  let res = Kit.refreshValidation();
  check('the generated four fixture validates with no errors, no broken references, and only the Marches boss warning', !res.errors.length && !res.broken.length && res.warnings.length === 1 && /Marches/.test(res.warnings[0].message), { s: Kit.validate.summary(res), w: res.warnings.map((x) => x.message).slice(0, 3), e: res.errors.slice(0, 2).map((x) => x.message) });
  const ids0 = JSON.stringify(Object.keys(b.world.records).map((p) => Object.keys(b.world.records[p]).sort()));
  b.world.seed = 43; Kit.bundle.touch('seed');
  res = Kit.refreshValidation();
  check('after a reroll the interiors are stale and validation says so', WORLD.interiors.stale() && res.warnings.some((x) => /Generate them again on the Sites tab/.test(x.message)));
  WORLD.interiors.apply();
  check('generating again clears the warning, keeps every world ID, and changes every floor', !WORLD.interiors.stale() && JSON.stringify(Object.keys(b.world.records).map((p) => Object.keys(b.world.records[p]).sort())) === ids0 &&
    WORLD.interiors.maps().every((m) => m.digest !== pageDig[m.key]));
  WORLD.overworld.apply();
  check('regenerating the overworld alone drops its enter links, which marks the interiors stale', WORLD.interiors.stale() && !(WORLD.overworld.record().sites[0].enter));
  WORLD.interiors.apply();
  check('and generating the interiors again restores them', !WORLD.interiors.stale() && WORLD.overworld.record().sites.every((s) => s.enter));
  const u = WORLD.interiors.maps()[0]; u.origin = 'user'; u.name = 'Hand made';
  const uk = WORLD.interiors.apply();
  check('a map_ record marked user made is kept on generate', uk.kept.indexOf(u.id) >= 0 && WORLD.records.get(u.id).name === 'Hand made');
  u.origin = 'generated';
  b.world.settings.interiors = { town: { residents: 3 } };
  const fewer = WORLD.interiors.apply();
  check('fewer residents in the settings removes the npc_ records no site makes any more', fewer.removed === 18 && WORLD.records.list('npc_').length === 69, fewer);
  delete b.world.settings.interiors; b.world.seed = 42; WORLD.interiors.apply();
  check('settings restored: 87 people again', WORLD.records.list('npc_').length === 87);

  // 10. Export and round trip.
  const draft = Kit.buildExport('draft'), db = JSON.parse(draft.files[0].text), man = JSON.parse(draft.files[1].text);
  check('Draft manifest lists 150 created world IDs (32 before plus 31 maps and 87 people) and nothing unresolved', man.created.length === 150 && !man.unresolved.length && man.counts.map_ === 32 && man.counts.npc_ === 87, { created: man.created.length, unresolved: man.unresolved, counts: man.counts });
  const fourText = JSON.stringify(win.WORLD_DEMO.fixture('four'));
  const base146 = await in146(fourText), base147 = await in147(fourText);
  const r146 = await in146(draft.files[0].text, (w, K) => ({ diff: PRIOR.concat(['world']).filter((k) => canon(K.bundle.current()[k]) !== canon(db[k])) }));
  check('Day 146 opens the Draft with interiors, every namespace identical and no new errors', r146.matches && !r146.diff.length && canon(r146.summary) === canon(base146.summary) && canon(r146.errors) === canon(base146.errors), { diff: r146.diff, now: r146.summary, before: base146.summary, e: r146.errors.slice(0, 2) });
  const r147 = await in147(draft.files[0].text, (w, K) => ({ diff: PRIOR.concat(['world']).filter((k) => canon(K.bundle.current()[k]) !== canon(db[k])), cov: w.ART.coverage.compute(K.bundle.current()).green }));
  check('Day 147 opens the Draft with interiors, every namespace identical, coverage green, and no new errors', r147.matches && !r147.diff.length && r147.cov && canon(r147.summary) === canon(base147.summary) && canon(r147.errors) === canon(base147.errors), { diff: r147.diff, now: r147.summary, before: base147.summary });

  // 11. The Sites tab.
  Kit.bundle.load(win.WORLD_DEMO.fixture('demo')); await wait(10);
  Kit.bundle.current().world.seed = 42;
  Kit.go('sites'); await wait(20);
  const ws = () => d.getElementById('ws');
  const gen = Array.prototype.find.call(ws().querySelectorAll('button'), (x) => /Generate every interior/.test(x.textContent));
  check('the Sites tab offers Generate every interior before anything exists', !!gen && !ws().querySelector('canvas'));
  gen.click(); await wait(40);
  let cv = ws().querySelector('.w8-imap canvas'), txt = ws().textContent;
  check('after Generate: chips for 3 towns, dungeons, a castle, and caves, a preview canvas of the first site, and nine site rows', cv && cv.dataset.drawn !== undefined && /3 towns/.test(txt) && /1 castle/.test(txt) && /35 people/.test(txt) && ws().querySelectorAll('.w8-sites tbody tr').length === 9 && WORLD.interiors.maps().length === 11, txt.slice(0, 300));
  const pick = Array.prototype.find.call(ws().querySelectorAll('.w8-pick'), (x) => /boss/.test(x.dataset.site));
  pick.click(); await wait(30);
  const segs = ws().querySelectorAll('.w8-seg-btn');
  check('Preview on the boss dungeon shows it with a two floor switch as a radio group', ws().querySelector('.w8-imap canvas').dataset.site === pick.dataset.site && segs.length === 2 && ws().querySelector('.w8-seg').getAttribute('role') === 'radiogroup' && /Stairs down/.test(ws().textContent));
  segs[1].click(); await wait(30);
  check('choosing Floor 2 draws floor 2 with its locked door and boss listed', ws().querySelector('.w8-imap canvas').dataset.floor === '2' && /Locked door/.test(ws().textContent) && /Key chest/.test(ws().textContent));
  const townPick = Array.prototype.find.call(ws().querySelectorAll('.w8-pick'), (x) => /start/.test(x.dataset.site));
  townPick.click(); await wait(30);
  check('a town preview lists its people with archetype and place', /Innkeeper/.test(ws().textContent) && /Inn/.test(ws().textContent) && /At the gate/.test(ws().textContent) && ws().querySelectorAll('.w8-site tbody tr').length === 13);
  check('no page errors', !errors.length, errors.slice(0, 3));

  // Pictures for the log.
  try {
    const png = require('./png');
    if (png.writeGrid) {
      const pick2 = (role, kind) => all42.filter((x) => x.sp.role === role && (!kind || x.sp.kind === kind))[0];
      png.writeGrid(path.join(OUT, 'phase4-town.png'), pick2('start').site.floors[0], 6);
      const bd = pick2('boss', 'dungeon').site; png.writeGrid(path.join(OUT, 'phase4-dungeon.png'), bd.floors[bd.floors.length - 1], 6);
      png.writeGrid(path.join(OUT, 'phase4-cave.png'), pick2('cave').site.floors[0], 6);
    }
  } catch (e) { console.log('png: ' + e.message); }

  const pass = results.filter((x) => x.ok).length;
  results.forEach((x) => console.log((x.ok ? 'PASS ' : 'FAIL ') + x.name + (x.ok ? '' : '  ' + String(JSON.stringify(x.detail)).slice(0, 700))));
  fs.writeFileSync(path.join(OUT, 'phase4-report.json'), JSON.stringify({ when: new Date().toISOString(), pass, total: results.length, buildMs: ms, firstTry: firstTry + '/' + total, results }, null, 2));
  console.log('\n' + pass + ' of ' + results.length + ' passed');
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
