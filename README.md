# World Forge (AppADay 148)

World Forge takes a Saga Forge bundle (Day 146) dressed by Art and Audio Forge (Day 147) and grows its world from one seed: a progression graph per chapter, an overworld of continents and climate biomes with gated passes, towns, castles, dungeons, and caves, and encounter zones. It writes only the world namespace (plus each side quest's giver) and exports a bundle Days 146 and 147 still open, with a manifest and `engine-world.js` for Day 150.

Live: https://augustineiacopelli.github.io/appaday-148-world-forge/ (add `?dev=1` for the fixture loaders).

## Status

| Phase | What | State |
| --- | --- | --- |
| 0 | Scaffold, world namespace, import gate, export, storage, Day 146 and 147 round trip | Done |
| 1 | Deterministic core in ENGINE:WORLD: seeded generators, simplex noise, octaves, bands, IDs, climate table | Done |
| 2 | Progression graph | Next |
| 3 | Continents and the overworld | |
| 4 | Interiors | |
| 5 | Encounter zones and side quest givers | |
| 6 | Validation | |
| 7 | Interface | |
| 8 | Export and ship | |

`src/build-log.txt` records every decision; it is also the comment at the top of `index.html`.

## Working on it

Clone this repo next to `appaday-146-saga-forge` and `appaday-147-art-and-audio-forge`, then:

```
node build.js
cd test && npm install
node make-demo.js   # only when the fixtures need rebuilding from Day 147
node phase0.js && node phase1.js
```

`build.js` copies KIT:CORE from Day 146 byte for byte and checks the vendored `engine-render.js` and `engine-audio.js` against Day 147 byte for byte. World Forge never edits either engine.
