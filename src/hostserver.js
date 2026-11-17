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
const { paths, readJSON, writeJSON, getJSON, request, download, push, slugify, profileByName, events } = require('./util');
const versions = require('./versions');

const SOFTWARE = {
  vanilla: { name: 'Vanilla', kind: 'none' },
  paper: { name: 'Paper', kind: 'plugins' },
  purpur: { name: 'Purpur', kind: 'plugins' },
  fabric: { name: 'Fabric', kind: 'mods' },
  forge: { name: 'Forge', kind: 'mods' },
  neoforge: { name: 'NeoForge', kind: 'mods' },
  quilt: { name: 'Quilt', kind: 'mods' },
  // Mojang's own Bedrock Dedicated Server: phones, consoles and Windows join directly (no Java, no mods/plugins).
  bedrock: { name: 'Bedrock', kind: 'none', native: true },
};
const E4MC_OK = ['fabric', 'forge', 'neoforge', 'quilt'];
const isBds = (m) => m.software === 'bedrock';
const BDS_LINKS = 'https://net-secondary.web.minecraft-services.net/api/v1.0/download/links';
async function bdsDownload() {
  const d = await getJSON(BDS_LINKS);
  const want = process.platform === 'win32' ? 'serverBedrockWindows' : process.platform === 'linux' ? 'serverBedrockLinux' : null;
  if (!want) throw new Error('Mojang’s Bedrock server only runs on Windows and Linux.');
  const l = (d?.result?.links || []).find((x) => x.downloadType === want);
  if (!l) throw new Error('Couldn’t find Mojang’s Bedrock server download.');
  return { url: l.downloadUrl, version: (l.downloadUrl.match(/bedrock-server-([\d.]+)\.zip/) || [])[1] || 'latest' };
}

const root = () => path.join(paths.getRoot(), 'hosted');
const indexFile = () => path.join(root(), 'servers.json');
const crashTimes = new Map(); // id -> recent crash times (auto restart)
// Add-ons in their own files (Astra Connect: BlueMap…) hook in here instead of growing this file.
const hooks = { beforeStart: new Set(), line: new Set() };
/** Merges a few fields into a server's saved settings (for add-ons; the keys are theirs). */
function patchMeta(id, patch) { const m = meta(id); Object.assign(m, patch); save(m); emit(id); return get(id); }
const running = new Map(); // id -> { proc, state, address, players:Set, lines, stopping, started, restart, stats }

