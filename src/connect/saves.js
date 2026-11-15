// Solaris Connect — player statistics, advancements and play time, read from Java worlds' own save files:
//   <world>/stats/<uuid>.json         {"stats": {"minecraft:custom": {"minecraft:play_time": ticks, …}, "minecraft:mined": {…}, …}}
//   <world>/advancements/<uuid>.json  {"minecraft:story/mine_stone": {"criteria": {"…": "2026-11-15 02:23:10 -0600"}, "done": true}, …}
//   <world>/level.dat                 (NBT) world name, version, last played
// Which advancements exist (and their English titles) comes from the game's own jar for that version
// (data/minecraft/advancement[s]/…, assets/minecraft/lang/en_us.json) when Solaris has it; otherwise the names are
// made from the ids and the total is unknown. Nothing here is sent anywhere; Bedrock worlds use another format and
// aren't read.
const fs = require('fs');
const path = require('path');
const nbt = require('./nbt');

const host = () => require('../hostserver');
const insts = () => require('../instances');
const UUID = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/i;

// ---------- where worlds are ----------
/** Every Java world Solaris knows: singleplayer worlds of instances, and hosted servers' worlds. */
function worlds() {
  const out = [];
  for (const i of insts().list()) {
    let ws = []; try { ws = insts().worlds(i.id); } catch {}
    for (const w of ws) if (fs.existsSync(path.join(w.path, 'level.dat'))) out.push({ key: `i:${i.id}:${w.name}`, kind: 'instance', owner: i.name, ownerId: i.id, name: w.name, dir: w.path, mc: i.versionId, lastPlayed: w.lastPlayed });
  }
  for (const s of host().list()) {
    if (s.missing || s.software === 'bedrock') continue;
    let ws = []; try { ws = host().worlds(s.id); } catch {}
    for (const w of ws) out.push({ key: `s:${s.id}:${w.name}`, kind: 'server', owner: s.name, ownerId: s.id, name: w.name, dir: path.join(s.dir, w.name), mc: s.mc, lastPlayed: w.modified, active: w.active });
  }
  return out.map((w) => ({ ...w, players: countPlayers(w.dir) }));
}
/** A world by its key — only worlds from the list above (never a path from outside). */
function world(key) { const w = worlds().find((x) => x.key === key); if (!w) throw new Error('That world isn’t there any more.'); return w; }
function countPlayers(dir) { try { return fs.readdirSync(path.join(dir, 'stats')).filter((f) => UUID.test(f)).length; } catch { return 0; } }

/** World details from level.dat. */
function level(dir) {
  try {
    const d = nbt.readFile(path.join(dir, 'level.dat')).Data || {};
    const modes = ['Survival', 'Creative', 'Adventure', 'Spectator'];
    return { name: d.LevelName || null, version: d.Version?.Name || null, lastPlayed: typeof d.LastPlayed === 'number' ? d.LastPlayed : null, mode: modes[d.GameType] || null, hardcore: !!d.hardcore, day: typeof d.DayTime === 'number' ? Math.floor(d.DayTime / 24000) + 1 : null };
  } catch (e) { return { error: e.message }; }
}

