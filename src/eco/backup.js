// Astra Cloud & Sync — versioned backups of what's yours to set up again (settings, saved servers, friends,
// waypoints, map links, and each instance's settings: instance.json, options.txt, config/, servers.dat, the mod
// list), restoring them, and keeping two PCs in step through a sync folder.
//
// "Cloud": Astra has no online service of its own, so there is no Astra account to sync with. Point the sync folder
// at a folder your own cloud drive already syncs (OneDrive, Dropbox, Google Drive, iCloud Drive, a network share):
// Astra writes its sync file and backups there, your drive's app moves them between PCs.
//
// Never in a backup: account sign-ins (accounts.json), sealed secrets (connect.json, playit.json), API keys from the
// settings, worlds (Hosting has its own world backups), mod jars (only the list; they can be downloaded again).
// Nothing is restored without the player choosing what, and Astra makes a backup of the current state first.

const fs = require('fs');
const path = require('path');
const os = require('os');

const FORMAT = 1;
const DATA_FILES = { settings: 'settings.json', servers: 'servers.json', friends: 'friends.json', waypoints: 'waypoints.json', maps: 'maps.json' };
const INSTANCE_FILES = ['options.txt', 'optionsof.txt', 'optionsshaders.txt', 'servers.dat'];
const INSTANCE_DIRS = ['config'];
const SECRET_KEY = /key|token|secret|password|webhook/i;
// settings that make sense on another PC (not paths, memory, Java or window positions)
const SYNC_SETTINGS = ['language', 'theme', 'accent', 'customTheme', 'colorMode', 'layout', 'keybinds', 'discordRpc', 'discordShowInstance', 'discordShowServer', 'discordShowHead', 'streamerMode', 'autoScanMods', 'notifications', 'showSnapshots', 'doubleClickLaunch', 'launchBehavior', 'browseSource', 'lowEndMode'];

/** A copy without anything that looks like a secret (keys, tokens, webhooks). */
function stripSecrets(obj) {
  if (Array.isArray(obj)) return obj.map(stripSecrets);
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) { if (SECRET_KEY.test(k) && typeof v !== 'object') continue; out[k] = stripSecrets(v); }
  return out;
}
const SECRET_NAME = /token|secret|credential|password|passwd|cookie|session|apikey|api[_-]key|account/i;
const SECRET_TEXT = /(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|bot[_-]?token)["']?\s*[:=]\s*["']?[A-Za-z0-9_\-./+=]{12,}|discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+|\bsk-ant-[\w-]{10,}/i;
/** A file that looks like it holds a credential (by its name, or a key/token/webhook inside a small text file). */
function secretFile(full) {
  if (SECRET_NAME.test(path.basename(full))) return true;
  try {
    const st = fs.statSync(full);
    if (!st.isFile() || st.size > 512 * 1024) return false;
    const buf = fs.readFileSync(full);
    if (buf.includes(0)) return false; // binary
    return SECRET_TEXT.test(buf.toString('utf8'));
  } catch { return false; }
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && k in o).map((k) => [k, o[k]]));

/** Saved servers from two places: one entry per address; the newer edit wins; a server deleted here stays deleted. */
function mergeServers(local = [], remote = [], { deleted = [] } = {}) {
  const key = (s) => String(s.address || '').trim().toLowerCase();
  const gone = new Set(deleted.map((a) => String(a).toLowerCase()));
  const map = new Map(local.map((s) => [key(s), s]));
  const added = [], updated = [];
  for (const r of remote) {
    const k = key(r); if (!k || gone.has(k)) continue;
    const l = map.get(k);
    if (!l) { map.set(k, r); added.push(r); }
    else if ((r.updatedAt || 0) > (l.updatedAt || 0)) { map.set(k, { ...l, ...r, id: l.id, address: l.address }); updated.push(r); }
  }
  return { servers: [...map.values()], added, updated };
}

/** What restoring would change, so the player can choose before anything is written. */
function planRestore(manifest, current = { instances: [] }) {
  const have = new Set(current.instances.map((i) => i.id));
  return {
    created: manifest.created, device: manifest.device, version: manifest.appVersion,
    data: Object.keys(manifest.data || {}).map((k) => ({ part: k, label: { settings: 'Settings', servers: 'Saved servers', friends: 'Friends', waypoints: 'Waypoints', maps: 'Map links' }[k] || k })),
    instances: (manifest.instances || []).map((i) => ({ id: i.id, name: i.name, exists: have.has(i.id), files: i.files, mods: i.mods?.length || 0, skipped: i.skipped || [] })),
  };
}

