// Solaris Connect step 6: inventory viewer.  Run: npm test
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { dataDir, cleanup } = require('./helpers/electron-stub');
const { T, root } = require('./helpers/nbt-writer');
const inv = require('../src/connect/inventory');

after(cleanup);

const itemNew = (id, count, components) => [T.compound, { id: [T.string, id], count: [T.int, count], ...(components ? { components: [T.compound, components] } : {}) }];
const slotNew = (slot, id, count, components) => ({ Slot: [T.byte, slot], id: [T.string, id], count: [T.int, count], ...(components ? { components: [T.compound, components] } : {}) });
const slotOld = (slot, id, count, tag) => ({ Slot: [T.byte, slot], id: [T.string, id], Count: [T.byte, count], ...(tag ? { tag: [T.compound, tag] } : {}) });

function server(id, mc) {
  const dir = path.join(dataDir, 'hosted', id), w = path.join(dir, 'world');
  for (const d of ['stats', 'playerdata']) fs.mkdirSync(path.join(w, d), { recursive: true });
  fs.writeFileSync(path.join(dir, 'solaris-server.json'), JSON.stringify({ name: id, mc, software: 'paper', port: 25565, tunnel: 'none' }));
  fs.writeFileSync(path.join(dir, 'server.properties'), 'level-name=world\n');
  fs.writeFileSync(path.join(w, 'level.dat'), zlib.gzipSync(root({ Data: [T.compound, { LevelName: [T.string, 'world'] }] })));
  return { dir, w };
}
const index = (list) => fs.writeFileSync(path.join(dataDir, 'hosted', 'servers.json'), JSON.stringify(list));
const U = '356d0bc7-55a6-4d7e-8455-09e49860c9d6';

test('item text: custom names in every format', () => {
  assert.equal(inv.textOf('{"text":"Excalibur"}'), 'Excalibur');
  assert.equal(inv.textOf({ text: 'Big ', extra: [{ text: 'Sword' }] }), 'Big Sword');
  assert.equal(inv.textOf('"Plain"'), 'Plain');
  assert.equal(inv.textOf('Just text'), 'Just text');
  assert.equal(inv.textOf(null), null);
});

