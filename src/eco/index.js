// Astra ecosystem modules (Phase 2): Modpack Intelligence, Server Management 2.0, Notifications, Cloud & Sync,
// Developer Hub, Discover, Analytics, Assistant. This file starts their background work and lists the functions the
// app can call (merged into src/api.js). API reference: docs/ecosystem.md.

const fs = require('fs');

// ---------- update checks (Minecraft versions, modpacks) ----------
const stateFile = () => require('../util').paths.file('eco-state.json');
const loadState = () => require('../util').readJSON(stateFile(), {});
const saveState = (s) => require('../util').writeJSON(stateFile(), s);

/** A new Minecraft release (or snapshot, if snapshots are shown in Settings). The first check only remembers. */
async function checkMinecraft({ getManifest, notify, showSnapshots, state }) {
  const m = await getManifest(true);
  const rel = m.latest?.release, snap = m.latest?.snapshot;
  const out = [];
  if (state.mcRelease && rel && rel !== state.mcRelease) out.push(notify({ category: 'minecraft', title: `Minecraft ${rel} is out`, body: 'Create an instance for it in Library → New instance.', key: 'mc:' + rel, action: { kind: 'route', page: 'library' } }));
  if (showSnapshots && state.mcSnapshot && snap && snap !== state.mcSnapshot && snap !== rel) out.push(notify({ category: 'minecraft', title: `Snapshot ${snap}`, body: 'A new test version of Minecraft.', key: 'mc:' + snap }));
  return { mcRelease: rel || state.mcRelease, mcSnapshot: snap || state.mcSnapshot, notified: out.filter(Boolean).length };
}
/** Modpack instances with a newer pack version than the installed one. Each new version is announced once. */
async function checkModpacks({ instances, versionsOf, notify, state }) {
  const seen = { ...(state.packSeen || {}) };
  let found = 0;
  for (const inst of instances) {
    if (!inst.modpack?.projectId) continue;
    let v; try { v = await versionsOf(inst); } catch { continue; }
    if (!v?.updatable || !v.versions?.length) continue;
    const newest = [...v.versions].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    if (!newest || String(newest.id) === String(v.current)) continue;
    if (seen[inst.id] === String(newest.id)) continue;
    seen[inst.id] = String(newest.id);
    found++;
    notify({ category: 'modpack', title: `${inst.name}: update available`, body: `${newest.name || newest.number}${newest.type && newest.type !== 'release' ? ` (${newest.type})` : ''}`, key: `pack:${inst.id}:${newest.id}`, action: { kind: 'route', page: 'instance', params: { id: inst.id } } });
  }
  return { packSeen: seen, found };
}

let timers = [];
async function runChecks() {
  const notify = (n) => require('./notify').add(n);
  let st = loadState();
  try { const r = await checkMinecraft({ getManifest: (f) => require('../versions').getManifest(f), notify, showSnapshots: !!require('../settings').get().showSnapshots, state: st }); st = { ...st, mcRelease: r.mcRelease, mcSnapshot: r.mcSnapshot, mcChecked: Date.now() }; } catch {}
  if (Date.now() - (st.packsChecked || 0) > 11 * 3600e3) {
    try {
      const r = await checkModpacks({
        instances: require('../instances').list(), notify, state: st,
        versionsOf: (inst) => (inst.modpack?.source === 'curseforge' ? require('../curseforge').modpackVersions(inst.id) : require('../modrinth').modpackVersions(inst.id)),
      });
      st = { ...st, packSeen: r.packSeen, packsChecked: Date.now() };
    } catch {}
  }
  saveState(st);
}
function init() {
  if (timers.length) return;
  require('./analytics').init();
  require('./backup').init();
  const first = setTimeout(() => runChecks().catch(() => {}), 90 * 1000);
  const every = setInterval(() => runChecks().catch(() => {}), 6 * 3600e3);
  for (const t of [first, every]) t.unref?.();
  timers = [first, every];
}

