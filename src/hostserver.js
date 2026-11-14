// Hosting: run Minecraft servers on this PC (SquidServers / PocketMC-style), and make them public.
// Software: Vanilla, Paper, Purpur, Fabric, Forge, NeoForge — downloaded from the official sources.
// Public access (no port forwarding):
//   - e4mc (MIT, github.com/vgskye/e4mc-minecraft-architectury): a mod, so Fabric/Forge/NeoForge only, no account;
//     the server prints "Domain assigned: <address>".
//   - playit.gg (src/playit.js): any server type; needs a free playit.gg account (claimed once in the browser).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn, execFile } = require('child_process');
const AdmZip = require('adm-zip');
const { shell, Notification, clipboard } = require('electron');
const { paths, readJSON, writeJSON, getJSON, request, download, push, slugify, profileByName } = require('./util');
const versions = require('./versions');

const SOFTWARE = {
  vanilla: { name: 'Vanilla', kind: 'none' },
  paper: { name: 'Paper', kind: 'plugins' },
  purpur: { name: 'Purpur', kind: 'plugins' },
  fabric: { name: 'Fabric', kind: 'mods' },
  forge: { name: 'Forge', kind: 'mods' },
  neoforge: { name: 'NeoForge', kind: 'mods' },
};
const E4MC_OK = ['fabric', 'forge', 'neoforge'];

const root = () => path.join(paths.getRoot(), 'hosted');
const indexFile = () => path.join(root(), 'servers.json');
const running = new Map(); // id -> { proc, state, address, players:Set, lines, stopping, started, restart, stats }

// ---------- index (servers may live in any folder the player picks) ----------
function index() {
  const idx = readJSON(indexFile(), null);
  if (idx) return idx;
  // first run of the index: pick up servers created by Solaris 1.4 under hosted/<id>
  const found = [];
  try { for (const d of fs.readdirSync(root())) if (fs.existsSync(path.join(root(), d, 'solaris-server.json'))) found.push({ id: d, dir: path.join(root(), d) }); } catch {}
  writeJSON(indexFile(), found);
  return found;
}
const dirOf = (id) => { const e = index().find((x) => x.id === id); if (!e) throw new Error('Server not found'); return e.dir; };
const metaFile = (id) => path.join(dirOf(id), 'solaris-server.json');
function meta(id) {
  const m = readJSON(metaFile(id), null);
  if (!m) throw new Error('This server’s folder is missing. Was it moved or deleted?');
  return { software: 'fabric', tunnel: m.public ? 'e4mc' : 'none', maxPlayers: 10, ...m, id, dir: dirOf(id) };
}
function save(m) { const { dir, ...rest } = m; writeJSON(path.join(dir, 'solaris-server.json'), rest); return view(m); }
function view(m) {
  const r = running.get(m.id);
  const pl = require('./playit');
  const tunnelAddress = m.tunnel === 'e4mc' ? r?.address || null : m.tunnel === 'playit' ? pl.addressFor(m.port) : null;
  return {
    ...m, softwareName: SOFTWARE[m.software]?.name || m.software, contentKind: SOFTWARE[m.software]?.kind || 'none',
    state: r ? r.state : 'offline', players: r ? [...r.players] : [], lan: `localhost:${m.port}`,
    address: tunnelAddress, tunnelStatus: tunnelStatus(m, r), started: r?.started || null, stats: r?.stats || null,
  };
}
function tunnelStatus(m, r) {
  if (m.tunnel === 'none') return { ok: false, text: 'Local network only' };
  if (m.tunnel === 'e4mc') {
    if (!r) return { ok: false, text: 'Public when started (e4mc)' };
    return r.address ? { ok: true, text: 'Public via e4mc' } : { ok: false, text: r.state === 'online' ? 'Connecting to e4mc…' : 'Starting…' };
  }
  return require('./playit').statusFor(m.port, !!r);
}
function list() {
  return index().map((e) => { try { return view(meta(e.id)); } catch (er) { return { id: e.id, dir: e.dir, name: e.id, missing: true, state: 'offline', error: er.message }; } })
    .sort((a, b) => (b.created || 0) - (a.created || 0));
}
function get(id) { return view(meta(id)); }
function emit(id) {
  try {
    const v = view(meta(id));
    push('hosted:state', v);
    // Discord: "Hosting <name> · 2 of 10" while it's online
    require('./discord').setHosted(id, v.state === 'online' ? { name: v.name, software: v.softwareName, mc: v.mc, players: v.players.length, max: v.maxPlayers, address: v.address } : null);
  } catch {}
}

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
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

