  // ---------------------------------------------------------------- bake (Phase 8)
  // An optional cache of built tile layers, so Day 150 can draw a map without generating it. Every map stays the product
  // of its seed: the bake is only ever a copy, and it is used only when it provably is one.
  //
  // bake.encode(maps, version) -> baked. maps: [{id, w, h, ground, deco, paramHash}] (any order; they are stored by ID).
  //   baked = {format: 'rle1', generatorVersion, palette [ref], maps {id: {w, h, paramHash, cells, ground, deco}}}.
  //   The palette lists every tile ref the maps use, sorted, once; a layer is a run length string over palette codes,
  //   code 0 for an empty cell and n for palette[n - 1], each run 'c' or 'c*len' in base 36 joined by '.'. cells is the
  //   digest of both layers as refs, so a decoded map is checked against what was baked, cell by cell.
  // bake.decode(baked, id, want) -> {w, h, ground, deco} or null. want = {paramHash, generatorVersion}. Null unless the
  //   format is known, the generator version equals want.generatorVersion (default this engine's version), the entry's
  //   paramHash equals want.paramHash, both layers decode to w * h cells, and the cells digest agrees. bake.why(...) takes
  //   the same arguments and names the first reason a decode would refuse, or null.
  // bake.load(bundle, mapId) -> the decoded map or null: reads bundle.world.baked and the map_ record's paramHash, so the
  //   caller (Day 150) regenerates from the seed whenever this returns null.
  var BAKE_FORMAT = 'rle1';
  function bakeCells(ground, deco) {
    var parts = [], n = ground.length;
    for (var i = 0; i < n; i++) parts.push((ground[i] || '-') + '|' + (deco[i] || '-'));
    return digest(parts);
  }
  function rleEncode(layer, code) {
    var out = [], n = layer.length, i = 0;
    while (i < n) {
      var c = layer[i] ? code[layer[i]] : 0, j = i + 1;
      while (j < n && (layer[j] ? code[layer[j]] : 0) === c) j++;
      out.push(c.toString(36) + (j - i > 1 ? '*' + (j - i).toString(36) : ''));
      i = j;
    }
    return out.join('.');
  }
  function rleDecode(text, palette, n) {
    var out = [], runs = text ? String(text).split('.') : [];
    for (var r = 0; r < runs.length; r++) {
      var p = runs[r].split('*'), c = parseInt(p[0], 36), len = p.length > 1 ? parseInt(p[1], 36) : 1;
      if (!(c >= 0) || !(len >= 1) || c > palette.length || out.length + len > n) return null;
      var v = c ? palette[c - 1] : null;
      for (var q = 0; q < len; q++) out.push(v);
    }
    return out.length === n ? out : null;
  }
  function bakeEncode(maps, version) {
    var seen = {}, byId = {};
    (maps || []).forEach(function (m) {
      byId[m.id] = m;
      for (var i = 0; i < m.ground.length; i++) { if (m.ground[i]) seen[m.ground[i]] = 1; if (m.deco[i]) seen[m.deco[i]] = 1; }
    });
    var palette = keys(seen), code = {}, out = {};
    palette.forEach(function (ref, k) { code[ref] = k + 1; });
    each(byId, function (m, id) {
      out[id] = { w: m.w, h: m.h, paramHash: m.paramHash, cells: bakeCells(m.ground, m.deco), ground: rleEncode(m.ground, code), deco: rleEncode(m.deco, code) };
    });
    return { format: BAKE_FORMAT, generatorVersion: version || W.version, palette: palette, maps: out };
  }
  function bakeWhy(baked, id, want) {
    want = want || {};
    if (!baked || typeof baked !== 'object' || !baked.maps) return 'Nothing is baked.';
    if (baked.format !== BAKE_FORMAT) return 'The bake format ' + baked.format + ' is not ' + BAKE_FORMAT + '.';
    var ver = want.generatorVersion || W.version;
    if (baked.generatorVersion !== ver) return 'The bake was made by generator ' + baked.generatorVersion + ', not ' + ver + '.';
    var e = baked.maps[id];
    if (!e) return 'Map ' + id + ' is not baked.';
    if (!want.paramHash || e.paramHash !== want.paramHash) return 'Map ' + id + ' was baked from other parameters than it has now.';
    var n = (e.w | 0) * (e.h | 0), pal = Array.isArray(baked.palette) ? baked.palette : [];
    var g = rleDecode(e.ground, pal, n), d = g && rleDecode(e.deco, pal, n);
    if (!g || !d) return 'Map ' + id + ' does not decode to ' + e.w + ' by ' + e.h + ' cells.';
    if (bakeCells(g, d) !== e.cells) return 'Map ' + id + ' does not decode to the cells that were baked.';
    return null;
  }
  function bakeDecode(baked, id, want) {
    if (bakeWhy(baked, id, want)) return null;
    var e = baked.maps[id], n = e.w * e.h;
    return { id: id, w: e.w, h: e.h, paramHash: e.paramHash, ground: rleDecode(e.ground, baked.palette, n), deco: rleDecode(e.deco, baked.palette, n), baked: true };
  }
  function bakeLoad(bundle, mapId) {
    var w = bundle && bundle.world, rec = w && w.records && w.records.map_ && w.records.map_[mapId];
    if (!rec) return null;
    return bakeDecode(w.baked, mapId, { paramHash: rec.paramHash, generatorVersion: W.version });
  }
  W.bake = { FORMAT: BAKE_FORMAT, encode: bakeEncode, decode: bakeDecode, why: bakeWhy, load: bakeLoad, cells: bakeCells };
