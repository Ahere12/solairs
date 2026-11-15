// Lets Solaris's main-process modules load under plain Node (no Electron): `require('electron')` gets a small stub,
// and all Solaris data goes to a fresh temporary folder. Require this before any Solaris module.
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-test-'));
process.env.SOLARIS_DATA_DIR = dataDir;

const stub = {
  app: { getPath: () => dataDir, getVersion: () => '0.0.0-test', setLoginItemSettings() {}, isPackaged: false },
  shell: { openPath: async () => '', openExternal: async () => {} },
  Notification: Object.assign(function Notification() { return { show() {}, on() {} }; }, { isSupported: () => false }),
  clipboard: { writeText() {} },
  // tests can't use the OS key store: "encryption" is reversible but clearly not plain text
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s, 'utf8').reverse(), decryptString: (b) => Buffer.from(b).reverse().toString('utf8') },
};
const load = Module._load;
Module._load = function (request, ...rest) { return request === 'electron' ? stub : load.call(this, request, ...rest); };

module.exports = { dataDir, electron: stub, cleanup: () => fs.rmSync(dataDir, { recursive: true, force: true }) };
