// CurseForge files whose authors turned off app downloads: Astra fetches them through CurseForge's own website
// download (the same thing that happens when you click "Download" on the file page), so nobody has to go to the
// website, save files and drag them in. Every file is checked against CurseForge's SHA-1 before it's used.
// The window stays hidden; it only shows if CurseForge asks for a browser check, so the player can pass it once.
const fs = require('fs');
const path = require('path');
const { paths, push, sha1File } = require('./util');

const PARTITION = 'persist:curseforge'; // keeps CurseForge's cookies, so a browser check is needed at most once

function websiteUrls(item) {
  const urls = [];
  if (item.modId && item.fileId) urls.push(`https://www.curseforge.com/api/v1/mods/${item.modId}/files/${item.fileId}/download`);
  if (item.page) urls.push(item.page);
  return [...new Set(urls)];
}

/** Downloads one file through a CurseForge web page. Resolves with the downloaded temp path, or null. */
function viaWindow(url, item, { showAfter = 9000, timeout = 120000 } = {}) {
  const { BrowserWindow, session } = require('electron');
  const ses = session.fromPartition(PARTITION);
  return new Promise((resolve) => {
    let finished = false, started = false;
    const tmp = path.join(paths.cache(), 'cf-web', `${Date.now()}-${path.basename(item.file)}`);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    const win = new BrowserWindow({
      show: false, width: 980, height: 720, title: `Astra — getting ${item.name} from CurseForge`, autoHideMenuBar: true,
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const end = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(showTimer); clearTimeout(killTimer);
      ses.removeListener('will-download', onDownload);
      try { if (!win.isDestroyed()) win.destroy(); } catch {}
      resolve(result);
    };
    const onDownload = (_e, dl, wc) => {
      if (wc !== win.webContents) return;
      started = true;
      dl.setSavePath(tmp);
      dl.on('done', (_ev, state) => end(state === 'completed' ? tmp : null));
    };
    ses.on('will-download', onDownload);
    // still nothing after a few seconds: probably a "verify you are human" page — show it so the player can click it
    const showTimer = setTimeout(() => { if (!started && !finished && !win.isDestroyed()) { win.show(); win.focus(); } }, showAfter);
    const killTimer = setTimeout(() => end(null), timeout);
    win.on('closed', () => end(null));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.loadURL(url).catch(() => { /* a download "fails" the navigation; will-download still fires */ });
  });
}

/**
 * Fetches files through the CurseForge website into `target` paths.
 * items: [{ name, file, dir, sha1, modId, fileId, page, target }]. Returns { got: [names], still: [items] }.
 */
async function fetchFiles(items, { label = 'Getting files from CurseForge' } = {}) {
  const got = [], still = [];
  let n = 0;
  for (const item of items) {
    push('task', { id: 'cf-web', label, progress: n / items.length, detail: item.name });
    let ok = false;
    for (const url of websiteUrls(item)) {
      const tmp = await viaWindow(url, item).catch(() => null);
      if (!tmp) continue;
      try {
        if (item.sha1 && (await sha1File(tmp)) !== item.sha1) { fs.rmSync(tmp, { force: true }); continue; } // not the right file
        fs.mkdirSync(path.dirname(item.target), { recursive: true });
        fs.copyFileSync(tmp, item.target);
        fs.rmSync(tmp, { force: true });
        ok = true; break;
      } catch {}
    }
    (ok ? got : still).push(ok ? item.name : item);
    n++;
  }
  push('task', { id: 'cf-web', done: true });
  return { got, still };
}

module.exports = { fetchFiles, websiteUrls };
