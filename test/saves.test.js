// Astra Connect step 5: save files (NBT), player statistics and advancements.  Run: npm test
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { dataDir, cleanup } = require('./helpers/electron-stub');
const nbt = require('../src/connect/nbt');

after(cleanup);

const { T, enc, root } = require('./helpers/nbt-writer');

test('NBT: every kind of value, gzip and zlib, and damaged files', () => {
  const file = root({
    Data: [T.compound, {
      LevelName: [T.string, 'My Wörld ✨'], GameType: [T.int, 0], hardcore: [T.byte, 1], LastPlayed: [T.long, 1794733070181], Big: [T.long, '9007199254740993'],
      DayTime: [T.long, 24000 * 41 + 100], Health: [T.float, 20], X: [T.double, -12.5], Slot: [T.short, -106],
      Version: [T.compound, { Name: [T.string, '1.21.10'] }], UUID: [T.ints, [1, -2, 3, 4]],
      Inventory: [T.list, [T.compound, [{ id: [T.string, 'minecraft:stick'], count: [T.byte, 6] }]]],
    }],
  });
  for (const packed of [zlib.gzipSync(file), zlib.deflateSync(file), file]) {
    const d = nbt.parse(packed).value.Data;
    assert.equal(d.LevelName, 'My Wörld ✨'); assert.equal(d.hardcore, 1); assert.equal(d.LastPlayed, 1794733070181);
    assert.equal(typeof d.Big, 'bigint', 'a long too big for a JS number stays exact'); assert.equal(d.Slot, -106); assert.equal(d.X, -12.5);
    assert.deepEqual(d.UUID, [1, -2, 3, 4]); assert.deepEqual(d.Inventory, [{ id: 'minecraft:stick', count: 6 }]); assert.equal(d.Version.Name, '1.21.10');
  }
  assert.throws(() => nbt.parse(zlib.gzipSync(file.subarray(0, file.length - 9))), /cut off or damaged/);
  assert.throws(() => nbt.parse(Buffer.from('hello world')), /isn’t a Minecraft save file/);
  // Java's "Modified UTF-8": NUL as C0 80
  assert.equal(nbt.mutf8(Buffer.from([0x61, 0xc0, 0x80, 0x62])), 'a\u0000b');
});

test('stats, advancements and play time from a world', async () => {
  // a hosted server with one world and two players (the owner with a Microsoft and an offline ID)
  const dir = path.join(dataDir, 'hosted', 'srv'), w = path.join(dir, 'world');
  for (const d of ['stats', 'advancements', 'playerdata']) fs.mkdirSync(path.join(w, d), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'hosted', 'servers.json'), JSON.stringify([{ id: 'srv', dir }]));
  fs.writeFileSync(path.join(dir, 'solaris-server.json'), JSON.stringify({ name: 'Survival', mc: '1.21.10', software: 'fabric', port: 25565, tunnel: 'none' }));
  fs.writeFileSync(path.join(dir, 'server.properties'), 'level-name=world\n');
  fs.writeFileSync(path.join(w, 'level.dat'), zlib.gzipSync(root({ Data: [T.compound, { LevelName: [T.string, 'world'], GameType: [T.int, 0], LastPlayed: [T.long, 1794733070181], DayTime: [T.long, 24000 * 9], Version: [T.compound, { Name: [T.string, '1.21.10'] }] }] })));
  const MS = '356d0bc7-55a6-4d7e-8455-09e49860c9d6', OFF = 'bb83b8bb-d63e-3ba9-a952-591247a3eabd';
  fs.writeFileSync(path.join(dir, 'usercache.json'), JSON.stringify([{ uuid: MS, name: 'Ahere1' }, { uuid: OFF, name: 'Ahere1' }]));
  fs.writeFileSync(path.join(w, 'stats', `${MS}.json`), JSON.stringify({ stats: {
    'minecraft:custom': { 'minecraft:play_time': 72000, 'minecraft:deaths': 2, 'minecraft:mob_kills': 7, 'minecraft:walk_one_cm': 150000, 'minecraft:sprint_one_cm': 50000, 'minecraft:fall_one_cm': 99999, 'minecraft:jump': 61, 'minecraft:damage_dealt': 455, 'minecraft:time_since_death': 2400 },
    'minecraft:mined': { 'minecraft:stone': 40, 'minecraft:dirt': 12 }, 'minecraft:killed': { 'minecraft:zombie': 5, 'minecraft:creeper': 2 }, 'minecraft:killed_by': { 'minecraft:skeleton': 2 },
  }, DataVersion: 4556 }));
  fs.writeFileSync(path.join(w, 'stats', `${OFF}.json`), JSON.stringify({ stats: { 'minecraft:custom': { 'minecraft:play_one_minute': 1200 } }, DataVersion: 2586 })); // older name for play time
  fs.writeFileSync(path.join(w, 'advancements', `${MS}.json`), JSON.stringify({
    'minecraft:story/root': { criteria: { crafting_table: '2026-11-15 02:20:00 -0600' }, done: true },
    'minecraft:story/mine_stone': { criteria: { get_stone: '2026-11-15 02:23:10 -0600' }, done: true },
    'minecraft:adventure/adventuring_time': { criteria: { 'minecraft:desert': '2026-11-15 02:23:11 -0600' }, done: false },
    'minecraft:recipes/decorations/ladder': { criteria: { has_stick: '2026-11-15 02:24:00 -0600' }, done: true },
    DataVersion: 4556,
  }));
  const saves = require('../src/connect/saves');
  const ws = saves.worlds();
  assert.deepEqual(ws.map((x) => [x.key, x.players]), [['s:srv:world', 2]]);
  const p = await saves.players('s:srv:world');
  assert.equal(p.world.level.version, '1.21.10'); assert.equal(p.world.level.day, 10); assert.equal(p.world.level.mode, 'Survival');
  assert.deepEqual(p.players.map((x) => [x.name, x.offline, x.playMs, x.advancementsDone]), [['Ahere1', false, 3600000, 2], ['Ahere1', true, 60000, 0]]);
  const one = await saves.player('s:srv:world', MS);
  assert.deepEqual([one.stats.playMs, one.stats.deaths, one.stats.mobKills, one.stats.distanceKm, one.stats.jumps, one.stats.damageDealt, one.stats.blocksMined, one.stats.sinceDeathMs],
    [3600000, 2, 7, 2, 61, 46, 52, 120000], 'falling isn’t distance; damage is stored ×10');
  assert.deepEqual(one.stats.topMined.map((x) => [x.name, x.count]), [['Stone', 40], ['Dirt', 12]]);
  // no game jar for 1.21.10 in this data folder: done ones are listed, the total is unknown
  assert.equal(one.advancements.known, false); assert.equal(one.advancements.total, null); assert.equal(one.advancements.done, 2);
  assert.ok(!one.advancements.list.some((x) => x.id.includes('recipes')), 'recipes aren’t advancements');
  assert.equal(one.advancements.list.find((x) => x.id === 'minecraft:story/mine_stone').when, Date.parse('2026-11-15T02:23:10-06:00'));
  await assert.rejects(saves.player('s:srv:world', '../../etc'), /Unknown player/);
  await assert.rejects(saves.players('s:srv:../../x'), /isn’t there/);
  const t = await saves.totals();
  assert.deepEqual(t.map((x) => [x.name, x.playMs, x.worlds]), [['Ahere1', 3660000, 1]], 'one world even with two IDs');
});

