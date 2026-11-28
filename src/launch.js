// Prepares files and launches Minecraft. Supports multiple running instances.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { Notification } = require('electron');
const { paths, push, events, downloadAll, download } = require('./util');
const settings = require('./settings');
const versions = require('./versions');
const java = require('./java');
const loaders = require('./loaders');
const instances = require('./instances');
const accounts = require('./accounts');
const crash = require('./crash');
const discord = require('./discord');
const modrinth = require('./modrinth');

const running = new Map(); // runId -> { proc, instanceId, start, lines, logFile }
const history = []; // finished runs (for the console)

/** "KEY=value" lines (instance ones replace the defaults entirely). */
function parseEnv(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
/** The launch hooks for an instance: its own (when turned on), else the defaults from Settings. */
function hooksFor(inst, s) {
  const own = inst.hooks && inst.hooks.enabled ? inst.hooks : {};
  const pick = (k, d) => String(own[k] || d || '').trim();
  return { pre: pick('pre', s.hookPre), wrapper: pick('wrapper', s.hookWrapper), post: pick('post', s.hookPost) };
}
/** Runs a hook command in the shell (pre-launch waits for it, post-exit doesn't). */
function runHook(cmd, env, cwd, wait) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, { shell: true, cwd, env, windowsHide: true, detached: !wait, stdio: wait ? 'pipe' : 'ignore' });
    if (!wait) { p.on('error', () => {}); p.unref(); return resolve(0); }
    let out = '';
    p.stdout.on('data', (d) => { out += d; if (out.length > 4000) out = out.slice(-4000); });
    p.stderr.on('data', (d) => { out += d; if (out.length > 4000) out = out.slice(-4000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(0) : reject(new Error(`Pre-launch command failed (exit code ${code})${out.trim() ? ': ' + out.trim().split(/\r?\n/).pop().slice(0, 200) : ''}`))));
  });
}
/** Splits a wrapper command like `prime-run` or `"C:\\x y\\wrap.exe" --flag` into program + arguments. */
function splitCmd(cmd) {
  const parts = []; const re = /"([^"]*)"|'([^']*)'|(\S+)/g; let m;
  while ((m = re.exec(cmd))) parts.push(m[1] ?? m[2] ?? m[3]);
  return parts;
}
function cleanEnv() {
  const e = { ...process.env }; delete e.JAVA_TOOL_OPTIONS; delete e._JAVA_OPTIONS;
  if (process.platform === 'linux') {
    // Astra's own AppImage/Electron variables must not leak into Java (they can load the wrong libraries).
    for (const k of ['LD_PRELOAD', 'ELECTRON_RUN_AS_NODE', 'CHROME_DESKTOP', 'GDK_BACKEND']) delete e[k];
    // The AppImage puts its own folder (with Electron's libEGL/libvulkan) on LD_LIBRARY_PATH; the game must use the system's.
    if (e.APPDIR && e.LD_LIBRARY_PATH) {
      e.LD_LIBRARY_PATH = e.LD_LIBRARY_PATH.split(':').filter((p) => p && !p.startsWith(e.APPDIR)).join(':');
      if (!e.LD_LIBRARY_PATH) delete e.LD_LIBRARY_PATH;
    }
    if (settings.get().dedicatedGpu) {
      e.DRI_PRIME = '1'; // Mesa (AMD / Intel) offload
      if (fs.existsSync('/proc/driver/nvidia')) { e.__NV_PRIME_RENDER_OFFLOAD = '1'; e.__GLX_VENDOR_LIBRARY_NAME = 'nvidia'; e.__VK_LAYER_NV_optimus = 'NVIDIA_only'; }
    }
  }
  return e;
}
function status(instanceId, stage, progress = null, detail = '') {
  push('launch:status', { instanceId, stage, progress, detail });
}

