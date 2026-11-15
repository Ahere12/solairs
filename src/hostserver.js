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
  const ts = tunnelStatus(m, r);
  // `address` is only set while it really works (friends can join now). playit.gg addresses stay the same for a
  // server's tunnel, so the saved one is shown separately as `knownAddress` while the server is stopped.
  const live = m.tunnel === 'e4mc' ? r?.address || null : m.tunnel === 'playit' && ts.ok ? require('./playit').liveAddress(m) || m.playitAddress || null : null;
  return {
    ...m, softwareName: SOFTWARE[m.software]?.name || m.software, contentKind: SOFTWARE[m.software]?.kind || 'none',
    state: r ? r.state : 'offline', players: r ? [...r.players] : [], lan: `localhost:${m.port}`,
    address: live, knownAddress: m.tunnel === 'playit' ? (require('./playit').liveAddress(m) || m.playitAddress || null) : null,
    tunnelStatus: ts, started: r?.started || null, stats: r?.stats || null, tunnelBusy: !!r?.tunnelBusy, chunky: r?.chunky || null,
  };
}
function tunnelStatus(m, r) {
  if (m.tunnel === 'none') return { ok: false, state: 'off', text: 'Local network only' };
  if (m.tunnel === 'e4mc') {
    if (!r) return { ok: false, state: 'off', text: 'Public when started (e4mc)' };
    return r.address ? { ok: true, state: 'ok', text: 'Public via e4mc' } : { ok: false, state: 'warn', text: r.state === 'online' ? 'Connecting to e4mc…' : 'Starting…' };
  }
  const st = require('./playit').statusFor(m, !!r, !!m.playitStopped);
  // the server itself must be up too: a connected tunnel to a server that is still starting can't be joined yet
  if (st.ok && r && r.state !== 'online') return { ok: false, state: 'warn', text: 'Tunnel ready — waiting for the server to finish starting' };
  if (r?.tunnelError && !st.ok && st.state !== 'error') return { ok: false, state: 'error', text: r.tunnelError, retry: true };
  return st;
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
  const { name, mc, software = 'fabric', memory = 3072, maxPlayers = 10, port, dir: chosenDir, tunnel = 'e4mc', eula = false, modpack, props: gameProps, tunnelName, content = [], voice = false, bedrock = false, autoStart = false, schedule } = opts;
  if (!eula) throw new Error('You need to accept the Minecraft EULA to run a server.');
  if (!SOFTWARE[software]) throw new Error('Pick the server software.');
  if (!/^[\w.-]+$/.test(mc || '')) throw new Error('Pick a Minecraft version.');
  onStep && onStep('Preparing Minecraft server…');
  let p = port ? Number(port) : nextPort();
  if (!(p >= 1024 && p <= 65535)) throw new Error('Port must be between 1024 and 65535.');
  if (list().some((s) => s.port === p)) throw new Error(`Another Solaris server already uses port ${p}.`);
  if (!(await portFree(p))) {
    if (port) throw new Error(`Port ${p} is already used by another program on this PC. Pick another port, or leave it on “auto”.`);
    const used = new Set(list().map((s) => s.port));
    do { p++; } while (p < 65535 && (used.has(p) || !(await portFree(p))));
  }
  let id = slugify(name || `server-${mc}`) || 'server';
  while (index().some((e) => e.id === id)) id += '-2';
  const dir = chosenDir ? path.resolve(chosenDir) : path.join(root(), id);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error('That folder isn’t empty. Pick an empty folder for a new server.');
  fs.mkdirSync(dir, { recursive: true });
  writeJSON(indexFile(), [...index(), { id, dir }]);
  const m = { id, dir, name: String(name || `${SOFTWARE[software].name} ${mc}`).slice(0, 40), mc, software, memory: clampMem(memory), maxPlayers: Math.max(1, Math.min(200, Number(maxPlayers) || 10)), port: p, tunnel: tunnelAllowed(software, tunnel), created: Date.now() };
  if (tunnelName && String(tunnelName).trim()) m.tunnelName = String(tunnelName).replace(/[^\x20-\x7e]/g, '').trim().slice(0, 40);
  if (autoStart) m.autoStart = true;
  if (schedule) m.schedule = cleanSchedule(schedule);
  try {
    const start = await installSoftware(m, resolveJava, onStep);
    m.start = start;
    fs.writeFileSync(path.join(dir, 'eula.txt'), `# Accepted in Solaris on ${new Date().toISOString()} (https://aka.ms/MinecraftEULA)\neula=true\n`);
    writeProps(id, { motd: `${m.name} \\u00a77\\u2014 hosted with Solaris`, 'server-port': p, 'max-players': m.maxPlayers, 'online-mode': true, 'spawn-protection': 0, difficulty: 'normal', 'enable-command-block': false, ...cleanProps(gameProps) });
    if (m.tunnel === 'e4mc') { onStep && onStep('Adding e4mc for the public address'); if (!(await addE4mc(m))) m.tunnel = 'none'; }
    // modpack first: Solaris's own extras are only added when the pack doesn't already bring them
    if (modpack) { onStep && onStep('Installing the modpack'); await installModpack(m, modpack, onStep); }
    if (SOFTWARE[software].kind === 'mods') {
      for (const slug of software === 'fabric' ? ['fabric-api', 'lithium', 'ferrite-core'] : ['ferrite-core']) {
        onStep && onStep(`Adding ${slug}`);
        await installContent(m, slug, null, true).catch(() => {});
      }
    }
    // Extras ticked in the create dialog (or listed in a setup code): installed like the player picked them.
    if (SOFTWARE[software].kind !== 'none') {
      for (const pid of [...new Set((content || []).map(String))].filter((x) => /^[\w-]{2,64}$/.test(x) && x !== 'simple-voice-chat' && x !== VOICE_ID).slice(0, 40)) {
        onStep && onStep(`Adding ${pid}`);
        try { await installContent(m, pid); } catch (e) { onStep && onStep(`Skipped ${pid}: ${e.message}`); }
      }
      // voice chat is extra: if it isn't out for this version yet, the server is still made (it can be added later)
      if (voice) {
        onStep && onStep('Adding Simple Voice Chat');
        try { await addVoice(m); } catch (e) { delete m.voice; onStep && onStep(`Skipped Simple Voice Chat: ${e.message}`); push('toast', { type: 'warn', text: `Simple Voice Chat wasn’t added: ${e.message} You can turn it on later in the server’s Settings.` }); }
      }
      if (bedrock) {
        onStep && onStep('Adding Bedrock support (Geyser + Floodgate)');
        try { await addBedrock(m); } catch (e) { delete m.bedrock; onStep && onStep(`Skipped Bedrock support: ${e.message}`); push('toast', { type: 'warn', text: `Bedrock support wasn’t added: ${e.message}` }); }
      }
    }
    // The player who made the server can always join it and run commands: whitelist + operator.
    addOwner(m);
  } catch (e) {
    writeJSON(indexFile(), index().filter((x) => x.id !== id));
    if (!chosenDir) try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    throw e;
  }
  save(m);
  // playit.gg: link this PC (once), start the agent, create this server's tunnel and get its real address now,
  // so the player sees the address before the first start. The server files are already installed, so a problem
  // here doesn't undo the server: it's reported, and the tunnel is set up again when the server starts.
  if (m.tunnel === 'playit') {
    const pl = require('./playit');
    try {
      const t = await pl.setupServer({ id, port: m.port, name: m.tunnelName || m.name, tunnelId: null, voice: voiceReq(m), bedrock: bedrockReq(m) }, onStep);
      Object.assign(m, { playitTunnelId: t.tunnelId, playitAddress: t.address });
      applyVoice(m, t); applyBedrock(m, t);
      save(m);
      onStep && onStep(`Public address: ${t.address}`);
      if (m.voice?.address) onStep && onStep(`Voice chat address: ${m.voice.address}`);
      if (m.bedrock?.address) onStep && onStep(`Bedrock address: ${m.bedrock.address}`);
    } catch (e) {
      m.playitSetupError = e.message;
      save(m);
      push('toast', { type: 'warn', text: `The server is ready, but playit.gg isn’t set up yet: ${e.message} Solaris tries again when you start the server, or use “Restart tunnel”.` });
    } finally {
      pl.releaseServer(id); // the agent only runs while a server needs it
    }
  }
  onStep && onStep('Server ready!');
  return view(meta(id));
}
function addOwner(m) {
  try {
    const accounts = require('./accounts');
    const a = accounts.active();
    if (!a || !a.name) return;
    const offlineServer = readProps(m.id)['online-mode'] === 'false';
    if (a.type !== 'msa' && !offlineServer) return; // offline accounts can't join a server that requires Microsoft accounts
    // offline-mode servers know every player by the offline UUID of their name
    const uuid = offlineServer ? accounts.offlineUuid(a.name) : String(a.uuid).replace(/^(.{8})-?(.{4})-?(.{4})-?(.{4})-?(.{12})$/, '$1-$2-$3-$4-$5');
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

// ---------- game settings from the create dialog / setup codes ----------
const PROP_KEYS = ['gamemode', 'difficulty', 'pvp', 'hardcore', 'level-seed', 'motd', 'view-distance', 'simulation-distance', 'online-mode', 'white-list', 'enforce-whitelist', 'allow-flight', 'spawn-protection', 'level-type', 'generate-structures', 'allow-nether', 'spawn-monsters', 'force-gamemode', 'enable-command-block'];
function cleanProps(p) {
  const out = {};
  for (const [k, v] of Object.entries(p || {})) if (PROP_KEYS.includes(k) && v !== '' && v != null) out[k] = String(v).replace(/[\r\n]/g, ' ').replace(/\\:/g, ':').slice(0, 120);
  if (out['level-type']) { const lt = out['level-type'].toLowerCase(); out['level-type'] = lt.includes(':') ? lt : 'minecraft:' + (lt === 'default' ? 'normal' : lt); }
  if (out['white-list'] === 'true') out['enforce-whitelist'] = 'true';
  return out;
}
const cleanSchedule = (sc) => ({ backupHours: Math.max(0, Math.min(168, Number(sc?.backupHours) || 0)), keepBackups: Math.max(1, Math.min(100, Number(sc?.keepBackups) || 10)), restartHours: Math.max(0, Math.min(168, Number(sc?.restartHours) || 0)) });

// ---------- Simple Voice Chat (mod or plugin) + its own playit.gg UDP tunnel ----------
const VOICE_ID = '9eGKb6K1'; // Modrinth project "simple-voice-chat"
const voiceFile = (m) => path.join(m.dir, SOFTWARE[m.software].kind === 'plugins' ? 'plugins' : 'config', 'voicechat', 'voicechat-server.properties');
const voiceReq = (m) => (m.voice?.on && m.tunnel === 'playit' ? { port: m.voice.port, tunnelId: m.voice.tunnelId || null } : null);
function udpFree(port) {
  return new Promise((resolve) => { const sock = require('dgram').createSocket('udp4'); sock.once('error', () => resolve(false)); sock.bind(port, '0.0.0.0', () => sock.close(() => resolve(true))); });
}
async function nextVoicePort(self) {
  const used = new Set([self.port]); for (const e of index()) { try { const o = meta(e.id); if (o.id !== self.id) { used.add(o.port); if (o.voice?.port) used.add(o.voice.port); } } catch {} }
  let p = 24454; while (p < 65535 && (used.has(p) || !(await udpFree(p)))) p++;
  return p;
}
/** Writes port + voice_host into the voice chat config (the mod fills in the rest on first start). */
function writeVoiceConfig(m) {
  if (!m.voice?.on) return;
  const file = voiceFile(m);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let lines = []; try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch {}
  const left = { port: String(m.voice.port), voice_host: m.tunnel === 'playit' && m.voice.address ? m.voice.address : '' };
  lines = lines.map((l) => { const k = (l.match(/^([a-z_]+)=/) || [])[1]; if (k && k in left) { const v = left[k]; delete left[k]; return `${k}=${v}`; } return l; });
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (!lines.length) lines.push('# Simple Voice Chat — port and voice_host are set by Solaris');
  for (const [k, v] of Object.entries(left)) lines.push(`${k}=${v}`);
  fs.writeFileSync(file, lines.join('\n') + '\n');
}
/** Installs the mod/plugin and picks a free UDP port. */
async function addVoice(m) {
  if (SOFTWARE[m.software].kind === 'none') throw new Error('Vanilla servers can’t run Simple Voice Chat — use Paper, Purpur, Fabric, Forge or NeoForge.');
  await installContent(m, 'simple-voice-chat');
  m.voice = { on: true, port: m.voice?.port || (await nextVoicePort(m)), tunnelId: m.voice?.tunnelId || null, address: m.voice?.address || null };
  writeVoiceConfig(m);
}
/** Takes the voice tunnel result from playit.setupServer. Returns true when the address changed. */
function applyVoice(m, t) {
  if (!m.voice?.on) return false;
  if (t.voiceError) { m.voice.error = t.voiceError; return false; }
  if (!t.voice) return false;
  const changed = m.voice.address !== t.voice.address;
  Object.assign(m.voice, { tunnelId: t.voice.tunnelId, address: t.voice.address }); delete m.voice.error;
  writeVoiceConfig(m);
  return changed;
}
async function setVoice(id, on) {
  const m = meta(id);
  if (on) {
    await addVoice(m);
    save(m);
    if (m.tunnel === 'playit' && !running.has(id)) {
      const pl = require('./playit');
      try { const t = await pl.setupServer({ id, port: m.port, name: m.tunnelName || m.name, tunnelId: m.playitTunnelId, voice: voiceReq(m), bedrock: bedrockReq(m) }, null); Object.assign(m, { playitTunnelId: t.tunnelId, playitAddress: t.address }); applyVoice(m, t); applyBedrock(m, t); save(m); }
      catch (e) { m.voice.error = e.message; save(m); }
      finally { pl.releaseServer(id); }
    } else if (running.has(id)) { log(id, '[Solaris] Simple Voice Chat added — restart the server to turn it on.'); if (m.tunnel === 'playit') startTunnel(id).catch(() => {}); }
  } else if (m.voice) {
    const rec = readJSON(recordFile(m), {});
    const vf = rec[VOICE_ID]?.file;
    if (vf) { fs.rmSync(path.join(contentDir(m), vf), { force: true }); fs.rmSync(path.join(contentDir(m), vf + '.disabled'), { force: true }); delete rec[VOICE_ID]; writeJSON(recordFile(m), rec); }
    require('./playit').deleteTunnel(m.voice.tunnelId);
    delete m.voice; save(m);
    if (running.has(id)) log(id, '[Solaris] Simple Voice Chat removed — restart the server to finish.');
  }
  emit(id);
  return get(id);
}

// ---------- setup codes: a whole server setup in one line to copy, keep or share ----------
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (t) => Buffer.from(String(t).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function setupCode(id) {
  const m = meta(id), props = readProps(id), rec = readJSON(recordFile(m), {});
  const keep = {}; for (const k of PROP_KEYS) if (k in props && k !== 'motd') keep[k] = props[k];
  const extras = new Set(['P7dR8mSH', 'gvQqBUqZ', 'uXXizFIs', VOICE_ID, 'wKkoqHrH', 'bWrNNfkb']); // fabric-api, lithium, ferrite-core, voice chat: Solaris adds those itself
  const d = { v: 1, n: m.name, sw: m.software, mc: m.mc, mem: m.memory, max: m.maxPlayers, t: m.tunnel, p: keep, c: m.modpack ? [] : Object.keys(rec).filter((k) => !extras.has(k) && !k.startsWith('geysermc:')), vc: !!m.voice?.on, br: !!m.bedrock?.on, mp: m.modpack?.versionId || null, sc: m.schedule || null };
  return 'SOLARIS-' + b64u(zlib.deflateRawSync(Buffer.from(JSON.stringify(d))));
}
function readSetupCode(code) {
  const c = String(code || '').trim().replace(/\s+/g, '');
  const mm = c.match(/^SOLARIS-([A-Za-z0-9_-]+)$/i);
  if (!mm) throw new Error('That isn’t a Solaris setup code. It starts with SOLARIS-');
  let d; try { d = JSON.parse(zlib.inflateRawSync(unb64u(mm[1])).toString('utf8')); } catch { throw new Error('That setup code is damaged — copy the whole code again.'); }
  if (d.v !== 1 || !SOFTWARE[d.sw]) throw new Error('This setup code was made by a newer Solaris. Update Solaris and try again.');
  return { name: String(d.n || '').slice(0, 40), software: d.sw, mc: String(d.mc || ''), memory: clampMem(d.mem), maxPlayers: Number(d.max) || 10, tunnel: d.t, props: cleanProps(d.p), content: (d.c || []).map(String).slice(0, 40), voice: !!d.vc, bedrock: !!d.br, modpack: d.mp ? { versionId: String(d.mp) } : null, schedule: d.sc ? cleanSchedule(d.sc) : null };
}
/** Join code: the address (+ version) in a short code friends paste into Solaris. */
const JOIN_SUFFIX = [['.gl.joinmc.link', '~j'], ['.joinmc.link', '~k'], ['.gl.at.ply.gg', '~a'], ['.tun.ply.gg', '~t'], ['.ply.gg', '~p'], ['.e4mc.link', '~e']];
function joinCode(id) {
  const v = view(meta(id)), addr = v.address || v.knownAddress;
  if (!addr) throw new Error('This server has no public address yet — start it with playit.gg or e4mc first.');
  let a = addr; for (const [suf, k] of JOIN_SUFFIX) if (a.endsWith(suf) || a.includes(suf + ':')) { a = a.replace(suf, k); break; }
  return 'JOIN-' + b64u(`${a}|${v.mc}|${v.contentKind === 'mods' ? v.softwareName : ''}`);
}
function readJoinCode(code) {
  const mm = String(code || '').trim().match(/^JOIN-([A-Za-z0-9_-]+)$/i);
  if (!mm) throw new Error('That isn’t a join code. Join codes start with JOIN-');
  const [a, mc, modded] = unb64u(mm[1]).toString('utf8').split('|');
  let addr = a || ''; for (const [suf, k] of JOIN_SUFFIX) if (addr.includes(k)) { addr = addr.replace(k, suf); break; }
  if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(addr)) throw new Error('That join code is damaged — ask your friend for it again.');
  return { address: addr, mc: mc || null, modded: modded || '' };
}

// ---------- schedules (auto backups / restarts) and start with Windows ----------
function setSchedule(id, sc) { const m = meta(id); m.schedule = cleanSchedule(sc); save(m); return get(id); }
function setAutoStart(id, on) {
  const m = meta(id); m.autoStart = !!on; save(m);
  if (on) {
    // a server can only start with Windows if Solaris does (hidden in the tray)
    const st = require('./settings');
    if (!st.get().openAtLogin) { st.set({ openAtLogin: true }); require('electron').app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] }); }
  }
  return get(id);
}
function autoStartAll(resolveJava) {
  for (const e of index()) { try { const m = meta(e.id); if (m.autoStart && !running.has(m.id)) start(m.id, resolveJava).catch((er) => push('toast', { type: 'error', text: `${m.name} couldn’t start automatically: ${er.message}` })); } catch {} }
}
setInterval(async () => {
  for (const [id, r] of running) {
    if (r.state !== 'online' || r.stopping) continue;
    let m; try { m = meta(id); } catch { continue; }
    const sc = m.schedule; if (!sc) continue;
    const now = Date.now();
    if (sc.backupHours && !r.autoBackup && now - Math.max(m.lastAutoBackup || 0, r.started) >= sc.backupHours * 3600000) {
      r.autoBackup = true;
      try {
        await backup(id, 'auto');
        const cur = meta(id); cur.lastAutoBackup = Date.now(); save(cur);
        for (const b of backups(id).filter((x) => /^auto-/.test(x.file)).slice(sc.keepBackups || 10)) fs.rmSync(path.join(backupsDir(id), b.file), { force: true });
        log(id, '[Solaris] Automatic backup saved.');
      } catch (e) { log(id, '[Solaris] Automatic backup failed: ' + e.message); }
      finally { r.autoBackup = false; }
    }
    if (sc.restartHours && !r.restartWarned && now - r.started >= sc.restartHours * 3600000) {
      r.restartWarned = true;
      try { command(id, 'say Scheduled restart in 1 minute.'); } catch {}
      setTimeout(() => { if (running.get(id) === r && !r.stopping) { log(id, '[Solaris] Scheduled restart.'); restart(id); } }, 60000);
    }
  }
}, 60000).unref?.();

