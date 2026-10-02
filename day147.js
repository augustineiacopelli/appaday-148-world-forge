// Finds a clone of Day 147 (appaday-147-art-and-audio-forge). It is never committed here: build.js checks the vendored
// engine-render.js and engine-audio.js against it byte for byte, and the tests boot its index.html.
// Looks for a folder named app147 at the repo root, then a sibling clone.
'use strict';
const fs = require('fs');
const path = require('path');
const CANDIDATES = [
  path.join(__dirname, 'app147'),
  path.join(__dirname, '..', 'appaday-147-art-and-audio-forge'),
  path.join(__dirname, '..', 'augustineiacopelli', 'appaday-147-art-and-audio-forge')
];
const found = CANDIDATES.find((p) => fs.existsSync(path.join(p, 'index.html')) && fs.existsSync(path.join(p, 'engine-render.js')));
if (!found) throw new Error('Day 147 not found. Clone https://github.com/augustineiacopelli/appaday-147-art-and-audio-forge next to this repo, or copy it here as app147/.');
module.exports = found;
