// Host a Minecraft server on this PC (like PocketMC / VoxelPort), public without port forwarding.
// Servers are Fabric servers; "Go public" adds e4mc (MIT, github.com/vgskye/e4mc-minecraft-architectury), which
// tunnels the server through e4mc's relay and prints "Domain assigned: <address>". Friends join that address with
// plain Minecraft — no account, no router settings. Without it the server is reachable on the local network.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { shell, Notification, clipboard } = require('electron');
const { paths, readJSON, writeJSON, getJSON, download, push, slugify } = require('./util');
const versions = require('./versions');

const root = () => path.join(paths.getRoot(), 'hosted');
const dirOf = (id) => path.join(root(), id);
const metaFile = (id) => path.join(dirOf(id), 'solaris-server.json');
const running = new Map(); // id -> { proc, state, address, players:Set, lines:[], stopping }
const PUBLIC_MODS = ['e4mc'];
const PERF_MODS = ['lithium', 'ferrite-core'];

function meta(id) { const m = readJSON(metaFile(id), null); if (!m) throw new Error('Server not found'); return m; }
function view(m) {
  const r = running.get(m.id);
  return { ...m, state: r ? r.state : 'offline', address: r?.address || null, players: r ? [...r.players] : [], lan: `localhost:${m.port}` };
}
function list() {
  let ids = [];
  try { ids = fs.readdirSync(root()).filter((d) => fs.existsSync(metaFile(d))); } catch {}
  return ids.map((id) => view(readJSON(metaFile(id)))).sort((a, b) => b.created - a.created);
}
function save(m) { writeJSON(metaFile(m.id), m); return view(m); }
function emit(id) { try { push('hosted:state', view(meta(id))); } catch {} }

