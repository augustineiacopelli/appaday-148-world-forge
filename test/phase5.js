// Phase 5 tests: encounter zones. The engine is checked on its own (determinism across contexts, seed independent troop
// tables, flag 2 coverage, the 5 5 5 1 slots, rates, backgrounds, weather, overrides, spare bosses, givers), then the page
// (records, the one write outside world, validation, staleness, export, the Final opening world, Days 146 and 147, and
// the Encounters tab). Run from test/: node phase5.js
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
const plain = (o) => JSON.parse(JSON.stringify(o));

// Everything the page hands the zone engine, rebuilt here from a fixture without the page (an independent reading of
// the plan, so the page's digest matching this one proves the WORLD side gathers the same spec).
function worldFor(ctx, b, seed, settings) {
  const { E, R } = ctx, enm = b.rules.enm_ || {}, trp = b.rules.trp_ || {}, boss = {}, minutes = {};
  settings = settings || {};
  Object.keys(trp).sort().forEach((k) => { const t = trp[k]; if (t.chapter && E.zones.isBoss(t, enm)) (boss[t.chapter] = boss[t.chapter] || []).push(t.id); });
  const chs = b.charter.sections.chapters;
  const chapters = chs.map((c) => { minutes[c.id] = Number(c.targetMinutes) || 60; return { chapter: c.id, name: c.name, continent: slug(c.continentLabel), label: c.continentLabel || 'Default', minutes: minutes[c.id], bosses: (boss[c.id] || []).sort() }; });
  const g = E.progression.build({ chapters }, settings);
  g.nodes.forEach((n) => { if (n.kind !== 'gate') n.record = E.ids.structural(n.kind + '_', n.key); });
  g.regions.forEach((r) => { r.record = E.ids.structural('reg_', r.key); });
  const ow = E.overworld.build({ seed, settings, graph: g, minutes, palette: E.overworld.palette(b.art, E.climate.table(b.art, R)) });
  const pal = E.interiors.palette(b.art), arch = [], byKey = {}, til = b.art.records.til_;
  Object.keys(b.art.records.spr_).sort().forEach((k) => { const s = b.art.records.spr_[k]; if (s.subject && s.subject.kind === 'role' && /^npc:/.test(s.subject.ref) && arch.indexOf(s.subject.ref.slice(4)) < 0) arch.push(s.subject.ref.slice(4)); });
  arch.sort();
  g.nodes.forEach((nd) => { byKey[nd.key] = nd; });
  const sites = ow.sites.map((s) => {
    const nd = byKey[s.key] || {}, gr = ow.ground[s.front];
    const sp = { seed: E.hash.seed(seed, 'interior|' + s.key), key: s.key, kind: s.interior, role: s.role, settings, palette: pal, outdoor: String(gr).indexOf(':') < 0 ? gr : null,
      archetypes: arch, prize: s.role === 'key' ? nd.grants[0] : null, troop: nd.troop || null, grants: nd.grants.slice(), finale: !!nd.finale };
    return { s, sp, site: E.interiors.build(sp) };
  });
  const biomes = {}; Object.keys(til).sort().forEach((id) => { if (til[id].kind === 'biome') biomes[id] = til[id].key || id; });
  const bg = {}; Object.keys(b.art.records.bgd_).sort().forEach((id) => { const x = b.art.records.bgd_[id]; if (x.subject && x.subject.kind === 'role' && !bg[x.subject.ref]) bg[x.subject.ref] = id; });
  const field = E.zones.fieldCells(ow, biomes).map((f) => Object.assign({}, f, { region: E.ids.structural('reg_', f.region), ref: til[f.biome].subject.ref }));
  const zch = chs.map((c) => {
    const troops = [], bosses = [];
    Object.keys(trp).sort().forEach((id) => { const t = trp[id]; if (t.chapter !== c.id) return; if (E.zones.isBoss(t, enm)) bosses.push(id); else troops.push({ troop: id, power: E.zones.power(t, enm) }); });
    return { chapter: c.id, continent: slug(c.continentLabel), troops, bosses };
  });
  const interiors = [], bossSites = [], caves = [], keys = [];
  const rows = [];
  sites.filter((x) => x.sp.kind !== 'town').forEach((x) => x.site.floors.forEach((fl) => rows.push({ x, fl, mk: 'map|' + x.s.key + '|' + fl.floor })));
  rows.sort((a, c) => (a.mk < c.mk ? -1 : 1));
  rows.forEach(({ x, fl, mk }) => {
    const map = E.ids.structural('map_', mk), site = x.s.record, ref = til[(pal.sets[x.sp.kind] || pal.sets.dungeon).til].subject.ref, ch = x.s.chapter;
    interiors.push({ key: x.s.key, site, map, kind: x.sp.kind, chapter: ch, floor: fl.floor, floors: x.site.floors.length, cells: E.zones.floorCells(fl, pal.flags), ref });
    fl.features.forEach((ft) => {
      const at = xy(ft.at, fl.w);
      if (ft.kind === 'boss') bossSites.push({ site, map, at, troop: ft.troop || null, chapter: ch, ref, finale: !!ft.finale });
      else if (ft.kind === 'chest' && ft.treasure && /^cave/.test(x.s.role)) caves.push({ chapter: ch, site, map, at, ref, kind: 'cave' });
      else if (ft.kind === 'chest' && ft.prize) keys.push({ chapter: ch, site, map, at, ref, kind: 'key' });
    });
  });
  const weather = Object.keys(b.rules.wth_ || {}).map((id) => ({ weather: id, name: b.rules.wth_[id].name, text: b.rules.wth_[id].realWorld || '' }));
  const zspec = { settings, chapters: zch, field, interiors, backgrounds: bg, weather, bossSites, spareSlots: caves.concat(keys), overrides: {} };
  return { g, ow, pal, sites, biomes, zspec };
}

