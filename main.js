const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let win = null;
let tray = null;
let hiddenForGame = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(init);
}

function showWindow() {
  if (!win) return;
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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  const startHidden = s.startMinimized || process.argv.includes('--hidden');
  win.once('ready-to-show', () => { if (!startHidden) win.show(); else if (!tray) win.minimize(); });
  win.on('close', (e) => {
    if (!app.isQuitting && settings.get().minimizeToTray) { e.preventDefault(); win.hide(); }
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
      ...instances.map((i) => ({ label: `Play ${i.name}`, click: () => require('./src/launch').launch(i.id).catch(() => showWindow()) })),
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
    ]));
  };
  rebuildTray();
  tray.on('click', showWindow);
  events.on('send', (ch) => { if (ch === 'launch:started' || ch === 'launch:exited') rebuildTray(); });

  if (s.discordRpc) discord.idle();
}

app.on('before-quit', () => { app.isQuitting = true; });
app.on('window-all-closed', () => app.quit());
