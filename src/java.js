// Java runtimes: auto-install Mojang's official runtimes and detect installed Javas.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { paths, getJSON, downloadAll } = require('./util');

const RUNTIME_ALL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

function platformKey() {
  const a = process.arch;
  if (process.platform === 'win32') return a === 'arm64' ? 'windows-arm64' : a === 'ia32' ? 'windows-x86' : 'windows-x64';
  if (process.platform === 'darwin') return a === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return a === 'ia32' ? 'linux-i386' : 'linux';
}
function javaExe(dir) {
  if (process.platform === 'win32') return path.join(dir, 'bin', 'javaw.exe');
  if (process.platform === 'darwin') return path.join(dir, 'jre.bundle', 'Contents', 'Home', 'bin', 'java');
  return path.join(dir, 'bin', 'java');
}

/** Ensure a Mojang runtime component (e.g. java-runtime-delta, jre-legacy) is installed. Returns java path. */
async function ensureRuntime(component = 'jre-legacy', onProgress) {
  const dir = path.join(paths.runtime(), component);
  const exe = javaExe(dir);
  const marker = path.join(dir, '.solaris-complete');
  if (fs.existsSync(marker) && fs.existsSync(exe)) return exe;
  const all = await getJSON(RUNTIME_ALL);
  let key = platformKey();
  let entry = all[key]?.[component]?.[0];
  const fallbacks = { 'mac-os-arm64': 'mac-os', 'windows-arm64': 'windows-x64' };
  if (!entry && fallbacks[key]) { key = fallbacks[key]; entry = all[key]?.[component]?.[0]; }
  if (!entry) throw new Error(`Java runtime "${component}" is not available for ${platformKey()}. Set a custom Java path in Settings.`);
  const man = await getJSON(entry.manifest.url);
  const tasks = [];
  const links = [];
  for (const [rel, f] of Object.entries(man.files)) {
    const full = path.join(dir, rel);
    if (f.type === 'directory') fs.mkdirSync(full, { recursive: true });
    else if (f.type === 'file') tasks.push({ url: f.downloads.raw.url, path: full, sha1: f.downloads.raw.sha1, size: f.downloads.raw.size, exec: f.executable });
    else if (f.type === 'link') links.push({ full, target: f.target });
  }
  await downloadAll(tasks, { onProgress });
  if (process.platform !== 'win32') {
    for (const t of tasks) if (t.exec) { try { fs.chmodSync(t.path, 0o755); } catch {} }
    for (const l of links) { try { fs.mkdirSync(path.dirname(l.full), { recursive: true }); fs.symlinkSync(l.target, l.full); } catch {} }
  }
  fs.writeFileSync(marker, new Date().toISOString());
  return exe;
}

function javaVersionOf(exe) {
  return new Promise((resolve) => {
    const bin = exe.replace(/javaw\.exe$/i, 'java.exe');
    execFile(bin, ['-version'], { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
      const out = String(stderr || stdout || '');
      const m = out.match(/version "([^"]+)"/);
      resolve(m ? { version: m[1], is64: /64-Bit/i.test(out) } : null);
    });
  });
}

/** Find Java installations on this machine. */
async function detect() {
  const candidates = new Set();
  const exeName = process.platform === 'win32' ? 'javaw.exe' : 'java';
  const add = (home) => { const e = path.join(home, 'bin', exeName); if (fs.existsSync(e)) candidates.add(e); };
  if (process.env.JAVA_HOME) add(process.env.JAVA_HOME);
  const roots = [];
  if (process.platform === 'win32') {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
      for (const vendor of ['Java', 'Eclipse Adoptium', 'Eclipse Foundation', 'Zulu', 'Microsoft', 'Amazon Corretto', 'BellSoft', 'AdoptOpenJDK']) roots.push(path.join(base, vendor));
    }
  } else if (process.platform === 'darwin') {
    roots.push('/Library/Java/JavaVirtualMachines');
  } else {
    roots.push('/usr/lib/jvm', '/usr/java', '/opt/java');
  }
  for (const r of roots) {
    let entries = []; try { entries = fs.readdirSync(r); } catch {}
    for (const e of entries) {
      add(path.join(r, e));
      add(path.join(r, e, 'Contents', 'Home'));
    }
  }
  // Solaris-managed runtimes
  try { for (const c of fs.readdirSync(paths.runtime())) { const e = javaExe(path.join(paths.runtime(), c)); if (fs.existsSync(e)) candidates.add(e); } } catch {}
  const out = [];
  for (const exe of candidates) {
    const v = await javaVersionOf(exe);
    if (v) out.push({ path: exe, ...v, managed: exe.startsWith(paths.runtime()) });
  }
  return out;
}

/** "1.8.0_392" → 8, "17.0.9" → 17, "21" → 21 */
function majorOf(v) { const m = String(v || '').match(/^(\d+)(?:\.(\d+))?/); if (!m) return null; return m[1] === '1' ? +(m[2] || 0) : +m[1]; }
function isInstalled(component) { const dir = path.join(paths.runtime(), component); return fs.existsSync(path.join(dir, '.solaris-complete')) && fs.existsSync(javaExe(dir)); }
/** Run `java -version` for the Java test button. */
async function test(exe) {
  if (!exe || !fs.existsSync(exe)) throw new Error('That Java file does not exist.');
  const v = await javaVersionOf(exe);
  if (!v) throw new Error('That file did not run as Java.');
  return { ...v, major: majorOf(v.version) };
}

module.exports = { ensureRuntime, detect, javaVersionOf, javaExe, majorOf, isInstalled, test };