function substitute(str, vars) {
  return str.replace(/\$\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
}
function expandArgs(list, vars, features) {
  const out = [];
  for (const a of list || []) {
    if (typeof a === 'string') { out.push(substitute(a, vars)); continue; }
    if (!versions.ruleAllows(a.rules, features)) continue;
    const vals = Array.isArray(a.value) ? a.value : [a.value];
    for (const v of vals) out.push(substitute(v, vars));
  }
  return out;
}

/**
 * Automatic Java selection: instance Java → global Java → your Java for this major version → Astra's
 * official runtime (installed on demand). A chosen Java that is too old for the version is skipped with a notice.
 */
async function resolveJava(inst, version, onProgress) {
  const s = settings.get();
  const need = version.javaVersion?.majorVersion || 8;
  for (const [p, where] of [[inst.javaPath, 'this instance'], [s.javaPath, 'Settings → Java'], [s.javaPaths?.[need], `Settings → Java (Java ${need})`]]) {
    if (!p) continue;
    if (!fs.existsSync(p)) { push('toast', { type: 'warn', text: `The Java set in ${where} no longer exists — using automatic Java.` }); continue; }
    const v = await java.javaVersionOf(p);
    const major = v ? java.majorOf(v.version) : null;
    if (major && major < need) { push('toast', { type: 'warn', text: `Minecraft ${inst.versionId} needs Java ${need}, but ${where} is Java ${major} — using automatic Java instead.` }); continue; }
    return p;
  }
  const component = version.javaVersion?.component || 'jre-legacy';
  if (s.javaAutoInstall === false) {
    const all = await java.detect();
    const found = all.find((j) => java.majorOf(j.version) === need) || all.find((j) => java.majorOf(j.version) > need && need >= 17);
    if (found) return found.path;
    if (!java.isInstalled(component)) throw new Error(`Java ${need} is needed but not installed, and automatic Java installs are off. Install it in Settings → Java.`);
  }
  try {
    return await java.ensureRuntime(component, onProgress);
  } catch (e) {
    // No Mojang Java for this computer (e.g. Linux on ARM): use a Java installed on the system if one fits.
    if (!/not available for/.test(e.message)) throw e;
    const all = await java.detect();
    const found = all.find((j) => java.majorOf(j.version) === need) || all.find((j) => java.majorOf(j.version) > need && need >= 17);
    if (found) return found.path;
    throw new Error(`Minecraft ${inst.versionId} needs Java ${need}. Install it with your system's package manager (for example: openjdk-${need}-jre), then press Play again.`);
  }
}

function setGpuPreference(javaPath) {
  if (process.platform !== 'win32' || !settings.get().dedicatedGpu) return;
  execFile('reg', ['add', 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences', '/v', javaPath, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f'], { windowsHide: true }, () => {});
}

/** Make sure the version for this instance (incl. loader) is installed; returns the launch version id. */
async function ensureVersion(inst) {
  if (inst.launchVersionId && fs.existsSync(path.join(paths.versions(), inst.launchVersionId, inst.launchVersionId + '.json'))) return inst.launchVersionId;
  const type = inst.loader?.type || 'vanilla';
  let lv = inst.loader?.version;
  if (type !== 'vanilla' && !lv) {
    status(inst.id, `Finding ${type} version`);
    const list = await loaders.listVersions(type, inst.versionId);
    if (!list.length) throw new Error(type === 'optifine' ? `Import OptiFine for Minecraft ${inst.versionId} first: download it from optifine.net, then use “Import OptiFine…” on the instance page.` : `${type} is not available for Minecraft ${inst.versionId}`);
    lv = (list.find((x) => x.recommended) || list.find((x) => x.stable) || list[0]).version;
  }
  let javaPath = null;
  if (type === 'forge' || type === 'neoforge' || type === 'optifine') {
    const base = await versions.resolveVersion(inst.versionId);
    javaPath = await resolveJava(inst, base, (d, t) => status(inst.id, 'Installing Java', d / t));
  }
  status(inst.id, `Installing ${type === 'vanilla' ? 'Minecraft' : type}`);
  const id = await loaders.install(type, inst.versionId, lv, { java: javaPath, onLog: (l) => push('game:log', { runId: 'install-' + inst.id, instanceId: inst.id, line: l }) });
  instances.save({ ...instances.get(inst.id), launchVersionId: id, loader: { type, version: lv } });
  return id;
}

/**
 * Offline accounts can't have a Mojang skin. If the player picked one in the wardrobe, hand it to the game through
 * CustomSkinLoader's local skin folder (installed from Modrinth into modded instances when missing).
 */
async function offlineSkin(inst, auth, gameDir) {
  if (auth.type !== 'offline') return;
  const acct = accounts.active();
  const skin = acct && require('./skins').offlineSkinFor(acct.id);
  if (!skin) return;
  if (!['fabric', 'quilt', 'forge', 'neoforge'].includes(inst.loader?.type)) {
    push('toast', { type: 'info', text: 'Offline skins need a modded instance (Fabric, Quilt, Forge or NeoForge) — this one shows the default skin.' });
    return;
  }
  try {
    const mods = path.join(gameDir, 'mods');
    const has = fs.existsSync(mods) && fs.readdirSync(mods).some((f) => /customskinloader/i.test(f) && f.endsWith('.jar'));
    if (!has) {
      status(inst.id, 'Adding CustomSkinLoader for your offline skin');
      await modrinth.install(inst.id, { projectId: 'customskinloader', projectType: 'mod' });
    }
    const dir = path.join(gameDir, 'CustomSkinLoader', 'LocalSkin', 'skins');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(skin.file, path.join(dir, auth.name + '.png'));
  } catch (e) { push('toast', { type: 'warn', text: 'Couldn’t set up your offline skin: ' + e.message }); }
}

/**
 * World hosting through e4mc (Astra Client "Host for friends"): e4mc prints the public address in chat when the
 * player uses Open to LAN. Astra picks it up from the game log so the player can copy or share it.
 */
const hosting = new Map(); // runId -> { address, instanceId, name, since }
/**
 * A copy of the mod loader itself in the mods folder (some modpacks ship one) makes the game load Fabric/Quilt twice
 * and crash ("loader constraint violation"). The launcher already provides the loader: such jars are turned off
 * (renamed .disabled, never deleted) with a note in the console.
 */
function stripLoaderCopies(inst, gameDir) {
  if (!['fabric', 'quilt'].includes(inst.loader?.type)) return;
  const dir = path.join(gameDir, 'mods');
  let files = []; try { files = fs.readdirSync(dir).filter((f) => /\.jar$/i.test(f)); } catch { return; }
  const AdmZip = require('adm-zip');
  for (const f of files) {
    if (!/loader|fabric|quilt/i.test(f)) continue; // only jars whose name hints at it are opened
    try {
      const zip = new AdmZip(path.join(dir, f));
      const fe = zip.getEntry('fabric.mod.json'), qe = zip.getEntry('quilt.mod.json');
      const id = fe ? JSON.parse(zip.readAsText(fe).replace(/[\u0000-\u001f]+/g, ' ')).id : qe ? JSON.parse(zip.readAsText(qe)).quilt_loader?.id : null;
      // the loader jar itself has no fabric.mod.json mod entry for "fabricloader"; it ships fabric-installer.json
      const isLoader = id === 'fabricloader' || id === 'quilt_loader' || (!fe && !qe && zip.getEntry('fabric-installer.json') && zip.getEntry('net/fabricmc/loader/impl/FabricLoaderImpl.class'));
      if (!isLoader) continue;
      fs.renameSync(path.join(dir, f), path.join(dir, f + '.disabled'));
      push('game:log', { runId: 'install-' + inst.id, instanceId: inst.id, line: `[Astra] Turned off ${f}: it is a copy of the mod loader itself — Astra already provides it, and two copies crash the game.` });
    } catch {}
  }
}

/**
 * Forge/NeoForge refuse a server whose mods differ ("mismatched mod list") and name the network channels:
 *   "Channels [mts:main] rejected their server side version number"  → the server lacks (or has another version of) mts
 *   "Channels [x:y] rejected their client side version number"        → the game lacks x
 * When the refusing server is one the player hosts with Astra, Astra fixes it (hostserver.healMismatch).
 */
function mismatchFromLog(run, line) {
  let mm;
  if ((mm = line.match(/Connecting to ([^\s,]+), (\d+)/))) { run.lastServer = { host: mm[1], port: Number(mm[2]) }; return; }
  if (!(mm = line.match(/Channels \[([^\]]*)\] rejected their (server|client) side version number/))) return;
  const g = (run.mismatch = run.mismatch || { server: new Set(), client: new Set(), timer: null });
  for (const ch of mm[1].split(',')) if (ch.trim()) g[mm[2]].add(ch.trim());
  clearTimeout(g.timer);
  g.timer = setTimeout(async () => { // the lines come in a burst: handle them together
    const server = [...g.server], client = [...g.client];
    run.mismatch = null;
    try {
      const r = await require('./hostserver').healMismatch({ ...(run.lastServer || {}), server, client, instanceId: run.instanceId });
      if (!r) return; // not one of the player's servers
      const parts = [];
      if (r.fixed.length) parts.push(`fixed the server (${r.fixed.join(', ')})`);
      if (r.addedToGame.length) parts.push(`added ${r.addedToGame.join(', ')} to your game`);
      const what = parts.length ? `Astra ${parts.join(' and ')}.` : '';
      const tail = r.notFound.length ? ` Still different: ${r.notFound.join(', ')} — put the same .jar in both.` : '';
      const next = r.restarted ? ' The server is restarting — join again in a minute.' : r.fixed.length ? ' Restart the server, then join again.' : r.addedToGame.length ? ' Restart the game, then join again.' : '';
      push('toast', { type: r.notFound.length && !parts.length ? 'warn' : 'info', text: `${r.name} refused you: the mods didn’t match. ${what}${next}${tail}` });
    } catch (e) { console.warn('[Astra] mismatch fix failed:', e.message); }
  }, 1500);
}

