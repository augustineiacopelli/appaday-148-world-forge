// Day 146 and Day 147 compatibility probes. Each call boots a fresh page of that forge, imports a bundle, and reports
// what the forge makes of it.
'use strict';
const path = require('path');
const { boot } = require('./boot');

const APP146 = require('../day146');
const APP147 = path.join(require('../day147'), 'index.html');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function inForge(file, url, bundleText, fn) {
  const { win, errors } = boot(file, { url });
  await wait(40);
  if (win.ART && win.ART.booted) await win.ART.booted;
  const Kit = win.Kit;
  let r;
  try { r = Kit.bundle.importText(bundleText); } catch (e) { return { rejected: e.message }; }
  const res = Kit.refreshValidation();
  const out = { matches: r.matches, summary: Kit.validate.summary(res), errors: res.errors.map((x) => x.recordId + ' ' + x.fieldPath + ': ' + x.message), broken: res.broken.map((x) => x.id), pageErrors: errors.slice(0, 3) };
  if (fn) Object.assign(out, await fn(win, Kit, res));
  return out;
}
const in146 = (text, fn) => inForge(APP146, 'https://augustineiacopelli.github.io/appaday-146-saga-forge/', text, fn);
const in147 = (text, fn) => inForge(APP147, 'https://augustineiacopelli.github.io/appaday-147-art-and-audio-forge/', text, fn);

// Restamps the content hash with Day 146's own algorithm (KIT:CORE is verbatim in every forge).
async function stamp(bundle) {
  const { win } = boot(APP146);
  await wait(30);
  bundle.kit.contentHash = win.Kit.bundle.hash(bundle);
  return JSON.stringify(bundle, null, 2);
}

module.exports = { in146, in147, stamp, APP146, APP147 };
