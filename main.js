const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

// The launcher is called Astra now, but its own folder keeps the old name: it holds the key that unlocks saved
// Microsoft sign-ins (Windows encrypts them per app folder), the data-folder pointer (boot.json) and the window
// state. A new folder name would sign everyone out. Game data stays in %APPDATA%\.solaris as before.
// (Only the installed app: a development copy keeps its own folder, so it never collides with the installed one.)
if (app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'Solaris'));

let win = null;
let tray = null;
let hiddenForGame = false;
let hostWin = null;   // Hosting popped out into its own window
let callerWin = null; // the window whose request is being handled right now

/** Sends an event to every open Astra window. */
function toAll(...args) {
  for (const w of [win, hostWin]) if (w && !w.isDestroyed()) w.webContents.send(...args);
}

/** Hosting in its own window. One at a time: clicking Pop out again brings it forward (on the clicked server). */
function openHostWindow(params = {}) {
  const id = typeof params.id === 'string' ? params.id : '';
  if (hostWin && !hostWin.isDestroyed()) {
    if (hostWin.isMinimized()) hostWin.restore();
    hostWin.show(); hostWin.focus();
    if (id) hostWin.webContents.send('event', 'popout:go', { id });
    return hostWin;
  }
  const settings = require('./src/settings');
  const b = settings.get().hostWindowBounds || {};
  hostWin = new BrowserWindow({
    width: b.width || 1120, height: b.height || 780, x: b.x, y: b.y, minWidth: 820, minHeight: 560,
    frame: false, backgroundColor: '#05070e', show: false, title: 'Astra Hosting',
    icon: nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  const w = hostWin;
  w.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { popout: 'host', id } });
  w.once('ready-to-show', () => w.show());
  w.on('maximize', () => w.webContents.send('event', 'window:maximized', true));
  w.on('unmaximize', () => w.webContents.send('event', 'window:maximized', false));
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  w.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
  // remember where the player put it
  w.on('close', () => { try { if (!w.isMaximized() && !w.isMinimized()) settings.set({ hostWindowBounds: w.getBounds() }); } catch {} });
  w.on('closed', () => {
    if (hostWin === w) hostWin = null;
    // The main window was closed earlier (only hidden because this one was open): now Astra closes too — unless
    // it lives in the tray anyway, a game or server still runs, or the main window was hidden for a game.
    if (app.isQuitting || !win || win.isDestroyed() || win.isVisible() || hiddenForGame || settings.get().minimizeToTray) return;
    if (require('./src/launch').anyRunning() || require('./src/hostserver').anyRunning()) quitWhenGamesClose = true;
    else { app.isQuitting = true; app.quit(); }
  });
  return w;
}
let quitWhenGamesClose = false; // window was closed while a game was running

// GPU acceleration can be turned off in Settings → Performance (read before the app is ready; never creates folders).
try {
  const { paths } = require('./src/util');
  if (!paths.missingDataDir()) {
    const root = process.env.SOLARIS_DATA_DIR || (() => { try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'boot.json'), 'utf8')).dataDir; } catch { return null; } })() || paths.defaultRoot();
    const s = JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'));
    if (s.hardwareAcceleration === false) app.disableHardwareAcceleration();
  }
} catch {}

// A bug in a background task (a download, a server, Discord) must not pop up an error box or stop Astra:
// write it to logs/main-errors.log instead.
function logMainError(kind, e) {
  try {
    const { paths } = require('./src/util');
    fs.mkdirSync(paths.logs(), { recursive: true });
    fs.appendFileSync(path.join(paths.logs(), 'main-errors.log'), `[${new Date().toISOString()}] ${kind}: ${e && e.stack ? e.stack : String(e)}\n`);
  } catch {}
  console.error(`[Astra] ${kind}:`, e);
}
process.on('uncaughtException', (e) => logMainError('uncaughtException', e));
process.on('unhandledRejection', (e) => logMainError('unhandledRejection', e));

// Started from inside another app's sandbox (e.g. by a Microsoft Store app)? Everything written to AppData would be
// redirected to a hidden folder and modpacks would crash — start again normally instead (src/sandbox.js).
const SANDBOXED = app.isPackaged && process.platform === 'win32' && !process.env.SOLARIS_DATA_DIR && require('./src/sandbox').inForeignSandbox(app.getPath('appData'));
if (SANDBOXED) {
  require('./src/sandbox').restartOutside(process.execPath);
  app.exit(0);
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const deeplink = require('./src/deeplink');
  deeplink.register(app);
  { const l = deeplink.fromArgv(process.argv); if (l) deeplink.handle(l, false); } // opened through a solaris:// link
  launchFromShortcut(process.argv);
  app.on('second-instance', (_e, argv) => {
    showWindow();
    const l = deeplink.fromArgv(argv);
    if (l) deeplink.handle(l, !!(win && !win.webContents.isLoading()));
    launchFromShortcut(argv); // an instance shortcut on the desktop while Astra is already open
  });
  app.on('open-url', (e, url) => { e.preventDefault(); showWindow(); deeplink.handle(url, !!(win && !win.webContents.isLoading())); }); // macOS
  app.whenReady().then(async () => { if (await recoverDataDir()) { await rescueHiddenData(); init(); } });
}

