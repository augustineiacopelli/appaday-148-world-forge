// === WORLD:GENERATE BEGIN ===
(function () {
  'use strict';
  // Turns the engine's generators into world records. Phase 2: the progression graph becomes one reg_ per chapter and a
  // twn_ or dgn_ per site, and the graph itself is kept in world.progression (node.record names each site's record).
  // Record IDs come from structural keys, so laying the graph out again rewrites the same IDs. A record whose origin is
  // 'user' is never overwritten; a generated record whose key the new graph no longer has is removed.
  var U = Kit.util, PG = ENGINE_WORLD.progression;
  var ROLE_NAMES = { start: 'Start town', town: 'Second town', key: 'Key dungeon', boss: 'Boss dungeon', cave: 'Cave' };
  var PREFIX_OF = { twn: 'twn_', dgn: 'dgn_' };
  function cur() { return Kit.bundle.current(); }

  // The engine reads plain data, never the bundle: chapters in Charter order with their continent slug and boss troops.
  function spec(b) {
    var bossBy = {};
    WORLD.bossTroops(b).forEach(function (t) { if (t.chapter) (bossBy[t.chapter] = bossBy[t.chapter] || []).push(t.id); });
    return {
      chapters: WORLD.chapters(b).map(function (c) {
        return { chapter: c.id, name: c.name || c.id, continent: WORLD.continentSlug(c), label: (c.continentLabel || '').trim() || 'Default',
          minutes: Number(c.targetMinutes) || 60, bosses: (bossBy[c.id] || []).slice().sort() };
      })
    };
  }
  function roleName(n, chName) {
    var base = n.role.replace(/\d+$/, ''), num = n.role.slice(base.length);
    var label = n.role === 'boss' && n.interior === 'castle' ? 'Castle' : ROLE_NAMES[base] || n.role;
    return chName + ': ' + label + (num ? ' ' + num : '');
  }
  function sameKeys(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  WORLD.progression = {
    spec: spec,
    // The graph the current Charter would produce, without writing anything.
    preview: function (b) { b = b || cur(); WORLD.ensure(b); return PG.build(spec(b), b.world.settings); },
    graph: function (b) { b = b || cur(); var g = b && b.world && b.world.progression; return U.isObj(g) && Array.isArray(g.nodes) ? g : null; },
    // True when the Charter or settings have changed since the graph was laid out.
    stale: function (b) { b = b || cur(); var g = WORLD.progression.graph(b); return !!g && g.digest !== WORLD.progression.preview(b).digest; },
    apply: function (b) {
      b = b || cur();
      WORLD.ensure(b);
      var g = PG.build(spec(b), b.world.settings), problems = PG.check(g);
      if (problems.length) throw new Error('The progression graph is not solvable: ' + problems[0].message);
      var chName = {}, made = {}, kept = [], written = 0, removed = 0, regId = {};
      spec(b).chapters.forEach(function (c) { chName[c.chapter] = c.name; });
      WORLD.batching = true;
      try {
        function put(rec) {
          var old = WORLD.records.get(rec.id, b);
          made[rec.id] = 1;
          if (old && old.origin === 'user') { kept.push(rec.id); return old; }
          WORLD.records.put(rec, b); written++;
          return rec;
        }
        g.regions.forEach(function (r) { regId[r.key] = ENGINE_WORLD.ids.structural('reg_', r.key); });
        g.nodes.forEach(function (n) {
          if (n.kind === 'gate') return;
          var rec = WORLD.envelope(PREFIX_OF[n.kind], n.key, roleName(n, chName[n.chapter]), {
            chapter: n.chapter, continent: n.continent, region: regId[n.region], role: n.role, golden: n.golden, optional: n.optional,
            interior: n.interior, requires: n.requires.slice(), grants: n.grants.slice(), order: n.index
          });
          if (n.role === 'boss') { rec.troop = n.troop; rec.spareBosses = (n.spareBosses || []).slice(); rec.finale = !!n.finale; }
          n.record = put(rec).id;
        });
        g.nodes.forEach(function (n) { if (n.kind === 'gate') n.regionRecord = regId[n.region]; });
        g.regions.forEach(function (r) {
          var exit = g.gates.filter(function (x) { return x.from === r.key; })[0] || null;
          var sites = g.nodes.filter(function (n) { return n.region === r.key && n.record; }).map(function (n) { return n.record; });
          var rec = WORLD.envelope('reg_', r.key, r.label + ': ' + chName[r.chapter], {
            chapter: r.chapter, continent: r.continent, continentLabel: r.label, part: r.part, entry: r.entry, order: r.index,
            sites: sites, next: exit ? regId[exit.to] : null, exitGate: exit ? { gate: exit.key, kind: exit.kind, requires: exit.requires.slice() } : null
          });
          r.record = put(rec).id;
        });
        // Generated twn_, dgn_, and reg_ records the graph no longer holds are removed; user records stay.
        ['reg_', 'twn_', 'dgn_'].forEach(function (p) {
          WORLD.records.list(p, b).forEach(function (rec) {
            if (!made[rec.id] && rec.origin !== 'user') { WORLD.records.del(rec.id, b); removed++; }
          });
        });
      } finally { WORLD.batching = false; }
      var old = WORLD.progression.graph(b), changed = !old || !sameKeys(old, g) || written > 0 || removed > 0;
      b.world.progression = g;
      if (b === cur()) { Kit.index.invalidate(); if (changed) Kit.bundle.touch('progression'); }
      return { graph: g, written: written, removed: removed, kept: kept, warnings: g.warnings.slice() };
    }
  };

  // Graph level checks (Phase 6 adds the geometric ones). Only runs once a graph has been laid out.
  Kit.validate.register('world.graph', function (b, ctx) {
    var g = WORLD.progression.graph(b);
    if (!g) return;
    PG.check(g).forEach(function (p) { ctx.add({ recordId: 'world', fieldPath: 'progression', message: p.message, level: 'error' }); });
    g.warnings.forEach(function (w) { ctx.add({ recordId: 'world', fieldPath: 'progression', message: w.message, level: 'warning' }); });
    if (WORLD.progression.stale(b)) ctx.add({ recordId: 'world', fieldPath: 'progression', message: 'The Charter\'s chapters or the progression settings changed after the graph was laid out. Lay it out again on the Start tab.', level: 'warning' });
    g.nodes.forEach(function (n) { if (n.record && !WORLD.records.get(n.record, b)) ctx.add({ recordId: 'world', fieldPath: 'progression', message: 'Site ' + n.record + ' is missing from the world records.', level: 'error' }); });
  });
})();
// === WORLD:GENERATE END ===