// ---------- small YAML helper (Geyser's config): set one key, keep everything else and all comments ----------
function setYaml(text, keyPath, value) {
  const lines = String(text || '').split(/\r?\n/);
  const stack = []; let parentAt = -1, parentInd = -2, parentDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const mm = lines[i].match(/^(\s*)([A-Za-z0-9_-]+):(.*)$/); if (!mm) continue;
    const ind = mm[1].length;
    while (stack.length && stack[stack.length - 1].ind >= ind) stack.pop();
    stack.push({ ind, key: mm[2] });
    const keys = stack.map((x) => x.key);
    if (keys.join('.') === keyPath.join('.')) {
      lines[i] = `${mm[1]}${mm[2]}: ${value}`;
      // a block list under this key (- item lines) is replaced by the new value
      while (i + 1 < lines.length && /^\s*- /.test(lines[i + 1]) && lines[i + 1].match(/^(\s*)/)[1].length >= ind) lines.splice(i + 1, 1);
      return lines.join('\n');
    }
    if (keys.length < keyPath.length && keys.every((k, n) => k === keyPath[n]) && keys.length > parentDepth) { parentAt = i; parentInd = ind; parentDepth = keys.length; }
  }
  // missing: add it (with any missing parents) under the deepest parent that exists
  const base = parentAt >= 0 ? parentInd + 2 : 0;
  const add = keyPath.slice(parentDepth).map((k, n, all) => `${' '.repeat(base + n * 2)}${k}:${n === all.length - 1 ? ' ' + value : ''}`);
  if (parentAt >= 0) lines.splice(parentAt + 1, 0, ...add);
  else { while (lines.length && !lines[lines.length - 1]) lines.pop(); lines.push(...add); }
  return lines.join('\n');
}

