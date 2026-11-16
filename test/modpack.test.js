// Astra Modpack Intelligence: version ranges, reading real jar files, and the instance checks.  Run: npm test
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { dataDir, cleanup } = require('./helpers/electron-stub');
const semver = require('../src/eco/semver');
const mp = require('../src/eco/modpack');

after(cleanup);

const jar = (entries) => { const z = new AdmZip(); for (const [n, c] of Object.entries(entries)) z.addFile(n, Buffer.isBuffer(c) ? c : Buffer.from(typeof c === 'string' ? c : JSON.stringify(c))); return z.toBuffer(); };
const fabricJar = (j, extra = {}) => jar({ 'fabric.mod.json': { schemaVersion: 1, ...j }, ...extra });

test('versions and ranges', () => {
  assert.equal(semver.compare('1.20.1', '1.20'), 1);
  assert.equal(semver.compare('1.20', '1.20.0'), 0);
  assert.equal(semver.compare('1.21-pre1', '1.21'), -1);
  assert.equal(semver.compare('0.15.11+build.3', '0.15.11'), 0);
  assert.equal(semver.compare('24w14a', '1.20'), null);
  assert.equal(semver.satisfies('1.20.1', '>=1.20 <1.21'), true);
  assert.equal(semver.satisfies('1.21', '>=1.20 <1.21'), false);
  assert.equal(semver.satisfies('1.20.4', '~1.20.1'), true);
  assert.equal(semver.satisfies('1.21', '~1.20.1'), false);
  assert.equal(semver.satisfies('3.9.0', '^3.0'), true);
  assert.equal(semver.satisfies('4.0.0', '^3.0'), false);
  assert.equal(semver.satisfies('1.20.6', '1.20.x'), true);
  assert.equal(semver.satisfies('1.21.1', ['1.20.x', '1.21.x']), true);
  assert.equal(semver.satisfies('1.20.2', '1.20 - 1.20.4'), true);
  assert.equal(semver.satisfies('24w14a', '>=1.20'), null, 'a snapshot name is "can’t tell", never a problem');
  assert.equal(semver.satisfies('47.2.0', '[47,)', 'maven'), true);
  assert.equal(semver.satisfies('46.0.1', '[47,)', 'maven'), false);
  assert.equal(semver.satisfies('1.20.1', '[1.20,1.21)', 'maven'), true);
  assert.equal(semver.satisfies('1.21', '[1.20,1.21)', 'maven'), false);
  assert.equal(semver.satisfies('1.20.1', '[1.20.1]', 'maven'), true);
  assert.equal(semver.satisfies('2.5', '[1.0,2.0),[3.0,)', 'maven'), false);
  assert.equal(semver.satisfies('3.1', '[1.0,2.0),[3.0,)', 'maven'), true);
  assert.equal(semver.satisfies('5', '1.0', 'maven'), true, 'a bare Maven version is a soft requirement');
  assert.equal(semver.describe('[1.20,1.21)', 'maven'), '1.20 or newer, before 1.21');
});

test('reads Fabric, Quilt, Forge and NeoForge jars, with mods carried inside', () => {
  const inner = fabricJar({ id: 'cloth-basic-math', version: '0.6.1' });
  const f = mp.readManifest(fabricJar({ id: 'Cloth-Config', name: 'Cloth Config', version: '11.1.106', depends: { fabricloader: '>=0.14', minecraft: '~1.20' }, breaks: { optifabric: '*' }, conflicts: { 'old-lib': '<2' }, provides: ['cloth_config'], jars: [{ file: 'META-INF/jars/math.jar' }] }, { 'META-INF/jars/math.jar': inner }));
  assert.equal(f.loader, 'fabric'); assert.equal(f.modId, 'cloth-config'); assert.equal(f.version, '11.1.106');
  assert.deepEqual(f.depends.map((d) => d.id), ['fabricloader', 'minecraft']);
  assert.deepEqual(f.breaks.map((b) => [b.id, b.hard]), [['optifabric', true], ['old-lib', false]]);
  assert.deepEqual(f.provides, ['cloth_config']);
  assert.deepEqual(f.nested.map((n) => n.modId), ['cloth-basic-math']);

  const q = mp.readManifest(jar({ 'quilt.mod.json': { quilt_loader: { id: 'qmod', version: '1.0.0', depends: ['minecraft', { id: 'quilted_fabric_api', versions: '>=7' }, { id: 'modmenu', optional: true }] } } }));
  assert.equal(q.loader, 'quilt');
  assert.deepEqual(q.depends.map((d) => d.id), ['minecraft', 'quilted_fabric_api']);
  assert.deepEqual(q.recommends.map((d) => d.id), ['modmenu']);

  const toml = `modLoader="javafml"\nloaderVersion="[47,)"\n[[mods]]\nmodId="jei"\nversion="\${file.jarVersion}"\ndisplayName="Just Enough Items"\n[[dependencies.jei]]\n    modId="forge"\n    mandatory=true\n    versionRange="[47,)"\n[[dependencies.jei]]\n    modId="minecraft"\n    mandatory=true\n    versionRange="[1.20.1,1.20.2)"\n[[dependencies.jei]]\n    modId="rei"\n    type="incompatible"\n    reason="Pick one recipe viewer."\n`;
  const fo = mp.readManifest(jar({ 'META-INF/mods.toml': toml, 'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\nImplementation-Version: 15.2.0.27\n' }));
  assert.equal(fo.loader, 'forge'); assert.equal(fo.modId, 'jei'); assert.equal(fo.version, '15.2.0.27', 'version comes from the jar manifest');
  assert.deepEqual(fo.depends.map((d) => d.id), ['forge', 'minecraft']);
  assert.equal(fo.breaks[0].id, 'rei'); assert.equal(fo.breaks[0].hard, true); assert.equal(fo.breaks[0].reason, 'Pick one recipe viewer.');

  const neo = mp.readManifest(jar({ 'META-INF/neoforge.mods.toml': '[[mods]]\nmodId="neomod"\nversion="2.0"\n[[dependencies.neomod]]\nmodId="neoforge"\ntype="required"\nversionRange="[21,)"\n' }));
  assert.equal(neo.loader, 'neoforge'); assert.equal(neo.depends[0].id, 'neoforge');

  assert.equal(mp.readManifest(jar({ 'a.txt': 'hi' })), null, 'a jar without mod metadata is not a mod');
  assert.ok(mp.readManifest(Buffer.from('not a zip')).error);
});

