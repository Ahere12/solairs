// A small NBT writer, only for making test save files (Astra itself only reads them).
const T = { byte: 1, short: 2, int: 3, long: 4, float: 5, double: 6, bytes: 7, string: 8, list: 9, compound: 10, ints: 11, longs: 12 };
function enc(type, v) {
  const b = (n) => Buffer.alloc(n);
  switch (type) {
    case T.byte: { const x = b(1); x.writeInt8(v); return x; }
    case T.short: { const x = b(2); x.writeInt16BE(v); return x; }
    case T.int: { const x = b(4); x.writeInt32BE(v); return x; }
    case T.long: { const x = b(8); x.writeBigInt64BE(BigInt(v)); return x; }
    case T.float: { const x = b(4); x.writeFloatBE(v); return x; }
    case T.double: { const x = b(8); x.writeDoubleBE(v); return x; }
    case T.string: { const s = Buffer.from(v, 'utf8'); const x = b(2); x.writeUInt16BE(s.length); return Buffer.concat([x, s]); }
    case T.ints: { const x = b(4 + v.length * 4); x.writeInt32BE(v.length); v.forEach((n, i) => x.writeInt32BE(n, 4 + i * 4)); return x; }
    case T.list: { const [et, items] = v; const x = b(5); x[0] = et; x.writeInt32BE(items.length, 1); return Buffer.concat([x, ...items.map((i) => enc(et, i))]); }
    case T.compound: return Buffer.concat([...Object.entries(v).map(([k, [t, val]]) => Buffer.concat([Buffer.from([t]), enc(T.string, k), enc(t, val)])), Buffer.from([0])]);
    default: throw new Error('type ' + type);
  }
}
const root = (obj) => Buffer.concat([Buffer.from([T.compound]), enc(T.string, ''), enc(T.compound, obj)]);

module.exports = { T, enc, root };
