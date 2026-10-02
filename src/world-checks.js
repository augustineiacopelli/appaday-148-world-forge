// === WORLD:CHECKS BEGIN ===
(function () {
  'use strict';
  // Phase 6: the world's validators. ENGINE_WORLD.checks does the proving on plain data; this fence gathers that data
  // from the bundle, memoizes the expensive walks by the hashes the maps were made from, and registers four validators
  // with Kit.validate:
  //   world.refs         every reference the world holds resolves (missing IDs are broken, missing roles and sprites are
  //                      errors), the one authority for references (Phases 3 to 5 now report only missing and stale).
  //   world.progression  the flood fill per chapter with held keys, ship and airship included, plus the walking proof
  //                      inside every site. Runs once the overworld is generated and up to date.
  //   world.flags        every tile resolves and carries the flags play depends on, on the overworld and every floor.
  //   world.zones        (Phase 5's, kept) none yet and stale as warnings, empty tables as warnings.
  // DECISION, the Final gate: a generated world (its overworld record carries a paramHash) exports Final only when it is
  // complete and current: progression, overworld, interiors, and zones all generated and none stale, so every record
  // agrees with what Day 150 regenerates from the seed. A hand made overworld (no paramHash) is not held to this.
  var U = Kit.util, CK = ENGINE_WORLD.checks, memo = { key: null, value: null };
  function cur() { return Kit.bundle.current(); }
  function recs(b, ns, p) { var r = b && b[ns] && (ns === 'art' ? b.art.records : b[ns]); return r && U.isObj(r[p]) ? r[p] : {}; }
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    return JSON.stringify(v);
  }

  // ---------------------------------------------------------------- what the checks read
  function refSpec(b) {
    WORLD.ensure(b);
    var trp = recs(b, 'rules', 'trp_'), enm = recs(b, 'rules', 'enm_'), troops = {}, tilesets = {}, sprites = {}, sets = {};
    Object.keys(trp).sort().forEach(function (id) { troops[id] = { boss: !!(trp[id] && ENGINE_WORLD.zones.isBoss(trp[id], enm)) }; });
    var til = recs(b, 'art', 'til_');
    Object.keys(til).sort().forEach(function (id) { tilesets[id] = til[id] && til[id].kind || 'unknown'; });
    var spr = recs(b, 'art', 'spr_');
    Object.keys(spr).sort().forEach(function (id) { sprites[id] = spr[id] && spr[id].subject && spr[id].subject.ref || ''; });
    var pal = ENGINE_WORLD.interiors.palette(b.art);
    Object.keys(pal.sets).sort().forEach(function (k) { sets[k] = pal.sets[k].til; });
    function ids(o) { var out = {}; Object.keys(o).sort().forEach(function (id) { out[id] = 1; }); return out; }
    return {
      records: b.world.records, chapters: WORLD.chapters(b).map(function (c) { return c.id; }), troops: troops, tilesets: tilesets, interiorSets: sets,
      backgrounds: ids(recs(b, 'art', 'bgd_')), music: WORLD.art.musicRoles(b), weather: ids(recs(b, 'rules', 'wth_')), sprites: sprites,
      quests: ids(recs(b, 'rules', 'sdq_')), zones: WORLD.zones.data(b), graph: WORLD.progression.graph(b), archetypes: ENGINE_WORLD.interiors.ARCHETYPES.slice()
    };
  }

  // Where the world stands: what exists and what is current. Geometric checks run only on a current, generated map.
  function state(b) {
    var rec = WORLD.overworld.record(b), gen = !!(rec && rec.paramHash);
    var s = { graph: !!WORLD.progression.graph(b), overworld: !!rec, generated: gen, owFresh: false, interiors: false, inFresh: false, zones: false, znFresh: false, graphFresh: false };
    s.graphFresh = s.graph && !WORLD.progression.stale(b);
    if (!gen) return s;
    s.owFresh = s.graphFresh && !WORLD.overworld.stale(b);
    s.interiors = WORLD.interiors.generated(b);
    s.inFresh = s.interiors && s.owFresh && !WORLD.interiors.stale(b);
    s.zones = WORLD.zones.generated(b);
    s.znFresh = s.zones && s.inFresh && !WORLD.zones.stale(b);
    return s;
  }

  // Tile flags are not part of the maps' parameter hashes (a map is laid out from tile keys, not flags), yet the walks
  // read them, so the memo is keyed by every tile's flags as well.
  function flagKey(b) {
    var til = recs(b, 'art', 'til_'), parts = [];
    Object.keys(til).sort().forEach(function (id) {
      var t = til[id];
      if (!t) return;
      parts.push(id + '=' + (Number(t.flags) | 0) + ':' + (t.kind || ''));
      (t.tiles || []).forEach(function (it) { if (it && it.key) parts.push(it.key + '=' + (Number(it.flags) | 0) + (it.autotile ? 'a' : '')); });
    });
    return ENGINE_WORLD.util.digest(parts);
  }
  // The walks (progression and flags) for the current maps, memoized by every hash the maps were made from.
  function walks(b, st) {
    if (!st.owFresh) return null;
    var ow = WORLD.overworld.generate(b), g = WORLD.progression.graph(b), built = st.inFresh ? WORLD.interiors.built(b) : [];
    var key = ow.paramHash + '|' + built.map(function (x) { return x.sp.key + '=' + x.sp.hash; }).join(',') + '|' + (st.inFresh ? 1 : 0) + '|' + flagKey(b);
    if (memo.key === key && memo.value) return memo.value;
    var t0 = Date.now(), sites = null, kinds = {}, recIds = {};
    if (st.inFresh) { sites = {}; built.forEach(function (x) { sites[x.sp.key] = x.site; kinds[x.sp.key] = x.sp.kind; recIds[x.sp.key] = x.sp.site.record; }); }
    var pal = ENGINE_WORLD.interiors.palette(b.art);
    var prog = CK.progression({ ow: ow, graph: g, sites: sites, palette: pal });
    var t1 = Date.now();
    var owRec = WORLD.overworld.record(b);
    var flags = CK.flags({ ow: ow, sites: sites || {}, kinds: kinds, records: recIds, overworldRecord: owRec && owRec.id, art: b.art, render: ENGINE_RENDER });
    var value = { progression: prog, flags: flags, interiors: !!sites, ms: { progression: t1 - t0, flags: Date.now() - t1 } };
    memo = { key: key, value: value };
    return value;
  }

  function item(p) {
    var o = { recordId: p.record || 'world', fieldPath: p.field || p.check, message: p.message, level: p.level, check: p.check, code: p.code };
    if (p.id) o.id = p.id;
    if (p.chapter) o.chapter = p.chapter;
    if (p.map) o.map = p.map;
    if (p.at != null) o.at = p.at;
    return o;
  }

  WORLD.checks = {
    refSpec: refSpec,
    state: state,
    refs: function (b) { b = b || cur(); return CK.refs(refSpec(b)); },
    walks: function (b) { b = b || cur(); WORLD.ensure(b); return walks(b, state(b)); },
    // Why a generated world may not export Final yet (null when nothing holds it back).
    finalBlock: function (b) {
      b = b || cur();
      var s = state(b);
      if (!s.generated) return null;
      if (!s.graphFresh) return 'Final export is blocked: the chapters changed since the progression was laid out. Lay it out again on the Start tab.';
      if (!s.owFresh) return 'Final export is blocked: the overworld is out of date. Generate it again on the World tab.';
      if (!s.interiors) return 'Final export is blocked: the towns, dungeons, and caves have no interiors yet. Generate them on the Sites tab.';
      if (!s.inFresh) return 'Final export is blocked: the interiors are out of date. Generate them again on the Sites tab.';
      if (!s.zones) return 'Final export is blocked: the world has no encounter zones yet. Generate them on the Encounters tab.';
      if (!s.znFresh) return 'Final export is blocked: the encounter zones are out of date. Generate them again on the Encounters tab.';
      return null;
    },
    // A compact record of what was proven, for the manifest and the Validation tab.
    summary: function (b) {
      b = b || cur();
      var s = state(b), r = CK.refs(refSpec(b)), w = walks(b, s);
      function lv(list) { var o = { error: 0, broken: 0, warning: 0 }; list.forEach(function (p) { o[p.level] = (o[p.level] || 0) + 1; }); return o; }
      return {
        engine: ENGINE_WORLD.version, refs: lv(r.problems), state: s,
        progression: w ? { ok: w.progression.ok, interiors: w.interiors, problems: lv(w.progression.problems), chapters: w.progression.chapters.map(function (c) { return { chapter: c.chapter, ok: c.ok, sites: c.sites.length, sealed: c.sealed, ship: c.ship, airship: c.airship }; }) } : null,
        flags: w ? { ok: w.flags.ok, problems: lv(w.flags.problems), stats: U.clone(w.flags.stats) } : null,
        finalBlock: WORLD.checks.finalBlock(b)
      };
    }
  };

  Kit.validate.register('world.refs', function (b, ctx) {
    if (!b.world || WORLD.isEmpty(b)) return;
    CK.refs(refSpec(b)).problems.forEach(function (p) { ctx.add(item(p)); });
  });
  Kit.validate.register('world.progression', function (b, ctx) {
    var s = state(b), w = walks(b, s);
    if (!w) return;
    w.progression.problems.forEach(function (p) { var o = item(p); o.fieldPath = 'progression'; ctx.add(o); });
  });
  Kit.validate.register('world.flags', function (b, ctx) {
    var s = state(b), w = walks(b, s);
    if (!w) return;
    w.flags.problems.forEach(function (p) { var o = item(p); o.fieldPath = 'flags' + (p.map ? '.' + p.map : ''); ctx.add(o); });
  });

  // ---------------------------------------------------------------- jump links
  // The validation panel's Jump buttons: a site, its maps, and its people open the Sites tab on that site; a region or
  // the overworld opens the World tab; 'world' itself routes by field (WORLD:STORE's handler calls WORLD.jumpWorld).
  function siteKeyOf(b, rec) {
    if (!rec) return null;
    var p = Kit.ids.prefixOf(rec.id);
    if (p === 'twn_' || p === 'dgn_') return rec.key || null;
    if ((p === 'map_' && rec.kind !== 'overworld') || p === 'npc_') { var s = WORLD.records.get(rec.site, b); return s ? s.key : null; }
    return null;
  }
  WORLD.jumpWorld = function (fieldPath) {
    var f = String(fieldPath || '');
    if (/^zones/.test(f)) return Kit.go('encounters');
    if (/^interiors/.test(f)) return Kit.go('sites');
    if (/^(progression|flags|refs|music)/.test(f)) return Kit.go('validation');
    return Kit.go('start');
  };
  Kit.jump.register({
    test: function (id) { return WORLD.PREFIXES.indexOf(Kit.ids.prefixOf(id)) >= 0; },
    name: function (id) { var r = WORLD.records.get(id); return r && r.name ? r.name : id; },
    go: function (id) {
      var b = cur(), rec = WORLD.records.get(id, b), key = siteKeyOf(b, rec);
      if (key && WORLD.sitesUi) { WORLD.sitesUi.site = key; WORLD.sitesUi.floor = rec && rec.floor ? rec.floor : 1; return Kit.go('sites'); }
      // Phase 7: a region opens the World tab centered on where its chapter starts walking.
      if (rec && Kit.ids.prefixOf(id) === 'reg_' && WORLD.worldUi) {
        var ow = WORLD.overworld.record(b), r2 = ow && (ow.regions || []).filter(function (x) { return x.region === id; })[0];
        if (r2 && r2.anchor) WORLD.worldUi.focus = r2.anchor.slice();
      }
      if (rec) return Kit.go('world');
      return Kit.go('validation');
    }
  });
})();
// === WORLD:CHECKS END ===