// ---------- versions per software ----------
async function softwareVersions(software) {
  if (software === 'vanilla') return (await versions.getManifest()).versions.filter((v) => v.type === 'release').map((v) => v.id);
  if (software === 'paper') { const d = await getJSON('https://fill.papermc.io/v3/projects/paper'); return Object.values(d.versions || {}).flat(); }
  if (software === 'purpur') return (await getJSON('https://api.purpurmc.org/v2/purpur')).versions.slice().reverse();
  if (software === 'fabric') return (await getJSON('https://meta.fabricmc.net/v2/versions/game')).filter((v) => v.stable).map((v) => v.version);
  if (software === 'forge' || software === 'neoforge') {
    const rel = (await versions.getManifest()).versions.filter((v) => v.type === 'release').map((v) => v.id).slice(0, 40);
    const loaders = require('./loaders');
    const ok = await Promise.all(rel.map(async (v) => ((await loaders.listVersions(software, v).catch(() => [])).length ? v : null)));
    return ok.filter(Boolean);
  }
  throw new Error('Unknown server software');
}

// ---------- install ----------
async function bestModFile(slug, mc, loader) {
  const q = `loaders=${encodeURIComponent(JSON.stringify([loader]))}&game_versions=${encodeURIComponent(JSON.stringify([mc]))}`;
  const vs = await getJSON(`https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}/version?${q}`).catch(() => []);
  return vs.find((x) => x.version_type === 'release') || vs[0] || null;
}
function runJava(java, args, cwd, onLine) {
  return new Promise((resolve, reject) => {
    const p = spawn(java.replace(/javaw\.exe$/i, 'java.exe'), args, { cwd, windowsHide: true });
    const tail = [];
    const on = (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => { tail.push(l); if (tail.length > 30) tail.shift(); onLine && onLine(l); });
    p.stdout.on('data', on); p.stderr.on('data', on);
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`Installer failed (code ${c}): ${tail.slice(-3).join(' ')}`))));
  });
}
async function javaFor(mc, resolveJava, onStep) {
  const version = await versions.resolveVersion(mc);
  return resolveJava({ versionId: mc, javaPath: null }, version, (d, t) => onStep && onStep(`Installing Java ${Math.round((d / t) * 100)}%`));
}

