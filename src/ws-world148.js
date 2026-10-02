// === WS:WORLD148 BEGIN ===
(function () {
  'use strict';
  var U = Kit.util, el = U.el, esc = U.esc;
  var DEV = /[?&]dev=1(&|$)/.test(location.search);
  function cur() { return Kit.bundle.current(); }
  function ready(b) {
    b = b || cur();
    var r = WORLD.readiness(b);
    return r === true ? true : r;
  }
  function kv(pairs) { return '<dl class="kv">' + pairs.map(function (p) { return '<dt>' + esc(p[0]) + '</dt><dd>' + p[1] + '</dd>'; }).join('') + '</dl>'; }
  function button(label, icon, cls, fn) {
    var b = el('button', 'btn' + (cls ? ' ' + cls : ''), (icon ? Kit.icon(icon) : '') + '<span>' + esc(label) + '</span>');
    b.type = 'button'; b.addEventListener('click', fn);
    return b;
  }
  function toggle(label, on, fn) {
    var l = el('label', 'switch'), c = el('input'); c.type = 'checkbox'; c.checked = !!on;
    l.appendChild(c); l.appendChild(el('span', 'track')); l.appendChild(el('span', 'switch-text', esc(label)));
    c.addEventListener('change', function () { fn(c.checked); });
    return l;
  }
  WORLD.ui = { button: button, toggle: toggle, kv: kv };

  // ---------------------------------------------------------------- size meter (header)
  function paintMeter() {
    var btn = document.getElementById('btnSize');
    if (!btn || !cur()) return;
    var s = WORLD.size();
    var cls = s.level === 'red' ? 'chip-error' : s.level === 'amber' ? 'chip-warning' : 'chip-ok';
    btn.innerHTML = '<span class="chip ' + cls + '">' + esc(U.fmtSize(s.total)) + '</span>';
    btn.setAttribute('aria-label', 'Bundle size ' + U.fmtSize(s.total) + ', ' + (s.level === 'ok' ? 'within budget' : s.level === 'amber' ? 'getting large' : 'near the storage limit') + '. Open size details.');
    btn.title = 'Bundle size ' + U.fmtSize(s.total) + ' of about ' + U.fmtSize(s.room) + ' available';
  }
  var meterSoon = U.debounce(paintMeter, 250);
  function sizeBody(host) {
    var s = WORLD.size();
    var pct = Math.min(100, Math.round(s.total / Math.max(1, s.room) * 100));
    host.appendChild(el('div', 'w8-meter w8-' + s.level, '<i style="width:' + pct + '%"></i>'));
    host.appendChild(el('p', 'muted', esc(U.fmtSize(s.total) + ' of about ' + U.fmtSize(s.room) + ' available in this browser. ' +
      (s.where === 'idb' ? 'The draft is saved in IndexedDB because localStorage filled up; exports are still the safe copy.' : 'The draft is saved under this forge\'s own keys, so Days 146 and 147 in another tab never overwrite it.'))));
    var t = el('table', 'tbl');
    t.innerHTML = '<thead><tr><th scope="col">Namespace</th><th scope="col" class="num">Size</th></tr></thead><tbody>' +
      Object.keys(s.ns).map(function (k) { return '<tr><th scope="row">' + esc(k) + '</th><td class="num">' + esc(U.fmtSize(s.ns[k])) + '</td></tr>'; }).join('') + '</tbody>';
    var w = el('div', 'tbl-wrap'); w.appendChild(t); host.appendChild(w);
  }
  WORLD.openSize = function () { Kit.ui.drawer({ title: 'Bundle size', body: function (b) { sizeBody(b); } }); };
  WORLD.paintMeter = paintMeter;

  // ---------------------------------------------------------------- the engine file
  // ENGINE:WORLD read back from this page's own script and written out as engine-world.js under a header. The markers are
  // built from parts so this fence never finds itself.
  var ENG = WORLD.engines = { FILE: 'engine-world.js', GLOBAL: 'ENGINE_WORLD' };
  ENG.markers = function () { var f = '// === ENGINE:' + 'WORLD '; return [f + 'BEGIN ===', f + 'END ===']; };
  ENG.cut = function (text) {
    var mk = ENG.markers(), a = text.indexOf(mk[0]), z = text.indexOf(mk[1]);
    if (a < 0 || z < a || text.indexOf(mk[0], a + 1) >= 0) return '';
    return text.slice(a, z + mk[1].length) + '\n';
  };
  var srcCache = '';
  ENG.source = function () {
    if (srcCache) return srcCache;
    var list = document.getElementsByTagName('script');
    for (var i = 0; i < list.length; i++) { var s = ENG.cut(list[i].textContent || ''); if (s) { srcCache = s; break; } }
    return srcCache;
  };
  ENG.available = function () { return !!ENG.source(); };
  ENG.header = function (hash) {
    return '/* World Forge ENGINE:WORLD, engine version ' + ENGINE_WORLD.version + '\n' +
      ' * Forge 148 (AppADay 148). Declares one global, ENGINE_WORLD. No dependencies; reads no host global. */\n' +
      (hash ? '/* Bundle hash ' + hash + ' */\n' : '');
  };
  ENG.file = function (hash) { return { key: 'engine-world', name: ENG.FILE, text: ENG.header(hash) + ENG.source(), mime: 'text/javascript' }; };

  // ---------------------------------------------------------------- manifest
  var ID_SCAN = /^[a-z]{3}_[a-z0-9_]*[a-z0-9]$/;
  function scanRefs(node, own, out, depth) {
    if (depth > 12 || node == null) return;
    if (typeof node === 'string') { if (ID_SCAN.test(node) && Kit.ids.isValid(node) && !own[node]) out[node] = 1; return; }
    if (typeof node !== 'object') return;
    if (Array.isArray(node)) { for (var i = 0; i < node.length; i++) scanRefs(node[i], own, out, depth + 1); return; }
    Object.keys(node).forEach(function (k) { if (k !== 'id') scanRefs(node[k], own, out, depth + 1); });
  }
  WORLD.manifest = function (b, hash) {
    b = b || cur();
    WORLD.ensure(b);
    var created = [], counts = {}, own = {}, refs = {}, idx = Kit.index(b);
    WORLD.PREFIXES.forEach(function (p) { var ids = Object.keys(b.world.records[p] || {}).sort(); counts[p] = ids.length; ids.forEach(function (id) { created.push(id); own[id] = 1; }); });
    WORLD.PREFIXES.forEach(function (p) { Object.keys(b.world.records[p] || {}).sort().forEach(function (id) { scanRefs(b.world.records[p][id], {}, refs, 0); }); });
    ['progression', 'zones', 'overrides'].forEach(function (k) { scanRefs(b.world[k], {}, refs, 0); });
    var fw = WORLD.forwardRefs(b).concat(WORLD.rulesRefs(b));
    fw.forEach(function (f) { refs[f.id] = 1; });
    var referenced = Object.keys(refs).sort();
    var unresolved = referenced.filter(function (id) { return !idx.byId[id] && !own[id]; });
    fw.forEach(function (f) { if (!f.ok && unresolved.indexOf(f.id) < 0) unresolved.push(f.id); });
    var s = Kit.validate.summary(Kit.validate(b));
    return {
      forge: WORLD.FORGE, bundleHash: hash || '', worldVersion: b.world.version, generator: U.clone(b.world.generator), seed: b.world.seed,
      charterVersion: b.charter.version || 0, artVersion: b.art && b.art.version || null, exportedAt: U.now(),
      created: created, referenced: referenced, unresolved: unresolved.sort(), forward: fw, worldOpened: Kit.codex.isOpened('world', b), counts: counts,
      validation: s, checks: WORLD.checks ? WORLD.checks.summary(b) : null, bake: WORLD.bake ? WORLD.bake.status(b) : null, engines: [{ key: 'world', global: ENG.GLOBAL, file: ENG.FILE, version: ENGINE_WORLD.version }]
    };
  };

  // ---------------------------------------------------------------- export (forge 148)
  // Overrides the Day 146 export dialog, which belongs to forge 146. KIT:CORE text is unchanged; these are reassignments.
  // Files, in order: bundle, manifest, engine-world.js. exportFile restamps kit.contentHash without a status, so
  // forges['146'] and forges['147'] are never touched; the manifest and the engine header carry the same hash.
  function finalBlock(b) {
    var res = Kit.refreshValidation(), n = res.errors.length + res.broken.length;
    if (n) return 'Final export is blocked by ' + n + ' error' + (n === 1 ? '' : 's') + ' or broken reference' + (n === 1 ? '' : 's') + '.';
    if (!WORLD.isGenerated(b)) return 'Final export is blocked: the world has not been generated yet.';
    if (!WORLD.canOpen(b)) return 'Final export is blocked: a side quest giver or a world reference points at a world record that does not exist.';
    // Phase 6: a generated world must be complete and current, so the records agree with what the seed regenerates.
    return WORLD.checks ? WORLD.checks.finalBlock(b) : null;
  }
  WORLD.finalBlock = finalBlock;
  Kit.buildExport = function (status, opts) {
    opts = opts || {};
    var b = cur();
    if (!b) throw new Error('No project is open.');
    WORLD.ensure(b);
    if (status === 'final') {
      var why = finalBlock(b);
      if (why) throw new Error(why);
      Kit.bundle.open('world');
    } else {
      Kit.refreshValidation();
      if (!WORLD.canOpen(b)) Kit.bundle.close('world');
    }
    b.world.generator = { name: WORLD.GENERATOR, version: ENGINE_WORLD.version };
    // Phase 8: bake the current maps when baking is on, and drop any bake when it is off, before the hash is taken.
    if (WORLD.bake) WORLD.bake.forExport(b);
    b.kit.forges['148'] = { status: status, exportedAt: U.now(), worldVersion: b.world.version, generatorVersion: ENGINE_WORLD.version, charterVersion: b.charter.version || 0 };
    var out = Kit.bundle.exportFile({ download: false });
    var files = [
      { key: 'bundle', name: out.filename, text: out.text, mime: 'application/json' },
      { key: 'manifest', name: Kit.bundle.slug() + '-world-manifest.json', text: JSON.stringify(WORLD.manifest(cur(), out.hash), null, 2), mime: 'application/json' }
    ];
    if (opts.engines !== false && ENG.available()) files.push(ENG.file(out.hash));
    return { hash: out.hash, files: files };
  };
  function download(files) { files.forEach(function (f, i) { setTimeout(function () { U.download(f.name, f.text, f.mime); }, i * 350); }); }
  WORLD.exportNow = function (status, opts) {
    try {
      var out = Kit.buildExport(status, opts);
      download(out.files);
      Kit.ui.toast('Exported ' + out.files.length + ' files (' + status + '). Hash ' + out.hash.slice(0, 12) + '.', 'ok', 6000);
      Kit.rerender();
      return out;
    } catch (e) { Kit.ui.toast(e.message, 'error', 7000); return null; }
  };
  function exportForm(host, st, onChange) {
    var b = cur(), s = Kit.validate.summary(Kit.refreshValidation()), why = finalBlock(b);
    host.appendChild(el('div', null, kv([
      ['Project', esc(b.kit.title)], ['World version', esc(b.world.version)], ['Generator', esc(WORLD.GENERATOR + ' ' + ENGINE_WORLD.version)],
      ['Seed', '<code>' + esc(b.world.seed) + '</code>'], ['World records', String(WORLD.count(b))],
      ['Issues', s.errors + s.broken ? '<span class="chip chip-error">' + s.errors + ' err</span> <span class="chip chip-broken">' + s.broken + ' broken</span>' : '<span class="chip chip-ok">' + Kit.icon('check') + 'none</span>']
    ])));
    var rc = el('div', 'radio-cards');
    if (why && st.status === 'final') st.status = 'draft';
    rc.innerHTML = '<label class="radio-card"><input type="radio" name="w8Status" value="draft"' + (st.status === 'draft' ? ' checked' : '') + '><span><strong>Draft</strong><br><span class="muted">Always allowed. World stays closed, so Days 146 and 147 keep reading world references as forward.</span></span></label>' +
      '<label class="radio-card' + (why ? ' disabled' : '') + '"><input type="radio" name="w8Status" value="final"' + (why ? ' disabled' : '') + (st.status === 'final' ? ' checked' : '') + '><span><strong>Final</strong><br><span class="muted">' + esc(why || 'Opens the world namespace and marks forge 148 final.') + '</span></span></label>';
    Array.prototype.forEach.call(rc.querySelectorAll('input'), function (r) { r.addEventListener('change', function () { st.status = r.value; if (onChange) onChange(); }); });
    host.appendChild(rc);
    var tg = el('div', 'w8-opts');
    tg.appendChild(toggle('Include engine-world.js', st.engines, function (on) { st.engines = on; if (onChange) onChange(); }));
    tg.appendChild(toggle('Bake the maps into the bundle', WORLD.bake.on(b), function (on) { WORLD.bake.set(b, on); paintBake(); if (onChange) onChange(); }));
    host.appendChild(tg);
    var note = el('p', 'muted w8-bake-note');
    function paintBake() {
      var est = WORLD.isGenerated(b) ? WORLD.bake.estimate(b) : null;
      note.textContent = WORLD.bake.on(b)
        ? 'Baking is on: each export stores the tile layers of every current map' + (est ? ' (' + est.maps + ' maps, about ' + U.fmtSize(est.bytes) + ')' : '') + ', so Day 150 can draw them without generating. A baked map is used only while its generator version and parameters match; otherwise Day 150 regenerates it from the seed.'
        : 'Baking is off: Day 150 regenerates every map from the seed' + (est ? '. Baking would add about ' + U.fmtSize(est.bytes) + ' for ' + est.maps + ' maps.' : '.');
    }
    paintBake();
    host.appendChild(note);
  }
  function exportState() { return { status: 'draft', engines: true }; }
  Kit.openExport = function () {
    var st = exportState();
    Kit.ui.dialog({
      title: 'Export forge 148',
      body: function (body) { exportForm(body, st); },
      actions: [
        { label: 'Close', kind: 'ghost', value: null },
        { label: 'Download', kind: 'primary', icon: 'export', onClick: function () { if (!WORLD.exportNow(st.status, { engines: st.engines })) return false; } }
      ]
    });
  };

  // ---------------------------------------------------------------- loading
  function replaceDraft(title, fn) {
    var b = cur(), empty = WORLD.isEmpty(b) && !(b.charter && b.charter.locked);
    var go = empty ? Promise.resolve(true) : Kit.ui.confirm({ title: title, message: 'The current working draft will be replaced. Save it to a slot or export it first if you want to keep it.', okLabel: 'Replace draft' });
    return go.then(function (ok) { if (ok) fn(); return ok; });
  }
  WORLD.loadFixture = function (key) {
    return replaceDraft('Load the ' + (key === 'demo' ? 'demo' : key + ' fixture') + '?', function () { Kit.bundle.load(WORLD_DEMO.fixture(key)); Kit.ui.toast('Loaded ' + (key === 'demo' ? 'the demo bundle' : 'fixture ' + key) + '.', 'ok'); });
  };
  // Copies Day 147's working draft into this forge. Day 147's copy is never written or removed.
  WORLD.openDay147Draft = function () {
    return WORLD.storage.day147Draft().then(function (d) {
      if (!d) { Kit.ui.toast('Day 147 has no draft in this browser.', 'warn'); return false; }
      var ok = WORLD.importable(d);
      if (ok !== true) { Kit.ui.toast(ok, 'warn', 9000); return false; }
      return replaceDraft('Open the Day 147 draft?', function () { Kit.bundle.load(d); Kit.ui.toast('Opened a copy of the Day 147 draft.', 'ok'); });
    });
  };

  // ---------------------------------------------------------------- Start
  var BIOME_COLORS = { ocean: '#2f5f9a', coast: '#d9c48a', swamp: '#4f6a3a', grassland: '#6aa84f', steppe: '#b8a85a', desert: '#e0c070', forest: '#2f7a3a', rainforest: '#1d5a2c', tundra: '#9aa8a0', snow: '#eef2f5', mountain: '#7a7068', volcanic: '#b0402a' };
  function biomeColor(id, key) {
    if (key && BIOME_COLORS[key]) return BIOME_COLORS[key];
    var h = ENGINE_WORLD.hash.str(id || 'x') % 360;
    return 'hsl(' + h + ', 45%, 50%)';
  }
  WORLD.biomeColor = biomeColor;
  function climateCard(b) {
    var card = el('section', 'card');
    card.appendChild(el('h3', 'section-h', 'Climate table'));
    var tb;
    try { tb = ENGINE_WORLD.climate.table(b.art, ENGINE_RENDER); } catch (e) { card.appendChild(el('p', 'msg msg-warning', esc(e.message))); return card; }
    card.appendChild(el('p', 'muted', esc(tb.order.length + ' biome tilesets, resolved through the render engine\'s matchClimate in priority order. ' + tb.exactCount + ' of 125 climate cells fall inside a biome\'s box; the other ' + tb.nearestCount + ' take the nearest box (hatched).' +
      (tb.features.length ? ' Placed by their own rule: ' + tb.features.map(function (f) { return f.key || f.id; }).join(', ') + '.' : ''))));
    var grids = el('div', 'w8-climate');
    var ELEV = ['Sea (0)', 'Coast (1)', 'Low (2)', 'High (3)', 'Peak (4)'];
    for (var e = 0; e < 5; e++) {
      var fig = el('figure'), g = el('div', 'w8-cgrid');
      fig.appendChild(el('figcaption', null, esc(ELEV[e])));
      for (var m = 4; m >= 0; m--) for (var t = 0; t < 5; t++) {
        var i = ENGINE_WORLD.climate.index(t, m, e), id = tb.cells[i], s = el('span', tb.exact[i] ? '' : 'near');
        s.style.backgroundColor = biomeColor(id, tb.keys[id]);
        s.title = 'Temperature ' + t + ', moisture ' + m + ', elevation ' + e + ': ' + ((b.art.records.til_[id] || {}).name || 'none') + (tb.exact[i] ? '' : ' (nearest)');
        g.appendChild(s);
      }
      fig.appendChild(g); grids.appendChild(fig);
    }
    card.appendChild(grids);
    card.appendChild(el('p', 'muted', 'Each square is one elevation band: temperature rises left to right, moisture rises bottom to top.'));
    var used = {};
    tb.cells.forEach(function (id) { if (id) used[id] = 1; });
    card.appendChild(el('div', 'w8-legend', tb.order.filter(function (id) { return used[id]; }).map(function (id) { return '<span><i style="background:' + biomeColor(id, tb.keys[id]) + '"></i>' + esc((b.art.records.til_[id] || {}).name || id) + '</span>'; }).join('')));
    return card;
  }
  function seedRow(b) {
    var row = el('div', 'w8-seed');
    var inp = el('input', 'inp'); inp.type = 'text'; inp.inputMode = 'numeric'; inp.value = String(b.world.seed); inp.setAttribute('aria-label', 'World seed');
    inp.addEventListener('change', function () {
      var v = Number(inp.value);
      if (!(v >= 0 && v <= 4294967295 && v === Math.floor(v))) { Kit.ui.toast('A seed is a whole number from 0 to 4294967295.', 'warn'); inp.value = String(b.world.seed); return; }
      b.world.seed = v >>> 0; Kit.bundle.touch('seed'); Kit.rerender();
    });
    row.appendChild(inp);
    row.appendChild(button('Reroll', 'spark', '', function () { b.world.seed = (Math.random() * 4294967295) >>> 0; Kit.bundle.touch('seed'); Kit.rerender(); Kit.ui.toast('New seed ' + b.world.seed + '. World IDs never change on a reroll.', 'ok'); }));
    return row;
  }
  function renderStart(host) {
    var b = cur(), C = b.charter || {}, ok = ready(b) === true;
    WORLD.ensure(b);
    var head = el('section', 'panel w8-hero');
    head.innerHTML = '<h2 class="panel-title">Start</h2><p class="muted">Load a Day 147 bundle or the demo. World Forge reads the Charter, the Rules, and the art, writes only the world namespace (and later each side quest\'s giver), and exports a bundle Days 146 and 147 still open.</p>';
    var row = el('div', 'btn-row');
    row.appendChild(button('Load a Day 147 bundle', 'import', 'btn-primary', function () { var f = document.getElementById('fileImport'); f.value = ''; f.click(); }));
    row.appendChild(button('Load the demo', 'spark', '', function () { WORLD.loadFixture('demo'); }));
    if (WORLD.storage.hasDay147Draft()) {
      var od = button('Open the Day 147 draft', 'book', '', WORLD.openDay147Draft);
      od.title = 'Copy the draft Art and Audio Forge left in this browser into this forge';
      row.appendChild(od);
    }
    row.appendChild(button('Settings', 'gear', 'btn-ghost', Kit.settings.open));
    head.appendChild(row);
    host.appendChild(head);

    var grid = el('div', 'grid-cards w8-grid');
    host.appendChild(grid);
    var forges = b.kit.forges || {};
    var proj = el('section', 'card');
    proj.innerHTML = '<h3 class="section-h">Project</h3>' + (ok ? '' : '<p class="msg msg-warning">' + esc(ready(b)) + '</p>') + kv([
      ['Title', esc(b.kit.title)],
      ['Charter', C.locked ? '<span class="chip chip-ok">Locked v' + esc(C.version) + '</span>' : '<span class="chip chip-muted">Not locked</span>'],
      ['Forges', esc(Object.keys(forges).sort().map(function (f) { return f + ' ' + ((forges[f] || {}).status || ''); }).join(', ') || 'none')],
      ['Opened', esc((b.kit.opened || []).join(', ') || 'none')]
    ]);
    grid.appendChild(proj);

    var chs = WORLD.chapters(b), conts = WORLD.continents(b), bossT = WORLD.bossTroops(b), trp = b.rules && b.rules.trp_ || {};
    var story = el('section', 'card span-all');
    story.appendChild(el('h3', 'section-h', 'Chapters and continents'));
    if (!chs.length) story.appendChild(el('div', 'empty-line', 'No chapters yet.'));
    else {
      var t = el('table', 'tbl');
      t.innerHTML = '<thead><tr><th scope="col">Chapter</th><th scope="col">Continent</th><th scope="col" class="num">Minutes</th><th scope="col" class="num">Troops</th><th scope="col">Boss</th></tr></thead><tbody>' +
        chs.map(function (c) {
          var tr = Object.keys(trp).filter(function (k) { return trp[k] && trp[k].chapter === c.id; });
          var boss = bossT.filter(function (x) { return x.chapter === c.id; });
          return '<tr><th scope="row">' + esc(c.name || c.id) + '</th><td>' + esc(c.continentLabel || 'Default') + '</td><td class="num">' + esc(c.targetMinutes || 60) + '</td><td class="num">' + tr.length + '</td><td>' +
            (boss.length ? esc(boss.map(function (x) { return x.name; }).join(', ')) : '<span class="chip chip-warning">none yet</span>') + '</td></tr>';
        }).join('') + '</tbody>';
      var w = el('div', 'tbl-wrap'); w.appendChild(t); story.appendChild(w);
      story.appendChild(el('p', 'muted', esc(conts.length + ' continent' + (conts.length === 1 ? '' : 's') + ': ' + conts.map(function (c) { return c.label + ' (' + c.chapters.length + ')'; }).join(', ') + '.')));
    }
    grid.appendChild(story);

    var art = el('section', 'card'), roles = WORLD.art.musicRoles(b);
    var bi = WORLD.art.biomes(b), ins = WORLD.art.interiors(b);
    art.innerHTML = '<h3 class="section-h">Art the world uses</h3>' + kv([
      ['Art version', esc(b.art && b.art.version || '-')],
      ['Biomes', bi.length ? String(bi.length) : '<span class="chip chip-warning">none</span>'],
      ['Interiors', ins.length ? esc(ins.map(function (x) { return (x.subject && x.subject.ref || x.id).replace(/^interior:/, ''); }).join(', ')) : '<span class="chip chip-warning">none</span>']
    ]) + '<div class="w8-chips">' + conts.map(function (c) { var has = roles['field:' + c.slug]; return '<span class="chip ' + (has ? 'chip-ok' : 'chip-warning') + '" title="' + (has ? 'Field music scored' : 'No field music for this continent') + '">field:' + esc(c.slug) + '</span>'; }).join('') + '</div>';
    grid.appendChild(art);

    var wd = el('section', 'card'), wr = b.world.records;
    wd.innerHTML = '<h3 class="section-h">World namespace</h3>' + kv([
      ['Version', esc(b.world.version)], ['Generator', esc((b.world.generator && b.world.generator.name || WORLD.GENERATOR) + ' ' + ENGINE_WORLD.version)],
      ['Records', String(WORLD.count(b))],
      ['World opened', Kit.codex.isOpened('world') ? '<span class="chip chip-ok">yes</span>' : '<span class="chip chip-muted">no, until a Final export</span>']
    ]) + '<div class="w8-chips">' + WORLD.PREFIXES.map(function (p) { var n = Object.keys(wr[p] || {}).length; return '<span class="chip ' + (n ? 'chip-accent' : 'chip-muted') + '" title="' + esc(WORLD.TYPES[p].label) + '">' + esc(p) + ' ' + n + '</span>'; }).join('') + '</div>';
    wd.appendChild(el('h4', 'section-h', 'Seed'));
    wd.appendChild(seedRow(b));
    grid.appendChild(wd);

    if (ok) host.appendChild(progressionCard(b));
    if (ok) host.appendChild(climateCard(b));
  }

  // ---------------------------------------------------------------- Progression (Phase 2)
  var STEP_LABEL = { start: 'Start town', key: 'Key dungeon', lock: 'Lock', boss: 'Boss', exit: 'Exit' };
  function progressionCard(b) {
    var card = el('section', 'card w8-prog'), g = WORLD.progression.graph(b), PG = ENGINE_WORLD.progression;
    card.appendChild(el('h3', 'section-h', 'Progression'));
    var row = el('div', 'btn-row');
    row.appendChild(button(g ? 'Lay out again' : 'Lay out progression', 'spark', g ? '' : 'btn-primary', function () {
      try {
        var r = WORLD.progression.apply(b);
        Kit.rerender();
        Kit.ui.toast('Progression laid out: ' + r.graph.nodes.filter(function (n) { return n.record; }).length + ' sites in ' + r.graph.regions.length + ' regions' + (r.kept.length ? ', ' + r.kept.length + ' user records kept' : '') + '.', r.warnings.length ? 'warn' : 'ok');
      } catch (e) { Kit.ui.toast(e.message, 'error', 8000); }
    }));
    if (!g) {
      card.appendChild(el('p', 'muted', 'The golden path is laid out before any terrain: for each chapter a start town, a key dungeon, the lock it opens, the boss dungeon, and the exit that needs the next chapter\'s key. Optional caves and a second town in chapter one come after. It never reads the seed.'));
      card.appendChild(row);
      return card;
    }
    var w = PG.walk(g), probs = PG.check(g), stale = WORLD.progression.stale(b);
    card.appendChild(el('p', null, '<span class="chip ' + (probs.length ? 'chip-broken' : 'chip-ok') + '">' + (probs.length ? probs.length + ' problems' : 'Solvable in ' + w.order.length + ' steps') + '</span> ' +
      (stale ? '<span class="chip chip-warning">Charter changed since layout</span> ' : '') +
      (g.vehicles.ship ? '<span class="chip chip-accent">Ship after ' + esc(chName(b, g.vehicles.ship.chapter)) + '</span> ' : '') +
      (g.vehicles.airship ? '<span class="chip chip-accent">Airship after ' + esc(chName(b, g.vehicles.airship.chapter)) + '</span>' : '')));
    var t = el('table', 'tbl');
    t.innerHTML = '<thead><tr><th scope="col">Region</th><th scope="col">Golden path</th></tr></thead><tbody>' +
      g.regions.map(function (r) {
        var ns = g.nodes.filter(function (n) { return n.region === r.key; });
        var gold = ns.filter(function (n) { return n.golden; }).map(function (n) {
          var cls = n.role === 'boss' && !n.troop ? 'chip-warning' : n.kind === 'gate' ? 'chip-muted' : 'chip-accent';
          var tip = (n.record || n.key) + ' needs ' + n.requires.join(', ') + (n.grants.length ? '; grants ' + n.grants.join(', ') : '');
          return '<span class="chip ' + cls + '" title="' + esc(tip) + '">' + esc(n.role === 'boss' && n.interior === 'castle' ? 'Castle' : STEP_LABEL[n.role]) + '</span>';
        }).join('<span class="w8-arrow" aria-hidden="true">&rsaquo;</span>');
        var opt = ns.filter(function (n) { return n.optional; }).map(function (n) { return n.kind === 'twn' ? 'Town' : 'Cave'; });
        return '<tr><th scope="row">' + esc(r.label + ': ' + chName(b, r.chapter)) + '<small class="w8-sub">Entry: ' + esc(r.entry) + (opt.length ? '. Optional: ' + esc(opt.join(', ')) : '') + '</small></th><td><div class="w8-path">' + gold + '</div></td></tr>';
      }).join('') + '</tbody>';
    var wrap = el('div', 'tbl-wrap'); wrap.appendChild(t); card.appendChild(wrap);
    probs.concat(g.warnings).forEach(function (p) { card.appendChild(el('p', 'msg ' + (p.code === 'no-boss' ? 'msg-warning' : 'msg-error'), esc(p.message))); });
    card.appendChild(row);
    return card;
  }
  function chName(b, id) { var c = WORLD.chapters(b).filter(function (x) { return x.id === id; })[0]; return c ? c.name || id : id; }

  // ---------------------------------------------------------------- Export
  function renderExport(host) {
    var head = el('section', 'panel');
    head.innerHTML = '<h2 class="panel-title">Export</h2><p class="muted">Export the bundle, its forge 148 manifest, and engine-world.js. Days 146 and 147 open the bundle unchanged. A Final export opens the world namespace for Days 149 and 150.</p>';
    host.appendChild(head);
    var st = WORLD.exportUi = WORLD.exportUi || exportState();
    var p = el('section', 'panel');
    p.appendChild(el('h3', 'section-h', 'Export the bundle'));
    exportForm(p, st);
    p.appendChild(button('Download', 'export', 'btn-primary', function () { WORLD.exportNow(st.status, { engines: st.engines }); }));
    host.appendChild(p);
    var m = el('section', 'panel'), man = WORLD.manifest(cur(), '');
    m.appendChild(el('h3', 'section-h', 'Manifest preview'));
    m.appendChild(el('div', null, kv([['Created', man.created.length + ' world IDs'], ['Referenced', man.referenced.length + ' IDs'],
      ['Unresolved', man.unresolved.length ? '<span class="chip chip-broken">' + man.unresolved.length + '</span>' : '<span class="chip chip-ok">0</span>'],
      ['Engine', esc(ENG.FILE + ' ' + ENGINE_WORLD.version)],
      ['Baked', man.bake && man.bake.maps ? esc(man.bake.fresh + ' of ' + man.bake.maps + ' maps current, ' + U.fmtSize(man.bake.bytes)) : esc(man.bake && man.bake.on ? 'On; bakes at export' : 'Off')]])));
    host.appendChild(m);
    var z = el('section', 'panel');
    z.appendChild(el('h3', 'section-h', 'Size'));
    sizeBody(z);
    host.appendChild(z);
  }

  function renderDev(host) {
    var p = el('section', 'panel');
    p.innerHTML = '<h2 class="panel-title">Developer</h2><p class="muted">Fixtures are real Day 147 Final exports. Loading one replaces the working draft.</p>';
    var list = el('div', 'w8-fixtures');
    WORLD_DEMO.FIXTURES.forEach(function (fx) {
      var row = el('div', 'slot-row');
      row.appendChild(el('div', 'slot-info', '<strong>' + esc(fx.label) + '</strong><small>' + esc(fx.purpose) + '</small>'));
      row.appendChild(button('Load', null, '', function () { WORLD.loadFixture(fx.key); }));
      list.appendChild(row);
    });
    p.appendChild(list);
    host.appendChild(p);
  }

  // ---------------------------------------------------------------- tabs that arrive in later phases
  var LATER = [
    ['world', 'World', 'chart', 'The overworld preview with biome, elevation, moisture, temperature, zone, and gate overlays, per continent controls, and the tap inspector.', 'Phase 3 and 7'],
    ['sites', 'Sites', 'scroll', 'Towns, castles, dungeons, and caves by chapter, each with its interior preview and exits.', 'Phase 4 and 7'],
    ['encounters', 'Encounters', 'sword', 'Encounter zones by continent and biome, and one table per dungeon, with editable weights and rates.', 'Phase 5 and 7'],
    ['validation', 'Validation', 'check', 'Reference and progression checks as pass or fail cards with jump links.', 'Phase 6 and 7']
  ];

  // ---------------------------------------------------------------- mount
  Kit.mount('start', { title: 'Start', icon: 'scroll', canEnter: function () { return true; }, render: renderStart });
  LATER.forEach(function (t) {
    var real = WORLD.WS && WORLD.WS[t[0]];
    Kit.mount(t[0], { title: t[1], icon: t[2], canEnter: ready, focus: real && real.focus, onLeave: real && real.onLeave,
      render: real ? real.render : function (h) { h.appendChild(Kit.ui.stub({ title: t[1], lead: t[3], status: 'Arrives in ' + t[4] + '.', icon: t[2] })); } });
  });
  Kit.mount('export', { title: 'Export', icon: 'export', canEnter: ready, render: renderExport });
  if (DEV) Kit.mount('dev', { title: 'Dev', icon: 'gear', canEnter: function () { return true; }, render: renderDev });
  Kit.on('change', meterSoon);
  Kit.on('load', function () { paintMeter(); });
})();
// === WS:WORLD148 END ===