/**
 * Files an earlier start inside another app's sandbox left in a hidden folder (see src/sandbox.js) are moved back
 * into the real data folder before anything reads it — e.g. a modpack installed while Astra ran sandboxed.
 */
async function rescueHiddenData() {
  if (process.platform !== 'win32' || process.env.SOLARIS_DATA_DIR) return;
  try {
    const { paths } = require('./src/util');
    const root = paths.getRoot();
    if (path.basename(root).toLowerCase() !== '.solaris') return; // only the default folder can be redirected
    const lines = [];
    const res = await require('./src/sandbox').rescue({ localAppData: process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local'), dataDir: root, log: (l) => lines.push(l) });
    if (!res.length) return;
    fs.mkdirSync(paths.logs(), { recursive: true });
    fs.appendFileSync(path.join(paths.logs(), 'sandbox-rescue.log'), lines.map((l) => `[${new Date().toISOString()}] ${l}`).join('\n') + '\n');
    const n = res.reduce((a, r) => a + r.copied, 0);
    if (n) setTimeout(() => { try { require('./src/util').push('toast', { type: 'info', text: `Astra found ${n} file${n === 1 ? '' : 's'} (like a modpack) that Windows had put in a hidden folder while Astra was started from inside another app, and moved ${n === 1 ? 'it' : 'them'} back.` }); } catch {} }, 6000);
  } catch (e) { logMainError('sandbox rescue', e); }
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
      type: 'warning', title: 'Astra data folder not found', noLink: true, defaultId: 0, cancelId: 3,
      message: 'Astra can’t find its data folder',
      detail: `Your instances, settings and accounts were moved to:\n${missing}\n\nThat folder isn’t there right now — maybe a USB or external drive is unplugged, or the folder was renamed.`,
      buttons: ['Try again', 'Choose the folder…', 'Use the default folder', 'Quit'],
    });
    if (response === 1) {
      const r = await dialog.showOpenDialog({ title: 'Where is your Astra data folder?', properties: ['openDirectory'] });
      if (r.filePaths[0]) paths.setRoot(r.filePaths[0]);
    } else if (response === 2) paths.setRoot(paths.defaultRoot());
    else if (response === 3) { app.quit(); return false; }
  }
}