// ---------- names ----------
const nameCache = new Map();
function namesFor(w) {
  const names = new Map();
  const add = (uuid, name) => { if (uuid && name) names.set(String(uuid).toLowerCase().replace(/^(.{8})-?(.{4})-?(.{4})-?(.{4})-?(.{12})$/, '$1-$2-$3-$4-$5'), name); };
  try { for (const a of require('../accounts').list().accounts || []) add(a.uuid, a.name); } catch {}
  if (w.kind === 'server') {
    const dir = path.dirname(w.dir);
    try { for (const u of JSON.parse(fs.readFileSync(path.join(dir, 'usercache.json'), 'utf8'))) add(u.uuid, u.name); } catch {}
    for (const f of ['whitelist.json', 'ops.json']) { try { for (const u of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) add(u.uuid, u.name); } catch {} }
  }
  try { for (const f of require('../friends').list()) add(f.uuid, f.name); } catch {}
  for (const [u, n] of nameCache) if (!names.has(u)) names.set(u, n);
  return names;
}
/** Mojang names for player IDs Solaris doesn't know (real accounts only — offline IDs have no Mojang profile). */
async function lookupNames(uuids) {
  await Promise.all(uuids.filter((u) => u[14] === '4' && !nameCache.has(u)).slice(0, 10).map(async (u) => {
    try {
      const r = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${u.replace(/-/g, '')}`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) { const p = await r.json(); if (p?.name) nameCache.set(u, p.name); }
    } catch {}
  }));
}

// ---------- stats ----------
const readJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const nice = (id) => String(id).replace(/^minecraft:/, '').replace(/_/g, ' ').replace(/\b\w/, (c) => c.toUpperCase());
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + (Number(b) || 0), 0);
const top = (o, n = 6) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([id, v]) => ({ id, name: nice(id), count: v }));

/** The numbers a player cares about, from stats/<uuid>.json (Minecraft 1.13+ format). */
function summarize(json) {
  const s = json?.stats || {};
  const c = s['minecraft:custom'] || {};
  const ticks = c['minecraft:play_time'] ?? c['minecraft:play_one_minute'] ?? 0; // renamed in 1.17
  const cm = Object.entries(c).filter(([k]) => /_one_cm$/.test(k) && k !== 'minecraft:fall_one_cm').reduce((a, [, v]) => a + v, 0);
  return {
    playMs: Math.round((ticks / 20) * 1000),
    deaths: c['minecraft:deaths'] || 0,
    mobKills: c['minecraft:mob_kills'] || 0,
    playerKills: c['minecraft:player_kills'] || 0,
    jumps: c['minecraft:jump'] || 0,
    distanceKm: Math.round(cm / 1000) / 100, // cm → km, 2 decimals
    flownKm: Math.round(((c['minecraft:aviate_one_cm'] || 0) + (c['minecraft:fly_one_cm'] || 0)) / 1000) / 100,
    damageDealt: Math.round((c['minecraft:damage_dealt'] || 0) / 10), // stored ×10
    damageTaken: Math.round((c['minecraft:damage_taken'] || 0) / 10),
    sinceDeathMs: c['minecraft:time_since_death'] != null ? Math.round((c['minecraft:time_since_death'] / 20) * 1000) : null,
    sleeps: c['minecraft:sleep_in_bed'] || 0,
    tradedWithVillagers: c['minecraft:traded_with_villager'] || 0,
    blocksMined: sum(s['minecraft:mined']), itemsCrafted: sum(s['minecraft:crafted']), mobsKilled: sum(s['minecraft:killed']),
    topMined: top(s['minecraft:mined']), topKilled: top(s['minecraft:killed']), topKilledBy: top(s['minecraft:killed_by'], 4), topCrafted: top(s['minecraft:crafted'], 4), topUsed: top(s['minecraft:used'], 4),
  };
}

// ---------- advancements ----------
const defsCache = new Map();
/** The advancements that exist in this Minecraft version (from the game jar Solaris downloaded), or null. */
function advancementDefs(mc) {
  if (defsCache.has(mc)) return defsCache.get(mc);
  let out = null;
  try {
    const jar = path.join(require('../util').paths.versions(), mc, `${mc}.jar`);
    if (fs.existsSync(jar)) {
      const AdmZip = require('adm-zip');
      const z = new AdmZip(jar);
      let lang = {}; try { lang = JSON.parse(z.readAsText('assets/minecraft/lang/en_us.json')); } catch {}
      const tr = (t) => (typeof t === 'string' ? t : t?.translate ? lang[t.translate] || t.fallback || t.translate : t?.text || '');
      out = new Map();
      for (const e of z.getEntries()) {
        const m = e.entryName.match(/^data\/minecraft\/advancements?\/(.+)\.json$/);
        if (!m || m[1].startsWith('recipes/')) continue;
        let j; try { j = JSON.parse(e.getData().toString('utf8')); } catch { continue; }
        if (!j.display) continue; // not shown in the game's advancement screen
        out.set(`minecraft:${m[1]}`, { tab: m[1].split('/')[0], title: tr(j.display.title), description: tr(j.display.description), frame: j.display.frame || 'task', hidden: !!j.display.hidden });
      }
      if (!out.size) out = null;
    }
  } catch { out = null; }
  defsCache.set(mc, out);
  return out;
}
const parseWhen = (s) => { const t = Date.parse(String(s).replace(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) ([+-]\d\d)(\d\d)$/, '$1T$2$3:$4')); return Number.isFinite(t) ? t : null; };
function advancements(json, mc) {
  const defs = advancementDefs(mc);
  const list = [];
  const seen = new Set();
  for (const [id, a] of Object.entries(json || {})) {
    if (id === 'DataVersion' || id.includes(':recipes/') || !a || typeof a !== 'object') continue;
    const d = defs?.get(id);
    if (defs && !d) continue; // not shown in the game (e.g. hidden roots) or from a datapack Solaris can't name
    seen.add(id);
    const times = Object.values(a.criteria || {}).map(parseWhen).filter(Boolean);
    list.push({ id, tab: d?.tab || id.split(':')[1]?.split('/')[0] || '', title: d?.title || nice(id.split('/').pop()), description: d?.description || '', frame: d?.frame || 'task', done: !!a.done, when: a.done && times.length ? Math.max(...times) : null, progress: Object.keys(a.criteria || {}).length });
  }
  if (defs) for (const [id, d] of defs) if (!seen.has(id) && !d.hidden) list.push({ id, tab: d.tab, title: d.title, description: d.description, frame: d.frame, done: false, when: null, progress: 0 });
  const total = defs ? [...defs.values()].filter((d) => !d.hidden).length + list.filter((x) => x.done && defs.get(x.id)?.hidden).length : null;
  return { done: list.filter((x) => x.done).length, total, known: !!defs, list: list.sort((a, b) => (b.done - a.done) || (b.when || 0) - (a.when || 0) || a.tab.localeCompare(b.tab) || a.title.localeCompare(b.title)) };
}

// ---------- what the Stats page asks ----------
async function players(key) {
  const w = world(key);
  let files = []; try { files = fs.readdirSync(path.join(w.dir, 'stats')).filter((f) => UUID.test(f)); } catch {}
  const uuids = files.map((f) => f.match(UUID)[1].toLowerCase());
  let names = namesFor(w);
  if (uuids.some((u) => !names.has(u))) { await lookupNames(uuids.filter((u) => !names.has(u))); names = namesFor(w); }
  const out = uuids.map((u) => {
    const st = summarize(readJSON(path.join(w.dir, 'stats', `${u}.json`)));
    const adv = readJSON(path.join(w.dir, 'advancements', `${u}.json`));
    const done = adv ? Object.entries(adv).filter(([id, a]) => !id.includes(':recipes/') && a?.done && id !== 'DataVersion').length : 0;
    let seen = null; try { seen = fs.statSync(path.join(w.dir, 'stats', `${u}.json`)).mtimeMs; } catch {}
    return { uuid: u, name: names.get(u) || null, offline: u[14] === '3', playMs: st.playMs, deaths: st.deaths, advancementsDone: done, lastSaved: seen };
  });
  return { world: { ...w, level: level(w.dir) }, players: out.sort((a, b) => b.playMs - a.playMs) };
}
async function player(key, uuid) {
  const w = world(key);
  const u = String(uuid).toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(u)) throw new Error('Unknown player.');
  const stats = readJSON(path.join(w.dir, 'stats', `${u}.json`));
  if (!stats) throw new Error('No stats for this player in this world yet.');
  const names = namesFor(w);
  return { uuid: u, name: names.get(u) || nameCache.get(u) || null, world: { key: w.key, name: w.name, owner: w.owner, mc: w.mc }, stats: summarize(stats), advancements: advancements(readJSON(path.join(w.dir, 'advancements', `${u}.json`)), w.mc) };
}
/** Play time per player name across every world (Stats page summary). */
async function totals() {
  const all = new Map();
  for (const w of worlds()) {
    if (!w.players) continue;
    const names = namesFor(w);
    for (const f of fs.readdirSync(path.join(w.dir, 'stats')).filter((x) => UUID.test(x))) {
      const u = f.match(UUID)[1].toLowerCase(), n = names.get(u) || nameCache.get(u) || null;
      const k = (n || u).toLowerCase();
      const st = summarize(readJSON(path.join(w.dir, 'stats', f)));
      const t = all.get(k) || { name: n, uuid: u, playMs: 0, worlds: new Set(), deaths: 0 };
      t.playMs += st.playMs; t.worlds.add(w.key); t.deaths += st.deaths;
      all.set(k, t);
    }
  }
  return [...all.values()].map((t) => ({ ...t, worlds: t.worlds.size })).sort((a, b) => b.playMs - a.playMs);
}

module.exports = { worlds, players, player, totals, summarize, advancements, advancementDefs, level, parseWhen };
