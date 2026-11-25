// All renderer-callable functions, exposed over a single IPC channel.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, shell, dialog, clipboard } = require('electron');
const { paths, readJSON, dirSizeAsync, getJSON, push } = require('./util');
const settings = require('./settings');
const versions = require('./versions');
const java = require('./java');
const loaders = require('./loaders');
const instances = require('./instances');
const accounts = require('./accounts');
const launch = require('./launch');
const modrinth = require('./modrinth');
const servers = require('./servers');
const skins = require('./skins');
const importers = require('./importers');
const discord = require('./discord');
const curseforge = require('./curseforge');
const friends = require('./friends');
const files = require('./files');

const DATA = path.join(__dirname, '..', 'data');

function withRunning(list) { return list.map((i) => ({ ...i, running: launch.isRunning(i.id) })); }

/** File actions from the UI are limited to Astra's own folders (data folder + instance game folders). */
function assertKnownPath(p) {
  const r = path.resolve(String(p || ''));
  // Windows and macOS paths ignore case; Linux paths don't.
  const fold = process.platform === 'linux' ? (x) => x : (x) => x.toLowerCase();
  const roots = [paths.getRoot(), ...instances.list().map((i) => i.gameDir)].map((x) => fold(path.resolve(x)));
  const rl = fold(r);
  if (!roots.some((root) => rl === root || rl.startsWith(root + path.sep))) throw new Error('That file is outside the Astra folders.');
  return r;
}
/** Scan newly installed jars in the background and warn if something looks like malware. */
function autoScan(instanceId, jars) {
  if (settings.get().autoScanMods === false || !jars.length) return;
  setImmediate(() => {
    for (const j of jars) {
      if (!fs.existsSync(j)) continue;
      const findings = instances.scanFile(j);
      if (findings.length) push('safety:flagged', { instanceId, file: path.basename(j), findings });
    }
  });
}
const modsPath = (id, list) => list.filter((x) => /\.jar$/i.test(x.file || '')).map((x) => path.join(instances.get(id).gameDir, 'mods', x.file));
const noGamesRunning = (what) => { if (launch.anyRunning()) throw new Error(`Close all running games before ${what}.`); };