/** Downloads/installs the server software into dir; returns the start command (relative to dir). */
async function installSoftware(m, resolveJava, onStep) {
  const dir = m.dir, mc = m.mc;
  const jar = path.join(dir, 'server.jar');
  if (m.software === 'vanilla') {
    onStep && onStep('Downloading the Minecraft server');
    const v = await versions.getVersionJson(mc);
    if (!v.downloads?.server) throw new Error(`Minecraft ${mc} has no official server download.`);
    await download(v.downloads.server.url, jar, { sha1: v.downloads.server.sha1 });
    return { jar: 'server.jar' };
  }
  if (m.software === 'paper') {
    onStep && onStep('Downloading Paper');
    const builds = await getJSON(`https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(mc)}/builds`);
    const b = builds.find((x) => x.channel === 'STABLE') || builds[0];
    const dl = b?.downloads?.['server:default'];
    if (!dl) throw new Error(`Paper has no build for ${mc} yet.`);
    await download(dl.url, jar, { sha256: dl.checksums?.sha256 });
    m.softwareBuild = String(b.id);
    return { jar: 'server.jar' };
  }
  if (m.software === 'purpur') {
    onStep && onStep('Downloading Purpur');
    const info = await getJSON(`https://api.purpurmc.org/v2/purpur/${encodeURIComponent(mc)}`);
    if (!info?.builds?.latest) throw new Error(`Purpur has no build for ${mc} yet.`);
    await download(`https://api.purpurmc.org/v2/purpur/${encodeURIComponent(mc)}/${info.builds.latest}/download`, jar);
    m.softwareBuild = String(info.builds.latest);
    return { jar: 'server.jar' };
  }
  if (m.software === 'fabric') {
    onStep && onStep('Downloading the Fabric server');
    const loaders = await getJSON(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}`);
    if (!loaders.length) throw new Error(`Fabric isn’t available for ${mc} yet.`);
    const installers = await getJSON('https://meta.fabricmc.net/v2/versions/installer');
    const loader = (loaders.find((l) => l.loader.stable) || loaders[0]).loader.version;
    const installer = (installers.find((i) => i.stable) || installers[0]).version;
    await download(`https://meta.fabricmc.net/v2/versions/loader/${mc}/${loader}/${installer}/server/jar`, jar);
    m.softwareBuild = loader;
    return { jar: 'server.jar' };
  }
  if (m.software === 'forge' || m.software === 'neoforge') {
    const list = await require('./loaders').listVersions(m.software, mc);
    if (!list.length) throw new Error(`${SOFTWARE[m.software].name} isn’t available for ${mc}.`);
    const lv = (list.find((x) => x.recommended) || list.find((x) => x.stable) || list[0]).version;
    const url = m.software === 'forge'
      ? `https://maven.minecraftforge.net/net/minecraftforge/forge/${lv}/forge-${lv}-installer.jar`
      : `https://maven.neoforged.net/releases/net/neoforged/neoforge/${lv}/neoforge-${lv}-installer.jar`;
    const inst = path.join(dir, 'installer.jar');
    onStep && onStep(`Downloading ${SOFTWARE[m.software].name} ${lv}`);
    await download(url, inst);
    const java = await javaFor(mc, resolveJava, onStep);
    onStep && onStep(`Installing ${SOFTWARE[m.software].name} (about a minute)`);
    await runJava(java, ['-jar', inst, m.software === 'forge' ? '--installServer' : '--install-server', dir], dir, (l) => onStep && /Downloading|Extracting|Processing/i.test(l) && onStep(l.slice(0, 80)));
    try { fs.rmSync(inst, { force: true }); fs.rmSync(inst + '.log', { force: true }); } catch {}
    m.softwareBuild = lv;
    // Modern (1.17+): an args file; older: a runnable forge-*.jar
    const group = m.software === 'forge' ? 'net/minecraftforge/forge' : 'net/neoforged/neoforge';
    const args = path.join(dir, 'libraries', ...group.split('/'), lv, process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt');
    if (fs.existsSync(args)) return { argsFile: path.relative(dir, args) };
    const runnable = fs.readdirSync(dir).find((f) => /^(forge|neoforge)-.*\.jar$/i.test(f) && !/installer/i.test(f));
    if (runnable) return { jar: runnable };
    throw new Error('The installer finished but no server start file was found.');
  }
  throw new Error('Unknown server software');
}

async function addE4mc(m) {
  const v = await bestModFile('e4mc', m.mc, m.software);
  if (!v) return false;
  const f = v.files.find((x) => x.primary) || v.files[0];
  fs.mkdirSync(path.join(m.dir, 'mods'), { recursive: true });
  await download(f.url, path.join(m.dir, 'mods', f.filename), { sha1: f.hashes.sha1 });
  return true;
}
function removeE4mc(m) {
  const mods = path.join(m.dir, 'mods');
  for (const f of fs.existsSync(mods) ? fs.readdirSync(mods) : []) if (/^e4mc/i.test(f)) fs.rmSync(path.join(mods, f), { force: true });
}

function nextPort() {
  const used = new Set(list().map((s) => s.port));
  let p = 25565; while (used.has(p)) p++;
  return p;
}

async function create(opts, resolveJava, onStep) {
  const { name, mc, software = 'fabric', memory = 3072, maxPlayers = 10, port, dir: chosenDir, tunnel = 'e4mc', eula = false, modpack } = opts;
  if (!eula) throw new Error('You need to accept the Minecraft EULA to run a server.');
  if (!SOFTWARE[software]) throw new Error('Pick the server software.');
  if (!/^[\w.-]+$/.test(mc || '')) throw new Error('Pick a Minecraft version.');
  const p = port ? Number(port) : nextPort();
  if (!(p >= 1024 && p <= 65535)) throw new Error('Port must be between 1024 and 65535.');
  if (list().some((s) => s.port === p)) throw new Error(`Another Solaris server already uses port ${p}.`);
  let id = slugify(name || `server-${mc}`) || 'server';
  while (index().some((e) => e.id === id)) id += '-2';
  const dir = chosenDir ? path.resolve(chosenDir) : path.join(root(), id);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error('That folder isn’t empty. Pick an empty folder for a new server.');
  fs.mkdirSync(dir, { recursive: true });
  writeJSON(indexFile(), [...index(), { id, dir }]);
  const m = { id, dir, name: String(name || `${SOFTWARE[software].name} ${mc}`).slice(0, 40), mc, software, memory: clampMem(memory), maxPlayers: Math.max(1, Math.min(200, Number(maxPlayers) || 10)), port: p, tunnel: tunnelAllowed(software, tunnel), created: Date.now() };
  try {
    const start = await installSoftware(m, resolveJava, onStep);
    m.start = start;
    fs.writeFileSync(path.join(dir, 'eula.txt'), `# Accepted in Solaris on ${new Date().toISOString()} (https://aka.ms/MinecraftEULA)\neula=true\n`);
    writeProps(id, { motd: `${m.name} \\u00a77\\u2014 hosted with Solaris`, 'server-port': p, 'max-players': m.maxPlayers, 'online-mode': true, 'spawn-protection': 0, difficulty: 'normal', 'enable-command-block': false });
    if (m.tunnel === 'e4mc') { onStep && onStep('Adding e4mc for the public address'); if (!(await addE4mc(m))) m.tunnel = 'none'; }
    if (SOFTWARE[software].kind === 'mods') {
      for (const slug of software === 'fabric' ? ['fabric-api', 'lithium', 'ferrite-core'] : ['ferrite-core']) {
        onStep && onStep(`Adding ${slug}`);
        await installContent(m, slug, null, true).catch(() => {});
      }
    }
    if (modpack) { onStep && onStep('Installing the modpack'); await installModpack(m, modpack, onStep); }
    // The player who made the server can always join it and run commands: whitelist + operator.
    addOwner(m);
  } catch (e) {
    writeJSON(indexFile(), index().filter((x) => x.id !== id));
    if (!chosenDir) try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    throw e;
  }
  return save(m);
}
function addOwner(m) {
  try {
    const a = require('./accounts').active();
    if (!a || a.type !== 'msa' || !a.uuid) return; // offline names can't join online-mode servers anyway
    const uuid = String(a.uuid).replace(/^(.{8})-?(.{4})-?(.{4})-?(.{4})-?(.{12})$/, '$1-$2-$3-$4-$5');
    const add = (file, entry) => {
      const f = path.join(m.dir, file);
      const l = readJSON(f, []).filter((p) => p.uuid !== uuid);
      l.push(entry); writeJSON(f, l);
    };
    add('whitelist.json', { uuid, name: a.name });
    add('ops.json', { uuid, name: a.name, level: 4, bypassesPlayerLimit: true });
  } catch {}
}
const clampMem = (v) => Math.max(1024, Math.min(65536, Number(v) || 3072));
const tunnelAllowed = (software, t) => (t === 'e4mc' && !E4MC_OK.includes(software) ? 'playit' : ['e4mc', 'playit', 'none'].includes(t) ? t : 'none');

async function setTunnel(id, tunnel) {
  const m = meta(id);
  if (running.has(id)) throw new Error('Stop the server first.');
  const t = tunnelAllowed(m.software, tunnel);
  if (t === 'e4mc') { if (!(await addE4mc(m))) throw new Error(`e4mc isn’t available for ${m.softwareName || m.software} ${m.mc}. Use playit.gg instead.`); }
  else removeE4mc(m);
  m.tunnel = t;
  return save(m);
}

// ---------- run ----------
async function start(id, resolveJava) {
  if (running.has(id)) return get(id);
  const m = meta(id);
  const r = { proc: null, state: 'starting', address: null, players: new Set(), lines: [], stopping: false, started: Date.now(), stats: null };
  running.set(id, r); emit(id);
  let java;
  try { java = await javaFor(m.mc, resolveJava, (s) => log(id, '[Solaris] ' + s)); }
  catch (e) { running.delete(id); emit(id); throw e; }
  // Stopped (or Solaris quitting) while Java was still being prepared: don't start it after all.
  if (r.cancelled) { running.delete(id); emit(id); return get(id); }
  // The port must be free. Usually it isn't because an earlier copy of this same server kept running after
  // Solaris closed (or updated) — close that one safely, otherwise explain what's wrong instead of crashing.
  try {
    if (!(await portFree(m.port))) {
      const old = readPid(m.dir);
      if (old && (await isOurServer(old, m.dir))) {
        log(id, `[Solaris] An earlier copy of this server is still running (process ${old}) — closing it first.`);
        try { process.kill(old); } catch {}
        for (let i = 0; i < 40 && !(await portFree(m.port)); i++) await new Promise((res) => setTimeout(res, 500));
      }
      if (!(await portFree(m.port))) throw new Error(`Port ${m.port} is already in use by another program (maybe another Minecraft server). Close it, or pick another port in this server’s Settings.`);
    }
  } catch (e) { running.delete(id); emit(id); throw e; }
  writeProps(id, { 'server-port': m.port });
  const st = m.start || { jar: 'server.jar' };
  const args = [`-Xmx${m.memory}M`, `-Xms${Math.min(1024, m.memory)}M`, '-XX:+UseG1GC', ...(st.argsFile ? ['@' + st.argsFile] : ['-jar', st.jar]), 'nogui'];
  log(id, `[Solaris] Starting ${m.name} — ${SOFTWARE[m.software].name} ${m.mc}, ${m.memory} MB, port ${m.port}`);
  if (m.tunnel === 'playit') require('./playit').serverStarted(m.port, m.name).catch((e) => log(id, '[Solaris] playit.gg: ' + e.message));
  const proc = spawn(java.replace(/javaw\.exe$/i, 'java.exe'), args, { cwd: m.dir, windowsHide: true });
  r.proc = proc;
  if (proc.pid) writePid(m.dir, proc.pid);
  proc.stdin.on('error', () => {}); // writing a command to a server that just exited (EPIPE) must not crash Solaris
  let buf = '';
  const onData = (d) => { buf += d; const parts = buf.split(/\r?\n/); buf = parts.pop(); parts.forEach((l) => onLine(id, l)); };
  proc.stdout.on('data', onData); proc.stderr.on('data', onData);
  proc.on('error', (e) => { log(id, '[Solaris] Could not start Java: ' + e.message); running.delete(id); emit(id); });
  proc.on('close', (code) => {
    if (buf) { onLine(id, buf); buf = ''; }
    writePid(m.dir, null);
    const restart = r.restart;
    log(id, `[Solaris] Server stopped${code && !r.stopping ? ` (exit code ${code})` : ''} after ${fmtUptime(Date.now() - r.started)}.`);
    running.delete(id); emit(id);
    if (m.tunnel === 'playit') require('./playit').serverStopped(m.port);
    push('hosted:stopped', { id, crashed: !!code && !r.stopping });
    if (restart) start(id, resolveJava).catch((e) => push('toast', { type: 'error', text: 'Restart failed: ' + e.message }));
  });
  return get(id);
}
// ---------- port / leftover server process ----------
function portFree(port) {
  return new Promise((resolve) => {
    const s = require('net').createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '0.0.0.0');
  });
}
const pidFile = (dir) => path.join(dir, '.solaris-pid');
function readPid(dir) { try { const n = Number(fs.readFileSync(pidFile(dir), 'utf8').trim()); return n > 0 ? n : null; } catch { return null; } }
function writePid(dir, pid) { try { if (pid) fs.writeFileSync(pidFile(dir), String(pid)); else fs.rmSync(pidFile(dir), { force: true }); } catch {} }
/** Is process `pid` still this server's Java (and not some other program that got the same process number)? */
function isOurServer(pid, dir) {
  try { process.kill(pid, 0); } catch { return Promise.resolve(false); }
  if (process.platform === 'linux') {
    try { return Promise.resolve(path.resolve(fs.readlinkSync(`/proc/${pid}/cwd`)) === path.resolve(dir) && /java/.test(fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'))); } catch { return Promise.resolve(false); }
  }
  if (process.platform === 'win32') {
    return new Promise((resolve) => execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000 }, (err, out) => resolve(!err && /^"javaw?\.exe"/i.test(String(out).trim()))));
  }
  return new Promise((resolve) => execFile('ps', ['-o', 'comm=', '-p', String(pid)], { timeout: 8000 }, (err, out) => resolve(!err && /java/.test(String(out)))));
}

const fmtUptime = (ms) => { const s = Math.floor(ms / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`; };

function log(id, line) {
  const r = running.get(id);
  if (r) { r.lines.push(line); if (r.lines.length > 4000) r.lines.shift(); }
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
  const nwl = line.match(/Disconnecting ([A-Za-z0-9_]{2,16}) .*not white-?listed/i);
  if (nwl) push('hosted:notWhitelisted', { id, name: nwl[1] });
  if (/You need to agree to the EULA/i.test(line)) push('toast', { type: 'error', text: 'The server needs the Minecraft EULA accepted.' });
  if (/FAILED TO BIND TO PORT/i.test(line)) push('toast', { type: 'error', text: 'Another program is using this server’s port. Close it, or change the port in Settings.' });
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
function stop(id, { restart = false } = {}) {
  const r = running.get(id);
  if (!r) return false;
  if (!r.proc) { r.cancelled = true; r.state = 'stopping'; emit(id); return true; } // still preparing Java
  r.stopping = true; r.restart = restart; r.state = restart ? 'restarting' : 'stopping'; emit(id);
  try { r.proc.stdin.write('stop\n'); } catch {}
  setTimeout(() => { if (running.get(id) === r) try { r.proc.kill(); } catch {} }, 45000); // big worlds take a while to save
  return true;
}
function restart(id) { return stop(id, { restart: true }); }
function stopAll() { for (const id of running.keys()) stop(id); }
function anyRunning() { return running.size > 0; }
function logs(id) { return running.get(id)?.lines || []; }

// ---------- CPU / RAM of running servers (sampled every 3 s) ----------
// Each sampler returns [{ pid, cpuSec (total CPU seconds used), rssBytes }].
const CLK_TCK = 100; // Linux kernel clock ticks per second (USER_HZ is 100 on every mainstream distro)
function sampleLinux(pids) {
  const rows = [];
  for (const pid of pids) {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const f = stat.slice(stat.lastIndexOf(')') + 2).split(' '); // fields after "(comm)"; f[0] is field 3 (state)
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      const rss = Number((status.match(/VmRSS:\s+(\d+)/) || [])[1] || 0) * 1024;
      rows.push({ pid, cpuSec: (Number(f[11]) + Number(f[12])) / CLK_TCK, rssBytes: rss });
    } catch {}
  }
  return Promise.resolve(rows);
}
function sampleWindows(pids) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,CPU,WorkingSet64 | ConvertTo-Json -Compress`], { windowsHide: true, timeout: 8000 }, (err, out) => {
      if (err || !String(out).trim()) return resolve([]);
      let rows; try { rows = JSON.parse(out); } catch { return resolve([]); }
      if (!Array.isArray(rows)) rows = [rows];
      resolve(rows.map((x) => ({ pid: x.Id, cpuSec: x.CPU, rssBytes: x.WorkingSet64 })));
    });
  });
}
function sampleMac(pids) {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'pid=,time=,rss=', '-p', pids.join(',')], { timeout: 8000 }, (err, out) => {
      if (err) return resolve([]);
      resolve(String(out).trim().split('\n').map((l) => {
        const [pid, time, rss] = l.trim().split(/\s+/);
        const t = time.split(/[:-]/).map(Number); let sec = 0; for (const x of t) sec = sec * 60 + x;
        return { pid: Number(pid), cpuSec: sec, rssBytes: Number(rss) * 1024 };
      }));
    });
  });
}
const sampler = process.platform === 'win32' ? sampleWindows : process.platform === 'linux' ? sampleLinux : sampleMac;
let lastCpu = new Map(), sampling = false;
setInterval(async () => {
  if (!running.size || sampling) return;
  const pids = [...running.values()].map((r) => r.proc?.pid).filter(Boolean);
  if (!pids.length) return;
  sampling = true;
  try {
    const rows = await sampler(pids);
    const now = Date.now(), cores = require('os').cpus().length;
    for (const [id, r] of running) {
      const row = rows.find((x) => x.pid === r.proc?.pid); if (!row) continue;
      const prev = lastCpu.get(id);
      const cpu = prev && prev.pid === row.pid ? Math.max(0, Math.min(100, ((row.cpuSec - prev.cpu) / ((now - prev.t) / 1000) / cores) * 100)) : null;
      lastCpu.set(id, { cpu: row.cpuSec, t: now, pid: row.pid });
      r.stats = { cpu, ramMb: Math.round(row.rssBytes / 1048576) };
      push('hosted:stats', { id, ...r.stats, uptime: now - r.started });
    }
  } catch {} finally { sampling = false; }
}, 3000).unref?.();

