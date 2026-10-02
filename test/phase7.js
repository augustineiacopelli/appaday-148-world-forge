// Phase 7 tests: the interface. The engine's painted cells (overworld.paint and spec.paint) are checked on their own
// (identical in two vm contexts and the plain context, every refusal by code, a cell that would break the walk refused
// and the rest kept, build with paint equal to paint after build). Then the page: painted cells in the hash, the record,
// and validation; the paint API; per continent settings; zone cell keys; zone edits stored as sparse diffs; the worker
// falling back to the main thread where none can start; the viewer's zoom ladder; field music lookup; the World, Sites,
// Encounters, and Validation tabs; Show on map; and a Final with painted cells and zone edits opening in Days 146 and
// 147. Drawing itself is checked in headless Chromium by layout.js (jsdom has no 2D context). Run from test/.
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
const PRIOR = ['charter', 'codex', 'rules', 'art'];

// A free land cell in the given region at low ground, away from every site front and gate, so painting it walkable
// ground can never matter to the walk.
function freeCell(ow, region) {
  const fronts = new Set(ow.sites.map((s) => s.front).concat(ow.sites.map((s) => s.approach).filter((x) => x != null)));
  for (let i = 0; i < ow.ground.length; i++) if (ow.owner[i] >= 0 && ow.st[i] === 0 && !ow.deco[i] && ow.elev[i] === 2 && ow.region[i] === region && !fronts.has(i) && !fronts.has(i - 1) && !fronts.has(i + 1)) return i;
  return -1;
}
function biomeBy(ow, key) { return Object.keys(ow.palette ? ow.palette.biomes : {}).find((id) => ow.palette.biomes[id].key === key); }

