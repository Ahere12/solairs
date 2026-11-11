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

const DATA = path.join(__dirname, '..', 'data');

function withRunning(list) { return list.map((i) => ({ ...i, running: launch.isRunning(i.id) })); }

/** File actions from the UI are limited to Solaris's own folders (data folder + instance game folders). */
function assertKnownPath(p) {
  const r = path.resolve(String(p || ''));
  const roots = [paths.getRoot(), ...instances.list().map((i) => i.gameDir)].map((x) => path.resolve(x).toLowerCase());
  const rl = r.toLowerCase();
  if (!roots.some((root) => rl === root || rl.startsWith(root + path.sep))) throw new Error('That file is outside the Solaris folders.');
  return r;
}
const noGamesRunning = (what) => { if (launch.anyRunning()) throw new Error(`Close all running games before ${what}.`); };

module.exports = (getWin) => ({
  // ---------- app / window ----------
  'app:info': () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch, totalMem: os.totalmem(), dataDir: paths.getRoot(), electron: process.versions.electron }),
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
  'settings:get': () => settings.get(),
  'settings:set': (patch) => {
    const s = settings.set(patch);
    if ('openAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: !!patch.openAtLogin, args: ['--hidden'] });
    if ('discordRpc' in patch || 'discordClientId' in patch) { s.discordRpc ? discord.idle() : discord.disconnect(); }
    return s;
  },
  'settings:reset': () => settings.reset(),
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
    return { ...instances.addFiles(id, files.filter((f) => !/\.mrpack$/i.test(f)), kind), modpacks: packs.length };
  },
  'instances:duplicates': (id) => instances.duplicates(id),
  'instances:scan': (id) => instances.scan(id),
  'instances:worlds': (id) => instances.worlds(id),
  'instances:export': async (id, include) => {
    const inst = instances.get(id);
    const dest = (await dialog.showSaveDialog(getWin(), { defaultPath: `${inst.name}.solpack`, filters: [{ name: 'Solaris pack', extensions: ['solpack'] }] })).filePath;
    if (!dest) return null;
    await instances.exportPack(id, dest, include);
    shell.showItemInFolder(dest);
    return dest;
  },
  'instances:importFile': async (file) => {
    if (/\.mrpack$/i.test(file)) return modrinth.installModpack({ file });
    if (/\.(solpack|zip)$/i.test(file)) return instances.importPack(file);
    throw new Error('Unsupported file. Use .solpack or .mrpack');
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
    try { return await launch.launch(id, opts || {}); }
    catch (e) { push('launch:status', { instanceId: id, stage: null, error: e.message }); throw e; }
  },
  'launch:stop': (runId) => launch.stop(runId),
  'launch:list': () => launch.list(),
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
  'modrinth:install': (instanceId, o) => modrinth.install(instanceId, o),
  'modrinth:installModpack': (o) => modrinth.installModpack(o),

  // ---------- Solaris Client ----------
  'solaris:modules': () => modrinth.modules(),
  'solaris:availability': (mc) => modrinth.moduleAvailability(mc),
  'solaris:create': async ({ mc, modules, name }) => {
    const inst = instances.create({ name: name || `Solaris ${mc}`, versionId: mc, loader: { type: 'fabric' }, icon: 'sun', extra: { solarisModules: modules } });
    return inst;
  },
  'solaris:setModules': (id, modules) => instances.update(id, { solarisModules: modules }),
  'solaris:sync': (id) => modrinth.syncModules(id, (p, slug) => push('task', { id: 'sync-' + id, label: 'Syncing Solaris modules', progress: p, detail: slug })),

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
  'skins:remove': (id) => skins.remove(id),
  'skins:update': (id, patch) => skins.rename(id, patch),
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
  'java:install': (component) => java.ensureRuntime(component, (d, t) => push('task', { id: 'java', label: `Installing ${component}`, progress: d / t, detail: `${d}/${t}` })).then((p) => { push('task', { id: 'java', done: true }); return p; }),

  // ---------- import ----------
  'import:officialScan': () => importers.scanOfficial(),
  'import:official': (keys) => importers.importOfficial(keys),
  'import:mmcScan': (dir) => importers.scanMultiMC(dir),
  'import:mmc': (dir, keys) => importers.importMultiMC(dir, keys),
  'import:folder': (dir, o) => importers.importFolder(dir, o),

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
    await rm(paths.cache());
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
    const [dir] = (await dialog.showOpenDialog(getWin(), { properties: ['openDirectory', 'createDirectory'] })).filePaths;
    if (!dir) return null;
    const target = path.join(dir, 'Solaris');
    const old = paths.getRoot();
    if (path.resolve(target) === path.resolve(old)) return null;
    push('task', { id: 'relocate', label: 'Moving data folder', progress: null });
    await fs.promises.cp(old, target, { recursive: true });
    paths.setRoot(target);
    push('task', { id: 'relocate', done: true });
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
