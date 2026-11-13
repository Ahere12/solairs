// Renders assets/logo.svg to assets/icon.png (512×512, transparent) with Electron.
// Usage: npx electron tools/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'assets', 'logo.svg'), 'utf8');
  const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace('<svg ', '<svg width="512" height="512" ')}</body></html>`));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.png'), img.resize({ width: 512, height: 512 }).toPNG());
  console.log('icon.png written', img.getSize());
  app.exit(0);
});
