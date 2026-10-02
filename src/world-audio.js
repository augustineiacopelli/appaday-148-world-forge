// === WORLD:AUDIO BEGIN ===
(function () {
  'use strict';
  // Field music audition (Phase 7). Day 147's player is created the first time someone presses Play, inside that click,
  // the way Day 147 does it: an AudioContext, ENGINE_AUDIO.create, load(bundle.art), unlock, then playRole with the
  // continent's role field:<slug>. One player for the page; loading another bundle stops it and reloads the art.
  var host = { ctx: null, audio: null, art: null, error: null, slug: null };
  function supported() { return typeof window.AudioContext === 'function' || typeof window.webkitAudioContext === 'function'; }
  function coarse() { try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (e) { return false; } }
  // The track for a role, read from the art the way the player reads it (subject music:<role>, kind track, by ID).
  function track(b, role) {
    var m = (b && b.art && b.art.records && b.art.records.mus_) || {}, ids = Object.keys(m).sort();
    for (var i = 0; i < ids.length; i++) { var r = m[ids[i]]; if (r && r.kind === 'track' && r.subject && r.subject.ref === 'music:' + role) return r; }
    return null;
  }
  // Call inside a click or pointerup handler.
  function unlock(b) {
    if (host.audio) {
      if (b && host.art !== b.art) { host.audio.load(b.art); host.art = b.art; }
      host.audio.unlock();
      return host.audio;
    }
    if (!supported()) { host.error = 'This browser has no Web Audio.'; return null; }
    try {
      var C = window.AudioContext || window.webkitAudioContext;
      host.ctx = new C();
      host.audio = ENGINE_AUDIO.create(host.ctx, { coarse: coarse(), navigator: window.navigator, createAudioElement: function () { return document.createElement('audio'); },
        lookaheadMs: b && b.art && b.art.settings && b.art.settings.lookaheadMs });
      host.audio.attachLifecycle(document);
      host.audio.load(b && b.art);
      host.art = b && b.art;
      host.audio.unlock();
      return host.audio;
    } catch (e) { host.error = e.message; host.audio = null; return null; }
  }
  function play(b, slug) {
    var a = unlock(b);
    if (!a) return false;
    var ok = a.playRole('field:' + slug, { restart: true });
    host.slug = ok ? slug : null;
    return ok;
  }
  function stop() { if (host.audio && host.slug) host.audio.stop(350); host.slug = null; }
  Kit.on('load', function () { stop(); if (host.audio) { var b = Kit.bundle.current(); host.audio.load(b && b.art); host.art = b && b.art; } });
  WORLD.audio = {
    supported: supported, track: track, unlock: unlock, play: play, stop: stop,
    playing: function () { return host.slug; },
    error: function () { return host.error; },
    player: function () { return host.audio; }
  };
})();
// === WORLD:AUDIO END ===
