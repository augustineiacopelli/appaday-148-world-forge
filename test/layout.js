// Layout audit in headless Chromium at 390 and 1280 wide: no horizontal scroll and no tap target under 44 px on every
// tab, the export dialog, and the size drawer. Needs Playwright with Chromium (not in package.json; install it on its own,
// for example npm install playwright in a scratch folder and run with NODE_PATH pointing at it).
const { chromium } = require('playwright');
const ROOT = require('path').join(__dirname, '..');
(async () => {
  const br = await chromium.launch();
  const report = [];
  for (const w of [390, 1280]) {
    const pg = await br.newPage({ viewport: { width: w, height: 900 } });
    const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await pg.goto('file://' + ROOT + '/index.html?dev=1');
    await pg.waitForFunction(() => window.WORLD && window.Kit && window.Kit.bundle.current());
    await pg.evaluate(() => window.WORLD.booted);
    await pg.evaluate(() => window.WORLD.loadFixture('four'));
    await pg.waitForTimeout(200);
    const audit = async (label) => pg.evaluate((label) => {
      const de = document.documentElement, small = [];
      document.querySelectorAll('button, a, input, select, label.switch, [role=tab]').forEach((e) => {
        const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
        if (!r.width || !r.height || cs.visibility === 'hidden' || e.closest('[hidden]')) return;
        if (e.tagName === 'INPUT' && (e.type === 'checkbox' || e.type === 'radio' || e.type === 'file')) return;
        if (e.tagName === 'A' && e.closest('p, td, dd, small')) return;
        if (r.height < 44 || r.width < 44) small.push((e.id || e.className || e.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' ' + (e.textContent || '').trim().slice(0, 20));
      });
      return { label, hscroll: de.scrollWidth > de.clientWidth, sw: de.scrollWidth, cw: de.clientWidth, small: small.slice(0, 8) };
    }, label);
    for (const t of ['start', 'world', 'sites', 'encounters', 'validation', 'export', 'dev']) {
      await pg.evaluate((t) => window.Kit.go(t), t); await pg.waitForTimeout(120);
      report.push(Object.assign({ w }, await audit(t)));
    }
    // The World tab once the overworld exists (Phase 3): the map, overlay buttons, and the region and gate tables.
    await pg.evaluate(() => { window.WORLD.overworld.apply(); window.Kit.go('world'); }); await pg.waitForTimeout(200);
    report.push(Object.assign({ w }, await audit('world (generated)')));
    await pg.evaluate(() => { const b = document.querySelectorAll('.w8-seg-btn')[4]; if (b) b.click(); }); await pg.waitForTimeout(150);
    report.push(Object.assign({ w }, await audit('world (regions overlay)')));
    await (await pg.$('.w8-ow')).screenshot({ path: ROOT + '/test/out/phase3-world-' + w + '.png' });
    // The Sites tab once the interiors exist (Phase 4): the preview, a two floor dungeon, and a town with its people.
    await pg.evaluate(() => { window.WORLD.interiors.apply(); window.Kit.go('sites'); }); await pg.waitForTimeout(250);
    report.push(Object.assign({ w }, await audit('sites (generated)')));
    await pg.evaluate(() => { const b = Array.prototype.find.call(document.querySelectorAll('.w8-pick'), (x) => /boss/.test(x.dataset.site)); if (b) b.click(); }); await pg.waitForTimeout(200);
    await pg.evaluate(() => { const b = document.querySelectorAll('.w8-seg-btn')[1]; if (b) b.click(); }); await pg.waitForTimeout(200);
    report.push(Object.assign({ w }, await audit('sites (boss dungeon, floor 2)')));
    await (await pg.$('.w8-site')).screenshot({ path: ROOT + '/test/out/phase4-sites-dungeon-' + w + '.png' });
    await pg.evaluate(() => { const b = Array.prototype.find.call(document.querySelectorAll('.w8-pick'), (x) => /start/.test(x.dataset.site)); if (b) b.click(); }); await pg.waitForTimeout(200);
    report.push(Object.assign({ w }, await audit('sites (town)')));
    await (await pg.$('.w8-site')).screenshot({ path: ROOT + '/test/out/phase4-sites-town-' + w + '.png' });
    // The Encounters tab once the zones exist (Phase 5): the zone tables, bosses, and side quest givers.
    await pg.evaluate(() => { window.WORLD.zones.apply(); window.Kit.go('encounters'); window.Kit.rerender(); }); await pg.waitForTimeout(250);
    report.push(Object.assign({ w }, await audit('encounters (generated)')));
    await pg.screenshot({ path: ROOT + '/test/out/phase5-encounters-' + w + '.png', fullPage: false });
    // The Validation tab once everything exists (Phase 6): the check cards and the chapter walk.
    await pg.evaluate(() => { window.Kit.go('validation'); window.Kit.rerender(); }); await pg.waitForTimeout(300);
    report.push(Object.assign({ w }, await audit('validation (generated)')));
    await pg.screenshot({ path: ROOT + '/test/out/phase6-validation-' + w + '.png', fullPage: true });
    await pg.evaluate(() => window.Kit.openExport()); await pg.waitForTimeout(150);
    report.push(Object.assign({ w }, await audit('export dialog')));
    await pg.evaluate(() => window.Kit.ui.closeTop()); await pg.waitForTimeout(100);
    await pg.evaluate(() => window.WORLD.openSize()); await pg.waitForTimeout(150);
    report.push(Object.assign({ w }, await audit('size drawer')));
    // Google Fonts cannot load offline; any other console error is reported.
    report.push({ w, errors: errs.filter((e) => !/ERR_(TUNNEL|NAME|INTERNET|CONNECTION)/.test(e)) });
    await pg.close();
  }
  await br.close();
  const bad = report.filter((r) => r.hscroll || (r.small && r.small.length) || (r.errors && r.errors.length));
  console.log(JSON.stringify(report, null, 0).replace(/\},\{/g, '},\n{'));
  console.log(bad.length ? 'LAYOUT FAIL ' + bad.length : 'LAYOUT PASS: ' + report.filter((r) => r.label).length + ' views, no horizontal scroll, no target under 44 px, no errors');
  process.exit(bad.length ? 1 : 0);
})();