// ---------- Astra ----------
const util = () => require('../util');
const dir = () => util().paths.file('backups');
const prefsFile = () => util().paths.file('backup-prefs.json');
const DEFAULT_PREFS = { auto: false, everyHours: 24, keep: 10, syncDir: '', lastAuto: 0, lastPush: 0, lastPull: 0, device: os.hostname(), deletedServers: [] };
function prefs() { return { ...DEFAULT_PREFS, ...util().readJSON(prefsFile(), {}) }; }
function setPrefs(patch = {}) {
  const p = prefs();
  if ('auto' in patch) p.auto = !!patch.auto;
  if ('everyHours' in patch) p.everyHours = Math.max(1, Math.min(24 * 30, Number(patch.everyHours) || 24));
  if ('keep' in patch) p.keep = Math.max(1, Math.min(100, Number(patch.keep) || 10));
  if ('syncDir' in patch) {
    const d = String(patch.syncDir || '').trim();
    if (d) {
      if (!path.isAbsolute(d) || !fs.existsSync(d) || !fs.statSync(d).isDirectory()) throw new Error('Pick a folder that exists.');
      const root = path.resolve(util().paths.getRoot());
      if (path.resolve(d) === root || path.resolve(d).startsWith(root + path.sep)) throw new Error('The sync folder must be outside the Astra data folder.');
    }
    p.syncDir = d;
  }
  util().writeJSON(prefsFile(), p);
  return p;
}

const manifestCache = new Map(); // file:size:mtime → manifest (opening every zip each time is slow)
function listBackups() {
  let files = []; try { files = fs.readdirSync(dir()).filter((f) => /^astra-backup-.+\.zip$/.test(f)); } catch {}
  return files.map((f) => {
    const full = path.join(dir(), f), st = fs.statSync(full);
    const ck = `${f}:${st.size}:${st.mtimeMs}`;
    let m = manifestCache.get(ck) ?? null;
    if (!manifestCache.has(ck)) { try { const AdmZip = require('adm-zip'); const z = new AdmZip(full); m = JSON.parse(z.readAsText('astra-backup.json')); } catch {} manifestCache.set(ck, m); }
    return { file: f, size: st.size, created: m?.created || st.mtimeMs, kind: m?.kind || 'manual', note: m?.note || '', device: m?.device || '', instances: (m?.instances || []).length, valid: !!m };
  }).sort((a, b) => b.created - a.created);
}

