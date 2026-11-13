// Modrinth: search, install (with dependencies), modpacks (.mrpack), updates, Solaris Client modules.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { shell } = require('electron');
const { paths, getJSON, download, downloadAll, sha1File, push, UA } = require('./util');
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

/**
 * project_id → { file, versionId } for every jar/zip already in `dir`, identified by SHA-1 through Modrinth.
 * This catches content Solaris didn't install itself (modpacks, imports, manual drops), so installing a mod
 * never adds a second copy of something that is already there (e.g. Fabric API → "Duplicate mods" crash).
 */
async function installedProjects(dir) {
  let files = []; try { files = fs.readdirSync(dir).filter((f) => /\.(jar|zip)(\.disabled)?$/i.test(f)); } catch {}
  if (!files.length) return {};
  const byHash = {};
  for (const f of files) { try { byHash[await sha1File(path.join(dir, f))] = f; } catch {} }
  try {
    const res = await getJSON(`${API}/version_files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hashes: Object.keys(byHash), algorithm: 'sha1' }) });
    const out = {};
    for (const [h, v] of Object.entries(res || {})) if (byHash[h]) out[v.project_id] = { file: byHash[h], versionId: v.id };
    return out;
  } catch { return {}; }
}

/** Install a project version (and required dependencies) into an instance. */
async function install(instanceId, { projectId, versionId, projectType = 'mod', world } = {}, seen = new Set(), found = {}) {
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
  if (!found[dir]) found[dir] = await installedProjects(dir);
  // Replace any other version of the same project — whether Solaris installed it or not.
  const record = readRecord(inst);
  const prev = record[v.project_id] || found[dir][v.project_id];
  if (prev && prev.file && prev.file !== f.filename) {
    const base = prev.file.replace(/\.disabled$/, '');
    try { fs.rmSync(path.join(dir, base), { force: true }); fs.rmSync(path.join(dir, base + '.disabled'), { force: true }); } catch {}
  }
  await download(f.url, path.join(dir, f.filename), { sha1: f.hashes.sha1 });
  try { fs.rmSync(path.join(dir, f.filename + '.disabled'), { force: true }); } catch {} // re-installing enables it
  record[v.project_id] = { file: f.filename, versionId: v.id, type: projectType };
  found[dir][v.project_id] = { file: f.filename, versionId: v.id };
  writeRecord(inst, record);
  const installed = [{ projectId: v.project_id, file: f.filename, version: v.version_number }];
  if (projectType === 'mod') {
    for (const dep of v.dependencies || []) {
      if (dep.dependency_type !== 'required' || !dep.project_id || seen.has(dep.project_id)) continue;
      const r = record[dep.project_id];
      if ((r && fs.existsSync(path.join(dir, r.file))) || found[dir][dep.project_id]) continue; // already present (any source)
      try { installed.push(...(await install(instanceId, { projectId: dep.project_id, versionId: dep.version_id || undefined, projectType: 'mod' }, seen, found))); }
      catch (e) { push('toast', { type: 'warn', text: `Dependency could not be installed: ${e.message}` }); }
    }
  }
  return installed;
}
function recordFile(inst) { return path.join(paths.instances(), inst.id, 'modrinth.json'); }
function readRecord(inst) { try { return JSON.parse(fs.readFileSync(recordFile(inst), 'utf8')); } catch { return {}; } }
function writeRecord(inst, r) { fs.writeFileSync(recordFile(inst), JSON.stringify(r, null, 2)); }

/** Install a .mrpack (from a Modrinth version id or a local file) as a new instance. */
/**
 * Install a .mrpack as a new instance. The progress task is always closed, and a half-installed
 * instance is removed again if anything fails.
 */
async function installModpack(opts) {
  let created = null;
  try {
    return await installModpackInner(opts, (inst) => { created = inst; });
  } catch (e) {
    if (created) { try { await instances.remove(created.id); } catch {} }
    throw e;
  } finally {
    push('task', { id: 'modpack', done: true });
  }
}
async function installModpackInner({ versionId, file, name, icon }, onCreated) {
  let mrpack = file, packProject = null;
  if (versionId) {
    const v = await version(versionId); packProject = v.project_id;
    const f = v.files.find((x) => x.primary) || v.files[0];
    mrpack = path.join(paths.cache(), 'modpacks', f.filename);
    push('task', { id: 'modpack', label: `Downloading ${f.filename}`, progress: 0 });
    await download(f.url, mrpack, { sha1: f.hashes.sha1 });
    if (!name) { const p = await project(v.project_id); name = p.title; icon = p.icon_url; }
  }
  let zip, index;
  try { zip = new AdmZip(mrpack); index = JSON.parse(zip.readAsText('modrinth.index.json')); }
  catch { throw new Error('This file is not a valid Modrinth modpack (.mrpack).'); }
  const deps = index.dependencies || {};
  const loaderType = deps['fabric-loader'] ? 'fabric' : deps['quilt-loader'] ? 'quilt' : deps.neoforge ? 'neoforge' : deps.forge ? 'forge' : 'vanilla';
  let loaderVersion = deps['fabric-loader'] || deps['quilt-loader'] || deps.neoforge || deps.forge || null;
  if (loaderType === 'forge' && loaderVersion && !loaderVersion.startsWith(deps.minecraft + '-')) loaderVersion = `${deps.minecraft}-${loaderVersion}`;
  const inst = instances.create({ name: name || index.name, versionId: deps.minecraft, loader: { type: loaderType, version: loaderVersion }, icon: icon || null,
    extra: { modpack: { name: index.name, version: index.versionId, versionId: versionId || null, projectId: packProject } } });
  onCreated(inst);
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
  // Remember which Modrinth projects the pack contains, so later installs/updates replace instead of duplicating.
  try {
    const mods = await installedProjects(path.join(root, 'mods'));
    const record = readRecord(inst);
    for (const [pid, r] of Object.entries(mods)) if (!record[pid]) record[pid] = { file: r.file, versionId: r.versionId, type: 'mod', pack: true };
    writeRecord(inst, record);
  } catch {}
  return inst;
}

/** Download (cached) and read a Modrinth modpack version: { zip, index, version }. */
async function readPackVersion(versionId) {
  const v = await version(versionId);
  const f = v.files.find((x) => x.primary) || v.files[0];
  const file = path.join(paths.cache(), 'modpacks', f.filename);
  await download(f.url, file, { sha1: f.hashes.sha1 });
  const zip = new AdmZip(file);
  return { zip, index: JSON.parse(zip.readAsText('modrinth.index.json')), version: v };
}
async function packProjectId(inst) {
  if (inst.modpack?.projectId) return inst.modpack.projectId;
  if (inst.modpack?.versionId) return (await version(inst.modpack.versionId)).project_id;
  return null;
}

/** Versions a Modrinth modpack instance can switch to (newest first). */
async function modpackVersions(instanceId) {
  const inst = instances.get(instanceId);
  const pid = await packProjectId(inst);
  if (!pid) return { updatable: false, reason: 'This modpack was imported from a file, so Solaris doesn’t know where to look for updates.' };
  const list = await versions(pid);
  return {
    updatable: true, projectId: pid, current: inst.modpack.versionId,
    versions: list.map((v) => ({ id: v.id, name: v.name, number: v.version_number, type: v.version_type, date: v.date_published, gameVersions: v.game_versions, loaders: v.loaders, changelog: v.changelog })),
  };
}

/**
 * Switch a modpack instance to another pack version: files the old version installed are removed,
 * the new ones downloaded and overrides applied. Worlds, options, screenshots and mods you added yourself are kept.
 */
async function updateModpack(instanceId, versionId) {
  const inst = instances.get(instanceId);
  const root = path.resolve(inst.gameDir);
  push('task', { id: 'modpack', label: `Updating ${inst.name}`, progress: null });
  try {
    const next = await readPackVersion(versionId);
    let oldPaths = [];
    if (inst.modpack?.versionId) { try { oldPaths = ((await readPackVersion(inst.modpack.versionId)).index.files || []).map((f) => f.path); } catch {} }
    const newPaths = new Set((next.index.files || []).map((f) => f.path));
    for (const p of oldPaths) {
      if (newPaths.has(p)) continue;
      const full = path.resolve(root, p);
      if (!full.startsWith(root + path.sep)) continue;
      for (const f of [full, full + '.disabled']) try { fs.rmSync(f, { force: true }); } catch {}
    }
    const tasks = (next.index.files || []).filter((f) => f.env?.client !== 'unsupported').map((f) => {
      const out = path.resolve(root, f.path);
      if (!out.startsWith(root + path.sep)) throw new Error('Unsafe path in modpack: ' + f.path);
      return { url: f.downloads[0], path: out, sha1: f.hashes.sha1, size: f.fileSize, verify: true };
    }).filter((t) => !fs.existsSync(t.path + '.disabled')); // keep mods the player turned off
    await downloadAll(tasks, { concurrency: 8, onProgress: (d, t) => push('task', { id: 'modpack', label: `Updating ${inst.name}`, progress: d / t, detail: `${d}/${t} files` }) });
    const KEEP = /^(options\.txt|optionsof\.txt|servers\.dat|saves\/)/i;
    for (const e of next.zip.getEntries()) {
      const m = !e.isDirectory && e.entryName.match(/^(client-overrides|overrides)\/(.+)$/);
      if (!m || (KEEP.test(m[2]) && fs.existsSync(path.resolve(root, m[2])))) continue;
      const out = path.resolve(root, m[2]);
      if (!out.startsWith(root + path.sep)) continue;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, e.getData());
    }
    const deps = next.index.dependencies || {};
    const type = deps['fabric-loader'] ? 'fabric' : deps['quilt-loader'] ? 'quilt' : deps.neoforge ? 'neoforge' : deps.forge ? 'forge' : 'vanilla';
    let lv = deps['fabric-loader'] || deps['quilt-loader'] || deps.neoforge || deps.forge || null;
    if (type === 'forge' && lv && !lv.startsWith(deps.minecraft + '-')) lv = `${deps.minecraft}-${lv}`;
    const changed = deps.minecraft !== inst.versionId || type !== inst.loader?.type || lv !== inst.loader?.version;
    instances.save({ ...instances.get(instanceId), versionId: deps.minecraft, loader: { type, version: lv }, launchVersionId: changed ? null : inst.launchVersionId,
      modpack: { ...inst.modpack, projectId: next.version.project_id, versionId, version: next.index.versionId || next.version.version_number } });
    try {
      const mods = await installedProjects(path.join(root, 'mods'));
      const record = readRecord(inst);
      for (const [pid, r] of Object.entries(mods)) record[pid] = { pack: true, ...(record[pid] || {}), file: r.file, versionId: r.versionId, type: 'mod' };
      for (const [pid, r] of Object.entries(record)) if (r.type === 'mod' && !fs.existsSync(path.join(root, 'mods', r.file)) && !fs.existsSync(path.join(root, 'mods', r.file + '.disabled'))) delete record[pid];
      writeRecord(inst, record);
    } catch {}
    return instances.get(instanceId);
  } finally {
    push('task', { id: 'modpack', done: true });
  }
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
  const wasDisabled = /\.disabled$/.test(file);
  await download(f.url, path.join(dir, f.filename), { sha1: f.hashes.sha1 });
  if (f.filename !== file) { try { await shell.trashItem(path.join(dir, file)); } catch { fs.rmSync(path.join(dir, file), { force: true }); } }
  // an update keeps the mod's on/off state
  let finalName = f.filename;
  if (wasDisabled) { try { fs.renameSync(path.join(dir, f.filename), path.join(dir, f.filename + '.disabled')); finalName = f.filename + '.disabled'; } catch {} }
  const record = readRecord(inst); record[v.project_id] = { file: f.filename, versionId: v.id, type: kind === 'mods' ? 'mod' : kind };
  writeRecord(inst, record);
  return finalName;
}

// ---------- Solaris Client: curated all-in-one module set ----------
const MODULES = [
  { slug: 'fabric-api', name: 'Fabric API', cat: 'Core', required: true, desc: 'Library required by most Fabric mods.' },
  // In-game client menu like Lunar / Feather: Polyfrost's OneConfig (the OneClient menu) — press Right Shift in game.
  { slug: 'oneconfig', name: 'Client menu (OneConfig)', cat: 'Core', default: true, desc: 'Press Right Shift in game: one menu for your mods, HUD editor and settings — like Lunar.' },
  { slug: 'polysprint', name: 'PolySprint', cat: 'HUD & Utility', default: true, desc: 'Toggle sprint and sneak, set up from the Right Shift menu.' },
  { slug: 'chatting', name: 'Chatting', cat: 'HUD & Utility', default: false, desc: 'Chat tabs, chat search, screenshots of chat and a cleaner chat box.' },
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
  { slug: 'moreculling', name: 'More Culling', cat: 'Performance', default: false, desc: 'Skips more hidden block faces for extra FPS.' },
  { slug: 'krypton', name: 'Krypton', cat: 'Performance', default: false, desc: 'Optimizes the networking stack — smoother multiplayer.' },
  // HUD like Feather / OneClient (EvergreenHUD is Polyfrost's, the OneClient team)
  { slug: 'evergreenhud', name: 'EvergreenHUD', cat: 'HUD & Utility', default: true, desc: 'FPS, CPS, keystrokes, coordinates, armour and more — movable HUD widgets.' },
  { slug: 'controlling', name: 'Controlling', cat: 'HUD & Utility', default: true, desc: 'Search your key binds and find conflicts.' },
  { slug: 'fastquit', name: 'FastQuit', cat: 'HUD & Utility', default: true, desc: 'Leave worlds instantly — saving continues in the background.' },
  { slug: 'shulkerboxtooltip', name: 'Shulker Box Tooltip', cat: 'HUD & Utility', default: false, desc: 'See what is inside shulker boxes by hovering.' },
  { slug: 'xaeros-minimap', name: "Xaero's Minimap", cat: 'HUD & Utility', default: false, desc: 'Minimap with waypoints.' },
  // Social & multiplayer
  { slug: 'e4mc', name: 'e4mc — Host for friends', cat: 'Social', default: true, desc: 'Open to LAN puts your world online — no port forwarding. Solaris shows the address to share.' },
  { slug: 'world-host', name: 'World Host', cat: 'Social', default: false, desc: 'In-game friends list: see friends online and join their worlds (Minecraft 1.21.5 and older).' },
  { slug: 'chat-heads', name: 'Chat Heads', cat: 'Social', default: true, desc: 'Player heads next to chat messages.' },
  { slug: 'no-chat-reports', name: 'No Chat Reports', cat: 'Social', default: false, desc: 'Makes your chat messages unreportable to Mojang.' },
  // Optional cosmetics (off by default)
  { slug: 'capes', name: 'Capes', cat: 'Cosmetics', default: false, desc: 'See capes from OptiFine, LabyMod, MinecraftCapes and more — and show your own.' },
  { slug: '3dskinlayers', name: '3D Skin Layers', cat: 'Cosmetics', default: false, desc: 'Renders the outer skin layer in 3D.' },
  { slug: 'wavey-capes', name: 'Wavey Capes', cat: 'Cosmetics', default: false, desc: 'Capes that wave with physics.' },
  { slug: 'emotecraft', name: 'Emotecraft', cat: 'Cosmetics', default: false, desc: 'Emotes and dances (others need it to see them).' },
  { slug: 'ears', name: 'Ears', cat: 'Cosmetics', default: false, desc: 'Ears, tails, wings and more drawn on your skin file.' },
];
// Optional libraries a module needs for its settings screen (e.g. AppleSkin's Mod Menu page needs Cloth Config).
const COMPANIONS = { appleskin: ['cloth-config'] };
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
/** Quick single check (no retries) so offline launches don't wait on dozens of retried lookups. */
async function reachable() {
  try { const r = await fetch(API, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(4000) }); return r.status < 500; } catch { return false; }
}
async function syncModules(instanceId, onProgress) {
  const inst = instances.get(instanceId);
  const chosen = inst.solarisModules || [];
  const companions = chosen.includes('modmenu') ? chosen.flatMap((s) => COMPANIONS[s] || []) : [];
  const wanted = [...new Set(['fabric-api', ...chosen, ...companions])];
  const record = readRecord(inst);
  const report = { installed: [], updated: [], unavailable: [], offline: false };
  if (!(await reachable())) { report.offline = true; return report; }
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
  report.unavailable = report.unavailable.filter((s) => !companions.includes(s)); // a missing helper library isn't news
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

module.exports = { readRecord, modpackVersions, updateModpack, search, project, versions, version, tags, install, installModpack, checkUpdates, applyUpdate, modules, moduleAvailability, syncModules, bestVersion };
