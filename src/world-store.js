// === WORLD:STORE BEGIN ===
(function () {
  'use strict';
  // World namespace storage, record envelope, Codex types, the import gate, the open policy, storage keys, and the size
  // model. Everything here sits on top of the verbatim KIT:CORE fence and changes nothing inside it. Day 146 already
  // reserved map_ reg_ npc_ twn_ dgn_ for forge 148 in namespace 'world', and Kit.index already walks bundle.world, so
  // world records live at bundle.world.records[prefix][id], the same keyed shape rules and art use.
  var U = Kit.util;
  var WORLD = window.WORLD = {};
  WORLD.VERSION = '1.0.0';
  WORLD.FORGE = 148;
  WORLD.GENERATOR = 'appaday-148-world';

  // ---------------------------------------------------------------- prefixes and Codex types
  WORLD.PREFIXES = ['map_', 'reg_', 'npc_', 'twn_', 'dgn_'];
  WORLD.TYPES = {
    'map_': { name: 'WorldMap', label: 'Map' }, 'reg_': { name: 'WorldRegion', label: 'Region' },
    'npc_': { name: 'WorldNpc', label: 'Person' }, 'twn_': { name: 'WorldTown', label: 'Town' },
    'dgn_': { name: 'WorldDungeon', label: 'Dungeon' }
  };
  // Every world record carries a structural key (its ID is derived from it, never from the seed) and, where it belongs
  // to one, a chapter. Generated records also say whether they came from the generator or from an override.
  var ENVELOPE_FIELDS = [
    { key: 'key', label: 'Structural key', type: 'text', max: 160, help: 'The key the ID is derived from, such as dgn|ch2|boss. It never changes on a reroll.' },
    { key: 'chapter', label: 'Chapter', type: 'ref', refPrefix: 'chp_' },
    { key: 'origin', label: 'Origin', type: 'enum', values: ['generated', 'user'] },
    { key: 'tags', label: 'Tags', type: 'list', of: { type: 'text', max: 40 }, itemLabel: 'Tag' }
  ];
  WORLD.PREFIXES.forEach(function (p) {
    var info = Kit.codex.PREFIXES[p];
    if (!info || info.ns !== 'world' || info.forge !== WORLD.FORGE) throw new Error('KIT:CORE no longer reserves ' + p + ' for forge 148 in namespace world.');
    var t = WORLD.TYPES[p];
    Kit.codex.register({ name: t.name, prefix: p, label: t.label, ns: 'world', forge: WORLD.FORGE, group: 'world', dependsOn: [], fields: U.clone(ENVELOPE_FIELDS) });
  });

  // ---------------------------------------------------------------- the namespace
  WORLD.DEFAULT_SETTINGS = {
    // Overworld size: base plus perContinent cells per side for each continent, capped at max (square).
    mapSize: { base: 96, perContinent: 32, max: 256 },
    // Cut points for the five bands of each climate layer, as cumulative fractions of the land (Phase 3 uses them).
    thresholds: { temp: [0.2, 0.4, 0.6, 0.8], moist: [0.2, 0.4, 0.6, 0.8] },
    // Noise shape (Phase 1 core, used from Phase 3).
    noise: { octaves: 5, lacunarity: 2, gain: 0.5, scale: 28 },
    // Progression (Phase 2): the airship arrives this far through the chapters; optional branches per chapter.
    airshipAt: 0.67, cavesPerChapter: 1, secondTownInChapterOne: true,
    // Volcanic and other feature biomes: the most of their own climate box they may cover.
    featureCoverage: 0.35,
    // Overworld shape (Phase 3): share of the map that is land, mountain and high ground shares of each continent's
    // inland, coastline ruggedness, minimum spacing between sites, and sparse per continent overrides keyed by slug
    // ({radius multiplier, ruggedness, mountains}) that the World tab edits in Phase 7.
    overworld: { landFraction: 0.36, mountainShare: 0.12, highShare: 0.35, ruggedness: 0.35, siteSpacing: 8, continents: {} },
    bake: false
  };
  function skeleton() {
    return {
      version: WORLD.VERSION,
      generator: { name: WORLD.GENERATOR, version: (typeof ENGINE_WORLD !== 'undefined' && ENGINE_WORLD.version) || null },
      seed: (Math.random() * 4294967295) >>> 0,
      settings: U.clone(WORLD.DEFAULT_SETTINGS),
      records: { 'map_': {}, 'reg_': {}, 'npc_': {}, 'twn_': {}, 'dgn_': {} },
      progression: {},
      zones: {},
      overrides: {},
      baked: {}
    };
  }
  // Fills a missing world namespace without ever overwriting what is there. Returns true when it changed the bundle.
  WORLD.ensure = function (b) {
    b = b || Kit.bundle.current();
    if (!b) return false;
    var changed = false;
    if (!U.isObj(b.world)) { b.world = {}; changed = true; }
    var w = b.world, sk = skeleton();
    Object.keys(sk).forEach(function (k) { if (w[k] === undefined) { w[k] = sk[k]; changed = true; } });
    if (!U.isObj(w.records)) { w.records = {}; changed = true; }
    WORLD.PREFIXES.forEach(function (p) { if (!U.isObj(w.records[p])) { w.records[p] = {}; changed = true; } });
    if (!U.isObj(w.settings)) { w.settings = {}; changed = true; }
    Object.keys(WORLD.DEFAULT_SETTINGS).forEach(function (k) { if (w.settings[k] === undefined) { w.settings[k] = U.clone(WORLD.DEFAULT_SETTINGS[k]); changed = true; } });
    if (typeof w.seed !== 'number' || w.seed !== (w.seed >>> 0)) { w.seed = (Number(w.seed) >>> 0) || ((Math.random() * 4294967295) >>> 0); changed = true; }
    return changed;
  };
  WORLD.count = function (b) {
    b = b || Kit.bundle.current();
    var r = b && b.world && U.isObj(b.world.records) ? b.world.records : {};
    return WORLD.PREFIXES.reduce(function (n, p) { return n + (U.isObj(r[p]) ? Object.keys(r[p]).length : 0); }, 0);
  };
  WORLD.isEmpty = function (b) { return WORLD.count(b) === 0; };
  // A world is generated once the overworld map exists (Phase 3). Until then a Final export is refused.
  WORLD.isGenerated = function (b) {
    b = b || Kit.bundle.current();
    return WORLD.records.list('map_', b).some(function (m) { return m.kind === 'overworld'; });
  };

  // ---------------------------------------------------------------- records
  function store(b) { WORLD.ensure(b); return b.world.records; }
  WORLD.records = {
    list: function (prefix, b) {
      b = b || Kit.bundle.current();
      var m = store(b)[Kit.codex.normPrefix(prefix)];
      return U.isObj(m) ? Object.keys(m).sort().map(function (k) { return m[k]; }).filter(U.isObj) : [];
    },
    get: function (id, b) {
      b = b || Kit.bundle.current();
      var m = store(b)[Kit.ids.prefixOf(id)];
      return U.isObj(m) && U.isObj(m[id]) ? m[id] : null;
    },
    put: function (rec, b) {
      b = b || Kit.bundle.current();
      var p = Kit.ids.prefixOf(rec && rec.id);
      if (!p || WORLD.PREFIXES.indexOf(p) < 0) throw new Error('WORLD.records.put stores world records only (' + WORLD.PREFIXES.join(' ') + ').');
      if (!Kit.ids.isValid(rec.id)) throw new Error('Invalid world ID ' + rec.id + '.');
      store(b)[p][rec.id] = rec;
      if (b === Kit.bundle.current() && !WORLD.batching) Kit.index.invalidate();
      return rec;
    },
    del: function (id, b) {
      b = b || Kit.bundle.current();
      var p = Kit.ids.prefixOf(id), r = store(b);
      if (!r[p] || !r[p][id]) return false;
      delete r[p][id];
      if (b === Kit.bundle.current()) Kit.index.invalidate();
      return true;
    }
  };
  // The envelope every world record carries. The ID comes from the structural key through ENGINE_WORLD, never from
  // Kit.ids.mint (which adds a random suffix) and never from Claude. References inside a record use field names other
  // than id (map, to, npc, giver), because Kit.index treats any object with an id field as a record.
  WORLD.envelope = function (prefix, key, name, body) {
    var p = Kit.codex.normPrefix(prefix);
    if (WORLD.PREFIXES.indexOf(p) < 0) throw new Error('Not a world prefix: ' + prefix);
    var rec = { id: ENGINE_WORLD.ids.structural(p, key), name: String(name || key), key: String(key), origin: 'generated', notes: '', tags: [] };
    if (U.isObj(body)) Object.keys(body).forEach(function (k) { if (k !== 'id' && k !== 'key') rec[k] = body[k]; });
    return rec;
  };

  // ---------------------------------------------------------------- what this forge reads
  WORLD.chapters = function (b) {
    b = b || Kit.bundle.current();
    var S = b && b.charter && b.charter.sections;
    return S && Array.isArray(S.chapters) ? S.chapters.filter(U.isObj) : [];
  };
  // The continent slug for a chapter, the same slug Day 147 uses for its field:<slug> music roles ('default' when blank).
  WORLD.continentSlug = function (c) {
    var l = U.isObj(c) && typeof c.continentLabel === 'string' ? c.continentLabel.trim() : '';
    return (l && U.slug(l)) || 'default';
  };
  WORLD.continents = function (b) {
    var out = [], seen = {};
    WORLD.chapters(b).forEach(function (c, i) {
      var s = WORLD.continentSlug(c);
      if (!seen[s]) { seen[s] = { slug: s, label: (c.continentLabel || '').trim() || 'Default', chapters: [], minutes: 0 }; out.push(seen[s]); }
      seen[s].chapters.push(c.id);
      seen[s].minutes += Number(c.targetMinutes) || 60;
    });
    return out;
  };
  function artList(b, prefix) {
    var m = b && b.art && U.isObj(b.art.records) && U.isObj(b.art.records[prefix]) ? b.art.records[prefix] : {};
    return Object.keys(m).sort().map(function (k) { return m[k]; }).filter(U.isObj);
  }
  WORLD.art = {
    list: artList,
    biomes: function (b) { return artList(b || Kit.bundle.current(), 'til_').filter(function (t) { return t.kind === 'biome'; }); },
    interiors: function (b) { return artList(b || Kit.bundle.current(), 'til_').filter(function (t) { return t.kind === 'interior'; }); },
    interior: function (b, key) { return WORLD.art.interiors(b).filter(function (t) { return t.subject && t.subject.ref === 'interior:' + key; })[0] || null; },
    musicRoles: function (b) { var out = {}; artList(b || Kit.bundle.current(), 'mus_').forEach(function (m) { if (m.subject && m.subject.kind === 'role') out[m.subject.ref] = m.id; }); return out; }
  };
  WORLD.bossTroops = function (b) {
    b = b || Kit.bundle.current();
    var enm = b.rules && b.rules.enm_ || {}, trp = b.rules && b.rules.trp_ || {};
    return Object.keys(trp).sort().map(function (k) { return trp[k]; }).filter(function (t) {
      return U.isObj(t) && Array.isArray(t.members) && t.members.some(function (m) { return m && enm[m.enm] && enm[m.enm].isBoss; });
    });
  };

  // ---------------------------------------------------------------- the import gate
  // World Forge reads the Charter's chapters and Day 147's tilesets, so it refuses a bundle without either, with a reason
  // a person can act on. Returns true or the reason.
  WORLD.importable = function (b) {
    if (!U.isObj(b) || !U.isObj(b.kit) || b.kit.format !== 'saga-bundle') return 'This file is not a Saga Forge bundle.';
    if (!b.charter || !b.charter.locked) return 'This bundle has no locked Charter. Lock the Charter in Saga Forge (Day 146), then dress it in Art and Audio Forge (Day 147), before building its world.';
    if (!WORLD.chapters(b).length) return 'This bundle\'s Charter has no chapters. World Forge lays out one region per chapter, so add chapters in Saga Forge (Day 146) first.';
    if (!U.isObj(b.art) || !U.isObj(b.art.records) || !Object.keys(b.art.records).length) return 'This bundle has no Day 147 art. Open it in Art and Audio Forge (Day 147) and run Quick Build so the world has tilesets to be drawn with.';
    var til = artList(b, 'til_');
    if (!til.some(function (t) { return t.kind === 'biome' && t.climate; })) return 'This bundle\'s art has no biome tilesets with climate keys. Run Quick Build in Art and Audio Forge (Day 147), or restore its default biomes.';
    if (!til.some(function (t) { return t.kind === 'interior'; })) return 'This bundle\'s art has no interior tilesets. Run Quick Build in Art and Audio Forge (Day 147) so towns and dungeons have tiles.';
    return true;
  };
  WORLD.readiness = function (b) { b = b || Kit.bundle.current(); return WORLD.importable(b); };
  var rawImport = Kit.bundle.importText;
  Kit.bundle.importText = function (text) {
    var b;
    try { b = JSON.parse(text); } catch (e) { throw new Error('That file is not valid JSON.'); }
    var probe = U.clone(b);
    try { Kit.bundle.migrate(probe); } catch (e) { throw e; }
    var ok = WORLD.importable(probe);
    if (ok !== true) throw new Error(ok);
    return rawImport.call(Kit.bundle, text);
  };

  // ---------------------------------------------------------------- the forward field and the open policy
  // Day 146 reserved two forward fields for this forge: sdq_.giver (an npc_) and the save schema's location (a map_,
  // which lives in the schema, not in a record, so there is nothing to fill). Filling sdq_.giver (Phase 5) is the only
  // write this forge makes outside world. Day 146 reads a world ID as FORWARD while world is absent from kit.opened and
  // as BROKEN once world is opened and the record is missing, so world opens only on a Final export, after every check.
  WORLD.FORWARD_FIELDS = [{ prefix: 'sdq_', field: 'giver', target: 'npc_' }];
  WORLD.forwardRefs = function (b) {
    b = b || Kit.bundle.current();
    var out = [];
    WORLD.FORWARD_FIELDS.forEach(function (f) {
      var m = b && b.rules && U.isObj(b.rules[f.prefix]) ? b.rules[f.prefix] : {};
      Object.keys(m).sort().forEach(function (id) {
        var v = U.isObj(m[id]) ? m[id][f.field] : null;
        if (!v) return;
        out.push({ recordId: id, field: f.field, id: v, ok: !!WORLD.records.get(v, b) && Kit.ids.prefixOf(v) === f.target });
      });
    });
    return out;
  };
  // Every world reference in the rules (rumor and side quest refs, the forward giver) resolves to a world record.
  WORLD.rulesRefs = function (b) {
    b = b || Kit.bundle.current();
    var out = [];
    ['rmr_', 'sdq_'].forEach(function (p) {
      var m = b && b.rules && U.isObj(b.rules[p]) ? b.rules[p] : {};
      Object.keys(m).sort().forEach(function (id) {
        var r = m[id];
        if (!U.isObj(r) || !Array.isArray(r.refs)) return;
        r.refs.forEach(function (v, i) { if (WORLD.PREFIXES.indexOf(Kit.ids.prefixOf(v)) >= 0) out.push({ recordId: id, field: 'refs[' + i + ']', id: v, ok: !!WORLD.records.get(v, b) }); });
      });
    });
    return out;
  };
  WORLD.canOpen = function (b) { return WORLD.forwardRefs(b).concat(WORLD.rulesRefs(b)).every(function (r) { return r.ok; }); };

  // ---------------------------------------------------------------- size meter model
  WORLD.LIMIT = 4.5e6;
  WORLD.AMBER = 1.5e6;
  WORLD.size = function (b) {
    b = b || Kit.bundle.current();
    if (!b) return { total: 0, ns: {}, level: 'ok', room: WORLD.LIMIT };
    var ns = {};
    Object.keys(b).forEach(function (k) { ns[k] = JSON.stringify(b[k] === undefined ? null : b[k]).length; });
    var total = JSON.stringify(b).length, draft = 0, where = WORLD.storage.where('kit:draft');
    try { draft = (localStorage.getItem('world148:draft') || '').length; } catch (e) {}
    var other = where === 'idb' ? 0 : Math.max(0, Kit.store.usage() - draft);
    var room = Math.max(0, WORLD.LIMIT - other);
    var level = total >= room * 0.9 ? 'red' : total >= WORLD.AMBER ? 'amber' : 'ok';
    return { total: total, ns: ns, other: other, room: room, level: level, where: where };
  };

  // ---------------------------------------------------------------- storage
  // Every AppADay app shares one origin and one localStorage quota, and Days 146 and 147 use the same KIT:CORE keys.
  // This forge keeps its draft, slots, suspend record, and UI state under its own world148: keys, so another forge's tab
  // can never overwrite a Day 148 draft (Day 147's pattern, decided 2026-10-01). kit:settings, which holds the API key,
  // stays shared on purpose. When localStorage refuses a write, the value moves to IndexedDB (database appaday-148), a
  // tiny marker records where it lives, and an in-memory mirror keeps Kit.store.get synchronous. APP:BOOT awaits
  // WORLD.storage.ready() first.
  var KEYMAP = { 'kit:draft': 'world148:draft', 'kit:slots': 'world148:slots', 'kit:suspend': 'world148:suspend', 'kit:ui': 'world148:ui' };
  var WHERE = 'world148:where:', IDB_NAME = 'appaday-148', IDB_STORE = 'kv';
  var raw = { get: Kit.store.get, set: Kit.store.set, del: Kit.store.del };
  var mem = {}, idbKeys = {}, dbp = null;
  function hasIdb() { try { return typeof indexedDB !== 'undefined' && !!indexedDB; } catch (e) { return false; } }
  function openDb(name) {
    return new Promise(function (resolve, reject) {
      var rq = indexedDB.open(name, 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore(IDB_STORE); };
      rq.onsuccess = function () { resolve(rq.result); };
      rq.onerror = function () { reject(rq.error); };
    });
  }
  function db() {
    if (dbp) return dbp;
    dbp = openDb(IDB_NAME);
    dbp.catch(function () { dbp = null; });
    return dbp;
  }
  function idbOn(dbPromise, mode, fn) {
    return dbPromise.then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction(IDB_STORE, mode), st = tx.objectStore(IDB_STORE), out;
        var rq = fn(st);
        if (rq) rq.onsuccess = function () { out = rq.result; };
        tx.oncomplete = function () { resolve(out); };
        tx.onerror = tx.onabort = function () { reject(tx.error); };
      });
    });
  }
  function idb(mode, fn) { return idbOn(db(), mode, fn); }
  function lsSet(k, s) { try { localStorage.setItem(k, s); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  WORLD.storage = {
    KEYMAP: KEYMAP,
    where: function (key) { var k = KEYMAP[key] || key; if (idbKeys[k]) return 'idb'; return lsGet(k) != null ? 'local' : 'none'; },
    hasIdb: hasIdb,
    ready: function () {
      var ks = [];
      try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(WHERE) === 0) ks.push(k.slice(WHERE.length)); } } catch (e) {}
      if (!ks.length) return Promise.resolve();
      if (!hasIdb()) { ks.forEach(function (k) { lsDel(WHERE + k); }); return Promise.resolve(); }
      return Promise.all(ks.map(function (k) {
        return idb('readonly', function (st) { return st.get(k); }).then(function (v) {
          if (typeof v === 'string') { mem[k] = v; idbKeys[k] = 1; } else lsDel(WHERE + k);
        }, function () {});
      })).then(function () {});
    },
    // The draft Day 147 left in this browser, if any (read only; this forge never writes Day 147's keys). Day 147 keeps
    // it under art147:draft, or in its own IndexedDB database when localStorage was full. Resolves to a bundle or null.
    day147Draft: function () {
      var s = lsGet('art147:draft');
      if (s) { try { return Promise.resolve(JSON.parse(s)); } catch (e) { return Promise.resolve(null); } }
      if (lsGet('art147:where:art147:draft') == null || !hasIdb()) return Promise.resolve(null);
      return idbOn(openDb('appaday-147'), 'readonly', function (st) { return st.get('art147:draft'); }).then(function (v) {
        try { return typeof v === 'string' ? JSON.parse(v) : null; } catch (e) { return null; }
      }, function () { return null; });
    },
    hasDay147Draft: function () { return lsGet('art147:draft') != null || lsGet('art147:where:art147:draft') != null; }
  };
  Kit.store.get = function (key, fallback) {
    var k = KEYMAP[key];
    if (!k) return raw.get.apply(Kit.store, arguments);
    if (idbKeys[k]) { try { return JSON.parse(mem[k]); } catch (e) { return fallback; } }
    return raw.get.call(Kit.store, k, fallback);
  };
  Kit.store.del = function (key) {
    var k = KEYMAP[key];
    if (!k) return raw.del.apply(Kit.store, arguments);
    if (idbKeys[k]) { delete idbKeys[k]; delete mem[k]; lsDel(WHERE + k); idb('readwrite', function (st) { return st.delete(k); }).catch(function () {}); }
    return raw.del.call(Kit.store, k);
  };
  Kit.store.set = function (key, value) {
    var k = KEYMAP[key];
    if (!k) return raw.set.apply(Kit.store, arguments);
    var s;
    try { s = JSON.stringify(value); } catch (e) { return false; }
    if (lsSet(k, s)) {
      if (idbKeys[k]) { delete idbKeys[k]; delete mem[k]; lsDel(WHERE + k); idb('readwrite', function (st) { return st.delete(k); }).catch(function () {}); }
      if (key === 'kit:draft') WORLD.storageFailed(false);
      return true;
    }
    lsDel(k);
    if (!hasIdb() || !lsSet(WHERE + k, '1')) {
      if (key === 'kit:draft') WORLD.storageFailed(true);
      if (Kit.ui && Kit.ui.toast) Kit.ui.toast('Could not save to browser storage. Export your bundle now to keep your work.', 'error', 8000);
      return false;
    }
    var first = !idbKeys[k];
    mem[k] = s; idbKeys[k] = 1;
    idb('readwrite', function (st) { return st.put(s, k); }).then(function () {
      if (key === 'kit:draft') WORLD.storageFailed(false);
      if (first && Kit.ui && Kit.ui.toast && key === 'kit:draft') Kit.ui.toast('This draft is now saved in IndexedDB, the browser\'s larger store, because localStorage is full.', 'warn', 7000);
    }, function () {
      delete idbKeys[k]; delete mem[k]; lsDel(WHERE + k);
      if (key === 'kit:draft') WORLD.storageFailed(true);
    });
    return true;
  };
  WORLD.storageFailed = function (failed) {
    var el = typeof document !== 'undefined' && document.getElementById('storeBanner');
    if (el) el.hidden = !failed;
  };

  // ---------------------------------------------------------------- validation
  Kit.validate.register('world.envelope', function (b, ctx) {
    var w = b.world, r = w && U.isObj(w.records) ? w.records : {};
    Object.keys(r).sort().forEach(function (p) {
      if (WORLD.PREFIXES.indexOf(p) < 0) { ctx.add({ recordId: 'world', fieldPath: 'records.' + p, message: 'Unknown world prefix ' + p + '. Records here are invisible to every forge.', level: 'error' }); return; }
      Object.keys(r[p] || {}).sort().forEach(function (id) {
        var rec = r[p][id];
        if (!U.isObj(rec) || rec.id !== id) ctx.add({ recordId: id, fieldPath: 'id', message: 'World record key and id do not match.', level: 'error' });
        else if (Kit.ids.prefixOf(id) !== p) ctx.add({ recordId: id, fieldPath: 'id', message: 'World record ' + id + ' is filed under ' + p + '.', level: 'error' });
        else if (typeof rec.key === 'string' && rec.origin !== 'user' && ENGINE_WORLD.ids.structural(p, rec.key) !== id) ctx.add({ recordId: id, fieldPath: 'key', message: 'World record ' + id + ' does not match the ID its structural key derives.', level: 'warning' });
      });
    });
  });
  Kit.jump.register({ test: function (rid) { return rid === 'world'; }, name: function () { return 'World namespace'; }, go: function (rid, fieldPath) { return WORLD.jumpWorld ? WORLD.jumpWorld(fieldPath) : Kit.go('start'); } });

  // Keep every loaded bundle shaped for this forge (an empty world gets its skeleton; nothing else is touched).
  Kit.on('load', function (b) { if (WORLD.ensure(b)) Kit.bundle.touch('world-ensure'); });
})();
// === WORLD:STORE END ===