/** Makes one backup now. kind: manual | auto | pre-restore. Returns its entry. */
async function create({ kind = 'manual', note = '', instanceIds = null } = {}) {
  const AdmZip = require('adm-zip');
  const { paths, readJSON } = util();
  const instances = require('../instances');
  const zip = new AdmZip();
  const manifest = { format: FORMAT, created: Date.now(), kind, note: String(note || '').slice(0, 200), device: prefs().device, appVersion: safeVersion(), data: {}, instances: [] };
  for (const [part, file] of Object.entries(DATA_FILES)) {
    const full = paths.file(file);
    if (!fs.existsSync(full)) continue;
    let json = readJSON(full, null); if (json == null) continue;
    if (part === 'settings') json = stripSecrets(json);
    zip.addFile(`data/${file}`, Buffer.from(JSON.stringify(json, null, 2)));
    manifest.data[part] = file;
  }
  for (const inst of instances.list()) {
    if (instanceIds && !instanceIds.includes(inst.id)) continue;
    const base = `instances/${inst.id}/`;
    const meta = readJSON(path.join(paths.instances(), inst.id, 'instance.json'), null);
    if (!meta) continue;
    zip.addFile(base + 'instance.json', Buffer.from(JSON.stringify({ ...meta, icon: meta.icon && String(meta.icon).length > 200000 ? null : meta.icon }, null, 2)));
    const files = ['instance.json'];
    for (const f of INSTANCE_FILES) { const p = path.join(inst.gameDir, f); if (fs.existsSync(p) && fs.statSync(p).size < 4 * 1024 * 1024) { zip.addLocalFile(p, base + 'game'); files.push(f); } }
    const skipped = [];
    for (const d of INSTANCE_DIRS) {
      const p = path.join(inst.gameDir, d);
      if (!fs.existsSync(p) || (await dirBytes(p)) >= 64 * 1024 * 1024) continue;
      // mod configs sometimes hold tokens, passwords or webhooks: those files stay out of the backup
      const zipBase = base + 'game/' + d;
      await zip.addLocalFolderPromise(p, { zipPath: zipBase, filter: (inZip) => { // adm-zip passes the path inside the zip
        const rel = path.relative(path.join(zipBase), inZip);
        const bad = secretFile(path.join(p, rel));
        if (bad) skipped.push(`${d}/${rel.split(path.sep).join('/')}`);
        return !bad;
      } });
      files.push(d + '/');
    }
    for (const rec of ['modrinth.json', 'curseforge.json']) { const p = path.join(paths.instances(), inst.id, rec); if (fs.existsSync(p)) { zip.addLocalFile(p, base); files.push(rec); } }
    let mods = []; try { mods = instances.listContent(inst.id, 'mods').filter((m) => !m.dir).map((m) => ({ file: m.file, name: m.name, version: m.version || null, enabled: m.enabled, source: m.source })); } catch {}
    manifest.instances.push({ id: inst.id, name: inst.name, mc: inst.versionId, loader: inst.loader, files, mods, skipped });
  }
  zip.addFile('astra-backup.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  fs.mkdirSync(dir(), { recursive: true });
  let name = `astra-backup-${new Date(manifest.created).toISOString().replace(/[:.]/g, '-').slice(0, 19)}${kind === 'manual' ? '' : '-' + kind}.zip`;
  if (fs.existsSync(path.join(dir(), name))) name = name.replace(/\.zip$/,`-${Date.now() % 1000}.zip`);
  await zip.writeZipPromise(path.join(dir(), name));
  prune();
  require('./notify').add({ category: 'backup', title: kind === 'auto' ? 'Automatic backup saved' : 'Backup saved', body: `${manifest.instances.length} instance${manifest.instances.length === 1 ? '' : 's'}, settings and servers`, key: 'eco-backup:' + name, desktop: kind !== 'manual', toast: kind === 'auto' }); // a backup you just pressed for already shows on its page
  return listBackups().find((b) => b.file === name);
}
function safeVersion() { try { return require('electron').app.getVersion(); } catch { return null; } }
async function dirBytes(d) { try { return await util().dirSizeAsync(d); } catch { return 0; } }

/** Automatic backups beyond "keep" are deleted (oldest first); manual ones are never deleted automatically. */
function prune() {
  const p = prefs();
  const autos = listBackups().filter((b) => b.kind === 'auto' || b.kind === 'pre-restore');
  for (const b of autos.slice(p.keep)) { try { fs.rmSync(path.join(dir(), b.file), { force: true }); } catch {} }
}
function openZip(file) {
  const AdmZip = require('adm-zip');
  const name = path.basename(String(file));
  const full = path.join(dir(), name);
  if (!/^astra-backup-.+\.zip$/.test(name) || !fs.existsSync(full)) throw new Error('That backup doesn’t exist.');
  const zip = new AdmZip(full);
  let manifest; try { manifest = JSON.parse(zip.readAsText('astra-backup.json')); } catch { throw new Error('That file isn’t an Astra backup (or it’s damaged).'); }
  if (manifest.format > FORMAT) throw new Error('This backup was made by a newer Astra — update Astra to restore it.');
  return { zip, manifest };
}
function preview(file) { const { manifest } = openZip(file); return planRestore(manifest, { instances: require('../instances').list() }); }

/**
 * Restores only what was chosen: { data: ['settings','servers',…], instances: ['id', …] }.
 * A backup of the current state is made first. Settings keep this PC's paths, memory and keys.
 */
async function restore(file, choice = {}) {
  if (require('../launch').anyRunning()) throw new Error('Close all running games before restoring.');
  const { zip, manifest } = openZip(file);
  const parts = (choice.data || []).filter((p) => manifest.data[p]);
  const insts = (choice.instances || []).filter((id) => manifest.instances.some((i) => i.id === id));
  if (!parts.length && !insts.length) throw new Error('Choose what to restore.');
  const safety = await create({ kind: 'pre-restore', note: `Before restoring ${path.basename(file)}` });
  const { paths, readJSON, writeJSON } = util();
  const done = [];
  for (const part of parts) {
    const f = manifest.data[part];
    let json = JSON.parse(zip.readAsText(`data/${f}`));
    if (part === 'settings') {
      const cur = readJSON(paths.file(f), {});
      json = { ...cur, ...pick(json, SYNC_SETTINGS.concat(['homeMcNews', 'homeModpacks', 'homeServers', 'homePlaytime', 'homeNews', 'instanceTabs'])) };
      require('../settings').set(json);
    } else writeJSON(paths.file(f), json);
    done.push(part);
  }
  const instances = require('../instances');
  for (const id of insts) {
    const base = `instances/${id}/`;
    const meta = JSON.parse(zip.readAsText(base + 'instance.json'));
    let inst; try { inst = instances.get(id); } catch { inst = null; }
    if (!inst) { // gone from this PC: make it again (its mods are downloaded by the modpack or by the player)
      fs.mkdirSync(path.join(paths.instances(), id, 'minecraft'), { recursive: true });
      writeJSON(path.join(paths.instances(), id, 'instance.json'), { ...meta, externalGameDir: undefined, launchVersionId: null });
      inst = instances.get(id);
    } else instances.update(id, pick(meta, ['name', 'icon', 'group', 'memory', 'jvmArgs', 'resolution', 'notes']));
    for (const e of zip.getEntries()) {
      if (e.isDirectory || !e.entryName.startsWith(base)) continue;
      const rel = e.entryName.slice(base.length);
      let out;
      if (rel.startsWith('game/')) out = path.join(inst.gameDir, rel.slice(5));
      else if (['modrinth.json', 'curseforge.json'].includes(rel)) out = path.join(paths.instances(), id, rel);
      else continue;
      const root = rel.startsWith('game/') ? path.resolve(inst.gameDir) : path.resolve(paths.instances(), id);
      if (!path.resolve(out).startsWith(root + path.sep)) continue; // never outside the instance
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, e.getData());
    }
    done.push(id);
  }
  return { restored: done, safetyBackup: safety?.file || null };
}
async function remove(file) {
  const name = path.basename(String(file));
  if (!/^astra-backup-.+\.zip$/.test(name)) throw new Error('Not an Astra backup.');
  try { await require('electron').shell.trashItem(path.join(dir(), name)); } catch { fs.rmSync(path.join(dir(), name), { force: true }); }
  return listBackups();
}