/** Instance shortcuts (src/shortcut.js) start Astra with --launch=<id>: play that instance once the window is up. */
function launchFromShortcut(argv) {
  const id = require('./src/shortcut').fromArgv(argv);
  if (!id) return;
  const go = () => {
    const { events } = require('./src/util');
    if (!require('./src/instances').list().some((i) => i.id === id)) return events.emit('send', 'toast', { type: 'error', text: 'That shortcut’s instance no longer exists.' });
    require('./src/launch').launch(id).catch((e) => { showWindow(); events.emit('send', 'toast', { type: 'error', text: e.message }); });
  };
  if (win && !win.webContents.isLoading()) go();
  else {
    const wait = () => {
      if (!win) return setTimeout(wait, 200);
      if (!win.webContents.isLoading()) return setTimeout(go, 1200);
      win.webContents.once('did-finish-load', () => setTimeout(go, 1200));
    };
    app.whenReady().then(wait);
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
  // All of Astra's main code (src/api.js and what it loads) is loaded on the first request from the window instead of
  // before the window is made — the window starts painting ~50 ms sooner. It's ready long before the page asks.
  let api = null;
  const getApi = () => {
    if (api) return api;
    api = require('./src/api')(() => (callerWin && !callerWin.isDestroyed() ? callerWin : win));
    // Hosting in its own window ("Pop out"): opens it, or brings it forward on the server that was clicked.
    api['win:popHost'] = (params = {}) => { openHostWindow(params); return true; };
    api['win:showMain'] = () => { showWindow(); return true; };
    return api;
  };
  const discord = { idle: () => require('./src/discord').idle() };

  ipcMain.handle('api', async (_e, name, args) => {
    const fn = getApi()[name];
    if (!fn) throw new Error('Unknown API: ' + name);
    // window buttons and dialogs belong to the window that asked (the main one or the Hosting window)
    callerWin = BrowserWindow.fromWebContents(_e.sender);
    return fn(...(args || []));
  });

  // Log lines (games, hosted servers) arrive by the thousand while modded games start: send them in batches
  // every 60 ms instead of one IPC message per line. Other events flush the batch first, so order is kept.
  let logQueue = [], logTimer = null;
  const LOG_CHANNELS = new Set(['game:log', 'hosted:log']);
  const flushLogs = () => {
    clearTimeout(logTimer); logTimer = null;
    if (!logQueue.length) return;
    const q = logQueue; logQueue = [];
    toAll('event', 'logs:batch', q);
  };
  events.on('send', (channel, payload) => {
    if (LOG_CHANNELS.has(channel)) {
      logQueue.push([channel, payload]);
      if (logQueue.length >= 500) flushLogs();
      else if (!logTimer) logTimer = setTimeout(flushLogs, 60);
      return;
    }
    flushLogs();
    toAll('event', channel, payload); // the main window and the Hosting window both stay live
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
    frame: false, backgroundColor: '#05070e', show: false, icon,
    title: 'Astra',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, v8CacheOptions: 'bypassHeatCheck', spellcheck: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  const startHidden = s.startMinimized || process.argv.includes('--hidden');
  // Servers marked "Start with Windows" (or with Astra): start them a few seconds after launch.
  setTimeout(() => { try { require('./src/hostserver').autoStartAll(require('./src/launch').resolveJava); } catch {} }, 5000);
  setTimeout(() => { try { require('./src/connect').init(); } catch (e) { console.error('Astra Connect:', e); } }, 6000); // server monitoring + desktop alerts
  try { require('./src/eco').init(); } catch (e) { console.error('Astra ecosystem:', e); } // session analytics, automatic backups, Minecraft / modpack update checks
  win.once('ready-to-show', () => { if (!startHidden) win.show(); else if (!tray) win.minimize(); });
  win.on('close', (e) => {
    if (app.isQuitting) return;
    if (settings.get().minimizeToTray) { e.preventDefault(); win.hide(); return; }
    // the Hosting window is still open: keep Astra running behind it (the tray icon brings this window back)
    if (hostWin && !hostWin.isDestroyed()) { e.preventDefault(); win.hide(); return; }
    // A game is running: keep Astra alive in the tray so play time and logs are still recorded,
    // then quit by itself once the last game closes.
    if (require('./src/launch').anyRunning() || require('./src/hostserver').anyRunning()) {
      e.preventDefault(); win.hide(); quitWhenGamesClose = true;
      if (Notification.isSupported()) new Notification({ title: 'Astra is still running', body: 'It will close by itself when you quit the game. Click the tray icon to reopen it.' }).show();
    }
  });
  win.on('maximize', () => win.webContents.send('event', 'window:maximized', true));
  win.on('unmaximize', () => win.webContents.send('event', 'window:maximized', false));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });

  // Tray with quick launch of recent instances.
  // Linux panels (GNOME AppIndicator, KDE) show tray icons at 22-24 px; Windows uses 16 px.
  const traySize = process.platform === 'linux' ? 24 : 16;
  tray = new Tray(icon.resize({ width: traySize, height: traySize }));
  tray.setToolTip('Astra');
  const rebuildTray = () => {
    const instances = require('./src/instances').list().sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 5);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Astra', click: showWindow },
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
    if ((ch === 'launch:exited' || (ch === 'launch:status' && payload?.error)) && quitWhenGamesClose) setTimeout(() => { if (quitWhenGamesClose && !require('./src/launch').anyRunning() && !require('./src/hostserver').anyRunning()) { app.isQuitting = true; app.quit(); } }, 1500);
  });

  // Background work starts after the window is up, so it doesn't slow down opening Astra.
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => { if (settings.get().discordRpc) discord.idle(); }, 1500);
    setTimeout(() => require('./src/updater').init(), 3000);
  });
}

let serversStopped = false;
app.on('before-quit', (e) => {
  app.isQuitting = true;
  try { require('./src/launch').savePlaytimeOnQuit(); } catch {}
  // Hosted servers must save their worlds: stop them properly before Astra exits (at most 40 s).
  let host; try { host = require('./src/hostserver'); } catch {}
  if (host && host.anyRunning() && !serversStopped) {
    e.preventDefault();
    host.stopAll();
    try { require('./src/playit').stopAgent(); } catch {}
    const t0 = Date.now();
    const wait = setInterval(() => { if (!host.anyRunning() || Date.now() - t0 > 40000) { clearInterval(wait); serversStopped = true; app.quit(); } }, 300);
  }
});
app.on('window-all-closed', () => app.quit());
// The playit.gg agent is Astra's child: never leave it running in the background (e.g. Astra closed during
// server setup). Its tunnels and the link to playit.gg are kept for next time.
app.on('will-quit', () => {
  try { require('./src/playit').stopAgent(); } catch {}
  try { require('./src/eco').shutdown(); } catch {} // unsaved uptime samples, background timers
});
