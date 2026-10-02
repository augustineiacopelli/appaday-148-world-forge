/* Art and Audio Forge ENGINE:AUDIO, engine version 1.0.0
 * Forge 147 (AppADay 147). Declares one global, ENGINE_AUDIO. No dependencies; reads no host global. */
// === ENGINE:AUDIO BEGIN ===
// ENGINE_AUDIO 1.0.0: four voice chiptune music, sfxr style sound effects, and leitmotif realization for the Saga forges.
// It reads no host global. The AudioContext, the art namespace, timers, the navigator, and the document all arrive as
// arguments, so Day 150 can lift this fence as it is (Phase 8 extracts it to engine-audio.js).
//   music  four voices: pulse 1 and pulse 2 (PeriodicWaves at 12.5, 25, 50, 75 percent duty), a quantized 4 bit triangle,
//          and LFSR noise (long and short modes) pitched with playbackRate. Every note is a fresh source node, so duty
//          changes are new segments, never a scheduled setPeriodicWave. Envelopes step at 60 per second from tables.
//   tracks {tempo, instruments {p1, p2, tri, noise}, slots [ins ids for @n], patterns {key: mml}, order [[p1, p2, tri,
//          noise] pattern keys or null], loop (row index or null)}. A 25 ms timer schedules ahead by the lookahead.
//   mml    a-g with + # or - accidentals, a length (1 2 3 4 6 8 12 16 24 32 48 64 96 192) with dots, r rest, ^ tie,
//          o octave, < down, > up, l default length, v volume 0 to 15, @n instrument slot. | and spaces are ignored.
//          Ticks: a whole note is 192, a quarter 48. o4 a is 440 Hz (MIDI 69).
//   sfxr   DrPetter's sfxr synthesis rendered once per effect into a buffer and cached, played on its own bus.
//   motif  scale degree tokens and durations realized through a recipe (mode, key, tempo scale, rhythm, octave, lead,
//          accompaniment, bass, drums, fragment) into an ordinary track.
var ENGINE_AUDIO = (function () {
  'use strict';
  var VERSION = '1.0.0';
  var WHOLE = 192, QUARTER = 48, FPS = 60, SFX_RATE = 44100;
  var CHANNELS = ['p1', 'p2', 'tri', 'noise'];
  var WAVES = ['pulse', 'tri', 'noise'];
  var DUTIES = [0.125, 0.25, 0.5, 0.75];
  // Channel levels before the music bus, and the trim that brings full scale sfxr renders down to sit with the music.
  // Measured offline: battle and title peak near 0.6 at music volume 0.8, the cue library near 0.5 at effects 0.9.
  var MIX = { p1: 0.27, p2: 0.21, tri: 0.4, noise: 0.2 }, SFX_TRIM = 0.55;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function rng(seed) { var a = (seed >>> 0) || 1; return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash32(s) { s = String(s); var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function canon(o) {
    if (o === null || typeof o !== 'object') return JSON.stringify(o);
    if (Array.isArray(o)) return '[' + o.map(canon).join(',') + ']';
    return '{' + Object.keys(o).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(o[k]); }).join(',') + '}';
  }
  function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  // Noise pitch: MIDI 108 (c8) steps the LFSR at the full 44.1 kHz; every octave down halves the step rate.
  function noiseRate(m) { return clamp(Math.pow(2, (m - 108) / 12), 1 / 512, 1); }

  // ---------------------------------------------------------------- MML
  var NOTE_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  var NAMES = ['c', 'c+', 'd', 'd+', 'e', 'f', 'f+', 'g', 'g+', 'a', 'a+', 'b'];
  // parse(str) -> {events [{t, d, n (MIDI or null for a rest), v, i (slot or null)}], ticks, errors [{pos, message}]}
  function mmlParse(str) {
    str = String(str == null ? '' : str);
    var out = [], errors = [], t = 0, oct = 4, len = 48, vol = 12, ins = null, p = 0, L = str.length;
    function err(pos, m) { if (errors.length < 20) errors.push({ pos: pos, message: m }); }
    function readInt() { var s = p; while (p < L && str.charCodeAt(p) >= 48 && str.charCodeAt(p) <= 57) p++; return p > s ? parseInt(str.slice(s, p), 10) : null; }
    // A length token: a number (or the default), then dots. Returns ticks or null on error.
    function readLen(def) {
      var at = p, n = readInt(), base;
      if (n == null) base = def;
      else if (n < 1 || n > WHOLE || WHOLE % n) { err(at, 'Length ' + n + ' is not one of 1 2 3 4 6 8 12 16 24 32 48 64 96 192.'); base = def; }
      else base = WHOLE / n;
      var add = base, total = base;
      while (p < L && str.charAt(p) === '.') { p++; add = add / 2; if (add !== Math.floor(add)) { err(p - 1, 'Too many dots for this length.'); break; } total += add; }
      return total;
    }
    while (p < L) {
      var c = str.charAt(p).toLowerCase(), at = p;
      if (c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '|' || c === ',') { p++; continue; }
      if (NOTE_PC[c] != null) {
        p++;
        var pc = NOTE_PC[c];
        while (p < L && /[+#-]/.test(str.charAt(p))) { pc += str.charAt(p) === '-' ? -1 : 1; p++; }
        var d = readLen(len), m = (oct + 1) * 12 + pc;
        if (m < 0 || m > 127) { err(at, 'Note out of range.'); m = clamp(m, 0, 127); }
        out.push({ t: t, d: d, n: m, v: vol, i: ins }); t += d;
      } else if (c === 'r') {
        p++; var dr = readLen(len);
        out.push({ t: t, d: dr, n: null, v: vol, i: ins }); t += dr;
      } else if (c === '^') {
        p++; var dt = readLen(len);
        if (!out.length) err(at, 'A tie needs a note or rest before it.');
        else { out[out.length - 1].d += dt; t += dt; }
      } else if (c === 'o') {
        p++; var o = readInt();
        if (o == null || o < 0 || o > 9) err(at, 'Octave must be 0 to 9.'); else oct = o;
      } else if (c === '<') { p++; oct = Math.max(0, oct - 1); }
      else if (c === '>') { p++; oct = Math.min(9, oct + 1); }
      else if (c === 'l') { p++; len = readLen(len); }
      else if (c === 'v') {
        p++; var v = readInt();
        if (v == null || v > 15) err(at, 'Volume must be 0 to 15.'); else vol = v;
      } else if (c === '@') {
        p++; var s = readInt();
        if (s == null || s > 31) err(at, 'Instrument slot must be 0 to 31.'); else ins = s;
      } else { err(at, 'Unknown token ' + JSON.stringify(str.charAt(p)) + '.'); p++; }
    }
    // Merge a rest that follows a rest so the event list stays canonical.
    var ev = [];
    out.forEach(function (e) { var last = ev[ev.length - 1]; if (last && e.n == null && last.n == null) last.d += e.d; else ev.push(e); });
    return { events: ev, ticks: t, errors: errors };
  }
  // Lengths a tick count can be written with, longest first: plain, dotted, double dotted.
  var LENS = (function () {
    var out = [];
    [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 192].forEach(function (n) {
      var b = WHOLE / n;
      out.push({ t: b, s: String(n) });
      if (b % 2 === 0) out.push({ t: b * 1.5, s: n + '.' });
      if (b % 4 === 0) out.push({ t: b * 1.75, s: n + '..' });
    });
    return out.sort(function (a, b) { return b.t - a.t; });
  })();
  function lenParts(ticks) {
    var out = [], left = Math.round(ticks);
    while (left > 0) { var f = null; for (var i = 0; i < LENS.length; i++) if (LENS[i].t <= left) { f = LENS[i]; break; } if (!f) break; out.push(f.s); left -= f.t; }
    return out;
  }
  // serialize(events) -> mml. Gaps become rests; overlapping events are trimmed (one voice per pattern).
  function mmlSerialize(events, opts) {
    opts = opts || {};
    var ev = (events || []).filter(function (e) { return e && e.d > 0; }).slice().sort(function (a, b) { return a.t - b.t; });
    var parts = ['l8'], oct = null, vol = null, ins = null, t = 0, defLen = '8';
    if (opts.v != null) { parts.push('v' + opts.v); vol = opts.v; }
    function lenStr(d) { var ls = lenParts(d); return ls.map(function (s, k) { return (k ? '^' : '') + (s === defLen && !k ? '' : s); }).join(''); }
    function emit(e, d) {
      if (e.n != null) {
        if (e.v != null && e.v !== vol) { parts.push('v' + e.v); vol = e.v; }
        if (e.i != null && e.i !== ins) { parts.push('@' + e.i); ins = e.i; }
        var o = Math.floor(e.n / 12) - 1, nm = NAMES[e.n % 12];
        if (oct == null || Math.abs(o - oct) > 1) parts.push('o' + o); else if (o === oct + 1) parts.push('>'); else if (o === oct - 1) parts.push('<');
        oct = o;
        var ls = lenParts(d);
        parts.push(nm + (ls[0] === defLen ? '' : ls[0]) + ls.slice(1).map(function (s) { return '^' + s; }).join(''));
      } else parts.push('r' + lenStr(d));
    }
    ev.forEach(function (e, k) {
      if (e.t > t) { emit({ n: null }, e.t - t); t = e.t; }
      var next = ev[k + 1], d = next && next.t < e.t + e.d ? next.t - e.t : e.d;
      if (e.t < t) { d -= t - e.t; if (d <= 0) return; }
      emit(e, d); t += d;
    });
    if (opts.ticks && opts.ticks > t) emit({ n: null }, opts.ticks - t);
    return parts.join(' ');
  }

  // ---------------------------------------------------------------- instruments
  // ins: {wave pulse|tri|noise, duty [0-3 indices into 12.5 25 50 75], vol [0-15 per frame], volLoop (index or null),
  //       release (frames), vibrato {delay frames, depth semitones, rate Hz}, arp [semitones, loops], pitch [cents, holds],
  //       noiseMode long|short}
  var DEFAULT_INS = {
    p1: { wave: 'pulse', duty: [2], vol: [15, 14, 13, 12, 11], volLoop: null, release: 6, vibrato: { delay: 18, depth: 0.15, rate: 5.5 }, arp: [], pitch: [], noiseMode: 'long' },
    p2: { wave: 'pulse', duty: [1], vol: [12, 11, 10, 9, 8], volLoop: null, release: 4, vibrato: null, arp: [], pitch: [], noiseMode: 'long' },
    tri: { wave: 'tri', duty: [], vol: [15], volLoop: null, release: 0, vibrato: null, arp: [], pitch: [], noiseMode: 'long' },
    noise: { wave: 'noise', duty: [], vol: [15, 12, 8, 5, 3, 1, 0], volLoop: null, release: 0, vibrato: null, arp: [], pitch: [], noiseMode: 'long' }
  };
  function insNorm(ins, chan) {
    var d = DEFAULT_INS[chan] || DEFAULT_INS.p1, o = isObj(ins) ? ins : {};
    function arr(a, lo, hi) { return Array.isArray(a) ? a.map(function (x) { return clamp(Math.round(num(x, 0)), lo, hi); }).slice(0, 256) : []; }
    var wave = WAVES.indexOf(o.wave) >= 0 ? o.wave : d.wave;
    var vol = arr(o.vol, 0, 15);
    var vib = isObj(o.vibrato) ? { delay: clamp(Math.round(num(o.vibrato.delay, 0)), 0, 600), depth: clamp(num(o.vibrato.depth, 0), 0, 2), rate: clamp(num(o.vibrato.rate, 5), 0.1, 20) } : null;
    var loop = o.volLoop == null || o.volLoop === '' ? null : Math.round(num(o.volLoop, -1));
    return {
      wave: wave, duty: arr(o.duty, 0, 3), vol: vol.length ? vol : [15], volLoop: loop != null && loop >= 0 && loop < vol.length ? loop : null,
      release: clamp(Math.round(num(o.release, d.release)), 0, 240), vibrato: vib && vib.depth > 0 ? vib : null,
      arp: arr(o.arp, -48, 48), pitch: arr(o.pitch, -4800, 4800), noiseMode: o.noiseMode === 'short' ? 'short' : 'long'
    };
  }
  function envAt(ins, f) {
    var v = ins.vol, n = v.length;
    if (f < n) return v[f];
    if (ins.volLoop != null) { var span = n - ins.volLoop; return v[ins.volLoop + (f - n) % span]; }
    return v[n - 1];
  }
  // plan(ins, midi, vol, t0, durSec) -> {gain [[t, v]], freq [[t, hz or rate]], segments [{t0, t1, duty}], end}. Pure:
  // the voice applies it to nodes, the tests read it directly. Gain is 0 to 1 before the channel mix.
  function insPlan(ins, midi, vol, t0, dur, maxFrames) {
    var nf = Math.max(1, Math.round(dur * FPS)), rel = ins.release, total = Math.min(nf + rel, maxFrames || 2400);
    var gain = [], freq = [], segs = [], lastG = null, lastF = null, lastD = null, k = vol / 15;
    var relFrom = envAt(ins, nf - 1) / 15 * k;
    for (var f = 0; f < total; f++) {
      var t = t0 + f / FPS, g;
      if (f < nf) g = envAt(ins, f) / 15 * k; else g = rel ? relFrom * (1 - (f - nf + 1) / (rel + 1)) : 0;
      g = Math.round(g * 10000) / 10000;
      if (g !== lastG) { gain.push([t, g]); lastG = g; }
      var semi = ins.arp.length ? ins.arp[f % ins.arp.length] : 0, cents = ins.pitch.length ? ins.pitch[Math.min(f, ins.pitch.length - 1)] : 0, vib = 0;
      if (ins.vibrato && f >= ins.vibrato.delay) vib = Math.sin(2 * Math.PI * ins.vibrato.rate * (f - ins.vibrato.delay) / FPS) * ins.vibrato.depth;
      var m = midi + semi + cents / 100 + vib, fv = ins.wave === 'noise' ? noiseRate(m) : midiHz(m);
      fv = Math.round(fv * 1000) / 1000;
      if (fv !== lastF) { freq.push([t, fv]); lastF = fv; }
      if (ins.wave === 'pulse') {
        var dI = ins.duty.length ? ins.duty[Math.min(f, ins.duty.length - 1)] : 2;
        if (dI !== lastD && segs.length < 8) { if (segs.length) segs[segs.length - 1].t1 = t; segs.push({ t0: t, t1: null, duty: dI }); lastD = dI; }
      }
    }
    var end = t0 + total / FPS;
    gain.push([end, 0]);
    if (!segs.length) segs.push({ t0: t0, t1: end, duty: null });
    segs[segs.length - 1].t1 = end;
    return { gain: gain, freq: freq, segments: segs, end: end, noteEnd: t0 + nf / FPS };
  }

  // ---------------------------------------------------------------- waves
  function pulseCoefs(duty, n) {
    var re = new Float32Array(n + 1), im = new Float32Array(n + 1);
    for (var k = 1; k <= n; k++) { re[k] = Math.sin(2 * Math.PI * k * duty) / (k * Math.PI); im[k] = (1 - Math.cos(2 * Math.PI * k * duty)) / (k * Math.PI); }
    return { real: re, imag: im };
  }
  // The NES triangle: 32 steps of a 4 bit ramp (15 down to 0, then 0 up to 15), as Fourier coefficients.
  function triCoefs(n) {
    var N = 32, x = [], re = new Float32Array(n + 1), im = new Float32Array(n + 1), k, j;
    for (j = 0; j < N; j++) x.push(((j < 16 ? 15 - j : j - 16) / 7.5) - 1);
    for (k = 1; k <= n; k++) { var a = 0, b = 0; for (j = 0; j < N; j++) { a += x[j] * Math.cos(2 * Math.PI * k * j / N); b += x[j] * Math.sin(2 * Math.PI * k * j / N); } re[k] = 2 * a / N; im[k] = 2 * b / N; }
    return { real: re, imag: im };
  }
  // 15 bit LFSR. Long mode taps bit 1, short mode taps bit 6 (period 93).
  function lfsr(mode, count) {
    var out = new Float32Array(count), r = 1;
    for (var i = 0; i < count; i++) { var fb = (r & 1) ^ ((r >> (mode === 'short' ? 6 : 1)) & 1); r = (r >> 1) | (fb << 14); out[i] = (r & 1) ? -0.8 : 0.8; }
    return out;
  }

  // ---------------------------------------------------------------- sfxr
  var SFX_WAVES = ['square', 'saw', 'sine', 'noise'];
  var SFX_CATEGORIES = ['hit', 'magic', 'ui', 'ambient', 'item', 'special'];
  var SFX_PARAMS = [
    { key: 'attack', label: 'Attack', min: 0, max: 1, def: 0 }, { key: 'sustain', label: 'Sustain', min: 0, max: 1, def: 0.3 },
    { key: 'punch', label: 'Punch', min: 0, max: 1, def: 0 }, { key: 'decay', label: 'Decay', min: 0, max: 1, def: 0.4 },
    { key: 'freq', label: 'Base frequency', min: 0, max: 1, def: 0.3 }, { key: 'minFreq', label: 'Frequency floor', min: 0, max: 1, def: 0 },
    { key: 'slide', label: 'Slide', min: -1, max: 1, def: 0 }, { key: 'dslide', label: 'Delta slide', min: -1, max: 1, def: 0 },
    { key: 'vibDepth', label: 'Vibrato depth', min: 0, max: 1, def: 0 }, { key: 'vibSpeed', label: 'Vibrato speed', min: 0, max: 1, def: 0 },
    { key: 'arpMod', label: 'Arpeggio jump', min: -1, max: 1, def: 0 }, { key: 'arpSpeed', label: 'Arpeggio speed', min: 0, max: 1, def: 0 },
    { key: 'duty', label: 'Duty', min: 0, max: 1, def: 0 }, { key: 'dutySweep', label: 'Duty sweep', min: -1, max: 1, def: 0 },
    { key: 'lpf', label: 'Low pass', min: 0, max: 1, def: 1 }, { key: 'lpfRes', label: 'Low pass resonance', min: 0, max: 1, def: 0 },
    { key: 'hpf', label: 'High pass', min: 0, max: 1, def: 0 }, { key: 'volume', label: 'Volume', min: 0, max: 1, def: 0.5 }
  ];
  function sfxNorm(p) {
    p = isObj(p) ? p : {};
    var o = { wave: SFX_WAVES.indexOf(p.wave) >= 0 ? p.wave : 'square' };
    SFX_PARAMS.forEach(function (d) { o[d.key] = Math.round(clamp(num(p[d.key], d.def), d.min, d.max) * 10000) / 10000; });
    return o;
  }
  // render(params, sampleRate, seed) -> Float32Array at sampleRate (synthesized at 44.1 kHz, resampled when different).
  function sfxRender(params, sampleRate, seed) {
    var p = sfxNorm(params), R = rng(seed || 1), out = [];
    var fperiod = 100 / (p.freq * p.freq + 0.001), fmaxperiod = 100 / (p.minFreq * p.minFreq + 0.001);
    var fslide = 1 - Math.pow(p.slide, 3) * 0.01, fdslide = -Math.pow(p.dslide, 3) * 0.000001;
    var sqDuty = 0.5 - p.duty * 0.5, sqSlide = -p.dutySweep * 0.00005;
    var arpMod = p.arpMod >= 0 ? 1 - p.arpMod * p.arpMod * 0.9 : 1 + p.arpMod * p.arpMod * 10;
    var arpTime = 0, arpLimit = p.arpSpeed === 1 ? 0 : Math.floor(Math.pow(1 - p.arpSpeed, 2) * 20000 + 32);
    if (p.arpMod === 0) arpLimit = 0;
    var envLen = [Math.floor(p.attack * p.attack * 100000), Math.floor(p.sustain * p.sustain * 100000), Math.floor(p.decay * p.decay * 100000) + 10];
    var envStage = 0, envTime = 0, envVol = 0, phase = 0, vibPhase = 0, vibSpeed = p.vibSpeed * p.vibSpeed * 0.01, vibAmp = p.vibDepth * 0.5;
    var fltp = 0, fltdp = 0, fltw = Math.pow(p.lpf, 3) * 0.1, fltdmp = Math.min(0.8, 5 / (1 + p.lpfRes * p.lpfRes * 20) * (0.01 + fltw));
    var fltphp = 0, flthp = p.hpf * p.hpf * 0.1, noise = [], i;
    for (i = 0; i < 32; i++) noise.push(R() * 2 - 1);
    var maxN = SFX_RATE * 8;
    for (var s = 0; s < maxN; s++) {
      if (arpLimit && ++arpTime >= arpLimit) { arpLimit = 0; fperiod *= arpMod; }
      fslide += fdslide; fperiod *= fslide;
      if (fperiod > fmaxperiod) { fperiod = fmaxperiod; if (p.minFreq > 0) break; }
      var rf = fperiod;
      if (vibAmp > 0) { vibPhase += vibSpeed; rf = fperiod * (1 + Math.sin(vibPhase) * vibAmp); }
      var period = Math.max(8, Math.floor(rf));
      sqDuty = clamp(sqDuty + sqSlide, 0, 0.5);
      if (++envTime > envLen[envStage]) { envTime = 0; envStage++; if (envStage > 2) break; }
      if (envStage === 0) envVol = envLen[0] ? envTime / envLen[0] : 1;
      else if (envStage === 1) envVol = 1 + Math.pow(1 - envTime / Math.max(1, envLen[1]), 1) * 2 * p.punch;
      else envVol = 1 - envTime / envLen[2];
      var sample = 0;
      for (var k = 0; k < 8; k++) {
        phase++;
        if (phase >= period) { phase %= period; if (p.wave === 'noise') for (i = 0; i < 32; i++) noise[i] = R() * 2 - 1; }
        var fp = phase / period, sub;
        if (p.wave === 'square') sub = fp < sqDuty ? 0.5 : -0.5;
        else if (p.wave === 'saw') sub = 1 - fp * 2;
        else if (p.wave === 'sine') sub = Math.sin(fp * 2 * Math.PI);
        else sub = noise[Math.floor(phase * 32 / period) % 32];
        var pp = fltp;
        if (p.lpf < 1) { fltdp += (sub - fltp) * fltw; fltdp -= fltdp * fltdmp; } else { fltp = sub; fltdp = 0; }
        fltp += fltdp;
        fltphp += fltp - pp; fltphp -= fltphp * flthp;
        sample += fltphp * envVol;
      }
      out.push(clamp(sample / 8 * p.volume * 2, -1, 1));
    }
    var sr = sampleRate || SFX_RATE;
    if (sr === SFX_RATE) return Float32Array.from(out);
    var n = Math.max(1, Math.floor(out.length * sr / SFX_RATE)), res = new Float32Array(n), r = SFX_RATE / sr;
    for (i = 0; i < n; i++) { var x = i * r, a = Math.floor(x), fr = x - a; res[i] = (out[a] || 0) * (1 - fr) + (out[a + 1] || 0) * fr; }
    return res;
  }
  // mutate(params, amount 0 to 1, seed): nudges about half the parameters by up to amount of their range.
  function sfxMutate(params, amount, seed) {
    var p = sfxNorm(params), R = rng(seed || 7), a = clamp(num(amount, 0.1), 0, 1);
    SFX_PARAMS.forEach(function (d) { if (d.key === 'volume') return; if (R() < 0.5) p[d.key] = clamp(p[d.key] + (R() * 2 - 1) * a * (d.max - d.min) * 0.5, d.min, d.max); });
    return sfxNorm(p);
  }
  // preset(category, seed) after sfxr's generators: hit (hurt and explosion), magic (laser and power up), ui (blip),
  // ambient (long filtered noise), item (pickup), special (big power up with vibrato).
  function sfxPreset(category, seed) {
    var R = rng(seed || 1), p = { wave: 'square' };
    function pick(a) { return a[Math.floor(R() * a.length)]; }
    var cat = SFX_CATEGORIES.indexOf(category) >= 0 ? category : 'ui';
    if (cat === 'hit') {
      if (R() < 0.6) { p.wave = pick(['square', 'saw', 'noise']); p.freq = 0.2 + R() * 0.6; p.slide = -0.3 - R() * 0.4; p.sustain = R() * 0.1; p.decay = 0.1 + R() * 0.2; if (R() < 0.5) p.hpf = R() * 0.3; }
      else { p.wave = 'noise'; p.freq = 0.15 + R() * 0.35; p.slide = -0.1 + R() * 0.3; p.sustain = 0.1 + R() * 0.25; p.decay = R() * 0.4; p.punch = 0.2 + R() * 0.6; }
    } else if (cat === 'magic') {
      if (R() < 0.5) { p.wave = pick(['square', 'saw', 'sine']); p.freq = 0.5 + R() * 0.5; p.minFreq = Math.max(0.2, p.freq - 0.2 - R() * 0.6); p.slide = -0.15 - R() * 0.2; p.duty = R() * 0.5; p.dutySweep = R() * 0.2; p.sustain = 0.1 + R() * 0.2; p.decay = R() * 0.4; }
      else { p.wave = pick(['square', 'saw']); p.freq = 0.2 + R() * 0.3; p.slide = 0.1 + R() * 0.4; p.vibDepth = R() < 0.5 ? R() * 0.7 : 0; p.vibSpeed = R() * 0.6; p.sustain = R() * 0.4; p.decay = 0.1 + R() * 0.4; }
    } else if (cat === 'ui') { p.wave = pick(['square', 'saw']); p.duty = R() * 0.6; p.freq = 0.2 + R() * 0.4; p.sustain = 0.1 + R() * 0.1; p.decay = R() * 0.2; p.hpf = 0.1; }
    else if (cat === 'ambient') { p.wave = 'noise'; p.freq = 0.2 + R() * 0.3; p.attack = 0.3 + R() * 0.2; p.sustain = 0.7 + R() * 0.2; p.decay = 0.5 + R() * 0.3; p.lpf = 0.3 + R() * 0.3; p.volume = 0.3; }
    else if (cat === 'item') { p.freq = 0.4 + R() * 0.5; p.sustain = R() * 0.1; p.decay = 0.1 + R() * 0.4; p.punch = 0.3 + R() * 0.3; if (R() < 0.5) { p.arpSpeed = 0.5 + R() * 0.2; p.arpMod = 0.2 + R() * 0.4; } }
    else { p.wave = pick(['square', 'saw']); p.freq = 0.25 + R() * 0.2; p.slide = 0.15 + R() * 0.2; p.vibDepth = 0.2 + R() * 0.4; p.vibSpeed = 0.4 + R() * 0.3; p.sustain = 0.3 + R() * 0.3; p.decay = 0.3 + R() * 0.3; p.punch = 0.2; }
    return sfxNorm(p);
  }

  // ---------------------------------------------------------------- leitmotifs
  var MODES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], harmonic: [0, 2, 3, 5, 7, 8, 11] };
  var KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  var RHYTHMS = ['straight', 'dotted', 'swing', 'half', 'double'];
  var ACCOMP = ['pad', 'arp', 'march', 'waltz', 'ostinato', 'none'];
  var BASS = ['root', 'walking', 'pedal', 'none'];
  var DRUMS = ['none', 'march', 'battle', 'ballad'];
  var VARIATIONS = {
    field: { mode: null, key: null, tempoScale: 1, rhythm: 'straight', octave: 5, lead: null, accomp: 'arp', bass: 'root', drums: 'ballad', fragment: null },
    sorrow: { mode: 'minor', key: null, tempoScale: 0.65, rhythm: 'straight', octave: 5, lead: null, accomp: 'pad', bass: 'pedal', drums: 'none', fragment: null },
    battle: { mode: null, key: null, tempoScale: 1.45, rhythm: 'dotted', octave: 5, lead: null, accomp: 'ostinato', bass: 'pedal', drums: 'battle', fragment: null },
    finale: { mode: 'major', key: null, tempoScale: 0.9, rhythm: 'straight', octave: 5, lead: null, accomp: 'march', bass: 'walking', drums: 'march', fragment: null }
  };
  function keyOf(k) { if (typeof k === 'number' && isFinite(k)) return ((Math.round(k) % 12) + 12) % 12; var i = KEYS.indexOf(String(k)); if (i >= 0) return i; var alt = { 'Db': 1, 'D#': 3, 'Gb': 6, 'G#': 8, 'A#': 10 }[String(k)]; return alt != null ? alt : 0; }
  // Degree tokens: an optional # or b, a digit 1 to 9 (8 and 9 are the next octave's 1 and 2), then ' for an octave up
  // or , for an octave down, each repeatable; r is a rest. -> {tokens [{deg, acc} or null], errors}
  function parseDegrees(s) {
    var toks = String(s == null ? '' : s).trim().split(/\s+/).filter(Boolean), out = [], errors = [];
    toks.forEach(function (t, i) {
      if (t === 'r' || t === 'R') { out.push(null); return; }
      var m = /^([#b]?)([1-9])([',]*)$/.exec(t);
      if (!m) { errors.push({ index: i, message: 'Token ' + t + ' is not a scale degree (1 to 9, optional # or b, then \' or ,) or r.' }); out.push(null); return; }
      var up = (m[3].match(/'/g) || []).length, dn = (m[3].match(/,/g) || []).length;
      out.push({ deg: Number(m[2]) - 1 + 7 * (up - dn), acc: m[1] === '#' ? 1 : m[1] === 'b' ? -1 : 0 });
    });
    return { tokens: out, errors: errors };
  }
  // Durations in eighth note units (1 is an eighth, 2 a quarter, 0.5 a sixteenth, 2/3 a triplet eighth); each must come
  // to a whole number of ticks (an eighth is 24).
  function parseDurs(s) {
    var toks = String(s == null ? '' : s).trim().split(/\s+/).filter(Boolean), out = [], errors = [];
    toks.forEach(function (t, i) { var fr = /^(\d+)\/(\d+)$/.exec(t), v = fr ? Number(fr[1]) / Number(fr[2]) : Number(t), tk = v * 24; if (!(v > 0) || Math.abs(tk - Math.round(tk)) > 1e-6 || tk > WHOLE * 4) { errors.push({ index: i, message: 'Duration ' + t + ' is not a positive number of eighths in whole ticks.' }); out.push(1); } else out.push(v); });
    return { durs: out, errors: errors };
  }
  function scaleMidi(scale, tonic, deg, acc) { var o = Math.floor(deg / 7), d = ((deg % 7) + 7) % 7; return tonic + 12 * o + scale[d] + (acc || 0); }
  // Which chord (scale degree root) carries a melody degree: 1 and 3 sit on I, 4 and 6 on IV, 2, 5, and 7 on V.
  var CHORD_FOR = [0, 4, 0, 3, 4, 3, 4];
  function motifNotes(motif, recipe) {
    var pd = parseDegrees(motif.degrees), pr = parseDurs(motif.durs), n = Math.min(pd.tokens.length, pr.durs.length), notes = [];
    for (var i = 0; i < n; i++) notes.push({ tok: pd.tokens[i], u: pr.durs[i] });
    var fr = recipe.fragment;
    if (isObj(fr) && notes.length) {
      var st = clamp(Math.round(num(fr.start, 0)), 0, notes.length - 1), ln = clamp(Math.round(num(fr.len, notes.length)), 1, notes.length - st), rp = clamp(Math.round(num(fr.repeat, 1)), 1, 16);
      var part = notes.slice(st, st + ln); notes = [];
      for (var r = 0; r < rp; r++) notes = notes.concat(part);
    }
    // Rhythm in ticks.
    var ticks = notes.map(function (x) { return x.u * 24; }), rh = recipe.rhythm;
    if (rh === 'half') ticks = ticks.map(function (t) { return t * 2; });
    else if (rh === 'double') ticks = ticks.map(function (t) { return Math.max(6, t / 2); });
    else if (rh === 'dotted' || rh === 'swing') {
      for (var j = 0; j + 1 < ticks.length; j++) {
        if (ticks[j] === ticks[j + 1] && notes[j].tok && notes[j + 1].tok && (rh === 'dotted' ? ticks[j] % 4 === 0 : ticks[j] === 24)) {
          var pair = ticks[j] * 2;
          ticks[j] = rh === 'dotted' ? pair * 3 / 4 : pair * 2 / 3; ticks[j + 1] = pair - ticks[j]; j++;
        }
      }
    }
    return notes.map(function (x, k) { return { tok: x.tok, d: Math.round(ticks[k]) }; });
  }
  // realize(motif, recipe, ins {lead, harmony, bass, kick, snare, hat}) -> track (an ordinary one).
  function realize(motif, recipe, ins) {
    motif = isObj(motif) ? motif : {}; ins = isObj(ins) ? ins : {};
    var rc = {}, base = VARIATIONS.field;
    Object.keys(base).forEach(function (k) { rc[k] = base[k]; });
    if (isObj(recipe)) Object.keys(recipe).forEach(function (k) { if (recipe[k] !== undefined && recipe[k] !== null) rc[k] = recipe[k]; });
    var mode = MODES[rc.mode] ? rc.mode : MODES[motif.mode] ? motif.mode : 'major', scale = MODES[mode];
    var key = keyOf(rc.key != null ? rc.key : motif.key), oct = clamp(Math.round(num(rc.octave, 5)), 3, 7);
    var meter = clamp(Math.round(num(motif.meter, 4)), 2, 7), bar = meter * QUARTER;
    var tonic = (oct + 1) * 12 + key;
    var notes = motifNotes(motif, rc), mel = [], t = 0;
    notes.forEach(function (x) { if (x.d <= 0) return; mel.push({ t: t, d: x.d, n: x.tok ? clamp(scaleMidi(scale, tonic, x.tok.deg, x.tok.acc), 24, 108) : null, v: 12, i: null, deg: x.tok ? x.tok.deg : null }); t += x.d; });
    var L = Math.max(bar, Math.ceil(t / bar) * bar), bars = L / bar;
    // Chords: one per bar from the melody degree sounding at its downbeat; the last bar resolves to I, the one before
    // it to V when the tune ends on the tonic.
    var chords = [];
    for (var b = 0; b < bars; b++) {
      var at = b * bar, nt = null, q;
      for (q = 0; q < mel.length && !nt; q++) if (mel[q].deg != null && mel[q].t <= at && mel[q].t + mel[q].d > at) nt = mel[q];
      for (q = 0; q < mel.length && !nt; q++) if (mel[q].deg != null && mel[q].t >= at && mel[q].t < at + bar) nt = mel[q];
      var root = nt ? CHORD_FOR[((nt.deg % 7) + 7) % 7] : 0;
      if (b > 0 && root === chords[b - 1] && root === 0 && b % 2 === 1 && nt && ((nt.deg % 7) + 7) % 7 === 2) root = 5;
      chords.push(root);
    }
    var lastDeg = null;
    for (var z = mel.length - 1; z >= 0; z--) if (mel[z].deg != null) { lastDeg = ((mel[z].deg % 7) + 7) % 7; break; }
    if (bars > 1) { chords[bars - 1] = 0; if (lastDeg === 0) chords[bars - 2] = 4; }
    function tone(chord, k, o) { return clamp(scaleMidi(scale, (o + 1) * 12 + key, chord + 2 * k, 0), 24, 108); }
    // Accompaniment on pulse 2.
    var acc = [], ao = Math.max(3, oct - 1), style = ACCOMP.indexOf(rc.accomp) >= 0 ? rc.accomp : 'arp';
    chords.forEach(function (ch, bi) {
      var s0 = bi * bar, k;
      if (style === 'pad') acc.push({ t: s0, d: bar, n: tone(ch, 1, ao), v: 7, i: null });
      else if (style === 'arp') { var seq = [0, 1, 2, 1]; for (k = 0; k < bar / 24; k++) acc.push({ t: s0 + k * 24, d: 24, n: tone(ch, seq[k % 4], ao), v: 8, i: null }); }
      else if (style === 'ostinato') { var os = [0, 2, 3.5, 2]; for (k = 0; k < bar / 12; k++) acc.push({ t: s0 + k * 12, d: 12, n: os[k % 4] === 3.5 ? tone(ch, 0, ao + 1) : tone(ch, os[k % 4], ao), v: 7, i: null }); }
      else if (style === 'march' || style === 'waltz') {
        for (k = 0; k < meter; k++) {
          var on = style === 'waltz' ? k % 3 !== 0 : k % 2 === 1;
          if (on) { acc.push({ t: s0 + k * QUARTER, d: 24, n: tone(ch, k % 2 ? 1 : 2, ao), v: 8, i: null }); acc.push({ t: s0 + k * QUARTER + 24, d: 24, n: null, v: 8, i: null }); }
          else acc.push({ t: s0 + k * QUARTER, d: QUARTER, n: null, v: 8, i: null });
        }
      } else acc.push({ t: s0, d: bar, n: null, v: 8, i: null });
    });
    // Bass on the triangle.
    var bs = [], bo = clamp(oct - 2, 2, 4), bst = BASS.indexOf(rc.bass) >= 0 ? rc.bass : 'root';
    chords.forEach(function (ch, bi) {
      var s0 = bi * bar, k;
      if (bst === 'root') { var half = Math.max(QUARTER, Math.floor(meter / 2) * QUARTER); bs.push({ t: s0, d: half, n: tone(ch, 0, bo), v: 15, i: null }); if (bar - half > 0) bs.push({ t: s0 + half, d: bar - half, n: tone(ch, 2, bo), v: 15, i: null }); }
      else if (bst === 'walking') {
        var nx = chords[(bi + 1) % chords.length];
        for (k = 0; k < meter; k++) { var w = k === 0 ? tone(ch, 0, bo) : k === meter - 1 ? clamp(scaleMidi(scale, (bo + 1) * 12 + key, nx - 1, 0), 24, 108) : tone(ch, k, bo); bs.push({ t: s0 + k * QUARTER, d: QUARTER, n: w, v: 15, i: null }); }
      } else if (bst === 'pedal') { for (k = 0; k < bar / 24; k++) bs.push({ t: s0 + k * 24, d: 24, n: clamp((bo + 1) * 12 + key, 24, 108), v: 15, i: null }); }
      else bs.push({ t: s0, d: bar, n: null, v: 15, i: null });
    });
    // Drums on the noise channel: slot 0 kick, 1 snare, 2 hat.
    var dr = [], dst = DRUMS.indexOf(rc.drums) >= 0 ? rc.drums : 'none';
    function hitAt(t0, d, s) { dr.push({ t: t0, d: d, n: s === 0 ? 62 : s === 1 ? 96 : 106, v: s === 0 ? 13 : s === 1 ? 11 : 6, i: s }); }
    for (var bi2 = 0; bi2 < bars; bi2++) {
      var s1 = bi2 * bar, e;
      if (dst === 'battle') { var pat = meter === 4 ? [0, 2, 1, 2, 0, 0, 1, 2] : null; for (e = 0; e < meter * 2; e++) hitAt(s1 + e * 24, 24, pat ? pat[e] : e === 0 ? 0 : e % 2 === 0 && e % 4 === 2 ? 1 : 2); }
      else if (dst === 'march') { for (e = 0; e < meter; e++) { if (bi2 % 4 === 3 && e === meter - 1) { for (var f2 = 0; f2 < 4; f2++) hitAt(s1 + e * QUARTER + f2 * 12, 12, 1); } else hitAt(s1 + e * QUARTER, QUARTER, e === 0 ? 0 : e % 2 === 0 ? 1 : 2); } }
      else if (dst === 'ballad') { for (e = 0; e < meter; e++) hitAt(s1 + e * QUARTER, QUARTER, e === 0 ? 0 : 2); }
      else dr.push({ t: s1, d: bar, n: null, v: 0, i: null });
    }
    var tempo = clamp(Math.round(num(motif.tempo, 120) * clamp(num(rc.tempoScale, 1), 0.25, 4)), 40, 300);
    return {
      kind: 'track', tempo: tempo,
      instruments: { p1: rc.lead || ins.lead || null, p2: ins.harmony || null, tri: ins.bass || null, noise: ins.kick || null },
      slots: [ins.kick || null, ins.snare || null, ins.hat || null],
      patterns: { A: mmlSerialize(mel, { ticks: L }), B: mmlSerialize(acc, { ticks: L }), C: mmlSerialize(bs, { ticks: L }), D: mmlSerialize(dr, { ticks: L }) },
      order: [['A', 'B', 'C', 'D']], loop: 0,
      info: { mode: mode, key: KEYS[key], bars: bars, ticks: L, chords: chords }
    };
  }
  // A seeded motif: two four bar phrases of eighth units, the first ending on 5 or 2, the second on 1.
  var CELLS = [[2, 2], [1, 1, 2], [3, 1], [1, 1, 1, 1], [4], [2, 1, 1], [1, 3]];
  function generateMotif(seed, opts) {
    opts = opts || {};
    var R = rng(seed), degs = [], durs = [], deg = [0, 2, 4][Math.floor(R() * 3)], meter = opts.meter || 4, barU = meter * 2;
    function phrase(endOn) {
      for (var b = 0; b < 2; b++) {
        var left = barU;
        while (left > 0) {
          var cell = CELLS[Math.floor(R() * CELLS.length)].slice(), sum = cell.reduce(function (s, x) { return s + x; }, 0);
          if (sum > left) cell = [left];
          cell.forEach(function (u, k) {
            var last = b === 1 && left - u <= 0 && k === cell.length - 1;
            if (last) deg = endOn; else { var step = [-2, -1, -1, 1, 1, 2, 0, 3, -3][Math.floor(R() * 9)]; deg = clamp(deg + step, -2, 9); }
            degs.push(deg); durs.push(u); left -= u;
          });
        }
      }
    }
    phrase(R() < 0.5 ? 4 : 1); phrase(0);
    function tok(d) { var o = d < 0 ? ',' : d >= 7 ? "'" : ''; var b = ((d % 7) + 7) % 7 + 1; return b + o; }
    return { degrees: degs.map(tok).join(' '), durs: durs.join(' '), meter: meter, mode: opts.mode || 'major', key: opts.key != null ? opts.key : KEYS[Math.floor(R() * 12)], tempo: opts.tempo || 100 + Math.floor(R() * 36) };
  }

  // ---------------------------------------------------------------- tracks
  // compile(track) -> {rows [{len, ch {p1: events, ...}}], errors [{pattern, pos, message}], ticks}
  function compile(track) {
    var pats = isObj(track && track.patterns) ? track.patterns : {}, parsed = {}, errors = [];
    Object.keys(pats).forEach(function (k) { var r = mmlParse(pats[k]); parsed[k] = r; r.errors.forEach(function (e) { errors.push({ pattern: k, pos: e.pos, message: e.message }); }); });
    var order = Array.isArray(track && track.order) ? track.order : [], rows = [], ticks = 0;
    order.forEach(function (row, ri) {
      var ch = {}, len = 0;
      CHANNELS.forEach(function (c, ci) {
        var key = Array.isArray(row) ? row[ci] : null;
        if (key == null || key === '') { ch[c] = []; return; }
        if (!parsed[key]) { errors.push({ pattern: String(key), pos: 0, message: 'Row ' + ri + ' names pattern ' + key + ', which does not exist.' }); ch[c] = []; return; }
        ch[c] = parsed[key].events; len = Math.max(len, parsed[key].ticks);
      });
      if (!len) len = QUARTER;
      rows.push({ len: len, ch: ch }); ticks += len;
    });
    return { rows: rows, errors: errors, ticks: ticks };
  }
  function secPerTick(tempo) { return 60 / (clamp(num(tempo, 120), 20, 400) * QUARTER); }
  // duration(track) -> {once seconds for every row, loop seconds from the loop row to the end, loops}
  function duration(track) {
    var c = compile(track), spt = secPerTick(track && track.tempo), lp = track && track.loop, once = c.ticks * spt;
    var loops = typeof lp === 'number' && lp >= 0 && lp < c.rows.length;
    var loopT = loops ? c.rows.slice(lp).reduce(function (s, r) { return s + r.len; }, 0) * spt : 0;
    return { once: once, loop: loopT, loops: loops };
  }

  // ---------------------------------------------------------------- silent element source
  // A short 8 bit WAV of silence as a data URI, for the looping audio element that lifts iOS out of the ringer
  // channel when navigator.audioSession does not exist. Built here so no file ships.
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64(bytes) {
    var s = '', i;
    for (i = 0; i + 2 < bytes.length; i += 3) { var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]; s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + B64[n >> 6 & 63] + B64[n & 63]; }
    var r = bytes.length - i;
    if (r === 1) { var m = bytes[i] << 16; s += B64[m >> 18 & 63] + B64[m >> 12 & 63] + '=='; }
    else if (r === 2) { var q = (bytes[i] << 16) | (bytes[i + 1] << 8); s += B64[q >> 18 & 63] + B64[q >> 12 & 63] + B64[q >> 6 & 63] + '='; }
    return s;
  }
  function silentSrc() {
    var rate = 8000, n = 4000, bytes = [], i;
    function str(s) { for (var k = 0; k < s.length; k++) bytes.push(s.charCodeAt(k)); }
    function u32(v) { bytes.push(v & 255, v >> 8 & 255, v >> 16 & 255, v >>> 24 & 255); }
    function u16(v) { bytes.push(v & 255, v >> 8 & 255); }
    str('RIFF'); u32(36 + n); str('WAVE'); str('fmt '); u32(16); u16(1); u16(1); u32(rate); u32(rate); u16(1); u16(8); str('data'); u32(n);
    for (i = 0; i < n; i++) bytes.push(128);
    return 'data:audio/wav;base64,' + b64(bytes);
  }

  // ---------------------------------------------------------------- the player
  // create(ctx, opts) -> audio. opts: {manual (no timer; call tick()), timers {setInterval, clearInterval, setTimeout},
  // coarse (true on touch screens), lookaheadMs {desktop, mobile}, navigator, createAudioElement(), maxSfx}
  function create(ctx, opts) {
    opts = opts || {};
    // Host timers are called through wrappers: a browser throws Illegal invocation when setInterval runs as a method of
    // another object.
    var T = opts.timers || { setInterval: function (f, ms) { return setInterval(f, ms); }, clearInterval: function (h) { clearInterval(h); }, setTimeout: function (f, ms) { return setTimeout(f, ms); } };
    var art = { records: {} }, lookMs = opts.lookaheadMs || { desktop: 100, mobile: 175 }, coarse = !!opts.coarse;
    var master = ctx.createGain(), musicBus = ctx.createGain(), sfxBus = ctx.createGain();
    musicBus.connect(master); sfxBus.connect(master); master.connect(ctx.destination);
    var vols = { music: 0.8, sfx: 0.9, muted: false };
    function applyVol() { var t = ctx.currentTime; master.gain.setValueAtTime(vols.muted ? 0 : 1, t); musicBus.gain.setValueAtTime(vols.music, t); sfxBus.gain.setValueAtTime(vols.sfx * SFX_TRIM, t); }
    applyVol();
    var waves = null, noiseBuf = {}, sfxCache = {}, sfxVoices = [], unlocked = false, silentEl = null, timer = null, disposed = false;
    var play = null, errors = [], recent = { p1: [], p2: [], tri: [], noise: [] }, stats = { notes: 0, sfx: 0, ticks: 0, rows: 0 };
    function rec(id) { var p = typeof id === 'string' ? id.slice(0, 4) : null, m = p && art.records && art.records[p]; return m && isObj(m[id]) ? m[id] : null; }
    function lookahead() { return Math.max(0.03, num(coarse ? lookMs.mobile : lookMs.desktop, 100) / 1000); }
    function ensureWaves() {
      if (waves) return waves;
      waves = { pulse: DUTIES.map(function (d) { var c = pulseCoefs(d, 48); return ctx.createPeriodicWave(c.real, c.imag); }), tri: (function () { var c = triCoefs(32); return ctx.createPeriodicWave(c.real, c.imag); })() };
      return waves;
    }
    function noiseBuffer(mode) {
      if (noiseBuf[mode]) return noiseBuf[mode];
      var data = lfsr(mode, mode === 'short' ? 93 : 32767), buf = ctx.createBuffer(1, data.length, SFX_RATE);
      buf.getChannelData(0).set(data);
      return (noiseBuf[mode] = buf);
    }

    // ---- one note on one channel
    // st holds the last note per channel for one playback, so a crossfade never cuts the other track's notes.
    function voice(chan, insRec, ev, t0, dur, dest, st) {
      var ins = insNorm(insRec, chan);
      if (chan === 'tri') ins.wave = 'tri'; else if (chan === 'noise') ins.wave = 'noise'; else ins.wave = 'pulse';
      var pl = insPlan(ins, ev.n, ev.v == null ? 12 : ev.v, t0, dur);
      var prev = st[chan];
      if (prev && prev.end > t0) { try { prev.g.gain.cancelScheduledValues(t0); prev.g.gain.setValueAtTime(0, t0); } catch (e) { /* ok */ } }
      var g = ctx.createGain(), mix = MIX[chan];
      g.gain.setValueAtTime(0, Math.max(0, t0 - 0.001));
      pl.gain.forEach(function (x) { g.gain.setValueAtTime(x[1] * mix, x[0]); });
      g.connect(dest);
      var W = ensureWaves();
      pl.segments.forEach(function (sg, si) {
        var src;
        if (ins.wave === 'noise') { src = ctx.createBufferSource(); src.buffer = noiseBuffer(ins.noiseMode); src.loop = true; }
        else { src = ctx.createOscillator(); src.setPeriodicWave(ins.wave === 'tri' ? W.tri : W.pulse[sg.duty == null ? 2 : sg.duty]); }
        var param = ins.wave === 'noise' ? src.playbackRate : src.frequency, first = pl.freq[0][1];
        pl.freq.forEach(function (x) { if (x[0] <= sg.t0) first = x[1]; });
        param.setValueAtTime(first, sg.t0);
        pl.freq.forEach(function (x) { if (x[0] > sg.t0 && x[0] < sg.t1) param.setValueAtTime(x[1], x[0]); });
        src.connect(g);
        src.start(sg.t0); src.stop(si === pl.segments.length - 1 ? sg.t1 + 0.01 : sg.t1);
      });
      st[chan] = { g: g, end: pl.end };
      stats.notes++;
      var rl = recent[chan]; rl.push({ n: ev.n, t0: t0, t1: pl.noteEnd, v: ev.v }); if (rl.length > 24) rl.shift();
      return pl;
    }

    // ---- the order list player
    function insFor(trk, chan, slot) {
      var id = slot != null && Array.isArray(trk.slots) ? trk.slots[slot] : null;
      if (!id && isObj(trk.instruments)) id = trk.instruments[chan];
      return (id && rec(id)) || null;
    }
    function startTrack(trk, meta, o) {
      var c = compile(trk);
      if (!c.rows.length) return null;
      var g = ctx.createGain(), t0 = ctx.currentTime + 0.06, fade = Math.max(0, num(o.fadeInMs, 0)) / 1000;
      g.gain.setValueAtTime(fade ? 0 : 1, t0);
      if (fade) g.gain.linearRampToValueAtTime(1, t0 + fade);
      g.connect(musicBus);
      var lp = typeof trk.loop === 'number' && trk.loop >= 0 && trk.loop < c.rows.length ? trk.loop : null;
      if (o.loop === false) lp = null;
      var p = { id: meta.id || null, name: meta.name || '', role: meta.role || null, track: trk, c: c, g: g, spt: secPerTick(trk.tempo), row: 0, rowStart: t0, cur: { p1: 0, p2: 0, tri: 0, noise: 0 }, chan: {}, loop: lp, ended: false, startedAt: t0, passes: 0, onEnd: o.onEnd || null };
      c.errors.forEach(function (e) { errors.push((meta.name || 'track') + ' ' + e.pattern + ': ' + e.message); if (errors.length > 20) errors.shift(); });
      return p;
    }
    function schedule(p, horizon) {
      var guard = 0;
      while (!p.ended && guard++ < 512) {
        var row = p.c.rows[p.row], done = true;
        CHANNELS.forEach(function (ch) {
          var evs = row.ch[ch];
          while (p.cur[ch] < evs.length) {
            var e = evs[p.cur[ch]], at = p.rowStart + e.t * p.spt;
            if (at >= horizon) { done = false; break; }
            if (e.n != null) voice(ch, insFor(p.track, ch, e.i), e, at, e.d * p.spt, p.g, p.chan);
            p.cur[ch]++;
          }
        });
        var rowEnd = p.rowStart + row.len * p.spt;
        if (!done || rowEnd >= horizon) break;
        p.rowStart = rowEnd; p.row++; stats.rows++;
        p.cur = { p1: 0, p2: 0, tri: 0, noise: 0 };
        if (p.row >= p.c.rows.length) {
          p.passes++;
          if (p.loop != null) p.row = p.loop;
          else { p.ended = true; p.endAt = rowEnd; }
        }
      }
    }
    function tick() {
      if (disposed) return;
      stats.ticks++;
      var horizon = ctx.currentTime + lookahead();
      if (play && !play.ended) schedule(play, horizon);
      if (play && play.ended && play.endAt != null && ctx.currentTime >= play.endAt + 0.25) {
        var fn = play.onEnd; play.finished = true;
        var old = play; play = null; old.g.disconnect && old.g.disconnect();
        if (fn) try { fn(); } catch (e) { /* ok */ }
      }
    }
    function startTimer() { if (timer == null && !opts.manual) timer = T.setInterval(tick, 25); }
    function fadeOut(p, ms) {
      if (!p) return;
      var t = ctx.currentTime, f = Math.max(0.005, num(ms, 0) / 1000);
      p.ended = true; p.stopped = true;
      try { p.g.gain.cancelScheduledValues(t); p.g.gain.setValueAtTime(p.g.gain.value == null ? 1 : p.g.gain.value, t); p.g.gain.linearRampToValueAtTime(0, t + f); } catch (e) { /* ok */ }
      var g = p.g;
      if (T.setTimeout) T.setTimeout(function () { try { g.disconnect(); } catch (e) { /* ok */ } }, f * 1000 + 300);
    }
    var api = {
      version: VERSION,
      ctx: ctx,
      // Call inside a pointerup or click handler.
      unlock: function () {
        try { if (ctx.state === 'suspended' && ctx.resume) ctx.resume(); } catch (e) { /* ok */ }
        try { var b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch (e) { /* ok */ }
        var nav = opts.navigator;
        if (nav && nav.audioSession) { try { nav.audioSession.type = 'playback'; } catch (e) { /* ok */ } }
        else if (!silentEl && typeof opts.createAudioElement === 'function') {
          try { silentEl = opts.createAudioElement(); silentEl.src = silentSrc(); silentEl.loop = true; silentEl.volume = 0.0001; var pr = silentEl.play && silentEl.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) { silentEl = null; }
        }
        unlocked = true;
        startTimer();
        return true;
      },
      load: function (a) {
        art = isObj(a) ? a : { records: {} };
        // The art namespace's lookahead applies unless the host passed its own to create().
        if (!opts.lookaheadMs && isObj(art.settings) && isObj(art.settings.lookaheadMs)) lookMs = art.settings.lookaheadMs;
        sfxCache = {};
        return api;
      },
      playTrack: function (idOrTrack, o) {
        o = o || {};
        var r = typeof idOrTrack === 'string' ? rec(idOrTrack) : idOrTrack;
        if (!isObj(r) || r.kind !== 'track') return false;
        if (play && !o.keep) fadeOut(play, o.crossfadeMs == null ? 250 : o.crossfadeMs);
        var p = startTrack(r, { id: r.id, name: r.name, role: o.role || null }, o);
        if (!p) return false;
        play = p;
        startTimer();
        schedule(play, ctx.currentTime + lookahead());
        return true;
      },
      // The first track whose subject is role music:<key>.
      trackForRole: function (key) {
        var m = art.records && art.records['mus_'] || {}, ks = Object.keys(m).sort();
        for (var i = 0; i < ks.length; i++) { var r = m[ks[i]]; if (isObj(r) && r.kind === 'track' && r.subject && r.subject.ref === 'music:' + key) return r; }
        return null;
      },
      playRole: function (key, o) {
        o = o || {};
        var r = api.trackForRole(key);
        if (!r) return false;
        if (play && !play.ended && play.id === r.id && !o.restart) return true;
        return api.playTrack(r, Object.assign({}, o, { role: key }));
      },
      stop: function (fadeMs) { if (play) { fadeOut(play, fadeMs || 0); play = null; } return true; },
      // playSfx(id or params, {volume, rate, seed}) renders once per parameter set and plays the cached buffer.
      playSfx: function (idOrParams, o) {
        o = o || {};
        var r = typeof idOrParams === 'string' ? rec(idOrParams) : null, params = r ? r.params : idOrParams;
        if (!isObj(params)) return false;
        var seed = num(o.seed, r ? (r.seed >>> 0) || 1 : 1), key = canon(sfxNorm(params)) + '|' + seed, buf = sfxCache[key];
        if (!buf) {
          var data = sfxRender(params, SFX_RATE, seed);
          buf = ctx.createBuffer(1, Math.max(1, data.length), SFX_RATE);
          buf.getChannelData(0).set(data);
          var ks = Object.keys(sfxCache); if (ks.length > 96) delete sfxCache[ks[0]];
          sfxCache[key] = buf;
        }
        var s = ctx.createBufferSource(), g = ctx.createGain(), t = ctx.currentTime;
        s.buffer = buf;
        if (o.rate) s.playbackRate.setValueAtTime(clamp(num(o.rate, 1), 0.25, 4), t);
        g.gain.setValueAtTime(clamp(num(o.volume, 1), 0, 2), t);
        s.connect(g); g.connect(sfxBus);
        s.start(t);
        sfxVoices.push({ s: s, end: t + buf.length / SFX_RATE });
        sfxVoices = sfxVoices.filter(function (v) { return v.end > t; });
        var max = opts.maxSfx || 8;
        while (sfxVoices.length > max) { var old = sfxVoices.shift(); try { old.s.stop(t); } catch (e) { /* ok */ } }
        stats.sfx++;
        return true;
      },
      setVolume: function (v) {
        if (isObj(v)) { if (v.music != null) vols.music = clamp(num(v.music, 0.8), 0, 1); if (v.sfx != null) vols.sfx = clamp(num(v.sfx, 0.9), 0, 1); if (v.muted != null) vols.muted = !!v.muted; }
        applyVol();
        return { music: vols.music, sfx: vols.sfx, muted: vols.muted };
      },
      suspend: function () { try { if (ctx.suspend) ctx.suspend(); } catch (e) { /* ok */ } },
      resume: function () { try { if (ctx.resume) ctx.resume(); } catch (e) { /* ok */ } },
      attachLifecycle: function (doc) {
        if (!doc || !doc.addEventListener) return false;
        doc.addEventListener('visibilitychange', function () { if (doc.hidden) api.suspend(); else api.resume(); });
        return true;
      },
      dispose: function () {
        disposed = true;
        if (timer != null) { T.clearInterval(timer); timer = null; }
        if (play) { fadeOut(play, 0); play = null; }
        sfxVoices.forEach(function (v) { try { v.s.stop(); } catch (e) { /* ok */ } });
        sfxVoices = [];
        if (silentEl) { try { silentEl.pause(); } catch (e) { /* ok */ } silentEl = null; }
        try { master.disconnect(); } catch (e) { /* ok */ }
      },
      tick: tick,
      // What is playing now: the track, the row, and the note each channel sounds at this moment.
      state: function () {
        var t = ctx.currentTime, chans = {};
        CHANNELS.forEach(function (c) { var hit = null; recent[c].forEach(function (x) { if (x.t0 <= t && t < x.t1) hit = x; }); chans[c] = hit ? { n: hit.n, v: hit.v } : null; });
        var pos = null;
        if (play) { var el = Math.max(0, t - play.startedAt); pos = { row: play.row, passes: play.passes, seconds: el }; }
        return { version: VERSION, unlocked: unlocked, ctxState: ctx.state || 'running', playing: play ? { id: play.id, name: play.name, role: play.role, ended: !!play.ended } : null, position: pos, channels: chans, volume: { music: vols.music, sfx: vols.sfx, muted: vols.muted }, lookaheadMs: Math.round(lookahead() * 1000), errors: errors.slice(), stats: { notes: stats.notes, sfx: stats.sfx, ticks: stats.ticks, rows: stats.rows }, timer: timer != null };
      }
    };
    return api;
  }

  return Object.freeze({
    version: VERSION, WHOLE: WHOLE, QUARTER: QUARTER, FPS: FPS, SFX_RATE: SFX_RATE, CHANNELS: CHANNELS, WAVES: WAVES, DUTIES: DUTIES, MIX: MIX,
    create: create,
    mml: Object.freeze({ parse: mmlParse, serialize: mmlSerialize, lengths: lenParts }),
    instrument: Object.freeze({ DEFAULTS: DEFAULT_INS, normalize: insNorm, plan: insPlan, envAt: envAt }),
    waves: Object.freeze({ pulse: pulseCoefs, tri: triCoefs, lfsr: lfsr, noiseRate: noiseRate, midiHz: midiHz }),
    sfxr: Object.freeze({ WAVES: SFX_WAVES, CATEGORIES: SFX_CATEGORIES, PARAMS: SFX_PARAMS, normalize: sfxNorm, render: sfxRender, mutate: sfxMutate, preset: sfxPreset }),
    motif: Object.freeze({ MODES: MODES, KEYS: KEYS, RHYTHMS: RHYTHMS, ACCOMP: ACCOMP, BASS: BASS, DRUMS: DRUMS, VARIATIONS: VARIATIONS, parseDegrees: parseDegrees, parseDurs: parseDurs, realize: realize, generate: generateMotif, keyOf: keyOf }),
    track: Object.freeze({ compile: compile, duration: duration, secPerTick: secPerTick }),
    util: Object.freeze({ rng: rng, hash32: hash32, canon: canon, clamp: clamp }),
    silentSrc: silentSrc
  });
})();
// === ENGINE:AUDIO END ===