// ---------- Bedrock players: Geyser + Floodgate, with a playit.gg TCP+UDP tunnel ----------
const GEYSER = { geyser: 'wKkoqHrH', floodgate: 'bWrNNfkb' }; // Modrinth projects (mod servers)
const BEDROCK_OK = ['paper', 'purpur', 'fabric', 'neoforge'];
const geyserFile = (m) => path.join(m.dir, ...(SOFTWARE[m.software].kind === 'plugins' ? ['plugins', 'Geyser-Spigot'] : ['config', m.software === 'neoforge' ? 'Geyser-NeoForge' : 'Geyser-Fabric']), 'config.yml');
const bedrockReq = (m) => (m.bedrock?.on && m.tunnel === 'playit' ? { port: m.bedrock.port, tunnelId: m.bedrock.tunnelId || null } : null);
function tcpFree(port) { return portFree(port); }
async function nextSidePort(m, from) {
  const used = new Set([m.port, m.voice?.port, m.bedrock?.port].filter(Boolean));
  for (const e of index()) { try { const o = meta(e.id); if (o.id !== m.id) for (const p of [o.port, o.voice?.port, o.bedrock?.port]) if (p) used.add(p); } catch {} }
  let p = from; while (p < 65535 && (used.has(p) || !(await udpFree(p)) || !(await tcpFree(p)))) p++;
  return p;
}
/** Port, Floodgate login and the public address Bedrock players are told to use. */
function writeBedrockConfig(m) {
  if (!m.bedrock?.on) return;
  const file = geyserFile(m);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let y = ''; try { y = fs.readFileSync(file, 'utf8'); } catch {}
  if (!y.trim()) y = '# Geyser — port, login and address are set by Solaris; Geyser adds everything else on first start.\n';
  y = setYaml(y, ['bedrock', 'port'], String(m.bedrock.port));
  y = setYaml(y, ['bedrock', 'clone-remote-port'], 'false');
  // playit.gg address: Bedrock players' game data goes there; without it Geyser finds this PC's own address
  const adv = m.tunnel === 'playit' && m.bedrock.address ? `["${m.bedrock.address}"]` : '[]';
  y = setYaml(y, ['bedrock', 'signaling', 'advertise-addresses'], adv);
  y = setYaml(y, ['java', 'auth-type'], 'floodgate'); // Bedrock players join without a Java account
  fs.writeFileSync(file, y.replace(/\n*$/, '\n'));
}
async function geyserMcDownload(project, platform, dest) {
  const b = await getJSON(`https://download.geysermc.org/v2/projects/${project}/versions/latest/builds/latest`);
  const d = b?.downloads?.[platform];
  if (!d) throw new Error(`GeyserMC has no ${project} download for this server type.`);
  await download(`https://download.geysermc.org/v2/projects/${project}/versions/${encodeURIComponent(b.version)}/builds/${b.build}/downloads/${platform}`, dest, d.sha256 ? { sha256: d.sha256 } : {});
  return `${b.version}-b${b.build}`;
}
/**
 * Bedrock players update their game often, and an old Geyser turns new Bedrock versions away: on start, get the
 * newest Geyser + Floodgate (at most every 12 hours). A problem here never stops the server from starting.
 */
async function updateBedrock(m, say) {
  if (!m.bedrock?.on || Date.now() - (m.bedrock.checked || 0) < 12 * 3600000) return;
  try {
    if (SOFTWARE[m.software].kind === 'plugins') {
      const dir = contentDir(m), rec = readJSON(recordFile(m), {});
      for (const [project, file, title] of [['geyser', 'Geyser-Spigot.jar', 'Geyser'], ['floodgate', 'floodgate-spigot.jar', 'Floodgate']]) {
        const b = await getJSON(`https://download.geysermc.org/v2/projects/${project}/versions/latest/builds/latest`);
        const ver = `${b.version}-b${b.build}`;
        if (rec['geysermc:' + project]?.version === ver && fs.existsSync(path.join(dir, file))) continue;
        say(`Updating ${title} to ${ver} (so the newest Bedrock versions can join)…`);
        rec['geysermc:' + project] = { file, version: await geyserMcDownload(project, 'spigot', path.join(dir, file)), title };
        writeJSON(recordFile(m), rec);
      }
    } else {
      for (const pid of [GEYSER.geyser, GEYSER.floodgate]) await installContent(m, pid); // newest for this Minecraft version
    }
    m.bedrock.checked = Date.now(); save(m);
  } catch (e) { say('Couldn’t check for a Geyser update: ' + e.message); }
}
async function addBedrock(m) {
  if (!BEDROCK_OK.includes(m.software)) throw new Error(`Bedrock players can join Paper, Purpur, Fabric and NeoForge servers — not ${SOFTWARE[m.software].name}.`);
  if (SOFTWARE[m.software].kind === 'plugins') {
    // Paper/Purpur: the official GeyserMC builds (always the newest, they support new Minecraft versions first)
    const dir = contentDir(m); fs.mkdirSync(dir, { recursive: true });
    const rec = readJSON(recordFile(m), {});
    for (const [project, file, title] of [['geyser', 'Geyser-Spigot.jar', 'Geyser'], ['floodgate', 'floodgate-spigot.jar', 'Floodgate']]) {
      const version = await geyserMcDownload(project, 'spigot', path.join(dir, file));
      rec['geysermc:' + project] = { file, version, title };
    }
    writeJSON(recordFile(m), rec);
  } else {
    try { await installContent(m, GEYSER.geyser); await installContent(m, GEYSER.floodgate); }
    catch (e) { throw new Error(`Geyser isn’t out for ${SOFTWARE[m.software].name} ${m.mc} yet (${e.message}). Try again later, or use Paper.`); }
  }
  m.bedrock = { on: true, port: m.bedrock?.port || (await nextSidePort(m, 19132)), tunnelId: m.bedrock?.tunnelId || null, address: m.bedrock?.address || null, checked: Date.now() }; // just installed: newest already
  writeBedrockConfig(m);
}
function applySide(m, t, kind, write) {
  if (!m[kind]?.on) return false;
  if (t[kind + 'Error']) { m[kind].error = t[kind + 'Error']; return false; }
  if (!t[kind]) return false;
  const changed = m[kind].address !== t[kind].address;
  Object.assign(m[kind], { tunnelId: t[kind].tunnelId, address: t[kind].address }); delete m[kind].error;
  write(m);
  return changed;
}
const applyBedrock = (m, t) => applySide(m, t, 'bedrock', writeBedrockConfig);
async function setBedrock(id, on) {
  const m = meta(id);
  if (on) {
    await addBedrock(m);
    save(m);
    if (m.tunnel === 'playit' && !running.has(id)) {
      const pl = require('./playit');
      try { const t = await pl.setupServer({ id, port: m.port, name: m.tunnelName || m.name, tunnelId: m.playitTunnelId, voice: voiceReq(m), bedrock: bedrockReq(m) }, null); Object.assign(m, { playitTunnelId: t.tunnelId, playitAddress: t.address }); applyVoice(m, t); applyBedrock(m, t); save(m); }
      catch (e) { m.bedrock.error = e.message; save(m); }
      finally { pl.releaseServer(id); }
    } else if (running.has(id)) { log(id, '[Solaris] Bedrock support added — restart the server to turn it on.'); if (m.tunnel === 'playit') startTunnel(id).catch(() => {}); }
  } else if (m.bedrock) {
    const rec = readJSON(recordFile(m), {});
    for (const k of ['geysermc:geyser', 'geysermc:floodgate', GEYSER.geyser, GEYSER.floodgate]) {
      const f = rec[k]?.file; if (!f) continue;
      fs.rmSync(path.join(contentDir(m), f), { force: true }); fs.rmSync(path.join(contentDir(m), f + '.disabled'), { force: true }); delete rec[k];
    }
    writeJSON(recordFile(m), rec);
    require('./playit').deleteTunnel(m.bedrock.tunnelId);
    delete m.bedrock; save(m);
    if (running.has(id)) log(id, '[Solaris] Bedrock support removed — restart the server to finish.');
  }
  emit(id);
  return get(id);
}