const M = (file, manifest, enabled = true) => ({ file, enabled, manifest });
const fab = (id, version, more = {}) => ({ loader: 'fabric', style: 'fabric', modId: id, name: id, version, depends: [], recommends: [], breaks: [], provides: [], nested: [], ...more });
const env = { mc: '1.20.1', loader: { type: 'fabric', version: '0.15.11' } };
const types = (r) => r.findings.map((f) => f.type).sort();

test('a healthy pack has no findings', () => {
  const r = mp.analyze([M('fabric-api.jar', fab('fabric-api', '0.92.0', { depends: [{ id: 'fabricloader', range: '>=0.14' }, { id: 'minecraft', range: '~1.20.1' }] })), M('sodium.jar', fab('sodium', '0.5.8', { depends: [{ id: 'fabric-api', range: '*' }] }))], env);
  assert.deepEqual(r.findings, []);
  assert.equal(mp.health(r).grade, 'healthy');
  assert.equal(mp.health(r).score, 100);
});

test('missing and disabled dependencies, wrong versions, wrong Minecraft and loader', () => {
  const r = mp.analyze([
    M('a.jar', fab('a', '1.0', { depends: [{ id: 'fabric-api', range: '*' }, { id: 'cloth-config', range: '>=11' }, { id: 'lib', range: '>=2' }] })),
    M('cloth.jar', fab('cloth-config', '10.0'), true),
    M('lib.jar.disabled', fab('lib', '2.1'), false),
    M('old.jar', fab('old', '1.0', { depends: [{ id: 'minecraft', range: '1.19.x' }, { id: 'fabricloader', range: '>=0.16' }] })),
    M('forgemod.jar', { ...fab('forgemod', '1'), loader: 'forge', style: 'maven' }),
  ], env);
  const byType = (t) => r.findings.filter((f) => f.type === t);
  assert.deepEqual(byType('missing-dependency').map((f) => [f.dep, f.fix.kind]).sort(), [['fabric-api', 'install'], ['lib', 'enable']]);
  assert.equal(byType('missing-dependency').find((f) => f.dep === 'lib').fix.file, 'lib.jar.disabled');
  assert.equal(byType('dependency-version')[0].dep, 'cloth-config');
  assert.equal(byType('wrong-minecraft')[0].modId, 'old');
  assert.equal(byType('wrong-loader-version')[0].modId, 'old');
  assert.equal(byType('wrong-loader')[0].modId, 'forgemod');
  assert.equal(mp.health(r).grade, 'broken');
  assert.ok(mp.recommendations(r.findings).some((x) => /Install fabric-api/.test(x.text)));
});

test('jar-in-jar and "provides" count as installed; Quilt loads Fabric mods', () => {
  const r = mp.analyze([
    M('a.jar', fab('a', '1', { depends: [{ id: 'cloth-basic-math', range: '>=0.5' }, { id: 'cloth_config', range: '*' }] })),
    M('cloth.jar', fab('cloth-config', '11', { provides: ['cloth_config'], nested: [{ modId: 'cloth-basic-math', version: '0.6.1', provides: [] }] })),
  ], { mc: '1.20.1', loader: { type: 'quilt', version: '0.26' } });
  assert.deepEqual(r.findings, []);
});

