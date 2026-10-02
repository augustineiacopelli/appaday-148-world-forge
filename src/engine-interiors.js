  // ---------------------------------------------------------------- interiors (Phase 4)
  // Three pure generators, each taking a seed and parameters and returning maps with exits: towns (a Dragon Quest style
  // single map cutaway), built dungeons and castles (binary space partitioning), and caves (cellular automaton). Like the
  // overworld, the art arrives as plain data (interiors.palette below) and nothing outside the spec is read.
  //
  // build(spec) -> site. spec: {seed (the site's sub seed), key (structural site key), kind 'town' | 'dungeon' |
  //   'castle' | 'cave', role (start, town, key, boss, cave...), settings (world.settings), palette, outdoor (the biome
  //   tileset of the overworld cell in front of the site, for town ground), archetypes (NPC archetypes the art has
  //   sprites for), prize (the gate key a key dungeon's last chest holds), troop (a boss node's troop), grants, finale}.
  // site: {key, kind, style, floors [floor], npcs [npc], ok, problems, attempts, digest}.
  // floor: {floor (1 based), w, h, ground [ref], deco [ref or null], exits [{kind 'overworld' | 'up' | 'down', at, arrive,
  //   toFloor}], features [{kind 'chest' | 'lock' | 'boss' | 'stairs', at, ...}], npcs [slot names], buildings, rooms,
  //   stats, digest}. Cells are row major indexes; at is the tile itself and arrive is where a party stands on arrival.
  //
  // Gate keys follow the world's local scheme: a dungeon's own small key is item:key:<site key>; the lock feature needs
  // it, the key chest holds it. Locks are world layer state, like the overworld's gates: the door tile itself reads
  // passable (flag 33 with its arch), and only the feature list says it is shut.
  //
  // NPC slots are named by role, never by seed (inn, shop:item, church, guard1, resident3), and their number depends only
  // on the site's role and settings, so npc_ IDs survive a reroll exactly as map_ IDs do.
  var IN_DEFAULTS = {
    town: { w: 34, h: 28, smallW: 30, smallH: 24, residents: 6, smallResidents: 4, houses: 3, smallHouses: 2 },
    dungeon: { w: 40, h: 30, minLeaf: 7, keyFloors: 1, bossFloors: 2 },
    castle: { w: 46, h: 36, minLeaf: 8, floors: 2 },
    cave: { w: 44, h: 32, fill: 0.45, steps: 5, floors: 1 },
    attempts: 8
  };
  var ARCHETYPES = ['elder', 'child', 'merchant', 'guard', 'worker', 'scholar', 'healer', 'traveler', 'noble', 'innkeeper'];
  // Residents are drawn by weight; innkeepers, merchants, the priest (a healer), and guards have fixed posts.
  var RESIDENT_WEIGHTS = [['elder', 2], ['child', 3], ['merchant', 1], ['worker', 3], ['scholar', 2], ['healer', 1], ['traveler', 2], ['noble', 1]];
  // Building footprints, walls included. The door is on the bottom wall at column dx.
  var BUILDINGS = {
    inn: { w: 9, h: 6, dx: 4 }, shop: { w: 6, h: 5, dx: 2 }, church: { w: 7, h: 7, dx: 3 }, house: { w: 5, h: 5, dx: 2 }
  };
  var SHOP_KINDS = ['item', 'weapon', 'armor'];

  function inSettings(s) {
    s = s || {};
    var o = s.interiors || {}, t = o.town || {}, d = o.dungeon || {}, c = o.castle || {}, v = o.cave || {}, D = IN_DEFAULTS;
    function n(x, def, a, b) { x = x == null || x === '' ? NaN : Number(x); return isFinite(x) ? clamp(Math.floor(x), a, b) : def; }
    function f(x, def, a, b) { x = x == null || x === '' ? NaN : Number(x); return isFinite(x) ? clamp(x, a, b) : def; }
    return {
      town: { w: n(t.w, D.town.w, 26, 64), h: n(t.h, D.town.h, 22, 64), smallW: n(t.smallW, D.town.smallW, 24, 64), smallH: n(t.smallH, D.town.smallH, 20, 64),
        residents: n(t.residents, D.town.residents, 0, 16), smallResidents: n(t.smallResidents, D.town.smallResidents, 0, 16),
        houses: n(t.houses, D.town.houses, 0, 8), smallHouses: n(t.smallHouses, D.town.smallHouses, 0, 8) },
      dungeon: { w: n(d.w, D.dungeon.w, 24, 96), h: n(d.h, D.dungeon.h, 20, 96), minLeaf: n(d.minLeaf, D.dungeon.minLeaf, 6, 16),
        keyFloors: n(d.keyFloors, D.dungeon.keyFloors, 1, 5), bossFloors: n(d.bossFloors, D.dungeon.bossFloors, 1, 5) },
      castle: { w: n(c.w, D.castle.w, 28, 96), h: n(c.h, D.castle.h, 24, 96), minLeaf: n(c.minLeaf, D.castle.minLeaf, 6, 16), floors: n(c.floors, D.castle.floors, 1, 5) },
      cave: { w: n(v.w, D.cave.w, 24, 96), h: n(v.h, D.cave.h, 20, 96), fill: f(v.fill, D.cave.fill, 0.3, 0.6), steps: n(v.steps, D.cave.steps, 1, 10), floors: n(v.floors, D.cave.floors, 1, 5) },
      attempts: n(o.attempts, D.attempts, 1, 16)
    };
  }

  // palette(art): the interior sets and the biomes a town stands on, as plain data. A set falls back exactly as the
  // overworld's stamps do: castles and caves to the dungeon set, towns to whichever interior exists. A tile key a set
  // lacks falls back to the same key in the dungeon set, then the town set. sets[kind].refs maps tile key -> ref.
  var IN_KEYS = ['floor', 'wall', 'door', 'stairs', 'counter', 'table', 'barrel', 'bed', 'shelf', 'rug', 'plant', 'lintel', 'pillar', 'torch', 'chest', 'arch'];
  function inPalette(art) {
    var recs = art && art.records && art.records.til_ || {}, flags = {}, ins = {}, biomes = [], problems = [];
    keys(recs).forEach(function (id) {
      var t = recs[id];
      if (!t) return;
      if (t.kind === 'biome') { flags[id] = Number(t.flags) | 0; biomes.push({ id: id, key: t.key || null, flags: flags[id], climate: t.climate || null }); }
      if (t.kind === 'interior' && t.subject && typeof t.subject.ref === 'string' && t.subject.ref.indexOf('interior:') === 0) { var k = t.subject.ref.slice(9); if (!ins[k]) ins[k] = t; }
    });
    function tileKeys(til) { var has = {}; (til && til.tiles || []).forEach(function (it) { if (it && it.key) { has[it.key] = it; flags[til.id + ':' + it.key] = Number(it.flags) | 0; } }); return has; }
    var dun = ins.dungeon || ins.town || null, town = ins.town || dun, own = {
      town: town, dungeon: dun, cave: ins.cave || dun, castle: ins.castle || dun
    }, sets = {};
    var hasD = tileKeys(dun), hasT = tileKeys(town);
    each(own, function (til, kind) {
      if (!til) return;
      var has = tileKeys(til), refs = {};
      IN_KEYS.forEach(function (k) {
        refs[k] = has[k] ? til.id + ':' + k : hasD[k] && dun ? dun.id + ':' + k : hasT[k] && town ? town.id + ':' + k : null;
      });
      if (!refs.wall || !refs.floor || !refs.door || !(flags[refs.door] & 1) || !(flags[refs.floor] & 1) || (flags[refs.wall] & 1)) problems.push({ code: 'set', message: 'Interior tileset ' + til.id + ' needs a passable floor, a passable door, and a wall that blocks, for the ' + kind + ' maps.' });
      sets[kind] = { til: til.id, own: til.id, refs: refs };
    });
    if (!dun) problems.push({ code: 'no-interior', message: 'No interior tileset exists, so no town or dungeon can be built.' });
    // The church altar borrows the dungeon set's counter (Day 147 labels it Altar) when there is one.
    var altar = hasD.counter && dun ? dun.id + ':counter' : sets.town ? sets.town.refs.counter : null;
    // Town ground: passable dry biomes. The path is the desert biome when there is one.
    var dry = biomes.filter(function (bm) { return (bm.flags & 1) && !(bm.flags & 4) && !(bm.flags & 8) && bm.climate && !bm.climate.feature; });
    var desert = dry.filter(function (bm) { return bm.key === 'desert'; })[0] || null;
    var low = dry.filter(function (bm) { var e = bm.climate.elev; return e && e[0] <= 2 && e[1] >= 2; }), pref = ['grassland', 'steppe', 'forest'];
    low.sort(function (x, y) { var px = pref.indexOf(x.key), py = pref.indexOf(y.key); return (px < 0 ? 9 : px) - (py < 0 ? 9 : py) || (x.id < y.id ? -1 : 1); });
    var lowland = low[0] || dry[0] || null;
    return { sets: sets, flags: flags, altar: altar, desert: desert ? desert.id : null, lowland: lowland ? lowland.id : null, dry: dry.map(function (bm) { return bm.id; }), problems: problems,
      digest: digest([altar, desert ? desert.id : '-', lowland ? lowland.id : '-'].concat(keys(sets).map(function (k) { return k + '=' + sets[k].til + '/' + IN_KEYS.map(function (q) { return sets[k].refs[q] || '-'; }).join(','); }))) };
  }

  // ---------------------------------------------------------------- shared helpers
  function grid(w, h, fill) { var g = new Array(w * h); for (var i = 0; i < g.length; i++) g[i] = fill; return g; }
  function flagOf(pal, ref) { return ref ? pal.flags[ref] | 0 : 0; }
  function cellFlags(pal, fl, i) { var d = fl.deco[i]; return d ? flagOf(pal, d) : flagOf(pal, fl.ground[i]); }
  // Walkable cells of a floor: passable flags, minus locks the party has no key for.
  function inWalk(pal, fl, held) {
    var shut = {};
    fl.features.forEach(function (ft) { if (ft.kind === 'lock' && !(held && held[ft.requires[0]])) shut[ft.at] = 1; });
    return function (i) { return !shut[i] && (cellFlags(pal, fl, i) & 1) === 1; };
  }
  function reachFrom(pal, fl, from, held) { return bfs(fl.w, fl.h, [from], inWalk(pal, fl, held)); }
  function floorDigest(fl) {
    var parts = [fl.w, fl.h];
    for (var i = 0; i < fl.ground.length; i++) parts.push((fl.ground[i] || '-') + '|' + (fl.deco[i] || '-'));
    fl.features.forEach(function (ft) { parts.push(ft.kind + '@' + ft.at); });
    fl.exits.forEach(function (ex) { parts.push(ex.kind + '@' + ex.at + '>' + ex.arrive); });
    return digest(parts);
  }
  function nbOpen(fl, i, ok) { return nb4(i, fl.w, fl.h).filter(ok); }
  function setDeco(fl, i, ref) { if (ref) fl.deco[i] = ref; }

  // ---------------------------------------------------------------- towns
  // A single map cutaway: a ring of town wall with a two cell gate in the bottom row, a plaza of path tiles, a street
  // from the plaza to the gate, then prefab buildings placed around the plaza in seeded order, each door joined to the
  // plaza by an L shaped path (a shortest path when both L shapes are blocked). Outdoor ground is the biome of the
  // site's overworld cell; building floors are the town set's floor (flag 1), so nothing triggers inside a town.
  function genTown(spec, S, pal, R, attempt) {
    var small = spec.role !== 'start', T = S.town, set = pal.sets.town, t = set.refs;
    var w = (small ? T.smallW : T.w) + attempt * 2, h = (small ? T.smallH : T.h) + attempt * 2, n = w * h;
    var outdoor = spec.outdoor && pal.dry.indexOf(spec.outdoor) >= 0 ? spec.outdoor : pal.lowland || t.floor;
    var path = pal.desert && pal.desert !== outdoor ? pal.desert : t.floor;
    var fl = { w: w, h: h, ground: grid(w, h, outdoor), deco: grid(w, h, null), exits: [], features: [], npcList: [], buildings: [], rooms: [], stats: {} };
    var P = [], occ = new Int16Array(n), x, y, i;
    for (i = 0; i < n; i++) occ[i] = -1;
    // Ring wall and gate.
    for (x = 0; x < w; x++) { fl.ground[x] = t.wall; fl.ground[(h - 1) * w + x] = t.wall; }
    for (y = 0; y < h; y++) { fl.ground[y * w] = t.wall; fl.ground[y * w + w - 1] = t.wall; }
    var gx = (w >> 1) - 1;
    [gx, gx + 1].forEach(function (cx) { var c = (h - 1) * w + cx; fl.ground[c] = path; fl.exits.push({ kind: 'overworld', at: c, arrive: c - w, toFloor: null }); });
    // Plaza and street. Reserved cells (ring, plaza, street, plus a one cell margin) never hold a building.
    var pw = 6, ph = 4, px = (w >> 1) - 3, py = Math.floor(h * 0.5) - 1, reserved = new Uint8Array(n);
    function reserve(x0, y0, x1, y1) { for (var yy = y0; yy <= y1; yy++) for (var xx = x0; xx <= x1; xx++) if (xx >= 0 && yy >= 0 && xx < w && yy < h) reserved[yy * w + xx] = 1; }
    for (y = py; y < py + ph; y++) for (x = px; x < px + pw; x++) fl.ground[y * w + x] = path;
    for (y = py + ph; y < h - 1; y++) { fl.ground[y * w + gx] = path; fl.ground[y * w + gx + 1] = path; }
    reserve(px - 1, py - 1, px + pw, py + ph); reserve(gx - 1, py + ph, gx + 2, h - 1);
    for (x = 0; x < w; x++) { reserved[w + x] = 1; reserved[(h - 2) * w + x] = 1; }
    for (y = 0; y < h; y++) { reserved[y * w + 1] = 1; reserved[y * w + w - 2] = 1; }
    for (i = 0; i < n; i++) if (fl.ground[i] === t.wall) reserved[i] = 1;
    var pcx = px + (pw >> 1), pcy = py + (ph >> 1);
    // Buildings, essentials first. The rect plus a one cell margin must be clear; the door's front cell stays outdoors.
    var plan = [['inn', 'inn']].concat((small ? ['item'] : SHOP_KINDS).map(function (k) { return ['shop', 'shop:' + k]; }), [['church', 'church']]);
    for (var hq = 1; hq <= (small ? T.smallHouses : T.houses); hq++) plan.push(['house', 'house' + hq]);
    function fits(bx, by, bw, bh) {
      if (bx < 2 || by < 2 || bx + bw > w - 2 || by + bh > h - 3) return false;
      for (var yy = by - 1; yy <= by + bh; yy++) for (var xx = bx - 1; xx <= bx + bw; xx++) { var c = yy * w + xx; if (occ[c] >= 0) return false; if (yy >= by && yy < by + bh && xx >= bx && xx < bx + bw && reserved[c]) return false; }
      return true;
    }
    plan.forEach(function (pl) {
      var B = BUILDINGS[pl[0]], cands = [];
      for (var by = 2; by + B.h <= h - 3; by++) for (var bx = 2; bx + B.w <= w - 2; bx++) {
        if (!fits(bx, by, B.w, B.h)) continue;
        var dxp = bx + B.dx, dyp = by + B.h, score = pl[0] === 'house' ? R() * 40 : Math.abs(dxp - pcx) + Math.abs(dyp - pcy) + R() * 6;
        cands.push({ x: bx, y: by, s: score });
      }
      cands.sort(function (a, b) { return a.s - b.s || a.y - b.y || a.x - b.x; });
      // Houses may be dropped only after three attempts at growing the map for them.
      if (!cands.length) { if (pl[0] !== 'house' || attempt < 3) P.push({ code: 'town-room', message: 'No room for the ' + pl[1] + ' in ' + spec.key + '.' }); return; }
      var pick = R.pick(cands.slice(0, Math.min(6, cands.length))), k = fl.buildings.length;
      for (var yy = pick.y; yy < pick.y + B.h; yy++) for (var xx = pick.x; xx < pick.x + B.w; xx++) occ[yy * w + xx] = k;
      fl.buildings.push({ kind: pl[0], slot: pl[1], x: pick.x, y: pick.y, w: B.w, h: B.h, door: (pick.y + B.h - 1) * w + pick.x + B.dx, front: (pick.y + B.h) * w + pick.x + B.dx });
    });
    // Draw each building and its furnishings; record the fixed NPC posts.
    var posts = [];
    fl.buildings.forEach(function (bd) {
      function at(dx, dy) { return (bd.y + dy) * w + bd.x + dx; }
      for (var dy = 0; dy < bd.h; dy++) for (var dx = 0; dx < bd.w; dx++) fl.ground[at(dx, dy)] = dy === 0 || dx === 0 || dy === bd.h - 1 || dx === bd.w - 1 ? t.wall : t.floor;
      fl.ground[bd.door] = t.door; setDeco(fl, bd.door, t.lintel);
      bd.counters = [];
      function counter(dx, dy, ref) { var c = at(dx, dy); fl.ground[c] = ref || t.counter; bd.counters.push(c); }
      if (bd.kind === 'inn') {
        counter(1, 2); counter(2, 2); counter(3, 2);
        setDeco(fl, at(4, 1), t.shelf); setDeco(fl, at(5, 1), t.bed); setDeco(fl, at(6, 1), t.bed); setDeco(fl, at(7, 1), t.bed);
        setDeco(fl, at(1, 4), t.barrel); setDeco(fl, at(4, 4), t.rug);
        posts.push({ slot: 'inn', archetype: 'innkeeper', role: 'innkeeper', at: at(2, 1), facing: 'down', wander: false, building: bd.slot, counter: at(2, 2) });
      } else if (bd.kind === 'shop') {
        for (var cx2 = 1; cx2 <= 4; cx2++) counter(cx2, 2);
        setDeco(fl, at(1, 1), t.shelf); setDeco(fl, at(3, 1), t.shelf); setDeco(fl, at(4, 1), t.barrel);
        posts.push({ slot: bd.slot, archetype: 'merchant', role: bd.slot, at: at(2, 1), facing: 'down', wander: false, building: bd.slot, counter: at(2, 2) });
      } else if (bd.kind === 'church') {
        counter(2, 2, pal.altar); counter(3, 2, pal.altar); counter(4, 2, pal.altar);
        setDeco(fl, at(1, 1), t.plant); setDeco(fl, at(5, 1), t.plant);
        setDeco(fl, at(1, 4), t.table); setDeco(fl, at(2, 4), t.table); setDeco(fl, at(4, 4), t.table); setDeco(fl, at(5, 4), t.table);
        setDeco(fl, at(3, 4), t.rug); setDeco(fl, at(3, 5), t.rug);
        posts.push({ slot: 'church', archetype: 'healer', role: 'priest', at: at(3, 1), facing: 'down', wander: false, building: bd.slot, counter: at(3, 2) });
      } else {
        setDeco(fl, at(1, 1), t.bed); setDeco(fl, at(3, 1), t.table); setDeco(fl, at(3, 3), t.barrel);
        bd.home = at(2, 2);
      }
    });
    // Paths from every door front to the plaza: an L shape when one is clear, else a shortest path over open ground.
    function outdoorCell(c) { return occ[c] < 0 && fl.ground[c] !== t.wall; }
    function clampTo(v, a, b) { return v < a ? a : v > b ? b : v; }
    fl.buildings.forEach(function (bd) {
      var fx = bd.front % w, fy = (bd.front - fx) / w, tx = clampTo(fx, px, px + pw - 1), ty = clampTo(fy, py, py + ph - 1), cells;
      function lPath(horizFirst) {
        var out = [], xx = fx, yy = fy;
        out.push(yy * w + xx);
        if (horizFirst) { while (xx !== tx) { xx += xx < tx ? 1 : -1; out.push(yy * w + xx); } while (yy !== ty) { yy += yy < ty ? 1 : -1; out.push(yy * w + xx); } }
        else { while (yy !== ty) { yy += yy < ty ? 1 : -1; out.push(yy * w + xx); } while (xx !== tx) { xx += xx < tx ? 1 : -1; out.push(yy * w + xx); } }
        return out.every(outdoorCell) ? out : null;
      }
      var first = R.chance(0.5);
      cells = lPath(first) || lPath(!first);
      if (!cells) {
        var d = bfs(w, h, [ty * w + tx], outdoorCell);
        if (d[bd.front] < 0) { P.push({ code: 'town-path', message: 'The ' + bd.slot + ' door cannot be joined to the plaza in ' + spec.key + '.' }); return; }
        cells = [bd.front];
        var c = bd.front;
        while (d[c] > 0) { c = nb4(c, w, h).filter(function (q) { return d[q] === d[c] - 1; })[0]; cells.push(c); }
      }
      cells.forEach(function (q) { fl.ground[q] = path; });
      bd.path = cells.length;
    });
    // Planters on open ground away from every path, door, and the gate, each kept only if nothing is cut off.
    var walk = inWalk(pal, fl, null), arrive = fl.exits[0].arrive;
    function reachCount() { var d = bfs(w, h, [arrive], walk), k = 0; for (var q = 0; q < n; q++) if (d[q] >= 0) k++; return k; }
    var openSpots = [];
    for (i = 0; i < n; i++) {
      if (fl.ground[i] !== outdoor || occ[i] >= 0 || reserved[i] || fl.deco[i]) continue;
      var near = false;
      for (var dy3 = -1; dy3 <= 1 && !near; dy3++) for (var dx3 = -1; dx3 <= 1 && !near; dx3++) { var q3 = i + dy3 * w + dx3; if (q3 >= 0 && q3 < n && (fl.ground[q3] === path || occ[q3] >= 0)) near = true; }
      if (!near) openSpots.push(i);
    }
    var base = reachCount(), planters = 0;
    R.shuffle(openSpots).slice(0, 10).forEach(function (c) {
      if (planters >= 6 || !t.plant) return;
      fl.deco[c] = t.plant;
      if (reachCount() !== base - 1) fl.deco[c] = null; else { base--; planters++; }
    });
    // People: fixed posts, two gate guards, then residents (one at home per house, the rest outdoors).
    var dist = bfs(w, h, [arrive], walk), taken = {};
    posts.forEach(function (p) { taken[p.at] = 1; });
    [[gx - 1, h - 2, 'guard1'], [gx + 2, h - 2, 'guard2']].forEach(function (gd) {
      var c = gd[1] * w + gd[0];
      if (dist[c] < 0) c = nb4(c, w, h).concat([c - w]).filter(function (q) { return dist[q] >= 0 && !taken[q]; })[0];
      if (c == null) { P.push({ code: 'town-guard', message: 'No post for ' + gd[2] + ' in ' + spec.key + '.' }); return; }
      taken[c] = 1;
      posts.push({ slot: gd[2], archetype: 'guard', role: 'guard', at: c, facing: 'down', wander: false, building: null });
    });
    var allowed = RESIDENT_WEIGHTS.filter(function (rw) { return !spec.archetypes || spec.archetypes.indexOf(rw[0]) >= 0; });
    if (!allowed.length) allowed = RESIDENT_WEIGHTS;
    var homes = fl.buildings.filter(function (bd) { return bd.home != null; }), gates = {};
    fl.exits.forEach(function (ex) { gates[ex.arrive] = 1; gates[ex.at] = 1; });
    var spots = [];
    for (i = 0; i < n; i++) if (dist[i] >= 0 && occ[i] < 0 && !taken[i] && !gates[i] && fl.ground[i] !== t.door && i % w > 2 && i % w < w - 3 && Math.floor(i / w) < h - 3) spots.push(i);
    spots = R.shuffle(spots);
    var fronts = {};
    fl.buildings.forEach(function (bd) { fronts[bd.front] = 1; });
    var residents = small ? T.smallResidents : T.residents;
    for (var rq = 1; rq <= residents; rq++) {
      var arch = allowed[R.weighted(allowed.map(function (rw) { return rw[1]; }))][0], home = homes[rq - 1], c4 = null;
      if (home && !taken[home.home]) c4 = home.home;
      while (c4 == null && spots.length) { var sp = spots.pop(); if (!taken[sp] && !fronts[sp]) c4 = sp; }
      if (c4 == null) { P.push({ code: 'town-people', message: 'No room for resident ' + rq + ' in ' + spec.key + '.' }); continue; }
      taken[c4] = 1;
      posts.push({ slot: 'resident' + rq, archetype: arch, role: 'resident', at: c4, facing: 'down', wander: !home || c4 !== home.home, building: home && c4 === home.home ? home.slot : null });
    }
    fl.npcList = posts;
    fl.stats = { buildings: fl.buildings.length, houses: fl.buildings.filter(function (bd) { return bd.kind === 'house'; }).length, planters: planters, outdoor: outdoor, path: path };
    fl.plaza = [px, py, pw, ph];
    return { floors: [fl], problems: P };
  }

  // ---------------------------------------------------------------- built dungeons and castles
  // Binary space partitioning to a minimum leaf, one room per leaf (inset one cell, at least 3 by 3), siblings joined by
  // L corridors between their nearest rooms, every other cell wall. Floor 1 opens on the bottom edge through an arched
  // door; deeper floors are joined by stairs (down in the room farthest from the arrival, up in the room nearest where
  // the stairs above stood). The last floor holds, in breadth first order from the arrival, the key chest (in the
  // farthest room reachable while the lock is shut), the locked door (the single way into the goal room, other entries
  // walled up), and the goal: the boss, or the prize chest of a key dungeon. Dead end rooms may hold treasure chests.
  function bspSplit(R, root, ml) {
    var leaves = [], tree = [];
    function split(nd) {
      var canV = nd.w >= 2 * ml, canH = nd.h >= 2 * ml;
      if (!canV && !canH || nd.w < 3 * ml && nd.h < 3 * ml && R.chance(0.2)) { nd.leaf = leaves.length; leaves.push(nd); return nd; }
      var vert = canV && canH ? (nd.w > nd.h * 1.2 ? true : nd.h > nd.w * 1.2 ? false : R.chance(0.5)) : canV;
      var cut = vert ? R.range(ml, nd.w - ml) : R.range(ml, nd.h - ml);
      nd.a = split(vert ? { x: nd.x, y: nd.y, w: cut, h: nd.h } : { x: nd.x, y: nd.y, w: nd.w, h: cut });
      nd.b = split(vert ? { x: nd.x + cut, y: nd.y, w: nd.w - cut, h: nd.h } : { x: nd.x, y: nd.y + cut, w: nd.w, h: nd.h - cut });
      tree.push(nd);
      return nd;
    }
    split(root);
    return { leaves: leaves, root: root };
  }
  function roomCenter(r, w) { return (r.y + (r.h >> 1)) * w + r.x + (r.w >> 1); }
  function inRoom(r, i, w) { var x = i % w, y = (i - x) / w; return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h; }
  function genBuiltFloor(spec, S, pal, R, attempt, fi, nFloors, prevStairs) {
    var style = spec.kind === 'castle' ? 'castle' : 'dungeon', C = style === 'castle' ? S.castle : S.dungeon, set = pal.sets[style] || pal.sets.dungeon, t = set.refs;
    var w = C.w + attempt * 2, h = C.h + attempt * 2, n = w * h, ml = C.minLeaf, P = [];
    var fl = { w: w, h: h, ground: grid(w, h, t.wall), deco: grid(w, h, null), exits: [], features: [], npcList: [], buildings: [], rooms: [], stats: {} };
    var tree = bspSplit(R, { x: 0, y: 0, w: w, h: h }, ml);
    tree.leaves.forEach(function (lf) {
      var maxW = lf.w - 2, maxH = lf.h - 2, rw = R.range(Math.max(3, Math.floor(maxW * 0.6)), maxW), rh = R.range(Math.max(3, Math.floor(maxH * 0.6)), maxH);
      var r = { x: lf.x + 1 + R.int(maxW - rw + 1), y: lf.y + 1 + R.int(maxH - rh + 1), w: rw, h: rh, leaf: [lf.x, lf.y, lf.w, lf.h] };
      fl.rooms.push(r);
      for (var y = r.y; y < r.y + r.h; y++) for (var x = r.x; x < r.x + r.w; x++) fl.ground[y * w + x] = t.floor;
    });
    // Corridors: at every split, the nearest pair of rooms across it is joined by an L.
    function roomsUnder(nd) { return nd.leaf != null ? [nd.leaf] : roomsUnder(nd.a).concat(roomsUnder(nd.b)); }
    function carve(a, b) {
      var ax = a % w, ay = (a - ax) / w, bx = b % w, by = (b - bx) / w, x = ax, y = ay;
      function put() { if (fl.ground[y * w + x] !== t.floor) fl.ground[y * w + x] = t.floor; }
      if (R.chance(0.5)) { while (x !== bx) { x += x < bx ? 1 : -1; put(); } while (y !== by) { y += y < by ? 1 : -1; put(); } }
      else { while (y !== by) { y += y < by ? 1 : -1; put(); } while (x !== bx) { x += x < bx ? 1 : -1; put(); } }
    }
    var links = 0;
    (function join(nd) {
      if (nd.leaf != null) return;
      join(nd.a); join(nd.b);
      var A = roomsUnder(nd.a), B = roomsUnder(nd.b), best = null, bd = Infinity;
      A.forEach(function (ia) { B.forEach(function (ib) { var ca = roomCenter(fl.rooms[ia], w), cb = roomCenter(fl.rooms[ib], w), d = Math.abs(ca % w - cb % w) + Math.abs(Math.floor(ca / w) - Math.floor(cb / w)); if (d < bd) { bd = d; best = [ca, cb]; } }); });
      carve(best[0], best[1]); links++;
    })(tree.root);
    var isFloor = function (i) { return fl.ground[i] === t.floor; };
    // Arrival: floor 1 through a door in the bottom edge, deeper floors by up stairs.
    var arrival, arrRoom;
    if (fi === 1) {
      arrRoom = fl.rooms.map(function (r, k) { return k; }).sort(function (a, b) { var ra = fl.rooms[a], rb = fl.rooms[b]; return (h - ra.y - ra.h) - (h - rb.y - rb.h) || Math.abs(ra.x + (ra.w >> 1) - (w >> 1)) - Math.abs(rb.x + (rb.w >> 1) - (w >> 1)) || a - b; })[0];
      var er = fl.rooms[arrRoom], ex = er.x + (er.w >> 1);
      for (var yy = er.y + er.h; yy < h - 1; yy++) fl.ground[yy * w + ex] = t.floor;
      var door = (h - 1) * w + ex;
      fl.ground[door] = t.door; setDeco(fl, door, t.arch);
      arrival = door - w;
      fl.exits.push({ kind: 'overworld', at: door, arrive: arrival, toFloor: null });
    } else {
      var px0 = prevStairs % w, py0 = (prevStairs - px0) / w;
      arrRoom = fl.rooms.map(function (r, k) { return k; }).sort(function (a, b) { var ca = roomCenter(fl.rooms[a], w), cb = roomCenter(fl.rooms[b], w); return Math.abs(ca % w - px0) + Math.abs(Math.floor(ca / w) - py0) - (Math.abs(cb % w - px0) + Math.abs(Math.floor(cb / w) - py0)) || a - b; })[0];
      var up = roomCenter(fl.rooms[arrRoom], w);
      fl.ground[up] = t.stairs;
      arrival = up + w;
      fl.exits.push({ kind: 'up', at: up, arrive: arrival, toFloor: fi - 1 });
      fl.features.push({ kind: 'stairs', at: up, dir: 'up' });
    }
    var dist = bfs(w, h, [arrival], function (i) { return (flagOf(pal, fl.ground[i]) & 1) === 1; });
    var order = fl.rooms.map(function (r, k) { return k; }).filter(function (k) { return k !== arrRoom; }).sort(function (a, b) { return dist[roomCenter(fl.rooms[b], w)] - dist[roomCenter(fl.rooms[a], w)] || a - b; });
    if (!order.length) return { fl: fl, problems: [{ code: 'rooms', message: spec.key + ' floor ' + fi + ' has a single room.' }] };
    var used = {};
    used[arrival] = 1;
    fl.exits.forEach(function (ex2) { used[ex2.at] = 1; });
    function entries(r) {
      var out = [];
      for (var y = r.y - 1; y <= r.y + r.h; y++) for (var x = r.x - 1; x <= r.x + r.w; x++) {
        var i = y * w + x;
        if (x < 0 || y < 0 || x >= w || y >= h || inRoom(r, i, w) || !isFloor(i) && fl.ground[i] !== t.door) continue;
        if ((x >= r.x && x < r.x + r.w) || (y >= r.y && y < r.y + r.h)) out.push(i);
      }
      return out;
    }
    // A chest against a wall inside a room, whose outer neighbors are wall, kept only when every other floor cell stays
    // reachable from the arrival.
    function placeChest(r, held, extra) {
      var cand = [], k;
      for (var y = r.y; y < r.y + r.h; y++) for (var x = r.x; x < r.x + r.w; x++) {
        var i = y * w + x, edge = y === r.y || x === r.x || x === r.x + r.w - 1;
        if (!edge || used[i] || fl.ground[i] !== t.floor || fl.deco[i]) continue;
        if (nb4(i, w, h).some(function (q) { return !inRoom(r, q, w) && fl.ground[q] !== t.wall; })) continue;
        cand.push(i);
      }
      cand.sort(function (a, b) { var ay = Math.floor(a / w), by = Math.floor(b / w); return ay - by || Math.abs(a % w - (r.x + (r.w >> 1))) - Math.abs(b % w - (r.x + (r.w >> 1))) || a - b; });
      for (k = 0; k < cand.length; k++) {
        var c = cand[k], before = 0, after = 0, d0 = reachFrom(pal, fl, arrival, held), q;
        for (q = 0; q < n; q++) if (d0[q] >= 0) before++;
        fl.deco[c] = t.chest;
        var d1 = reachFrom(pal, fl, arrival, held);
        for (q = 0; q < n; q++) if (d1[q] >= 0) after++;
        if (after === before - 1 && nb4(c, w, h).some(function (q2) { return d1[q2] >= 0; })) { used[c] = 1; var ft = { kind: 'chest', at: c }; keys(extra || {}).forEach(function (kk) { ft[kk] = extra[kk]; }); fl.features.push(ft); return ft; }
        fl.deco[c] = null;
      }
      return null;
    }
    var deadEnds = function () { return order.filter(function (k) { return entries(fl.rooms[k]).length === 1; }); };
    if (fi < nFloors) {
      // Down stairs in the farthest room.
      var dr = order[0], down = roomCenter(fl.rooms[dr], w);
      fl.ground[down] = t.stairs;
      fl.exits.push({ kind: 'down', at: down, arrive: down + w, toFloor: fi + 1 });
      fl.features.push({ kind: 'stairs', at: down, dir: 'down' });
      used[down] = 1; used[down + w] = 1;
      var de = deadEnds().filter(function (k) { return k !== dr; });
      if (de.length) placeChest(fl.rooms[de[0]], null, { item: null, treasure: true });
    } else {
      // The goal room: the farthest room that can be given exactly one way in.
      var lockKey = 'item:key:' + spec.key, goal = null, lock = null;
      for (var gi = 0; gi < order.length && goal == null; gi++) {
        var r = fl.rooms[order[gi]], E = entries(r);
        if (!E.length) continue;
        E.sort(function (a, b) { return (dist[a] < 0 ? 1e9 : dist[a]) - (dist[b] < 0 ? 1e9 : dist[b]) || a - b; });
        var keep = E[0], sealed = E.slice(1), saved = sealed.map(function (c) { return fl.ground[c]; });
        sealed.forEach(function (c) { fl.ground[c] = t.wall; });
        // With the kept entry shut, every floor cell outside the goal room must still be reachable from the arrival
        // (orphaned corridor stubs are walled up); with it open, the goal room must be reachable.
        var shutWalk = function (i) { return i !== keep && (flagOf(pal, fl.ground[i]) & 1) === 1; };
        var d2 = bfs(w, h, [arrival], shutWalk), ok = true, stubs = [];
        for (var q = 0; q < n && ok; q++) {
          if (!isFloor(q) || d2[q] >= 0 || q === keep || inRoom(r, q, w)) continue;
          if (fl.rooms.some(function (rr, kk) { return inRoom(rr, q, w); })) ok = false; else stubs.push(q);
        }
        if (ok && d2[keep] < 0 && !nb4(keep, w, h).some(function (q4) { return d2[q4] >= 0; })) ok = false;
        if (!ok || order[gi] === arrRoom) { sealed.forEach(function (c, k2) { fl.ground[c] = saved[k2]; }); continue; }
        stubs.forEach(function (c) { fl.ground[c] = t.wall; });
        goal = order[gi]; lock = keep;
      }
      if (goal == null) return { fl: fl, problems: [{ code: 'goal', message: 'No room on the last floor of ' + spec.key + ' can be locked.' }] };
      fl.ground[lock] = t.door; setDeco(fl, lock, t.arch);
      used[lock] = 1;
      fl.features.push({ kind: 'lock', at: lock, requires: [lockKey], room: goal });
      var gr = fl.rooms[goal];
      // The key chest: the farthest room reachable while the lock is shut.
      var dShut = reachFrom(pal, fl, arrival, null);
      var keyRooms = order.filter(function (k) { return k !== goal && dShut[roomCenter(fl.rooms[k], w)] >= 0; }).concat([arrRoom]);
      var keyChest = null;
      for (var kr = 0; kr < keyRooms.length && !keyChest; kr++) keyChest = placeChest(fl.rooms[keyRooms[kr]], null, { item: lockKey, opens: lock });
      if (!keyChest) return { fl: fl, problems: [{ code: 'key', message: 'No place for the key chest in ' + spec.key + '.' }] };
      var held = {};
      held[lockKey] = true;
      if (spec.role === 'boss' || spec.kind === 'castle') {
        var bc = roomCenter(gr, w);
        used[bc] = 1;
        var bossF = { kind: 'boss', at: bc, troop: spec.troop || null, grants: (spec.grants || []).slice(), finale: !!spec.finale };
        fl.features.push(bossF);
      } else {
        var prize = placeChest(gr, held, { item: spec.prize || null, prize: true });
        if (!prize) return { fl: fl, problems: [{ code: 'prize', message: 'No place for the prize chest in ' + spec.key + '.' }] };
      }
      var de2 = deadEnds().filter(function (k) { return k !== goal && fl.rooms[k] && !fl.features.some(function (ft2) { return ft2.kind === 'chest' && inRoom(fl.rooms[k], ft2.at, w); }); });
      if (de2.length) placeChest(fl.rooms[de2[0]], held, { item: null, treasure: true });
    }
    // Torches on north walls, and pillars in the inset corners of large castle rooms; each kept only if nothing is cut off.
    var walkAll = function () { var hh = {}; hh['item:key:' + spec.key] = true; return reachFrom(pal, fl, arrival, hh); };
    var base = 0, d5 = walkAll(), q5;
    for (q5 = 0; q5 < n; q5++) if (d5[q5] >= 0) base++;
    fl.rooms.forEach(function (r2) {
      if (t.torch) for (var x = r2.x + 1; x < r2.x + r2.w - 1; x += 3) { var c = (r2.y - 1) * w + x; if (r2.y > 0 && fl.ground[c] === t.wall && !fl.deco[c]) fl.deco[c] = t.torch; }
      if (style === 'castle' && t.pillar && r2.w >= 5 && r2.h >= 5) {
        [[1, 1], [r2.w - 2, 1], [1, r2.h - 2], [r2.w - 2, r2.h - 2]].forEach(function (o) {
          var c = (r2.y + o[1]) * w + r2.x + o[0];
          if (used[c] || fl.ground[c] !== t.floor || fl.deco[c] || fl.features.some(function (ft3) { return ft3.at === c || nb4(ft3.at, w, h).indexOf(c) >= 0; })) return;
          fl.ground[c] = t.pillar;
          var d6 = walkAll(), cnt = 0;
          for (var q6 = 0; q6 < n; q6++) if (d6[q6] >= 0) cnt++;
          if (cnt !== base - 1) fl.ground[c] = t.floor; else base--;
        });
      }
    });
    fl.stats = { rooms: fl.rooms.length, links: links, leaves: tree.leaves.map(function (lf) { return [lf.w, lf.h]; }) };
    fl.arrival = arrival;
    return { fl: fl, problems: P };
  }

  // ---------------------------------------------------------------- caves
  // Random fill near 45 percent inside a wall border, then the 4-5 rule (a cell becomes wall when five or more of the nine
  // cells around and including it are wall) for a few steps. The largest open region is the cave; each stranded pocket of
  // three or more cells is tunneled to its nearest main region cell, pockets taken in order of their first cell; smaller
  // pockets are filled. Stairs lead in near the bottom; the farthest corner holds a treasure chest.
  function genCaveFloor(spec, S, pal, R, attempt, fi, nFloors, prevStairs) {
    var C = S.cave, set = pal.sets.cave || pal.sets.dungeon, t = set.refs, w = C.w + attempt * 2, h = C.h + attempt * 2, n = w * h, x, y, i;
    var fl = { w: w, h: h, ground: grid(w, h, t.wall), deco: grid(w, h, null), exits: [], features: [], npcList: [], buildings: [], rooms: [], stats: {} };
    var wall = new Uint8Array(n), seeded = 0, interior = (w - 2) * (h - 2);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { i = y * w + x; wall[i] = x === 0 || y === 0 || x === w - 1 || y === h - 1 || R.chance(C.fill) ? 1 : 0; if (wall[i] && x > 0 && y > 0 && x < w - 1 && y < h - 1) seeded++; }
    for (var step = 0; step < C.steps; step++) {
      var nx = new Uint8Array(n);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { nx[i] = 1; continue; }
        var c = 0;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) c += wall[i + dy * w + dx];
        nx[i] = c >= 5 ? 1 : 0;
      }
      wall = nx;
    }
    var comp = components(w, h, function (q) { return !wall[q]; }), best = -1, bs = 0;
    comp.sizes.forEach(function (s2, k) { if (s2 > bs) { bs = s2; best = k; } });
    if (best < 0 || bs < interior * 0.2) return { fl: fl, problems: [{ code: 'cave-small', message: 'The cave of ' + spec.key + ' came out too small.' }] };
    var main = new Uint8Array(n), first = [], tunnels = 0, filled = 0;
    for (i = 0; i < n; i++) { var lb = comp.label[i]; if (lb === best) main[i] = 1; else if (lb >= 0 && first[lb] == null) first[lb] = i; }
    first.forEach(function (start, k) {
      if (start == null || k === best) return;
      if (comp.sizes[k] < 3) { for (var q = 0; q < n; q++) if (comp.label[q] === k) wall[q] = 1; filled++; return; }
      var src = [];
      for (var q2 = 0; q2 < n; q2++) if (comp.label[q2] === k) src.push(q2);
      var d = bfs(w, h, src, function (j) { var jx = j % w, jy = (j - jx) / w; return jx > 0 && jy > 0 && jx < w - 1 && jy < h - 1; }), target = -1, td = Infinity;
      for (var q3 = 0; q3 < n; q3++) if (main[q3] && d[q3] >= 0 && d[q3] < td) { td = d[q3]; target = q3; }
      if (target < 0) return;
      var c2 = target;
      while (d[c2] > 0) { wall[c2] = 0; main[c2] = 1; c2 = nb4(c2, w, h).filter(function (j) { return d[j] === d[c2] - 1; })[0]; }
      src.forEach(function (j) { main[j] = 1; });
      tunnels++;
    });
    for (i = 0; i < n; i++) if (!wall[i] && main[i]) fl.ground[i] = t.floor; else fl.ground[i] = t.wall;
    var isF = function (q) { return fl.ground[q] === t.floor; };
    // Stairs in: floor 1 near the bottom middle, deeper floors near where the stairs above stood.
    var tx = fi === 1 ? w >> 1 : prevStairs % w, ty = fi === 1 ? h - 1 : Math.floor(prevStairs / w), sIn = -1, sd = Infinity;
    for (i = 0; i < n; i++) {
      if (!isF(i)) continue;
      var ix = i % w, iy = (i - ix) / w, dd = Math.abs(ix - tx) * 2 + Math.abs(iy - ty) * 3;
      if (dd < sd && nb4(i, w, h).filter(isF).length >= 2) { sd = dd; sIn = i; }
    }
    if (sIn < 0) return { fl: fl, problems: [{ code: 'cave-stairs', message: 'No place for the stairs in ' + spec.key + '.' }] };
    var arr = nb4(sIn, w, h).filter(isF).sort(function (a, b) { return (b - sIn === -w ? 1 : 0) - (a - sIn === -w ? 1 : 0) || a - b; })[0];
    fl.ground[sIn] = t.stairs;
    fl.exits.push(fi === 1 ? { kind: 'overworld', at: sIn, arrive: arr, toFloor: null } : { kind: 'up', at: sIn, arrive: arr, toFloor: fi - 1 });
    fl.features.push({ kind: 'stairs', at: sIn, dir: fi === 1 ? 'out' : 'up' });
    var dist = reachFrom(pal, fl, arr, null), far = [];
    for (i = 0; i < n; i++) if (dist[i] > 0 && i !== sIn) far.push(i);
    far.sort(function (a, b) { return dist[b] - dist[a] || a - b; });
    if (fi < nFloors) {
      var down = -1;
      for (var k3 = 0; k3 < far.length && down < 0; k3++) { var cd = far[k3]; var o = nb4(cd, w, h).filter(function (q) { return isF(q) && q !== sIn; }); if (o.length >= 1) down = cd; }
      if (down < 0) return { fl: fl, problems: [{ code: 'cave-stairs', message: 'No place for the stairs down in ' + spec.key + '.' }] };
      var darr = nb4(down, w, h).filter(isF)[0];
      fl.ground[down] = t.stairs;
      fl.exits.push({ kind: 'down', at: down, arrive: darr, toFloor: fi + 1 });
      fl.features.push({ kind: 'stairs', at: down, dir: 'down' });
    }
    // The treasure chest: the farthest cell whose chest cuts nothing off.
    var walk = inWalk(pal, fl, null), total = 0, d0 = bfs(w, h, [arr], walk);
    for (i = 0; i < n; i++) if (d0[i] >= 0) total++;
    var stairsAt = {};
    fl.exits.forEach(function (ex) { stairsAt[ex.at] = 1; stairsAt[ex.arrive] = 1; });
    for (var k4 = 0; k4 < far.length && k4 < 200; k4++) {
      var c3 = far[k4];
      if (stairsAt[c3] || !isF(c3)) continue;
      fl.deco[c3] = t.chest;
      var d1 = bfs(w, h, [arr], inWalk(pal, fl, null)), cnt = 0;
      for (i = 0; i < n; i++) if (d1[i] >= 0) cnt++;
      if (cnt === total - 1) { fl.features.push({ kind: 'chest', at: c3, item: null, treasure: true }); break; }
      fl.deco[c3] = null;
    }
    var open = 0;
    for (i = 0; i < n; i++) if (isF(i)) open++;
    fl.stats = { seededFill: seeded / interior, open: open / interior, pockets: comp.sizes.length - 1, tunnels: tunnels, filled: filled };
    fl.arrival = arr;
    return { fl: fl, problems: [] };
  }

  // ---------------------------------------------------------------- build, check
  function siteFloors(spec, S) {
    if (spec.kind === 'town') return 1;
    if (spec.kind === 'castle') return S.castle.floors;
    if (spec.kind === 'cave') return S.cave.floors;
    return spec.role === 'boss' ? S.dungeon.bossFloors : S.dungeon.keyFloors;
  }
  function inAttempt(spec, S, pal, attempt) {
    var P = [], floors = [];
    function R(fi) { return rng(hashStr((spec.seed >>> 0) + '|' + attempt + '|' + fi)); }
    if (spec.kind === 'town') {
      var tr = genTown(spec, S, pal, R(1), attempt);
      floors = tr.floors; P = tr.problems;
    } else {
      var nF = siteFloors(spec, S), prev = null;
      for (var fi = 1; fi <= nF && !P.length; fi++) {
        var r = spec.kind === 'cave' ? genCaveFloor(spec, S, pal, R(fi), attempt, fi, nF, prev) : genBuiltFloor(spec, S, pal, R(fi), attempt, fi, nF, prev);
        r.problems.forEach(function (p) { P.push(p); });
        floors.push(r.fl);
        var dn = r.fl.exits.filter(function (ex) { return ex.kind === 'down'; })[0];
        prev = dn ? dn.at : null;
      }
    }
    floors.forEach(function (fl, k) { fl.floor = k + 1; });
    var site = { key: spec.key, kind: spec.kind, role: spec.role || null, style: spec.kind, attempt: attempt, floors: floors, problems: P };
    site.npcs = [];
    floors.forEach(function (fl) { fl.npcList.forEach(function (p) { site.npcs.push({ slot: p.slot, archetype: p.archetype, role: p.role, floor: fl.floor, at: p.at, facing: p.facing, wander: p.wander, building: p.building, counter: p.counter == null ? null : p.counter }); }); fl.npcs = fl.npcList.map(function (p) { return p.slot; }); delete fl.npcList; });
    if (!P.length) inCheck(site, pal).forEach(function (p) { P.push(p); });
    site.ok = !P.length;
    floors.forEach(function (fl) { fl.digest = floorDigest(fl); });
    site.digest = digest(floors.map(function (fl) { return fl.digest; }).concat(site.npcs.map(function (p) { return p.slot + '@' + p.floor + ':' + p.at + ':' + p.archetype; })));
    return site;
  }
  function inBuild(spec) {
    var S = inSettings(spec.settings), pal = spec.palette, last = null;
    if (!pal || !pal.sets || !pal.sets.dungeon) throw new Error('interiors.build needs interiors.palette(art) with at least one interior tileset.');
    if (['town', 'dungeon', 'castle', 'cave'].indexOf(spec.kind) < 0) throw new Error('Unknown interior kind: ' + spec.kind);
    for (var a = 0; a < S.attempts; a++) { last = inAttempt(spec, S, pal, a); if (last.ok) break; }
    last.attempts = last.attempt + 1;
    return last;
  }
  // The walking check of one site. For each floor: every exit's arrival is reachable from the floor's first arrival
  // (holding every key); stairs pair up between floors; on a locked floor the key chest and the lock's near side are
  // reachable while the lock is shut, the goal is not, and with the key it is; every chest has a reachable side; every
  // other floor cell is reachable with the key (nothing walled off by accident). Towns: every door, counter front, and
  // the plaza are reachable from the gate, and every fixed NPC post stands on a floor or behind its counter.
  function inCheck(site, pal) {
    var out = [];
    site.floors.forEach(function (fl, k) {
      var w = fl.w, h = fl.h, n = w * h, first = fl.exits[0];
      if (!first) { out.push({ code: 'no-exit', message: site.key + ' floor ' + fl.floor + ' has no way in.' }); return; }
      var all = {}, lock = fl.features.filter(function (ft) { return ft.kind === 'lock'; })[0];
      if (lock) all[lock.requires[0]] = true;
      var dAll = reachFrom(pal, fl, first.arrive, all);
      fl.exits.forEach(function (ex) {
        if (dAll[ex.arrive] < 0) out.push({ code: 'exit', message: site.key + ' floor ' + fl.floor + ': the ' + ex.kind + ' exit cannot be reached.' });
        if (ex.toFloor != null) {
          var other = site.floors[ex.toFloor - 1];
          if (!other || !other.exits.some(function (e2) { return e2.toFloor === fl.floor && e2.kind === (ex.kind === 'down' ? 'up' : 'down'); })) out.push({ code: 'stairs', message: site.key + ' floor ' + fl.floor + ': its ' + ex.kind + ' stairs have no partner.' });
        }
      });
      function sideReach(d, c) { return nb4(c, w, h).some(function (q) { return d[q] >= 0; }); }
      fl.features.forEach(function (ft) { if (ft.kind === 'chest' && !sideReach(dAll, ft.at)) out.push({ code: 'chest', message: site.key + ' floor ' + fl.floor + ': a chest cannot be reached.' }); });
      var built = (site.kind === 'dungeon' || site.kind === 'castle') && k === site.floors.length - 1;
      if (built && !lock) out.push({ code: 'no-lock', message: site.key + ': the last floor has no locked door.' });
      if (lock) {
        var dShut = reachFrom(pal, fl, first.arrive, null), kc = fl.features.filter(function (ft) { return ft.kind === 'chest' && ft.item === lock.requires[0]; })[0];
        var goal = fl.features.filter(function (ft) { return ft.kind === 'boss' || ft.kind === 'chest' && ft.prize; })[0];
        if (!kc || !sideReach(dShut, kc.at)) out.push({ code: 'key-after-lock', message: site.key + ': the key chest cannot be reached before the lock.' });
        if (!sideReach(dShut, lock.at)) out.push({ code: 'lock', message: site.key + ': the locked door cannot be reached.' });
        if (!goal) out.push({ code: 'goal', message: site.key + ': the last floor has no goal.' });
        else {
          var gAt = goal.at;
          if (goal.kind === 'boss' ? dShut[gAt] >= 0 : sideReach(dShut, gAt)) out.push({ code: 'lock-open', message: site.key + ': the goal can be reached without the key.' });
          if (goal.kind === 'boss' ? dAll[gAt] < 0 : !sideReach(dAll, gAt)) out.push({ code: 'goal', message: site.key + ': the goal cannot be reached even with the key.' });
        }
      }
      if (site.kind === 'town') {
        (fl.buildings || []).forEach(function (bd) {
          if (dAll[bd.front] < 0 || dAll[bd.door] < 0 || dAll[bd.door - w] < 0) out.push({ code: 'door', message: site.key + ': the ' + bd.slot + ' cannot be entered.' });
          (bd.counters || []).forEach(function (c) { if (dAll[c + w] < 0) out.push({ code: 'counter', message: site.key + ': a counter in the ' + bd.slot + ' cannot be reached.' }); });
        });
        var pz = fl.plaza;
        if (pz && dAll[(pz[1] + 1) * w + pz[0] + 1] < 0) out.push({ code: 'plaza', message: site.key + ': the plaza cannot be reached from the gate.' });
      } else {
        for (var i = 0; i < n; i++) if ((flagOf(pal, fl.ground[i]) & 1) && !fl.deco[i] && dAll[i] < 0) { out.push({ code: 'orphan', message: site.key + ' floor ' + fl.floor + ' has floor that cannot be reached.' }); break; }
      }
    });
    site.npcs.forEach(function (p) {
      var fl = site.floors[p.floor - 1], f = fl ? cellFlags(pal, fl, p.at) : 0;
      if (!(f & 1)) out.push({ code: 'npc', message: site.key + ': ' + p.slot + ' stands on a wall.' });
    });
    return out;
  }
  // The NPC slots a site will have, from its kind, role, and settings alone (never the seed), so callers can name records
  // before building.
  function inSlots(spec) {
    if (spec.kind !== 'town') return [];
    var S = inSettings(spec.settings), small = spec.role !== 'start', out = ['inn'].concat((small ? ['item'] : SHOP_KINDS).map(function (k) { return 'shop:' + k; }), ['church', 'guard1', 'guard2']);
    for (var r = 1; r <= (small ? S.town.smallResidents : S.town.residents); r++) out.push('resident' + r);
    return out;
  }
  W.interiors = { DEFAULTS: IN_DEFAULTS, ARCHETYPES: ARCHETYPES, RESIDENT_WEIGHTS: RESIDENT_WEIGHTS, BUILDINGS: BUILDINGS, KEYS: IN_KEYS,
    settings: inSettings, palette: inPalette, floors: function (spec) { return siteFloors(spec, inSettings(spec.settings)); }, slots: inSlots,
    build: inBuild, check: inCheck, walk: function (pal, fl, held) { return inWalk(pal, fl, held); }, reach: reachFrom };