// ---------- crash helper: why did the server stop, and a one-click fix ----------
const lastRun = new Map(); // id -> { lines, code, at }
const stripAnsi = (l) => String(l).replace(/\x1b\[[0-9;]*m/g, '');
/** The mod/plugin file in the server for a mod id or plugin name. */
function fileForMod(m, modId) {
  const dir = contentDir(m), want = String(modId).toLowerCase();
  let files = []; try { files = fs.readdirSync(dir).filter((f) => /\.jar$/i.test(f)); } catch {}
  const { readModMeta } = require('./instances');
  for (const f of files) { try { if (String(readModMeta(path.join(dir, f)).modId || '').toLowerCase() === want) return f; } catch {} }
  for (const f of files) { try { if (jarInfo(path.join(dir, f)).plugin === want) return f; } catch {} }
  // last resort: the file name starts with the mod id (only for ids long enough not to hit some other mod)
  const w = want.replace(/[^a-z0-9]/g, '');
  return w.length >= 5 ? files.find((f) => f.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(w)) || null : null;
}
/** A Modrinth project for a missing mod id, for this server's loader and version. */
async function modrinthFor(m, modId) {
  const loaders = loadersFor(m);
  try { const p = await getJSON(`https://api.modrinth.com/v2/project/${encodeURIComponent(modId)}`); if (p?.id && p.loaders?.some((l) => loaders.includes(l))) return { id: p.id, title: p.title }; } catch {}
  try {
    const facets = [[`project_type:${SOFTWARE[m.software].kind === 'plugins' ? 'plugin' : 'mod'}`], loaders.map((l) => `categories:${l}`), [`versions:${m.mc}`]];
    const r = await getJSON(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(modId.replace(/[_-]/g, ' '))}&facets=${encodeURIComponent(JSON.stringify(facets))}&limit=5`);
    const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
    // only a project that really is this mod — never "the first search result", which could be something else
    const h = r.hits.find((x) => norm(x.slug) === norm(modId) || norm(x.title) === norm(modId))
      || r.hits.find((x) => norm(x.slug).startsWith(norm(modId)) || norm(modId).startsWith(norm(x.slug)));
    if (h) return { id: h.project_id, title: h.title };
  } catch {}
  return null;
}
async function diagnose(id) {
  const m = meta(id);
  let lines = running.get(id)?.lines || lastRun.get(id)?.lines || [];
  // Solaris was closed since: the server's own log file of its last run (plus the crash report it wrote, if any)
  if (!lines.length) { try { lines = fs.readFileSync(path.join(m.dir, 'logs', 'latest.log'), 'utf8').split(/\r?\n/).slice(-800); } catch {} }
  lines = lines.map(stripAnsi);
  const text = lines.join('\n');
  const out = []; const seen = new Set();
  const addFinding = (key, f) => { if (!seen.has(key)) { seen.add(key); out.push(f); } };
  // missing dependency (Fabric/Quilt)
  for (const mm of text.matchAll(/Mod '([^']+)' \(([\w.-]+)\)[^\n]*?requires [^\n]*?of (?:mod )?'?([^'(),\n]+?)'? ?(?:\(([\w.-]+)\))?, which is missing/g)) {
    let dep = (mm[4] || mm[3]).trim(); if (/^(minecraft|java|fabricloader)$/i.test(dep)) continue;
    // Fabric API's own parts (fabric-resource-loader-v1, fabric-networking-api-v1 …) all mean "Fabric API is missing"
    if (/^fabric-[\w-]+-v\d+$/i.test(dep) || /^fabric$/i.test(dep)) dep = 'fabric-api';
    if (seen.has('dep:' + dep)) continue;
    const p = await modrinthFor(m, dep);
    addFinding('dep:' + dep, { text: `${mm[1]} needs ${p?.title || dep}, which isn’t on the server.`, fix: p ? { type: 'install', projectId: p.id, label: `Install ${p.title}` } : null });
  }
  // missing dependency (Forge/NeoForge)
  for (const mm of text.matchAll(/Mod ID: '([\w.-]+)', Requested by: '([\w.-]+)'[^\n]*?Actual version: '([^']*)'/g)) {
    if (/^(minecraft|forge|neoforge|java)$/i.test(mm[1])) continue;
    if (/MISSING/i.test(mm[3])) { const p = await modrinthFor(m, mm[1]); addFinding('dep:' + mm[1], { text: `${mm[2]} needs ${p?.title || mm[1]}, which isn’t on the server.`, fix: p ? { type: 'install', projectId: p.id, label: `Install ${p.title}` } : null }); }
    else { const f = fileForMod(m, mm[2]); addFinding('ver:' + mm[2], { text: `${mm[2]} needs a different version of ${mm[1]} (the server has ${mm[3]}).`, fix: f ? { type: 'disable', file: f, label: `Turn off ${mm[2]}` } : null }); }
  }
  // made for another Minecraft version (Fabric)
  for (const mm of text.matchAll(/Mod '([^']+)' \(([\w.-]+)\)[^\n]*?requires [^\n]*?of (?:game )?'?minecraft'?[^\n]*?(?:but only the wrong version is present|which is missing)/gi)) {
    const f = fileForMod(m, mm[2]);
    addFinding('mc:' + mm[2], { text: `${mm[1]} is made for another Minecraft version than ${m.mc}.`, fix: f ? { type: 'disable', file: f, label: `Turn off ${mm[1]}` } : null });
  }
  // client-only mods (they crash a server)
  const client = text.match(/(?:Environment type SERVER is invalid|invalid dist DEDICATED_SERVER|Attempted to load class net\/minecraft\/client|ClassNotFoundException: net\.minecraft\.client|NoClassDefFoundError: net\/minecraft\/client)[\s\S]{0,4000}/);
  if (client) {
    const who = (client[0].match(/(?:for mod|from mod|Mod '?)\s*'?([\w.-]+)'?/i) || text.match(/Mixin apply for mod ([\w.-]+) failed/) || [])[1];
    const f = who ? fileForMod(m, who) : null;
    addFinding('client', { text: `${who ? who + ' is' : 'A mod is'} made only for the game, not for servers.`, fix: f ? { type: 'disable', file: f, label: `Turn off ${who}` } : null });
  }
  for (const mm of text.matchAll(/Mixin apply for mod ([\w.-]+) failed/g)) { const f = fileForMod(m, mm[1]); addFinding('mixin:' + mm[1], { text: `${mm[1]} failed to load (it may not match this Minecraft version or another mod).`, fix: f ? { type: 'disable', file: f, label: `Turn off ${mm[1]}` } : null }); }
  if (/Found duplicate mods|is present multiple times|Duplicate mods? found/i.test(text)) addFinding('dupe', { text: 'The same mod is on the server twice.', fix: { type: 'dedupe', label: 'Remove the extra copies' } });
  // plugins (Paper/Purpur)
  for (const mm of text.matchAll(/Could not load '?plugins[\\/]([^'\s]+\.jar)'?/g)) addFinding('pl:' + mm[1], { text: `The plugin ${mm[1]} couldn’t load (usually made for another version).`, fix: { type: 'disable', file: mm[1], label: `Turn off ${mm[1]}` } });
  for (const mm of text.matchAll(/Error occurred while enabling ([\w.-]+)/g)) { const f = fileForMod(m, mm[1]); addFinding('ple:' + mm[1], { text: `The plugin ${mm[1]} crashed while starting.`, fix: f ? { type: 'disable', file: f, label: `Turn off ${mm[1]}` } : null }); }
  if (/OutOfMemoryError|Java heap space|GC overhead limit/i.test(text)) {
    const total = Math.floor(require('os').totalmem() / 1048576), next = Math.min(m.memory + 2048, Math.floor(total * 0.75));
    addFinding('oom', { text: `The server ran out of memory (it has ${(m.memory / 1024).toFixed(1)} GB).`, fix: next > m.memory ? { type: 'memory', mb: next, label: `Give it ${(next / 1024).toFixed(1)} GB` } : null });
  }
  if (/FAILED TO BIND TO PORT|Address already in use/i.test(text)) addFinding('port', { text: `Another program is using port ${m.port}.`, fix: { type: 'port', label: 'Use a free port' } });
  if (/UnsupportedClassVersionError|class file version \d+/i.test(text)) addFinding('java', { text: 'A mod or plugin needs a newer Java than this Minecraft version uses — it’s probably made for a newer Minecraft version.', fix: null });
  if (/You need to agree to the EULA/i.test(text)) addFinding('eula', { text: 'The Minecraft EULA isn’t accepted for this server.', fix: { type: 'eula', label: 'Accept the EULA' } });
  if (/Failed to load level|Exception reading .*level\.dat|Corrupted|Chunk file at .* is in the wrong location/i.test(text)) addFinding('world', { text: 'The world looks damaged.', fix: { type: 'backups', label: 'Open Backups' } });
  // messages servers print on every start that mean nothing (Windows performance counters, an empty data map …)
  const harmless = /Perflib|counter names|Win32Exception: The parameter is incorrect|No key layers in MapLike|sun\.misc\.Unsafe/i;
  const errors = lines.filter((l) => /\b(ERROR|FATAL)\b|Exception|Caused by/.test(l) && !harmless.test(l)).slice(-6);
  // did the last run end normally? (stopped from Solaris or with /stop, no crash)
  const lr = lastRun.get(id);
  const normal = !out.length && (lr ? !lr.crashed : /Stopping (the )?server|Saving worlds|ThreadedAnvilChunkStorage: All dimensions are saved|All RegionFile I\/O tasks to complete/i.test(lines.slice(-60).join('\n')));
  return { id, name: m.name, findings: out, errors: normal ? [] : errors, hasLog: lines.length > 0, normal };
}
async function applyFix(id, fix) {
  const m = meta(id);
  if (!fix || typeof fix !== 'object') throw new Error('Nothing to fix.');
  if (fix.type === 'install') { if (!/^[\w-]{2,64}$/.test(String(fix.projectId))) throw new Error('Unknown mod.'); return `Installed ${(await installContent(m, String(fix.projectId))).join(', ')}`; }
  if (fix.type === 'disable') {
    const f = path.basename(String(fix.file || '')); const p = path.join(contentDir(m), f);
    if (!/\.jar$/i.test(f) || !fs.existsSync(p)) throw new Error('That file isn’t on the server any more.');
    fs.renameSync(p, p + '.disabled'); return `Turned off ${f}`;
  }
  if (fix.type === 'dedupe') { fixDuplicateMods(id); return 'Removed duplicate copies'; }
  if (fix.type === 'memory') { m.memory = clampMem(fix.mb); save(m); return `Memory set to ${(m.memory / 1024).toFixed(1)} GB`; }
  if (fix.type === 'port') { if (running.has(id)) throw new Error('Stop the server first.'); const p = nextPort(); setSettings(id, { props: { 'server-port': p } }); return `Port changed to ${p}`; }
  if (fix.type === 'eula') { fs.writeFileSync(path.join(m.dir, 'eula.txt'), `# Accepted in Solaris on ${new Date().toISOString()} (https://aka.ms/MinecraftEULA)\neula=true\n`); return 'EULA accepted'; }
  throw new Error('Unknown fix.');
}

// ---------- pre-generate the world with Chunky ----------
const CHUNKY_ID = 'fALzjamp';
const hasChunky = (m) => { try { return fs.readdirSync(contentDir(m)).some((f) => /^chunky.*\.jar$/i.test(f)); } catch { return false; } };
async function pregen(id, { action = 'start', radius = 2000 } = {}) {
  const m = meta(id), r = running.get(id);
  if (SOFTWARE[m.software].kind === 'none') throw new Error('Vanilla servers can’t run Chunky — use Paper, Purpur, Fabric, Forge or NeoForge.');
  if (!hasChunky(m)) {
    await installContent(m, CHUNKY_ID);
    return { installed: true, message: r ? 'Chunky added — restart the server, then press Start again.' : 'Chunky added — start the server, then press Start.' };
  }
  if (!r?.proc || r.state !== 'online') throw new Error('Start the server first (and wait until it’s online).');
  if (action === 'start') {
    const rad = Math.max(100, Math.min(20000, Math.round(Number(radius) || 2000)));
    r.chunky = { state: 'running', percent: 0, eta: null, radius: rad };
    command(id, `chunky radius ${rad}`); command(id, 'chunky start'); setTimeout(() => { try { command(id, 'chunky confirm'); } catch {} }, 1500);
  } else if (action === 'pause') { command(id, 'chunky pause'); if (r.chunky) r.chunky.state = 'paused'; }
  else if (action === 'continue') { command(id, 'chunky continue'); if (r.chunky) r.chunky.state = 'running'; }
  else if (action === 'cancel') { command(id, 'chunky cancel'); setTimeout(() => { try { command(id, 'chunky confirm'); } catch {} }, 800); r.chunky = null; }
  push('hosted:chunky', { id, ...(r.chunky || { state: 'idle' }) });
  return { chunky: r.chunky || null };
}

// ---------- lag check with spark ----------
function waitForLines(id, until, ms) {
  const r = running.get(id); if (!r) return Promise.resolve([]);
  return new Promise((resolve) => {
    const got = [];
    const f = (l) => { got.push(l); if (until(l, got)) done(); };
    const done = () => { r.listeners.delete(f); clearTimeout(t); resolve(got); };
    const t = setTimeout(done, ms);
    r.listeners.add(f);
  });
}
async function lagCheck(id, { profile = true } = {}) {
  const m = meta(id), r = running.get(id);
  if (!r?.proc || r.state !== 'online') throw new Error('Start the server first (and wait until it’s online).');
  const builtIn = SOFTWARE[m.software].kind === 'plugins'; // Paper and Purpur come with spark
  const hasSpark = builtIn || (() => { try { return fs.readdirSync(contentDir(m)).some((f) => /^spark.*\.jar$/i.test(f)); } catch { return false; } })();
  if (!hasSpark) {
    if (SOFTWARE[m.software].kind === 'none') throw new Error('Vanilla servers can’t run spark. Use Paper or a mod server.');
    await installContent(m, 'l6YH9Als');
    return { installed: true, message: 'spark added — restart the server, then run the lag check again.' };
  }
  const p = waitForLines(id, (l, all) => all.filter((x) => /\((?:process)\)/.test(x)).length >= 1, 6000);
  command(id, 'spark tps');
  const lines = (await p).map(stripAnsi).map((l) => l.replace(/^.*?\]:\s*/, '')); // drop "[time INFO]: " so only spark's text is left
  const after = (re) => { const i = lines.findIndex((l) => re.test(l)); return i >= 0 ? lines[i + 1] || '' : ''; };
  const nums = (s) => (String(s).match(/\d+(?:\.\d+)?/g) || []).map(Number);
  const tps = nums(after(/TPS from last/))[0] ?? null;
  const tick = nums(after(/Tick durations/)); // min/med/95%/max for 10s
  const cpuLine = lines.find((l) => /\(process\)/.test(l)) || '';
  const res = { tps, msptMedian: tick[1] ?? null, mspt95: tick[2] ?? null, cpu: nums(cpuLine)[0] ?? null, players: r.players.size, chunks: null, url: null };
  if (profile) {
    const u = waitForLines(id, (l) => /https:\/\/spark\.lucko\.me\/\w+/.test(stripAnsi(l)), 60000);
    command(id, 'spark profiler start --timeout 30');
    const got = await u;
    const hit = got.map(stripAnsi).join('\n').match(/https:\/\/spark\.lucko\.me\/\w+/);
    res.url = hit ? hit[0] : null;
  }
  // plain words
  const v = [];
  if (res.tps != null) v.push(res.tps >= 19.5 ? 'The server runs at full speed (20 TPS).' : res.tps >= 17 ? `The server is a little slow (${res.tps} of 20 TPS) — players may notice small hiccups.` : `The server is lagging (${res.tps} of 20 TPS) — everything in the game is slowed down.`);
  if (res.mspt95 != null) v.push(res.mspt95 < 40 ? 'Ticks finish quickly, so there’s room for more players.' : res.mspt95 < 50 ? 'Some ticks are close to the limit (50 ms) — big farms or many players can tip it over.' : `Some ticks take ${res.mspt95} ms (the limit is 50 ms) — the spark report below shows which mod, plugin or area takes the time.`);
  if (res.cpu != null && res.cpu > 85) v.push(`The server uses ${res.cpu}% of your CPU — close other programs or lower view distance in Settings.`);
  if (r.stats?.ramMb && r.stats.ramMb > m.memory * 0.95) v.push('Memory is almost full — give the server more memory in Settings.');
  res.verdict = v;
  return res;
}

// ---------- Discord alerts (webhook) ----------
const DISCORD_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
async function postDiscord(url, content) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Solaris', content: String(content).slice(0, 1900), allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(r.status === 404 ? 'Discord says this webhook doesn’t exist any more.' : `Discord answered HTTP ${r.status}.`);
}
function notifyDiscord(id, event, text) {
  let m; try { m = meta(id); } catch { return; }
  const d = m.discord; if (!d?.url || !d.events?.[event]) return;
  postDiscord(d.url, text).catch((e) => log(id, '[Solaris] Discord alert failed: ' + e.message));
}
function setDiscord(id, { url, events } = {}) {
  const m = meta(id);
  const u = String(url || '').trim();
  if (u && !DISCORD_RE.test(u)) throw new Error('That isn’t a Discord webhook link. In Discord: Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.');
  const ev = {}; for (const k of ['online', 'stop', 'crash', 'join', 'leave']) ev[k] = !!events?.[k];
  if (u) m.discord = { url: u, events: ev }; else delete m.discord;
  save(m);
  return getSettings(id);
}
async function testDiscord(id, url) {
  const u = String(url || meta(id).discord?.url || '').trim();
  if (!DISCORD_RE.test(u)) throw new Error('Paste a Discord webhook link first.');
  await postDiscord(u, `✅ Solaris is connected — alerts for **${meta(id).name}** will show up here.`);
  return true;
}