test('1.21.5+ saves: inventory, equipment, ender chest, enchantments, shulker box and bundle contents', () => {
  const a = server('new-srv', '1.21.10');
  const player = root({
    DataVersion: [T.int, 4556], SelectedItemSlot: [T.int, 2], Health: [T.float, 17.5], foodLevel: [T.int, 18], XpLevel: [T.int, 30], playerGameType: [T.int, 0],
    Dimension: [T.string, 'minecraft:the_nether'], Pos: [T.list, [T.double, [-603.7, 70, 252.6]]],
    Inventory: [T.list, [T.compound, [
      slotNew(0, 'minecraft:diamond_sword', 1, { 'minecraft:enchantments': [T.compound, { 'minecraft:sharpness': [T.int, 5], 'minecraft:looting': [T.int, 3] }], 'minecraft:damage': [T.int, 100], 'minecraft:custom_name': [T.compound, { text: [T.string, 'Excalibur'] }] }),
      slotNew(2, 'minecraft:stick', 6),
      slotNew(9, 'minecraft:shulker_box', 1, { 'minecraft:container': [T.list, [T.compound, [{ slot: [T.int, 0], item: itemNew('minecraft:diamond', 64) }, { slot: [T.int, 26], item: itemNew('minecraft:emerald', 3) }]]] }),
      slotNew(35, 'minecraft:bundle', 1, { 'minecraft:bundle_contents': [T.list, [T.compound, [{ id: [T.string, 'minecraft:apple'], count: [T.int, 2] }]]] }),
    ]]],
    equipment: [T.compound, { head: itemNew('minecraft:turtle_helmet', 1), feet: itemNew('minecraft:diamond_boots', 1, { 'minecraft:enchantments': [T.compound, { levels: [T.compound, { 'minecraft:feather_falling': [T.int, 4] }] }] }), offhand: itemNew('minecraft:totem_of_undying', 1) }],
    EnderItems: [T.list, [T.compound, [slotNew(26, 'minecraft:elytra', 1, { 'minecraft:damage': [T.int, 10], 'minecraft:max_damage': [T.int, 432] })]]],
  });
  fs.writeFileSync(path.join(a.w, 'playerdata', `${U}.dat`), zlib.gzipSync(player));
  fs.writeFileSync(path.join(a.w, 'stats', `${U}.json`), '{"stats":{}}');
  index([{ id: 'new-srv', dir: a.dir }]);
  const v = inv.inventory('s:new-srv:world', U);
  assert.equal(v.hotbar[0].customName, 'Excalibur'); assert.equal(v.hotbar[0].name, 'Diamond Sword', 'name from the id when there is no game jar');
  assert.deepEqual(v.hotbar[0].enchantments.map((e) => [e.id, e.level]), [['minecraft:sharpness', 5], ['minecraft:looting', 3]]);
  assert.equal(v.hotbar[0].damage, 100); assert.equal(v.hotbar[2].count, 6); assert.equal(v.selected, 2);
  assert.deepEqual(v.main[0].contents.map((x) => [x.id, x.count, x.slot]), [['minecraft:diamond', 64, 0], ['minecraft:emerald', 3, 26]]);
  assert.deepEqual(v.main[26].contents.map((x) => [x.id, x.count]), [['minecraft:apple', 2]]);
  assert.equal(v.armor.head.id, 'minecraft:turtle_helmet'); assert.equal(v.armor.chest, null);
  assert.deepEqual(v.armor.feet.enchantments.map((e) => e.level), [4], 'the older "levels" wrapper works too');
  assert.equal(v.offhand.id, 'minecraft:totem_of_undying');
  assert.deepEqual([v.ender[26].id, v.ender[26].maxDamage], ['minecraft:elytra', 432]);
  assert.deepEqual([v.health, v.food, v.xpLevel, v.dimension, v.mode], [17.5, 18, 30, 'Nether', 'Survival']);
  assert.deepEqual(v.position, [-604, 70, 252]);
  assert.equal(v.from, 'playerdata'); assert.equal(v.world.serverOnline, false);
});

test('older saves (before 1.20.5): Count, tag, armour slots 100–103 and off hand -106', () => {
  const a = server('old-srv', '1.16.5');
  const player = root({
    Inventory: [T.list, [T.compound, [
      slotOld(0, 'minecraft:bow', 1, { Enchantments: [T.list, [T.compound, [{ id: [T.string, 'minecraft:power'], lvl: [T.short, 5] }]]], Damage: [T.int, 7], display: [T.compound, { Name: [T.string, '{"text":"Old Bow"}'] }] }),
      slotOld(103, 'minecraft:iron_helmet', 1), slotOld(100, 'minecraft:iron_boots', 1), slotOld(-106, 'minecraft:shield', 1),
      slotOld(10, 'minecraft:shulker_box', 1, { BlockEntityTag: [T.compound, { Items: [T.list, [T.compound, [slotOld(4, 'minecraft:cobblestone', 32)]]] }] }),
    ]]],
    Dimension: [T.int, 1], Health: [T.float, 20],
  });
  fs.writeFileSync(path.join(a.w, 'playerdata', `${U}.dat`), zlib.gzipSync(player));
  index([{ id: 'old-srv', dir: a.dir }]);
  const v = inv.inventory('s:old-srv:world', U);
  assert.equal(v.hotbar[0].customName, 'Old Bow'); assert.deepEqual(v.hotbar[0].enchantments.map((e) => [e.name, e.level]), [['Power', 5]]); assert.equal(v.hotbar[0].damage, 7);
  assert.equal(v.armor.head.id, 'minecraft:iron_helmet'); assert.equal(v.armor.feet.id, 'minecraft:iron_boots'); assert.equal(v.offhand.id, 'minecraft:shield');
  assert.deepEqual(v.main[1].contents.map((x) => [x.id, x.count, x.slot]), [['minecraft:cobblestone', 32, 4]]);
  assert.equal(v.dimension, 'The End');
});

