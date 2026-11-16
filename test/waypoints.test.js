// Astra Connect step 7: waypoints & coordinate sharing.  Run: npm test
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { dataDir, cleanup } = require('./helpers/electron-stub');
const { T, root } = require('./helpers/nbt-writer');
const wp = require('../src/connect/waypoints');

after(cleanup);

test('waypoints are checked and kept', () => {
  assert.throws(() => wp.save({ name: '', x: 1, z: 2 }), /Give the waypoint a name/);
  assert.throws(() => wp.save({ name: 'Far', x: 40000000, z: 0 }), /between -30,000,000/);
  assert.throws(() => wp.save({ name: 'NaN', x: 'abc', z: 0 }), /X must be a number/);
  let l = wp.save({ name: '  Base\n', x: 120.4, y: 64, z: -340.6, color: '#bad', place: 's:srv:world' });
  assert.deepEqual([l[0].name, l[0].x, l[0].y, l[0].z, l[0].dimension, l[0].color], ['Base', 120, 64, -341, 'minecraft:overworld', '#7c9cff']);
  l = wp.save({ name: 'Fortress', x: 5, y: '', z: 9, dimension: 'nether', note: 'blaze\nspawner' });
  const f = l.find((w) => w.name === 'Fortress');
  assert.equal(f.y, null, 'Y is optional'); assert.equal(f.dimension, 'minecraft:the_nether'); assert.equal(f.note, 'blaze spawner');
  assert.equal(wp.dimOf('modded:aether'), 'modded:aether', 'modded dimensions keep their id');
  assert.equal(wp.dimOf(1), 'minecraft:the_end');
  const id = f.id; wp.save({ ...f, name: 'Nether fortress' });
  assert.equal(wp.list().find((w) => w.id === id).name, 'Nether fortress', 'saving again edits it');
  wp.remove(id); assert.equal(wp.list().length, 1);
});

