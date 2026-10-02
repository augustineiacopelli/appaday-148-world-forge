// === WS:ENCOUNTERS BEGIN ===
(function () {
  'use strict';
  // The Encounters tab. Phase 5: generate the encounter zones and read them back: field zones by chapter, continent,
  // and biome; one table per dungeon, castle, and cave floor; the bosses and guardians; and who gives each side quest.
  // Phase 7: every zone has an Edit button that opens its rate and weights inline. Saving stores only what differs from
  // the generated table in world.overrides.zones (WORLD.zones.edit) and applies the zones again at once, so the table on
  // screen is always the stored one. Back to generated removes the override.
  var U = Kit.util, el = U.el, esc = U.esc;
  var ui = { editing: null };
  function cur() { return Kit.bundle.current(); }
  function btn(label, icon, cls, fn) { return WORLD.ui.button(label, icon, cls, fn); }
  function nameOf(b, id) {
    if (!id) return '';
    var r = (b.rules && (b.rules.trp_ || {})[id]) || (b.rules && (b.rules.wth_ || {})[id]) || (b.rules && (b.rules.sdq_ || {})[id]) ||
      (b.art && b.art.records && ((b.art.records.bgd_ || {})[id] || (b.art.records.til_ || {})[id])) || WORLD.records.get(id, b);
    return r && r.name ? r.name : id;
  }
  function chName(b, id) { var c = WORLD.chapters(b).filter(function (x) { return x.id === id; })[0]; return c ? c.name || id : id || 'No chapter'; }
  function steps(rate) { return rate > 0 ? 'about 1 in ' + Math.round(256 / rate) : 'never'; }
  function troopsCell(b, z) {
    if (!z.troops.length) return '<span class="chip chip-warning">No troops</span>';
    return z.troops.map(function (t) { return '<span class="w8-troop' + (t.troop === z.rare ? ' w8-rare' : '') + '">' + esc(nameOf(b, t.troop)) + ' <b>' + t.weight + '/16</b></span>'; }).join('');
  }

  function generate(b) {
    try {
      var r = WORLD.zones.apply(b), s = r.zones.stats;
      Kit.rerender();
      Kit.ui.toast('Encounter zones generated: ' + s.field + ' field, ' + s.interior + ' interior, ' + s.bosses + ' bosses' + (s.guardians ? ', ' + s.guardians + ' guardians' : '') +
        (s.givers ? ', ' + s.givers + ' quest givers' : '') + ', in ' + r.ms + ' ms.', 'ok');
    } catch (e) { Kit.ui.toast(e.message, 'error', 8000); }
  }

  function editBtn(q) {
    var open = ui.editing === q.key;
    return '<td class="w8-zcell"><button class="btn w8-pick w8-zedit" type="button" data-zone="' + esc(q.key) + '" aria-expanded="' + (open ? 'true' : 'false') + '">' + (open ? 'Close' : 'Edit') + '</button></td>';
  }
  function edited(q) { return q.overridden ? ' <span class="chip chip-accent">Edited</span>' : ''; }
  // The inline form: rate in 256ths a step and one weight per troop, with what the generator made beside each.
  function editor(b, q, q0) {
    var box = el('div', 'w8-zform'), wid = {};
    box.appendChild(el('h4', 'w8-zform-h', 'Edit ' + esc(q.kind === 'field' ? nameOf(b, q.biome) + ', ' + chName(b, q.chapter) : (WORLD.records.get(q.map, b) || {}).name || q.key)));
    function num(label, value, max, hint) {
      var id = 'w8z' + U.rand36(6), row = el('div', 'w8-zfield'), lab = el('label', null, esc(label));
      lab.htmlFor = id;
      var inp = el('input', 'inp w8-znum'); inp.type = 'number'; inp.id = id; inp.min = 0; inp.max = max; inp.step = 1; inp.value = value; inp.inputMode = 'numeric';
      var out = el('span', 'w8-zhint muted', esc(hint));
      row.appendChild(lab); row.appendChild(inp); row.appendChild(out);
      box.appendChild(row);
      return { inp: inp, out: out };
    }
    var rate = num('Battle chance each step, in 256', q.rate, 255, '');
    function rateHint() { var r = Math.max(0, Math.min(255, Math.floor(Number(rate.inp.value) || 0))); rate.out.textContent = steps(r) + (q0 ? ', generated ' + q0.rate : ''); }
    rateHint(); rate.inp.addEventListener('input', rateHint);
    var tot = el('p', 'w8-ztotal muted');
    if (!q.troops.length) box.appendChild(el('p', 'muted', 'This zone has no troops, so only its rate can change.'));
    q.troops.forEach(function (t) {
      var g0 = q0 && q0.troops.filter(function (x) { return x.troop === t.troop; })[0];
      wid[t.troop] = num(nameOf(b, t.troop) + (t.troop === q.rare ? ' (rare slot)' : ''), t.weight, 64, '');
      wid[t.troop].g0 = g0 ? g0.weight : null;
    });
    function totals() {
      var sum = 0;
      q.troops.forEach(function (t) { sum += Math.max(0, Math.floor(Number(wid[t.troop].inp.value) || 0)); });
      q.troops.forEach(function (t) {
        var v = Math.max(0, Math.floor(Number(wid[t.troop].inp.value) || 0));
        wid[t.troop].out.textContent = (sum ? Math.round(v / sum * 100) : 0) + '% of battles' + (wid[t.troop].g0 != null ? ', generated ' + wid[t.troop].g0 : '');
      });
      tot.textContent = q.troops.length ? 'Weights add up to ' + sum + (sum === 16 ? ' sixteenths, as generated tables do.' : sum ? '; each troop fights in its share of the total.' : '. With every weight at 0 this zone never picks a troop.') : '';
    }
    q.troops.forEach(function (t) { wid[t.troop].inp.addEventListener('input', totals); });
    totals();
    box.appendChild(tot);
    var row = el('div', 'btn-row');
    row.appendChild(WORLD.ui.button('Save', 'check', 'btn-primary', function () {
      var w = {};
      q.troops.forEach(function (t) { w[t.troop] = wid[t.troop].inp.value; });
      save(b, q.key, { rate: rate.inp.value, weights: w });
    }));
    if (q.overridden) row.appendChild(WORLD.ui.button('Back to generated', null, '', function () { save(b, q.key, null); }));
    row.appendChild(WORLD.ui.button('Cancel', null, '', function () { ui.editing = null; Kit.rerender(); }));
    box.appendChild(row);
    return box;
  }
  function save(b, key, want) {
    try {
      var r = WORLD.zones.edit(b, key, want || {});
      if (!r.ok) { Kit.ui.toast(r.message, 'error', 8000); return; }
      ui.editing = null;
      Kit.rerender();
      Kit.ui.toast(r.override ? 'Zone saved: only the changes are stored, and the tables were applied again.' : 'Zone is back to its generated table.', 'ok');
      var tr = document.querySelector('tr[data-zone="' + key.replace(/"/g, '\\"') + '"]');
      if (tr && tr.scrollIntoView) tr.scrollIntoView({ block: 'center' });
    } catch (e) { Kit.ui.toast(e.message, 'error', 8000); }
  }
  // Wires a table's Edit buttons and puts the open form under its row.
  function wire(b, wrap, list, base) {
    Array.prototype.forEach.call(wrap.querySelectorAll('.w8-zedit'), function (bt) {
      bt.addEventListener('click', function () {
        ui.editing = ui.editing === bt.dataset.zone ? null : bt.dataset.zone;
        Kit.rerender();
        var f = document.querySelector('.w8-zform');
        if (f && f.scrollIntoView) f.scrollIntoView({ block: 'nearest' });
        var i = f && f.querySelector('input');
        if (i) i.focus();
      });
    });
    var q = list.filter(function (x) { return x.key === ui.editing; })[0];
    if (!q) return;
    var tr = Array.prototype.filter.call(wrap.querySelectorAll('tbody tr'), function (r) { return r.dataset.zone === q.key; })[0];
    if (!tr) return;
    var q0 = base ? base.field.concat(base.interior).filter(function (x) { return x.key === q.key; })[0] : null;
    var er = el('tr', 'w8-zrow'), td = el('td');
    td.colSpan = tr.children.length;
    td.appendChild(editor(b, q, q0));
    er.appendChild(td);
    tr.parentNode.insertBefore(er, tr.nextSibling);
  }

  function table(head, rows) {
    var t = el('table', 'tbl w8-enc');
    t.innerHTML = '<thead><tr>' + head.map(function (h, k) { return '<th scope="col"' + (h.num ? ' class="num"' : '') + '>' + (h.sr ? '<span class="sr-only">' + esc(h.t) + '</span>' : esc(h.t || h)) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody>';
    var wrap = el('div', 'tbl-wrap'); wrap.appendChild(t);
    return wrap;
  }

  function render(host) {
    var b = cur();
    WORLD.ensure(b);
    var head = el('section', 'panel'), z = WORLD.zones.data(b), stale = z && WORLD.zones.stale(b);
    head.innerHTML = '<h2 class="panel-title">Encounters</h2><p class="muted">Random battles come from zones. On the overworld each continent, chapter, and biome is its own zone, built only from ground that carries the encounter flag; every dungeon, castle, and cave floor has its own table; towns have none. Each table fills four slots the way Final Fantasy VI did, weighted 5, 5, 5, and 1 in sixteenths, with the chapter\'s strongest troop in the rare slot. Rates are chances in 256 per step. Bosses keep their rooms, spare boss troops guard optional treasure, and each side quest gets a giver in a town of its chapter.</p>';
    if (!WORLD.interiors.generated(b)) head.appendChild(el('p', 'muted', 'The interiors have not been generated yet. Generating the zones generates the overworld and interiors first.'));
    if (z) {
      var s = z.stats || {};
      head.appendChild(el('p', 'w8-chips', (stale ? '<span class="chip chip-warning">Out of date</span>' : '<span class="chip chip-ok">Up to date</span>') +
        '<span class="chip chip-accent">' + s.field + ' field zones</span><span class="chip chip-accent">' + s.interior + ' interior zones</span>' +
        '<span class="chip chip-muted">' + s.bosses + ' bosses</span>' + (s.guardians ? '<span class="chip chip-muted">' + s.guardians + ' guardians</span>' : '') +
        '<span class="chip chip-muted">' + (s.cells || 0) + ' encounter cells</span>' + (s.givers + s.kept ? '<span class="chip chip-muted">' + (s.givers + s.kept) + ' quest givers</span>' : '') +
        (z.warnings.length ? '<span class="chip chip-warning">' + z.warnings.length + ' warning' + (z.warnings.length === 1 ? '' : 's') + '</span>' : '')));
      if (stale) head.appendChild(el('p', 'msg msg-warning', 'The maps, troops, art, or settings changed since the zones were made. Generate them again to store the new tables.'));
    }
    var row = el('div', 'btn-row');
    row.appendChild(btn(z ? 'Generate again' : 'Generate encounter zones', 'spark', !z || stale ? 'btn-primary' : '', function () { generate(b); }));
    head.appendChild(row);
    host.appendChild(head);
    if (!z) return;
    var all = z.field.concat(z.interior);
    if (ui.editing && !all.some(function (q) { return q.key === ui.editing; })) ui.editing = null;
    var base = ui.editing ? WORLD.zones.base(b) : null;

    if (z.warnings.length) {
      var wp = el('section', 'panel');
      wp.appendChild(el('h3', 'section-h', 'Warnings'));
      wp.appendChild(el('ul', 'w8-lines', z.warnings.map(function (w) { return '<li>' + esc(w.message) + '</li>'; }).join('')));
      host.appendChild(wp);
    }

    // Field zones by chapter.
    var fp = el('section', 'panel');
    fp.id = 'enc-field';
    fp.appendChild(el('h3', 'section-h', 'Overworld zones'));
    var rows = [];
    WORLD.chapters(b).forEach(function (c) {
      z.field.filter(function (q) { return q.chapter === c.id; }).sort(function (a, d) { return d.cells - a.cells || (a.key < d.key ? -1 : 1); }).forEach(function (q) {
        rows.push('<tr data-zone="' + esc(q.key) + '"><th scope="row">' + esc(nameOf(b, q.biome)) + edited(q) + '<small class="w8-sub">' + esc(chName(b, c.id) + ', ' + (c.continentLabel || 'Default')) + '</small></th>' +
          '<td class="num">' + q.cells + '</td><td class="num">' + q.rate + '<small class="w8-sub">' + esc(steps(q.rate)) + '</small></td><td>' + troopsCell(b, q) + '</td>' +
          '<td>' + esc(nameOf(b, q.background) || 'None') + '<small class="w8-sub">' + esc(nameOf(b, q.weather) || 'No weather') + '</small></td>' + editBtn(q) + '</tr>');
      });
    });
    var ft = table(['Zone', { t: 'Cells', num: 1 }, { t: 'Rate', num: 1 }, 'Troops', 'Background and weather', { t: 'Edit', sr: 1 }], rows);
    wire(b, ft, z.field, base);
    fp.appendChild(ft);
    host.appendChild(fp);

    // Interior zones.
    var ip = el('section', 'panel');
    ip.id = 'enc-interior';
    ip.appendChild(el('h3', 'section-h', 'Dungeon, castle, and cave floors'));
    var it = table(['Floor', { t: 'Cells', num: 1 }, { t: 'Rate', num: 1 }, 'Troops', 'Background', { t: 'Edit', sr: 1 }], z.interior.map(function (q) {
      var m = WORLD.records.get(q.map, b);
      return '<tr data-zone="' + esc(q.key) + '"><th scope="row">' + esc(m ? m.name : q.map) + edited(q) + '<small class="w8-sub">' + esc(chName(b, q.chapter)) + '</small></th><td class="num">' + q.cells + '</td>' +
        '<td class="num">' + q.rate + '<small class="w8-sub">' + esc(steps(q.rate)) + '</small></td><td>' + troopsCell(b, q) + '</td><td>' + esc(nameOf(b, q.background) || 'None') + '</td>' + editBtn(q) + '</tr>';
    }));
    wire(b, it, z.interior, base);
    ip.appendChild(it);
    host.appendChild(ip);

    // Bosses and guardians.
    var bp = el('section', 'panel');
    bp.id = 'enc-bosses';
    bp.appendChild(el('h3', 'section-h', 'Bosses and guardians'));
    bp.appendChild(table(['Where', 'Troop', 'Role'], z.bosses.map(function (x) {
      var m = WORLD.records.get(x.map, b);
      return '<tr><th scope="row">' + esc(m ? m.name : x.map) + '<small class="w8-sub">' + esc(chName(b, x.chapter) + (x.at ? ', cell ' + x.at.join(',') : '')) + '</small></th>' +
        '<td>' + (x.troop ? esc(nameOf(b, x.troop)) : '<span class="chip chip-warning">Empty slot for Day 149</span>') + '</td><td>' + esc(x.role === 'guardian' ? 'Guards the ' + (x.guards === 'cave' ? 'cave treasure' : 'prize chest') : x.finale ? 'Final boss' : 'Chapter boss') + '</td></tr>';
    })));
    host.appendChild(bp);

    // Side quest givers.
    var quests = (b.rules && b.rules.sdq_) || {}, qids = Object.keys(quests).sort();
    if (qids.length) {
      var qp = el('section', 'panel');
      qp.id = 'enc-givers';
      qp.appendChild(el('h3', 'section-h', 'Side quest givers'));
      qp.appendChild(table(['Quest', 'Giver', 'Set by'], qids.map(function (id) {
        var q = quests[id], p = q.giver && WORLD.records.get(q.giver, b);
        return '<tr><th scope="row">' + esc(q.name || id) + '<small class="w8-sub">' + esc(chName(b, q.chapter)) + '</small></th><td>' + (p ? esc(p.name) : '<span class="chip chip-warning">No giver</span>') + '</td>' +
          '<td>' + esc(!q.giver ? 'Nobody yet' : z.givers[id] === q.giver ? 'World Forge' : 'Kept as set') + '</td></tr>';
      })));
      host.appendChild(qp);
    }
  }

  WORLD.WS = WORLD.WS || {};
  WORLD.WS.encounters = { render: render };
  WORLD.encountersUi = ui;
})();
// === WS:ENCOUNTERS END ===
