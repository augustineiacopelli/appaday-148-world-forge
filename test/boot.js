// Loads an AppADay forge page in jsdom. Shared by every test.
// opts.engines: script files evaluated in the window before the page parses. World Forge loads engine-render.js and
// engine-audio.js through relative script tags, which jsdom does not fetch, so the tests supply them this way.
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require(path.join(__dirname, 'node_modules', 'jsdom'));

function boot(file, opts) {
  opts = opts || {};
  const html = fs.readFileSync(file, 'utf8');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String(e && (e.stack || e.message) || e)));
  vc.on('error', (...a) => errors.push(a.join(' ')));
  if (opts.verbose) vc.on('log', (...a) => console.log('[page]', ...a));
  const dom = new JSDOM(html, {
    url: opts.url || 'https://augustineiacopelli.github.io/appaday/146/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(win) {
      win.TextEncoder = win.TextEncoder || require('util').TextEncoder;
      win.TextDecoder = win.TextDecoder || require('util').TextDecoder;
      win.matchMedia = win.matchMedia || function (q) {
        return { matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
      };
      if (opts.storage) Object.keys(opts.storage).forEach((k) => win.localStorage.setItem(k, opts.storage[k]));
      // opts.indexedDB: true for a fresh fake database, or a shared IDBFactory so a second boot sees the first one's data.
      if (opts.indexedDB) { const fi = require(path.join(__dirname, 'node_modules', 'fake-indexeddb')); win.indexedDB = opts.indexedDB === true ? new fi.IDBFactory() : opts.indexedDB; win.IDBKeyRange = fi.IDBKeyRange; }
      win.fetch = () => Promise.reject(new Error('offline test'));
      win.HTMLCanvasElement.prototype.getContext = function () { return null; };
      (opts.engines || []).forEach((f) => win.eval(fs.readFileSync(f, 'utf8')));
      if (opts.setup) opts.setup(win);
    }
  });
  return { dom, win: dom.window, errors };
}
module.exports = { boot };
