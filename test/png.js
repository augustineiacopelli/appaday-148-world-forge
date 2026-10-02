// Writes an overworld as a PNG (biome colors, stamps dark, gates by kind) with nothing but zlib, for the build log.
'use strict';
const zlib = require('zlib');
const fs = require('fs');
const COL = { ocean: '2f5f9a', coast: 'd9c48a', swamp: '4f6a3a', grassland: '6aa84f', steppe: 'b8a85a', desert: 'e0c070', forest: '2f7a3a', rainforest: '1d5a2c', tundra: '9aa8a0', snow: 'eef2f5', mountain: '7a7068', volcanic: 'b0402a' };
const GATE = { pass: [245, 209, 66], landing: [63, 208, 224], seawall: [240, 138, 60], lock: [224, 74, 208] };
const hex = (s) => [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4), 16)];
const TABLE = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc(buf) { let x = 0xffffffff; for (const b of buf) x = TABLE[(x ^ b) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); }
function write(file, ow, pal, scale) {
  scale = scale || 3;
  const px = ow.ground.map((r, i) => {
    if (ow.gateAt[i] >= 0) return GATE[ow.gates[ow.gateAt[i]].kind] || [255, 255, 255];
    if (i === ow.start) return [255, 255, 255];
    if (String(r).indexOf(':') >= 0) return i === (ow.sites.filter((s) => s.entrance === i)[0] || {}).entrance ? [255, 246, 216] : [24, 20, 16];
    const b = pal.biomes[r];
    return b && COL[b.key] ? hex(COL[b.key]) : [120, 40, 40];
  });
  const W = ow.w * scale, H = ow.h * scale, raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = px[Math.floor(y / scale) * ow.w + Math.floor(x / scale)], o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
// Writes one interior floor (tile keys colored, chests, locks, bosses, exits marked) for the build log.
const KEYC = { wall: '3a332e', door: '9a6a34', stairs: 'e8d48a', counter: 'b0643a', table: '7a5636', barrel: '6e4a2a', bed: 'b25a6a', shelf: '5e4630', rug: 'a8473f', plant: '3f8a4a', lintel: '9a6a34', arch: '9a6a34', pillar: '8c8c94', torch: 'f0983c', chest: 'f5c542' };
function writeGrid(file, fl, scale) {
  scale = scale || 6;
  const mark = {};
  fl.features.forEach((f) => { mark[f.at] = f.kind === 'lock' ? [224, 74, 208] : f.kind === 'boss' ? [224, 68, 58] : null; });
  fl.exits.forEach((e) => { mark[e.at] = [63, 208, 224]; });
  const px = fl.ground.map((g, i) => {
    if (mark[i]) return mark[i];
    const d = fl.deco[i], dk = d ? String(d).split(':')[1] : null, k = String(g).split(':')[1];
    if (dk && KEYC[dk]) return hex(KEYC[dk]);
    if (String(g).indexOf(':') < 0) return /desert/.test(g) ? hex('e0c070') : hex('6aa84f');
    if (k === 'floor') return /town/.test(g) ? hex('c8a46c') : hex('6c7079');
    return hex(KEYC[k] || '888888');
  });
  const W = fl.w * scale, H = fl.h * scale, raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = px[Math.floor(y / scale) * fl.w + Math.floor(x / scale)], o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
module.exports = { write, writeGrid };