(async () => {
  const C1 = context(), C2 = context(), FAST = fast(), E = FAST.E, four = fixture('four');
  const W42 = worldFor(FAST, four, 42, {}), ow = W42.ow, g = W42.g, pal = E.overworld.palette(four.art, E.climate.table(four.art, FAST.R));
  ow.palette = pal;
  const xy = (i) => [i % ow.w, Math.floor(i / ow.w)], k = (i) => xy(i).join(',');
  const desert = biomeBy(ow, 'desert'), mountain = pal.mountain, ocean = biomeBy(ow, 'ocean');
  const free = freeCell(ow, 0), wall = ow.st.findIndex((s) => s === 1), gateCell = ow.gates[0].cells[0], stamp = ow.st.findIndex((s) => s === 3), water = ow.owner.findIndex((o) => o < 0);

  // 1. The engine.
  check('overworld.paint is exported and the engine stays frozen', typeof E.overworld.paint === 'function' && Object.isFrozen(E.overworld));
  check('nothing to paint returns the very same map', E.overworld.paint(ow, {}, g) === ow && E.overworld.paint(ow, null, g) === ow);
  const P1 = E.overworld.paint(ow, { [k(free)]: desert }, g);
  check('a free land cell takes the new biome; the copy names the painted cell, keeps the map as built, and changes the digest',
    P1 !== ow && P1.ground[free] === desert && ow.ground[free] !== desert && P1.painted.length === 1 && P1.painted[0] === free && P1.unpainted === ow && P1.digest !== ow.digest && !P1.skipped.length && P1.ok);
  check('only the ground array is copied: every other layer is shared and untouched', P1.elev === ow.elev && P1.st === ow.st && P1.ground !== ow.ground && P1.ground.filter((x, i) => x !== ow.ground[i]).length === 1);
  const cells = { [k(free)]: desert };
  const v1 = C1.E.overworld.paint(worldFor(C1, four, 42, {}).ow, cells, worldFor(C1, four, 42, {}).g), v2 = C2.E.overworld.paint(worldFor(C2, four, 42, {}).ow, cells, worldFor(C2, four, 42, {}).g);
  check('the painted digest is identical in two vm contexts and the plain context', v1.digest === v2.digest && v1.digest === P1.digest, [v1.digest, v2.digest, P1.digest]);
  const built = E.overworld.build({ seed: 42, settings: {}, graph: g, minutes: Object.fromEntries(four.charter.sections.chapters.map((c) => [c.id, Number(c.targetMinutes) || 60])), palette: pal, paint: cells });
  check('build with spec.paint equals paint after build (same digest, same painted cell)', built.digest === P1.digest && built.painted[0] === free && built.unpainted.digest === ow.digest);
  const bad = E.overworld.paint(ow, { 'nine,1': desert, '9999,1': desert, [k(free)]: 'til_nope_zz99', [k(water)]: desert, [k(wall)]: desert, [k(gateCell)]: desert, [k(stamp)]: desert }, g);
  const codes = bad.skipped.map((s) => s.code).sort();
  check('every refusal has its code: paint-key, paint-bounds, paint-biome, paint-water, and paint-structure for a ridge, a gate, and a stamp', canon(codes) === canon(['paint-biome', 'paint-bounds', 'paint-key', 'paint-structure', 'paint-structure', 'paint-structure', 'paint-water']) && !bad.painted.length && bad.ok, codes);
  const sw = E.overworld.paint(ow, { [k(free)]: ocean }, g);
  check('water cannot be painted onto land (paint-swim)', sw.skipped.length === 1 && sw.skipped[0].code === 'paint-swim' && sw.ground[free] === ow.ground[free]);
  // The start, a site's front, and a boss approach only take walkable ground.
  const start = ow.sites.find((s) => s.role === 'start' && s.chapter === g.chapters[0]), front = start.front;
  const fr = E.overworld.paint(ow, { [k(front)]: mountain, [k(ow.start)]: mountain }, g), fr2 = E.overworld.paint(ow, { [k(front)]: desert }, g);
  check('a wall on the start or a site front is refused (paint-front), while walkable ground there is fine', fr.skipped.length === 1 + (front !== ow.start ? 1 : 0) && fr.skipped.every((x) => x.code === 'paint-front') && !fr.painted.length && fr2.painted.length === 1, fr.skipped);
  // Walling in every open neighbor of chapter one's key dungeon front: the greedy pass keeps all but the one that
  // would close the way, and refuses that one as paint-blocks.
  const keySite = ow.sites.find((s) => s.role === 'key' && s.chapter === g.chapters[0]), kf = keySite.front;
  const ring = [kf - 1, kf + 1, kf + ow.w].filter((c) => ow.st[c] === 0 && !ow.deco[c] && ow.owner[c] >= 0 && (ow.flags[ow.ground[c]] & 1));
  const ringCells = Object.fromEntries(ring.map((c) => [k(c), mountain]));
  const br = E.overworld.paint(ow, Object.assign({ [k(free)]: desert }, ringCells), g);
  const cut = br.skipped.length ? br.skipped[0].at[1] * ow.w + br.skipped[0].at[0] : -1;
  check('walling in a site is refused at the last open cell (paint-blocks, naming the walk problem) and every other cell is kept', ring.length >= 1 && br.skipped.length === 1 && br.skipped[0].code === 'paint-blocks' && /would break the walk/.test(br.skipped[0].message) && br.painted.length === ring.length && br.painted.indexOf(free) >= 0 && br.ground[cut] === ow.ground[cut] && br.ok, { ring, sk: br.skipped });
  check('the painted map still passes the engine\'s own check', !E.overworld.check(P1, g).length && !E.overworld.check(br, g).length);
  const nok = Object.assign({}, ow, { ok: false });
  check('a map that failed its own checks is never painted', E.overworld.paint(nok, cells, g) === nok);
  const engSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'engine-overworld.js'), 'utf8'), pSrc = engSrc.slice(engSrc.indexOf('function owPaint'), engSrc.indexOf('// ---------------------------------------------------------------- walking the map'));
  check('the paint code keeps the determinism rules (no Math.random, Date, for in, or Object.keys)', pSrc.length > 500 && !/Math\.random|Date|for \(var \w+ in |Object\.keys/.test(pSrc));

  // 2. The page.
  const { win } = await boot148();
  const pageErr = []; win.addEventListener('error', (e) => pageErr.push(e.message));
  const { Kit, WORLD } = win, d = win.document, ws = () => d.getElementById('ws');
  WORLD.loadFixture('four'); await wait(20);
  let b = Kit.bundle.current(); b.world.seed = 42;
  const orig = JSON.parse(JSON.stringify({ charter: b.charter, codex: b.codex, rules: b.rules, art: b.art }));
  check('the page has no Web Worker here, so builds run on the main thread (async false, nothing made)', WORLD.overworld.async() === false && WORLD.overworld.worker().made === 0);
  WORLD.zones.apply(); Kit.bundle.touch('t');
  const h0 = WORLD.overworld.paramHash(b), rec0 = JSON.stringify(WORLD.overworld.record(b));
  b.world.overrides.cells = {};
  check('an empty painted set leaves the hash as it always was, and the record has no paint field', WORLD.overworld.paramHash(b) === h0 && !WORLD.overworld.record(b).paint);
  delete b.world.overrides.cells;
  check('prefetch without a worker resolves the current map at once', (await WORLD.overworld.prefetch(b)).paramHash === h0 && WORLD.overworld.ready(b));
  const pow = WORLD.overworld.generate(b), pfree = freeCell(pow, 0), px = pfree % pow.w, py = Math.floor(pfree / pow.w), pdesert = biomeBy(pow, 'desert');
  check('the page builds the same overworld digest as the engine (four, seed 42)', pow.digest === ow.digest);
  let r = WORLD.overworld.paint(b, px, py, pdesert);
  check('paint stores the cell in world.overrides.cells, updates the cached map without a rebuild, and moves the hash', r.ok && r.changed && b.world.overrides.cells[px + ',' + py] === pdesert && WORLD.overworld.ready(b) && WORLD.overworld.generate(b).ground[pfree] === pdesert && WORLD.overworld.paramHash(b) !== h0 && WORLD.overworld.stale(b));
  const pwall = pow.st.findIndex((s) => s === 1);
  r = WORLD.overworld.paint(b, pwall % pow.w, Math.floor(pwall / pow.w), pdesert);
  check('painting a ridge is refused with the engine\'s reason and stores nothing', !r.ok && r.code === 'paint-structure' && /ridge/.test(r.message) && Object.keys(b.world.overrides.cells).length === 1);
  const pfront = pow.sites.find((s) => s.role === 'start' && s.chapter === WORLD.chapters(b)[0].id).front;
  r = WORLD.overworld.paint(b, pfront % pow.w, Math.floor(pfront / pow.w), pow.palette.mountain);
  check('painting a wall in front of the start town is refused (paint-front) and stores nothing', !r.ok && r.code === 'paint-front' && Object.keys(b.world.overrides.cells).length === 1, r.message);
  const rs = ring.map((c) => WORLD.overworld.paint(b, c % pow.w, Math.floor(c / pow.w), pow.palette.mountain));
  check('through the page, walling in the key dungeon is refused at the last open cell (paint-blocks) and only the others are stored', rs.filter((x) => !x.ok).length === 1 && rs.filter((x) => !x.ok)[0].code === 'paint-blocks' && Object.keys(b.world.overrides.cells).length === ring.length, rs.map((x) => x.code || 'ok'));
  ring.forEach((c) => WORLD.overworld.paint(b, c % pow.w, Math.floor(c / pow.w), null));
  WORLD.zones.apply();
  let rec = WORLD.overworld.record(b), res = Kit.refreshValidation();
  check('storing the painted map writes record.paint {cells 1, skipped none}, regenerates interiors and zones current, and validates clean but the Marches warning',
    rec.paint && rec.paint.cells === 1 && !rec.paint.skipped.length && !WORLD.overworld.stale(b) && !WORLD.interiors.stale(b) && !WORLD.zones.stale(b) && !res.errors.length && !res.broken.length && res.warnings.length === 1, res.warnings.map((x) => x.message));
  check('the walks of Phase 6 read the painted ground', WORLD.checks.walks(b).progression.ok && WORLD.overworld.generate(b).ground[pfree] === pdesert);
  check('IDs never move when a cell is painted', JSON.parse(rec0).id === rec.id);
  // A painted cell the engine skips (set by hand to a ridge) is a warning naming it.
  b.world.overrides.cells[pwall % pow.w + ',' + Math.floor(pwall / pow.w)] = pdesert; WORLD.overworld.apply(); WORLD.zones.apply();
  rec = WORLD.overworld.record(b); res = Kit.refreshValidation();
  check('a stored painted cell the engine cannot apply is listed in record.paint.skipped and is a warning, never an error', rec.paint.skipped.length === 1 && rec.paint.skipped[0].code === 'paint-structure' && res.warnings.some((x) => /painted cell was not applied/.test(x.message)) && !res.errors.length);
  r = WORLD.overworld.paint(b, px, py, null);
  check('clearing a painted cell removes it; unpaint removes the rest and says how many', r.ok && r.changed && !b.world.overrides.cells[px + ',' + py] && WORLD.overworld.unpaint(b) === 1 && !b.world.overrides.cells && WORLD.overworld.unpaint(b) === 0);
  WORLD.zones.apply();
  check('with every paint cleared the hash is the original again and nothing is stale', WORLD.overworld.paramHash(b) === h0 && !WORLD.zones.stale(b) && !WORLD.overworld.record(b).paint);

  // Zone cell keys.
  const keys = WORLD.zones.cellKeys(pow, b);
  const sample = [pfree, pwall, 0, pow.sites[0].entrance, Math.floor(pow.ground.length / 2)];
  check('zones.cellKeys covers every cell and agrees with cellKey (water, walls, and stamps have none)', keys.length === pow.w * pow.h && sample.every((i) => keys[i] === WORLD.zones.cellKey(i, b)) && keys[pwall] === null && keys[0] === null && keys[pfree] && WORLD.zones.cellKeys(pow, b) === keys);

  // Zone edits.
  const z0 = WORLD.zones.data(b).field.find((q) => q.troops.length >= 2), t0 = z0.troops[0], t1 = z0.troops[1];
  let e = WORLD.zones.edit(b, z0.key, { rate: z0.rate, weights: Object.fromEntries(z0.troops.map((t) => [t.troop, t.weight])) });
  check('an edit equal to the generated table stores nothing', e.ok && e.override === null && !(b.world.overrides.zones && b.world.overrides.zones[z0.key]));
  e = WORLD.zones.edit(b, z0.key, { rate: 40, weights: Object.fromEntries(z0.troops.map((t) => [t.troop, t.troop === t1.troop ? 12 : t.weight])) });
  const z1 = WORLD.zones.zone(z0.key, b);
  check('an edit stores only what differs (the rate and one weight), applies at once, and the stored table shows it marked overridden',
    e.ok && canon(b.world.overrides.zones[z0.key]) === canon({ rate: 40, weights: { [t1.troop]: 12 } }) && z1.rate === 40 && z1.troops.find((t) => t.troop === t1.troop).weight === 12 && z1.troops.find((t) => t.troop === t0.troop).weight === t0.weight && z1.overridden && !WORLD.zones.stale(b));
  check('zones.base still gives the generated table under the edit', WORLD.zones.base(b).field.find((q) => q.key === z0.key).rate === z0.rate);
  check('an unknown zone is refused', !WORLD.zones.edit(b, 'zone|field|nowhere|chp_x|forest', { rate: 1 }).ok);
  WORLD.zones.edit(b, z0.key, { rate: 40, weights: Object.fromEntries(z0.troops.map((t) => [t.troop, 0])) });
  res = Kit.refreshValidation();
  check('every weight at 0 with a rate above 0 is a warning that names the zone and never blocks Final', res.warnings.some((x) => x.message.indexOf(z0.key) >= 0 && /every weight is 0/.test(x.message)) && !res.errors.length && WORLD.finalBlock(b) === null);
  b.world.overrides.zones['zone|field|gone|chp_gone|forest'] = { rate: 3 }; Kit.bundle.touch('t');
  WORLD.zones.apply(); res = Kit.refreshValidation();
  check('an edit naming a zone the world no longer has is a warning', res.warnings.some((x) => /no longer has/.test(x.message)));
  delete b.world.overrides.zones['zone|field|gone|chp_gone|forest'];
  e = WORLD.zones.edit(b, z0.key, null);
  check('Back to generated removes the override and the table is the generated one again', e.ok && !b.world.overrides.zones && WORLD.zones.zone(z0.key, b).rate === z0.rate && !WORLD.zones.zone(z0.key, b).overridden);
  e = WORLD.zones.edit(b, z0.key, { rate: 33 });

  // Per continent settings.
  const slug = WORLD.continents(b)[0].slug;
  b.world.settings.overworld.continents[slug] = { radius: 1.2 }; Kit.bundle.touch('t');
  check('a continent radius moves the hash and marks the map out of date; the engine reads it', WORLD.overworld.paramHash(b) !== h0 && WORLD.overworld.stale(b) && win.ENGINE_WORLD.overworld.settings(b.world.settings).continents[slug].radius === 1.2);
  delete b.world.settings.overworld.continents[slug]; Kit.bundle.touch('t');
  check('removing it brings the stored map back to current', !WORLD.overworld.stale(b));

  // The viewer's math and the music lookup.
  check('the zoom ladder is whole device pixels a cell, below the tile size then whole multiples of it', canon(WORLD.tiles.ladder(16)) === canon([1, 2, 3, 4, 6, 8, 12, 16, 32, 48, 64, 96, 128]) && canon(WORLD.tiles.ladder(8).slice(-6)) === canon([8, 16, 24, 32, 48, 64]) && WORLD.tiles.snap([1, 2, 4, 8], 5.9) === 4 && WORLD.tiles.snap([1, 2, 4, 8], 0.2) === 1);
  check('tile size comes from the Charter specs as Day 147 reads it (16 here) and the master palette has entries', WORLD.tiles.size(b) === 16 && WORLD.tiles.entries(b).length > 4);
  check('every continent of the fixture has its field:<slug> track, found the way the player finds it', WORLD.continents(b).every((c) => { const t = WORLD.audio.track(b, 'field:' + c.slug); return t && t.kind === 'track' && t.subject.ref === 'music:field:' + c.slug; }));
  check('without Web Audio, Play says so instead of throwing', WORLD.audio.play(b, slug) === false && /no Web Audio/.test(WORLD.audio.error()) && WORLD.audio.playing() === null);

  // 3. The tabs.
  Kit.go('world'); await wait(30);
  const segs = ws().querySelectorAll('.w8-seg-btn');
  check('World: seven overlays (Tiles first and chosen), Sites and Gates toggles, the viewer naming the 224 by 224 map, and zoom buttons of 44 px by style',
    segs.length === 7 && segs[0].textContent === 'Tiles' && segs[0].getAttribute('aria-checked') === 'true' && ws().querySelectorAll('.w8-owbar .switch').length === 2 &&
    ws().querySelector('.w8-view-cv').dataset.w === '224' && ws().querySelector('.w8-view-cv').dataset.overlay === 'tiles' && ws().querySelectorAll('.w8-zoom').length === 3);
  check('World: the inspector invites a tap, and the Continents card has three sliders and a field music button per continent',
    /Tap or click any cell/.test(d.getElementById('w8-inspect').textContent) && d.querySelectorAll('.w8-cont').length === 4 && d.querySelectorAll('.w8-cont .w8-range').length === 12 && d.querySelectorAll('.w8-music').length === 4);
  check('World: every region and gate has a Show button', d.querySelectorAll('#w8-regions .w8-pick').length === WORLD.overworld.record(b).regions.length + WORLD.overworld.record(b).gates.length);
  segs[6].click(); await wait(20);
  check('choosing Zones redraws with the zone overlay and a legend of zones by biome and chapter', ws().querySelector('.w8-view-cv').dataset.overlay === 'zones' && /\(\d+\)/.test(ws().querySelector('.w8-legend').textContent));
  const rng = d.querySelector('.w8-cont .w8-range'); rng.value = '1.5'; rng.dispatchEvent(new win.Event('change')); await wait(30);
  check('moving a continent slider writes the sparse setting and the tab offers Store changes', b.world.settings.overworld.continents[d.querySelector('.w8-cont').dataset.continent].radius === 1.5 && Array.prototype.some.call(ws().querySelectorAll('button'), (x) => /Store changes/.test(x.textContent)));
  Array.prototype.find.call(d.querySelectorAll('.w8-cont button'), (x) => /Reset/.test(x.textContent)).click(); await wait(30);
  check('Reset removes the continent\'s settings and the map is current again', !b.world.settings.overworld.continents[d.querySelector('.w8-cont').dataset.continent] && !WORLD.overworld.stale(b));
  WORLD.worldUi.overlay = 'tiles';
  WORLD.showAt(null, [px, py]); await wait(30);
  check('Show on map opens the World tab with that cell picked and the inspector reading it, with its paint controls', Kit.active() === 'world' && canon(WORLD.worldUi.view.sel) === canon([px, py]) && new RegExp('Cell' + px + ', ' + py).test(d.getElementById('w8-inspect').textContent) && d.querySelector('.w8-paint select') && /Paint/.test(d.querySelector('.w8-paint').textContent));
  const paintBtn = Array.prototype.find.call(d.querySelectorAll('.w8-paint button'), (x) => /^Paint$/.test(x.textContent.trim()));
  d.querySelector('.w8-paint select').value = pdesert; paintBtn.click(); await wait(30);
  check('the inspector\'s Paint button paints the cell, marks the chip, and offers Clear paint', b.world.overrides.cells && b.world.overrides.cells[px + ',' + py] === pdesert && /1 painted/.test(ws().textContent) && /Clear paint/.test(d.getElementById('w8-inspect').textContent));
  Array.prototype.find.call(d.querySelectorAll('#w8-inspect button'), (x) => /Clear all/.test(x.textContent)).click(); await wait(30);
  check('Clear all removes every painted cell', !b.world.overrides.cells);
  Array.prototype.find.call(ws().querySelectorAll('button'), (x) => /Generate again|Store changes/.test(x.textContent)).click(); await wait(60);
  Kit.go('sites'); await wait(30);
  check('Sites: Tiles and Exits toggles, the viewer on the site with its floor, and a readout of the tapped cell', ws().querySelectorAll('.w8-site .w8-owbar .switch').length === 2 && ws().querySelector('.w8-imap canvas').dataset.site === WORLD.sitesUi.site && ws().querySelector('.w8-imap canvas').dataset.floor === '1' && /Tap a cell/.test(ws().querySelector('.w8-cellread').textContent));
  const bossMap = WORLD.interiors.maps(b).find((m) => m.kind === 'dungeon' && m.floor === 2), bossAt = bossMap.features.find((f) => f.kind === 'boss').at;
  WORLD.showAt(bossMap.id, bossAt[1] * bossMap.w + bossAt[0]); await wait(30);
  check('Show on map with an interior map opens the Sites tab on that site and floor, the cell picked and read', Kit.active() === 'sites' && ws().querySelector('.w8-imap canvas').dataset.floor === '2' && /the boss/.test(ws().querySelector('.w8-cellread').textContent) && canon(WORLD.sitesUi.view.sel) === canon(bossAt));
  Kit.go('encounters'); await wait(30);
  const zall = WORLD.zones.data(b).field.length + WORLD.zones.data(b).interior.length;
  check('Encounters: one Edit button per zone, and the edited zone wears an Edited chip', ws().querySelectorAll('.w8-zedit').length === zall && ws().querySelectorAll('.w8-enc .chip-accent').length === 1);
  const eb = Array.prototype.find.call(ws().querySelectorAll('.w8-zedit'), (x) => x.dataset.zone === z0.key); eb.click(); await wait(30);
  const form = ws().querySelector('.w8-zform');
  check('Edit opens the form under its row: the rate and one weight per troop, with the generated values beside them', form && form.querySelectorAll('input').length === 1 + z0.troops.length && /generated 12|generated \d+/.test(form.textContent) && ws().querySelector('.w8-zedit[aria-expanded="true"]'));
  form.querySelectorAll('input')[0].value = '7';
  Array.prototype.find.call(form.querySelectorAll('button'), (x) => /Back to generated/.test(x.textContent)).click(); await wait(30);
  check('Back to generated in the form removes the override and closes it', !b.world.overrides.zones && !ws().querySelector('.w8-zform') && !ws().querySelectorAll('.w8-enc .chip-accent').length);
  Array.prototype.find.call(ws().querySelectorAll('.w8-zedit'), (x) => x.dataset.zone === z0.key).click(); await wait(30);
  ws().querySelector('.w8-zform').querySelectorAll('input')[0].value = '9';
  Array.prototype.find.call(ws().querySelectorAll('.w8-zform button'), (x) => /Save/.test(x.textContent)).click(); await wait(30);
  check('Save in the form stores the new rate only', canon(b.world.overrides.zones) === canon({ [z0.key]: { rate: 9 } }) && WORLD.zones.zone(z0.key, b).rate === 9);
  Kit.go('validation'); await wait(40);
  const pills = ws().querySelectorAll('.w8-vpill'), cards = ws().querySelectorAll('.w8-vcard');
  check('Validation: six jump links naming each check\'s state, failing or warned cards first, a Show button per chapter, and Go to Export when ready',
    pills.length === 6 && /Pass with warnings/.test(pills[1].textContent) && cards[0].dataset.check === 'progression' && ws().querySelectorAll('.w8-walk-tbl .w8-pick').length === 6 && Array.prototype.some.call(ws().querySelectorAll('button'), (x) => /Go to Export/.test(x.textContent)));
  // A fault with a cell: make the dungeon wall passable (as Phase 6 did); every flag item names its map and cell.
  const dun = Object.keys(b.art.records.til_).find((id) => b.art.records.til_[id].subject && b.art.records.til_[id].subject.ref === 'interior:dungeon');
  const wt = b.art.records.til_[dun].tiles.find((t) => t.key === 'wall'), f0 = wt.flags; wt.flags = 1; Kit.bundle.touch('t'); Kit.rerender(); await wait(40);
  const flagCard = Array.prototype.find.call(ws().querySelectorAll('.w8-vcard'), (c) => c.dataset.check === 'flags'), onmap = flagCard.querySelector('.w8-onmap');
  check('a flag fault puts its card first with Fail, and its item offers Show on map', /^(flags|progression)$/.test(ws().querySelectorAll('.w8-vcard')[0].dataset.check) && /Fail/.test(flagCard.textContent) && !!onmap, flagCard.textContent.slice(0, 200));
  check('the flag fault items carry their map and cell', Kit.refreshValidation().errors.filter((x) => x.check === 'flags').every((x) => x.map && x.at != null));
  if (onmap) { onmap.click(); await wait(40); }
  const fi = Kit.refreshValidation().errors.filter((x) => x.check === 'flags'), inner = fi.find((x) => x.map !== 'overworld');
  check('Show on map follows the item: an overworld fault opens the World tab on its cell', Kit.active() === 'world' && fi[0].map === 'overworld' && canon(WORLD.worldUi.view.sel) === canon([fi[0].at % pow.w, Math.floor(fi[0].at / pow.w)]));
  WORLD.showAt(inner.map, inner.at); await wait(40);
  check('and an interior fault (map named <site key>|<floor>) opens the Sites tab on that site and floor with the cell picked', Kit.active() === 'sites' && WORLD.sitesUi.site + '|' + WORLD.sitesUi.floor === inner.map && Array.isArray(WORLD.sitesUi.view.sel));
  wt.flags = f0; Kit.bundle.touch('t');
  Kit.go('validation'); await wait(30);
  const many = Array.prototype.find.call(ws().querySelectorAll('.w8-vcard'), (c) => c.querySelector('.w8-vmore'));
  check('no card needs Show all on a clean world', !many);

  // 4. Export with painted cells and a zone edit: Days 146 and 147 open the Final unchanged.
  WORLD.overworld.paint(b, px, py, pdesert); WORLD.zones.apply();
  check('prior namespaces are untouched by everything this phase does (the givers aside, as in Phase 5)', PRIOR.filter((k2) => k2 !== 'rules').every((k2) => canon(b[k2]) === canon(orig[k2])) &&
    canon(Object.assign({}, b.rules, { sdq_: null })) === canon(Object.assign({}, orig.rules, { sdq_: null })));
  let fin = null, finErr = null; try { fin = Kit.buildExport('final'); } catch (x) { finErr = x.message; }
  const fb = fin && JSON.parse(fin.files[0].text), fman = fin && JSON.parse(fin.files[1].text);
  check('Final is allowed with a painted cell and a zone edit, and the bundle carries both', !finErr && fb.world.overrides.cells[px + ',' + py] === pdesert && fb.world.overrides.zones[z0.key].rate === 9 && fman.worldOpened && fman.checks.progression.ok, finErr);
  if (fin) {
    const f146 = await in146(fin.files[0].text, (w, K, rr) => ({ fwd: rr.forward.length, diff: PRIOR.concat(['world']).filter((k2) => canon(K.bundle.current()[k2]) !== canon(fb[k2])) }));
    check('Day 146 opens it with every namespace identical, 0 errors, 0 broken, 0 forward', f146.matches && !f146.diff.length && !f146.summary.errors && !f146.summary.broken && !f146.fwd, f146);
    const f147 = await in147(fin.files[0].text, (w, K) => ({ diff: PRIOR.concat(['world']).filter((k2) => canon(K.bundle.current()[k2]) !== canon(fb[k2])) }));
    check('Day 147 opens it with every namespace identical, 0 errors, 0 broken', f147.matches && !f147.diff.length && !f147.summary.errors && !f147.summary.broken, f147.summary);
  }
  const eng = fin && fin.files.find((f) => /engine-world/.test(f.name));
  check('the exported engine-world.js carries overworld.paint, so Day 150 regenerates painted worlds from the bundle', eng && /function owPaint/.test(eng.text));
  check('no page errors', !pageErr.length, pageErr.slice(0, 3));

  const n = results.filter((x) => x.ok).length;
  results.forEach((x) => console.log((x.ok ? 'PASS ' : 'FAIL ') + x.name + (x.ok ? '' : '  ' + String(JSON.stringify(x.detail)).slice(0, 700))));
  fs.writeFileSync(path.join(OUT, 'phase7-report.json'), JSON.stringify({ when: new Date().toISOString(), pass: n, total: results.length, results }, null, 2));
  console.log('\n' + n + ' of ' + results.length + ' passed');
  process.exit(n === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
