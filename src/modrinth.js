// Modrinth: search, install (with dependencies), modpacks (.mrpack), updates, Solaris Client modules.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { shell } = require('electron');
const { paths, getJSON, download, downloadAll, sha1File, push } = require('./util');
const instances = require('./instances');

const API = 'https://api.modrinth.com/v2';
const TYPE_DIR = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks', datapack: 'datapacks' };

async function search({ query = '', type = 'mod', gameVersion, loader, categories = [], sort = 'relevance', offset = 0, limit = 24 }) {
  const facets = [[`project_type:${type}`]];
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  if (loader && type !== 'resourcepack' && type !== 'datapack' && type !== 'shader') facets.push([`categories:${loader}`]);
  for (const c of categories) facets.push([`categories:${c}`]);
  const q = new URLSearchParams({ query, index: sort, offset: String(offset), limit: String(limit), facets: JSON.stringify(facets) });
  return getJSON(`${API}/search?${q}`);
}
const project = (id) => getJSON(`${API}/project/${encodeURIComponent(id)}`);
const projects = (ids) => ids.length ? getJSON(`${API}/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`) : [];
async function versions(id, { loaders, gameVersions } = {}) {
  const q = new URLSearchParams();
  if (loaders?.length) q.set('loaders', JSON.stringify(loaders));
  if (gameVersions?.length) q.set('game_versions', JSON.stringify(gameVersions));
  return getJSON(`${API}/project/${encodeURIComponent(id)}/version?${q}`);
}
const version = (id) => getJSON(`${API}/version/${encodeURIComponent(id)}`);
let tagCache = null;
async function tags() {
  if (tagCache) return tagCache;
  const [categories, loaders] = await Promise.all([getJSON(`${API}/tag/category`), getJSON(`${API}/tag/loader`)]);
  tagCache = { categories, loaders };
  return tagCache;
}

function loaderFilter(inst, projectType) {
  if (projectType === 'shader') return inst.loader.type === 'vanilla' ? [] : ['iris', 'optifine', 'canvas'];
  if (projectType === 'resourcepack') return ['minecraft'];
  if (projectType === 'datapack') return ['datapack'];
  const t = inst.loader.type;
  if (t === 'quilt') return ['quilt', 'fabric'];
  if (t === 'vanilla') return [];
  return [t];
}

/** Pick the best version of a project for an instance. */
async function bestVersion(projectId, inst, projectType = 'mod') {
  const list = await versions(projectId, { loaders: loaderFilter(inst, projectType), gameVersions: [inst.versionId] });
  return list.find((v) => v.version_type === 'release') || list[0] || null;
}

/** Install a project version (and required dependencies) into an instance. */
async function install(instanceId, { projectId, versionId, projectType = 'mod', world } = {}, seen = new Set()) {
  const inst = instances.get(instanceId);
  const v = versionId ? await version(versionId) : await bestVersion(projectId, inst, projectType);
  if (!v) throw new Error('No compatible version for ' + inst.versionId + (inst.loader.type !== 'vanilla' ? ' / ' + inst.loader.type : ''));
  if (seen.has(v.project_id)) return [];
  seen.add(v.project_id);
  const f = v.files.find((x) => x.primary) || v.files[0];
  let dir = path.join(inst.gameDir, TYPE_DIR[projectType] || 'mods');
  if (projectType === 'datapack') {
    if (!world) throw new Error('Choose a world to install the datapack into');
    dir = path.join(inst.gameDir, 'saves', world, 'datapacks');
  }
  // Remove other versions of the same project we installed before.
  const record = readRecord(inst);
  const prev = record[v.project_id];
  if (prev && prev.file !== f.filename) { try { fs.rmSync(path.join(dir, prev.file), { force: true }); fs.rmSync(path.join(dir, prev.file + '.disabled'), { force: true }); } catch {} }
  await download(f.url, path.join(dir, f.filename), { sha1: f.hashes.sha1 });
  record[v.project_id] = { file: f.filename, versionId: v.id, type: projectType };
  writeRecord(inst, record);
  const installed = [{ projectId: v.project_id, file: f.filename, version: v.version_number }];
  if (projectType === 'mod') {
    for (const dep of v.dependencies || []) {
      if (dep.dependency_type !== 'required' || !dep.project_id || seen.has(dep.project_id)) continue;
      if (record[dep.project_id]) continue;
      try { installed.push(...(await install(instanceId, { projectId: dep.project_id, versionId: dep.version_id || undefined, projectType: 'mod' }, seen))); }
      catch (e) { push('toast', { type: 'warn', text: `Dependency could not be installed: ${e.message}` }); }
    }
  }
  return installed;
}
function recordFile(inst) { return path.join(paths.instances(), inst.id, 'modrinth.json'); }
function readRecord(inst) { try { return JSON.parse(fs.readFileSync(recordFile(inst), 'utf8')); } catch { return {}; } }
function writeRecord(inst, r) { fs.writeFileSync(recordFile(inst), JSON.stringify(r, null, 2)); }

