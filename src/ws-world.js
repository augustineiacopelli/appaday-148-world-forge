// === WS:WORLD BEGIN ===
(function () {
  'use strict';
  // The World tab. Phase 3: generate the overworld, see it one cell to a pixel with overlays for biome, elevation,
  // temperature, moisture, and regions, with sites and gates marked, and read its regions and gates. Phase 7 adds the
  // tile preview (tiles.drawMap), pan and pinch, per continent controls, and the tap inspector.
  var U = Kit.util, el = U.el, esc = U.esc;
  var ui = { overlay: 'biome', sites: true, gates: true };
  var OVERLAYS = [['biome', 'Biome'], ['elev', 'Elevation'], ['temp', 'Temperature'], ['moist', 'Moisture'], ['region', 'Regions']];
  var ELEV_C = ['#2f5f9a', '#d9c48a', '#7fae5c', '#4f7a3a', '#7a7068'];
  var TEMP_C = ['#3d6fb6', '#6fa3c8', '#b8c47a', '#e0a04a', '#c8502e'];
  var MOIST_C = ['#c9a96a', '#b4b46a', '#7fae5c', '#3f8a6a', '#2d6a8a'];
  var GATE_C = { pass: '#f5d142', landing: '#3fd0e0', seawall: '#f08a3c', lock: '#e04ad0' };
  var GATE_LABEL = { pass: 'Pass', landing: 'Landing', seawall: 'Sea ring', lock: 'Lock' };
  var GATE_PLURAL = { pass: 'passes', landing: 'landings', seawall: 'sea rings', lock: 'locks' };
  var ENTRY_LABEL = { start: 'Start', pass: 'Over a pass', landing: 'By sea' };
  function cur() { return Kit.bundle.current(); }
  function btn(label, icon, cls, fn) { return WORLD.ui.button(label, icon, cls, fn); }
  function chName(b, id) { var c = WORLD.chapters(b).filter(function (x) { return x.id === id; })[0]; return c ? c.name || id : id; }
  function regionHue(k) { return 'hsl(' + ((k * 137) % 360) + ', 55%, 55%)'; }

  function generate(b, reroll) {
    try {
      if (reroll) { b.world.seed = (Math.random() * 4294967295) >>> 0; Kit.bundle.touch('seed'); }
      var r = WORLD.overworld.apply(b);
      Kit.rerender();
      Kit.ui.toast(r.kept ? 'The overworld record is marked as user made, so it was kept.' : 'Overworld generated: ' + r.ow.w + ' by ' + r.ow.h + ', ' + r.ow.sites.length + ' sites, ' + r.ow.gates.length + ' gates, in ' + r.ow.ms + ' ms.', r.kept ? 'warn' : 'ok');
    } catch (e) { Kit.ui.toast(e.message, 'error', 8000); }
  }

  // One canvas pixel per cell; colors run length encoded per row so any CSS color works.
  function colorAt(ow, i, b) {
    switch (ui.overlay) {
      case 'elev': return ELEV_C[ow.elev[i]] || '#000';
      case 'temp': return ow.owner[i] < 0 ? '#1d3557' : TEMP_C[ow.temp[i]];
      case 'moist': return ow.owner[i] < 0 ? '#1d3557' : MOIST_C[ow.moist[i]];
      case 'region': return ow.region[i] >= 0 ? (ow.st[i] === 1 ? '#5a524c' : regionHue(ow.region[i])) : ow.owner[i] >= 0 ? '#888' : '#1d3557';
      default: {
        var ref = String(ow.ground[i] || ''), id = ref.split(':')[0], bio = ow.palette.biomes[id];
        if (ref.indexOf(':') >= 0) return '#2a2420';
        return WORLD.biomeColor(id, bio && bio.key);
      }
    }
  }
  function draw(cv, ow, b) {
    var ctx = cv.getContext && cv.getContext('2d');
    if (!ctx) return false;
    ctx.imageSmoothingEnabled = false;
    for (var y = 0; y < ow.h; y++) {
      var run = 0, col = null;
      for (var x = 0; x <= ow.w; x++) {
        var c = x < ow.w ? colorAt(ow, y * ow.w + x, b) : null;
        if (c !== col) { if (col) { ctx.fillStyle = col; ctx.fillRect(x - run, y, run, 1); } col = c; run = 0; }
        run++;
      }
    }
    if (ui.sites) ow.sites.forEach(function (s) {
      ctx.fillStyle = s.golden ? '#14100c' : '#3a3430'; ctx.fillRect(s.x, s.y, s.w, s.h);
      var e = s.entrance; ctx.fillStyle = '#fff6d8'; ctx.fillRect(e % ow.w, Math.floor(e / ow.w), 1, 1);
    });
    if (ui.gates) ow.gates.forEach(function (g) { ctx.fillStyle = GATE_C[g.kind] || '#fff'; g.cells.forEach(function (c) { ctx.fillRect(c % ow.w, Math.floor(c / ow.w), 1, 1); }); });
    if (ow.start != null) { ctx.fillStyle = '#ffffff'; ctx.fillRect(ow.start % ow.w - 1, Math.floor(ow.start / ow.w), 3, 1); ctx.fillRect(ow.start % ow.w, Math.floor(ow.start / ow.w) - 1, 1, 3); }
    return true;
  }
  function legend(ow, b) {
    var items = [];
    if (ui.overlay === 'biome') {
      var counts = {}, order = [];
      ow.ground.forEach(function (r) { r = String(r || ''); if (r.indexOf(':') >= 0) return; if (!counts[r]) { counts[r] = 0; order.push(r); } counts[r]++; });
      order.sort(function (a, c) { return counts[c] - counts[a] || (a < c ? -1 : 1); }).forEach(function (id) {
        var bio = ow.palette.biomes[id], t = b.art.records.til_[id], pct = counts[id] / (ow.w * ow.h) * 100;
        items.push([WORLD.biomeColor(id, bio && bio.key), (t && t.name || id) + ' ' + (pct < 1 ? '<1' : Math.round(pct)) + '%']);
      });
    } else if (ui.overlay === 'elev') ['Sea', 'Coast', 'Low', 'High', 'Peak'].forEach(function (l, k) { items.push([ELEV_C[k], l]); });
    else if (ui.overlay === 'temp') ['Coldest', 'Cold', 'Mild', 'Warm', 'Hottest'].forEach(function (l, k) { items.push([TEMP_C[k], l]); });
    else if (ui.overlay === 'moist') ['Driest', 'Dry', 'Moderate', 'Wet', 'Wettest'].forEach(function (l, k) { items.push([MOIST_C[k], l]); });
    else ow.regions.forEach(function (r, k) { items.push([regionHue(k), chName(b, r.chapter) + (r.ringed ? ' (sea ring)' : '')]); });
    if (ui.gates) Object.keys(GATE_LABEL).forEach(function (k) { if (ow.gates.some(function (g) { return g.kind === k; })) items.push([GATE_C[k], GATE_LABEL[k]]); });
    if (ui.sites) items.push(['#14100c', 'Site (light dot is the door)']);
    return el('div', 'w8-legend', items.map(function (it) { return '<span><i style="background:' + it[0] + '"></i>' + esc(it[1]) + '</span>'; }).join(''));
  }

  function render(host) {
    var b = cur();
    WORLD.ensure(b);
    var head = el('section', 'panel');
    head.innerHTML = '<h2 class="panel-title">World</h2><p class="muted">The overworld grows from the seed around the progression graph: continents sized by their chapters\' minutes, climate bands matched to biome tilesets, a mountain ridge with one pass between chapters that share a continent, a sea ring with one landing around each region the ship could reach early, and every town and dungeon stamped where its chapter can walk to it.</p>';
    host.appendChild(head);
    var rec = WORLD.overworld.record(b), card = el('section', 'panel w8-ow');
    host.appendChild(card);
    var row = el('div', 'btn-row');
    if (!rec || !rec.paramHash) {
      card.appendChild(el('h3', 'section-h', 'Overworld'));
      card.appendChild(el('p', 'muted', 'Nothing generated yet. Generating lays out the progression first if it is missing, then builds the map from seed ' + esc(String(b.world.seed)) + '.'));
      row.appendChild(btn('Generate the overworld', 'spark', 'btn-primary', function () { generate(b); }));
      card.appendChild(row);
      return;
    }
    var ow = WORLD.overworld.generate(b), stale = WORLD.overworld.stale(b);
    card.appendChild(el('h3', 'section-h', 'Overworld'));
    var kinds = {};
    rec.gates.forEach(function (g) { kinds[g.kind] = (kinds[g.kind] || 0) + 1; });
    card.appendChild(el('p', 'w8-chips', '<span class="chip ' + (ow && ow.ok ? 'chip-ok' : 'chip-broken') + '">' + (ow && ow.ok ? 'Every chapter checks out' : 'Problems') + '</span>' +
      (stale ? '<span class="chip chip-warning">Out of date</span>' : '') +
      '<span class="chip chip-muted">' + rec.w + ' by ' + rec.h + '</span>' +
      '<span class="chip chip-muted">Seed ' + esc(String(rec.seed)) + '</span>' +
      '<span class="chip chip-muted">Land ' + Math.round(rec.stats.land / (rec.w * rec.h) * 100) + '%</span>' +
      '<span class="chip chip-accent">' + rec.sites.length + ' sites</span>' +
      Object.keys(kinds).sort().map(function (k) { return '<span class="chip chip-accent">' + kinds[k] + ' ' + esc(kinds[k] === 1 ? (GATE_LABEL[k] || k).toLowerCase() : GATE_PLURAL[k] || k) + '</span>'; }).join('') +
      (ow && ow.ms != null ? '<span class="chip chip-muted">' + ow.ms + ' ms</span>' : '')));
    if (stale) card.appendChild(el('p', 'msg msg-warning', 'The seed, settings, chapters, or art changed since this map was made. The picture shows the new map; Generate again to store it.'));
    row.appendChild(btn('Generate again', 'spark', stale ? 'btn-primary' : '', function () { generate(b); }));
    row.appendChild(btn('New seed', 'spark', '', function () { generate(b, true); }));
    card.appendChild(row);

    // Overlay picker and toggles.
    var bar = el('div', 'w8-owbar');
    var seg = el('div', 'w8-seg');
    seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', 'Map overlay');
    OVERLAYS.forEach(function (o) {
      var bt = el('button', 'btn w8-seg-btn', esc(o[1]));
      bt.type = 'button'; bt.setAttribute('role', 'radio'); bt.setAttribute('aria-checked', ui.overlay === o[0] ? 'true' : 'false'); bt.dataset.overlay = o[0];
      bt.addEventListener('click', function () { ui.overlay = o[0]; Kit.rerender(); });
      seg.appendChild(bt);
    });
    bar.appendChild(seg);
    bar.appendChild(WORLD.ui.toggle('Sites', ui.sites, function (on) { ui.sites = on; Kit.rerender(); }));
    bar.appendChild(WORLD.ui.toggle('Gates', ui.gates, function (on) { ui.gates = on; Kit.rerender(); }));
    card.appendChild(bar);
    if (ow) {
      var fig = el('figure', 'w8-map'), cv = el('canvas');
      cv.width = ow.w; cv.height = ow.h;
      cv.setAttribute('role', 'img');
      cv.setAttribute('aria-label', 'Overworld map, ' + ow.w + ' by ' + ow.h + ' cells, showing ' + (OVERLAYS.filter(function (o) { return o[0] === ui.overlay; })[0] || OVERLAYS[0])[1].toLowerCase());
      cv.dataset.overlay = ui.overlay;
      cv.dataset.drawn = draw(cv, ow, b) ? '1' : '0';
      fig.appendChild(cv);
      card.appendChild(fig);
      card.appendChild(legend(ow, b));
    }

    // Regions and gates.
    var rp = el('section', 'panel');
    rp.appendChild(el('h3', 'section-h', 'Regions'));
    var t = el('table', 'tbl');
    t.innerHTML = '<thead><tr><th scope="col">Chapter</th><th scope="col">Arrive</th><th scope="col" class="num">Cells</th><th scope="col" class="num">Sites</th></tr></thead><tbody>' +
      rec.regions.map(function (r) {
        var n = rec.sites.filter(function (s) { return s.region === r.region; }).length, c = rec.continents.filter(function (x) { return x.continent === r.continent; })[0];
        return '<tr><th scope="row">' + esc(chName(b, r.chapter)) + '<small class="w8-sub">' + esc((c ? c.label : r.continent) + (r.ringed ? ', sea ring' : '')) + '</small></th><td>' + esc(ENTRY_LABEL[r.entry] || r.entry) + '</td><td class="num">' + r.cells + '</td><td class="num">' + n + '</td></tr>';
      }).join('') + '</tbody>';
    var wrap = el('div', 'tbl-wrap'); wrap.appendChild(t); rp.appendChild(wrap);
    if (rec.gates.length) {
      rp.appendChild(el('h3', 'section-h', 'Gates'));
      var t2 = el('table', 'tbl');
      t2.innerHTML = '<thead><tr><th scope="col">Gate</th><th scope="col">Opens with</th></tr></thead><tbody>' +
        rec.gates.map(function (g) {
          var where = rec.regions.filter(function (r) { return r.region === g.region; })[0];
          return '<tr><th scope="row"><span class="w8-dot" style="background:' + (GATE_C[g.kind] || '#fff') + '"></span>' + esc(GATE_LABEL[g.kind] || g.kind) + '<small class="w8-sub">' + esc(where ? chName(b, where.chapter) : '') + ' at ' + esc(g.cells.map(function (c) { return c.join(','); }).join(' and ')) + '</small></th><td>' +
            g.requires.map(function (k) { return '<span class="chip chip-muted">' + esc(k.replace(/^chapter:(chp_.*)$/, function (m, id) { return 'chapter: ' + chName(b, id); }).replace(/^item:seal:(chp_.*)$/, function (m, id) { return 'seal: ' + chName(b, id); })) + '</span>'; }).join(' ') + '</td></tr>';
        }).join('') + '</tbody>';
      var wrap2 = el('div', 'tbl-wrap'); wrap2.appendChild(t2); rp.appendChild(wrap2);
    }
    host.appendChild(rp);
  }

  WORLD.WS = WORLD.WS || {};
  WORLD.WS.world = { render: render };
  WORLD.worldUi = ui;
})();
// === WS:WORLD END ===
