// Windows "app sandbox" protection.
//
// Apps from the Microsoft Store (packaged/MSIX apps, like the Claude desktop app) run with a private copy of AppData:
// whatever a program started BY such an app writes to %APPDATA% is quietly redirected to
//   %LOCALAPPDATA%\Packages\<that app>\LocalCache\Roaming\…
// If Astra is started that way, a modpack installed in it lands in that hidden folder. Java then sees the same jars at
// two different paths, Fabric loads itself twice and crashes ("loader constraint violation … previously loaded by
// 'app'") — and once Astra is started normally, the files seem to be gone.
//
// So: (1) Astra notices it was started inside another app's sandbox and starts itself again through Windows Explorer
// (a normal start); (2) on a normal start, files that ended up in such a hidden folder are moved back into the real
// Astra folder.
const fs = require('fs');
const path = require('path');

const HIDDEN = /\\Packages\\[^\\]+\\LocalCache\\/i;

/** True when files written to AppData by this process are redirected into another app's private folder. */
function inForeignSandbox(appData) {
  if (process.platform !== 'win32') return false;
  const dir = path.join(appData, `.astra-sandbox-check-${process.pid}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'probe');
    fs.writeFileSync(f, '1');
    return HIDDEN.test(fs.realpathSync.native(f));
  } catch { return false; }
  finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}

/** Starts the same Astra again through Windows Explorer (outside the sandbox). The caller then quits. */
function restartOutside(exe) {
  const { spawn } = require('child_process');
  // Explorer hands the start to the Windows shell (which isn't sandboxed) and returns at once. No delay is needed:
  // the sandboxed copy never takes the single-instance lock. (A cmd/ping wait in between got cut off when this copy quit.)
  const p = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'), [exe], { detached: true, stdio: 'ignore' });
  p.unref();
}

/** Hidden copies of Astra's data folder left by sandboxed starts: [folder]. */
function hiddenCopies(localAppData, folderName = '.solaris') {
  const out = [];
  let pkgs = []; try { pkgs = fs.readdirSync(path.join(localAppData, 'Packages')); } catch { return out; }
  for (const p of pkgs) {
    const d = path.join(localAppData, 'Packages', p, 'LocalCache', 'Roaming', folderName);
    try { if (fs.statSync(d).isDirectory()) out.push(d); } catch {}
  }
  return out;
}

/**
 * Copies files from a hidden copy into the real data folder: files the real folder doesn't have, and files that are
 * newer in the hidden copy. Nothing in the real folder is deleted. Returns { copied, skipped, failed }.
 */
async function mergeInto(src, dest, onFile) {
  const r = { copied: 0, skipped: 0, failed: 0 };
  const walk = async (rel) => {
    let entries; try { entries = await fs.promises.readdir(path.join(src, rel), { withFileTypes: true }); } catch { r.failed++; return; }
    for (const e of entries) {
      const relP = path.join(rel, e.name);
      if (e.isDirectory()) { await walk(relP); continue; }
      if (!e.isFile()) continue;
      const from = path.join(src, relP), to = path.join(dest, relP);
      try {
        const a = await fs.promises.stat(from);
        let b = null; try { b = await fs.promises.stat(to); } catch {}
        if (b && b.mtimeMs >= a.mtimeMs) { r.skipped++; continue; }
        await fs.promises.mkdir(path.dirname(to), { recursive: true });
        await fs.promises.copyFile(from, to);
        await fs.promises.utimes(to, a.atime, a.mtime).catch(() => {});
        r.copied++;
        onFile && onFile(relP);
      } catch { r.failed++; }
    }
  };
  await walk('');
  return r;
}

/**
 * On a normal start: brings back what sandboxed starts left in hidden folders, then renames each hidden copy so it
 * isn't merged twice (kept, not deleted). Returns [{ from, copied, failed }].
 */
async function rescue({ localAppData, dataDir, log = () => {} }) {
  const done = [];
  for (const src of hiddenCopies(localAppData)) {
    if (path.resolve(src).toLowerCase() === path.resolve(dataDir).toLowerCase()) continue;
    const r = await mergeInto(src, dataDir);
    log(`Moved back ${r.copied} file(s) from ${src} (${r.skipped} already up to date, ${r.failed} failed)`);
    if (!r.failed) { try { fs.renameSync(src, src + `-merged-${Date.now()}`); } catch {} }
    done.push({ from: src, ...r });
  }
  return done;
}

module.exports = { inForeignSandbox, restartOutside, hiddenCopies, mergeInto, rescue, HIDDEN };