module.exports = (getWin) => ({
  // ---------- Astra ecosystem: modpack checks, servers 2.0, inbox, backups & sync, Developer Hub, Discover, analytics, assistant ----------
  ...require('./eco').api(getWin),

  // ---------- app / window ----------
  'app:info': () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch, totalMem: os.totalmem(), dataDir: paths.getRoot(), electron: process.versions.electron }),
  'news:minecraft': (opts) => require('./news').minecraft(opts || {}),
  'deeplink:take': () => require('./deeplink').take(),
  'update:state': () => require('./updater').getState(),
  'update:check': () => require('./updater').check(),
  'update:install': () => require('./updater').install(),
  'app:restart': () => { app.isQuitting = true; app.relaunch(); app.quit(); },
  'win:minimize': () => getWin()?.minimize(),
  'win:maximize': () => { const w = getWin(); if (w) w.isMaximized() ? w.unmaximize() : w.maximize(); },
  'win:close': () => getWin()?.close(),
  'shell:open': (url) => { if (/^https?:\/\//.test(url)) return shell.openExternal(url); },
  'shell:openPath': (p) => shell.openPath(assertKnownPath(p)),
  'shell:showItem': (p) => shell.showItemInFolder(assertKnownPath(p)),
  'clipboard:write': (t) => clipboard.writeText(String(t)),
  'dialog:open': async (opts) => (await dialog.showOpenDialog(getWin(), opts)).filePaths,
  'dialog:save': async (opts) => (await dialog.showSaveDialog(getWin(), opts)).filePath || null,
  'data:changelog': () => readJSON(path.join(DATA, 'changelog.json'), []),
  'data:roadmap': () => readJSON(path.join(DATA, 'roadmap.json'), {}),

  // ---------- settings ----------
  'settings:get': () => settings.forPage(),
  'discord:page': (name) => discord.setPage(String(name || '')),
  'settings:set': (patch) => {
    const s = settings.set(patch);
    if ('openAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: !!patch.openAtLogin, args: ['--hidden'] });
    if ('hardwareAcceleration' in patch) push('toast', { type: 'info', text: 'Restart Astra to apply the GPU acceleration change.' });
    if ('discordRpc' in patch) { s.discordRpc ? discord.idle() : discord.disconnect(); }
    else if (['discordShowInstance', 'discordShowServer', 'discordShowHead', 'streamerMode'].some((k) => k in patch)) discord.setActivity(); // privacy change: update right away
    return settings.forPage(s);
  },
  'settings:reset': () => settings.forPage(settings.reset()),
  'settings:autoMemory': (modded) => settings.autoMemory(modded),

  // ---------- versions & loaders ----------
  'versions:list': async () => (await versions.getManifest()).versions.map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime })),
  'versions:latest': async () => (await versions.getManifest()).latest,
  'loaders:list': () => loaders.LOADERS,
  'loaders:versions': (type, mc) => loaders.listVersions(type, mc),

  // ---------- instances ----------
  'instances:list': () => withRunning(instances.list()),
  'instances:get': (id) => ({ ...instances.get(id), running: launch.isRunning(id) }),
  'instances:create': (o) => instances.create(o),
  'instances:update': (id, patch) => instances.update(id, patch),
  'instances:delete': (id) => {
    if (launch.isBusy(id)) throw new Error('Close the game before deleting this instance.');
    return instances.remove(id);
  },
  'instances:duplicate': (id, o) => instances.duplicate(id, o),
  'instances:openFolder': (id, sub = '') => { const g = instances.get(id).gameDir; const p = path.join(g, sub); fs.mkdirSync(p, { recursive: true }); return shell.openPath(p); },
  'instances:content': (id, kind) => instances.listContent(id, kind),
  'instances:setEnabled': (id, kind, files, on) => instances.setEnabled(id, kind, files, on),
  'instances:deleteContent': (id, kind, files) => instances.deleteContent(id, kind, files),
  'instances:addFiles': async (id, files, kind) => {
    const packs = files.filter((f) => /\.mrpack$/i.test(f));
    for (const f of packs) await modrinth.installModpack({ file: f });
    const r = { ...instances.addFiles(id, files.filter((f) => !/\.mrpack$/i.test(f)), kind), modpacks: packs.length };
    autoScan(id, modsPath(id, files.map((f) => ({ file: path.basename(f) }))));
    return r;
  },
  'instances:duplicates': (id) => instances.duplicates(id),
  'instances:scan': (id) => instances.scan(id),
  'instances:worlds': (id) => instances.worlds(id),
  'instances:contentCounts': (id) => instances.contentCounts(id),
  'instances:unlink': (id) => instances.unlink(id),
  'instances:exportTree': (id) => instances.exportTree(id),
  /** Checks every game file by checksum on the next launch and re-resolves the loader. */
  'instances:repair': (id) => {
    if (launch.isBusy(id)) throw new Error('Close the game before repairing this instance.');
    instances.update(id, { launchVersionId: null });
    fs.writeFileSync(paths.file('repair.flag'), new Date().toISOString());
    return true;
  },
  /** Desktop shortcut that starts Astra and launches this instance. */
  'instances:shortcut': (id, picture) => require('./shortcut').create(instances.get(id), typeof picture === 'string' && picture.length < 2e6 ? picture : null),
  'instances:export': async (id, include, pack = {}) => {
    const inst = instances.get(id);
    const base = String(pack.name || inst.name).replace(/[<>:"/\\|?*]+/g, '').trim() || 'instance';
    const dest = (await dialog.showSaveDialog(getWin(), { defaultPath: `${base}${pack.version ? ' ' + String(pack.version).replace(/[<>:"/\\|?*]+/g, '') : ''}.solpack`, filters: [{ name: 'Astra pack', extensions: ['solpack'] }] })).filePath;
    if (!dest) return null;
    await instances.exportPack(id, dest, include, pack);
    shell.showItemInFolder(dest);
    return dest;
  },
  'instances:importFile': async (file) => {
    if (/\.mrpack$/i.test(file)) return modrinth.installModpack({ file });
    if (/\.zip$/i.test(file) && curseforge.isCurseForgePack(file)) return curseforge.installModpack({ file });
    if (/\.(solpack|zip)$/i.test(file)) return instances.importPack(file);
    throw new Error('Unsupported file. Use .mrpack, a CurseForge modpack .zip or .solpack');
  },
  'instances:checkUpdates': (id, kind) => modrinth.checkUpdates(id, kind),
  'instances:applyUpdate': (id, kind, file, versionId) => modrinth.applyUpdate(id, kind, file, versionId),
  'instances:setIcon': async (id) => {
    const [f] = (await dialog.showOpenDialog(getWin(), { filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }], properties: ['openFile'] })).filePaths;
    if (!f) return null;
    const buf = fs.readFileSync(f);
    if (buf.length > 1024 * 1024) throw new Error('Icon must be under 1 MB');
    const ext = path.extname(f).slice(1).replace('jpg', 'jpeg');
    return instances.update(id, { icon: `data:image/${ext};base64,${buf.toString('base64')}` });
  },

  // ---------- launch ----------
  'launch:start': async (id, opts) => {
    try { const r = await launch.launch(id, opts || {}); if (opts?.server) { try { require('./eco/serverinfo').joined(opts.server, id); } catch {} } return r; } // join history (Server details)
    catch (e) { push('launch:status', { instanceId: id, stage: null, error: e.message }); throw e; }
  },
  'launch:stop': (runId) => launch.stop(runId),
  'launch:list': () => launch.list(),
  'optifine:list': (mc) => require('./optifine').list(mc),
  'optifine:import': (file) => require('./optifine').importJar(file),
  'optifine:remove': (id) => require('./optifine').remove(id),
  'host:list': () => launch.hostingList(),
  // ---------- Hosting (Host page) ----------
  'hosted:list': () => require('./hostserver').list(),
  'hosted:get': (id) => require('./hostserver').get(id),
  'hosted:versions': (software) => require('./hostserver').softwareVersions(software),
  'hosted:create': (opts) => require('./hostserver').create(opts || {}, launch.resolveJava, (step) => push('task', { id: 'hosted-create', label: 'Creating server', progress: null, detail: step })).finally(() => push('task', { id: 'hosted-create', done: true })),
  'hosted:start': (id) => require('./hostserver').start(id, launch.resolveJava),
  'hosted:stop': (id) => require('./hostserver').stop(id),
  'hosted:restart': (id) => require('./hostserver').restart(id),
  'hosted:command': (id, cmd) => require('./hostserver').command(id, cmd),
  'hosted:logs': (id) => require('./hostserver').logs(id),
  'hosted:settings': (id) => require('./hostserver').getSettings(id),
  'hosted:setSettings': (id, patch) => require('./hostserver').saveSettings(id, patch || {}),
  'hosted:setTunnel': (id, t) => require('./hostserver').setTunnel(id, t),
  'hosted:tunnelStop': (id) => require('./hostserver').tunnelStop(id),
  'hosted:tunnelStart': (id) => require('./hostserver').tunnelStart(id),
  'hosted:tunnelRestart': (id) => require('./hostserver').tunnelRestart(id),
  'hosted:remove': (id) => require('./hostserver').remove(id),
  'hosted:openFolder': (id, sub) => require('./hostserver').openFolder(id, sub),
  'hosted:worlds': (id) => require('./hostserver').worlds(id),
  'hosted:setWorld': (id, n) => require('./hostserver').setActiveWorld(id, n),
  'hosted:deleteWorld': (id, n) => require('./hostserver').deleteWorld(id, n),
  'hosted:people': (id, kind) => require('./hostserver').people(id, kind),
  'hosted:addPerson': (id, kind, name) => require('./hostserver').addPerson(id, kind, name),
  'hosted:removePerson': (id, kind, name) => require('./hostserver').removePerson(id, kind, name),
  'hosted:backups': (id) => require('./hostserver').backups(id),
  'hosted:backup': (id) => require('./hostserver').backup(id),
  'hosted:restore': (id, f) => require('./hostserver').restore(id, f),
  'hosted:deleteBackup': (id, f) => require('./hostserver').deleteBackup(id, f),
  'hosted:logFiles': (id) => require('./hostserver').logFiles(id),
  'hosted:readLog': (id, f) => require('./hostserver').readLog(id, f),
  'hosted:search': (id, q, off, src) => require('./hostserver').searchContent(id, q, off, src === 'curseforge' ? 'curseforge' : 'modrinth'),
  'hosted:content': (id) => require('./hostserver').installedContent(id),
  'hosted:install': (id, pid, vid) => require('./hostserver').installContent(id, pid, vid),
  'hosted:removeContent': (id, f) => require('./hostserver').removeContent(id, f),
  'hosted:modSources': (id) => require('./hostserver').modSources(id),
  'hosted:instanceMods': (id, instId) => require('./hostserver').instanceMods(id, instId),
  'hosted:copyFromInstance': (id, instId, files) => require('./hostserver').copyFromInstance(id, instId, files),
  'hosted:addFiles': (id, files) => require('./hostserver').addContentFiles(id, files),
  'hosted:toggleContent': (id, f) => require('./hostserver').toggleContent(id, f),
  'hosted:modpackVersions': (pid, sw, mc) => require('./hostserver').modpackVersions(pid, sw, mc),
  'hosted:searchModpacks': async (q, sw, mc, src) => { if (src === 'curseforge') return require('./hostserver').searchModpacksCf(q, sw, mc); const facets = [['project_type:modpack'], [`categories:${sw}`], [`versions:${mc}`]]; const r = await getJSON(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(q || '')}&facets=${encodeURIComponent(JSON.stringify(facets))}&limit=12&index=${q ? 'relevance' : 'downloads'}`); return r.hits.map((h) => ({ id: h.project_id, title: h.title, icon: h.icon_url, downloads: h.downloads, description: h.description })); },
  // ---------- playit.gg ----------
  'hosted:setVoice': (id, on) => require('./hostserver').setVoice(id, !!on),
  'hosted:setVoiceAddress': (id, addr) => require('./hostserver').setVoiceAddress(id, addr),
  'hosted:allowOffline': (id, o) => require('./hostserver').allowOffline(id, o || {}),
  'hosted:setBedrock': (id, on) => require('./hostserver').setBedrock(id, !!on),
  'hosted:diagnose': (id) => require('./hostserver').diagnose(id),
  'hosted:applyFix': (id, fix) => require('./hostserver').applyFix(id, fix),
  'hosted:pregen': (id, o) => require('./hostserver').pregen(id, o || {}),
  'hosted:lagCheck': (id) => require('./hostserver').lagCheck(id),
  'hosted:setDiscord': (id, o) => require('./hostserver').setDiscord(id, o || {}),
  'hosted:testDiscord': (id, url) => require('./hostserver').testDiscord(id, url),
  'hosted:makeInstance': (id) => require('./hostserver').makeInstance(id, (step) => push('task', { id: 'hosted-inst', label: 'Making the game instance', progress: null, detail: step })).finally(() => push('task', { id: 'hosted-inst', done: true })),
  'hosted:setupCode': (id) => require('./hostserver').setupCode(id),
  'hosted:readSetupCode': (code) => require('./hostserver').readSetupCode(code),
  'hosted:joinCode': (id) => require('./hostserver').joinCode(id),
  'hosted:readJoinCode': (code) => require('./hostserver').readJoinCode(code),
  'hosted:setSchedule': (id, sc) => require('./hostserver').setSchedule(id, sc || {}),
  'hosted:setAutoStart': (id, on) => require('./hostserver').setAutoStart(id, on),
  'hosted:bans': (id) => require('./hostserver').bans(id),
  'hosted:pardon': (id, name) => require('./hostserver').pardon(id, name),
  'hosted:players': (id) => require('./hostserver').knownPlayers(id),
  'hosted:tasks': (id) => require('./hostserver').tasks(id),
  'hosted:saveTask': (id, t) => require('./hostserver').saveTask(id, t || {}),
  'hosted:deleteTask': (id, tid) => require('./hostserver').deleteTask(id, tid),
  'hosted:runTask': (id, tid) => require('./hostserver').runTaskNow(id, tid),
  'hosted:perf': (id) => require('./hostserver').perf(id),
  'hosted:setPack': (id, o) => require('./hostserver').setPack(id, o || {}),
  'hosted:copy': (id) => require('./hostserver').copyServer(id),
  'hosted:export': (id, dest) => require('./hostserver').exportServer(id, dest),
  'hosted:import': (file) => require('./hostserver').importServer(file, (step) => push('task', { id: 'hosted-import', label: 'Importing server', progress: null, detail: step })).finally(() => push('task', { id: 'hosted-import', done: true })),
  'hosted:importWorld': (id, src) => require('./hostserver').importWorld(id, src),
  'hosted:clientMods': (id) => require('./hostserver').clientMods(id),
  'hosted:addClientMod': (id, pid) => require('./hostserver').addClientMod(id, pid),
  'hosted:removeClientMod': (id, pid) => require('./hostserver').removeClientMod(id, pid),
  'hosted:searchClientMods': (id, q) => require('./hostserver').searchClientMods(id, q),
  // ---------- Astra Connect ----------
  'connect:list': () => require('./connect').list(),
  'connect:get': (id) => require('./connect').get(id),
  'connect:status': (id) => require('./connect').status(id),
  'connect:setEnabled': (id, on) => require('./connect').setEnabled(id, on),
  'connect:setConfig': (id, patch) => require('./connect').setConfig(id, patch),
  'connect:clearErrors': (id) => require('./connect').clearErrors(id),
  'connect:compatibility': (id) => require('./connect').compatibility(id),
  'connect:details': (id) => require('./connect').details(id),
  'stats:worlds': () => require('./connect/saves').worlds(),
  'stats:players': (key) => require('./connect/saves').players(String(key)),
  'stats:player': (key, uuid) => require('./connect/saves').player(String(key), String(uuid)),
  'stats:totals': () => require('./connect/saves').totals(),
  'wp:list': () => require('./connect/waypoints').list(),
  'wp:save': (w) => require('./connect/waypoints').save(w || {}),
  'wp:remove': (id) => require('./connect/waypoints').remove(String(id)),
  'wp:encode': (ids) => require('./connect/waypoints').encode(Array.isArray(ids) ? ids.map(String) : []),
  'wp:decode': (text) => require('./connect/waypoints').decode(text),
  'wp:places': (key, uuid) => require('./connect/waypoints').placesFrom(String(key), uuid ? String(uuid) : null),
  'wp:teleport': (id, player) => require('./connect/waypoints').teleport(String(id), String(player)),
  'wp:announce': (id) => require('./connect/waypoints').announce(String(id)),
  'stats:inventory': (key, uuid) => require('./connect/inventory').inventory(String(key), String(uuid)),
  'stats:saveNow': (serverId) => require('./connect/inventory').saveNow(String(serverId)),
  'maps:info': (id) => require('./connect/webmap').info(id),
  'maps:enable': (id, o) => require('./connect/webmap').enable(id, o || {}),
  'maps:disable': (id) => require('./connect/webmap').disable(id),
  'maps:links': () => require('./connect/webmap').listLinks(),
  'maps:addLink': (url, name) => require('./connect/webmap').addLink(url, name),
  'maps:removeLink': (lid) => require('./connect/webmap').removeLink(lid),
  'playit:tunnels': () => require('./playit').listTunnels(),
  'playit:enableTunnel': (tid, on) => require('./playit').enableTunnel(tid, on),
  'playit:removeTunnel': (tid) => require('./playit').removeTunnel(tid),
  'playit:useKey': (key) => require('./playit').useKey(key),
  'playit:status': () => require('./playit').status(),
  'playit:connect': () => require('./playit').startClaim(),
  'playit:cancel': () => require('./playit').cancelClaim(),
  'playit:unlink': () => require('./playit').unlink(),
  'playit:refresh': async () => { await require('./playit').refresh(); return require('./playit').status(); },
  'launch:logs': (runId) => launch.logs(runId),
  'logs:share': async (text) => {
    const r = await getJSON('https://api.mclo.gs/1/log', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ content: text.slice(-10 * 1024 * 1024) }).toString() });
    if (!r.success) throw new Error(r.error || 'Upload failed');
    clipboard.writeText(r.url);
    return r.url;
  },

  // ---------- accounts ----------
  'accounts:list': () => accounts.list(),
  'accounts:addOffline': (name) => accounts.addOffline(name),
  'accounts:offlineUuid': (name) => accounts.offlineUuid(String(name || '')),
  'accounts:checkOfflineName': (name) => accounts.checkOfflineName(name),
  'accounts:refreshProfile': () => accounts.refreshProfile(),
  'accounts:startMicrosoft': (opts) => accounts.startMicrosoft(opts || {}),
  'accounts:microsoftAvailable': () => accounts.microsoftAvailable(),
  'accounts:cancelMicrosoft': () => accounts.cancelMicrosoft(),
  'accounts:remove': (id) => accounts.remove(id),
  'accounts:setActive': (id) => accounts.setActive(id),

  // ---------- modrinth ----------
  'modrinth:search': (q) => modrinth.search(q),
  'modrinth:project': (id) => modrinth.project(id),
  'modrinth:versions': (id, o) => modrinth.versions(id, o),
  'modrinth:tags': () => modrinth.tags(),
  'modrinth:install': async (instanceId, o) => { const r = await modrinth.install(instanceId, o); autoScan(instanceId, modsPath(instanceId, r)); return r; },
  'modpack:versions': (id) => (instances.get(id).modpack?.source === 'curseforge' ? curseforge.modpackVersions(id) : modrinth.modpackVersions(id)),
  'modpack:update': (id, versionId) => {
    if (launch.isBusy(id)) throw new Error('Close the game before updating the modpack.');
    return instances.get(id).modpack?.source === 'curseforge' ? curseforge.updateModpack(id, versionId) : modrinth.updateModpack(id, versionId);
  },

  // ---------- CurseForge ----------
  'curseforge:available': () => curseforge.available(),
  'curseforge:search': (q) => curseforge.search(q),
  'curseforge:categories': (type) => curseforge.categories(type),
  'curseforge:project': (id) => curseforge.project(id),
  'curseforge:files': (id, o) => curseforge.files(id, o),
  'curseforge:install': async (instanceId, o) => { const r = await curseforge.install(instanceId, o); autoScan(instanceId, modsPath(instanceId, r)); return r; },
  'curseforge:installModpack': (o) => curseforge.installModpack(o),
  // a local CurseForge export .zip: read without a key (only files the player picked in the dialog or dropped)
  'curseforge:inspect': (file) => { if (!/\.zip$/i.test(String(file || '')) || !require('path').isAbsolute(file)) throw new Error('Pick a CurseForge modpack .zip'); return curseforge.inspectModpack(file); },
  'curseforge:addManual': (id, files) => curseforge.addManualFiles(id, (Array.isArray(files) ? files : []).filter((f) => typeof f === 'string' && require('path').isAbsolute(f))),
  'curseforge:cancel': () => curseforge.cancelModpack(),
  // The key goes in once, is checked against the real API, then sealed; the page only ever learns connected / not.
  'curseforge:setKey': async (k) => {
    k = String(k || '').replace(/^\s+|\s+$/g, '');
    if (!k) { settings.setCurseforgeKey(''); return settings.forPage(); }
    const t = await curseforge.test(k);
    if (!t.ok && (t.kind === 'auth' || t.kind === 'other')) throw new Error(t.kind === 'auth' ? 'CurseForge didn’t accept that key. Copy the whole key from console.curseforge.com → API keys (it starts with $2a$10$) and paste it again.' : t.error);
    settings.setCurseforgeKey(k);
    if (!t.ok) push('toast', { type: 'warn', text: 'Key saved, but it couldn’t be checked right now: ' + t.error });
    return settings.forPage();
  },
  'curseforge:status': () => curseforge.test(),


  // ---------- friends ----------
  'friends:list': () => friends.list(),
  'friends:add': (n, o) => friends.add(n, o || {}),
  'friends:remove': (u) => friends.remove(u),
  'friends:note': (u, n) => friends.setNote(u, n),
  'friends:skin': (u) => friends.skin(u),

  // ---------- instance files & logs ----------
  'files:list': (id, rel) => files.list(id, rel),
  'files:read': (id, rel) => files.read(id, rel),
  'files:write': (id, rel, t) => files.write(id, rel, t),
  'files:trash': (id, rels) => files.trash(id, rels),
  'files:rename': (id, rel, n) => files.rename(id, rel, n),
  'files:mkdir': (id, rel, n) => files.mkdir(id, rel, n),
  'files:open': (id, rel) => files.open(id, rel),
  'files:reveal': (id, rel) => files.reveal(id, rel),
  'files:logs': (id) => files.logs(id),

  // ---------- safety ----------
  'safety:scanAll': async () => {
    try { return await instances.scanAll((d, t) => { if (d % 5 === 0 || d === t) push('task', { id: 'scan', label: 'Scanning mods for malware', progress: d / Math.max(1, t), detail: `${d}/${t}` }); }); }
    finally { push('task', { id: 'scan', done: true }); }
  },
  'safety:disable': (id, file) => instances.setEnabled(id, 'mods', [path.basename(file)], false),
  'modrinth:installModpack': (o) => modrinth.installModpack(o),

  // ---------- Astra Client ----------
  'solaris:modules': () => modrinth.modules(),
  'solaris:availability': (mc) => modrinth.moduleAvailability(mc),
  'solaris:create': async ({ mc, modules, name }) => {
    const inst = instances.create({ name: name || `Astra ${mc}`, versionId: mc, loader: { type: 'fabric' }, icon: 'sun', extra: { solarisModules: modules } });
    return inst;
  },
  'solaris:setModules': (id, modules) => instances.update(id, { solarisModules: modules }),
  'solaris:sync': (id) => modrinth.syncModules(id, (p, slug) => push('task', { id: 'sync-' + id, label: 'Syncing Astra modules', progress: p, detail: slug })),

  // ---------- servers ----------
  'servers:list': () => servers.list(),
  'servers:save': (s) => servers.save(s),
  'servers:remove': (id) => servers.remove(id),
  'servers:ping': (address) => servers.ping(address),
  'servers:history': (address) => servers.history(address),

  // ---------- skins ----------
  'skins:list': () => skins.list(),
  'skins:addFile': async (variant) => {
    const [f] = (await dialog.showOpenDialog(getWin(), { filters: [{ name: 'Skin PNG', extensions: ['png'] }], properties: ['openFile'] })).filePaths;
    return f ? skins.addFile(f, variant) : skins.list();
  },
  'skins:addFromUsername': (n) => skins.addFromUsername(n),
  'skins:addData': (data, name, variant) => skins.addData(data, name, variant),
  'skins:remove': (id) => skins.remove(id),
  'skins:update': (id, patch) => skins.rename(id, patch),
  'skins:wearing': (url) => skins.wearingId(url),
  'skins:current': () => skins.current(),
  'skins:apply': (id) => skins.apply(id),
  'skins:capes': () => skins.capes(),
  'skins:setCape': (id) => skins.setCape(id),

  // ---------- gallery ----------
  'gallery:list': () => instances.screenshots(),
  'gallery:delete': async (p) => {
    const f = assertKnownPath(p);
    if (!/\.(png|jpe?g)$/i.test(f)) throw new Error('Only screenshots can be deleted here.');
    await shell.trashItem(f); return true;
  },

  // ---------- java ----------
  'java:detect': () => java.detect(),
  'java:test': (p) => java.test(p),
  'java:install': (component) => java.ensureRuntime(component, (d, t) => push('task', { id: 'java', label: `Installing ${component}`, progress: d / t, detail: `${d}/${t}` })).finally(() => push('task', { id: 'java', done: true })),

  // ---------- import ----------
  'import:officialScan': () => importers.scanOfficial(),
  'import:official': (keys) => importers.importOfficial(keys),
  'import:mmcScan': (dir) => importers.scanMultiMC(dir),
  'import:mmc': (dir, keys) => importers.importMultiMC(dir, keys),
  'import:folder': (dir, o) => importers.importFolder(dir, o),
  'import:cfScan': (dir) => importers.scanCurseForge(dir || undefined),
  'import:cf': (keys, dir) => importers.importCurseForge(keys, dir || undefined),
  'import:cfDir': () => importers.curseforgeDir(),

  // ---------- storage & diagnostics ----------
  'storage:usage': async () => {
    const dirs = { Instances: paths.instances(), Assets: paths.assets(), Libraries: paths.libraries(), Versions: paths.versions(), 'Java runtimes': paths.runtime(), Natives: paths.natives(), Logs: paths.logs(), Cache: paths.cache() };
    const out = [];
    for (const [name, dir] of Object.entries(dirs)) out.push({ name, dir, size: await dirSizeAsync(dir) }); // async: never freezes the app
    return out;
  },
  'storage:cleanup': async () => {
    noGamesRunning('cleaning up'); // running games use natives and version files
    let freed = 0;
    const rm = async (p) => { const sz = await dirSizeAsync(p); try { await fs.promises.rm(p, { recursive: true, force: true }); freed += sz; } catch {} };
    // Cache, except what can't simply be downloaded again: OptiFine jars the player imported by hand,
    // and the playit.gg agent (it may be running a tunnel right now).
    const KEEP = new Set(['optifine', 'playit']);
    try { for (const f of fs.readdirSync(paths.cache())) if (!KEEP.has(f)) await rm(path.join(paths.cache(), f)); } catch {}
    await rm(paths.natives());
    // Old logs (>14 days)
    try { for (const f of fs.readdirSync(paths.logs())) { const full = path.join(paths.logs(), f); if (Date.now() - fs.statSync(full).mtimeMs > 14 * 864e5) { freed += fs.statSync(full).size; fs.unlinkSync(full); } } } catch {}
    // Versions not used by any instance (keeping parents of used ones)
    const used = new Set();
    for (const i of instances.list()) {
      used.add(i.versionId);
      if (i.launchVersionId) { used.add(i.launchVersionId); const j = readJSON(path.join(paths.versions(), i.launchVersionId, i.launchVersionId + '.json'), {}); if (j.inheritsFrom) used.add(j.inheritsFrom); }
    }
    try { for (const v of fs.readdirSync(paths.versions())) if (!used.has(v)) await rm(path.join(paths.versions(), v)); } catch {}
    return freed;
  },
  'storage:repair': async () => {
    noGamesRunning('repairing game files');
    // Natives are re-extracted, and the next launch verifies every game file by checksum (see launch.js).
    await fs.promises.rm(paths.natives(), { recursive: true, force: true });
    fs.writeFileSync(paths.file('repair.flag'), new Date().toISOString());
    return true;
  },
  'storage:relocate': async () => {
    noGamesRunning('moving the data folder');
    if (require('./hostserver').anyRunning()) throw new Error('Stop your hosted servers before moving the data folder.');
    const [dir] = (await dialog.showOpenDialog(getWin(), { properties: ['openDirectory', 'createDirectory'] })).filePaths;
    if (!dir) return null;
    const target = path.join(dir, 'Astra');
    const old = paths.getRoot();
    if (path.resolve(target) === path.resolve(old)) return null;
    // Copying a folder into itself never ends.
    if (path.resolve(target).startsWith(path.resolve(old) + path.sep)) throw new Error('Pick a folder outside the current Astra data folder.');
    push('task', { id: 'relocate', label: 'Moving data folder', progress: null });
    try { await fs.promises.cp(old, target, { recursive: true }); } finally { push('task', { id: 'relocate', done: true }); }
    paths.setRoot(target);
    app.relaunch(); app.exit(0);
    return target;
  },
  'storage:resetDataDir': () => { paths.setRoot(path.join(app.getPath('appData'), '.solaris')); app.relaunch(); app.exit(0); },
  'diag:hosts': () => {
    const file = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts') : '/etc/hosts';
    let txt = ''; try { txt = fs.readFileSync(file, 'utf8'); } catch { return { file, readable: false, issues: [] }; }
    const issues = txt.split(/\r?\n/).map((l, i) => ({ line: i + 1, text: l.trim() }))
      .filter((l) => l.text && !l.text.startsWith('#') && /(mojang\.com|minecraft\.net|minecraftservices\.com|xboxlive\.com|login\.(live|microsoftonline)\.com|modrinth\.com)/i.test(l.text));
    return { file, readable: true, issues };
  },
  'diag:openLogs': () => { fs.mkdirSync(paths.logs(), { recursive: true }); return shell.openPath(paths.logs()); },
  'diag:openData': () => shell.openPath(paths.getRoot()),
});
