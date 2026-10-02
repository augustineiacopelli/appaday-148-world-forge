  // ---------------------------------------------------------------- checks (Phase 6)
  // The world's proofs, run before a Final export and reusable by Day 150 at load time. Pure: the bundle arrives as plain
  // data, the render engine is passed in where tiles are read, and nothing outside the spec is read. Every check returns
  // {ok, problems, ...detail}; a problem is {check, code, level ('error' | 'broken' | 'warning'), message, record (an ID
  // or 'world'), field, id (the missing ID for a broken reference), map, at}.
  //
  // progression(spec): a four way flood fill over the overworld once per chapter, holding what the chapters before it
  //   granted. The ship lets the party sail sea water and step ashore on passable land; the airship lands on any open,
  //   passable land cell that is not a gate, so it reaches every land cell, never a site: every site's entrance still
  //   needs its own chapter key. Proven for each chapter: every non boss site front is reachable and can be entered; the
  //   boss lock's approach is reachable while the lock stays shut, and the lock opens with the chapter's seal; inside each
  //   site the key chest comes before the lock, the goal sits behind it, and the key dungeon's prize is the chapter's
  //   seal while the boss grants what the graph says. Then, holding everything up to and including the chapter's seal but
  //   not its boss, no site of a later chapter can be entered (a golden key there is an early-key error), and, the airship
  //   aside, no inner ground of a later region can be walked to.
  // flags(spec): every tile of every map resolves through the render engine and carries the flags play depends on.
  // refs(spec): every reference the world holds points at something that exists.
  var CK_LEVEL = { error: 1, broken: 1, warning: 1 };
  function ckItem(check, code, level, message, extra) {
    var o = { check: check, code: code, level: CK_LEVEL[level] ? level : 'error', message: message, record: 'world', field: check };
    each(extra || {}, function (v, k) { o[k] = v; });
    return o;
  }
  function heldOf(list) { var h = {}; (list || []).forEach(function (k) { h[k] = true; }); return h; }
  function heldList(h) { return keys(h).filter(function (k) { return h[k]; }); }
  function covers(req, h) { return (req || []).every(function (k) { return h[k]; }); }

  // Cells a party can reach holding h. Without the airship this is overworld.reach; with it, every open passable land cell
  // that is not a gate is a landing place as well, and the party walks (and sails, with the ship) on from each one.
  function ckLandable(ow, i) {
    return ow.owner[i] >= 0 && ow.st[i] === ST_FREE && ow.gateAt[i] < 0 && !ow.sea[i] && owWalkable(ow, i, {}, false);
  }
  function ckReach(ow, h, airship) {
    if (!airship) return owReach(ow, h);
    var ship = !!h['vehicle:ship'], seeds = [], out = new Uint8Array(ow.w * ow.h), n = ow.w * ow.h, i;
    if (ow.start != null) seeds.push(ow.start);
    for (i = 0; i < n; i++) if (ckLandable(ow, i)) seeds.push(i);
    if (!seeds.length) return out;
    var d = bfs(ow.w, ow.h, seeds, function (j) { return owWalkable(ow, j, h, ship); });
    for (i = 0; i < n; i++) if (d[i] >= 0) out[i] = 1;
    return out;
  }
  function ckCount(a) { var c = 0; for (var i = 0; i < a.length; i++) c += a[i]; return c; }

  // The walking proof inside one site, beyond interiors.check: the golden item is where the graph puts it.
  function ckInterior(site, nd, pal, chp) {
    var out = [], rec = nd.record || 'world';
    if (!site) return [ckItem('progression', 'no-interior', 'error', 'The interior of ' + nd.key + ' was not built.', { record: rec, chapter: chp })];
    inCheck(site, pal).forEach(function (p) { out.push(ckItem('progression', 'interior-' + p.code, 'error', p.message, { record: rec, chapter: chp })); });
    var last = site.floors[site.floors.length - 1], feats = last ? last.features : [];
    if (nd.role === 'key') {
      var seal = (nd.grants || [])[0] || null, prize = feats.filter(function (ft) { return ft.kind === 'chest' && ft.prize; })[0];
      if (!prize || prize.item !== seal) out.push(ckItem('progression', 'seal-missing', 'error', 'The key dungeon ' + nd.key + ' does not hold ' + (seal || 'its seal') + ' behind its lock.', { record: rec, chapter: chp }));
    }
    if (nd.role === 'boss') {
      var boss = feats.filter(function (ft) { return ft.kind === 'boss'; })[0];
      if (!boss) out.push(ckItem('progression', 'boss-missing', 'error', 'The boss dungeon ' + nd.key + ' has no boss room.', { record: rec, chapter: chp }));
      else if ((boss.grants || []).join('|') !== (nd.grants || []).join('|')) out.push(ckItem('progression', 'boss-grants', 'error', 'The boss of ' + nd.key + ' grants ' + ((boss.grants || []).join(', ') || 'nothing') + ', not ' + ((nd.grants || []).join(', ') || 'nothing') + '.', { record: rec, chapter: chp }));
    }
    return out;
  }

  // spec: {ow (overworld.build output), graph (Phase 2, site nodes carrying record), sites {site key: interiors.build
  // output} (optional: without it only the overworld is proven), palette (interiors.palette(art), with sites)}.
  function ckProgression(spec) {
    var ow = spec.ow, g = spec.graph, sites = spec.sites || null, pal = spec.palette || null, problems = [], chapters = [], byKey = {}, idx = {};
    if (!ow || !g || !Array.isArray(g.chapters)) return { ok: false, problems: [ckItem('progression', 'no-map', 'error', 'There is no overworld to walk.')], chapters: [] };
    g.chapters.forEach(function (c, k) { idx[c] = k; });
    g.nodes.forEach(function (nd) { byKey[nd.key] = nd; });
    var later = {};
    ow.sites.forEach(function (s) { (later[s.chapter] = later[s.chapter] || []).push(s); });
    g.chapters.forEach(function (chp, k) {
      var h = heldOf(g.start);
      g.nodes.forEach(function (nd) { if (idx[nd.chapter] < k) nd.grants.forEach(function (gk) { h[gk] = true; }); });
      var air = !!h['vehicle:airship'], A = ckReach(ow, h, air), seal = 'item:seal:' + chp, h2 = heldOf(heldList(h).concat([seal])), B = ckReach(ow, h2, air);
      var mine = ow.sites.filter(function (s) { return s.chapter === chp; }), rows = [], before = problems.length;
      var report = { chapter: chp, index: k, held: heldList(h), ship: !!h['vehicle:ship'], airship: air, reach: ckCount(A), sites: rows, lock: null, sealed: true };
      mine.forEach(function (s) {
        var nd = byKey[s.key] || { key: s.key, requires: [], grants: [], role: s.role }, rec = s.record || nd.record || 'world', row = { key: s.key, record: rec, role: s.role, golden: !!nd.golden, ok: true, why: [] };
        function fail(code, msg) { row.ok = false; row.why.push(msg); problems.push(ckItem('progression', code, 'error', msg, { record: rec, chapter: chp, at: s.front })); }
        if (s.role === 'boss') {
          var shut = !A[s.front], opens = !!B[s.front];
          report.lock = { site: s.key, shut: shut, opens: opens, approach: !!A[s.approach] };
          if (!A[s.approach]) fail('unreachable', 'The way to ' + s.key + ' cannot be reached in chapter ' + chp + '.');
          if (!shut) fail('lock-open', 'The lock before ' + s.key + ' opens without the seal ' + seal + '.');
          if (!opens) fail('lock-shut', 'The lock before ' + s.key + ' stays shut even with the seal ' + seal + '.');
          if (!covers(nd.requires, h2)) fail('sealed-site', s.key + ' needs ' + nd.requires.filter(function (q) { return !h2[q]; }).join(', ') + ', which chapter ' + chp + ' never holds.');
        } else {
          if (!A[s.front]) fail('unreachable', s.key + ' cannot be reached in chapter ' + chp + '.');
          if (!covers(nd.requires, h)) fail('sealed-site', s.key + ' needs ' + nd.requires.filter(function (q) { return !h[q]; }).join(', ') + ', which chapter ' + chp + ' does not hold on arrival.');
        }
        if (sites) ckInterior(sites[s.key], nd, pal, chp).forEach(function (p) { row.ok = false; row.why.push(p.message); problems.push(p); });
        rows.push(row);
      });
      // Nothing of a later chapter may open while this one is still being played (seal held, boss not yet beaten).
      ow.sites.forEach(function (s) {
        var j = idx[s.chapter], nd = byKey[s.key];
        if (!(j > k) || !nd) return;
        if (B[s.role === 'boss' ? s.approach : s.front] && covers(nd.requires, h2)) {
          report.sealed = false;
          var gold = nd.golden || s.role === 'key' || s.role === 'boss';
          problems.push(ckItem('progression', gold ? 'early-key' : 'early-site', 'error',
            (gold ? 'The golden key in ' + s.key + ' (chapter ' + s.chapter + ')' : s.key + ' (chapter ' + s.chapter + ')') + ' can be reached and entered during chapter ' + chp + '.', { record: nd.record || s.record || 'world', chapter: chp, at: s.front }));
        }
      });
      // Walking (and sailing) alone never reaches a later region's inner ground. The airship flies anywhere by design.
      var G = air ? ckReach(ow, heldOf(heldList(h2).filter(function (q) { return q !== 'vehicle:airship'; })), false) : B;
      for (var i = 0; i < G.length; i++) {
        if (!G[i] || ow.region[i] < 0 || ow.cls[i] !== CLS_INNER || ow.st[i] === ST_GATE) continue;
        var rk = ow.regions[ow.region[i]];
        if (rk && rk.index > k) {
          report.sealed = false;
          problems.push(ckItem('progression', 'early-ground', 'error', 'Chapter ' + rk.chapter + ' ground can be walked to during chapter ' + chp + ' without the airship.', { record: 'world', chapter: chp, at: i }));
          break;
        }
      }
      report.ok = problems.length === before;
      chapters.push(report);
    });
    return { ok: !problems.length, problems: problems, chapters: chapters, interiors: !!sites };
  }

  // spec: {ow, sites {key: site}, kinds {key: kind}, art (plain), render (ENGINE_RENDER)}. Rules, by what play needs:
  // errors change where a party can walk (water that is walkable, a wall or ridge that is, a door, floor, exit, lock
  // cell, or person's cell that is not, a tile the art lacks); warnings change only drawing or triggering (a wall that
  // does not autotile, a door with no layer above, a dungeon floor without the encounter flag, a building floor with it,
  // a counter without the counter flag, a chest that can be walked through).
  function ckFlags(spec) {
    var R = spec.render, art = spec.art, problems = [], stats = { maps: 0, cells: 0, walls: 0, doors: 0, counters: 0, floors: 0 };
    if (!R || !R.tiles) return { ok: false, problems: [ckItem('flags', 'no-render', 'error', 'The render engine is not available, so no tile can be read.')], stats: stats };
    var T = R.tiles, memoRef = {};
    function res(ref) { if (memoRef[ref] === undefined) memoRef[ref] = ref ? T.resolve(art, ref) : null; return memoRef[ref]; }
    function tally(map, record) {
      var got = {};
      return {
        add: function (code, level, msg, at) { var k = code + '|' + level; if (!got[k]) got[k] = { code: code, level: level, msg: msg, n: 0, at: at }; got[k].n++; },
        flush: function () {
          keys(got).forEach(function (k) {
            var t = got[k];
            problems.push(ckItem('flags', t.code, t.level, t.msg + (t.n > 1 ? ' (' + t.n + ' cells)' : ''), { record: record || 'world', map: map, at: t.at, count: t.n }));
          });
        }
      };
    }
    var ow = spec.ow;
    if (ow) {
      var om = { w: ow.w, h: ow.h, ground: ow.ground, deco: ow.deco }, tl = tally('overworld', spec.overworldRecord), n = ow.w * ow.h, lockCell = {};
      ow.gates.forEach(function (gq) { if (gq.kind === 'lock') lockCell[gq.cells[0]] = 1; });
      stats.maps++;
      for (var i = 0; i < n; i++) {
        stats.cells++;
        var gref = ow.ground[i], dref = ow.deco[i];
        if (!res(gref)) { tl.add('missing-tile', 'broken', 'The overworld uses ' + gref + ', a tile the art does not have.', i); continue; }
        if (dref && !res(dref)) { tl.add('missing-tile', 'broken', 'The overworld uses ' + dref + ', a tile the art does not have.', i); continue; }
        var f = T.flagsAt(art, om, i % ow.w, (i - i % ow.w) / ow.w), st = ow.st[i];
        if (ow.owner[i] < 0) {
          if (f & 1) tl.add('water-walkable', 'error', 'Water on the overworld can be walked on, so the ship is not needed to cross it.', i);
          if (ow.sea[i] && !(f & 4)) tl.add('sea-not-sailable', 'error', 'Sea on the overworld does not carry the swim flag, so the ship cannot sail it.', i);
        } else if (st === ST_WALL || st === ST_GATE && !lockCell[i]) {
          stats.walls++;
          if (f & 5) tl.add('wall-open', 'error', 'A ridge or ring cell of the overworld can be ' + (f & 1 ? 'walked' : 'sailed') + ' over, so a gate could be bypassed.', i);
        } else if (lockCell[i]) {
          if (!(f & 1)) tl.add('lock-blocked', 'error', 'A boss lock cell on the overworld blocks even when open.', i);
        } else if (st === ST_STAMP) {
          if (f & 1) tl.add('stamp-open', 'error', 'A site wall on the overworld can be walked through.', i);
        } else if (st === ST_DOOR) {
          stats.doors++;
          if (!(f & 1)) tl.add('door-blocked', 'error', 'A site entrance on the overworld cannot be walked into.', i);
        }
      }
      if (ow.start != null && !(T.flagsAt(art, om, ow.start % ow.w, (ow.start - ow.start % ow.w) / ow.w) & 1)) tl.add('start-blocked', 'error', 'The start cell of the overworld cannot be stood on.', ow.start);
      ow.sites.forEach(function (s) {
        if (s.stamp === 'cave') return;
        var e = s.entrance, fe = T.flagsAt(art, om, e % ow.w, (e - e % ow.w) / ow.w);
        if (!(fe & 32)) tl.add('door-layer', 'warning', 'A town or dungeon entrance on the overworld has no lintel or arch drawn above the party.', e);
      });
      tl.flush();
    }
    each(spec.sites || {}, function (site, key) {
      var kind = (spec.kinds || {})[key] || site.kind, rec = (spec.records || {})[key] || 'world';
      site.floors.forEach(function (fl) {
        var map = { w: fl.w, h: fl.h, ground: fl.ground, deco: fl.deco }, tl2 = tally(key + '|' + fl.floor, rec), w = fl.w, N = fl.w * fl.h, grid2 = { w: fl.w, h: fl.h, cells: fl.ground };
        stats.maps++;
        function F(c) { return T.flagsAt(art, map, c % w, (c - c % w) / w); }
        for (var c = 0; c < N; c++) {
          stats.cells++;
          var gr = fl.ground[c], dc = fl.deco[c], rg = res(gr);
          if (!rg) { tl2.add('missing-tile', 'broken', key + ' floor ' + fl.floor + ' uses ' + gr + ', a tile the art does not have.', c); continue; }
          if (dc && !res(dc)) { tl2.add('missing-tile', 'broken', key + ' floor ' + fl.floor + ' uses ' + dc + ', a tile the art does not have.', c); continue; }
          var fa = F(c), gk = rg.key, dk = dc ? res(dc).key : null;
          if (gk === 'wall') {
            stats.walls++;
            if (rg.flags & 1) tl2.add('wall-open', 'error', key + ' floor ' + fl.floor + ' has a wall that can be walked through.', c);
            var bi = T.blobIndex(T.mask8(grid2, c % w, (c - c % w) / w, function (a, b2) { return a === b2; }));
            if (!rg.autotile || !(bi >= 0 && bi < 47)) tl2.add('wall-autotile', 'warning', key + ' floor ' + fl.floor + ' has a wall that does not autotile.', c);
          } else if (gk === 'counter') {
            stats.counters++;
            if (fa & 1) tl2.add('counter-open', 'error', key + ' floor ' + fl.floor + ' has a counter that can be walked over.', c);
            if (!(fa & 16)) tl2.add('counter-flag', 'warning', key + ' floor ' + fl.floor + ' has a counter without the counter flag, so no one can be spoken to across it.', c);
          } else if (gk === 'floor' && !dc) {
            stats.floors++;
            if (!(fa & 1)) tl2.add('floor-blocked', 'error', key + ' floor ' + fl.floor + ' has floor that cannot be walked on.', c);
            if (kind === 'town' && (fa & 2)) tl2.add('town-encounter', 'warning', key + ' has building floor carrying the encounter flag (building floors are flag 1).', c);
            if (kind !== 'town' && !(fa & 2)) tl2.add('floor-encounter', 'warning', key + ' floor ' + fl.floor + ' has floor without the encounter flag, so its zone never triggers there.', c);
          }
          if (dk === 'lintel' || dk === 'arch') {
            stats.doors++;
            if (!(fa & 1)) tl2.add('door-blocked', 'error', key + ' floor ' + fl.floor + ' has a door that cannot be walked through.', c);
            if (!(fa & 32)) tl2.add('door-layer', 'warning', key + ' floor ' + fl.floor + ' has a door whose ' + dk + ' is not drawn above the party.', c);
          }
          if (dk === 'chest' && (fa & 1)) tl2.add('chest-open', 'warning', key + ' floor ' + fl.floor + ' has a chest that can be walked through.', c);
        }
        fl.exits.forEach(function (ex) {
          if (!(F(ex.at) & 1)) tl2.add('exit-blocked', 'error', key + ' floor ' + fl.floor + ' has a ' + ex.kind + ' exit that cannot be stood on.', ex.at);
          if (!(F(ex.arrive) & 1)) tl2.add('arrive-blocked', 'error', key + ' floor ' + fl.floor + ' has an arrival cell that cannot be stood on.', ex.arrive);
        });
        fl.features.forEach(function (ft) { if (ft.kind === 'lock' && !(F(ft.at) & 1)) tl2.add('lock-blocked', 'error', key + ' floor ' + fl.floor + ' has a locked door that blocks even when unlocked.', ft.at); });
        site.npcs.forEach(function (p) { if (p.floor === fl.floor && !(F(p.at) & 1)) tl2.add('npc-blocked', 'error', key + ': ' + p.slot + ' stands on a cell that cannot be stood on.', p.at); });
        tl2.flush();
      });
    });
    return { ok: !problems.some(function (p) { return p.level !== 'warning'; }), problems: problems, stats: stats };
  }

  // spec: plain data gathered from the bundle:
  //   records {map_, reg_, npc_, twn_, dgn_: {id: record}}, chapters [chp ids], troops {trp_: {boss}}, tilesets {til_:
  //   kind}, interiorSets {town, dungeon, cave, castle: til_ id} (interiors.palette sets), backgrounds {bgd_: 1}, music
  //   {role ref: mus_} (subject refs such as music:battle), weather {wth_: 1}, sprites {spr_: subject ref}, quests {sdq_: 1},
  //   zones (world.zones or null), graph (world.progression or null), archetypes [names].
  // A missing ID is 'broken'; a missing role or sprite the world needs is an 'error'; anything only cosmetic is a warning.
  function ckRefs(spec) {
    var out = [], R = spec.records || {}, chap = heldOf(spec.chapters), trp = spec.troops || {}, til = spec.tilesets || {}, bg = spec.backgrounds || {};
    var mus = spec.music || {}, wth = spec.weather || {}, spr = spec.sprites || {}, sdq = spec.quests || {}, sets = spec.interiorSets || {}, arch = heldOf(spec.archetypes);
    function has(id) { var p = typeof id === 'string' ? id.slice(0, 4) : ''; return !!(R[p] && R[p][id]); }
    function broken(rec, field, id, what) { out.push(ckItem('refs', 'missing-' + what, 'broken', (rec === 'world' ? 'The world' : rec) + ' refers to ' + what + ' ' + id + ', which does not exist.', { record: rec, field: field, id: id })); }
    function need(rec, field, id, what) { if (id && !has(id)) broken(rec, field, id, what); }
    function needTroop(rec, field, id) { if (id && !trp[id]) broken(rec, field, id, 'troop'); }
    function needChapter(rec, field, id) { if (id && !chap[id]) broken(rec, field, id, 'chapter'); }
    var used = { town: false, dungeon: false, battle: false, boss: false, field: {} };
    each(R.reg_, function (r, id) {
      (r.sites || []).forEach(function (s, k) { need(id, 'sites[' + k + ']', s, 'site'); });
      need(id, 'next', r.next, 'region');
    });
    ['twn_', 'dgn_'].forEach(function (p) {
      each(R[p], function (r, id) {
        need(id, 'region', r.region, 'region');
        if (r.interior) {
          if (['town', 'dungeon', 'cave', 'castle'].indexOf(r.interior) < 0) out.push(ckItem('refs', 'interior-key', 'error', id + ' asks for an interior kind ' + r.interior + ', which no generator makes.', { record: id, field: 'interior' }));
          else if (!sets[r.interior]) out.push(ckItem('refs', 'interior-key', 'error', id + ' is a ' + r.interior + ', but the art has no interior tileset to build it with. Add interior:' + r.interior + ' or interior:dungeon in Art and Audio Forge (Day 147).', { record: id, field: 'interior' }));
          if (r.interior === 'town') used.town = true; else used.dungeon = true;
        }
        if (r.troop) {
          needTroop(id, 'troop', r.troop);
          if (trp[r.troop] && !trp[r.troop].boss) out.push(ckItem('refs', 'boss-not-boss', 'warning', id + ' sets troop ' + r.troop + ' as its boss, but no member of that troop is a boss.', { record: id, field: 'troop' }));
          used.boss = true;
        }
        (r.spareBosses || []).forEach(function (t, k) { needTroop(id, 'spareBosses[' + k + ']', t); });
        (r.maps || []).forEach(function (m, k) { need(id, 'maps[' + k + ']', m, 'map'); });
        (r.people || []).forEach(function (m, k) { need(id, 'people[' + k + ']', m, 'person'); });
        if (r.entrance) need(id, 'entrance.map', r.entrance.map, 'map');
        if (r.overworld) need(id, 'overworld.map', r.overworld.map, 'map');
      });
    });
    each(R.map_, function (m, id) {
      if (m.kind === 'overworld') {
        (m.continents || []).forEach(function (c, k) {
          (c.regions || []).forEach(function (r, q) { need(id, 'continents[' + k + '].regions[' + q + ']', r, 'region'); });
          if (c.continent && (c.regions || []).length) used.field[c.continent] = true;
        });
        (m.regions || []).forEach(function (r, k) { need(id, 'regions[' + k + ']', r.region, 'region'); needChapter(id, 'regions[' + k + '].chapter', r.chapter); });
        (m.sites || []).forEach(function (s, k) {
          need(id, 'sites[' + k + ']', s.site, 'site'); need(id, 'sites[' + k + '].region', s.region, 'region'); needChapter(id, 'sites[' + k + '].chapter', s.chapter);
          if (s.enter) need(id, 'sites[' + k + '].enter.map', s.enter.map, 'map');
        });
        (m.gates || []).forEach(function (gq, k) { need(id, 'gates[' + k + '].region', gq.region, 'region'); need(id, 'gates[' + k + '].from', gq.from, 'region'); });
        ((m.stats || {}).biomes || []).forEach(function (bm, k) {
          if (!til[bm.biome]) broken(id, 'stats.biomes[' + k + ']', bm.biome, 'biome');
          else if (til[bm.biome] !== 'biome') out.push(ckItem('refs', 'not-biome', 'error', id + ' paints ground with ' + bm.biome + ', which is not a biome tileset.', { record: id, field: 'stats.biomes' }));
        });
      } else {
        need(id, 'site', m.site, 'site');
        if (m.tileset) { if (!til[m.tileset]) broken(id, 'tileset', m.tileset, 'tileset'); else if (til[m.tileset] !== 'interior') out.push(ckItem('refs', 'not-interior', 'error', id + ' is drawn with ' + m.tileset + ', which is not an interior tileset.', { record: id, field: 'tileset' })); }
        if (m.outdoor && !til[m.outdoor]) broken(id, 'outdoor', m.outdoor, 'biome');
        if (m.path && !til[String(m.path).split(':')[0]]) broken(id, 'path', m.path, 'tileset');
        (m.exits || []).forEach(function (ex, k) { if (!ex.to) out.push(ckItem('refs', 'exit-nowhere', 'error', id + ' has a ' + ex.kind + ' exit that leads nowhere.', { record: id, field: 'exits[' + k + ']' })); else need(id, 'exits[' + k + '].to.map', ex.to.map, 'map'); });
        (m.people || []).forEach(function (p, k) { need(id, 'people[' + k + ']', p, 'person'); });
        (m.features || []).forEach(function (ft, k) { if (ft.troop) needTroop(id, 'features[' + k + '].troop', ft.troop); });
      }
    });
    each(R.npc_, function (p, id) {
      need(id, 'site', p.site, 'site'); need(id, 'map', p.map, 'map');
      if (p.archetype && spec.archetypes && !arch[p.archetype]) out.push(ckItem('refs', 'archetype', 'warning', id + ' is a ' + p.archetype + ', which is not one of the ten NPC archetypes.', { record: id, field: 'archetype' }));
      // The archetype's sprite is what draws a person: the record's own sprite, else the art's npc:<archetype> role.
      var roleHas = keys(spr).some(function (sid) { return spr[sid] === 'npc:' + p.archetype; });
      if (!p.sprite && !roleHas) out.push(ckItem('refs', 'no-sprite', 'error', (p.name || id) + (p.archetype ? ' has no field sprite: the art has none for the ' + p.archetype + ' archetype. Add an npc:' + p.archetype + ' sprite in Art and Audio Forge (Day 147).' : ' has neither a sprite nor an archetype, so nothing can draw them.'), { record: id, field: 'sprite' }));
      else if (p.sprite && !spr[p.sprite]) broken(id, 'sprite', p.sprite, 'sprite');
      else if (p.sprite && spr[p.sprite] !== 'npc:' + p.archetype) out.push(ckItem('refs', 'sprite-archetype', 'warning', id + ' is a ' + p.archetype + ' drawn with ' + p.sprite + ', whose role is ' + spr[p.sprite] + '.', { record: id, field: 'sprite' }));
      (p.quests || []).forEach(function (q, k) { if (!sdq[q]) broken(id, 'quests[' + k + ']', q, 'side quest'); });
    });
    var z = spec.zones;
    if (z && Array.isArray(z.field)) {
      var fire = function (q) { return !q.empty && (q.rate | 0) > 0 && (q.troops || []).length > 0; };
      z.field.concat(z.interior || []).forEach(function (q) {
        var at = 'zones.' + q.key;
        needChapter('world', at + '.chapter', q.chapter);
        if (q.biome && !til[q.biome]) broken('world', at + '.biome', q.biome, 'biome');
        if (q.region) need('world', at + '.region', q.region, 'region');
        if (q.map) need('world', at + '.map', q.map, 'map');
        if (q.site) need('world', at + '.site', q.site, 'site');
        (q.troops || []).forEach(function (t) { needTroop('world', at + '.troops', t.troop); if (trp[t.troop] && trp[t.troop].boss) out.push(ckItem('refs', 'boss-in-table', 'error', 'Zone ' + q.key + ' draws boss troop ' + t.troop + ' at random.', { record: 'world', field: at })); });
        if (q.background && !bg[q.background]) broken('world', at + '.background', q.background, 'battle background');
        if (!q.background && fire(q)) out.push(ckItem('refs', 'no-background', 'error', 'Zone ' + q.key + ' can start a battle, but no battle background has its role. Add one in Art and Audio Forge (Day 147).', { record: 'world', field: at }));
        if (q.weather && !wth[q.weather]) broken('world', at + '.weather', q.weather, 'weather state');
        if (fire(q)) used.battle = true;
      });
      (z.bosses || []).forEach(function (x, k) {
        var at = 'zones.bosses[' + k + ']';
        need('world', at + '.map', x.map, 'map');
        if (x.site) need('world', at + '.site', x.site, 'site');
        if (x.troop) { needTroop('world', at + '.troop', x.troop); used.boss = true; }
        if (x.background && !bg[x.background]) broken('world', at + '.background', x.background, 'battle background');
        if (!x.background && x.troop) out.push(ckItem('refs', 'no-background', 'error', 'The ' + x.role + ' on ' + x.map + ' has no battle background. Add an interior:dungeon background in Art and Audio Forge (Day 147).', { record: 'world', field: at }));
      });
      if (!keys(wth).length && z.field.length) out.push(ckItem('refs', 'no-weather', 'warning', 'The rules hold no weather states, so every zone plays under no weather.', { record: 'world', field: 'zones' }));
      each(z.givers || {}, function (n, q) { if (!sdq[q]) broken('world', 'zones.givers.' + q, q, 'side quest'); need('world', 'zones.givers.' + q, n, 'person'); });
    }
    var gr = spec.graph;
    if (gr && Array.isArray(gr.nodes)) {
      (gr.chapters || []).forEach(function (c, k) { needChapter('world', 'progression.chapters[' + k + ']', c); });
      gr.nodes.forEach(function (nd) { if (nd.troop) needTroop('world', 'progression.' + nd.key + '.troop', nd.troop); if (nd.record) need('world', 'progression.' + nd.key, nd.record, 'site'); });
    }
    // Music the world plays: each continent's field theme, towns, dungeons, random battles, and bosses.
    function role(r, why) { if (!mus[r]) out.push(ckItem('refs', 'no-music', 'error', 'The world plays music role ' + r + ' ' + why + ', but no music track has that role. Add it in Art and Audio Forge (Day 147).', { record: 'world', field: 'music', id: r })); }
    keys(used.field).forEach(function (c) { role('music:field:' + c, 'on continent ' + c); });
    if (used.town) role('music:town', 'in towns');
    if (used.dungeon) role('music:dungeon', 'in dungeons and caves');
    if (used.battle) role('music:battle', 'in random battles');
    if (used.boss) role('music:boss', 'in boss battles');
    return { ok: !out.some(function (p) { return p.level !== 'warning'; }), problems: out, used: { town: used.town, dungeon: used.dungeon, battle: used.battle, boss: used.boss, field: keys(used.field) } };
  }

  W.checks = { progression: ckProgression, flags: ckFlags, refs: ckRefs, reach: ckReach, landable: ckLandable };
