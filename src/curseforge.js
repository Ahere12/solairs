// CurseForge: search, project details, file browsing, installs (with dependencies) and modpacks.
// The CurseForge API needs a personal API key (free, from console.curseforge.com). Players paste it in
// Settings → Integrations; Astra never ships someone else's key.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { paths, getJSON, download, downloadAll, push } = require('./util');
const settings = require('./settings');
const instances = require('./instances');

const API = 'https://api.curseforge.com/v1';
const GAME = 432; // Minecraft
const CLASS = { mod: 6, modpack: 4471, resourcepack: 12, shader: 6552, datapack: 6945, world: 17, customization: 4546, plugin: 5 }; // plugin = Bukkit plugins (hosted Paper/Purpur servers) // world = maps (Astra Discover)
const CLASS_DIR = { 6: 'mods', 12: 'resourcepacks', 6552: 'shaderpacks' };
const LOADER = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const SORT = { relevance: 2, downloads: 6, follows: 2, newest: 11, updated: 3 };

const key = () => settings.curseforgeKey(); // sealed in settings.json, main process only
const available = () => !!key();
/** A CurseForge error in words a player understands (never contains the key). */
function cfError(e, url) {
  const m = String(e?.message || e);
  const code = +(m.match(/HTTP (\d{3})/) || [])[1];
  const err = (text, kind) => Object.assign(new Error(text), { cfKind: kind, status: code || null });
  if (code === 401 || code === 403) return err('CurseForge didn’t accept the API key (HTTP ' + code + '). Check it in Settings → Integrations → CurseForge.', 'auth');
  if (code === 404) return err(/\/files\//.test(url) ? 'That CurseForge file no longer exists (it was deleted or made private).' : 'That CurseForge project no longer exists (it was deleted or made private).', 'missing');
  if (code === 429) return err('CurseForge asked Astra to slow down — try again in a minute.', 'rate');
  if (code >= 500) return err('CurseForge is having problems right now (HTTP ' + code + '). Try again later.', 'down');
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|timeout|aborted/i.test(m)) return err('Couldn’t reach CurseForge — check your internet connection.', 'network');
  return err('CurseForge: ' + m.replace(/https?:\/\/\S+/g, '').slice(0, 160), 'other');
}
async function cf(url, opts = {}) {
  const k = key();
  if (!k) throw Object.assign(new Error('CurseForge isn’t connected yet — add the API key in Settings → Integrations → CurseForge.'), { cfKind: 'nokey' });
  try { return await getJSON(API + url, { ...opts, headers: { Accept: 'application/json', 'x-api-key': k, ...(opts.headers || {}) } }); }
  catch (e) { throw cfError(e, url); }
}
/** Checks the saved key against the real API. { ok, configured, error, kind } */
async function test(candidate) {
  const k = candidate != null ? String(candidate).replace(/^\s+|\s+$/g, '') : key();
  if (!k) return { ok: false, configured: false, kind: 'nokey', error: 'No CurseForge API key saved.' };
  try {
    const r = await getJSON(API + '/games/' + GAME, { headers: { Accept: 'application/json', 'x-api-key': k } });
    return r?.data?.id === GAME ? { ok: true, configured: true } : { ok: false, configured: true, kind: 'other', error: 'CurseForge answered, but not with Minecraft’s game info.' };
  } catch (e) { const x = cfError(e, '/games'); return { ok: false, configured: true, kind: x.cfKind, error: x.message }; }
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

async function search({ query = '', type = 'mod', gameVersion, loader, categoryId, sort = 'relevance', offset = 0, limit = 24 }) {
  const q = new URLSearchParams({ gameId: String(GAME), classId: String(CLASS[type] || 6), searchFilter: query, sortField: String(SORT[sort] || 1), sortOrder: 'desc', pageSize: String(limit), index: String(offset) });
  if (gameVersion) q.set('gameVersion', gameVersion);
  if (loader && LOADER[loader] && (type === 'mod' || type === 'modpack')) q.set('modLoaderType', String(LOADER[loader]));
  if (/^\d{1,9}$/.test(String(categoryId || ''))) q.set('categoryId', String(categoryId));
  const r = await cf('/mods/search?' + q);
  return { hits: r.data.map(hit), total_hits: Math.min(r.pagination?.totalCount || 0, 10000), offset, limit };
}
/** Top-level CurseForge categories for a content type (cached for the session): [{ id, name }]. */
const catCache = new Map();
async function categories(type = 'mod') {
  const classId = CLASS[type] || 6;
  if (!catCache.has(classId)) {
    catCache.set(classId, cf('/categories?' + new URLSearchParams({ gameId: String(GAME), classId: String(classId) }))
      .then((r) => (r.data || []).filter((c) => c.parentCategoryId === classId).map((c) => ({ id: c.id, name: c.name, icon: c.iconUrl || null })).sort((a, b) => a.name.localeCompare(b.name)))
      .catch((e) => { catCache.delete(classId); throw e; }));
  }
  return catCache.get(classId);
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
/**
 * The download link CurseForge gives apps. An author can turn third-party downloads off: then downloadUrl is null and
 * the file may only be downloaded from the CurseForge website — Astra respects that and never builds a CDN link itself.
 */
function urlOf(f, mod) {
  if (f.downloadUrl) return f.downloadUrl;
  throw Object.assign(new Error(`${mod?.name || f.displayName || f.fileName}: the author only allows downloads from the CurseForge website. Download it there, then add it to the instance (drag the file onto the instance page).`), { cfKind: 'restricted', page: pageOf(f, mod) });
}
/** The CurseForge web page where a file can be downloaded by hand. */
function pageOf(f, mod) {
  const slug = mod?.slug, base = mod?.links?.websiteUrl || (slug ? `https://www.curseforge.com/minecraft/${{ 6: 'mc-mods', 4471: 'modpacks', 12: 'texture-packs', 6552: 'shaders' }[mod.classId] || 'mc-mods'}/${slug}` : null);
  return base ? `${base.replace(/\/$/, '')}/download/${f.id}` : `https://www.curseforge.com/api/v1/mods/${f.modId}/files/${f.id}/download`;
}
const safeName = (n) => path.basename(String(n || '')).replace(/[<>:"|?*\x00-\x1f]/g, '_');
const sha1Of = (f) => (f.hashes || []).find((h) => h.algo === 1)?.value;

function recordFile(inst) { return path.join(paths.instances(), inst.id, 'curseforge.json'); }
function readRecord(inst) { try { return JSON.parse(fs.readFileSync(recordFile(inst), 'utf8')); } catch { return {}; } }
function writeRecord(inst, r) { fs.writeFileSync(recordFile(inst), JSON.stringify(r, null, 2)); }

/**
 * Downloads a CurseForge file to `target`. Files the author keeps off the API come from Modrinth (same SHA-1) or
 * through CurseForge's website download instead of failing.
 */
async function getFile(f, mod, target) {
  if (f.downloadUrl) return download(f.downloadUrl, target, { sha1: sha1Of(f) });
  const sha1 = sha1Of(f);
  const mirror = sha1 ? (await modrinthMirror([sha1]))[sha1] : null;
  if (mirror) { try { return await download(mirror, target, { sha1 }); } catch {} }
  const r = await require('./cfweb').fetchFiles([{ name: mod?.name || f.fileName, file: f.fileName, sha1, modId: f.modId, fileId: f.id, page: pageOf(f, mod), target }], { label: `Getting ${mod?.name || f.fileName} from CurseForge` });
  if (r.still.length) urlOf(f, mod); // throws the "only on the website" error with the page link
}
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
  if (mod.classId === CLASS.world) return installMap(instanceId, { projectId, fileId: f.id });
  if (mod.classId === CLASS.customization) throw new Error('This is a customization download — open its page to see how to install it.');
  let dir = path.join(inst.gameDir, CLASS_DIR[mod.classId] || 'mods');
  if (mod.classId === CLASS.datapack) {
    if (!world) throw new Error('Choose a world to install the datapack into');
    dir = path.join(inst.gameDir, 'saves', world, 'datapacks');
  }
  const record = readRecord(inst);
  const prev = record[String(projectId)];
  if (prev?.file && prev.file !== f.fileName) { for (const n of [prev.file, prev.file + '.disabled']) try { fs.rmSync(path.join(dir, n), { force: true }); } catch {} }
  await getFile(f, mod, path.join(dir, safeName(f.fileName)));
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

// ---------- CurseForge modpacks ----------
// A CurseForge modpack export is a .zip with manifest.json (Minecraft version, loader, the project/file IDs of every
// mod) and an overrides/ folder (configs, resource packs, scripts…). Reading it needs no API key; downloading the mods
// it lists goes through the API (key needed). Files whose authors block third-party downloads are listed for the
// player to download from the CurseForge website — Astra then picks them up from the Downloads folder.

const MAX_ENTRIES = 50000, MAX_UNPACKED = 8 * 1024 ** 3; // a pack bigger than this is almost certainly a zip bomb

/** Opens and checks a CurseForge modpack .zip. Throws a clear error for anything that isn't one. */
function readPack(file) {
  let zip;
  try { zip = new AdmZip(file); } catch { throw new Error('This file isn’t a valid .zip (it may be damaged or still downloading).'); }
  const entries = zip.getEntries();
  if (entries.length > MAX_ENTRIES) throw new Error('This .zip has too many files to be a modpack.');
  const total = entries.reduce((t, e) => t + (e.header.size || 0), 0);
  if (total > MAX_UNPACKED) throw new Error('This .zip unpacks to more than 8 GB — Astra won’t open it.');
  const me = zip.getEntry('manifest.json');
  if (!me) throw new Error('This isn’t a CurseForge modpack: manifest.json is missing. (Download the modpack’s “export” .zip from CurseForge, not a single mod.)');
  let man;
  try { man = JSON.parse(zip.readAsText(me).replace(/^﻿/, '')); } catch { throw new Error('The modpack’s manifest.json is damaged.'); }
  if (man.manifestType && man.manifestType !== 'minecraftModpack') throw new Error('This manifest.json isn’t a Minecraft modpack.');
  if (!man.minecraft?.version) throw new Error('This CurseForge modpack doesn’t say which Minecraft version it needs.');
  const primary = (man.minecraft.modLoaders || []).find((l) => l.primary) || man.minecraft.modLoaders?.[0];
  const [ltype, ...lrest] = String(primary?.id || 'vanilla').split('-');
  const type = ['forge', 'fabric', 'quilt', 'neoforge'].includes(ltype) ? ltype : 'vanilla';
  let lver = lrest.join('-') || null;
  if (type === 'forge' && lver) lver = `${man.minecraft.version}-${lver}`;
  const files = (man.files || []).filter((f) => f && Number.isInteger(+f.projectID) && Number.isInteger(+f.fileID)).map((f) => ({ projectID: +f.projectID, fileID: +f.fileID, required: f.required !== false }));
  const over = String(man.overrides || 'overrides').replace(/^\/+|\/+$/g, '') + '/';
  const overrides = entries.filter((e) => !e.isDirectory && e.entryName.startsWith(over));
  const kinds = {};
  for (const e of overrides) { const top = e.entryName.slice(over.length).split('/')[0]; kinds[top] = (kinds[top] || 0) + 1; }
  return { zip, man, over, overrides, info: { name: String(man.name || 'CurseForge modpack').slice(0, 80), version: String(man.version || ''), author: String(man.author || ''), mc: man.minecraft.version, loader: { type, version: lver }, loaderId: primary?.id || 'vanilla', files: files.filter((f) => f.required).length, optional: files.filter((f) => !f.required).length, overrides: overrides.length, folders: kinds, projectID: man.projectID ? String(man.projectID) : null } };
}
/** What's inside a CurseForge modpack .zip — works without a CurseForge key. */
function inspectModpack(file) {
  const { info } = readPack(file);
  return { ...info, canDownload: available() };
}

/** Copies overrides/ into the instance; nothing can be written outside the instance folder. */
function copyOverrides(zip, over, overrides, gameDir) {
  const root = path.resolve(gameDir);
  let n = 0;
  for (const e of overrides) {
    const rel = e.entryName.slice(over.length);
    if (!rel || rel.includes('\0')) continue;
    const out = path.resolve(root, rel);
    if (!out.startsWith(root + path.sep)) continue; // ../ tricks: skipped
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, e.getData());
    n++;
  }
  return n;
}

/** Looks up the files a manifest lists: { meta: [files], mods: {modId: project}, gone: [{projectID,fileID}] } */
async function resolveFiles(list) {
  const ids = list.map((f) => f.fileID);
  const meta = [];
  for (let i = 0; i < ids.length; i += 500) meta.push(...((await post('/mods/files', { fileIds: ids.slice(i, i + 500) })).data || []));
  const modIds = [...new Set(meta.map((f) => f.modId))];
  const mods = {};
  for (let i = 0; i < modIds.length; i += 500) for (const m of (await post('/mods', { modIds: modIds.slice(i, i + 500) })).data || []) mods[m.id] = m;
  const found = new Set(meta.map((f) => f.id));
  return { meta, mods, gone: list.filter((f) => !found.has(f.fileID)) };
}

/** Modrinth download links for files with these SHA-1s: { [sha1]: url }. Empty when offline or none match. */
async function modrinthMirror(hashes) {
  if (!hashes.length) return {};
  try {
    const { getJSON } = require('./util');
    const res = await getJSON('https://api.modrinth.com/v2/version_files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hashes, algorithm: 'sha1' }) });
    const out = {};
    for (const [h, v] of Object.entries(res || {})) { const f = (v.files || []).find((x) => x.hashes?.sha1 === h); if (f) out[h] = f.url; }
    return out;
  } catch { return {}; }
}

const cancels = new Map(); // task id → AbortController
function cancelModpack() { for (const c of cancels.values()) c.abort(); return true; }

/**
 * Installs a CurseForge modpack: from a CurseForge project/file, or a local export .zip.
 * Returns the instance plus { installed, manual: [files to download by hand], gone: [deleted files] }.
 * Success is only reported for files that are really on disk with the right SHA-1.
 */
async function installModpack({ projectId, fileId, file }) {
  let created = null;
  const ctl = new AbortController(); cancels.set('modpack', ctl);
  const step = (label, progress = null, detail) => push('task', { id: 'modpack', label, progress, detail, cancellable: true });
  try {
    let zipPath = file, name, iconUrl;
    if (!zipPath) {
      const mod = (await cf(`/mods/${projectId}`)).data;
      const f = fileId ? (await cf(`/mods/${projectId}/files/${fileId}`)).data : (await cf(`/mods/${projectId}/files?pageSize=1`)).data[0];
      if (!f) throw new Error('This modpack has no files.');
      name = mod.name; iconUrl = mod.logo?.thumbnailUrl || null;
      zipPath = path.join(paths.cache(), 'modpacks', safeName(f.fileName));
      step(`Downloading ${f.fileName}`);
      await download(urlOf(f, mod), zipPath, { sha1: sha1Of(f), signal: ctl.signal });
    }
    const { zip, over, overrides, info, man } = readPack(zipPath);
    const required = (man.files || []).filter((f) => f && f.required !== false).map((f) => ({ projectID: +f.projectID, fileID: +f.fileID }));
    if (required.length && !available()) throw Object.assign(new Error(`“${info.name}” needs ${required.length} mods from CurseForge. Connect CurseForge (Settings → Integrations → CurseForge) and import it again.`), { cfKind: 'nokey' });
    step(`Reading ${info.name}`);
    const { meta, mods, gone } = required.length ? await resolveFiles(required) : { meta: [], mods: {}, gone: [] };
    const inst = instances.create({ name: name || info.name, versionId: info.mc, loader: info.loader, icon: iconUrl || mods[+projectId || +info.projectID]?.logo?.thumbnailUrl || null,
      extra: { modpack: { name: info.name, version: info.version, source: 'curseforge', projectId: projectId ? String(projectId) : info.projectID, fileId: fileId ? String(fileId) : null } } });
    created = inst;
    const record = {}, tasks = [], manual = [];
    // Files whose author turned third-party downloads off on CurseForge: the identical file (same SHA-1) is often
    // on Modrinth too — download it from there instead of asking the player to fetch it by hand.
    const mirror = await modrinthMirror(meta.filter((f) => !f.downloadUrl).map((f) => sha1Of(f)).filter(Boolean));
    for (const f of meta) {
      const m = mods[f.modId];
      const dir = CLASS_DIR[m?.classId] || 'mods', fname = safeName(f.fileName);
      const entry = { file: fname, fileId: String(f.id), name: m?.name || fname, type: dir === 'mods' ? 'mod' : dir === 'resourcepacks' ? 'resourcepack' : 'shader', pack: true };
      record[String(f.modId)] = entry;
      const target = path.join(inst.gameDir, dir, fname);
      const url = f.downloadUrl || mirror[sha1Of(f)];
      if (!url) { manual.push({ modId: f.modId, fileId: f.id, name: m?.name || fname, file: fname, dir, size: f.fileLength, sha1: sha1Of(f), page: pageOf(f, m) }); continue; }
      tasks.push({ url, path: target, sha1: sha1Of(f), size: f.fileLength, name: entry.name, signal: ctl.signal });
    }
    // downloads: 8 at a time, each retried by download(); one bad file doesn't stop the others
    const failed = [];
    let done = 0;
    const queue = [...tasks];
    const worker = async () => {
      while (queue.length) {
        if (ctl.signal.aborted) throw Object.assign(new Error('Modpack install cancelled.'), { cancelled: true });
        const t = queue.shift();
        try { await download(t.url, t.path, t); }
        catch (e) { if (ctl.signal.aborted) throw Object.assign(new Error('Modpack install cancelled.'), { cancelled: true }); failed.push({ name: t.name, file: path.basename(t.path), error: e.message }); }
        step(`Installing ${info.name}`, ++done / Math.max(1, tasks.length), `${done}/${tasks.length} files`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, tasks.length) }, worker));
    if (failed.length) throw new Error(`${failed.length} of ${tasks.length} mod${tasks.length === 1 ? '' : 's'} couldn’t be downloaded (${failed.slice(0, 3).map((x) => x.name).join(', ')}${failed.length > 3 ? '…' : ''}): ${failed[0].error}. Nothing was kept — try again.`);
    step(`Copying ${info.name} settings`);
    copyOverrides(zip, over, overrides, inst.gameDir);
    writeRecord(inst, record);
    // verify: every downloaded file is really there
    const missing = tasks.filter((t) => !fs.existsSync(t.path));
    if (missing.length) throw new Error(`${missing.length} downloaded file(s) went missing during the install. Try again.`);
    instances.update(inst.id, { modpack: { ...inst.modpack, manual: manual.length ? manual : undefined, gone: gone.length ? gone : undefined } });
    // files CurseForge won't give to apps: fetch them through CurseForge's website download, no trip to the browser
    let left = manual;
    if (manual.length) { try { left = (await autoManual(inst.id)).still; } catch (e) { console.error('[Astra] CurseForge website downloads:', e.message); } }
    return { ...instances.get(inst.id), cfResult: { installed: tasks.length + (manual.length - left.length), manual: left, gone, overrides: overrides.length } };
  } catch (e) {
    if (created) { try { await instances.remove(created.id); } catch {} }
    throw e;
  } finally {
    cancels.delete('modpack');
    push('task', { id: 'modpack', done: true });
  }
}

/**
 * Files the player downloaded from the CurseForge website by hand: found in the Downloads folder (or given paths),
 * checked against CurseForge's SHA-1, and copied into the instance. Returns what's still missing.
 */
async function addManualFiles(instanceId, extraPaths = []) {
  const inst = instances.get(instanceId);
  const want = inst.modpack?.manual || [];
  if (!want.length) return { added: [], still: [] };
  const { app } = require('electron');
  const dirs = [app.getPath('downloads')];
  const { sha1File } = require('./util');
  const added = [], still = [];
  for (const w of want) {
    const target = path.join(inst.gameDir, w.dir, w.file);
    if (fs.existsSync(target) && (!w.sha1 || (await sha1File(target)) === w.sha1)) { added.push(w.name); continue; }
    const cands = [...extraPaths.filter((p) => path.basename(p) === w.file), ...dirs.map((d) => path.join(d, w.file))];
    let ok = false;
    for (const c of cands) {
      try {
        if (!fs.statSync(c).isFile()) continue;
        if (w.sha1 && (await sha1File(c)) !== w.sha1) continue; // same name, different file: not it
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(c, target);
        ok = true; break;
      } catch {}
    }
    (ok ? added : still).push(ok ? w.name : w);
  }
  instances.update(inst.id, { modpack: { ...inst.modpack, manual: still.length ? still : undefined } });
  return { added, still };
}
/**
 * Installs the files a modpack still misses without the player doing anything: the identical file from Modrinth
 * when it's there, otherwise through CurseForge's own website download (src/cfweb.js). Returns { added, still }.
 */
async function autoManual(instanceId) {
  const inst = instances.get(instanceId);
  const want = inst.modpack?.manual || [];
  if (!want.length) return { added: [], still: [] };
  const items = want.map((w) => ({ ...w, target: path.join(inst.gameDir, w.dir, w.file) }));
  const mirror = await modrinthMirror(items.map((i) => i.sha1).filter(Boolean));
  const left = [];
  for (const it of items) {
    const u = it.sha1 && mirror[it.sha1];
    if (u) { try { await download(u, it.target, { sha1: it.sha1 }); continue; } catch {} }
    left.push(it);
  }
  if (left.length) await require('./cfweb').fetchFiles(left, { label: `Finishing ${inst.modpack.name}` });
  return addManualFiles(instanceId); // checks every file on disk (SHA-1) and updates the list
}
async function modpackVersions(instanceId) {
  const inst = instances.get(instanceId);
  const pid = inst.modpack?.projectId;
  if (!pid) return { updatable: false, reason: 'This modpack was imported from a file, so Astra doesn’t know where to look for updates.' };
  const list = (await cf(`/mods/${pid}/files?pageSize=50`)).data;
  return { updatable: true, projectId: pid, current: inst.modpack.fileId, versions: list.map((f) => ({ id: String(f.id), name: f.displayName, number: f.displayName, type: f.releaseType === 1 ? 'release' : f.releaseType === 2 ? 'beta' : 'alpha', date: f.fileDate, gameVersions: (f.gameVersions || []).filter((v) => /^\d/.test(v)) })) };
}
/** Switch a CurseForge modpack instance to another file. Pack files are tracked in curseforge.json (pack: true). */
async function updateModpack(instanceId, fileId) {
  const inst = instances.get(instanceId);
  const pid = inst.modpack?.projectId;
  if (!pid) throw new Error('Astra doesn’t know which CurseForge project this modpack came from.');
  push('task', { id: 'modpack', label: `Updating ${inst.name}`, progress: null });
  try {
    const f = (await cf(`/mods/${pid}/files/${fileId}`)).data;
    const zipPath = path.join(paths.cache(), 'modpacks', safeName(f.fileName));
    await getFile(f, null, zipPath);
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
      return { url: x.downloadUrl || null, x, path: path.join(root, dir, x.fileName), sha1: sha1Of(x), size: x.fileLength };
    }).filter((t) => !fs.existsSync(t.path + '.disabled'));
    await downloadAll(tasks.filter((t) => t.url), { concurrency: 8, onProgress: (d, t) => push('task', { id: 'modpack', label: `Updating ${inst.name}`, progress: d / t, detail: `${d}/${t} files` }) });
    // files CurseForge keeps off the API: Modrinth copy or the website download (getFile), not a failed update
    for (const t of tasks.filter((x) => !x.url)) { if (!fs.existsSync(t.path)) await getFile(t.x, mods[t.x.modId], t.path); }
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

/**
 * A map (CurseForge "Worlds"): the zip is downloaded to the cache, checked to really hold a world (level.dat),
 * and unpacked into the instance's saves folder under a new name — an existing world is never overwritten.
 */
async function installMap(instanceId, { projectId, fileId }) {
  const AdmZip = require('adm-zip');
  const inst = instances.get(instanceId);
  const mod = (await cf(`/mods/${projectId}`)).data;
  if (mod.classId !== CLASS.world) throw new Error(`${mod.name} isn’t a map.`);
  const f = fileId ? (await cf(`/mods/${projectId}/files/${fileId}`)).data : (await cf(`/mods/${projectId}/files?pageSize=20`)).data[0];
  if (!f) throw new Error(`${mod.name} has no files.`);
  const tmp = path.join(paths.cache(), 'maps', `${projectId}-${f.id}.zip`);
  await getFile(f, mod, tmp);
  const zip = new AdmZip(tmp);
  const levels = zip.getEntries().filter((e) => /(^|\/)level\.dat$/.test(e.entryName) && !e.isDirectory);
  if (!levels.length) throw new Error(`${mod.name}: the download doesn’t contain a Minecraft world (no level.dat).`);
  const top = levels.map((e) => e.entryName.slice(0, -'level.dat'.length)).sort((a, b) => a.length - b.length)[0]; // '' or 'Folder/'
  const saves = path.join(inst.gameDir, 'saves');
  const base = String(mod.name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 60) || 'Map';
  let name = base, n = 2;
  while (fs.existsSync(path.join(saves, name))) name = `${base} (${n++})`;
  const dest = path.join(saves, name);
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !e.entryName.startsWith(top)) continue;
    const out = path.join(dest, e.entryName.slice(top.length));
    if (!path.resolve(out).startsWith(path.resolve(dest) + path.sep)) continue; // unsafe path in the zip
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, e.getData());
  }
  try { fs.rmSync(tmp, { force: true }); } catch {}
  return [{ projectId: String(projectId), file: name, version: f.displayName, world: name }];
}

// ---------- for hosted servers (src/hostserver.js) ----------
/** The best file of a CurseForge project for a Minecraft version + loader: releases first, never a server-pack zip. */
async function serverFile(modId, { mc, loader } = {}) {
  const q = new URLSearchParams({ pageSize: "50" });
  if (mc) q.set("gameVersion", mc);
  if (LOADER[loader]) q.set("modLoaderType", String(LOADER[loader]));
  const list = ((await cf(`/mods/${modId}/files?${q}`)).data || []).filter((f) => !f.isServerPack);
  return list.find((f) => f.releaseType === 1) || list[0] || null;
}

module.exports = { getFile, autoManual, categories, installMap, available, test, cfError, inspectModpack, readPack, addManualFiles, cancelModpack, urlOf, pageOf, search, project, files, install, installModpack, modpackVersions, updateModpack, isCurseForgePack, readRecord, request: cf, sha1Of, safeName, resolveFiles, copyOverrides, serverFile, LOADER };
