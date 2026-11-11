// Minecraft version metadata: manifest, version JSON resolution, libraries, assets, natives.
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { paths, getJSON, download, readJSON, writeJSON, osName } = require('./util');

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
let manifestCache = null;

async function getManifest(force = false) {
  if (manifestCache && !force) return manifestCache;
  const file = paths.file('cache', 'version_manifest.json');
  try {
    manifestCache = await getJSON(MANIFEST);
    writeJSON(file, manifestCache);
  } catch (e) {
    manifestCache = readJSON(file, null);
    if (!manifestCache) throw new Error('Could not load the Minecraft version list. Check your internet connection.');
  }
  return manifestCache;
}

async function getVersionJson(id) {
  const file = path.join(paths.versions(), id, id + '.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const m = await getManifest();
  const v = m.versions.find((x) => x.id === id);
  if (!v) throw new Error(`Unknown Minecraft version "${id}"`);
  await download(v.url, file, { sha1: v.sha1 });
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function merge(child, parent) {
  const args = child.arguments || parent.arguments
    ? {
        game: [...(parent.arguments?.game || []), ...(child.arguments?.game || [])],
        jvm: [...(parent.arguments?.jvm || []), ...(child.arguments?.jvm || [])],
      }
    : undefined;
  return {
    ...parent,
    ...child,
    id: child.id,
    libraries: [...(child.libraries || []), ...(parent.libraries || [])],
    arguments: args,
    minecraftArguments: child.minecraftArguments || parent.minecraftArguments,
    assetIndex: parent.assetIndex || child.assetIndex,
    assets: parent.assets || child.assets,
    downloads: child.downloads?.client ? child.downloads : parent.downloads,
    javaVersion: child.javaVersion || parent.javaVersion,
    mainClass: child.mainClass || parent.mainClass,
    _vanilla: parent._vanilla,
    _jarId: child.downloads?.client ? child.id : parent._jarId,
  };
}

/** Load a version and all of its parents (inheritsFrom) into one merged object. */
async function resolveVersion(id) {
  const json = await getVersionJson(id);
  if (json.inheritsFrom) {
    const parent = await resolveVersion(json.inheritsFrom);
    return merge(json, parent);
  }
  return { ...json, _vanilla: json.id, _jarId: json.jar || json.id };
}

// ---------- rules ----------
function archName() { return process.arch === 'ia32' ? 'x86' : process.arch; }
function ruleAllows(rules, features = {}) {
  if (!rules || !rules.length) return true;
  let allow = false;
  for (const r of rules) {
    let match = true;
    if (r.os) {
      if (r.os.name && r.os.name !== osName()) match = false;
      if (r.os.arch && r.os.arch !== archName()) match = false;
      if (r.os.version) { try { if (!new RegExp(r.os.version).test(os.release())) match = false; } catch {} }
    }
    if (r.features) for (const [k, v] of Object.entries(r.features)) if (!!features[k] !== v) match = false;
    if (match) allow = r.action === 'allow';
  }
  return allow;
}

function mavenPath(name) {
  const [coord, ext0] = name.split('@');
  const [g, a, v, c] = coord.split(':');
  return `${g.replace(/\./g, '/')}/${a}/${v}/${a}-${v}${c ? '-' + c : ''}.${ext0 || 'jar'}`;
}
function fixRepo(url) {
  return (url || 'https://libraries.minecraft.net/')
    .replace('http://files.minecraftforge.net/maven', 'https://maven.minecraftforge.net')
    .replace(/^http:\/\//, 'https://')
    .replace(/\/?$/, '/');
}

/** Returns { classpath: [task], natives: [task] } download tasks for a resolved version. */
function collectLibraries(version) {
  const classpath = [];
  const natives = [];
  const seen = new Set();
  const libDir = paths.libraries();
  for (const lib of version.libraries || []) {
    if (!ruleAllows(lib.rules)) continue;
    if (lib.clientreq === false) continue;
    const parts = lib.name.split(':');
    const key = `${parts[0]}:${parts[1]}${parts[3] ? ':' + parts[3] : ''}`;
    const art = lib.downloads?.artifact;
    let task = null;
    if (art) {
      const rel = art.path || mavenPath(lib.name);
      task = { path: path.join(libDir, rel), url: art.url, sha1: art.sha1, size: art.size };
    } else if (!lib.downloads) {
      const rel = mavenPath(lib.name);
      task = { path: path.join(libDir, rel), url: fixRepo(lib.url) + rel, sha1: lib.sha1 || lib.checksums?.[0], size: lib.size };
    }
    if (task && !seen.has(key)) {
      seen.add(key);
      classpath.push(task);
      if (/:natives-/.test(lib.name)) natives.push({ ...task, exclude: ['META-INF/'] });
    }
    // Legacy native classifiers (<= 1.18)
    if (lib.natives && lib.natives[osName()]) {
      const cls = lib.natives[osName()].replace('${arch}', process.arch === 'ia32' ? '32' : '64');
      const n = lib.downloads?.classifiers?.[cls];
      const exclude = lib.extract?.exclude || ['META-INF/'];
      if (n) natives.push({ path: path.join(libDir, n.path), url: n.url, sha1: n.sha1, size: n.size, exclude });
      else if (!lib.downloads) {
        const rel = mavenPath(`${lib.name}:${cls}`);
        natives.push({ path: path.join(libDir, rel), url: fixRepo(lib.url) + rel, exclude });
      }
    }
  }
  return { classpath, natives };
}

function extractNatives(natives, dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const n of natives) {
    if (!fs.existsSync(n.path)) continue;
    let zip; try { zip = new AdmZip(n.path); } catch { continue; }
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue;
      if ((n.exclude || []).some((x) => e.entryName.startsWith(x))) continue;
      if (!/\.(dll|so|dylib|jnilib)$/i.test(e.entryName)) continue;
      const out = path.join(dir, path.basename(e.entryName));
      if (!fs.existsSync(out)) { try { fs.writeFileSync(out, e.getData()); } catch {} }
    }
  }
}

/** Asset download tasks plus info about legacy layouts. */
async function assetTasks(version) {
  const ai = version.assetIndex;
  if (!ai) return { tasks: [], index: null, id: 'legacy' };
  const idxFile = path.join(paths.assets(), 'indexes', ai.id + '.json');
  await download(ai.url, idxFile, { sha1: ai.sha1 });
  const index = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
  const tasks = Object.entries(index.objects).map(([name, o]) => ({
    name,
    url: `https://resources.download.minecraft.net/${o.hash.slice(0, 2)}/${o.hash}`,
    path: path.join(paths.assets(), 'objects', o.hash.slice(0, 2), o.hash),
    sha1: o.hash,
    size: o.size,
  }));
  return { tasks, index, id: ai.id };
}

/** Copy objects into legacy layouts (pre-1.7 virtual / map_to_resources). Returns the assets root to use. */
function prepareLegacyAssets(assetInfo, gameDir) {
  const { index, id } = assetInfo;
  if (!index) return paths.assets();
  let target = null;
  if (index.map_to_resources) target = path.join(gameDir, 'resources');
  else if (index.virtual) target = path.join(paths.assets(), 'virtual', id);
  if (!target) return paths.assets();
  for (const [name, o] of Object.entries(index.objects)) {
    const out = path.join(target, name);
    if (fs.existsSync(out)) continue;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    try { fs.copyFileSync(path.join(paths.assets(), 'objects', o.hash.slice(0, 2), o.hash), out); } catch {}
  }
  return target;
}

module.exports = { getManifest, getVersionJson, resolveVersion, ruleAllows, collectLibraries, extractNatives, assetTasks, prepareLegacyAssets, mavenPath, fixRepo };
