  // ---------------------------------------------------------------- encounter zones (Phase 5)
  // Encounter tables for the overworld and every dungeon, castle, and cave floor, plus the boss and guardian encounters
  // and the side quest givers. Pure: the bundle arrives as plain data (the WORLD side builds the spec) and nothing outside
  // the spec is read.
  //
  // Field zones are keyed by continent slug, chapter, and biome key (zone|field|<continent>|<chp>|<biome key>) and are
  // built only from overworld cells whose ground carries flag 2. DECISION: the chapter is part of the key because troops
  // belong to chapters, so a continent shared by two chapters has one table per chapter and biome (the cell's region
  // names its chapter). Interior zones are one per floor map (zone|<site key>|<floor>). Towns have none. Every key is
  // structural, so a reroll moves cells between zones but never renames one.
  //
  // A table fills four slots in FF6's pattern, weights in sixteenths 5, 5, 5, 1: the rare slot holds the strongest
  // non boss troop of the chapter, the three common slots cycle through the others in an order shuffled by the zone key
  // (not the seed), so different biomes of one chapter draw different mixes and a reroll keeps every table's troops.
  // Duplicate slots merge their weights. A rate in 256ths per step comes from the biome (or interior kind), scaled up
  // through the chapters and down the floors of a dungeon.
  var ZN_DEFAULTS = {
    slots: [5, 5, 5, 1],
    rates: { grassland: 8, steppe: 8, coast: 6, forest: 12, rainforest: 14, swamp: 14, desert: 12, tundra: 10, snow: 12, volcanic: 16, mountain: 6, default: 10 },
    interiorRates: { dungeon: 12, castle: 10, cave: 14 },
    chapterScale: 0.5, floorScale: 0.15
  };
  // Weather keywords matched against a wth_ record's name and realWorld text, tried in order; the first wth_ is the fallback.
  var WEATHER_HINTS = {
    snow: ['snow', 'blizzard', 'frost', 'ice', 'hail'], tundra: ['snow', 'frost', 'cold', 'wind'], mountain: ['wind', 'snow', 'clear'],
    rainforest: ['rain', 'storm', 'mist', 'fog'], swamp: ['fog', 'mist', 'rain'], forest: ['mist', 'rain', 'clear'],
    desert: ['sand', 'dust', 'heat', 'sun', 'clear'], volcanic: ['ash', 'ember', 'smoke', 'heat'], steppe: ['wind', 'dust', 'clear'],
    coast: ['wind', 'fog', 'rain', 'clear'], ocean: ['storm', 'rain', 'wind'], grassland: ['clear', 'sun', 'fair'],
    interior: ['clear', 'calm', 'still', 'none'], default: ['clear', 'fair', 'sun']
  };
  function znNum(v, d, a, b) { v = v == null || v === '' ? NaN : Number(v); return isFinite(v) ? clamp(v, a, b) : d; }
  function znSettings(s) {
    var z = s && s.zones || {}, rates = {}, ir = {}, sl = Array.isArray(z.slots) && z.slots.length === 4 ? z.slots.map(function (v) { return Math.floor(znNum(v, 0, 0, 16)); }) : ZN_DEFAULTS.slots.slice();
    each(ZN_DEFAULTS.rates, function (v, k) { rates[k] = v; });
    each(z.rates, function (v, k) { rates[k] = Math.floor(znNum(v, rates[k] == null ? ZN_DEFAULTS.rates.default : rates[k], 0, 255)); });
    each(ZN_DEFAULTS.interiorRates, function (v, k) { ir[k] = v; });
    each(z.interiorRates, function (v, k) { ir[k] = Math.floor(znNum(v, ir[k] == null ? ZN_DEFAULTS.interiorRates.dungeon : ir[k], 0, 255)); });
    return { slots: sl, rates: rates, interiorRates: ir, chapterScale: znNum(z.chapterScale, ZN_DEFAULTS.chapterScale, 0, 4), floorScale: znNum(z.floorScale, ZN_DEFAULTS.floorScale, 0, 2) };
  }
  function fieldKey(continent, chapter, biomeKey) { return 'zone|field|' + continent + '|' + chapter + '|' + biomeKey; }
  function interiorKey(siteKey, floor) { return 'zone|' + siteKey + '|' + floor; }
  function round(v) { return Math.floor(v + 0.5); }

  // A troop's strength: the sum of its members' levels (tier x 5 when a level is missing), then hit points to break ties.
  function troopPower(trp, enm) {
    var lv = 0, hp = 0;
    ((trp && trp.members) || []).forEach(function (m) {
      var e = enm && m && enm[m.enm];
      if (!e) return;
      lv += Number(e.level) > 0 ? Number(e.level) : (Number(e.tier) > 0 ? Number(e.tier) * 5 : 1);
      hp += Number(e.stats && e.stats.hp) > 0 ? Number(e.stats.hp) : 0;
    });
    return lv * 100000 + Math.min(hp, 99999);
  }
  function troopIsBoss(trp, enm) { return ((trp && trp.members) || []).some(function (m) { return !!(enm && m && enm[m.enm] && enm[m.enm].isBoss); }); }
  function byPower(a, b) { return b.power - a.power || (a.troop < b.troop ? -1 : a.troop > b.troop ? 1 : 0); }

  // slots(troops [{troop, power}], key, settings) -> {slots [4 troop IDs], troops [{troop, weight}], rare}.
  function znSlots(troops, key, S) {
    S = S || znSettings({});
    var list = (troops || []).slice().sort(byPower);
    if (!list.length) return { slots: [], troops: [], rare: null };
    var rare = list[0].troop, pool = list.slice(1).map(function (t) { return t.troop; }).sort();
    if (!pool.length) pool = [rare];
    var order = rng(hashStr('zone|' + key)).shuffle(pool), slots = [];
    for (var k = 0; k < 3; k++) slots.push(order[k % order.length]);
    slots.push(rare);
    var weights = {}, seen = [];
    slots.forEach(function (t, k) { if (weights[t] == null) { weights[t] = 0; seen.push(t); } weights[t] += S.slots[k]; });
    return { slots: slots, troops: seen.map(function (t) { return { troop: t, weight: weights[t] }; }).filter(function (x) { return x.weight > 0; }), rare: rare };
  }
  // weatherFor(hintKey, weather [{weather, name, text}]) -> wth_ ID or null.
  function weatherFor(hint, weather) {
    weather = weather || [];
    if (!weather.length) return null;
    var words = WEATHER_HINTS[hint] || WEATHER_HINTS.default;
    for (var k = 0; k < words.length; k++) {
      for (var j = 0; j < weather.length; j++) {
        var hay = (String(weather[j].name || '') + ' ' + String(weather[j].text || '')).toLowerCase();
        if (hay.indexOf(words[k]) >= 0) return weather[j].weather;
      }
    }
    return weather[0].weather;
  }
  // The field zone a cell of a built overworld belongs to, or null when it carries no flag 2 (water, walls, stamps).
  // biomes: {tileset ID: biome key}. Day 150 uses this at run time to find the table for the cell a party steps on.
  function znCellKey(ow, i, biomes) {
    var g = ow.ground[i];
    if (!g || String(g).indexOf(':') >= 0 || !((ow.flags[g] | 0) & 2)) return null;
    var r = ow.region[i];
    if (r == null || r < 0 || !ow.regions[r]) return null;
    var reg = ow.regions[r];
    return fieldKey(reg.continent, reg.chapter, biomes && biomes[g] || g);
  }
  // Field zone tallies of a built overworld: [{key, continent, chapter, region (region key), biome, biomeKey, cells}].
  function znFieldCells(ow, biomes) {
    var tally = {}, n = ow.ground.length;
    for (var i = 0; i < n; i++) {
      var k = znCellKey(ow, i, biomes);
      if (!k) continue;
      var z = tally[k];
      if (!z) { var reg = ow.regions[ow.region[i]]; z = tally[k] = { key: k, continent: reg.continent, chapter: reg.chapter, region: reg.key, biome: ow.ground[i], biomeKey: biomes && biomes[ow.ground[i]] || ow.ground[i], cells: 0 }; }
      z.cells++;
    }
    return keys(tally).map(function (k) { return tally[k]; });
  }
  // Cells of an interior floor that carry flag 2 (the decoration's flags when there is one, as the walk does).
  function znFloorCells(fl, flags) {
    var c = 0;
    for (var i = 0; i < fl.ground.length; i++) { var r = fl.deco[i] || fl.ground[i]; if (r && ((flags[r] | 0) & 2)) c++; }
    return c;
  }

  // build(spec) -> {field [zone], interior [zone], bosses [encounter], warnings, digest}.
  // spec: {settings (world.settings), chapters [{chapter, continent, troops [{troop, power}] (non boss), bosses [trp_]}]
  //   in story order, field (fieldCells output, plus region (the reg_ ID) and ref (biome:<key>)), interiors [{key (site
  //   key), site, map, kind, chapter, floor, floors, cells, ref (interior:<kind> of the tileset drawn with)}],
  //   backgrounds {subject ref: bgd_}, weather [{weather, name, text}] in rules order, bossSites [{site, map, at, troop,
  //   chapter, ref, finale}], spareSlots [{chapter, site, map, at, ref, kind}] in preference order, overrides {zone key:
  //   {rate, weights {trp_: n}}}}.
  // zone: {key, kind 'field' | 'interior', continent, chapter, region, biome, biomeKey, site, map, floor, cells, rate,
  //   baseRate, slots, troops [{troop, weight}], rare, background, weather, music 'battle', empty, overridden}.
  function znBuild(spec) {
    var S = znSettings(spec.settings), chap = {}, N = (spec.chapters || []).length, warnings = [], bg = spec.backgrounds || {}, ov = spec.overrides || {};
    (spec.chapters || []).forEach(function (c, k) { chap[c.chapter] = { index: k, c: c }; });
    function scale(chapter) { var ci = chap[chapter]; return 1 + S.chapterScale * (ci && N > 1 ? ci.index / (N - 1) : 0); }
    function zone(base, kind, hint, rateBase, floor) {
      var ci = chap[base.chapter], troops = ci ? ci.c.troops || [] : [], sl = znSlots(troops, base.key, S);
      var rate = clamp(round(rateBase * scale(base.chapter) * (1 + S.floorScale * ((floor || 1) - 1))), 0, 255);
      var bgd = bg[base.ref] || null;
      if (!bgd && kind === 'interior' && bg['interior:dungeon']) bgd = bg['interior:dungeon'];
      var z = { key: base.key, kind: kind, continent: base.continent || (ci ? ci.c.continent : null), chapter: base.chapter, region: base.region || null,
        biome: base.biome || null, biomeKey: base.biomeKey || null, site: base.site || null, map: base.map || null, floor: floor || null,
        cells: base.cells | 0, rate: rate, baseRate: rateBase, slots: sl.slots, troops: sl.troops, rare: sl.rare, background: bgd,
        weather: weatherFor(hint, spec.weather), music: 'battle', empty: !sl.troops.length, overridden: false };
      var o = ov[base.key];
      if (o && typeof o === 'object') {
        if (o.rate != null && isFinite(Number(o.rate))) { z.rate = clamp(Math.floor(Number(o.rate)), 0, 255); z.overridden = true; }
        if (o.weights && typeof o.weights === 'object') {
          z.troops = z.troops.map(function (t) { var w = o.weights[t.troop]; return w == null || !isFinite(Number(w)) ? t : { troop: t.troop, weight: clamp(Math.floor(Number(w)), 0, 255) }; });
          z.overridden = true;
        }
      }
      if (!ci) warnings.push({ code: 'no-chapter', zone: z.key, message: 'Zone ' + z.key + ' belongs to no chapter of the Charter.' });
      else if (z.empty) warnings.push({ code: 'no-troops', zone: z.key, chapter: z.chapter, message: 'Chapter ' + z.chapter + ' has no troop without a boss for zone ' + z.key + ', so it never triggers a battle. Add troops in Saga Forge (Day 146).' });
      if (!z.background) warnings.push({ code: 'no-background', zone: z.key, message: 'No battle background has the role ' + base.ref + ' for zone ' + z.key + '.' });
      return z;
    }
    var field = (spec.field || []).slice().sort(function (a, b) { return a.key < b.key ? -1 : 1; }).map(function (f) {
      var r = S.rates[f.biomeKey]; return zone(f, 'field', WEATHER_HINTS[f.biomeKey] ? f.biomeKey : 'default', r == null ? S.rates.default : r, null);
    });
    var interior = (spec.interiors || []).map(function (m) {
      var r = S.interiorRates[m.kind]; return zone({ key: interiorKey(m.key, m.floor), chapter: m.chapter, site: m.site, map: m.map, cells: m.cells, ref: m.ref }, 'interior', 'interior', r == null ? S.interiorRates.dungeon : r, m.floor);
    }).sort(function (a, b) { return a.key < b.key ? -1 : 1; });
    // Bosses: each boss feature keeps its troop. Spare boss troops of a chapter (more than one) guard its optional caves'
    // treasure, then its key dungeon's prize, in the order the slots arrive.
    var bosses = [], used = {};
    (spec.bossSites || []).forEach(function (s) {
      if (s.troop) used[s.troop] = 1;
      bosses.push({ role: 'boss', site: s.site, map: s.map, at: s.at, troop: s.troop || null, chapter: s.chapter, background: bg[s.ref] || bg['interior:dungeon'] || null, music: 'boss', finale: !!s.finale });
    });
    (spec.chapters || []).forEach(function (c) {
      var spare = (c.bosses || []).filter(function (t) { return !used[t]; }).sort();
      var slots = (spec.spareSlots || []).filter(function (s) { return s.chapter === c.chapter; });
      spare.forEach(function (t, k) {
        var s = slots[k];
        if (!s) { warnings.push({ code: 'spare-boss', chapter: c.chapter, troop: t, message: 'Boss troop ' + t + ' of chapter ' + c.chapter + ' has nowhere to stand: the chapter has no free cave or key dungeon chest to guard.' }); return; }
        used[t] = 1;
        bosses.push({ role: 'guardian', site: s.site, map: s.map, at: s.at, troop: t, chapter: c.chapter, background: bg[s.ref] || bg['interior:dungeon'] || null, music: 'boss', finale: false, guards: s.kind });
      });
    });
    var parts = [];
    field.concat(interior).forEach(function (z) { parts.push(z.key, z.rate, z.background || '-', z.weather || '-', z.troops.map(function (t) { return t.troop + '*' + t.weight; }).join(',')); });
    bosses.forEach(function (x) { parts.push(x.role, x.site, x.map, String(x.at), x.troop || '-'); });
    return { field: field, interior: interior, bosses: bosses, warnings: warnings, digest: digest(parts) };
  }

  // givers(spec) -> {assign {sdq_: npc_}, warnings}. spec: {chapters [chp_ in story order], quests [{quest, chapter,
  //   keep (an npc_ to leave in place, or null)}], people [{npc, chapter, town (order of its town), slot, role}]}.
  // Each quest takes a person in a town of its own chapter, residents first, then anyone but innkeepers, merchants,
  // and the priest, then anyone; within those, the person giving the fewest quests so far, then the earliest town and
  // slot. A chapter with no townsfolk borrows the nearest chapter's, earlier first. Quests go in ID order.
  function slotCmp(a, b) {
    var ma = /^(.*?)(\d+)$/.exec(a), mb = /^(.*?)(\d+)$/.exec(b);
    if (ma && mb && ma[1] === mb[1]) return Number(ma[2]) - Number(mb[2]);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  var POSTED = { innkeeper: 1, priest: 1 };
  function tier(p) { return p.role === 'resident' ? 0 : POSTED[p.role] || /^shop:/.test(p.role || '') ? 2 : 1; }
  function znGivers(spec) {
    var order = spec.chapters || [], at = {}, people = (spec.people || []).slice(), count = {}, assign = {}, warnings = [];
    order.forEach(function (c, k) { at[c] = k; });
    people.sort(function (a, b) { return tier(a) - tier(b) || (a.town | 0) - (b.town | 0) || slotCmp(String(a.slot), String(b.slot)) || (a.npc < b.npc ? -1 : 1); });
    people.forEach(function (p) { count[p.npc] = 0; });
    (spec.quests || []).forEach(function (q) { if (q.keep && count[q.keep] != null) count[q.keep]++; });
    function poolFor(ch) {
      var own = people.filter(function (p) { return p.chapter === ch; });
      if (own.length || at[ch] == null) return own;
      for (var d = 1; d < order.length; d++) {
        var e = order[at[ch] - d], l = order[at[ch] + d];
        var pe = e ? people.filter(function (p) { return p.chapter === e; }) : [], pl = l ? people.filter(function (p) { return p.chapter === l; }) : [];
        if (pe.length) return pe;
        if (pl.length) return pl;
      }
      return [];
    }
    (spec.quests || []).slice().sort(function (a, b) { return a.quest < b.quest ? -1 : 1; }).forEach(function (q) {
      if (q.keep) return;
      var ch = q.chapter && at[q.chapter] != null ? q.chapter : order[0];
      if (ch !== q.chapter) warnings.push({ code: 'quest-chapter', quest: q.quest, message: 'Side quest ' + q.quest + ' names no chapter of the Charter, so its giver stands in the first chapter.' });
      var pool = poolFor(ch);
      if (!pool.length) { warnings.push({ code: 'no-giver', quest: q.quest, message: 'No town has anyone to give side quest ' + q.quest + '.' }); return; }
      if (pool[0].chapter !== ch) warnings.push({ code: 'borrowed-giver', quest: q.quest, message: 'Chapter ' + ch + ' has no townsfolk, so side quest ' + q.quest + ' is given in chapter ' + pool[0].chapter + '.' });
      var best = null;
      pool.forEach(function (p) { if (!best || tier(p) < tier(best) || tier(p) === tier(best) && count[p.npc] < count[best.npc]) best = p; });
      assign[q.quest] = best.npc; count[best.npc]++;
    });
    return { assign: assign, warnings: warnings };
  }

  W.zones = { DEFAULTS: ZN_DEFAULTS, WEATHER_HINTS: WEATHER_HINTS, settings: znSettings, fieldKey: fieldKey, interiorKey: interiorKey,
    power: troopPower, isBoss: troopIsBoss, slots: znSlots, weatherFor: weatherFor, cellKey: znCellKey, fieldCells: znFieldCells,
    floorCells: znFloorCells, build: znBuild, givers: znGivers };