(async () => {
  const C1 = context(), C2 = context(), E = FAST.E, demo = fixture('demo'), four = fixture('four');
  const enm4 = four.rules.enm_, trp4 = four.rules.trp_, til4 = four.art.records.til_, bgd4 = four.art.records.bgd_;

  // 1. Determinism.
  const W42 = worldFor(FAST, four, 42), Z42 = E.zones.build(W42.zspec);
  const za = C1.E.zones.build(worldFor(C1, four, 42).zspec), zb = C2.E.zones.build(worldFor(C2, four, 42).zspec);
  check('one seed gives identical zones, bosses, and digests in two vm contexts and the plain context (' + Z42.field.length + ' field, ' + Z42.interior.length + ' interior)',
    za.digest === Z42.digest && zb.digest === Z42.digest && canon(plain(za)) === canon(plain(Z42)) && Z42.field.length > 20 && Z42.interior.length === 24);
  const W43 = worldFor(FAST, four, 43), Z43 = E.zones.build(W43.zspec);
  check('another seed moves the cells: a different digest and different cell counts', Z43.digest !== Z42.digest && canon(Z43.field.map((z) => z.cells)) !== canon(Z42.field.map((z) => z.cells)));
  const shared = Z42.field.filter((z) => Z43.field.some((q) => q.key === z.key));
  check('a zone key present under both seeds draws the same troops with the same weights (tables never depend on the seed)',
    shared.length > 20 && shared.every((z) => canon(Z43.field.filter((q) => q.key === z.key)[0].troops) === canon(z.troops)) && canon(Z43.interior.map((z) => z.key + canon(z.troops))) === canon(Z42.interior.map((z) => z.key + canon(z.troops))));
  check('interior zone keys and boss placements by site never depend on the seed', canon(Z43.interior.map((z) => z.key)) === canon(Z42.interior.map((z) => z.key)) && canon(Z43.bosses.map((x) => x.site + x.troop)) === canon(Z42.bosses.map((x) => x.site + x.troop)));

  // 2. Coverage: zones are exactly the flag 2 overworld cells.
  function coverage(W, Z) {
    const ow = W.ow, n = ow.ground.length, keyOf = {}; let f2 = 0, bad = [];
    Z.field.forEach((z) => { keyOf[z.key] = z; });
    const tally = {};
    for (let i = 0; i < n; i++) {
      const g = ow.ground[i], f = ow.flags[g] | 0, k = E.zones.cellKey(ow, i, W.biomes);
      if (String(g).indexOf(':') < 0 && (f & 2)) { f2++; if (!k) bad.push('missing ' + i); else tally[k] = (tally[k] || 0) + 1; }
      else if (k) bad.push('extra ' + i);
      if (k) { const z = keyOf[k], r = ow.regions[ow.region[i]]; if (!z || z.chapter !== r.chapter || z.continent !== r.continent || z.biome !== g) bad.push('wrong ' + i); }
    }
    Object.keys(tally).forEach((k) => { if (keyOf[k].cells !== tally[k]) bad.push('count ' + k); });
    return { f2, sum: Z.field.reduce((s, z) => s + z.cells, 0), bad };
  }
  const cv = coverage(W42, Z42);
  check('field zone cells sum to the overworld cells whose ground carries flag 2 (' + cv.f2 + '), each cell in the zone of its region\'s chapter, continent, and biome', cv.sum === cv.f2 && !cv.bad.length, cv.bad.slice(0, 4));
  const sea = W42.ow.ground.filter((g) => g === W42.ow.ground[0]).length;
  check('no zone for ocean, mountains, lakes, gates, or site stamps', Z42.field.every((z) => ['ocean', 'mountain'].indexOf(z.biomeKey) < 0 && String(z.biome).indexOf(':') < 0) && sea > 0);
  let allCov = true; const covBad = [];
  for (const [nm, b] of [['demo', demo], ['four', four]]) for (let s = 1; s <= 6; s++) { const W = worldFor(FAST, b, s * 911), c = coverage(W, E.zones.build(W.zspec)); if (c.sum !== c.f2 || c.bad.length) { allCov = false; covBad.push(nm + s); } }
  check('the same holds for demo and four on six more seeds each', allCov, covBad);
  const shareCont = Z42.field.filter((z) => z.continent === 'westland'), westCh = new Set(shareCont.map((z) => z.chapter));
  check('a continent shared by two chapters (Westland) has separate tables per chapter, each drawing only its own chapter\'s troops', westCh.size === 2 &&
    Z42.field.concat(Z42.interior).every((z) => z.troops.every((t) => trp4[t.troop].chapter === z.chapter)));
  check('towns have no zone; every dungeon, castle, and cave floor has exactly one', !Z42.interior.some((z) => /\|twn\|/.test(z.key) || /^zone\|twn/.test(z.key)) &&
    W42.sites.filter((x) => x.sp.kind !== 'town').reduce((s, x) => s + x.site.floors.length, 0) === Z42.interior.length &&
    new Set(Z42.interior.map((z) => z.key)).size === Z42.interior.length && Z42.interior.every((z) => z.key === E.zones.interiorKey(z.key.replace(/^zone\|/, '').replace(/\|\d+$/, ''), z.floor)));
  check('interior cells count the floor cells carrying flag 2, every dungeon and cave floor has some', Z42.interior.every((z) => z.cells > 20));

  // 3. Tables: the 5 5 5 1 pattern, no bosses, strongest rare.
  const allZ = Z42.field.concat(Z42.interior);
  check('every table\'s weights sum to 16 over four slots, in slot weights 5 5 5 1', allZ.every((z) => z.slots.length === 4 && z.troops.reduce((s, t) => s + t.weight, 0) === 16 &&
    z.troops.every((t) => t.weight === [5, 5, 5, 1].filter((w, k) => z.slots[k] === t.troop).reduce((s, w) => s + w, 0))));
  check('no zone draws a troop with a boss member; at most four troops per table', allZ.every((z) => z.troops.length <= 4 && z.troops.every((t) => !E.zones.isBoss(trp4[t.troop], enm4))));
  check('the rare slot holds the chapter\'s strongest non boss troop', allZ.every((z) => {
    const mine = Object.keys(trp4).filter((id) => trp4[id].chapter === z.chapter && !E.zones.isBoss(trp4[id], enm4)).sort((a, c) => E.zones.power(trp4[c], enm4) - E.zones.power(trp4[a], enm4) || (a < c ? -1 : 1));
    return z.rare === mine[0] && z.slots[3] === mine[0];
  }));
  const T = (n) => Array.from({ length: n }, (_, k) => ({ troop: 'trp_t' + k, power: (k + 1) * 10 }));
  const s1 = E.zones.slots(T(1), 'a'), s2 = E.zones.slots(T(2), 'a'), s3 = E.zones.slots(T(3), 'a'), s4 = E.zones.slots(T(4), 'a'), s7 = E.zones.slots(T(7), 'a');
  check('one troop takes all 16; two give 15 and 1; three give 10, 5, and 1; four give 5, 5, 5, 1', canon(s1.troops) === canon([{ troop: 'trp_t0', weight: 16 }]) &&
    canon(s2.troops.map((t) => t.weight).sort((a, c) => c - a)) === '[15,1]' && canon(s3.troops.map((t) => t.weight).sort((a, c) => c - a)) === '[10,5,1]' && canon(s4.troops.map((t) => t.weight).sort((a, c) => c - a)) === '[5,5,5,1]' && s4.rare === 'trp_t3');
  const mixes = new Set(['zone|a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k) => E.zones.slots(T(7), k).slots.slice(0, 3).sort().join()));
  check('with seven troops each table draws three of the six commons, and different zone keys draw different mixes (' + mixes.size + ' of 8)', s7.troops.length === 4 && s7.rare === 'trp_t6' && mixes.size >= 4);
  check('the empty case: no troops makes an empty table and a warning', (() => { const z = E.zones.build({ chapters: [{ chapter: 'chp_a', troops: [], bosses: [] }], field: [{ key: 'k', chapter: 'chp_a', biomeKey: 'grassland', cells: 4, ref: 'biome:grassland' }], backgrounds: { 'biome:grassland': 'bgd_x' } }); return z.field[0].empty && z.field[0].troops.length === 0 && z.warnings.some((w) => w.code === 'no-troops'); })());

  // 4. Rates.
  const S0 = E.zones.settings({}), chIdx = {}; four.charter.sections.chapters.forEach((c, k) => { chIdx[c.id] = k; });
  const expRate = (base, ch, floor) => Math.min(255, Math.floor(base * (1 + 0.5 * chIdx[ch] / 5) * (1 + 0.15 * ((floor || 1) - 1)) + 0.5));
  check('field rates are the biome default scaled by chapter (one and a half times by the last chapter)', Z42.field.every((z) => z.baseRate === (S0.rates[z.biomeKey] == null ? S0.rates.default : S0.rates[z.biomeKey]) && z.rate === expRate(z.baseRate, z.chapter)));
  check('interior rates come from the kind (dungeon 12, castle 10, cave 14), rising by floor', Z42.interior.every((z) => { const k = W42.zspec.interiors.filter((m) => m.map === z.map)[0].kind; return z.baseRate === S0.interiorRates[k] && z.rate === expRate(z.baseRate, z.chapter, z.floor); }) &&
    Z42.interior.some((z) => z.floor === 2 && Z42.interior.some((q) => q.key === z.key.replace(/2$/, '1') && q.rate < z.rate)));
  const Zs = E.zones.build(Object.assign({}, W42.zspec, { settings: { zones: { rates: { grassland: 40 }, interiorRates: { cave: 0 }, chapterScale: 0, slots: [4, 4, 4, 4] } } }));
  check('settings take effect: a grassland rate, a silent cave, no chapter scaling, and custom slot weights', Zs.field.filter((z) => z.biomeKey === 'grassland').every((z) => z.rate === 40) &&
    Zs.interior.filter((z) => /cave/.test(z.key)).every((z) => z.rate === 0) && Zs.field.filter((z) => z.biomeKey === 'forest').every((z) => z.rate === 12) && Zs.field.every((z) => z.troops.reduce((s, t) => s + t.weight, 0) === 16));

  // 5. Backgrounds, weather, music.
  check('every field zone\'s background has the role of its biome tileset; every interior uses the dungeon background', Z42.field.every((z) => z.background && bgd4[z.background].subject.ref === til4[z.biome].subject.ref) &&
    Z42.interior.every((z) => z.background && bgd4[z.background].subject.ref === 'interior:dungeon'));
  const wName = (id) => four.rules.wth_[id].name;
  check('weather by biome keyword: snow and tundra Snow, swamp and rainforest Rain, grassland and desert Clear, interiors Clear', Z42.field.every((z) => {
    const w = wName(z.weather); return ({ snow: 'Snow', tundra: 'Snow', swamp: 'Rain', rainforest: 'Rain', grassland: 'Clear', desert: 'Clear' })[z.biomeKey] ? w === ({ snow: 'Snow', tundra: 'Snow', swamp: 'Rain', rainforest: 'Rain', grassland: 'Clear', desert: 'Clear' })[z.biomeKey] : !!w;
  }) && Z42.interior.every((z) => wName(z.weather) === 'Clear'));
  check('with no keyword match the first wth_ is used, and with no weather at all it is null', E.zones.weatherFor('volcanic', [{ weather: 'wth_b', name: 'Breeze' }, { weather: 'wth_c', name: 'Calm' }]) === 'wth_b' && E.zones.weatherFor('snow', []) === null &&
    E.zones.weatherFor('volcanic', [{ weather: 'wth_b', name: 'Breeze' }, { weather: 'wth_a', name: 'Ashfall', text: 'volcanic ash' }]) === 'wth_a');
  check('a missing background is a warning, never a crash', (() => { const z = E.zones.build(Object.assign({}, W42.zspec, { backgrounds: {} })); return z.field.every((q) => q.background === null) && z.warnings.filter((w) => w.code === 'no-background').length === z.field.length + z.interior.length; })());
  check('zones play the battle music; bosses the boss music', allZ.every((z) => z.music === 'battle') && Z42.bosses.every((x) => x.music === 'boss'));

  // 6. Overrides.
  const zk = Z42.field[0], ovr = {}; ovr[zk.key] = { rate: 3, weights: {} }; ovr[zk.key].weights[zk.troops[0].troop] = 9;
  const Zo = E.zones.build(Object.assign({}, W42.zspec, { overrides: ovr })), zo = Zo.field.filter((z) => z.key === zk.key)[0];
  check('a sparse override sets one zone\'s rate and a troop weight and marks it; other zones are untouched', zo.rate === 3 && zo.troops[0].weight === 9 && zo.overridden && Zo.field.filter((z) => z.overridden).length === 1);

  // 7. Bosses and spare bosses.
  check('every boss dungeon and the castle has its boss on the boss feature; the Marches slot is empty for Day 149', Z42.bosses.length === 6 && Z42.bosses.every((x) => x.role === 'boss') &&
    Z42.bosses.filter((x) => !x.troop).length === 1 && /marches/.test(Z42.bosses.filter((x) => !x.troop)[0].chapter) && Z42.bosses.filter((x) => x.finale).length === 1);
  const four2 = fixture('four'), ch1 = four2.charter.sections.chapters[0].id, king = Object.keys(four2.rules.trp_).filter((id) => four2.rules.trp_[id].chapter === ch1 && E.zones.isBoss(four2.rules.trp_[id], four2.rules.enm_))[0];
  ['trp_spare_a_aaaa', 'trp_spare_b_bbbb', 'trp_spare_c_cccc'].forEach((id) => { four2.rules.trp_[id] = Object.assign(plain(four2.rules.trp_[king]), { id, name: id }); });
  const Wsp = worldFor(FAST, four2, 42), Zsp = E.zones.build(Wsp.zspec), guards = Zsp.bosses.filter((x) => x.role === 'guardian');
  check('three spare boss troops in chapter one: one guards the cave treasure, one the key dungeon prize, the third is a warning; the boss keeps the first',
    guards.length === 2 && guards[0].guards === 'cave' && guards[1].guards === 'key' && Zsp.warnings.filter((w) => w.code === 'spare-boss').length === 1 &&
    Zsp.bosses.filter((x) => x.role === 'boss' && x.chapter === ch1)[0].troop === [king, 'trp_spare_a_aaaa', 'trp_spare_b_bbbb', 'trp_spare_c_cccc'].sort()[0] &&
    Zsp.field.concat(Zsp.interior).every((z) => z.troops.every((t) => t.troop.indexOf('spare') < 0)));

  // 8. Givers (engine).
  const gp = [{ npc: 'npc_inn', chapter: 'c1', town: 0, slot: 'inn', role: 'innkeeper' }, { npc: 'npc_r2', chapter: 'c1', town: 0, slot: 'resident2', role: 'resident' },
    { npc: 'npc_r10', chapter: 'c1', town: 0, slot: 'resident10', role: 'resident' }, { npc: 'npc_g', chapter: 'c1', town: 0, slot: 'guard1', role: 'guard' }, { npc: 'npc_x', chapter: 'c3', town: 2, slot: 'resident1', role: 'resident' }];
  const gq = E.zones.givers({ chapters: ['c1', 'c2', 'c3'], people: gp, quests: [{ quest: 'sdq_a', chapter: 'c1' }, { quest: 'sdq_b', chapter: 'c1' }, { quest: 'sdq_c', chapter: 'c1' }, { quest: 'sdq_d', chapter: 'c2' }, { quest: 'sdq_e', chapter: null }, { quest: 'sdq_f', chapter: 'c3', keep: 'npc_inn' }] });
  check('givers: residents first in slot order, spread before repeated, a townless chapter borrows the earlier chapter, a quest with no chapter goes to the first, a kept giver stays',
    gq.assign.sdq_a === 'npc_r2' && gq.assign.sdq_b === 'npc_r10' && gq.assign.sdq_c === 'npc_r2' && gq.assign.sdq_d === 'npc_r10' && gq.assign.sdq_e === 'npc_r2' && !gq.assign.sdq_f &&
    gq.warnings.some((w) => w.code === 'borrowed-giver' && w.quest === 'sdq_d') && gq.warnings.some((w) => w.code === 'quest-chapter' && w.quest === 'sdq_e'), gq);
  const gq2 = E.zones.givers({ chapters: ['c1'], people: gp.filter((p) => p.role !== 'resident' && p.chapter === 'c1'), quests: [{ quest: 'sdq_a', chapter: 'c1' }] });
  check('with no residents a guard gives the quest before the innkeeper', gq2.assign.sdq_a === 'npc_g');

  // 9. Speed.
  const tz = Date.now(); for (let k = 0; k < 10; k++) E.zones.build(W42.zspec); const zms = (Date.now() - tz) / 10;
  check('zone tables for the four fixture build in ' + zms.toFixed(1) + ' ms in the plain context', zms < 50);

  // 10. The page.
  const { win } = await boot148();
  const errors = []; win.addEventListener('error', (e) => errors.push(e.message));
  const { Kit, WORLD } = win, d = win.document;
  WORLD.loadFixture('four'); await wait(20);
  const b = Kit.bundle.current(); b.world.seed = 42;
  const before = plain({ charter: b.charter, codex: b.codex, rules: b.rules, art: b.art });
  check('before anything is generated the Encounters tab offers to generate, and zones are absent', !WORLD.zones.generated() && WORLD.zones.data() === null);
  const app = WORLD.zones.apply(), Z = app.zones;
  check('apply generates the overworld and interiors first, then the zones', WORLD.overworld.record() && WORLD.interiors.generated() && WORLD.zones.generated() && !WORLD.zones.stale());
  check('the page builds exactly the engine\'s zones from the fixture (digest ' + Z.digest + ')', Z.digest === Z42.digest && canon(plain(Z.field)) === canon(plain(Z42.field)) && canon(plain(Z.interior)) === canon(plain(Z42.interior)) && canon(plain(Z.bosses)) === canon(plain(Z42.bosses)), { page: Z.digest, engine: Z42.digest });
  const fCell = WORLD.overworld.generate().ground.findIndex((g, i) => WORLD.zones.cellKey(i));
  check('WORLD.zones.cellKey and zone(key) find the table for an overworld cell', fCell >= 0 && WORLD.zones.zone(WORLD.zones.cellKey(fCell)).cells > 0);
  const diffRules = []; Object.keys(b.rules).forEach((ns) => Object.keys(b.rules[ns] || {}).forEach((id) => { const a = before.rules[ns][id], c = b.rules[ns][id]; if (canon(a) !== canon(c)) diffRules.push(ns + '.' + id + ':' + Object.keys(c).filter((k) => canon(a[k]) !== canon(c[k])).join(',')); }));
  check('the only write outside world is sdq_.giver on the two side quests; charter, codex, and art are untouched', PRIOR.filter((k) => k !== 'rules').every((k) => canon(b[k]) === canon(before[k])) &&
    canon(diffRules.sort()) === canon(Object.keys(b.rules.sdq_).sort().map((id) => 'sdq_.' + id + ':giver')), diffRules);
  const givers = Object.keys(b.rules.sdq_).map((id) => ({ q: b.rules.sdq_[id], p: WORLD.records.get(b.rules.sdq_[id].giver) }));
  check('each giver is a resident of a town of the quest\'s own chapter, marked with the quest, and recorded as written by this forge', givers.every(({ q, p }) => p && p.role === 'resident' && p.chapter === q.chapter && /^twn_/.test(p.site) && canon(p.quests) === canon([q.id]) && Z.givers[q.id] === p.id) && app.filled === 2);
  check('no other person carries quests', WORLD.records.list('npc_').filter((p) => p.quests).length === 2);
  check('no field named id anywhere in world.zones, so Kit.index files nothing from it', !/"id"\s*:/.test(JSON.stringify(b.world.zones)));
  let res = Kit.refreshValidation();
  check('the generated four fixture validates with no errors, no broken references, and only the Marches boss warning', !res.errors.length && !res.broken.length && res.warnings.length === 1 && /Marches/.test(res.warnings[0].message), { s: Kit.validate.summary(res), w: res.warnings.map((x) => x.message).slice(0, 3), e: res.errors.slice(0, 2).map((x) => x.message) });
  check('World can now open: every giver resolves', WORLD.canOpen(b) && WORLD.forwardRefs(b).every((f) => f.ok));

  // Staleness and regeneration.
  const ids0 = JSON.stringify(Object.keys(b.world.records).map((p) => Object.keys(b.world.records[p]).sort())), keys0 = canon(Z.interior.map((z) => z.key));
  b.world.seed = 43; Kit.bundle.touch('seed');
  res = Kit.refreshValidation();
  check('after a reroll the zones are stale and validation says so', WORLD.zones.stale() && res.warnings.some((x) => /Generate them again on the Encounters tab/.test(x.message)));
  const re = WORLD.zones.apply();
  check('generating again regenerates the maps, keeps every world ID and interior zone key, keeps both givers (filled 0), and matches the engine for seed 43',
    !WORLD.zones.stale() && JSON.stringify(Object.keys(b.world.records).map((p) => Object.keys(b.world.records[p]).sort())) === ids0 && canon(re.zones.interior.map((z) => z.key)) === keys0 && re.filled === 0 && re.zones.digest === Z43.digest);
  b.world.seed = 42; WORLD.zones.apply();
  const fz = b.world.zones.field[0].key; b.world.overrides.zones = {}; b.world.overrides.zones[fz] = { rate: 2 };
  check('an override makes the zones stale; applying honors it and it survives another generate', WORLD.zones.stale() && WORLD.zones.apply().zones.field[0].rate === 2 && WORLD.zones.apply().zones.field[0].overridden);
  delete b.world.overrides.zones; WORLD.zones.apply();
  // Someone else's giver is kept; a dangling one is replaced; a giver this forge wrote is rewritten freely.
  const q0 = Object.keys(b.rules.sdq_).sort()[0], q1 = Object.keys(b.rules.sdq_).sort()[1], elder = WORLD.records.list('npc_').filter((p) => p.chapter === b.rules.sdq_[q0].chapter && p.role === 'innkeeper')[0];
  b.rules.sdq_[q0].giver = elder.id; b.rules.sdq_[q1].giver = 'npc_missing_zz99';
  const kp = WORLD.zones.apply();
  check('a giver set by hand is kept and marked; a dangling giver is replaced', b.rules.sdq_[q0].giver === elder.id && kp.kept.indexOf(q0) >= 0 && canon(WORLD.records.get(elder.id).quests) === canon([q0]) &&
    WORLD.records.get(b.rules.sdq_[q1].giver) && !b.world.zones.givers[q0] && b.world.zones.givers[q1] === b.rules.sdq_[q1].giver && WORLD.records.list('npc_').filter((p) => p.quests).length === 2);
  delete b.rules.sdq_[q0].giver; WORLD.zones.apply();
  check('clearing it hands the quest back to a resident chosen here', WORLD.records.get(b.rules.sdq_[q0].giver).role === 'resident' && b.world.zones.givers[q0] === b.rules.sdq_[q0].giver && !WORLD.records.get(elder.id).quests);
  // The World and Sites tabs carry the zones along once they exist.
  b.world.seed = 44; Kit.bundle.touch('seed'); Kit.go('world'); await wait(30);
  Array.prototype.find.call(d.getElementById('ws').querySelectorAll('button'), (x) => /Generate again/.test(x.textContent)).click(); await wait(60);
  check('Generate again on the World tab regenerates the interiors and the zones with it', !WORLD.interiors.stale() && !WORLD.zones.stale());
  b.world.seed = 42; Kit.bundle.touch('seed'); Kit.go('sites'); await wait(30);
  Array.prototype.find.call(d.getElementById('ws').querySelectorAll('button'), (x) => /Generate again/.test(x.textContent)).click(); await wait(60);
  check('Generate again on the Sites tab regenerates the zones too (back to seed 42, so the overworld comes along)', !WORLD.zones.stale() && b.world.zones.digest === Z42.digest);

  // 11. Export and round trip.
  const draft = Kit.buildExport('draft'), db = JSON.parse(draft.files[0].text), man = JSON.parse(draft.files[1].text);
  check('Draft keeps world closed, lists nothing unresolved, and carries the zones', db.kit.opened.indexOf('world') < 0 && !man.unresolved.length && canon(db.world.zones) === canon(plain(b.world.zones)), { unresolved: man.unresolved });
  const fourText = JSON.stringify(win.WORLD_DEMO.fixture('four'));
  const base146 = await in146(fourText), base147 = await in147(fourText);
  const r146 = await in146(draft.files[0].text, (w, K) => ({ diff: PRIOR.concat(['world']).filter((k) => canon(K.bundle.current()[k]) !== canon(db[k])) }));
  check('Day 146 opens the Draft with every namespace identical and no new errors; the givers read as forward', r146.matches && !r146.diff.length && !r146.summary.broken && r146.summary.errors === base146.summary.errors && r146.summary.forward === 2, { diff: r146.diff, now: r146.summary, before: base146.summary });
  const r147 = await in147(draft.files[0].text, (w, K) => ({ diff: PRIOR.concat(['world']).filter((k) => canon(K.bundle.current()[k]) !== canon(db[k])), cov: w.ART.coverage.compute(K.bundle.current()).green }));
  check('Day 147 opens the Draft with every namespace identical, coverage green, and no new errors', r147.matches && !r147.diff.length && r147.cov && canon(r147.errors) === canon(base147.errors), { diff: r147.diff, now: r147.summary, before: base147.summary });
  let finErr = null, fin = null; try { fin = Kit.buildExport('final'); } catch (e) { finErr = e.message; }
  const fb = fin && JSON.parse(fin.files[0].text), fman = fin && JSON.parse(fin.files[1].text);
  check('Final is allowed and opens world: the givers resolve, nothing unresolved, forge 148 final, 146 and 147 untouched', !finErr && fb.kit.opened.indexOf('world') >= 0 && fman.worldOpened && !fman.unresolved.length && fb.kit.forges['148'].status === 'final' && fb.kit.forges['146'].status === 'final' && fb.kit.forges['147'].status === 'final', finErr);
  if (fin) {
    const f146 = await in146(fin.files[0].text, (w, K, r) => { let blocked = null; try { K.buildExport('final'); } catch (e) { blocked = e.message; } return { blocked, fwd: r.forward.length }; });
    check('Day 146 opens the 148 Final: the givers resolve, 0 broken, 0 forward, its own Final still allowed', f146.matches && !f146.summary.broken && !f146.summary.errors && !f146.fwd && !f146.blocked, f146);
    const f147 = await in147(fin.files[0].text);
    check('Day 147 opens the 148 Final with 0 errors and 0 broken', f147.matches && !f147.summary.errors && !f147.summary.broken, f147.summary);
  }

  // 12. The Encounters tab.
  Kit.bundle.load(win.WORLD_DEMO.fixture('demo')); await wait(10);
  Kit.bundle.current().world.seed = 42;
  Kit.go('encounters'); await wait(20);
  const ws = () => d.getElementById('ws');
  const gen = Array.prototype.find.call(ws().querySelectorAll('button'), (x) => /Generate encounter zones/.test(x.textContent));
  check('the Encounters tab offers Generate encounter zones before anything exists', !!gen && !ws().querySelector('.w8-enc'));
  gen.click(); await wait(60);
  const zd = WORLD.zones.data(), txt = ws().textContent;
  check('after Generate: chips, a row per overworld zone and per floor, the bosses, and no givers table (the demo has no side quests)', zd && ws().querySelectorAll('#enc-field tbody tr').length === zd.field.length && ws().querySelectorAll('#enc-interior tbody tr').length === zd.interior.length &&
    ws().querySelectorAll('#enc-bosses tbody tr').length === zd.bosses.length && !ws().querySelector('#enc-givers') && new RegExp(zd.field.length + ' field zones').test(txt) && /Up to date/.test(txt) && /\/16/.test(txt), txt.slice(0, 300));
  check('the demo\'s bossless first chapter shows an empty slot for Day 149', /Empty slot for Day 149/.test(txt));
  Kit.bundle.load(win.WORLD_DEMO.fixture('four')); await wait(20); Kit.bundle.current().world.seed = 42; WORLD.zones.apply(); Kit.go('encounters'); Kit.rerender(); await wait(30);
  check('with side quests the tab lists each quest and its giver, set by World Forge', ws().querySelectorAll('#enc-givers tbody tr').length === 2 && (ws().textContent.match(/World Forge/g) || []).length >= 2, ws().textContent.slice(-400));
  check('no page errors', !errors.length, errors.slice(0, 3));

  const pass = results.filter((x) => x.ok).length;
  results.forEach((x) => console.log((x.ok ? 'PASS ' : 'FAIL ') + x.name + (x.ok ? '' : '  ' + String(JSON.stringify(x.detail)).slice(0, 700))));
  fs.writeFileSync(path.join(OUT, 'phase5-report.json'), JSON.stringify({ when: new Date().toISOString(), pass, total: results.length, zoneMs: zms, results }, null, 2));
  console.log('\n' + pass + ' of ' + results.length + ' passed');
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
