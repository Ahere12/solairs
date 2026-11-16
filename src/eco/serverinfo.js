// Astra Server Management 2.0 — what kind of server it is, a step-by-step connection test, uptime statistics,
// a join history, and which instance (modpack) belongs to a server.
//
// Saved server profiles stay in servers.json (src/servers.js); extra fields (notes, instanceId, notify) are stored
// on the same entries. Uptime samples come from every real ping Astra makes (server list, monitoring, tests) and
// live in server-uptime.json.

const semver = require('./semver');

// ---------- what software a server runs ----------
const PATTERNS = [
  [/\bvelocity\b/i, 'Velocity', 'proxy'], [/\bwaterfall\b/i, 'Waterfall', 'proxy'], [/\bbungeecord\b/i, 'BungeeCord', 'proxy'],
  [/\bfolia\b/i, 'Folia', 'plugins'], [/\bpurpur\b/i, 'Purpur', 'plugins'], [/\bpufferfish\b/i, 'Pufferfish', 'plugins'], [/\bleaf\b/i, 'Leaf', 'plugins'],
  [/\bpaper\b/i, 'Paper', 'plugins'], [/\bspigot\b/i, 'Spigot', 'plugins'], [/\bcraftbukkit\b|\bbukkit\b/i, 'CraftBukkit', 'plugins'],
  [/\bmohist\b/i, 'Mohist', 'hybrid'], [/\barclight\b/i, 'Arclight', 'hybrid'], [/\bmagma\b/i, 'Magma', 'hybrid'], [/\bcatserver\b/i, 'CatServer', 'hybrid'],
  [/\bneoforge\b/i, 'NeoForge', 'mods'], [/\bforge\b/i, 'Forge', 'mods'], [/\bfabric\b/i, 'Fabric', 'mods'], [/\bquilt\b/i, 'Quilt', 'mods'],
];
/**
 * From a Server List Ping answer (servers.ping). Servers don't have to say what they run, so the answer says how
 * sure it is: "certain" (the server's own mod data), "likely" (its version text), or "unknown".
 */
function detectSoftware(r) {
  if (!r || !r.online) return { name: null, kind: null, confidence: 'unknown', hint: 'The server didn’t answer.' };
  const v = String(r.version || '');
  if (r.forge?.neoforge || r.forge?.isModded) return { name: 'NeoForge', kind: 'mods', confidence: 'certain', hint: 'The server reports NeoForge.', mods: r.forge?.mods ?? null };
  // Proxies (CubeCraft, BungeeCord setups) send an empty legacy "modinfo" for client compatibility: only a mod list
  // with mods in it proves Forge. Real Forge always lists at least its own core mods.
  if ((r.forge?.forgeData || r.forge?.fml) && r.forge.mods !== 0) {
    const hit = PATTERNS.find(([re, , k]) => k === 'hybrid' && re.test(v));
    if (hit) return { name: hit[1], kind: 'hybrid', confidence: 'certain', hint: 'Forge mods and Bukkit plugins.', mods: r.forge.mods ?? null };
    return { name: 'Forge', kind: 'mods', confidence: 'certain', hint: `The server reports Forge${r.forge.mods != null ? ` with ${r.forge.mods} mods` : ''}.`, mods: r.forge.mods ?? null };
  }
  const hit = PATTERNS.find(([re]) => re.test(v));
  if (hit) return { name: hit[1], kind: hit[2], confidence: 'likely', hint: `From its version text “${v}”.` };
  if (/requires|[\d.]+\s*[-–]\s*[\d.]+|\bx\b/i.test(v) && /\d/.test(v)) return { name: 'Proxy or multi-version', kind: 'proxy', confidence: 'likely', hint: `It accepts several versions (“${v}”).` };
  if (/^\d+\.\d+(\.\d+)?$/.test(v.trim())) return { name: 'Vanilla or unmarked', kind: 'vanilla', confidence: 'likely', hint: 'It only reports a plain version number.' };
  return { name: null, kind: null, confidence: 'unknown', hint: v ? `Unrecognised version text “${v}”.` : 'The server doesn’t say.' };
}

