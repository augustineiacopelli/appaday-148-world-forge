// === WS:VALIDATION BEGIN ===
(function () {
  'use strict';
  // The Validation tab. Phase 6: one pass or fail card per check (references, progression, map flags, encounter zones,
  // generation, records), each item with a Jump button, then the progression walk chapter by chapter and what the flag
  // check read. Phase 7 polish: a row of jump links to the six cards with their status, failing cards first, Show all
  // in place of a pointer to the panel, Show on map for any problem that names a cell (the World tab or the Sites tab
  // centers on it and picks it), a Show button per chapter of the walk with why a chapter failed, and a way on to
  // Export once the world is ready. Everything here reads Kit.validate and WORLD.checks, so it never disagrees with the
  // badge or the Final gate.
  var U = Kit.util, el = U.el, esc = U.esc;
  function cur() { return Kit.bundle.current(); }
  var SHOW = 8, ui = { open: {} };
  var CARDS = [
    { key: 'refs', title: 'References', lead: 'Every chapter, troop, biome, tileset, interior kind, battle background, music role, weather state, and person sprite the world names exists.' },
    { key: 'progression', title: 'Progression', lead: 'Each chapter, walking with only the keys earlier chapters gave, reaches all of its sites, and nothing of a later chapter opens early.' },
    { key: 'flags', title: 'Map flags', lead: 'Every tile resolves in the art and blocks, opens, or triggers the way play needs.' },
    { key: 'zones', title: 'Encounter zones', lead: 'Every zone and boss is current; a zone with no troops never starts a battle.' },
    { key: 'generation', title: 'Generation', lead: 'Progression, overworld, interiors, and zones exist and are current, so the records match what the seed regenerates.' },
    { key: 'records', title: 'Records', lead: 'The bundle\'s own record checks: shapes, IDs, envelopes, and references across forges.' }
  ];
  // Which card an item belongs to: Phase 6 items carry check; earlier validators are known by their field.
  function cardOf(it) {
    if (it.check === 'refs' || it.check === 'progression' || it.check === 'flags') return it.check;
    var f = String(it.fieldPath || '');
    if (f === 'zones') return 'zones';
    if (f === 'progression') return /changed after|Lay it out again/.test(it.message) ? 'generation' : 'progression';
    if (f === 'interiors' || f === 'paramHash') return 'generation';
    return 'records';
  }
  function jumpBtn(it) {
    if (!Kit.jump.can(it.recordId)) return null;
    var j = el('button', 'btn btn-ghost w8-jump', Kit.icon('jump') + '<span>Jump</span>');
    j.type = 'button';
    j.setAttribute('aria-label', 'Jump to ' + it.recordId);
    j.addEventListener('click', function () { Kit.jump(it.recordId, it.fieldPath); });
    return j;
  }
  function mapBtn(it) {
    if (it.at == null || !(it.check === 'flags' || it.check === 'progression') || !WORLD.showAt) return null;
    var m = el('button', 'btn btn-ghost w8-jump w8-onmap', '<span>Show on map</span>');
    m.type = 'button';
    m.addEventListener('click', function () { WORLD.showAt(it.map || null, it.at); });
    return m;
  }
  function itemRow(it) {
    var row = el('li', 'w8-vitem', '<span class="chip chip-' + esc(it.level) + '">' + esc(it.level) + '</span><span class="w8-vmsg">' + esc(it.message) + '</span>');
    var m = mapBtn(it), j = jumpBtn(it);
    if (m) row.appendChild(m);
    if (j) row.appendChild(j);
    return row;
  }
  function stateOf(items, waiting) {
    if (items.some(function (x) { return x.level === 'error' || x.level === 'broken'; })) return 'fail';
    if (waiting && !items.length) return 'wait';
    return items.length ? 'warn' : 'pass';
  }
  var RANK = { fail: 0, warn: 1, pass: 2, wait: 3 }, WORD = { fail: 'Fail', warn: 'Pass with warnings', pass: 'Pass', wait: 'Waiting' };
  function statusChip(items, waiting) {
    var bad = items.filter(function (x) { return x.level === 'error' || x.level === 'broken'; }).length, warn = items.filter(function (x) { return x.level === 'warning'; }).length;
    if (waiting && !items.length) return '<span class="chip chip-muted">Waiting</span>';
    if (bad) return '<span class="chip chip-error">Fail: ' + bad + '</span>' + (warn ? '<span class="chip chip-warning">' + warn + ' warn</span>' : '');
    return '<span class="chip chip-ok">' + Kit.icon('check') + 'Pass</span>' + (warn ? '<span class="chip chip-warning">' + warn + ' warn</span>' : '');
  }

  function render(host) {
    var b = cur();
    WORLD.ensure(b);
    var res = Kit.refreshValidation(), s = Kit.validate.summary(res), st = WORLD.checks.state(b), why = WORLD.finalBlock(b);
    var head = el('section', 'panel');
    head.innerHTML = '<h2 class="panel-title">Validation</h2><p class="muted">Before a Final export the world must prove itself: its references resolve, every chapter can be played in order with only the keys the chapters before it gave (the ship sails the sea, the airship lands on open ground, and every site still needs its own chapter key), every map reads the right tile flags, and everything is current. Errors and broken references block a Final export; warnings never do; drafts can always be exported.</p>' +
      '<p class="w8-chips"><span class="chip chip-error">' + s.errors + ' errors</span><span class="chip chip-broken">' + s.broken + ' broken</span><span class="chip chip-warning">' + s.warnings + ' warnings</span><span class="chip chip-forward">' + s.forward + ' forward</span></p>';
    head.appendChild(el('p', 'msg ' + (why ? 'msg-error' : 'w8-msg-ok'), esc(why || 'Ready for a Final export: every check passes and the world is current.')));
    var row = el('div', 'btn-row');
    row.appendChild(WORLD.ui.button('Check again', 'check', why ? 'btn-primary' : '', function () { Kit.rerender(); Kit.ui.toast('Checks run again.', 'ok'); }));
    if (!why) row.appendChild(WORLD.ui.button('Go to Export', 'export', 'btn-primary', function () { Kit.go('export'); }));
    row.appendChild(WORLD.ui.button('Open the validation panel', null, '', function () { Kit.openValidation(); }));
    head.appendChild(row);
    host.appendChild(head);

    var items = res.errors.concat(res.broken, res.warnings), by = {};
    CARDS.forEach(function (c) { by[c.key] = []; });
    items.forEach(function (it) { by[cardOf(it)].push(it); });
    var waiting = { refs: !WORLD.count(b), progression: !st.owFresh, flags: !st.owFresh, zones: !st.zones, generation: !st.generated, records: false };
    var states = {};
    CARDS.forEach(function (c) { states[c.key] = stateOf(by[c.key], waiting[c.key]); });
    // Jump links to the cards, in their usual order, each saying how its check stands.
    var nav = el('nav', 'w8-vnav');
    nav.setAttribute('aria-label', 'Checks');
    CARDS.forEach(function (c) {
      var bad = by[c.key].filter(function (x) { return x.level === 'error' || x.level === 'broken'; }).length;
      var a = el('a', 'w8-vpill w8-v-' + states[c.key], '<span class="w8-vpill-t">' + esc(c.title) + '</span><span class="w8-vpill-s">' + esc(states[c.key] === 'fail' ? 'Fail: ' + bad : WORD[states[c.key]]) + '</span>');
      a.href = '#w8v-' + c.key;
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var t = document.getElementById('w8v-' + c.key);
        if (t) { if (t.scrollIntoView) t.scrollIntoView({ block: 'start', behavior: 'smooth' }); t.focus({ preventScroll: true }); }
      });
      nav.appendChild(a);
    });
    host.appendChild(nav);
    var grid = el('div', 'grid-cards w8-grid w8-vcards');
    CARDS.slice().sort(function (a, c) { return RANK[states[a.key]] - RANK[states[c.key]] || CARDS.indexOf(a) - CARDS.indexOf(c); }).forEach(function (c) {
      var list = by[c.key], card = el('section', 'card w8-vcard w8-v-' + states[c.key], '<h3 class="section-h">' + esc(c.title) + '</h3><p class="w8-chips">' + statusChip(list, waiting[c.key]) + '</p><p class="muted w8-vlead">' + esc(c.lead) + '</p>');
      card.dataset.check = c.key;
      card.id = 'w8v-' + c.key;
      card.tabIndex = -1;
      if (list.length) {
        var ul = el('ul', 'w8-vlist'), all = !!ui.open[c.key];
        list.slice(0, all ? list.length : SHOW).forEach(function (it) { ul.appendChild(itemRow(it)); });
        card.appendChild(ul);
        if (list.length > SHOW) card.appendChild(WORLD.ui.button(all ? 'Show fewer' : 'Show all ' + list.length, null, 'w8-vmore', function () { ui.open[c.key] = !all; Kit.rerender(); var t = document.getElementById('w8v-' + c.key); if (t && t.scrollIntoView) t.scrollIntoView({ block: 'nearest' }); }));
      } else if (waiting[c.key]) {
        card.appendChild(el('p', 'muted', c.key === 'zones' ? 'Generate the encounter zones on the Encounters tab.' : c.key === 'refs' ? 'Nothing to check until the world has records.' : 'Generate the world (and keep it current) to run this check.'));
      }
      grid.appendChild(card);
    });
    host.appendChild(grid);

    var w = WORLD.checks.walks(b);
    if (!w) return;
    var P = w.progression, pp = el('section', 'panel w8-walk');
    pp.innerHTML = '<h2 class="panel-title">The walk, chapter by chapter</h2><p class="muted">A flood fill from the start, once per chapter, holding what the chapters before it granted.' +
      (w.interiors ? ' Inside every site, the key chest comes before the locked door and the seal or the boss waits behind it.' : ' The interiors are not current, so only the overworld was walked.') + '</p>';
    var rows = P.chapters.map(function (c) {
      var ch = WORLD.chapters(b).filter(function (x) { return x.id === c.chapter; })[0], name = ch ? ch.name || c.chapter : c.chapter;
      var keys = c.held.filter(function (k) { return /^chapter:/.test(k); }).length, seals = c.held.filter(function (k) { return /^item:seal:/.test(k); }).length;
      var hold = '<span class="chip chip-muted">' + keys + ' chapter key' + (keys === 1 ? '' : 's') + '</span>' + (seals ? '<span class="chip chip-muted">' + seals + ' seal' + (seals === 1 ? '' : 's') + '</span>' : '') +
        (c.ship ? '<span class="chip chip-accent">Ship</span>' : '') + (c.airship ? '<span class="chip chip-accent">Airship</span>' : '');
      var okSites = c.sites.filter(function (x) { return x.ok; }).length, lock = c.lock;
      var lockTxt = !lock ? 'None' : lock.shut && lock.opens ? 'Shut, opens with the seal' : !lock.shut ? 'Opens early' : 'Stays shut';
      var whys = [];
      c.sites.forEach(function (x) { if (!x.ok) (x.why || []).forEach(function (m) { whys.push(m); }); });
      return '<tr data-chapter="' + esc(c.chapter) + '"><th scope="row">' + esc(name) + '</th><td><span class="w8-chips w8-tight">' + hold + '</span></td><td class="num">' + okSites + ' of ' + c.sites.length + '</td><td>' + esc(lockTxt) + '</td><td>' + (c.sealed ? 'Yes' : '<span class="chip chip-error">No</span>') + '</td><td>' +
        (c.ok ? '<span class="chip chip-ok">' + Kit.icon('check') + 'Pass</span>' : '<span class="chip chip-error">Fail</span>' + (whys.length ? '<small class="w8-sub w8-why">' + esc(whys.slice(0, 3).join(' ')) + '</small>' : '')) + '</td><td class="w8-zcell"></td></tr>';
    });
    var t = el('table', 'tbl w8-walk-tbl');
    t.innerHTML = '<thead><tr><th scope="col">Chapter</th><th scope="col">Holding</th><th scope="col" class="num">Sites</th><th scope="col">Boss lock</th><th scope="col">Later sealed</th><th scope="col">Result</th><th scope="col"><span class="sr-only">Show</span></th></tr></thead><tbody>' + rows.join('') + '</tbody>';
    // A Show button per chapter centers the World tab on where that chapter's region starts.
    var owRec = WORLD.overworld.record(b);
    Array.prototype.forEach.call(t.querySelectorAll('tbody tr'), function (tr) {
      var reg = owRec && (owRec.regions || []).filter(function (r) { return r.chapter === tr.dataset.chapter; })[0];
      if (!reg || !reg.anchor || !WORLD.showAt) return;
      var x = el('button', 'btn w8-pick', 'Show');
      x.type = 'button'; x.setAttribute('aria-label', 'Show this chapter\'s region on the map');
      x.addEventListener('click', function () { WORLD.showAt(null, reg.anchor.slice()); });
      tr.lastChild.appendChild(x);
    });
    var wrap = el('div', 'tbl-wrap'); wrap.appendChild(t); pp.appendChild(wrap);
    var fs = w.flags.stats;
    pp.appendChild(el('p', 'muted w8-flagstats', 'The flag check read ' + fs.cells + ' cells on ' + fs.maps + ' maps: ' + fs.walls + ' walls and ridges, ' + fs.doors + ' doors, ' + fs.counters + ' counters, and ' + fs.floors + ' floor cells, in ' + w.ms.flags + ' ms; the walk took ' + w.ms.progression + ' ms.'));
    host.appendChild(pp);
  }

  WORLD.WS = WORLD.WS || {};
  WORLD.WS.validation = { render: render };
})();
// === WS:VALIDATION END ===
