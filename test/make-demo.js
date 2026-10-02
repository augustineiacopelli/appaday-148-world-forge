// Builds the World Forge fixtures by running Day 147's own harness on Day 146 bundles, so every fixture is a real Day 147
// Final export: Quick Build fills the art, then Kit.buildExport('final', {fill: true}) opens art and stamps forge 147.
// Outputs:
//   test/out/demo147-bundle.json  the Day 146 demo (two chapters, Westland and Eastland), dressed by Day 147.
//   test/out/four147-bundle.json  six chapters on four continents (Westland and Southmere each shared by two chapters),
//                                 one chapter with no boss troop, two side quests with an empty giver. Built from the
//                                 same demo through Day 146 shaped edits, restamped, then dressed by Day 147.
'use strict';
const fs = require('fs');
const path = require('path');
const { boot } = require('./boot');
const { in146 } = require('./compat');
const APP147 = path.join(require('../day147'), 'index.html');
const OUT = path.join(__dirname, 'out');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function page147() {
  const { win, errors } = boot(APP147, { url: 'https://augustineiacopelli.github.io/appaday-147-art-and-audio-forge/' });
  await wait(60);
  await win.ART.booted;
  if (errors.length) throw new Error('Day 147 page errors: ' + errors.join('\n'));
  return win;
}
async function dress(bundle) {
  const win = await page147(), Kit = win.Kit, ART = win.ART;
  Kit.bundle.load(bundle);
  const rep = ART.quickBuild.run(Kit.bundle.current());
  Kit.refreshValidation();
  const out = Kit.buildExport('final', { fill: true, engines: false });
  const b = JSON.parse(out.files[0].text);
  const res = Kit.refreshValidation();
  return { text: out.files[0].text, bundle: b, created: rep.created, coverage: ART.coverage.compute(Kit.bundle.current()), summary: Kit.validate.summary(res) };
}

