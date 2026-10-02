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

  // ---------------------------------------------------------------- the overworld (Phase 3)
  // The map itself is not stored: it regenerates from the seed, settings, graph, and art (the optional bake of Phase 8
  // stores it). The map_ record holds what Days 149 and 150 reference: where each site and gate is, where play starts,
  // and the hash of everything the map was made from, so a stale map is caught.
  var OWE = ENGINE_WORLD.overworld, memo = null;
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    return JSON.stringify(v);
  }
  function palette(b) { return OWE.palette(b.art, ENGINE_WORLD.climate.table(b.art, ENGINE_RENDER)); }
  function minutesOf(b) { var m = {}; WORLD.chapters(b).forEach(function (c) { m[c.id] = Number(c.targetMinutes) || 60; }); return m; }
  function settingsForHash(b) { var s = U.clone(b.world.settings || {}); delete s.bake; return s; }
  // Painted cells (Phase 7): world.overrides.cells {'x,y': biome tileset ID}, sparse, applied by the engine after the
  // map is built. They join the hash only when there are any, so a world nobody painted keeps the hash it always had.
  function paintCells(b) { var o = b.world && b.world.overrides; return o && U.isObj(o.cells) ? o.cells : {}; }
  function paramHash(b, g, pal) {
    var parts = [ENGINE_WORLD.version, b.world.seed, canon(settingsForHash(b)), g ? g.digest : '-', pal.digest, canon(minutesOf(b))], pc = paintCells(b);
    if (Object.keys(pc).length) parts.push('paint', canon(pc));
    return ENGINE_WORLD.util.digest(parts);
  }
  function owSpec(b, g, pal) { return { seed: b.world.seed, settings: b.world.settings, graph: g, minutes: minutesOf(b), palette: pal, paint: paintCells(b) }; }
  function xy(i, w) { return i == null || i < 0 ? null : [i % w, Math.floor(i / w)]; }
  function overworldRecord(b) { return WORLD.records.list('map_', b).filter(function (m) { return m.kind === 'overworld'; })[0] || null; }

  // The Web Worker (Phase 7). Measured in Chromium at a 4x CPU slowdown, the overworld takes 190 to 330 ms for the demo
  // and 550 to 780 ms for the four continent fixture, over the 100 ms bar, so interactive builds run off the main
  // thread. DECISION: the worker is a Blob of this page's own ENGINE:WORLD fence (WORLD.engines.source(), the very bytes
  // the export writes as engine-world.js) plus a few lines that call overworld.build, rather than importScripts of the
  // file, so it works offline and from a file:// page and can never drift from the engine in the page. A newer request
  // replaces a running one (the old promise resolves null). Where no worker can start (jsdom, a strict CSP) everything
  // runs on the main thread as before, and the synchronous generate stays the one authority the validators use.
  var WORKER_TAIL = '\nself.onmessage = function (e) { var d = e.data; try { var t0 = Date.now(), ow = ENGINE_WORLD.overworld.build(d.spec); ow.ms = Date.now() - t0; self.postMessage({ hash: d.hash, ow: ow }); }' +
    ' catch (err) { self.postMessage({ hash: d.hash, error: String(err && err.message || err) }); } };\n';
  var wk = { worker: null, broken: false, url: null, job: null, made: 0, served: 0 };
  function killWorker() { if (wk.worker) { try { wk.worker.terminate(); } catch (e) { /* gone */ } } wk.worker = null; }
  function startWorker() {
    if (wk.worker || wk.broken) return wk.worker;
    try {
      if (typeof Worker !== 'function' || typeof Blob !== 'function' || typeof URL === 'undefined' || !URL.createObjectURL) throw new Error('No Web Worker here.');
      var src = WORLD.engines && WORLD.engines.source();
      if (!src) throw new Error('The ENGINE:WORLD fence was not found in the page.');
      if (!wk.url) wk.url = URL.createObjectURL(new Blob([src + WORKER_TAIL], { type: 'text/javascript' }));
      var w = new Worker(wk.url);
      w.onmessage = function (e) {
        var d = e.data || {}, job = wk.job;
        if (!job || job.hash !== d.hash) return;
        wk.job = null;
        if (d.error || !d.ow) { job.done(syncFor(job)); return; }
        var ow = d.ow;
        ow.paramHash = job.hash; ow.palette = job.pal;
        memo = { hash: job.hash, ow: ow };
        wk.served++;
        job.done(ow);
      };
      w.onerror = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        wk.broken = true; killWorker();
        var job = wk.job; wk.job = null;
        if (job) job.done(syncFor(job));
      };
      wk.worker = w; wk.made++;
    } catch (e) { wk.broken = true; wk.worker = null; }
    return wk.worker;
  }
  // The main thread fallback for a job: only when its hash is still the bundle's, so a superseded job never builds.
  function syncFor(job) {
    var b = job.b;
    try { return WORLD.overworld.paramHash(b) === job.hash ? WORLD.overworld.generate(b) : null; } catch (e) { return null; }
  }

  WORLD.overworld = {
    record: overworldRecord,
    // The hash of what the current bundle would generate from (seed, settings, graph, art, chapter minutes, engine).
    paramHash: function (b) { b = b || cur(); WORLD.ensure(b); return paramHash(b, WORLD.progression.graph(b), palette(b)); },
    // Builds (or returns the cached) overworld for the current graph. Null until a graph exists.
    generate: function (b) {
      b = b || cur();
      WORLD.ensure(b);
      var g = WORLD.progression.graph(b);
      if (!g) return null;
      var pal = palette(b), hash = paramHash(b, g, pal);
      if (memo && memo.hash === hash) return memo.ow;
      var t0 = Date.now(), ow = OWE.build(owSpec(b, g, pal));
      ow.ms = Date.now() - t0; ow.paramHash = hash; ow.palette = pal;
      memo = { hash: hash, ow: ow };
      return ow;
    },
    // True when generate would answer at once (the map for the current hash is already built).
    ready: function (b) {
      b = b || cur();
      if (!memo || !WORLD.progression.graph(b)) return false;
      return memo.hash === WORLD.overworld.paramHash(b);
    },
    // True when builds run in the Web Worker.
    async: function () { return !!startWorker(); },
    worker: function () { return { running: !!wk.worker, broken: wk.broken, made: wk.made, served: wk.served, busy: !!wk.job }; },
    // Builds the current map off the main thread and fills the same cache generate reads. Resolves the map, or null when
    // a newer request replaced this one. Without a worker it builds here.
    prefetch: function (b) {
      b = b || cur();
      WORLD.ensure(b);
      var g = WORLD.progression.graph(b);
      if (!g) return Promise.resolve(null);
      var pal = palette(b), hash = paramHash(b, g, pal);
      if (memo && memo.hash === hash) return Promise.resolve(memo.ow);
      if (wk.job && wk.job.hash === hash) return wk.job.p;
      var w = startWorker();
      if (!w) { try { return Promise.resolve(WORLD.overworld.generate(b)); } catch (e) { return Promise.reject(e); } }
      if (wk.job) {
        // A newer map is wanted: stop the running build and start again.
        var old = wk.job; wk.job = null; killWorker(); old.done(null);
        w = startWorker();
        if (!w) return Promise.resolve(WORLD.overworld.generate(b));
      }
      var job = { hash: hash, b: b, pal: pal };
      job.p = new Promise(function (res) { job.done = res; });
      wk.job = job;
      w.postMessage({ hash: hash, spec: owSpec(b, g, pal) });
      return job.p;
    },
    // Painted cells: world.overrides.cells. paint(b, x, y, biome) stores one (biome null clears it) when the engine
    // accepts it on the current map, and refuses with the engine's reason otherwise (a ridge, gate, site, water, or a
    // cell whose new ground would break the walk). The cached map is updated in place, so nothing is rebuilt.
    paintCells: function (b) { return U.clone(paintCells(b || cur())); },
    paint: function (b, x, y, biome) {
      b = b || cur();
      WORLD.ensure(b);
      var ow = WORLD.overworld.generate(b), g = WORLD.progression.graph(b);
      if (!ow || !g) return { ok: false, message: 'Generate the overworld first.' };
      var base = ow.unpainted || ow, cells = U.clone(paintCells(b)), k = x + ',' + y;
      if (biome) cells[k] = biome; else if (cells[k]) delete cells[k]; else return { ok: true, ow: ow, changed: false };
      // Cells apply in sorted order, so the cell refused may be an earlier one; any cell that applied before and would
      // not now refuses the new paint, so a paint never silently undoes another.
      var out = OWE.paint(base, cells, g), was = {};
      (ow.skipped || []).forEach(function (s) { was[String(s.at)] = 1; });
      var miss = biome && (out.skipped || []).filter(function (s) { return !was[String(s.at)]; })[0];
      if (miss) {
        var mine = Array.isArray(miss.at) && miss.at[0] === x && miss.at[1] === y;
        return { ok: false, code: miss.code, message: mine ? miss.message : 'Painting cell ' + k + ' with ' + biome + ' would break the walk together with the cells already painted (cell ' + miss.at.join(',') + ' would no longer apply).' };
      }
      if (!base.ok) return { ok: false, code: 'not-ok', message: 'The overworld failed its own checks, so it cannot be painted.' };
      b.world.overrides = U.isObj(b.world.overrides) ? b.world.overrides : {};
      if (Object.keys(cells).length) b.world.overrides.cells = cells; else delete b.world.overrides.cells;
      out.ms = base.ms; out.palette = ow.palette; out.paramHash = WORLD.overworld.paramHash(b);
      memo = { hash: out.paramHash, ow: out };
      if (b === cur()) Kit.bundle.touch('paint');
      return { ok: true, ow: out, changed: true };
    },
    // Clears every painted cell.
    unpaint: function (b) {
      b = b || cur();
      var n = Object.keys(paintCells(b)).length;
      if (!n) return 0;
      delete b.world.overrides.cells;
      if (b === cur()) Kit.bundle.touch('paint');
      return n;
    },
    // True when the stored map was made from something other than what the bundle holds now.
    stale: function (b) {
      b = b || cur();
      var rec = overworldRecord(b);
      return !!(rec && rec.paramHash) && rec.paramHash !== WORLD.overworld.paramHash(b);
    },
    // Lays out the progression first when it is missing or stale, generates, and writes the map_ record. Refuses a map
    // that failed its own checks, naming the first problem.
    apply: function (b) {
      b = b || cur();
      WORLD.ensure(b);
      if (!WORLD.progression.graph(b) || WORLD.progression.stale(b)) WORLD.progression.apply(b);
      var g = WORLD.progression.graph(b), ow = WORLD.overworld.generate(b);
      if (!ow.ok) throw new Error('The overworld could not be generated after ' + ow.attempts + ' attempts: ' + ow.problems[0].message);
      var regId = {}, w = ow.w;
      g.regions.forEach(function (r) { regId[r.key] = r.record || ENGINE_WORLD.ids.structural('reg_', r.key); });
      var counts = {}, land = 0, seaN = 0, lake = 0;
      for (var i = 0; i < ow.ground.length; i++) {
        if (ow.owner[i] >= 0) land++; else if (ow.sea[i]) seaN++; else lake++;
        var gr = String(ow.ground[i]).split(':')[0];
        if (ow.ground[i] && String(ow.ground[i]).indexOf(':') < 0) counts[gr] = (counts[gr] || 0) + 1;
      }
      var rec = WORLD.envelope('map_', 'map|overworld', 'Overworld', {
        kind: 'overworld', w: ow.w, h: ow.h, seed: b.world.seed, generatorVersion: ENGINE_WORLD.version, paramHash: ow.paramHash, digest: ow.digest, attempts: ow.attempts,
        start: xy(ow.start, w),
        continents: ow.continents.map(function (c) { return { continent: c.slug, label: c.label, center: [Math.round(c.x), Math.round(c.y)], radius: Math.round(c.r * 10) / 10, cells: c.cells, regions: c.regions.map(function (k) { return regId[k]; }) }; }),
        regions: ow.regions.map(function (r) { return { region: regId[r.key], chapter: r.chapter, continent: r.continent, entry: r.entry, ringed: r.ringed, cells: r.cells, anchor: xy(r.anchor, w) }; }),
        sites: ow.sites.map(function (s2) {
          var o = { site: s2.record, key: s2.key, kind: s2.kind, role: s2.role, chapter: s2.chapter, region: regId[s2.region], interior: s2.interior, stamp: s2.stamp,
            rect: [s2.x, s2.y, s2.w, s2.h], entrance: xy(s2.entrance, w), front: xy(s2.front, w) };
          if (s2.approach != null) o.approach = xy(s2.approach, w);
          return o;
        }),
        gates: ow.gates.map(function (gq) { return { key: gq.key, gate: gq.gate, kind: gq.kind, requires: gq.requires.slice(), region: regId[gq.region], from: gq.from ? regId[gq.from] : null, cells: gq.cells.map(function (c) { return xy(c, w); }) }; }),
        stats: { land: land, sea: seaN, lake: lake, biomes: Object.keys(counts).sort(function (a, c) { return counts[c] - counts[a] || (a < c ? -1 : 1); }).map(function (k) { return { biome: k, cells: counts[k] }; }) }
      });
      // Painted cells (Phase 7) are named only when there are any, so an unpainted record is unchanged.
      if (ow.painted || ow.skipped) rec.paint = { cells: (ow.painted || []).length, skipped: (ow.skipped || []).map(function (s) { return { at: s.at, biome: s.biome, code: s.code, message: s.message }; }) };
      var old = WORLD.records.get(rec.id, b);
      if (old && old.origin === 'user') return { ow: ow, record: old, kept: true };
      WORLD.records.put(rec, b);
      if (b.world.generator) b.world.generator.version = ENGINE_WORLD.version;
      if (b === cur()) { Kit.index.invalidate(); Kit.bundle.touch('overworld'); }
      return { ow: ow, record: rec, kept: false };
    },
    // Cell index helpers for the interface.
    xy: xy
  };

  Kit.validate.register('world.overworld', function (b, ctx) {
    var rec = overworldRecord(b);
    if (!rec || !rec.paramHash) return;
    if (WORLD.overworld.stale(b)) ctx.add({ recordId: rec.id, fieldPath: 'paramHash', message: 'The seed, settings, chapters, painted cells, or art changed after the overworld was generated. Generate it again on the World tab.', level: 'warning' });
    else if (rec.paint && Array.isArray(rec.paint.skipped)) rec.paint.skipped.forEach(function (s) {
      ctx.add({ recordId: rec.id, fieldPath: 'paint', message: 'A painted cell was not applied: ' + s.message + ' Clear it or paint it again on the World tab.', level: 'warning' });
    });
    // Missing sites and regions are reported by world.refs (Phase 6), the one authority for references.
  });

  // ---------------------------------------------------------------- interiors (Phase 4)
  // Every site on the overworld gets its interior: one map_ per floor (key map|<site key>|<floor>) and one npc_ per person
  // (key npc|<site key>|<slot>). Like the overworld, no tile array is stored; each floor regenerates from its sub seed
  // (hash.seed(master seed, 'interior|' + site key)), the settings, the art, and the biome in front of the site, whose hash
  // the record keeps. Exits link both ways: each floor 1 exit names the overworld map and the cell in front of the site,
  // the overworld record's site entry gains enter {map, at}, stairs name the partner floor and its arrival cell, and the
  // twn_ or dgn_ record lists its maps, its people, and both ends of its entrance.
  var INE = ENGINE_WORLD.interiors, inMemo = {};
  var NPC_NAMES = { inn: 'Innkeeper', 'shop:item': 'Item merchant', 'shop:weapon': 'Weapon merchant', 'shop:armor': 'Armor merchant', church: 'Priest', guard1: 'Gate guard', guard2: 'Gate guard' };
  function inPalette(b) { return INE.palette(b.art); }
  // NPC archetypes the art has field sprites for (Day 147 role npc:<archetype>), and the sprite for each.
  function npcSprites(b) {
    var out = {};
    WORLD.art.list(b, 'spr_').forEach(function (sp) { if (sp.subject && sp.subject.kind === 'role' && /^npc:/.test(sp.subject.ref || '') && !out[sp.subject.ref.slice(4)]) out[sp.subject.ref.slice(4)] = sp.id; });
    return out;
  }
  function inHash(b, sp) {
    return ENGINE_WORLD.util.digest([ENGINE_WORLD.version, sp.seed, canon(b.world.settings && b.world.settings.interiors || {}), sp.key, sp.kind, sp.role, sp.outdoor || '-', sp.palette.digest,
      canon(sp.archetypes), sp.prize || '-', sp.troop || '-', canon(sp.grants || []), !!sp.finale]);
  }
  // The plain spec for every site on the current overworld, in map order.
  function inSpecs(b) {
    var ow = WORLD.overworld.generate(b), g = WORLD.progression.graph(b);
    if (!ow || !g) return [];
    var pal = inPalette(b), arch = Object.keys(npcSprites(b)).sort(), byKey = {};
    g.nodes.forEach(function (nd) { byKey[nd.key] = nd; });
    return ow.sites.map(function (s2) {
      var nd = byKey[s2.key] || {}, gr = ow.ground[s2.front], biome = gr && String(gr).indexOf(':') < 0 ? gr : null;
      var sp = { seed: ENGINE_WORLD.hash.seed(b.world.seed, 'interior|' + s2.key), key: s2.key, kind: s2.interior || (s2.kind === 'twn' ? 'town' : 'dungeon'), role: s2.role,
        settings: b.world.settings, palette: pal, outdoor: biome, archetypes: arch.length ? arch : INE.ARCHETYPES.slice(),
        prize: s2.role === 'key' ? (nd.grants || [])[0] || null : null, troop: nd.troop || null, grants: (nd.grants || []).slice(), finale: !!nd.finale };
      sp.hash = inHash(b, sp);
      sp.site = s2;
      return sp;
    });
  }
  function inGenerate(sp) {
    var m = inMemo[sp.key];
    if (m && m.hash === sp.hash) return m.site;
    var t0 = Date.now(), site = INE.build(sp);
    site.ms = Date.now() - t0;
    inMemo[sp.key] = { hash: sp.hash, site: site };
    return site;
  }
  function mapKey(siteKey, floor) { return 'map|' + siteKey + '|' + floor; }
  function npcKey(siteKey, slot) { return 'npc|' + siteKey + '|' + slot; }
  function npcName(p) {
    if (NPC_NAMES[p.slot]) return NPC_NAMES[p.slot];
    return p.archetype.charAt(0).toUpperCase() + p.archetype.slice(1);
  }
  function interiorMaps(b) { return WORLD.records.list('map_', b).filter(function (m) { return m.kind && m.kind !== 'overworld'; }); }

  WORLD.interiors = {
    palette: inPalette,
    sprites: npcSprites,
    specs: function (b) { b = b || cur(); WORLD.ensure(b); return inSpecs(b); },
    // The built site for one structural site key (memoized by its parameter hash), or null.
    site: function (key, b) { b = b || cur(); var sp = inSpecs(b).filter(function (x) { return x.key === key; })[0]; return sp ? inGenerate(sp) : null; },
    // Every site's spec and built interior in map order (memoized like site), for the Phase 6 checks.
    built: function (b) { b = b || cur(); WORLD.ensure(b); return inSpecs(b).map(function (sp) { return { sp: sp, site: inGenerate(sp) }; }); },
    mapKey: mapKey, npcKey: npcKey,
    maps: interiorMaps,
    generated: function (b) { b = b || cur(); return interiorMaps(b).length > 0; },
    // True when some site's interior was made from something other than what the bundle holds now, or the overworld
    // was generated again since (its site entries lost their links).
    stale: function (b) {
      b = b || cur();
      if (!WORLD.interiors.generated(b)) return false;
      var rec = WORLD.overworld.record(b);
      if (!rec || WORLD.overworld.stale(b)) return true;
      if ((rec.sites || []).some(function (s2) { return !s2.enter || !WORLD.records.get(s2.enter.map, b); })) return true;
      return inSpecs(b).some(function (sp) { var r = WORLD.records.get(ENGINE_WORLD.ids.structural('map_', mapKey(sp.key, 1)), b); return !r || r.paramHash !== sp.hash; });
    },
    // Generates the overworld first when it is missing or stale, then every interior, and writes map_ and npc_ records.
    // Refuses when any site fails its own walking check. User made records are kept; generated map_ (other than the
    // overworld) and npc_ records that no site makes any more are removed.
    apply: function (b) {
      b = b || cur();
      WORLD.ensure(b);
      if (!WORLD.overworld.record(b) || WORLD.overworld.stale(b)) WORLD.overworld.apply(b);
      var ow = WORLD.overworld.generate(b), owRec = WORLD.overworld.record(b), specs = inSpecs(b), t0 = Date.now();
      var built = specs.map(function (sp) { return { sp: sp, site: inGenerate(sp) }; });
      var bad = built.filter(function (x) { return !x.site.ok; })[0];
      if (bad) throw new Error('The interior of ' + bad.sp.key + ' could not be generated after ' + bad.site.attempts + ' attempts: ' + bad.site.problems[0].message);
      var sprites = npcSprites(b), made = {}, kept = [], written = 0, removed = 0, people = 0, floors = 0;
      function put(rec) {
        made[rec.id] = 1;
        var old = WORLD.records.get(rec.id, b);
        if (old && old.origin === 'user') { kept.push(rec.id); return old; }
        WORLD.records.put(rec, b); written++;
        return rec;
      }
      WORLD.batching = true;
      try {
        built.forEach(function (x) {
          var sp = x.sp, site = x.site, s2 = sp.site, siteRec = WORLD.records.get(s2.record, b), base = siteRec ? siteRec.name : s2.key;
          var ids = site.floors.map(function (fl) { return ENGINE_WORLD.ids.structural('map_', mapKey(sp.key, fl.floor)); });
          var npcIds = site.npcs.map(function (p) { return ENGINE_WORLD.ids.structural('npc_', npcKey(sp.key, p.slot)); });
          site.floors.forEach(function (fl, k) {
            var w = fl.w, P = function (i) { return xy(i, w); };
            var exits = fl.exits.map(function (ex) {
              var to;
              if (ex.kind === 'overworld') to = { map: owRec.id, at: xy(s2.front, ow.w) };
              else {
                var other = site.floors[ex.toFloor - 1], partner = other.exits.filter(function (e2) { return e2.toFloor === fl.floor; })[0];
                to = { map: ids[ex.toFloor - 1], at: xy(partner.arrive, other.w) };
              }
              return { kind: ex.kind, at: P(ex.at), arrive: P(ex.arrive), to: to };
            });
            var features = fl.features.map(function (ft) {
              var o = {};
              Object.keys(ft).sort().forEach(function (f) { o[f] = f === 'at' || f === 'opens' ? P(ft[f]) : Array.isArray(ft[f]) ? ft[f].slice() : ft[f]; });
              return o;
            });
            var body = {
              kind: sp.kind, site: s2.record, chapter: s2.chapter, floor: fl.floor, floors: site.floors.length, w: fl.w, h: fl.h, seed: sp.seed,
              generatorVersion: ENGINE_WORLD.version, paramHash: sp.hash, digest: fl.digest, attempts: site.attempts,
              tileset: (sp.palette.sets[sp.kind] || sp.palette.sets.dungeon).til, exits: exits, features: features,
              people: site.npcs.filter(function (p) { return p.floor === fl.floor; }).map(function (p) { return ENGINE_WORLD.ids.structural('npc_', npcKey(sp.key, p.slot)); }),
              stats: JSON.parse(JSON.stringify(fl.stats || {}))
            };
            if (sp.kind === 'town') body.buildings = fl.buildings.map(function (bd) { return { kind: bd.kind, slot: bd.slot, rect: [bd.x, bd.y, bd.w, bd.h], door: P(bd.door) }; });
            else body.rooms = fl.rooms.length;
            if (sp.kind === 'town') { body.outdoor = fl.stats.outdoor; body.path = fl.stats.path; }
            put(WORLD.envelope('map_', mapKey(sp.key, fl.floor), base + (site.floors.length > 1 ? ', floor ' + fl.floor : ''), body));
            floors++;
          });
          site.npcs.forEach(function (p, k) {
            var fl = site.floors[p.floor - 1], w = fl.w;
            put(WORLD.envelope('npc_', npcKey(sp.key, p.slot), base + ': ' + npcName(p), {
              chapter: s2.chapter, site: s2.record, map: ids[p.floor - 1], at: xy(p.at, w), slot: p.slot, archetype: p.archetype, role: p.role,
              sprite: sprites[p.archetype] || null, facing: p.facing, wander: !!p.wander, building: p.building || null, counter: p.counter == null ? null : xy(p.counter, w)
            }));
            people++;
          });
          var f1 = site.floors[0], ent = f1.exits.filter(function (ex) { return ex.kind === 'overworld'; })[0];
          if (siteRec && siteRec.origin !== 'user') {
            siteRec.maps = ids.slice();
            siteRec.people = npcIds.slice();
            siteRec.entrance = { map: ids[0], at: xy(ent.arrive, f1.w) };
            siteRec.overworld = { map: owRec.id, at: xy(s2.front, ow.w) };
            siteRec.interiorHash = sp.hash;
          }
          var oe = (owRec.sites || []).filter(function (o) { return o.key === sp.key; })[0];
          if (oe && owRec.origin !== 'user') oe.enter = { map: ids[0], at: xy(ent.arrive, f1.w) };
        });
        WORLD.records.list('map_', b).forEach(function (rec) { if (rec.kind !== 'overworld' && !made[rec.id] && rec.origin !== 'user') { WORLD.records.del(rec.id, b); removed++; } });
        WORLD.records.list('npc_', b).forEach(function (rec) { if (!made[rec.id] && rec.origin !== 'user') { WORLD.records.del(rec.id, b); removed++; } });
      } finally { WORLD.batching = false; }
      if (b === cur()) { Kit.index.invalidate(); Kit.bundle.touch('interiors'); }
      return { sites: built.length, floors: floors, people: people, written: written, removed: removed, kept: kept, ms: Date.now() - t0 };
    }
  };

  Kit.validate.register('world.interiors', function (b, ctx) {
    var owRec = WORLD.overworld.record(b);
    if (!owRec || !owRec.paramHash) return;
    var maps = interiorMaps(b);
    if (!maps.length) { ctx.add({ recordId: 'world', fieldPath: 'interiors', message: 'The towns, dungeons, and caves have no interiors yet. Generate them on the Sites tab.', level: 'warning' }); return; }
    if (WORLD.interiors.stale(b)) ctx.add({ recordId: 'world', fieldPath: 'interiors', message: 'The overworld, seed, settings, or art changed after the interiors were generated. Generate them again on the Sites tab.', level: 'warning' });
    // Exits, people, sites, maps, and sprites are reference checks: world.refs (Phase 6) reports them, and a person with
    // no field sprite is now an error there, since nothing could draw them.
  });

  // ---------------------------------------------------------------- encounter zones (Phase 5)
  // world.zones holds the encounter tables (no record prefix: zones are data the maps point at by key, not records Day 149
  // references by ID): field zones per continent, chapter, and biome over flag 2 overworld cells, one interior zone per
  // dungeon, castle, and cave floor, boss and guardian encounters, and the sdq_ givers this forge wrote. Like the maps it
  // keeps the hash of what it was made from, so a stale table is caught. Sparse edits live in world.overrides.zones
  // {zone key: {rate, weights {trp_: n}}} and survive every regeneration. Filling sdq_.giver is the one write this forge
  // makes outside world; a giver someone else set (resolving, and not the one this forge last wrote) is kept.
  var ZNE = ENGINE_WORLD.zones, ckMemo = null;
  function zoneData(b) { var z = b && b.world && b.world.zones; return U.isObj(z) && Array.isArray(z.field) ? z : null; }
  function tilesets(b) { return (b.art && b.art.records && b.art.records.til_) || {}; }
  function biomeKeys(b) { var o = {}, t = tilesets(b); Object.keys(t).sort().forEach(function (id) { if (t[id] && t[id].kind === 'biome') o[id] = t[id].key || id; }); return o; }
  function subjectRef(b, tilId) { var t = tilesets(b)[tilId]; return t && t.subject && t.subject.ref || null; }
  function backgrounds(b) {
    var o = {}, recs = (b.art && b.art.records && b.art.records.bgd_) || {};
    Object.keys(recs).sort().forEach(function (id) { var g = recs[id]; if (g && g.subject && g.subject.kind === 'role' && g.subject.ref && !o[g.subject.ref]) o[g.subject.ref] = id; });
    return o;
  }
  function weatherList(b) {
    var w = (b.rules && b.rules.wth_) || {};
    return Object.keys(w).map(function (id) { return { weather: id, name: w[id].name || '', text: w[id].realWorld || '' }; });
  }
  function siteKeyOfMap(m) { return String(m.key || '').replace(/^map\|/, '').replace(/\|\d+$/, ''); }
  function znSpec(b) {
    var ow = WORLD.overworld.generate(b), g = WORLD.progression.graph(b);
    if (!ow || !g) return null;
    var bk = biomeKeys(b), regId = {}, trp = (b.rules && b.rules.trp_) || {}, enm = (b.rules && b.rules.enm_) || {};
    g.regions.forEach(function (r) { regId[r.key] = r.record || ENGINE_WORLD.ids.structural('reg_', r.key); });
    var field = ZNE.fieldCells(ow, bk).map(function (f) { return Object.assign({}, f, { region: regId[f.region], ref: subjectRef(b, f.biome) }); });
    var chapters = WORLD.chapters(b).map(function (c) {
      var troops = [], bosses = [];
      Object.keys(trp).sort().forEach(function (id) {
        var t = trp[id];
        if (!t || t.chapter !== c.id) return;
        if (ZNE.isBoss(t, enm)) bosses.push(id); else troops.push({ troop: id, power: ZNE.power(t, enm) });
      });
      return { chapter: c.id, continent: WORLD.continentSlug(c), troops: troops, bosses: bosses };
    });
    var flags = INE.palette(b.art).flags, interiors = [], bossSites = [], caves = [], keys2 = [];
    interiorMaps(b).filter(function (m) { return m.kind !== 'town'; }).sort(function (a, c) { return a.key < c.key ? -1 : 1; }).forEach(function (m) {
      var sk = siteKeyOfMap(m), site = WORLD.interiors.site(sk, b), fl = site && site.floors[(m.floor || 1) - 1], siteRec = WORLD.records.get(m.site, b) || {};
      var ref = subjectRef(b, m.tileset) || 'interior:' + m.kind;
      interiors.push({ key: sk, site: m.site, map: m.id, kind: m.kind, chapter: m.chapter, floor: m.floor || 1, floors: m.floors || 1, cells: fl ? ZNE.floorCells(fl, flags) : 0, ref: ref });
      (m.features || []).forEach(function (ft) {
        if (ft.kind === 'boss') bossSites.push({ site: m.site, map: m.id, at: ft.at, troop: ft.troop || null, chapter: m.chapter, ref: ref, finale: !!ft.finale });
        else if (ft.kind === 'chest' && ft.treasure && /^cave/.test(siteRec.role || '')) caves.push({ chapter: m.chapter, site: m.site, map: m.id, at: ft.at, ref: ref, kind: 'cave', order: sk });
        else if (ft.kind === 'chest' && ft.prize) keys2.push({ chapter: m.chapter, site: m.site, map: m.id, at: ft.at, ref: ref, kind: 'key', order: sk });
      });
    });
    var ovr = b.world.overrides && U.isObj(b.world.overrides.zones) ? b.world.overrides.zones : {};
    var sp = { settings: b.world.settings, chapters: chapters, field: field, interiors: interiors, backgrounds: backgrounds(b), weather: weatherList(b),
      bossSites: bossSites, spareSlots: caves.concat(keys2), overrides: ovr };
    sp.hash = ENGINE_WORLD.util.digest([ENGINE_WORLD.version, (WORLD.overworld.record(b) || {}).paramHash || '-', canon(interiorMaps(b).map(function (m) { return m.id + '=' + m.paramHash; }).sort()),
      canon(chapters), canon(sp.backgrounds), canon(sp.weather), canon(b.world.settings && b.world.settings.zones || {}), canon(ovr)]);
    return sp;
  }
  function znGivers(b, prior) {
    var people = [], towns = {};
    WORLD.records.list('twn_', b).forEach(function (t) { towns[t.id] = t; });
    WORLD.records.list('npc_', b).forEach(function (p) {
      var t = towns[p.site];
      if (t) people.push({ npc: p.id, chapter: p.chapter, town: t.order | 0, slot: p.slot || '', role: p.role || '' });
    });
    var quests = [], sdq = (b.rules && b.rules.sdq_) || {};
    Object.keys(sdq).sort().forEach(function (id) {
      var q = sdq[id], g0 = q.giver, live = g0 && WORLD.records.get(g0, b);
      // Someone else's choice stays: a giver that resolves and is not the one this forge last wrote.
      quests.push({ quest: id, chapter: q.chapter || null, keep: live && g0 !== prior[id] ? g0 : null });
    });
    var r = ZNE.givers({ chapters: WORLD.chapters(b).map(function (c) { return c.id; }), quests: quests, people: people });
    r.kept = quests.filter(function (q) { return q.keep; }).map(function (q) { return q.quest; });
    return r;
  }

  WORLD.zones = {
    data: function (b) { return zoneData(b || cur()); },
    generated: function (b) { return !!zoneData(b || cur()); },
    spec: function (b) { b = b || cur(); WORLD.ensure(b); return znSpec(b); },
    // The field zone of an overworld cell index, by the engine's rule (null for water, walls, and stamps).
    cellKey: function (i, b) { b = b || cur(); var ow = WORLD.overworld.generate(b); return ow ? ZNE.cellKey(ow, i, biomeKeys(b)) : null; },
    // Every cell's zone key for a map already built (the World tab's Zones overlay), memoized by the map's digest.
    cellKeys: function (ow, b) {
      b = b || cur();
      if (!ow) return null;
      if (ckMemo && ckMemo.digest === ow.digest && ckMemo.w === ow.w) return ckMemo.keys;
      var bk = biomeKeys(b), out = new Array(ow.w * ow.h);
      for (var i = 0; i < out.length; i++) out[i] = ZNE.cellKey(ow, i, bk);
      ckMemo = { digest: ow.digest, w: ow.w, keys: out };
      return out;
    },
    // The tables as generated, before any override (what an edit is compared with, so only real changes are stored).
    base: function (b) { b = b || cur(); WORLD.ensure(b); var sp = znSpec(b); return sp ? ZNE.build(Object.assign({}, sp, { overrides: {} })) : null; },
    // Sets one zone's rate and weights (the full values wanted). Only what differs from the generated table is stored in
    // world.overrides.zones, an empty difference removes the override, and the zones are applied again at once.
    edit: function (b, key, want) {
      b = b || cur();
      var base = WORLD.zones.base(b), z0 = base && base.field.concat(base.interior).filter(function (x) { return x.key === key; })[0];
      if (!z0) return { ok: false, message: 'Zone ' + key + ' is not in the world.' };
      var ov = {}, w = {};
      function n(v) { v = Math.floor(Number(v)); return isFinite(v) ? Math.max(0, Math.min(255, v)) : null; }
      if (want && want.rate != null && n(want.rate) != null && n(want.rate) !== z0.rate) ov.rate = n(want.rate);
      z0.troops.forEach(function (t) { var v = want && want.weights ? n(want.weights[t.troop]) : null; if (v != null && v !== t.weight) w[t.troop] = v; });
      if (Object.keys(w).length) ov.weights = w;
      b.world.overrides = U.isObj(b.world.overrides) ? b.world.overrides : {};
      var all = U.isObj(b.world.overrides.zones) ? U.clone(b.world.overrides.zones) : {};
      if (Object.keys(ov).length) all[key] = ov; else delete all[key];
      if (Object.keys(all).length) b.world.overrides.zones = all; else delete b.world.overrides.zones;
      var r = WORLD.zones.apply(b);
      return { ok: true, override: Object.keys(ov).length ? ov : null, zone: WORLD.zones.zone(key, b), ms: r.ms };
    },
    zone: function (key, b) { var z = zoneData(b || cur()); return z ? z.field.concat(z.interior).filter(function (x) { return x.key === key; })[0] || null : null; },
    stale: function (b) {
      b = b || cur();
      var z = zoneData(b);
      if (!z) return false;
      if (WORLD.interiors.stale(b)) return true;
      var sp = znSpec(b);
      return !sp || sp.hash !== z.paramHash;
    },
    // Generates the interiors first when they are missing or stale, then the tables, bosses, and givers.
    apply: function (b) {
      b = b || cur();
      WORLD.ensure(b);
      if (!WORLD.interiors.generated(b) || WORLD.interiors.stale(b)) WORLD.interiors.apply(b);
      var t0 = Date.now(), sp = znSpec(b), r = ZNE.build(sp), old = zoneData(b), prior = old && U.isObj(old.givers) ? old.givers : {};
      var gv = znGivers(b, prior), sdq = (b.rules && b.rules.sdq_) || {}, wrote = {}, filled = 0;
      WORLD.batching = true;
      try {
        Object.keys(gv.assign).sort().forEach(function (q) { if (sdq[q].giver !== gv.assign[q]) { sdq[q].giver = gv.assign[q]; filled++; } wrote[q] = gv.assign[q]; });
        // Every generated person who gives a quest lists it in quests (a giver set by hand is marked too).
        var giving = {};
        Object.keys(sdq).sort().forEach(function (q) { var n = sdq[q].giver; if (n) (giving[n] = giving[n] || []).push(q); });
        WORLD.records.list('npc_', b).forEach(function (p) {
          if (p.origin === 'user') return;
          var qs = giving[p.id] || [];
          if (qs.length) p.quests = qs; else delete p.quests;
        });
      } finally { WORLD.batching = false; }
      var stats = { field: r.field.length, interior: r.interior.length, bosses: r.bosses.filter(function (x) { return x.role === 'boss'; }).length,
        guardians: r.bosses.filter(function (x) { return x.role === 'guardian'; }).length, givers: Object.keys(wrote).length, kept: gv.kept.length,
        cells: r.field.reduce(function (s, z) { return s + z.cells; }, 0) };
      b.world.zones = { version: 1, generatorVersion: ENGINE_WORLD.version, paramHash: sp.hash, digest: r.digest, field: r.field, interior: r.interior,
        bosses: r.bosses, givers: wrote, warnings: r.warnings.concat(gv.warnings), stats: stats };
      if (b === cur()) { Kit.index.invalidate(); Kit.bundle.touch('zones'); }
      return { zones: b.world.zones, filled: filled, kept: gv.kept, ms: Date.now() - t0 };
    }
  };

  Kit.validate.register('world.zones', function (b, ctx) {
    var z = zoneData(b);
    if (!z) {
      if (WORLD.interiors.generated(b)) ctx.add({ recordId: 'world', fieldPath: 'zones', message: 'The world has no encounter zones yet. Generate them on the Encounters tab.', level: 'warning' });
      return;
    }
    if (WORLD.zones.stale(b)) ctx.add({ recordId: 'world', fieldPath: 'zones', message: 'The maps, troops, art, or settings changed after the encounter zones were made. Generate them again on the Encounters tab.', level: 'warning' });
    // Troops, backgrounds, weather, and maps the zones name are reference checks (world.refs, Phase 6). DECISION: an empty
    // table stays a warning, because a zone with no troop never starts a battle; a missing battle background is left to
    // world.refs, which makes it an error exactly when that zone (or boss) can start a battle and passes it otherwise.
    (z.warnings || []).forEach(function (w) { if (w.code !== 'no-background') ctx.add({ recordId: 'world', fieldPath: 'zones', message: w.message, level: 'warning' }); });
    // Phase 7 edits: a table whose weights were all set to 0 never picks a troop, and an edit naming a zone the world no
    // longer has does nothing. Both are warnings; neither blocks a Final export.
    z.field.concat(z.interior).forEach(function (q) {
      if (q.empty || !(q.rate > 0)) return;
      if (!q.troops.some(function (t) { return t.weight > 0; })) ctx.add({ recordId: 'world', fieldPath: 'zones', message: 'Zone ' + q.key + ' has troops but every weight is 0, so it can never pick one. Raise a weight or set its rate to 0 on the Encounters tab.', level: 'warning' });
    });
    var ovz = b.world.overrides && U.isObj(b.world.overrides.zones) ? b.world.overrides.zones : {};
    Object.keys(ovz).sort().forEach(function (k) {
      if (!z.field.concat(z.interior).some(function (q) { return q.key === k; })) ctx.add({ recordId: 'world', fieldPath: 'zones', message: 'An encounter edit names zone ' + k + ', which the world no longer has, so it does nothing.', level: 'warning' });
    });
  });

  // Graph level checks (Phase 6's world.progression adds the geometric ones). Only runs once a graph has been laid out.
  Kit.validate.register('world.graph', function (b, ctx) {
    var g = WORLD.progression.graph(b);
    if (!g) return;
    PG.check(g).forEach(function (p) { ctx.add({ recordId: 'world', fieldPath: 'progression', message: p.message, level: 'error' }); });
    g.warnings.forEach(function (w) { ctx.add({ recordId: 'world', fieldPath: 'progression', message: w.message, level: 'warning' }); });
    if (WORLD.progression.stale(b)) ctx.add({ recordId: 'world', fieldPath: 'progression', message: 'The Charter\'s chapters or the progression settings changed after the graph was laid out. Lay it out again on the Start tab.', level: 'warning' });
    // A site record the graph names but the records lack is a world.refs error (Phase 6).
  });
})();
// === WORLD:GENERATE END ===
