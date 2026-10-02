// Shared by the Phase 6 tests: rebuilds a whole world (graph, overworld, interiors, zone spec) from a fixture without the
// page, by the same independent reading of the plan Phase 5's tests use.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const engFile = () => fs.readFileSync(path.join(ROOT, 'engine-world.js'), 'utf8');
const renFile = () => fs.readFileSync(path.join(ROOT, 'engine-render.js'), 'utf8');
function context() { const box = vm.createContext({}); vm.runInContext(renFile(), box); vm.runInContext(engFile(), box, { filename: 'engine-world.js' }); return { E: box.ENGINE_WORLD, R: box.ENGINE_RENDER }; }
function fast() { return { E: new Function(engFile() + '\nreturn ENGINE_WORLD;')(), R: new Function(renFile() + '\nreturn ENGINE_RENDER;')() }; }
const fixture = (k) => JSON.parse(fs.readFileSync(path.join(OUT, k + '147-bundle.json'), 'utf8'));
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'default';
const xy = (i, w) => [i % w, Math.floor(i / w)];
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

module.exports = { worldFor, context, fast, fixture, slug, xy, ROOT, OUT };
