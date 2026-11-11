// Server list: Server List Ping protocol, favourites, featured servers, player count history.
const net = require('net');
const dns = require('dns').promises;
const { paths, readJSON, writeJSON } = require('./util');

const FEATURED = [
  { name: 'Hypixel', address: 'mc.hypixel.net', region: 'NA', tags: ['Minigames', 'SkyBlock', 'Bedwars'], version: '1.8–1.21' },
  { name: 'CubeCraft', address: 'play.cubecraft.net', region: 'EU', tags: ['Minigames', 'SkyWars', 'Eggwars'], version: '1.8–1.21' },
  { name: 'Wynncraft', address: 'play.wynncraft.com', region: 'NA', tags: ['MMORPG', 'Adventure'], version: '1.12–1.21' },
  { name: 'Minemen Club', address: 'minemen.club', region: 'NA', tags: ['PvP', 'Practice'], version: '1.7–1.21' },
  { name: '2b2t', address: '2b2t.org', region: 'NA', tags: ['Anarchy', 'Survival'], version: '1.12–1.21' },
  { name: 'ManaCube', address: 'play.manacube.com', region: 'NA', tags: ['Skyblock', 'Parkour', 'Survival'], version: '1.8–1.21' },
  { name: 'Complex Gaming', address: 'hub.mc-complex.com', region: 'NA', tags: ['Pixelmon', 'Survival', 'Prison'], version: '1.16–1.21' },
  { name: 'GommeHD', address: 'gommehd.net', region: 'EU', tags: ['Minigames', 'Bedwars'], version: '1.8–1.21' },
];

const file = () => paths.file('servers.json');
const load = () => readJSON(file(), { servers: [], history: {} });
const store = (d) => writeJSON(file(), d);

function list() { const d = load(); return { featured: FEATURED, servers: d.servers }; }
function save(server) {
  const d = load();
  if (!server.address) throw new Error('Server address is required');
  const id = server.id || 'srv-' + Date.now().toString(36);
  const next = { name: server.address, favorite: false, ...server, id };
  const i = d.servers.findIndex((s) => s.id === id);
  if (i >= 0) d.servers[i] = { ...d.servers[i], ...next }; else d.servers.push(next);
  store(d);
  return list();
}
function remove(id) { const d = load(); d.servers = d.servers.filter((s) => s.id !== id); store(d); return list(); }
function history(address) { return load().history[address.toLowerCase()] || []; }

function varint(n) { const b = []; n >>>= 0; do { let t = n & 0x7f; n >>>= 7; if (n) t |= 0x80; b.push(t); } while (n); return Buffer.from(b); }
function str(s) { const b = Buffer.from(s, 'utf8'); return Buffer.concat([varint(b.length), b]); }
function packet(id, payload) { const body = Buffer.concat([varint(id), payload]); return Buffer.concat([varint(body.length), body]); }
function readVarint(buf, off) { let n = 0, shift = 0, b; do { if (off >= buf.length) return null; b = buf[off++]; n |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80); return { value: n, off }; }

async function resolve(address) {
  let [host, port] = address.trim().split(':');
  port = parseInt(port, 10);
  if (!port) {
    try { const srv = await dns.resolveSrv('_minecraft._tcp.' + host); if (srv[0]) return { host: srv[0].name, port: srv[0].port, origHost: host }; } catch {}
    port = 25565;
  }
  return { host, port, origHost: host };
}

/** Ping a server. Returns { online, players, version, motd, favicon, latency }. */
async function ping(address, timeout = 5000) {
  const { host, port, origHost } = await resolve(address);
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    let buf = Buffer.alloc(0), started = 0, status = null, done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); resolve(r); };
    const timer = setTimeout(() => finish({ online: false, error: 'Timed out' }), timeout);
    sock.on('error', (e) => finish({ online: false, error: e.code || e.message }));
    sock.on('connect', () => {
      const port16 = Buffer.alloc(2); port16.writeUInt16BE(port);
      sock.write(packet(0, Buffer.concat([varint(767), str(origHost), port16, varint(1)])));
      sock.write(packet(0, Buffer.alloc(0)));
    });
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      const len = readVarint(buf, 0); if (!len) return;
      if (buf.length < len.off + len.value) return;
      const id = readVarint(buf, len.off);
      if (!status && id.value === 0) {
        const sl = readVarint(buf, id.off);
        try { status = JSON.parse(buf.slice(sl.off, sl.off + sl.value).toString('utf8')); } catch { return finish({ online: false, error: 'Bad response' }); }
        buf = buf.slice(len.off + len.value);
        started = Date.now();
        const t = Buffer.alloc(8); t.writeBigInt64BE(BigInt(started));
        sock.write(packet(1, t));
        setTimeout(() => finish(result(status, null)), 1500);
      } else if (status && id.value === 1) {
        finish(result(status, Date.now() - started));
      }
    });
  }).then((r) => { if (r.online) { record(address, r.players.online); try { require('./friends').notePlayers(address, r.players.sample); } catch {} } return r; });
}
function result(s, latency) {
  return {
    online: true, latency,
    players: { online: s.players?.online ?? 0, max: s.players?.max ?? 0, sample: (s.players?.sample || []).map((p) => p.name) },
    version: s.version?.name || '', protocol: s.version?.protocol,
    motd: s.description, favicon: s.favicon || null,
  };
}
function record(address, online) {
  const d = load();
  const k = address.toLowerCase();
  const h = (d.history[k] = d.history[k] || []);
  const now = Date.now();
  if (h.length && now - h[h.length - 1].t < 60000) h[h.length - 1] = { t: now, n: online };
  else h.push({ t: now, n: online });
  while (h.length > 500) h.shift();
  store(d);
}

module.exports = { list, save, remove, ping, history, FEATURED };