// ---------- a game instance that matches the server (same version, loader and mods) ----------
async function makeInstance(id, onStep) {
  const m = meta(id), instances = require('./instances'), modrinth = require('./modrinth');
  let old = null; try { old = m.playInstance ? instances.get(m.playInstance) : null; } catch {}
  if (m.modpack?.versionId) {
    onStep && onStep('Installing the modpack');
    // the same modpack version is already installed for this server: keep it (its worlds and settings too)
    const inst = old && old.modpack?.versionId === m.modpack.versionId ? old : await modrinth.installModpack({ versionId: m.modpack.versionId, name: `${m.name} (play)` });
    const added = [];
    if (m.voice?.on && inst?.id && ['fabric', 'forge', 'neoforge', 'quilt'].includes(inst.loader?.type)) { try { await modrinth.install(inst.id, { projectId: VOICE_ID }); added.push('Simple Voice Chat'); } catch {} }
    const cur = meta(id); cur.playInstance = inst.id; save(cur);
    return { instance: inst, added, skipped: [] };
  }
  const kind = SOFTWARE[m.software].kind;
  // Plugin and vanilla servers: a vanilla game, unless voice chat needs a mod loader (Fabric).
  const loader = kind === 'mods' ? m.software : m.voice?.on ? 'fabric' : 'vanilla';
  // "Make it again" updates the instance made before (keeps its worlds); a new one only when it no longer matches
  const reuse = old && old.versionId === m.mc && (old.loader?.type || 'vanilla') === loader;
  const inst = reuse ? old : instances.create({ name: `${m.name} (play)`.slice(0, 40), versionId: m.mc, loader: { type: loader, version: null } }); // newest loader for this version
  const added = [], skipped = [];
  const want = [];
  if (kind === 'mods') {
    // every mod that is turned on in the server — from Modrinth, a modpack, an instance or a file from this PC
    const rec = readJSON(recordFile(m), {}), dir = contentDir(m);
    let files = []; try { files = fs.readdirSync(dir).filter((f) => /\.jar$/i.test(f)); } catch {}
    const byFile = {}; for (const [k, v] of Object.entries(rec)) if (/^\w{8}$/.test(k) && v?.file) byFile[v.file] = k;
    const unknown = files.filter((f) => !byFile[f]);
    const mr = unknown.length ? await modrinthFiles(unknown.map((f) => path.join(dir, f))) : {};
    const ids = new Set();
    for (const f of files) {
      const pid = byFile[f] || mr[f]?.projectId;
      if (pid) ids.add(pid);
      else if (!/^e4mc/i.test(f)) skipped.push(`${f} (not on Modrinth — copy it into the instance yourself if players need it)`);
    }
    let projects = []; try { if (ids.size) projects = await getJSON(`https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify([...ids]))}`); } catch {}
    for (const p of projects) {
      if (p.client_side === 'unsupported') { skipped.push(`${p.title} (server only)`); continue; }
      if (['e4mc', 'lithium', 'ferrite-core', 'geyser', 'floodgate', 'chunky', 'spark', 'luckperms'].includes(p.slug) || [GEYSER.geyser, GEYSER.floodgate].includes(p.id)) continue; // server-side helpers players don't need
      want.push([p.id, p.title]);
    }
  }
  if (m.voice?.on && loader !== 'vanilla' && !want.some(([pid]) => pid === VOICE_ID)) want.push([VOICE_ID, 'Simple Voice Chat']);
  for (const [pid, title] of want) {
    onStep && onStep(`Adding ${title}`);
    try { await modrinth.install(inst.id, { projectId: pid }); added.push(title); } catch (e) { skipped.push(`${title} (${e.message})`); }
  }
  // remember which instance plays this server
  const cur = meta(id); cur.playInstance = inst.id; save(cur);
  return { instance: inst, added, skipped, updated: !!reuse };
}

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
  const r = { proc: null, state: 'starting', address: null, players: new Set(), lines: [], stopping: false, started: Date.now(), stats: null, listeners: new Set() };
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
  try { writeVoiceConfig(m); } catch {}
  await updateBedrock(m, (t) => log(id, '[Solaris] ' + t));
  if (r.cancelled) { running.delete(id); emit(id); return get(id); } // stopped while Geyser was updating
  try { writeBedrockConfig(m); } catch {}
  try { fixDuplicateMods(id); } catch {}
  const st = m.start || { jar: 'server.jar' };
  const args = [`-Xmx${m.memory}M`, `-Xms${Math.min(1024, m.memory)}M`, '-XX:+UseG1GC', ...(st.argsFile ? ['@' + st.argsFile] : ['-jar', st.jar]), 'nogui'];
  log(id, `[Solaris] Starting ${m.name} — ${SOFTWARE[m.software].name} ${m.mc}, ${m.memory} MB, port ${m.port}`);
  if (m.tunnel === 'playit' && !m.playitStopped) startTunnel(id).catch(() => {});
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
    // crashed = exited with an error, or stopped by itself before it finished starting
    const crashed = !r.stopping && (!!code || r.state !== 'online');
    lastRun.set(id, { lines: r.lines.slice(-800), code, at: Date.now(), crashed });
    running.delete(id); emit(id);
    if (m.tunnel === 'playit') require('./playit').releaseServer(id);
    push('hosted:stopped', { id, crashed });
    if (crashed) {
      diagnose(id)
        .catch(() => ({ id, name: m.name, findings: [], errors: [], hasLog: true })) // still tell the player it stopped
        .then((d) => { push('hosted:crash', d); notifyDiscord(id, 'crash', `⚠️ **${m.name}** stopped unexpectedly${d.findings[0] ? ': ' + d.findings[0].text : '.'}`); });
    } else if (!restart) notifyDiscord(id, 'stop', `🔴 **${m.name}** is offline.`);
    if (restart) start(id, resolveJava).catch((e) => push('toast', { type: 'error', text: 'Restart failed: ' + e.message }));
  });
  return get(id);
}
// ---------- playit.gg tunnel of a running server ----------
/** Sets up (or re-uses) the server's tunnel while it runs, and remembers the address playit.gg gives it. */
async function startTunnel(id) {
  const r = running.get(id); if (!r) return;
  const m = meta(id);
  r.tunnelBusy = true; r.tunnelError = null; emit(id);
  try {
    const t = await require('./playit').setupServer({ id, port: m.port, name: m.tunnelName || m.name, tunnelId: m.playitTunnelId, voice: voiceReq(m), bedrock: bedrockReq(m) }, (s) => log(id, '[Solaris] playit.gg: ' + s));
    const cur = meta(id); // re-read: settings may have changed meanwhile
    Object.assign(cur, { playitTunnelId: t.tunnelId, playitAddress: t.address }); delete cur.playitSetupError;
    const voiceChanged = applyVoice(cur, t), bedrockChanged = applyBedrock(cur, t);
    save(cur);
    log(id, `[Solaris] playit.gg tunnel ready: ${t.address} → localhost:${m.port}`);
    if (cur.voice?.on) {
      if (t.voiceError) log(id, '[Solaris] ' + t.voiceError);
      else if (cur.voice.address) log(id, `[Solaris] Voice chat tunnel ready: ${cur.voice.address} → UDP localhost:${cur.voice.port}`);
    }
    if (cur.bedrock?.on) {
      if (t.bedrockError) log(id, '[Solaris] ' + t.bedrockError);
      else if (cur.bedrock.address) log(id, `[Solaris] Bedrock tunnel ready: ${cur.bedrock.address} → localhost:${cur.bedrock.port}`);
    }
    // The server read the old voice_host / Bedrock address when it started: restart it once (right away while
    // nobody is on it, otherwise ask) so it uses the new address.
    if ((voiceChanged || bedrockChanged) && running.get(id) === r) {
      if (!r.players.size) { if (r.state === 'online') { log(id, '[Solaris] Restarting once so the new voice chat / Bedrock address is used.'); restart(id); } else r.voiceRestart = true; }
      else push('toast', { type: 'warn', text: `${cur.name}: ${voiceChanged ? 'voice chat' : 'Bedrock'} has a new address — restart the server so it’s used.` });
    }
  } catch (e) {
    if (running.get(id) === r) r.tunnelError = e.message;
    log(id, '[Solaris] playit.gg: ' + e.message);
    // nothing to tunnel for this server any more — let the agent stop if no other server needs it
    if (!running.has(id)) require('./playit').releaseServer(id);
  } finally {
    if (running.get(id) === r) r.tunnelBusy = false;
    emit(id);
  }
}
/** Dashboard buttons. */
async function tunnelStop(id) {
  const m = meta(id);
  m.playitStopped = true; save(m);
  require('./playit').releaseServer(id);
  if (running.has(id)) log(id, '[Solaris] playit.gg tunnel stopped — the server is only reachable on your network now.');
  emit(id);
  return get(id);
}
async function tunnelStart(id) {
  const m = meta(id);
  delete m.playitStopped; save(m);
  if (running.has(id)) await startTunnel(id);
  emit(id);
  return get(id);
}
async function tunnelRestart(id) {
  const m = meta(id);
  if (m.tunnel !== 'playit') throw new Error('This server doesn’t use playit.gg.');
  if (m.playitStopped) { delete m.playitStopped; save(m); }
  if (!running.has(id)) {
    // stopped server: just (re)check the link and the tunnel, then let the agent stop again
    const pl = require('./playit');
    try {
      const t = await pl.setupServer({ id, port: m.port, name: m.tunnelName || m.name, tunnelId: m.playitTunnelId, voice: voiceReq(m), bedrock: bedrockReq(m) }, null);
      Object.assign(m, { playitTunnelId: t.tunnelId, playitAddress: t.address }); delete m.playitSetupError; applyVoice(m, t); applyBedrock(m, t); save(m);
    } finally { pl.releaseServer(id); }
    emit(id);
    return get(id);
  }
  log(id, '[Solaris] Restarting the playit.gg tunnel…');
  await require('./playit').restartAgent();
  await startTunnel(id);
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
  line = stripAnsi(line); // spark and others colour their output; the console shows plain text
  log(id, line);
  for (const f of r.listeners) { try { f(line); } catch {} }
  const ck = line.match(/\[Chunky\] Task (running|finished|stopped|paused|cancelled) for [\w:]+\.(?: Processed: \d+ chunks \(([\d.]+)%\)(?:, ETA: ([\d:]+))?)?/);
  if (ck) {
    const st = ck[1] === 'running' ? 'running' : ck[1] === 'finished' ? 'done' : ck[1] === 'paused' ? 'paused' : 'idle';
    r.chunky = { ...(r.chunky || {}), state: st, percent: ck[2] != null ? Number(ck[2]) : st === 'done' ? 100 : r.chunky?.percent || 0, eta: ck[3] || null };
    push('hosted:chunky', { id, ...r.chunky });
    if (st === 'done') log(id, '[Solaris] World pre-generation finished.');
  }
  if (/Done \([\d.,]+s\)!/.test(line)) {
    r.state = 'online'; emit(id);
    try { const mm = meta(id), v = view(mm); if (!r.notifiedOnline) { r.notifiedOnline = true; notifyDiscord(id, 'online', `🟢 **${mm.name}** is online${v.address || v.knownAddress ? ` — join at \`${v.address || v.knownAddress}\`` : ''} (Java ${mm.mc}).`); } } catch {}
    if (r.voiceRestart && !r.players.size) { r.voiceRestart = false; log(id, '[Solaris] Restarting once so voice chat uses its new address.'); setTimeout(() => { if (running.get(id) === r && !r.players.size) restart(id); }, 1500); }
  }
  const dom = line.match(/Domain assigned: ([A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
  if (dom) {
    r.address = dom[1]; emit(id);
    const m = meta(id);
    if (Notification.isSupported()) { const n = new Notification({ title: `${m.name} is online`, body: `Friends join at ${r.address} — click to copy` }); n.on('click', () => clipboard.writeText(r.address)); n.show(); }
  }
  // Players: Minecraft 26.x writes "System chat: <name> joined the game", older versions and Paper "<name> joined
  // the game". "<name>[/ip] logged in" and "<name> lost connection" cover the rest (and players that time out).
  const PLAYER = '(\\.?[A-Za-z0-9_]{1,16})'; // Bedrock players (Floodgate) have a "." in front of their name
  const j = line.match(new RegExp(`\\]: (?:System chat: |\\[Server\\] )?${PLAYER} joined the game`)) || line.match(new RegExp(`\\]: ${PLAYER}\\[/[^\\]]*\\] logged in with entity id`));
  if (j && !r.players.has(j[1])) {
    r.players.add(j[1]); emit(id);
    try { const mm = meta(id), vv = view(mm); require('./friends').notePlayers(vv.address || vv.knownAddress || `localhost:${mm.port}`, [j[1]]); notifyDiscord(id, 'join', `➕ **${j[1]}** joined ${mm.name} (${r.players.size} online).`); } catch {}
  }
  const lft = line.match(new RegExp(`\\]: (?:System chat: |\\[Server\\] )?${PLAYER} left the game`)) || line.match(new RegExp(`\\]: ${PLAYER} lost connection: `));
  if (lft && r.players.has(lft[1])) { r.players.delete(lft[1]); emit(id); try { notifyDiscord(id, 'leave', `➖ **${lft[1]}** left ${meta(id).name} (${r.players.size} online).`); } catch {} }
  const nwl = line.match(/Disconnecting ([A-Za-z0-9_]{2,16}) .*not white-?listed/i);
  if (nwl) push('hosted:notWhitelisted', { id, name: nwl[1] });
  if (/You need to agree to the EULA/i.test(line)) push('toast', { type: 'error', text: 'The server needs the Minecraft EULA accepted.' });
  if (/FAILED TO BIND TO PORT/i.test(line)) push('toast', { type: 'error', text: 'Another program is using this server’s port. Close it, or change the port in Settings.' });
}
function command(id, cmd) {
  const r = running.get(id);
  if (!r?.proc) throw new Error('The server isn’t running.');
  const c = String(cmd || '').replace(/[\r\n]+/g, ' ').replace(/^\//, '').trim(); // one line = one command
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
function getSettings(id) { const m = meta(id); return { props: readProps(id), memory: m.memory, tunnel: m.tunnel, name: m.name, tunnelName: m.tunnelName || '', voice: m.voice || null, bedrock: m.bedrock || null, discord: m.discord ? { url: m.discord.url, events: m.discord.events } : null, playInstance: m.playInstance || null, schedule: m.schedule || null, autoStart: !!m.autoStart, port: m.port, software: m.software, mc: m.mc, dir: m.dir }; }
function setSettings(id, patch) {
  const m = meta(id);
  if (patch.props) {
    const props = {};
    for (const [k, v] of Object.entries(patch.props)) { if (!/^[a-z0-9.-]+$/i.test(k)) continue; props[k] = String(v).replace(/[\r\n]/g, ' ').slice(0, 300); }
    if (props['server-port']) { const p = Number(props['server-port']); if (!(p >= 1024 && p <= 65535)) throw new Error('Port must be between 1024 and 65535.'); if (list().some((s) => s.id !== id && s.port === p)) throw new Error(`Another Solaris server uses port ${p}.`); if (p !== m.port) delete m.playitAddress; m.port = p; }
    if (props['max-players']) m.maxPlayers = Number(props['max-players']) || m.maxPlayers;
    const wasOnline = readProps(id)['online-mode'] !== 'false';
    writeProps(id, props);
    if ('online-mode' in props && wasOnline !== (props['online-mode'] !== 'false')) convertPeople(id, props['online-mode'] !== 'false').catch(() => {});
  }
  if (patch.memory) m.memory = clampMem(patch.memory);
  if (patch.name) m.name = String(patch.name).slice(0, 40);
  if ('tunnelName' in patch) { const tn = String(patch.tunnelName || '').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 40); if (tn) m.tunnelName = tn; else delete m.tunnelName; }
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
/**
 * The identity Minecraft checks for a player on this server. With "Require Microsoft accounts" on, that's the
 * player's Mojang UUID. With it off (online-mode=false, offline/cracked accounts can join), the server uses an
 * offline UUID made from the exact name the player types — a Mojang lookup would give the wrong one, and
 * whitelisted players would still be refused.
 */
async function playerId(id, name) {
  const n = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{1,16}$/.test(n)) throw new Error('Minecraft names are 1–16 letters, numbers or _.');
  if (readProps(id)['online-mode'] === 'false') {
    // keep the spelling the player actually used on this server, if they tried to join already
    const seen = [...(running.get(id)?.lines || [])].reverse().join('\n').match(new RegExp(`(?:Disconnecting|UUID of player) (${n})\\b`, 'i'));
    const exact = seen ? seen[1] : n;
    return { uuid: require('./accounts').offlineUuid(exact), name: exact, offline: true };
  }
  const prof = await profileByName(n);
  if (!prof) throw new Error(`No Minecraft account is called “${n}”. (Turn off “Require Microsoft accounts” in Settings to let offline accounts join.)`);
  return { uuid: prof.id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5'), name: prof.name, offline: false };
}
async function addPerson(id, kind, name) {
  const p = await playerId(id, name);
  const r = running.get(id);
  // Solaris writes the list itself (with the right UUID for this server's mode), then a running server reloads it.
  const l = people(id, kind).filter((x) => x.uuid !== p.uuid && x.name.toLowerCase() !== p.name.toLowerCase());
  l.push(kind === 'ops' ? { uuid: p.uuid, name: p.name, level: 4, bypassesPlayerLimit: false } : { uuid: p.uuid, name: p.name });
  writeJSON(listFile(id, kind), l);
  if (r?.proc) {
    if (kind === 'ops') {
      // there's no "op reload": a player who is online gets op right away, everyone else from the next start
      if ([...r.players].some((x) => x.toLowerCase() === p.name.toLowerCase())) command(id, `op ${p.name}`);
      else log(id, `[Solaris] ${p.name} becomes an operator the next time the server starts (or use “op ${p.name}” once they are online).`);
    } else command(id, 'whitelist reload');
  }
  return people(id, kind);
}
/** "Require Microsoft accounts" was switched: give whitelisted players and operators the IDs of the new mode. */
async function convertPeople(id, online) {
  for (const kind of ['whitelist', 'ops']) {
    const out = [];
    for (const p of people(id, kind)) {
      let uuid = p.uuid;
      if (!online) uuid = require('./accounts').offlineUuid(p.name);
      else { try { const prof = await profileByName(p.name); if (prof) uuid = prof.id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5'); } catch {} }
      out.push({ ...p, uuid });
    }
    writeJSON(listFile(id, kind), out);
  }
  if (running.get(id)?.proc) command(id, 'whitelist reload');
}
function removePerson(id, kind, name) {
  const lower = String(name).toLowerCase();
  const r = running.get(id);
  if (r?.proc && kind === 'ops') command(id, `deop ${name}`);
  writeJSON(listFile(id, kind), people(id, kind).filter((p) => p.name.toLowerCase() !== lower));
  if (r?.proc && kind !== 'ops') command(id, 'whitelist reload');
  return people(id, kind);
}

function bans(id) { return readJSON(path.join(dirOf(id), 'banned-players.json'), []).map((b) => ({ name: b.name, reason: b.reason || '' })); }
function pardon(id, name) {
  if (running.get(id)?.proc) command(id, `pardon ${name}`);
  else { const bf = path.join(dirOf(id), 'banned-players.json'); writeJSON(bf, readJSON(bf, []).filter((b) => String(b.name).toLowerCase() !== String(name).toLowerCase())); }
  return bans(id);
}

// ---------- backups ----------
const backupsDir = (id) => path.join(dirOf(id), 'backups');
function backups(id) {
  try { return fs.readdirSync(backupsDir(id)).filter((f) => f.endsWith('.zip')).map((f) => ({ file: f, size: fs.statSync(path.join(backupsDir(id), f)).size, time: fs.statSync(path.join(backupsDir(id), f)).mtimeMs })).sort((a, b) => b.time - a.time); }
  catch { return []; }
}
async function backup(id, prefix = 'backup') {
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
    const name = `${prefix === 'auto' ? 'auto' : 'backup'}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`;
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
  return files.map((f) => { const e = Object.entries(rec).find(([, v]) => v.file === f.replace(/\.disabled$/, '')); return { file: f, enabled: !f.endsWith('.disabled'), projectId: e?.[0] || null, title: e?.[1].title || require('./instances').readModMeta(path.join(dir, f)).name || f.replace(/\.jar(\.disabled)?$/i, ''), version: e?.[1].version || '' }; });
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
  // The same mod under another file name (e.g. it came with the modpack): never keep two copies.
  // Extras Solaris adds by itself (quiet) give way to the copy that's already there; a mod the player picks
  // replaces the older copy.
  const newFile = path.join(dir, f.filename);
  const dupes = sameModFiles(dir, newFile);
  if (dupes.length && quiet) { fs.rmSync(newFile, { force: true }); return []; }
  for (const d of dupes) fs.rmSync(path.join(dir, d), { force: true });
  rec[v.project_id] = { file: f.filename, version: v.version_number, title: proj.title };
  writeJSON(recordFile(m), rec);
  const out = [proj.title];
  for (const d of v.dependencies || []) if (d.dependency_type === 'required' && d.project_id) out.push(...(await installContent(m, d.project_id, null, true, seen).catch(() => [])));
  return out;
}
/** Other enabled jars in `dir` that are the same mod (same mod id) as `file`. */
function sameModFiles(dir, file) {
  const { readModMeta } = require('./instances');
  const id = readModMeta(file).modId;
  if (!id) return [];
  let files = []; try { files = fs.readdirSync(dir).filter((f) => /\.jar$/i.test(f)); } catch {}
  return files.filter((f) => path.join(dir, f) !== file && readModMeta(path.join(dir, f)).modId === id);
}
/**
 * Before a start: if a mod is in the mods folder twice (different versions), keep the newest and turn the others
 * off (renamed to .disabled, not deleted) — two copies make Fabric/Forge refuse to start or load the wrong one.
 */
function fixDuplicateMods(id) {
  const m = meta(id);
  if (SOFTWARE[m.software]?.kind !== 'mods') return;
  const dir = contentDir(m);
  const { readModMeta } = require('./instances');
  let files = []; try { files = fs.readdirSync(dir).filter((f) => /\.jar$/i.test(f)); } catch { return; }
  const byId = new Map();
  for (const f of files) {
    const meta_ = readModMeta(path.join(dir, f));
    if (!meta_.modId) continue;
    (byId.get(meta_.modId) || byId.set(meta_.modId, []).get(meta_.modId)).push({ f, v: String(meta_.version || ''), t: fs.statSync(path.join(dir, f)).mtimeMs });
  }
  const cmp = (a, b) => {
    const pa = a.v.split(/[.+-]/).map((x) => parseInt(x, 10)), pb = b.v.split(/[.+-]/).map((x) => parseInt(x, 10));
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = pa[i] || 0, y = pb[i] || 0; if (!Number.isNaN(x) && !Number.isNaN(y) && x !== y) return y - x; }
    return b.t - a.t;
  };
  for (const [modId, list] of byId) {
    if (list.length < 2) continue;
    list.sort(cmp);
    for (const old of list.slice(1)) {
      try { fs.renameSync(path.join(dir, old.f), path.join(dir, old.f + '.disabled')); log(id, `[Solaris] ${modId} was installed twice — using ${list[0].f}, turned off ${old.f}.`); } catch {}
    }
  }
}
/** What a jar is for: 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'plugin' | null, and whether it only runs in the game client. */
function jarInfo(file) {
  try {
    const zip = new AdmZip(file);
    const txt = (n) => { const e = zip.getEntry(n); return e ? zip.readAsText(e) : null; };
    const fab = txt('fabric.mod.json');
    if (fab) { let env = ''; try { env = JSON.parse(fab.replace(/[\u0000-\u001f]+/g, ' ')).environment || ''; } catch {} return { loader: 'fabric', clientOnly: env === 'client' }; }
    if (txt('quilt.mod.json')) return { loader: 'quilt', clientOnly: false };
    const neo = txt('META-INF/neoforge.mods.toml'), forge = txt('META-INF/mods.toml');
    if (neo || forge) return { loader: neo ? 'neoforge' : 'forge', clientOnly: /^\s*clientSideOnly\s*=\s*true/m.test(neo || forge) };
    const py = txt('paper-plugin.yml') || txt('plugin.yml');
    if (py) return { loader: 'plugin', clientOnly: false, plugin: ((py.match(/^name:\s*['"]?([^'"\r\n]+)/m) || [])[1] || '').trim().toLowerCase() || null };
  } catch {}
  return { loader: null, clientOnly: false };
}
/** Why `file` can't go on this server, or null if it can. */
function wontRun(m, file) {
  const kind = SOFTWARE[m.software].kind, info = jarInfo(file);
  if (/^solaris-client/i.test(path.basename(file))) return 'the Solaris client mod only runs in the game';
  if (info.clientOnly) return 'it only works in the game client, not on servers';
  if (!info.loader) return null;
  if (kind === 'plugins') return info.loader === 'plugin' ? null : `it’s a ${info.loader} mod, and this is a plugin server`;
  if (info.loader === 'plugin') return 'it’s a plugin, and this is a mod server';
  const ok = { fabric: ['fabric'], forge: ['forge'], neoforge: ['neoforge', 'forge'] }[m.software] || [];
  return ok.includes(info.loader) ? null : `it’s for ${info.loader}, and this server runs ${SOFTWARE[m.software].name}`;
}
/** Copy jars into the server: replaces an older copy of the same mod; skips what can't run here. */
function addJars(m, files, srcRecord = {}) {
  const { readModMeta } = require('./instances');
  const dir = contentDir(m); fs.mkdirSync(dir, { recursive: true });
  const rec = readJSON(recordFile(m), {});
  const added = [], skipped = [];
  for (const src of files) {
    const name = path.basename(String(src));
    let st = null; try { st = fs.statSync(src); } catch {}
    if (!/\.jar$/i.test(name)) { skipped.push({ name, why: 'it isn’t a .jar file' }); continue; }
    if (!st || !st.isFile()) { skipped.push({ name, why: 'the file wasn’t found' }); continue; }
    const why = wontRun(m, src);
    if (why) { skipped.push({ name, why }); continue; }
    const dest = path.join(dir, name);
    if (path.resolve(src) !== path.resolve(dest)) fs.copyFileSync(src, dest);
    fs.rmSync(dest + '.disabled', { force: true });
    for (const d of sameModFiles(dir, dest)) fs.rmSync(path.join(dir, d), { force: true });
    const pl = jarInfo(dest).plugin; // the same plugin under another file name: keep only the new one
    if (pl) for (const f of fs.readdirSync(dir).filter((x) => /\.jar$/i.test(x) && x !== name)) if (jarInfo(path.join(dir, f)).plugin === pl) fs.rmSync(path.join(dir, f), { force: true });
    const mm = readModMeta(dest);
    const pid = Object.keys(srcRecord).find((k) => String(srcRecord[k]?.file).replace(/\.disabled$/, '') === name);
    if (pid) rec[pid] = { file: name, version: mm.version || '', title: mm.name || name };
    added.push(mm.name || name.replace(/\.jar$/i, ''));
  }
  for (const [k, r] of Object.entries(rec)) if (!fs.existsSync(path.join(dir, r.file)) && !fs.existsSync(path.join(dir, r.file + '.disabled'))) delete rec[k];
  writeJSON(recordFile(m), rec);
  return { added, skipped };
}
/** Modrinth's record of each jar (looked up by its SHA-1): { [fileName]: { projectId, gameVersions } }. Empty when offline. */
async function modrinthFiles(files) {
  const { sha1File } = require('./util');
  const byHash = {};
  for (const f of files) { try { byHash[await sha1File(f)] = path.basename(f); } catch {} }
  if (!Object.keys(byHash).length) return {};
  try {
    const res = await getJSON('https://api.modrinth.com/v2/version_files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hashes: Object.keys(byHash), algorithm: 'sha1' }) });
    const out = {};
    for (const [h, v] of Object.entries(res || {})) if (byHash[h]) out[byHash[h]] = { projectId: v.project_id, gameVersions: v.game_versions || [] };
    return out;
  } catch { return {}; }
}
/** The Minecraft version a mod file was made for, when Modrinth says it isn't this server's version (else null). */
function otherVersion(m, info) {
  const gv = info?.gameVersions || [];
  if (!gv.length || gv.includes(m.mc)) return null;
  const releases = gv.filter((v) => /^\d+(\.\d+)+$/.test(v));
  return (releases.length ? releases : gv)[(releases.length ? releases : gv).length - 1];
}
/** Your instances whose mods fit this server (same mod loader); same Minecraft version first. */
function modSources(id) {
  const m = meta(id);
  if (SOFTWARE[m.software].kind !== 'mods') return [];
  const instances = require('./instances');
  const ok = m.software === 'neoforge' ? ['neoforge'] : [m.software];
  return instances.list().filter((i) => ok.includes(i.loader?.type)).map((i) => {
    let count = 0; try { count = fs.readdirSync(path.join(instances.gameDir(i), 'mods')).filter((f) => /\.jar$/i.test(f)).length; } catch {}
    return { id: i.id, name: i.name, mc: i.versionId, sameVersion: i.versionId === m.mc, count };
  }).filter((i) => i.count).sort((a, b) => (b.sameVersion - a.sameVersion) || a.name.localeCompare(b.name));
}
/** The enabled mods of an instance, marked with whether they can run on this server and whether it already has them. */
async function instanceMods(id, instId) {
  const m = meta(id), instances = require('./instances'), inst = instances.get(instId);
  if (!inst) throw new Error('That instance no longer exists.');
  const items = instances.listContent(instId, 'mods').filter((c) => c.enabled && !c.dir && /\.jar$/i.test(c.file));
  const rec = readJSON(path.join(paths.instances(), instId, 'modrinth.json'), {});
  const mr = await modrinthFiles(items.map((c) => c.path));
  const pidOf = (f) => Object.keys(rec).find((k) => rec[k]?.file === f) || mr[f]?.projectId;
  // Modrinth knows which mods are client-only even when the jar doesn't say so — one request for all of them.
  const side = {};
  const pids = [...new Set(items.map((c) => pidOf(c.file)).filter(Boolean))];
  if (pids.length) {
    try { for (const p of await getJSON(`https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(pids))}`)) side[p.id] = p.server_side; } catch {}
  }
  const dir = contentDir(m);
  const have = new Set(); try { for (const f of fs.readdirSync(dir).filter((x) => /\.jar$/i.test(x))) { const mid = instances.readModMeta(path.join(dir, f)).modId; if (mid) have.add(mid); have.add(f); } } catch {}
  return {
    name: inst.name, mc: inst.versionId, sameVersion: inst.versionId === m.mc,
    mods: items.map((c) => {
      const why = side[pidOf(c.file)] === 'unsupported' ? 'only works in the game client' : wontRun(m, c.path);
      return { file: c.file, name: c.name, version: c.version || '', icon: c.icon || null, why: why || null, otherVersion: otherVersion(m, mr[c.file]), onServer: have.has(c.file) || (c.modId && have.has(c.modId)) || false };
    }).sort((a, b) => (!!a.why - !!b.why) || a.name.localeCompare(b.name)),
  };
}
/** Copy the chosen mods of an instance into the server. `files` are names inside that instance's mods folder. */
function copyFromInstance(id, instId, files) {
  const m = meta(id), instances = require('./instances'), inst = instances.get(instId);
  if (!inst) throw new Error('That instance no longer exists.');
  if (SOFTWARE[m.software].kind !== 'mods') throw new Error('Only mod servers (Fabric, Forge, NeoForge) can use mods from an instance.');
  const src = path.join(instances.gameDir(inst), 'mods');
  const rec = readJSON(path.join(paths.instances(), instId, 'modrinth.json'), {});
  const r = addJars(m, (files || []).map((f) => path.join(src, path.basename(f))), rec);
  return { ...r, items: installedContent(id) };
}
/** Add .jar files from this PC (file picker or drag and drop). */
async function addContentFiles(id, files) {
  const m = meta(id);
  if (SOFTWARE[m.software].kind === 'none') throw new Error('Vanilla servers can’t run mods or plugins.');
  files = (files || []).filter((f) => typeof f === 'string' && path.isAbsolute(f));
  const r = addJars(m, files);
  // Made for another Minecraft version? Added anyway (the player picked it), but say so — it's the usual reason a server won't start.
  const mr = await modrinthFiles(files.filter((f) => /\.jar$/i.test(f)));
  const warnings = Object.entries(mr).map(([f, info]) => ({ name: f, made: otherVersion(m, info) })).filter((w) => w.made && !r.skipped.some((s) => s.name === w.name));
  return { ...r, warnings, items: installedContent(id) };
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
  // stable releases first (a server shouldn't get a beta or alpha unless that's all there is)
  const rank = { release: 0, beta: 1, alpha: 2 };
  return vs.slice().sort((a, b) => (rank[a.version_type] ?? 3) - (rank[b.version_type] ?? 3)).map((v) => ({ id: v.id, name: v.name, number: v.version_number, type: v.version_type }));
}

module.exports = {
  SOFTWARE, list, get, create, start, stop, restart, stopAll, anyRunning, command, logs, getSettings, setSettings, setTunnel, remove, openFolder,
  softwareVersions, worlds, setActiveWorld, deleteWorld, people, addPerson, removePerson, backups, backup, restore, deleteBackup,
  logFiles, readLog, searchContent, installedContent, installContent: (id, pid, vid) => installContent(id, pid, vid), removeContent, toggleContent, modSources, instanceMods, copyFromInstance, addContentFiles, modpackVersions,
  tunnelStop, tunnelStart, tunnelRestart,
  setVoice, setBedrock, diagnose, applyFix, pregen, lagCheck, setDiscord, testDiscord, makeInstance, setupCode, readSetupCode, joinCode, readJoinCode, setSchedule, setAutoStart, autoStartAll, bans, pardon,
};
