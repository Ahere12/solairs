// Shared helpers: paths, JSON storage, HTTP downloads, events.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { app } = require('electron');

const UA = 'Solaris-Launcher/1.0.0';
const events = new EventEmitter();
events.setMaxListeners(50);
/** Push an event to the renderer. */
const push = (channel, payload) => events.emit('send', channel, payload);

// ---------- paths ----------
let root;
const bootFile = () => path.join(app.getPath('userData'), 'boot.json');
function getRoot() {
  if (root) return root;
  if (process.env.SOLARIS_DATA_DIR) root = process.env.SOLARIS_DATA_DIR; // portable / testing
  if (!root) try { const b = JSON.parse(fs.readFileSync(bootFile(), 'utf8')); if (b.dataDir) root = b.dataDir; } catch {}
  if (!root) root = path.join(app.getPath('appData'), '.solaris');
  fs.mkdirSync(root, { recursive: true });
  // Resolve redirections (MSIX/AppContainer file virtualization, junctions, symlinks) so every path we
  // hand to Java is the one Java itself sees. Otherwise Fabric can load its own jars twice and crash.
  try { root = fs.realpathSync.native(root); } catch {}
  return root;
}
/** The moved data folder from boot.json if it is missing (e.g. an unplugged drive), else null. Never creates it. */
function missingDataDir() {
  if (process.env.SOLARIS_DATA_DIR) return null;
  try { const b = JSON.parse(fs.readFileSync(bootFile(), 'utf8')); if (b.dataDir && !fs.existsSync(b.dataDir)) return b.dataDir; } catch {}
  return null;
}
function defaultRoot() { return path.join(app.getPath('appData'), '.solaris'); }
function setRoot(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.dirname(bootFile()), { recursive: true });
  fs.writeFileSync(bootFile(), JSON.stringify({ dataDir: dir }));
  root = dir;
}
const p = (...a) => path.join(getRoot(), ...a);
const paths = {
  getRoot, setRoot, missingDataDir, defaultRoot,
  versions: () => p('versions'),
  libraries: () => p('libraries'),
  assets: () => p('assets'),
  runtime: () => p('runtime'),
  instances: () => p('instances'),
  natives: () => p('natives'),
  logs: () => p('logs'),
  cache: () => p('cache'),
  skins: () => p('skins'),
  file: (...n) => p(...n),
};

// ---------- json ----------
function readJSON(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def === undefined ? null : structuredClone(def); }
}
function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// ---------- http ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function request(url, opts = {}) {
  const headers = { 'User-Agent': UA, ...(opts.headers || {}) };
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { ...opts, headers });
      if (r.status >= 500) throw new Error(`HTTP ${r.status} for ${url}`);
      return r;
    } catch (e) { last = e; await sleep(400 * (i + 1)); }
  }
  throw last;
}
async function getJSON(url, opts) {
  const r = await request(url, opts);
  if (!r.ok) {
    let t = ''; try { t = await r.text(); } catch {}
    const err = new Error(`HTTP ${r.status} for ${url}${t ? ': ' + t.slice(0, 300) : ''}`);
    err.status = r.status; err.body = t;
    throw err;
  }
  if (r.status === 204) return null;
  return r.json();
}
function sha1File(file) {
  return new Promise((res, rej) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej);
  });
}
/** Download url → dest. Skips when file exists and matches size/sha1. Returns true if downloaded. */
async function download(url, dest, { sha1, size, verify } = {}) {
  if (fs.existsSync(dest)) {
    if (!sha1 && !size) return false;
    if (size && !verify && fs.statSync(dest).size === size) return false;
    if (sha1 && (await sha1File(dest)) === sha1) return false;
  }
  if (!url) {
    if (fs.existsSync(dest)) return false;
    throw new Error(`Missing file with no download source: ${path.basename(dest)}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.' + Math.random().toString(36).slice(2, 7) + '.part';
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status} downloading ${url}`);
      await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(tmp));
      if (sha1) {
        const got = await sha1File(tmp);
        if (got !== sha1) throw new Error(`Checksum mismatch for ${path.basename(dest)}`);
      }
      fs.renameSync(tmp, dest);
      return true;
    } catch (e) {
      last = e;
      try { fs.unlinkSync(tmp); } catch {}
      if (/HTTP 404/.test(e.message)) break;
      await sleep(500 * (i + 1));
    }
  }
  throw last;
}
/** Download many files with bounded concurrency. */
async function downloadAll(tasks, { concurrency = 16, onProgress } = {}) {
  const seen = new Set();
  const list = tasks.filter((t) => (seen.has(t.path) ? false : seen.add(t.path)));
  let done = 0, i = 0;
  const total = list.length;
  const worker = async () => {
    while (i < total) {
      const t = list[i++];
      await download(t.url, t.path, t);
      done++;
      if (onProgress) onProgress(done, total, t);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  return total;
}

// ---------- misc ----------
function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 48) || 'instance';
}
function dirSize(dir) {
  let total = 0;
  const walk = (d) => {
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else { try { total += fs.statSync(f).size; } catch {} }
    }
  };
  walk(dir);
  return total;
}
/** Same as dirSize but asynchronous, so big folders never block the main process. */
async function dirSizeAsync(dir) {
  let total = 0;
  const walk = async (d) => {
    let entries; try { entries = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) await walk(f);
      else { try { total += (await fs.promises.stat(f)).size; } catch {} }
    }
  };
  await walk(dir);
  return total;
}
function osName() { return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'; }

module.exports = { UA, events, push, paths, readJSON, writeJSON, request, getJSON, download, downloadAll, sha1File, sleep, slugify, dirSize, dirSizeAsync, osName };