test('advancements: with the game jar, real titles and "X of Y"', () => {
  const AdmZip = require('adm-zip');
  const z = new AdmZip();
  const adv = (title, desc, extra = {}) => Buffer.from(JSON.stringify({ display: { title: { translate: title }, description: { translate: desc }, ...extra }, criteria: {} }));
  z.addFile('data/minecraft/advancement/story/root.json', adv('advancements.story.root.title', 'advancements.story.root.description'));
  z.addFile('data/minecraft/advancement/story/mine_stone.json', adv('advancements.story.mine_stone.title', 'advancements.story.mine_stone.description'));
  z.addFile('data/minecraft/advancement/nether/root.json', adv('advancements.nether.root.title', 'advancements.nether.root.description'));
  z.addFile('data/minecraft/advancement/adventure/secret.json', adv('x.secret', 'x.secret.d', { hidden: true }));
  z.addFile('data/minecraft/advancement/recipes/misc/ladder.json', Buffer.from('{"criteria":{}}'));
  z.addFile('data/minecraft/advancement/story/no_display.json', Buffer.from('{"criteria":{}}'));
  z.addFile('assets/minecraft/lang/en_us.json', Buffer.from(JSON.stringify({ 'advancements.story.root.title': 'Minecraft', 'advancements.story.root.description': 'The heart and story of the game', 'advancements.story.mine_stone.title': 'Stone Age', 'advancements.story.mine_stone.description': 'Mine Stone with your new Pickaxe', 'advancements.nether.root.title': 'Nether', 'advancements.nether.root.description': 'Bring summer clothes' })));
  const vdir = path.join(dataDir, 'versions', '9.9.9'); fs.mkdirSync(vdir, { recursive: true }); z.writeZip(path.join(vdir, '9.9.9.jar'));
  const saves = require('../src/connect/saves');
  const a = saves.advancements({ 'minecraft:story/mine_stone': { criteria: { get_stone: '2026-11-15 02:23:10 -0600' }, done: true }, 'minecraft:custom/datapack_thing': { criteria: {}, done: true } }, '9.9.9');
  assert.equal(a.known, true);
  assert.equal(a.total, 3, 'hidden, recipe and display-less ones don’t count');
  assert.equal(a.done, 1, 'unknown (datapack) advancements are left out');
  assert.deepEqual(a.list[0].title, 'Stone Age', 'done ones first');
  assert.deepEqual(a.list.map((x) => [x.title, x.done]).sort(), [['Minecraft', false], ['Nether', false], ['Stone Age', true]]);
  assert.equal(a.list[0].description, 'Mine Stone with your new Pickaxe');
  // an older jar (≤1.20.6) uses "advancements/" — same result
  const z2 = new AdmZip(); z2.addFile('data/minecraft/advancements/story/root.json', adv('a.t', 'a.d')); z2.addFile('assets/minecraft/lang/en_us.json', Buffer.from('{"a.t":"Old Root"}'));
  const v2 = path.join(dataDir, 'versions', '1.20.1'); fs.mkdirSync(v2, { recursive: true }); z2.writeZip(path.join(v2, '1.20.1.jar'));
  assert.equal(saves.advancementDefs('1.20.1').get('minecraft:story/root').title, 'Old Root');
});

test('Connect: the statistics integration reports what it finds', async () => {
  const connect = require('../src/connect');
  const i = await connect.get('player-stats');
  assert.equal(i.status.state, 'ready'); assert.match(i.status.text, /1 world with stats · 2 players/);
  const t = await connect.details('player-stats');
  assert.deepEqual(t.rows, [['world', 'Server: Survival', '1.21.10', '2']]);
});
