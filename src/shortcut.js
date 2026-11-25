// Desktop shortcuts for instances: double-click starts Astra (or wakes the running one) and launches the instance.
// The shortcut passes --launch=<instance id>; main.js handles it on start and in 'second-instance'.
const fs = require('fs');
const path = require('path');
const { app, shell, nativeImage } = require('electron');
const { paths } = require('./util');

const ARG = '--launch=';

/** The instance id in a command line, if Astra was started from an instance shortcut. */
function fromArgv(argv) {
  const a = (argv || []).find((x) => typeof x === 'string' && x.startsWith(ARG));
  const id = a ? a.slice(ARG.length).replace(/^"|"$/g, '') : '';
  return /^[A-Za-z0-9._-]{1,80}$/.test(id) ? id : null;
}

/** A Windows .ico that simply holds one PNG (supported since Vista). */
function pngToIco(png) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4); // reserved, type = icon, 1 image
  head.writeUInt8(0, 6); head.writeUInt8(0, 7); // 256 x 256
  head.writeUInt8(0, 8); head.writeUInt8(0, 9);
  head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
  head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
  return Buffer.concat([head, png]);
}

/** Writes the instance's picture next to it. `picture` is the icon as drawn by the window (Minecraft block icons
 *  only exist there); emoji icons can't be turned into a file, so those fall back to the app icon. */
function iconFile(inst, ext, picture) {
  const src = /^data:image\//.test(String(picture || '')) ? picture : inst.icon;
  if (!/^data:image\//.test(String(src || ''))) return null;
  try {
    const img = nativeImage.createFromDataURL(src);
    if (img.isEmpty()) return null;
    const png = img.resize({ width: 256, height: 256, quality: 'best' }).toPNG();
    const out = path.join(paths.instances(), inst.id, 'shortcut-icon.' + ext);
    fs.writeFileSync(out, ext === 'ico' ? pngToIco(png) : png);
    return out;
  } catch { return null; }
}

const safeName = (n) => String(n || 'Minecraft').replace(/[<>:"/\\|?*\x00-\x1f]+/g, '').trim().slice(0, 60) || 'Minecraft';

/** { path, iconFallback }: iconFallback is true when the app icon had to be used instead of the instance's. */
function create(inst, picture) {
  const desktop = app.getPath('desktop');
  // in development Electron needs the app folder as its first argument
  const base = app.isPackaged ? [] : [`"${app.getAppPath()}"`];
  const args = [...base, `${ARG}${inst.id}`].join(' ');
  if (process.platform === 'win32') {
    const file = path.join(desktop, safeName(inst.name) + '.lnk');
    const ico = iconFile(inst, 'ico', picture);
    const ok = shell.writeShortcutLink(file, 'create', { target: process.execPath, args, description: `Play ${inst.name} with Astra`, icon: ico || process.execPath, iconIndex: 0, workingDirectory: path.dirname(process.execPath) });
    if (!ok) throw new Error('Windows didn’t let Astra create the shortcut on your desktop.');
    return { path: file, iconFallback: !ico };
  }
  if (process.platform === 'linux') {
    const file = path.join(desktop, 'astra-' + inst.id + '.desktop');
    const png = iconFile(inst, 'png', picture);
    const exec = (process.env.APPIMAGE || process.execPath).replace(/"/g, '');
    fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=${safeName(inst.name)}\nComment=Play ${safeName(inst.name)} with Astra\nExec="${exec}" ${args}\nIcon=${png || 'solaris'}\nTerminal=false\nCategories=Game;\n`, { mode: 0o755 });
    return { path: file, iconFallback: !png };
  }
  throw new Error('Desktop shortcuts are only available on Windows and Linux.');
}

module.exports = { create, fromArgv, pngToIco, ARG };
