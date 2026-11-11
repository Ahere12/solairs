// Import instances from the official launcher, MultiMC / Prism Launcher, or any folder.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { paths, readJSON, writeJSON } = require('./util');
const instances = require('./instances');

function officialDir() {
  if (process.platform === 'win32') return path.join(app.getPath('appData'), '.minecraft');
  if (process.platform === 'darwin') return path.join(app.getPath('home'), 'Library', 'Application Support', 'minecraft');
  return path.join(app.getPath('home'), '.minecraft');
}
function parseVersionId(id, dir) {
  let m;
  if ((m = id.match(/^fabric-loader-([^-]+)-(.+)$/))) return { versionId: m[2], loader: { type: 'fabric', version: m[1] } };
  if ((m = id.match(/^quilt-loader-([^-]+)-(.+)$/))) return { versionId: m[2], loader: { type: 'quilt', version: m[1] } };
  if ((m = id.match(/^(1\.[\d.]+)-forge-?(.+)$/))) return { versionId: m[1], loader: { type: 'forge', version: `${m[1]}-${m[2]}` } };
  if ((m = id.match(/^neoforge-(.+)$/))) {
    const j = readJSON(path.join(dir, 'versions', id, id + '.json'), {});
    return { versionId: j.inheritsFrom || null, loader: { type: 'neoforge', version: m[1] } };
  }
  return { versionId: id, loader: { type: 'vanilla' } };
}

/** Official launcher profiles; they keep using their existing game directory. */
function scanOfficial() {
  const dir = officialDir();
  const prof = readJSON(path.join(dir, 'launcher_profiles.json'), null);
  if (!prof) return [];
  return Object.entries(prof.profiles || {}).map(([key, p]) => {
    let vid = p.lastVersionId;
    if (vid === 'latest-release' || vid === 'latest-snapshot' || !vid) vid = null;
    return { key, name: p.name || (p.type === 'latest-release' ? 'Latest release' : key), lastVersionId: vid, type: p.type, gameDir: p.gameDir || dir, icon: p.icon?.startsWith('data:') ? p.icon : null };
  }).filter((p) => p.lastVersionId);
}
function importOfficial(keys) {
  const dir = officialDir();
  const out = [];
  for (const p of scanOfficial().filter((x) => keys.includes(x.key))) {
    const { versionId, loader } = parseVersionId(p.lastVersionId, dir);
    if (!versionId) continue;
    // Copy the loader version JSON so we can launch it without reinstalling.
    const src = path.join(dir, 'versions', p.lastVersionId, p.lastVersionId + '.json');
    const dst = path.join(paths.versions(), p.lastVersionId, p.lastVersionId + '.json');
    if (loader.type !== 'vanilla' && fs.existsSync(src) && !fs.existsSync(dst)) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
    const inst = instances.create({ name: p.name, versionId, loader, icon: p.icon, extra: { externalGameDir: p.gameDir, importedFrom: 'Official launcher' } });
    if (loader.type !== 'vanilla' && fs.existsSync(dst)) instances.save({ ...inst, launchVersionId: p.lastVersionId });
    out.push(inst);
  }
  return out;
}

/** MultiMC / Prism Launcher instances folder. */
function scanMultiMC(root) {
  let dirs = []; try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch {}
  const out = [];
  for (const d of dirs) {
    const dir = path.join(root, d.name);
    const pack = readJSON(path.join(dir, 'mmc-pack.json'), null);
    if (!pack) continue;
    let name = d.name;
    try { const cfg = fs.readFileSync(path.join(dir, 'instance.cfg'), 'utf8'); name = (cfg.match(/^name=(.*)$/m) || [])[1] || name; } catch {}
    const comp = Object.fromEntries((pack.components || []).map((c) => [c.uid, c.version]));
    const loader = comp['net.fabricmc.fabric-loader'] ? { type: 'fabric', version: comp['net.fabricmc.fabric-loader'] }
      : comp['org.quiltmc.quilt-loader'] ? { type: 'quilt', version: comp['org.quiltmc.quilt-loader'] }
      : comp['net.neoforged'] ? { type: 'neoforge', version: comp['net.neoforged'] }
      : comp['net.minecraftforge'] ? { type: 'forge', version: `${comp['net.minecraft']}-${comp['net.minecraftforge']}` }
      : { type: 'vanilla' };
    const mcDir = ['.minecraft', 'minecraft'].map((x) => path.join(dir, x)).find((x) => fs.existsSync(x));
    out.push({ key: d.name, name, versionId: comp['net.minecraft'], loader, mcDir });
  }
  return out;
}
async function importMultiMC(root, keys) {
  const out = [];
  for (const p of scanMultiMC(root).filter((x) => keys.includes(x.key))) {
    const inst = instances.create({ name: p.name, versionId: p.versionId, loader: p.loader, extra: { importedFrom: 'MultiMC/Prism' } });
    if (p.mcDir) await fs.promises.cp(p.mcDir, inst.gameDir, { recursive: true }); // async: no UI freeze
    out.push(inst);
  }
  return out;
}

/** Generic: copy a .minecraft-like folder into a new instance. */
async function importFolder(folder, { name, versionId, loader }) {
  const inst = instances.create({ name: name || path.basename(folder), versionId, loader, extra: { importedFrom: 'Folder' } });
  await fs.promises.cp(folder, inst.gameDir, { recursive: true });
  return inst;
}

module.exports = { officialDir, scanOfficial, importOfficial, scanMultiMC, importMultiMC, importFolder };
