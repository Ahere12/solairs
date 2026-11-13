const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');

let win = null;
let tray = null;
let hiddenForGame = false;
let quitWhenGamesClose = false; // window was closed while a game was running

// GPU acceleration can be turned off in Settings → Performance (read before the app is ready; never creates folders).
try {
  const { paths } = require('./src/util');
  if (!paths.missingDataDir()) {
    const fs = require('fs');
    const root = process.env.SOLARIS_DATA_DIR || (() => { try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'boot.json'), 'utf8')).dataDir; } catch { return null; } })() || paths.defaultRoot();
    const s = JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'));
    if (s.hardwareAcceleration === false) app.disableHardwareAcceleration();
  }
} catch {}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const deeplink = require('./src/deeplink');
  deeplink.register(app);
  { const l = deeplink.fromArgv(process.argv); if (l) deeplink.handle(l, false); } // opened through a solaris:// link
  app.on('second-instance', (_e, argv) => {
    showWindow();
    const l = deeplink.fromArgv(argv);
    if (l) deeplink.handle(l, !!(win && !win.webContents.isLoading()));
  });
  app.on('open-url', (e, url) => { e.preventDefault(); showWindow(); deeplink.handle(url, !!(win && !win.webContents.isLoading())); }); // macOS
  app.whenReady().then(async () => { if (await recoverDataDir()) init(); });
}

/**
 * Safer missing-data-folder recovery: if the data folder was moved to a drive that is no longer there,
 * ask instead of silently starting with an empty launcher (and never create a new empty folder there).
 */
async function recoverDataDir() {
  const { dialog } = require('electron');
  const { paths } = require('./src/util');
  for (;;) {
    const missing = paths.missingDataDir();
    if (!missing) return true;
    const { response } = await dialog.showMessageBox({
      type: 'warning', title: 'Solaris data folder not found', noLink: true, defaultId: 0, cancelId: 3,
      message: 'Solaris can’t find its data folder',
      detail: `Your instances, settings and accounts were moved to:\n${missing}\n\nThat folder isn’t there right now — maybe a USB or external drive is unplugged, or the folder was renamed.`,
      buttons: ['Try again', 'Choose the folder…', 'Use the default folder', 'Quit'],
    });
    if (response === 1) {
      const r = await dialog.showOpenDialog({ title: 'Where is your Solaris data folder?', properties: ['openDirectory'] });
      if (r.filePaths[0]) paths.setRoot(r.filePaths[0]);
    } else if (response === 2) paths.setRoot(paths.defaultRoot());
    else if (response === 3) { app.quit(); return false; }
  }
}

function showWindow() {
  if (!win) return;
  quitWhenGamesClose = false; // the player came back — don't auto-quit any more
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function init() {
  const { events } = require('./src/util');
  const settings = require('./src/settings');
  const api = require('./src/api')(() => win);
  const discord = require('./src/discord');

  ipcMain.handle('api', async (_e, name, args) => {
    const fn = api[name];
    if (!fn) throw new Error('Unknown API: ' + name);
    return fn(...(args || []));
  });

  events.on('send', (channel, payload) => {
    if (win && !win.isDestroyed()) win.webContents.send('event', channel, payload);
  });
  events.on('window', (action) => {
    if (!win) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'hide') { hiddenForGame = true; win.hide(); }
    else if (action === 'restore' && hiddenForGame) { hiddenForGame = false; showWindow(); }
  });

  const s = settings.get();
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
  win = new BrowserWindow({
    width: 1320, height: 840, minWidth: 1040, minHeight: 660,
    frame: false, backgroundColor: '#0d0b12', show: false, icon,
    title: 'Solaris',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, v8CacheOptions: 'bypassHeatCheck' },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  const startHidden = s.startMinimized || process.argv.includes('--hidden');
  win.once('ready-to-show', () => { if (!startHidden) win.show(); else if (!tray) win.minimize(); });
  win.on('close', (e) => {
    if (app.isQuitting) return;
    if (settings.get().minimizeToTray) { e.preventDefault(); win.hide(); return; }
    // A game is running: keep Solaris alive in the tray so play time and logs are still recorded,
    // then quit by itself once the last game closes.
    if (require('./src/launch').anyRunning()) {
      e.preventDefault(); win.hide(); quitWhenGamesClose = true;
      if (Notification.isSupported()) new Notification({ title: 'Solaris is still running', body: 'It will close by itself when you quit the game. Click the tray icon to reopen it.' }).show();
    }
  });
  win.on('maximize', () => win.webContents.send('event', 'window:maximized', true));
  win.on('unmaximize', () => win.webContents.send('event', 'window:maximized', false));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });

  // Tray with quick launch of recent instances.
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Solaris');
  const rebuildTray = () => {
    const instances = require('./src/instances').list().sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 5);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Solaris', click: showWindow },
      { type: 'separator' },
      ...instances.map((i) => ({ label: `Play ${i.name}`, click: () => require('./src/launch').launch(i.id).catch((e) => { showWindow(); events.emit('send', 'toast', { type: 'error', text: e.message }); }) })),
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
    ]));
  };
  rebuildTray();
  tray.on('click', showWindow);
  events.on('send', (ch, payload) => {
    if (ch === 'launch:started' || ch === 'launch:exited') rebuildTray();
    // window was closed during play: quit once nothing is running (a game exited, or a launch failed)
    if ((ch === 'launch:exited' || (ch === 'launch:status' && payload?.error)) && quitWhenGamesClose) setTimeout(() => { if (!require('./src/launch').anyRunning()) { app.isQuitting = true; app.quit(); } }, 1500);
  });

  // Background work starts after the window is up, so it doesn't slow down opening Solaris.
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => { if (settings.get().discordRpc) discord.idle(); }, 1500);
    setTimeout(() => require('./src/updater').init(), 3000);
  });
}

app.on('before-quit', () => {
  app.isQuitting = true;
  try { require('./src/launch').savePlaytimeOnQuit(); } catch {}
});
app.on('window-all-closed', () => app.quit());
