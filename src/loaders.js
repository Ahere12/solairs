// Mod loaders: Fabric, Quilt, Legacy Fabric, Forge, NeoForge.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const { paths, getJSON, request, download, writeJSON, readJSON } = require('./util');
const { getVersionJson, mavenPath } = require('./versions');

const META = {
  fabric: 'https://meta.fabricmc.net/v2',
  quilt: 'https://meta.quiltmc.org/v3',
  legacyfabric: 'https://meta.legacyfabric.net/v2',
};
const LOADERS = [
  { id: 'vanilla', name: 'Vanilla' },
  { id: 'fabric', name: 'Fabric' },
  { id: 'quilt', name: 'Quilt' },
  { id: 'forge', name: 'Forge' },
  { id: 'neoforge', name: 'NeoForge' },
  { id: 'legacyfabric', name: 'Legacy Fabric' },
];

async function text(url) { const r = await request(url); if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`); return r.text(); }

function neoMc(v) {
  const [a, b] = v.split(/[.-]/).map((x) => parseInt(x, 10));
  if (a >= 26) return null; // year-based MC versions: matched by prefix below
  return `1.${a}${b ? '.' + b : ''}`;
}

/** List loader versions available for a Minecraft version. Empty array = unsupported. */
async function listVersions(type, mc) {
  try {
    if (type === 'fabric' || type === 'quilt' || type === 'legacyfabric') {
      const list = await getJSON(`${META[type]}/versions/loader/${encodeURIComponent(mc)}`);
      return list.map((x) => ({ version: x.loader.version, stable: x.loader.stable !== false && !/beta|rc|pre/i.test(x.loader.version) }));
    }
    if (type === 'forge') {
      const xml = await text('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml');
      const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]).filter((v) => v.startsWith(mc + '-'));
      let promos = {};
      try { promos = (await getJSON('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')).promos; } catch {}
      const rec = promos[`${mc}-recommended`], lat = promos[`${mc}-latest`];
      return all.map((v) => {
        const fv = v.slice(mc.length + 1);
        return { version: v, label: fv, stable: fv === rec, recommended: fv === rec, latest: fv === lat };
      }).reverse().sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
    }
    if (type === 'neoforge') {
      const data = await getJSON('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
      const list = (data.versions || []).filter((v) => {
        const m = neoMc(v);
        return m ? m === mc : v.startsWith(mc + '.');
      });
      return list.reverse().map((v) => ({ version: v, stable: !/beta|alpha/i.test(v) }));
    }
  } catch (e) {
    if (e.status === 400 || e.status === 404) return [];
    throw e;
  }
  return [];
}

function ensureProfilesFile() {
  const f = path.join(paths.getRoot(), 'launcher_profiles.json');
  if (!fs.existsSync(f)) writeJSON(f, { profiles: {}, settings: {}, version: 3 });
}

function runInstaller(java, jar, args, onLog) {
  return new Promise((resolve, reject) => {
    const p = spawn(java.replace(/javaw\.exe$/i, 'java.exe'), ['-jar', jar, ...args], { cwd: path.dirname(jar), windowsHide: true });
    const tail = [];
    const onData = (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => { tail.push(l); if (tail.length > 40) tail.shift(); onLog && onLog(l); });
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Installer exited with code ${code}:\n${tail.slice(-8).join('\n')}`))));
  });
}

/**
 * Install a loader and return the version id to launch.
 * java is required only for Forge/NeoForge (installer).
 */
async function install(type, mc, loaderVersion, { java, onLog } = {}) {
  if (type === 'vanilla') { await getVersionJson(mc); return mc; }
  await getVersionJson(mc);
  if (META[type]) {
    const json = await getJSON(`${META[type]}/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(loaderVersion)}/profile/json`);
    writeJSON(path.join(paths.versions(), json.id, json.id + '.json'), json);
    return json.id;
  }
  if (type === 'forge' || type === 'neoforge') {
    if (!java) throw new Error('Java is required to install ' + type);
    const url = type === 'forge'
      ? `https://maven.minecraftforge.net/net/minecraftforge/forge/${loaderVersion}/forge-${loaderVersion}-installer.jar`
      : `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
    const jar = path.join(paths.cache(), 'installers', path.basename(url));
    onLog && onLog(`Downloading ${path.basename(url)}…`);
    await download(url, jar);
    const zip = new AdmZip(jar);
    const versionEntry = zip.getEntry('version.json');
    if (versionEntry) {
      const vjson = JSON.parse(zip.readAsText(versionEntry));
      const vfile = path.join(paths.versions(), vjson.id, vjson.id + '.json');
      if (fs.existsSync(vfile) && readJSON(vfile)?.libraries?.length) return vjson.id;
      ensureProfilesFile();
      onLog && onLog('Running installer (this can take a minute)…');
      await runInstaller(java, jar, [type === 'forge' ? '--installClient' : '--install-client', paths.getRoot()], onLog);
      if (!fs.existsSync(vfile)) writeJSON(vfile, vjson);
      return vjson.id;
    }
    // Legacy Forge (1.5–1.12): install_profile.json contains versionInfo + universal jar.
    const ip = JSON.parse(zip.readAsText('install_profile.json'));
    if (!ip.versionInfo) throw new Error('Unsupported Forge installer format');
    const vi = ip.versionInfo;
    vi.libraries = (vi.libraries || []).map((l) => (l.url ? { ...l, url: l.url } : l));
    writeJSON(path.join(paths.versions(), vi.id, vi.id + '.json'), vi);
    const libPath = path.join(paths.libraries(), mavenPath(ip.install.path));
    const universal = zip.getEntry(ip.install.filePath);
    if (universal) { fs.mkdirSync(path.dirname(libPath), { recursive: true }); fs.writeFileSync(libPath, universal.getData()); }
    return vi.id;
  }
  throw new Error('Unknown loader ' + type);
}

module.exports = { LOADERS, listVersions, install };