/** Install a .mrpack (from a Modrinth version id or a local file) as a new instance. */
async function installModpack({ versionId, file, name, icon }) {
  let mrpack = file;
  if (versionId) {
    const v = await version(versionId);
    const f = v.files.find((x) => x.primary) || v.files[0];
    mrpack = path.join(paths.cache(), 'modpacks', f.filename);
    push('task', { id: 'modpack', label: `Downloading ${f.filename}`, progress: 0 });
    await download(f.url, mrpack, { sha1: f.hashes.sha1 });
    if (!name) { const p = await project(v.project_id); name = p.title; icon = p.icon_url; }
  }
  const zip = new AdmZip(mrpack);
  const index = JSON.parse(zip.readAsText('modrinth.index.json'));
  const deps = index.dependencies || {};
  const loaderType = deps['fabric-loader'] ? 'fabric' : deps['quilt-loader'] ? 'quilt' : deps.neoforge ? 'neoforge' : deps.forge ? 'forge' : 'vanilla';
  let loaderVersion = deps['fabric-loader'] || deps['quilt-loader'] || deps.neoforge || deps.forge || null;
  if (loaderType === 'forge' && loaderVersion && !loaderVersion.startsWith(deps.minecraft + '-')) loaderVersion = `${deps.minecraft}-${loaderVersion}`;
  const inst = instances.create({ name: name || index.name, versionId: deps.minecraft, loader: { type: loaderType, version: loaderVersion }, icon: icon || null,
    extra: { modpack: { name: index.name, version: index.versionId, versionId: versionId || null } } });
  const root = inst.gameDir;
  const tasks = (index.files || []).filter((f) => f.env?.client !== 'unsupported').map((f) => {
    const out = path.resolve(root, f.path);
    if (!out.startsWith(path.resolve(root) + path.sep)) throw new Error('Unsafe path in modpack: ' + f.path);
    return { url: f.downloads[0], path: out, sha1: f.hashes.sha1, size: f.fileSize };
  });
  await downloadAll(tasks, { concurrency: 8, onProgress: (d, t) => push('task', { id: 'modpack', label: `Installing ${index.name}`, progress: d / t, detail: `${d}/${t} files` }) });
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    const m = e.entryName.match(/^(client-overrides|overrides)\/(.+)$/);
    if (!m) continue;
    const out = path.resolve(root, m[2]);
    if (!out.startsWith(path.resolve(root) + path.sep)) continue;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, e.getData());
  }
  push('task', { id: 'modpack', done: true });
  return inst;
}

