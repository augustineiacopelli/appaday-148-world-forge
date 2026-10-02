/* Art and Audio Forge ENGINE:RENDER, engine version 1.0.0
 * Forge 147 (AppADay 147). Declares one global, ENGINE_RENDER. No dependencies; reads no host global. */
// === ENGINE:RENDER BEGIN ===
// ENGINE_RENDER is the pure rendering engine. It reads no host global: art, rules, charter, contexts, and callbacks always
// arrive as arguments, so Phase 8 can lift this fence into engine-render.js unchanged. Phase 1 adds color math (OKLab) and
// the palette module. Later phases add their sections above the freeze at the bottom of this fence.
var ENGINE_RENDER = (function () {
  'use strict';
  var R = { version: '1.0.0' };

  // ---------------------------------------------------------------- shared helpers
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function hash32(str) {
    var h = 0x811c9dc5;
    str = String(str);
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  R.util = { clamp: clamp, rng: rng, hash32: hash32 };

  // ---------------------------------------------------------------- color (sRGB, OKLab, OKLCH)
  var HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
  function normHex(hex) {
    var m = HEX_RE.exec(String(hex == null ? '' : hex).trim());
    if (!m) return null;
    var h = m[1].toLowerCase();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return '#' + h;
  }
  function hexToRgb(hex) {
    var h = normHex(hex);
    if (!h) return null;
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function byteHex(v) { var t = clamp(Math.round(v), 0, 255).toString(16); return t.length < 2 ? '0' + t : t; }
  function rgbToHex(r, g, b) { return '#' + byteHex(r) + byteHex(g) + byteHex(b); }
  function toLinear(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function toSrgb(c) { var v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return v * 255; }
  function linToLab(r, g, b) {
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }
  function labToLin(L, a, b) {
    var l = L + 0.3963377774 * a + 0.2158037573 * b, m = L - 0.1055613458 * a - 0.0638541728 * b, s = L - 0.0894841775 * a - 1.2914855480 * b;
    l = l * l * l; m = m * m * m; s = s * s * s;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  }
  var labMemo = {}, labMemoSize = 0;
  function hexToLab(hex) {
    var fast = typeof hex === 'string' ? labMemo[hex] : null;
    if (fast) return fast;
    var h = normHex(hex);
    if (!h) return null;
    var hit = labMemo[h];
    if (hit) return hit;
    var c = hexToRgb(h), lab = linToLab(toLinear(c[0]), toLinear(c[1]), toLinear(c[2]));
    if (labMemoSize > 20000) { labMemo = {}; labMemoSize = 0; }
    labMemo[h] = lab; labMemoSize++;
    return lab;
  }
  function labToLch(lab) {
    var C = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]), h = Math.atan2(lab[2], lab[1]) * 180 / Math.PI;
    return [lab[0], C, h < 0 ? h + 360 : h];
  }
  function lchToLab(L, C, h) { var r = h * Math.PI / 180; return [L, C * Math.cos(r), C * Math.sin(r)]; }
  function inGamut(lin) { var e = 0.0005; return lin[0] >= -e && lin[0] <= 1 + e && lin[1] >= -e && lin[1] <= 1 + e && lin[2] >= -e && lin[2] <= 1 + e; }
  // OKLCH to hex with gamut mapping by chroma reduction (hue and lightness are kept, chroma shrinks until it fits).
  function lchToHex(L, C, h) {
    L = clamp(L, 0, 1); C = Math.max(0, C);
    var lab = lchToLab(L, C, h), lin = labToLin(lab[0], lab[1], lab[2]);
    if (!inGamut(lin)) {
      var lo = 0, hi = C;
      for (var i = 0; i < 18; i++) {
        var mid = (lo + hi) / 2, t = lchToLab(L, mid, h), tl = labToLin(t[0], t[1], t[2]);
        if (inGamut(tl)) lo = mid; else hi = mid;
      }
      lab = lchToLab(L, lo, h); lin = labToLin(lab[0], lab[1], lab[2]);
    }
    return rgbToHex(toSrgb(clamp(lin[0], 0, 1)), toSrgb(clamp(lin[1], 0, 1)), toSrgb(clamp(lin[2], 0, 1)));
  }
  function hexToLch(hex) { var lab = hexToLab(hex); return lab ? labToLch(lab) : null; }
  function labToHex(lab) { var l = labToLch(lab); return lchToHex(l[0], l[1], l[2]); }
  function dist(a, b) { var x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return Math.sqrt(x * x + y * y + z * z); }
  function distHex(a, b) { var x = hexToLab(a), y = hexToLab(b); return x && y ? dist(x, y) : Infinity; }
  // Signed hue distance, from h toward target, in (-180, 180].
  function hueDelta(h, target) { var d = ((target - h) % 360 + 540) % 360 - 180; return d === -180 ? 180 : d; }
  function rotateToward(h, target, deg) {
    var d = hueDelta(h, target), step = Math.sign(d) * Math.min(Math.abs(d), deg);
    return ((h + step) % 360 + 360) % 360;
  }
  // A shade or tint of a color the way pixel artists ramp: shadows cool toward blue violet, highlights warm toward yellow,
  // and chroma falls off toward both ends. k is in steps (negative darker); spread is the lightness change per step.
  function shade(lch, k, spread) {
    var L = clamp(lch[0] + k * spread, 0.06, 0.97);
    var ak = Math.abs(k), grey = lch[1] < 0.03;
    var h = grey ? lch[2] : k < 0 ? rotateToward(lch[2], 265, 9 * ak) : k > 0 ? rotateToward(lch[2], 85, 7 * ak) : lch[2];
    var C = lch[1] * (k < 0 ? 1 - 0.12 * ak : k > 0 ? 1 - 0.2 * ak : 1);
    if (L > 0.9) C *= 0.6;
    return [L, Math.max(0, C), h];
  }
  function idealRamp(hex, steps, spread) {
    var lch = hexToLch(hex) || [0.5, 0, 0], out = [], mid = (steps - 1) / 2;
    for (var i = 0; i < steps; i++) out.push(shade(lch, i - mid, spread));
    return out;
  }
  function contrastInk(hex) { var lab = hexToLab(hex); return lab && lab[0] > 0.66 ? '#111111' : '#ffffff'; }
  R.color = {
    normHex: normHex, hexToRgb: hexToRgb, rgbToHex: rgbToHex, hexToLab: hexToLab, hexToLch: hexToLch, labToHex: labToHex,
    lchToHex: lchToHex, dist: dist, distHex: distHex, hueDelta: hueDelta, rotateToward: rotateToward, shade: shade,
    idealRamp: idealRamp, contrastInk: contrastInk
  };

  // ---------------------------------------------------------------- palette
  // Local sprite palettes have 16 slots: 0 transparent, 1 outline, then three step ramps and a two step metal ramp. The
  // enemy layout reuses the same slots with enemy materials. Tilesets use their own 32 slot layout (Phase 4).
  var RAMPS = { skin: [2, 3, 4], hair: [5, 6, 7], clothA: [8, 9, 10], clothB: [11, 12, 13], metal: [14, 15] };
  var ENEMY_RAMPS = { body: [2, 3, 4], shade: [5, 6, 7], accent: [8, 9, 10], eye: [11, 12, 13], metal: [14, 15] };
  var LOCAL_SLOTS = 16;
  var SKIN = ['#f6d8bf', '#eabf98', '#d39a6e', '#b07a4e', '#8a5634', '#5e3a24'];
  var HAIR = ['#2a2220', '#4a2e1c', '#7a4a24', '#b07a34', '#d8b060', '#c8c4bc', '#9a3a2a', '#3a3a4a'];
  var METAL = ['#a3abba', '#c4a04c', '#7c7f88', '#b07a54'];
  // Built in anchors keep a palette usable for people, terrain, and metal whatever the bundle's own colors are.
  var BUILTIN = [
    { hex: '#f2c9a8', role: 'skin', w: 0.8 }, { hex: '#b47e54', role: 'skin', w: 0.8 }, { hex: '#6a4430', role: 'skin', w: 0.75 },
    { hex: '#3a2a22', role: 'hair', w: 0.65 }, { hex: '#c8963c', role: 'hair', w: 0.6 },
    { hex: '#4f9a3e', role: 'terrain', w: 0.75 }, { hex: '#2d5a32', role: 'terrain', w: 0.7 }, { hex: '#3a72c0', role: 'terrain', w: 0.75 },
    { hex: '#8cc4ec', role: 'terrain', w: 0.7 }, { hex: '#e2cc92', role: 'terrain', w: 0.65 }, { hex: '#8a5e3a', role: 'terrain', w: 0.65 },
    { hex: '#7e848e', role: 'terrain', w: 0.6 }, { hex: '#eaf2fa', role: 'terrain', w: 0.55 },
    { hex: '#a3abba', role: 'metal', w: 0.6 }, { hex: '#c4a04c', role: 'metal', w: 0.6 }
  ];
  var DARK = '#140f1c', LIGHT = '#f7f2e4';

  function famColors(rules) {
    var m = rules && rules.fam_ && typeof rules.fam_ === 'object' ? rules.fam_ : {};
    return Object.keys(m).map(function (id) { return m[id]; }).filter(function (f) { return f && typeof f === 'object'; });
  }
  function collectAnchors(charter, rules) {
    var out = [{ hex: DARK, role: 'outline', w: 9 }, { hex: LIGHT, role: 'highlight', w: 9 }];
    var els = charter && charter.ruleset && Array.isArray(charter.ruleset.elements) ? charter.ruleset.elements : [];
    els.forEach(function (e) { var h = e && normHex(e.color); if (h) out.push({ hex: h, role: 'element', src: e.key, w: 1 }); });
    famColors(rules).forEach(function (f) {
      var p = f.palette || {};
      var a = normHex(p.base), c = normHex(p.accent);
      if (a) out.push({ hex: a, role: 'family', src: f.id, w: 0.95 });
      if (c) out.push({ hex: c, role: 'family accent', src: f.id, w: 0.75 });
    });
    BUILTIN.forEach(function (x) { out.push({ hex: x.hex, role: x.role, w: x.w }); });
    // Collapse near duplicates, keeping the heavier anchor.
    var kept = [];
    out.forEach(function (a) {
      var lab = hexToLab(a.hex);
      for (var i = 0; i < kept.length; i++) {
        if (dist(lab, hexToLab(kept[i].hex)) < 0.018) { if (a.w > kept[i].w) kept[i] = a; return; }
      }
      kept.push(a);
    });
    return kept;
  }
  // Weighted farthest point selection in OKLab. Each pick maximizes weight times distance to everything already chosen.
  function maximin(pool, chosen, count) {
    var labs = pool.map(function (c) { return hexToLab(c.hex); });
    var best = labs.map(function (l) { var d = Infinity; chosen.forEach(function (h) { d = Math.min(d, dist(l, hexToLab(h))); }); return d; });
    while (chosen.length < count) {
      var bi = -1, bs = 0;
      for (var i = 0; i < pool.length; i++) { var s = pool[i].w * best[i]; if (s > bs) { bs = s; bi = i; } }
      if (bi < 0) break;
      var hx = pool[bi].hex, bl = labs[bi];
      chosen.push(hx);
      for (var j = 0; j < pool.length; j++) best[j] = Math.min(best[j], dist(labs[j], bl));
    }
    return chosen;
  }
  function sortEntries(entries) {
    var rows = entries.map(function (h) { var l = hexToLch(h); return { h: h, L: l[0], C: l[1], H: l[2] }; });
    rows.sort(function (a, b) {
      var an = a.C < 0.035, bn = b.C < 0.035;
      if (an !== bn) return an ? -1 : 1;
      if (!an) { var ab = Math.floor(((a.H + 15) % 360) / 30), bb = Math.floor(((b.H + 15) % 360) / 30); if (ab !== bb) return ab - bb; }
      return a.L - b.L;
    });
    return rows.map(function (r) { return r.h; });
  }
  // Two to four colors: a single hue lightness ramp, the way tiny handheld palettes work.
  function monoRamp(size, anchors) {
    var el = anchors.filter(function (a) { return a.role === 'element' || a.role === 'family'; })[0];
    var h = el ? hexToLch(el.hex)[2] : 110, out = [];
    for (var i = 0; i < size; i++) {
      var t = size === 1 ? 0 : i / (size - 1);
      out.push(lchToHex(0.13 + t * 0.83, 0.035 + 0.03 * Math.sin(t * Math.PI), h));
    }
    return out;
  }
  function paletteSize(charter) {
    var n = charter && charter.specs ? Math.round(Number(charter.specs.paletteSize)) : NaN;
    return clamp(isFinite(n) ? n : 64, 2, 256);
  }
  // buildMaster(charter, rules, seed) -> {size, entries: [hex x size], anchors: [{hex, role, src}]}
  function buildMaster(charter, rules, seed) {
    var size = paletteSize(charter), anchors = collectAnchors(charter, rules), rnd = rng(seed || 1), entries;
    if (size <= 4) entries = monoRamp(size, anchors);
    else {
      var forced = anchors.filter(function (a) { return a.w > 5; }).map(function (a) { return a.hex; });
      var soft = anchors.filter(function (a) { return a.w <= 5; });
      // Stage one spends up to half the budget on anchors only, so bundle colors are honored before ramps compete.
      var chosen = maximin(soft, forced.slice(), Math.min(size, Math.max(forced.length + 1, Math.floor(size * 0.5))));
      var pool = soft.slice(), ks = [-2, -1, 1, 2], kw = [0.5, 0.72, 0.68, 0.45];
      soft.forEach(function (a) {
        var lch = hexToLch(a.hex);
        ks.forEach(function (k, i) { var s = shade(lch, k, 0.11); pool.push({ hex: lchToHex(s[0], s[1], s[2]), w: Math.min(1, a.w) * kw[i] }); });
      });
      // Even fill so large palettes still cover the hue wheel; the seed turns the wheel.
      var turn = rnd() * 30;
      for (var L = 0.22; L < 0.93; L += 0.1) {
        for (var hh = 0; hh < 360; hh += 30) { pool.push({ hex: lchToHex(L, 0.07, hh + turn), w: 0.3 }); if (L < 0.85) pool.push({ hex: lchToHex(L, 0.14, hh + turn + 15), w: 0.28 }); }
        pool.push({ hex: lchToHex(L, 0, 0), w: 0.32 });
      }
      chosen = maximin(pool, chosen, size);
      var guard = 0;
      while (chosen.length < size && guard++ < 5000) {
        var hx = lchToHex(0.15 + rnd() * 0.8, rnd() * 0.18, rnd() * 360);
        if (chosen.indexOf(hx) < 0) chosen.push(hx);
      }
      entries = chosen.slice(0, size);
    }
    return { size: size, entries: sortEntries(entries), anchors: anchors.map(function (a) { var o = { hex: a.hex, role: a.role }; if (a.src) o.src = a.src; return o; }) };
  }
  // nearest(master, hex) -> index of the closest master entry in OKLab.
  function nearest(master, hex) {
    var lab = hexToLab(hex), bi = 0, bd = Infinity;
    if (!lab) return 0;
    for (var i = 0; i < master.length; i++) { var m = hexToLab(master[i]); if (!m) continue; var d = dist(lab, m); if (d < bd) { bd = d; bi = i; } }
    return bi;
  }
  // Maps an ideal ramp onto master indices, dark to light. Picks stay monotone in lightness and avoid reuse while any
  // fresh candidate keeps the order; tiny palettes fall back to repeats, which is correct for them.
  // The k nearest labs to t, nearest first, by insertion into a short list (no full sort of the master).
  // Ramp matching weighs hue and chroma above lightness (order keeps lightness honest) and adds a soft penalty for indices
  // another material already uses, so cloth A and cloth B stop sharing colors whenever the master has room.
  function closest(labs, t, k, avoid) {
    var out = [];
    for (var i = 0; i < labs.length; i++) {
      var l = labs[i], dl = l[0] - t[0], da = l[1] - t[1], db = l[2] - t[2];
      var d = Math.sqrt(0.45 * dl * dl + da * da + db * db) + (avoid && avoid[i] ? 0.06 : 0);
      if (out.length === k && d >= out[k - 1].d) continue;
      var j = out.length < k ? out.length : k - 1;
      while (j > 0 && out[j - 1].d > d) { out[j] = out[j - 1]; j--; }
      out[j] = { i: i, d: d, L: labs[i][0] };
    }
    return out;
  }
  function rampFor(master, hex, steps, spread, avoid) {
    var ideal = idealRamp(hex, steps, spread || 0.12), used = {}, out = [], prevL = -1;
    var labs = master.map(function (h) { return hexToLab(h) || [0, 0, 0]; });
    ideal.forEach(function (lch) {
      var t = lchToLab(lch[0], lch[1], lch[2]);
      var order = closest(labs, t, 12, avoid);
      var pick = null, near = order[0];
      for (var j = 0; j < order.length; j++) {
        var o = order[j];
        if (used[o.i] || o.L <= prevL) continue;
        if (o.d > near.d + 0.09) break;
        pick = o; break;
      }
      if (!pick) pick = near.L >= prevL ? near : (out.length ? { i: out[out.length - 1], L: prevL } : near);
      used[pick.i] = 1; out.push(pick.i); prevL = Math.max(prevL, pick.L);
    });
    return out;
  }
  function ramp(master, idx, steps, spread) { return rampFor(master, master[clamp(idx | 0, 0, master.length - 1)], steps, spread); }
  function outline(master) {
    var bi = 0, bl = Infinity;
    master.forEach(function (h, i) { var l = hexToLab(h); if (l && l[0] < bl) { bl = l[0]; bi = i; } });
    return bi;
  }
  function slotsFrom(master, mats, layout) {
    var s = new Array(LOCAL_SLOTS);
    for (var i = 0; i < LOCAL_SLOTS; i++) s[i] = 0;
    s[0] = null; s[1] = outline(master);
    Object.keys(layout).forEach(function (k) { (layout[k] || []).forEach(function (slot, j) { var v = mats[k] && mats[k][j]; s[slot] = typeof v === 'number' && v >= 0 && v < master.length ? v : s[1]; }); });
    return s;
  }
  // Seeded colorway sources: the colors a character is dressed in, before they are fitted to the master palette.
  // hint: {hue (degrees, spreads a party), dark (villain)}
  function colorwaySource(seed, hint) {
    hint = hint || {};
    var r = rng(seed), hueA = typeof hint.hue === 'number' ? hint.hue : r() * 360;
    var skin = SKIN[Math.floor(r() * SKIN.length)], hair = HAIR[Math.floor(r() * HAIR.length)];
    var la = hint.dark ? 0.38 + r() * 0.08 : 0.52 + r() * 0.1, ca = 0.11 + r() * 0.05;
    var compl = r() < 0.5, hueB = hueA + (compl ? 150 + r() * 60 : 25 + r() * 35);
    var clothA = lchToHex(la, ca, hueA), clothB = lchToHex(hint.dark ? 0.3 + r() * 0.1 : 0.48 + r() * 0.2, 0.08 + r() * 0.06, hueB);
    var metal = METAL[Math.floor(r() * METAL.length)];
    return { skin: skin, hair: hair, clothA: clothA, clothB: clothB, metal: metal, accent: r() < 0.5 ? 'clothB' : 'metal' };
  }
  // colorway(master, src) -> {skin, hair, clothA, clothB: [m, m, m], metal: [m, m], accent}
  function colorway(master, src) {
    var cw = { accent: src.accent === 'metal' ? 'metal' : 'clothB' };
    // Two colors: every material reads as light with a dark shadow step, so figures stay readable against the outline
    // instead of collapsing into dark silhouettes.
    if (master.length <= 2) {
      var dk = outline(master), lt = master.length > 1 ? 1 - dk : dk;
      Object.keys(RAMPS).forEach(function (k) { cw[k] = RAMPS[k].map(function (_, j) { return j === 0 ? dk : lt; }); });
      return cw;
    }
    var taken = {};
    taken[outline(master)] = 1;
    Object.keys(RAMPS).forEach(function (k) {
      cw[k] = rampFor(master, src[k] || '#808080', RAMPS[k].length, k === 'metal' ? 0.16 : 0.12, taken);
      cw[k].forEach(function (i) { taken[i] = 1; });
    });
    return cw;
  }
  function local(master, cw) { return slotsFrom(master, cw, RAMPS); }
  // tier(fam, tierIndex, master, avoid) -> {slots, ramps, rampOffset, inverted, collapsed}. Day 146 tier families carry
  // their own shifted colors; when that shift lands on the same master indices as a sibling (common at small sizes),
  // the ramps are offset in lightness, then inverted, until the palette differs from everything in avoid.
  function tier(fam, tierIndex, master, avoid) {
    var p = (fam && fam.palette) || {}, base = normHex(p.base) || '#7a7a7a', acc = normHex(p.accent) || '#d0d0d0';
    var bl = hexToLch(base), seen = {};
    (avoid || []).forEach(function (s) { seen[String(s)] = 1; });
    var shadeHex = lchToHex(bl[0] * 0.82, bl[1] * 0.7, rotateToward(bl[2], 265, 28));
    var eyeHex = bl[0] > 0.6 ? lchToHex(0.3, 0.12, bl[2] + 180) : lchToHex(0.88, 0.14, (bl[2] + 180) % 360);
    var tries = [0, 1, -1, 2, -2, 3, -3], first = null;
    function lift(hex, k) { var l = hexToLch(hex); return lchToHex(clamp(l[0] + k * 0.13, 0.08, 0.96), l[1], l[2]); }
    for (var t = 0; t < tries.length * 2; t++) {
      var k = tries[t % tries.length], inv = t >= tries.length;
      var mats = { body: rampFor(master, lift(base, k), 3), shade: rampFor(master, lift(shadeHex, k), 3), accent: rampFor(master, lift(acc, k), 3), eye: rampFor(master, eyeHex, 3), metal: rampFor(master, '#9aa0ac', 2, 0.16) };
      if (inv) { var sw = mats.body; mats.body = mats.accent; mats.accent = sw; }
      var slots = slotsFrom(master, mats, ENEMY_RAMPS);
      var res = { slots: slots, ramps: ENEMY_RAMPS, rampOffset: k, inverted: inv, collapsed: false, tier: tierIndex || 1 };
      if (!first) first = res;
      if (!seen[String(slots)]) return res;
    }
    first.collapsed = true;
    return first;
  }
  // element(color, master) -> {palette: [dark, base, light, hot], flash, tint}
  function element(color, master) {
    var hex = normHex(color) || '#c0c0c0', l = hexToLch(hex);
    var ideal = [shade(l, -1.2, 0.12), l, shade(l, 1, 0.12), [0.95, l[1] * 0.35, rotateToward(l[2], 85, 20)]];
    var used = {}, prevL = -1, pal = [];
    ideal.forEach(function (c) {
      var i = nearest(master, lchToHex(c[0], c[1], c[2]));
      if ((used[i] || hexToLab(master[i])[0] < prevL) && master.length > 4) {
        var t = lchToLab(c[0], c[1], c[2]), bd = Infinity;
        master.forEach(function (h, j) { var lb = hexToLab(h); if (used[j] || lb[0] < prevL) return; var d = dist(lb, t); if (d < bd) { bd = d; i = j; } });
      }
      used[i] = 1; prevL = Math.max(prevL, hexToLab(master[i])[0]); pal.push(i);
    });
    return { palette: pal, flash: nearest(master, '#ffffff'), tint: nearest(master, hex) };
  }
  // collapse(pal, size) -> {entries, map}: reduce any palette to size colors, keeping the darkest and lightest, and map
  // every old index to its nearest survivor.
  function collapse(pal, size) {
    size = clamp(size | 0, 1, 256);
    var list = pal.map(normHex).filter(Boolean);
    if (list.length <= size) return { entries: list.slice(), map: list.map(function (_, i) { return i; }) };
    var dark = list[outline(list)], light = list.reduce(function (a, h) { return hexToLab(h)[0] > hexToLab(a)[0] ? h : a; }, list[0]);
    var seed = size === 1 ? [dark] : dark === light ? [dark] : [dark, light];
    var entries = maximin(list.map(function (h) { return { hex: h, w: 1 }; }), seed, size);
    return { entries: entries, map: list.map(function (h) { return nearest(entries, h); }) };
  }
  R.palette = {
    LOCAL_SLOTS: LOCAL_SLOTS, RAMPS: RAMPS, ENEMY_RAMPS: ENEMY_RAMPS,
    size: paletteSize, anchors: collectAnchors, buildMaster: buildMaster, nearest: nearest, ramp: ramp, rampFor: rampFor,
    outline: outline, colorwaySource: colorwaySource, colorway: colorway, local: local, slotsFrom: slotsFrom,
    tier: tier, element: element, collapse: collapse
  };

  // ================================================================ PHASE 2: COMPOSER
  // build.js splices this file into ENGINE:RENDER above the freeze line. It reads no host global either.

  // ---------------------------------------------------------------- codec
  // Pixel strings use 0 to 9 then A to V (indices 0 to 31). Rows are concatenated and the width lives on the containing
  // object. A period followed by one alphabet character n is a run of n + 1 transparent pixels; longer runs chain.
  var ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUV', AIDX = {};
  for (var ai = 0; ai < 32; ai++) AIDX[ALPHA[ai]] = ai;
  function decodePx(str, w, h) {
    var n = w * h, out = new Uint8Array(n), p = 0, s = String(str == null ? '' : str);
    if (!(w > 0 && h > 0)) throw new Error('Width and height must be positive.');
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === '.') {
        var c = AIDX[s[i + 1]];
        if (c === undefined) throw new Error('The run marker at character ' + i + ' has no count.');
        p += c + 1; i++;
        continue;
      }
      var v = AIDX[ch];
      if (v === undefined) throw new Error('Character ' + JSON.stringify(ch) + ' at ' + i + ' is not in the pixel alphabet.');
      if (p < n) out[p] = v;
      p++;
    }
    if (p !== n) throw new Error('The pixels expand to ' + p + ', but ' + w + ' by ' + h + ' needs ' + n + '.');
    return out;
  }
  function encodePx(arr) {
    var s = '', i = 0, n = arr.length;
    while (i < n) {
      var v = arr[i] | 0;
      if (v === 0) {
        var j = i;
        while (j < n && (arr[j] | 0) === 0) j++;
        var run = j - i;
        while (run > 0) {
          if (run === 1) { s += '0'; run = 0; } else { var k = Math.min(run, 32); s += '.' + ALPHA[k - 1]; run -= k; }
        }
        i = j;
      } else { s += ALPHA[clamp(v, 0, 31)]; i++; }
    }
    return s;
  }
  function validatePx(str, w, h, maxIndex) {
    var a;
    try { a = decodePx(str, w, h); } catch (e) { return { ok: false, error: e.message }; }
    var mx = maxIndex == null ? 31 : maxIndex;
    for (var i = 0; i < a.length; i++) if (a[i] > mx) return { ok: false, error: 'Pixel ' + i + ' uses index ' + a[i] + ', above the limit of ' + mx + '.' };
    return { ok: true, pixels: a.length };
  }
  R.codec = { ALPHABET: ALPHA, decode: decodePx, encode: encodePx, validate: validatePx };

  // ---------------------------------------------------------------- raster
  // A composing raster holds a cell code and a layer id per pixel. Cell code: low four bits are the material (1 outline,
  // 2 to 6 the five ramps in slot order, 7 the accent alias, 8 ground shadow), high four bits are a fixed ramp step plus
  // one (0 means the shading pass decides). Drawing takes unit coordinates; s scales units to pixels, so generators
  // rasterize natively at any tile size instead of resampling.
  var M_OUT = 1, M_A = 2, M_B = 3, M_C = 4, M_D = 5, M_E = 6, M_ACC = 7, M_GROUND = 8;
  function fx(m, step) { return m | ((step + 1) << 4); }
  function Ras(w, h, s) {
    this.w = w; this.h = h; this.s = s;
    this.c = new Uint8Array(w * h); this.l = new Uint8Array(w * h);
    this.layer = 1; this.clip = null;
  }
  // The outermost ring of pixels stays clear so the outline pass always has room, at any size.
  Ras.prototype.ok = function (px, py) {
    if (px < 1 || py < 1 || px >= this.w - 1 || py >= this.h - 1) return false;
    var k = this.clip;
    if (!k) return true;
    var ux = (px + 0.5) / this.s, uy = (py + 0.5) / this.s;
    return !(ux < k[0] || ux > k[2] || uy < k[1] || uy > k[3]);
  };
  Ras.prototype.put = function (px, py, code) { px |= 0; py |= 0; if (this.ok(px, py)) { var i = py * this.w + px; this.c[i] = code; this.l[i] = this.layer; } };
  // A unit point as one pixel (used for eyes and studs, which must exist even at tiny sizes).
  // Grows with scale so eyes read at large tile sizes too.
  Ras.prototype.dot = function (x, y, code, tall) {
    var n = Math.max(1, Math.floor(this.s * 0.8)), m = tall ? Math.max(1, Math.round(this.s * 1.4)) : n, px = Math.floor(x * this.s), py = Math.floor(y * this.s);
    for (var j = 0; j < m; j++) for (var i = 0; i < n; i++) this.put(px + i, py + j, code);
  };
  Ras.prototype.rect = function (x0, y0, x1, y1, code) {
    var s = this.s, a = Math.round(Math.min(x0, x1) * s), b = Math.round(Math.min(y0, y1) * s);
    var c = Math.round(Math.max(x0, x1) * s), d = Math.round(Math.max(y0, y1) * s);
    if (c <= a) c = a + 1;
    if (d <= b) d = b + 1;
    for (var y = b; y < d; y++) for (var x = a; x < c; x++) this.put(x, y, code);
  };
  Ras.prototype.ell = function (cx, cy, rx, ry, code) {
    var s = this.s, X = cx * s, Y = cy * s, RX = Math.max(0.5, rx * s), RY = Math.max(0.5, ry * s), any = false;
    for (var y = Math.floor(Y - RY); y <= Math.ceil(Y + RY); y++) {
      for (var x = Math.floor(X - RX); x <= Math.ceil(X + RX); x++) {
        var dx = (x + 0.5 - X) / RX, dy = (y + 0.5 - Y) / RY;
        if (dx * dx + dy * dy <= 1.0001) { this.put(x, y, code); any = true; }
      }
    }
    if (!any) this.put(Math.floor(X), Math.floor(Y), code);
  };
  Ras.prototype.poly = function (pts, code) {
    var s = this.s, P = pts.map(function (p) { return [p[0] * s, p[1] * s]; }), y0 = Infinity, y1 = -Infinity, any = false;
    P.forEach(function (p) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
    for (var y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      var cy = y + 0.5, xs = [];
      for (var i = 0, j = P.length - 1; i < P.length; j = i++) {
        var a = P[i], b = P[j];
        if ((a[1] > cy) !== (b[1] > cy)) xs.push(a[0] + (cy - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      xs.sort(function (p, q) { return p - q; });
      for (var k = 0; k + 1 < xs.length; k += 2) {
        for (var x = Math.ceil(xs[k] - 0.5); x < xs[k + 1] - 0.5; x++) { this.put(x, y, code); any = true; }
      }
    }
    if (!any && P.length) { var m = P.reduce(function (o, p) { return [o[0] + p[0] / P.length, o[1] + p[1] / P.length]; }, [0, 0]); this.put(Math.floor(m[0]), Math.floor(m[1]), code); }
  };
  // A capsule: every pixel whose center lies within t / 2 units of the segment.
  Ras.prototype.line = function (x0, y0, x1, y1, t, code) {
    var s = this.s, ax = x0 * s, ay = y0 * s, bx = x1 * s, by = y1 * s, rr = Math.max(0.5, (t || 1) * s / 2);
    var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, any = false;
    for (var y = Math.floor(Math.min(ay, by) - rr); y <= Math.ceil(Math.max(ay, by) + rr); y++) {
      for (var x = Math.floor(Math.min(ax, bx) - rr); x <= Math.ceil(Math.max(ax, bx) + rr); x++) {
        var px = x + 0.5, py = y + 0.5, u = L2 ? clamp(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1) : 0;
        var qx = ax + u * dx - px, qy = ay + u * dy - py;
        if (qx * qx + qy * qy <= rr * rr + 0.0001) { this.put(x, y, code); any = true; }
      }
    }
    if (!any) this.put(Math.floor(ax), Math.floor(ay), code);
  };
  Ras.prototype.next = function () { this.layer++; this.clip = null; return this; };

  // Shading: a pixel whose top and left neighbors leave its region is lit, one whose bottom and right neighbors leave it
  // is shaded, otherwise it takes the middle step. A region is one material within one layer. The light and shade bands
  // widen with scale (one pixel per 1.5 units of scale) so large tile sizes keep readable form.
  function shadeAndOutline(r, outline) {
    var w = r.w, h = r.h, c = r.c, l = r.l, step = new Int8Array(w * h), band = Math.max(1, Math.round(r.s / 1.5));
    // 0 inside the region, 1 open edge (empty or an earlier layer), 2 an edge under a later layer, which casts shade.
    function off(i, x, y, dx, dy) {
      for (var k = 1; k <= band; k++) {
        var X = x + dx * k, Y = y + dy * k;
        if (same(i, X, Y)) continue;
        if (X < 0 || Y < 0 || X >= w || Y >= h) return 1;
        var j = Y * w + X, mj = c[j] & 15;
        return mj && mj !== M_GROUND && l[j] > l[i] ? 2 : 1;
      }
      return 0;
    }
    function same(i, x, y) {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      var j = y * w + x, m = c[j] & 15;
      return m && m !== M_GROUND && l[j] === l[i] && (m === (c[i] & 15));
    }
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = y * w + x, m = c[i] & 15, f = c[i] >> 4;
      if (!m || m === M_OUT || m === M_GROUND) { step[i] = -1; continue; }
      if (f) { step[i] = f - 1; continue; }
      var t = off(i, x, y, 0, -1), lf = off(i, x, y, -1, 0);
      var hl = (t === 1 ? 1 : 0) + (lf === 1 ? 1 : 0), sh = (off(i, x, y, 0, 1) ? 1 : 0) + (off(i, x, y, 1, 0) ? 1 : 0) + (t === 2 ? 1 : 0);
      var n = m === M_E ? 2 : 3;
      step[i] = n === 3 ? (hl > sh ? 2 : sh > hl ? 0 : 1) : (hl > sh ? 1 : 0);
    }
    var edge = new Uint8Array(w * h);
    if (outline !== false) {
      for (var y2 = 0; y2 < h; y2++) for (var x2 = 0; x2 < w; x2++) {
        var k = y2 * w + x2, mk = c[k] & 15;
        if (mk && mk !== M_GROUND) continue;
        var hit = false;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          var X = x2 + d[0], Y = y2 + d[1];
          if (X < 0 || Y < 0 || X >= w || Y >= h) return;
          var mm = c[Y * w + X] & 15;
          if (mm && mm !== M_GROUND) hit = true;
        });
        if (hit) edge[k] = 1;
      }
    }
    return { step: step, edge: edge };
  }
  // Slot resolution. Every 16 slot layout (humanoid, enemy, icon) keeps ramps at 2-4, 5-7, 8-10, 11-13, and 14-15.
  var RAMP_SLOTS = [[2, 3, 4], [5, 6, 7], [8, 9, 10], [11, 12, 13], [14, 15]];
  function resolve(r, sh, accent) {
    var w = r.w, out = new Uint8Array(w * r.h);
    for (var i = 0; i < out.length; i++) {
      var m = r.c[i] & 15;
      if (sh.edge[i]) { out[i] = 1; continue; }
      if (!m) continue;
      if (m === M_OUT) { out[i] = 1; continue; }
      if (m === M_GROUND) { var x = i % w, y = (i - x) / w; out[i] = (x + y) & 1 ? 1 : 0; continue; }
      var k = m === M_ACC ? (accent === 'metal' ? 4 : accent === 'clothA' ? 2 : 3) : m - 2;
      var ramp = RAMP_SLOTS[k], st = clamp(sh.step[i], 0, ramp.length - 1);
      out[i] = ramp[st];
    }
    return out;
  }
  // A hand drawn local slot back into a fixed cell, so px parts layer exactly like generated ones.
  function slotCell(s) {
    if (!s) return 0;
    if (s === 1) return M_OUT;
    if (s >= 14) return fx(M_E, s - 14);
    return fx(2 + Math.floor((s - 2) / 3), (s - 2) % 3);
  }
  function mirror(idx, w, h) {
    var out = new Uint8Array(idx.length);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) out[y * w + x] = idx[y * w + (w - 1 - x)];
    return out;
  }
  // Pixels drawn for a one tile frame placed in a wider battle frame: same height, centered, nothing stretched.
  function fit(idx, w, h, W, H) {
    if (w === W && h === H) return idx;
    if (h !== H || w > W) return resample(idx, w, h, W, H);
    var out = new Uint8Array(W * H), ox = (W - w) >> 1;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) out[y * W + x + ox] = idx[y * w + x];
    return out;
  }
  function resample(idx, w, h, W, H) {
    var out = new Uint8Array(W * H);
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) out[y * W + x] = idx[Math.min(h - 1, Math.floor(y * h / H)) * w + Math.min(w - 1, Math.floor(x * w / W))];
    return out;
  }

  // ---------------------------------------------------------------- humanoid rig
  var BODY_PLANS = {
    slight: { sh: 3, hip: 2.3, leg: 6.4, torso: 6, head: 3.9, arm: 1.5, legW: 1.6 },
    average: { sh: 3.5, hip: 2.6, leg: 6, torso: 6, head: 4, arm: 1.8, legW: 1.9 },
    broad: { sh: 4.4, hip: 3.2, leg: 5.6, torso: 6.4, head: 4.1, arm: 2.3, legW: 2.3 },
    small: { sh: 2.8, hip: 2.2, leg: 3.8, torso: 4.4, head: 4.3, arm: 1.5, legW: 1.6 },
    tall: { sh: 3.6, hip: 2.6, leg: 7.4, torso: 6.8, head: 3.8, arm: 1.8, legW: 1.9 }
  };
  // Pose parameters. legs and arms are -1 to 1 per side (index 0 far or viewer left, 1 near or viewer right).
  //   bob, crouch: units the hips drop. ready: battle stance (near arm forward). lean: upper body forward in side view.
  //   hdx, hdy: head offset in side view (hdy also in front and back views); fx: head offset in front and back views.
  //   reach: per arm [x, y] as a fraction of arm length from the shoulder (x forward in side view, outward otherwise).
  //   wpn: weapon angle in degrees in side view (0 forward, -90 up, 90 down). kneel, sit: bent legs with knees.
  //   lie: the figure lies on its back (the frame is rotated, so it is wider than tall).
  // Phase 3 completes the field, emote, and battle sets; generators read only these fields.
  var POSES = {
    stand: { legs: [0, 0], arms: [0, 0], bob: 0 },
    stepA: { legs: [1, -1], arms: [-1, 1], bob: 0.4 },
    stepB: { legs: [-1, 1], arms: [1, -1], bob: 0.4 },
    idle: { legs: [-0.6, 0.7], arms: [0.2, 0.8], bob: 0, crouch: 0.6, ready: true },
    ready: { legs: [-0.7, 0.8], arms: [0.2, 0.8], crouch: 0.9, ready: true, lean: 0.25 },
    step: { legs: [0.9, -0.9], arms: [-0.6, 0.6], bob: 0.3, ready: true, lean: 0.45 },
    windup: { legs: [-0.5, 0.9], arms: [0.3, 0], crouch: 0.4, lean: -0.2, reach: [null, [-0.3, -0.85]], wpn: -125 },
    attack: { legs: [1, -0.9], arms: [-0.4, 0], crouch: 0.7, lean: 0.7, reach: [null, [0.9, -0.05]], wpn: 12 },
    cast: { legs: [-0.3, 0.4], arms: [0, 0], lean: 0.1, hdy: -0.2, reach: [[0.55, -0.75], [0.7, -0.65]], wpn: -70 },
    item: { legs: [0, 0.3], arms: [0, 0], reach: [null, [0.35, -0.95]], wpn: -80 },
    hurt: { legs: [-0.8, 0.5], arms: [-0.6, -0.4], lean: -0.6, hdx: -0.4, hdy: -0.2, fx: 0, reach: [[-0.45, 0.55], [-0.5, 0.5]], wpn: 115 },
    kneel: { legs: [0, 0], arms: [0, 0], kneel: true, lean: 0.35, hdy: 0.5, reach: [[0.2, 0.8], [0.4, 0.75]], wpn: 70 },
    ko: { legs: [0, 0], arms: [0, 0], lie: true },
    revive: { legs: [0, 0], arms: [0, 0], kneel: true, lean: 0.1, hdy: -0.2, reach: [[0.1, 0.7], [0.3, -0.3]], wpn: -40 },
    victory: { legs: [-0.6, 0.6], arms: [0, 0], hdy: -0.3, reach: [[-0.2, 0.85], [0.15, -1]], wpn: -90 },
    limit: { legs: [-1, 1], arms: [0, 0], crouch: 1.2, lean: 0.3, reach: [[-0.7, 0.1], [0.6, -0.8]], wpn: -55 },
    nod: { legs: [0, 0], arms: [0, 0], hdx: 0.3, hdy: 0.7 },
    shakeL: { legs: [0, 0], arms: [0, 0], hdx: -0.4, fx: -0.7 },
    shakeR: { legs: [0, 0], arms: [0, 0], hdx: 0.4, fx: 0.7 },
    crouch: { legs: [-0.3, 0.3], arms: [0.2, -0.2], crouch: 1.1 },
    jump: { legs: [0.4, -0.4], arms: [0, 0], reach: [[-0.5, -0.6], [0.5, -0.6]], hdy: -0.2 },
    sit: { legs: [0, 0], arms: [0, 0], sit: true, reach: [[-0.15, 0.7], [0.3, 0.65]] },
    laugh: { legs: [0, 0], arms: [0, 0], bob: 0.3, hdx: -0.3, hdy: -0.4, reach: [[-0.45, 0.55], [0.45, 0.55]] },
    laughB: { legs: [0, 0], arms: [0, 0], hdx: -0.2, hdy: -0.15, reach: [[-0.35, 0.65], [0.35, 0.65]] }
  };
  // Battle frames are two tiles wide so weapon swings and lunges have room; field frames stay one tile wide.
  function framePx(size, prop, wide) { var h = clamp(Number(prop && prop.height) || 1.5, 1, 2.5); return { w: wide ? size * 2 : size, h: Math.round(size * h) }; }
  function skeleton(plan, prop, pose, dir, Wu, Hu) {
    var bp = BODY_PLANS[plan && BODY_PLANS[plan] ? plan : 'average'];
    if (plan && typeof plan === 'object') bp = plan;
    var hs = clamp(Number(prop && prop.headScale) || 1, 0.6, 1.6), head = bp.head * hs;
    var need = head * 1.8 + bp.torso + bp.leg + 2.2, k = Math.min(1.25, (Hu - 1.6) / need);
    var side = dir === 'right', cx = Wu / 2, footY = Hu - 1.6, crouch = (pose.crouch || 0);
    var L0 = bp.leg * k, L = L0 - crouch, T = bp.torso * k, r = head * k, bob = pose.bob || 0;
    var hipY = footY - L + bob * 0.5;
    if (pose.kneel) hipY = footY - L0 * 0.52;
    if (pose.sit) hipY = footY - Math.max(1, L0 * 0.18);
    var lean = side ? (pose.lean || 0) * 1.3 : 0, ux = cx + lean;
    var neckY = hipY - T + Math.abs(lean) * 0.35, headCy = neckY - r * 0.82 + (pose.hdy || 0);
    var hx = ux + (side ? (pose.hdx || 0) : (pose.fx || 0));
    var sh = bp.sh * (side ? 0.62 : 1), hip = bp.hip * (side ? 0.66 : 1);
    var J = { cx: cx, ux: ux, hx: hx, footY: footY, hipY: hipY, neckY: neckY, headCy: headCy, headR: r, sh: sh, hip: hip, armW: bp.arm, legW: bp.legW, dir: dir, side: side, ready: !!pose.ready, plan: bp, legLen: footY - hipY, wpn: side && typeof pose.wpn === 'number' ? pose.wpn : null };
    var half = L0 * 0.5;
    J.legs = [0, 1].map(function (i) {
      var v = pose.legs[i] || 0, hx0 = side ? cx + (i ? 0.4 : -0.4) : cx + (i ? 1 : -1) * hip * 0.55;
      if (pose.kneel) {
        if (side) return i ? { hx: hx0, kx: hx0 + half * 0.95, ky: hipY - 0.2, x: hx0 + half * 0.95, y: footY, far: false } : { hx: hx0, kx: hx0 - 0.1, ky: footY - 0.4, x: hx0 - half * 0.95, y: footY - 0.4, far: true };
        return { hx: hx0, x: hx0 + (i ? 0.3 : -0.3), y: footY - (i ? 0 : 0.6), far: false };
      }
      if (pose.sit) {
        if (side) return { hx: hx0, kx: hx0 + half * 0.85, ky: hipY - half * 0.55 + (i ? 0 : 0.3), x: hx0 + half * 1.55 + (i ? 0.3 : -0.3), y: footY, far: !i };
        return { hx: hx0, x: hx0 + (i ? 1.6 : -1.6), y: footY, far: false };
      }
      if (side) return { hx: hx0, x: hx0 + v * 2.3, y: footY - (v > 0.3 ? 0.4 : 0), far: !i };
      return { hx: hx0, x: hx0, y: footY - (v > 0 ? 1 : 0), far: false };
    });
    J.arms = [0, 1].map(function (i) {
      var v = pose.arms[i] || 0, sx = side ? ux + (i ? 0.3 : -0.3) : ux + (i ? 1 : -1) * (sh + 0.1), sy = neckY + 1;
      var len = T * 0.95, rc = pose.reach && pose.reach[i];
      if (rc) return { sx: sx, sy: sy, hx: sx + rc[0] * len * (side ? 1 : (i ? 1 : -1)), hy: sy + rc[1] * len, far: side && !i };
      if (side) {
        if (pose.ready && i) return { sx: sx, sy: sy, hx: sx + len * 0.75, hy: sy + len * 0.45, far: false };
        return { sx: sx, sy: sy, hx: sx + v * 2.4, hy: sy + len - Math.abs(v) * 0.4, far: !i };
      }
      return { sx: sx, sy: sy, hx: sx + (i ? 0.5 : -0.5), hy: sy + len - (v > 0 ? 0.8 : 0), far: false };
    });
    return J;
  }
  // A leg from hip to foot, through the knee when the pose bends it.
  function limb(r, g, y0, w, code, trim) {
    var fy = g.y - (trim || 0);
    if (g.kx == null) { r.line(g.hx, y0, g.x, fy, w, code); return; }
    r.line(g.hx, y0, g.kx, g.ky, w, code);
    r.line(g.kx, g.ky, g.x, fy, w, code);
  }
  // Materials for the humanoid layout: 2 skin, 3 hair, 4 cloth A, 5 cloth B, 6 metal, 7 accent alias.
  var SKN = M_A, HAI = M_B, CLA = M_C, CLB = M_D, MET = M_E, ACC = M_ACC;
  function farc(code, far) { return far ? fx(code & 15, 0) : code; }
  var HUMANOID = {};
  HUMANOID['shadow.ground'] = function (r, J, p) { r.ell(J.cx, J.footY + 0.4, J.plan.sh * 1.05 * (p.width || 1), 0.9, M_GROUND); };
  HUMANOID['body.plan'] = function (r, J) {
    r.rect(J.ux - 0.8, J.neckY - 1, J.ux + 0.8, J.neckY + 1.2, SKN);
    J.arms.forEach(function (a) { if (a.far) { r.line(a.sx, a.sy, a.hx, a.hy, J.armW, farc(SKN, 1)); } });
    J.legs.forEach(function (g) { limb(r, g, J.hipY, J.legW, farc(SKN, g.far)); });
    r.poly([[J.ux - J.sh, J.neckY + 0.4], [J.ux + J.sh, J.neckY + 0.4], [J.cx + J.hip, J.hipY + 0.5], [J.cx - J.hip, J.hipY + 0.5]], SKN);
    J.arms.forEach(function (a) { if (!a.far) r.line(a.sx, a.sy, a.hx, a.hy, J.armW, SKN); r.ell(a.hx, a.hy + 0.2, J.armW * 0.55, J.armW * 0.55, farc(SKN, a.far)); });
  };
  function headShape(r, J, shape, code) {
    var cx = J.hx + (J.side ? 0.3 : 0), cy = J.headCy, R0 = J.headR;
    if (shape === 'square') r.poly([[cx - R0 * 0.85, cy - R0 * 0.8], [cx + R0 * 0.85, cy - R0 * 0.8], [cx + R0 * 0.9, cy + R0 * 0.4], [cx + R0 * 0.45, cy + R0], [cx - R0 * 0.45, cy + R0], [cx - R0 * 0.9, cy + R0 * 0.4]], code);
    else if (shape === 'long') r.ell(cx, cy + R0 * 0.1, R0 * 0.8, R0 * 1.1, code);
    else r.ell(cx, cy, R0 * 0.92, R0, code);
  }
  HUMANOID['head.shape'] = function (r, J, p) {
    headShape(r, J, p.shape, SKN);
    var cy = J.headCy + J.headR * 0.18, R0 = J.headR;
    if (J.dir === 'down') { r.dot(J.hx - R0 * 0.42, cy, M_OUT, true); r.dot(J.hx + R0 * 0.42 - 0.01, cy, M_OUT, true); }
    else if (J.dir === 'right') { r.dot(J.hx + R0 * 0.55, cy, M_OUT, true); r.dot(J.hx + R0 * 1.12, cy + R0 * 0.25, SKN); }
  };
  HUMANOID['hair.style'] = function (r, J, p) {
    var st = p.style || 'short', cx = J.hx + (J.side ? 0.3 : 0), cy = J.headCy, R0 = J.headR, code = st === 'covered' ? CLB : HAI;
    if (st === 'none') return;
    if (J.dir === 'up') {
      if (st === 'cropped') { r.clip = [-99, -99, 99, cy + R0 * 0.2]; r.ell(cx, cy, R0 * 0.95, R0 * 1.02, code); r.clip = null; }
      else r.ell(cx, cy, R0 * (st === 'covered' ? 1.1 : 0.98), R0 * (st === 'covered' ? 1.08 : 1.02), code);
      if (st === 'long') r.rect(cx - R0 * 0.85, cy, cx + R0 * 0.85, J.neckY + 2.6, code);
      if (st === 'tied') r.line(cx, cy + R0 * 0.6, cx, J.neckY + 2.4, 1.4, code);
      if (st === 'covered') r.poly([[cx - R0 * 1.05, cy], [cx + R0 * 1.05, cy], [cx + J.sh * 0.9, J.neckY + 1.5], [cx - J.sh * 0.9, J.neckY + 1.5]], code);
      if (st === 'spiked') for (var u = -1; u <= 1; u++) r.poly([[cx + u * R0 * 0.55 - R0 * 0.3, cy - R0 * 0.55], [cx + u * R0 * 0.55 + R0 * 0.3, cy - R0 * 0.55], [cx + u * R0 * 0.7, cy - R0 * 1.4]], code);
      return;
    }
    var back = J.side ? -R0 * 0.18 : 0, depth = st === 'cropped' ? -0.45 : -0.08;
    if (st === 'long') {
      if (J.side) r.rect(cx - R0 * 1.0, cy - R0 * 0.2, cx - R0 * 0.1, J.neckY + 2.4, code);
      else { r.rect(cx - R0 * 1.04, cy - R0 * 0.2, cx - R0 * 0.6, J.neckY + 2.4, code); r.rect(cx + R0 * 0.6, cy - R0 * 0.2, cx + R0 * 1.04, J.neckY + 2.4, code); }
    }
    if (st === 'covered') {
      r.ell(cx + back, cy - R0 * 0.05, R0 * 1.12, R0 * 1.12, code);
      r.poly([[cx - R0 * 1.05, cy + R0 * 0.2], [cx + R0 * 1.05, cy + R0 * 0.2], [cx + J.sh * 0.95, J.neckY + 1.6], [cx - J.sh * 0.95, J.neckY + 1.6]], code);
      r.next(); headFace(r, J);
      return;
    }
    r.clip = [-99, -99, 99, cy + R0 * depth];
    r.ell(cx + back, cy - R0 * 0.08, R0 * 1.0, R0 * 0.98, code);
    r.clip = null;
    if (J.side) { r.clip = [-99, -99, cx - R0 * 0.05, cy + R0 * 0.5]; r.ell(cx + back, cy, R0, R0, code); r.clip = null; }
    else if (st !== 'cropped') { r.rect(cx - R0 * 0.98, cy - R0 * 0.2, cx - R0 * 0.62, cy + R0 * 0.45, code); r.rect(cx + R0 * 0.62, cy - R0 * 0.2, cx + R0 * 0.98, cy + R0 * 0.45, code); }
    if (st === 'spiked') for (var v = -1; v <= 1; v++) r.poly([[cx + v * R0 * 0.55 - R0 * 0.32, cy - R0 * 0.6], [cx + v * R0 * 0.55 + R0 * 0.32, cy - R0 * 0.6], [cx + v * R0 * 0.75 + back, cy - R0 * 1.45]], code);
    if (st === 'tied') { if (J.side) r.line(cx - R0 * 0.9, cy - R0 * 0.2, cx - R0 * 1.5, cy + R0 * 1.1, 1.4, code); else r.ell(cx, cy - R0 * 1.0, R0 * 0.4, R0 * 0.35, code); }
  };
  // A hood leaves the face open: redraw it in its own layer so the shading reads.
  function headFace(r, J) {
    var cx = J.hx + (J.side ? 0.45 : 0), R0 = J.headR;
    r.ell(cx, J.headCy + R0 * 0.2, R0 * 0.62, R0 * 0.7, SKN);
    var cy = J.headCy + J.headR * 0.18;
    if (J.dir === 'down') { r.dot(J.hx - R0 * 0.32, cy, M_OUT); r.dot(J.hx + R0 * 0.32 - 0.01, cy, M_OUT); }
    else if (J.dir === 'right') r.dot(J.hx + R0 * 0.62, cy, M_OUT);
  }
  function sleeves(r, J, len, code) {
    J.arms.forEach(function (a) {
      var ex = a.sx + (a.hx - a.sx) * len, ey = a.sy + (a.hy - a.sy) * len;
      r.line(a.sx, a.sy, ex, ey, J.armW + 0.5, farc(code, a.far));
    });
  }
  function chest(r, J, wid, bottom, flare, code) {
    var s = J.sh * wid, hb = J.hip * flare;
    r.poly([[J.ux - s, J.neckY + 0.3], [J.ux + s, J.neckY + 0.3], [J.cx + hb, bottom], [J.cx - hb, bottom]], code);
  }
  HUMANOID['torso.cloth'] = function (r, J, p) {
    var st = p.style || 'tunic', front = J.dir === 'down';
    if (st === 'robe') {
      chest(r, J, 1.02, J.footY - 0.3, 1.6, CLA); sleeves(r, J, 1, CLA);
      if (J.dir !== 'up') r.rect(J.cx - J.hip * 0.9, J.hipY - 0.6, J.cx + J.hip * 0.9, J.hipY + 0.3, ACC);
    } else if (st === 'coat') {
      chest(r, J, 1.05, J.hipY + J.legLen * 0.55, 1.45, CLA); sleeves(r, J, 1, CLA);
      if (front) r.rect(J.cx - 0.35, J.neckY + 1.2, J.cx + 0.35, J.hipY + J.legLen * 0.5, CLB);
      if (J.dir !== 'up') r.rect(J.ux - J.sh * 0.6, J.neckY + 0.2, J.ux + J.sh * 0.6, J.neckY + 1.0, ACC);
    } else if (st === 'plate') {
      sleeves(r, J, 1, CLA);
      chest(r, J, 1.0, J.hipY + 0.6, 1.1, MET);
      J.arms.forEach(function (a) { if (!J.side || !a.far) r.ell(a.sx, a.sy - 0.1, J.armW * 0.9, J.armW * 0.75, MET); });
      r.rect(J.cx - J.hip * 1.05, J.hipY - 0.3, J.cx + J.hip * 1.05, J.hipY + 0.5, CLB);
    } else if (st === 'bodysuit') {
      chest(r, J, 0.92, J.hipY + 0.5, 1.0, CLA); sleeves(r, J, 1, CLA);
      if (front) r.line(J.cx - J.sh * 0.6, J.neckY + 1, J.cx + J.sh * 0.5, J.hipY - 0.5, 0.8, ACC);
    } else if (st === 'vest') {
      chest(r, J, 1.0, J.hipY + 0.6, 1.1, CLA); sleeves(r, J, 0.45, CLA);
      if (front) { r.rect(J.cx - J.sh, J.neckY + 0.5, J.cx - 0.5, J.hipY + 0.6, CLB); r.rect(J.cx + 0.5, J.neckY + 0.5, J.cx + J.sh, J.hipY + 0.6, CLB); }
      else chest(r, J, 0.95, J.hipY + 0.6, 1.05, CLB);
    } else {
      chest(r, J, 1.0, J.hipY + 1.3, 1.25, CLA); sleeves(r, J, 0.5, CLA);
      r.rect(J.cx - J.hip * 1.2, J.hipY - 0.4, J.cx + J.hip * 1.2, J.hipY + 0.4, CLB);
    }
  };
  HUMANOID['legs.cloth'] = function (r, J, p) {
    var st = p.style || 'trousers';
    function shoes() { J.legs.forEach(function (g) { r.rect(g.x - J.legW * 0.6 + (J.side ? 0.4 : 0), g.y - 0.8, g.x + J.legW * 0.6 + (J.side ? 0.9 : 0), g.y + 0.25, farc(M_OUT, 0)); }); }
    if (st === 'skirt') {
      r.poly([[J.cx - J.hip * 1.05, J.hipY - 0.5], [J.cx + J.hip * 1.05, J.hipY - 0.5], [J.cx + J.hip * 1.5, J.hipY + J.legLen * 0.55], [J.cx - J.hip * 1.5, J.hipY + J.legLen * 0.55]], CLB);
      shoes();
    } else if (st === 'longrobe') {
      r.poly([[J.cx - J.hip * 1.05, J.hipY - 0.5], [J.cx + J.hip * 1.05, J.hipY - 0.5], [J.cx + J.hip * 1.45, J.footY - 0.5], [J.cx - J.hip * 1.45, J.footY - 0.5]], CLA);
      shoes();
    } else {
      J.legs.forEach(function (g) { limb(r, g, J.hipY - 0.3, J.legW * 1.12, farc(CLB, g.far), 0.6); });
      r.rect(J.cx - J.hip * 1.02, J.hipY - 0.5, J.cx + J.hip * 1.02, J.hipY + 0.6, CLB);
      if (st === 'boots') J.legs.forEach(function (g) { var bx = g.kx == null ? g.x : g.kx + (g.x - g.kx) * 0.3, by = g.kx == null ? g.y - J.legLen * 0.38 : g.ky + (g.y - g.ky) * 0.3; r.line(bx, by, g.x + (J.side ? 0.4 : 0), g.y - 0.2, J.legW * 1.25, farc(ACC, g.far)); });
      else shoes();
    }
  };
  HUMANOID['back.gear'] = function (r, J, p) {
    var st = p.style || 'cape', s = J.sh, dx = J.side ? -1.2 : 0;
    if (st === 'cape') {
      if (J.side) r.poly([[J.ux + 0.3, J.neckY + 0.2], [J.ux - 0.8, J.neckY + 0.2], [J.cx - s * 1.3 - 1.8, J.hipY + J.legLen * 0.75], [J.cx - 0.4, J.hipY + J.legLen * 0.75]], CLB);
      else r.poly([[J.cx - s, J.neckY + 0.2], [J.cx + s, J.neckY + 0.2], [J.cx + s * 1.35, J.hipY + J.legLen * 0.75], [J.cx - s * 1.35, J.hipY + J.legLen * 0.75]], CLB);
    }
    else if (st === 'pack') r.rect(J.ux - s * 0.75 + dx * 1.3, J.neckY + 0.4 - (J.dir === 'down' ? 1 : 0), J.ux + s * 0.75 + dx * 0.4, J.hipY - 0.2, CLB);
    else r.line(J.cx - s - 0.5 + dx, J.hipY + 1.5, J.ux + s + 1 + dx, J.neckY - J.headR * 1.2, 1.1, MET);
  };
  HUMANOID['front.gear'] = function (r, J, p) {
    var st = p.style || 'bare';
    if (st === 'bare') return;
    var hi = J.side ? 1 : J.dir === 'up' ? 1 : 0, off = 1 - hi, h = J.arms[hi], o = J.arms[off], hx = h.hx, hy = h.hy + 0.2;
    var up = J.ready, dir = J.dir, w = J.wpn, ca = w == null ? 0 : Math.cos(w * Math.PI / 180), sa = w == null ? 0 : Math.sin(w * Math.PI / 180);
    if (st === 'blade') {
      if (w != null) {
        r.line(hx, hy, hx + ca * 6.4, hy + sa * 6.4, 1.05, MET);
        r.line(hx - sa * 0.95, hy + ca * 0.95, hx + sa * 0.95, hy - ca * 0.95, 0.9, ACC);
      } else {
        var tx = up ? hx + 4.6 : hx + (dir === 'right' ? 1.4 : dir === 'up' ? 1.2 : -1.4), ty = up ? hy - 4.8 : hy + 5.2;
        r.line(hx, hy, tx, ty, 1.05, MET);
        r.line(hx - (up ? 0.8 : 1), hy + (up ? 0.8 : 0), hx + (up ? 0.8 : 1), hy - (up ? 0.8 : 0), 0.9, ACC);
      }
    } else if (st === 'staff') {
      var ex0 = w != null ? hx - ca * 3 : hx, ey0 = w != null ? hy - sa * 3 : hy + 3, ex1 = w != null ? hx + ca * 8.5 : hx + (up ? 1.5 : 0), ey1 = w != null ? hy + sa * 8.5 : hy - 8.5;
      r.line(ex0, ey0, ex1, ey1, 1.05, ACC);
      r.ell(ex1 + (w != null ? ca * 0.3 : 0), ey1 + (w != null ? sa * 0.3 : -0.3), 1.1, 1.1, MET);
    } else if (st === 'shield') {
      var sx = J.side ? J.ux + J.sh + 1.2 : o.hx + (off ? 0.4 : -0.4), sy = J.side ? J.neckY + J.plan.torso * 0.55 : o.hy - 1.4;
      r.ell(sx, sy, J.side ? 1.1 : 1.9, 2.3, MET);
      r.dot(sx, sy, ACC);
    } else if (st === 'tool') {
      var ex = w != null ? hx + ca * 3.6 : up ? hx + 3 : hx, ey = w != null ? hy + sa * 3.6 : up ? hy - 3.6 : hy + 3.6;
      r.line(hx, hy, ex, ey, 0.9, ACC);
      if (w != null) r.line(ex - sa * 1.3, ey + ca * 1.3, ex + sa * 1.3, ey - ca * 1.3, 1.6, MET); else r.line(ex - 1.3, ey, ex + 1.3, ey, 1.6, MET);
    } else if (st === 'device') {
      var bx = hx + (J.side ? 0.6 : 0);
      for (var t = 0; t < 6; t++) {
        var a0 = -1.1 + t * 0.44, a1 = a0 + 0.44, rr = 4.2;
        r.line(bx + Math.cos(a0) * 1.4, hy + Math.sin(a0) * rr, bx + Math.cos(a1) * 1.4, hy + Math.sin(a1) * rr, 0.9, ACC);
      }
      r.line(bx + Math.cos(-1.1) * 1.4, hy + Math.sin(-1.1) * 4.2, bx + Math.cos(1.54) * 1.4, hy + Math.sin(1.54) * 4.2, 0.6, M_OUT);
    }
  };
  // Each default part generator: shape key, the layer it fills, and its parameters.
  var LAYERS = ['shadow', 'back', 'body', 'legs', 'torso', 'head', 'hair', 'front'];
  var ORDER = {
    down: ['shadow', 'back', 'body', 'legs', 'torso', 'head', 'hair', 'front'],
    right: ['shadow', 'back', 'body', 'legs', 'torso', 'head', 'hair', 'front'],
    up: ['shadow', 'front', 'body', 'legs', 'torso', 'head', 'hair', 'back']
  };
  var GEN_KEY = { shadow: 'shadow.ground', body: 'body.plan', head: 'head.shape', hair: 'hair.style', torso: 'torso.cloth', legs: 'legs.cloth', back: 'back.gear', front: 'front.gear' };
  var LIBRARY = [];
  function lib(layer, style, label, params) { LIBRARY.push({ key: layer + '.' + style, layer: layer, rig: 'humanoid', label: label, gen: { shape: GEN_KEY[layer], params: params } }); }
  Object.keys(BODY_PLANS).forEach(function (k) { lib('body', k, k.charAt(0).toUpperCase() + k.slice(1) + ' build', { plan: k }); });
  [['round', 'Round head'], ['square', 'Square head'], ['long', 'Long head']].forEach(function (x) { lib('head', x[0], x[1], { shape: x[0] }); });
  [['short', 'Short hair'], ['long', 'Long hair'], ['tied', 'Tied hair'], ['spiked', 'Spiked hair'], ['cropped', 'Cropped hair'], ['covered', 'Hood'], ['none', 'No hair']].forEach(function (x) { lib('hair', x[0], x[1], { style: x[0] }); });
  [['tunic', 'Tunic'], ['robe', 'Robe'], ['coat', 'Coat'], ['plate', 'Plate'], ['bodysuit', 'Bodysuit'], ['vest', 'Vest']].forEach(function (x) { lib('torso', x[0], x[1], { style: x[0] }); });
  [['trousers', 'Trousers'], ['skirt', 'Skirt'], ['longrobe', 'Long robe'], ['boots', 'Boots']].forEach(function (x) { lib('legs', x[0], x[1], { style: x[0] }); });
  [['cape', 'Cape'], ['pack', 'Pack'], ['item', 'Long carried item']].forEach(function (x) { lib('back', x[0], x[1], { style: x[0] }); });
  [['blade', 'Blade'], ['staff', 'Staff'], ['shield', 'Shield'], ['tool', 'Tool'], ['device', 'Ranged device'], ['bare', 'Bare hand']].forEach(function (x) { lib('front', x[0], x[1], { style: x[0] }); });

  // ---------------------------------------------------------------- enemy rigs (battle, facing right, 2 by 2 tiles)
  // Materials for the enemy layout: 2 body, 3 shade, 4 accent, 5 eye, 6 metal.
  var BOD = M_A, SHD = M_B, EAC = M_C, EYE = M_D, EMT = M_E;
  function eyes(r, x, y, n, sz) {
    for (var i = 0; i < n; i++) { var ex = x - i * (sz * 2.4 + 0.6); r.ell(ex, y, sz, sz * 1.15, fx(EYE, 2)); r.dot(ex + sz * 0.35, y + sz * 0.2, M_OUT); }
  }
  var ENEMY = {};
  ENEMY.ooze = function (r, p, rnd) {
    var w = 13 * (p.width || 0.85), hgt = 20 * (p.height || 0.7), base = 29.5, cx = 16;
    r.clip = [-99, -99, 99, base];
    r.ell(cx, base, w, hgt, BOD);
    r.clip = null;
    if (p.crest) r.poly([[cx - 2, base - hgt + 1], [cx + 2, base - hgt + 1], [cx + 0.5, base - hgt - 4]], BOD);
    r.next(); r.clip = [-99, base - 2.4, 99, base]; r.ell(cx, base, w, hgt, SHD); r.clip = null;
    for (var i = 0; i < (p.drip == null ? 1 : p.drip); i++) r.ell(cx - w * 0.5 + rnd() * w, base + 0.4, 1.1, 1.3, SHD);
    r.next(); r.ell(cx - w * 0.45, base - hgt * 0.62, w * 0.16, hgt * 0.1, fx(EAC, 2));
    r.next(); eyes(r, cx + w * 0.45, base - hgt * 0.5, p.eyes == null ? 2 : p.eyes, 1.5);
    r.line(cx + w * 0.05, base - hgt * 0.22, cx + w * 0.5, base - hgt * 0.22, 0.7, M_OUT);
  };
  ENEMY.floater = function (r, p, rnd) {
    var sz = 7 * (p.size || 0.9) + 2, cx = 15, cy = 13;
    var n = p.tails == null ? 3 : p.tails;
    for (var i = 0; i < n; i++) {
      var a = (i - (n - 1) / 2) * 0.55, len = 9 + rnd() * 4;
      r.line(cx - Math.sin(a) * 2, cy + sz * 0.5, cx - 2 - Math.sin(a) * len * 0.6, cy + sz * 0.6 + len, 3.2 - i * 0.2, EAC);
    }
    r.next(); r.ell(cx, cy, sz, sz, BOD);
    r.next(); r.ell(cx - sz * 0.25, cy - sz * 0.15, sz * 0.5, sz * 0.5, fx(EAC, 2));
    r.next(); eyes(r, cx + sz * 0.45, cy + 0.5, p.eyes == null ? 2 : p.eyes, 1.2);
  };
  ENEMY.quadruped = function (r, p, rnd) {
    var sz = p.size || 0.85, leg = 4 + 5 * (p.legLen == null ? 0.5 : p.legLen), base = 29.5, by = base - leg - 3.5;
    var bx = 13, bw = 9.5 * sz, bh = 4.6 * sz, hx = bx + bw + 1.5 + 2 * (p.neck || 0.5), hy = by - 4 - 2 * (p.neck || 0.5);
    [[bx - bw * 0.55, 1], [bx + bw * 0.55, 1]].forEach(function (q) { r.line(q[0] + 1.2, by + 1, q[0] + 1.8, base, 2.1, fx(SHD, 0)); });
    if (p.tail !== 0) r.line(bx - bw * 0.85, by - 1, bx - bw - 3, by - 5 - rnd() * 2, 1.8, SHD);
    r.next(); r.ell(bx, by, bw, bh, BOD);
    if (p.mane) r.ell(bx + bw * 0.55, by - bh * 0.5, bw * 0.4, bh * 0.75, EAC);
    r.line(bx + bw * 0.6, by - 1, hx - 1, hy + 1, 3.6 * sz, BOD);
    [[bx - bw * 0.55], [bx + bw * 0.55]].forEach(function (q) { r.line(q[0], by + 1.5, q[0] + 0.4, base, 2.3, BOD); });
    r.next(); r.ell(hx, hy, 3.6 * sz + 0.4, 3.1 * sz + 0.4, BOD); r.ell(hx + 3.2 * sz, hy + 1.3, 2.3, 1.5, BOD);
    if (p.ears !== 0) r.poly([[hx - 2.2, hy - 1.5], [hx - 0.2, hy - 2.5], [hx - 2.4, hy - 5.8]], BOD);
    if (p.horns) r.line(hx - 0.5, hy - 2.6, hx - 3.5, hy - 6.5, 1.3, EMT);
    r.next(); r.ell(hx + 0.6, hy - 0.4, 0.9, 0.9, fx(EYE, 2)); r.dot(hx + 0.9, hy - 0.3, M_OUT);
    r.dot(hx + 5.2 * sz, hy + 1.2, M_OUT);
  };
  ENEMY.avian = function (r, p) {
    var base = 29.5, bx = 14, by = 18, span = p.wingspan == null ? 1 : p.wingspan, hx = 21.5, hy = 10.5;
    r.poly([[bx - 2, by - 2], [bx + 3, by - 3], [bx - 6 * span, by - 12 * span], [bx - 10 * span, by - 6]], fx(EAC, 0));
    r.line(bx, by + 4, bx - 0.5, base, 1, EMT); r.line(bx + 2.5, by + 4, bx + 3, base, 1, EMT);
    r.next(); r.poly([[bx - 6, by + 1], [bx - 12, by + 1 + 2 * (p.tail == null ? 1 : p.tail)], [bx - 11, by - 2]], SHD);
    r.ell(bx, by, 6.6, 5, BOD); r.line(bx + 3, by - 3, hx - 1, hy + 1.5, 3.2, BOD);
    r.next(); r.ell(hx, hy, 3.6, 3.3, BOD);
    r.poly([[hx + 2.8, hy - 0.4], [hx + 2.8, hy + 1.6], [hx + 4 + 2.5 * (p.beak == null ? 1 : p.beak), hy + 0.8]], EMT);
    r.next(); r.poly([[bx - 4, by - 1], [bx + 4, by - 2], [bx - 3 * span, by - 10 * span], [bx - 8 * span, by - 5]], EAC);
    r.next(); r.ell(hx + 0.8, hy - 0.6, 0.9, 0.9, fx(EYE, 2)); r.dot(hx + 1.1, hy - 0.5, M_OUT);
  };
  ENEMY.serpent = function (r, p) {
    var coils = p.coils == null ? 2 : p.coils, pts = [], n = 18;
    for (var i = 0; i <= n; i++) {
      var t = i / n, x = 3 + t * 20, y = 27 - t * 13 - Math.sin(t * Math.PI * coils) * 3.5;
      pts.push([x, y, 2.2 + t * 4.4 * (p.length || 1)]);
    }
    for (var j = 1; j < pts.length; j++) r.line(pts[j - 1][0], pts[j - 1][1], pts[j][0], pts[j][1], pts[j][2], BOD);
    r.next();
    for (var k = 2; k < pts.length - 1; k += 2) r.line(pts[k][0], pts[k][1] + pts[k][2] * 0.32, pts[k + 1][0], pts[k + 1][1] + pts[k + 1][2] * 0.32, Math.max(0.8, pts[k][2] * 0.35), EAC);
    var h = pts[n];
    r.next(); if (p.hood) r.ell(h[0] - 1, h[1] - 0.5, 3.2, 4.6, SHD);
    r.ell(h[0] + 1.5, h[1] - 1, 3.6, 2.6, BOD);
    r.line(h[0] + 4.8, h[1] - 0.4, h[0] + 7.5, h[1] + 0.6, 0.6, EAC);
    r.next(); r.ell(h[0] + 2.2, h[1] - 2, 0.85, 0.85, fx(EYE, 2)); r.dot(h[0] + 2.5, h[1] - 1.9, M_OUT);
  };
  ENEMY.construct = function (r, p) {
    var b = p.bulk || 1, base = 29.5, cx = 15;
    r.rect(cx - 4.5, base - 7, cx - 1.5, base, fx(SHD, 0)); r.rect(cx + 1.5, base - 7, cx + 4.5, base, SHD);
    if (p.arms !== 0) r.rect(cx - 9 * b, base - 18, cx - 6 * b, base - 7, fx(SHD, 0));
    r.next(); r.rect(cx - 6.5 * b, base - 19, cx + 6.5 * b, base - 6, BOD);
    r.rect(cx - 3, base - 25, cx + 3.5, base - 19, BOD);
    if (p.arms !== 0) r.rect(cx + 6 * b, base - 18, cx + 9 * b, base - 7, BOD);
    r.next(); r.rect(cx - 4.5 * b, base - 16, cx + 4.5 * b, base - 13, EMT);
    r.dot(cx - 5 * b, base - 8, EMT); r.dot(cx + 5 * b, base - 8, EMT);
    r.next(); r.rect(cx - 1, base - 23, cx + 3, base - 21.6, p.glow === 0 ? EYE : fx(EYE, 2));
  };
  ENEMY.plant = function (r, p, rnd) {
    var base = 29.5, cx = 15, top = base - 20 * (p.height || 0.75);
    r.line(cx, base, cx + 1, top + 3, 2.2, SHD);
    for (var i = 0; i < 3; i++) r.line(cx, base - 0.3, cx - 4 + i * 4, base + 0.4, 1, fx(SHD, 0));
    r.next(); r.poly([[cx, base - 7], [cx - 7, base - 11], [cx - 2, base - 6]], EAC); r.poly([[cx + 1, base - 10], [cx + 8, base - 14], [cx + 3, base - 9]], EAC);
    var n = p.petals == null ? 5 : p.petals;
    r.next();
    for (var k = 0; k < n; k++) { var a = k / n * Math.PI * 2 + rnd() * 0.3; r.ell(cx + 1 + Math.cos(a) * 5, top + Math.sin(a) * 4.6, 2.6, 2.2, EAC); }
    r.next(); r.ell(cx + 1, top, 4.4, 4, BOD);
    r.line(cx + 2, top + 1.2, cx + 5, top + 1.2, 0.9, M_OUT); r.dot(cx + 3, top + 1.9, EMT); r.dot(cx + 4.4, top + 1.9, EMT);
    r.next(); r.ell(cx + 2.6, top - 1.6, 0.8, 0.8, fx(EYE, 2));
  };
  ENEMY.humanoid = function (r, p) {
    var base = 29.5, cx = 14, b = p.bulk || 1, hunch = p.hunch == null ? 0.5 : p.hunch;
    r.line(cx - 1.5, base - 9, cx - 3, base, 2.4 * b, fx(SHD, 0)); r.line(cx - 4 * b, base - 19, cx - 6 * b, base - 10, 2.2 * b, fx(SHD, 0));
    r.next(); r.line(cx + 1.5, base - 9, cx + 2.5, base, 2.6 * b, SHD);
    r.ell(cx, base - 14, 5 * b, 6.5, BOD);
    r.ell(cx + 2 + hunch * 2.5, base - 22 + hunch * 2, 3.4, 3.4, BOD);
    r.line(cx + 4 * b, base - 18, cx + 7 * b, base - 11, 2.2 * b, BOD);
    if (p.weapon !== 0) { r.next(); r.line(cx + 7 * b, base - 10, cx + 12 * b, base - 20, 1.3, EMT); }
    r.next(); r.ell(cx + 3.6 + hunch * 2.5, base - 22.6 + hunch * 2, 0.8, 0.8, fx(EYE, 2));
  };
  var RIGS = ['humanoid', 'quadruped', 'avian', 'serpent', 'ooze', 'construct', 'floater', 'plant'];
  var RIG_PARAMS = {
    ooze: { width: 0.85, height: 0.7, eyes: 2, drip: 1, crest: 0 }, floater: { size: 0.9, tails: 3, eyes: 2 },
    quadruped: { size: 0.85, legLen: 0.5, neck: 0.5, tail: 1, ears: 1, horns: 0, mane: 0 }, avian: { wingspan: 1, beak: 1, tail: 1 },
    serpent: { coils: 2, length: 1, hood: 0 }, construct: { bulk: 1, arms: 1, glow: 1 }, plant: { height: 0.75, petals: 5 },
    humanoid: { bulk: 1, hunch: 0.5, weapon: 1 }
  };
  RIGS.forEach(function (k) { LIBRARY.push({ key: 'enemy.' + k, layer: 'body', rig: k, label: k.charAt(0).toUpperCase() + k.slice(1) + ' body', gen: { shape: 'enemy.' + k, params: clone(RIG_PARAMS[k]) } }); });
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ---------------------------------------------------------------- portraits
  var EXPRESSIONS = {
    neutral: { brow: 0, tilt: 0, eye: 1, mouth: 'line' }, happy: { brow: -0.4, tilt: 0, eye: 0.55, mouth: 'smile' },
    sad: { brow: 0.4, tilt: 1, eye: 0.8, mouth: 'frown' }, angry: { brow: 0.6, tilt: -1, eye: 0.75, mouth: 'grit' },
    surprised: { brow: -1.2, tilt: 0, eye: 1.3, mouth: 'open' }, determined: { brow: 0.4, tilt: -0.5, eye: 0.85, mouth: 'set' }
  };
  function portraitSize(T) { return clamp(Math.round(T * 3), 24, 96); }
  function portrait(recipe, expr, P) {
    recipe = recipe || {}; var e = typeof expr === 'object' && expr ? expr : EXPRESSIONS[expr] || EXPRESSIONS.neutral;
    var r = new Ras(P, P, P / 48), hair = recipe.hair || 'short', cx = 24, cy = 21, hr = 11.5;
    var hc = hair === 'covered' ? CLB : HAI;
    if (hair === 'long' || hair === 'tied' || hair === 'covered') { r.rect(cx - 13, cy - 4, cx + 13, 41, hc); r.next(); }
    r.poly([[3, 48], [45, 48], [38, 37], [10, 37]], CLA);
    r.poly([[18, 37], [30, 37], [24, 45]], CLB);
    if (recipe.collar === 'plate') { r.ell(10, 41, 6, 4, MET); r.ell(38, 41, 6, 4, MET); }
    r.next(); r.rect(cx - 4, cy + 8, cx + 4, 39, SKN);
    r.next();
    var shp = recipe.head || 'round';
    if (shp === 'square') r.poly([[cx - 10.5, cy - 11], [cx + 10.5, cy - 11], [cx + 11, cy + 5], [cx + 5, cy + 12.5], [cx - 5, cy + 12.5], [cx - 11, cy + 5]], SKN);
    else if (shp === 'long') r.ell(cx, cy + 1, 9.6, 14, SKN);
    else r.ell(cx, cy, hr, 13, SKN);
    r.ell(cx - hr - 0.3, cy + 2, 1.8, 2.8, SKN); r.ell(cx + hr + 0.3, cy + 2, 1.8, 2.8, SKN);
    r.next();
    var ey = cy + 1.5, eo = 5, eh = 2.2 * clamp(e.eye, 0.3, 1.6);
    [-1, 1].forEach(function (sd) {
      var ex = cx + sd * eo;
      if (e.eye > 0.4) { r.ell(ex, ey + 0.2, 1.3, Math.max(0.8, eh * 0.8), M_OUT); r.dot(ex - 0.6, ey - eh * 0.35, fx(SKN, 2)); }
      r.line(ex - 2.4, ey - eh + 0.1, ex + 2.4, ey - eh + 0.1, 0.8, M_OUT);
      r.line(ex - 1.8 * sd, ey + eh * 0.9, ex + 1.2 * sd, ey + eh * 0.9, 0.6, fx(SKN, 0));
      var by = ey - 4.2 + e.brow, inner = ex - sd * 2.2, outer = ex + sd * 2.6;
      r.line(inner, by - e.tilt * 0.9, outer, by + e.tilt * 0.6, 1.1, fx(HAI, 0));
    });
    r.line(cx + 0.4, cy + 4, cx + 1, cy + 6.5, 0.9, fx(SKN, 0));
    var my = cy + 9.5, mw = 3.6 * (recipe.mouth || 1);
    if (e.mouth === 'smile') { r.line(cx - mw, my - 0.8, cx - mw * 0.4, my + 0.5, 0.8, M_OUT); r.line(cx - mw * 0.4, my + 0.5, cx + mw * 0.4, my + 0.5, 0.8, M_OUT); r.line(cx + mw * 0.4, my + 0.5, cx + mw, my - 0.8, 0.8, M_OUT); }
    else if (e.mouth === 'frown') { r.line(cx - mw, my + 0.8, cx - mw * 0.4, my - 0.3, 0.8, M_OUT); r.line(cx - mw * 0.4, my - 0.3, cx + mw * 0.4, my - 0.3, 0.8, M_OUT); r.line(cx + mw * 0.4, my - 0.3, cx + mw, my + 0.8, 0.8, M_OUT); }
    else if (e.mouth === 'open') { r.ell(cx, my + 0.4, mw * 0.55, 1.9, M_OUT); }
    else if (e.mouth === 'grit') { r.rect(cx - mw * 0.8, my - 0.6, cx + mw * 0.8, my + 1, fx(SKN, 2)); r.line(cx - mw * 0.8, my - 0.6, cx + mw * 0.8, my - 0.6, 0.6, M_OUT); r.line(cx - mw * 0.8, my + 1, cx + mw * 0.8, my + 1, 0.6, M_OUT); }
    else r.line(cx - mw * (e.mouth === 'set' ? 0.85 : 0.7), my, cx + mw * (e.mouth === 'set' ? 0.85 : 0.7), my, 0.8, M_OUT);
    r.next();
    if (hair !== 'none') {
      r.clip = [-99, -99, 99, cy - (hair === 'cropped' ? 7 : 3.5)];
      r.ell(cx, cy - 1, hr + 1.4, 14.4, hc);
      r.clip = null;
      if (hair !== 'cropped') { r.rect(cx - hr - 1.4, cy - 5, cx - hr + 2, cy + 6, hc); r.rect(cx + hr - 2, cy - 5, cx + hr + 1.4, cy + 6, hc); }
      if (hair === 'spiked') for (var v = -2; v <= 2; v++) r.poly([[cx + v * 4.6 - 3, cy - 10], [cx + v * 4.6 + 3, cy - 10], [cx + v * 5.4, cy - 19]], hc);
      if (hair === 'tied') { r.next(); r.ell(cx, cy - 15.2, 3.4, 2.8, hc); }
      if (hair === 'covered') r.poly([[cx - 14, cy - 2], [cx - 12, cy - 15], [cx + 12, cy - 15], [cx + 14, cy - 2], [cx + 12, cy + 8], [cx + 10, cy - 4], [cx - 10, cy - 4], [cx - 12, cy + 8]], hc);
      if (hair === 'short' || hair === 'long') r.poly([[cx - 9, cy - 8], [cx + 6, cy - 9], [cx - 2, cy - 4.5]], hc);
    }
    var sh = shadeAndOutline(r, true);
    return { w: P, h: P, ax: P >> 1, ay: P - 1, idx: resolve(r, sh, recipe.accent) };
  }

  // ---------------------------------------------------------------- icons
  // The icon layout: 2 to 4 metal, 5 to 7 wood, 8 to 10 tint (swapped per icon), 11 to 13 cloth, 14 and 15 light.
  var GLYPHS = ['blade', 'staff', 'shield', 'helm', 'body', 'ring', 'vial', 'scroll', 'gem', 'seed', 'tool', 'device'];
  var STATUS_SHAPES = ['drop', 'skull', 'sleep', 'spiral', 'star', 'up', 'down', 'clock', 'heart', 'bolt', 'flame', 'leaf', 'eye', 'chain'];
  var I_MET = M_A, I_WOD = M_B, I_TNT = M_C, I_CLO = M_D, I_LGT = M_E;
  function iconSize(T) { T = Number(T) || 16; return T <= 16 ? Math.max(8, Math.round(T)) : clamp(Math.round(T / 2), 16, 32); }
  var ICON = {
    blade: function (r) { r.line(4, 12, 12.5, 3.5, 1.7, I_MET); r.line(2.8, 9.8, 6.2, 13.2, 1.2, I_TNT); r.line(2.2, 13.8, 4.2, 11.8, 1.3, I_WOD); },
    staff: function (r) { r.line(3, 14, 11, 5, 1.3, I_WOD); r.ell(11.8, 4, 2.4, 2.4, I_TNT); },
    shield: function (r) { r.poly([[3, 2.5], [13, 2.5], [13, 8], [8, 14], [3, 8]], I_MET); r.next(); r.poly([[5, 4.5], [11, 4.5], [11, 8], [8, 11.5], [5, 8]], I_TNT); },
    helm: function (r) { r.clip = [-9, -9, 99, 10]; r.ell(8, 10, 5.6, 7, I_MET); r.clip = null; r.rect(2.4, 10, 13.6, 12.4, I_MET); r.next(); r.rect(6, 8, 10, 9.4, M_OUT); r.line(8, 2.5, 8, 6.5, 1.3, I_TNT); },
    body: function (r) { r.poly([[3, 3], [6, 2.5], [8, 4], [10, 2.5], [13, 3], [13.5, 7], [11.5, 7.5], [11.5, 13.5], [4.5, 13.5], [4.5, 7.5], [2.5, 7]], I_MET); r.next(); r.rect(5.5, 9, 10.5, 10.4, I_TNT); },
    ring: function (r) { r.ell(8, 9.5, 4.6, 4.6, I_MET); r.next(); r.ell(8, 9.5, 2.5, 2.5, 0); r.next(); r.ell(8, 4.4, 2.2, 1.9, I_TNT); },
    vial: function (r) { r.rect(6.6, 2.2, 9.4, 4.2, I_WOD); r.rect(7, 4, 9, 6.4, I_LGT); r.ell(8, 10.2, 4.4, 4.2, I_LGT); r.next(); r.clip = [-9, 9.4, 99, 99]; r.ell(8, 10.2, 4.4, 4.2, I_TNT); r.clip = null; },
    scroll: function (r) { r.rect(3.5, 4, 12.5, 12, I_CLO); r.next(); r.rect(2.4, 2.6, 13.6, 4.6, I_WOD); r.rect(2.4, 11.4, 13.6, 13.4, I_WOD); r.next(); r.line(5, 7, 11, 7, 0.7, M_OUT); r.line(5, 9.4, 10, 9.4, 0.7, M_OUT); },
    gem: function (r) { r.poly([[4, 6], [6.5, 2.8], [9.5, 2.8], [12, 6], [8, 13.5]], I_TNT); r.next(); r.poly([[6.4, 5.6], [8, 3.6], [9.6, 5.6], [8, 9]], fx(I_TNT, 2)); },
    seed: function (r) { r.ell(8, 9.5, 3.8, 4.6, I_WOD); r.next(); r.line(8, 5.2, 10.6, 2.6, 1.2, I_TNT); r.ell(11.4, 2.8, 1.6, 1.1, I_TNT); },
    tool: function (r) { r.line(4, 13, 10, 7, 1.4, I_WOD); r.next(); r.poly([[8, 3], [13.5, 8.5], [11.5, 10.5], [6, 5]], I_MET); },
    device: function (r) { for (var t = 0; t < 7; t++) { var a = -1.25 + t * 0.4; r.line(6 + Math.cos(a) * 5.5, 8 + Math.sin(a) * 6, 6 + Math.cos(a + 0.4) * 5.5, 8 + Math.sin(a + 0.4) * 6, 1.3, I_WOD); } r.line(6 + Math.cos(-1.25) * 5.5, 8 + Math.sin(-1.25) * 6, 6 + Math.cos(1.55) * 5.5, 8 + Math.sin(1.55) * 6, 0.6, I_LGT); r.line(3, 8, 12.5, 8, 0.8, I_TNT); },
    'status.drop': function (r) { r.poly([[8, 2], [12, 9], [4, 9]], I_TNT); r.ell(8, 10, 4, 3.8, I_TNT); },
    'status.skull': function (r) { r.ell(8, 7, 5, 4.8, I_LGT); r.rect(5.4, 10, 10.6, 13.4, I_LGT); r.next(); r.ell(6, 7.4, 1.2, 1.3, M_OUT); r.ell(10, 7.4, 1.2, 1.3, M_OUT); r.line(6.6, 12, 9.4, 12, 0.6, M_OUT); },
    'status.sleep': function (r) { r.line(3, 4, 8, 4, 1.2, I_TNT); r.line(8, 4, 3, 10, 1.2, I_TNT); r.line(3, 10, 8, 10, 1.2, I_TNT); r.line(9.5, 9, 13, 9, 1, I_TNT); r.line(13, 9, 9.5, 13, 1, I_TNT); r.line(9.5, 13, 13, 13, 1, I_TNT); },
    'status.spiral': function (r) { var px = 8, py = 8; for (var t = 0; t < 26; t++) { var a = t * 0.5, rr = 0.4 + t * 0.24, x = 8 + Math.cos(a) * rr, y = 8 + Math.sin(a) * rr; r.line(px, py, x, y, 1.1, I_TNT); px = x; py = y; } },
    'status.star': function (r) { var pts = []; for (var k = 0; k < 10; k++) { var a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? 2.6 : 6.2; pts.push([8 + Math.cos(a) * rr, 8.5 + Math.sin(a) * rr]); } r.poly(pts, I_TNT); },
    'status.up': function (r) { r.poly([[8, 2], [13.5, 8], [10, 8], [10, 14], [6, 14], [6, 8], [2.5, 8]], I_TNT); },
    'status.down': function (r) { r.poly([[8, 14], [13.5, 8], [10, 8], [10, 2], [6, 2], [6, 8], [2.5, 8]], I_TNT); },
    'status.clock': function (r) { r.ell(8, 8, 5.8, 5.8, I_LGT); r.next(); r.line(8, 8, 8, 4.2, 0.9, M_OUT); r.line(8, 8, 10.8, 9.6, 0.9, M_OUT); r.next(); r.dot(8, 8, I_TNT); },
    'status.heart': function (r) { r.ell(5.6, 6.4, 3, 3, I_TNT); r.ell(10.4, 6.4, 3, 3, I_TNT); r.poly([[2.8, 7.4], [13.2, 7.4], [8, 13.6]], I_TNT); },
    'status.bolt': function (r) { r.poly([[9.5, 1.8], [4, 9], [7.6, 9], [6.2, 14.2], [12, 6.6], [8.4, 6.6]], I_TNT); },
    'status.flame': function (r) { r.ell(8, 10, 4.6, 4.2, I_TNT); r.poly([[3.6, 9.6], [12.4, 9.6], [9, 1.8], [7.6, 5.6], [6, 3.8]], I_TNT); r.next(); r.ell(8, 10.8, 2, 2.4, fx(I_TNT, 2)); },
    'status.leaf': function (r) { r.poly([[3, 13], [4, 6], [9, 2.6], [13.4, 3], [12, 9], [6, 12]], I_TNT); r.next(); r.line(3.6, 12.4, 11, 4.4, 0.7, fx(I_TNT, 0)); },
    'status.eye': function (r) { r.poly([[1.8, 8], [5, 4.6], [11, 4.6], [14.2, 8], [11, 11.4], [5, 11.4]], I_LGT); r.next(); r.ell(8, 8, 2.6, 2.6, I_TNT); r.dot(8, 8, M_OUT); },
    'status.chain': function (r) { r.ell(5.6, 8, 3.4, 2.4, I_MET); r.ell(10.4, 8, 3.4, 2.4, I_MET); r.next(); r.ell(5.6, 8, 1.6, 0.9, 0); r.ell(10.4, 8, 1.6, 0.9, 0); }
  };
  function icon(glyph, N) {
    var r = new Ras(N, N, N / 16), g = ICON[glyph] || ICON.gem;
    g(r);
    // A zero code erases (rings and links are hollow); erased pixels must not count as filled.
    return { w: N, h: N, ax: N >> 1, ay: N >> 1, idx: resolve(r, shadeAndOutline(r, true), 'metal') };
  }

  // ---------------------------------------------------------------- composing a sprite
  // spec: {layout, rig, size, proportions, accent, seed, layers: [{layer, gen: {shape, params}} | {layer, px}]}
  // poseKey is a POSES key; dir is down, up, right, or left (left mirrors right). Returns {w, h, ax, ay, idx}.
  function compose(spec, poseKey, dir) {
    if (dir === 'left') { var f = compose(spec, poseKey, 'right'); return { w: f.w, h: f.h, ax: f.w - 1 - f.ax, ay: f.ay, idx: mirror(f.idx, f.w, f.h) }; }
    var T = clamp(Math.round(spec.size || 16), 4, 128), layers = spec.layers || [], pose = poseOf(spec, poseKey);
    if (pose.lie && spec.layout !== 'enemy') return lieDown(spec, pose, dir);
    if (spec.layout === 'enemy') {
      var N = T * 2, r = new Ras(N, N, N / 32), rnd = rng(spec.seed || 1);
      layers.forEach(function (L) {
        if (L.px) blit(r, L.px, poseKey, 'right');
        else { var g = ENEMY[(L.gen.shape || '').replace('enemy.', '')]; if (g) g(r, Object.assign(clone(RIG_PARAMS[(L.gen.shape || '').replace('enemy.', '')] || {}), L.gen.params || {}), rnd); }
        r.next();
      });
      return { w: N, h: N, ax: N >> 1, ay: N - 2, idx: resolve(r, shadeAndOutline(r, true), 'clothB') };
    }
    var fp = framePx(T, spec.proportions, spec.wide), s = T / 16, Wu = fp.w / s, Hu = fp.h / s;
    var byLayer = {};
    layers.forEach(function (L) { byLayer[L.layer] = L; });
    var body = byLayer.body && byLayer.body.gen && byLayer.body.gen.params ? byLayer.body.gen.params.plan : 'average';
    var J = skeleton(body, spec.proportions, pose, dir === 'up' ? 'up' : dir, Wu, Hu);
    var r2 = new Ras(fp.w, fp.h, s), order = ORDER[dir] || ORDER.down;
    if (spec.shadow !== false && !byLayer.shadow) byLayer.shadow = { layer: 'shadow', gen: { shape: 'shadow.ground', params: {} } };
    order.forEach(function (name) {
      var L = byLayer[name];
      if (!L) return;
      if (L.px) blit(r2, L.px, poseKey, dir);
      else { var g = HUMANOID[L.gen && L.gen.shape]; if (g) g(r2, J, L.gen.params || {}); }
      r2.next();
    });
    return { w: fp.w, h: fp.h, ax: Math.round(J.cx * s), ay: Math.min(fp.h - 1, Math.round(J.footY * s)), idx: resolve(r2, shadeAndOutline(r2, true), spec.accent) };
  }
  // A pose key resolves through the spec's own pose table (sprite and project overrides) over the engine defaults; a
  // pose may also be passed as an object. Unknown keys fall back to stand.
  function poseOf(spec, key) {
    if (key && typeof key === 'object') return Object.assign({ legs: [0, 0], arms: [0, 0] }, key);
    var own = spec && spec.poses && spec.poses[key], base = POSES[key] || (own && own.base && POSES[own.base]) || POSES.stand;
    if (!own) return base;
    var out = Object.assign({}, base, own);
    out.legs = own.legs || base.legs || [0, 0]; out.arms = own.arms || base.arms || [0, 0];
    return out;
  }
  // Lying down: compose the figure standing with limp limbs and no ground shadow, turn it a quarter turn so the head
  // points behind, and rest it on the bottom row. Rotation is exact, so outlines and shading survive.
  function lieDown(spec, pose, dir) {
    var flat = Object.assign({}, pose, { lie: false, crouch: 0, bob: 0, kneel: false, sit: false, ready: false, wpn: 160, reach: [[0.05, 0.95], [0.1, 0.95]] });
    var d = dir === 'up' || dir === 'down' ? 'right' : dir;
    // Composed one tile wide even for battle sprites: rotating a two tile battle frame would make a tall frame.
    var f = compose(Object.assign({}, spec, { shadow: false, poses: null, wide: false }), flat, d === 'left' ? 'right' : d);
    var W = f.h, H = f.w, out = new Uint8Array(W * H), last = 0;
    for (var y = 0; y < f.h; y++) for (var x = 0; x < f.w; x++) {
      var v = f.idx[y * f.w + x];
      if (!v) continue;
      var X = y, Y = f.w - 1 - x;
      out[Y * W + X] = v;
      if (Y > last) last = Y;
    }
    // Drop the figure so its lowest pixel sits on the frame's bottom row (the ground line).
    var drop = H - 1 - last;
    if (drop > 0) { var sh = new Uint8Array(W * H); for (var i = 0; i < W * (H - drop); i++) sh[i + W * drop] = out[i]; out = sh; }
    var res = { w: W, h: H, ax: W >> 1, ay: H - 1, idx: out };
    if (dir === 'left') res.idx = mirror(res.idx, W, H);
    return res;
  }
  // A hand drawn part: variants keyed "<pose>.<dir>" (or "<dir>", or "*"), each {w, h, d} in local slots at the part's
  // base size. Variants at another size are resampled with nearest neighbor, which the editor warns about.
  function pickVariant(px, poseKey, dir) {
    var v = px && px.variants || {};
    return v[poseKey + '.' + dir] || v['stand.' + dir] || v[dir] || v['*'] || null;
  }
  function blit(r, px, poseKey, dir) {
    var v = pickVariant(px, poseKey, dir === 'left' ? 'right' : dir);
    if (!v) return;
    var a;
    try { a = decodePx(v.d, v.w, v.h); } catch (e) { return; }
    a = fit(a, v.w, v.h, r.w, r.h);
    for (var i = 0; i < a.length; i++) if (a[i]) { r.c[i] = slotCell(a[i]); r.l[i] = r.layer; }
  }
  // Just one layer rasterized alone and resolved to slots: what "draw a part by hand" starts from.
  function partFrame(spec, layerName, poseKey, dir) {
    var only = (spec.layers || []).filter(function (L) { return L.layer === layerName || L.layer === 'body'; });
    var full = compose(Object.assign({}, spec, { layers: only, shadow: false }), poseKey, dir);
    if (layerName === 'body') return full;
    var base = compose(Object.assign({}, spec, { layers: only.filter(function (L) { return L.layer === 'body'; }), shadow: false }), poseKey, dir);
    var out = new Uint8Array(full.idx.length);
    for (var i = 0; i < out.length; i++) out[i] = full.idx[i] !== base.idx[i] ? full.idx[i] : 0;
    return { w: full.w, h: full.h, ax: full.ax, ay: full.ay, idx: out };
  }

  // ---------------------------------------------------------------- records to specs (pure; art is bundle.art)
  function recs(art, p) { return art && art.records && art.records[p] && typeof art.records[p] === 'object' ? art.records[p] : {}; }
  function rec(art, id) { var p = typeof id === 'string' ? id.slice(0, 4) : ''; return recs(art, p)[id] || null; }
  // A tier family sprite shares its base sprite's recipe and overrides and keeps its own palette.
  function baseSprite(art, spr) {
    var seen = {}, s = spr;
    while (s && s.shares && !seen[s.id]) { seen[s.id] = 1; s = rec(art, s.shares); }
    return s || spr;
  }
  // Optional poses a project adds to its taxonomy: entries {key, label, required: false, pose: {base, ...params}}.
  function artPoses(art) {
    var out = {}, tax = art && art.poseTaxonomy;
    if (!tax || typeof tax !== 'object') return out;
    Object.keys(tax).forEach(function (g) { (Array.isArray(tax[g]) ? tax[g] : []).forEach(function (e) { if (e && e.key && e.pose && typeof e.pose === 'object') out[e.key] = e.pose; }); });
    return out;
  }
  function spriteSpec(art, spr, size) {
    var b = baseSprite(art, spr), rc = b && b.recipe || {}, parts = rc.parts || {}, layers = [];
    Object.keys(parts).forEach(function (layer) {
      var pid = parts[layer];
      if (!pid) return;
      var p = rec(art, pid);
      if (!p) return;
      if (p.px && p.px.variants && Object.keys(p.px.variants).length) layers.push({ layer: layer, px: p.px });
      else if (p.gen) layers.push({ layer: layer, gen: { shape: p.gen.shape, params: Object.assign({}, p.gen.params || {}, (rc.params && rc.params[layer]) || {}) } });
    });
    var cw = rc.colorway || {};
    var poses = Object.assign({}, artPoses(art), b && b.poses || {}, spr !== b && spr.poses || {});
    return { poses: poses, layout: spr.kind === 'enemy' ? 'enemy' : 'humanoid', rig: rc.rig || 'humanoid', size: size, proportions: rc.proportions || {}, accent: rc.accent || cw.accent || 'clothB', seed: b.seed, layers: layers, shadow: spr.mode !== 'battle', wide: spr.mode === 'battle' && spr.kind !== 'enemy' };
  }
  // The frame with any hand edited override applied. Overrides are keyed "<pose>.<dir>" and stored at the size they
  // were drawn; left falls back to mirroring right.
  function spriteFrame(art, spr, poseKey, dir, size, accentOverride) {
    // Overrides on the sprite itself win over the ones it inherits from a shared base.
    var b = baseSprite(art, spr), ov = Object.assign({}, b && b.overrides || {}, spr && spr !== b && spr.overrides || {});
    var key = poseKey + '.' + dir, o = ov[key];
    var spec = spriteSpec(art, spr, size);
    if (accentOverride) spec.accent = accentOverride;
    if (!o && dir === 'left' && ov[poseKey + '.right']) { var f = spriteFrame(art, spr, poseKey, 'right', size, accentOverride); return { w: f.w, h: f.h, ax: f.w - 1 - f.ax, ay: f.ay, idx: mirror(f.idx, f.w, f.h), override: f.override }; }
    var g = compose(spec, poseKey, dir);
    if (o) {
      try {
        var a = decodePx(o.d, o.w, o.h);
        a = fit(a, o.w, o.h, g.w, g.h);
        return { w: g.w, h: g.h, ax: g.ax, ay: g.ay, idx: a, override: true, resampled: o.h !== g.h || o.w > g.w };
      } catch (e) { g.badOverride = e.message; }
    }
    return g;
  }
  function portraitFrame(art, por, expr, size) {
    var ov = por && por.overrides || {}, o = ov[expr], P = por && por.size || portraitSize(size);
    var e = Object.assign({}, EXPRESSIONS[expr] || EXPRESSIONS.neutral, (por && por.expressions && por.expressions[expr]) || {});
    var g = portrait(por && por.recipe, e, P);
    if (o) { try { var a = decodePx(o.d, o.w, o.h); if (o.w !== P || o.h !== P) a = resample(a, o.w, o.h, P, P); return { w: P, h: P, ax: g.ax, ay: g.ay, idx: a, override: true }; } catch (e2) { g.badOverride = e2.message; } }
    return g;
  }
  function iconFrame(art, ico, size) {
    var N = ico && ico.size || iconSize(size);
    if (ico && ico.px && ico.px.d) { try { var a = decodePx(ico.px.d, ico.px.w, ico.px.h); if (ico.px.w !== N || ico.px.h !== N) a = resample(a, ico.px.w, ico.px.h, N, N); return { w: N, h: N, ax: N >> 1, ay: N >> 1, idx: a, override: true }; } catch (e) {} }
    return icon(ico && ico.gen && ico.gen.glyph, N);
  }
  // Local slots to master indices for one record: the sprite's pal_, with an icon's tint ramp swapped into 8 to 10.
  function slotsFor(art, palId, tintRamp) {
    var p = rec(art, palId), s = p && Array.isArray(p.slots) ? p.slots.slice() : null;
    if (s && tintRamp && tintRamp.length === 3) { s[8] = tintRamp[0]; s[9] = tintRamp[1]; s[10] = tintRamp[2]; }
    return s;
  }
  function rgba(idx, slots, entries) {
    var out = new Uint8ClampedArray(idx.length * 4), lut = [];
    for (var k = 0; k < 32; k++) { var m = slots && k ? slots[k] : null, rgb = typeof m === 'number' && entries[m] ? hexToRgb(entries[m]) : null; lut.push(rgb); }
    for (var i = 0; i < idx.length; i++) {
      var c = lut[idx[i]];
      if (!c) continue;
      out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255;
    }
    return out;
  }

  // ---------------------------------------------------------------- bake cache
  // createCache(art, {size, entries, makeCanvas(w, h), budget}) bakes frames once and keeps them in an LRU capped by an
  // estimate of their memory (index plus RGBA plus canvas). makeCanvas is the host's; without it frames carry RGBA only.
  function lightest(list) { var bi = null, bl = -1; (list || []).forEach(function (h) { var l = hexToLab(h); if (l && l[0] > bl) { bl = l[0]; bi = h; } }); return bi || '#ffffff'; }
  function createCache(art, opts) {
    opts = opts || {};
    var map = new Map(), tmemo = new Map(), bytes = 0, cap = opts.budget || 8e6, st = { hits: 0, misses: 0, evictions: 0 };
    function put(k, v) {
      v.bytes = v.w * v.h * (v.canvas ? 9 : 5);
      map.set(k, v); bytes += v.bytes;
      var it = map.keys();
      while (bytes > cap && map.size > 1) { var old = it.next().value; if (old === k) continue; bytes -= map.get(old).bytes; map.delete(old); st.evictions++; }
    }
    function get(k, make) {
      if (map.has(k)) { var v = map.get(k); map.delete(k); map.set(k, v); st.hits++; return v; }
      st.misses++;
      var f = make();
      if (!f) return null;
      if (opts.makeCanvas) {
        var cv = opts.makeCanvas(f.w, f.h), ctx = cv && cv.getContext && cv.getContext('2d');
        if (ctx) { var im = ctx.createImageData(f.w, f.h); im.data.set(f.rgba); ctx.putImageData(im, 0, 0); f.canvas = cv; }
      }
      put(k, f);
      return f;
    }
    var T = opts.size || 16, entries = opts.entries || [];
    function finish(f, slots) { if (!f) return null; f.rgba = rgba(f.idx, slots, entries); return f; }
    return {
      // flags 'flash' bakes the frame's silhouette in the palette's lightest color (the hurt flash).
      sprite: function (sprId, poseKey, dir, palId, flags) {
        var spr = rec(art, sprId);
        if (!spr) return null;
        var pal = palId || spr.pal;
        return get('s|' + sprId + '|' + poseKey + '|' + dir + '|' + pal + (flags ? '|' + flags : ''), function () {
          var f = finish(spriteFrame(art, spr, poseKey, dir, T), slotsFor(art, pal));
          if (f && flags === 'flash') { var c = hexToRgb(lightest(entries)) || [255, 255, 255]; for (var i = 0; i < f.idx.length; i++) if (f.idx[i]) { f.rgba[i * 4] = c[0]; f.rgba[i * 4 + 1] = c[1]; f.rgba[i * 4 + 2] = c[2]; } }
          return f;
        });
      },
      portrait: function (porId, expr) {
        var por = rec(art, porId);
        if (!por) return null;
        return get('p|' + porId + '|' + expr, function () { return finish(portraitFrame(art, por, expr, T), slotsFor(art, por.pal)); });
      },
      icon: function (icoId) {
        var ico = rec(art, icoId);
        if (!ico) return null;
        return get('i|' + icoId, function () { return finish(iconFrame(art, ico, T), slotsFor(art, ico.pal, ico.tintRamp)); });
      },
      // Phase 4: one tile of a tileset, baked lazily per blob index and animation frame (ENGINE_RENDER.tiles). key names
      // an interior tile; variant picks a decorated full fill. Templates are memoized per cache, outside the LRU.
      tile: function (tilId, blob, frame, key, variant) {
        var til = rec(art, tilId);
        if (!til) return null;
        return get('t|' + tilId + '|' + (blob | 0) + '|' + (frame | 0) + '|' + (key || '') + '|' + (variant | 0), function () { return tileBake(art, til, blob | 0, frame | 0, key || null, variant | 0, T, entries, tmemo); });
      },
      invalidate: function (id) { var tag = '|' + id + '|', tail = '|' + id; Array.from(map.keys()).forEach(function (k) { if (k.indexOf(tag) >= 0 || k.slice(-tail.length) === tail) { bytes -= map.get(k).bytes; map.delete(k); } }); Array.from(tmemo.keys()).forEach(function (k) { if (k.indexOf(id + '|') === 0) tmemo.delete(k); }); },
      size: T, entries: entries, art: art,
      stats: function () { return { entries: map.size, templates: tmemo.size, bytes: bytes, budget: cap, hits: st.hits, misses: st.misses, evictions: st.evictions }; },
      clear: function () { map.clear(); tmemo.clear(); bytes = 0; },
      budget: function (n) { if (n > 0) { cap = n; var it = map.keys(); while (bytes > cap && map.size > 1) { var k = it.next().value; bytes -= map.get(k).bytes; map.delete(k); st.evictions++; } } return cap; }
    };
  }

  R.sprite = {
    LAYERS: LAYERS, ORDER: ORDER, POSES: POSES, BODY_PLANS: BODY_PLANS, LIBRARY: LIBRARY, RIGS: RIGS, RIG_PARAMS: RIG_PARAMS,
    GENERATORS: Object.keys(HUMANOID).concat(RIGS.map(function (k) { return 'enemy.' + k; })),
    DIRS: ['down', 'up', 'right', 'left'], FIELD_POSES: ['stand', 'stepA', 'stepB'],
    BATTLE_POSES: ['idle', 'ready', 'step', 'windup', 'attack', 'cast', 'item', 'hurt', 'kneel', 'ko', 'revive', 'victory', 'limit'],
    EMOTE_POSES: ['nod', 'shakeL', 'shakeR', 'crouch', 'jump', 'sit', 'kneel', 'ko', 'laugh', 'laughB'],
    ENEMY_POSES: ['idle', 'attack', 'hurt'], poseOf: poseOf, artPoses: artPoses,
    handPoses: function () {
      var out = [], seen = {};
      function add(p, d) { if (POSES[p] && POSES[p].lie) return; var k = p + '.' + d; if (!seen[k]) { seen[k] = 1; out.push([p, d]); } }
      ['stand', 'stepA', 'stepB'].forEach(function (p) { ['down', 'up', 'right'].forEach(function (d) { add(p, d); }); });
      ['idle', 'ready', 'step', 'windup', 'attack', 'cast', 'item', 'hurt', 'kneel', 'revive', 'victory', 'limit'].forEach(function (p) { add(p, 'right'); });
      ['nod', 'shakeL', 'shakeR', 'crouch', 'jump', 'sit', 'kneel', 'laugh', 'laughB'].forEach(function (p) { add(p, 'down'); });
      return out;
    },
    framePx: framePx, compose: compose, partFrame: partFrame, mirror: mirror, resample: resample, slotCell: slotCell,
    spec: spriteSpec, frame: spriteFrame, base: baseSprite, slotsFor: slotsFor, rgba: rgba
  };
  R.portrait = { EXPRESSIONS: EXPRESSIONS, size: portraitSize, compose: portrait, frame: portraitFrame };
  R.icon = { GLYPHS: GLYPHS, STATUS_SHAPES: STATUS_SHAPES, size: iconSize, compose: icon, frame: iconFrame };
  R.createCache = createCache;

  // ================================================================ PHASE 3: MOTION
  // build.js splices this file into ENGINE:RENDER after the composer. It reads no host global: records, palettes, and
  // drawing contexts arrive as arguments. Drawing uses fillRect and drawImage only, at logical resolution.

  // ---------------------------------------------------------------- animation records
  // anm_ kinds:
  //   sprite  {frames: [{pose, ms, off: [dx, dy], flash}], loop, markers: [{f, type, arg}]}
  //           off is in logical pixels at a 16 pixel tile (scaled by tile size); dx is forward, so it flips facing left.
  //   death   {method: scatter|fade|melt, ms}: generated at runtime from the sprite's own pixels.
  //   ability {caster: attack|cast|item|limit, travel: {type: none|projectile|beam|rise|fall, ms},
  //            impact: {fx: efx_ id or null, ms, flash, shake}, hits, markers: [{ms, type, arg}]}
  var MARKER_TYPES = ['hit', 'sfx', 'particle', 'flash', 'shake'];
  var DEATH_METHODS = ['scatter', 'fade', 'melt'];
  var CASTERS = ['attack', 'cast', 'item', 'limit'];
  var TRAVELS = ['none', 'projectile', 'beam', 'rise', 'fall'];
  function frames(anm) { return anm && Array.isArray(anm.frames) ? anm.frames.filter(function (f) { return f && typeof f === 'object'; }) : []; }
  function frameMs(f) { var m = Number(f && f.ms); return m > 0 ? Math.min(m, 10000) : 100; }
  function duration(anm) {
    if (!anm) return 0;
    if (anm.kind === 'death') return Math.max(1, Number(anm.ms) || 700);
    if (anm.kind === 'ability') { var tl = abilityTimeline(anm, null); return tl.duration; }
    return frames(anm).reduce(function (s, f) { return s + frameMs(f); }, 0);
  }
  function frameStart(anm, i) { var fr = frames(anm), t = 0; for (var k = 0; k < i && k < fr.length; k++) t += frameMs(fr[k]); return t; }
  // frameAt(anm, t) -> {index, pose, off, flash, ms, done, cycle}. A looping animation wraps; a one shot holds its last
  // frame and reports done.
  function frameAt(anm, t) {
    var fr = frames(anm), D = duration(anm);
    if (!fr.length || !(D > 0)) return { index: 0, pose: 'stand', off: [0, 0], flash: false, ms: 0, done: true, cycle: 0 };
    t = Math.max(0, Number(t) || 0);
    var cycle = 0, done = false;
    if (anm.loop) { cycle = Math.floor(t / D); t = t - cycle * D; } else if (t >= D) { done = true; t = D - 0.0001; }
    var acc = 0;
    for (var i = 0; i < fr.length; i++) {
      var m = frameMs(fr[i]);
      if (t < acc + m) {
        var f = fr[i], off = Array.isArray(f.off) ? [Number(f.off[0]) || 0, Number(f.off[1]) || 0] : [0, 0];
        return { index: i, pose: f.pose || 'stand', off: off, flash: !!f.flash, ms: m, done: done, cycle: cycle, local: t - acc };
      }
      acc += m;
    }
    var L = fr[fr.length - 1];
    return { index: fr.length - 1, pose: L.pose || 'stand', off: L.off || [0, 0], flash: !!L.flash, ms: frameMs(L), done: true, cycle: cycle };
  }
  // Markers whose frame starts in (t0, t1], across loops. Pass t0 = -1 at the start so frame zero markers fire.
  function markersBetween(anm, t0, t1) {
    var mk = anm && Array.isArray(anm.markers) ? anm.markers : [], out = [], D = duration(anm);
    if (!mk.length || !(D > 0) || !(t1 > t0)) return out;
    var times = mk.map(function (m) { return anm.kind === 'ability' ? Number(m.ms) || 0 : frameStart(anm, m.f | 0); });
    var c0 = anm.loop ? Math.max(0, Math.floor(Math.max(0, t0) / D)) : 0, c1 = anm.loop ? Math.floor(t1 / D) : 0;
    for (var c = c0; c <= c1; c++) {
      mk.forEach(function (m, i) {
        var at = c * D + times[i];
        if (at > t0 && at <= t1) out.push({ type: m.type, arg: m.arg == null ? null : m.arg, f: m.f, t: at });
      });
    }
    return out.sort(function (a, b) { return a.t - b.t; });
  }
  function firstMarker(anm, type) {
    var mk = anm && Array.isArray(anm.markers) ? anm.markers : [];
    for (var i = 0; i < mk.length; i++) if (mk[i] && mk[i].type === type) return anm.kind === 'ability' ? Number(mk[i].ms) || 0 : frameStart(anm, mk[i].f | 0);
    return null;
  }
  // The animation a sprite plays for a taxonomy key: the sprite's own map, then its shared base's, then the library
  // record whose subject is role anim:<key>.
  function animFor(art, spr, key) {
    var b = spr ? baseSprite(art, spr) : null, id = (spr && spr.anims && spr.anims[key]) || (b && b.anims && b.anims[key]);
    var r = id ? rec(art, id) : null;
    if (r) return r;
    var all = recs(art, 'anm_'), ks = Object.keys(all);
    for (var i = 0; i < ks.length; i++) { var a = all[ks[i]]; if (a && a.subject && a.subject.kind === 'role' && a.subject.ref === 'anim:' + key) return a; }
    return null;
  }

  // ---------------------------------------------------------------- small pixel helpers
  function rgbStr(hex) { return normHex(hex) || '#ffffff'; }
  function px(ctx, x, y, s) { ctx.fillRect(Math.round(x), Math.round(y), s || 1, s || 1); }
  function pxLine(ctx, x0, y0, x1, y1, s) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    var dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, e = dx + dy, n = 0;
    while (n++ < 4000) {
      ctx.fillRect(x0, y0, s || 1, s || 1);
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
  }
  function unitOf(size) { return Math.max(1, Math.round((Number(size) || 16) / 16)); }

  // ---------------------------------------------------------------- death (scatter, fade, melt)
  // deathPixels(frame, method, p, seed) -> [{x, y, i, a}]: the visible pixels at progress p (0 to 1), in frame
  // coordinates, with i the pixel's index in the frame and a its alpha. Pure, so the presenter and tests share it.
  function deathPixels(frame, method, p, seed) {
    var out = [], w = frame.w, h = frame.h, idx = frame.idx, r = rng(seed || 7), cx = w / 2, cy = h / 2;
    p = clamp(Number(p) || 0, 0, 1);
    var cols = [];
    for (var c = 0; c < w; c++) cols.push(0.45 + r() * 0.55);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = y * w + x;
      if (!idx[i]) continue;
      var hh = hash32(seed + ':' + i) / 4294967296;
      if (method === 'fade') { if (hh >= 1 - p) continue; out.push({ x: x, y: y, i: i, a: 1 }); continue; }
      if (method === 'melt') {
        var dy = p * h * 1.15 * cols[x], ny = y + dy;
        if (ny > h - 1) continue;
        out.push({ x: x, y: ny, i: i, a: 1 - p * 0.5 });
        continue;
      }
      // scatter: every pixel flies out from the center, faster the farther out it starts, and fades.
      var ax = x - cx + (hh - 0.5) * 2, ay = y - cy + (hash32(i + ':' + seed) / 4294967296 - 0.5) * 2, d = Math.sqrt(ax * ax + ay * ay) || 1;
      var k = p * p * (w * 0.9) * (0.6 + hh * 0.8);
      out.push({ x: x + ax / d * k, y: y + ay / d * k - p * h * 0.15, i: i, a: 1 - p });
    }
    return out;
  }
  function drawDeath(ctx, frame, method, p, x0, y0, seed) {
    var pts = deathPixels(frame, method, p, seed), rgba = frame.rgba, last = '', la = -1;
    for (var k = 0; k < pts.length; k++) {
      var q = pts[k], o = q.i * 4;
      if (!rgba || !rgba[o + 3]) continue;
      var st = 'rgb(' + rgba[o] + ',' + rgba[o + 1] + ',' + rgba[o + 2] + ')';
      if (st !== last) { ctx.fillStyle = st; last = st; }
      var a = clamp(q.a, 0, 1);
      if (a !== la) { ctx.globalAlpha = a; la = a; }
      ctx.fillRect(Math.round(x0 + q.x), Math.round(y0 + q.y), 1, 1);
    }
    ctx.globalAlpha = 1;
    return pts.length;
  }

  // ---------------------------------------------------------------- drawing sprites with animation
  function blitFrame(ctx, f, x, y) {
    if (!f) return;
    if (f.canvas) { ctx.drawImage(f.canvas, x, y); return; }
    // No host canvas (tests, workers): draw the pixels one by one.
    var last = '';
    for (var i = 0; i < f.w * f.h; i++) {
      var o = i * 4;
      if (!f.rgba[o + 3]) continue;
      var st = 'rgb(' + f.rgba[o] + ',' + f.rgba[o + 1] + ',' + f.rgba[o + 2] + ')';
      if (st !== last) { ctx.fillStyle = st; last = st; }
      ctx.fillRect(x + i % f.w, y + Math.floor(i / f.w), 1, 1);
    }
  }
  // draw.sprite(ctx, cache, sprId, anm, tMs, x, y, opts) draws the sprite's anchor (feet) at x, y.
  // anm is an anm_ record (or null for opts.pose held still). opts: {dir, pal, flash, alpha, pose, seed}.
  // Returns the frame info used, or null.
  function drawSprite(ctx, cache, sprId, anm, tMs, x, y, opts) {
    opts = opts || {};
    var dir = opts.dir || 'down', u = unitOf(cache.size), fi;
    if (anm && anm.kind === 'death') {
      var base = cache.sprite(sprId, opts.pose || 'idle', dir, opts.pal);
      if (!base) return null;
      var p = clamp((Number(tMs) || 0) / duration(anm), 0, 1);
      if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
      drawDeath(ctx, base, anm.method || 'scatter', p, Math.round(x - base.ax), Math.round(y - base.ay), opts.seed || 7);
      ctx.globalAlpha = 1;
      return { pose: opts.pose || 'idle', death: true, p: p, done: p >= 1 };
    }
    fi = anm ? frameAt(anm, tMs) : { pose: opts.pose || 'stand', off: [0, 0], flash: false, done: true };
    var f = cache.sprite(sprId, fi.pose, dir, opts.pal, fi.flash || opts.flash ? 'flash' : null);
    if (!f) return null;
    var fdx = (fi.off[0] || 0) * u * (dir === 'left' ? -1 : 1), fdy = (fi.off[1] || 0) * u;
    if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
    blitFrame(ctx, f, Math.round(x - f.ax + fdx), Math.round(y - f.ay + fdy));
    if (opts.alpha != null) ctx.globalAlpha = 1;
    fi.w = f.w; fi.h = f.h; fi.ax = f.ax; fi.ay = f.ay;
    return fi;
  }

  // ---------------------------------------------------------------- particle systems
  // spec: {x, y, colors: [hex x 4 (dark, base, light, hot)], particle: {shape, count, life, gravity, spread, speed},
  //        mode: burst|rise|fall|stream, to: {x, y} (bolts aim here), unit, radius}
  // create(spec, seed) -> sys; step(sys, dtMs) -> live count; draw(ctx, sys).
  var SHAPES = ['spark', 'flake', 'bubble', 'shard', 'ring', 'wisp', 'bolt'];
  function spawn(sys, r) {
    var pt = sys.pt, u = sys.unit, shape = sys.shape, sp = (Number(pt.speed) || 1) * 46 * u, spread = clamp(Number(pt.spread) || 1, 0.1, 3);
    var a, v = sp * (0.45 + r() * 0.75), q = { age: 0, life: (Number(pt.life) || 420) * (0.6 + r() * 0.6), seed: (r() * 1e9) >>> 0, c: r() < 0.3 ? 3 : r() < 0.6 ? 2 : 1 };
    var R = (sys.radius || 6 * u);
    if (sys.mode === 'rise') { q.x = sys.x + (r() - 0.5) * R * 2 * spread; q.y = sys.y + r() * R * 0.5; a = -Math.PI / 2 + (r() - 0.5) * 0.6 * spread; }
    else if (sys.mode === 'fall') { q.x = sys.x + (r() - 0.5) * R * 2 * spread; q.y = sys.y - R * 3 - r() * R * 2; a = Math.PI / 2 + (r() - 0.5) * 0.4 * spread; v *= 1.6; }
    else { q.x = sys.x + (r() - 0.5) * u * 2; q.y = sys.y + (r() - 0.5) * u * 2; a = r() * Math.PI * 2; if (spread < 1) a = -Math.PI / 2 + (a - Math.PI) * spread; }
    q.vx = Math.cos(a) * v; q.vy = Math.sin(a) * v;
    if (shape === 'bubble') q.vy -= sp * 0.4;
    if (shape === 'ring') { q.vx *= 0.15; q.vy *= 0.15; q.r0 = 1 + r() * 2; }
    return q;
  }
  function fxCreate(spec, seed) {
    spec = spec || {};
    var pt = spec.particle || {}, r = rng(seed || 1), shape = SHAPES.indexOf(pt.shape) >= 0 ? pt.shape : 'spark';
    var cols = (spec.colors || []).map(rgbStr);
    while (cols.length < 4) cols.push(cols[cols.length - 1] || '#ffffff');
    var sys = { x: Number(spec.x) || 0, y: Number(spec.y) || 0, to: spec.to || null, unit: Math.max(1, Math.round(spec.unit || 1)), shape: shape, pt: pt, colors: cols,
      mode: spec.mode || 'burst', radius: spec.radius || 0, gravity: Number(pt.gravity) || 0, parts: [], t: 0, rnd: r, seed: seed || 1 };
    var n = clamp(Math.round(Number(pt.count) || 12), 1, 120);
    if (shape === 'ring') n = Math.max(1, Math.min(4, Math.round(n / 5)));
    if (shape === 'bolt') n = Math.max(1, Math.min(3, Math.round(n / 6)));
    for (var i = 0; i < n; i++) sys.parts.push(spawn(sys, r));
    return sys;
  }
  function fxStep(sys, dt) {
    dt = Math.max(0, Math.min(100, Number(dt) || 0));
    sys.t += dt;
    var s = dt / 1000, g = sys.gravity * 220 * sys.unit, live = 0;
    sys.parts.forEach(function (q) {
      if (q.age >= q.life) return;
      q.age += dt;
      if (sys.shape === 'wisp') q.vx += Math.sin((q.age + q.seed) / 90) * 20 * s * sys.unit;
      q.vy += g * s;
      var drag = sys.shape === 'flake' || sys.shape === 'wisp' ? 0.985 : 0.995;
      q.vx *= drag; q.vy *= drag;
      q.x += q.vx * s; q.y += q.vy * s;
      if (q.age < q.life) live++;
    });
    return live;
  }
  function fxDone(sys) { return sys.parts.every(function (q) { return q.age >= q.life; }); }
  function fxDraw(ctx, sys) {
    var u = sys.unit;
    sys.parts.forEach(function (q) {
      if (q.age >= q.life) return;
      var k = q.age / q.life, ci = k < 0.25 ? 3 : k < 0.6 ? q.c : k < 0.85 ? 1 : 0;
      ctx.fillStyle = sys.colors[ci];
      ctx.globalAlpha = k > 0.75 ? clamp((1 - k) * 4, 0, 1) : 1;
      var x = q.x, y = q.y;
      switch (sys.shape) {
        case 'flake': px(ctx, x, y, u); px(ctx, x - u, y, u); px(ctx, x + u, y, u); px(ctx, x, y - u, u); px(ctx, x, y + u, u); break;
        case 'bubble': [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]].forEach(function (d) { if (d[0] && d[1]) return; px(ctx, x + d[0] * u, y + d[1] * u, u); }); ctx.fillStyle = sys.colors[3]; px(ctx, x - u, y - u, u); break;
        case 'shard': var m = Math.sqrt(q.vx * q.vx + q.vy * q.vy) || 1; px(ctx, x, y, u); px(ctx, x - q.vx / m * u * 1.5, y - q.vy / m * u * 1.5, u); px(ctx, x - q.vx / m * u * 3, y - q.vy / m * u * 3, u); break;
        case 'ring': var rr = (q.r0 + k * 9) * u, n = Math.max(8, Math.round(rr * 1.6)); for (var j = 0; j < n; j++) px(ctx, x + Math.cos(j / n * 6.283) * rr, y + Math.sin(j / n * 6.283) * rr * 0.75, u); break;
        case 'wisp': px(ctx, x, y, u * 2); ctx.globalAlpha *= 0.5; px(ctx, x - q.vx * 0.04, y - q.vy * 0.04, u * 2); break;
        case 'bolt':
          var tx = sys.to ? sys.to.x : sys.x + (q.vx > 0 ? 1 : -1) * 20 * u, ty = sys.to ? sys.to.y : sys.y - 30 * u, br = rng(q.seed + Math.floor(q.age / 60)), segs = 6, px0 = sys.x, py0 = sys.y;
          for (var g2 = 1; g2 <= segs; g2++) { var f2 = g2 / segs, nx = sys.x + (tx - sys.x) * f2 + (g2 < segs ? (br() - 0.5) * 8 * u : 0), ny = sys.y + (ty - sys.y) * f2 + (g2 < segs ? (br() - 0.5) * 4 * u : 0); pxLine(ctx, px0, py0, nx, ny, u); px0 = nx; py0 = ny; }
          break;
        default: px(ctx, x, y, u); ctx.globalAlpha *= 0.6; px(ctx, x - q.vx * 0.03, y - q.vy * 0.03, u);
      }
    });
    ctx.globalAlpha = 1;
  }
  // Screen behavior of an effect at progress p (0 to 1): shake offsets, a darkening alpha, and a wave amplitude.
  function screenAt(kind, p, unit, seed) {
    var e = Math.max(0, 1 - p), u = unit || 1, r = rng(((seed || 1) + Math.floor(p * 40)) >>> 0);
    return {
      shake: kind === 'shake' ? [Math.round((r() - 0.5) * 4 * u * e), Math.round((r() - 0.5) * 3 * u * e)] : [0, 0],
      darken: kind === 'darken' ? 0.45 * Math.sin(Math.min(1, p) * Math.PI) : 0,
      wave: kind === 'wave' ? Math.round(2 * u * e) : 0
    };
  }
  // Applies a wave to rows already drawn on ctx (drawImage of the canvas onto itself, one row strip at a time).
  function applyWave(ctx, amp, tMs, w, h) {
    if (!amp || !ctx.canvas) return;
    for (var y = 0; y < h; y += 2) { var dx = Math.round(Math.sin(y / 6 + tMs / 70) * amp); if (dx) ctx.drawImage(ctx.canvas, 0, y, w, 2, dx, y, w, 2); }
  }

  // ---------------------------------------------------------------- weather overlays
  // wov: {layers: [{type, density, angle, speed, depth, m}], tint: {m, alpha}, lightning: {every: [min, max], flashMs, m}}
  // create(wov, w, h, seed, {entries, unit}) -> state; step(state, dtMs); draw(ctx, state).
  // Particle counts scale with the logical area (a 256 by 224 screen is the reference), never with screen pixels.
  var WEATHER_TYPES = ['streak', 'flake', 'mote', 'band', 'bolt', 'leaf', 'none'];
  var WEATHER_BASE = { streak: 140, flake: 90, mote: 70, leaf: 16, band: 5, bolt: 0, none: 0 };
  function wParticle(L, st, r, fresh) {
    var q = { x: r() * st.w, y: fresh ? r() * st.h : -r() * 20, z: 0.45 + r() * 0.55 * (L.depth == null ? 1 : clamp(L.depth, 0, 1)) + 0.0001, ph: r() * 6.283 };
    if (L.type === 'band') { q.y = r() * st.h; q.hh = Math.round((0.05 + r() * 0.1) * st.h); q.z = 0.3 + r() * 0.7; }
    return q;
  }
  function weatherCreate(wov, w, h, seed, opts) {
    opts = opts || {};
    var r = rng(seed || 3), ent = opts.entries || [], u = Math.max(1, Math.round(opts.unit || 1)), area = (w * h) / (256 * 224);
    var st = { w: w, h: h, t: 0, unit: u, rnd: r, layers: [], tint: null, lightning: null, flash: 0, bolt: null, nextBolt: 0, strikes: 0 };
    function col(m, fb) { return typeof m === 'number' && ent[m] ? ent[m] : fb; }
    ((wov && wov.layers) || []).forEach(function (L) {
      if (!L || WEATHER_TYPES.indexOf(L.type) < 0 || L.type === 'none' || L.type === 'bolt') return;
      var dens = clamp(L.density == null ? 0.5 : Number(L.density) || 0, 0, 1), n = Math.min(900, Math.round(dens * WEATHER_BASE[L.type] * area));
      var lay = { type: L.type, angle: Number(L.angle) || 0, speed: L.speed == null ? 1 : clamp(Number(L.speed), 0, 4), color: col(L.m, L.type === 'flake' ? '#f4f6fa' : L.type === 'leaf' ? '#8a9a3a' : '#c8d8f0'),
        alpha: L.type === 'band' ? clamp(0.12 + 0.3 * dens, 0, 0.6) : 1, parts: [] };
      for (var i = 0; i < n; i++) lay.parts.push(wParticle(L, st, r, true));
      st.layers.push(lay);
    });
    if (wov && wov.tint && typeof wov.tint.m === 'number' && ent[wov.tint.m]) st.tint = { color: ent[wov.tint.m], alpha: clamp(Number(wov.tint.alpha) || 0, 0, 0.8) };
    var hasBoltLayer = ((wov && wov.layers) || []).some(function (L) { return L && L.type === 'bolt'; });
    if (wov && (wov.lightning || hasBoltLayer)) {
      var lg = wov.lightning || {}, ev = Array.isArray(lg.every) && lg.every.length === 2 ? lg.every : [2500, 7000];
      st.lightning = { min: Math.max(200, Number(ev[0]) || 2500), max: Math.max(Number(ev[0]) || 2500, Number(ev[1]) || 7000), flashMs: clamp(Number(lg.flashMs) || 160, 40, 1200), color: col(lg.m, '#ffffff') };
      st.nextBolt = st.lightning.min + r() * (st.lightning.max - st.lightning.min);
    }
    return st;
  }
  function weatherStep(st, dt) {
    dt = Math.max(0, Math.min(100, Number(dt) || 0));
    st.t += dt;
    var s = dt / 1000, u = st.unit, r = st.rnd;
    st.layers.forEach(function (L) {
      var a = L.angle * Math.PI / 180;
      L.parts.forEach(function (q) {
        var v;
        if (L.type === 'streak') { v = 260 * L.speed * q.z * u; q.x += Math.sin(a) * v * s; q.y += Math.cos(a) * v * s; }
        else if (L.type === 'flake') { v = 26 * L.speed * q.z * u; q.y += v * s; q.x += (Math.sin(a) * v + Math.sin(st.t / 700 + q.ph) * 8 * u) * s; }
        else if (L.type === 'mote') { v = 18 * L.speed * q.z * u; q.x += Math.sin(a) * v * s + Math.sin(st.t / 900 + q.ph) * 3 * u * s; q.y += Math.cos(a) * v * s * 0.6; }
        else if (L.type === 'leaf') { v = 48 * L.speed * q.z * u; q.x += (Math.sin(a) * v + 14 * u) * s; q.y += (12 * u + Math.sin(st.t / 300 + q.ph) * 20 * u) * s; }
        else if (L.type === 'band') { q.x += 6 * L.speed * q.z * u * s; }
        if (L.type === 'band') { if (q.x > st.w) q.x -= st.w * 2; return; }
        if (q.y > st.h + 4) { q.y -= st.h + 8; q.x = r() * st.w; }
        if (q.y < -10) q.y += st.h + 8;
        if (q.x > st.w + 4) q.x -= st.w + 8; else if (q.x < -4) q.x += st.w + 8;
      });
    });
    if (st.lightning) {
      st.flash = Math.max(0, st.flash - dt / st.lightning.flashMs);
      if (st.t >= st.nextBolt) {
        st.flash = 1; st.strikes++;
        var x0 = r() * st.w, pts = [[x0, 0]], y = 0;
        while (y < st.h * 0.62) { y += (6 + r() * 10) * u; pts.push([pts[pts.length - 1][0] + (r() - 0.5) * 14 * u, y]); }
        st.bolt = pts;
        st.nextBolt = st.t + st.lightning.min + r() * (st.lightning.max - st.lightning.min);
      }
    }
    return st;
  }
  function weatherDraw(ctx, st) {
    var u = st.unit;
    st.layers.forEach(function (L) {
      ctx.fillStyle = L.color;
      if (L.type === 'band') {
        L.parts.forEach(function (q) { ctx.globalAlpha = L.alpha * q.z; ctx.fillRect(Math.round(q.x), Math.round(q.y), st.w, q.hh); ctx.fillRect(Math.round(q.x - st.w), Math.round(q.y), st.w, q.hh); });
        ctx.globalAlpha = 1;
        return;
      }
      var a = L.angle * Math.PI / 180;
      L.parts.forEach(function (q) {
        ctx.globalAlpha = 0.45 + 0.55 * q.z;
        if (L.type === 'streak') { var len = Math.max(2, Math.round((2 + q.z * 5) * u * Math.max(0.5, L.speed))); pxLine(ctx, q.x, q.y, q.x - Math.sin(a) * len, q.y - Math.cos(a) * len, 1); }
        else if (L.type === 'flake') { var sz = q.z > 0.8 ? 2 * u : u; ctx.fillRect(Math.round(q.x), Math.round(q.y), sz, sz); }
        else if (L.type === 'mote') { ctx.globalAlpha *= 0.6 + 0.4 * Math.sin(st.t / 300 + q.ph); ctx.fillRect(Math.round(q.x), Math.round(q.y), u, u); }
        else if (L.type === 'leaf') { var flip = Math.sin(st.t / 160 + q.ph) > 0; ctx.fillRect(Math.round(q.x), Math.round(q.y), flip ? 2 * u : u, flip ? u : 2 * u); }
      });
      ctx.globalAlpha = 1;
    });
    if (st.tint && st.tint.alpha > 0) { ctx.globalAlpha = st.tint.alpha; ctx.fillStyle = st.tint.color; ctx.fillRect(0, 0, st.w, st.h); ctx.globalAlpha = 1; }
    if (st.lightning && st.flash > 0) {
      if (st.bolt && st.flash > 0.35) { ctx.fillStyle = st.lightning.color; for (var i = 1; i < st.bolt.length; i++) pxLine(ctx, st.bolt[i - 1][0], st.bolt[i - 1][1], st.bolt[i][0], st.bolt[i][1], u); }
      ctx.globalAlpha = 0.55 * st.flash; ctx.fillStyle = st.lightning.color; ctx.fillRect(0, 0, st.w, st.h); ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- ability playback
  // timeline(anm, casterAnm) -> {release, travelEnd, impactStart, impactEnd, duration, hits: [ms]}. The caster's own
  // animation fires its first hit marker at the release; projectiles travel after it; hits land through the impact.
  function abilityTimeline(anm, casterAnm) {
    anm = anm || {};
    var cd = casterAnm ? duration(casterAnm) : 480, rel = casterAnm ? firstMarker(casterAnm, 'hit') : null;
    var release = rel == null ? Math.round(cd * 0.6) : rel;
    var tr = anm.travel || {}, travel = tr.type && tr.type !== 'none' ? clamp(Number(tr.ms) || 260, 0, 4000) : 0;
    var imp = anm.impact || {}, ims = clamp(Number(imp.ms) || 450, 60, 4000);
    var n = clamp(Math.round(Number(anm.hits) || 1), 1, 16), gap = Math.min(160, ims / (n + 1));
    var hits = [];
    for (var i = 0; i < n; i++) hits.push(Math.round(release + travel + i * gap));
    var end = release + travel + ims;
    return { release: release, travelEnd: release + travel, impactStart: release + travel, impactEnd: end, duration: Math.max(end, cd), casterMs: cd, hits: hits, melee: anm.caster === 'attack' && !travel };
  }
  // create(cfg) -> playback. cfg: {anm, caster (anm_ record), from: {x, y}, to: {x, y}, efx (record), entries, unit, seed}.
  // step(dtMs) returns the markers that fired; draw(ctx) draws travel and impact effects; screen() reports shake,
  // flash, darkening, and wave; casterAt() gives the time into the caster's animation and its forward offset.
  function abilityCreate(cfg) {
    var anm = cfg.anm || {}, tl = abilityTimeline(anm, cfg.caster), u = Math.max(1, Math.round(cfg.unit || 1)), ent = cfg.entries || [], fx = cfg.efx || null;
    var cols = fx && Array.isArray(fx.palette) ? fx.palette.map(function (m) { return ent[m] || '#ffffff'; }) : ['#6a6a6a', '#b8b8b8', '#e8e8e8', '#ffffff'];
    var flashCol = fx && ent[fx.flash] ? ent[fx.flash] : '#ffffff', from = cfg.from || { x: 0, y: 0 }, to = cfg.to || { x: 0, y: 0 };
    var pt = Object.assign({ shape: 'spark', count: 12, life: 420, gravity: 0, spread: 1, speed: 1 }, fx && fx.particle || {});
    var imp = anm.impact || {}, tr = anm.travel || {}, seed = cfg.seed || 11;
    var screenKind = imp.shake ? 'shake' : fx && fx.screen || 'none';
    var pb = { t: 0, timeline: tl, systems: [], fired: [], next: 0 };
    var extra = (Array.isArray(anm.markers) ? anm.markers : []).map(function (m) { return { ms: Number(m.ms) || 0, type: m.type, arg: m.arg == null ? null : m.arg }; });
    var sched = [{ ms: 0, type: 'sfx', arg: anm.sfx || 'cast' }, { ms: tl.release, type: 'sfx', arg: anm.sfx || 'release' }]
      .concat(tl.hits.map(function (h, i) { return { ms: h, type: 'hit', arg: i }; }), [{ ms: tl.impactStart, type: 'particle', arg: fx ? fx.id || null : null }])
      .concat(imp.flash ? [{ ms: tl.impactStart, type: 'flash', arg: null }] : [], imp.shake ? [{ ms: tl.impactStart, type: 'shake', arg: imp.shake }] : [], extra)
      .sort(function (a, b) { return a.ms - b.ms; });
    pb.step = function (dt) {
      var t0 = pb.t, t1 = pb.t + Math.max(0, Number(dt) || 0), out = [];
      while (pb.next < sched.length && sched[pb.next].ms <= t1) { var m = sched[pb.next++]; out.push({ type: m.type, arg: m.arg, t: m.ms }); }
      if (t0 < tl.release && t1 >= tl.release && tr.type && tr.type !== 'none') {
        var mode = tr.type === 'rise' ? 'rise' : tr.type === 'fall' ? 'fall' : 'stream';
        if (tr.type === 'rise' || tr.type === 'fall') pb.systems.push(fxCreate({ x: to.x, y: to.y, colors: cols, particle: Object.assign({}, pt, { count: Math.round(pt.count * 1.4), life: tl.travelEnd - tl.release + 200 }), mode: mode, unit: u, radius: 8 * u }, seed + 1));
      }
      if (t0 < tl.impactStart && t1 >= tl.impactStart) pb.systems.push(fxCreate({ x: to.x, y: to.y, to: { x: to.x + 6 * u, y: to.y - 30 * u }, colors: cols, particle: pt, mode: 'burst', unit: u }, seed + 2));
      pb.t = t1;
      pb.systems.forEach(function (s) { fxStep(s, Math.min(100, t1 - t0)); });
      pb.fired = pb.fired.concat(out);
      return out;
    };
    pb.done = function () { return pb.t >= tl.duration && pb.systems.every(fxDone); };
    pb.casterAt = function () {
      var off = 0;
      if (tl.melee) {
        var D = Math.max(0, Math.abs(to.x - from.x) - 18 * u), go = tl.release * 0.45, back = tl.impactEnd;
        off = pb.t < go ? D * (pb.t / Math.max(1, go)) : pb.t < back ? D : Math.max(0, D * (1 - (pb.t - back) / 220));
      }
      return { t: Math.min(pb.t, tl.casterMs), off: [Math.round(off), 0] };
    };
    pb.screen = function () {
      var p = clamp((pb.t - tl.impactStart) / Math.max(1, tl.impactEnd - tl.impactStart), 0, 1), on = pb.t >= tl.impactStart && pb.t <= tl.impactEnd;
      var sc = on ? screenAt(screenKind, p, u * (imp.shake || 1), seed) : { shake: [0, 0], darken: 0, wave: 0 };
      var fl = imp.flash && pb.t >= tl.impactStart && pb.t < tl.impactStart + 140 ? 1 - (pb.t - tl.impactStart) / 140 : 0;
      return { shake: sc.shake, darken: sc.darken, wave: sc.wave, flash: fl * 0.7, flashColor: flashCol };
    };
    pb.draw = function (ctx) {
      if (tr.type === 'projectile' && pb.t >= tl.release && pb.t < tl.travelEnd) {
        var k = (pb.t - tl.release) / Math.max(1, tl.travelEnd - tl.release), x = from.x + (to.x - from.x) * k, y = from.y + (to.y - from.y) * k - Math.sin(k * Math.PI) * 6 * u;
        ctx.fillStyle = cols[2]; ctx.fillRect(Math.round(x - u), Math.round(y - u), 3 * u, 3 * u);
        ctx.fillStyle = cols[3]; ctx.fillRect(Math.round(x), Math.round(y), u, u);
        ctx.fillStyle = cols[1]; ctx.globalAlpha = 0.6; ctx.fillRect(Math.round(x - (to.x - from.x) * 0.06), Math.round(y), 2 * u, u); ctx.globalAlpha = 1;
      }
      if (tr.type === 'beam' && pb.t >= tl.release && pb.t < tl.impactEnd) {
        var kb = clamp((pb.t - tl.release) / Math.max(1, tl.travelEnd - tl.release), 0, 1), bx = from.x + (to.x - from.x) * kb, by = from.y + (to.y - from.y) * kb;
        ctx.fillStyle = cols[1]; pxLine(ctx, from.x, from.y, bx, by, 3 * u);
        ctx.fillStyle = cols[3]; pxLine(ctx, from.x, from.y, bx, by, u);
      }
      pb.systems.forEach(function (s) { fxDraw(ctx, s); });
    };
    return pb;
  }

  R.anim = {
    MARKER_TYPES: MARKER_TYPES, DEATH_METHODS: DEATH_METHODS, CASTERS: CASTERS, TRAVELS: TRAVELS,
    duration: duration, frameAt: frameAt, frameStart: frameStart, markersBetween: markersBetween, firstMarker: firstMarker,
    forSprite: animFor, deathPixels: deathPixels, drawDeath: drawDeath, unit: unitOf
  };
  R.draw = { sprite: drawSprite, frame: blitFrame, line: pxLine };
  R.fx = { SHAPES: SHAPES, SCREENS: ['none', 'wave', 'shake', 'darken'], create: fxCreate, step: fxStep, draw: fxDraw, done: fxDone, screen: screenAt, wave: applyWave };
  R.weather = { TYPES: WEATHER_TYPES, BASE: WEATHER_BASE, create: weatherCreate, step: weatherStep, draw: weatherDraw };
  R.ability = { timeline: abilityTimeline, create: abilityCreate };

  // ================================================================ PHASE 4: TILES
  // build.js splices this file into ENGINE:RENDER after engine-motion.js. It reads no host global.

  // ---------------------------------------------------------------- tile palette layout and flags
  // Tilesets use 32 local slots: 0 transparent, 1 outline, then six material ramps. Slots 28 to 31 are spare and point
  // at the outline. Terrain needs more simultaneous ramps than a character, and tiles are never swapped by tier.
  var TILE_SLOTS = 32;
  var TILE_RAMPS = { A: [2, 3, 4, 5, 6], B: [7, 8, 9, 10, 11], C: [12, 13, 14, 15], D: [16, 17, 18, 19], E: [20, 21, 22, 23], F: [24, 25, 26, 27] };
  var TA = TILE_RAMPS.A, TB = TILE_RAMPS.B, TC = TILE_RAMPS.C, TD = TILE_RAMPS.D, TE = TILE_RAMPS.E, TF = TILE_RAMPS.F;
  var FLAGS = { passable: 1, encounter: 2, swim: 4, damage: 8, counter: 16, above: 32 };
  function tileSlots(master, mats) {
    var s = new Array(TILE_SLOTS), out = outline(master);
    for (var i = 0; i < TILE_SLOTS; i++) s[i] = out;
    s[0] = null;
    Object.keys(TILE_RAMPS).forEach(function (k) { (TILE_RAMPS[k] || []).forEach(function (slot, j) { var v = mats[k] && mats[k][j]; if (typeof v === 'number' && v >= 0 && v < master.length) s[slot] = v; }); });
    return s;
  }
  // Fits material source colors {A: hex, ...} to the master: {A: [m x5], B: [m x5], C..F: [m x4]}.
  function tileColorway(master, src) {
    // Materials may share master colors (terrain often should), so no material avoids another's picks.
    var cw = {};
    Object.keys(TILE_RAMPS).forEach(function (k) {
      var hex = src && src[k] || '#808080';
      cw[k] = master.length <= 4 ? TILE_RAMPS[k].map(function (_, j) { return nearest(master, lchToHex(0.18 + 0.78 * j / (TILE_RAMPS[k].length - 1), 0, 0)); }) : rampFor(master, hex, TILE_RAMPS[k].length, k === 'A' || k === 'B' ? 0.09 : 0.11);
    });
    return cw;
  }

  // ---------------------------------------------------------------- periodic noise
  function hh(x, y, k) {
    var h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul((y | 0) + 0x3c6ef372, 0x165667b1) ^ Math.imul(k | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function mod(a, n) { return ((a % n) + n) % n; }
  // n cells across one tile, wrapping, so every texture repeats exactly at the tile size and fills join seamlessly.
  function pnoise(lx, ly, T, n, k) {
    var gx = lx / T * n, gy = ly / T * n, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = smooth(gx - x0), fy = smooth(gy - y0);
    var x1 = mod(x0 + 1, n), y1 = mod(y0 + 1, n); x0 = mod(x0, n); y0 = mod(y0, n);
    var a = hh(x0, y0, k), b = hh(x1, y0, k), c = hh(x0, y1, k), d = hh(x1, y1, k);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  // The detail cell: about a sixteenth of a tile, always a divisor of the tile size so hashed cells tile too.
  function detailCell(T) { var d = Math.max(1, Math.round(T / 16)); while (T % d) d--; return d; }
  function makeCtx(T, seed, params, ph, variant) {
    var dc = detailCell(T), N = T / dc;
    return {
      T: T, dc: dc, N: N, seed: seed >>> 0, p: params || {}, ph: ph || 0, v: variant || 0,
      n: function (lx, ly, cells, k) { return pnoise(lx, ly, T, cells, (seed + k * 7919) | 0); },
      h: function (cx, cy, k) { return hh(mod(cx, N), mod(cy, N), (seed + k * 104729) | 0); },
      d: function (key, def) { var v = Number(params && params[key]); return isFinite(v) ? v : def; }
    };
  }

  // ---------------------------------------------------------------- the blob set (47 tiles)
  // Neighbor bits: N 1, NE 2, E 4, SE 8, S 16, SW 32, W 64, NW 128. The corner rule: a diagonal counts only when both
  // of its adjacent edges match. Reducing all 256 masks by that rule leaves exactly 47 distinct tiles.
  var BN = 1, BNE = 2, BE = 4, BSE = 8, BS = 16, BSW = 32, BW = 64, BNW = 128;
  function reduceMask(m) {
    m &= 255;
    if (!((m & BN) && (m & BE))) m &= ~BNE;
    if (!((m & BS) && (m & BE))) m &= ~BSE;
    if (!((m & BS) && (m & BW))) m &= ~BSW;
    if (!((m & BN) && (m & BW))) m &= ~BNW;
    return m;
  }
  var BLOB = [], BLOB_INDEX = new Int16Array(256);
  (function () {
    var seen = {};
    for (var m = 0; m < 256; m++) { var r = reduceMask(m); if (!seen[r]) { seen[r] = 1; BLOB.push(r); } }
    BLOB.sort(function (a, b) { return a - b; });
    for (var k = 0; k < 256; k++) BLOB_INDEX[k] = BLOB.indexOf(reduceMask(k));
  })();
  function blobIndex(mask) { return BLOB_INDEX[mask & 255]; }
  var BLOB_FULL = BLOB_INDEX[255];
  // mask8(grid, x, y, sameFn): grid {w, h, cells}. Off the map, a neighbor repeats the nearest edge cell, so a region
  // runs cleanly off the screen edge instead of growing a border there.
  var DIRS8 = [[0, -1, BN], [1, -1, BNE], [1, 0, BE], [1, 1, BSE], [0, 1, BS], [-1, 1, BSW], [-1, 0, BW], [-1, -1, BNW]];
  function mask8(grid, x, y, sameFn) {
    var w = grid.w, h = grid.h, c = grid.cells, me = c[y * w + x], m = 0;
    for (var i = 0; i < 8; i++) {
      var nx = clamp(x + DIRS8[i][0], 0, w - 1), ny = clamp(y + DIRS8[i][1], 0, h - 1);
      if (sameFn(me, c[ny * w + nx])) m |= DIRS8[i][2];
    }
    return m;
  }

  // ---------------------------------------------------------------- templates and compose47
  // A template is a 2 by 3 tile block: top left the isolated preview, top right four inner corner quarters, the bottom
  // 2 by 2 a square patch whose quarters are outer corners, edges, and fill. Each tile of the 47 is assembled from four
  // quarters. Parity is kept (a left half quarter always comes from a left half), so textures and odd sizes line up.
  // [vertical bit, horizontal bit, diagonal bit, corner x, corner y, fill, inner, vertical edge, horizontal edge, outer]
  var CORNERS = [
    [BN, BW, BNW, 0, 0, [2, 4], [2, 0], [0, 4], [2, 2], [0, 2]],
    [BN, BE, BNE, 1, 0, [1, 4], [3, 0], [3, 4], [1, 2], [3, 2]],
    [BS, BW, BSW, 0, 1, [2, 3], [2, 1], [0, 3], [2, 5], [0, 5]],
    [BS, BE, BSE, 1, 1, [1, 3], [3, 1], [3, 3], [1, 5], [3, 5]]
  ];
  // quarterFor(reducedMask, corner) -> [qx, qy] in the template's 4 by 6 quarter grid.
  function quarterFor(rm, k) {
    var c = CORNERS[k], v = rm & c[0], hz = rm & c[1], d = rm & c[2];
    return v && hz ? (d ? c[5] : c[6]) : v ? c[7] : hz ? c[8] : c[9];
  }
  function composeTile(tmpl, T, rm) {
    var out = new Uint8Array(T * T), q0 = T >> 1, q1 = T - q0, W = 2 * T;
    for (var k = 0; k < 4; k++) {
      var q = quarterFor(rm, k), c = CORNERS[k];
      var sx = (q[0] >> 1) * T + (q[0] & 1 ? q0 : 0), sy = (q[1] >> 1) * T + (q[1] & 1 ? q0 : 0);
      var ox = c[3] ? q0 : 0, oy = c[4] ? q0 : 0, w = c[3] ? q1 : q0, h = c[4] ? q1 : q0;
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) out[(oy + y) * T + ox + x] = tmpl[(sy + y) * W + sx + x];
    }
    return out;
  }
  // Distance inside the region boundary for a template pixel, and the direction toward that boundary.
  function rrect(px, py, W, H, r) {
    var dl = px, dr = W - px, dt = py, db = H - py, dx = Math.min(dl, dr), dy = Math.min(dt, db), sx = dl < dr ? -1 : 1, sy = dt < db ? -1 : 1;
    if (dx < r && dy < r) { var ax = r - dx, ay = r - dy, L = Math.sqrt(ax * ax + ay * ay) || 1; return { d: r - L, nx: sx * ax / L, ny: sy * ay / L }; }
    return dx < dy ? { d: dx, nx: sx, ny: 0 } : { d: dy, nx: 0, ny: sy };
  }
  function regionAt(x, y, T, r) {
    var px = x + 0.5, py = y + 0.5;
    if (y < T && x < T) return rrect(px, py, T, T, r);
    if (y < T) {
      var lx = px - T, cx = lx < T / 2 ? 0 : T, cy = py < T / 2 ? 0 : T, vx = lx - cx, vy = py - cy, L = Math.sqrt(vx * vx + vy * vy) || 1;
      return { d: L - r, nx: -vx / L, ny: -vy / L };
    }
    return rrect(px, py - T, 2 * T, 2 * T, r);
  }
  // Paints a template from a style: fill(c, x, y) for the inside, edge(c, e, n, x, y) for the band along the boundary
  // (returns a slot, 0 for clear, or -1 to use the fill), wob(c, x, y) a non negative inward wobble.
  // ox, oy shift the texture only (the scroll animation), never the region.
  function paintTemplate(style, c, ox, oy) {
    var T = c.T, W = 2 * T, H = 3 * T, out = new Uint8Array(W * H), r = style.square ? 0 : Math.max(1, Math.round(T * 0.28));
    var edge = style.edge || EDGE.soft, bw = 1 + c.dc * (style.band || 1);
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var lx = mod(x, T), ly = mod(y, T), R = regionAt(x, y, T, r);
      var e = R.d - (style.wob ? style.wob(c, lx, ly) : 0);
      if (e <= 0) continue;
      var s = -1;
      if (e < bw) s = edge(c, e, R, lx, ly);
      if (s < 0) s = style.fill(c, mod(lx + (ox || 0), T), mod(ly + (oy || 0), T));
      out[y * W + x] = s;
    }
    return out;
  }
  // A full fill tile, optionally a variant. Every tile of a texture repeats exactly, so large cells of one biome would
  // show a grid; variants break it up. mode 'reseed' redraws the middle of the tile from another seed, with a dithered
  // seam well inside the border so neighbors still match; mode 'deco' adds a small decoration in the middle.
  function paintFull(style, c, ox, oy, mode) {
    var T = c.T, out = new Uint8Array(T * T), inset = Math.max(1, c.dc * 2), alt = null;
    if (c.v && mode === 'reseed') alt = makeCtx(T, (c.seed + c.v * 7717) >>> 0, c.p, c.ph, 0);
    for (var y = 0; y < T; y++) for (var x = 0; x < T; x++) {
      var tx = mod(x + (ox || 0), T), ty = mod(y + (oy || 0), T), s;
      if (alt) {
        var edgeD = Math.min(x, y, T - 1 - x, T - 1 - y), t = (edgeD - inset) / Math.max(1, inset);
        s = t > 1 || (t > 0 && hh(x, y, c.seed + 3) < t) ? style.fill(alt, tx, ty) : style.fill(c, tx, ty);
      } else s = style.fill(c, tx, ty);
      if (c.v && mode !== 'reseed' && x >= inset && y >= inset && x < T - inset && y < T - inset) { var dv = (style.deco || decoDefault)(c, x, y); if (dv > 0) s = dv; }
      out[y * T + x] = s;
    }
    return out;
  }
  function decoDefault(c, x, y) {
    var T = c.T, cx = T * (0.32 + 0.36 * hh(c.v, 1, c.seed)), cy = T * (0.32 + 0.36 * hh(c.v, 2, c.seed)), r = T * 0.14;
    var dx = x + 0.5 - cx, dy = (y + 0.5 - cy) * 1.4, d = Math.sqrt(dx * dx + dy * dy);
    if (d > r) return 0;
    var stones = c.v % 2 === 1;
    if (d > r - c.dc) return dy > 0 ? 1 : stones ? TC[1] : TD[0];
    return stones ? (dx + dy < 0 ? TC[3] : TC[2]) : (hh(Math.floor(x / c.dc), Math.floor(y / c.dc), c.seed + 5) < 0.4 ? TD[3] : TD[1]);
  }

  // ---------------------------------------------------------------- edges
  var EDGE = {
    // Dithered first pixel, a lit lip on top edges, a shadow on bottom edges.
    soft: function (c, e, R, x, y) { if (e < 1) return (x + y) & 1 ? 0 : TA[1]; return R.ny < -0.5 ? TA[3] : R.ny > 0.5 ? TA[0] : TA[1]; },
    outlined: function (c, e, R) { if (e < 1) return 1; return R.ny > 0.4 ? TA[0] : -1; },
    foam: function (c, e) { return e < 1 ? TF[3] : e < 1 + c.dc ? TF[1] : -1; },
    beach: function (c, e) { return e < 1 ? TF[3] : e < 1 + c.dc ? TF[1] : TB[1]; },
    bevel: function (c, e, R) { if (e < 1) return 1; return R.ny < -0.5 ? TB[4] : R.ny > 0.5 ? TB[0] : TB[1]; },
    rug: function (c, e) { return e < 1 ? TD[0] : e < 1 + c.dc ? TF[2] : TD[0]; },
    lip: function (c, e, R) { if (e < 1) return 1; return R.ny > 0.5 ? TA[0] : TA[3]; }
  };
  function organic(k) { return function (c, x, y) { return c.n(x, y, 4, 13) * c.T * k * c.d('rough', 1); }; }

  // ---------------------------------------------------------------- biome styles
  // Each draws in tile coordinates (x, y within one tile), from hashed detail cells and periodic noise, so any tile
  // size rasterizes natively. Material slots: A ground, B second ground or canopy, C stone or wood, D flora or accent,
  // E liquid or glow, F foam, snow, or light.
  function crowns(c, x, y, list, r, hi) {
    var T = c.T, best = -1, bdx = 0, bdy = 0, bd = 0;
    for (var i = 0; i < list.length; i++) {
      var dx = x + 0.5 - list[i][0] * T, dy = y + 0.5 - list[i][1] * T;
      dx -= T * Math.round(dx / T); dy -= T * Math.round(dy / T);
      var d = Math.sqrt(dx * dx + dy * dy * 1.15);
      if (d < r) { best = i; bdx = dx; bdy = dy; bd = d; }
    }
    if (best < 0) return -1;
    var sway = c.ph ? (1 - Math.cos(c.ph * Math.PI * 2)) * 0.16 : 0;
    if (bd > r - c.dc) return bdy > -r * 0.2 ? 1 : TB[1];
    var q = (bdx + bdy * 1.1) / r + sway;
    if (c.h(Math.floor(x / c.dc), Math.floor(y / c.dc), 11) < 0.05) return q < 0 ? TB[4] : TB[2];
    return q < -0.62 ? (hi || TB[4]) : q < -0.12 ? TB[3] : q < 0.48 ? TB[2] : TB[1];
  }
  function crownSet(c, n) {
    var base = n === 5 ? [[0.25, 0.25], [0.75, 0.2], [0.5, 0.52], [0.24, 0.78], [0.76, 0.76]] : [[0.25, 0.28], [0.75, 0.22], [0.27, 0.76], [0.76, 0.72]];
    return base.map(function (p, i) { return [p[0] + (hh(i, 3, c.seed) - 0.5) * 0.08, p[1] + (hh(i, 4, c.seed) - 0.5) * 0.08]; });
  }
  function peak(x, y, T, cx, ay, by, hw) {
    var px = x + 0.5, py = y + 0.5, slope = (by - ay) / hw, top = ay + Math.abs(px - cx) * slope;
    if (py < top || py >= by) return null;
    return { e: (py - top) / Math.max(1, slope) * slope, lit: px < cx, ridge: Math.abs(px - cx), t: (py - ay) / (by - ay) };
  }
  var STYLES = {
    grass: { label: 'Grass', mats: { A: '#4f9a3e', B: '#6aa848', C: '#8a6a44', D: '#e8d468', E: '#3a72c0', F: '#eaf2fa' }, wob: organic(0.14),
      fill: function (c, x, y) {
        var n = c.n(x, y, 4, 1), cx = Math.floor(x / c.dc), cy = Math.floor(y / c.dc), t = 0.16 * c.d('detail', 0.5);
        if (c.h(cx, cy + 1, 3) < t) return TA[4];
        if (c.h(cx, cy, 3) < t) return TA[0];
        if (c.h(cx - 1, cy + 1, 3) < t) return TA[3];
        if (c.h(cx, cy, 5) < 0.025 * c.d('detail', 0.5)) return TD[2];
        return n < 0.36 ? TA[1] : n < 0.72 ? TA[2] : TA[3];
      } },
    steppe: { label: 'Dry grass', mats: { A: '#a8a454', B: '#c8b86a', C: '#8a6e48', D: '#d89a4a', E: '#3a72c0', F: '#eaf2fa' }, wob: organic(0.14),
      fill: function (c, x, y) {
        var n = c.n(x, y, 3, 1), cx = Math.floor(x / c.dc), cy = Math.floor(y / c.dc), t = 0.12 * c.d('detail', 0.5);
        if (c.h(cx >> 1, cy, 7) < 0.1 && (cx & 1)) return TB[3];
        if (c.h(cx, cy + 1, 3) < t) return TB[4];
        if (c.h(cx, cy, 3) < t) return TA[0];
        if (c.h(cx, cy, 6) < 0.01) return TC[1];
        return n < 0.4 ? TA[1] : n < 0.78 ? TA[2] : TA[3];
      } },
    sand: { label: 'Sand dunes', mats: { A: '#e2c27e', B: '#d8b070', C: '#9a7a54', D: '#c86a3a', E: '#3a72c0', F: '#fff4dc' }, wob: organic(0.12),
      fill: function (c, x, y) {
        var T = c.T, v = Math.sin(Math.PI * 2 * (3 * y / T + x / T) + Math.PI * 2 * 0.8 * c.n(x, y, 3, 2));
        if (c.h(Math.floor(x / c.dc), Math.floor(y / c.dc), 4) < 0.012 * c.d('detail', 0.5) * 2) return TC[1];
        return v > 0.9 ? TA[4] : v > 0.5 ? TA[3] : v < -0.62 ? TA[1] : TA[2];
      } },
    beach: { label: 'Beach', mats: { A: '#ead6a0', B: '#b89a6a', C: '#9a8a7a', D: '#e8a0a0', E: '#4a8ac8', F: '#f4faff' }, wob: organic(0.1), edge: EDGE.beach, band: 2,
      fill: function (c, x, y) {
        var T = c.T, v = Math.sin(Math.PI * 2 * (2 * y / T) + Math.PI * 2 * c.n(x, y, 2, 2) * 0.6);
        var cx = Math.floor(x / c.dc), cy = Math.floor(y / c.dc);
        if (c.h(cx, cy, 9) < 0.008 * c.d('detail', 0.5) * 2) return TD[2];
        if (c.h(cx, cy, 4) < 0.01) return TC[2];
        return v > 0.8 ? TA[3] : v < -0.8 ? TA[1] : TA[2];
      } },
    water: { label: 'Open water', mats: { A: '#2a5a9a', B: '#3a72c0', C: '#1e3e6a', D: '#5a9ad0', E: '#7ab8e8', F: '#eaf6ff' }, wob: organic(0.1), edge: EDGE.foam,
      fill: function (c, x, y) {
        var n = c.n(x, y, 6, 1), col = Math.floor(x / c.dc), row = Math.floor(y / c.dc);
        if (row % 3 === 0 && c.h(col >> 2, row, 6) < 0.2 * c.d('detail', 0.5) * 2) return TE[mod(col + row, 4)];
        if (c.h(col, row, 7) < 0.1) return TA[2];
        return n < 0.3 ? TA[0] : TA[1];
      } },
    marsh: { label: 'Marsh', mats: { A: '#5a7040', B: '#6a8048', C: '#8a8a4a', D: '#c8c070', E: '#4a6a6a', F: '#c8dcd8' }, wob: organic(0.14),
      fill: function (c, x, y) {
        var n = c.n(x, y, 4, 1), m = c.n(x, y, 5, 4), cx = Math.floor(x / c.dc), cy = Math.floor(y / c.dc);
        if (m > 0.72) return c.h(cx, cy, 12) < 0.06 ? TE[3] : m > 0.8 ? TE[1] : TE[0];
        if (m > 0.69) return TA[0];
        if (c.h(cx, 0, 8) < 0.14 * c.d('detail', 0.5) * 2 && mod(cy + Math.floor(c.h(cx, 1, 9) * 16), 7) < 3) return mod(cy + Math.floor(c.h(cx, 1, 9) * 16), 7) === 0 ? TC[3] : TC[1];
        return n < 0.45 ? TA[1] : TA[2];
      } },
    forest: { label: 'Forest canopy', mats: { A: '#2d4a2a', B: '#3e7a38', C: '#5a3e2a', D: '#a8c858', E: '#3a72c0', F: '#eaf2fa' }, wob: organic(0.1), edge: EDGE.outlined,
      variants: false,
      fill: function (c, x, y) { var s = crowns(c, x, y, crownSet(c, 4), c.T * 0.33 * c.d('size', 1)); return s >= 0 ? s : c.n(x, y, 4, 1) < 0.5 ? TA[0] : TA[1]; },
      deco: function (c, x, y) { var T = c.T, dx = x + 0.5 - T / 2, dy = y + 0.5 - T / 2; return dx * dx + dy * dy < T * T * 0.03 ? (c.v % 2 ? TA[2] : TD[1]) : 0; } },
    jungle: { label: 'Jungle canopy', mats: { A: '#1e3a24', B: '#2e6a34', C: '#4a3424', D: '#b8e060', E: '#3a72c0', F: '#eaf2fa' }, wob: organic(0.1), edge: EDGE.outlined,
      variants: false,
      fill: function (c, x, y) { var s = crowns(c, x, y, crownSet(c, 5), c.T * 0.27 * c.d('size', 1), TD[2]); return s >= 0 ? s : TA[0]; },
      deco: function () { return 0; } },
    tundra: { label: 'Tundra', mats: { A: '#7a8a6a', B: '#8a9478', C: '#7e848e', D: '#b88a5a', E: '#5a7a9a', F: '#eef4fa' }, wob: organic(0.14),
      fill: function (c, x, y) {
        var n = c.n(x, y, 4, 1), s = c.n(x, y, 6, 5), cx = Math.floor(x / c.dc), cy = Math.floor(y / c.dc);
        if (s > 0.78) return s > 0.85 ? TF[3] : TF[2];
        if (c.h(cx, cy, 5) < 0.05 * c.d('detail', 0.5) * 2) return TD[1];
        if (c.h(cx, cy, 6) < 0.012) return TC[1];
        return n < 0.4 ? TA[1] : n < 0.75 ? TA[2] : TA[3];
      } },
    snow: { label: 'Snowfield', mats: { A: '#d8e4f0', B: '#b8c8e0', C: '#8a98a8', D: '#a0b8d8', E: '#6a90c0', F: '#ffffff' }, wob: organic(0.14),
      fill: function (c, x, y) {
        var T = c.T, n = c.n(x, y, 4, 1), v = Math.sin(Math.PI * 2 * (2 * y / T + x / T) + Math.PI * 2 * c.n(x, y, 2, 3));
        if (c.h(Math.floor(x / c.dc), Math.floor(y / c.dc), 7) < 0.01) return TF[3];
        if (v > 0.93) return TA[1];
        return n < 0.3 ? TA[2] : n < 0.7 ? TA[3] : TA[4];
      } },
    mountain: { label: 'Mountains', mats: { A: '#7a6e62', B: '#8a8478', C: '#5a5048', D: '#6a7a4a', E: '#3a72c0', F: '#f4f8fc' }, wob: organic(0.08), edge: EDGE.outlined, variants: false,
      fill: function (c, x, y) {
        var T = c.T, k = peak(x, y, T, T * 0.54, T * 0.1, T * 0.94, T * 0.44), dc = c.dc;
        if (!k) k = peak(x, y, T, T * 0.2, T * 0.44, T * 0.96, T * 0.18);
        if (k) {
          if (k.e < dc) return 1;
          if (k.t < 0.3 * c.d('snow', 1)) return k.lit ? TF[3] : TF[1];
          if (k.ridge < dc * 0.6) return TB[3];
          return k.lit ? (k.t < 0.6 ? TB[4] : TB[3]) : (k.t < 0.6 ? TB[1] : TB[0]);
        }
        if (c.h(Math.floor(x / dc), Math.floor(y / dc), 4) < 0.05) return TC[1];
        return c.n(x, y, 4, 1) < 0.5 ? TA[1] : TA[2];
      }, deco: function () { return 0; } },
    lava: { label: 'Lava rock', mats: { A: '#3a3034', B: '#4a3a3a', C: '#5a4a44', D: '#8a4a2a', E: '#f06a20', F: '#ffd860' }, wob: organic(0.1), edge: EDGE.outlined,
      fill: function (c, x, y) {
        var m = Math.abs(c.n(x, y, 5, 3) - 0.5), w = 0.04 * c.d('flow', 1);
        if (m < w) return TE[3];
        if (m < w * 1.6) return TE[2];
        if (m < w * 2.3) return TE[0];
        if (c.h(Math.floor(x / c.dc), Math.floor(y / c.dc), 4) < 0.04) return TA[2];
        return c.n(x, y, 4, 1) < 0.5 ? TA[0] : TA[1];
      } },
    // Interior autotiles.
    'wall.brick': { label: 'Brick wall', interior: true, square: true, edge: EDGE.bevel,
      fill: function (c, x, y) {
        var T = c.T, bh = Math.max(2, Math.round(T / 4)), row = Math.floor(y / bh), off = row % 2 ? T / 4 : 0, bwid = T / 2, col = Math.floor(mod(x + off, T) / bwid);
        if (y % bh < Math.max(1, Math.round(c.dc * 0.6)) || mod(x + off, bwid) < Math.max(1, Math.round(c.dc * 0.6))) return TB[0];
        if (y % bh === Math.max(1, Math.round(c.dc * 0.6))) return TB[3];
        return hh(row, col, c.seed) < 0.5 ? TB[2] : TB[1];
      } },
    'wall.block': { label: 'Block wall', interior: true, square: true, edge: EDGE.bevel,
      fill: function (c, x, y) {
        var T = c.T, bh = Math.max(2, Math.round(T / 2)), row = Math.floor(y / bh), off = row % 2 ? T / 2 : 0, col = Math.floor(mod(x + off, T) / (T / 2)), m = Math.max(1, Math.round(c.dc * 0.7));
        if (y % bh < m || mod(x + off, T / 2) < m) return TB[0];
        if (y % bh < m * 2 || mod(x + off, T / 2) < m * 2) return TB[3];
        if (c.h(Math.floor(x / c.dc), Math.floor(y / c.dc), 9) < 0.05) return TD[1];
        return hh(row, col, c.seed) < 0.5 ? TB[2] : TB[1];
      } },
    rug: { label: 'Rug', interior: true, square: true, edge: EDGE.rug, band: 3,
      fill: function (c, x, y) { var T = c.T, q = T / 2, a = mod(x + y, q), b = mod(x - y, q); return a < c.dc || b < c.dc ? TD[2] : (mod(x, T) < T / 2) === (mod(y, T) < T / 2) ? TD[1] : TD[0]; } },
    channel: { label: 'Water channel', interior: true, edge: EDGE.lip, band: 1,
      fill: function (c, x, y) { var col = Math.floor(x / c.dc), row = Math.floor(y / c.dc); if (col % 3 === 1 && c.h(col, row >> 2, 6) < 0.3) return (row & 3) ? TE[2] : TE[3]; return c.n(x, y, 3, 1) < 0.5 ? TE[0] : TE[1]; } }
  };
  STYLES.channel.anim = true;

  // ---------------------------------------------------------------- interior single tiles
  // draw(c) -> Uint8Array T by T. Rectangles and circles in tile fractions, then an outline from the alpha mask.
  function Px(T) { return { T: T, a: new Uint8Array(T * T) }; }
  function pr(r, x0, y0, x1, y1, s) {
    var T = r.T, ax = Math.max(0, Math.round(x0 * T)), ay = Math.max(0, Math.round(y0 * T)), bx = Math.min(T, Math.round(x1 * T)), by = Math.min(T, Math.round(y1 * T));
    for (var y = ay; y < by; y++) for (var x = ax; x < bx; x++) r.a[y * T + x] = s;
  }
  function pc(r, cx, cy, rad, s, sy) {
    var T = r.T, R = rad * T, k = sy || 1;
    for (var y = 0; y < T; y++) for (var x = 0; x < T; x++) { var dx = x + 0.5 - cx * T, dy = (y + 0.5 - cy * T) / k; if (dx * dx + dy * dy <= R * R) r.a[y * T + x] = s; }
  }
  function pout(r) {
    var T = r.T, a = r.a, o = new Uint8Array(a);
    for (var y = 0; y < T; y++) for (var x = 0; x < T; x++) {
      if (a[y * T + x]) continue;
      if ((x > 0 && a[y * T + x - 1] > 1) || (x < T - 1 && a[y * T + x + 1] > 1) || (y > 0 && a[(y - 1) * T + x] > 1) || (y < T - 1 && a[(y + 1) * T + x] > 1)) o[y * T + x] = 1;
    }
    r.a = o;
    return r;
  }
  function pline(r, y0, s, step) { var T = r.T; for (var y = Math.round(y0 * T); y < T; y += Math.max(2, Math.round(step * T))) for (var x = 0; x < T; x++) r.a[y * T + x] = s; }
  var ISTYLES = {
    planks: { label: 'Wood floor', full: true, fill: function (c, x, y) {
      var T = c.T, bh = Math.max(2, Math.round(T / 4)), b = Math.floor(y / bh), j = Math.floor(hh(b, 9, c.seed) * T);
      if (y % bh === 0 || x === j) return TC[0];
      if (x === mod(j + 2, T) && y % bh === 1) return TA[0];
      if (c.h(Math.floor(x / (c.dc * 3)), Math.floor(y / c.dc), 3) < 0.08) return TA[3];
      return b % 2 ? TA[2] : TA[1];
    } },
    flagstone: { label: 'Stone floor', full: true, fill: function (c, x, y) {
      var T = c.T, sh = T / 2, row = Math.floor(y / sh), off = row % 2 ? T / 4 : 0, sx = mod(x + off, sh), sy = y % sh, m = Math.max(1, Math.round(c.dc * 0.6));
      if (sx < m || sy < m) return c.h(Math.floor(x / c.dc), Math.floor(y / c.dc), 4) < 0.18 ? TD[1] : TA[0];
      if (sx < m * 2 && sy < sh * 0.6) return TA[3];
      return hh(row, Math.floor(mod(x + off, T) / sh), c.seed) < 0.5 ? TA[2] : TA[1];
    } },
    'door.wood': { label: 'Wooden door', draw: function (c) { var r = Px(c.T); pr(r, 0, 0, 1, 1, TB[1]); pr(r, 0.12, 0.08, 0.88, 1, TC[0]); pr(r, 0.2, 0.16, 0.8, 1, TC[2]); for (var i = 1; i < 3; i++) pr(r, 0.2 + i * 0.2, 0.16, 0.2 + i * 0.2 + 0.04, 1, TC[1]); pr(r, 0.66, 0.56, 0.74, 0.64, TF[3]); return r.a; } },
    'door.iron': { label: 'Iron door', draw: function (c) { var r = Px(c.T); pr(r, 0, 0, 1, 1, TB[1]); pr(r, 0.12, 0.06, 0.88, 1, TC[0]); pr(r, 0.18, 0.12, 0.82, 1, TC[2]); pr(r, 0.18, 0.3, 0.82, 0.38, TC[3]); pr(r, 0.18, 0.7, 0.82, 0.78, TC[3]); pr(r, 0.64, 0.5, 0.72, 0.58, TF[3]); return r.a; } },
    'stairs.up': { label: 'Stairs up', draw: function (c) { var r = Px(c.T); for (var i = 0; i < 4; i++) { pr(r, 0, i / 4, 1, (i + 1) / 4, i % 2 ? TA[2] : TA[3]); pr(r, 0, (i + 1) / 4 - 0.06, 1, (i + 1) / 4, TA[0]); } pr(r, 0, 0, 0.1, 1, TB[1]); pr(r, 0.9, 0, 1, 1, TB[1]); return r.a; } },
    'stairs.down': { label: 'Stairs down', draw: function (c) { var r = Px(c.T); pr(r, 0, 0, 1, 1, 1); for (var i = 0; i < 4; i++) pr(r, 0.1, i / 4 + 0.04, 0.9, (i + 1) / 4 - 0.04, [TA[3], TA[2], TA[1], TA[0]][i]); return r.a; } },
    counter: { label: 'Counter', draw: function (c) { var r = Px(c.T); pr(r, 0, 0.18, 1, 0.46, TA[4]); pr(r, 0, 0.42, 1, 0.48, TA[1]); pr(r, 0, 0.48, 1, 0.94, TC[1]); pr(r, 0.1, 0.56, 0.45, 0.86, TC[2]); pr(r, 0.55, 0.56, 0.9, 0.86, TC[2]); return pout(r).a; } },
    altar: { label: 'Altar', draw: function (c) { var r = Px(c.T); pr(r, 0.06, 0.2, 0.94, 0.44, TB[3]); pr(r, 0.06, 0.4, 0.94, 0.46, TB[1]); pr(r, 0.14, 0.46, 0.86, 0.92, TB[2]); pr(r, 0.42, 0.52, 0.58, 0.8, TD[2]); return pout(r).a; } },
    table: { label: 'Table', draw: function (c) { var r = Px(c.T); pr(r, 0.12, 0.62, 0.2, 0.92, TC[0]); pr(r, 0.8, 0.62, 0.88, 0.92, TC[0]); pr(r, 0.06, 0.26, 0.94, 0.64, TA[3]); pr(r, 0.06, 0.26, 0.94, 0.34, TA[4]); pr(r, 0.06, 0.58, 0.94, 0.64, TA[1]); return pout(r).a; } },
    barrel: { label: 'Barrel', draw: function (c) { var r = Px(c.T); pr(r, 0.18, 0.2, 0.82, 0.92, TA[1]); pr(r, 0.24, 0.2, 0.42, 0.92, TA[3]); pr(r, 0.66, 0.2, 0.82, 0.92, TA[0]); pr(r, 0.18, 0.12, 0.82, 0.24, TA[4]); pr(r, 0.18, 0.36, 0.82, 0.42, TC[0]); pr(r, 0.18, 0.72, 0.82, 0.78, TC[0]); return pout(r).a; } },
    bed: { label: 'Bed', draw: function (c) { var r = Px(c.T); pr(r, 0.08, 0.04, 0.92, 0.96, TC[0]); pr(r, 0.14, 0.1, 0.86, 0.9, TD[1]); pr(r, 0.14, 0.1, 0.86, 0.34, TF[3]); pr(r, 0.14, 0.4, 0.86, 0.48, TD[2]); return pout(r).a; } },
    shelf: { label: 'Bookshelf', draw: function (c) { var r = Px(c.T); pr(r, 0.04, 0.02, 0.96, 0.96, TC[0]); [0.08, 0.5].forEach(function (y0) { pr(r, 0.1, y0, 0.9, y0 + 0.38, TC[1]); for (var i = 0; i < 6; i++) pr(r, 0.12 + i * 0.13, y0 + 0.06 + (i % 3) * 0.03, 0.12 + i * 0.13 + 0.1, y0 + 0.36, [TD[1], TE[1], TF[1], TD[2], TE[2], TA[3]][i]); }); return r.a; } },
    plant: { label: 'Potted plant', draw: function (c) { var r = Px(c.T); pr(r, 0.32, 0.64, 0.68, 0.94, TC[1]); pr(r, 0.28, 0.6, 0.72, 0.68, TC[2]); pc(r, 0.5, 0.38, 0.28, TE[1]); pc(r, 0.42, 0.32, 0.12, TE[2]); pc(r, 0.62, 0.44, 0.08, TE[0]); return pout(r).a; } },
    lintel: { label: 'Beam (above)', draw: function (c) { var r = Px(c.T); pr(r, 0, 0, 1, 0.3, TC[1]); pr(r, 0, 0, 1, 0.08, TC[2]); pr(r, 0, 0.26, 1, 0.3, TC[0]); return r.a; } },
    pillar: { label: 'Pillar', draw: function (c) { var r = Px(c.T); pr(r, 0.22, 0.1, 0.78, 0.92, TB[2]); pr(r, 0.22, 0.1, 0.4, 0.92, TB[3]); pr(r, 0.62, 0.1, 0.78, 0.92, TB[1]); pr(r, 0.14, 0.02, 0.86, 0.14, TB[4]); pr(r, 0.14, 0.86, 0.86, 0.98, TB[1]); return pout(r).a; } },
    torch: { label: 'Torch', draw: function (c) {
      var r = Px(c.T), f = c.ph ? Math.sin(c.ph * Math.PI * 2) : 0;
      pr(r, 0.44, 0.48, 0.56, 0.86, TC[1]); pr(r, 0.36, 0.44, 0.64, 0.52, TC[2]);
      pc(r, 0.5, 0.32 - f * 0.03, 0.15 + f * 0.02, TF[1], 1.4); pc(r, 0.5, 0.36, 0.08, TF[3], 1.3);
      return pout(r).a;
    } },
    chest: { label: 'Chest', draw: function (c) { var r = Px(c.T); pr(r, 0.12, 0.34, 0.88, 0.88, TC[1]); pr(r, 0.12, 0.3, 0.88, 0.52, TC[2]); pr(r, 0.12, 0.5, 0.88, 0.56, TF[1]); pr(r, 0.44, 0.46, 0.56, 0.64, TF[3]); pr(r, 0.12, 0.3, 0.2, 0.88, TF[1]); pr(r, 0.8, 0.3, 0.88, 0.88, TF[1]); return pout(r).a; } },
    spikes: { label: 'Spike floor', draw: function (c) { var r = Px(c.T); for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) { var cx = 0.17 + i * 0.33, cy = 0.2 + j * 0.3; pr(r, cx - 0.06, cy, cx + 0.06, cy + 0.12, TC[2]); pr(r, cx - 0.02, cy - 0.06, cx + 0.02, cy + 0.02, TF[3]); } return r.a; }, under: true },
    arch: { label: 'Archway (above)', draw: function (c) { var r = Px(c.T); pr(r, 0, 0, 1, 0.34, TB[2]); pr(r, 0, 0, 1, 0.06, TB[4]); pr(r, 0, 0.3, 1, 0.36, TB[0]); pr(r, 0, 0, 0.18, 1, TB[2]); pr(r, 0.82, 0, 1, 1, TB[1]); return r.a; } }
  };

  // ---------------------------------------------------------------- tile animation
  // Three techniques. cycle rotates one material's master colors through its slots (the pixels never change, so any
  // hand drawn template animates too). scroll slides the texture across the shape (flowing water). phase redraws the
  // generator at successive phases (swaying canopy, flicker). Every tile bakes at most four frames.
  var TECHNIQUES = ['cycle', 'scroll', 'phase'];
  var ANIM_TYPES = {
    liquid: { label: 'Liquid shimmer', technique: 'cycle', params: { mat: 'E', ms: 240 } },
    flame: { label: 'Flame flicker', technique: 'phase', params: { ms: 130, frames: 4 } },
    flow: { label: 'Flowing current', technique: 'scroll', params: { ms: 150, frames: 4, dx: 0, dy: 1 } },
    foliage: { label: 'Foliage sway', technique: 'phase', params: { ms: 520, frames: 2 } },
    mechanism: { label: 'Mechanism', technique: 'phase', params: { ms: 200, frames: 4 } }
  };
  // animOf(art, anim) -> {technique, mat, ms, frames, dx, dy} with the type's defaults under the record's own params.
  function animOf(art, anim) {
    if (!anim || !anim.type || anim.type === 'none') return null;
    var reg = art && art.tileAnimTypes && art.tileAnimTypes[anim.type] || ANIM_TYPES[anim.type] || {};
    var p = Object.assign({}, reg.params || {}, anim.params || {}), tech = TECHNIQUES.indexOf(anim.technique) >= 0 ? anim.technique : reg.technique || 'cycle';
    var mat = TILE_RAMPS[p.mat] ? p.mat : 'E';
    var frames = tech === 'cycle' ? Math.min(4, TILE_RAMPS[mat].length) : clamp(Math.round(Number(p.frames) || 4), 2, 4);
    return { technique: tech, mat: mat, ms: clamp(Number(p.ms) || 200, 40, 4000), frames: frames, dx: Number(p.dx) || 0, dy: p.dy == null ? 1 : Number(p.dy) || 0 };
  }
  function frameAtTile(art, anim, tMs) { var a = animOf(art, anim); return a ? Math.floor((Number(tMs) || 0) / a.ms) % a.frames : 0; }
  // Slots for one animation frame: cycle rotates the material's last four slots; other techniques keep the slots.
  function cycleSlots(slots, a, frame) {
    if (!slots || !a || a.technique !== 'cycle' || !frame) return slots;
    var s = slots.slice(), sub = TILE_RAMPS[a.mat].slice(-4);
    for (var i = 0; i < sub.length; i++) s[sub[i]] = slots[sub[(i + frame) % sub.length]];
    return s;
  }

  // ---------------------------------------------------------------- records to pixels (pure; art is bundle.art)
  function tileItem(til, key) { return til && Array.isArray(til.tiles) ? til.tiles.filter(function (t) { return t && t.key === key; })[0] || null : null; }
  function styleOf(gen) { return gen && STYLES[gen.shape || gen.style] || null; }
  // template(art, til, T, frame, key) -> {w: 2T, h: 3T, idx} for a biome (key null) or an autotile interior item.
  function template(art, til, T, frame, key) {
    var src = key ? tileItem(til, key) : til && til.templates, anim = key ? src && src.anim : til && til.anim, a = animOf(art, anim);
    var seed = ((til && til.seed) >>> 0) ^ (key ? hash32(key) : 0), W = 2 * T, H = 3 * T;
    if (src && src.px && src.px.d) {
      try {
        var w = src.px.w || W, h = src.px.h || H, idx = decodePx(src.px.d, w, h);
        if (w !== W || h !== H) idx = resample(idx, w, h, W, H);
        return { w: W, h: H, idx: idx, px: true, resampled: w !== W || h !== H };
      } catch (e) { /* fall back to the generator */ }
    }
    var st = styleOf(src && src.gen) || STYLES.grass, f = a && a.technique !== 'cycle' ? frame % a.frames : 0;
    var c = makeCtx(T, seed, src && src.gen && src.gen.params, a && a.technique === 'phase' ? f / a.frames : 0, 0);
    var sh = a && a.technique === 'scroll' ? T / a.frames * f : 0;
    return { w: W, h: H, idx: paintTemplate(st, c, sh * (a ? a.dx : 0), sh * (a ? a.dy : 0)) };
  }
  function compose47(art, til, T, key) { var t = template(art, til, T, 0, key); return BLOB.map(function (rm) { return composeTile(t.idx, T, rm); }); }
  // tileIdx(art, til, blob, frame, key, variant, T, memo) -> Uint8Array T by T.
  function tileIdx(art, til, blob, frame, key, variant, T, memo) {
    var item = key ? tileItem(til, key) : null, anim = key ? item && item.anim : til.anim, a = animOf(art, anim), f = a && a.technique !== 'cycle' ? frame % a.frames : 0;
    var seed = ((til.seed >>> 0) ^ (key ? hash32(key) : 0)) >>> 0;
    if (key && item && !item.autotile) {
      if (item.px && item.px.d) { try { var pw = item.px.w || T, ph = item.px.h || T, pi = decodePx(item.px.d, pw, ph); return pw === T && ph === T ? pi : resample(pi, pw, ph, T, T); } catch (e) { /* generator */ } }
      var g = item.gen || {}, is = ISTYLES[g.shape || g.style], c0 = makeCtx(T, seed, g.params, a && a.technique === 'phase' ? f / a.frames : 0, 0);
      if (!is) return new Uint8Array(T * T);
      if (is.full) { var sh0 = a && a.technique === 'scroll' ? T / a.frames * f : 0; return paintFull(is, c0, sh0 * (a ? a.dx : 0), sh0 * (a ? a.dy : 0)); }
      return is.draw(c0);
    }
    var src = key ? item : til.templates;
    if (variant && blob === BLOB_FULL && !(src && src.px && src.px.d)) {
      var st = styleOf(src && src.gen) || STYLES.grass, c = makeCtx(T, seed, src && src.gen && src.gen.params, a && a.technique === 'phase' ? f / a.frames : 0, variant);
      var sh = a && a.technique === 'scroll' ? T / a.frames * f : 0, vs = !key && Array.isArray(til.fillVariants) ? til.fillVariants[variant - 1] : null;
      return paintFull(st, c, sh * (a ? a.dx : 0), sh * (a ? a.dy : 0), vs && vs.mode === 'deco' ? 'deco' : 'reseed');
    }
    var mk = til.id + '|' + (key || '') + '|' + f + '|' + T, t = memo && memo.get(mk);
    if (!t) { t = template(art, til, T, f, key); if (memo) memo.set(mk, t); }
    return composeTile(t.idx, T, BLOB[blob] == null ? 0 : BLOB[blob]);
  }
  // Slots for a tileset: its pal_ record's 32 slots.
  function tileSlotsFor(art, til) { var p = rec(art, til && til.pal); return p && Array.isArray(p.slots) ? p.slots : null; }
  function tileBake(art, til, blob, frame, key, variant, T, entries, memo) {
    var idx = tileIdx(art, til, blob, frame, key, variant, T, memo), item = key ? tileItem(til, key) : null;
    var a = animOf(art, key ? item && item.anim : til.anim);
    return { w: T, h: T, ax: 0, ay: 0, idx: idx, rgba: rgba(idx, cycleSlots(tileSlotsFor(art, til), a, frame), entries) };
  }

  // ---------------------------------------------------------------- maps
  // map: {w, h, ground: [ref], deco: [ref or null]}. A ref is a tileset ID (a biome) or "<til id>:<tile key>" (an
  // interior tile). Biomes compose by priority: a cell belongs to every biome layer at or below its own, so higher
  // biomes draw their blob over the lower one and the lower one shows through their rounded, transparent edges.
  function prioList(art) {
    var all = recs(art, 'til_'), ids = Object.keys(all).filter(function (id) { return all[id] && all[id].kind === 'biome'; });
    var order = Array.isArray(art && art.priority) ? art.priority : [];
    ids.sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0 !== ib >= 0) return ia >= 0 ? -1 : 1;
      return (Number(all[a].priority) || 0) - (Number(all[b].priority) || 0) || (a < b ? -1 : 1);
    });
    return ids;
  }
  function resolveRef(art, ref) {
    if (typeof ref !== 'string' || !ref) return null;
    var i = ref.indexOf(':'), id = i < 0 ? ref : ref.slice(0, i), key = i < 0 ? null : ref.slice(i + 1), til = rec(art, id);
    if (!til) return null;
    if (!key) return til.kind === 'biome' ? { til: til, key: null, biome: true, flags: Number(til.flags) | 0, autotile: true } : null;
    var it = tileItem(til, key);
    return it ? { til: til, key: key, item: it, biome: false, flags: Number(it.flags) | 0, autotile: !!it.autotile } : null;
  }
  var PREP = typeof WeakMap === 'function' ? new WeakMap() : null;
  function prepare(art, map, token) {
    var old = PREP && PREP.get(map);
    if (old && old.art === art && old.token === token && old.n === map.ground.length) return old;
    var ranks = prioList(art), codes = [], byRef = {};
    function code(ref) {
      if (ref == null) return -1;
      if (byRef[ref] !== undefined) return byRef[ref];
      var r = resolveRef(art, ref);
      if (r) { r.rank = r.biome ? ranks.indexOf(r.til.id) : -1; r.ref = ref; }
      codes.push(r); byRef[ref] = codes.length - 1;
      return byRef[ref];
    }
    var n = map.w * map.h, g = new Int32Array(n), d = new Int32Array(n);
    for (var i = 0; i < n; i++) { g[i] = code(map.ground[i]); d[i] = map.deco ? code(map.deco[i]) : -1; }
    var rankInfo = ranks.map(function (id) { return codes.filter(function (c) { return c && c.biome && c.til.id === id; })[0] || null; });
    var p = { art: art, token: token, n: n, codes: codes, g: g, d: d, rankInfo: rankInfo };
    if (PREP) PREP.set(map, p);
    return p;
  }
  function flagsAt(art, map, x, y) {
    if (x < 0 || y < 0 || x >= map.w || y >= map.h) return 0;
    var i = y * map.w + x, dr = map.deco ? resolveRef(art, map.deco[i]) : null;
    if (dr) return dr.flags;
    var gr = resolveRef(art, map.ground[i]);
    return gr ? gr.flags : 0;
  }
  function variantAt(til, x, y) {
    var v = Array.isArray(til.fillVariants) ? til.fillVariants : [];
    if (!v.length) return 0;
    var r = hh(x, y, til.seed >>> 0), acc = 0;
    for (var i = 0; i < v.length; i++) { acc += clamp(Number(v[i] && v[i].weight) || 0, 0, 1); if (r < acc) return i + 1; }
    return 0;
  }
  // drawMap(ctx, cache, map, cam, tMs, opts) draws the visible cells. cam {x, y, w, h} in logical pixels. opts.layer
  // 'below' (default: ground, then decorations without the above flag) or 'above' (decorations with it).
  function drawMap(ctx, cache, map, cam, tMs, opts) {
    opts = opts || {};
    var art = cache.art, T = cache.size, P = prepare(art, map, cache), W = map.w, H = map.h, codes = P.codes, st = { cells: 0, blits: 0 };
    var x0 = Math.max(0, Math.floor(cam.x / T)), y0 = Math.max(0, Math.floor(cam.y / T)), x1 = Math.min(W - 1, Math.floor((cam.x + cam.w - 1) / T)), y1 = Math.min(H - 1, Math.floor((cam.y + cam.h - 1) / T));
    var above = opts.layer === 'above';
    function at(arr, x, y) { return arr[clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)]; }
    function rankAt(x, y) { var c = codes[at(P.g, x, y)]; return c && c.biome ? c.rank : 1e9; }
    function blit(til, blob, key, variant, anim, px, py) {
      var f = cache.tile(til.id, blob, frameAtTile(art, anim, tMs), key, variant);
      if (f) { blitFrame(ctx, f, px, py); st.blits++; }
    }
    function sameMask(arr, x, y, me) { var m = 0; for (var i = 0; i < 8; i++) if (at(arr, x + DIRS8[i][0], y + DIRS8[i][1]) === me) m |= DIRS8[i][2]; return m; }
    function drawInterior(info, arr, x, y, px, py, codeHere) {
      if (info.item.autotile || info.item.under) {
        var under = tileItem(info.til, 'floor');
        if (under && arr === P.g && info.key !== 'floor') blit(info.til, 0, 'floor', 0, under.anim, px, py);
      }
      blit(info.til, info.item.autotile ? blobIndex(sameMask(arr, x, y, codeHere)) : 0, info.key, 0, info.item.anim, px, py);
    }
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var i = y * W + x, px = x * T - Math.round(cam.x), py = y * T - Math.round(cam.y);
      st.cells++;
      if (!above) {
        var info = codes[P.g[i]];
        if (info && info.biome) {
          var own = info.rank, rs = [];
          for (var k = 0; k < 9; k++) { var rk = rankAt(x + (k % 3) - 1, y + Math.floor(k / 3) - 1); if (rk <= own && rs.indexOf(rk) < 0) rs.push(rk); }
          rs.sort(function (a, b) { return b - a; });
          var stack = [];
          for (var j = 0; j < rs.length; j++) {
            var m = 0;
            for (var q = 0; q < 8; q++) if (rankAt(x + DIRS8[q][0], y + DIRS8[q][1]) >= rs[j]) m |= DIRS8[q][2];
            stack.push([rs[j], m]);
            if (reduceMask(m) === 255) break;
          }
          for (var s = stack.length - 1; s >= 0; s--) {
            var ri = P.rankInfo[stack[s][0]];
            if (!ri) continue;
            var b = blobIndex(stack[s][1]), v = s === 0 && b === BLOB_FULL ? variantAt(ri.til, x, y) : 0;
            blit(ri.til, b, null, v, ri.til.anim, px, py);
          }
        } else if (info) drawInterior(info, P.g, x, y, px, py, P.g[i]);
      }
      var dinfo = codes[P.d[i]];
      if (dinfo && !dinfo.biome && !!(dinfo.flags & FLAGS.above) === above) drawInterior(dinfo, P.d, x, y, px, py, P.d[i]);
    }
    return st;
  }
  // matchClimate(tils, temp, moist, elev) -> the biome tileset whose climate box holds the point, preferring the
  // tightest box, then the higher priority. Feature biomes (volcanic) are placed by their own rule and never match.
  // With no box holding the point, the nearest box wins.
  function inBand(b, v) { return Array.isArray(b) && v >= b[0] && v <= b[1]; }
  function bandGap(b, v) { return !Array.isArray(b) ? 9 : v < b[0] ? b[0] - v : v > b[1] ? v - b[1] : 0; }
  function matchClimate(tils, t, m, e) {
    var best = null, bs = Infinity, near = null, nd = Infinity;
    (tils || []).forEach(function (til) {
      var c = til && til.climate;
      if (!c || til.kind !== 'biome' || c.feature) return;
      if (inBand(c.temp, t) && inBand(c.moist, m) && inBand(c.elev, e)) {
        var vol = (c.temp[1] - c.temp[0] + 1) * (c.moist[1] - c.moist[0] + 1) * (c.elev[1] - c.elev[0] + 1) * 100 - (Number(til.priority) || 0);
        if (vol < bs) { bs = vol; best = til; }
      } else {
        var d = bandGap(c.temp, t) + bandGap(c.moist, m) + bandGap(c.elev, e) * 1.5;
        if (d < nd) { nd = d; near = til; }
      }
    });
    return best || near;
  }

  // ---------------------------------------------------------------- battle backgrounds
  // bgd: {layers: [{kind, gen: {style, seed, colors: [dark, mid, light]}, parallax, drift}]}. Drawn straight to the
  // logical canvas in scanline rectangles, back to front. Horizontal drift scrolls a layer by parallax; everything wraps.
  var BG_KINDS = ['sky', 'far', 'mid', 'near', 'floor'];
  var BG_STYLES = {
    sky: ['gradient', 'stars', 'cave', 'storm', 'clouds'],
    far: ['peaks', 'hills', 'dunes', 'sea', 'canopy', 'wall', 'none'],
    mid: ['trees', 'pines', 'rocks', 'reeds', 'pillars', 'waves', 'mounds', 'none'],
    near: ['tufts', 'stones', 'none'],
    floor: ['grass', 'sand', 'snow', 'stone', 'water', 'planks', 'ash', 'mud']
  };
  function bgColors(L, ent) { var c = (L.gen && L.gen.colors) || []; return [0, 1, 2].map(function (i) { var m = c[i]; return typeof m === 'number' && ent[m] ? ent[m] : ['#203040', '#406080', '#8098b0'][i]; }); }
  // A periodic ridge: integer frequency sines over period P, so a scrolled layer wraps without a seam.
  function ridge(x, P, seed, amp) { var r = rng(seed), v = 0; for (var k = 1; k <= 4; k++) v += Math.sin((x / P) * Math.PI * 2 * (k * 2 + Math.floor(r() * 3)) + r() * 6.283) / k; return v * amp; }
  function bgDraw(ctx, bgd, tMs, w, h, opts) {
    opts = opts || {};
    var ent = opts.entries || [], hy = Math.round(h * 0.56), t = (Number(tMs) || 0) / 1000;
    var layers = (bgd && Array.isArray(bgd.layers) ? bgd.layers : []).slice().sort(function (a, b) { return BG_KINDS.indexOf(a && a.kind) - BG_KINDS.indexOf(b && b.kind); });
    var floorTop = hy;
    layers.forEach(function (L) {
      if (!L || BG_KINDS.indexOf(L.kind) < 0) return;
      var st = L.gen && L.gen.style || 'none', seed = (L.gen && L.gen.seed) >>> 0 || 1, c = bgColors(L, ent), r = rng(seed);
      var par = clamp(Number(L.parallax) || 0, 0, 1), off = (Number(L.drift) || 0) * t * 24 * (0.25 + par), P = w * 2, u = Math.max(1, Math.round(h / 224));
      function sx(x) { return mod(Math.round(x - off), P); }
      if (L.kind === 'sky') {
        var bands = 8, top = st === 'cave' ? h : hy;
        for (var i = 0; i < bands; i++) {
          var y0 = Math.floor(top * i / bands), y1 = Math.floor(top * (i + 1) / bands);
          ctx.fillStyle = i < bands / 2 ? c[0] : c[1]; ctx.fillRect(0, y0, w, y1 - y0);
          if (i === bands / 2 - 1 || i === bands / 2) { ctx.fillStyle = i < bands / 2 ? c[1] : c[0]; for (var dy = y0 + (i < bands / 2 ? 1 : 0); dy < y1; dy += 2) for (var dx = (dy >> 1) & 1; dx < w; dx += 2) ctx.fillRect(dx, dy, 1, 1); }
        }
        if (st === 'stars') { ctx.fillStyle = c[2]; for (var s = 0; s < 40; s++) { var tw = Math.sin(t * 3 + s) > -0.6; if (tw) ctx.fillRect(Math.floor(r() * w), Math.floor(r() * hy * 0.8), u, u); } }
        if (st === 'clouds' || st === 'storm') {
          ctx.fillStyle = st === 'storm' ? c[0] : c[2];
          for (var k = 0; k < 6; k++) { var cx = r() * P, cy = r() * hy * 0.6, cw = (30 + r() * 50) * u, ch = (6 + r() * 8) * u, px0 = sx(cx); for (var yy = 0; yy < ch; yy++) { var half = cw / 2 * Math.sqrt(1 - Math.pow(yy / ch * 2 - 1, 2)); var a0 = Math.round(px0 - half), a1 = Math.round(px0 + half); ctx.fillRect(a0, Math.round(cy + yy), a1 - a0, 1); ctx.fillRect(a0 - P, Math.round(cy + yy), a1 - a0, 1); } }
        }
        if (st === 'cave') { ctx.fillStyle = c[0]; for (var x = 0; x < w; x += 2 * u) { var dl = (6 + 18 * Math.abs(ridge(sx(x), P, seed, 1))) * u; ctx.fillRect(x, 0, 2 * u, Math.round(dl)); } }
        return;
      }
      if (L.kind === 'far') {
        if (st === 'none') return;
        if (st === 'wall') { ctx.fillStyle = c[1]; ctx.fillRect(0, 0, w, hy); ctx.fillStyle = c[0]; var bh = 8 * u; for (var y = 0; y < hy; y += bh) { ctx.fillRect(0, y, w, u); for (var x2 = ((y / bh) % 2) * 8 * u; x2 < w; x2 += 16 * u) ctx.fillRect(x2, y, u, bh); } return; }
        var amp = st === 'peaks' ? hy * 0.32 : st === 'hills' ? hy * 0.12 : st === 'dunes' ? hy * 0.08 : st === 'canopy' ? hy * 0.06 : hy * 0.02, base = st === 'peaks' ? hy * 0.62 : st === 'sea' ? hy : hy * 0.8;
        // Peaks are seeded triangles (the highest wins per column), lit on their left flank, capped in the light color.
        var pk = [];
        if (st === 'peaks') for (var q3 = 0; q3 < 9; q3++) pk.push([r() * P, hy * (0.25 + r() * 0.5), 0.55 + r() * 0.6]);
        for (var x3 = 0; x3 < w; x3++) {
          var X = sx(x3), yt, lit = false, cap = 0;
          if (st === 'peaks') {
            var top = hy;
            pk.forEach(function (p) { var dxp = X - p[0]; dxp -= P * Math.round(dxp / P); var y = hy - p[1] + Math.abs(dxp) * p[2]; if (y < top) { top = y; lit = dxp < 0; cap = Math.max(0, p[1] * 0.28 - Math.abs(dxp) * p[2] * 0.2); } });
            yt = Math.round(top + (hh(Math.floor(X / (2 * u)), 0, seed) - 0.5) * 2 * u);
          } else yt = Math.round(base - amp * (ridge(X, P, seed, 1) * 0.5 + 0.5) - (st === 'canopy' ? Math.abs(Math.sin(X / (6 * u))) * 5 * u : 0));
          ctx.fillStyle = st === 'peaks' && !lit ? c[0] : c[1]; ctx.fillRect(x3, yt, 1, hy - yt + 1);
          ctx.fillStyle = st === 'peaks' ? c[2] : c[0]; ctx.fillRect(x3, yt, 1, st === 'peaks' ? Math.max(1, Math.round(cap)) : u);
        }
        if (st === 'sea') { ctx.fillStyle = c[2]; for (var y4 = 0; y4 < 4; y4++) for (var k4 = 0; k4 < 10; k4++) ctx.fillRect(sx(r() * P + y4 * 7), hy - 2 * u - y4 * 3 * u, 6 * u, u); }
        return;
      }
      if (L.kind === 'mid' || L.kind === 'near') {
        if (st === 'none') return;
        var near = L.kind === 'near', count = near ? 7 : st === 'pillars' ? 5 : 8, sc = near ? 2 : 1.8;
        for (var n = 0; n < count; n++) {
          var ox = r() * P, ph = r(), x5 = sx(ox), gy = near ? h - Math.round((4 + r() * 10) * u) : hy + Math.round(r() * 3 * u), s5 = (0.7 + r() * 0.6) * sc * u;
          [x5, x5 - P].forEach(function (bx) {
            if (bx < -60 * s5 || bx > w + 60 * s5) return;
            if (st === 'trees') { ctx.fillStyle = c[0]; ctx.fillRect(Math.round(bx - 2 * s5), gy - Math.round(12 * s5), Math.round(4 * s5), Math.round(12 * s5)); for (var j = 0; j < 14 * s5; j++) { var hw = Math.sqrt(Math.max(0, 1 - Math.pow(j / (14 * s5) * 2 - 1, 2))) * 12 * s5; ctx.fillStyle = j < 6 * s5 ? c[2] : c[1]; ctx.fillRect(Math.round(bx - hw), gy - Math.round(26 * s5) + j, Math.round(hw * 2), 1); } }
            else if (st === 'pines') { for (var j2 = 0; j2 < 30 * s5; j2++) { var hw2 = (j2 % (10 * s5)) / (10 * s5) * 6 * s5 + j2 / (30 * s5) * 4 * s5; ctx.fillStyle = j2 % (10 * s5) < 3 * s5 ? c[2] : c[1]; ctx.fillRect(Math.round(bx - hw2), gy - Math.round(32 * s5) + j2, Math.max(1, Math.round(hw2 * 2)), 1); } ctx.fillStyle = c[0]; ctx.fillRect(Math.round(bx - s5), gy - Math.round(3 * s5), Math.max(1, Math.round(2 * s5)), Math.round(3 * s5)); }
            else if (st === 'rocks' || st === 'stones' || st === 'mounds') { var rw = (st === 'mounds' ? 22 : 10) * s5, rh = (st === 'mounds' ? 10 : 7) * s5; for (var j3 = 0; j3 < rh; j3++) { var hw3 = Math.sqrt(1 - Math.pow(1 - j3 / rh, 2)) * rw / 2; ctx.fillStyle = j3 < rh * 0.35 ? c[2] : c[1]; ctx.fillRect(Math.round(bx - hw3), gy - Math.round(rh) + j3, Math.max(1, Math.round(hw3 * 2)), 1); } ctx.fillStyle = c[0]; ctx.fillRect(Math.round(bx - rw / 2), gy - 1, Math.round(rw), Math.max(1, u)); }
            else if (st === 'reeds' || st === 'tufts') { ctx.fillStyle = c[1]; for (var j4 = 0; j4 < 5; j4++) { var hh4 = (st === 'reeds' ? 10 + j4 * 3 : 3 + j4) * s5; ctx.fillRect(Math.round(bx + (j4 - 2) * 2 * s5), gy - Math.round(hh4), Math.max(1, Math.round(s5)), Math.round(hh4)); } ctx.fillStyle = c[2]; ctx.fillRect(Math.round(bx), gy - Math.round((st === 'reeds' ? 22 : 6) * s5), Math.max(1, Math.round(2 * s5)), Math.max(1, Math.round(3 * s5))); }
            else if (st === 'pillars') { var pw = 13 * s5, phh = hy * (0.7 + ph * 0.2); ctx.fillStyle = c[1]; ctx.fillRect(Math.round(bx - pw / 2), Math.round(gy - phh), Math.round(pw), Math.round(phh)); ctx.fillStyle = c[2]; ctx.fillRect(Math.round(bx - pw / 2), Math.round(gy - phh), Math.max(1, Math.round(pw / 3)), Math.round(phh)); ctx.fillStyle = c[0]; ctx.fillRect(Math.round(bx - pw / 2 - 2 * s5), Math.round(gy - phh), Math.round(pw + 4 * s5), Math.max(1, Math.round(3 * s5))); }
            else if (st === 'waves') { ctx.fillStyle = c[2]; ctx.fillRect(Math.round(bx), gy + Math.round(Math.sin(t * 2 + ph * 6) * 2 * u), Math.round(10 * s5), Math.max(1, u)); }
          });
        }
        return;
      }
      if (L.kind === 'floor') {
        floorTop = hy;
        ctx.fillStyle = c[1]; ctx.fillRect(0, hy, w, h - hy);
        var rows = 7;
        for (var i2 = 0; i2 < rows; i2++) {
          var fy = hy + Math.round((h - hy) * Math.pow(i2 / rows, 1.7)), gap = Math.max(4, Math.round((4 + i2 * 5) * u));
          ctx.fillStyle = i2 % 2 ? c[0] : c[2];
          if (st === 'planks' || st === 'stone') { ctx.fillRect(0, fy, w, u); for (var x6 = mod(-Math.round(off * (0.3 + i2 * 0.1)) + i2 * 7, gap * 3); x6 < w; x6 += gap * 3) ctx.fillRect(x6, fy, u, Math.max(1, Math.round((h - hy) / rows))); }
          else if (st === 'water') { for (var k6 = 0; k6 < w; k6 += gap * 2) ctx.fillRect(mod(k6 + Math.round(Math.sin(t + i2) * gap), w), fy, gap, u); }
          else { for (var k7 = 0; k7 < w / gap; k7++) { var xx = mod(Math.floor(r() * w) - Math.round(off * (0.3 + i2 * 0.15)), w); ctx.fillRect(xx, fy + Math.floor(r() * 2 * u), Math.max(u, Math.round(gap / 3)), u); } }
        }
        ctx.fillStyle = c[0]; ctx.fillRect(0, hy, w, u);
      }
    });
    return { horizon: floorTop };
  }

  R.tiles = {
    SLOTS: TILE_SLOTS, RAMPS: TILE_RAMPS, FLAGS: FLAGS, STYLES: STYLES, ISTYLES: ISTYLES, TECHNIQUES: TECHNIQUES, ANIM_TYPES: ANIM_TYPES,
    BLOB: BLOB, BLOB_FULL: BLOB_FULL, slots: tileSlots, colorway: tileColorway, detailCell: detailCell,
    reduce: reduceMask, mask8: mask8, blobIndex: blobIndex, quarterFor: quarterFor, compose: composeTile, template: template, compose47: compose47,
    tile: tileIdx, slotsFor: tileSlotsFor, cycleSlots: cycleSlots, anim: animOf, frameAt: frameAtTile,
    item: tileItem, resolve: resolveRef, prioList: prioList, prepare: prepare, flagsAt: flagsAt, drawMap: drawMap, matchClimate: matchClimate, variantAt: variantAt
  };
  R.bg = { KINDS: BG_KINDS, STYLES: BG_STYLES, draw: bgDraw };

  // ================================================================ PHASE 5: INTERFACE KIT AND BATTLE PRESENTER
  // build.js splices this file into ENGINE:RENDER after the tile engine. It reads no host global: records, palettes,
  // contexts, battle snapshots, events, and the cue callback all arrive as arguments. Drawing uses fillRect and
  // drawImage only, at logical resolution; the host scales the logical canvas once per frame.

  // ---------------------------------------------------------------- the font
  // An original 5 by 7 font (cap height 7, one descender row, so 8 rows per glyph) for code points 32 to 126. Each glyph
  // is eight characters of the codec alphabet, one per row, bit 4 the leftmost pixel. A uik_ ui:font record stores the
  // same glyphs as hex rows ({code: 'rrrrrrrrrrrrrrrr'}, two hex digits per row) so a user can redraw any of them.
  var FONT_ROWS = '0000000044444040AAA00000AAVAVAA04FKE5U40OP248J30CIK8LID044800000248884208422248004LEL400044V440000000448' +
    '000V000000000CC011248GG0EHJLPHE04C4444E0EH1248V0U11E11U026AIV220VGU11HE068GUHHE0V1248880EHHEHHE0EHHF12C0' +
    '0CC0CC000CC0C480248G842000V0V00084212480EH124040EHNLNGF04AHHVHH0UHHUHHU0EHGGGHE0SIHHHIS0VGGUGGV0VGGUGGG0' +
    'EHGNHHF0HHHVHHH0E44444E072222IC0HIKOKIH0GGGGGGV0HRLLHHH0HHPLJHH0EHHHHHE0UHHUGGG0EHHHLID0UHHUKIH0FGGE11U0' +
    'V4444440HHHHHHE0HHHHHA40HHHLLLA0HHA4AHH0HHA44440V1248GV0E88888E0GG842110E22222E04AH000000000000V84200000' +
    '00E1FHF0GGUHHHU000EGGHE011FHHHF000EHVGE0698S888000FHHF1EGGUHHHH040C444E0206222ICGGIKOKI0C44444E000QLLLL0' +
    '00UHHHH000EHHHE000UHHUGG00FHHF1100MPGGG000FGE1U088S8896000HHHJD000HHHA4000HHLLA000HA4AH000HHHF1E00V248V0' +
    '344O443044444440O44344O0008L2000';
  var B32 = '0123456789ABCDEFGHIJKLMNOPQRSTUV';
  function defaultGlyphs() {
    var out = {};
    for (var c = 32; c <= 126; c++) {
      var s = FONT_ROWS.substr((c - 32) * 8, 8), hex = '';
      for (var r = 0; r < 8; r++) { var v = B32.indexOf(s.charAt(r)); hex += (v < 16 ? '0' : '') + Math.max(0, v).toString(16); }
      out[c] = hex;
    }
    return out;
  }
  var DEFAULT_FONT = { w: 5, h: 7, rows: 8, advance: 6, line: 10, glyphs: defaultGlyphs() };
  // fontOf(record or null) -> {w, h, rows, advance, line, bits: {code: [row ints]}}. Memoized by content, so an edited
  // glyph redraws at once and an unchanged record parses once.
  var fontMemo = {}, fontMemoKeys = [], defaultFontObj = null;
  function parseFont(src) {
    var w = clamp(Math.round(Number(src.w) || 5), 1, 8), rows = clamp(Math.round(Number(src.rows) || 8), 1, 16);
    var f = { w: w, h: clamp(Math.round(Number(src.h) || 7), 1, rows), rows: rows, advance: clamp(Math.round(Number(src.advance) || w + 1), 1, 16), line: clamp(Math.round(Number(src.line) || rows + 2), rows, 32), bits: {} };
    var g = src.glyphs && typeof src.glyphs === 'object' ? src.glyphs : {};
    Object.keys(g).forEach(function (k) {
      var hex = String(g[k] || ''), list = [];
      for (var r = 0; r < rows; r++) { var v = parseInt(hex.substr(r * 2, 2), 16); list.push(isFinite(v) ? v & ((1 << w) - 1) : 0); }
      f.bits[Number(k)] = list;
    });
    return f;
  }
  function fontOf(rec0) {
    if (!rec0 || !rec0.glyphs) { if (!defaultFontObj) defaultFontObj = parseFont(DEFAULT_FONT); return defaultFontObj; }
    var key = [rec0.w, rec0.h, rec0.rows, rec0.advance, rec0.line, JSON.stringify(rec0.glyphs)].join('|');
    if (fontMemo[key]) return fontMemo[key];
    var f = parseFont(rec0);
    fontMemo[key] = f; fontMemoKeys.push(key);
    if (fontMemoKeys.length > 8) delete fontMemo[fontMemoKeys.shift()];
    return f;
  }
  function glyphBits(font, code) { return font.bits[code] || font.bits[63] || null; }
  function measure(font, str, scale) {
    font = font && font.bits ? font : fontOf(font);
    var s = String(str == null ? '' : str), k = Math.max(1, Math.round(scale || 1));
    return s.length ? (s.length * font.advance - (font.advance - font.w)) * k : 0;
  }
  // text(ctx, font, str, x, y, {color, shadow, scale, align: left|center|right}) draws runs of lit pixels as single rects.
  function drawText(ctx, font, str, x, y, opts) {
    opts = opts || {};
    font = font && font.bits ? font : fontOf(font);
    var s = String(str == null ? '' : str), k = Math.max(1, Math.round(opts.scale || 1));
    if (opts.align === 'center') x -= Math.floor(measure(font, s, k) / 2);
    else if (opts.align === 'right') x -= measure(font, s, k);
    x = Math.round(x); y = Math.round(y);
    function pass(dx, dy, color) {
      ctx.fillStyle = color;
      for (var i = 0; i < s.length; i++) {
        var bits = glyphBits(font, s.charCodeAt(i));
        if (!bits) continue;
        var gx = x + i * font.advance * k + dx;
        for (var r = 0; r < bits.length; r++) {
          var row = bits[r], c = 0;
          while (c < font.w) {
            if (!(row & (1 << (font.w - 1 - c)))) { c++; continue; }
            var c0 = c;
            while (c < font.w && (row & (1 << (font.w - 1 - c)))) c++;
            ctx.fillRect(gx + c0 * k, y + r * k + dy, (c - c0) * k, k);
          }
        }
      }
    }
    if (opts.shadow) pass(k, k, opts.shadow);
    if (opts.outline) [[-k, 0], [k, 0], [0, -k], [0, k], [-k, -k], [k, -k], [-k, k], [k, k]].forEach(function (d) { pass(d[0], d[1], opts.outline); });
    pass(0, 0, opts.color || '#ffffff');
    return measure(font, s, k);
  }
  // Greedy word wrap to a pixel width.
  function wrapText(font, str, maxW, scale) {
    font = font && font.bits ? font : fontOf(font);
    var words = String(str == null ? '' : str).split(/\s+/).filter(Boolean), lines = [], line = '';
    words.forEach(function (wd) {
      var t = line ? line + ' ' + wd : wd;
      if (!line || measure(font, t, scale) <= maxW) line = t;
      else { lines.push(line); line = wd; }
    });
    if (line) lines.push(line);
    return lines;
  }

  // ---------------------------------------------------------------- colors from records
  // A color field is {hex, m}: m is a master index (wins when the palette has it), hex the source it was fitted from.
  function colOf(o, entries, fb) {
    if (o && typeof o.m === 'number' && entries && entries[o.m]) return entries[o.m];
    var h = o && normHex(o.hex);
    return h || fb;
  }

  // ---------------------------------------------------------------- windows
  // ui:window {gradient: {top, bottom}, border, light, corner: square|round|notch, thickness: 1|2, alpha, open {ms, style}}
  var WIN_CORNERS = ['square', 'round', 'notch'];
  var OPEN_STYLES = ['grow', 'fade', 'none'];
  function drawWindow(ctx, uik, x, y, w, h, opts) {
    opts = opts || {};
    var ent = opts.entries || [], u = Math.max(1, Math.round(opts.unit || 1)), win = uik || {};
    var open = opts.open == null ? 1 : clamp(Number(opts.open) || 0, 0, 1), st = win.open && win.open.style || 'grow';
    if (open <= 0) return null;
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    if (open < 1 && st === 'grow') { var nh = Math.max(4 * u, Math.round(h * open)); y += Math.round((h - nh) / 2); h = nh; }
    var alpha = clamp(win.alpha == null ? 1 : Number(win.alpha), 0.2, 1) * (open < 1 && st === 'fade' ? open : 1);
    var top = colOf(win.gradient && win.gradient.top, ent, '#2848a8'), bot = colOf(win.gradient && win.gradient.bottom, ent, '#101850');
    var bd = colOf(win.border, ent, '#000000'), li = colOf(win.light, ent, '#e8e8f0'), th = clamp(Math.round(Number(win.thickness) || 1), 1, 3) * u;
    var corner = WIN_CORNERS.indexOf(win.corner) >= 0 ? win.corner : 'round', cut = corner === 'round' ? u : corner === 'notch' ? 2 * u : 0;
    ctx.globalAlpha = alpha;
    // body: top color, a two row checker dither, then the bottom color
    var bx = x + u + th, by = y + u + th, bw = w - 2 * (u + th), bh = h - 2 * (u + th);
    if (bw > 0 && bh > 0) {
      var mid = by + Math.round(bh * 0.5);
      ctx.fillStyle = top; ctx.fillRect(bx, by, bw, Math.max(0, mid - by));
      ctx.fillStyle = bot; ctx.fillRect(bx, mid, bw, by + bh - mid);
      ctx.fillStyle = top;
      for (var dy = mid; dy < Math.min(by + bh, mid + 2 * u); dy += u) for (var dx = bx + (((dy - mid) / u) & 1) * u; dx < bx + bw; dx += 2 * u) ctx.fillRect(dx, dy, u, u);
      ctx.fillStyle = bot;
      for (var dy2 = mid - 2 * u; dy2 < mid; dy2 += u) if (dy2 >= by) for (var dx2 = bx + (((dy2 - mid) / u) & 1) * u; dx2 < bx + bw; dx2 += 2 * u) ctx.fillRect(dx2, dy2, u, u);
    }
    // frame: the outer dark line, then the light border, with the chosen corner
    function frame(x0, y0, w0, h0, s, color, c) {
      ctx.fillStyle = color;
      ctx.fillRect(x0 + c, y0, w0 - 2 * c, s); ctx.fillRect(x0 + c, y0 + h0 - s, w0 - 2 * c, s);
      ctx.fillRect(x0, y0 + c, s, h0 - 2 * c); ctx.fillRect(x0 + w0 - s, y0 + c, s, h0 - 2 * c);
      if (c > s) { ctx.fillRect(x0 + s, y0 + s, c - s, c - s); ctx.fillRect(x0 + w0 - c, y0 + s, c - s, c - s); ctx.fillRect(x0 + s, y0 + h0 - c, c - s, c - s); ctx.fillRect(x0 + w0 - c, y0 + h0 - c, c - s, c - s); }
    }
    frame(x, y, w, h, u, bd, cut);
    frame(x + u, y + u, w - 2 * u, h - 2 * u, th, li, Math.max(0, cut - u));
    ctx.globalAlpha = 1;
    return { x: x, y: y, w: w, h: h, inner: { x: bx + u, y: by + u, w: bw - 2 * u, h: bh - 2 * u } };
  }

  // ---------------------------------------------------------------- cursor
  // ui:cursor {style: triangle|hand|diamond|bar, fill, outline, light, bob: {amp, ms}}. x, y is the point the cursor aims
  // at; the cursor sits to its left and bobs horizontally.
  var CURSOR_SHAPES = {
    triangle: { rows: ['oo....', 'olo...', 'olfo..', 'offfo.', 'offffo', 'offfo.', 'offo..', 'ofo...', 'oo....'], tip: [5, 4] },
    hand: { rows: ['..oooo....', '.ollffoooo', 'olffffllfo', 'offfffoooo', 'offffo....', '.offo.....', '..oo......'], tip: [9, 2] },
    diamond: { rows: ['...o...', '..olo..', '.olffo.', 'offfffo', '.offfo.', '..ofo..', '...o...'], tip: [6, 3] },
    bar: { rows: ['oo', 'lo', 'fo', 'fo', 'fo', 'fo', 'oo'], tip: [1, 3] }
  };
  function drawCursor(ctx, uik, x, y, tMs, opts) {
    opts = opts || {};
    var c = uik || {}, ent = opts.entries || [], u = Math.max(1, Math.round(opts.unit || 1)), sh = CURSOR_SHAPES[c.style] || CURSOR_SHAPES.triangle;
    var bob = c.bob || {}, amp = clamp(Number(bob.amp == null ? 2 : bob.amp), 0, 8), ms = clamp(Number(bob.ms) || 600, 100, 4000);
    var off = Math.round(-Math.abs(Math.sin((Number(tMs) || 0) / ms * Math.PI)) * amp) * u;
    var cols = { o: colOf(c.outline, ent, '#101010'), f: colOf(c.fill, ent, '#f0f0f0'), l: colOf(c.light, ent, '#ffffff') };
    var x0 = Math.round(x - (sh.tip[0] + 2) * u + off), y0 = Math.round(y - sh.tip[1] * u);
    ['o', 'f', 'l'].forEach(function (k) {
      ctx.fillStyle = cols[k];
      sh.rows.forEach(function (row, r) { for (var i = 0; i < row.length; i++) if (row.charAt(i) === k) ctx.fillRect(x0 + i * u, y0 + r * u, u, u); });
    });
    return { x: x0, y: y0, w: sh.rows[0].length * u, h: sh.rows.length * u };
  }

  // ---------------------------------------------------------------- gauges and popups
  function drawGauge(ctx, x, y, w, h, frac, colors) {
    colors = colors || {};
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    ctx.fillStyle = colors.back || '#101018'; ctx.fillRect(x, y, w, h);
    var f = Math.round((w - 2) * clamp(Number(frac) || 0, 0, 1));
    if (f > 0) { ctx.fillStyle = colors.fill || '#e8c040'; ctx.fillRect(x + 1, y + 1, f, h - 2); if (colors.light && h > 3) { ctx.fillStyle = colors.light; ctx.fillRect(x + 1, y + 1, f, 1); } }
  }
  // A number or word popping from a point: bounces for 240 ms, holds, fades over its last 150 ms.
  var POPUP_MS = 600;
  function popupOffset(age, u) {
    if (age < 240) return -Math.round(Math.sin(age / 240 * Math.PI) * 6 * u);
    return 0;
  }

  // ---------------------------------------------------------------- touch skin
  // ui:touch {scheme (null reads the Charter), shape: round|square, opacity, size, color, ink, labels {a, b, menu}}.
  // layout(scheme, w, h, skin) -> {scheme, controls: [{key, kind: dpad|stick|button|area, x, y, r, label}]}, all in
  // logical pixels. hit(layout, x, y) -> {key, dir, vx, vy} or null. draw(ctx, layout, skin, {pressed, entries, font}).
  var SCHEMES = ['dpad', 'stick', 'tap', 'hybrid'];
  function touchLayout(scheme, w, h, skin) {
    skin = skin || {};
    scheme = SCHEMES.indexOf(scheme) >= 0 ? scheme : 'dpad';
    var s = clamp(Math.round(Number(skin.size) || Math.min(w, h) * 0.2), 12, Math.round(Math.min(w, h) * 0.45));
    var r = Math.round(s / 2), m = Math.max(3, Math.round(s * 0.18)), labels = skin.labels || {};
    var out = [], br = Math.max(6, Math.round(r * 0.55)), cy = h - m - r;
    if (scheme === 'tap' || scheme === 'hybrid') out.push({ key: 'tap', kind: 'area', x: 0, y: 0, w: w, h: h });
    if (scheme === 'dpad') out.push({ key: 'dpad', kind: 'dpad', x: m + r, y: cy, r: r });
    if (scheme === 'stick' || scheme === 'hybrid') out.push({ key: 'stick', kind: 'stick', x: m + r, y: cy, r: r });
    if (scheme !== 'tap') {
      out.push({ key: 'a', kind: 'button', x: w - m - br, y: cy - Math.round(br * 0.6), r: br, label: String(labels.a || 'A').slice(0, 2) });
      out.push({ key: 'b', kind: 'button', x: w - m - br * 3 - 2, y: cy + Math.round(br * 0.6), r: br, label: String(labels.b || 'B').slice(0, 2) });
    }
    var mr = Math.max(5, Math.round(br * 0.6));
    out.push({ key: 'menu', kind: 'button', x: w - m - mr, y: m + mr, r: mr, label: String(labels.menu || '=').slice(0, 2), small: true });
    return { scheme: scheme, w: w, h: h, size: s, controls: out };
  }
  function touchHit(layout, x, y) {
    if (!layout) return null;
    var list = layout.controls, area = null;
    for (var i = list.length - 1; i >= 0; i--) {
      var c = list[i];
      if (c.kind === 'area') { area = c; continue; }
      var dx = x - c.x, dy = y - c.y, d = Math.sqrt(dx * dx + dy * dy), reach = c.kind === 'button' ? c.r * 1.25 : c.r * 1.35;
      if (d > reach) continue;
      if (c.kind === 'button') return { key: c.key };
      var dead = c.r * 0.22;
      if (d < dead) return { key: c.key, dir: null, vx: 0, vy: 0 };
      var dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      return { key: c.key, dir: dir, vx: clamp(dx / c.r, -1, 1), vy: clamp(dy / c.r, -1, 1) };
    }
    return area ? { key: 'tap', x: x, y: y } : null;
  }
  function disc(ctx, cx, cy, r, round) {
    cx = Math.round(cx); cy = Math.round(cy); r = Math.max(1, Math.round(r));
    if (!round) { ctx.fillRect(cx - r, cy - r, 2 * r + 1, 2 * r + 1); return; }
    for (var dy = -r; dy <= r; dy++) { var half = Math.floor(Math.sqrt(r * r - dy * dy + r * 0.8)); ctx.fillRect(cx - half, cy + dy, 2 * half + 1, 1); }
  }
  function drawTouch(ctx, layout, skin, opts) {
    if (!layout) return;
    skin = skin || {}; opts = opts || {};
    var ent = opts.entries || [], round = skin.shape !== 'square', a = clamp(skin.opacity == null ? 0.55 : Number(skin.opacity), 0.1, 1);
    var col = colOf(skin.color, ent, '#d8d8e0'), ink = colOf(skin.ink, ent, '#202028'), pressed = opts.pressed || {}, font = opts.font ? fontOf(opts.font) : fontOf(null);
    layout.controls.forEach(function (c) {
      if (c.kind === 'area') return;
      var on = pressed[c.key] != null && pressed[c.key] !== false;
      ctx.globalAlpha = a * (on ? 1 : 0.8);
      if (c.kind === 'dpad') {
        var arm = Math.max(3, Math.round(c.r * 0.38));
        ctx.fillStyle = ink; disc(ctx, c.x, c.y, c.r, round);
        ctx.fillStyle = col;
        ctx.fillRect(Math.round(c.x - arm), Math.round(c.y - c.r + 2), 2 * arm, 2 * c.r - 3);
        ctx.fillRect(Math.round(c.x - c.r + 2), Math.round(c.y - arm), 2 * c.r - 3, 2 * arm);
        var dirOn = on ? pressed[c.key] : null;
        if (dirOn && typeof dirOn === 'string') {
          var d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dirOn];
          if (d) { ctx.fillStyle = ink; ctx.globalAlpha = a; ctx.fillRect(Math.round(c.x + d[0] * c.r * 0.6 - arm / 2), Math.round(c.y + d[1] * c.r * 0.6 - arm / 2), arm, arm); }
        }
      } else if (c.kind === 'stick') {
        ctx.fillStyle = ink; disc(ctx, c.x, c.y, c.r, round);
        ctx.fillStyle = col; ctx.globalAlpha = a * 0.5; disc(ctx, c.x, c.y, c.r - 2, round);
        var v = on && typeof pressed[c.key] === 'object' ? pressed[c.key] : { vx: 0, vy: 0 };
        ctx.globalAlpha = a; ctx.fillStyle = col; disc(ctx, c.x + (v.vx || 0) * c.r * 0.5, c.y + (v.vy || 0) * c.r * 0.5, Math.round(c.r * 0.45), round);
      } else {
        ctx.fillStyle = on ? col : ink; disc(ctx, c.x, c.y, c.r, round);
        ctx.fillStyle = on ? ink : col; disc(ctx, c.x, c.y, c.r - 1, round);
        ctx.globalAlpha = 1;
        drawText(ctx, font, c.label || '', c.x, c.y - Math.floor(font.h / 2), { color: on ? col : ink, align: 'center' });
      }
    });
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- title screen
  // ui:title {text (null reads the Charter title), style: outline|shadow|plain, scale, color, shadow, layout:
  // center|upper|lower, bg (bgd_ id), prompt, credit}. Draws the background, the logo, a blinking prompt, and a credit.
  var TITLE_STYLES = ['outline', 'shadow', 'plain'];
  var TITLE_LAYOUTS = ['center', 'upper', 'lower'];
  function drawTitle(ctx, uik, opts) {
    opts = opts || {};
    var t = uik || {}, ent = opts.entries || [], w = opts.w || 256, h = opts.h || 224, u = Math.max(1, Math.round(opts.unit || 1)), tMs = Number(opts.tMs) || 0;
    var font = fontOf(opts.font || null), bgd = opts.bgd || null;
    if (bgd) bgDraw(ctx, bgd, tMs, w, h, { entries: ent }); else { ctx.fillStyle = colOf(t.shadow, ent, '#080810'); ctx.fillRect(0, 0, w, h); }
    var text = String(t.text || opts.text || 'Untitled'), k = clamp(Math.round(Number(t.scale) || 3), 1, 8) * u;
    var lines = wrapText(font, text, w - 16 * u, k);
    while (lines.length > 3 && k > u) { k -= u; lines = wrapText(font, text, w - 16 * u, k); }
    var lh = font.line * k, blockH = lines.length * lh, lay = TITLE_LAYOUTS.indexOf(t.layout) >= 0 ? t.layout : 'center';
    var y0 = lay === 'upper' ? Math.round(h * 0.16) : lay === 'lower' ? Math.round(h * 0.62 - blockH) : Math.round(h * 0.42 - blockH / 2);
    var main = colOf(t.color, ent, '#f0d070'), shade = colOf(t.shadow, ent, '#201008'), style = TITLE_STYLES.indexOf(t.style) >= 0 ? t.style : 'outline';
    lines.forEach(function (ln, i) {
      var o = { color: main, scale: k, align: 'center' };
      if (style === 'outline') { o.outline = shade; o.shadow = shade; } else if (style === 'shadow') o.shadow = shade;
      drawText(ctx, font, ln, w / 2, y0 + i * lh, o);
    });
    var prompt = t.prompt == null ? 'Press Start' : String(t.prompt);
    if (prompt && Math.floor(tMs / 520) % 2 === 0) drawText(ctx, font, prompt, w / 2, Math.round(h * 0.76), { color: colOf(t.light, ent, '#ffffff'), shadow: shade, scale: u, align: 'center' });
    if (t.credit) drawText(ctx, font, String(t.credit), w / 2, h - (font.line + 2) * u, { color: colOf(t.light, ent, '#c0c0c0'), shadow: shade, scale: u, align: 'center' });
    return { lines: lines.length, scale: k };
  }

  // ---------------------------------------------------------------- the battle presenter
  // createPresenter(cfg) turns ENGINE_BATTLE events into timed beats on a logical canvas. cfg:
  //   {art, cache, ctx, w, h, snapshot (the init state, deep copied, read once), pacing: wait|active, cue(kind, id, opts),
  //    layout: {partySide: right|left}, entries, bgd, wov, ui: {window, font, cursor} (uik_ records), seed, speed,
  //    names: {abl id: name}, icons: {sta id: ico id}}
  // Returns {feed(events, state), update(dtMs), draw(), isIdle(), backlog(), targets(), display(), setPacing(mode),
  //   setSpeed(k), setCursor(uid or null), setMessage(text), stats(), beats()}.
  // The presenter's look is a pure function of the snapshot, the fed events and states, and the dt sequence: beat
  // timing never reaches the engine, so a replay renders identically.
  var BACKLOG_MS = 2000;
  var BASE_KEYS = { 'battle.idle': 1, 'battle.kneel': 1, 'battle.ready': 1, 'battle.victory': 1, 'enemy.idle': 1 };
  var BEAT_MS = { ready: 160, command: 120, status: 300, limitReady: 500, revive: 760, message: 700, result: 420, end: 1400 };
  function createPresenter(cfg) {
    cfg = cfg || {};
    var art = cfg.art || { records: {} }, cache = cfg.cache, ctx = cfg.ctx, W = cfg.w || 256, H = cfg.h || 224, ent = cfg.entries || (cache && cache.entries) || [];
    var u = Math.max(1, Math.round((cache && cache.size || 16) / 16)), cue = typeof cfg.cue === 'function' ? cfg.cue : function () {};
    var uiRec = cfg.ui || {}, font = fontOf(uiRec.font || null), side = (cfg.layout && cfg.layout.partySide) === 'left' ? 'left' : 'right';
    var snap = JSON.parse(JSON.stringify(cfg.snapshot || { units: [] })), db = snap.db || {};
    var pacing = cfg.pacing === 'active' ? 'active' : 'wait', speedK = Math.max(0.25, Number(cfg.speed) || 1), seed = (cfg.seed >>> 0) || 1;
    var fieldH = Math.round(H * 0.64), hudY = fieldH, now = 0, queue = [], popups = [], cursor = null, message = null, banner = null, ended = null;
    var weather = cfg.wov ? weatherCreate(cfg.wov, W, fieldH, seed, { entries: ent, unit: u }) : null, pb = null, pbBeat = null, flashScreen = 0;
    var stats = { beats: 0, events: 0, hits: 0, popups: 0, compressed: 0, cues: 0 };
    var A = {}, order = [];

    // ---- sprites and animations from the art namespace
    function findSpr(kind, ref) {
      var all = recs(art, 'spr_'), ks = Object.keys(all);
      for (var i = 0; i < ks.length; i++) { var s = all[ks[i]]; if (s && s.subject && s.subject.kind === kind && s.subject.ref === ref && s.mode === 'battle') return s; }
      return null;
    }
    function bySubject(p, kind, ref) {
      var all = recs(art, p), ks = Object.keys(all);
      for (var i = 0; i < ks.length; i++) { var r = all[ks[i]]; if (r && r.subject && r.subject.kind === kind && r.subject.ref === ref) return r; }
      return null;
    }
    function animKey(a, key) { return a.spr ? animFor(art, a.spr, key) : bySubject('anm_', 'role', 'anim:' + key); }
    function frameOf(a, pose) { return a.spr && cache ? cache.sprite(a.spr.id, pose || 'idle', a.dir) : null; }

    // ---- actors from the snapshot
    (snap.units || []).forEach(function (un) {
      var party = un.side === 'party', spr = party ? findSpr('chr', un.ref) : findSpr('fam', un.fam) || findSpr('fam', un.ref);
      var a = { uid: un.uid, side: party ? 'party' : 'foe', name: String(un.name || un.uid), spr: spr, dir: party ? (side === 'right' ? 'left' : 'right') : (side === 'right' ? 'right' : 'left'),
        row: un.row === 'back' ? 'back' : 'front', boss: !!un.isBoss, hp: Number(un.hp) || 0, maxHp: Math.max(1, Number(un.maxHp) || 1), mp: Number(un.mp) || 0, maxMp: Math.max(0, Number(un.maxMp) || 0),
        shownHp: Number(un.hp) || 0, roll: null, ko: !!un.ko, gone: false, gauge: 0, ready: false, statuses: (un.statuses || []).map(function (s) { return s.sta; }),
        anim: null, animT: 0, off: [0, 0], flash: 0, glow: 0, highlight: 0, death: null, tint: un.palette || null };
      a.base = a.ko ? (party ? 'battle.ko' : null) : party ? 'battle.idle' : 'enemy.idle';
      if (a.ko && !party) a.gone = true;
      A[a.uid] = a; order.push(a.uid);
    });
    function gaugeOf(un) { var gm = Number(snap.gaugeMax) || 65536; return clamp((Number(un.gauge) || 0) / gm, 0, 1); }
    (snap.units || []).forEach(function (un) { if (A[un.uid]) A[un.uid].gauge = gaugeOf(un); });

    // ---- layout: party stacked with a stagger on its side, foes packed in columns by sprite height
    var pos = {};
    function size(a) { var f = frameOf(a, a.side === 'party' ? 'idle' : 'idle'); return f ? { w: f.w, h: f.h, ax: f.ax, ay: f.ay } : { w: 16 * u, h: 24 * u, ax: 8 * u, ay: 23 * u }; }
    function layout() {
      var party = order.filter(function (k) { return A[k].side === 'party'; }), foes = order.filter(function (k) { return A[k].side === 'foe'; });
      var top = 10 * u, bottom = fieldH - 4 * u, avail = bottom - top, right = side === 'right';
      // The party stands on the ground band (below the backdrop's horizon at 56 percent), not up in the sky.
      var pTop = Math.round(fieldH * 0.36), pAvail = bottom - pTop;
      var ph = party.map(function (k) { return size(A[k]).h; }), sumP = ph.reduce(function (s, v) { return s + v; }, 0);
      var gapP = party.length ? Math.max(0, (pAvail - sumP) / (party.length + 1)) : 0, yP = pTop + gapP;
      party.forEach(function (k, i) {
        var a = A[k], sz = size(a), stagger = Math.round(i * 4 * u), back = a.row === 'back' ? 10 * u : 0;
        var x = right ? Math.round(W * 0.8) + stagger + back : Math.round(W * 0.2) - stagger - back;
        var feet = Math.round(yP + sz.h);
        if (sumP > pAvail) feet = Math.round(pTop + pAvail * (i + 1) / party.length);
        pos[k] = { x: x, y: Math.min(bottom, feet) };
        yP += sz.h + gapP;
      });
      function pack(list, x0, dirSign) {
        var cols = [[]], colH = [0], colW = [0];
        list.forEach(function (k) {
          var sz = size(A[k]), c = cols.length - 1;
          if (colH[c] + sz.h > avail && cols[c].length) { cols.push([]); colH.push(0); colW.push(0); c++; }
          cols[c].push(k); colH[c] += sz.h; colW[c] = Math.max(colW[c], sz.w);
        });
        var x = x0;
        cols.forEach(function (col, ci) {
          var gap = Math.max(0, (avail - colH[ci]) / (col.length + 1)), y = top + gap;
          col.forEach(function (k) { var sz = size(A[k]); pos[k] = { x: Math.round(x), y: Math.round(Math.min(bottom, y + sz.h)) }; y += sz.h + gap; });
          x += dirSign * (colW[ci] + 4 * u);
        });
      }
      var front = foes.filter(function (k) { return A[k].row !== 'back'; }), back = foes.filter(function (k) { return A[k].row === 'back'; });
      if (right) { pack(front, Math.round(W * 0.38), -1); pack(back, Math.round(W * 0.16), -1); }
      else { pack(front, Math.round(W * 0.62), 1); pack(back, Math.round(W * 0.84), 1); }
    }
    layout();
    function rectOf(k) {
      var a = A[k], p = pos[k], sz = size(a);
      return p ? { x: p.x - sz.ax + a.off[0], y: p.y - sz.ay + a.off[1], w: sz.w, h: sz.h } : null;
    }
    function center(k) { var r = rectOf(k); return r ? { x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h * 0.55) } : { x: W / 2, y: fieldH / 2 }; }
    function front(k) { var r = rectOf(k), a = A[k]; if (!r) return center(k); var lft = a.dir === 'left'; return { x: lft ? r.x : r.x + r.w, y: Math.round(r.y + r.h * 0.45) }; }

    // ---- actor animation helpers
    function play(a, key) { var an = animKey(a, key); a.anim = an; a.animT = 0; a.animKey = key; return an; }
    function baseKey(a) {
      if (a.side === 'foe') return a.ko ? null : 'enemy.idle';
      if (a.ko) return 'battle.ko';
      if (ended === 'win') return 'battle.victory';
      if (a.ready) return 'battle.ready';
      return a.shownHp <= a.maxHp / 4 ? 'battle.kneel' : 'battle.idle';
    }
    function settle(a) { var k = baseKey(a); if (a.animKey !== k || !a.anim) { if (k) play(a, k); else { a.anim = null; a.animKey = null; } } }
    function popup(uid, text, color, extra) {
      var a = A[uid]; if (!a) return;
      var c = center(uid), r = rectOf(uid);
      popups.push({ uid: uid, x: c.x, y: r ? r.y + Math.round(r.h * 0.3) : c.y, text: String(text), color: color, age: 0, dy: (extra && extra.dy) || 0 });
      stats.popups++;
    }
    function setHp(a, v) { v = clamp(Number(v) || 0, 0, a.maxHp); a.roll = { from: a.shownHp, to: v, t: 0 }; a.hp = v; }
    function emit(kind, id, opts) { stats.cues++; try { cue(kind, id, opts || {}); } catch (e) { /* a cue never stops the show */ } }

    // ---- results (damage, heal, miss, status, ko, revive) applied when their hit lands
    function applyResult(e) {
      var t = A[e.target];
      stats.hits++;
      if (!t) return;
      if (e.type === 'damage') {
        setHp(t, t.hp - (Number(e.value) || 0));
        popup(t.uid, String(e.value), e.crit ? '#f8e060' : '#ffffff');
        if (!t.ko) { play(t, t.side === 'party' ? 'battle.hurt' : 'enemy.hurt'); t.flash = 90; }
        emit('sfx', e.crit ? 'crit' : 'hit', { element: e.element || null, target: t.uid });
      } else if (e.type === 'heal') {
        setHp(t, t.hp + (Number(e.value) || 0));
        popup(t.uid, String(e.value), '#70f090');
        t.glow = 300;
        emit('sfx', 'heal', { target: t.uid });
      } else if (e.type === 'miss') {
        popup(t.uid, 'Miss', '#c0c0c8');
        emit('sfx', 'miss', { target: t.uid });
      } else if (e.type === 'status') {
        var v = String(e.value || ''), off = v.charAt(0) === '-', sid = off ? v.slice(1) : v, nm = (db.sta && db.sta[sid] && db.sta[sid].name) || (cfg.names && cfg.names[sid]) || sid;
        if (off) t.statuses = t.statuses.filter(function (s) { return s !== sid; }); else if (t.statuses.indexOf(sid) < 0) t.statuses.push(sid);
        popup(t.uid, off ? (e.name || 'cured') : nm, off ? '#a0c0f0' : '#e0a0f0', { dy: -4 * u });
        emit('sfx', off ? 'status.off' : 'status', { status: sid, target: t.uid });
      } else if (e.type === 'revive') {
        t.ko = false; t.gone = false; t.death = null;
        if (e.value != null && Number(e.value) > 0) setHp(t, Number(e.value));
        play(t, t.side === 'party' ? 'battle.revive' : 'enemy.idle');
        emit('sfx', 'revive', { target: t.uid });
      }
    }
    function applyKo(e) {
      var t = A[e.target];
      if (!t) return 0;
      t.ko = true; t.ready = false;
      setHp(t, 0);
      emit('sfx', t.side === 'party' ? 'ko' : 'death', { target: t.uid });
      if (t.side === 'party') { play(t, 'battle.ko'); return 640; }
      var an = animKey(t, 'enemy.death'), ms = an ? duration(an) : 700;
      t.death = { anm: an || { kind: 'death', method: 'scatter', ms: 700 }, t: 0, ms: ms };
      t.anim = null; t.animKey = null;
      return ms;
    }

    // ---- beats
    function abilityRecord(e) {
      var id = e.abl, an = id ? bySubject('anm_', 'abl', id) : null, info = id && db.abl ? db.abl[id] : null;
      var isItem = e.type === 'item' || (typeof id === 'string' && id.slice(0, 4) === 'itm_');
      if (!an) {
        var def = isItem ? 'item' : info && (info.kind === 'magic' || info.kind === 'heal' || info.kind === 'status' || info.kind === 'summon') ? 'cast' : 'attack';
        an = bySubject('anm_', 'role', 'ability:' + def) || { kind: 'ability', caster: def, travel: { type: def === 'cast' ? 'projectile' : def === 'item' ? 'rise' : 'none', ms: 260 }, impact: { fx: null, ms: 400 }, hits: 1, markers: [] };
      }
      return { anm: an, item: isItem, info: info };
    }
    function actionBeat(e) {
      return { kind: 'action', ev: e, results: [], kos: [], after: [], dur: 0, t: 0 };
    }
    function startAction(b) {
      var e = b.ev, a = A[e.actor], look = abilityRecord(e), anm = look.anm;
      var targets = (e.targets && e.targets.length ? e.targets : b.results.map(function (r) { return r.target; })).filter(function (k) { return A[k]; });
      var tgt = targets.length ? targets : a ? [a.uid] : [];
      var to = tgt.length ? tgt.map(center).reduce(function (s, c) { return { x: s.x + c.x / tgt.length, y: s.y + c.y / tgt.length }; }, { x: 0, y: 0 }) : { x: W / 2, y: fieldH / 2 };
      var casterKey = !a ? null : a.side === 'party' ? 'battle.' + (look.item ? 'item' : EA_CASTER(anm.caster)) : 'enemy.attack';
      var casterAnm = a && casterKey ? animKey(a, casterKey) : null;
      var fx = anm && anm.impact && anm.impact.fx ? rec(art, anm.impact.fx) : null;
      if (!fx && e.element) fx = bySubject('efx_', 'element', e.element);
      pb = abilityCreate({ anm: anm, caster: casterAnm, from: a ? front(a.uid) : to, to: { x: Math.round(to.x), y: Math.round(to.y) }, efx: fx, entries: ent, unit: u, seed: (seed + stats.beats * 31) >>> 0 });
      pbBeat = b;
      if (a && casterKey) { play(a, casterKey); a.ready = false; }
      b.caster = a; b.tl = pb.timeline;
      // Results land on hit markers: the n-th result for a target takes the n-th hit, and every hit past the last
      // marker stacks on it. A single hit area attack hits every target on the first marker.
      var per = {}, nh = pb.timeline.hits.length;
      b.slots = b.results.map(function (r) { var k = r.target || '_', j = per[k] || 0; per[k] = j + 1; return Math.min(j, nh - 1); });
      b.landed = b.results.map(function () { return false; });
      b.dur = pb.timeline.duration + 160;
      var nm = e.name || (look.info && look.info.name) || '';
      if (nm && e.abl !== '_attack') banner = { text: nm, t: 0, ms: b.dur };
      emit('sfx', look.item ? 'item' : 'action', { abl: e.abl || null, element: e.element || null, actor: e.actor });
    }
    function EA_CASTER(c) { return c === 'cast' || c === 'item' || c === 'limit' ? c : 'attack'; }
    function landHit(b, i) {
      b.results.forEach(function (r, k) { if (!b.landed[k] && b.slots[k] === i) { b.landed[k] = true; applyResult(r); } });
    }
    function finishAction(b) {
      b.results.forEach(function (r, k) { if (!b.landed[k]) { b.landed[k] = true; applyResult(r); } });
      if (b.caster) { b.caster.off = [0, 0]; settle(b.caster); }
      pb = null; pbBeat = null; banner = null;
    }
    function beatFor(kind, e, dur) { return { kind: kind, ev: e, dur: dur, t: 0 }; }
    function start(b) {
      b.started = true; stats.beats++;
      var e = b.ev || {}, a = A[e.actor];
      if (b.kind === 'action') startAction(b);
      else if (b.kind === 'ready') { if (a) { a.ready = true; a.highlight = b.dur; settle(a); } emit('ui', 'ready', { actor: e.actor }); }
      else if (b.kind === 'command') { if (a) a.highlight = b.dur; emit('ui', 'confirm', { actor: e.actor }); if (e.value === 'flee') banner = { text: e.name || 'Flee', t: 0, ms: 600 }; }
      else if (b.kind === 'result') applyResult(e);
      else if (b.kind === 'ko') { var ms = 0; b.list.forEach(function (x) { ms = Math.max(ms, applyKo(x)); }); b.dur = Math.max(b.dur, ms + 80); }
      else if (b.kind === 'revive') applyResult(e);
      else if (b.kind === 'limitReady') { var t = A[e.target]; if (t) { t.glow = 500; popup(t.uid, 'LIMIT', '#f8d040', { dy: -8 * u }); } emit('sfx', 'limit', { target: e.target }); }
      else if (b.kind === 'message') { message = { text: b.text, t: 0, ms: b.dur }; emit('ui', b.sound || 'error', {}); }
      else if (b.kind === 'end') {
        ended = e.value || 'end';
        order.forEach(function (k) { var x = A[k]; x.ready = false; if (x.side === 'party' && !x.ko) settle(x); });
        if (ended === 'flee') order.forEach(function (k) { var x = A[k]; if (x.side === 'party' && !x.ko) x.flee = true; });
        message = { text: { win: 'Victory', lose: 'Defeat', flee: 'Escaped', timeout: 'Time out' }[ended] || String(ended), t: 0, ms: 1e9 };
        emit('music', ended === 'win' ? 'victory' : ended === 'lose' ? 'defeat' : 'stop', { outcome: ended });
      }
    }
    function finish(b) {
      if (b.kind === 'action') finishAction(b);
      if (b.kind === 'message') message = null;
      if (b.apply) applyState(b.apply, false);
    }
    // States carry what events do not: ATB gauges, MP, and readiness (contract gaps 1 and 2). A state rides on the last
    // beat of its feed and applies when that beat finishes, so the HUD never runs ahead of the show.
    function applyState(st, early) {
      if (!st || !st.units) return;
      st.units.forEach(function (un) {
        var a = A[un.uid]; if (!a) return;
        a.gauge = gaugeOf(un);
        if (!early) { a.mp = Number(un.mp) || 0; a.maxMp = Math.max(0, Number(un.maxMp) || a.maxMp); }
      });
    }

    // feed(events, state): converts one advance call's events to beats.
    var open = null;
    function close() { if (open) { queue.push(open); open.after.forEach(function (x) { queue.push(x); }); if (open.kos.length) queue.push({ kind: 'ko', list: open.kos, dur: 120, t: 0 }); open = null; } }
    function feed(events, state) {
      var before = queue.length;
      (events || []).forEach(function (e) {
        if (!e || !e.type) return;
        stats.events++;
        var tp = e.type;
        if (tp === 'tick') return;
        var resultish = tp === 'damage' || tp === 'heal' || tp === 'status' || tp === 'revive' || (tp === 'miss' && e.target && (e.value == null || (e.value !== 'mp' && e.value !== 'flee' && e.value !== 'rejected')));
        if (open && resultish) { open.results.push(e); return; }
        if (open && tp === 'ko') { open.kos.push(e); return; }
        if (open && tp === 'limitReady') { open.after.push(beatFor('limitReady', e, BEAT_MS.limitReady)); return; }
        close();
        if (tp === 'action' || tp === 'item') { open = actionBeat(e); return; }
        if (tp === 'ready') queue.push(beatFor('ready', e, BEAT_MS.ready));
        else if (tp === 'command') queue.push(beatFor('command', e, BEAT_MS.command));
        else if (tp === 'damage' || tp === 'heal' || tp === 'miss' && e.target && resultish) queue.push(beatFor('result', e, BEAT_MS.result));
        else if (tp === 'status') queue.push(beatFor('result', e, BEAT_MS.status));
        else if (tp === 'revive') queue.push(beatFor('revive', e, BEAT_MS.revive));
        else if (tp === 'ko') { var last = queue[queue.length - 1]; if (last && last.kind === 'ko' && !last.started) last.list.push(e); else queue.push({ kind: 'ko', list: [e], dur: 120, t: 0 }); }
        else if (tp === 'limitReady') queue.push(beatFor('limitReady', e, BEAT_MS.limitReady));
        else if (tp === 'miss') { if (e.value === 'rejected') return; var mb = beatFor('message', e, BEAT_MS.message); mb.text = e.value === 'mp' ? 'Not enough MP' : e.name || 'Cannot escape'; queue.push(mb); }
        else if (tp === 'end') queue.push(beatFor('end', e, BEAT_MS.end));
      });
      close();
      if (state) {
        if (queue.length > before) queue[queue.length - 1].apply = state;
        else if (!queue.length) applyState(state, false);
        else queue[queue.length - 1].apply = state;
      }
      return queue.length - before;
    }
    // Unstarted action and KO beats learn their length when they start; until then they count at an estimate.
    function estimate(b) {
      if (b.started) return b.dur;
      if (b.kind === 'action') {
        var a = A[b.ev.actor], look = abilityRecord(b.ev), ck = !a ? null : a.side === 'party' ? 'battle.' + (look.item ? 'item' : EA_CASTER(look.anm.caster)) : 'enemy.attack';
        return abilityTimeline(look.anm, a && ck ? animKey(a, ck) : null).duration + 160;
      }
      if (b.kind === 'ko') return 760;
      return b.dur || 0;
    }
    function backlog() { return queue.reduce(function (s, b) { return s + Math.max(0, estimate(b) - (b.t || 0)); }, 0); }
    function rate() {
      var k = speedK;
      if (pacing === 'active') { var bl = backlog(); if (bl > BACKLOG_MS) { k *= bl / BACKLOG_MS; stats.compressed++; } }
      return k;
    }
    function update(dt) {
      dt = Math.max(0, Math.min(100, Number(dt) || 0));
      var k = rate(), vt = dt * k, budget = vt;
      now += vt;
      while (budget > 0 && queue.length) {
        var b = queue[0];
        if (!b.started) start(b);
        var step = Math.min(budget, Math.max(0, b.dur - b.t));
        if (b.kind === 'action' && pb) {
          pb.step(step).forEach(function (m) {
            if (m.type === 'hit') landHit(b, m.arg | 0);
            else if (m.type === 'sfx') emit('sfx', m.arg, { marker: true });
            else if (m.type === 'flash') flashScreen = 1;
          });
          var ca = pb.casterAt(), cst = b.caster;
          if (cst) { cst.animT = ca.t; cst.off = [ca.off[0] * (cst.dir === 'left' ? -1 : 1), 0]; }
        }
        b.t += step; budget -= step;
        if (b.t >= b.dur) { finish(b); queue.shift(); }
        else break;
        if (b.dur === 0 && !queue.length) break;
      }
      order.forEach(function (key) {
        var a = A[key], busy = pbBeat && pbBeat.caster === a;
        if (!busy) a.animT += vt;
        if (a.death) { a.death.t += vt; if (a.death.t >= a.death.ms) { a.gone = true; } }
        if (a.roll) { a.roll.t += vt; var p = Math.min(1, a.roll.t / 400); a.shownHp = Math.round(a.roll.from + (a.roll.to - a.roll.from) * p); if (p >= 1) { a.roll = null; a.shownHp = a.hp; } }
        // Back to the resting pose once a one shot ends, or when the resting pose itself changes (low HP, ready, victory).
        if (!busy && !a.death) {
          var oneShotDone = a.anim && !a.anim.loop && a.animKey !== 'battle.ko' && duration(a.anim) <= a.animT;
          if (!a.anim || oneShotDone || BASE_KEYS[a.animKey]) settle(a);
        }
        a.flash = Math.max(0, a.flash - vt); a.glow = Math.max(0, a.glow - vt); a.highlight = Math.max(0, a.highlight - vt);
        if (a.flee) a.off = [Math.min(W, a.off[0] + vt * 0.18 * (a.dir === 'left' ? -1 : 1) * -1), 0];
      });
      popups.forEach(function (p) { p.age += vt; });
      popups = popups.filter(function (p) { return p.age < POPUP_MS; });
      if (banner) { banner.t += vt; }
      if (message) message.t += vt;
      flashScreen = Math.max(0, flashScreen - vt / 160);
      if (weather) weatherStep(weather, vt);
      return k;
    }
    function isIdle() { return !queue.length; }

    // ---- drawing
    function hudColors() { return { back: '#101018', fill: '#e8c040', light: '#fff0a0' }; }
    function drawActor(k, shake) {
      var a = A[k], p = pos[k];
      if (!p || a.gone) return;
      var x = p.x + a.off[0] + shake[0], y = p.y + a.off[1] + shake[1];
      if (!a.spr || !cache) {
        ctx.fillStyle = a.side === 'party' ? '#c0a040' : '#a04040';
        if (!a.ko || a.side === 'party') ctx.fillRect(Math.round(x - 6 * u), Math.round(y - 20 * u), 12 * u, 20 * u);
        return;
      }
      if (a.death) { drawSprite(ctx, cache, a.spr.id, a.death.anm, a.death.t, x, y, { dir: a.dir, pose: 'idle', seed: hash32(a.uid) }); return; }
      var fl = a.flash > 0 && Math.floor(a.flash / 45) % 2 === 0;
      drawSprite(ctx, cache, a.spr.id, a.anim, a.animT, x, y, { dir: a.dir, pose: 'idle', flash: fl });
      if (a.statuses.length && cfg.icons) {
        var sid = a.statuses[Math.floor(now / 900) % a.statuses.length], ico = cfg.icons[sid], r = rectOf(k);
        var f = ico ? cache.icon(ico) : null;
        if (f && r) { blitFrame(ctx, f, Math.round(r.x + r.w / 2 - f.w / 2 + shake[0]), Math.round(r.y - f.h - 1 + shake[1])); }
      }
    }
    function draw(target) {
      var g = target || ctx;
      if (!g) return;
      var prev = ctx; ctx = g;
      var sc = pb ? pb.screen() : { shake: [0, 0], darken: 0, wave: 0, flash: 0 };
      if (cfg.bgd) bgDraw(ctx, cfg.bgd, now, W, fieldH, { entries: ent });
      else { ctx.fillStyle = '#203048'; ctx.fillRect(0, 0, W, fieldH); ctx.fillStyle = '#304830'; ctx.fillRect(0, Math.round(fieldH * 0.56), W, fieldH - Math.round(fieldH * 0.56)); }
      var foes = order.filter(function (k) { return A[k].side === 'foe'; }).sort(function (a, b) { return (pos[a] || {}).y - (pos[b] || {}).y; });
      var party = order.filter(function (k) { return A[k].side === 'party'; }).sort(function (a, b) { return (pos[a] || {}).y - (pos[b] || {}).y; });
      foes.forEach(function (k) { drawActor(k, sc.shake); });
      party.forEach(function (k) { drawActor(k, sc.shake); });
      order.forEach(function (k) {
        var a = A[k], r = rectOf(k);
        if (!r || a.gone) return;
        if (a.glow > 0) { ctx.globalAlpha = 0.35 * (a.glow / 500); ctx.fillStyle = '#ffffff'; ctx.fillRect(r.x - u, r.y - u, r.w + 2 * u, r.h + 2 * u); ctx.globalAlpha = 1; }
        if (a.highlight > 0 && a.side === 'party') { ctx.fillStyle = '#f8f0a0'; ctx.fillRect(Math.round(r.x + r.w / 2 - u), Math.round(r.y - 3 * u), 2 * u, 2 * u); }
      });
      if (pb) pb.draw(ctx);
      if (sc.wave && ctx.canvas) applyWave(ctx, sc.wave, now, W, fieldH);
      if (weather) weatherDraw(ctx, weather);
      if (sc.darken > 0) { ctx.globalAlpha = sc.darken; ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, W, fieldH); ctx.globalAlpha = 1; }
      var fl = Math.max(sc.flash || 0, flashScreen * 0.6);
      if (fl > 0) { ctx.globalAlpha = fl; ctx.fillStyle = sc.flashColor || '#ffffff'; ctx.fillRect(0, 0, W, fieldH); ctx.globalAlpha = 1; }
      // popups over everything on the field
      popups.forEach(function (p) {
        var fade = p.age > POPUP_MS - 150 ? clamp((POPUP_MS - p.age) / 150, 0, 1) : 1;
        ctx.globalAlpha = fade;
        drawText(ctx, font, p.text, p.x, p.y + p.dy + popupOffset(p.age, u), { color: p.color, shadow: '#000000', scale: u, align: 'center' });
        ctx.globalAlpha = 1;
      });
      if (cursor && pos[cursor] && !A[cursor].gone) { var cr = rectOf(cursor); if (cr) drawCursor(ctx, uiRec.cursor, A[cursor].side === 'party' && side === 'right' ? cr.x : cr.x, cr.y + Math.round(cr.h / 2), now, { entries: ent, unit: u }); }
      // banner (the ability name) and messages at the top
      var lh = font.line * u, pad = 4 * u;
      if (banner && banner.text) {
        var bw = Math.min(W - 8 * u, measure(font, banner.text, u) + 2 * pad + 4 * u), bx = Math.round((W - bw) / 2);
        drawWindow(ctx, uiRec.window, bx, 2 * u, bw, lh + 2 * pad, { entries: ent, unit: u, open: Math.min(1, banner.t / 80) });
        drawText(ctx, font, banner.text, W / 2, 2 * u + pad + u, { color: '#ffffff', shadow: '#000000', scale: u, align: 'center' });
      }
      if (message && message.text) {
        var mw = Math.min(W - 8 * u, measure(font, message.text, u) + 2 * pad + 8 * u), mx = Math.round((W - mw) / 2), my = Math.round(fieldH * 0.36);
        drawWindow(ctx, uiRec.window, mx, my, mw, lh + 2 * pad, { entries: ent, unit: u, open: Math.min(1, message.t / 100) });
        drawText(ctx, font, message.text, W / 2, my + pad + u, { color: '#ffffff', shadow: '#000000', scale: u, align: 'center' });
      }
      drawHud();
      ctx = prev;
    }
    function drawHud() {
      var lh = font.line * u, pad = 4 * u, hh = H - hudY, foeW = Math.round(W * 0.36);
      var foes = order.filter(function (k) { return A[k].side === 'foe'; }), party = order.filter(function (k) { return A[k].side === 'party'; });
      var left = side === 'right' ? 0 : W - foeW, right = side === 'right' ? foeW : 0;
      drawWindow(ctx, uiRec.window, left, hudY, foeW, hh, { entries: ent, unit: u });
      drawWindow(ctx, uiRec.window, right, hudY, W - foeW, hh, { entries: ent, unit: u });
      var rows = Math.max(1, Math.floor((hh - 2 * pad) / lh)), seen = {}, names = [];
      foes.forEach(function (k) { var a = A[k]; if (a.gone || a.ko) return; var base = a.name.replace(/ [A-Z]$/, ''); if (seen[base]) seen[base].n++; else { seen[base] = { n: 1 }; names.push(base); } });
      names.slice(0, rows).forEach(function (nm, i) {
        var n = seen[nm].n, label = nm + (n > 1 ? ' x' + n : ''), maxW = foeW - 2 * pad - 2 * u;
        while (label.length > 3 && measure(font, label, u) > maxW) label = label.slice(0, -1);
        drawText(ctx, font, label, left + pad + u, hudY + pad + u + i * lh, { color: '#ffffff', shadow: '#000000', scale: u });
      });
      var pw = W - foeW - 2 * pad, gaugeW = Math.max(12 * u, Math.round(pw * 0.2)), nameW = Math.round(pw * 0.32);
      var digits = party.reduce(function (m, k) { return Math.max(m, String(A[k].maxHp).length); }, 1), hpW = measure(font, new Array(digits * 2 + 2).join('9'), u);
      var mpW = measure(font, '999', u), gaugeX = right + (W - foeW) - pad - gaugeW - u;
      party.slice(0, rows).forEach(function (k, i) {
        var a = A[k], y = hudY + pad + u + i * lh, x = right + pad + u, low = a.shownHp <= a.maxHp / 4;
        var col = a.ko ? '#d05050' : low ? '#f0c040' : '#ffffff', label = a.name;
        while (label.length > 3 && measure(font, label, u) > nameW - 2 * u) label = label.slice(0, -1);
        if (cursor === k) drawCursor(ctx, uiRec.cursor, x + 2 * u, y + Math.round(font.h * u / 2), now, { entries: ent, unit: u });
        drawText(ctx, font, label, x, y, { color: a.ready ? '#f8f0a0' : col, shadow: '#000000', scale: u });
        var hpRight = x + nameW + hpW, mpRight = hpRight + 3 * u + mpW;
        drawText(ctx, font, a.shownHp + '/' + a.maxHp, hpRight, y, { color: col, shadow: '#000000', scale: u, align: 'right' });
        if (a.maxMp && mpRight + 2 * u <= gaugeX) drawText(ctx, font, String(a.mp), mpRight, y, { color: '#a0c8f8', shadow: '#000000', scale: u, align: 'right' });
        drawGauge(ctx, gaugeX, y + u, gaugeW, Math.max(3, font.h * u - 2 * u), a.ko ? 0 : a.gauge, a.gauge >= 1 ? { back: '#101018', fill: '#f8f0a0', light: '#ffffff' } : hudColors());
      });
    }
    function targets() {
      var out = {};
      order.forEach(function (k) { var r = rectOf(k); if (r && !A[k].gone) out[k] = r; });
      return out;
    }
    function display() {
      var out = {};
      order.forEach(function (k) { var a = A[k]; out[k] = { name: a.name, side: a.side, hp: a.shownHp, hpTarget: a.hp, maxHp: a.maxHp, mp: a.mp, maxMp: a.maxMp, ko: a.ko, gone: a.gone, statuses: a.statuses.slice(), atb: a.gauge, ready: a.ready, anim: a.animKey || (a.death ? 'death' : null) }; });
      return out;
    }
    return {
      feed: feed, update: update, draw: draw, isIdle: isIdle, backlog: backlog, targets: targets, display: display,
      setPacing: function (m) { pacing = m === 'active' ? 'active' : 'wait'; return pacing; },
      setSpeed: function (k) { speedK = Math.max(0.25, Number(k) || 1); return speedK; },
      setCursor: function (uid) { cursor = uid && A[uid] ? uid : null; },
      setMessage: function (text) { message = text ? { text: String(text), t: 1000, ms: 1e9 } : null; },
      pacing: function () { return pacing; }, ended: function () { return ended; },
      stats: function () { return Object.assign({ queued: queue.length, backlog: backlog(), now: Math.round(now), popupsLive: popups.length }, stats); },
      beats: function () { return queue.map(function (b) { return { kind: b.kind, dur: b.dur, t: b.t, results: b.results ? b.results.length : 0 }; }); },
      layout: function () { var o = {}; Object.keys(pos).forEach(function (k) { o[k] = { x: pos[k].x, y: pos[k].y }; }); return o; },
      field: { w: W, h: H, fieldH: fieldH, unit: u }
    };
  }

  R.ui = {
    FONT: DEFAULT_FONT, CORNERS: WIN_CORNERS, OPEN_STYLES: OPEN_STYLES, CURSORS: Object.keys(CURSOR_SHAPES), CURSOR_SHAPES: CURSOR_SHAPES,
    SCHEMES: SCHEMES, TITLE_STYLES: TITLE_STYLES, TITLE_LAYOUTS: TITLE_LAYOUTS, POPUP_MS: POPUP_MS,
    font: fontOf, measure: measure, text: drawText, wrap: wrapText, window: drawWindow, cursor: drawCursor, gauge: drawGauge, color: colOf,
    touch: { layout: touchLayout, hit: touchHit, draw: drawTouch }, title: drawTitle
  };
  R.presenter = { BEAT_MS: BEAT_MS, BACKLOG_MS: BACKLOG_MS };
  R.createPresenter = createPresenter;

  // ---------------------------------------------------------------- later phases insert sections above this line
  Object.keys(R).forEach(function (k) { if (R[k] && typeof R[k] === 'object') Object.freeze(R[k]); });
  return Object.freeze(R);
})();
// === ENGINE:RENDER END ===
