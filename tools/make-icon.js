// Generates assets/icon.png (a stylised sun) without any image libraries.
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const S = 512, px = Buffer.alloc(S * S * 4);
const mix = (a, b, t) => a + (b - a) * t;
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const dx = x - S / 2 + 0.5, dy = y - S / 2 + 0.5, r = Math.hypot(dx, dy) / (S / 2), ang = Math.atan2(dy, dx);
  let R = 0, G = 0, B = 0, A = 0;
  // rays
  const ray = Math.pow(Math.max(0, Math.cos(ang * 12)), 6);
  if (r < 0.98 && r > 0.55) { const a = ray * (1 - (r - 0.55) / 0.43); R = 255; G = 140; B = 30; A = a * 255; }
  // glow
  const glow = Math.max(0, 1 - r / 0.75); if (glow > 0) { const ga = Math.pow(glow, 2) * 200; if (ga > A) { R = 255; G = 120; B = 40; A = ga; } }
  // core
  if (r < 0.5) { const t = Math.min(1, r / 0.5); R = 255; G = mix(225, 120, t); B = mix(110, 20, t); A = 255;
    // eclipse ring cut for a "Solaris" look
    const ex = dx - S * 0.09, ey = dy + S * 0.07, er = Math.hypot(ex, ey) / (S / 2);
    if (er < 0.36) { const e = Math.min(1, (0.36 - er) / 0.02); R = mix(R, 22, e); G = mix(G, 15, e); B = mix(B, 30, e); }
    const edge = Math.min(1, (0.5 - r) * S / 4); A = 255 * edge; }
  const i = (y * S + x) * 4; px[i] = R; px[i + 1] = G; px[i + 2] = B; px[i + 3] = Math.max(0, Math.min(255, A));
}
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.png'), png);
console.log('icon.png written', png.length, 'bytes');