// ---------- sync folder ----------
const SYNC_FILE = 'astra-sync.json';
function syncState() {
  const p = prefs();
  if (!p.syncDir) return { configured: false, cloud: { available: false, why: 'Astra has no online accounts. Choose a folder your cloud drive syncs instead.' } };
  const exists = fs.existsSync(p.syncDir);
  const remote = exists ? util().readJSON(path.join(p.syncDir, SYNC_FILE), null) : null;
  return { configured: true, dir: p.syncDir, reachable: exists, remote: remote ? { device: remote.device, updated: remote.updated, servers: (remote.servers || []).length } : null, lastPush: p.lastPush, lastPull: p.lastPull, device: p.device, cloud: { available: false, why: 'Astra has no online accounts. Your cloud drive moves the sync folder between PCs.' } };
}
function needSync() { const p = prefs(); if (!p.syncDir) throw new Error('Choose a sync folder first.'); if (!fs.existsSync(p.syncDir)) throw new Error(`The sync folder isn’t there: ${p.syncDir}`); return p; }
/** Writes this PC's settings and servers (and the newest backup) to the sync folder. */
async function syncPush({ withBackup = true } = {}) {
  const p = needSync();
  const { paths, readJSON, writeJSON } = util();
  const now = Date.now();
  const servers = (readJSON(paths.file('servers.json'), { servers: [] }).servers || []).map(stripSecrets);
  const body = { format: FORMAT, device: p.device, updated: now, settings: pick(stripSecrets(require('../settings').get()), SYNC_SETTINGS), servers, deletedServers: p.deletedServers || [], waypoints: readJSON(paths.file('waypoints.json'), null) };
  writeJSON(path.join(p.syncDir, SYNC_FILE), body);
  let copied = null;
  if (withBackup) {
    const b = listBackups()[0] && Date.now() - listBackups()[0].created < 3600e3 ? listBackups()[0] : await create({ kind: 'manual', note: 'For sync' });
    const to = path.join(p.syncDir, 'backups'); fs.mkdirSync(to, { recursive: true });
    fs.copyFileSync(path.join(dir(), b.file), path.join(to, b.file)); copied = b.file;
  }
  util().writeJSON(prefsFile(), { ...prefs(), lastPush: now });
  return { pushed: now, backup: copied };
}
/** What pulling would change, without changing anything. */
function syncPreview() {
  const p = needSync();
  const { paths, readJSON } = util();
  const remote = readJSON(path.join(p.syncDir, SYNC_FILE), null);
  if (!remote) return { empty: true };
  const local = readJSON(paths.file('servers.json'), { servers: [] }).servers || [];
  const m = mergeServers(local, remote.servers || [], { deleted: p.deletedServers });
  const cur = require('../settings').get();
  const changed = Object.keys(remote.settings || {}).filter((k) => SYNC_SETTINGS.includes(k) && JSON.stringify(cur[k]) !== JSON.stringify(remote.settings[k]));
  return { device: remote.device, updated: remote.updated, sameDevice: remote.device === p.device, settings: changed, serversAdded: m.added.map((s) => s.name || s.address), serversUpdated: m.updated.map((s) => s.name || s.address), backups: listSyncBackups(p) };
}
function listSyncBackups(p = prefs()) { try { return fs.readdirSync(path.join(p.syncDir, 'backups')).filter((f) => /^astra-backup-.+\.zip$/.test(f)).sort().reverse(); } catch { return []; } }
/** Applies the sync folder's settings and servers (what syncPreview listed). Makes a backup first. */
async function syncPull({ settings = true, servers = true } = {}) {
  const p = needSync();
  const { paths, readJSON, writeJSON } = util();
  const remote = readJSON(path.join(p.syncDir, SYNC_FILE), null);
  if (!remote) throw new Error('There’s nothing in the sync folder yet — press “Send this PC’s setup” on the other PC first.');
  await create({ kind: 'pre-restore', note: 'Before syncing from ' + (remote.device || 'another PC') });
  if (settings && remote.settings) require('../settings').set(pick(remote.settings, SYNC_SETTINGS));
  if (servers) {
    const d = readJSON(paths.file('servers.json'), { servers: [], history: {} });
    d.servers = mergeServers(d.servers || [], remote.servers || [], { deleted: p.deletedServers }).servers;
    writeJSON(paths.file('servers.json'), d);
  }
  util().writeJSON(prefsFile(), { ...prefs(), lastPull: Date.now() });
  return syncState();
}
/** Brings a backup from the sync folder into this PC's backups (to restore it with restore()). */
function importSyncBackup(name) {
  const p = needSync();
  const n = path.basename(String(name));
  const from = path.join(p.syncDir, 'backups', n);
  if (!/^astra-backup-.+\.zip$/.test(n) || !fs.existsSync(from)) throw new Error('That backup isn’t in the sync folder.');
  fs.mkdirSync(dir(), { recursive: true });
  fs.copyFileSync(from, path.join(dir(), n));
  return listBackups();
}
/** Remember a server deleted here, so pulling doesn't bring it back. */
function noteDeletedServer(address) { const p = prefs(); p.deletedServers = [...new Set([...(p.deletedServers || []), String(address).toLowerCase()])].slice(-500); util().writeJSON(prefsFile(), p); }