/** Hash-based update check via Modrinth for all mods/packs in an instance. */
async function checkUpdates(instanceId, kind = 'mods') {
  const inst = instances.get(instanceId);
  const items = instances.listContent(instanceId, kind).filter((m) => !m.dir);
  const hashes = {};
  for (const m of items) hashes[await sha1File(m.path)] = m;
  const hashList = Object.keys(hashes);
  if (!hashList.length) return [];
  const pt = kind === 'mods' ? 'mod' : kind === 'shaderpacks' ? 'shader' : 'resourcepack';
  const [current, latest] = await Promise.all([
    getJSON(`${API}/version_files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hashes: hashList, algorithm: 'sha1' }) }),
    getJSON(`${API}/version_files/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hashes: hashList, algorithm: 'sha1', loaders: loaderFilter(inst, pt), game_versions: [inst.versionId] }) }),
  ]);
  const projIds = [...new Set(Object.values(current).map((v) => v.project_id))];
  const projs = Object.fromEntries((await projects(projIds)).map((p) => [p.id, p]));
  return hashList.map((h) => {
    const cur = current[h], nxt = latest[h];
    const p = cur ? projs[cur.project_id] : null;
    return {
      file: hashes[h].file, name: p?.title || hashes[h].name, icon: p?.icon_url || hashes[h].icon || null,
      projectId: cur?.project_id || null, current: cur?.version_number || hashes[h].version || null,
      latest: nxt && cur && nxt.id !== cur.id ? { id: nxt.id, version: nxt.version_number, changelog: nxt.changelog } : null,
      onModrinth: !!cur,
    };
  });
}
async function applyUpdate(instanceId, kind, file, versionId) {
  const inst = instances.get(instanceId);
  const v = await version(versionId);
  const f = v.files.find((x) => x.primary) || v.files[0];
  const dir = path.join(inst.gameDir, instances.CONTENT_DIRS[kind]);
  await download(f.url, path.join(dir, f.filename), { sha1: f.hashes.sha1 });
  if (f.filename !== file) { try { await shell.trashItem(path.join(dir, file)); } catch { fs.rmSync(path.join(dir, file), { force: true }); } }
  const record = readRecord(inst); record[v.project_id] = { file: f.filename, versionId: v.id, type: kind === 'mods' ? 'mod' : kind };
  writeRecord(inst, record);
  return f.filename;
}

// ---------- Solaris Client: curated all-in-one module set ----------
const MODULES = [
  { slug: 'fabric-api', name: 'Fabric API', cat: 'Core', required: true, desc: 'Library required by most Fabric mods.' },
  { slug: 'sodium', name: 'Sodium', cat: 'Performance', default: true, desc: 'Modern rendering engine — huge FPS boost.' },
  { slug: 'lithium', name: 'Lithium', cat: 'Performance', default: true, desc: 'Optimizes game logic, physics and AI.' },
  { slug: 'ferrite-core', name: 'FerriteCore', cat: 'Performance', default: true, desc: 'Cuts memory usage dramatically.' },
  { slug: 'entityculling', name: 'Entity Culling', cat: 'Performance', default: true, desc: 'Skips rendering of hidden entities and block entities.' },
  { slug: 'immediatelyfast', name: 'ImmediatelyFast', cat: 'Performance', default: true, desc: 'Faster HUD, text and entity rendering.' },
  { slug: 'modernfix', name: 'ModernFix', cat: 'Performance', default: true, desc: 'Faster launch and lower memory.' },
  { slug: 'sodium-extra', name: 'Sodium Extra', cat: 'Graphics', default: true, desc: 'Extra video options: fog, particles, FPS counter, fullbright-style gamma.' },
  { slug: 'reeses-sodium-options', name: "Reese's Sodium Options", cat: 'Graphics', default: true, desc: 'Cleaner, tabbed video settings screen.' },
  { slug: 'iris', name: 'Iris Shaders', cat: 'Graphics', default: false, desc: 'Shader pack support compatible with Sodium.' },
  { slug: 'continuity', name: 'Continuity', cat: 'Graphics', default: false, desc: 'Connected textures for resource packs.' },
  { slug: 'lambdynamiclights', name: 'LambDynamicLights', cat: 'Graphics', default: false, desc: 'Held torches light up the world.' },
  { slug: 'zoomify', name: 'Zoomify', cat: 'HUD & Utility', default: true, desc: 'Smooth configurable zoom key.' },
  { slug: 'betterf3', name: 'BetterF3', cat: 'HUD & Utility', default: false, desc: 'Customizable, readable F3 debug/coordinates screen.' },
  { slug: 'appleskin', name: 'AppleSkin', cat: 'HUD & Utility', default: true, desc: 'Shows hunger & saturation values.' },
  { slug: 'mouse-tweaks', name: 'Mouse Tweaks', cat: 'HUD & Utility', default: true, desc: 'Better inventory mouse handling.' },
  { slug: 'modmenu', name: 'Mod Menu', cat: 'HUD & Utility', default: true, desc: 'In-game list and settings for all modules.' },
  { slug: 'freelook', name: 'Freelook', cat: 'HUD & Utility', default: false, desc: 'Look around without turning your player.' },
  { slug: 'not-enough-animations', name: 'Not Enough Animations', cat: 'Visual', default: false, desc: 'Third-person animations for eating, maps and more.' },
  { slug: 'cull-leaves', name: 'Cull Leaves', cat: 'Performance', default: false, desc: 'Faster leaf rendering in forests.' },
  { slug: 'dynamic-fps', name: 'Dynamic FPS', cat: 'Performance', default: true, desc: 'Lowers FPS when the game is in the background.' },
];
function modules() { return MODULES; }

