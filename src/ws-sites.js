// === WS:SITES BEGIN ===
(function () {
  'use strict';
  // The Sites tab. Phase 4: generate every interior, list the towns, dungeons, castles, and caves by chapter, and preview
  // any floor one cell to a pixel with its exits, chests, locks, bosses, and people marked. Phase 7 adds the tile
  // preview (tiles.drawMap) and the exits overlay on top of the real tiles.
  var U = Kit.util, el = U.el, esc = U.esc;
  var ui = { site: null, floor: 1 };
  var KIND_LABEL = { town: 'Town', dungeon: 'Dungeon', castle: 'Castle', cave: 'Cave' };
  var TILE_C = { wall: '#3a332e', floor: null, door: '#9a6a34', stairs: '#e8d48a', counter: '#b0643a', table: '#7a5636', barrel: '#6e4a2a', bed: '#b25a6a',
    shelf: '#5e4630', rug: '#a8473f', plant: '#3f8a4a', lintel: '#9a6a34', arch: '#9a6a34', pillar: '#8c8c94', torch: '#f0983c', chest: '#f5c542', channel: '#3a78c8', spikes: '#c0c0c8' };
  var FLOOR_C = { town: '#c8a46c', dungeon: '#6c7079', castle: '#7d7a86', cave: '#6a5f55' };
  var MARK = { lock: '#e04ad0', boss: '#e0443a', exit: '#3fd0e0', npc: '#ffffff' };
  var ROLE_LABEL = { start: 'Start town', town: 'Second town', key: 'Key dungeon', boss: 'Boss dungeon' };
  function cur() { return Kit.bundle.current(); }
  function btn(label, icon, cls, fn) { return WORLD.ui.button(label, icon, cls, fn); }
  function chName(b, id) { var c = WORLD.chapters(b).filter(function (x) { return x.id === id; })[0]; return c ? c.name || id : id; }
  function placeLabel(slot) {
    var m = /^shop:(.*)$/.exec(slot), h = /^house(\d+)$/.exec(slot);
    return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) + ' shop' : h ? 'House ' + h[1] : slot.charAt(0).toUpperCase() + slot.slice(1);
  }
  function roleLabel(s) { return s.role === 'boss' && s.interior === 'castle' ? 'Castle' : ROLE_LABEL[s.role] || (/^cave/.test(s.role) ? 'Cave' : s.role); }

  function generate(b) {
    try {
      var r = WORLD.interiors.apply(b);
      Kit.rerender();
      Kit.ui.toast('Interiors generated: ' + r.sites + ' sites, ' + r.floors + ' floors, ' + r.people + ' people, in ' + r.ms + ' ms.' + (r.kept.length ? ' ' + r.kept.length + ' user records kept.' : ''), r.kept.length ? 'warn' : 'ok');
    } catch (e) { Kit.ui.toast(e.message, 'error', 8000); }
  }

  function colorAt(fl, i, kind, b) {
    var d = fl.deco[i], g = String(fl.ground[i] || ''), k;
    if (d) { k = String(d).split(':')[1]; if (TILE_C[k]) return TILE_C[k]; }
    if (g.indexOf(':') < 0) return WORLD.biomeColor(g, (b.art.records.til_[g] || {}).key);
    k = g.split(':')[1];
    if (k === 'floor') return FLOOR_C[kind] || '#888';
    return TILE_C[k] || '#888';
  }
  function draw(cv, fl, site, b) {
    var ctx = cv.getContext && cv.getContext('2d');
    if (!ctx) return false;
    ctx.imageSmoothingEnabled = false;
    for (var y = 0; y < fl.h; y++) {
      var run = 0, col = null;
      for (var x = 0; x <= fl.w; x++) {
        var c = x < fl.w ? colorAt(fl, y * fl.w + x, site.kind, b) : null;
        if (c !== col) { if (col) { ctx.fillStyle = col; ctx.fillRect(x - run, y, run, 1); } col = c; run = 0; }
        run++;
      }
    }
    function dot(i, c) { ctx.fillStyle = c; ctx.fillRect(i % fl.w, Math.floor(i / fl.w), 1, 1); }
    fl.features.forEach(function (ft) { if (MARK[ft.kind]) dot(ft.at, MARK[ft.kind]); });
    fl.exits.forEach(function (ex) { dot(ex.at, MARK.exit); });
    site.npcs.forEach(function (p) { if (p.floor === fl.floor) dot(p.at, MARK.npc); });
    return true;
  }
  function legend(site) {
    var items = [[FLOOR_C[site.kind], 'Floor'], [TILE_C.wall, 'Wall'], [TILE_C.door, 'Door'], [MARK.exit, 'Exit']];
    if (site.kind === 'town') items.push([TILE_C.counter, 'Counter'], [TILE_C.bed, 'Bed'], [MARK.npc, 'Person']);
    else items.push([TILE_C.stairs, 'Stairs'], [TILE_C.chest, 'Chest']);
    if (site.floors.some(function (fl) { return fl.features.some(function (ft) { return ft.kind === 'lock'; }); })) items.push([MARK.lock, 'Locked door'], [MARK.boss, 'Boss']);
    return el('div', 'w8-legend', items.map(function (it) { return '<span><i style="background:' + it[0] + '"></i>' + esc(it[1]) + '</span>'; }).join(''));
  }

  function preview(b, spec, site, host) {
    var card = el('section', 'panel w8-site'), s2 = spec.site, rec = WORLD.records.get(s2.record, b);
    card.id = 'site-preview';
    var nF = site.floors.length;
    if (ui.floor > nF) ui.floor = 1;
    var fl = site.floors[ui.floor - 1];
    card.appendChild(el('h3', 'section-h', esc(rec ? rec.name : s2.key)));
    card.appendChild(el('p', 'w8-chips', '<span class="chip chip-accent">' + esc(KIND_LABEL[site.kind] || site.kind) + '</span>' +
      '<span class="chip chip-muted">' + fl.w + ' by ' + fl.h + '</span>' +
      (nF > 1 ? '<span class="chip chip-muted">' + nF + ' floors</span>' : '') +
      (site.npcs.length ? '<span class="chip chip-muted">' + site.npcs.length + ' people</span>' : '') +
      '<span class="chip ' + (site.ok ? 'chip-ok' : 'chip-broken') + '">' + (site.ok ? 'Walks clean' : 'Problems') + '</span>'));
    if (nF > 1) {
      var seg = el('div', 'w8-seg');
      seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', 'Floor');
      site.floors.forEach(function (f) {
        var bt = el('button', 'btn w8-seg-btn', 'Floor ' + f.floor);
        bt.type = 'button'; bt.setAttribute('role', 'radio'); bt.setAttribute('aria-checked', f.floor === ui.floor ? 'true' : 'false');
        bt.addEventListener('click', function () { ui.floor = f.floor; Kit.rerender(); });
        seg.appendChild(bt);
      });
      var bar = el('div', 'w8-owbar'); bar.appendChild(seg); card.appendChild(bar);
    }
    var fig = el('figure', 'w8-imap'), cv = el('canvas');
    cv.width = fl.w; cv.height = fl.h;
    cv.style.aspectRatio = fl.w + ' / ' + fl.h;
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', (rec ? rec.name : s2.key) + ', floor ' + fl.floor + ', ' + fl.w + ' by ' + fl.h + ' cells');
    cv.dataset.site = s2.key; cv.dataset.floor = String(fl.floor);
    cv.dataset.drawn = draw(cv, fl, site, b) ? '1' : '0';
    fig.appendChild(cv);
    card.appendChild(fig);
    card.appendChild(legend(site));
    // Exits and features in words.
    var outs = fl.exits.filter(function (ex) { return ex.kind === 'overworld'; }).map(function (ex) { return WORLD.overworld.xy(ex.at, fl.w).join(','); });
    var lines = outs.length ? ['Way out at ' + outs.join(' and ') + ', back to the overworld in front of the site'] : [];
    fl.exits.forEach(function (ex) { if (ex.kind !== 'overworld') lines.push('Stairs ' + ex.kind + ' at ' + WORLD.overworld.xy(ex.at, fl.w).join(',') + ' to floor ' + ex.toFloor); });
    fl.features.forEach(function (ft) {
      var at = WORLD.overworld.xy(ft.at, fl.w).join(',');
      if (ft.kind === 'lock') lines.push('Locked door at ' + at + ', opened by the key chest');
      else if (ft.kind === 'chest') lines.push((ft.prize ? 'Prize chest' : ft.item ? 'Key chest' : 'Treasure chest') + ' at ' + at + (ft.prize && ft.item ? ' holding ' + ft.item.replace(/^item:seal:(chp_.*)$/, function (m, id) { return 'the seal of ' + chName(b, id); }) : ''));
      else if (ft.kind === 'boss') lines.push('Boss at ' + at + (ft.troop ? ', troop ' + ft.troop : ', troop slot empty for Day 149'));
    });
    if (lines.length) card.appendChild(el('ul', 'w8-lines', lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('')));
    if (site.npcs.length) {
      var t = el('table', 'tbl');
      t.innerHTML = '<thead><tr><th scope="col">Person</th><th scope="col">Archetype</th><th scope="col">Where</th></tr></thead><tbody>' +
        site.npcs.map(function (p) {
          var r = WORLD.records.get(ENGINE_WORLD.ids.structural('npc_', WORLD.interiors.npcKey(s2.key, p.slot)), b);
          return '<tr><th scope="row">' + esc(r ? r.name.replace(/^.*: /, '') : p.slot) + '</th><td>' + esc(p.archetype) + '</td><td>' + esc(p.building ? placeLabel(p.building) : p.role === 'guard' ? 'At the gate' : 'Outdoors') + '</td></tr>';
        }).join('') + '</tbody>';
      var wrap = el('div', 'tbl-wrap'); wrap.appendChild(t); card.appendChild(wrap);
    }
    host.appendChild(card);
  }

  function render(host) {
    var b = cur();
    WORLD.ensure(b);
    var head = el('section', 'panel');
    head.innerHTML = '<h2 class="panel-title">Sites</h2><p class="muted">Every town, dungeon, castle, and cave on the overworld gets its interior from the seed. Towns are single map cutaways with an inn, shops, a church, and houses around a plaza; dungeons and castles are rooms split by binary space partitioning with a key chest before the locked door to the boss; caves are grown by cellular automaton and tunneled together. Exits lead back to the cell in front of each site.</p>';
    var row = el('div', 'btn-row'), owRec = WORLD.overworld.record(b), gen = WORLD.interiors.generated(b), stale = gen && WORLD.interiors.stale(b);
    if (!owRec || !owRec.paramHash) head.appendChild(el('p', 'muted', 'The overworld has not been generated yet. Generating the interiors generates it first.'));
    if (gen) {
      var maps = WORLD.interiors.maps(b), npcs = WORLD.records.list('npc_', b).length, kinds = {};
      maps.forEach(function (m) { if (m.floor === 1) kinds[m.kind] = (kinds[m.kind] || 0) + 1; });
      head.appendChild(el('p', 'w8-chips', (stale ? '<span class="chip chip-warning">Out of date</span>' : '<span class="chip chip-ok">Every interior walks clean</span>') +
        Object.keys(kinds).sort().map(function (k) { return '<span class="chip chip-accent">' + kinds[k] + ' ' + esc((KIND_LABEL[k] || k).toLowerCase() + (kinds[k] === 1 ? '' : 's')) + '</span>'; }).join('') +
        '<span class="chip chip-muted">' + maps.length + ' maps</span><span class="chip chip-muted">' + npcs + ' people</span>'));
      if (stale) head.appendChild(el('p', 'msg msg-warning', 'The overworld, seed, settings, or art changed since the interiors were made. Generate them again to store the new ones.'));
    }
    row.appendChild(btn(gen ? 'Generate again' : 'Generate every interior', 'spark', !gen || stale ? 'btn-primary' : '', function () { generate(b); }));
    head.appendChild(row);
    host.appendChild(head);
    if (!gen) return;
    var specs = WORLD.interiors.specs(b);
    if (!specs.length) return;
    if (!ui.site || !specs.some(function (sp) { return sp.key === ui.site; })) { ui.site = specs[0].key; ui.floor = 1; }
    var sel = specs.filter(function (sp) { return sp.key === ui.site; })[0];
    preview(b, sel, WORLD.interiors.site(sel.key, b), host);
    // Sites by chapter.
    var list = el('section', 'panel');
    list.appendChild(el('h3', 'section-h', 'Sites by chapter'));
    var t = el('table', 'tbl w8-sites');
    var rows = [];
    WORLD.chapters(b).forEach(function (c) {
      specs.filter(function (sp) { return sp.site.chapter === c.id; }).forEach(function (sp, k) {
        var rec = WORLD.records.get(sp.site.record, b), nF = (rec && rec.maps || []).length, np = (rec && rec.people || []).length;
        rows.push('<tr' + (sp.key === ui.site ? ' aria-current="true"' : '') + '><th scope="row">' + esc(roleLabel(sp.site)) + '<small class="w8-sub">' + esc(chName(b, c.id)) + '</small></th><td>' + esc(KIND_LABEL[sp.kind] || sp.kind) + '</td><td class="num">' + nF + '</td><td class="num">' + np + '</td><td><button class="btn w8-pick" type="button" data-site="' + esc(sp.key) + '"' + (sp.key === ui.site ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>Preview</button></td></tr>');
      });
    });
    t.innerHTML = '<thead><tr><th scope="col">Site</th><th scope="col">Kind</th><th scope="col" class="num">Floors</th><th scope="col" class="num">People</th><th scope="col"><span class="sr-only">Preview</span></th></tr></thead><tbody>' + rows.join('') + '</tbody>';
    Array.prototype.forEach.call(t.querySelectorAll('.w8-pick'), function (bt) {
      bt.addEventListener('click', function () {
        ui.site = bt.dataset.site; ui.floor = 1; Kit.rerender();
        var pv = document.getElementById('site-preview');
        if (pv && pv.scrollIntoView) pv.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    });
    var wrap = el('div', 'tbl-wrap'); wrap.appendChild(t); list.appendChild(wrap);
    host.appendChild(list);
  }

  WORLD.WS = WORLD.WS || {};
  WORLD.WS.sites = { render: render };
  WORLD.sitesUi = ui;
})();
// === WS:SITES END ===