let timer = null;
let first = null, ticking = false;
function init() {
  if (timer) return;
  const tick = async () => {
    if (ticking) return; // a slow backup is still being written
    const p = prefs();
    if (!p.auto || Date.now() - (p.lastAuto || 0) < p.everyHours * 3600e3) return;
    ticking = true;
    try {
      await create({ kind: 'auto' });
      if (p.syncDir && fs.existsSync(p.syncDir)) await syncPush({ withBackup: true });
    } catch (e) { require('./notify').add({ category: 'backup', title: 'Automatic backup failed', body: e.message, key: 'eco-backup-fail' }); }
    finally {
      // a failure waits for the next period too, instead of retrying (and alerting) every half hour
      try { util().writeJSON(prefsFile(), { ...prefs(), lastAuto: Date.now() }); } catch {}
      ticking = false;
    }
  };
  first = setTimeout(tick, 60000); first.unref?.();
  timer = setInterval(tick, 30 * 60000); timer.unref?.();
}
function shutdown() { clearTimeout(first); clearInterval(timer); timer = null; }

module.exports = { stripSecrets, mergeServers, planRestore, SYNC_SETTINGS, prefs, setPrefs, listBackups, create, preview, restore, remove, syncState, syncPush, syncPreview, syncPull, importSyncBackup, noteDeletedServer, init, shutdown };