function hostingFromLog(line, { runId, instanceId, name }) {
  const on = line.match(/Domain assigned: ([A-Za-z0-9.-]+\.[A-Za-z]{2,})/) || (/\[CHAT\]/.test(line) && line.match(/Local game hosted on domain \[([A-Za-z0-9.-]+\.[A-Za-z]{2,})\]/));
  if (on) {
    if (hosting.get(runId)?.address === on[1]) return; // the chat line repeats the log line
    const h = { runId, instanceId, name, address: on[1], since: Date.now() };
    hosting.set(runId, h);
    push('host:online', h);
    if (Notification.isSupported()) {
      const n = new Notification({ title: 'Your world is online', body: `Friends can join at ${h.address} — click to copy` });
      n.on('click', () => { require('electron').clipboard.writeText(h.address); });
      n.show();
    }
  } else if (/Local game no longer publicly hosted/.test(line) && hosting.has(runId)) {
    hosting.delete(runId);
    push('host:offline', { runId, instanceId });
  }
}
function hostingList() { return [...hosting.values()]; }

const starting = new Set(); // instances between "Play" and the game process starting

/** Launch guard: one game per instance at a time, and failures always reach the UI (also for tray launches). */
async function launch(instanceId, opts = {}) {
  if (isRunning(instanceId)) throw new Error('This instance is already running.');
  if (starting.has(instanceId)) throw new Error('This instance is already starting.');
  starting.add(instanceId);
  try {
    return await launchInner(instanceId, opts);
  } catch (e) {
    push('launch:status', { instanceId, stage: null, error: e.message });
    throw e;
  } finally {
    starting.delete(instanceId);
  }
}

