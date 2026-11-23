// Hosting a modpack: the server must end up with the SAME mods as the players' game, or Forge refuses everyone
// with "mismatched mod list" (what happened with DREAD 3.1.2: mts and watchdog were missing on the server).
const { dataDir } = require('./helpers/electron-stub');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

// a Forge mod jar: one [[mods]] entry, optional mandatory dependencies, optional clientSideOnly
function forgeJar(file, modId, { needs = [], clientOnly = false } = {}) {
  const z = new AdmZip();
  const deps = needs.map((d) => `[[dependencies.${modId}]]\nmodId="${d}"\nmandatory=true\nversionRange="[1,)"\nside="BOTH"\n`).join('\n');
  z.addFile('META-INF/mods.toml', Buffer.from(`modLoader="javafml"\nloaderVersion="[43,)"\n${clientOnly ? 'clientSideOnly=true\n' : ''}[[mods]]\nmodId="${modId}"\nversion="1.0"\ndisplayName="${modId}"\n${deps}`));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  z.writeZip(file);
  return file;
}
const sha1 = (p) => crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');

function mkServer(id, extra = {}) {
  const dir = path.join(dataDir, 'hosted', id);
  fs.mkdirSync(path.join(dir, 'mods'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'solaris-server.json'), JSON.stringify({ name: id, mc: '1.19.2', software: 'forge', port: 25570, tunnel: 'none', ...extra }));
  const f = path.join(dataDir, 'hosted', 'servers.json');
  let idx = []; try { idx = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  fs.writeFileSync(f, JSON.stringify([...idx.filter((x) => x.id !== id), { id, dir }]));
  return dir;
}
function mkInstance(name) {
  const instances = require('../src/instances');
  const inst = instances.create({ name, versionId: '1.19.2', loader: { type: 'forge', version: '1.19.2-43.5.0' } });
  const mods = path.join(instances.gameDir(inst), 'mods'); fs.mkdirSync(mods, { recursive: true });
  return { inst, mods };
}

test('the server uses the exact loader version the modpack needs', () => {
  const hs = require('../src/hostserver');
  const list = ['1.19.2-43.2.0', '1.19.2-43.4.0', '1.19.2-43.5.0'];
  const m = { software: 'forge', mc: '1.19.2', loaderVersion: '1.19.2-43.5.0' };
  assert.equal(hs.pinLoader(m, list, '1.19.2-43.2.0'), '1.19.2-43.5.0');
  // a pack may give only "43.5.0" (Modrinth .mrpack); the list has "<mc>-<forge>"
  assert.equal(hs.pinLoader({ ...m, loaderVersion: '43.5.0' }, list, '1.19.2-43.2.0'), '1.19.2-43.5.0');
  // gone from the list: falls back to the recommended one instead of failing
  assert.equal(hs.pinLoader({ ...m, loaderVersion: '43.9.9' }, list, '1.19.2-43.2.0'), '1.19.2-43.2.0');
  // no pack: recommended
  assert.equal(hs.pinLoader({ software: 'forge', mc: '1.19.2' }, list, '1.19.2-43.2.0'), '1.19.2-43.2.0');
  assert.equal(hs.pinLoader({ software: 'neoforge', mc: '1.21.1', loaderVersion: '21.1.267' }, ['21.1.200', '21.1.267'], '21.1.200'), '21.1.267');
});

test('mod ids are read from every loader’s metadata in a jar', () => {
  const hs = require('../src/hostserver');
  const p = forgeJar(path.join(dataDir, 'jars', 'mts.jar'), 'mts', { needs: ['forge', 'somelib'] });
  const ids = hs.jarModIds(p);
  assert.ok(ids.has('mts'));
  // dependencies are other mods, not what this jar provides
  assert.ok(!ids.has('forge') && !ids.has('somelib'), [...ids].join(','));
});

test('players refused with "mismatched mod list" on their own server: the server is fixed', async () => {
  const hs = require('../src/hostserver');
  const dir = mkServer('dread');
  // Astra had turned mts off on the server (wrongly), and watchdog was never put on it
  forgeJar(path.join(dir, 'mods', 'mts-1.19.2.jar.disabled'), 'mts');
  forgeJar(path.join(dir, 'mods', 'create.jar'), 'create');
  fs.writeFileSync(path.join(dir, 'solaris-sidecheck.json'), JSON.stringify({ __v: 2, __off: ['mts-1.19.2.jar'] }));
  const { inst, mods } = mkInstance('DREAD 3.1.2');
  forgeJar(path.join(mods, 'watchdog-1.0.jar'), 'watchdog');
  forgeJar(path.join(mods, 'mts-1.19.2.jar'), 'mts');
  // exactly what the game logged on the player's PC
  const r = await hs.healMismatch({ host: 'localhost', port: 25570, server: ['mts:main', 'watchdog:main'], client: [], instanceId: inst.id });
  assert.ok(r, 'it is the player’s own server');
  assert.equal(r.notFound.length, 0, JSON.stringify(r));
  assert.ok(fs.existsSync(path.join(dir, 'mods', 'mts-1.19.2.jar')), 'mts turned back on');
  assert.ok(fs.existsSync(path.join(dir, 'mods', 'watchdog-1.0.jar')), 'watchdog copied from the game');
  const c = JSON.parse(fs.readFileSync(path.join(dir, 'solaris-sidecheck.json'), 'utf8'));
  assert.ok(c.__keep.includes('mts-1.19.2.jar') && c.__keep.includes('watchdog-1.0.jar'), 'remembered as needed');
  assert.ok(!c.__off.includes('mts-1.19.2.jar'));
  // a server the player doesn't host: nothing is touched
  assert.equal(await hs.healMismatch({ host: 'mc.hypixel.net', port: 25565, server: ['mts:main'] }), null);
});

test('the game lacks a mod the server has: it is added to the player’s instance', async () => {
  const hs = require('../src/hostserver');
  const dir = mkServer('srv-client', { port: 25571 });
  forgeJar(path.join(dir, 'mods', 'serverthing.jar'), 'serverthing');
  const { inst, mods } = mkInstance('Client pack');
  const r = await hs.healMismatch({ host: '127.0.0.1', port: 25571, server: [], client: ['serverthing:net'], instanceId: inst.id });
  assert.deepEqual(r.addedToGame, ['serverthing']);
  assert.ok(fs.existsSync(path.join(mods, 'serverthing.jar')));
});

test('a mod is not turned off just because a dependency LOOKS missing; mods proven needed are never turned off', async () => {
  const hs = require('../src/hostserver');
  const dir = mkServer('deps', { port: 25572 });
  // needs "hidden_lib", provided in a way the scan can't see: it must stay on (Forge itself says so if it's really missing)
  forgeJar(path.join(dir, 'mods', 'vehicles.jar'), 'vehicles', { needs: ['hidden_lib'] });
  // game-only by its own metadata, but players were refused without it → kept
  forgeJar(path.join(dir, 'mods', 'needed-anyway.jar'), 'neededanyway', { clientOnly: true });
  // plain game-only mod → turned off (renamed, not deleted)
  forgeJar(path.join(dir, 'mods', 'shaders.jar'), 'shaders', { clientOnly: true });
  fs.writeFileSync(path.join(dir, 'solaris-sidecheck.json'), JSON.stringify({ __v: 2, __off: [], __keep: ['needed-anyway.jar'] }));
  await hs.disableClientOnly('deps');
  assert.ok(fs.existsSync(path.join(dir, 'mods', 'vehicles.jar')), 'vehicles stays on');
  assert.ok(fs.existsSync(path.join(dir, 'mods', 'needed-anyway.jar')), 'kept jar stays on');
  assert.ok(fs.existsSync(path.join(dir, 'mods', 'shaders.jar.disabled')), 'game-only mod turned off, not deleted');
});

test('a mod that needs a game-only library Astra turned off earlier is turned off too (Legendary Tooltips → Prism)', async () => {
  const hs = require('../src/hostserver');
  const dir = mkServer('tooltips', { port: 25575 });
  // turned off when the server was made (game-only: Modrinth says so for the real one; here its own metadata does)
  forgeJar(path.join(dir, 'mods', 'Prism-1.19.1-1.0.2.jar.disabled'), 'prism', { clientOnly: true });
  forgeJar(path.join(dir, 'mods', 'LegendaryTooltips.jar'), 'legendarytooltips', { needs: ['prism'] });
  forgeJar(path.join(dir, 'mods', 'create.jar'), 'create');
  fs.writeFileSync(path.join(dir, 'solaris-sidecheck.json'), JSON.stringify({ __v: 2, __off: ['Prism-1.19.1-1.0.2.jar'] }));
  await hs.disableClientOnly('tooltips');
  assert.ok(fs.existsSync(path.join(dir, 'mods', 'LegendaryTooltips.jar.disabled')), 'legendarytooltips follows prism');
  assert.ok(fs.existsSync(path.join(dir, 'mods', 'create.jar')), 'unrelated mods stay on');
  assert.ok(fs.existsSync(path.join(dir, 'mods', 'Prism-1.19.1-1.0.2.jar.disabled')));
});

test('modpack mods CurseForge won’t let apps download are copied from the player’s instance before a start', () => {
  const hs = require('../src/hostserver');
  const { mods } = mkInstance('Blocked pack');
  const jar = forgeJar(path.join(mods, 'blocked-mod-2.0.jar'), 'blockedmod');
  const dir = mkServer('blocked', { port: 25573, modpack: { name: 'Pack', manual: [{ name: 'Blocked Mod', file: 'blocked-mod-2.0.jar', sha1: sha1(jar) }, { name: 'Nowhere', file: 'nowhere.jar', sha1: 'ab'.repeat(20) }] } });
  hs.fillMissingPackMods('blocked');
  assert.ok(fs.existsSync(path.join(dir, 'mods', 'blocked-mod-2.0.jar')), 'copied from the instance');
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'solaris-server.json'), 'utf8'));
  assert.deepEqual(m.modpack.manual.map((x) => x.name), ['Nowhere'], 'only the one that is nowhere stays on the list');
  // a file with the same name but different contents is NOT used
  const dir2 = mkServer('blocked2', { port: 25574, modpack: { name: 'Pack', manual: [{ name: 'Blocked Mod', file: 'blocked-mod-2.0.jar', sha1: 'cd'.repeat(20) }] } });
  hs.fillMissingPackMods('blocked2');
  assert.ok(!fs.existsSync(path.join(dir2, 'mods', 'blocked-mod-2.0.jar')));
});