// ---------- settings ----------
function getSettings(id) { const m = meta(id); return { props: readProps(id), memory: m.memory, tunnel: m.tunnel, name: m.name, port: m.port, software: m.software, mc: m.mc, dir: m.dir }; }
function setSettings(id, patch) {
  const m = meta(id);
  if (patch.props) {
    const props = {};
    for (const [k, v] of Object.entries(patch.props)) { if (!/^[a-z0-9.-]+$/i.test(k)) continue; props[k] = String(v).replace(/[\r\n]/g, ' ').slice(0, 300); }
    if (props['server-port']) { const p = Number(props['server-port']); if (!(p >= 1024 && p <= 65535)) throw new Error('Port must be between 1024 and 65535.'); if (list().some((s) => s.id !== id && s.port === p)) throw new Error(`Another Solaris server uses port ${p}.`); m.port = p; }
    if (props['max-players']) m.maxPlayers = Number(props['max-players']) || m.maxPlayers;
    writeProps(id, props);
  }
  if (patch.memory) m.memory = clampMem(patch.memory);
  if (patch.name) m.name = String(patch.name).slice(0, 40);
  save(m);
  emit(id); // the page header and cards show the new name right away
  return getSettings(id);
}
async function remove(id) {
  if (running.has(id)) throw new Error('Stop the server first.');
  const dir = dirOf(id);
  // Deleted for good, like instances. Only folders that really are Solaris servers are removed.
  if (fs.existsSync(path.join(dir, 'solaris-server.json'))) await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  writeJSON(indexFile(), index().filter((x) => x.id !== id));
  return list();
}
function openFolder(id, sub = '') { const p = path.join(dirOf(id), sub); fs.mkdirSync(p, { recursive: true }); return shell.openPath(p); }

