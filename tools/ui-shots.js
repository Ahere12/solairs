// Screenshots of dialogs and pages driven by small scripts (tools/smoke.js covers plain page visits).
// Usage: SOLARIS_DATA_DIR=<tmp> SHOTS_OUT=<dir> SHOTS=<file.json: [[name, js], ...]> electron tools/ui-shots.js --user-data-dir=<tmp>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const out = process.env.SHOTS_OUT || path.join(__dirname, '..', 'smoke');
fs.mkdirSync(out, { recursive: true });
require('../main.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const steps = JSON.parse(fs.readFileSync(process.env.SHOTS, 'utf8'));
app.whenReady().then(async () => {
  await sleep(2500);
  const win = BrowserWindow.getAllWindows()[0];
  win.show();
  const errors = [];
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) errors.push(e.message); });
  for (const [name, js, wait] of steps) {
    try { await win.webContents.executeJavaScript(`(async () => { ${js} })()`); } catch (e) { errors.push(`${name}: ${e.message}`); }
    await sleep(wait || 2500);
    if (name) fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
  }
  fs.writeFileSync(path.join(out, 'errors.txt'), errors.join('\n'));
  console.log('SHOTS DONE. errors:', errors.length ? '\n' + errors.join('\n') : 'none');
  app.exit(0);
});
