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

function cleanEnv() { const e = { ...process.env }; delete e.JAVA_TOOL_OPTIONS; delete e._JAVA_OPTIONS; return e; }
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

async function resolveJava(inst, version, onProgress) {
  const custom = inst.javaPath || settings.get().javaPath;
  if (custom && fs.existsSync(custom)) return custom;
  const component = version.javaVersion?.component || 'jre-legacy';
  return java.ensureRuntime(component, onProgress);
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
    if (!list.length) throw new Error(`${type} is not available for Minecraft ${inst.versionId}`);
    lv = (list.find((x) => x.recommended) || list.find((x) => x.stable) || list[0]).version;
  }
  let javaPath = null;
  if (type === 'forge' || type === 'neoforge') {
    const base = await versions.resolveVersion(inst.versionId);
    javaPath = await resolveJava(inst, base, (d, t) => status(inst.id, 'Installing Java', d / t));
  }
  status(inst.id, `Installing ${type === 'vanilla' ? 'Minecraft' : type}`);
  const id = await loaders.install(type, inst.versionId, lv, { java: javaPath, onLog: (l) => push('game:log', { runId: 'install-' + inst.id, instanceId: inst.id, line: l }) });
  instances.save({ ...instances.get(inst.id), launchVersionId: id, loader: { type, version: lv } });
  return id;
}

async function launch(instanceId, opts = {}) {
  let inst = instances.get(instanceId);
  const s = settings.get();
  status(instanceId, 'Signing in');
  const auth = await accounts.getLaunchAuth();

  if (inst.solarisModules) {
    status(instanceId, 'Updating Solaris modules');
    try { await modrinth.syncModules(instanceId, (p, slug) => status(instanceId, 'Updating Solaris modules', p, slug)); }
    catch (e) { push('toast', { type: 'warn', text: 'Could not update Solaris modules: ' + e.message }); }
  }

  const versionId = await ensureVersion(inst);
  inst = instances.get(instanceId);
  status(instanceId, 'Reading version');
  const version = await versions.resolveVersion(versionId);
  fs.mkdirSync(inst.gameDir, { recursive: true });
  let gameDir = inst.gameDir;
  try { gameDir = fs.realpathSync.native(gameDir); } catch {}

  const javaPath = await resolveJava(inst, version, (d, t) => status(instanceId, 'Installing Java', d / t, `${d}/${t}`));
  setGpuPreference(javaPath);

  // Client jar — for inheriting versions, the launcher expects a copy under the child id.
  const jarId = version._jarId;
  const clientDl = version.downloads?.client;
  const baseJar = path.join(paths.versions(), jarId, jarId + '.jar');
  const tasks = [];
  if (clientDl) tasks.push({ url: clientDl.url, path: baseJar, sha1: clientDl.sha1, size: clientDl.size });
  const libs = versions.collectLibraries(version);
  tasks.push(...libs.classpath, ...libs.natives);
  status(instanceId, 'Checking assets');
  const assetInfo = await versions.assetTasks(version);
  tasks.push(...assetInfo.tasks);
  await downloadAll(tasks, { concurrency: s.concurrency || 16, onProgress: (d, t) => { if (d % 20 === 0 || d === t) status(instanceId, 'Downloading game files', d / t, `${d}/${t}`); } });

  let clientJar = baseJar;
  if (version.id !== jarId) {
    clientJar = path.join(paths.versions(), version.id, version.id + '.jar');
    if (!fs.existsSync(clientJar) || fs.statSync(clientJar).size !== fs.statSync(baseJar).size) fs.copyFileSync(baseJar, clientJar);
  }

  status(instanceId, 'Preparing');
  const nativesDir = path.join(paths.natives(), version.id);
  versions.extractNatives(libs.natives, nativesDir);
  const assetsRoot = versions.prepareLegacyAssets(assetInfo, gameDir);

  const sep = process.platform === 'win32' ? ';' : ':';
  const classpath = [...libs.classpath.map((l) => l.path), clientJar].join(sep);
  const res = inst.resolution || s.resolution || {};
  const features = { is_demo_user: false, has_custom_resolution: !!(res.width && res.height) };
  const vars = {
    auth_player_name: auth.name, version_name: version.id, game_directory: gameDir, assets_root: assetsRoot, game_assets: assetsRoot,
    assets_index_name: assetInfo.id, auth_uuid: auth.uuid, auth_access_token: auth.accessToken, auth_session: auth.accessToken,
    clientid: '', auth_xuid: auth.xuid, user_type: auth.userType, version_type: version.type || 'release', user_properties: '{}',
    natives_directory: nativesDir, launcher_name: 'Solaris', launcher_version: '1.0.0', classpath, classpath_separator: sep,
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
  const proc = spawn(javaPath, args, { cwd: gameDir, windowsHide: false, env: cleanEnv() });
  const run = { runId, proc, instanceId, name: inst.name, start: Date.now(), lines: [], logFile, gameDir };
  running.set(runId, run);
  const safe = (l) => (auth.accessToken.length > 8 ? l.split(auth.accessToken).join('••••••') : l);
  const header = `[Solaris] Launching ${inst.name} — ${version.id} with ${javaPath} (${maxMem} MB)`;
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
    }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('error', (e) => push('game:log', { runId, instanceId, line: '[Solaris] Failed to start Java: ' + e.message }));

  instances.save({ ...instances.get(instanceId), lastPlayed: Date.now() });
  push('launch:started', { runId, instanceId, name: inst.name });
  events.emit('window', s.launchBehavior);
  discord.setActivity({
    details: `Playing ${inst.name}`,
    state: opts.server ? `On ${opts.server}` : `Minecraft ${inst.versionId}${modded ? ' · ' + inst.loader.type : ''}`,
    timestamps: { start: Math.floor(run.start / 1000) },
    assets: { large_image: 'solaris', large_text: 'Solaris Launcher' },
  });

  proc.on('close', (code, signal) => {
    if (buf) onData('\n');
    logStream.end();
    running.delete(runId);
    const duration = Date.now() - run.start;
    try { const cur = instances.get(instanceId); instances.save({ ...cur, playTime: (cur.playTime || 0) + duration }); } catch {}
    const killed = run.killed || signal === 'SIGTERM';
    let analysis = null;
    if (code !== 0 && !killed) {
      analysis = crash.analyze({ code: code ?? -1, lines: run.lines.slice(-400), gameDir, since: run.start });
      if (settings.get().notifications && Notification.isSupported()) new Notification({ title: `${inst.name} crashed`, body: analysis.causes[0].title }).show();
    }
    history.unshift({ runId, instanceId, name: inst.name, start: run.start, end: Date.now(), code, lines: run.lines, logFile, analysis });
    history.splice(20);
    push('launch:exited', { runId, instanceId, code, killed, duration, analysis });
    if (!running.size) { events.emit('window', 'restore'); settings.get().discordRpc ? discord.idle() : discord.disconnect(); }
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

module.exports = { launch, stop, list, logs, isRunning, ensureVersion };
