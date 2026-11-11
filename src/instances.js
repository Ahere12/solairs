// Instances: create/duplicate/export, content (mods, packs, shaders), worlds, screenshots.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { shell } = require('electron');
const { paths, readJSON, writeJSON, slugify, sha1File } = require('./util');

const CONTENT_DIRS = { mods: 'mods', resourcepacks: 'resourcepacks', shaderpacks: 'shaderpacks', datapacks: 'datapacks' };
const instFile = (id) => path.join(paths.instances(), id, 'instance.json');

function gameDir(inst) {
  return inst.externalGameDir || path.join(paths.instances(), inst.id, 'minecraft');
}
function list() {
  let dirs = []; try { dirs = fs.readdirSync(paths.instances()); } catch {}
  return dirs.map((d) => readJSON(path.join(paths.instances(), d, 'instance.json'), null)).filter(Boolean)
    .map((i) => ({ ...i, gameDir: gameDir(i) }));
}
function get(id) {
  const i = readJSON(instFile(id), null);
  if (!i) throw new Error('Instance not found: ' + id);
  return { ...i, gameDir: gameDir(i) };
}
function save(inst) {
  const { gameDir: _g, running: _r, ...clean } = inst;
  writeJSON(instFile(inst.id), clean);
  return get(inst.id);
}
function uniqueId(name) {
  const base = slugify(name);
  let id = base, n = 2;
  while (fs.existsSync(path.join(paths.instances(), id))) id = `${base}-${n++}`;
  return id;
}
function create({ name, versionId, loader = { type: 'vanilla' }, icon = null, group = '', extra = {} }) {
  if (!name || !versionId) throw new Error('Name and version are required');
  const id = uniqueId(name);
  const inst = {
    id, name, icon, group, versionId,
    loader: { type: loader.type || 'vanilla', version: loader.version || null },
    launchVersionId: null,
    created: Date.now(), lastPlayed: 0, playTime: 0, pinned: false,
    memory: null, jvmArgs: '', javaPath: '', resolution: null,
    ...extra,
  };
  fs.mkdirSync(path.join(paths.instances(), id, 'minecraft'), { recursive: true });
  return save(inst);
}
function update(id, patch) {
  const inst = get(id);
  const next = { ...inst, ...patch };
  // Changing version or loader requires re-resolving the launch version.
  if (patch.versionId || patch.loader) next.launchVersionId = null;
  return save(next);
}
async function remove(id) {
  const dir = path.join(paths.instances(), id);
  try { await shell.trashItem(dir); } catch { fs.rmSync(dir, { recursive: true, force: true }); }
  return true;
}
function duplicate(id, { name, include = ['mods', 'config', 'resourcepacks', 'shaderpacks', 'saves', 'options.txt'] } = {}) {
  const src = get(id);
  const copy = create({ name: name || `${src.name} (copy)`, versionId: src.versionId, loader: src.loader, icon: src.icon, group: src.group,
    extra: { memory: src.memory, jvmArgs: src.jvmArgs, javaPath: src.javaPath, resolution: src.resolution, solarisModules: src.solarisModules } });
  const from = gameDir(src), to = gameDir(copy);
  for (const item of include) {
    const s = path.join(from, item);
    if (fs.existsSync(s)) fs.cpSync(s, path.join(to, item), { recursive: true });
  }
  return copy;
}

