// A modpack installed while Astra ran inside another app's sandbox ended up in a hidden folder and crashed with
// "loader constraint violation … previously loaded by 'app'". These tests cover the protection against that.
const { dataDir } = require('./helpers/electron-stub');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

test('files left in a hidden sandbox folder are moved back: missing and newer files only, nothing deleted', async () => {
  const sb = require('../src/sandbox');
  const local = path.join(dataDir, 'LocalAppData');
  const hidden = path.join(local, 'Packages', 'Some.App_abc123', 'LocalCache', 'Roaming', '.solaris');
  const real = path.join(dataDir, 'real-solaris');
  const w = (root, rel, text, mtime) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); if (mtime) fs.utimesSync(p, mtime, mtime); };
  const old = new Date('2026-11-01T00:00:00Z'), now = new Date('2026-11-28T00:00:00Z');
  // the modpack only exists in the hidden copy
  w(hidden, 'instances/vanilla-perfected/instance.json', '{"name":"Vanilla Perfected"}', now);
  w(hidden, 'instances/vanilla-perfected/minecraft/mods/sodium.jar', 'jar', now);
  // settings: the real one is newer → kept; accounts: the hidden one is newer → taken
  w(hidden, 'settings.json', '{"old":true}', old); w(real, 'settings.json', '{"real":true}', now);
  w(hidden, 'accounts.json', '{"new":true}', now); w(real, 'accounts.json', '{"old":true}', old);
  w(real, 'instances/ahere/instance.json', '{"name":"Ahere"}', old); // only real: untouched
  assert.deepEqual(sb.hiddenCopies(local), [hidden]);
  const res = await sb.rescue({ localAppData: local, dataDir: real });
  assert.equal(res.length, 1);
  assert.equal(res[0].copied, 3, JSON.stringify(res));
  assert.equal(fs.readFileSync(path.join(real, 'instances/vanilla-perfected/instance.json'), 'utf8'), '{"name":"Vanilla Perfected"}');
  assert.ok(fs.existsSync(path.join(real, 'instances/vanilla-perfected/minecraft/mods/sodium.jar')));
  assert.equal(fs.readFileSync(path.join(real, 'settings.json'), 'utf8'), '{"real":true}', 'newer real file kept');
  assert.equal(fs.readFileSync(path.join(real, 'accounts.json'), 'utf8'), '{"new":true}', 'newer hidden file taken');
  assert.ok(fs.existsSync(path.join(real, 'instances/ahere/instance.json')), 'nothing deleted');
  // the hidden copy is renamed (kept), so it isn't merged again
  assert.deepEqual(sb.hiddenCopies(local), []);
  assert.ok(fs.readdirSync(path.dirname(hidden)).some((n) => n.startsWith('.solaris-merged-')));
});

test('detecting a sandbox start never throws and is false for a normal folder', () => {
  const sb = require('../src/sandbox');
  assert.equal(typeof sb.inForeignSandbox(dataDir), 'boolean');
  assert.equal(sb.HIDDEN.test('C:\\Users\\x\\AppData\\Local\\Packages\\AnthropicPBC.Claude_fnn82\\LocalCache\\Roaming\\.solaris\\a.json'), true);
  assert.equal(sb.HIDDEN.test('C:\\Users\\x\\AppData\\Roaming\\.solaris\\a.json'), false);
});

test('the crash helper explains "Fabric was loaded twice"', () => {
  const crash = require('../src/crash');
  const lines = [
    "LinkageError: loader constraint violation: loader 'knot' @3b07a0d6 wants to load class net.fabricmc.api.EnvType. A different class with the same name was previously loaded by 'app'. (net.fabricmc.api.EnvType is in unnamed module of loader 'app')",
  ];
  const a = crash.analyze({ code: 1, lines, gameDir: dataDir, since: Date.now() });
  assert.equal(a.causes[0].title, 'Fabric was loaded twice');
});

test('a copy of Fabric Loader in the mods folder is turned off before the game starts; normal mods are not', () => {
  const { stripLoaderCopies } = require('../src/launch');
  const mods = path.join(dataDir, 'loader-copy', 'mods'); fs.mkdirSync(mods, { recursive: true });
  const jar = (name, files) => { const z = new AdmZip(); for (const [k, v] of Object.entries(files)) z.addFile(k, Buffer.from(v)); z.writeZip(path.join(mods, name)); };
  jar('fabric-loader-0.20.1.jar', { 'fabric-installer.json': '{}', 'net/fabricmc/loader/impl/FabricLoaderImpl.class': 'x' });
  jar('fabric-api-0.100.jar', { 'fabric.mod.json': '{"id":"fabric-api"}' });
  jar('sodium.jar', { 'fabric.mod.json': '{"id":"sodium"}' });
  stripLoaderCopies({ id: 't', loader: { type: 'fabric' } }, path.dirname(mods));
  assert.ok(fs.existsSync(path.join(mods, 'fabric-loader-0.20.1.jar.disabled')), 'loader copy turned off');
  assert.ok(fs.existsSync(path.join(mods, 'fabric-api-0.100.jar')), 'Fabric API stays');
  assert.ok(fs.existsSync(path.join(mods, 'sodium.jar')));
  // Forge instances are left alone
  jar('fabric-loader-copy.jar', { 'fabric-installer.json': '{}', 'net/fabricmc/loader/impl/FabricLoaderImpl.class': 'x' });
  stripLoaderCopies({ id: 't', loader: { type: 'forge' } }, path.dirname(mods));
  assert.ok(fs.existsSync(path.join(mods, 'fabric-loader-copy.jar')));
});
