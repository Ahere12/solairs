// Astra Connect — waypoints & coordinate sharing.
//   · Your waypoints are kept on this PC (waypoints.json in the data folder), grouped by place: a server you host,
//     one of your singleplayer worlds, a saved server, or anywhere.
//   · Places come from real save data too: a player's position, last death point and bed/respawn point, and the world
//     spawn (read with the NBT reader; see the field names below).
//   · Sharing is a code (ASTRA-WP-…) or plain text you send through any chat; there is no online Astra service.
//   · On a server you host that is running, Astra can teleport a player to a waypoint (/tp) or post it in chat (/say).
//
// Save fields (Java): level.dat Data.spawn {pos:[x,y,z], dimension} (1.21.9+) or Data.SpawnX/Y/Z (older);
// player LastDeathLocation {pos, dimension} (1.19+); player respawn {pos, dimension} (1.21.5+) or SpawnX/Y/Z +
// SpawnDimension (older); player Pos [x,y,z] + Dimension.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const util = () => require('../util');
const file = () => util().paths.file('waypoints.json');
const load = () => { const l = util().readJSON(file(), []); return Array.isArray(l) ? l : []; };
const store = (l) => util().writeJSON(file(), l);

const DIMS = { overworld: 'minecraft:overworld', nether: 'minecraft:the_nether', the_nether: 'minecraft:the_nether', end: 'minecraft:the_end', the_end: 'minecraft:the_end' };
const DIM_NAMES = { 'minecraft:overworld': 'Overworld', 'minecraft:the_nether': 'Nether', 'minecraft:the_end': 'The End' };
const COLORS = ['#7c9cff', '#4ade80', '#fbbf24', '#f87171', '#c084fc', '#22d3ee', '#ffffff'];
const LIMIT = 30000000; // the world border

function dimOf(d) {
  if (d == null || d === '') return 'minecraft:overworld';
  if (typeof d === 'number') return d === -1 ? 'minecraft:the_nether' : d === 1 ? 'minecraft:the_end' : 'minecraft:overworld';
  const s = String(d).toLowerCase().trim();
  if (DIMS[s]) return DIMS[s];
  if (/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(s)) return s; // modded dimensions keep their id
  return 'minecraft:overworld';
}
const coord = (v, label) => { const n = Math.round(Number(v)); if (!Number.isFinite(n) || Math.abs(n) > LIMIT) throw new Error(`${label} must be a number between -30,000,000 and 30,000,000.`); return n; };

/** Checks and cleans one waypoint (from the page, a code, or save data). */
function clean(w) {
  const name = String(w?.name || '').replace(/[\r\n]/g, ' ').trim().slice(0, 40);
  if (!name) throw new Error('Give the waypoint a name.');
  const out = {
    id: /^[a-z0-9]{6,16}$/.test(w.id || '') ? w.id : Math.random().toString(36).slice(2, 10),
    name, x: coord(w.x, 'X'), y: w.y === '' || w.y == null ? null : Math.max(-2048, Math.min(4096, coord(w.y, 'Y'))), z: coord(w.z, 'Z'),
    dimension: dimOf(w.dimension), place: String(w.place || '').slice(0, 200), color: COLORS.includes(w.color) ? w.color : COLORS[0],
    note: String(w.note || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200), created: Number(w.created) || Date.now(), from: String(w.from || '').slice(0, 60),
  };
  return out;
}
function list() { return load().sort((a, b) => (a.place || '').localeCompare(b.place || '') || a.name.localeCompare(b.name)); }
function save(w) {
  const c = clean(w), l = load().filter((x) => x.id !== c.id);
  if (l.length >= 500) throw new Error('You have 500 waypoints — delete some first.');
  l.push(c); store(l); return list();
}
function remove(id) { store(load().filter((x) => x.id !== id)); return list(); }

