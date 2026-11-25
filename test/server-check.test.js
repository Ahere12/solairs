// Server readiness check (Hosting → Check): required mods, modpack mods that are off, crash-proven game-only jars,
// and Fix all converging without turning the same mod on and off again.  Run: npm test
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { dataDir, cleanup } = require('./helpers/electron-stub');
const hs = require('../src/hostserver');

after(cleanup);

const forgeJar = (file, modId, { needs = [], displayTest = null } = {}) => {
  const z = new AdmZip();
  const deps = needs.map((d) => `[[dependencies.${modId}]]\n    modId="${d}"\n    mandatory=true\n    side="BOTH"\n`).join('');
  z.addFile('META-INF/mods.toml', Buffer.from(`modLoader="javafml"\nloaderVersion="[47,)"\n[[mods]]\nmodId="${modId}"\nversion="1.0"\n${displayTest ? `displayTest="${displayTest}"\n` : ''}${deps}`));
  fs.writeFileSync(file, z.toBuffer());
};

function server(id) {
  const dir = path.join(dataDir, 'hosted', id);
  fs.mkdirSync(path.join(dir, 'mods'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'solaris-server.json'), JSON.stringify({ name: id, software: 'forge', mc: '1.20.1', memory: 8192, port: 25600, modpack: { name: 'Pack', source: 'curseforge' } }));
  fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n');
  fs.writeFileSync(path.join(dir, 'run.bat'), '');
  // registered in the server list (servers may live in any folder)
  const idx = path.join(dataDir, 'hosted', 'servers.json');
  let list = []; try { list = JSON.parse(fs.readFileSync(idx, 'utf8')); } catch {}
  if (!list.some((x) => x.id === id)) fs.writeFileSync(idx, JSON.stringify([...list, { id, dir }]));
  return dir;
}

test('a mod that needs a turned-off mod: offered to turn the needed one back on', async () => {
  const dir = server('needs');
  forgeJar(path.join(dir, 'mods', 'core.jar'), 'core', { needs: ['lib'] });
  forgeJar(path.join(dir, 'mods', 'lib.jar.disabled'), 'lib');
  const r = await hs.checkServer('needs');
  assert.equal(r.ready, false);
  const c = r.checks.find((x) => /needs lib/.test(x.title));
  assert.deepEqual(c.fix, { type: 'enable', file: 'lib.jar', label: 'Turn it back on' });
  await hs.applyFix('needs', c.fix);
  assert.ok(fs.existsSync(path.join(dir, 'mods', 'lib.jar')));
  assert.equal((await hs.checkServer('needs')).ready, true);
  // remembered as needed: the game-only check never turns it off again
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'solaris-sidecheck.json'), 'utf8')).__keep, ['lib.jar']);
});

test('modpack mods that are off: only the ones players must have on both sides are flagged', async () => {
  const dir = server('packoff');
  forgeJar(path.join(dir, 'mods', 'boss.jar.disabled'), 'boss');
  forgeJar(path.join(dir, 'mods', 'keys.jar.disabled'), 'keys', { displayTest: 'IGNORE_ALL_VERSION' });
  fs.writeFileSync(path.join(dir, 'solaris-content.json'), JSON.stringify({ 'cf:1': { file: 'boss.jar', title: 'Boss Mod', pack: true }, 'cf:2': { file: 'keys.jar', title: 'Keys', pack: true } }));
  const r = await hs.checkServer('packoff');
  const titles = r.checks.filter((c) => !c.ok).map((c) => c.title);
  assert.ok(titles.includes('Boss Mod is turned off'));
  assert.ok(!titles.some((t) => /Keys/.test(t)), 'a mod the game may lack (IGNORE_* displayTest) is fine off');
  // never automatic: the player may have turned it off on purpose
  await hs.checkServer('packoff', { autoFix: true });
  assert.ok(fs.existsSync(path.join(dir, 'mods', 'boss.jar.disabled')));
});

test('a crash-proven game-only jar is turned off and stays off (no on/off loop with the modpack check)', async () => {
  const dir = server('crash');
  forgeJar(path.join(dir, 'mods', 'dam.jar'), 'dam');
  fs.writeFileSync(path.join(dir, 'solaris-content.json'), JSON.stringify({ 'cf:3': { file: 'dam.jar', title: 'Dimension Access', pack: true } }));
  fs.mkdirSync(path.join(dir, 'crash-reports'));
  fs.writeFileSync(path.join(dir, 'crash-reports', 'crash-2026-11-25_02.39.55-fml.txt'), `Description: Mod loading error has occurred\n\n-- Mod loading issue for: dam --\n\tjava.lang.RuntimeException: Attempted to load class net/minecraft/client/multiplayer/MultiPlayerGameMode for invalid dist DEDICATED_SERVER\n\tMod File: /C:/x/mods/dam.jar\n\tFailure message: Dam has failed to load correctly\n`);
  fs.mkdirSync(path.join(dir, 'logs'));
  fs.writeFileSync(path.join(dir, 'logs', 'latest.log'), '[main/FATAL] Mod Loading has failed\n[main/ERROR] Failed to start the minecraft server\n');
  const d = await hs.diagnose('crash');
  const f = d.findings.find((x) => x.auto);
  assert.equal(f.fix.file, 'dam.jar');
  assert.equal(d.findings.filter((x) => /made only for the game/.test(x.text)).length, 0, 'no vague duplicate when the jar is known');
  for (let pass = 0; pass < 4; pass++) {
    const r = await hs.checkServer('crash');
    const todo = r.checks.filter((c) => !c.ok && c.fix && ['enable', 'disable'].includes(c.fix.type));
    if (!todo.length) break;
    for (const c of todo) await hs.applyFix('crash', c.fix);
  }
  assert.ok(fs.existsSync(path.join(dir, 'mods', 'dam.jar.disabled')), 'still off after Fix all');
  assert.equal((await hs.checkServer('crash')).ready, true);
});
