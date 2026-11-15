// Solaris Connect step 2: server monitoring and desktop alerts.  Run: npm test
const { test, after } = require('node:test');
const assert = require('node:assert');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { dataDir, electron, cleanup } = require('./helpers/electron-stub');
const { createWatcher } = require('../src/connect/watch');

after(cleanup);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A tiny fake Minecraft server that answers Server List Ping with `status()`. */
function fakeServer(status) {
  const varint = (n) => { const b = []; do { let t = n & 0x7f; n >>>= 7; if (n) t |= 0x80; b.push(t); } while (n); return Buffer.from(b); };
  const packet = (id, body) => { const p = Buffer.concat([varint(id), body]); return Buffer.concat([varint(p.length), p]); };
  const srv = net.createServer((sock) => {
    let got = Buffer.alloc(0), answered = false;
    sock.on('data', (d) => {
      got = Buffer.concat([got, d]);
      if (!answered && got.length > 5) {
        answered = true;
        const json = Buffer.from(JSON.stringify(status()));
        sock.write(packet(0, Buffer.concat([varint(json.length), json])));
      } else if (answered && got.length) {
        // ping packet: answer with the same 8 bytes (pong)
        const tail = got.slice(-8); if (tail.length === 8) sock.write(packet(1, tail));
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

test('changes are reported: online, offline, a friend joins — nothing on the first check', async () => {
  const answers = { a: { online: true, players: { online: 1, max: 10, sample: ['Steve'] }, version: '1.21.10', latency: 20 }, b: { online: false, error: 'ECONNREFUSED' } };
  const notes = [];
  const w = createWatcher({
    ping: async (addr) => answers[addr],
    savedServers: () => [{ name: 'Alpha', address: 'a', favorite: true }, { name: 'Beta', address: 'b', favorite: true }, { name: 'Gamma', address: 'c', favorite: false }],
    friendNames: () => ['Alex'],
    notify: (n) => notes.push(n),
  });
  const cfg = { watch: 'favorites', notifyOnline: true, notifyOffline: true, notifyFriends: true };
  await w.checkAll(cfg);
  assert.equal(notes.length, 0, 'first look is not a change');
  assert.deepEqual(w.view().servers.map((s) => [s.name, s.online]), [['Alpha', true], ['Beta', false]], 'only favourites');
  answers.a = { online: true, players: { online: 2, max: 10, sample: ['Steve', 'alex'] } };
  answers.b = { online: true, players: { online: 0, max: 20, sample: [] } };
  await w.checkAll(cfg);
  assert.deepEqual(notes.map((x) => x.kind).sort(), ['friend', 'online']);
  assert.match(notes.find((x) => x.kind === 'friend').title, /alex is on Alpha/);
  notes.length = 0;
  answers.a = { online: false, error: 'Timed out' };
  await w.checkAll(cfg);
  assert.deepEqual(notes.map((x) => x.title), ['Alpha went offline']);
  const alpha = w.view().servers.find((s) => s.name === 'Alpha');
  assert.equal(alpha.error, 'Timed out');
  notes.length = 0;
  await w.checkAll({ ...cfg, notifyOnline: false, notifyOffline: false, notifyFriends: false });
  assert.equal(notes.length, 0, 'switched-off alerts stay quiet');
  // watching all servers adds Gamma; a ping that throws is just "offline"
  answers.c = undefined;
  await w.checkAll({ ...cfg, watch: 'all' });
  assert.equal(w.view().servers.length, 3);
  assert.equal(w.view().servers.find((s) => s.name === 'Gamma').online, false);
  // un-favourited servers are forgotten again
  await w.checkAll(cfg);
  assert.equal(w.view().servers.length, 2);
});

test('runs on its own while on, and stops when turned off', async () => {
  let pings = 0, on = { watch: 'all', intervalMin: 1 };
  const w = createWatcher({ ping: async () => { pings++; return { online: true, players: { online: 0, max: 1, sample: [] } }; }, savedServers: () => [{ address: 'x' }] });
  w.start(() => on, { firstAfter: 20 });
  await sleep(120);
  assert.equal(pings, 1);
  assert.ok(w.view().lastRun);
  w.stop(); assert.equal(w.active, false);
  on = null; w.start(() => on, { firstAfter: 20 }); await sleep(80);
  assert.equal(pings, 1, 'turned off: no checks');
});

test('the real Server List Ping, against a fake Minecraft server', async () => {
  let players = { max: 20, online: 3, sample: [{ name: 'Alex', id: '0' }] };
  const { srv, port } = await fakeServer(() => ({ version: { name: 'Paper 1.21.10', protocol: 773 }, players, description: { text: 'hi' } }));
  const servers = require('../src/servers');
  const notes = [];
  const w = createWatcher({ ping: (a) => servers.ping(a, 2000), savedServers: () => [{ name: 'Local', address: `127.0.0.1:${port}`, favorite: true }], friendNames: () => ['Alex'], notify: (n) => notes.push(n) });
  await w.checkAll({ watch: 'favorites', notifyOffline: true, notifyOnline: true });
  const s = w.view().servers[0];
  assert.equal(s.online, true); assert.equal(s.players, 3); assert.equal(s.max, 20); assert.equal(s.version, 'Paper 1.21.10');
  await new Promise((r) => srv.close(r));
  await w.checkAll({ watch: 'favorites', notifyOffline: true });
  assert.equal(w.view().servers[0].online, false);
  assert.deepEqual(notes.map((x) => x.kind), ['offline']);
});

test('Connect: monitoring status and table, and desktop alerts for hosted servers', async () => {
  const connect = require('../src/connect');
  // no favourites yet
  await connect.setEnabled('server-watch', true);
  assert.equal((await connect.get('server-watch')).status.state, 'needs-setup');
  require('../src/servers').save({ name: 'Fav', address: '127.0.0.1:1', favorite: true });
  assert.equal((await connect.get('server-watch')).status.state, 'ready');
  const runtime = require('../src/connect/runtime');
  await runtime.watcher.checkAll({ watch: 'favorites' });
  const t = await connect.details('server-watch');
  assert.deepEqual(t.columns, ['Server', 'Status', 'Players', 'Ping', 'For']);
  assert.equal(t.rows[0][0], 'Fav'); assert.match(t.rows[0][1], /^Offline/);
  await assert.rejects(connect.setConfig('server-watch', { intervalMin: 0 }), /at least 1/);
  await connect.setEnabled('server-watch', false);
  assert.equal(await connect.details('server-watch'), null, 'no table while off');

  // desktop alerts: a crash from Hosting becomes a notification (Solaris in the background)
  const shown = [];
  electron.Notification = Object.assign(function (o) { return { on() {}, show() { shown.push(o); } }; }, { isSupported: () => true });
  connect.init();
  const { events } = require('../src/util');
  events.emit('hosted:event', { id: 's', name: 'My Server', event: 'crash', text: 'My Server stopped unexpectedly.' });
  events.emit('hosted:event', { id: 's', name: 'My Server', event: 'join', text: 'Alex joined' }); // off by default
  assert.deepEqual(shown.map((o) => o.title), ['My Server']);
  await connect.setConfig('server-alerts', { join: true });
  events.emit('hosted:event', { id: 's', name: 'My Server', event: 'join', text: 'Alex joined' });
  assert.equal(shown.length, 2);
  await connect.setEnabled('server-alerts', false);
  events.emit('hosted:event', { id: 's', name: 'My Server', event: 'crash', text: 'x' });
  assert.equal(shown.length, 2, 'off: no alerts');
  require('../src/settings').set({ notifications: false });
  await connect.setEnabled('server-alerts', true);
  assert.equal((await connect.get('server-alerts')).status.state, 'needs-setup', 'notifications off in Settings is explained');
  assert.ok(fs.existsSync(path.join(dataDir, 'connect.json')));
});

test('Hosting announces its server events (the alerts listen to these)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'hostserver.js'), 'utf8');
  const fn = src.slice(src.indexOf('function notifyDiscord('), src.indexOf('function setDiscord('));
  assert.match(fn, /events\.emit\('hosted:event'/);
  for (const e of ['online', 'stop', 'crash', 'join', 'leave']) assert.ok(src.includes(`notifyDiscord(id, '${e}'`), e);
});
