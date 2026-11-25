// Instance page tools: modpack unlink, content counts, export with picked files, shortcut arguments.  Run: npm test
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { dataDir, cleanup } = require('./helpers/electron-stub');
const instances = require('../src/instances');
const shortcut = require('../src/shortcut');

after(cleanup);

const put = (inst, rel, text = 'x') => { const p = path.join(inst.gameDir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };

test('unlink keeps the files and remembers which modpack it was', () => {
  const inst = instances.create({ name: 'Pack Test', versionId: '1.21.1', loader: { type: 'fabric', version: '0.16.0' }, extra: { modpack: { name: 'Some Pack', version: '2.0', projectId: 'abc' } } });
  put(inst, 'mods/a.jar');
  const out = instances.unlink(inst.id);
  assert.equal(out.modpack, null);
  assert.equal(out.unlinkedModpack.name, 'Some Pack');
  assert.ok(fs.existsSync(path.join(inst.gameDir, 'mods/a.jar')));
  assert.equal(instances.unlink(inst.id).unlinkedModpack.name, 'Some Pack', 'unlinking twice changes nothing');
});

test('content counts per tab, disabled files included', () => {
  const inst = instances.create({ name: 'Counts', versionId: '1.21.1', loader: { type: 'fabric' } });
  put(inst, 'mods/a.jar'); put(inst, 'mods/b.jar.disabled'); put(inst, 'mods/readme.txt');
  put(inst, 'resourcepacks/p.zip'); put(inst, 'resourcepacks/Folder Pack/pack.mcmeta');
  put(inst, 'datapacks/d.zip');
  const c = instances.contentCounts(inst.id);
  assert.deepEqual(c, { mods: 2, resourcepacks: 2, shaderpacks: 0, datapacks: 1 });
});

test('export takes exactly the picked files and folders, with the pack name and version', async () => {
  const inst = instances.create({ name: 'Export Me', versionId: '1.21.1', loader: { type: 'fabric' } });
  put(inst, 'mods/a.jar'); put(inst, 'config/x.json', '{}'); put(inst, 'config/sub/y.toml', 'a=1'); put(inst, 'options.txt', 'key_key.jump:key.keyboard.space');
  put(inst, 'saves/World/level.dat');
  const tree = instances.exportTree(inst.id);
  assert.ok(tree.find((t) => t.name === 'mods' && t.dir && t.count === 1));
  const dest = path.join(dataDir, 'out.solpack');
  await instances.exportPack(inst.id, dest, ['mods', 'config/sub/y.toml', 'config/sub', 'options.txt', '../../evil', 'missing'], { name: 'My Pack', version: '1.2.3' });
  const zip = new AdmZip(dest);
  const names = zip.getEntries().map((e) => e.entryName.replace(/\\/g, '/')).filter((n) => !n.endsWith('/')).sort();
  assert.deepEqual(names, ['minecraft/config/sub/y.toml', 'minecraft/mods/a.jar', 'minecraft/options.txt', 'solaris.json']);
  const meta = JSON.parse(zip.readAsText('solaris.json'));
  assert.deepEqual(meta.pack, { name: 'My Pack', version: '1.2.3' });
  assert.equal(meta.instance.name, 'My Pack');
  // and it imports back
  const back = await instances.importPack(dest);
  assert.equal(back.name, 'My Pack');
  assert.ok(fs.existsSync(path.join(back.gameDir, 'config/sub/y.toml')));
});

test('shortcut: --launch argument is read safely, ico wraps the png', () => {
  assert.equal(shortcut.fromArgv(['astra.exe', '--launch=my-pack-2']), 'my-pack-2');
  assert.equal(shortcut.fromArgv(['astra.exe', '--launch="my-pack"']), 'my-pack');
  assert.equal(shortcut.fromArgv(['astra.exe', '--launch=../../etc']), null);
  assert.equal(shortcut.fromArgv(['astra.exe']), null);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const ico = shortcut.pngToIco(png);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt32LE(14), png.length);
  assert.ok(ico.subarray(22).equals(png));
});
