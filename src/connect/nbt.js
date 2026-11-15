// Reads Minecraft's binary save format (NBT: level.dat, playerdata/<uuid>.dat …). Read-only, Java Edition,
// big-endian, gzip / zlib / uncompressed. Spec: https://minecraft.wiki/w/NBT_format
//
// Values become plain JavaScript: compounds → objects, lists → arrays, numbers → numbers (a long that doesn't fit a
// JS number exactly stays a BigInt), byte/int/long arrays → arrays of numbers, strings → strings ("Modified UTF-8").
const zlib = require('zlib');

const MAX_DEPTH = 512; // what Minecraft itself allows

function decompress(buf) {
  if (buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf);
  if (buf[0] === 0x78) { try { return zlib.inflateSync(buf); } catch {} }
  return buf;
}

/** Java's "Modified UTF-8": like UTF-8, but NUL is 0xC0 0x80 and characters past U+FFFF are two 3-byte surrogates. */
function mutf8(b) {
  let out = '', i = 0;
  while (i < b.length) {
    const c = b[i++];
    if (c < 0x80) out += String.fromCharCode(c);
    else if ((c & 0xe0) === 0xc0) out += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f));
    else { const c2 = b[i++], c3 = b[i++]; out += String.fromCharCode(((c & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f)); }
  }
  return out;
}

function parse(input) {
  const buf = decompress(Buffer.isBuffer(input) ? input : Buffer.from(input));
  let o = 0;
  const need = (n) => { if (o + n > buf.length) throw new Error('This save file is cut off or damaged.'); };
  const long = () => { need(8); const v = buf.readBigInt64BE(o); o += 8; return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v; };
  const str = () => { need(2); const n = buf.readUInt16BE(o); o += 2; need(n); const s = mutf8(buf.subarray(o, o + n)); o += n; return s; };
  const count = () => { need(4); const n = buf.readInt32BE(o); o += 4; if (n < 0 || n > buf.length) throw new Error('This save file is damaged (bad length).'); return n; };
  function payload(type, depth) {
    if (depth > MAX_DEPTH) throw new Error('This save file is nested too deep.');
    switch (type) {
      case 1: need(1); return buf.readInt8(o++);
      case 2: { need(2); const v = buf.readInt16BE(o); o += 2; return v; }
      case 3: { need(4); const v = buf.readInt32BE(o); o += 4; return v; }
      case 4: return long();
      case 5: { need(4); const v = buf.readFloatBE(o); o += 4; return v; }
      case 6: { need(8); const v = buf.readDoubleBE(o); o += 8; return v; }
      case 7: { const n = count(); need(n); const a = Array.from(buf.subarray(o, o + n), (x) => (x << 24) >> 24); o += n; return a; }
      case 8: return str();
      case 9: { need(1); const t = buf[o++]; const n = count(); const a = new Array(n); for (let i = 0; i < n; i++) a[i] = payload(t, depth + 1); return a; }
      case 10: {
        const obj = {};
        for (;;) {
          need(1); const t = buf[o++];
          if (t === 0) return obj;
          const name = str();
          obj[name] = payload(t, depth + 1);
        }
      }
      case 11: { const n = count(); need(n * 4); const a = new Array(n); for (let i = 0; i < n; i++) { a[i] = buf.readInt32BE(o); o += 4; } return a; }
      case 12: { const n = count(); need(n * 8); const a = new Array(n); for (let i = 0; i < n; i++) a[i] = long(); return a; }
      default: throw new Error(`This isn’t a Minecraft save file (unknown tag ${type}).`);
    }
  }
  need(1);
  const rootType = buf[o++];
  if (rootType !== 10) throw new Error('This isn’t a Minecraft save file.');
  const name = str();
  const value = payload(10, 0);
  return { name, value };
}

/** Reads a file and returns its root compound. */
function readFile(file) { return parse(require('fs').readFileSync(file)).value; }

module.exports = { parse, readFile, mutf8 };
