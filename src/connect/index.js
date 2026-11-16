// Astra Connect — the app's registry: Astra's integrations, their state in connect.json, secrets sealed with
// the operating system's key store (Electron safeStorage) so they never sit in the file as plain text.
const { safeStorage } = require('electron');
const { paths, readJSON, writeJSON } = require('../util');
const { createRegistry } = require('./registry');
const { INTEGRATIONS } = require('./integrations');

const file = () => paths.file('connect.json');
const secrets = {
  seal: (s) => (safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(s).toString('base64') : 'b64:' + Buffer.from(s).toString('base64')),
  unseal: (s) => (s.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(s.slice(4), 'base64')) : Buffer.from(s.slice(4), 'base64').toString()),
};
let reg = null;
const registry = () => (reg = reg || createRegistry({ defs: INTEGRATIONS, store: { read: () => readJSON(file(), {}), write: (d) => writeJSON(file(), d) }, secrets }));

module.exports = {
  list: () => registry().list(),
  get: (id) => registry().get(String(id)),
  status: (id) => registry().status(String(id)),
  setEnabled: (id, on) => registry().setEnabled(String(id), !!on),
  setConfig: (id, patch) => registry().setConfig(String(id), patch && typeof patch === 'object' ? patch : {}),
  clearErrors: (id) => registry().clearErrors(String(id)),
  details: (id) => registry().details(String(id)),
  /** Starts what runs in the background (server monitoring, desktop alerts). Called once when Astra starts. */
  init: () => require('./runtime').init((id) => registry().active(id)),
  restartWatch: () => require('./runtime').restartWatch((id) => registry().active(id)),
  compatibility: (id) => registry().compatibility(String(id), require('../hostserver').list().filter((s) => !s.missing)),
};
