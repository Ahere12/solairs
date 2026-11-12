// Launcher self-update from GitHub Releases (electron-updater). Progress is pushed to the renderer as 'update:state'.
// Releases: upload the files from dist/ (Solaris Setup x.y.z.exe, .blockmap, latest.yml) to a GitHub release on
// Ahere12/solairs — see README → "Releasing an update".
// SOLARIS_FAKE_UPDATE=1 simulates an update (for testing the in-launcher animation without a release).
const { app } = require('electron');
const { push } = require('./util');

let state = { status: 'idle' }; // idle | checking | available | downloading | ready | error | none
let updater = null;
let fakeTimer = null;

function set(patch) {
  state = { ...state, ...patch };
  push('update:state', state);
}

function init() {
  if (process.env.SOLARIS_FAKE_UPDATE) { setTimeout(fakeUpdate, 2500); return; }
  if (!app.isPackaged) return; // `npm start`: nothing to update
  try { updater = require('electron-updater').autoUpdater; } catch (e) { console.error('[Solaris] updater unavailable', e); return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.logger = null;
  updater.on('checking-for-update', () => set({ status: 'checking' }));
  updater.on('update-available', (i) => set({ status: 'downloading', version: i.version, notes: notesText(i.releaseNotes), percent: 0, transferred: 0, total: 0, speed: 0 }));
  updater.on('update-not-available', () => set({ status: 'none' }));
  updater.on('download-progress', (p) => set({ status: 'downloading', percent: p.percent, transferred: p.transferred, total: p.total, speed: p.bytesPerSecond }));
  updater.on('update-downloaded', (i) => set({ status: 'ready', version: i.version, percent: 100 }));
  updater.on('error', (e) => {
    const msg = String(e?.message || e);
    console.error('[Solaris] update error:', msg);
    // No release published yet, offline, or GitHub rate limit: not the player's problem — stay quiet and retry later.
    // Only a download that had actually started is reported.
    if (state.status !== 'downloading') { set({ status: 'none' }); return; }
    set({ status: 'error', error: /ENOTFOUND|ECONNRESET|ETIMEDOUT|net::/i.test(msg) ? 'The update download was interrupted. Solaris will try again later.' : 'Couldn’t download the update. Solaris will try again later.' });
  });
  check();
  setInterval(check, 4 * 60 * 60 * 1000); // and every 4 hours while open
}

function notesText(n) {
  if (!n) return '';
  const s = Array.isArray(n) ? n.map((x) => x.note).join('\n') : String(n);
  return s.replace(/<[^>]+>/g, '').trim().slice(0, 600);
}

function check() {
  if (process.env.SOLARIS_FAKE_UPDATE) { if (state.status !== 'downloading' && state.status !== 'ready') fakeUpdate(); return state; }
  if (!updater || state.status === 'downloading' || state.status === 'ready') return state;
  updater.checkForUpdates().catch(() => {});
  return state;
}

function install() {
  if (state.status !== 'ready') return false;
  set({ status: 'installing' });
  // short delay so the renderer can play its "installing" animation
  setTimeout(() => {
    app.isQuitting = true;
    if (process.env.SOLARIS_FAKE_UPDATE) { app.exit(0); return; } // test mode: nothing to install
    updater.quitAndInstall(true, true); // silent install, then reopen Solaris
  }, 1800);
  return true;
}

function fakeUpdate() {
  clearInterval(fakeTimer);
  const total = 118 * 1024 * 1024;
  let got = 0;
  set({ status: 'downloading', version: '9.9.9', notes: 'Test update (SOLARIS_FAKE_UPDATE).', percent: 0, transferred: 0, total, speed: 0 });
  fakeTimer = setInterval(() => {
    const speed = (6 + Math.random() * 6) * 1024 * 1024;
    got = Math.min(total, got + speed / 4);
    set({ percent: (got / total) * 100, transferred: got, speed });
    if (got >= total) { clearInterval(fakeTimer); set({ status: 'ready', percent: 100 }); }
  }, 250);
}

module.exports = { init, check, install, getState: () => state };
