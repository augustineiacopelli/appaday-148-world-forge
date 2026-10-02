# World Forge (AppADay 148)

World Forge takes a Saga Forge bundle (Day 146) dressed by Art and Audio Forge (Day 147) and grows its world from one seed: a progression graph per chapter, an overworld of continents and climate biomes with gated mountain passes, towns, castles, dungeons, and caves with their people, and encounter zones. It proves every chapter can be walked in order, writes only the world namespace (plus each side quest's giver), and exports a bundle Days 146 and 147 still open, with a manifest and `engine-world.js` for Day 150.

Live: https://augustineiacopelli.github.io/appaday-148-world-forge/ (add `?dev=1` for the fixture loaders).

Part of [AppADay](https://augustineiacopelli.github.io/appaday/), and the third of four forges (146 rules, 147 art and audio, 148 world, 149 story) that feed the Day 150 RPG.

## Using it

1. **Start.** Load a Day 147 Final export, open the Day 147 draft left in this browser, or load the demo. The import gate refuses a bundle without a locked Charter or without Day 147 art and says why. Lay out the progression: for each chapter a start town, a key dungeon, the lock it opens, the boss dungeon, and the exit that needs the next chapter's key, then optional caves and a second town. Pick or reroll the seed; world IDs never change on a reroll.
2. **World.** Generate the overworld and look at it in real tiles or through the biome, elevation, temperature, moisture, region, and zone overlays, with gates and sites marked. Drag to pan, pinch or use the buttons to zoom, tap a cell to inspect it, and paint any non water biome onto open land (a paint that would break the walk is refused with the reason). Each continent has radius, ruggedness, and mountain share sliders and plays its field music when Day 147 scored it.
3. **Sites.** Generate the interiors and open any town, castle, dungeon, or cave floor by floor, with exits, stairs, the key chest, the locked door, the boss, and every person on their sprite.
4. **Encounters.** Generate the zones: one table per continent, chapter, and biome over walkable land, one per dungeon and cave floor, bosses on their boss rooms, and a giver for each side quest. Edit any zone's rate and weights; only the difference is stored, and Back to generated undoes it.
5. **Validation.** Every reference resolves, every chapter's sites, keys, and boss are reachable with what earlier chapters granted and no golden key is reachable early, every map's tiles carry the flags play depends on, and every zone can start a battle. Failing cards come first and jump to the cell.
6. **Export.** Draft is always allowed. Final opens the world namespace for Days 149 and 150 and is allowed only when every check passes and the world is current. Turn on **Bake the maps into the bundle** to store every map's tile layers so Day 150 can draw them without generating.

## What an export holds

| File | What it is |
| --- | --- |
| `<slug>-bundle.json` | The Saga Bundle with the world namespace: `seed`, `settings`, `records` (`map_` `reg_` `npc_` `twn_` `dgn_`), `progression`, `zones`, `overrides` (painted cells and zone edits), and `baked`. Every other namespace is byte for byte what came in, except the side quest givers this forge fills. |
| `<slug>-world-manifest.json` | Forge 148, the bundle hash, generator version, seed, every world ID created, every ID referenced, unresolved IDs (always empty for a Final), counts, the validation summary, the proofs, and the bake status. |
| `engine-world.js` | The generators and checks as one global, `ENGINE_WORLD`, under a header carrying the bundle hash. It reads no host global; Day 150 loads it beside Day 147's `engine-render.js`. |

Maps are never stored by default: each regenerates from the seed, the settings, the progression, and the art, and its `map_` record keeps the `paramHash` of everything it was made from, so a stale map is caught. The bake (format `rle1`) is one sorted palette of tile refs and run length encoded ground and decoration layers per map. `ENGINE_WORLD.bake.load(bundle, mapId)` returns a baked map only when the generator version and the map's `paramHash` both match and the cells digest agrees; on `null`, regenerate. The demo's bake adds about 22 KB, the four continent fixture's about 51 KB.

Gates use world local keys (`chapter:<chp id>`, `vehicle:ship`, `vehicle:airship`, `item:<key>`) that Day 149 binds to its own flags and items. World IDs come from structural keys such as `dgn|ch2|boss`, never from the seed.

## Status

| Phase | What | State |
| --- | --- | --- |
| 0 | Scaffold, world namespace, import gate, export, storage, Day 146 and 147 round trip | Done |
| 1 | Deterministic core in ENGINE:WORLD: seeded generators, simplex noise, octaves, bands, IDs, climate table | Done |
| 2 | Progression graph: golden path per chapter, ship and airship, optional branches, reg_ twn_ dgn_ records | Done |
| 3 | Continents and the overworld: climate, regions, ridges and passes, sea rings and landings, locks, site stamps, the map_ record, the World tab | Done |
| 4 | Interiors: towns, BSP dungeons and castles, caves, map_ per floor, npc_ per person, two way exits, the Sites tab | Done |
| 5 | Encounter zones per continent, chapter, and biome, one per dungeon and cave floor, bosses and guardians, side quest givers, the Encounters tab | Done |
| 6 | Validation: references, the per chapter walk, map flags, zones, the Final gate, the Validation tab | Done |
| 7 | Interface: tile previews with pan and pinch, overlays, the tap inspector and painted cells, per continent controls, editable zones, field music, the Web Worker | Done |
| 8 | Export and ship: the optional bake, the definition of done suite | Done |

`src/build-log.txt` records every decision; it is also the comment at the top of `index.html`.

## Working on it

Clone this repo next to `appaday-146-saga-forge` and `appaday-147-art-and-audio-forge`, then:

```
node build.js
cd test && npm install
node make-demo.js   # only when the fixtures need rebuilding from Day 147
for p in 0 1 2 3 4 5 6 7 8; do node phase$p.js | tail -1; done
```

`test/phase8.js` is the definition of done: both fixtures import cleanly, one seed grows an identical world in two pages, every map renders and flags correctly, every check passes, prior namespaces are unchanged, a fresh context holding only the exported engines regenerates every map with its record's digest and loads every baked map, and Days 146 and 147 open the Final bundle with zero broken references. 519 checks pass across the nine suites.

`test/layout.js` audits every view at 390 and 1280 wide in headless Chromium. Playwright is not in package.json: install a version that matches the local Chromium build in a scratch folder and run with `NODE_PATH` pointing at its node_modules (and `PLAYWRIGHT_BROWSERS_PATH` if the browsers live elsewhere).

`build.js` copies KIT:CORE from Day 146 byte for byte and checks the vendored `engine-render.js` and `engine-audio.js` against Day 147 byte for byte. World Forge never edits either engine.

## License

MIT. See `LICENSE`.
