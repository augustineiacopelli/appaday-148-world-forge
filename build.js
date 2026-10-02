// Assembles index.html: KIT:CORE CSS and JS copied byte for byte from Day 146, the vendored Day 147 engines checked byte
// for byte against the Day 147 repository, then the Day 148 fences. Also writes engine-world.js from the ENGINE:WORLD fence.
// node build.js             build (fails if a vendored engine differs from Day 147's)
// node build.js --revendor  copy Day 147's engine-render.js and engine-audio.js over the vendored copies first
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const R = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(__dirname, p));
const src146 = fs.readFileSync(require('./day146'), 'utf8');
const dir147 = require('./day147');

function fence(text, open, close) {
  const a = text.indexOf(open), z = text.indexOf(close);
  if (a < 0 || z < 0) throw new Error('Fence not found: ' + open);
  return text.slice(a, z + close.length);
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// 1. Vendored engines. They are never edited here: Day 147 owns them.
const VENDORED = ['engine-render.js', 'engine-audio.js'];
VENDORED.forEach((f) => {
  const theirs = fs.readFileSync(path.join(dir147, f), 'utf8');
  if (process.argv.includes('--revendor') || !exists(f)) fs.writeFileSync(path.join(__dirname, f), theirs);
  const ours = R(f);
  if (ours !== theirs) { console.error(f + ' differs from Day 147 (' + sha(ours).slice(0, 12) + ' here, ' + sha(theirs).slice(0, 12) + ' in Day 147). Run node build.js --revendor to take Day 147\'s copy.'); process.exit(1); }
  console.log(f, ours.length, 'chars, byte equal to Day 147, sha256', sha(ours).slice(0, 16));
});

// 2. Fences.
const kitCss = fence(src146, '/* === KIT:CORE CSS BEGIN === */', '/* === KIT:CORE CSS END === */');
const kitJs = fence(src146, '// === KIT:CORE BEGIN ===', '// === KIT:CORE END ===');
// Embedded JSON: '</' is escaped so no string can close the script element; anything outside ASCII becomes \uXXXX.
const embed = (file) => JSON.stringify(JSON.parse(R(file))).replace(/<\//g, '<\\/').replace(/[\u007f-￿]/g, (c) => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4));
const demoSrc = R('src/world-demo.js').replace('/*DEMO_JSON*/null', () => embed('test/out/demo147-bundle.json')).replace('/*FOUR_JSON*/null', () => embed('test/out/four147-bundle.json'));
const buildLog = R('src/build-log.txt');
// ENGINE:WORLD is one fence in the output. Later phases keep their engine sections in their own source files, spliced in
// order above the freeze line, so each phase's engine code stays readable on its own.
const ENGINE_SECTIONS = ['src/engine-progression.js', 'src/engine-overworld.js', 'src/engine-interiors.js', 'src/engine-zones.js', 'src/engine-checks.js'].filter(exists);
const FREEZE = '  // ---------------------------------------------------------------- later phases insert sections above this line';
const engineBase = R('src/engine-world.js');
if (engineBase.split(FREEZE).length !== 2) throw new Error('ENGINE:WORLD freeze marker not found exactly once.');
const engineWorld = engineBase.replace(FREEZE, () => ENGINE_SECTIONS.map((f) => R(f).replace(/\s+$/, '') + '\n\n').join('') + FREEZE).trim();
// Workspace fences arrive with later phases; each is optional until its phase.
const CSS_FENCES = ['src/world-map.css', 'src/world-sites.css', 'src/world-encounters.css', 'src/world-validation.css'].filter(exists);
const JS_FENCES = ['src/world-generate.js', 'src/ws-world.js', 'src/ws-sites.js', 'src/ws-encounters.js', 'src/ws-validation.js'].filter(exists);

const html = `<!--
${buildLog.trim()}
-->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>World Forge | AppADay 148</title>
<meta name="description" content="World Forge: grow a seeded overworld, towns, dungeons, caves, and encounter zones from a Saga Forge bundle dressed by Art and Audio Forge. AppADay 148.">
<meta name="theme-color" content="#10121a">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Alegreya+Sans:ital,wght@0,400;0,500;0,700;0,800;1,400&family=Cinzel:wght@500;700&display=swap" rel="stylesheet">
<style>
${kitCss}
${R('src/world-shell.css').trim()}
${CSS_FENCES.map((f) => R(f).trim()).join('\n')}
</style>
</head>
<body>
<div class="app" id="app">
  <header class="app-head">
    <div class="brand">
      <h1 class="brand-title">World Forge</h1>
      <span class="brand-num">App 148</span>
    </div>
    <a class="backlink" href="https://augustineiacopelli.github.io/appaday/" title="Back to the AppADay portfolio">&larr; AppADay</a>
    <button class="btn btn-ghost btn-icon" id="btnTheme" type="button" aria-label="Toggle night and parchment theme" title="Toggle theme"></button>
    <button class="btn btn-ghost btn-icon" id="btnSettings" type="button" aria-label="Settings" title="Settings"></button>
  </header>
  <div class="topbar" role="toolbar" aria-label="Project">
    <button class="btn btn-ghost proj-title" id="btnTitle" type="button" title="Rename project"><span class="t">Untitled Saga</span></button>
    <button class="btn size-btn" id="btnSize" type="button" aria-label="Bundle size"></button>
    <button class="btn vbadge" id="btnValidation" type="button" title="Open validation panel" aria-label="Validation status"></button>
    <div class="top-actions">
      <button class="btn" id="btnSave" type="button" title="Save draft (Ctrl+S)"></button>
      <button class="btn" id="btnSlots" type="button" title="Project slots"></button>
      <button class="btn" id="btnImport" type="button" title="Import a bundle"></button>
      <button class="btn" id="btnExport" type="button" title="Export the bundle"></button>
    </div>
    <input type="file" id="fileImport" accept=".json,application/json" hidden>
  </div>
  <div class="store-banner" id="storeBanner" role="alert" hidden><span>This browser refused to save the draft because storage is full. Export the bundle now so no work is lost.</span><button class="btn btn-primary" id="btnBannerExport" type="button">Export now</button></div>
  <nav class="tabs" id="tabs" role="tablist" aria-label="Workspaces"></nav>
  <main class="ws" id="ws" tabindex="-1"></main>
  <footer class="app-foot">
    <span>World Forge &middot; AppADay 148</span>
    <a class="backlink" href="https://augustineiacopelli.github.io/appaday/">augustineiacopelli.github.io/appaday</a>
  </footer>
</div>
<div id="overlays"></div>
<div class="toast-root" id="toasts" aria-live="polite" role="status"></div>
<script src="engine-render.js"></script>
<script src="engine-audio.js"></script>
<script>
${kitJs}
${R('src/world-store.js').trim()}
${demoSrc.trim()}
${engineWorld}
${JS_FENCES.map((f) => R(f).trim()).join('\n')}
${R('src/ws-world148.js').trim()}
${R('src/app-boot.js').trim()}
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
const out = R('index.html');
const same = fence(out, '// === KIT:CORE BEGIN ===', '// === KIT:CORE END ===') === kitJs && fence(out, '/* === KIT:CORE CSS BEGIN === */', '/* === KIT:CORE CSS END === */') === kitCss;
console.log('index.html', out.length, 'chars,', out.split('\n').length, 'lines; KIT:CORE verbatim:', same);
if (!same) process.exit(1);

// 3. engine-world.js: the ENGINE:WORLD fence under a header. WORLD.engines cuts the same fence out of the page at run time
// and adds the same header, with the bundle hash line when a bundle is exported. This repository copy carries no hash.
const open = '// === ENGINE:WORLD BEGIN ===', close = '// === ENGINE:WORLD END ===';
const a = out.indexOf(open), z = out.indexOf(close);
if (a < 0 || z < a || out.indexOf(open, a + 1) >= 0) throw new Error('ENGINE:WORLD fence not found exactly once.');
const engSrc = out.slice(a, z + close.length) + '\n';
const ver = /var W = \{ version: '([^']+)' \}/.exec(engSrc);
if (!ver) throw new Error('No version in ENGINE:WORLD.');
const header = '/* World Forge ENGINE:WORLD, engine version ' + ver[1] + '\n' +
  ' * Forge 148 (AppADay 148). Declares one global, ENGINE_WORLD. No dependencies; reads no host global. */\n';
fs.writeFileSync(path.join(__dirname, 'engine-world.js'), header + engSrc);
console.log('engine-world.js', (header + engSrc).length, 'chars, version', ver[1]);