// ---------- worlds ----------
function worlds(id) {
  const dir = dirOf(id), active = readProps(id)['level-name'] || 'world';
  return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'level.dat')))
    .map((d) => ({ name: d.name, active: d.name === active, modified: fs.statSync(path.join(dir, d.name, 'level.dat')).mtimeMs }));
}
function setActiveWorld(id, name) {
  if (running.has(id)) throw new Error('Stop the server first.');
  if (!worlds(id).some((w) => w.name === name)) throw new Error('That world folder doesn’t exist.');
  writeProps(id, { 'level-name': name });
  return worlds(id);
}
async function deleteWorld(id, name) {
  if (running.has(id)) throw new Error('Stop the server first.');
  const dir = dirOf(id), w = path.resolve(dir, name);
  if (path.dirname(w) !== path.resolve(dir) || !fs.existsSync(path.join(w, 'level.dat'))) throw new Error('Not a world folder');
  await fs.promises.rm(w, { recursive: true, force: true });
  for (const extra of ['_nether', '_the_end']) { const e = w + extra; if (fs.existsSync(path.join(e, 'level.dat'))) await fs.promises.rm(e, { recursive: true, force: true }); }
  return worlds(id);
}

// ---------- whitelist / operators ----------
const listFile = (id, kind) => path.join(dirOf(id), kind === 'ops' ? 'ops.json' : 'whitelist.json');
function people(id, kind) { return readJSON(listFile(id, kind), []); }
async function addPerson(id, kind, name) {
  const prof = await profileByName(String(name || '').trim());
  if (!prof) throw new Error(`No Minecraft player called “${name}”.`);
  const uuid = prof.id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  if (running.has(id)) command(id, `${kind === 'ops' ? 'op' : 'whitelist add'} ${prof.name}`); // the server updates its own file
  else {
    const l = people(id, kind).filter((p) => p.uuid !== uuid);
    l.push(kind === 'ops' ? { uuid, name: prof.name, level: 4, bypassesPlayerLimit: false } : { uuid, name: prof.name });
    writeJSON(listFile(id, kind), l);
  }
  return kind === 'ops' || !running.has(id) ? people(id, kind) : [...people(id, kind).filter((p) => p.uuid !== uuid), { uuid, name: prof.name }];
}
function removePerson(id, kind, name) {
  if (running.has(id)) command(id, `${kind === 'ops' ? 'deop' : 'whitelist remove'} ${name}`);
  else writeJSON(listFile(id, kind), people(id, kind).filter((p) => p.name.toLowerCase() !== String(name).toLowerCase()));
  return people(id, kind).filter((p) => p.name.toLowerCase() !== String(name).toLowerCase());
}

