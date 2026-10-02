// === WORLD:BAKE BEGIN ===
(function () {
  'use strict';
  // The optional bake (Phase 8). world.settings.bake on means every export stores the tile layers of each map the records
  // still agree with (the overworld, painted cells included, and every interior floor) in world.baked, run length encoded
  // over one reference palette by ENGINE_WORLD.bake. Off means an export carries no bake. The bake never feeds the
  // generators or the checks here: the page always regenerates. It is for Day 150, which calls ENGINE_WORLD.bake.load and
  // gets a map only when the generator version and the map's paramHash both match, and regenerates otherwise.
  // DECISION: the plan named interiors; the overworld is baked too, because it is the one map whose build is slow enough
  // to matter on a phone (Phase 7 measured 190 to 780 ms at a 4x slowdown), and it costs the same rule to check.
  // DECISION: bake is not part of any paramHash (settingsForHash drops it), so turning it on or off never makes a map stale.
  var U = Kit.util, EB = ENGINE_WORLD.bake;
  function cur() { return Kit.bundle.current(); }
  function on(b) { return !!(b && b.world && b.world.settings && b.world.settings.bake); }
  function data(b) { var k = b && b.world && b.world.baked; return U.isObj(k) && U.isObj(k.maps) ? k : null; }

  // Every map whose record matches what the seed builds now, as {id, w, h, ground, deco, paramHash}, in record order.
  function collect(b) {
    var out = [], owRec = WORLD.overworld.record(b);
    if (!owRec || !owRec.paramHash || WORLD.overworld.stale(b)) return out;
    var ow = WORLD.overworld.generate(b);
    if (ow && ow.ok && ow.paramHash === owRec.paramHash) out.push({ id: owRec.id, w: ow.w, h: ow.h, ground: ow.ground, deco: ow.deco, paramHash: owRec.paramHash });
    if (!WORLD.interiors.generated(b)) return out;
    WORLD.interiors.built(b).forEach(function (x) {
      if (!x.site.ok) return;
      x.site.floors.forEach(function (fl) {
        var id = ENGINE_WORLD.ids.structural('map_', WORLD.interiors.mapKey(x.sp.key, fl.floor)), rec = WORLD.records.get(id, b);
        if (rec && rec.paramHash === x.sp.hash) out.push({ id: id, w: fl.w, h: fl.h, ground: fl.ground, deco: fl.deco, paramHash: rec.paramHash });
      });
    });
    return out;
  }
  function size(k) { return k ? JSON.stringify(k).length : 0; }

  WORLD.bake = {
    on: on,
    data: function (b) { return data(b || cur()); },
    // Turns the setting on or off. Off clears world.baked at once, so a bundle never carries a bake nobody asked for.
    set: function (b, v) {
      b = b || cur();
      WORLD.ensure(b);
      if (!!v === on(b)) return false;
      b.world.settings.bake = !!v;
      if (!v) b.world.baked = {};
      if (b === cur()) Kit.bundle.touch('bake');
      return true;
    },
    collect: function (b) { b = b || cur(); WORLD.ensure(b); return collect(b); },
    // Bakes every current map (an empty bake when nothing is current). Deterministic: the same world bakes the same bytes.
    apply: function (b) {
      b = b || cur();
      WORLD.ensure(b);
      var maps = collect(b), k = maps.length ? EB.encode(maps, ENGINE_WORLD.version) : {};
      var changed = JSON.stringify(k) !== JSON.stringify(b.world.baked || {});
      b.world.baked = k;
      if (changed && b === cur()) Kit.bundle.touch('bake');
      return { maps: maps.length, bytes: size(k), changed: changed };
    },
    clear: function (b) { b = b || cur(); WORLD.ensure(b); var had = !!data(b); b.world.baked = {}; if (had && b === cur()) Kit.bundle.touch('bake'); return had; },
    // What a reader of the bundle would get for one map: the decoded layers, or null with the reason.
    map: function (id, b) {
      b = b || cur();
      var rec = WORLD.records.get(id, b), k = data(b);
      var why = !rec ? 'No map record ' + id + '.' : EB.why(k, id, { paramHash: rec.paramHash, generatorVersion: ENGINE_WORLD.version });
      if (!why && WORLD.overworld.stale(b)) why = 'The world changed after it was generated, so the bake would be out of date.';
      return why ? { map: null, why: why } : { map: EB.decode(k, id, { paramHash: rec.paramHash }), why: null };
    },
    // Counts for the manifest and the Export tab: baked maps, how many still match their records, the bytes they add.
    status: function (b) {
      b = b || cur();
      var k = data(b), ids = k ? Object.keys(k.maps).sort() : [], fresh = 0, stale = [];
      ids.forEach(function (id) { var rec = WORLD.records.get(id, b); if (rec && !EB.why(k, id, { paramHash: rec.paramHash })) fresh++; else stale.push(id); });
      return { on: on(b), format: k ? k.format : null, generatorVersion: k ? k.generatorVersion : null, maps: ids.length, fresh: fresh, stale: stale, palette: k ? k.palette.length : 0, bytes: size(k) };
    },
    // Called by the export: bake when the setting is on, clear when it is off. Returns the status after.
    forExport: function (b) {
      b = b || cur();
      if (on(b)) WORLD.bake.apply(b); else if (data(b)) WORLD.bake.clear(b);
      return WORLD.bake.status(b);
    },
    // The bytes a bake of the current world would add, for the toggle's label (null before the world is generated).
    estimate: function (b) {
      b = b || cur();
      var maps = collect(b);
      return maps.length ? { maps: maps.length, bytes: size(EB.encode(maps, ENGINE_WORLD.version)) } : null;
    }
  };

  // A bake that no longer matches its maps is ignored by every reader, so it is a warning, never an error; the next
  // export with the setting on bakes again. A bake left behind with the setting off is named too.
  Kit.validate.register('world.bake', function (b, ctx) {
    var k = data(b);
    if (!k) return;
    var s = WORLD.bake.status(b);
    if (!s.on) ctx.add({ recordId: 'world', fieldPath: 'baked', message: 'The bundle carries baked maps but baking is off. The next export removes them.', level: 'warning' });
    else if (s.stale.length) ctx.add({ recordId: 'world', fieldPath: 'baked', message: s.stale.length + ' baked map' + (s.stale.length === 1 ? ' no longer matches its' : 's no longer match their') + ' generator version or parameters, so readers ignore ' + (s.stale.length === 1 ? 'it' : 'them') + '. The next export bakes again.', level: 'warning' });
  });
})();
// === WORLD:BAKE END ===