test('duplicates keep the newest; declared conflicts are errors or warnings', () => {
  const r = mp.analyze([
    M('sodium-0.5.3.jar', fab('sodium', '0.5.3')), M('sodium-0.5.8.jar', fab('sodium', '0.5.8')),
    M('of.jar', fab('optifabric', '1.14', { breaks: [] })),
    M('iris.jar', fab('iris', '1.7', { breaks: [{ id: 'optifabric', range: '*', hard: true }, { id: 'sodium', range: '<0.5', hard: false }] })),
  ], env);
  const dup = r.findings.find((f) => f.type === 'duplicate');
  assert.equal(dup.fix.keep, 'sodium-0.5.8.jar'); assert.deepEqual(dup.fix.files, ['sodium-0.5.3.jar']);
  const conflicts = r.findings.filter((f) => f.type === 'conflict');
  assert.equal(conflicts.length, 1, 'the soft conflict only applies to sodium < 0.5, which isn’t installed');
  assert.equal(conflicts[0].severity, 'error'); assert.deepEqual(conflicts[0].fix.files, ['iris.jar', 'of.jar']);
});

test('a Vanilla instance with mods, unreadable jars, a disabled mod is ignored', () => {
  const v = mp.analyze([M('x.jar', fab('x', '1'))], { mc: '1.20.1', loader: { type: 'vanilla' } });
  assert.deepEqual(types(v), ['wrong-loader']);
  const u = mp.analyze([M('bad.jar', { error: 'Not a readable jar' }), M('off.jar.disabled', fab('off', '1', { depends: [{ id: 'nope', range: '*' }] }), false)], env);
  assert.deepEqual(types(u), ['unreadable']);
});

test('real-world ranges and duplicates: "<1.20.2-", and the copy that fits this Minecraft is kept', () => {
  assert.equal(semver.satisfies('1.20.1', '>=1.20 <1.20.2-'), true, 'Fabric API 0.92 for 1.20.1 really says this');
  assert.equal(semver.satisfies('1.20.2-pre1', '<1.20.2-'), false);
  const r = mp.analyze([
    M('sodium-0.5.13.jar', fab('sodium', '0.5.13+mc1.20.1', { depends: [{ id: 'minecraft', range: '>=1.20 <1.20.2' }] })),
    M('sodium-0.8.13.jar', fab('sodium', '0.8.13+mc1.21.1', { depends: [{ id: 'minecraft', range: ['1.21', '1.21.1'] }], provides: ['indium'], breaks: [] })),
    M('sodium-0.4.10.jar', fab('sodium', '0.4.10', { breaks: [{ id: 'indium', range: '<1.0.36', hard: true }] })),
  ], env);
  const dup = r.findings.find((f) => f.type === 'duplicate');
  assert.equal(dup.fix.keep, 'sodium-0.5.13.jar');
  assert.ok(!r.findings.some((f) => f.type === 'conflict'), 'a copy of the same mod "providing" indium isn’t a conflict');
});

test('comparing two packs', () => {
  const c = mp.compare(
    [M('a.jar', fab('a', '1.0')), M('b.jar', fab('b', '2.0')), M('c.jar', fab('c', '1')), M('x.zip', null)],
    [M('a2.jar', fab('a', '1.1')), M('b.jar', fab('b', '2.0')), M('d.jar', fab('d', '1'))],
  );
  assert.deepEqual(c.onlyA.map((x) => x.id), ['c', 'file:x.zip']);
  assert.deepEqual(c.onlyB.map((x) => x.id), ['d']);
  assert.deepEqual(c.different, [{ id: 'a', name: 'a', a: '1.0', b: '1.1', newer: 'b' }]);
  assert.equal(c.same, 1);
});

test('checks a real instance folder', async () => {
  const instances = require('../src/instances');
  const inst = instances.create({ name: 'Health test', versionId: '1.20.1', loader: { type: 'fabric', version: '0.15.11' } });
  const mods = path.join(inst.gameDir, 'mods');
  fs.mkdirSync(mods, { recursive: true });
  fs.writeFileSync(path.join(mods, 'sodium.jar'), fabricJar({ id: 'sodium', version: '0.5.8', depends: { 'fabric-api': '*', minecraft: '1.20.x' } }));
  fs.writeFileSync(path.join(mods, 'notes.jar'), jar({ 'readme.txt': 'library' }));
  const r = await mp.check(inst.id);
  assert.equal(r.instance.id, inst.id);
  assert.deepEqual(r.findings.map((f) => [f.type, f.dep]), [['missing-dependency', 'fabric-api']]);
  assert.equal(r.counts.notMods, 1);
  assert.ok(fs.readdirSync(mods).length === 2, 'checking never changes files');
  assert.ok(dataDir);
});