// ---------- backups ----------
const backupsDir = (id) => path.join(dirOf(id), 'backups');
function backups(id) {
  try { return fs.readdirSync(backupsDir(id)).filter((f) => f.endsWith('.zip')).map((f) => ({ file: f, size: fs.statSync(path.join(backupsDir(id), f)).size, time: fs.statSync(path.join(backupsDir(id), f)).mtimeMs })).sort((a, b) => b.time - a.time); }
  catch { return []; }
}
async function backup(id) {
  const dir = dirOf(id), live = running.has(id);
  // Paper/Purpur keep world_nether / world_the_end as worlds of their own: list every folder once.
  const ws = [...new Set(worlds(id).map((w) => w.name).flatMap((n) => [n, n + '_nether', n + '_the_end']))].filter((n) => fs.existsSync(path.join(dir, n)));
  if (!ws.length) throw new Error('There’s no world to back up yet — start the server once first.');
  if (live) { command(id, 'save-off'); command(id, 'save-all flush'); await new Promise((r) => setTimeout(r, 4000)); }
  try {
    const zip = new AdmZip();
    // session.lock is held open by a running server (and isn't world data) — leave it out.
    for (const w of ws) await zip.addLocalFolderPromise(path.join(dir, w), { zipPath: w, filter: (f) => !/(^|[\\/])session\.lock$/.test(f) });
    for (const f of ['server.properties', 'whitelist.json', 'ops.json']) if (fs.existsSync(path.join(dir, f))) zip.addLocalFile(path.join(dir, f));
    fs.mkdirSync(backupsDir(id), { recursive: true });
    const name = `backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`;
    await zip.writeZipPromise(path.join(backupsDir(id), name));
    return backups(id);
  } finally { if (live && running.has(id)) command(id, 'save-on'); }
}
async function restore(id, file) {
  if (running.has(id)) throw new Error('Stop the server first.');
  const dir = dirOf(id), zipPath = path.join(backupsDir(id), path.basename(file));
  const zip = new AdmZip(zipPath);
  const tops = [...new Set(zip.getEntries().map((e) => e.entryName.split('/')[0]))].filter((t) => t && !t.includes('..'));
  for (const t of tops) { const p = path.join(dir, t); if (fs.existsSync(p) && fs.statSync(p).isDirectory()) await fs.promises.rm(p, { recursive: true, force: true }); }
  zip.extractAllTo(dir, true);
  return worlds(id);
}
async function deleteBackup(id, file) { await fs.promises.rm(path.join(backupsDir(id), path.basename(file)), { force: true }); return backups(id); }

