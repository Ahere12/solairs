// OptiFine for vanilla instances. OptiFine may not be redistributed, so players download the installer .jar from
// optifine.net themselves and Solaris imports it ("standalone install"). Solaris then uses OptiFine's own patcher to
// build the library and writes a version that launches through LaunchWrapper with OptiFine's tweaker.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const { paths, download, writeJSON, readJSON } = require('./util');
const { getVersionJson } = require('./versions');

const DOWNLOADS_PAGE = 'https://optifine.net/downloads';
const dir = () => path.join(paths.cache(), 'optifine');
const NAME_RE = /OptiFine_(\d+(?:\.\d+){1,2})_HD_U_([A-Z]\d+(?:_pre\d+)?)/i;

/** Reads the Minecraft version and OptiFine edition from the jar (falls back to the file name). */
function identify(file) {
  let zip;
  try { zip = new AdmZip(file); } catch { throw new Error('That file isn’t a valid .jar.'); }
  const entries = zip.getEntries().map((e) => e.entryName);
  if (!entries.some((n) => /^(optifine\/|net\/optifine\/)/.test(n))) throw new Error('That jar isn’t OptiFine. Download the OptiFine installer from optifine.net.');
  let m = path.basename(file).match(NAME_RE);
  if (!m) {
    // Renamed file: OptiFine's changelog starts with its full name ("OptiFine 1.21.11_HD_U_J9"),
    // and its debug screen class holds "OptiFine_1.21.11_HD_U_J9".
    const log = zip.getEntry('changelog.txt');
    if (log) { const mm = zip.readAsText(log).match(/OptiFine[ _](\d+(?:\.\d+){1,2})_HD_U_([A-Z]\d+(?:_pre\d+)?)/i); if (mm) m = mm; }
    for (const n of entries) {
      if (m) break;
      if (!/optifine\/gui\/DebugEntryOF\.class$|(^|\/)Config\.class$/.test(n)) continue;
      const mm = zip.getEntry(n).getData().toString('latin1').match(NAME_RE);
      if (mm) m = mm;
    }
  }
  if (!m) throw new Error('Couldn’t tell which Minecraft version this OptiFine is for. Keep the original file name (e.g. OptiFine_1.21.4_HD_U_J3.jar).');
  return { mc: m[1], edition: `HD_U_${m[2].toUpperCase()}`, id: `${m[1]}_HD_U_${m[2].toUpperCase()}`, hasPatcher: entries.includes('optifine/Patcher.class'), launchwrapper: (() => { const e = zip.getEntry('launchwrapper-of.txt'); return e ? zip.readAsText(e).trim() : null; })() };
}

/** Imports an OptiFine installer jar the player downloaded. Returns its info. */
function importJar(file) {
  const info = identify(file);
  fs.mkdirSync(dir(), { recursive: true });
  fs.copyFileSync(file, path.join(dir(), `OptiFine_${info.id}.jar`));
  return info;
}

/** Imported OptiFine editions, optionally for one Minecraft version (newest first). */
function list(mc) {
  let files = [];
  try { files = fs.readdirSync(dir()).filter((f) => /^OptiFine_.+\.jar$/i.test(f)); } catch {}
  return files.map((f) => { const m = f.match(NAME_RE); return m && { mc: m[1], id: `${m[1]}_HD_U_${m[2].toUpperCase()}`, version: `${m[1]}_HD_U_${m[2].toUpperCase()}`, label: `HD U ${m[2].toUpperCase()}`, stable: !/pre/i.test(m[2]), file: path.join(dir(), f) }; })
    .filter(Boolean).filter((x) => !mc || x.mc === mc).sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
}
function remove(id) { try { fs.unlinkSync(path.join(dir(), `OptiFine_${id}.jar`)); } catch {} return list(); }

function run(java, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(java.replace(/javaw\.exe$/i, 'java.exe'), args, { cwd, windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`OptiFine patcher failed (code ${code}): ${out.trim().split(/\r?\n/).slice(-3).join(' ')}`))));
  });
}

/** Builds the OptiFine version for `mc` from an imported edition id. Returns the launch version id. */
async function install(mc, id, { java, onLog } = {}) {
  const imported = list(mc).find((x) => x.id === id) || list(mc)[0];
  if (!imported) throw new Error(`Import OptiFine for Minecraft ${mc} first (Download it from optifine.net, then “Import OptiFine…”).`);
  const info = identify(imported.file);
  const versionId = `${mc}-OptiFine_${info.edition}`;
  const vfile = path.join(paths.versions(), versionId, versionId + '.json');
  const libRel = `optifine/OptiFine/${info.id}/OptiFine-${info.id}.jar`;
  const libPath = path.join(paths.libraries(), libRel);
  if (fs.existsSync(vfile) && fs.existsSync(libPath)) return versionId;

  const base = await getVersionJson(mc);
  const clientJar = path.join(paths.versions(), mc, mc + '.jar');
  if (base.downloads?.client) await download(base.downloads.client.url, clientJar, { sha1: base.downloads.client.sha1 });
  fs.mkdirSync(path.dirname(libPath), { recursive: true });
  if (info.hasPatcher) {
    if (!java) throw new Error('Java is needed to install OptiFine.');
    onLog && onLog('Patching OptiFine for Minecraft ' + mc + '…');
    await run(java, ['-cp', imported.file, 'optifine.Patcher', clientJar, imported.file, libPath], dir());
  } else fs.copyFileSync(imported.file, libPath); // very old OptiFine: the jar is the library

  const libraries = [{ name: `optifine:OptiFine:${info.id}`, downloads: { artifact: { path: libRel, url: null } } }];
  if (info.launchwrapper) {
    const lwRel = `optifine/launchwrapper-of/${info.launchwrapper}/launchwrapper-of-${info.launchwrapper}.jar`;
    const zip = new AdmZip(imported.file);
    const e = zip.getEntry(`launchwrapper-of-${info.launchwrapper}.jar`);
    if (!e) throw new Error('This OptiFine jar is missing its launchwrapper.');
    const lwPath = path.join(paths.libraries(), lwRel);
    fs.mkdirSync(path.dirname(lwPath), { recursive: true });
    fs.writeFileSync(lwPath, e.getData());
    libraries.push({ name: `optifine:launchwrapper-of:${info.launchwrapper}`, downloads: { artifact: { path: lwRel, url: null } } });
  } else libraries.push({ name: 'net.minecraft:launchwrapper:1.12' });

  const json = { id: versionId, inheritsFrom: mc, type: 'release', mainClass: 'net.minecraft.launchwrapper.Launch', libraries };
  if (base.arguments) json.arguments = { game: ['--tweakClass', 'optifine.OptiFineTweaker'] };
  else json.minecraftArguments = `${base.minecraftArguments} --tweakClass optifine.OptiFineTweaker`;
  writeJSON(vfile, json);
  return versionId;
}

module.exports = { DOWNLOADS_PAGE, identify, importJar, list, remove, install };