// ---------- index (servers may live in any folder the player picks) ----------
function index() {
  const idx = readJSON(indexFile(), null);
  if (idx) return idx;
  // first run of the index: pick up servers created by Astra 1.4 under hosted/<id>
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
    tunnelStatus: ts, started: r?.started || null, stats: r?.stats || null, nextBackupAt: nextBackupAt(m, r), bedrockServer: m.software === 'bedrock', tunnelBusy: !!r?.tunnelBusy, chunky: r?.chunky || null,
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
  if (software === 'quilt') return (await getJSON('https://meta.quiltmc.org/v3/versions/game')).filter((v) => v.stable).map((v) => v.version);
  if (software === 'bedrock') return [(await bdsDownload()).version]; // Mojang only offers the newest Bedrock server
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
  const q = `loaders=${encodeURIComponent(JSON.stringify(loader === 'quilt' ? ['quilt', 'fabric'] : [loader]))}&game_versions=${encodeURIComponent(JSON.stringify([mc]))}`;
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
/** The Java a server runs with: the one picked in its Settings (if it's new enough), otherwise automatic. */
async function serverJava(m, resolveJava, onStep) {
  const version = await versions.resolveVersion(m.mc);
  return resolveJava({ versionId: m.mc, javaPath: m.javaPath || null }, version, (d, t) => onStep && onStep(`Installing Java ${Math.round((d / t) * 100)}%`));
}
// Aikar's flags: the garbage-collector settings most Minecraft hosts use (fewer lag spikes on busy servers).
const AIKAR = ['-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200', '-XX:+UnlockExperimentalVMOptions', '-XX:+DisableExplicitGC', '-XX:+AlwaysPreTouch', '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40', '-XX:G1HeapRegionSize=8M', '-XX:G1ReservePercent=20', '-XX:G1HeapWastePercent=5', '-XX:G1MixedGCCountTarget=4', '-XX:InitiatingHeapOccupancyPercent=15', '-XX:G1MixedGCLiveThresholdPercent=90', '-XX:G1RSetUpdatingPauseTimePercent=5', '-XX:SurvivorRatio=32', '-XX:+PerfDisableSharedMem', '-XX:MaxTenuringThreshold=1', '-Daikars.new.flags=true'];
/** Extra JVM arguments typed in Settings: only "-…" options, never anything that would replace the server jar. */
function splitArgs(s) {
  return String(s || '').split(/\s+/).filter((a) => /^-[\w.:+=%/@,-]+$/.test(a) && !/^-(jar|cp|classpath|Xmx|Xms)/i.test(a)).slice(0, 40);
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
  if (m.software === 'quilt') {
    onStep && onStep('Downloading the Quilt installer');
    const inst = (await getJSON('https://meta.quiltmc.org/v3/versions/installer'))[0];
    const loaders = await getJSON(`https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mc)}`);
    if (!loaders.length) throw new Error(`Quilt isn’t available for ${mc} yet.`);
    const lv = (loaders.find((l) => !/beta|pre/i.test(l.loader.version)) || loaders[0]).loader.version;
    const file = path.join(dir, 'quilt-installer.jar');
    await download(inst.url, file, { sha1: inst.hashes?.sha1 });
    const java = await javaFor(mc, resolveJava, onStep);
    onStep && onStep(`Installing Quilt ${lv}`);
    await runJava(java, ['-jar', file, 'install', 'server', mc, lv, `--install-dir=${dir}`, '--download-server'], dir);
    try { fs.rmSync(file, { force: true }); } catch {}
    m.softwareBuild = lv;
    if (!fs.existsSync(path.join(dir, 'quilt-server-launch.jar'))) throw new Error('The Quilt installer finished but quilt-server-launch.jar is missing.');
    return { jar: 'quilt-server-launch.jar' };
  }
  if (m.software === 'bedrock') {
    const { url, version } = await bdsDownload();
    onStep && onStep(`Downloading Mojang’s Bedrock server ${version} (about 90 MB)`);
    const zip = path.join(dir, 'bedrock-server.zip');
    await download(url, zip);
    onStep && onStep('Unpacking the Bedrock server');
    await installBdsZip(dir, zip);
    m.mc = version; m.softwareBuild = version;
    return { exe: process.platform === 'win32' ? 'bedrock_server.exe' : 'bedrock_server' };
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

/** Unpacks Mojang's Bedrock server zip; on an update the player's settings, lists and worlds are kept. */
const BDS_KEEP = ['server.properties', 'allowlist.json', 'permissions.json', 'whitelist.json'];
async function installBdsZip(dir, zip) {
  const z = new AdmZip(zip);
  for (const e of z.getEntries()) {
    const name = e.entryName.replace(/\\/g, '/');
    if (name.split('/').includes('..')) continue;
    const out = path.join(dir, name);
    if (e.isDirectory) { fs.mkdirSync(out, { recursive: true }); continue; }
    if (BDS_KEEP.includes(name) && fs.existsSync(out)) continue;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, e.getData());
  }
  if (process.platform !== 'win32') { try { fs.chmodSync(path.join(dir, 'bedrock_server'), 0o755); } catch {} }
  try { fs.rmSync(zip, { force: true }); } catch {}
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

function nextPort(software) {
  const used = new Set(list().flatMap((s) => [s.port, s.port + 1]));
  let p = software === 'bedrock' ? 19132 : 25565; while (used.has(p) || used.has(p + 1)) p += software === 'bedrock' ? 2 : 1;
  return p;
}
/** Bedrock's server.properties uses other names for a few settings. */
function bdsProps(props) {
  const out = { ...props };
  if ('white-list' in out) { out['allow-list'] = out['white-list']; delete out['white-list']; }
  delete out['enforce-whitelist'];
  if (out.motd) { out['server-name'] = String(out.motd).replace(/\\u00a7.|§./g, '').slice(0, 60); delete out.motd; }
  if (out['level-type']) out['level-type'] = /flat/i.test(out['level-type']) ? 'FLAT' : 'DEFAULT';
  for (const k of ['pvp', 'hardcore', 'allow-flight', 'spawn-protection', 'generate-structures', 'allow-nether', 'spawn-monsters', 'enable-command-block', 'simulation-distance']) delete out[k];
  return out;
}
const worldRoot = (m) => (isBds(m) ? path.join(m.dir, 'worlds') : m.dir);

async function create(opts, resolveJava, onStep) {
  const { name, mc, software = 'fabric', memory = 3072, maxPlayers = 10, port, dir: chosenDir, tunnel = 'e4mc', eula = false, modpack, props: gameProps, tunnelName, content = [], voice = false, bedrock = false, autoStart = false, schedule } = opts;
  if (!eula) throw new Error('You need to accept the Minecraft EULA to run a server.');
  if (!SOFTWARE[software]) throw new Error('Pick the server software.');
  if (!/^[\w.-]+$/.test(mc || '')) throw new Error('Pick a Minecraft version.');
  onStep && onStep('Preparing Minecraft server…');
  if (software === 'bedrock' && !['win32', 'linux'].includes(process.platform)) throw new Error('Mojang’s Bedrock server only runs on Windows and Linux.');
  let p = port ? Number(port) : nextPort(software);
  if (!(p >= 1024 && p <= 65535)) throw new Error('Port must be between 1024 and 65535.');
  if (list().some((s) => s.port === p)) throw new Error(`Another Astra server already uses port ${p}.`);
  const free = software === 'bedrock' ? (x) => udpFree(x) : (x) => portFree(x);
  if (!(await free(p))) {
    if (port) throw new Error(`Port ${p} is already used by another program on this PC. Pick another port, or leave it on “auto”.`);
    const used = new Set(list().map((s) => s.port));
    do { p++; } while (p < 65535 && (used.has(p) || !(await free(p))));
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
    if (isBds(m)) {
      writeProps(id, bdsProps({ 'server-name': m.name, 'server-port': p, 'server-portv6': p + 1, 'max-players': m.maxPlayers, 'online-mode': true, difficulty: 'normal', 'level-name': 'world', 'content-log-file-enabled': false, ...cleanProps(gameProps) }));
    } else {
      fs.writeFileSync(path.join(dir, 'eula.txt'), `# Accepted in Astra on ${new Date().toISOString()} (https://aka.ms/MinecraftEULA)\neula=true\n`);
      writeProps(id, { motd: `${m.name} \\u00a77\\u2014 hosted with Astra`, 'server-port': p, 'max-players': m.maxPlayers, 'online-mode': true, 'spawn-protection': 0, difficulty: 'normal', 'enable-command-block': false, ...cleanProps(gameProps) });
    }
    if (m.tunnel === 'e4mc') { onStep && onStep('Adding e4mc for the public address'); if (!(await addE4mc(m))) m.tunnel = 'none'; }
    // modpack first: Astra's own extras are only added when the pack doesn't already bring them
    if (modpack) { onStep && onStep('Installing the modpack'); await installModpack(m, modpack, onStep); }
    if (SOFTWARE[software].kind === 'mods') {
      // Quilt's loader often lags behind Fabric API's newest requirements: it gets Quilt's own API (QSL) instead
      for (const slug of software === 'fabric' ? ['fabric-api', 'lithium', 'ferrite-core'] : software === 'quilt' ? ['qsl'] : ['ferrite-core']) {
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
    if (!isBds(m)) addOwner(m); // Bedrock players use their Xbox gamertag, not the Java account
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
      const t = await pl.setupServer({ id, port: m.port, name: m.tunnelName || m.name, tunnelId: null, voice: voiceReq(m), bedrock: bedrockReq(m), main: isBds(m) ? 'bds' : 'java', pack: packReq(m) }, onStep);
      Object.assign(m, { playitTunnelId: t.tunnelId, playitAddress: t.address });
      applyVoice(m, t); applyBedrock(m, t);
      save(m);
      onStep && onStep(`Public address: ${t.address}`);
      if (m.voice?.address) onStep && onStep(`Voice chat address: ${m.voice.address}`);
      if (m.bedrock?.address) onStep && onStep(`Bedrock address: ${m.bedrock.address}`);
    } catch (e) {
      m.playitSetupError = e.message;
      save(m);
      push('toast', { type: 'warn', text: `The server is ready, but playit.gg isn’t set up yet: ${e.message} Astra tries again when you start the server, or use “Restart tunnel”.` });
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
// (an address the player set by hand means they made the tunnel themselves: Astra doesn't make another)
const voiceReq = (m) => (m.voice?.on && m.tunnel === 'playit' && !m.voice.manualAddress ? { port: m.voice.port, tunnelId: m.voice.tunnelId || null } : null);
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
  // voice_host: an address the player typed in Settings wins, then the playit.gg tunnel Astra found or made.
  // With playit.gg but no address yet, an existing voice_host is left alone (it may be one the player set by hand);
  // on the home network it's empty, so players connect to the same address they joined with.
  const vh = m.voice.manualAddress || (m.tunnel === 'playit' ? m.voice.address : null);
  const left = { port: String(m.voice.port) };
  if (vh) left.voice_host = vh;
  else if (m.tunnel !== 'playit') left.voice_host = '';
  lines = lines.map((l) => { const k = (l.match(/^([a-z_]+)=/) || [])[1]; if (k && k in left) { const v = left[k]; delete left[k]; return `${k}=${v}`; } return l; });
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (!lines.length) lines.push('# Simple Voice Chat — port and voice_host are set by Astra');
  for (const [k, v] of Object.entries(left)) lines.push(`${k}=${v}`);
  fs.writeFileSync(file, lines.join('\n') + '\n');
}
/** The voice chat address typed in Settings (e.g. a tunnel made on playit.gg by hand). Empty = automatic. */
function setVoiceAddress(id, address) {
  const m = meta(id);
  if (!m.voice?.on) throw new Error('Turn voice chat on first.');
  const a = String(address || '').trim().replace(/^udp:\/\//i, '');
  if (a && !/^[A-Za-z0-9.-]+:\d{1,5}$/.test(a)) throw new Error('Enter the address with its port, like scooter-unanimous.tun.ply.gg:50761 (both are shown on playit.gg).');
  if (a) m.voice.manualAddress = a; else delete m.voice.manualAddress;
  writeVoiceConfig(m); save(m);
  if (running.has(id)) log(id, '[Astra] Voice chat address saved — restart the server so players use it.');
  emit(id);
  return get(id);
}
/** Installs the mod/plugin and picks a free UDP port. */
async function addVoice(m) {
  if (SOFTWARE[m.software].kind === 'none') throw new Error(`${SOFTWARE[m.software].name} servers can’t run Simple Voice Chat — use Paper, Purpur, Fabric, Quilt, Forge or NeoForge.`);
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
      try { const t = await pl.setupServer({ id, port: m.port, name: m.tunnelName || m.name, tunnelId: m.playitTunnelId, voice: voiceReq(m), bedrock: bedrockReq(m), main: isBds(m) ? 'bds' : 'java', pack: packReq(m) }, null); Object.assign(m, { playitTunnelId: t.tunnelId, playitAddress: t.address }); applyVoice(m, t); applyBedrock(m, t); save(m); }
      catch (e) { m.voice.error = e.message; save(m); }
      finally { pl.releaseServer(id); }
    } else if (running.has(id)) { log(id, '[Astra] Simple Voice Chat added — restart the server to turn it on.'); if (m.tunnel === 'playit') startTunnel(id).catch(() => {}); }
  } else if (m.voice) {
    const rec = readJSON(recordFile(m), {});
    const vf = rec[VOICE_ID]?.file;
    if (vf) { fs.rmSync(path.join(contentDir(m), vf), { force: true }); fs.rmSync(path.join(contentDir(m), vf + '.disabled'), { force: true }); delete rec[VOICE_ID]; writeJSON(recordFile(m), rec); }
    require('./playit').deleteTunnel(m.voice.tunnelId);
    delete m.voice; save(m);
    if (running.has(id)) log(id, '[Astra] Simple Voice Chat removed — restart the server to finish.');
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
  const extras = new Set(['P7dR8mSH', 'gvQqBUqZ', 'uXXizFIs', VOICE_ID, 'wKkoqHrH', 'bWrNNfkb']); // fabric-api, lithium, ferrite-core, voice chat: Astra adds those itself
  const d = { v: 1, n: m.name, sw: m.software, mc: m.mc, mem: m.memory, max: m.maxPlayers, t: m.tunnel, p: keep, c: m.modpack ? [] : Object.keys(rec).filter((k) => !extras.has(k) && !k.startsWith('geysermc:')), vc: !!m.voice?.on, br: !!m.bedrock?.on, mp: m.modpack?.versionId || null, sc: m.schedule || null };
  return 'SOLARIS-' + b64u(zlib.deflateRawSync(Buffer.from(JSON.stringify(d))));
}
function readSetupCode(code) {
  const c = String(code || '').trim().replace(/\s+/g, '');
  const mm = c.match(/^SOLARIS-([A-Za-z0-9_-]+)$/i);
  if (!mm) throw new Error('That isn’t a Astra setup code. It starts with SOLARIS-');
  let d; try { d = JSON.parse(zlib.inflateRawSync(unb64u(mm[1])).toString('utf8')); } catch { throw new Error('That setup code is damaged — copy the whole code again.'); }
  if (d.v !== 1 || !SOFTWARE[d.sw]) throw new Error('This setup code was made by a newer Astra. Update Astra and try again.');
  return { name: String(d.n || '').slice(0, 40), software: d.sw, mc: String(d.mc || ''), memory: clampMem(d.mem), maxPlayers: Number(d.max) || 10, tunnel: d.t, props: cleanProps(d.p), content: (d.c || []).map(String).slice(0, 40), voice: !!d.vc, bedrock: !!d.br, modpack: d.mp ? { versionId: String(d.mp) } : null, schedule: d.sc ? cleanSchedule(d.sc) : null };
}
/** Join code: the address (+ version) in a short code friends paste into Astra. */
const JOIN_SUFFIX = [['.gl.joinmc.link', '~j'], ['.joinmc.link', '~k'], ['.gl.at.ply.gg', '~a'], ['.tun.ply.gg', '~t'], ['.ply.gg', '~p'], ['.e4mc.link', '~e']];
function joinCode(id) {
  const v = view(meta(id)), addr = v.address || v.knownAddress;
  if (v.software === 'bedrock') throw new Error('Join codes are for Java friends — Bedrock friends add the server address and port in Play → Servers.');
  if (!addr) throw new Error('This server has no public address yet — start it with playit.gg or e4mc first.');
  let a = addr; for (const [suf, k] of JOIN_SUFFIX) if (a.endsWith(suf) || a.includes(suf + ':')) { a = a.replace(suf, k); break; }
  const needsMs = readProps(id)['online-mode'] !== 'false';
  return 'JOIN-' + b64u(`${a}|${v.mc}|${v.contentKind === 'mods' ? v.softwareName : ''}|${needsMs ? 'm' : 'o'}`);
}
function readJoinCode(code) {
  const mm = String(code || '').trim().match(/^JOIN-([A-Za-z0-9_-]+)$/i);
  if (!mm) throw new Error('That isn’t a join code. Join codes start with JOIN-');
  const [a, mc, modded, acct] = unb64u(mm[1]).toString('utf8').split('|');
  let addr = a || ''; for (const [suf, k] of JOIN_SUFFIX) if (addr.includes(k)) { addr = addr.replace(k, suf); break; }
  if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(addr)) throw new Error('That join code is damaged — ask your friend for it again.');
  // requiresMicrosoft: true / false, or null for codes made before Astra put it in
  return { address: addr, mc: mc || null, modded: modded || '', requiresMicrosoft: acct === 'm' ? true : acct === 'o' ? false : null };
}

// ---------- players and account mode ----------
/** Everyone on your running servers right now (the Friends tab shows them live). */
function onlinePlayers() {
  const out = [];
  for (const [id, r] of running) {
    let v; try { v = view(meta(id)); } catch { continue; }
    const address = v.address || v.knownAddress || `localhost:${v.port}`;
    for (const name of r.players) out.push({ name, serverId: id, serverName: v.name, address, since: r.joined?.get(name) || r.started });
  }
  return out;
}
/**
 * "Require Microsoft accounts" decides which ID Minecraft gives a player: the Mojang one, or one made from the name
 * (offline). Inventories, positions, advancements and stats are saved per ID, so after switching everyone would
 * start over. Before the server starts, Astra copies each known player's save to their ID for the new mode (the
 * old files stay, so switching back finds them again). A save already made in the new mode is never overwritten.
 */
async function movePlayerData(m, say) {
  const props = readProps(m.id);
  const offlineMode = props['online-mode'] === 'false';
  const accounts = require('./accounts');
  const world = path.join(m.dir, props['level-name'] || 'world');
  // who has played here: the server's own name ↔ ID list, plus the whitelist and operators
  const known = new Map();
  for (const p of [...readJSON(path.join(m.dir, 'usercache.json'), []), ...people(m.id, 'whitelist'), ...people(m.id, 'ops')]) {
    if (!p?.name || !p?.uuid || !/^[A-Za-z0-9_]{1,16}$/.test(p.name)) continue;
    const k = p.name.toLowerCase();
    if (!known.has(k)) known.set(k, { name: p.name, ids: new Set() });
    known.get(k).ids.add(String(p.uuid).toLowerCase());
  }
  const files = (id) => [['playerdata', `${id}.dat`], ['playerdata', `${id}.dat_old`], ['advancements', `${id}.json`], ['stats', `${id}.json`]].map(([d, f]) => path.join(world, d, f));
  const hasSave = (id) => fs.existsSync(files(id)[0]);
  const isMojangId = (id) => id[14] === '4'; // Mojang IDs are random (version 4); offline IDs come from the name (version 3)
  let moved = 0;
  for (const { name, ids } of known.values()) {
    const offlineId = accounts.offlineUuid(name).toLowerCase();
    ids.add(offlineId);
    let target = offlineMode ? offlineId : [...ids].find(isMojangId);
    const sources = () => [...ids].filter((id) => id !== target && hasSave(id));
    if (!offlineMode && !target) {
      // only ask Mojang when there is an offline save to bring over
      if (!sources().length) continue;
      try { const prof = await profileByName(name); target = prof?.id?.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5').toLowerCase(); } catch {}
      if (!target) continue;
    }
    if (hasSave(target)) continue; // already has a save for this mode: never overwrite it
    // the newest save under this player's other ID
    const from = sources().sort((a, b) => fs.statSync(files(b)[0]).mtimeMs - fs.statSync(files(a)[0]).mtimeMs)[0];
    if (!from) continue;
    const [src, dst] = [files(from), files(target)];
    for (let n = 0; n < src.length; n++) if (fs.existsSync(src[n])) { fs.mkdirSync(path.dirname(dst[n]), { recursive: true }); fs.copyFileSync(src[n], dst[n]); }
    moved++;
    say && say(`Kept ${name}’s inventory, position and progress for ${offlineMode ? 'offline' : 'Microsoft'} accounts.`);
  }
  return moved;
}
/** An offline (cracked) player was turned away: let offline accounts join (optionally whitelist on + add them). */
async function allowOffline(id, { whitelist = true, name = '' } = {}) {
  const props = { 'online-mode': false };
  if (whitelist) { props['white-list'] = true; props['enforce-whitelist'] = true; }
  setSettings(id, { props });
  await convertPeople(id, false); // whitelist + operators get their offline IDs now (the owner stays an operator)
  const owner = require('./accounts').active();
  if (whitelist && owner?.name) { try { await addPerson(id, 'whitelist', owner.name); } catch {} }
  if (whitelist && name && /^[A-Za-z0-9_]{1,16}$/.test(name)) await addPerson(id, 'whitelist', name);
  if (running.has(id)) { log(id, '[Astra] Offline accounts allowed — restarting so it takes effect.'); restart(id); }
  return get(id);
}

// ---------- schedules (auto backups / restarts) and start with Windows ----------
// ---------- Task Scheduler: the player's own timed tasks ----------
// { id, name, action: command|say|restart|backup|stop|start, command, when: { type: every|daily|start, minutes, time }, enabled, last }
const TASK_ACTIONS = ['command', 'say', 'restart', 'backup', 'stop', 'start'];
let javaResolver = null; // set by start(); "start" tasks need it
function cleanTask(t) {
  const action = TASK_ACTIONS.includes(t?.action) ? t.action : 'command';
  const type = ['every', 'daily', 'start'].includes(t?.when?.type) ? t.when.type : 'every';
  if (action === 'start' && type === 'start') throw new Error('“Start the server” can’t run when the server starts.');
  const w = t?.when || {};
  const when = type === 'every' ? { type, minutes: Math.max(1, Math.min(10080, Math.round(Number(w.minutes) || 60))) }
    : type === 'daily' ? { type, time: /^([01]\d|2[0-3]):[0-5]\d$/.test(w.time || '') ? w.time : '04:00' } : { type };
  const command = String(t.command || '').replace(/\r/g, '').split('\n').map((x) => x.trim().replace(/^\//, '')).filter(Boolean).slice(0, 20).join('\n').slice(0, 2000);
  if ((action === 'command' || action === 'say') && !command) throw new Error(action === 'say' ? 'Type the message to send.' : 'Type the command to run.');
  return { id: /^[\w-]{4,40}$/.test(t.id || '') ? t.id : Math.random().toString(36).slice(2, 10), name: String(t.name || '').slice(0, 60), action, command, when, enabled: t.enabled !== false, last: Number(t.last) || 0, since: Number(t.since) || 0 };
}
function tasks(id) { return meta(id).tasks || []; }
function saveTask(id, t) {
  const m = meta(id), clean = cleanTask(t);
  const list = (m.tasks || []).filter((x) => x.id !== clean.id);
  if (list.length >= 30) throw new Error('A server can have up to 30 tasks.');
  const old = (m.tasks || []).find((x) => x.id === clean.id);
  m.tasks = [...list, { ...clean, last: old ? old.last : 0, since: old?.since || Date.now() }]; // a new task first runs one interval from now
  save(m); return m.tasks;
}
function deleteTask(id, taskId) { const m = meta(id); m.tasks = (m.tasks || []).filter((t) => t.id !== taskId); save(m); return m.tasks; }
async function runTask(id, t) {
  const r = running.get(id), live = r?.state === 'online' && !r.stopping;
  const label = t.name || t.action;
  const mark = () => { try { const m = meta(id); const x = (m.tasks || []).find((y) => y.id === t.id); if (x) { x.last = Date.now(); save(m); } } catch {} };
  if (t.action === 'start') { if (running.has(id)) return; mark(); log(id, `[Astra] Task “${label}”: starting the server.`); if (javaResolver) await start(id, javaResolver); return; }
  if (!live) return;
  mark();
  log(id, `[Astra] Task “${label}”.`);
  if (t.action === 'command') for (const c of t.command.split('\n')) command(id, c);
  else if (t.action === 'say') command(id, 'say ' + t.command.replace(/\n/g, ' '));
  else if (t.action === 'restart') { try { command(id, 'say Restarting in 1 minute.'); } catch {} setTimeout(() => { if (running.get(id) === r && !r.stopping) restart(id); }, 60000); }
  else if (t.action === 'stop') { try { command(id, 'say Stopping in 1 minute.'); } catch {} setTimeout(() => { if (running.get(id) === r && !r.stopping) stop(id); }, 60000); }
  else if (t.action === 'backup') await backup(id, 'auto');
}
/** A task is due: "every" counts from its last run (or the server start), "daily" fires once at its time. */
function taskDue(t, r, now = Date.now()) {
  if (!t.enabled) return false;
  if (t.when.type === 'every') return now - Math.max(t.last || 0, t.since || 0, r?.started || 0) >= t.when.minutes * 60000;
  if (t.when.type === 'daily') {
    const [h, mi] = t.when.time.split(':').map(Number);
    const at = new Date(now); at.setHours(h, mi, 0, 0);
    return now >= at.getTime() && now - at.getTime() < 10 * 60000 && (t.last || 0) < at.getTime();
  }
  return false;
}
function runTasks(id, why) {
  let list; try { list = tasks(id); } catch { return; }
  for (const t of list) if (t.enabled && (why === 'start' ? t.when.type === 'start' : taskDue(t, running.get(id)))) runTask(id, t).catch((e) => log(id, `[Astra] Task “${t.name || t.action}” failed: ${e.message}`));
}
setInterval(() => {
  for (const e of index()) {
    let m; try { m = meta(e.id); } catch { continue; }
    if (!m.tasks?.length) continue;
    const r = running.get(m.id);
    // a "start" task runs while the server is off; everything else needs it online
    for (const t of m.tasks) {
      if (!taskDue(t, r)) continue;
      if (t.action === 'start' ? running.has(m.id) : r?.state !== 'online' || r.stopping) continue;
      runTask(m.id, t).catch((er) => log(m.id, `[Astra] Task “${t.name || t.action}” failed: ${er.message}`));
    }
  }
}, 30000).unref?.();
/** When the next automatic backup happens (shown on the Backups tab). */
function nextBackupAt(m, r) {
  const h = m.schedule?.backupHours; if (!h) return null;
  if (!r || r.state !== 'online') return null; // paused while the server is off
  return Math.max(m.lastAutoBackup || 0, r.started) + h * 3600000;
}

function setSchedule(id, sc) { const m = meta(id); m.schedule = cleanSchedule(sc); save(m); return get(id); }
function setAutoStart(id, on) {
  const m = meta(id); m.autoStart = !!on; save(m);
  if (on) {
    // a server can only start with Windows if Astra does (hidden in the tray)
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
        log(id, '[Astra] Automatic backup saved.');
      } catch (e) { log(id, '[Astra] Automatic backup failed: ' + e.message); try { require('./eco/notify').add({ category: 'backup', title: `${m.name}: automatic backup failed`, body: e.message, key: `hosted-backup-fail:${id}` }); } catch {} }
      finally { r.autoBackup = false; }
    }
    if (sc.restartHours && !r.restartWarned && now - r.started >= sc.restartHours * 3600000) {
      r.restartWarned = true;
      try { command(id, 'say Scheduled restart in 1 minute.'); } catch {}
      setTimeout(() => { if (running.get(id) === r && !r.stopping) { log(id, '[Astra] Scheduled restart.'); restart(id); } }, 60000);
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
const BEDROCK_OK = ['paper', 'purpur', 'fabric', 'quilt', 'neoforge'];
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
  if (!y.trim()) y = '# Geyser — port, login and address are set by Astra; Geyser adds everything else on first start.\n';
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
// the Bedrock (Geyser) and resource pack tunnels come back together; true when either address changed
const applyBedrock = (m, t) => { const a = applySide(m, t, 'bedrock', writeBedrockConfig); const b = applySide(m, t, 'pack', writePackProps); return a || b; };
async function setBedrock(id, on) {
  const m = meta(id);
  if (on) {
    await addBedrock(m);
    save(m);
    if (m.tunnel === 'playit' && !running.has(id)) {
      const pl = require('./playit');
      try { const t = await pl.setupServer({ id, port: m.port, name: m.tunnelName || m.name, tunnelId: m.playitTunnelId, voice: voiceReq(m), bedrock: bedrockReq(m), main: isBds(m) ? 'bds' : 'java', pack: packReq(m) }, null); Object.assign(m, { playitTunnelId: t.tunnelId, playitAddress: t.address }); applyVoice(m, t); applyBedrock(m, t); save(m); }
      catch (e) { m.bedrock.error = e.message; save(m); }
      finally { pl.releaseServer(id); }
    } else if (running.has(id)) { log(id, '[Astra] Bedrock support added — restart the server to turn it on.'); if (m.tunnel === 'playit') startTunnel(id).catch(() => {}); }
  } else if (m.bedrock) {
    const rec = readJSON(recordFile(m), {});
    for (const k of ['geysermc:geyser', 'geysermc:floodgate', GEYSER.geyser, GEYSER.floodgate]) {
      const f = rec[k]?.file; if (!f) continue;
      fs.rmSync(path.join(contentDir(m), f), { force: true }); fs.rmSync(path.join(contentDir(m), f + '.disabled'), { force: true }); delete rec[k];
    }
    writeJSON(recordFile(m), rec);
    require('./playit').deleteTunnel(m.bedrock.tunnelId);
    delete m.bedrock; save(m);
    if (running.has(id)) log(id, '[Astra] Bedrock support removed — restart the server to finish.');
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
  // Astra was closed since: the server's own log file of its last run (plus the crash report it wrote, if any)
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
  // did the last run end normally? (stopped from Astra or with /stop, no crash)
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
  if (fix.type === 'eula') { fs.writeFileSync(path.join(m.dir, 'eula.txt'), `# Accepted in Astra on ${new Date().toISOString()} (https://aka.ms/MinecraftEULA)\neula=true\n`); return 'EULA accepted'; }
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
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Astra', content: String(content).slice(0, 1900), allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(r.status === 404 ? 'Discord says this webhook doesn’t exist any more.' : `Discord answered HTTP ${r.status}.`);
}
function notifyDiscord(id, event, text) {
  let m; try { m = meta(id); } catch { return; }
  // Astra Connect's desktop alerts listen here too (online / stop / crash / join / leave)
  try { events.emit('hosted:event', { id, name: m.name, event, text: String(text).replace(/\*\*/g, '').replace(/`/g, '') }); } catch {}
  const d = m.discord; if (!d?.url || !d.events?.[event]) return;
  postDiscord(d.url, text).catch((e) => log(id, '[Astra] Discord alert failed: ' + e.message));
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
  await postDiscord(u, `✅ Astra is connected — alerts for **${meta(id).name}** will show up here.`);
  return true;
}

// ---------- a game instance that matches the server (same version, loader and mods) ----------
/**
 * Client mods: what players need in their own game to join — the server's mods that also run in the game
 * (server-only helpers left out), plus extra game-only mods the owner adds (minimaps, shaders support…).
 */
async function clientMods(id) {
  const m = meta(id), kind = SOFTWARE[m.software].kind;
  const needed = [], serverOnly = [], unknown = [];
  if (kind === 'mods') {
    // every mod that is turned on in the server — from Modrinth, a modpack, an instance or a file from this PC
    const rec = readJSON(recordFile(m), {}), dir = contentDir(m);
    let files = []; try { files = fs.readdirSync(dir).filter((f) => /\.jar$/i.test(f)); } catch {}
    const byFile = {}; for (const [k, v] of Object.entries(rec)) if (/^\w{8}$/.test(k) && v?.file) byFile[v.file] = k;
    const missing = files.filter((f) => !byFile[f]);
    const mr = missing.length ? await modrinthFiles(missing.map((f) => path.join(dir, f))) : {};
    const ids = new Set();
    for (const f of files) {
      const pid = byFile[f] || mr[f]?.projectId;
      if (pid) ids.add(pid); else if (!/^e4mc/i.test(f)) unknown.push(f);
    }
    let projects = []; try { if (ids.size) projects = await getJSON(`https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify([...ids]))}`); } catch {}
    for (const p of projects) {
      const helper = ['e4mc', 'lithium', 'ferrite-core', 'geyser', 'floodgate', 'chunky', 'spark', 'luckperms'].includes(p.slug) || [GEYSER.geyser, GEYSER.floodgate].includes(p.id);
      if (p.client_side === 'unsupported' || helper) serverOnly.push(p.title);
      else needed.push({ id: p.id, title: p.title, icon: p.icon_url || null, required: p.client_side === 'required' });
    }
  }
  if (m.voice?.on && !needed.some((x) => x.id === VOICE_ID)) needed.push({ id: VOICE_ID, title: 'Simple Voice Chat', icon: null, required: true });
  return { needed, serverOnly, unknown, extra: m.clientMods || [], loader: kind === 'mods' ? m.software : m.voice?.on ? 'fabric' : 'vanilla', mc: m.mc };
}
async function addClientMod(id, projectId) {
  const m = meta(id);
  const p = await getJSON(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}`);
  if (p.project_type !== 'mod' && p.project_type !== 'resourcepack' && p.project_type !== 'shader') throw new Error('Only mods, resource packs and shaders can be added.');
  m.clientMods = [...(m.clientMods || []).filter((x) => x.id !== p.id), { id: p.id, title: p.title, icon: p.icon_url || null, type: p.project_type }].slice(0, 60);
  save(m); return clientMods(id);
}
function removeClientMod(id, projectId) { const m = meta(id); m.clientMods = (m.clientMods || []).filter((x) => x.id !== projectId); save(m); return clientMods(id); }
async function makeInstance(id, onStep) {
  const m = meta(id), instances = require('./instances'), modrinth = require('./modrinth');
  if (isBds(m)) throw new Error('Bedrock servers are joined from Minecraft Bedrock Edition, not a Java instance.');
  let old = null; try { old = m.playInstance ? instances.get(m.playInstance) : null; } catch {}
  if (m.modpack?.versionId) {
    onStep && onStep('Installing the modpack');
    // the same modpack version is already installed for this server: keep it (its worlds and settings too)
    const cfv = String(m.modpack.versionId).startsWith('cf:') ? String(m.modpack.versionId).split(':') : null;
    const same = old && (cfv ? old.modpack?.source === 'curseforge' && old.modpack?.fileId === cfv[2] : old.modpack?.versionId === m.modpack.versionId);
    const inst = same ? old : cfv ? await require('./curseforge').installModpack({ projectId: cfv[1], fileId: cfv[2] }) : await modrinth.installModpack({ versionId: m.modpack.versionId, name: `${m.name} (play)` });
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
  const added = [], cm = await clientMods(id), skipped = [...cm.unknown.map((x) => `${x} (not on Modrinth — copy it into the instance yourself if players need it)`), ...cm.serverOnly.map((x) => `${x} (server only)`)];
  const want = [...cm.needed, ...cm.extra].map((x) => [x.id, x.title]);
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
  const t = tunnelAllowed(m.software, tunnel);
  if (running.has(id)) {
    if (t === m.tunnel) return get(id);
    // playit.gg runs beside the server, so switching between it and "home only" works while the server runs.
    // e4mc is a mod inside the server: that switch is saved and used from the next start.
    if (t === 'e4mc' || m.tunnel === 'e4mc') {
      if (t === 'e4mc') { if (!(await addE4mc(m))) throw new Error(`e4mc isn’t available for ${m.softwareName || m.software} ${m.mc}. Use playit.gg instead.`); }
      else m.e4mcRemove = true; // the running server has the jar open (Windows locks it): taken out at the next start
      if (t === 'e4mc') delete m.e4mcRemove;
      m.tunnel = t; delete m.playitStopped; save(m);
      if (t === 'playit') startTunnel(id).catch(() => {}); // the old e4mc address lasts until the restart; playit.gg works now
      log(id, `[Astra] Public address set to ${t === 'none' ? 'home only' : t}. e4mc changes when the server restarts.`);
      emit(id);
      return { ...get(id), needsRestart: true };
    }
    m.tunnel = t; delete m.playitStopped; save(m);
    if (t === 'playit') { log(id, '[Astra] Making the server public with playit.gg…'); startTunnel(id).catch(() => {}); }
    else { require('./playit').releaseServer(id); log(id, '[Astra] playit.gg tunnel closed — the server is only reachable on your network now.'); }
    emit(id);
    return get(id);
  }
  if (t === 'e4mc') { if (!(await addE4mc(m))) throw new Error(`e4mc isn’t available for ${m.softwareName || m.software} ${m.mc}. Use playit.gg instead.`); }
  else removeE4mc(m);
  delete m.e4mcRemove;
  m.tunnel = t;
  return save(m);
}

// ---------- run ----------
async function start(id, resolveJava) {
  if (resolveJava) javaResolver = resolveJava;
  if (running.has(id)) return get(id);
  const m = meta(id);
  if (m.e4mcRemove) { try { if (m.tunnel !== 'e4mc') removeE4mc(m); delete m.e4mcRemove; save(m); } catch {} }
  const r = { proc: null, state: 'starting', address: null, players: new Set(), lines: [], stopping: false, started: Date.now(), stats: null, listeners: new Set() };
  running.set(id, r); emit(id);
  const bds = isBds(m);
  let java = null;
  if (!bds) {
    try { java = await serverJava(m, resolveJava, (s) => log(id, '[Astra] ' + s)); }
    catch (e) { running.delete(id); emit(id); throw e; }
  }
  // Stopped (or Astra quitting) while Java was still being prepared: don't start it after all.
  if (r.cancelled) { running.delete(id); emit(id); return get(id); }
  // The port must be free. Usually it isn't because an earlier copy of this same server kept running after
  // Astra closed (or updated) — close that one safely, otherwise explain what's wrong instead of crashing.
  const free = bds ? udpFree : portFree;
  try {
    if (!(await free(m.port))) {
      const old = readPid(m.dir);
      if (old && (await isOurServer(old, m.dir))) {
        log(id, `[Astra] An earlier copy of this server is still running (process ${old}) — closing it first.`);
        try { process.kill(old); } catch {}
        for (let i = 0; i < 40 && !(await free(m.port)); i++) await new Promise((res) => setTimeout(res, 500));
      }
      if (!(await free(m.port))) throw new Error(`Port ${m.port} is already in use by another program (maybe another Minecraft server). Close it, or pick another port in this server’s Settings.`);
    }
  } catch (e) { running.delete(id); emit(id); throw e; }
  writeProps(id, bds ? { 'server-port': m.port, 'server-portv6': m.port + 1 } : { 'server-port': m.port });
  if (!bds) {
    try { await movePlayerData(m, (t) => log(id, '[Astra] ' + t)); } catch (e) { log(id, '[Astra] Couldn’t move player progress: ' + e.message); }
    try { writeVoiceConfig(m); } catch {}
    await updateBedrock(m, (t) => log(id, '[Astra] ' + t));
    if (r.cancelled) { running.delete(id); emit(id); return get(id); } // stopped while Geyser was updating
    try { writeBedrockConfig(m); } catch {}
    try { fixDuplicateMods(id); } catch {}
    if (m.pack) { try { writePackProps(m); } catch {} openPackServer(m); }
    for (const h of hooks.beforeStart) { try { h(m); } catch (e) { log(id, '[Astra] ' + e.message); } }
  }
  const st = m.start || { jar: 'server.jar' };
  const args = bds ? [] : [`-Xmx${m.memory}M`, `-Xms${Math.min(1024, m.memory)}M`, ...(m.aikar ? AIKAR : ['-XX:+UseG1GC']), ...splitArgs(m.jvmArgs), ...(st.argsFile ? ['@' + st.argsFile] : ['-jar', st.jar]), 'nogui'];
  log(id, `[Astra] Starting ${m.name} — ${SOFTWARE[m.software].name} ${m.mc}${bds ? '' : `, ${m.memory} MB`}, port ${m.port}`);
  if (m.tunnel === 'playit' && !m.playitStopped) startTunnel(id).catch(() => {});
  const exe = bds ? path.join(m.dir, st.exe || (process.platform === 'win32' ? 'bedrock_server.exe' : 'bedrock_server')) : java.replace(/javaw\.exe$/i, 'java.exe');
  const env = bds && process.platform === 'linux' ? { ...process.env, LD_LIBRARY_PATH: '.' } : process.env;
  const proc = spawn(exe, args, { cwd: m.dir, windowsHide: true, env });
  r.proc = proc;
  if (proc.pid) writePid(m.dir, proc.pid);
  proc.stdin.on('error', () => {}); // writing a command to a server that just exited (EPIPE) must not crash Astra
  let buf = '';
  const onData = (d) => { buf += d; const parts = buf.split(/\r?\n/); buf = parts.pop(); parts.forEach((l) => onLine(id, l)); };
  proc.stdout.on('data', onData); proc.stderr.on('data', onData);
  proc.on('error', (e) => { log(id, `[Astra] Could not start ${bds ? 'the Bedrock server' : 'Java'}: ` + e.message); running.delete(id); emit(id); });
  proc.on('close', (code) => {
    if (buf) { onLine(id, buf); buf = ''; }
    writePid(m.dir, null);
    closePackServer(id);
    const restart = r.restart;
    log(id, `[Astra] Server stopped${code && !r.stopping ? ` (exit code ${code})` : ''} after ${fmtUptime(Date.now() - r.started)}.`);
    // crashed = exited with an error, or stopped by itself before it finished starting
    const crashed = !r.stopping && (!!code || r.state !== 'online');
    lastRun.set(id, { lines: r.lines.slice(-800), code, at: Date.now(), crashed });
    for (const p of r.players) notePlayer(id, p, false);
    running.delete(id); emit(id);
    if (m.tunnel === 'playit') require('./playit').releaseServer(id);
    push('hosted:stopped', { id, crashed });
    if (crashed) {
      diagnose(id)
        .catch(() => ({ id, name: m.name, findings: [], errors: [], hasLog: true })) // still tell the player it stopped
        .then((d) => { push('hosted:crash', d); notifyDiscord(id, 'crash', `⚠️ **${m.name}** stopped unexpectedly${d.findings[0] ? ': ' + d.findings[0].text : '.'}`); });
    } else if (!restart) notifyDiscord(id, 'stop', `🔴 **${m.name}** is offline.`);
    if (restart) start(id, resolveJava).catch((e) => push('toast', { type: 'error', text: 'Restart failed: ' + e.message }));
    // "Restart after a crash" (Settings): try again, but not over and over (at most 3 times in 10 minutes)
    else if (crashed && m.restartOnCrash) {
      const recent = (crashTimes.get(id) || []).filter((t) => Date.now() - t < 600000);
      if (recent.length < 3) {
        crashTimes.set(id, [...recent, Date.now()]);
        log(id, '[Astra] Restarting after the crash in 10 seconds…');
        setTimeout(() => { if (!running.has(id)) start(id, resolveJava).catch((e) => push('toast', { type: 'error', text: 'Restart failed: ' + e.message })); }, 10000);
      } else log(id, '[Astra] It crashed 3 times in 10 minutes — not restarting again by itself. See “Why did it stop?”.');
    }
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
    const t = await require('./playit').setupServer({ id, port: m.port, name: m.tunnelName || m.name, tunnelId: m.playitTunnelId, voice: voiceReq(m), bedrock: bedrockReq(m), main: isBds(m) ? 'bds' : 'java', pack: packReq(m) }, (s) => log(id, '[Astra] playit.gg: ' + s));
    const cur = meta(id); // re-read: settings may have changed meanwhile
    Object.assign(cur, { playitTunnelId: t.tunnelId, playitAddress: t.address }); delete cur.playitSetupError;
    const voiceChanged = applyVoice(cur, t), bedrockChanged = applyBedrock(cur, t);
    save(cur);
    log(id, `[Astra] playit.gg tunnel ready: ${t.address} → localhost:${m.port}`);
    if (cur.voice?.on) {
      if (t.voiceError) log(id, '[Astra] ' + t.voiceError);
      else if (cur.voice.address) log(id, `[Astra] Voice chat tunnel ready: ${cur.voice.address} → UDP localhost:${cur.voice.port}`);
    }
    if (cur.bedrock?.on) {
      if (t.bedrockError) log(id, '[Astra] ' + t.bedrockError);
      else if (cur.bedrock.address) log(id, `[Astra] Bedrock tunnel ready: ${cur.bedrock.address} → localhost:${cur.bedrock.port}`);
    }
    // The server read the old voice_host / Bedrock address when it started: restart it once (right away while
    // nobody is on it, otherwise ask) so it uses the new address.
    if ((voiceChanged || bedrockChanged) && running.get(id) === r) {
      if (!r.players.size) { if (r.state === 'online') { log(id, '[Astra] Restarting once so the new voice chat / Bedrock address is used.'); restart(id); } else r.voiceRestart = true; }
      else push('toast', { type: 'warn', text: `${cur.name}: ${voiceChanged ? 'voice chat' : 'Bedrock'} has a new address — restart the server so it’s used.` });
    }
  } catch (e) {
    if (running.get(id) === r) r.tunnelError = e.message;
    log(id, '[Astra] playit.gg: ' + e.message);
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
  if (running.has(id)) log(id, '[Astra] playit.gg tunnel stopped — the server is only reachable on your network now.');
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
      const t = await pl.setupServer({ id, port: m.port, name: m.tunnelName || m.name, tunnelId: m.playitTunnelId, voice: voiceReq(m), bedrock: bedrockReq(m), main: isBds(m) ? 'bds' : 'java', pack: packReq(m) }, null);
      Object.assign(m, { playitTunnelId: t.tunnelId, playitAddress: t.address }); delete m.playitSetupError; applyVoice(m, t); applyBedrock(m, t); save(m);
    } finally { pl.releaseServer(id); }
    emit(id);
    return get(id);
  }
  log(id, '[Astra] Restarting the playit.gg tunnel…');
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
/** The server finished starting (Java "Done (…)!" or Bedrock "Server started."). */
function onOnline(id, r) {
  try { const mm = meta(id), v = view(mm); if (!r.notifiedOnline) { r.notifiedOnline = true; notifyDiscord(id, 'online', `🟢 **${mm.name}** is online${v.address || v.knownAddress ? ` — join at \`${v.address || v.knownAddress}\`` : ''} (${isBds(mm) ? 'Bedrock' : 'Java'} ${mm.mc}).`); } } catch {}
  if (r.voiceRestart && !r.players.size) { r.voiceRestart = false; log(id, '[Astra] Restarting once so voice chat uses its new address.'); setTimeout(() => { if (running.get(id) === r && !r.players.size) restart(id); }, 1500); }
  runTasks(id, 'start');
  applyRules(id).catch(() => {});
}
/**
 * Everyone who ever joined (Players → All): first seen, last seen and play time, kept in solaris-players.json.
 * Saved when someone joins or leaves (and for everyone still on when the server stops).
 */
const playerSaves = new Map();
function notePlayer(id, name, joined) {
  let m; try { m = meta(id); } catch { return; }
  const f = path.join(m.dir, 'solaris-players.json');
  const all = playerSaves.get(id) || readJSON(f, {});
  const key = name.toLowerCase(), now = Date.now();
  const p = all[key] || { name, first: now, last: now, playMs: 0 };
  p.name = name;
  if (joined) { p.since = now; p.joins = (p.joins || 0) + 1; }
  else if (p.since) { p.playMs += now - p.since; delete p.since; }
  p.last = now;
  all[key] = p;
  playerSaves.set(id, all);
  writeJSON(f, all);
}
function knownPlayers(id) {
  const m = meta(id), r = running.get(id), now = Date.now();
  const all = { ...readJSON(path.join(m.dir, 'solaris-players.json'), {}) };
  // players from before Astra kept this list: the server's own name cache
  if (!isBds(m)) for (const u of readJSON(path.join(m.dir, 'usercache.json'), [])) { const k = String(u.name || '').toLowerCase(); if (k && !all[k]) all[k] = { name: u.name, uuid: u.uuid, first: null, last: null, playMs: 0 }; }
  const ops = new Set(people(id, 'ops').map((p) => p.name.toLowerCase()));
  const wl = new Set(people(id, 'whitelist').map((p) => p.name.toLowerCase()));
  const banned = new Set(bans(id).map((b) => String(b.name).toLowerCase()));
  const online = new Set([...(r?.players || [])].map((n) => n.toLowerCase()));
  for (const n of [...ops, ...wl, ...banned]) if (!all[n]) all[n] = { name: [...people(id, 'ops'), ...people(id, 'whitelist'), ...bans(id)].find((p) => p.name.toLowerCase() === n)?.name || n, first: null, last: null, playMs: 0 };
  return Object.entries(all).map(([k, p]) => ({ name: p.name, first: p.first, last: online.has(k) ? now : p.last, playMs: (p.playMs || 0) + (p.since && online.has(k) ? now - p.since : 0), joins: p.joins || 0, op: ops.has(k), whitelisted: wl.has(k), banned: banned.has(k), online: online.has(k) }))
    .sort((a, b) => (b.online - a.online) || (b.last || 0) - (a.last || 0) || a.name.localeCompare(b.name));
}
function onLine(id, line) {
  const r = running.get(id); if (!r) return;
  line = stripAnsi(line); // spark and others colour their output; the console shows plain text
  log(id, line);
  for (const f of r.listeners) { try { f(line); } catch {} }
  for (const h of hooks.line) { try { h(id, line); } catch {} }
  const ck = line.match(/\[Chunky\] Task (running|finished|stopped|paused|cancelled) for [\w:]+\.(?: Processed: \d+ chunks \(([\d.]+)%\)(?:, ETA: ([\d:]+))?)?/);
  if (ck) {
    const st = ck[1] === 'running' ? 'running' : ck[1] === 'finished' ? 'done' : ck[1] === 'paused' ? 'paused' : 'idle';
    r.chunky = { ...(r.chunky || {}), state: st, percent: ck[2] != null ? Number(ck[2]) : st === 'done' ? 100 : r.chunky?.percent || 0, eta: ck[3] || null };
    push('hosted:chunky', { id, ...r.chunky });
    if (st === 'done') log(id, '[Astra] World pre-generation finished.');
  }
  // Mojang's Bedrock server: "Server started." / "Player connected: Some Name, xuid: 2535…" / "Player disconnected: …"
  const bj = line.match(/Player connected: (.+?), xuid/), bl = line.match(/Player disconnected: (.+?), xuid/);
  if (bj && !r.players.has(bj[1])) { notePlayer(id, bj[1], true); r.players.add(bj[1]); (r.joined = r.joined || new Map()).set(bj[1], Date.now()); emit(id); try { notifyDiscord(id, 'join', `➕ **${bj[1]}** joined ${meta(id).name} (${r.players.size} online).`); } catch {} }
  if (bl && r.players.has(bl[1])) { notePlayer(id, bl[1], false); r.players.delete(bl[1]); emit(id); try { notifyDiscord(id, 'leave', `➖ **${bl[1]}** left ${meta(id).name} (${r.players.size} online).`); } catch {} }
  if (/\bServer started\.$/.test(line) && r.state !== 'online') { r.state = 'online'; emit(id); onOnline(id, r); }
  if (/Done \([\d.,]+s\)!/.test(line)) { r.state = 'online'; emit(id); onOnline(id, r); }
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
    notePlayer(id, j[1], true);
    r.players.add(j[1]); (r.joined = r.joined || new Map()).set(j[1], Date.now()); emit(id);
    try { const mm = meta(id), vv = view(mm); require('./friends').notePlayers(vv.address || vv.knownAddress || `localhost:${mm.port}`, [j[1]]); notifyDiscord(id, 'join', `➕ **${j[1]}** joined ${mm.name} (${r.players.size} online).`); } catch {}
  }
  const lft = line.match(new RegExp(`\\]: (?:System chat: |\\[Server\\] )?${PLAYER} left the game`)) || line.match(new RegExp(`\\]: ${PLAYER} lost connection: `));
  if (lft && r.players.has(lft[1])) {
    notePlayer(id, lft[1], false); r.players.delete(lft[1]); emit(id); try { notifyDiscord(id, 'leave', `➖ **${lft[1]}** left ${meta(id).name} (${r.players.size} online).`); } catch {} }
  const nwl = line.match(/Disconnecting ([A-Za-z0-9_]{2,16}) .*not white-?listed/i);
  if (nwl) push('hosted:notWhitelisted', { id, name: nwl[1] });
  // "Disconnecting Steve (/1.2.3.4:5): Failed to verify username!" (older: "...name=Steve,... lost connection: Failed to verify username!")
  const unv = line.match(/Disconnecting (?:.*?name=)?([A-Za-z0-9_]{1,16})\b.*Failed to verify username/i) || line.match(/name=([A-Za-z0-9_]{1,16})\b.*lost connection: Failed to verify username/i);
  if (unv && readProps(id)['online-mode'] !== 'false') push('hosted:offlineKick', { id, name: unv[1] });
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
      (r.history = r.history || []).push({ t: now, cpu, ram: r.stats.ramMb, players: r.players.size }); if (r.history.length > 600) r.history.shift();
      push('hosted:stats', { id, ...r.stats, uptime: now - r.started });
    }
  } catch {} finally { sampling = false; }
}, 3000).unref?.();

// ---------- settings ----------
function getSettings(id) {
  const m = meta(id);
  return {
    // servers that made PvP/monsters/Nether game rules show them like the other switches (Astra keeps their values)
    props: usesRules(id) ? { ...readProps(id), pvp: 'true', 'spawn-monsters': 'true', 'allow-nether': 'true', ...(m.gamerules || {}) } : readProps(id), live: running.get(id)?.state === 'online', memory: m.memory, tunnel: m.tunnel, name: m.name, tunnelName: m.tunnelName || '', voice: m.voice || null, bedrock: m.bedrock || null,
    discord: m.discord ? { url: m.discord.url, events: m.discord.events } : null, playInstance: m.playInstance || null, schedule: m.schedule || null, autoStart: !!m.autoStart,
    port: m.port, software: m.software, mc: m.mc, dir: m.dir, javaPath: m.javaPath || '', jvmArgs: m.jvmArgs || '', aikar: !!m.aikar, restartOnCrash: !!m.restartOnCrash,
    pack: m.pack ? { type: m.pack.type, name: m.pack.name, url: m.pack.type === 'url' ? m.pack.url : packUrl(m), size: m.pack.size, required: !!m.pack.required, prompt: m.pack.prompt || '', error: m.pack.error || null } : null,
    totalMemMb: Math.round(require('os').totalmem() / 1048576), modded: SOFTWARE[m.software].kind === 'mods', bedrockServer: isBds(m),
  };
}

// ---------- resource pack ----------
const PACK_MAX = 250 * 1024 * 1024;
const packFile = (m) => path.join(m.dir, 'solaris-resource-pack.zip');
const packReq = (m) => (m.pack?.on && m.tunnel === 'playit' ? { port: m.pack.port, tunnelId: m.pack.tunnelId || null } : null);
function lanIp() {
  for (const list of Object.values(require('os').networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return '127.0.0.1';
}
/** The link players' games download the pack from. */
function packUrl(m) {
  if (!m.pack) return null;
  if (m.pack.type === 'url') return m.pack.url;
  if (m.tunnel === 'playit') return m.pack.address ? `http://${m.pack.address}/pack.zip` : null;
  return `http://${lanIp()}:${m.pack.port}/pack.zip`;
}
function writePackProps(m) {
  const url = packUrl(m);
  const promptJson = m.pack?.prompt ? JSON.stringify({ text: m.pack.prompt }) : '';
  writeProps(m.id, url ? { 'resource-pack': url.replace(/:/g, '\\:'), 'resource-pack-sha1': m.pack.sha1, 'require-resource-pack': !!m.pack.required, 'resource-pack-prompt': promptJson }
    : { 'resource-pack': '', 'resource-pack-sha1': '', 'require-resource-pack': false, 'resource-pack-prompt': '' });
}
async function sha1Of(file) { return require('./util').sha1File(file); }
/** Settings → Resource pack: a .zip from this PC (Astra serves it), a download link, or nothing. */
async function setPack(id, { file, url, required = false, prompt = '', remove = false } = {}) {
  const m = meta(id);
  if (isBds(m)) throw new Error('Bedrock servers use add-on packs from the worlds folder, not a resource pack link.');
  const extra = { required: !!required, prompt: String(prompt || '').replace(/[\r\n]/g, ' ').slice(0, 200) };
  if (file) {
    if (!/\.zip$/i.test(file)) throw new Error('Pick the resource pack as a .zip file.');
    const st = fs.statSync(file);
    if (st.size > PACK_MAX) throw new Error('The resource pack is bigger than 250 MB — Minecraft won’t download it.');
    try { if (!new AdmZip(file).getEntries().some((e) => /(^|\/)pack\.mcmeta$/.test(e.entryName))) throw new Error('x'); } catch { throw new Error('That .zip isn’t a resource pack (it has no pack.mcmeta).'); }
    fs.copyFileSync(file, packFile(m));
    const port = m.pack?.port || (await nextSidePort(m, m.port + 100));
    m.pack = { on: true, type: 'file', name: path.basename(file), size: st.size, sha1: await sha1Of(packFile(m)), port, tunnelId: m.pack?.tunnelId || null, address: m.pack?.address || null, ...extra };
  } else if (url) {
    const u = String(url).trim();
    if (!/^https?:\/\/\S+$/i.test(u)) throw new Error('Paste a download link that starts with https://');
    // download it once for the checksum players' games check it against (and to make sure the link works)
    const tmp = path.join(require('os').tmpdir(), `solaris-pack-${Date.now()}.zip`);
    try {
      const r = await request(u);
      if (!r.ok) throw new Error(`The link answered with HTTP ${r.status}.`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > PACK_MAX) throw new Error('The resource pack is bigger than 250 MB.');
      if (buf.slice(0, 2).toString() !== 'PK') throw new Error('The link doesn’t download a .zip — use a direct download link (for Dropbox, end it with ?dl=1).');
      fs.writeFileSync(tmp, buf);
      if (m.pack?.type === 'file') { closePackServer(id); require('./playit').deleteTunnel(m.pack.tunnelId); try { fs.rmSync(packFile(m), { force: true }); } catch {} }
      m.pack = { on: false, type: 'url', url: u, name: decodeURIComponent(u.split('/').pop().split('?')[0]).slice(0, 80) || 'pack.zip', size: buf.length, sha1: await sha1Of(tmp), ...extra };
    } finally { try { fs.rmSync(tmp, { force: true }); } catch {} }
  } else if (m.pack && !remove) {
    Object.assign(m.pack, extra); // only the options changed
  }
  if (remove) {
    if (m.pack?.type === 'file') { closePackServer(id); require('./playit').deleteTunnel(m.pack.tunnelId); try { fs.rmSync(packFile(m), { force: true }); } catch {} }
    delete m.pack;
  }
  writePackProps(m);
  save(m);
  if (running.has(id) && m.pack?.type === 'file') { openPackServer(m); if (m.tunnel === 'playit') startTunnel(id).catch(() => {}); }
  return getSettings(id);
}
const packServers = new Map(); // id -> http.Server
function openPackServer(m) {
  if (packServers.has(m.id) || m.pack?.type !== 'file') return;
  const file = packFile(m);
  const srv = require('http').createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (!/^\/pack\.zip(\?|$)/.test(req.url) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': fs.statSync(file).size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
  srv.on('error', (e) => log(m.id, `[Astra] The resource pack couldn’t be shared on port ${m.pack.port}: ${e.message}`));
  srv.listen(m.pack.port, '0.0.0.0');
  packServers.set(m.id, srv);
}
function closePackServer(id) { const s = packServers.get(id); if (s) { s.close(); packServers.delete(id); } }

// ---------- performance (Performance tab) ----------
function perf(id) {
  const m = meta(id), r = running.get(id);
  return { state: r ? r.state : 'offline', uptime: r ? Date.now() - r.started : 0, cpu: r?.stats?.cpu ?? null, ramMb: r?.stats?.ramMb || 0, memory: m.memory, bedrockServer: isBds(m),
    history: r?.history || [], players: r ? r.players.size : 0, maxPlayers: m.maxPlayers, totalMemMb: Math.round(require('os').totalmem() / 1048576), cores: require('os').cpus().length };
}

// ---------- move a server to another PC / bring in a world ----------
const SKIP_EXPORT = /^(backups|logs|crash-reports|cache|\.solaris-pid|solaris-resource-pack\.zip)([\\/]|$)/;
/** One .zip with the whole server (without backups and logs). Import it on another PC with “Import server”. */
async function exportServer(id, dest) {
  const m = meta(id);
  if (running.has(id)) throw new Error('Stop the server first, so the world is saved in one piece.');
  if (!dest) throw new Error('Pick where to save the server.');
  const zip = new AdmZip();
  await zip.addLocalFolderPromise(m.dir, { filter: (f) => !SKIP_EXPORT.test(path.relative(m.dir, path.resolve(m.dir, f))) && !/(^|[\\/])session\.lock$/.test(f) });
  await zip.writeZipPromise(dest);
  return { file: dest, size: fs.statSync(dest).size };
}
/** A server exported from Astra (on this PC or another one) becomes a server here, with free ports. */
async function importServer(file, onStep) {
  if (!file || !fs.existsSync(file)) throw new Error('Pick the server .zip to import.');
  const zip = new AdmZip(file);
  const entry = zip.getEntries().find((e) => /(^|\/)solaris-server\.json$/.test(e.entryName) && e.entryName.split('/').length <= 2);
  if (!entry) throw new Error('That .zip isn’t a server exported from Astra (it has no solaris-server.json).');
  const prefix = entry.entryName.replace(/solaris-server\.json$/, '');
  const data = JSON.parse(entry.getData().toString('utf8'));
  if (!SOFTWARE[data.software]) throw new Error('This server was made with a newer Astra. Update Astra first.');
  let id = slugify(data.name || 'imported-server') || 'server';
  while (index().some((e) => e.id === id)) id += '-2';
  const dir = path.join(root(), id);
  fs.mkdirSync(dir, { recursive: true });
  onStep && onStep('Unpacking the server');
  for (const e of zip.getEntries()) {
    if (!e.entryName.startsWith(prefix) || e.isDirectory) continue;
    const rel = e.entryName.slice(prefix.length);
    if (!rel || rel.split('/').includes('..')) continue;
    const out = path.join(dir, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, e.getData());
  }
  if (data.software === 'bedrock' && process.platform !== 'win32') { try { fs.chmodSync(path.join(dir, 'bedrock_server'), 0o755); } catch {} }
  const bds = data.software === 'bedrock';
  const used = new Set(list().flatMap((s) => [s.port, s.port + 1]));
  let port = data.port || (bds ? 19132 : 25565); while (used.has(port) || used.has(port + 1)) port += bds ? 2 : 1;
  const m = { ...data, id, dir, port, created: Date.now(), autoStart: false };
  // tunnels, Java and the game instance belong to the other PC: made again here
  for (const k of ['playitTunnelId', 'playitAddress', 'playitSetupError', 'playInstance', 'javaPath', 'playitStopped']) delete m[k];
  if (m.voice) m.voice = { ...m.voice, tunnelId: null, address: null };
  if (m.bedrock) m.bedrock = { ...m.bedrock, tunnelId: null, address: null };
  if (m.pack) m.pack = { ...m.pack, tunnelId: null, address: null };
  writeJSON(indexFile(), [...index(), { id, dir }]);
  save(m);
  writeProps(id, bds ? { 'server-port': port, 'server-portv6': port + 1 } : { 'server-port': port });
  return get(id);
}
/** Worlds tab → Import world: a world folder or .zip (singleplayer, another host); Bedrock also takes .mcworld. */
async function importWorld(id, src) {
  const m = meta(id), rootDir = worldRoot(m);
  if (running.has(id)) throw new Error('Stop the server first.');
  if (!src || !fs.existsSync(src)) throw new Error('Pick the world to import.');
  fs.mkdirSync(rootDir, { recursive: true });
  const unique = (base) => { let n = String(base).replace(/[^\w .-]/g, '').trim().slice(0, 40) || 'imported'; let x = n, i = 2; while (fs.existsSync(path.join(rootDir, x))) x = `${n}-${i++}`; return x; };
  if (fs.statSync(src).isDirectory()) {
    if (!fs.existsSync(path.join(src, 'level.dat'))) throw new Error('That folder isn’t a Minecraft world (it has no level.dat).');
    const name = unique(path.basename(src));
    await fs.promises.cp(src, path.join(rootDir, name), { recursive: true, filter: (f) => !/(^|[\\/])session\.lock$/.test(f) });
    return { name, worlds: worlds(id) };
  }
  if (!/\.(zip|mcworld)$/i.test(src)) throw new Error('Pick a world folder, or a .zip / .mcworld file.');
  const zip = new AdmZip(src);
  const lvl = zip.getEntries().filter((e) => /(^|\/)level\.dat$/.test(e.entryName)).sort((a, b) => a.entryName.length - b.entryName.length)[0];
  if (!lvl) throw new Error('That file doesn’t contain a Minecraft world (no level.dat inside).');
  const prefix = lvl.entryName.replace(/level\.dat$/, '');
  const name = unique(prefix ? prefix.replace(/\/$/, '').split('/').pop() : path.basename(src).replace(/\.(zip|mcworld)$/i, ''));
  const out = path.join(rootDir, name);
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !e.entryName.startsWith(prefix)) continue;
    const rel = e.entryName.slice(prefix.length);
    if (!rel || rel.split('/').includes('..')) continue;
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
    fs.writeFileSync(path.join(out, rel), e.getData());
  }
  return { name, worlds: worlds(id) };
}

// ---------- copy / delete ----------
/** Settings → Copy server: a full copy of the folder (without backups) as a new server with its own port. */
async function copyServer(id, onStep) {
  const m = meta(id);
  if (running.has(id)) throw new Error('Stop the server first, so the world is copied in one piece.');
  let nid = slugify(m.name + '-copy') || 'server-copy';
  while (index().some((e) => e.id === nid)) nid += '-2';
  const dir = path.join(root(), nid);
  onStep && onStep('Copying the server files');
  await fs.promises.cp(m.dir, dir, { recursive: true, filter: (src) => { const rel = path.relative(m.dir, src); return !/^(backups|logs|crash-reports)([\\/]|$)/.test(rel) && !/\.solaris-pid$/.test(rel); } });
  const used = new Set(list().map((s) => s.port));
  let port = m.port + (isBds(m) ? 2 : 1); while (used.has(port) || used.has(port + 1)) port += isBds(m) ? 2 : 1;
  const copy = { ...m, id: nid, dir, name: `${m.name} (copy)`.slice(0, 40), port, created: Date.now(), autoStart: false };
  for (const k of ['playitTunnelId', 'playitAddress', 'playitSetupError', 'playInstance', 'lastAutoBackup', 'tasks']) delete copy[k];
  if (copy.voice) copy.voice = { ...copy.voice, port: port + 10, tunnelId: null, address: null, manualAddress: null };
  if (copy.bedrock) copy.bedrock = { ...copy.bedrock, port: port + 20, tunnelId: null, address: null };
  if (copy.pack?.type === 'file') copy.pack = { ...copy.pack, port: port + 100, tunnelId: null, address: null };
  writeJSON(indexFile(), [...index(), { id: nid, dir }]);
  save(copy);
  writeProps(nid, isBds(copy) ? { 'server-port': port, 'server-portv6': port + 1 } : { 'server-port': port });
  try { writeVoiceConfig(copy); } catch {}
  try { writeBedrockConfig(copy); } catch {}
  return get(nid);
}
// ---------- settings that change on a running server (no restart) ----------
// Minecraft 1.21.9 moved PvP, monsters and the Nether from server.properties to game rules (camelCase names);
// 26.x renamed them to snake_case. Both names are tried; the one the server knows wins.
const RULES = {
  pvp: ['pvp'],
  'spawn-monsters': ['spawn_monsters', 'spawnMonsters'],
  'allow-nether': ['allow_entering_nether_using_portals', 'allowEnteringNetherUsingPortals'],
};
/** true: this server keeps PvP/monsters/Nether as game rules; false: in server.properties; null: never started, can't tell yet. */
function usesRules(id) {
  try { const m = meta(id); if (isBds(m)) return false; } catch { return null; }
  const P = readProps(id);
  if (Object.keys(P).length <= 3) return null;
  return !('pvp' in P);
}
const refused = (lines) => lines.some((l) => /Incorrect argument|Unknown or incomplete command|Unknown command|Unknown game ?rule|<--\[HERE\]/i.test(l));
/** Set a game rule on a running server, trying each name the versions use. true when the server took it. */
async function setRule(id, prop, value) {
  for (const name of RULES[prop] || []) {
    const wait = waitForLines(id, (l, got) => refused(got) || new RegExp(`Game ?rule ${name} is now set|Gamerule ${name} is now set`, 'i').test(l), 2500);
    command(id, `gamerule ${name} ${value === 'true' ? 'true' : 'false'}`);
    if (!refused(await wait)) return true;
  }
  return false;
}
/** Game rules picked in Astra for servers that use them: applied when the server is online (every start). */
async function applyRules(id) {
  let m; try { m = meta(id); } catch { return; }
  if (!m.gamerules || usesRules(id) === false) return;
  for (const [prop, v] of Object.entries(m.gamerules)) await setRule(id, prop, v).catch(() => {});
}
/**
 * Changes the running server picks up straight away, by command. Returns what applied live and what still needs a restart.
 * `changed` = the server.properties keys whose value really changed.
 */
async function applyLive(id, changed) {
  const r = running.get(id), m = meta(id);
  const live = [], restart = [];
  if (!r?.proc || r.state !== 'online') return { live, restart: [], offline: true };
  const bds = isBds(m);
  for (const [k, v] of Object.entries(changed)) {
    try {
      if (k === 'difficulty') { command(id, `difficulty ${v}`); live.push(k); }
      else if (k === 'gamemode' && !bds) { command(id, `defaultgamemode ${v}`); live.push(k); }
      else if ((k === 'white-list' || k === 'allow-list') && !bds) { command(id, `whitelist ${v === 'true' ? 'on' : 'off'}`); live.push(k); }
      else if (k === 'enforce-whitelist') { /* goes with the whitelist switch */ }
      else if (k === 'player-idle-timeout' && !bds) { command(id, `setidletimeout ${Number(v) || 0}`); live.push(k); }
      else if (k === 'pvp' && bds) { command(id, `gamerule pvp ${v === 'true'}`); live.push(k); }
      else if (RULES[k] && usesRules(id) !== false && (await setRule(id, k, v))) live.push(k);
      else restart.push(k);
    } catch { restart.push(k); }
  }
  return { live, restart };
}
/** Save settings, and change on the running server whatever can change without a restart. */
async function saveSettings(id, patch) {
  const before = readProps(id);
  const m = meta(id);
  // PvP / monsters / Nether on servers that made them game rules: remembered by Astra, set by command
  const ruleChanges = {};
  if (patch.props) {
    const rules = usesRules(id);
    for (const k of Object.keys(RULES)) {
      if (!(k in patch.props) || rules === false) continue;
      const v = String(patch.props[k]), old = m.gamerules?.[k] ?? 'true';
      m.gamerules = { ...(m.gamerules || {}), [k]: v };
      if (rules === true && before[k] === undefined) { delete patch.props[k]; if (v !== old) ruleChanges[k] = v; }
    }
    if (m.gamerules) save(m);
  }
  const settings = setSettings(id, patch);
  const changed = { ...ruleChanges };
  for (const [k, v] of Object.entries(patch.props || {})) if (String(before[k] ?? '') !== String(v)) changed[k] = String(v);
  if (patch.memory && patch.memory !== m.memory) changed.memory = String(patch.memory);
  const res = await applyLive(id, changed);
  if (!res.offline && res.live.length) log(id, `[Astra] Changed now, no restart needed: ${res.live.join(', ')}.`);
  return { ...settings, applied: res };
}
function setSettings(id, patch) {
  const m = meta(id);
  if (patch.props) {
    let props = {};
    for (const [k, v] of Object.entries(patch.props)) { if (!/^[a-z0-9.-]+$/i.test(k)) continue; props[k] = String(v).replace(/[\r\n]/g, ' ').slice(0, 300); }
    if (props['server-port']) { const p = Number(props['server-port']); if (!(p >= 1024 && p <= 65535)) throw new Error('Port must be between 1024 and 65535.'); if (list().some((s) => s.id !== id && s.port === p)) throw new Error(`Another Astra server uses port ${p}.`); if (p !== m.port) delete m.playitAddress; m.port = p; }
    if (props['max-players']) m.maxPlayers = Number(props['max-players']) || m.maxPlayers;
    if (isBds(m)) { props = bdsProps(props); if (props['server-port']) props['server-portv6'] = m.port + 1; }
    const wasOnline = readProps(id)['online-mode'] !== 'false';
    writeProps(id, props);
    if ('online-mode' in props && wasOnline !== (props['online-mode'] !== 'false')) convertPeople(id, props['online-mode'] !== 'false').catch(() => {});
  }
  if (patch.memory) m.memory = clampMem(patch.memory);
  if ('javaPath' in patch) {
    const j = String(patch.javaPath || '').trim();
    if (j && !fs.existsSync(j)) throw new Error('That Java file doesn’t exist.');
    if (j) m.javaPath = j; else delete m.javaPath;
  }
  if ('jvmArgs' in patch) { const a = splitArgs(patch.jvmArgs).join(' '); if (a) m.jvmArgs = a; else delete m.jvmArgs; }
  if ('aikar' in patch) m.aikar = !!patch.aikar;
  if ('restartOnCrash' in patch) m.restartOnCrash = !!patch.restartOnCrash;
  if (patch.name) m.name = String(patch.name).slice(0, 40);
  if ('tunnelName' in patch) { const tn = String(patch.tunnelName || '').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 40); if (tn) m.tunnelName = tn; else delete m.tunnelName; }
  save(m);
  emit(id); // the page header and cards show the new name right away
  return getSettings(id);
}
async function remove(id) {
  if (running.has(id)) throw new Error('Stop the server first.');
  const dir = dirOf(id);
  // its playit.gg tunnels go too (free accounts only have a few)
  try {
    const m = meta(id), pl = require('./playit');
    const others = list().filter((x) => x.id !== id);
    for (const t of [m.playitTunnelId, m.voice?.tunnelId, m.bedrock?.tunnelId, m.pack?.tunnelId]) {
      if (t && !others.some((o) => [o.playitTunnelId, o.voice?.tunnelId, o.bedrock?.tunnelId, o.pack?.tunnelId].includes(t))) await pl.deleteTunnel(t);
    }
  } catch {}
  // Deleted for good, like instances. Only folders that really are Astra servers are removed.
  if (fs.existsSync(path.join(dir, 'solaris-server.json'))) await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  writeJSON(indexFile(), index().filter((x) => x.id !== id));
  return list();
}
function openFolder(id, sub = '') { const p = path.join(dirOf(id), sub); fs.mkdirSync(p, { recursive: true }); return shell.openPath(p); }

// ---------- worlds ----------
function worlds(id) {
  const dir = worldRoot(meta(id)), active = readProps(id)['level-name'] || 'world';
  if (!fs.existsSync(dir)) return [];
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
  const dir = worldRoot(meta(id)), w = path.resolve(dir, name);
  if (path.dirname(w) !== path.resolve(dir) || !fs.existsSync(path.join(w, 'level.dat'))) throw new Error('Not a world folder');
  await fs.promises.rm(w, { recursive: true, force: true });
  for (const extra of ['_nether', '_the_end']) { const e = w + extra; if (fs.existsSync(path.join(e, 'level.dat'))) await fs.promises.rm(e, { recursive: true, force: true }); }
  return worlds(id);
}

// ---------- whitelist / operators ----------
const listFile = (id, kind) => { const m = meta(id); return path.join(m.dir, isBds(m) ? (kind === 'ops' ? 'permissions.json' : 'allowlist.json') : kind === 'ops' ? 'ops.json' : 'whitelist.json'); };
function people(id, kind) { const l = readJSON(listFile(id, kind), []); return Array.isArray(l) ? l.filter((p) => p && p.name) : []; } // Bedrock operators are stored by Xbox ID only
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
  if (isBds(meta(id))) {
    // Bedrock: Xbox gamertags (spaces allowed). Operators need the player online (the server stores them by Xbox ID).
    const n = String(name || '').trim().replace(/"/g, '');
    if (!/^[A-Za-z0-9_ ]{1,20}$/.test(n)) throw new Error('Type the player’s Xbox gamertag.');
    const r = running.get(id);
    if (kind === 'ops') {
      if (!r?.proc) throw new Error('Start the server first — Bedrock operators are added while the server runs.');
      command(id, `op "${n}"`); return people(id, kind);
    }
    writeJSON(listFile(id, kind), [...people(id, kind).filter((p) => p.name.toLowerCase() !== n.toLowerCase()), { name: n, ignoresPlayerLimit: false }]);
    if (r?.proc) command(id, 'allowlist reload');
    return people(id, kind);
  }
  const p = await playerId(id, name);
  const r = running.get(id);
  // Astra writes the list itself (with the right UUID for this server's mode), then a running server reloads it.
  const l = people(id, kind).filter((x) => x.uuid !== p.uuid && x.name.toLowerCase() !== p.name.toLowerCase());
  l.push(kind === 'ops' ? { uuid: p.uuid, name: p.name, level: 4, bypassesPlayerLimit: false } : { uuid: p.uuid, name: p.name });
  writeJSON(listFile(id, kind), l);
  if (r?.proc) {
    if (kind === 'ops') {
      // there's no "op reload": a player who is online gets op right away, everyone else from the next start
      if ([...r.players].some((x) => x.toLowerCase() === p.name.toLowerCase())) command(id, `op ${p.name}`);
      else log(id, `[Astra] ${p.name} becomes an operator the next time the server starts (or use “op ${p.name}” once they are online).`);
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
  if (isBds(meta(id))) {
    if (kind === 'ops') { if (r?.proc) command(id, `deop "${name}"`); return people(id, kind); }
    if (r?.proc) command(id, `allowlist remove "${name}"`);
    writeJSON(listFile(id, kind), people(id, kind).filter((p) => p.name.toLowerCase() !== lower));
    return people(id, kind);
  }
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
  const m = meta(id), dir = dirOf(id), live = running.get(id)?.proc && running.get(id).state === 'online', bds = isBds(m);
  // Paper/Purpur keep world_nether / world_the_end as worlds of their own: list every folder once.
  const ws = bds ? worlds(id).map((w) => 'worlds/' + w.name) : [...new Set(worlds(id).map((w) => w.name).flatMap((n) => [n, n + '_nether', n + '_the_end']))].filter((n) => fs.existsSync(path.join(dir, n)));
  if (!ws.length) throw new Error('There’s no world to back up yet — start the server once first.');
  if (live) { if (bds) command(id, 'save hold'); else { command(id, 'save-off'); command(id, 'save-all flush'); } await new Promise((r) => setTimeout(r, 4000)); }
  try {
    const zip = new AdmZip();
    // session.lock is held open by a running server (and isn't world data) — leave it out.
    for (const w of ws) await zip.addLocalFolderPromise(path.join(dir, w), { zipPath: w, filter: (f) => !/(^|[\\/])session\.lock$/.test(f) });
    for (const f of ['server.properties', 'whitelist.json', 'ops.json', 'allowlist.json', 'permissions.json']) if (fs.existsSync(path.join(dir, f))) zip.addLocalFile(path.join(dir, f));
    fs.mkdirSync(backupsDir(id), { recursive: true });
    const name = `${prefix === 'auto' ? 'auto' : 'backup'}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`;
    await zip.writeZipPromise(path.join(backupsDir(id), name));
    try { require('./eco/notify').add({ category: 'backup', title: `${m.name}: backup saved`, body: `${name} (${Math.round(fs.statSync(path.join(backupsDir(id), name)).size / 1048576)} MB)`, key: `hosted-backup:${id}:${name}`, toast: prefix === 'auto', desktop: prefix === 'auto' }); } catch {}
    return backups(id);
  } finally { if (live && running.has(id)) command(id, bds ? 'save resume' : 'save-on'); }
}
async function restore(id, file) {
  if (running.has(id)) throw new Error('Stop the server first.');
  const dir = dirOf(id), zipPath = path.join(backupsDir(id), path.basename(file));
  const zip = new AdmZip(zipPath);
  const tops = [...new Set(zip.getEntries().map((e) => { const p = e.entryName.split('/'); return p[0] === 'worlds' && p[1] ? 'worlds/' + p[1] : p[0]; }))].filter((t) => t && !t.includes('..'));
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
const loadersFor = (m) => (m.software === 'paper' ? ['paper', 'spigot', 'bukkit'] : m.software === 'purpur' ? ['purpur', 'paper', 'spigot', 'bukkit'] : m.software === 'quilt' ? ['quilt', 'fabric'] : [m.software]);
async function searchContent(id, query = '', offset = 0, source = 'modrinth') {
  const m = meta(id);
  if (SOFTWARE[m.software].kind !== 'none' && source === 'curseforge') return searchContentCf(m, query, offset);
  if (SOFTWARE[m.software].kind === 'none') throw new Error(`${SOFTWARE[m.software].name} servers can’t run mods or plugins. Create a Paper, Purpur, Fabric, Quilt, Forge or NeoForge server.`);
  const kind = SOFTWARE[m.software].kind === 'plugins' ? 'plugin' : 'mod';
  const facets = [[`project_type:${kind}`], loadersFor(m).map((l) => `categories:${l}`), [`versions:${m.mc}`], ['server_side:required', 'server_side:optional']];
  const r = await getJSON(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(JSON.stringify(facets))}&limit=20&offset=${offset}&index=${query ? 'relevance' : 'downloads'}`);
  const have = installedContent(id).map((x) => x.projectId).filter(Boolean);
  return { total: r.total_hits, hits: r.hits.map((h) => ({ id: h.project_id, slug: h.slug, title: h.title, description: h.description, icon: h.icon_url, downloads: h.downloads, author: h.author, installed: have.includes(h.project_id) })) };
}
/** Client mods → search: game-side mods for the players' instance (minimaps, shaders support…). */
async function searchClientMods(id, query = '') {
  const m = meta(id), loader = SOFTWARE[m.software].kind === 'mods' ? m.software : 'fabric';
  if (isBds(m)) throw new Error('Bedrock players can’t use Java mods.');
  const facets = [['project_type:mod'], (loader === 'quilt' ? ['quilt', 'fabric'] : [loader]).map((l) => `categories:${l}`), [`versions:${m.mc}`], ['client_side:required', 'client_side:optional']];
  const r = await getJSON(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(JSON.stringify(facets))}&limit=20&index=${query ? 'relevance' : 'downloads'}`);
  const have = (m.clientMods || []).map((x) => x.id);
  return r.hits.map((h) => ({ id: h.project_id, title: h.title, description: h.description, icon: h.icon_url, added: have.includes(h.project_id) }));
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
  if (String(projectId).startsWith('cf:')) return installContentCf(m, projectId, versionId, quiet, seen);
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
  // Extras Astra adds by itself (quiet) give way to the copy that's already there; a mod the player picks
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
      try { fs.renameSync(path.join(dir, old.f), path.join(dir, old.f + '.disabled')); log(id, `[Astra] ${modId} was installed twice — using ${list[0].f}, turned off ${old.f}.`); } catch {}
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
  if (/^solaris-client/i.test(path.basename(file))) return 'the Astra client mod only runs in the game';
  if (info.clientOnly) return 'it only works in the game client, not on servers';
  if (!info.loader) return null;
  if (kind === 'plugins') return info.loader === 'plugin' ? null : `it’s a ${info.loader} mod, and this is a plugin server`;
  if (info.loader === 'plugin') return 'it’s a plugin, and this is a mod server';
  const ok = { fabric: ['fabric'], quilt: ['quilt', 'fabric'], forge: ['forge'], neoforge: ['neoforge', 'forge'] }[m.software] || [];
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
  const ok = m.software === 'quilt' ? ['quilt', 'fabric'] : [m.software];
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
// ---------- CurseForge for hosted servers ----------
// CurseForge results carry ids like "cf:238222" (mods/plugins) and modpack versions like "cf:<modId>:<fileId>", so
// the rest of hosting (installed marks, setup codes, the content list) works the same for both sources.
// CurseForge doesn't say which mods are client-only, so every jar is checked after download (wontRun) and removed
// if it can't run on a server.
const cfLoader = (m) => (m.software === 'quilt' ? 'fabric' : m.software); // Quilt runs Fabric mods; few are tagged Quilt
async function searchContentCf(m, query = '', offset = 0) {
  const cfm = require('./curseforge');
  const plugins = SOFTWARE[m.software].kind === 'plugins';
  const r = await cfm.search({ query, type: plugins ? 'plugin' : 'mod', gameVersion: plugins ? undefined : m.mc, loader: plugins ? undefined : cfLoader(m), sort: query ? 'relevance' : 'downloads', offset, limit: 20 });
  const have = new Set(Object.keys(readJSON(recordFile(m), {})));
  return { total: r.total_hits, source: 'curseforge', hits: r.hits.map((h) => ({ id: 'cf:' + h.project_id, slug: h.slug, title: h.title, description: h.description, icon: h.icon_url, downloads: h.downloads, author: h.author, installed: have.has('cf:' + h.project_id) })) };
}
async function installContentCf(m, modId, fileId = null, quiet = false, seen = new Set()) {
  const cfm = require('./curseforge');
  modId = String(modId).replace(/^cf:/, '');
  if (seen.has('cf:' + modId)) return [];
  seen.add('cf:' + modId);
  const plugins = SOFTWARE[m.software].kind === 'plugins';
  const mod = (await cfm.request(`/mods/${modId}`)).data;
  if (mod.classId === 4471) throw new Error(`${mod.name} is a modpack — pick it when you create a server (Server type → Modpack).`);
  const f = fileId ? (await cfm.request(`/mods/${modId}/files/${fileId}`)).data : await cfm.serverFile(modId, plugins ? {} : { mc: m.mc, loader: cfLoader(m) });
  if (!f) { if (quiet) return []; throw new Error(`${mod.name} has no file for ${SOFTWARE[m.software].name} ${m.mc} on CurseForge.`); }
  let url; try { url = cfm.urlOf(f, mod); } catch (e) { if (quiet) return []; throw e; }
  const dir = contentDir(m); fs.mkdirSync(dir, { recursive: true });
  const name = cfm.safeName(f.fileName), dest = path.join(dir, name);
  const rec = readJSON(recordFile(m), {});
  const key = 'cf:' + modId;
  if (rec[key]?.file && rec[key].file !== name) fs.rmSync(path.join(dir, rec[key].file), { force: true });
  await download(url, dest, { sha1: cfm.sha1Of(f) });
  const why = wontRun(m, dest);
  if (why) { fs.rmSync(dest, { force: true }); if (quiet) return []; throw new Error(`${mod.name}: ${why}.`); }
  const dupes = sameModFiles(dir, dest);
  if (dupes.length && quiet) { fs.rmSync(dest, { force: true }); return []; }
  for (const d of dupes) fs.rmSync(path.join(dir, d), { force: true });
  rec[key] = { file: name, version: f.displayName || '', title: mod.name, source: 'curseforge' };
  writeJSON(recordFile(m), rec);
  const out = [mod.name];
  for (const d of f.dependencies || []) if (d.relationType === 3 && d.modId) out.push(...(await installContentCf(m, d.modId, null, true, seen).catch(() => [])));
  return out;
}
/** CurseForge modpacks for the create dialog: { id: 'cf:<modId>', … } */
async function searchModpacksCf(query, software, mc) {
  const r = await require('./curseforge').search({ query, type: 'modpack', gameVersion: mc, loader: software === 'quilt' ? 'quilt' : software, sort: query ? 'relevance' : 'downloads', limit: 12 });
  return r.hits.map((h) => ({ id: 'cf:' + h.project_id, title: h.title, icon: h.icon_url, downloads: h.downloads, description: h.description, source: 'curseforge' }));
}
async function modpackVersionsCf(projectId, software, mc) {
  const cfm = require('./curseforge'), modId = String(projectId).replace(/^cf:/, '');
  const q = new URLSearchParams({ pageSize: '50', gameVersion: mc });
  if (cfm.LOADER[software]) q.set('modLoaderType', String(cfm.LOADER[software]));
  const list = ((await cfm.request(`/mods/${modId}/files?${q}`)).data || []).filter((f) => !f.isServerPack);
  const rank = { 1: 0, 2: 1, 3: 2 };
  return list.sort((a, b) => (rank[a.releaseType] - rank[b.releaseType]) || (b.id - a.id)).map((f) => ({ id: `cf:${modId}:${f.id}`, name: f.displayName, number: f.displayName, type: f.releaseType === 1 ? 'release' : f.releaseType === 2 ? 'beta' : 'alpha' }));
}
/** CurseForge modpack server install: the pack's server-capable mods + overrides. Files the author keeps website-only are listed. */
async function installModpackCf(m, versionId, onStep) {
  const cfm = require('./curseforge');
  const [, modId, fileId] = String(versionId).split(':');
  const mod = (await cfm.request(`/mods/${modId}`)).data, f = (await cfm.request(`/mods/${modId}/files/${fileId}`)).data;
  const tmp = path.join(m.dir, '.modpack.zip');
  await download(cfm.urlOf(f, mod), tmp, { sha1: cfm.sha1Of(f) });
  const { zip, man, over, overrides, info } = cfm.readPack(tmp);
  const required = (man.files || []).filter((x) => x && x.required !== false).map((x) => ({ projectID: +x.projectID, fileID: +x.fileID }));
  const { meta: files, mods } = required.length ? await cfm.resolveFiles(required) : { meta: [], mods: {} };
  const dir = contentDir(m); fs.mkdirSync(dir, { recursive: true });
  const rec = readJSON(recordFile(m), {});
  const manual = [], clientOnly = [];
  const jars = files.filter((x) => (mods[x.modId]?.classId || 6) === 6); // resource packs / shaders are for the players' game
  let n = 0;
  for (const x of jars) {
    onStep && onStep(`Modpack files ${++n}/${jars.length}`);
    const pm = mods[x.modId];
    if (!x.downloadUrl) { manual.push({ name: pm?.name || x.fileName, page: cfm.pageOf(x, pm) }); continue; }
    const name = cfm.safeName(x.fileName), dest = path.join(dir, name);
    await download(x.downloadUrl, dest, { sha1: cfm.sha1Of(x) });
    if (wontRun(m, dest)) { fs.rmSync(dest, { force: true }); clientOnly.push(pm?.name || name); continue; }
    rec['cf:' + x.modId] = { file: name, version: x.displayName || '', title: pm?.name || name, source: 'curseforge', pack: true };
  }
  writeJSON(recordFile(m), rec);
  cfm.copyOverrides(zip, over, overrides, m.dir);
  fs.rmSync(tmp, { force: true });
  m.modpack = { versionId, name: info.name, version: info.version, source: 'curseforge', ...(manual.length ? { manual } : {}) };
  if (clientOnly.length) onStep && onStep(`Left out ${clientOnly.length} game-only mod${clientOnly.length === 1 ? '' : 's'} (the server doesn’t need them)`);
  if (manual.length) onStep && onStep(`${manual.length} mod${manual.length === 1 ? '' : 's'} must be downloaded from the CurseForge website: ${manual.map((x) => x.name).join(', ')}`);
}

/** Modrinth modpack (.mrpack) server install: server-side files + overrides + server-overrides. */
async function installModpack(m, { versionId }, onStep) {
  if (String(versionId).startsWith('cf:')) return installModpackCf(m, versionId, onStep);
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
  if (String(projectId).startsWith('cf:')) return modpackVersionsCf(projectId, software, mc);
  const vs = await getJSON(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version?loaders=${encodeURIComponent(JSON.stringify([software]))}&game_versions=${encodeURIComponent(JSON.stringify([mc]))}`);
  // stable releases first (a server shouldn't get a beta or alpha unless that's all there is)
  const rank = { release: 0, beta: 1, alpha: 2 };
  return vs.slice().sort((a, b) => (rank[a.version_type] ?? 3) - (rank[b.version_type] ?? 3)).map((v) => ({ id: v.id, name: v.name, number: v.version_number, type: v.version_type }));
}

module.exports = {
  SOFTWARE, list, get, create, start, stop, restart, stopAll, anyRunning, command, logs, getSettings, setSettings, saveSettings, applyLive, setTunnel, remove, openFolder,
  softwareVersions, worlds, setActiveWorld, deleteWorld, people, addPerson, removePerson, backups, backup, restore, deleteBackup,
  logFiles, readLog, searchContent, installedContent, installContent: (id, pid, vid) => installContent(id, pid, vid), removeContent, toggleContent, searchModpacksCf, modSources, instanceMods, copyFromInstance, addContentFiles, modpackVersions,
  tunnelStop, tunnelStart, tunnelRestart,
  setVoice, setVoiceAddress, setBedrock, onlinePlayers, movePlayerData, allowOffline, diagnose, applyFix, pregen, lagCheck, setDiscord, testDiscord, makeInstance, setupCode, readSetupCode, joinCode, readJoinCode, setSchedule, setAutoStart, autoStartAll, bans, pardon,
  knownPlayers, tasks, saveTask, deleteTask, runTaskNow: async (id, taskId) => { const t = tasks(id).find((x) => x.id === taskId); if (!t) throw new Error('Task not found'); if (t.action !== 'start' && running.get(id)?.state !== 'online') throw new Error('Start the server first.'); await runTask(id, t); return tasks(id); },
  hooks, patchMeta, setYaml, contentDir: (id) => contentDir(meta(id)), isRunning: (id) => running.get(id)?.state || null, logLine: (id, l) => log(id, l),
  perf, setPack, copyServer, exportServer, importServer, importWorld, clientMods, addClientMod, removeClientMod, searchClientMods, taskDue, cleanTask,
};

// Astra Connect add-ons that hook into hosting (their own files)
try { require('./connect/webmap').register(hooks); } catch (e) { console.error('Web map hooks:', e.message); }