// ---------- server log files ----------
function logFiles(id) {
  const d = path.join(dirOf(id), 'logs');
  try { return fs.readdirSync(d).filter((f) => /\.log(\.gz)?$/.test(f)).map((f) => ({ file: f, time: fs.statSync(path.join(d, f)).mtimeMs })).sort((a, b) => b.time - a.time).slice(0, 60); } catch { return []; }
}
function readLog(id, file) {
  const f = path.join(dirOf(id), 'logs', path.basename(file));
  const buf = fs.readFileSync(f);
  const text = f.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  return text.length > 400000 ? text.slice(-400000) : text;
}

// ---------- mods / plugins / modpacks (Modrinth, checked against version + loader) ----------
const contentDir = (m) => path.join(m.dir, SOFTWARE[m.software].kind === 'plugins' ? 'plugins' : 'mods');
const loadersFor = (m) => (m.software === 'paper' ? ['paper', 'spigot', 'bukkit'] : m.software === 'purpur' ? ['purpur', 'paper', 'spigot', 'bukkit'] : [m.software]);
async function searchContent(id, query = '', offset = 0) {
  const m = meta(id);
  if (SOFTWARE[m.software].kind === 'none') throw new Error('Vanilla servers can’t run mods or plugins. Create a Paper, Purpur, Fabric, Forge or NeoForge server.');
  const kind = SOFTWARE[m.software].kind === 'plugins' ? 'plugin' : 'mod';
  const facets = [[`project_type:${kind}`], loadersFor(m).map((l) => `categories:${l}`), [`versions:${m.mc}`], ['server_side:required', 'server_side:optional']];
  const r = await getJSON(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(JSON.stringify(facets))}&limit=20&offset=${offset}&index=${query ? 'relevance' : 'downloads'}`);
  const have = installedContent(id).map((x) => x.projectId).filter(Boolean);
  return { total: r.total_hits, hits: r.hits.map((h) => ({ id: h.project_id, slug: h.slug, title: h.title, description: h.description, icon: h.icon_url, downloads: h.downloads, author: h.author, installed: have.includes(h.project_id) })) };
}
const recordFile = (m) => path.join(m.dir, 'solaris-content.json');
function installedContent(id) {
  const m = meta(id), dir = contentDir(m), rec = readJSON(recordFile(m), {});
  let files = []; try { files = fs.readdirSync(dir).filter((f) => /\.jar(\.disabled)?$/i.test(f)); } catch {}
  return files.map((f) => { const e = Object.entries(rec).find(([, v]) => v.file === f.replace(/\.disabled$/, '')); return { file: f, enabled: !f.endsWith('.disabled'), projectId: e?.[0] || null, title: e?.[1].title || f.replace(/\.jar(\.disabled)?$/i, ''), version: e?.[1].version || '' }; });
}
async function installContent(mOrId, projectId, versionId = null, quiet = false, seen = new Set()) {
  const m = typeof mOrId === 'string' ? meta(mOrId) : mOrId;
  const kind = SOFTWARE[m.software].kind;
  if (kind === 'none') throw new Error('Vanilla servers can’t run mods or plugins.');
  let v = null;
  if (versionId) v = await getJSON(`https://api.modrinth.com/v2/version/${versionId}`);
  else for (const l of loadersFor(m)) { v = await bestModFile(projectId, m.mc, l); if (v) break; }
  if (!v) throw new Error(`No version for ${SOFTWARE[m.software].name} ${m.mc}.`);
  if (seen.has(v.project_id)) return [];
  seen.add(v.project_id);
  const proj = await getJSON(`https://api.modrinth.com/v2/project/${v.project_id}`).catch(() => ({ title: projectId }));
  if (proj.server_side === 'unsupported') { if (quiet) return []; throw new Error(`${proj.title} only works on the client, not on servers.`); }
  const f = v.files.find((x) => x.primary) || v.files[0];
  const dir = contentDir(m); fs.mkdirSync(dir, { recursive: true });
  const rec = readJSON(recordFile(m), {});
  if (rec[v.project_id]?.file && rec[v.project_id].file !== f.filename) fs.rmSync(path.join(dir, rec[v.project_id].file), { force: true });
  await download(f.url, path.join(dir, f.filename), { sha1: f.hashes.sha1 });
  rec[v.project_id] = { file: f.filename, version: v.version_number, title: proj.title };
  writeJSON(recordFile(m), rec);
  const out = [proj.title];
  for (const d of v.dependencies || []) if (d.dependency_type === 'required' && d.project_id) out.push(...(await installContent(m, d.project_id, null, true, seen).catch(() => [])));
  return out;
}
async function removeContent(id, file) {
  const m = meta(id);
  fs.rmSync(path.join(contentDir(m), path.basename(file)), { force: true });
  return installedContent(id);
}
function toggleContent(id, file) {
  const m = meta(id), dir = contentDir(m), f = path.basename(file);
  fs.renameSync(path.join(dir, f), path.join(dir, f.endsWith('.disabled') ? f.slice(0, -9) : f + '.disabled'));
  return installedContent(id);
}
/** Modrinth modpack (.mrpack) server install: server-side files + overrides + server-overrides. */
async function installModpack(m, { versionId }, onStep) {
  const v = await getJSON(`https://api.modrinth.com/v2/version/${versionId}`);
  const f = v.files.find((x) => x.primary) || v.files[0];
  const tmp = path.join(m.dir, '.modpack.mrpack');
  await download(f.url, tmp);
  const zip = new AdmZip(tmp);
  const index = JSON.parse(zip.readAsText('modrinth.index.json'));
  const files = (index.files || []).filter((x) => x.env?.server !== 'unsupported');
  let n = 0;
  for (const file of files) {
    const dest = path.resolve(m.dir, file.path);
    if (!dest.startsWith(path.resolve(m.dir))) continue;
    onStep && onStep(`Modpack files ${++n}/${files.length}`);
    await download(file.downloads[0], dest, { sha1: file.hashes?.sha1 });
  }
  for (const e of zip.getEntries()) {
    const mm = e.entryName.match(/^(overrides|server-overrides)\/(.+)$/);
    if (!mm || e.isDirectory) continue;
    const dest = path.resolve(m.dir, mm[2]);
    if (!dest.startsWith(path.resolve(m.dir))) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.getData());
  }
  fs.rmSync(tmp, { force: true });
  m.modpack = { versionId, name: index.name, version: index.versionId };
}
/** Modpacks whose loader matches this software + Minecraft version (for the create dialog). */
async function modpackVersions(projectId, software, mc) {
  const vs = await getJSON(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version?loaders=${encodeURIComponent(JSON.stringify([software]))}&game_versions=${encodeURIComponent(JSON.stringify([mc]))}`);
  return vs.map((v) => ({ id: v.id, name: v.name, number: v.version_number }));
}

module.exports = {
  SOFTWARE, list, get, create, start, stop, restart, stopAll, anyRunning, command, logs, getSettings, setSettings, setTunnel, remove, openFolder,
  softwareVersions, worlds, setActiveWorld, deleteWorld, people, addPerson, removePerson, backups, backup, restore, deleteBackup,
  logFiles, readLog, searchContent, installedContent, installContent: (id, pid, vid) => installContent(id, pid, vid), removeContent, toggleContent, modpackVersions,
};