test('sharing: codes round-trip, plain text is understood, bad codes are explained', () => {
  wp.save({ name: 'End portal', x: -1200, y: 30, z: 880, dimension: 'minecraft:the_end', color: '#c084fc', note: 'stronghold' });
  const ids = wp.list().map((w) => w.id);
  const code = wp.encode(ids);
  assert.match(code, /^ASTRA-WP-[A-Za-z0-9_-]+$/);
  const back = wp.decode(`hey, here: ${code} have fun`);
  assert.deepEqual(back.map((w) => [w.name, w.x, w.y, w.z, w.dimension, w.color, w.note]).sort(), wp.list().map((w) => [w.name, w.x, w.y, w.z, w.dimension, w.color, w.note]).sort());
  assert.ok(!JSON.stringify(back).includes('s:srv'), 'your places aren’t in a shared code');
  const cases = { 'Base: 120 64 -340': ['Base', 120, 64, -340], 'x: 100, z: -5': ['Shared place', 100, null, -5], '/tp @s 10 70 20': ['Shared place', 10, 70, 20], 'Nether hub 5 64 9': ['Nether hub', 5, 64, 9] };
  for (const [t, want] of Object.entries(cases)) { const w = wp.decode(t)[0]; assert.deepEqual([w.name, w.x, w.y, w.z], want, t); }
  assert.equal(wp.decode('Nether hub 5 64 9')[0].dimension, 'minecraft:the_nether');
  assert.throws(() => wp.decode('hello'), /Paste a waypoint code/);
  assert.throws(() => wp.decode('ASTRA-WP-AAAAbroken'), /damaged/);
  const future = 'ASTRA-WP-' + zlib.deflateRawSync(Buffer.from('{"v":9,"w":[]}')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.throws(() => wp.decode(future), /newer Astra/);
  assert.throws(() => wp.encode([]), /Pick the waypoints/);
  assert.equal(wp.chatText({ name: 'Base', x: 1, y: null, z: 2, dimension: 'minecraft:the_nether' }), 'Base — 1 ~ 2 (Nether)');
});

test('places from save files: spawn, position, last death, bed — new and old formats', () => {
  const mk = (id, level, players) => {
    const dir = path.join(dataDir, 'hosted', id), w = path.join(dir, 'world');
    fs.mkdirSync(path.join(w, 'playerdata'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'solaris-server.json'), JSON.stringify({ name: id, mc: '1.21.10', software: 'paper', port: 25565, tunnel: 'none' }));
    fs.writeFileSync(path.join(dir, 'server.properties'), 'level-name=world\n');
    fs.writeFileSync(path.join(w, 'level.dat'), zlib.gzipSync(root({ Data: [T.compound, { LevelName: [T.string, 'world'], ...level }] })));
    for (const [u, p] of Object.entries(players)) fs.writeFileSync(path.join(w, 'playerdata', `${u}.dat`), zlib.gzipSync(root(p)));
    return { id, dir };
  };
  const U = 'bb83b8bb-d63e-3ba9-a952-591247a3eabd';
  const a = mk('new-srv', { spawn: [T.compound, { pos: [T.ints, [-560, 80, 160]], dimension: [T.string, 'minecraft:overworld'] }] }, {
    [U]: { Pos: [T.list, [T.double, [-563.7, 81, 159.1]]], Dimension: [T.string, 'minecraft:overworld'], LastDeathLocation: [T.compound, { pos: [T.ints, [-564, 81, 159]], dimension: [T.string, 'minecraft:overworld'] }], respawn: [T.compound, { pos: [T.ints, [10, 64, 20]], dimension: [T.string, 'minecraft:the_nether'] }] },
  });
  const b = mk('old-srv', { SpawnX: [T.int, 8], SpawnY: [T.int, 70], SpawnZ: [T.int, -8] }, { [U]: { Pos: [T.list, [T.double, [1, 2, 3]]], Dimension: [T.int, -1], SpawnX: [T.int, 100], SpawnY: [T.int, 65], SpawnZ: [T.int, 200] } });
  fs.writeFileSync(path.join(dataDir, 'hosted', 'servers.json'), JSON.stringify([a, b]));
  const n = wp.placesFrom('s:new-srv:world', U);
  assert.deepEqual(n.places.map((p) => [p.kind, p.x, p.y, p.z, p.dimension]), [
    ['spawn', -560, 80, 160, 'minecraft:overworld'], ['position', -564, 81, 159, 'minecraft:overworld'],
    ['death', -564, 81, 159, 'minecraft:overworld'], ['bed', 10, 64, 20, 'minecraft:the_nether']]);
  const o = wp.placesFrom('s:old-srv:world', U);
  assert.deepEqual(o.places.map((p) => [p.kind, p.x, p.y, p.z, p.dimension]), [
    ['spawn', 8, 70, -8, 'minecraft:overworld'], ['position', 1, 2, 3, 'minecraft:the_nether'], ['bed', 100, 65, 200, 'minecraft:overworld']]);
  assert.equal(wp.placesFrom('s:new-srv:world').places.length, 1, 'world only: just the spawn');
  assert.throws(() => wp.placesFrom('s:nope:world'), /isn’t there/);
  assert.throws(() => wp.placesFrom('s:new-srv:world', '../x'), /Unknown player/);
});

test('teleport and chat only on a running server you host, for a real player name', async () => {
  const anywhere = wp.list().find((w) => !w.place);
  assert.throws(() => wp.teleport(anywhere.id, 'Alex'), /isn’t on a server you host/);
  const onSrv = wp.save({ name: 'Spawn', x: 0, z: 0, place: 's:new-srv:world' }).find((w) => w.place === 's:new-srv:world' && w.name === 'Spawn');
  assert.throws(() => wp.teleport(onSrv.id, 'bad name!'), /Pick an online player/);
  assert.throws(() => wp.teleport(onSrv.id, 'Alex'), /Start the server first/);
  assert.throws(() => wp.announce(onSrv.id), /Start the server first/);
  assert.throws(() => wp.teleport('nope', 'Alex'), /not found/);
  const connect = require('../src/connect');
  const i = await connect.get('waypoints');
  assert.equal(i.status.state, 'ready'); assert.match(i.status.text, /waypoints? in \d+ places?/);
});
