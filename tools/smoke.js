// Smoke test: boots Solaris, visits every page, saves screenshots, reports renderer errors.
// Usage: SOLARIS_DATA_DIR=<tmp> SMOKE_OUT=<dir> electron tools/smoke.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const out = process.env.SMOKE_OUT || path.join(__dirname, '..', 'smoke');
fs.mkdirSync(out, { recursive: true });
require('../main.js');
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  await sleep(1500);
  const win = BrowserWindow.getAllWindows()[0];
  win.show();
  win.webContents.on('console-message', (e) => { const { level, message } = e; if (level === 'error' || level === 3) errors.push(message); });
  const pages = (process.env.SMOKE_PAGES || 'home,library,browse,solaris,servers,skins,gallery,console,changelog,roadmap,settings').split(',');
  await win.webContents.executeJavaScript(`document.querySelectorAll('.modal-back').forEach(m=>m.remove())`);
  if (process.env.SMOKE_JS) await win.webContents.executeJavaScript(process.env.SMOKE_JS).catch((e) => errors.push('SMOKE_JS: ' + e.message));
  for (const p of pages) {
    const [name, params] = p.split('?');
    await win.webContents.executeJavaScript(`Router.go(${JSON.stringify(name)}, ${params ? params : '{}'})`);
    await sleep(+process.env.SMOKE_WAIT || 3500);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, name + (params ? '-' + params.replace(/\W+/g, '') : '') + '.png'), img.toPNG());
    const err = await win.webContents.executeJavaScript(`(document.querySelector('.page .empty')||{}).textContent||''`);
    if (/error|undefined|is not/i.test(err)) errors.push(`${name}: ${err}`);
  }
  fs.writeFileSync(path.join(out, 'errors.txt'), errors.join('\n'));
  console.log('SMOKE DONE. errors:', errors.length ? '\n' + errors.join('\n') : 'none');
  app.exit(0);
});