test('names and icons come from the game jar when Solaris has it', () => {
  const AdmZip = require('adm-zip');
  const z = new AdmZip();
  z.addFile('assets/minecraft/lang/en_us.json', Buffer.from(JSON.stringify({ 'item.minecraft.stick': 'Stick (real name)', 'block.minecraft.stone': 'Stone (real name)', 'enchantment.minecraft.sharpness': 'Sharpness!' })));
  z.addFile('assets/minecraft/textures/item/stick.png', Buffer.from([137, 80, 78, 71, 1]));
  z.addFile('assets/minecraft/models/item/stone.json', Buffer.from('{"parent":"minecraft:block/stone"}'));
  z.addFile('assets/minecraft/models/block/stone.json', Buffer.from('{"parent":"block/cube_all","textures":{"all":"minecraft:block/stone"}}'));
  z.addFile('assets/minecraft/textures/block/stone.png', Buffer.from([137, 80, 78, 71, 2]));
  const vd = path.join(dataDir, 'versions', '7.7.7'); fs.mkdirSync(vd, { recursive: true }); z.writeZip(path.join(vd, '7.7.7.jar'));
  const stick = inv.item({ id: 'minecraft:stick', count: 1 }, '7.7.7');
  assert.equal(stick.name, 'Stick (real name)'); assert.equal(stick.icon, 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71, 1]).toString('base64'));
  const stone = inv.item({ id: 'minecraft:stone', count: 1, components: { 'minecraft:enchantments': { 'minecraft:sharpness': 1 } } }, '7.7.7');
  assert.equal(stone.name, 'Stone (real name)'); assert.ok(stone.icon.endsWith(Buffer.from([137, 80, 78, 71, 2]).toString('base64')), 'icon through the block model');
  assert.equal(stone.enchantments[0].name, 'Sharpness!');
  assert.equal(inv.item({ id: 'modded:thing', count: 1 }, '7.7.7').icon, null, 'no picture for items Solaris can’t find');
});

test('singleplayer worlds read the player from level.dat; unknown players and worlds are refused', async () => {
  // an instance world: the player lives in level.dat → Data.Player
  const instances = require('../src/instances');
  const inst = instances.create({ name: 'Solo', versionId: '1.21.10', loader: { type: 'fabric' } });
  const w = path.join(instances.get(inst.id).gameDir, 'saves', 'Solo World'); fs.mkdirSync(path.join(w, 'stats'), { recursive: true });
  fs.writeFileSync(path.join(w, 'level.dat'), zlib.gzipSync(root({ Data: [T.compound, { LevelName: [T.string, 'Solo World'], Player: [T.compound, { Inventory: [T.list, [T.compound, [slotNew(4, 'minecraft:bread', 3)]]], Health: [T.float, 20] }] }] })));
  fs.writeFileSync(path.join(w, 'stats', `${U}.json`), '{"stats":{}}');
  const v = inv.inventory(`i:${inst.id}:Solo World`, U);
  assert.equal(v.from, 'level.dat'); assert.equal(v.hotbar[4].id, 'minecraft:bread'); assert.equal(v.hotbar[4].count, 3);
  assert.throws(() => inv.inventory('s:new-srv:world', '../../../x'), /Unknown player/);
  assert.throws(() => inv.inventory('s:nope:world', U), /isn’t there/);
  assert.throws(() => inv.inventory(`i:${inst.id}:Solo World`.replace('Solo World', 'Other'), U), /isn’t there/);
  await assert.rejects(inv.saveNow('old-srv'), /isn’t running/);
  const connect = require('../src/connect');
  assert.equal((await connect.get('inventory-viewer')).status.state, 'ready');
});
