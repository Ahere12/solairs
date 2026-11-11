// CurseForge: search, project details, file browsing, installs (with dependencies) and modpacks.
// The CurseForge API needs a personal API key (free, from console.curseforge.com). Players paste it in
// Settings → Integrations; Solaris never ships someone else's key.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { paths, getJSON, download, downloadAll, push } = require('./util');
const settings = require('./settings');
const instances = require('./instances');

const API = 'https://api.curseforge.com/v1';
const GAME = 432; // Minecraft
const CLASS = { mod: 6, modpack: 4471, resourcepack: 12, shader: 6552, datapack: 6945 };
const CLASS_DIR = { 6: 'mods', 12: 'resourcepacks', 6552: 'shaderpacks' };
const LOADER = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const SORT = { relevance: 1, downloads: 6, follows: 2, newest: 11, updated: 3 };

const key = () => String(settings.get().curseforgeKey || '').trim();
const available = () => !!key();
function cf(url, opts = {}) {
  if (!key()) throw new Error('Add your CurseForge API key in Settings → Integrations to use CurseForge.');
  return getJSON(API + url, { ...opts, headers: { Accept: 'application/json', 'x-api-key': key(), ...(opts.headers || {}) } });
}
const post = (url, body) => cf(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Normalise a CurseForge mod into the same shape the UI uses for Modrinth hits. */
function hit(m) {
  return {
    source: 'curseforge', project_id: String(m.id), slug: m.slug, title: m.name, description: m.summary, author: m.authors?.[0]?.name || '',
    icon_url: m.logo?.thumbnailUrl || m.logo?.url || null, downloads: m.downloadCount || 0, follows: m.thumbsUpCount || 0,
    date_modified: m.dateModified, categories: (m.categories || []).map((c) => c.name), classId: m.classId,
    project_type: Object.keys(CLASS).find((k) => CLASS[k] === m.classId) || 'mod',
    gallery: (m.screenshots || []).map((s) => s.url), url: m.links?.websiteUrl || null,
  };
}

async function search({ query = '', type = 'mod', gameVersion, loader, sort = 'relevance', offset = 0, limit = 24 }) {
  const q = new URLSearchParams({ gameId: String(GAME), classId: String(CLASS[type] || 6), searchFilter: query, sortField: String(SORT[sort] || 1), sortOrder: 'desc', pageSize: String(limit), index: String(offset) });
  if (gameVersion) q.set('gameVersion', gameVersion);
  if (loader && LOADER[loader] && (type === 'mod' || type === 'modpack')) q.set('modLoaderType', String(LOADER[loader]));
  const r = await cf('/mods/search?' + q);
  return { hits: r.data.map(hit), total_hits: Math.min(r.pagination?.totalCount || 0, 10000), offset, limit };
}
async function project(id) {
  const [m, desc] = await Promise.all([cf(`/mods/${id}`), cf(`/mods/${id}/description`).catch(() => ({ data: '' }))]);
  return { ...hit(m.data), body_html: desc.data || '' };
}
async function files(id, { gameVersion, loader } = {}) {
  const q = new URLSearchParams({ pageSize: '50' });
  if (gameVersion) q.set('gameVersion', gameVersion);
  if (loader && LOADER[loader]) q.set('modLoaderType', String(LOADER[loader]));
  const r = await cf(`/mods/${id}/files?${q}`);
  return r.data.map((f) => ({
    id: String(f.id), name: f.displayName, file: f.fileName, date: f.fileDate, downloads: f.downloadCount,
    type: f.releaseType === 1 ? 'release' : f.releaseType === 2 ? 'beta' : 'alpha',
    gameVersions: (f.gameVersions || []).filter((v) => /^\d/.test(v)), loaders: (f.gameVersions || []).filter((v) => /^[A-Za-z]/.test(v)).map((v) => v.toLowerCase()),
    downloadable: !!f.downloadUrl,
  }));
}
/** CurseForge hides the download URL for some authors' files; their CDN path is predictable from the file id. */
function urlOf(f) {
  if (f.downloadUrl) return f.downloadUrl;
  const id = String(f.id);
  return `https://edge.forgecdn.net/files/${id.slice(0, 4)}/${+id.slice(4)}/${encodeURIComponent(f.fileName)}`;
}
const sha1Of = (f) => (f.hashes || []).find((h) => h.algo === 1)?.value;

function recordFile(inst) { return path.join(paths.instances(), inst.id, 'curseforge.json'); }
function readRecord(inst) { try { return JSON.parse(fs.readFileSync(recordFile(inst), 'utf8')); } catch { return {}; } }
function writeRecord(inst, r) { fs.writeFileSync(recordFile(inst), JSON.stringify(r, null, 2)); }

async function bestFile(modId, inst) {
  const loader = inst.loader?.type;
  const list = (await cf(`/mods/${modId}/files?` + new URLSearchParams({ gameVersion: inst.versionId, pageSize: '50', ...(LOADER[loader] ? { modLoaderType: String(LOADER[loader]) } : {}) }))).data;
  return list.find((f) => f.releaseType === 1) || list[0] || null;
}

/** Install a CurseForge file (or the best file for the instance) plus required dependencies. */
async function install(instanceId, { projectId, fileId, world } = {}, seen = new Set()) {
  const inst = instances.get(instanceId);
  if (seen.has(String(projectId))) return [];
  seen.add(String(projectId));
  const mod = (await cf(`/mods/${projectId}`)).data;
  const f = fileId ? (await cf(`/mods/${projectId}/files/${fileId}`)).data : await bestFile(projectId, inst);
  if (!f) throw new Error(`${mod.name} has no file for Minecraft ${inst.versionId}${inst.loader.type !== 'vanilla' ? ' / ' + inst.loader.type : ''}`);
  if (mod.classId === CLASS.modpack) throw new Error('This is a modpack — install it from Browse → Modpacks.');
  let dir = path.join(inst.gameDir, CLASS_DIR[mod.classId] || 'mods');
  if (mod.classId === CLASS.datapack) {
    if (!world) throw new Error('Choose a world to install the datapack into');
    dir = path.join(inst.gameDir, 'saves', world, 'datapacks');
  }
  const record = readRecord(inst);
  const prev = record[String(projectId)];
  if (prev?.file && prev.file !== f.fileName) { for (const n of [prev.file, prev.file + '.disabled']) try { fs.rmSync(path.join(dir, n), { force: true }); } catch {} }
  await download(urlOf(f), path.join(dir, f.fileName), { sha1: sha1Of(f) });
  try { fs.rmSync(path.join(dir, f.fileName + '.disabled'), { force: true }); } catch {}
  record[String(projectId)] = { file: f.fileName, fileId: String(f.id), name: mod.name, type: Object.keys(CLASS).find((k) => CLASS[k] === mod.classId) || 'mod' };
  writeRecord(inst, record);
  const out = [{ projectId: String(projectId), file: f.fileName, version: f.displayName }];
  for (const d of f.dependencies || []) {
    if (d.relationType !== 3) continue; // 3 = required
    const have = record[String(d.modId)];
    if (have && fs.existsSync(path.join(dir, have.file))) continue;
    try { out.push(...(await install(instanceId, { projectId: d.modId }, seen))); }
    catch (e) { push('toast', { type: 'warn', text: 'Dependency could not be installed: ' + e.message }); }
  }
  return out;
}

/** Modpacks: from a CurseForge file id, or a local CurseForge export (.zip with manifest.json). */
async function installModpack({ projectId, fileId, file }) {
  let created = null;
  try {
    let zipPath = file, name, iconUrl;
    if (!zipPath) {
      const mod = (await cf(`/mods/${projectId}`)).data;
      const f = fileId ? (await cf(`/mods/${projectId}/files/${fileId}`)).data : (await cf(`/mods/${projectId}/files?pageSize=1`)).data[0];
      if (!f) throw new Error('This modpack has no files.');
      name = mod.name; iconUrl = mod.logo?.thumbnailUrl || null;
      zipPath = path.join(paths.cache(), 'modpacks', f.fileName);
      push('task', { id: 'modpack', label: `Downloading ${f.fileName}`, progress: null });
      await download(urlOf(f), zipPath, { sha1: sha1Of(f) });
    }
    let zip, man;
    try { zip = new AdmZip(zipPath); man = JSON.parse(zip.readAsText('manifest.json')); } catch { throw new Error('This file is not a CurseForge modpack (manifest.json missing).'); }
    if (!man.minecraft?.version) throw new Error('This CurseForge modpack has no Minecraft version.');
    const primary = (man.minecraft.modLoaders || []).find((l) => l.primary) || man.minecraft.modLoaders?.[0];
    const [ltype, ...lrest] = String(primary?.id || 'vanilla').split('-');
    const type = ['forge', 'fabric', 'quilt', 'neoforge'].includes(ltype) ? ltype : 'vanilla';
    let lver = lrest.join('-') || null;
    if (type === 'forge' && lver) lver = `${man.minecraft.version}-${lver}`;
    const inst = instances.create({ name: name || man.name || 'CurseForge modpack', versionId: man.minecraft.version, loader: { type, version: lver }, icon: iconUrl,
      extra: { modpack: { name: man.name, version: man.version || '', source: 'curseforge', projectId: projectId ? String(projectId) : (man.projectID ? String(man.projectID) : null), fileId: fileId ? String(fileId) : null } } });
    created = inst;
    const ids = (man.files || []).filter((f) => f.required !== false).map((f) => f.fileID);
    const meta = ids.length ? (await post('/mods/files', { fileIds: ids })).data : [];
    const mods = ids.length ? Object.fromEntries((await post('/mods', { modIds: [...new Set(meta.map((f) => f.modId))] })).data.map((m) => [m.id, m])) : {};
    const record = {};
    const tasks = meta.map((f) => {
      const dir = CLASS_DIR[mods[f.modId]?.classId] || 'mods';
      record[String(f.modId)] = { file: f.fileName, fileId: String(f.id), name: mods[f.modId]?.name, type: 'mod', pack: true };
      return { url: urlOf(f), path: path.join(inst.gameDir, dir, f.fileName), sha1: sha1Of(f), size: f.fileLength };
    });
    await downloadAll(tasks, { concurrency: 8, onProgress: (d, t) => push('task', { id: 'modpack', label: `Installing ${man.name}`, progress: d / t, detail: `${d}/${t} files` }) });
    const over = (man.overrides || 'overrides').replace(/\/$/, '') + '/';
    const root = path.resolve(inst.gameDir);
    for (const e of zip.getEntries()) {
      if (e.isDirectory || !e.entryName.startsWith(over)) continue;
      const out = path.resolve(root, e.entryName.slice(over.length));
      if (!out.startsWith(root + path.sep)) continue;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, e.getData());
    }
    writeRecord(inst, record);
    return inst;
  } catch (e) {
    if (created) { try { await instances.remove(created.id); } catch {} }
    throw e;
  } finally {
    push('task', { id: 'modpack', done: true });
  }
}
async function modpackVersions(instanceId) {
  const inst = instances.get(instanceId);
  const pid = inst.modpack?.projectId;
  if (!pid) return { updatable: false, reason: 'This modpack was imported from a file, so Solaris doesn’t know where to look for updates.' };
  const list = (await cf(`/mods/${pid}/files?pageSize=50`)).data;
  return { updatable: true, projectId: pid, current: inst.modpack.fileId, versions: list.map((f) => ({ id: String(f.id), name: f.displayName, number: f.displayName, type: f.releaseType === 1 ? 'release' : f.releaseType === 2 ? 'beta' : 'alpha', date: f.fileDate, gameVersions: (f.gameVersions || []).filter((v) => /^\d/.test(v)) })) };
}
/** Switch a CurseForge modpack instance to another file. Pack files are tracked in curseforge.json (pack: true). */
async function updateModpack(instanceId, fileId) {
  const inst = instances.get(instanceId);
  const pid = inst.modpack?.projectId;
  if (!pid) throw new Error('Solaris doesn’t know which CurseForge project this modpack came from.');
  push('task', { id: 'modpack', label: `Updating ${inst.name}`, progress: null });
  try {
    const f = (await cf(`/mods/${pid}/files/${fileId}`)).data;
    const zipPath = path.join(paths.cache(), 'modpacks', f.fileName);
    await download(urlOf(f), zipPath, { sha1: sha1Of(f) });
    const zip = new AdmZip(zipPath);
    const man = JSON.parse(zip.readAsText('manifest.json'));
    const ids = (man.files || []).filter((x) => x.required !== false).map((x) => x.fileID);
    const meta = ids.length ? (await post('/mods/files', { fileIds: ids })).data : [];
    const mods = meta.length ? Object.fromEntries((await post('/mods', { modIds: [...new Set(meta.map((x) => x.modId))] })).data.map((m) => [m.id, m])) : {};
    const record = readRecord(inst);
    const root = path.resolve(inst.gameDir);
    const keepIds = new Set(meta.map((x) => String(x.modId)));
    for (const [mid, r] of Object.entries(record)) {
      if (!r.pack) continue;
      const nf = meta.find((x) => String(x.modId) === mid);
      if (keepIds.has(mid) && nf?.fileName === r.file) continue;
      for (const d of ['mods', 'resourcepacks', 'shaderpacks']) for (const n of [r.file, r.file + '.disabled']) try { fs.rmSync(path.join(root, d, n), { force: true }); } catch {}
      delete record[mid];
    }
    const tasks = meta.map((x) => {
      const dir = CLASS_DIR[mods[x.modId]?.classId] || 'mods';
      record[String(x.modId)] = { file: x.fileName, fileId: String(x.id), name: mods[x.modId]?.name, type: 'mod', pack: true };
      return { url: urlOf(x), path: path.join(root, dir, x.fileName), sha1: sha1Of(x), size: x.fileLength };
    }).filter((t) => !fs.existsSync(t.path + '.disabled'));
    await downloadAll(tasks, { concurrency: 8, onProgress: (d, t) => push('task', { id: 'modpack', label: `Updating ${inst.name}`, progress: d / t, detail: `${d}/${t} files` }) });
    const over = (man.overrides || 'overrides').replace(/\/$/, '') + '/';
    const KEEP = /^(options\.txt|optionsof\.txt|servers\.dat|saves\/)/i;
    for (const e of zip.getEntries()) {
      if (e.isDirectory || !e.entryName.startsWith(over)) continue;
      const rel = e.entryName.slice(over.length);
      const out = path.resolve(root, rel);
      if (!out.startsWith(root + path.sep) || (KEEP.test(rel) && fs.existsSync(out))) continue;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, e.getData());
    }
    writeRecord(inst, record);
    const primary = (man.minecraft.modLoaders || []).find((l) => l.primary) || man.minecraft.modLoaders?.[0];
    const [lt, ...lr] = String(primary?.id || 'vanilla').split('-');
    const type = ['forge', 'fabric', 'quilt', 'neoforge'].includes(lt) ? lt : 'vanilla';
    let lv = lr.join('-') || null;
    if (type === 'forge' && lv) lv = `${man.minecraft.version}-${lv}`;
    const changed = man.minecraft.version !== inst.versionId || type !== inst.loader?.type || lv !== inst.loader?.version;
    return instances.save({ ...instances.get(instanceId), versionId: man.minecraft.version, loader: { type, version: lv }, launchVersionId: changed ? null : inst.launchVersionId, modpack: { ...inst.modpack, fileId: String(fileId), version: man.version || f.displayName } });
  } finally {
    push('task', { id: 'modpack', done: true });
  }
}
const isCurseForgePack = (file) => { try { return !!new AdmZip(file).getEntry('manifest.json'); } catch { return false; } };

module.exports = { available, search, project, files, install, installModpack, modpackVersions, updateModpack, isCurseForgePack, readRecord };
