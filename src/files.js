// Built-in file explorer and log viewer for an instance's game folder.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { shell } = require('electron');
const instances = require('./instances');

/** Resolve a path inside the instance folder; anything that escapes it is refused. */
function inside(id, rel = '') {
  const root = path.resolve(instances.get(id).gameDir);
  const full = path.resolve(root, String(rel || ''));
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('That path is outside this instance.');
  return { root, full };
}
const relOf = (root, full) => path.relative(root, full).split(path.sep).join('/');

async function list(id, rel = '') {
  const { root, full } = inside(id, rel);
  fs.mkdirSync(root, { recursive: true });
  let ents = [];
  try { ents = await fs.promises.readdir(full, { withFileTypes: true }); } catch (e) { throw new Error(e.code === 'ENOENT' ? 'This folder no longer exists.' : e.message); }
  const out = [];
  for (const e of ents) {
    const p = path.join(full, e.name);
    let st = null; try { st = await fs.promises.stat(p); } catch { continue; }
    out.push({ name: e.name, rel: relOf(root, p), dir: st.isDirectory(), size: st.isDirectory() ? null : st.size, mtime: st.mtimeMs });
  }
  out.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { rel: relOf(root, full), entries: out };
}

const TEXT = /\.(txt|log|json|json5|toml|cfg|conf|properties|ini|yml|yaml|mcmeta|md|csv|lang|js|snbt|xml)$/i;
async function read(id, rel) {
  const { full } = inside(id, rel);
  const st = await fs.promises.stat(full);
  if (st.isDirectory()) throw new Error('That is a folder.');
  let buf = await fs.promises.readFile(full);
  if (/\.gz$/i.test(full)) buf = zlib.gunzipSync(buf);
  else if (!TEXT.test(full) && buf.subarray(0, 4096).includes(0)) throw new Error('This file is not text — open it with another program.');
  const max = 2 * 1024 * 1024;
  const text = buf.length > max ? '… (showing the last 2 MB)\n' + buf.subarray(buf.length - max).toString('utf8') : buf.toString('utf8');
  return { text, size: st.size, truncated: buf.length > max };
}
async function write(id, rel, text) {
  const { full } = inside(id, rel);
  if (!TEXT.test(full)) throw new Error('Only text/config files can be edited here.');
  await fs.promises.writeFile(full, String(text));
  return true;
}
async function trash(id, rels) {
  for (const rel of [].concat(rels)) {
    const { root, full } = inside(id, rel);
    if (full === root) throw new Error('The instance folder itself can’t be deleted here.');
    try { await shell.trashItem(full); } catch { await fs.promises.rm(full, { recursive: true, force: true }); }
  }
  return true;
}
async function rename(id, rel, name) {
  if (!name || /[\\/:*?"<>|]/.test(name)) throw new Error('That name is not allowed.');
  const { full } = inside(id, rel);
  const dest = path.join(path.dirname(full), name);
  inside(id, path.relative(path.resolve(instances.get(id).gameDir), dest));
  if (fs.existsSync(dest)) throw new Error('Something with that name already exists.');
  await fs.promises.rename(full, dest);
  return true;
}
async function mkdir(id, rel, name) {
  if (!name || /[\\/:*?"<>|]/.test(name)) throw new Error('That name is not allowed.');
  const { full } = inside(id, path.posix.join(rel || '', name));
  await fs.promises.mkdir(full, { recursive: true });
  return true;
}
const open = (id, rel) => shell.openPath(inside(id, rel).full);
const reveal = (id, rel) => shell.showItemInFolder(inside(id, rel).full);

/** Crash reports and game logs, newest first. */
async function logs(id) {
  const { root } = inside(id);
  const out = [];
  for (const [dir, kind] of [['crash-reports', 'crash'], ['logs', 'log']]) {
    let names = []; try { names = await fs.promises.readdir(path.join(root, dir)); } catch {}
    for (const n of names) {
      if (!/\.(txt|log|log\.gz)$/i.test(n)) continue;
      const p = path.join(root, dir, n);
      try { const st = await fs.promises.stat(p); out.push({ name: n, rel: relOf(root, p), kind, size: st.size, mtime: st.mtimeMs }); } catch {}
    }
  }
  // JVM crash logs land in the game folder itself
  try { for (const n of await fs.promises.readdir(root)) if (/^hs_err_pid\d+\.log$/i.test(n)) { const st = await fs.promises.stat(path.join(root, n)); out.push({ name: n, rel: n, kind: 'crash', size: st.size, mtime: st.mtimeMs }); } } catch {}
  return out.sort((a, b) => b.mtime - a.mtime);
}

module.exports = { list, read, write, trash, rename, mkdir, open, reveal, logs };
