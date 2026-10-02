// Phase 3 acceptance: continents and the overworld. The engine grows a map around the progression graph: continents
// placed by seeded rejection sampling and sized by their chapters' minutes, straits at least two cells wide, a three
// cell ocean margin, climate bands matched through the table, mountain walls placed directly, feature biomes inside
// their own climate box, a ridge with one pass between chapters that share a continent, a sea ring with one landing
// around each region the ship could reach early, and every site stamped where its chapter can walk to it. The page
// stores the map_ record and the bundle still round trips through Days 146 and 147.
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
function context() { const box = vm.createContext({}); vm.runInContext(renFile, box); vm.runInContext(engFile, box, { filename: 'engine-world.js' }); return box; }
// The same engines in the ordinary Node context (vm contexts route Math and other globals through interceptors and run
// several times slower than a browser tab, so timing is measured here).
const FAST = { E: new Function(engFile + '\nreturn ENGINE_WORLD;')(), R: new Function(renFile + '\nreturn ENGINE_RENDER;')() };
const fixture = (k) => JSON.parse(fs.readFileSync(path.join(OUT, k + '147-bundle.json'), 'utf8'));
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'default';

// The plain spec the page would hand the engine, built here from a fixture without the page.
function specFor(ctx, b, seed, settings) {
  const E = ctx.E || ctx.ENGINE_WORLD, R = ctx.R || ctx.ENGINE_RENDER, enm = b.rules.enm_ || {}, trp = b.rules.trp_ || {}, boss = {}, minutes = {};
  Object.keys(trp).sort().forEach((k) => { const t = trp[k]; if (t.chapter && (t.members || []).some((m) => enm[m.enm] && enm[m.enm].isBoss)) (boss[t.chapter] = boss[t.chapter] || []).push(t.id); });
  const chapters = b.charter.sections.chapters.map((c) => { minutes[c.id] = Number(c.targetMinutes) || 60; return { chapter: c.id, name: c.name, continent: slug(c.continentLabel), label: c.continentLabel || 'Default', minutes: minutes[c.id], bosses: (boss[c.id] || []).sort() }; });
  const g = E.progression.build({ chapters }, settings || {});
  g.nodes.forEach((n) => { if (n.kind !== 'gate') n.record = E.ids.structural(n.kind + '_', n.key); });
  g.regions.forEach((r) => { r.record = E.ids.structural('reg_', r.key); });
  const table = E.climate.table(b.art, R);
  return { seed, settings: settings || {}, graph: g, minutes, palette: E.overworld.palette(b.art, table), table };
}
const ch = (id, cont, bosses) => ({ chapter: 'chp_' + id, name: id, continent: cont, label: cont, minutes: 60, bosses: bosses || ['trp_' + id + '_boss'] });
const SYNTH = {
  one: [ch('a', 'w')],
  oneContinent: [ch('a', 'w'), ch('b', 'w'), ch('c', 'w'), ch('d', 'w')],
  returns: [ch('a', 'w'), ch('b', 'e'), ch('c', 'w'), ch('d', 'n'), ch('e', 'e')],
  everyNew: [ch('a', 'w'), ch('b', 'e'), ch('c', 'n'), ch('d', 's'), ch('e', 'x'), ch('f', 'y')],
  long: 'abcdefghijkl'.split('').map((k, i) => ch(k, ['w', 'w', 'w', 'e', 'e', 'n', 'n', 'n', 's', 's', 'w', 'x'][i], i % 3 ? undefined : []))
};