async function moduleAvailability(mc) {
  const fake = { versionId: mc, loader: { type: 'fabric' } };
  const out = {};
  await Promise.all(MODULES.map(async (m) => {
    try { out[m.slug] = !!(await bestVersion(m.slug, fake, 'mod')); } catch { out[m.slug] = false; }
  }));
  return out;
}

/** Install/update the selected modules in a Solaris-managed instance. */
async function syncModules(instanceId, onProgress) {
  const inst = instances.get(instanceId);
  const wanted = [...new Set(['fabric-api', ...(inst.solarisModules || [])])];
  const record = readRecord(inst);
  const report = { installed: [], updated: [], unavailable: [] };
  let i = 0;
  for (const slug of wanted) {
    onProgress && onProgress(i++ / wanted.length, slug);
    try {
      const p = await project(slug);
      const v = await bestVersion(p.id, inst, 'mod');
      if (!v) { report.unavailable.push(slug); continue; }
      const had = record[p.id];
      if (had) {
        const f = path.join(inst.gameDir, 'mods', had.file);
        if (!fs.existsSync(f) && fs.existsSync(f + '.disabled')) fs.renameSync(f + '.disabled', f);
      }
      if (!(had && had.versionId === v.id && fs.existsSync(path.join(inst.gameDir, 'mods', had.file)))) {
        await install(instanceId, { projectId: p.id, versionId: v.id, projectType: 'mod' });
        (had ? report.updated : report.installed).push(p.title);
      }
      const rec = readRecord(inst);
      if (rec[p.id]) { rec[p.id].slug = slug; writeRecord(inst, rec); }
    } catch (e) { report.unavailable.push(slug); }
  }
  // Disable modules the user turned off (only ones Solaris installed).
  const fresh = readRecord(inst);
  for (const m of MODULES) {
    if (wanted.includes(m.slug)) continue;
    for (const [, r] of Object.entries(fresh)) {
      if (r.slug === m.slug) { const f = path.join(inst.gameDir, 'mods', r.file); if (fs.existsSync(f)) fs.renameSync(f, f + '.disabled'); }
    }
  }
  return report;
}

module.exports = { search, project, versions, version, tags, install, installModpack, checkUpdates, applyUpdate, modules, moduleAvailability, syncModules, bestVersion };