/** Can an instance join? Compares the instance's Minecraft version with the version the server announces. */
function versionMatch(instanceMc, serverVersion) {
  if (!instanceMc || !serverVersion) return { ok: null, text: 'Unknown' };
  const nums = String(serverVersion).match(/\d+\.\d+(?:\.\d+)?/g) || [];
  if (!nums.length) return { ok: null, text: `Server says “${serverVersion}”` };
  if (nums.length >= 2 && /[-–]|requires|\bto\b/i.test(serverVersion)) { // a range: proxies, ViaVersion
    const ok = semver.compare(instanceMc, nums[0]) >= 0 && semver.compare(instanceMc, nums[nums.length - 1]) <= 0;
    return { ok, text: ok ? `${instanceMc} is in the server’s range ${nums[0]}–${nums[nums.length - 1]}` : `The server accepts ${nums[0]}–${nums[nums.length - 1]}, this instance is ${instanceMc}` };
  }
  const c = semver.compare(instanceMc, nums[0]);
  if (c === 0) return { ok: true, text: `Same version (${instanceMc})` };
  return { ok: false, text: `Server is ${nums[0]}, this instance is ${instanceMc}${c < 0 ? ' (older)' : ' (newer)'} — it may refuse to connect unless it runs ViaVersion` };
}

// ---------- connection test ----------
/**
 * Every step a join goes through, each with its own result: address, DNS (SRV + A/AAAA), TCP connect, Minecraft
 * status, version. deps = { resolveSrv, lookup, connect(host, port, ms) → ms, ping(address) } so it can be tested.
 */
async function connectionTest(address, { instanceMc = null, deps } = {}) {
  const steps = [];
  const step = (id, ok, text, extra = {}) => { steps.push({ id, ok, text, ...extra }); return ok; };
  const raw = String(address || '').trim();
  const m = raw.match(/^(\[[^\]]+\]|[^:\s]+)(?::(\d{1,5}))?$/);
  if (!m || (m[2] && (+m[2] < 1 || +m[2] > 65535))) { step('address', false, `“${raw}” isn’t a server address (host or host:port).`); return finish(); }
  let host = m[1].replace(/^\[|\]$/g, ''), port = m[2] ? +m[2] : 25565;
  step('address', true, `${host}, port ${port}${m[2] ? '' : ' (default)'}`);
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) step('network', true, 'A local-network address — it only works on the same network as the server.', { warn: true });

  let target = host;
  if (!isIp && !m[2]) {
    try {
      const srv = await deps.resolveSrv('_minecraft._tcp.' + host);
      if (srv && srv[0]) { target = srv[0].name; port = srv[0].port; step('srv', true, `SRV record points to ${target}:${port}`); }
      else step('srv', true, 'No SRV record (that’s normal)');
    } catch { step('srv', true, 'No SRV record (that’s normal)'); }
  }
  if (!isIp) {
    try {
      const t0 = Date.now(); const ips = await deps.lookup(target);
      step('dns', true, `${target} → ${ips.slice(0, 3).join(', ')}`, { ms: Date.now() - t0 });
    } catch (e) {
      step('dns', false, `The name ${target} doesn’t exist or DNS isn’t reachable (${e.code || e.message}). Check the spelling; if other sites work, the address is wrong or expired.`);
      return finish();
    }
  }
  try {
    const ms = await deps.connect(target, port, 6000);
    step('tcp', true, `Port ${port} is open (${ms} ms)`, { ms });
  } catch (e) {
    const why = { ECONNREFUSED: 'the computer answered but nothing listens on that port — the server is off or uses another port', ETIMEDOUT: 'no answer — the server is offline, or a firewall / missing port forward blocks it', EHOSTUNREACH: 'that computer can’t be reached from here', ENETUNREACH: 'no network route — check your internet connection' }[e.code] || e.message;
    step('tcp', false, `Couldn’t connect to ${target}:${port}: ${why}.`);
    return finish();
  }
  let r;
  // ping the address as typed (it finds the same SRV target): its uptime is kept under the saved address
  try { r = await deps.ping(raw); } catch (e) { r = { online: false, error: e.message }; }
  if (!r?.online) { step('status', false, `The port is open but it didn’t answer like a Minecraft Java server (${r?.error || 'no answer'}). It may be a Bedrock server, or still starting.`); return finish(); }
  step('status', true, `Minecraft answered: ${r.players?.online ?? 0}/${r.players?.max ?? '?'} players${r.latency != null ? `, ${r.latency} ms` : ''}`, { ms: r.latency });
  const soft = detectSoftware(r);
  if (instanceMc) { const v = versionMatch(instanceMc, r.version); step('version', v.ok !== false, v.text, { warn: v.ok === null }); }
  if (r.players && r.players.max && r.players.online >= r.players.max) step('slots', true, 'The server says it is full — big servers often still let you in, or put you in a queue.', { warn: true });
  return finish(r, soft);

  function finish(result = null, software = null) {
    const failed = steps.find((s) => !s.ok);
    return { address: raw, ok: !failed, summary: failed ? failed.text : 'Everything works — you should be able to join.', steps, software, version: result?.version || null, at: Date.now() };
  }
}