// Day 146 shaped edits on the plain demo: four more chapters, three more continents, bosses, troops, side quests.
function fourContinents(demo) {
  const b = JSON.parse(JSON.stringify(demo));
  const S = b.charter.sections, R = b.rules;
  const [low, far] = S.chapters;
  const chap = (id, name, label, minutes, summary) => ({ id, name, continentLabel: label, summary, targetMinutes: minutes, charterVersion: 0 });
  S.chapters = [
    Object.assign(low, { targetMinutes: 60 }),
    chap('chp_the_marches_m4r2', 'The Marches', 'Westland', 45, 'The road climbs toward the border forts.'),
    Object.assign(far, { targetMinutes: 90 }),
    chap('chp_the_frost_reach_f7k1', 'The Frost Reach', 'Northreach', 60, 'A northern detour through the ice fields.'),
    chap('chp_the_sunken_coast_s2c9', 'The Sunken Coast', 'Southmere', 75, 'The drowned towns of the south.'),
    chap('chp_the_last_light_l9t3', 'The Last Light', 'Southmere', 120, 'The message is read where the land ends.')
  ];
  S.endings = { endings: [{ name: 'Delivered', concept: 'The message is read aloud.' }] };
  b.charter.quotas = Object.assign({}, b.charter.quotas, { towns: 7, dungeons: 10, bosses: 5, targetPlayHours: 7 });
  delete b.charter.lockFingerprint;
  const enm = Object.values(R.enm_), byName = (n) => enm.find((e) => e.name === n).id;
  const warden = enm.find((e) => e.isBoss);
  const V = b.charter.version;
  const put = (prefix, rec) => { (R[prefix] = R[prefix] || {})[rec.id] = Object.assign({ charterVersion: V }, rec); return rec; };
  const boss = (id, name, famOf, level, hp) => put('enm_', Object.assign(JSON.parse(JSON.stringify(warden)), { id, name, family: R.enm_[byName(famOf)].family, level, stats: Object.assign({}, warden.stats, { hp }), isBoss: true }));
  boss('enm_slime_king_k2s8', 'Slime King', 'Slime', 6, 420);
  boss('enm_frost_wolf_f3w1', 'Frost Wolf', 'Wolf T2', 16, 1400);
  boss('enm_tide_wisp_t8w4', 'Tide Wisp', 'Wisp T2', 20, 1800);
  boss('enm_the_hollow_one_h1o5', 'The Hollow One', 'Wolf T2', 26, 2600);
  const troop = (id, name, chp, members, noEscape) => put('trp_', { id, name, members: members.map((m) => ({ enm: m.startsWith('enm_') ? m : byName(m), row: 'front' })), chapter: chp, flags: { noEscape: !!noEscape, preemptiveChance: 0 } });
  const [c1, c2, c3, c4, c5, c6] = S.chapters.map((c) => c.id);
  troop('trp_slime_king_k4t2', 'Slime King', c1, ['enm_slime_king_k2s8'], true);
  troop('trp_march_wolves_m1w7', 'March Wolves', c2, ['Wolf', 'Wolf']);
  troop('trp_march_mixed_m5x3', 'March Mixed', c2, ['Slime', 'Wisp', 'Wolf']);
  troop('trp_frost_pack_f6p2', 'Frost Pack', c4, ['Wolf T2', 'Wolf T2']);
  troop('trp_frost_wolf_f8b9', 'Frost Wolf', c4, ['enm_frost_wolf_f3w1'], true);
  troop('trp_coast_wisps_c3w6', 'Coast Wisps', c5, ['Wisp T2', 'Slime T2']);
  troop('trp_tide_wisp_t2b7', 'Tide Wisp', c5, ['enm_tide_wisp_t8w4'], true);
  troop('trp_last_pack_l4p8', 'Last Pack', c6, ['Wolf T2', 'Wisp T2', 'Slime T2']);
  troop('trp_hollow_one_h9b2', 'The Hollow One', c6, ['enm_the_hollow_one_h1o5'], true);
  // The Marches (chapter 2) is the chapter with no boss troop.
  const eps = Object.values(R.eps_)[1];
  [[c2, 'Marches state', 7], [c4, 'Frost Reach state', 16], [c5, 'Sunken Coast state', 20], [c6, 'Last Light state', 26]].forEach(([c, n, lv], i) =>
    put('eps_', Object.assign(JSON.parse(JSON.stringify(eps)), { id: 'eps_state_' + 'abcd'[i] + '7q' + i, name: n, chapter: c, targetLevel: lv })));
  put('sdq_', { id: 'sdq_lost_ring_r3q1', name: 'The lost ring', text: 'A farmer in the lowlands lost his late wife\'s ring near the river.', chapter: c1, rewards: [], refs: [] });
  put('sdq_', { id: 'sdq_frozen_lantern_l6q4', name: 'The frozen lantern', text: 'Relight the lantern that guides sleds across the ice.', chapter: c4, rewards: [], refs: [] });
  b.kit.title = 'Four Continents';
  b.kit.bundleId = 'bnd_fourcontinents';
  return b;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = await page147();
  const demo146 = win.ART_DEMO.bundle();
  const summary = {};
  for (const [key, file, make] of [['demo', 'demo147-bundle.json', (d) => d], ['four', 'four147-bundle.json', fourContinents]]) {
    const src = make(JSON.parse(JSON.stringify(demo146)));
    src.kit.contentHash = win.Kit.bundle.hash(src);
    const r146 = await in146(JSON.stringify(src));
    const d = await dress(src);
    fs.writeFileSync(path.join(OUT, file), d.text);
    const chk = await in146(d.text);
    summary[key] = {
      file, bytes: d.text.length, artCreated: d.created, coverage: d.coverage.covered + '/' + d.coverage.required, in147: d.summary,
      forges: Object.keys(d.bundle.kit.forges).join(' '), opened: d.bundle.kit.opened.join(' '),
      chapters: d.bundle.charter.sections.chapters.map((c) => c.name + '@' + c.continentLabel).join(', '),
      biomes: Object.values(d.bundle.art.records.til_).filter((t) => t.kind === 'biome').length,
      interiors: Object.values(d.bundle.art.records.til_).filter((t) => t.kind === 'interior').map((t) => t.subject.ref).join(' '),
      source146: r146.summary, final146: { matches: chk.matches, summary: chk.summary, errors: chk.errors.slice(0, 3) }
    };
  }
  console.log(JSON.stringify(summary, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
