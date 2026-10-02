// === WORLD:VIEWER BEGIN ===
(function () {
  'use strict';
  // The map viewer (Phase 7), shared by the World and Sites tabs. A map {w, h, ground, deco} is drawn the way the game
  // will draw it, through ENGINE_RENDER.tiles.drawMap at logical size and scaled by a whole number with smoothing off
  // (Day 147's preview pattern), or as one color per cell for the overlays and whenever a cell is smaller than a tile.
  // Every scale is an integer number of device pixels per cell: the ladder runs 1, 2, 3, 4, 6, 8, 12 up to the tile
  // size and then whole multiples of it, so tiles are only ever drawn at 1x, 2x, 3x of their logical pixels.
  // Pan by dragging, zoom by pinching, the wheel, the buttons, or the keyboard (arrows, plus, minus, 0 to fit, Enter to
  // pick the middle cell). A tap (a press that moved under 6 px) picks a cell. The camera lives in a state object the
  // caller keeps, so a rerender of the tab puts the map back where it was.
  var U = Kit.util, el = U.el, esc = U.esc, ER = ENGINE_RENDER, ET = ER.tiles;
  var tc = { art: null, T: 0, cache: null }, cellMemo = [];

  // Day 147's rules, read the same way: tile size from the Charter's specs (4 to 128, default 16) and the colors from
  // the master palette's entries.
  function tileSize(b) { var n = b && b.charter && b.charter.specs ? Math.round(Number(b.charter.specs.tileSize)) : NaN; return isFinite(n) ? Math.max(4, Math.min(128, n)) : 16; }
  function entries(b) { var m = WORLD.art.list(b, 'pal_').filter(function (r) { return r.kind === 'master'; })[0]; return m && Array.isArray(m.entries) ? m.entries : []; }
  function makeCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  // One bake cache per art and tile size, so moving between tabs reuses every baked tile.
  function cache(b) {
    var T = tileSize(b);
    if (tc.cache && tc.art === b.art && tc.T === T) return tc.cache;
    tc = { art: b.art, T: T, cache: ER.createCache(b.art, { size: T, entries: entries(b), budget: 48e6, makeCanvas: makeCanvas }) };
    return tc.cache;
  }
  function ladder(T) {
    var s = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64].filter(function (v) { return v < T; });
    [1, 2, 3, 4, 6, 8].forEach(function (k) { if (k * T <= 512) s.push(k * T); });
    return s;
  }
  function snap(steps, z) { var s = steps[0]; for (var i = 0; i < steps.length; i++) if (steps[i] <= z + 1e-9) s = steps[i]; return s; }
  function reduced() { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function raf(fn) { return typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame(fn) : setTimeout(fn, 16); }

  // A canvas with one pixel per cell, colors run length encoded per row so any CSS color works. Kept for the last few
  // keys, so switching tabs or toggling a marker never repaints it.
  function cellCanvas(key, w, h, colorAt) {
    for (var q = 0; q < cellMemo.length; q++) if (cellMemo[q].key === key) return cellMemo[q].cv;
    var cv = makeCanvas(w, h), ctx = cv.getContext && cv.getContext('2d');
    if (!ctx) return null;
    for (var y = 0; y < h; y++) {
      var run = 0, col = null;
      for (var x = 0; x <= w; x++) {
        var c = x < w ? colorAt(y * w + x) : null;
        if (c !== col) { if (col) { ctx.fillStyle = col; ctx.fillRect(x - run, y, run, 1); } col = c; run = 0; }
        run++;
      }
    }
    cellMemo.unshift({ key: key, cv: cv });
    if (cellMemo.length > 6) cellMemo.length = 6;
    return cv;
  }

  // viewer(o) -> {el, canvas, redraw, center(x, y, zoomTo), select(x, y), view()}.
  // o: {state {z, cx, cy, sel, key} kept by the caller, key (a new key refits), map {w, h, ground, deco}, b (bundle),
  //   tiles (draw tiles when a cell is at least a tile), cellsKey and cellColor(i) (the one color per cell layer),
  //   sprites [{spr, at, dir}] (drawn between the two tile layers), overlay(ctx, view) (markers in device pixels),
  //   onTap(x, y), label, busy (text over a dimmed map), bg, height (CSS class modifier), animate}.
  function viewer(o) {
    var st = o.state, map = o.map, W = map.w, H = map.h, b = o.b, T = tileSize(b), steps = ladder(T), last = null, alive = true;
    if (st.key !== o.key) { st.key = o.key; st.z = null; st.sel = null; st.cx = W / 2; st.cy = H / 2; }
    if (!isFinite(st.cx) || !isFinite(st.cy)) { st.cx = W / 2; st.cy = H / 2; }
    var wrap = el('div', 'w8-view' + (o.busy ? ' w8-dim' : '') + (o.size ? ' w8-view-' + o.size : '')), stage = el('div', 'w8-view-stage'), cv = el('canvas', 'w8-view-cv');
    cv.tabIndex = 0;
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', (o.label || 'Map') + '. Drag to pan, pinch or use plus and minus to zoom, tap or press Enter to pick a cell.');
    cv.dataset.w = String(W); cv.dataset.h = String(H); cv.dataset.drawn = '0';
    stage.appendChild(cv);
    if (o.busy) stage.appendChild(el('div', 'w8-view-busy', '<span class="w8-busy">' + esc(o.busy) + '</span>'));
    wrap.appendChild(stage);
    var bar = el('div', 'w8-view-bar'), read = el('span', 'w8-view-read');
    function zbtn(txt, aria, fn) { var x = el('button', 'btn w8-zoom', txt); x.type = 'button'; x.setAttribute('aria-label', aria); x.addEventListener('click', fn); return x; }
    bar.appendChild(zbtn('-', 'Zoom out', function () { step(-1); }));
    bar.appendChild(zbtn('+', 'Zoom in', function () { step(1); }));
    bar.appendChild(zbtn('Fit', 'Fit the whole map', function () { fit(); draw(); }));
    bar.appendChild(read);
    bar.appendChild(el('span', 'w8-view-hint', 'Drag to pan, pinch or scroll to zoom, tap a cell to pick it.'));
    wrap.appendChild(bar);

    function dpr() { return Math.max(1, Math.min(3, window.devicePixelRatio || 1)); }
    function size() {
      var cw = stage.clientWidth || 320, ch = stage.clientHeight || 320, d = dpr(), wd = Math.max(1, Math.round(cw * d)), hd = Math.max(1, Math.round(ch * d));
      if (cv.width !== wd) cv.width = wd;
      if (cv.height !== hd) cv.height = hd;
      return { wd: wd, hd: hd, d: d };
    }
    function fit() {
      var sz = size(), want = Math.min(sz.wd / W, sz.hd / H);
      st.z = snap(steps, want); st.cx = W / 2; st.cy = H / 2;
    }
    // The first fit waits until the stage is on the page, so it measures the real size rather than the fallback.
    function scale() {
      if (st.z == null) { if (!cv.isConnected) { var sz = size(); return snap(steps, Math.min(sz.wd / W, sz.hd / H)); } fit(); }
      return snap(steps, st.z);
    }
    function clampCam() { st.cx = Math.max(0, Math.min(W, st.cx)); st.cy = Math.max(0, Math.min(H, st.cy)); }

    function draw() {
      if (!alive) return null;
      var ctx = cv.getContext && cv.getContext('2d'), sz = size(), s = scale();
      clampCam();
      var ox = Math.round(sz.wd / 2 - st.cx * s), oy = Math.round(sz.hd / 2 - st.cy * s), tiles = !!o.tiles && s >= T;
      cv.dataset.scale = String(s); cv.dataset.mode = tiles ? 'tiles' : 'cells';
      read.textContent = tiles ? 'Tiles at ' + (s / T) + 'x' : (Math.round(s / sz.d * 10) / 10) + ' px a cell' + (o.tiles ? ', zoom in for tiles' : '');
      if (!ctx) { cv.dataset.drawn = '0'; last = { s: s, ox: ox, oy: oy, d: sz.d, wd: sz.wd, hd: sz.hd, tiles: tiles }; return last; }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = o.bg || '#0c1424';
      ctx.fillRect(0, 0, sz.wd, sz.hd);
      var t = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      if (tiles) {
        var k = s / T, c = cache(b);
        ox = Math.round(ox / k) * k; oy = Math.round(oy / k) * k;
        ctx.setTransform(k, 0, 0, k, 0, 0);
        ctx.imageSmoothingEnabled = false;
        var cam = { x: -ox / k, y: -oy / k, w: Math.ceil(sz.wd / k), h: Math.ceil(sz.hd / k) };
        try {
          ET.drawMap(ctx, c, map, cam, t);
          (o.sprites || []).forEach(function (p) {
            var px = (p.at % W) * T + T / 2 - cam.x, py = Math.floor(p.at / W) * T + T - cam.y, ok = null;
            if (p.spr) { try { ok = ER.draw.sprite(ctx, c, p.spr, null, t, px, py, { dir: p.dir || 'down', pose: 'stand' }); } catch (e) { ok = null; } }
            p.drawn = !!ok;
          });
          ET.drawMap(ctx, c, map, cam, t, { layer: 'above' });
        } catch (e) { tiles = false; cv.dataset.mode = 'cells'; cv.dataset.error = e.message; }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      if (!tiles) {
        var cc = o.cellColor ? cellCanvas(o.cellsKey || 'x', W, H, o.cellColor) : null;
        if (cc) ctx.drawImage(cc, ox, oy, W * s, H * s);
      }
      last = { s: s, ox: ox, oy: oy, d: sz.d, wd: sz.wd, hd: sz.hd, tiles: tiles, ctx: ctx,
        at: function (x, y) { return [ox + x * s, oy + y * s]; } };
      if (o.overlay) { try { o.overlay(ctx, last); } catch (e) { cv.dataset.error = e.message; } }
      if (st.sel) {
        var sx = ox + st.sel[0] * s, sy = oy + st.sel[1] * s, lw = Math.max(1, Math.round(sz.d)), pad = s < 6 ? 2 * lw : 0;
        ctx.lineWidth = lw * 2; ctx.strokeStyle = '#000000'; ctx.strokeRect(sx - pad - lw, sy - pad - lw, s + 2 * pad + 2 * lw, s + 2 * pad + 2 * lw);
        ctx.lineWidth = lw; ctx.strokeStyle = '#ffffff'; ctx.strokeRect(sx - pad - lw / 2, sy - pad - lw / 2, s + 2 * pad + lw, s + 2 * pad + lw);
      }
      cv.dataset.drawn = '1';
      return last;
    }
    var queued = false;
    function soon() { if (queued) return; queued = true; raf(function () { queued = false; draw(); }); }

    function zoomAt(px, py, z) {
      var s0 = scale(), sz = size();
      var ax = st.cx + (px - sz.wd / 2) / s0, ay = st.cy + (py - sz.hd / 2) / s0;
      st.z = Math.max(steps[0], Math.min(steps[steps.length - 1], z));
      var s1 = snap(steps, st.z);
      st.cx = ax - (px - sz.wd / 2) / s1; st.cy = ay - (py - sz.hd / 2) / s1;
      soon();
    }
    function step(dir, px, py) {
      var sz = size(), s = scale(), i = steps.indexOf(s), j = Math.max(0, Math.min(steps.length - 1, i + dir));
      zoomAt(px == null ? sz.wd / 2 : px, py == null ? sz.hd / 2 : py, steps[j]);
    }
    function devXY(e) { var r = cv.getBoundingClientRect(), d = dpr(); return [(e.clientX - r.left) * d, (e.clientY - r.top) * d]; }
    function pick(px, py) {
      var v = last || draw(); if (!v) return;
      var x = Math.floor((px - v.ox) / v.s), y = Math.floor((py - v.oy) / v.s);
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      st.sel = [x, y];
      draw();
      if (o.onTap) o.onTap(x, y);
    }

    // Pointers: one drags, two pinch (zoom about their midpoint and pan with it). A press that moved under 6 px picks.
    var ptrs = {}, n = 0, press = null, pinch = null;
    cv.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button > 0) return;
      try { cv.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY }; n++;
      if (n === 1) press = { x: e.clientX, y: e.clientY, moved: false };
      else { if (press) press.moved = true; pinch = null; }
    });
    cv.addEventListener('pointermove', function (e) {
      var p = ptrs[e.pointerId];
      if (!p) return;
      var d = dpr(), dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (n === 1) {
        p.x = e.clientX; p.y = e.clientY;
        if (press && (Math.abs(e.clientX - press.x) > 6 || Math.abs(e.clientY - press.y) > 6)) press.moved = true;
        if (press && press.moved) { var s = scale(); st.cx -= dx * d / s; st.cy -= dy * d / s; soon(); }
        return;
      }
      p.x = e.clientX; p.y = e.clientY;
      var ids = Object.keys(ptrs);
      if (ids.length < 2) return;
      var a = ptrs[ids[0]], c = ptrs[ids[1]], dist = Math.sqrt((a.x - c.x) * (a.x - c.x) + (a.y - c.y) * (a.y - c.y)), mx = (a.x + c.x) / 2, my = (a.y + c.y) / 2;
      if (pinch && pinch.dist > 0) {
        var r = cv.getBoundingClientRect(), s2 = scale();
        st.cx -= (mx - pinch.mx) * d / s2; st.cy -= (my - pinch.my) * d / s2;
        zoomAt((mx - r.left) * d, (my - r.top) * d, (st.z || s2) * dist / pinch.dist);
      }
      pinch = { dist: dist, mx: mx, my: my };
    });
    function up(e) {
      if (!ptrs[e.pointerId]) return;
      delete ptrs[e.pointerId]; n = Math.max(0, n - 1); pinch = null;
      if (n === 0) {
        var pr = press; press = null;
        if (pr && !pr.moved && e.type === 'pointerup') { var xy = devXY(e); pick(xy[0], xy[1]); }
        // A pinch leaves z between steps; settle it on the step it shows.
        if (st.z != null) st.z = snap(steps, st.z);
      }
    }
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var xy = devXY(e);
      step(e.deltaY < 0 ? 1 : -1, xy[0], xy[1]);
    }, { passive: false });
    cv.addEventListener('keydown', function (e) {
      var s = scale(), panBy = Math.max(1, Math.round(size().wd / s / 8)), k = e.key;
      if (k === 'ArrowLeft') st.cx -= panBy; else if (k === 'ArrowRight') st.cx += panBy;
      else if (k === 'ArrowUp') st.cy -= panBy; else if (k === 'ArrowDown') st.cy += panBy;
      else if (k === '+' || k === '=') { step(1); e.preventDefault(); return; }
      else if (k === '-' || k === '_') { step(-1); e.preventDefault(); return; }
      else if (k === '0') { fit(); draw(); e.preventDefault(); return; }
      else if (k === 'Enter' || k === ' ') { var sz = size(); pick(sz.wd / 2, sz.hd / 2); e.preventDefault(); return; }
      else return;
      e.preventDefault(); soon();
    });

    // Draw once attached and again on every resize; animated tiles step about seven times a second while visible. A
    // viewer that was attached and then left the page (a rerender) stops; one never attached gives up after a while.
    var seen = false, misses = 0;
    function connected() { if (cv.isConnected) { seen = true; misses = 0; return true; } if (seen || ++misses > 40) alive = false; return false; }
    if (typeof ResizeObserver === 'function') { var ro = new ResizeObserver(function () { if (!connected() && !alive) { ro.disconnect(); return; } soon(); }); ro.observe(stage); }
    soon();
    if (o.tiles && o.animate !== false && !reduced()) {
      (function loop() {
        setTimeout(function () {
          if (connected() && last && last.tiles && !document.hidden) draw();
          if (alive) loop();
        }, 140);
      })();
    }
    return {
      el: wrap, canvas: cv, redraw: draw, view: function () { return last; }, steps: steps, tile: T,
      // Centers the camera on a cell; zoomTo raises the zoom to at least that many device pixels a cell.
      center: function (x, y, zoomTo) { st.cx = x + 0.5; st.cy = y + 0.5; if (zoomTo && (st.z == null || snap(steps, st.z) < zoomTo)) st.z = snap(steps, zoomTo); soon(); },
      select: function (x, y) { st.sel = x == null ? null : [x, y]; soon(); },
      zoom: step, fit: function () { fit(); soon(); }, pick: pick
    };
  }

  WORLD.tiles = { size: tileSize, entries: entries, cache: cache, ladder: ladder, snap: snap };
  WORLD.viewer = viewer;
})();
// === WORLD:VIEWER END ===