// ---------- uptime ----------
const DAY = 864e5;
/** samples = [{ t, up, ms }] oldest first. Uptime in a window counts each sample until the next one. */
function uptimeStats(samples = [], now = Date.now()) {
  const win = (ms) => {
    const s = samples.filter((x) => x.t >= now - ms);
    if (!s.length) return null;
    return Math.round((s.filter((x) => x.up).length / s.length) * 1000) / 10;
  };
  const ups = samples.filter((x) => x.up && x.ms != null);
  let longest = 0, cur = null;
  for (const s of samples) {
    if (!s.up) { if (cur == null) cur = s.t; }
    else if (cur != null) { longest = Math.max(longest, s.t - cur); cur = null; }
  }
  if (cur != null) longest = Math.max(longest, now - cur);
  const last = samples[samples.length - 1] || null;
  const lastUp = [...samples].reverse().find((x) => x.up);
  return {
    checks: samples.length, day: win(DAY), week: win(7 * DAY), month: win(30 * DAY),
    avgLatency: ups.length ? Math.round(ups.reduce((t, x) => t + x.ms, 0) / ups.length) : null,
    longestOutageMs: longest, online: last ? last.up : null, lastCheck: last ? last.t : null, lastOnline: lastUp ? lastUp.t : null,
    since: samples[0]?.t || null,
  };
}
/** Hours of the last week → share online, for a small bar chart (null = no checks that hour). */
function uptimeHours(samples = [], now = Date.now(), hours = 7 * 24) {
  const out = [];
  for (let h = hours - 1; h >= 0; h--) {
    const a = now - (h + 1) * 3600e3, b = now - h * 3600e3;
    const s = samples.filter((x) => x.t >= a && x.t < b);
    out.push(s.length ? s.filter((x) => x.up).length / s.length : null);
  }
  return out;
}

// ---------- Astra ----------
const MAX_SAMPLES = 3000;
const k = (a) => String(a || '').trim().toLowerCase();
function store() {
  const { paths, readJSON, writeJSON } = require('../util');
  const f = paths.file('server-uptime.json');
  return { read: () => readJSON(f, { samples: {}, joins: [] }), write: (d) => writeJSON(f, d) };
}
let pending = null, saveTimer = null;
/** Called after every ping (src/servers.js). Kept in memory and written at most every few seconds. */
function record(address, result) {
  const s = store();
  pending = pending || s.read();
  const list = (pending.samples[k(address)] = pending.samples[k(address)] || []);
  const t = Date.now();
  const sample = { t, up: !!result?.online, ms: result?.online ? result.latency ?? null : null };
  // several pings within a minute (list refresh + monitoring): keep the last
  if (list.length && t - list[list.length - 1].t < 60000) list[list.length - 1] = sample; else list.push(sample);
  const cutoff = t - 31 * DAY;
  while (list.length && (list[0].t < cutoff || list.length > MAX_SAMPLES)) list.shift();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { s.write(pending); } catch {} pending = null; }, 15000); // the Servers page pings every minute: write at most every 15 s (flushed on quit)
  saveTimer.unref?.();
}
function data() { return pending || store().read(); }
function flush() { if (pending) { clearTimeout(saveTimer); store().write(pending); pending = null; } }