// ---------- functions the app calls ----------
function api(getWin) {
  const mp = () => require('./modpack'), si = () => require('./serverinfo'), nt = () => require('./notify'), bk = () => require('./backup');
  const dh = () => require('./devhub'), dc = () => require('./discovery'), an = () => require('./analytics'), as = () => require('./assistant');
  const { dialog, clipboard } = require('electron');
  const pickFolder = async (title) => (await dialog.showOpenDialog(getWin(), { title, properties: ['openDirectory', 'createDirectory'] })).filePaths[0] || null;
  return {
    // Modpack Intelligence
    'modpack:check': (id) => mp().check(String(id)),
    'modpack:checkUpdates': (id) => mp().checkWithUpdates(String(id)),
    'modpack:compare': (a, b) => mp().compareInstances(String(a), String(b)),
    'modpack:findMissing': (id, modId) => mp().findMissing(String(id), String(modId)),
    // Server Management 2.0
    'srv:profile': (id) => si().profile(String(id)),
    'srv:setProfile': (id, patch) => si().setProfile(String(id), patch || {}),
    'srv:live': (address) => si().live(String(address)),
    'srv:test': (address, instanceId) => si().test(String(address), instanceId ? String(instanceId) : null),
    'srv:overview': () => si().overview(),
    // Notifications
    'notify:list': (o) => nt().get().list(o || {}),
    'notify:unread': () => nt().get().unreadCount(),
    'notify:read': (ids) => nt().get().markRead(ids || 'all'),
    'notify:remove': (id) => nt().get().remove(String(id)),
    'notify:clear': () => nt().get().clear(),
    'notify:prefs': () => ({ categories: nt().CATEGORIES, prefs: nt().get().prefs() }),
    'notify:setPrefs': (p) => nt().get().setPrefs(p || {}),
    // Cloud & Sync
    'backup:list': () => bk().listBackups(),
    'backup:create': (o) => bk().create({ kind: 'manual', note: o?.note || '', instanceIds: Array.isArray(o?.instanceIds) ? o.instanceIds.map(String) : null }),
    'backup:preview': (f) => bk().preview(String(f)),
    'backup:restore': (f, choice) => bk().restore(String(f), choice || {}),
    'backup:remove': (f) => bk().remove(String(f)),
    'backup:prefs': () => bk().prefs(),
    'backup:setPrefs': (p) => bk().setPrefs(p || {}),
    'backup:chooseSyncDir': async () => { const d = await pickFolder('Choose a folder your cloud drive syncs'); return d ? bk().setPrefs({ syncDir: d }) : null; },
    'backup:openFolder': () => { const d = require('../util').paths.file('backups'); fs.mkdirSync(d, { recursive: true }); return require('electron').shell.openPath(d); },
    'sync:state': () => bk().syncState(),
    'sync:push': () => bk().syncPush({ withBackup: true }),
    'sync:preview': () => bk().syncPreview(),
    'sync:pull': (o) => bk().syncPull(o || {}),
    'sync:importBackup': (name) => bk().importSyncBackup(String(name)),
    // Developer Hub
    'devhub:list': () => dh().list(),
    'devhub:pick': () => pickFolder('Choose an integration folder (with astra-integration.json)'),
    'devhub:check': (folder) => dh().check(String(folder)),
    'devhub:dryRun': (folder, config) => dh().dryRun(String(folder), config || {}),
    'devhub:install': (folder) => dh().install(String(folder)),
    'devhub:grant': (id, perm, on) => dh().setGrant(String(id), String(perm), !!on),
    'devhub:uninstall': (id) => dh().uninstall(String(id)),
    // the developer guide and example ship with Astra (package.json build files)
    'devhub:openGuide': () => require('electron').shell.openPath(require('path').join(__dirname, '..', '..', 'docs', 'developer-hub.md')),
    'devhub:openExample': () => require('electron').shell.showItemInFolder(require('path').join(__dirname, '..', '..', 'sdk', 'example', 'astra-integration.json')),
    'devhub:report': (id) => { const r = dh().report(String(id)); clipboard.writeText(r); return r; },
    // Discover
    'discover:kinds': () => dc().kinds(),
    'discover:search': (q) => dc().run(q || {}),
    'discover:install': (o) => dc().install(o || {}),
    // Analytics
    'analytics:overview': () => an().overview(),
    'analytics:sessions': (o) => an().sessions(o || {}),
    'analytics:worlds': () => an().worlds(),
    'analytics:clear': () => an().clear(),
    // Assistant
    'assistant:settings': () => as().settings(),
    'assistant:setSettings': (p) => as().setSettings(p || {}),
    'assistant:crash': (o) => as().crash(o || {}),
    'assistant:error': (msg) => as().explainError(String(msg || '')),
    'assistant:server': (address, instanceId) => as().server(String(address), instanceId ? String(instanceId) : null),
    'assistant:preview': (o) => as().preview(o || {}),
    'assistant:ask': (o) => as().ask(o || {}),
    'assistant:apply': (action) => as().apply(action || {}),
  };
}

/** Stops background work and writes what is still in memory. Called when Astra quits. */
function shutdown() {
  for (const t of timers) { clearTimeout(t); clearInterval(t); }
  timers = [];
  try { require('./backup').shutdown(); } catch {}
  try { require('./serverinfo').flush(); } catch {}
}

module.exports = { init, shutdown, api, runChecks, checkMinecraft, checkModpacks };
