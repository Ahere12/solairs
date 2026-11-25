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
/** Integrations installed through the Developer Hub (a broken one is left out, never stops Connect). */
function thirdParty() { try { return require('../eco/devhub').definitions(); } catch (e) { console.error('[Astra] Developer Hub:', e.message); return []; } }
const registry = () => (reg = reg || createRegistry({ defs: [...INTEGRATIONS, ...thirdParty()], store: { read: () => readJSON(file(), {}), write: (d) => writeJSON(file(), d) }, secrets,
  // a new problem goes to the Astra inbox (Notifications → Integration problems)
  onError: (id, name, message) => require('../eco/notify').add({ category: 'integration', title: `${name}: problem`, body: message, key: `integration:${id}:${message}`, action: { kind: 'route', page: 'settings' } }),
}));

module.exports = {
  /** Builds the registry again (after a Developer Hub install / uninstall). */
  reload: () => { reg = null; return true; },
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