// ---------- server.properties ----------
function readProps(id) {
  const out = {};
  try { for (const l of fs.readFileSync(path.join(dirOf(id), 'server.properties'), 'utf8').split(/\r?\n/)) { const m = l.match(/^([^#=\s][^=]*)=(.*)$/); if (m) out[m[1].trim()] = m[2]; } } catch {}
  return out;
}
function writeProps(id, patch) {
  const file = path.join(dirOf(id), 'server.properties');
  let lines = []; try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch {}
  const left = { ...patch };
  lines = lines.map((l) => { const m = l.match(/^([^#=\s][^=]*)=/); if (m && m[1].trim() in left) { const k = m[1].trim(); const v = left[k]; delete left[k]; return `${k}=${v}`; } return l; });
  for (const [k, v] of Object.entries(left)) lines.push(`${k}=${v}`);
  fs.writeFileSync(file, lines.filter((l, i) => l || i < lines.length - 1).join('\n') + '\n');
}

// ---------- create ----------
async function bestModFile(slug, mc) {
  const q = `loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent(JSON.stringify([mc]))}`;
  const vs = await getJSON(`https://api.modrinth.com/v2/project/${slug}/version?${q}`).catch(() => []);
  const v = vs.find((x) => x.version_type === 'release') || vs[0];
  if (!v) return null;
  const f = v.files.find((x) => x.primary) || v.files[0];
  return { url: f.url, filename: f.filename, sha1: f.hashes.sha1, deps: v.dependencies || [] };
}
async function installMods(id, mc, slugs, onStep) {
  const mods = path.join(dirOf(id), 'mods');
  fs.mkdirSync(mods, { recursive: true });
  const missing = [];
  for (const slug of ['fabric-api', ...slugs]) {
    onStep && onStep(`Adding ${slug}`);
    const f = await bestModFile(slug, mc);
    if (!f) { missing.push(slug); continue; }
    await download(f.url, path.join(mods, f.filename), { sha1: f.sha1 });
  }
  return missing;
}
function nextPort() {
  const used = new Set(list().map((s) => s.port));
  let p = 25565; while (used.has(p)) p++;
  return p;
}

async function create({ name, mc, memory = 3072, makePublic = true, eula = false }, onStep) {
  if (!eula) throw new Error('You need to accept the Minecraft EULA to run a server.');
  if (!/^[\w.-]+$/.test(mc || '')) throw new Error('Pick a Minecraft version.');
  const loaders = await getJSON(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}`).catch(() => []);
  if (!loaders.length) throw new Error(`Fabric servers aren’t available for Minecraft ${mc} yet.`);
  const installers = await getJSON('https://meta.fabricmc.net/v2/versions/installer');
  const loader = (loaders.find((l) => l.loader.stable) || loaders[0]).loader.version;
  const installer = (installers.find((i) => i.stable) || installers[0]).version;
  let id = slugify(name || `server-${mc}`) || 'server';
  while (fs.existsSync(dirOf(id))) id += '-2';
  fs.mkdirSync(dirOf(id), { recursive: true });
  const m = { id, name: String(name || `Server ${mc}`).slice(0, 40), mc, loader, memory: Math.max(1024, Math.min(32768, Number(memory) || 3072)), public: !!makePublic, port: nextPort(), created: Date.now() };
  save(m);
  try {
    onStep && onStep('Downloading the Fabric server');
    await download(`https://meta.fabricmc.net/v2/versions/loader/${mc}/${loader}/${installer}/server/jar`, path.join(dirOf(id), 'server.jar'));
    fs.writeFileSync(path.join(dirOf(id), 'eula.txt'), `# Accepted in Solaris on ${new Date().toISOString()} (https://aka.ms/MinecraftEULA)\neula=true\n`);
    writeProps(id, { motd: `${m.name} \\u00a77\\u2014 hosted with Solaris`, 'server-port': m.port, 'max-players': 10, 'online-mode': true, 'spawn-protection': 0, 'enable-command-block': false, difficulty: 'normal' });
    m.missingMods = await installMods(id, mc, [...(m.public ? PUBLIC_MODS : []), ...PERF_MODS], onStep);
    if (m.public && m.missingMods.includes('e4mc')) m.public = false;
  } catch (e) { try { fs.rmSync(dirOf(id), { recursive: true, force: true }); } catch {} throw e; }
  return save(m);
}

async function setPublic(id, on) {
  const m = meta(id);
  if (running.has(id)) throw new Error('Stop the server first.');
  const mods = path.join(dirOf(id), 'mods');
  if (on) {
    const missing = await installMods(id, m.mc, PUBLIC_MODS);
    if (missing.includes('e4mc')) throw new Error(`Going public isn’t available for Minecraft ${m.mc} yet (e4mc doesn’t support it).`);
  } else {
    for (const f of fs.existsSync(mods) ? fs.readdirSync(mods) : []) if (/^e4mc/i.test(f)) fs.rmSync(path.join(mods, f), { force: true });
  }
  m.public = !!on;
  return save(m);
}

// ---------- run ----------
async function start(id, resolveJava) {
  if (running.has(id)) return view(meta(id));
  const m = meta(id);
  const version = await versions.resolveVersion(m.mc);
  const r = { proc: null, state: 'starting', address: null, players: new Set(), lines: [], stopping: false };
  running.set(id, r); emit(id);
  let java;
  try { java = await resolveJava({ versionId: m.mc, javaPath: null }, version, (d, t) => log(id, `[Solaris] Installing Java ${Math.round((d / t) * 100)}%`)); }
  catch (e) { running.delete(id); emit(id); throw e; }
  const args = [`-Xmx${m.memory}M`, `-Xms${Math.min(1024, m.memory)}M`, '-XX:+UseG1GC', '-jar', 'server.jar', 'nogui'];
  log(id, `[Solaris] Starting ${m.name} (Minecraft ${m.mc}, ${m.memory} MB)…`);
  const proc = spawn(java.replace(/javaw\.exe$/i, 'java.exe'), args, { cwd: dirOf(id), windowsHide: true });
  r.proc = proc;
  let buf = '';
  const onData = (d) => { buf += d; const parts = buf.split(/\r?\n/); buf = parts.pop(); parts.forEach((l) => onLine(id, l)); };
  proc.stdout.on('data', onData); proc.stderr.on('data', onData);
  proc.on('error', (e) => { log(id, '[Solaris] Could not start Java: ' + e.message); running.delete(id); emit(id); });
  proc.on('close', (code) => {
    log(id, `[Solaris] Server stopped${code && !r.stopping ? ` (exit code ${code})` : ''}.`);
    running.delete(id); emit(id);
    push('hosted:stopped', { id, crashed: !!code && !r.stopping });
  });
  return view(m);
}

function log(id, line) {
  const r = running.get(id);
  if (r) { r.lines.push(line); if (r.lines.length > 3000) r.lines.shift(); }
  push('hosted:log', { id, line });
}

function onLine(id, line) {
  const r = running.get(id); if (!r) return;
  log(id, line);
  if (/Done \([\d.,]+s\)!/.test(line)) { r.state = 'online'; emit(id); }
  const dom = line.match(/Domain assigned: ([A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
  if (dom) {
    r.address = dom[1]; emit(id);
    const m = meta(id);
    if (Notification.isSupported()) { const n = new Notification({ title: `${m.name} is online`, body: `Friends join at ${r.address} — click to copy` }); n.on('click', () => clipboard.writeText(r.address)); n.show(); }
  }
  const j = line.match(/\]: ([A-Za-z0-9_]{2,16}) joined the game/); if (j) { r.players.add(j[1]); emit(id); }
  const lft = line.match(/\]: ([A-Za-z0-9_]{2,16}) left the game/); if (lft) { r.players.delete(lft[1]); emit(id); }
  if (/You need to agree to the EULA/i.test(line)) push('toast', { type: 'error', text: 'The server needs the Minecraft EULA accepted.' });
  if (/FAILED TO BIND TO PORT/i.test(line)) push('toast', { type: 'error', text: 'Another program is using this server’s port. Close it, or change the port in the server settings.' });
}

function command(id, cmd) {
  const r = running.get(id);
  if (!r?.proc) throw new Error('The server isn’t running.');
  const c = String(cmd || '').replace(/^\//, '').trim();
  if (!c) return true;
  log(id, '> ' + c);
  r.proc.stdin.write(c + '\n');
  return true;
}
function stop(id) {
  const r = running.get(id);
  if (!r?.proc) return false;
  r.stopping = true; r.state = 'stopping'; emit(id);
  try { r.proc.stdin.write('stop\n'); } catch {}
  setTimeout(() => { if (running.get(id) === r) try { r.proc.kill(); } catch {} }, 30000); // saving big worlds can take a while
  return true;
}
function stopAll() { for (const id of running.keys()) stop(id); }
function anyRunning() { return running.size > 0; }
function logs(id) { return running.get(id)?.lines || []; }

// ---------- settings ----------
const EDITABLE = ['motd', 'gamemode', 'difficulty', 'max-players', 'pvp', 'online-mode', 'white-list', 'allow-flight', 'view-distance', 'spawn-protection', 'server-port'];
function getSettings(id) { const m = meta(id); const p = readProps(id); return { ...Object.fromEntries(EDITABLE.map((k) => [k, p[k]])), memory: m.memory, public: m.public, name: m.name }; }
function setSettings(id, patch) {
  const m = meta(id);
  const props = Object.fromEntries(Object.entries(patch).filter(([k]) => EDITABLE.includes(k)).map(([k, v]) => [k, String(v).replace(/[\r\n]/g, ' ').slice(0, 120)]));
  if (props['server-port']) { const p = Number(props['server-port']); if (!(p >= 1024 && p <= 65535)) throw new Error('Port must be between 1024 and 65535.'); m.port = p; }
  if (Object.keys(props).length) writeProps(id, props);
  if (patch.memory) m.memory = Math.max(1024, Math.min(32768, Number(patch.memory) || m.memory));
  if (patch.name) m.name = String(patch.name).slice(0, 40);
  save(m);
  return getSettings(id);
}
async function remove(id) {
  if (running.has(id)) throw new Error('Stop the server first.');
  await shell.trashItem(dirOf(id));
  return list();
}
function openFolder(id) { return shell.openPath(dirOf(meta(id).id)); }

module.exports = { list, create, start, stop, stopAll, anyRunning, command, logs, getSettings, setSettings, setPublic, remove, openFolder };