/** Save play time for games still running when Astra quits (the games themselves keep running). */
function savePlaytimeOnQuit() {
  // before-quit can fire twice (Astra waits for hosted servers, then quits again): count each game only once
  for (const r of running.values()) {
    if (r.savedOnQuit) continue;
    r.savedOnQuit = true;
    const end = Date.now();
    try { const cur = instances.get(r.instanceId); instances.save({ ...cur, playTime: (cur.playTime || 0) + (end - r.start) }); } catch {}
    // Astra Analytics: the game keeps running, but Astra stops watching it here — record the part it saw
    try { const cur = instances.get(r.instanceId); events.emit('game:session', { runId: r.runId, instanceId: r.instanceId, name: r.name, mc: cur.versionId, loader: cur.loader?.type || 'vanilla', start: r.start, end, launchMs: null, code: null, killed: false, crashed: false, crash: null, interrupted: true }); } catch {}
  }
}

async function launchInner(instanceId, opts = {}) {
  const pressedAt = Date.now(); // for Astra Analytics: how long the launch took
  let inst = instances.get(instanceId);
  const s = settings.get();
  status(instanceId, 'Signing in');
  // Signing in (a Microsoft refresh can take a few seconds) runs while the files are checked.
  const authP = accounts.getLaunchAuth({ allowStale: true });
  authP.catch(() => {}); // awaited below; this only stops an early failure being reported twice

  if (inst.solarisModules) {
    status(instanceId, 'Updating Astra modules');
    try {
      const rep = await modrinth.syncModules(instanceId, (p, slug) => status(instanceId, 'Updating Astra modules', p, slug));
      if (rep?.offline) push('toast', { type: 'info', text: 'You’re offline — playing with the Astra modules you already have.' });
    }
    catch (e) { push('toast', { type: 'warn', text: 'Could not update Astra modules: ' + e.message }); }
  }

  const versionId = await ensureVersion(inst);
  inst = instances.get(instanceId);
  status(instanceId, 'Reading version');
  const version = await versions.resolveVersion(versionId);
  fs.mkdirSync(inst.gameDir, { recursive: true });
  let gameDir = inst.gameDir;
  try { gameDir = fs.realpathSync.native(gameDir); } catch {}
  stripLoaderCopies(inst, gameDir);

  const javaPath = await resolveJava(inst, version, (d, t) => status(instanceId, 'Installing Java', d / t, `${d}/${t}`));
  setGpuPreference(javaPath);

  // Client jar — for inheriting versions, the launcher expects a copy under the child id.
  const jarId = version._jarId;
  const clientDl = version.downloads?.client;
  const baseJar = path.join(paths.versions(), jarId, jarId + '.jar');
  const tasks = [];
  // The client jar is always checked by checksum, so a damaged game jar is detected and fixed automatically.
  if (clientDl) tasks.push({ url: clientDl.url, path: baseJar, sha1: clientDl.sha1, size: clientDl.size, verify: true });
  const libs = versions.collectLibraries(version);
  tasks.push(...libs.classpath, ...libs.natives);
  status(instanceId, 'Checking assets');
  const assetInfo = await versions.assetTasks(version);
  // "Repair game files" sets a flag: verify every file by checksum once (normally only sizes are checked).
  const repairFlag = paths.file('repair.flag');
  const repairing = fs.existsSync(repairFlag);
  // Sounds and textures (thousands of files) are checked before the game only the first time; after that the check
  // runs while the game loads, so Play doesn't wait on it. Anything missing is still downloaded.
  const assetsOk = assetInfo.index ? path.join(paths.assets(), 'indexes', assetInfo.id + '.checked') : null;
  const assetsLater = !repairing && assetsOk && fs.existsSync(assetsOk) && !assetInfo.index.virtual && !assetInfo.index.map_to_resources;
  if (!assetsLater) tasks.push(...assetInfo.tasks);
  if (repairing) for (const t of tasks) t.verify = true;
  await downloadAll(tasks, { concurrency: s.concurrency || 16, onProgress: (d, t) => { if (d % 20 === 0 || d === t) status(instanceId, repairing ? 'Verifying game files' : 'Downloading game files', d / t, `${d}/${t}`); } });
  if (repairing) { try { fs.unlinkSync(repairFlag); } catch {} }
  if (assetsOk && !assetsLater) { try { fs.writeFileSync(assetsOk, new Date().toISOString()); } catch {} }

  let clientJar = baseJar;
  if (version.id !== jarId) {
    clientJar = path.join(paths.versions(), version.id, version.id + '.jar');
    if (!fs.existsSync(clientJar) || fs.statSync(clientJar).size !== fs.statSync(baseJar).size) fs.copyFileSync(baseJar, clientJar);
  }

  status(instanceId, 'Signing in');
  const auth = await authP;
  await offlineSkin(inst, auth, gameDir);

  status(instanceId, 'Preparing');
  const nativesDir = path.join(paths.natives(), version.id);
  versions.extractNatives(libs.natives, nativesDir);
  const assetsRoot = versions.prepareLegacyAssets(assetInfo, gameDir);

  const sep = process.platform === 'win32' ? ';' : ':';
  // Every path the game gets is its REAL location. If Windows redirected some files (Astra started from inside another
  // app's sandbox — see sandbox.js), Java reports the redirected place for them; Fabric then sees its own jars at two
  // paths, loads them twice and stops with "loader constraint violation … previously loaded by 'app'".
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return p; } };
  const classpath = [...libs.classpath.map((l) => real(l.path)), real(clientJar)].join(sep);
  const res = inst.resolution || s.resolution || {};
  const features = { is_demo_user: false, has_custom_resolution: !!(res.width && res.height) };
  const vars = {
    auth_player_name: auth.name, version_name: version.id, game_directory: gameDir, assets_root: assetsRoot, game_assets: assetsRoot,
    assets_index_name: assetInfo.id, auth_uuid: auth.uuid, auth_access_token: auth.accessToken, auth_session: auth.accessToken,
    clientid: '', auth_xuid: auth.xuid, user_type: auth.userType, version_type: version.type || 'release', user_properties: '{}',
    natives_directory: nativesDir, launcher_name: 'Astra', launcher_version: '1.0.0', classpath, classpath_separator: sep,
    library_directory: paths.libraries(), resolution_width: String(res.width || 854), resolution_height: String(res.height || 480),
  };

  const hasQuickPlay = JSON.stringify(version.arguments?.game || []).includes('quickPlayMultiplayer');
  if (opts.server && hasQuickPlay) { features.is_quick_play_multiplayer = true; vars.quickPlayMultiplayer = opts.server; }
  if (opts.world && hasQuickPlay) { features.is_quick_play_singleplayer = true; vars.quickPlaySingleplayer = opts.world; }

  const modded = inst.loader?.type && inst.loader.type !== 'vanilla';
  const maxMem = inst.memory?.max || (s.autoMemory ? settings.autoMemory(modded) : s.memoryMax);
  const minMem = Math.min(inst.memory?.min || s.memoryMin || 512, maxMem);
  const jvm = [`-Xmx${maxMem}M`, `-Xms${minMem}M`, '-Dlog4j2.formatMsgNoLookups=true', '-Dfml.ignorePatchDiscrepancies=true', '-Dfml.ignoreInvalidMinecraftCertificates=true'];
  const customJvm = (inst.jvmArgs || s.jvmArgs || '').split(/\s+/).filter(Boolean);
  jvm.push(...customJvm);
  if (s.performanceMode) jvm.push('-XX:+UseStringDeduplication', '-XX:+ParallelRefProcEnabled', '-XX:+DisableExplicitGC');
  if (version.arguments?.jvm) jvm.push(...expandArgs(version.arguments.jvm, vars, features));
  else {
    if (process.platform === 'darwin') jvm.push('-XstartOnFirstThread');
    if (process.platform === 'win32') jvm.push('-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump');
    jvm.push(`-Djava.library.path=${nativesDir}`, '-cp', classpath);
  }
  let game = version.arguments?.game
    ? expandArgs(version.arguments.game, vars, features)
    : (version.minecraftArguments || '').split(' ').map((a) => substitute(a, vars));
  if (res.width && res.height && !version.arguments?.game) game.push('--width', String(res.width), '--height', String(res.height));
  if (res.fullscreen) game.push('--fullscreen');
  if (opts.server && !hasQuickPlay) {
    const [host, port] = opts.server.split(':');
    game.push('--server', host, '--port', port || '25565');
  }
  const args = [...jvm, version.mainClass, ...game];

  status(instanceId, 'Starting Minecraft');
  const runId = `${instanceId}-${Date.now()}`;
  fs.mkdirSync(paths.logs(), { recursive: true });
  const logFile = path.join(paths.logs(), `${runId}.log`);
  const logStream = fs.createWriteStream(logFile);
  // Environment variables and launch hooks (instance settings, else the defaults in Settings → Default options)
  const env = { ...cleanEnv(), ...parseEnv(inst.envVars && String(inst.envVars).trim() ? inst.envVars : s.envVars), INST_NAME: inst.name, INST_ID: inst.id, INST_DIR: gameDir, INST_MC_VER: inst.versionId, INST_JAVA: javaPath };
  const hooks = hooksFor(inst, s);
  if (hooks.pre) { status(instanceId, 'Running pre-launch command'); await runHook(hooks.pre, env, gameDir, true); }
  const wrap = hooks.wrapper && !s.dedicatedGpu ? splitCmd(hooks.wrapper) : [];
  const proc = wrap.length ? spawn(wrap[0], [...wrap.slice(1), javaPath, ...args], { cwd: gameDir, windowsHide: false, env }) : spawn(javaPath, args, { cwd: gameDir, windowsHide: false, env });
  const run = { runId, proc, instanceId, name: inst.name, start: Date.now(), lines: [], logFile, gameDir };
  running.set(runId, run);
  const safe = (l) => (auth.accessToken.length > 8 ? l.split(auth.accessToken).join('••••••') : l);
  const header = `[Astra] Launching ${inst.name} — ${version.id} with ${javaPath} (${maxMem} MB)`;
  run.lines.push(header); logStream.write(header + '\n');
  push('game:log', { runId, instanceId, line: header });
  let buf = '';
  const onData = (d) => {
    buf += String(d);
    const parts = buf.split(/\r?\n/); buf = parts.pop();
    for (const raw of parts) {
      const line = safe(raw);
      run.lines.push(line); if (run.lines.length > 8000) run.lines.shift();
      logStream.write(line + '\n');
      push('game:log', { runId, instanceId, line });
      hostingFromLog(line, { runId, instanceId, name: inst.name });
      discord.fromGameLog(runId, line);
      mismatchFromLog(run, line);
    }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('error', (e) => {
    push('game:log', { runId, instanceId, line: '[Astra] Failed to start Java: ' + e.message });
    // Java never started: 'close' may not fire, so don't leave the instance marked as running.
    if (!proc.pid && running.has(runId)) {
      running.delete(runId); logStream.end();
      push('launch:status', { instanceId, stage: null, error: 'Could not start Java: ' + e.message });
      push('launch:exited', { runId, instanceId, code: -1, killed: true, duration: 0, analysis: null });
      discord.gameEnded(runId);
      if (!running.size) events.emit('window', 'restore');
    }
  });

  if (assetsLater) {
    downloadAll(assetInfo.tasks, { concurrency: 4 }).catch((e) => {
      try { fs.unlinkSync(assetsOk); } catch {} // check everything before the next launch instead
      push('game:log', { runId, instanceId, line: '[Astra] Some sounds/textures could not be downloaded: ' + e.message });
    });
  }

  instances.save({ ...instances.get(instanceId), lastPlayed: Date.now() });
  push('launch:started', { runId, instanceId, name: inst.name });
  events.emit('window', inst.launchBehavior || s.launchBehavior);
  if (inst.discordRpc !== 'off') discord.playing({ runId, inst, server: opts.server, world: opts.world, start: run.start, account: accounts.active(), modded });

  proc.on('close', (code, signal) => {
    if (!running.has(runId)) return; // already handled (Java failed to start)
    if (buf) onData('\n');
    logStream.end();
    running.delete(runId);
    if (hosting.delete(runId)) push('host:offline', { runId, instanceId });
    const duration = Date.now() - run.start;
    if (!run.savedOnQuit) { try { const cur = instances.get(instanceId); instances.save({ ...cur, playTime: (cur.playTime || 0) + duration }); } catch {} } // else: already counted while Astra was quitting
    const killed = run.killed || signal === 'SIGTERM';
    let analysis = null;
    if (code !== 0 && !killed) {
      analysis = crash.analyze({ code: code ?? -1, lines: run.lines.slice(-400), gameDir, since: run.start });
      // Damaged game files: check and re-download everything on the next launch automatically.
      if (analysis.corrupt) { try { fs.writeFileSync(paths.file('repair.flag'), new Date().toISOString()); } catch {} push('toast', { type: 'warn', text: 'Some game files look damaged — Astra will check and repair them the next time you press Play.' }); }
      if (settings.get().notifications && Notification.isSupported()) new Notification({ title: `${inst.name} crashed`, body: analysis.causes[0].title }).show();
    }
    history.unshift({ runId, instanceId, name: inst.name, start: run.start, end: Date.now(), code, lines: run.lines, logFile, analysis });
    // Astra Analytics: one session record (src/eco/analytics.js)
    try { events.emit('game:session', { runId, instanceId, name: inst.name, mc: inst.versionId, loader: inst.loader?.type || 'vanilla', start: run.start, end: Date.now(), launchMs: run.start - pressedAt, code, killed, crashed: !!analysis, crash: analysis?.causes?.[0]?.title || null, server: opts.server || null, world: opts.world || null, memoryMb: maxMem }); } catch {}
    history.splice(20);
    push('launch:exited', { runId, instanceId, code, killed, duration, analysis });
    discord.gameEnded(runId);
    if (hooks.post) runHook(hooks.post, { ...env, INST_EXIT_CODE: String(code ?? -1) }, gameDir, false).catch(() => {});
    if (!running.size) { events.emit('window', 'restore'); }
  });
  return { runId };
}

function stop(runId) {
  const r = running.get(runId);
  if (!r) return false;
  r.killed = true;
  r.proc.kill();
  setTimeout(() => { try { if (running.has(runId)) r.proc.kill('SIGKILL'); } catch {} }, 5000);
  return true;
}
function list() {
  return {
    running: [...running.values()].map((r) => ({ runId: r.runId, instanceId: r.instanceId, name: r.name, start: r.start, running: true })),
    history: history.map((h) => ({ runId: h.runId, instanceId: h.instanceId, name: h.name, start: h.start, end: h.end, code: h.code, analysis: h.analysis })),
  };
}
function logs(runId) {
  const r = running.get(runId) || history.find((h) => h.runId === runId);
  return r ? r.lines : [];
}
const isRunning = (instanceId) => [...running.values()].some((r) => r.instanceId === instanceId);

const anyRunning = () => running.size > 0 || starting.size > 0;
const isBusy = (instanceId) => isRunning(instanceId) || starting.has(instanceId);

module.exports = { launch, stop, list, logs, isRunning, isBusy, anyRunning, ensureVersion, savePlaytimeOnQuit, hostingList, resolveJava, stripLoaderCopies };