// ---------- content ----------
const metaCache = new Map();
function readModMeta(file) {
  const st = fs.statSync(file);
  const key = `${file}:${st.size}:${st.mtimeMs}`;
  if (metaCache.has(key)) return metaCache.get(key);
  let meta = {};
  try {
    const zip = new AdmZip(file);
    const txt = (n) => { const e = zip.getEntry(n); return e ? zip.readAsText(e) : null; };
    const iconData = (p) => {
      if (!p) return null;
      const e = zip.getEntry(String(p).replace(/^\//, ''));
      if (!e || e.header.size > 512 * 1024) return null;
      return 'data:image/png;base64,' + e.getData().toString('base64');
    };
    const fab = txt('fabric.mod.json');
    const quilt = txt('quilt.mod.json');
    const toml = txt('META-INF/neoforge.mods.toml') || txt('META-INF/mods.toml');
    const mcmod = txt('mcmod.info');
    const pack = txt('pack.mcmeta');
    if (fab) {
      const j = JSON.parse(fab.replace(/[\u0000-\u001f]+/g, ' '));
      const icon = typeof j.icon === 'string' ? j.icon : j.icon && Object.values(j.icon).pop();
      meta = { modId: j.id, name: j.name || j.id, version: j.version, description: j.description, authors: (j.authors || []).map((a) => a.name || a), icon: iconData(icon) };
    } else if (quilt) {
      const j = JSON.parse(quilt).quilt_loader || {};
      const md = j.metadata || {};
      meta = { modId: j.id, name: md.name || j.id, version: j.version, description: md.description, icon: iconData(typeof md.icon === 'string' ? md.icon : null) };
    } else if (toml) {
      const g = (k) => (toml.match(new RegExp(`^\\s*${k}\\s*=\\s*"([^"]*)"`, 'm')) || [])[1];
      const ver = g('version');
      meta = { modId: g('modId'), name: g('displayName') || g('modId'), version: ver === '${file.jarVersion}' ? null : ver, description: g('description'), icon: iconData(g('logoFile')) };
    } else if (mcmod) {
      const j = JSON.parse(mcmod.replace(/[\u0000-\u001f]+/g, ' '));
      const m = Array.isArray(j) ? j[0] : (j.modList || [])[0];
      if (m) meta = { modId: m.modid, name: m.name, version: m.version, description: m.description, icon: iconData(m.logoFile) };
    } else if (pack) {
      let desc = ''; try { const d = JSON.parse(pack).pack?.description; desc = typeof d === 'string' ? d : (d?.text || ''); } catch {}
      meta = { description: desc, icon: iconData('pack.png') };
    }
  } catch {}
  metaCache.set(key, meta);
  return meta;
}
function listContent(id, kind = 'mods') {
  const dir = path.join(gameDir(get(id)), CONTENT_DIRS[kind] || kind);
  let files = []; try { files = fs.readdirSync(dir, { withFileTypes: true }); } catch {}
  return files
    .filter((f) => f.isFile() && /\.(jar|zip|disabled|litemod)$/i.test(f.name) || (f.isDirectory() && kind !== 'mods'))
    .map((f) => {
      const full = path.join(dir, f.name);
      const st = fs.statSync(full);
      const enabled = !f.name.endsWith('.disabled');
      const meta = f.isFile() ? readModMeta(full) : {};
      return { file: f.name, path: full, enabled, size: st.size, mtime: st.mtimeMs, dir: f.isDirectory(), ...meta, name: meta.name || f.name.replace(/\.disabled$/, '').replace(/\.(jar|zip)$/i, '') };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
function setEnabled(id, kind, files, enabled) {
  const dir = path.join(gameDir(get(id)), CONTENT_DIRS[kind] || kind);
  for (const f of files) {
    const cur = path.join(dir, f);
    if (!fs.existsSync(cur)) continue;
    const isOff = f.endsWith('.disabled');
    if (enabled && isOff) fs.renameSync(cur, cur.replace(/\.disabled$/, ''));
    if (!enabled && !isOff) fs.renameSync(cur, cur + '.disabled');
  }
  return listContent(id, kind);
}
async function deleteContent(id, kind, files) {
  const dir = path.join(gameDir(get(id)), CONTENT_DIRS[kind] || kind);
  for (const f of files) {
    const full = path.join(dir, f);
    try { await shell.trashItem(full); } catch { fs.rmSync(full, { recursive: true, force: true }); }
  }
  return listContent(id, kind);
}
function guessKind(file) {
  if (/\.jar$/i.test(file)) return 'mods';
  if (/\.zip$/i.test(file)) {
    try {
      const zip = new AdmZip(file);
      if (zip.getEntries().some((e) => /^shaders\//.test(e.entryName))) return 'shaderpacks';
      if (zip.getEntry('pack.mcmeta') && zip.getEntries().some((e) => /^data\//.test(e.entryName))) return 'datapacks';
    } catch {}
    return 'resourcepacks';
  }
  return null;
}
/** Copy dropped / picked files into the instance. Returns counts per kind. */
function addFiles(id, files, forcedKind) {
  const inst = get(id);
  const added = {};
  for (const f of files) {
    const kind = forcedKind || guessKind(f);
    if (!kind) continue;
    const dir = path.join(gameDir(inst), CONTENT_DIRS[kind]);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(f, path.join(dir, path.basename(f)));
    added[kind] = (added[kind] || 0) + 1;
  }
  return added;
}
/** Mods sharing the same mod id. */
function duplicates(id) {
  const mods = listContent(id, 'mods').filter((m) => m.modId && m.enabled);
  const by = {};
  for (const m of mods) (by[m.modId] = by[m.modId] || []).push(m);
  return Object.entries(by).filter(([, v]) => v.length > 1).map(([modId, v]) => ({ modId, files: v.map((m) => ({ file: m.file, version: m.version, mtime: m.mtime })) }));
}

// ---------- heuristic malware scan ----------
const IOCS = [
  { re: /discord(app)?\.com\/api\/webhooks/i, label: 'Discord webhook URL (common in token/session stealers)' },
  { re: /85\.217\.144\.130|107\.189\.3\.101|files-8ie\.pages\.dev|skyrage\.de/i, label: 'Known fractureiser malware indicator' },
  { re: /dev\/neko/i, label: 'Known fractureiser package (dev/neko)' },
  { re: /Login Data|Local State|\\Discord\\Local Storage|leveldb.*tokens?/i, label: 'Reads browser/Discord credential stores' },
  { re: /api\.telegram\.org\/bot/i, label: 'Telegram bot exfiltration URL' },
];
function scan(id) {
  const results = [];
  for (const m of listContent(id, 'mods')) {
    if (m.dir) continue;
    const findings = new Set();
    try {
      const zip = new AdmZip(m.path);
      for (const e of zip.getEntries()) {
        if (!/\.(class|json|txt|properties)$/i.test(e.entryName) || e.header.size > 4 * 1024 * 1024) continue;
        const s = e.getData().toString('latin1');
        for (const ioc of IOCS) if (ioc.re.test(s)) findings.add(ioc.label);
      }
    } catch { findings.add('Could not read archive (corrupt or not a jar)'); }
    results.push({ file: m.file, name: m.name, findings: [...findings], ok: findings.size === 0 });
  }
  return results;
}

// ---------- worlds & screenshots ----------
function worlds(id) {
  const dir = path.join(gameDir(get(id)), 'saves');
  let ds = []; try { ds = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch {}
  return ds.map((d) => {
    const full = path.join(dir, d.name);
    const icon = path.join(full, 'icon.png');
    let mtime = 0; try { mtime = fs.statSync(path.join(full, 'level.dat')).mtimeMs; } catch { try { mtime = fs.statSync(full).mtimeMs; } catch {} }
    return { name: d.name, path: full, icon: fs.existsSync(icon) ? 'data:image/png;base64,' + fs.readFileSync(icon).toString('base64') : null, lastPlayed: mtime };
  }).sort((a, b) => b.lastPlayed - a.lastPlayed);
}
function screenshots() {
  const out = [];
  for (const inst of list()) {
    const dir = path.join(inst.gameDir, 'screenshots');
    let fsl = []; try { fsl = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f)); } catch {}
    for (const f of fsl) {
      const full = path.join(dir, f);
      out.push({ instanceId: inst.id, instanceName: inst.name, file: f, path: full, url: 'file:///' + full.replace(/\\/g, '/'), mtime: fs.statSync(full).mtimeMs });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

// ---------- share / export ----------
function exportPack(id, dest, include = ['mods', 'config', 'resourcepacks', 'shaderpacks', 'options.txt']) {
  const inst = get(id);
  const zip = new AdmZip();
  const { gameDir: _g, ...meta } = inst;
  zip.addFile('solaris.json', Buffer.from(JSON.stringify({ format: 1, instance: { ...meta, playTime: 0, lastPlayed: 0, externalGameDir: undefined } }, null, 2)));
  for (const item of include) {
    const full = path.join(gameDir(inst), item);
    if (!fs.existsSync(full)) continue;
    if (fs.statSync(full).isDirectory()) zip.addLocalFolder(full, 'minecraft/' + item);
    else zip.addLocalFile(full, 'minecraft/');
  }
  zip.writeZip(dest);
  return dest;
}
function importPack(file) {
  const zip = new AdmZip(file);
  const meta = JSON.parse(zip.readAsText('solaris.json')).instance;
  const inst = create({ name: meta.name, versionId: meta.versionId, loader: meta.loader, icon: meta.icon,
    extra: { memory: meta.memory, jvmArgs: meta.jvmArgs, solarisModules: meta.solarisModules } });
  const root = path.join(paths.instances(), inst.id);
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !e.entryName.startsWith('minecraft/')) continue;
    const out = path.resolve(root, e.entryName);
    if (!out.startsWith(path.resolve(root) + path.sep)) continue; // zip-slip guard
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, e.getData());
  }
  return inst;
}

module.exports = { CONTENT_DIRS, list, get, save, create, update, remove, duplicate, gameDir, listContent, setEnabled, deleteContent, addFiles, duplicates, scan, worlds, screenshots, exportPack, importPack, readModMeta, sha1File, uniqueId };