function joined(address, instanceId) {
  flush();
  const s = store(), d = s.read();
  d.joins = [{ address, instanceId: instanceId || null, at: Date.now() }, ...(d.joins || [])].slice(0, 300);
  s.write(d);
}

async function profile(id) {
  const servers = require('../servers');
  const saved = servers.list().servers.find((x) => x.id === id);
  if (!saved) throw new Error('That server isn’t saved anymore.');
  const samples = data().samples[k(saved.address)] || [];
  let inst = null;
  if (saved.instanceId) { try { const i = require('../instances').get(saved.instanceId); inst = { id: i.id, name: i.name, mc: i.versionId, loader: i.loader }; } catch { inst = { id: saved.instanceId, missing: true }; } }
  return {
    server: saved, instance: inst, uptime: uptimeStats(samples), hours: uptimeHours(samples),
    players: servers.history(saved.address).slice(-200),
    joins: (data().joins || []).filter((j) => k(j.address) === k(saved.address)).slice(0, 30),
  };
}
async function live(address) {
  const r = await require('../servers').ping(address);
  return { ...r, software: detectSoftware(r) };
}
async function test(address, instanceId) {
  const dns = require('dns').promises, net = require('net');
  let instanceMc = null;
  if (instanceId) { try { instanceMc = require('../instances').get(instanceId).versionId; } catch {} }
  return connectionTest(address, {
    instanceMc,
    deps: {
      resolveSrv: (n) => dns.resolveSrv(n),
      lookup: async (h) => (await dns.lookup(h, { all: true })).map((a) => a.address),
      connect: (host, port, ms) => new Promise((resolve, reject) => {
        const t0 = Date.now(); const sock = net.createConnection({ host, port });
        const timer = setTimeout(() => { sock.destroy(); const e = new Error('timed out'); e.code = 'ETIMEDOUT'; reject(e); }, ms);
        sock.once('connect', () => { clearTimeout(timer); sock.destroy(); resolve(Date.now() - t0); });
        sock.once('error', (e) => { clearTimeout(timer); reject(e); });
      }),
      ping: (a) => require('../servers').ping(a),
    },
  });
}
async function setProfile(id, patch = {}) {
  const servers = require('../servers');
  const saved = servers.list().servers.find((x) => x.id === id);
  if (!saved) throw new Error('That server isn’t saved anymore.');
  const next = { id };
  if ('notes' in patch) next.notes = String(patch.notes || '').slice(0, 2000);
  if ('instanceId' in patch) { if (patch.instanceId) require('../instances').get(patch.instanceId); next.instanceId = patch.instanceId || null; }
  if ('notify' in patch) next.notify = !!patch.notify;
  if ('name' in patch && String(patch.name).trim()) next.name = String(patch.name).trim().slice(0, 80);
  servers.save({ ...saved, ...next });
  return profile(id);
}
/** Saved servers with their uptime in one go, for the list. */
function overview() {
  const d = data();
  return require('../servers').list().servers.map((s) => ({ id: s.id, uptime: uptimeStats(d.samples[k(s.address)] || []) }));
}

module.exports = { detectSoftware, versionMatch, connectionTest, uptimeStats, uptimeHours, record, joined, profile, live, test, setProfile, overview, flush };
