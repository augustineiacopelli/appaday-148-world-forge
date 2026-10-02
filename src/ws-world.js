// === WS:WORLD BEGIN ===
(function () {
  'use strict';
  // The World tab. Phase 3 built the overworld and read it one cell to a pixel. Phase 7: the map is drawn through
  // tiles.drawMap in the shared viewer (pan, pinch, integer zoom), with overlays for biome, elevation, temperature,
  // moisture, regions, and encounter zones, markers for sites and gates, a tap inspector that reads any cell and paints
  // free land (sparse world.overrides.cells, refused when the walk would break), per continent controls for radius,
  // ruggedness, and mountain share (world.settings.overworld.continents), and field music audition per continent.
  // A changed map grows in the Web Worker while the last one stays on screen, dimmed.
  var U = Kit.util, el = U.el, esc = U.esc;
  var ui = { overlay: 'tiles', sites: true, gates: true, view: {}, focus: null, busy: false, lastOw: null, msg: null, viewer: null, paint: null };
  var OVERLAYS = [['tiles', 'Tiles'], ['biome', 'Biome'], ['elev', 'Elevation'], ['temp', 'Temperature'], ['moist', 'Moisture'], ['region', 'Regions'], ['zones', 'Zones']];
  var ELEV_C = ['#2f5f9a', '#d9c48a', '#7fae5c', '#4f7a3a', '#7a7068'];
  var TEMP_C = ['#3d6fb6', '#6fa3c8', '#b8c47a', '#e0a04a', '#c8502e'];
  var MOIST_C = ['#c9a96a', '#b4b46a', '#7fae5c', '#3f8a6a', '#2d6a8a'];
  var ELEV_N = ['Sea', 'Coast', 'Low', 'High', 'Peak'], TEMP_N = ['Coldest', 'Cold', 'Mild', 'Warm', 'Hottest'], MOIST_N = ['Driest', 'Dry', 'Moderate', 'Wet', 'Wettest'];
  var GATE_C = { pass: '#f5d142', landing: '#3fd0e0', seawall: '#f08a3c', lock: '#e04ad0' };
  var GATE_LABEL = { pass: 'Pass', landing: 'Landing', seawall: 'Sea ring', lock: 'Lock' };
  var GATE_PLURAL = { pass: 'passes', landing: 'landings', seawall: 'sea rings', lock: 'locks' };
  var ENTRY_LABEL = { start: 'Start', pass: 'Over a pass', landing: 'By sea' };
  var ST_LABEL = { 1: 'Wall: a ridge between chapters, a sea ring, or the side of a lock', 2: 'Gate', 3: 'Part of a site', 4: 'Site entrance' };
  var SEA = '#1d3557';
  function cur() { return Kit.bundle.current(); }
  function btn(label, icon, cls, fn) { return WORLD.ui.button(label, icon, cls, fn); }
  function chName(b, id) { var c = WORLD.chapters(b).filter(function (x) { return x.id === id; })[0]; return c ? c.name || id : id; }
  function regionHue(k) { return 'hsl(' + ((k * 137) % 360) + ', 55%, 55%)'; }
  function zoneHue(key) { return 'hsl(' + (ENGINE_WORLD.hash.str(key) % 360) + ', 58%, 52%)'; }
  // zone|field|<continent>|<chp>|<biome key> reads as 'forest, The Lowlands'.
  function zoneLabel(b, k) { var p = String(k).split('|'); return (p[4] || k) + ', ' + chName(b, p[3]); }
  function tilName(b, id) { var t = b.art.records.til_ && b.art.records.til_[id]; return t && t.name ? t.name : id; }
  function refName(b, ref) {
    ref = String(ref || '');
    var k = ref.indexOf(':');
    if (k < 0) return tilName(b, ref);
    var key = ref.slice(k + 1);
    return tilName(b, ref.slice(0, k)) + ', ' + key.charAt(0).toUpperCase() + key.slice(1);
  }
  function needText(b, k) {
    return k.replace(/^chapter:(chp_.*)$/, function (m, id) { return 'chapter: ' + chName(b, id); }).replace(/^item:seal:(chp_.*)$/, function (m, id) { return 'seal: ' + chName(b, id); })
      .replace(/^vehicle:ship$/, 'the ship').replace(/^vehicle:airship$/, 'the airship');
  }

  // ---------------------------------------------------------------- generating
  function store(b, cleared) {
    if (b !== cur()) return;
    try {
      var had = WORLD.interiors && WORLD.interiors.generated(b), hadZones = WORLD.zones && WORLD.zones.generated(b), r = WORLD.overworld.apply(b);
      // Interiors hang off the overworld's sites, so once they exist they are generated again with it, and so are zones.
      if (had && !r.kept) WORLD.interiors.apply(b);
      if (had && hadZones && !r.kept) WORLD.zones.apply(b);
      Kit.rerender();
      Kit.ui.toast(r.kept ? 'The overworld record is marked as user made, so it was kept.' : 'Overworld stored: ' + r.ow.w + ' by ' + r.ow.h + ', ' + r.ow.sites.length + ' sites, ' + r.ow.gates.length + ' gates, grown in ' + r.ow.ms + ' ms.' +
        (cleared ? ' ' + cleared + ' painted cell' + (cleared === 1 ? ' was' : 's were') + ' cleared for the new seed.' : ''), r.kept ? 'warn' : 'ok');
    } catch (e) { Kit.rerender(); Kit.ui.toast(e.message, 'error', 8000); }
  }
  function generate(b, reroll) {
    if (ui.busy) return;
    try {
      var cleared = 0;
      if (reroll) {
        b.world.seed = (Math.random() * 4294967295) >>> 0;
        // DECISION: painted cells are coordinates on one map, so a new seed clears them (the toast says how many).
        cleared = WORLD.overworld.unpaint(b);
        Kit.bundle.touch('seed');
      }
      if (!WORLD.progression.graph(b) || WORLD.progression.stale(b)) WORLD.progression.apply(b);
      if (WORLD.overworld.async() && !WORLD.overworld.ready(b)) {
        ui.busy = true; Kit.rerender();
        WORLD.overworld.prefetch(b).then(function (ow) { ui.busy = false; if (ow) store(b, cleared); else Kit.rerender(); }, function (e) { ui.busy = false; Kit.rerender(); Kit.ui.toast(e.message, 'error', 8000); });
        return;
      }
      store(b, cleared);
    } catch (e) { ui.busy = false; Kit.ui.toast(e.message, 'error', 8000); }
  }

  // ---------------------------------------------------------------- drawing
  function colorFn(ow, b, overlay) {
    var bio = ow.palette.biomes, keys = overlay === 'zones' ? WORLD.zones.cellKeys(ow, b) : null, biomeOf = {};
    function biomeColor(ref) {
      if (biomeOf[ref] !== undefined) return biomeOf[ref];
      var r = String(ref || ''), id = r.split(':')[0], c = r.indexOf(':') >= 0 ? '#2a2420' : WORLD.biomeColor(id, bio[id] && bio[id].key);
      biomeOf[ref] = c; return c;
    }
    return function (i) {
      switch (overlay) {
        case 'elev': return ELEV_C[ow.elev[i]] || '#000';
        case 'temp': return ow.owner[i] < 0 ? SEA : TEMP_C[ow.temp[i]];
        case 'moist': return ow.owner[i] < 0 ? SEA : MOIST_C[ow.moist[i]];
        case 'region': return ow.region[i] >= 0 ? (ow.st[i] === 1 ? '#5a524c' : regionHue(ow.region[i])) : ow.owner[i] >= 0 ? '#888' : SEA;
        case 'zones': return keys[i] ? zoneHue(keys[i]) : ow.owner[i] < 0 ? SEA : ow.st[i] ? '#2a2420' : '#4a4440';
        default: return biomeColor(ow.ground[i]);
      }
    };
  }
  function overlayFn(ow, b) {
    var painted = WORLD.overworld.paintCells(b);
    return function (ctx, v) {
      var s = v.s, lw = Math.max(1, Math.round(v.d)), w = ow.w;
      function box(i, cw, ch) { var x = v.ox + (i % w) * s, y = v.oy + Math.floor(i / w) * s; return [x, y, cw * s, ch * s]; }
      if (ui.sites) ow.sites.forEach(function (st) {
        var x = v.ox + st.x * s, y = v.oy + st.y * s;
        if (s < 4) { ctx.fillStyle = st.golden ? '#14100c' : '#3a3430'; ctx.fillRect(x, y, st.w * s, st.h * s); ctx.fillStyle = '#fff6d8'; var e = box(st.entrance, 1, 1); ctx.fillRect(e[0], e[1], s, s); return; }
        ctx.lineWidth = lw * 2; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeRect(x - lw, y - lw, st.w * s + 2 * lw, st.h * s + 2 * lw);
        ctx.lineWidth = lw; ctx.strokeStyle = st.golden ? '#f4d27a' : '#d8cfc0'; ctx.strokeRect(x - lw / 2, y - lw / 2, st.w * s + lw, st.h * s + lw);
      });
      if (ui.gates) ow.gates.forEach(function (g) {
        ctx.fillStyle = GATE_C[g.kind] || '#fff';
        g.cells.forEach(function (c) {
          var r = box(c, 1, 1);
          if (s < 8) { ctx.fillRect(r[0], r[1], r[2], r[3]); return; }
          ctx.globalAlpha = 0.35; ctx.fillRect(r[0], r[1], r[2], r[3]); ctx.globalAlpha = 1;
          ctx.lineWidth = lw * 2; ctx.strokeStyle = GATE_C[g.kind] || '#fff'; ctx.strokeRect(r[0] + lw, r[1] + lw, r[2] - 2 * lw, r[3] - 2 * lw);
        });
      });
      if (ow.start != null) {
        var p = box(ow.start, 1, 1), m = Math.max(1, Math.round(s / 3));
        ctx.fillStyle = '#ffffff';
        if (s < 4) { ctx.fillRect(p[0] - s, p[1], 3 * s, s); ctx.fillRect(p[0], p[1] - s, s, 3 * s); }
        else { ctx.fillRect(p[0] + m, p[1], s - 2 * m, s); ctx.fillRect(p[0], p[1] + m, s, s - 2 * m); }
      }
      if (s >= 6) Object.keys(painted).forEach(function (k) {
        var q = k.split(','), x = v.ox + Number(q[0]) * s, y = v.oy + Number(q[1]) * s, d = Math.max(2, Math.round(s / 4));
        ctx.fillStyle = '#000000'; ctx.fillRect(x + s - d - lw, y + lw, d + lw, d + lw);
        ctx.fillStyle = '#ffd84a'; ctx.fillRect(x + s - d, y + lw * 1.5, d - lw / 2, d - lw / 2);
      });
    };
  }
  function legend(ow, b) {
    var items = [], ov = ui.overlay;
    if (ov === 'biome' || ov === 'tiles') {
      var counts = {}, order = [];
      ow.ground.forEach(function (r) { r = String(r || ''); if (r.indexOf(':') >= 0) return; if (!counts[r]) { counts[r] = 0; order.push(r); } counts[r]++; });
      order.sort(function (a, c) { return counts[c] - counts[a] || (a < c ? -1 : 1); }).forEach(function (id) {
        var bio = ow.palette.biomes[id], pct = counts[id] / (ow.w * ow.h) * 100;
        items.push([WORLD.biomeColor(id, bio && bio.key), tilName(b, id) + ' ' + (pct < 1 ? '<1' : Math.round(pct)) + '%']);
      });
    } else if (ov === 'elev') ELEV_N.forEach(function (l, k) { items.push([ELEV_C[k], l]); });
    else if (ov === 'temp') TEMP_N.forEach(function (l, k) { items.push([TEMP_C[k], l]); });
    else if (ov === 'moist') MOIST_N.forEach(function (l, k) { items.push([MOIST_C[k], l]); });
    else if (ov === 'region') ow.regions.forEach(function (r, k) { items.push([regionHue(k), chName(b, r.chapter) + (r.ringed ? ' (sea ring)' : '')]); });
    else if (ov === 'zones') {
      var keys = WORLD.zones.cellKeys(ow, b), n = {};
      keys.forEach(function (k) { if (k) n[k] = (n[k] || 0) + 1; });
      var ks = Object.keys(n).sort(function (a, c) { return n[c] - n[a] || (a < c ? -1 : 1); });
      ks.slice(0, 12).forEach(function (k) {
        items.push([zoneHue(k), zoneLabel(b, k) + ' (' + n[k] + ')']);
      });
      if (ks.length > 12) items.push(['transparent', 'and ' + (ks.length - 12) + ' more zones']);
    }
    if (ui.gates) Object.keys(GATE_LABEL).forEach(function (k) { if (ow.gates.some(function (g) { return g.kind === k; })) items.push([GATE_C[k], GATE_LABEL[k]]); });
    if (ui.sites) items.push(['#f4d27a', 'Golden path site'], ['#d8cfc0', 'Optional site']);
    if (Object.keys(WORLD.overworld.paintCells(b)).length) items.push(['#ffd84a', 'Painted cell']);
    return el('div', 'w8-legend', items.map(function (it) { return '<span><i style="background:' + it[0] + '"></i>' + esc(it[1]) + '</span>'; }).join(''));
  }

  // ---------------------------------------------------------------- the inspector
  function siteAt(ow, x, y) { return ow.sites.filter(function (s) { return x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h; })[0] || null; }
  function paintable(ow, i) { return ow.owner[i] >= 0 && ow.st[i] === 0 && !ow.deco[i]; }
  function inspect(box, b, ow, x, y) {
    U.clear(box);
    box.appendChild(el('h3', 'section-h', 'Inspector'));
    if (x == null) { box.appendChild(el('p', 'muted', 'Tap or click any cell of the map (or focus the map and press Enter) to read its ground, climate, region, gate, site, encounter zone, and how it walks. Free land can be painted with another biome.')); return; }
    var i = y * ow.w + x, g = ow.ground[i], d = ow.deco[i], f = d ? ow.flags[d] | 0 : ow.flags[g] | 0, painted = WORLD.overworld.paintCells(b)[x + ',' + y];
    var rows = [];
    rows.push(['Cell', esc(x + ', ' + y)]);
    rows.push(['Ground', esc(refName(b, g)) + (painted ? ' <span class="chip chip-accent">Painted</span>' : '') + (d ? '<small class="w8-sub">' + esc('Over it: ' + refName(b, d)) + '</small>' : '')]);
    if (ow.owner[i] < 0) rows.push(['Where', ow.sea[i] ? 'Open sea' : 'A lake']);
    else {
      var c = ow.continents[ow.owner[i]], r = ow.region[i] >= 0 ? ow.regions[ow.region[i]] : null;
      rows.push(['Where', esc((c ? c.label : '') + (r ? ', ' + chName(b, r.chapter) : ''))]);
      rows.push(['Climate', esc(ELEV_N[ow.elev[i]] + ' ground, ' + TEMP_N[ow.temp[i]].toLowerCase() + ', ' + MOIST_N[ow.moist[i]].toLowerCase())]);
    }
    var walk = f & 1 ? 'Walkable' : f & 4 ? 'Water: the ship sails it' : 'Blocked';
    if (f & 2) walk += ', random battles';
    var gi = ow.gateAt[i], gate = gi >= 0 ? ow.gates[gi] : null;
    if (gate) walk = 'A ' + (GATE_LABEL[gate.kind] || gate.kind).toLowerCase() + ': opens with ' + gate.requires.map(function (k) { return needText(b, k); }).join(' and ');
    else if (ow.st[i]) walk = ST_LABEL[ow.st[i]] + (ow.st[i] === 4 ? ', enters with its chapter key' : '');
    rows.push(['Walk', esc(walk)]);
    var site = siteAt(ow, x, y);
    if (site) {
      var rec = WORLD.records.get(site.record, b);
      rows.push(['Site', esc(rec ? rec.name : site.key)]);
    }
    if (f & 2 && ow.owner[i] >= 0 && !ow.st[i]) {
      var zk = WORLD.zones.cellKeys(ow, b)[i], z = zk && WORLD.zones.generated(b) ? WORLD.zones.zone(zk, b) : null;
      if (zk) rows.push(['Zone', z ? esc(zoneLabel(b, zk) + ': ' + z.rate + ' in 256 a step, ' + (z.troops.length ? z.troops.length + ' troop' + (z.troops.length === 1 ? '' : 's') : 'no troops')) + (z.overridden ? ' <span class="chip chip-accent">Edited</span>' : '') : '<span class="muted">' + esc(zoneLabel(b, zk)) + ' (not generated yet)</span>']);
    }
    box.appendChild(el('div', 'w8-insp', WORLD.ui.kv(rows.map(function (p) { return [p[0], p[1]]; }))));
    var row = el('div', 'btn-row');
    if (site) row.appendChild(btn('Open in Sites', 'jump', '', function () { if (WORLD.sitesUi) { WORLD.sitesUi.site = site.key; WORLD.sitesUi.floor = 1; } Kit.go('sites'); }));
    if (WORLD.zones.generated(b) && f & 2 && ow.owner[i] >= 0 && !ow.st[i]) row.appendChild(btn('Edit this zone', 'jump', '', function () { var zk2 = WORLD.zones.cellKeys(ow, b)[i]; if (WORLD.encountersUi) WORLD.encountersUi.editing = zk2; Kit.go('encounters'); }));
    if (row.childNodes.length) box.appendChild(row);

    // Painting free land.
    var pp = el('div', 'w8-paint');
    if (!paintable(ow, i)) pp.appendChild(el('p', 'muted', ow.owner[i] < 0 ? 'Sea and lakes cannot be painted.' : 'This cell belongs to a ridge, ring, gate, or site, which the world needs as generated, so it cannot be painted.'));
    else {
      var ids = Object.keys(ow.palette.biomes).filter(function (id) { return !((ow.flags[id] | 0) & 4); }).sort(function (a, c) { var na = tilName(b, a), nc = tilName(b, c); return na < nc ? -1 : na > nc ? 1 : 0; });
      var sid = 'w8p' + U.rand36(6), lab = el('label', 'w8-paint-lab', 'Paint with');
      lab.htmlFor = sid;
      var sel = el('select', 'inp');
      sel.id = sid;
      ids.forEach(function (id) { var op = el('option', null, esc(tilName(b, id) + ((ow.flags[id] | 0) & 1 ? '' : ' (blocks)'))); op.value = id; if (id === (ui.paint || g)) op.selected = true; sel.appendChild(op); });
      sel.addEventListener('change', function () { ui.paint = sel.value; });
      var pr = el('div', 'w8-paint-row');
      pr.appendChild(lab); pr.appendChild(sel);
      pr.appendChild(btn('Paint', 'spark', 'btn-primary', function () { doPaint(b, x, y, sel.value); }));
      if (painted) pr.appendChild(btn('Clear paint', null, '', function () { doPaint(b, x, y, null); }));
      pp.appendChild(pr);
      pp.appendChild(el('p', 'muted w8-small', 'A painted cell is kept in world.overrides.cells and applied after the map is built. A cell whose new ground would break any chapter\'s walk is refused.'));
    }
    if (ui.msg) pp.appendChild(el('p', 'msg ' + (ui.msg.level === 'ok' ? 'w8-msg-ok' : 'msg-error'), esc(ui.msg.text)));
    var n = Object.keys(WORLD.overworld.paintCells(b)).length;
    if (n) { var cr = el('div', 'btn-row'); cr.appendChild(btn('Clear all ' + n + ' painted cell' + (n === 1 ? '' : 's'), null, '', function () { WORLD.overworld.unpaint(b); ui.msg = null; Kit.rerender(); })); pp.appendChild(cr); }
    box.appendChild(pp);
  }
  function doPaint(b, x, y, id) {
    var r = WORLD.overworld.paint(b, x, y, id);
    if (!r.ok) { ui.msg = { level: 'error', text: r.message }; refreshInspector(); return; }
    ui.msg = r.changed ? { level: 'ok', text: id ? 'Painted ' + tilName(b, id) + ' at ' + x + ', ' + y + '. Store the map to keep the records in step.' : 'Cleared the paint at ' + x + ', ' + y + '.' } : null;
    ui.focus = [x, y];
    Kit.rerender();
  }
  function refreshInspector() {
    var box = document.getElementById('w8-inspect'), b = cur(), ow = WORLD.overworld.ready(b) ? WORLD.overworld.generate(b) : ui.lastOw, s = ui.view.sel;
    if (box && ow) inspect(box, b, ow, s ? s[0] : null, s ? s[1] : null);
  }
  // Centers the live map on a cell and picks it, without rebuilding the tab.
  function showCell(x, y) {
    if (!ui.viewer) return;
    ui.msg = null;
    ui.viewer.center(x, y, 8);
    ui.viewer.select(x, y);
    refreshInspector();
    var fig = ui.viewer.el;
    if (fig && fig.scrollIntoView) fig.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // ---------------------------------------------------------------- per continent controls
  function slider(label, value, min, max, stp, isDefault, fmt, onSet) {
    var id = 'w8s' + U.rand36(6), w = el('div', 'w8-slider'), top = el('div', 'w8-slider-top'), lab = el('label', null, esc(label));
    lab.htmlFor = id;
    var out = el('output', 'w8-slider-val', esc(fmt(value) + (isDefault ? ' (default)' : '')));
    out.setAttribute('for', id);
    top.appendChild(lab); top.appendChild(out); w.appendChild(top);
    var inp = el('input', 'w8-range');
    inp.type = 'range'; inp.id = id; inp.min = min; inp.max = max; inp.step = stp; inp.value = value;
    inp.addEventListener('input', function () { out.textContent = fmt(Number(inp.value)); });
    inp.addEventListener('change', function () { onSet(Number(inp.value)); });
    w.appendChild(inp);
    return w;
  }
  function continentsCard(b, ow) {
    var card = el('section', 'panel'), S = ENGINE_WORLD.overworld.settings(b.world.settings), conts = WORLD.continents(b);
    card.id = 'w8-conts';
    card.appendChild(el('h3', 'section-h', 'Continents'));
    card.appendChild(el('p', 'muted', 'Shape each continent: its radius against the size its chapters\' minutes earn, how ragged its coast is, and how much of its inland rises into impassable mountains. A change grows a new map from the same seed; IDs never move.'));
    var list = el('div', 'w8-conts');
    ow.continents.forEach(function (c) {
      var own = (b.world.settings.overworld && b.world.settings.overworld.continents || {})[c.slug] || {}, eff = S.continents[c.slug] || {}, info = conts.filter(function (x) { return x.slug === c.slug; })[0];
      var row = el('div', 'card w8-cont');
      row.dataset.continent = c.slug;
      row.appendChild(el('h4', 'w8-cont-h', esc(c.label) + '<small class="w8-sub">' + esc((info ? info.chapters.map(function (id) { return chName(b, id); }).join(', ') : '') + ', ' + c.cells + ' cells') + '</small>'));
      function set(field, v) {
        var o = b.world.settings.overworld = U.isObj(b.world.settings.overworld) ? b.world.settings.overworld : {};
        o.continents = U.isObj(o.continents) ? o.continents : {};
        o.continents[c.slug] = U.isObj(o.continents[c.slug]) ? o.continents[c.slug] : {};
        o.continents[c.slug][field] = v;
        Kit.bundle.touch('settings'); Kit.rerender();
      }
      var pct = function (v) { return Math.round(v * 100) + '%'; };
      row.appendChild(slider('Radius', own.radius != null ? eff.radius : 1, 0.4, 1.8, 0.05, own.radius == null, function (v) { return v.toFixed(2) + 'x'; }, function (v) { set('radius', v); }));
      row.appendChild(slider('Ruggedness', isFinite(eff.ruggedness) ? eff.ruggedness : S.ruggedness, 0, 1, 0.05, !isFinite(eff.ruggedness), pct, function (v) { set('ruggedness', v); }));
      row.appendChild(slider('Mountain share', isFinite(eff.mountains) ? eff.mountains : S.mountainShare, 0, 0.45, 0.01, !isFinite(eff.mountains), pct, function (v) { set('mountains', v); }));
      var br = el('div', 'btn-row w8-cont-btns');
      var tr = WORLD.audio.track(b, 'field:' + c.slug);
      if (tr) {
        var mb = btn(WORLD.audio.playing() === c.slug ? 'Stop field music' : 'Play field music', null, 'w8-music', function () {
          if (WORLD.audio.playing() === c.slug) { WORLD.audio.stop(); }
          else if (!WORLD.audio.play(b, c.slug)) Kit.ui.toast(WORLD.audio.error() || 'The field music could not start.', 'warn');
          Array.prototype.forEach.call(document.querySelectorAll('.w8-music'), function (x) { var me = x.closest('.w8-cont').dataset.continent === WORLD.audio.playing(); x.querySelector('span').textContent = me ? 'Stop field music' : 'Play field music'; x.setAttribute('aria-pressed', me ? 'true' : 'false'); });
        });
        mb.setAttribute('aria-pressed', WORLD.audio.playing() === c.slug ? 'true' : 'false');
        mb.title = tr.name || 'field:' + c.slug;
        br.appendChild(mb);
      } else br.appendChild(el('span', 'muted w8-small', 'No track has the role field:' + esc(c.slug) + ' yet.'));
      if (Object.keys(own).length) br.appendChild(btn('Reset', null, '', function () { delete b.world.settings.overworld.continents[c.slug]; Kit.bundle.touch('settings'); Kit.rerender(); }));
      row.appendChild(br);
      list.appendChild(row);
    });
    card.appendChild(list);
    return card;
  }

  // ---------------------------------------------------------------- the tab
  function render(host) {
    var b = cur();
    WORLD.ensure(b);
    ui.viewer = null;
    var head = el('section', 'panel');
    head.innerHTML = '<h2 class="panel-title">World</h2><p class="muted">The overworld grows from the seed around the progression graph: continents sized by their chapters\' minutes, climate bands matched to biome tilesets, a mountain ridge with one pass between chapters that share a continent, a sea ring with one landing around each region the ship could reach early, and every town and dungeon stamped where its chapter can walk to it.</p>';
    host.appendChild(head);
    var rec = WORLD.overworld.record(b), card = el('section', 'panel w8-ow');
    host.appendChild(card);
    var row = el('div', 'btn-row');
    if (!rec || !rec.paramHash) {
      card.appendChild(el('h3', 'section-h', 'Overworld'));
      card.appendChild(el('p', 'muted', ui.busy ? 'Growing the overworld from seed ' + esc(String(b.world.seed)) + '.' : 'Nothing generated yet. Generating lays out the progression first if it is missing, then builds the map from seed ' + esc(String(b.world.seed)) + '.'));
      var g0 = btn(ui.busy ? 'Growing the map' : 'Generate the overworld', 'spark', 'btn-primary', function () { generate(b); });
      g0.disabled = ui.busy;
      row.appendChild(g0);
      card.appendChild(row);
      return;
    }
    var ready = WORLD.overworld.ready(b), ow = ready || !WORLD.overworld.async() ? WORLD.overworld.generate(b) : null, stale = WORLD.overworld.stale(b), growing = !ow;
    if (growing) {
      WORLD.overworld.prefetch(b).then(function (o) { if (o && b === cur() && Kit.active() === 'world') Kit.rerender(); }, function (e) { Kit.ui.toast(e.message, 'error', 8000); });
    } else ui.lastOw = ow;
    var shown = ow || ui.lastOw;
    card.appendChild(el('h3', 'section-h', 'Overworld'));
    var kinds = {};
    rec.gates.forEach(function (g) { kinds[g.kind] = (kinds[g.kind] || 0) + 1; });
    var nPaint = Object.keys(WORLD.overworld.paintCells(b)).length;
    card.appendChild(el('p', 'w8-chips', (growing ? '<span class="chip chip-muted">Growing</span>' : '<span class="chip ' + (ow.ok ? 'chip-ok' : 'chip-broken') + '">' + (ow.ok ? 'Every chapter checks out' : 'Problems') + '</span>') +
      (stale ? '<span class="chip chip-warning">Out of date</span>' : '') +
      '<span class="chip chip-muted">' + rec.w + ' by ' + rec.h + '</span>' +
      '<span class="chip chip-muted">Seed ' + esc(String(rec.seed)) + '</span>' +
      '<span class="chip chip-muted">Land ' + Math.round(rec.stats.land / (rec.w * rec.h) * 100) + '%</span>' +
      '<span class="chip chip-accent">' + rec.sites.length + ' sites</span>' +
      Object.keys(kinds).sort().map(function (k) { return '<span class="chip chip-accent">' + kinds[k] + ' ' + esc(kinds[k] === 1 ? (GATE_LABEL[k] || k).toLowerCase() : GATE_PLURAL[k] || k) + '</span>'; }).join('') +
      (nPaint ? '<span class="chip chip-accent">' + nPaint + ' painted</span>' : '') +
      (ow && ow.ms != null ? '<span class="chip chip-muted">' + ow.ms + ' ms' + (WORLD.overworld.worker().served ? ' in the worker' : '') + '</span>' : '')));
    if (stale && !growing) card.appendChild(el('p', 'msg msg-warning', 'The seed, settings, painted cells, chapters, or art changed since this map was stored. The picture shows the new map; Store changes to write it (the interiors and zones follow).'));
    var g1 = btn(ui.busy ? 'Growing the map' : stale ? 'Store changes' : 'Generate again', 'spark', stale ? 'btn-primary' : '', function () { generate(b); });
    var g2 = btn('New seed', 'spark', '', function () { generate(b, true); });
    g1.disabled = g2.disabled = ui.busy;
    row.appendChild(g1); row.appendChild(g2);
    card.appendChild(row);

    // Overlay picker and toggles.
    var bar = el('div', 'w8-owbar'), seg = el('div', 'w8-seg');
    seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', 'Map overlay');
    OVERLAYS.forEach(function (o) {
      var bt = el('button', 'btn w8-seg-btn', esc(o[1]));
      bt.type = 'button'; bt.setAttribute('role', 'radio'); bt.setAttribute('aria-checked', ui.overlay === o[0] ? 'true' : 'false'); bt.dataset.overlay = o[0];
      bt.addEventListener('click', function () { ui.overlay = o[0]; Kit.rerender(); });
      seg.appendChild(bt);
    });
    bar.appendChild(seg);
    bar.appendChild(WORLD.ui.toggle('Sites', ui.sites, function (on) { ui.sites = on; if (ui.viewer) ui.viewer.redraw(); }));
    bar.appendChild(WORLD.ui.toggle('Gates', ui.gates, function (on) { ui.gates = on; if (ui.viewer) ui.viewer.redraw(); }));
    card.appendChild(bar);

    var fig = el('figure', 'w8-map'), ib = el('section', 'panel w8-inspect');
    ib.id = 'w8-inspect';
    if (shown) {
      var cellOv = ui.overlay === 'tiles' ? 'biome' : ui.overlay;
      var v = WORLD.viewer({ state: ui.view, key: 'ow|' + shown.w + 'x' + shown.h, map: shown, b: b, tiles: ui.overlay === 'tiles',
        cellsKey: 'ow|' + shown.digest + '|' + cellOv, cellColor: colorFn(shown, b, cellOv), overlay: overlayFn(shown, b),
        label: 'Overworld map, ' + shown.w + ' by ' + shown.h + ' cells, showing ' + (OVERLAYS.filter(function (o) { return o[0] === ui.overlay; })[0] || OVERLAYS[0])[1].toLowerCase(),
        busy: growing ? 'Growing the map' : null,
        onTap: function (x, y) { ui.msg = null; if (!growing) inspect(ib, b, shown, x, y); } });
      v.canvas.dataset.overlay = ui.overlay;
      ui.viewer = growing ? null : v;
      fig.appendChild(v.el);
      card.appendChild(fig);
      card.appendChild(legend(shown, b));
      if (!growing && ui.focus != null) {
        var fx = Array.isArray(ui.focus) ? ui.focus[0] : ui.focus % shown.w, fy = Array.isArray(ui.focus) ? ui.focus[1] : Math.floor(ui.focus / shown.w);
        ui.focus = null;
        v.center(fx, fy, 8); v.select(fx, fy);
        setTimeout(function () { if (fig.isConnected && fig.scrollIntoView) fig.scrollIntoView({ block: 'center' }); }, 0);
      }
    } else {
      fig.appendChild(el('div', 'w8-view-stage w8-view-empty', '<div class="w8-view-busy"><span class="w8-busy">Growing the map</span></div>'));
      card.appendChild(fig);
    }
    if (shown) {
      var sel = ui.view.sel;
      inspect(ib, b, shown, sel && !growing ? sel[0] : null, sel && !growing ? sel[1] : null);
      host.appendChild(ib);
      host.appendChild(continentsCard(b, shown));
    }

    // Regions and gates, each with a Show button that centers the map on it.
    var rp = el('section', 'panel');
    rp.id = 'w8-regions';
    rp.appendChild(el('h3', 'section-h', 'Regions'));
    function showBtn(at, what) {
      var x = el('button', 'btn w8-pick', 'Show');
      x.type = 'button'; x.setAttribute('aria-label', 'Show ' + what + ' on the map');
      x.addEventListener('click', function () { if (at) showCell(at[0], at[1]); });
      x.disabled = !at || growing;
      return x;
    }
    var t = el('table', 'tbl');
    t.innerHTML = '<thead><tr><th scope="col">Chapter</th><th scope="col">Arrive</th><th scope="col" class="num">Cells</th><th scope="col" class="num">Sites</th><th scope="col"><span class="sr-only">Show</span></th></tr></thead><tbody></tbody>';
    rec.regions.forEach(function (r) {
      var n = rec.sites.filter(function (s) { return s.region === r.region; }).length, c = rec.continents.filter(function (x) { return x.continent === r.continent; })[0];
      var tr = el('tr', null, '<th scope="row">' + esc(chName(b, r.chapter)) + '<small class="w8-sub">' + esc((c ? c.label : r.continent) + (r.ringed ? ', sea ring' : '')) + '</small></th><td>' + esc(ENTRY_LABEL[r.entry] || r.entry) + '</td><td class="num">' + r.cells + '</td><td class="num">' + n + '</td>');
      var td = el('td'); td.appendChild(showBtn(r.anchor, chName(b, r.chapter))); tr.appendChild(td);
      t.tBodies[0].appendChild(tr);
    });
    var wrap = el('div', 'tbl-wrap'); wrap.appendChild(t); rp.appendChild(wrap);
    if (rec.gates.length) {
      rp.appendChild(el('h3', 'section-h', 'Gates'));
      var t2 = el('table', 'tbl');
      t2.innerHTML = '<thead><tr><th scope="col">Gate</th><th scope="col">Opens with</th><th scope="col"><span class="sr-only">Show</span></th></tr></thead><tbody></tbody>';
      rec.gates.forEach(function (g) {
        var where = rec.regions.filter(function (r) { return r.region === g.region; })[0];
        var tr = el('tr', null, '<th scope="row"><span class="w8-dot" style="background:' + (GATE_C[g.kind] || '#fff') + '"></span>' + esc(GATE_LABEL[g.kind] || g.kind) + '<small class="w8-sub">' + esc(where ? chName(b, where.chapter) : '') + ' at ' + esc(g.cells.map(function (c) { return c.join(','); }).join(' and ')) + '</small></th><td>' +
          g.requires.map(function (k) { return '<span class="chip chip-muted">' + esc(needText(b, k)) + '</span>'; }).join(' ') + '</td>');
        var td = el('td'); td.appendChild(showBtn(g.cells[0], (GATE_LABEL[g.kind] || g.kind) + (where ? ' of ' + chName(b, where.chapter) : ''))); tr.appendChild(td);
        t2.tBodies[0].appendChild(tr);
      });
      var wrap2 = el('div', 'tbl-wrap'); wrap2.appendChild(t2); rp.appendChild(wrap2);
    }
    host.appendChild(rp);
  }

  // Validation and other tabs open a cell here: map omitted or the overworld's map_ means the overworld; an interior
  // map_ opens the Sites tab on that site and floor with the cell picked.
  // The checks name an interior map as '<site key>|<floor>' and the overworld as 'overworld'; a map_ ID works too.
  WORLD.showAt = function (mapId, at) {
    var b = cur(), owRec = WORLD.overworld.record(b), m = mapId ? WORLD.records.get(mapId, b) : null, site = null, floor = 1;
    if (m && !(owRec && m.id === owRec.id)) { site = String(m.key || '').replace(/^map\|/, '').replace(/\|\d+$/, ''); floor = m.floor || 1; }
    else if (!m && mapId && mapId !== 'overworld') {
      var mm = /^(.*)\|(\d+)$/.exec(String(mapId));
      if (mm && WORLD.interiors.specs(b).some(function (sp) { return sp.key === mm[1]; })) { site = mm[1]; floor = Number(mm[2]); }
    }
    if (!site || !WORLD.sitesUi) { ui.focus = at; return Kit.go('world'); }
    WORLD.sitesUi.site = site; WORLD.sitesUi.floor = floor; WORLD.sitesUi.focus = at;
    return Kit.go('sites');
  };

  WORLD.WS = WORLD.WS || {};
  WORLD.WS.world = { render: render, onLeave: function () { if (WORLD.audio) WORLD.audio.stop(); } };
  WORLD.worldUi = ui;
})();
// === WS:WORLD END ===