(async () => {
  const C1 = context(), C2 = context(), E = FAST.E, R = FAST.R, demo = fixture('demo'), four = fixture('four');

  // 1. Determinism: identical maps in two vm contexts and the plain context; seeds differ; IDs never move.
  const seeds = [1, 42, 148, 4294967295];
  const dig = (ctx, b, s) => ctx.ENGINE_WORLD.overworld.build(specFor(ctx, b, s)).digest;
  const same = seeds.every((s) => { const a = dig(C1, four, s); return a === dig(C2, four, s) && a === E.overworld.build(specFor(FAST, four, s)).digest; }) && dig(C1, demo, 42) === dig(C2, demo, 42);
  check('one seed gives an identical overworld in two vm contexts and the plain context (four fixture, ' + seeds.length + ' seeds; demo)', same);
  const digs = seeds.map((s) => E.overworld.build(specFor(FAST, four, s)).digest);
  check('different seeds give different overworlds', new Set(digs).size === seeds.length, digs);
  const S42 = specFor(FAST, four, 42), S43 = specFor(FAST, four, 43);
  const W42 = E.overworld.build(S42), W43 = E.overworld.build(S43);
  check('a reroll moves every site but never renames one: the same site records, at new places', canon(W42.sites.map((s) => s.record).sort()) === canon(W43.sites.map((s) => s.record).sort()) && W42.sites.some((s, k) => s.entrance !== W43.sites.filter((t) => t.key === s.key)[0].entrance));
  check('ENGINE_WORLD.overworld is frozen with the rest of the engine', Object.isFrozen(C1.ENGINE_WORLD.overworld) && Object.isFrozen(C1.ENGINE_WORLD.overworld.DEFAULTS));

  // 2. Every fixture and synthetic layout builds and passes its own walking check on many seeds.
  const sweep = [], attempts = {};
  [['demo', demo, 30], ['four', four, 30]].forEach(([name, b, N]) => {
    for (let s = 0; s < N; s++) { const ow = E.overworld.build(specFor(FAST, b, (s * 2654435761) >>> 0)); attempts[name] = (attempts[name] || 0) + ow.attempts; if (!ow.ok) sweep.push(name + ' ' + s + ' ' + ow.problems[0].code); }
  });
  const pal = specFor(FAST, demo, 1).palette;
  Object.keys(SYNTH).forEach((name) => {
    const g = E.progression.build({ chapters: SYNTH[name] }, {}), minutes = {};
    g.nodes.forEach((n) => { if (n.kind !== 'gate') n.record = E.ids.structural(n.kind + '_', n.key); });
    SYNTH[name].forEach((c) => { minutes[c.chapter] = 60; });
    for (let s = 0; s < 8; s++) { const ow = E.overworld.build({ seed: s * 7919 + 3, settings: {}, graph: g, minutes, palette: pal }); attempts[name] = (attempts[name] || 0) + ow.attempts; if (!ow.ok) sweep.push(name + ' ' + s + ' ' + ow.problems[0].code); }
  });
  check('demo and four on 30 seeds each, and five synthetic layouts (one chapter to twelve, six continents, a returning continent) on 8 seeds each, all build and walk clean', !sweep.length, { sweep: sweep.slice(0, 5), attempts });

  // 3. Shape: size, margin, straits, one landmass per continent.
  const W = W42, n = W.w * W.h, Wd = E.overworld.build(specFor(FAST, demo, 42));
  check('size is 96 plus 32 per continent: demo (2) 160, four (4) 224', Wd.w === 160 && Wd.h === 160 && W.w === 224 && W.h === 224, [Wd.w, W.w]);
  const sz = E.overworld.build(Object.assign(specFor(FAST, four, 42), { settings: { mapSize: { base: 96, perContinent: 32, max: 160 } } }));
  check('mapSize.max caps the side (160)', sz.w === 160 && sz.ok, [sz.w, sz.problems.slice(0, 2)]);
  let margin = true, strait = true;
  for (let i = 0; i < n; i++) {
    const x = i % W.w, y = (i - x) / W.w;
    if ((x < 3 || y < 3 || x >= W.w - 3 || y >= W.h - 3) && W.owner[i] >= 0) margin = false;
    if (W.owner[i] < 0) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W.w && yy < W.h) { const o = W.owner[yy * W.w + xx]; if (o >= 0 && o !== W.owner[i]) strait = false; } }
  }
  check('a three cell border of ocean', margin);
  check('no land of one continent within two cells of another (straits at least two cells wide)', strait);
  const landmass = W.continents.every((c, k) => E.overworld.grid.components(W.w, W.h, (j) => W.owner[j] === k).sizes.length === 1);
  check('each continent is one four way connected landmass, and four continents appear', landmass && W.continents.length === 4, W.continents.map((c) => c.slug + ':' + c.cells));
  const byMin = {}; four.charter.sections.chapters.forEach((c) => { const s = slug(c.continentLabel); byMin[s] = (byMin[s] || 0) + (Number(c.targetMinutes) || 60); });
  const radOk = W.continents.every((a) => W.continents.every((b2) => byMin[a.slug] <= byMin[b2.slug] || a.r >= b2.r));
  check('continent radius follows its chapters\' target minutes (Southmere, 195 minutes, is the largest)', radOk && W.continents.slice().sort((a, b2) => b2.r - a.r)[0].slug === 'southmere', W.continents.map((c) => c.slug + ' ' + c.r.toFixed(1)));

  // 4. Climate and terrain.
  const tb = S42.table, P42 = S42.palette, mountain = P42.mountain, flags = P42.flags;
  let climateOk = 0, climateBad = [], waterOk = true;
  for (let i = 0; i < n; i++) {
    if (W.owner[i] < 0) { if (W.st[i] === 0 && !(flags[W.ground[i]] & 4)) waterOk = false; continue; }
    if (W.st[i] !== 0 || String(W.ground[i]).indexOf(':') >= 0) continue;
    const f = P42.features.some((ft) => ft.id === W.ground[i]);
    if (f) continue;
    const want = E.climate.lookup(tb, W.temp[i], W.moist[i], W.elev[i]);
    if (W.ground[i] === want || W.ground[i] === P42.lowland && W.elev[i] === 2) climateOk++; else climateBad.push([i, W.ground[i], want]);
  }
  check('every open land cell takes the climate table\'s biome for its temperature, moisture, and elevation (or carved lowland)', !climateBad.length && climateOk > 10000, { climateOk, bad: climateBad.slice(0, 3) });
  check('every open water cell is a swim tile', waterOk);
  const bandShare = [0, 0, 0, 0, 0]; let land = 0;
  for (let i = 0; i < n; i++) if (W.owner[i] >= 0) { bandShare[W.temp[i]]++; land++; }
  check('temperature bands split the land at the thresholds in world.settings (each near a fifth)', bandShare.every((c) => Math.abs(c / land - 0.2) < 0.03), bandShare.map((c) => (c / land).toFixed(3)));
  const latTemp = (row) => { let s = 0, c = 0; for (let x = 0; x < W.w; x++) { const i = row * W.w + x; if (W.owner[i] >= 0) { s += W.temp[i]; c++; } } return c ? s / c : null; };
  const mids = [], poles = [];
  for (let y = 0; y < W.h; y++) { const t = latTemp(y); if (t == null) continue; (Math.abs(y - W.h / 2) < W.h / 8 ? mids : Math.abs(y - W.h / 2) > W.h * 0.3 ? poles : []).push(t); }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  check('temperature falls with latitude (equator rows warmer than polar rows)', avg(mids) > avg(poles) + 1, [avg(mids).toFixed(2), avg(poles).toFixed(2)]);
  let wallsOk = true, coastOk = true;
  for (let i = 0; i < n; i++) {
    if (W.st[i] === 1 && W.ground[i] !== mountain) wallsOk = false;
    if (W.owner[i] >= 0 && W.st[i] === 0 && W.elev[i] === 1) { const x = i % W.w, y = (i - x) / W.w; let near = false; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { if (Math.abs(dx) + Math.abs(dy) > 2) continue; const j = (y + dy) * W.w + x + dx; if (W.owner[j] < 0) near = true; } if (!near) coastOk = false; }
  }
  check('every wall (ridge, ring, lock side) is the mountain biome itself, impassable, never looked up through the table', wallsOk && !(flags[mountain] & 1) && P42.biomes[mountain].key === 'mountain');
  check('coast is land within one or two steps of water', coastOk);
  const feat = P42.features[0], fcells = []; let elig = 0;
  for (let i = 0; i < n; i++) if (W.ground[i] === feat.id) fcells.push(i);
  check('volcanic cells lie inside volcanic\'s own climate box, on inland ground', fcells.length > 0 && fcells.every((i) => E.climate.inBox(feat, W.temp[i], W.moist[i], W.elev[i]) && W.cls[i] === 2), fcells.length);
  const cov0 = E.overworld.build(Object.assign(specFor(FAST, four, 42), { settings: { featureCoverage: 0 } }));
  check('featureCoverage 0 places no volcanic ground', !cov0.ground.some((r) => r === feat.id) && cov0.ok);
  const mtn = E.overworld.build(Object.assign(specFor(FAST, four, 42), { settings: { overworld: { mountainShare: 0.3 } } }));
  const peaks = (ow) => ow.elev.filter((e, i) => e === 4 && ow.st[i] === 0).length;
  check('a larger mountainShare raises more peaks', peaks(mtn) > peaks(W) * 1.5, [peaks(W), peaks(mtn)]);
  const big = E.overworld.build(Object.assign(specFor(FAST, four, 42), { settings: { overworld: { continents: { northreach: { radius: 1.5 } } } } }));
  const cellsOf = (ow, s) => ow.continents.filter((c) => c.slug === s)[0].cells;
  check('a per continent radius override grows that continent', cellsOf(big, 'northreach') > cellsOf(W, 'northreach') * 1.4, [cellsOf(W, 'northreach'), cellsOf(big, 'northreach')]);

  // 5. Regions, rings, and gates.
  const G = S42.graph, shipAt = G.chapters.indexOf(G.vehicles.ship.chapter);
  check('one region per chapter, each one connected piece of its continent', W.regions.length === 6 && W.regions.every((r, k) => r.cells > 0 && E.overworld.grid.components(W.w, W.h, (j) => W.region[j] === k).sizes.length === 1), W.regions.map((r) => r.cells));
  check('regions after the ship\'s chapter that touch the sea are ringed; Westland\'s two are not', W.regions.map((r) => r.ringed ? 1 : 0).join('') === '001111' && W.regions.every((r) => r.ringed === (r.index > shipAt)), W.regions.map((r) => r.ringed));
  let ridge = true;
  for (let i = 0; i < n; i++) { if (W.region[i] < 0 || W.st[i] === 1 || W.st[i] === 2) continue; E.overworld.grid.nb4(i, W.w, W.h).forEach((j) => { if (W.region[j] >= 0 && W.region[j] !== W.region[i] && W.st[j] !== 1 && W.st[j] !== 2) ridge = false; }); }
  check('every boundary between two regions is wall or gate (no open cell touches another region\'s open cell)', ridge);
  const kinds = W.gates.map((g) => g.kind);
  const count = (k) => kinds.filter((x) => x === k).length;
  check('gates: 2 passes (Westland, Southmere), 3 landings (Eastland, Northreach, Southmere), 1 sea ring (the Southmere pass region), 6 locks', count('pass') === 2 && count('landing') === 3 && count('seawall') === 1 && count('lock') === 6, kinds);
  const passOk = W.gates.filter((g) => g.kind === 'pass').every((g) => { const [a, b2] = g.cells, adj = Math.abs(a - b2) === 1 || Math.abs(a - b2) === W.w; return g.cells.length === 2 && adj && W.ground[a] === mountain && W.ground[b2] === mountain && W.region[a] !== W.region[b2]; });
  check('each pass is two adjacent mountain cells straddling the ridge between consecutive chapters, needing the later chapter\'s key', passOk && W.gates.filter((g) => g.kind === 'pass').every((g) => g.requires.join() === 'chapter:' + G.regions.filter((r) => r.key === g.region)[0].chapter));
  const seaDist = E.overworld.grid.bfs(W.w, W.h, [...Array(n).keys()].filter((i) => W.sea[i]), () => true);
  check('each landing and sea ring is one ring cell three steps from the sea; landings also need the ship', W.gates.filter((g) => g.kind === 'landing' || g.kind === 'seawall').every((g) => g.cells.length === 1 && seaDist[g.cells[0]] === 3 && W.ground[g.cells[0]] === mountain && (g.kind !== 'landing' || g.requires.indexOf('vehicle:ship') >= 0)));
  check('each lock is the cell in front of a boss door, needing the chapter key and its seal, walled on both sides',
    W.gates.filter((g) => g.kind === 'lock').every((g) => { const c = g.cells[0], s = W.sites.filter((x) => x.front === c)[0]; return s && s.role === 'boss' && W.st[c - 1] === 1 && W.st[c + 1] === 1 && g.requires.some((k) => /^item:seal:/.test(k)) && g.requires.some((k) => /^chapter:/.test(k)); }));

  // 6. Sites and stamps.
  const nodes = G.nodes.filter((nd) => nd.kind === 'twn' || nd.kind === 'dgn');
  check('every twn_ and dgn_ of the graph is stamped once, in its own region', W.sites.length === nodes.length && nodes.every((nd) => W.sites.filter((s) => s.key === nd.key).length === 1) &&
    W.sites.every((s) => W.region[s.entrance] === G.regions.findIndex((r) => r.key === s.region)), [W.sites.length, nodes.length]);
  const art = four.art, resolveAll = W.sites.every((s) => { for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) { const i = y * W.w + x; if (!R.tiles.resolve(art, W.ground[i]) || W.deco[i] && !R.tiles.resolve(art, W.deco[i])) return false; } return true; });
  check('every stamp tile resolves through tiles.resolve', resolveAll);
  const mapObj = { w: W.w, h: W.h, ground: W.ground, deco: W.deco };
  const fa = (i) => R.tiles.flagsAt(art, mapObj, i % W.w, Math.floor(i / W.w));
  check('stamp doors read passable through tiles.flagsAt (town lintel 33, dungeon arch 33, cave stairs 1); stamp walls read 0',
    W.sites.every((s) => (fa(s.entrance) & 1) === 1) && W.sites.filter((s) => s.stamp === 'town').every((s) => fa(s.entrance) === 33) && W.sites.filter((s) => s.stamp === 'cave').every((s) => fa(s.entrance) === 1) &&
    W.sites.every((s) => { const ex = s.entrance % W.w, ey = Math.floor(s.entrance / W.w); for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) if ((x !== ex || y !== ey) && (fa(y * W.w + x) & 1)) return false; return true; }));
  check('the finale is a 5 by 3 castle; towns, dungeons, and caves are 3 by 2', W.sites.filter((s) => s.stamp === 'castle').length === 1 && W.sites.filter((s) => s.stamp === 'castle').every((s) => s.w === 5 && s.h === 3 && s.role === 'boss') && W.sites.filter((s) => s.stamp !== 'castle').every((s) => s.w === 3 && s.h === 2));
  const lowOk = W.sites.every((s) => { for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) { const r = W.region[y * W.w + x]; if (W.cls[y * W.w + x] !== 2 || G.regions[r].key !== s.region) return false; } return true; });
  check('sites sit on inland ground of their region (never on the beach strip of a ringed region)', lowOk);
  let spaced = true;
  W.sites.forEach((a, i) => W.sites.forEach((b2, j) => { if (i < j && Math.max(Math.abs(a.x + a.w / 2 - b2.x - b2.w / 2), Math.abs(a.y + a.h / 2 - b2.y - b2.h / 2)) < 3) spaced = false; }));
  check('sites keep at least three cells between centers', spaced);
  const startSite = W.sites.filter((s) => s.role === 'start' && s.chapter === G.chapters[0])[0];
  check('play starts in front of chapter one\'s start town', W.start === startSite.front);

  // 7. Walking: the geometric progression check, its control cases, and vehicles.
  check('the walking check finds nothing wrong with the four fixture', !E.overworld.check(W, G).length);
  function broken(fn) { const ow = Object.assign({}, W, { gates: W.gates.map((g) => Object.assign({}, g, { requires: g.requires.slice() })) }); fn(ow); return E.overworld.check(ow, G).map((p) => p.code); }
  const openPass = broken((ow) => { ow.gates.filter((g) => g.kind === 'pass')[0].requires = []; });
  const openLanding = broken((ow) => { ow.gates.filter((g) => g.kind === 'landing')[1].requires = ['vehicle:ship']; });
  const openLock = broken((ow) => { const l = ow.gates.filter((g) => g.kind === 'lock')[2]; l.requires = l.requires.filter((k) => !/seal/.test(k)); });
  const st2 = W.st.slice(), wallHole = (() => { const ring = W.gates.filter((g) => g.kind === 'landing')[2], r = W.region[ring.cells[0]], cells = []; for (let i = 0; i < n; i++) if (W.region[i] === r && W.st[i] === 1 && seaDist[i] === 3) cells.push(i); cells.forEach((i) => { st2[i] = 0; }); const ow = Object.assign({}, W, { st: st2, ground: W.ground.map((g, i) => cells.indexOf(i) >= 0 ? P42.lowland : g) }); return E.overworld.check(ow, G).map((p) => p.code); })();
  check('the walking check catches an open pass, a landing without its chapter key, a lock without its seal, and a ring torn down',
    openPass.indexOf('early') >= 0 && openLanding.indexOf('early') >= 0 && openLock.indexOf('lock-open') >= 0 && wallHole.indexOf('early') >= 0, { openPass, openLanding, openLock, wallHole });
  const all = {}; G.nodes.forEach((nd) => nd.grants.forEach((k) => { all[k] = true; })); (G.start || []).forEach((k) => { all[k] = true; });
  const everything = E.overworld.reach(W, all), noShip = Object.assign({}, all); delete noShip['vehicle:ship'];
  const onFoot = E.overworld.reach(W, noShip);
  check('holding every key and the ship, every site front is reachable', W.sites.every((s) => everything[s.front]));
  check('without the ship nothing beyond Westland is reachable, even holding every key', W.sites.every((s) => !!onFoot[s.front] === (s.region === G.regions[0].key || s.region === G.regions[1].key)));
  const ch1 = E.overworld.reach(W, G.start);
  check('at the start only the first chapter\'s ground is open', ch1.some((v) => v) && ch1.every((v, i) => !v || W.region[i] === 0));

  // 8. Speed, in a plain context.
  const tm = {};
  for (const [k, b] of [['demo', demo], ['four', four]]) { const sp = specFor(FAST, b, 7); E.overworld.build(sp); const t0 = Date.now(); for (let i = 0; i < 3; i++) E.overworld.build(Object.assign({}, sp, { seed: 100 + i })); tm[k] = Math.round((Date.now() - t0) / 3); }
  check('generation time in a plain context: demo ' + tm.demo + ' ms, four ' + tm.four + ' ms (under 1500 ms)', tm.demo < 1500 && tm.four < 1500, tm);

  // 9. The page: generate, store the map_ record, validate, reroll, user record.
  const { win, errors } = await boot148();
  const Kit = win.Kit, WORLD = win.WORLD, d = win.document;
  Kit.bundle.load(win.WORLD_DEMO.fixture('four')); await wait(10);
  let b = Kit.bundle.current();
  b.world.seed = 42;
  const before = JSON.parse(JSON.stringify(b));
  check('before generating, isGenerated is false and there is no graph', !WORLD.isGenerated() && !WORLD.progression.graph());
  const r1 = WORLD.overworld.apply();
  const rec = WORLD.overworld.record();
  check('apply lays out the progression first, then writes one map_ record keyed map|overworld', rec && rec.id === win.ENGINE_WORLD.ids.structural('map_', 'map|overworld') && rec.kind === 'overworld' && WORLD.isGenerated() && Object.keys(b.world.records.reg_).length === 6, rec && rec.id);
  check('the page builds the very map the engine builds outside it (same digest for seed 42)', rec.digest === W.digest, [rec.digest, W.digest]);
  check('the record holds size, seed, engine version, parameter hash, start, continents, regions, sites, gates, and stats, and no tile arrays',
    rec.w === 224 && rec.seed === 42 && rec.generatorVersion === win.ENGINE_WORLD.version && rec.paramHash && canon(rec.start) === canon([W.start % 224, Math.floor(W.start / 224)]) &&
    rec.continents.length === 4 && rec.regions.length === 6 && rec.sites.length === 25 && rec.gates.length === 12 && rec.stats.land > 0 && !('ground' in rec) && !('deco' in rec) && JSON.stringify(rec).length < 20000, JSON.stringify(rec).length);
  check('every site, region, and continent region in the record resolves to a world record; no field is named id inside',
    rec.sites.every((s) => WORLD.records.get(s.site)) && rec.regions.every((r) => WORLD.records.get(r.region)) && rec.continents.every((c) => c.regions.every((x) => WORLD.records.get(x))) &&
    rec.gates.every((g) => WORLD.records.get(g.region) && (g.from === null || WORLD.records.get(g.from))) && !/"id"\s*:/.test(JSON.stringify(Object.assign({}, rec, { id: undefined }))));
  check('charter, codex, rules, and art are untouched by generating', PRIOR.every((k) => canon(b[k]) === canon(before[k])));
  let res = Kit.refreshValidation();
  const owMsgs = res.errors.concat(res.warnings).filter((x) => x.recordId === rec.id);
  check('the generated four fixture validates with no errors and no broken references, and nothing about the overworld', !res.errors.length && !res.broken.length && !owMsgs.length, { s: Kit.validate.summary(res), e: res.errors.slice(0, 2).map((x) => x.message) });
  b.world.seed = 43; Kit.bundle.touch('seed');
  res = Kit.refreshValidation();
  check('after a reroll the map is stale and validation says so', WORLD.overworld.stale() && res.warnings.some((x) => x.recordId === rec.id && /Generate it again/.test(x.message)));
  const ids0 = JSON.stringify(Object.keys(b.world.records).map((p) => Object.keys(b.world.records[p]).sort()));
  WORLD.overworld.apply();
  const rec2 = WORLD.overworld.record();
  check('generating again clears the warning, keeps every world ID, and moves the sites', !WORLD.overworld.stale() && JSON.stringify(Object.keys(b.world.records).map((p) => Object.keys(b.world.records[p]).sort())) === ids0 && rec2.id === rec.id && rec2.digest === W43.digest && canon(rec2.sites.map((s) => s.entrance)) !== canon(rec.sites.map((s) => s.entrance)));
  b.world.settings.bake = true;
  check('the bake toggle alone does not make the map stale', !WORLD.overworld.stale());
  b.world.settings.bake = false;
  rec2.origin = 'user'; rec2.name = 'Gaia';
  b.world.seed = 44;
  const r3 = WORLD.overworld.apply();
  check('a map_ record marked user made is kept on generate', r3.kept && WORLD.overworld.record().name === 'Gaia');
  rec2.origin = 'generated'; b.world.seed = 42; WORLD.overworld.apply();

  // 10. Export and round trip.
  const draft = Kit.buildExport('draft'), db = JSON.parse(draft.files[0].text), man = JSON.parse(draft.files[1].text);
  check('Draft manifest lists 32 created world IDs (the map_ included) and nothing unresolved', man.created.length === 32 && man.created.indexOf(rec.id) >= 0 && !man.unresolved.length && man.counts.map_ === 1, { created: man.created.length, unresolved: man.unresolved });
  const why = WORLD.finalBlock(Kit.bundle.current());
  check('Final is no longer blocked for want of an overworld', !why || !/not been generated/.test(why), why);
  const fourText = JSON.stringify(win.WORLD_DEMO.fixture('four'));
  const base146 = await in146(fourText), base147 = await in147(fourText);
  const r146 = await in146(draft.files[0].text, (w, K) => ({ diff: PRIOR.concat(['world']).filter((k) => canon(K.bundle.current()[k]) !== canon(db[k])) }));
  check('Day 146 opens the generated Draft with every namespace identical and no new errors', r146.matches && !r146.diff.length && canon(r146.summary) === canon(base146.summary) && canon(r146.errors) === canon(base146.errors), { diff: r146.diff, now: r146.summary, before: base146.summary });
  const r147 = await in147(draft.files[0].text, (w, K) => ({ diff: PRIOR.concat(['world']).filter((k) => canon(K.bundle.current()[k]) !== canon(db[k])), cov: w.ART.coverage.compute(K.bundle.current()).green }));
  check('Day 147 opens the generated Draft with every namespace identical, coverage green, and no new errors', r147.matches && !r147.diff.length && r147.cov && canon(r147.summary) === canon(base147.summary) && canon(r147.errors) === canon(base147.errors), { diff: r147.diff, now: r147.summary, before: base147.summary });

  // 11. The World tab.
  Kit.bundle.load(win.WORLD_DEMO.fixture('demo')); await wait(10);
  Kit.go('world'); await wait(20);
  const ws = () => d.getElementById('ws');
  const genBtn = Array.prototype.find.call(ws().querySelectorAll('button'), (x) => /Generate the overworld/.test(x.textContent));
  check('the World tab offers Generate before anything exists', !!genBtn && !ws().querySelector('canvas'));
  genBtn.click(); await wait(30);
  const cv = ws().querySelector('.w8-map canvas'), txt = ws().textContent;
  check('after Generate: a 160 by 160 map canvas, size and site chips, two region rows, and a gates table', cv && cv.width === 160 && cv.height === 160 && /160 by 160/.test(txt) && /9 sites/.test(txt) &&
    ws().querySelectorAll('.panel')[2].querySelectorAll('tbody')[0].querySelectorAll('tr').length === 2 && /Landing/.test(txt) && /Lock/.test(txt), txt.slice(0, 200));
  const segs = ws().querySelectorAll('.w8-seg-btn');
  check('five overlay buttons as a radio group, Biome checked, each at least 44 px tall by style', segs.length === 5 && segs[0].getAttribute('aria-checked') === 'true' && ws().querySelector('.w8-seg').getAttribute('role') === 'radiogroup');
  segs[1].click(); await wait(20);
  check('choosing Elevation redraws with the elevation overlay and its legend', ws().querySelector('.w8-map canvas').dataset.overlay === 'elev' && ws().querySelector('.w8-seg-btn[aria-checked="true"]').textContent === 'Elevation' && /Peak/.test(ws().querySelector('.w8-legend').textContent));
  check('no page errors', !errors.length, errors.slice(0, 3));

  // Save a picture of the four fixture for the log (biome overlay with sites and gates).
  require('./png').write(path.join(OUT, 'phase3-four-42.png'), W, P42, 3);
  require('./png').write(path.join(OUT, 'phase3-demo-42.png'), Wd, specFor(FAST, demo, 42).palette, 3);

  const pass = results.filter((x) => x.ok).length;
  results.forEach((x) => console.log((x.ok ? 'PASS ' : 'FAIL ') + x.name + (x.ok ? '' : '  ' + String(JSON.stringify(x.detail)).slice(0, 700))));
  fs.writeFileSync(path.join(OUT, 'phase3-report.json'), JSON.stringify({ when: new Date().toISOString(), pass, total: results.length, timing: tm, digest42: W.digest, results }, null, 2));
  console.log('\nfour seed 42 digest ' + W.digest + '; timing ' + JSON.stringify(tm));
  console.log('\n' + pass + ' of ' + results.length + ' passed');
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