// ---------- sharing ----------
const b64u = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
/** A short code with one or more waypoints (no place — that's yours), to paste into another Astra. */
function encode(ids) {
  const l = load().filter((w) => ids.includes(w.id));
  if (!l.length) throw new Error('Pick the waypoints to share.');
  const compact = l.slice(0, 50).map((w) => [w.name, w.x, w.y, w.z, w.dimension === 'minecraft:overworld' ? 0 : w.dimension === 'minecraft:the_nether' ? -1 : w.dimension === 'minecraft:the_end' ? 1 : w.dimension, w.color, w.note]);
  return 'ASTRA-WP-' + b64u(zlib.deflateRawSync(Buffer.from(JSON.stringify({ v: 1, w: compact }))));
}
/** Reads a waypoint code, or plain text with coordinates ("Base: 120 64 -340", "x: 1, z: 5", "/tp @s 1 2 3"). */
function decode(text) {
  const t = String(text || '').trim();
  const code = t.match(/ASTRA-WP-([A-Za-z0-9_-]+)/);
  if (code) {
    let d; try { d = JSON.parse(zlib.inflateRawSync(unb64u(code[1])).toString('utf8')); } catch { throw new Error('That waypoint code is damaged — copy it again.'); }
    if (d.v !== 1 || !Array.isArray(d.w)) throw new Error('That waypoint code was made by a newer Astra. Update Astra and try again.');
    return d.w.slice(0, 50).map(([name, x, y, z, dim, color, note]) => clean({ name, x, y, z, dimension: dim, color, note, from: 'code' }));
  }
  // plain text: three numbers (x y z) or two (x z)
  const nums = (t.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  if (nums.length < 2) throw new Error('Paste a waypoint code, or coordinates like “120 64 -340”.');
  const [x, y, z] = nums.length >= 3 ? nums.slice(-3) : [nums[0], null, nums[1]];
  const dim = /nether/i.test(t) ? 'minecraft:the_nether' : /\bend\b/i.test(t) ? 'minecraft:the_end' : 'minecraft:overworld';
  let name = (t.split(/[:\n]|-?\d/)[0] || '').replace(/^\/?tp\s+\S+\s*/i, '').replace(/[,\s]*\b[xyz]\s*[=:]?\s*$/i, '').trim().slice(0, 40);
  if (!name || /^[xyz]$/i.test(name)) name = 'Shared place';
  return [clean({ name, x, y, z, dimension: dim, from: 'text' })];
}
/** "Base — 120 64 -340 (Overworld)" for any chat. */
const chatText = (w) => `${w.name} — ${w.x} ${w.y ?? '~'} ${w.z} (${DIM_NAMES[w.dimension] || w.dimension})`;

// ---------- places from save files ----------
const pos3 = (p) => (Array.isArray(p) && p.length >= 3 ? { x: Math.round(Number(p[0])), y: Math.round(Number(p[1])), z: Math.round(Number(p[2])) } : null);
/** World spawn, and for a player: where they are, their last death and their bed/respawn point. */
function placesFrom(key, uuid = null) {
  const nbt = require('./nbt');
  const w = require('./saves').worlds().find((x) => x.key === key);
  if (!w) throw new Error('That world isn’t there any more.');
  const out = [];
  try {
    const d = nbt.readFile(path.join(w.dir, 'level.dat')).Data || {};
    const s = d.spawn?.pos ? { ...pos3(d.spawn.pos), dimension: dimOf(d.spawn.dimension) } : d.SpawnX != null ? { x: d.SpawnX, y: d.SpawnY, z: d.SpawnZ, dimension: 'minecraft:overworld' } : null;
    if (s) out.push({ kind: 'spawn', name: 'World spawn', ...s });
  } catch {}
  if (uuid) {
    const u = String(uuid).toLowerCase();
    if (!/^[0-9a-f-]{36}$/.test(u)) throw new Error('Unknown player.');
    let p = null;
    const f = path.join(w.dir, 'playerdata', `${u}.dat`);
    if (fs.existsSync(f)) p = nbt.readFile(f);
    else if (w.kind === 'instance') { try { p = nbt.readFile(path.join(w.dir, 'level.dat')).Data?.Player || null; } catch {} }
    if (p) {
      if (p.Pos) out.push({ kind: 'position', name: 'Where they are', ...pos3(p.Pos), dimension: dimOf(p.Dimension) });
      if (p.LastDeathLocation?.pos) out.push({ kind: 'death', name: 'Last death', ...pos3(p.LastDeathLocation.pos), dimension: dimOf(p.LastDeathLocation.dimension) });
      if (p.respawn?.pos) out.push({ kind: 'bed', name: 'Bed / respawn point', ...pos3(p.respawn.pos), dimension: dimOf(p.respawn.dimension) });
      else if (p.SpawnX != null) out.push({ kind: 'bed', name: 'Bed / respawn point', x: p.SpawnX, y: p.SpawnY, z: p.SpawnZ, dimension: dimOf(p.SpawnDimension) });
    }
  }
  return { place: key, placeName: `${w.name} (${w.owner})`, places: out.filter((x) => Number.isFinite(x.x) && Number.isFinite(x.z)) };
}

// ---------- on a server you host ----------
const PLAYER = /^\.?[A-Za-z0-9_]{1,16}$/;
function serverOf(place) {
  const m = String(place || '').match(/^s:([^:]+):/);
  if (!m) throw new Error('This waypoint isn’t on a server you host.');
  const hs = require('../hostserver');
  if (hs.get(m[1]).state !== 'online') throw new Error('Start the server first.');
  return { hs, id: m[1] };
}
/** /tp a player to a waypoint (they must be online; the server checks the rest). */
function teleport(wid, player) {
  const w = load().find((x) => x.id === wid); if (!w) throw new Error('Waypoint not found.');
  if (!PLAYER.test(String(player || ''))) throw new Error('Pick an online player.');
  const { hs, id } = serverOf(w.place);
  if (!hs.get(id).players.includes(player)) throw new Error(`${player} isn’t online.`);
  const dimNow = w.dimension;
  hs.command(id, `execute in ${dimNow} run tp ${player} ${w.x} ${w.y ?? '~'} ${w.z}`);
  return true;
}
/** Posts the waypoint in the server's chat. */
function announce(wid) {
  const w = load().find((x) => x.id === wid); if (!w) throw new Error('Waypoint not found.');
  const { hs, id } = serverOf(w.place);
  hs.command(id, `say Waypoint ${chatText(w)}`);
  return true;
}

module.exports = { list, save, remove, encode, decode, chatText, placesFrom, teleport, announce, clean, dimOf, COLORS, DIM_NAMES };
