// Shared loader for the World Forge page under jsdom: supplies the two vendored engines the page loads by script tag.
'use strict';
const path = require('path');
const { boot } = require('./boot');
const ROOT = path.join(__dirname, '..');
const APP148 = path.join(ROOT, 'index.html');
const ENGINES = [path.join(ROOT, 'engine-render.js'), path.join(ROOT, 'engine-audio.js')];
const URL148 = 'https://augustineiacopelli.github.io/appaday-148-world-forge/';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function boot148(opts) {
  opts = Object.assign({ url: URL148 + (opts && opts.dev === false ? '' : '?dev=1') }, opts || {});
  const r = boot(APP148, Object.assign({}, opts, { engines: ENGINES }));
  await wait(60);
  if (r.win.WORLD && r.win.WORLD.booted) await r.win.WORLD.booted;
  return r;
}
module.exports = { boot148, ROOT, APP148, ENGINES, URL148, wait };
