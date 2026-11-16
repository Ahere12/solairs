// Astra Server Management 2.0 and Notifications.  Run: npm test
const { test, after } = require('node:test');
const assert = require('node:assert');
const { cleanup } = require('./helpers/electron-stub');
const si = require('../src/eco/serverinfo');
const { createCenter } = require('../src/eco/notify');
const eco = require('../src/eco');

after(cleanup);

test('server software detection says how sure it is', () => {
  assert.equal(si.detectSoftware({ online: true, version: 'Paper 1.20.4' }).name, 'Paper');
  assert.equal(si.detectSoftware({ online: true, version: 'Velocity 3.3.0-SNAPSHOT' }).kind, 'proxy');
  assert.equal(si.detectSoftware({ online: true, version: '1.20.1', forge: { forgeData: true, mods: 42 } }).name, 'Forge');
  assert.equal(si.detectSoftware({ online: true, version: '1.20.1', forge: { forgeData: true, mods: 42 } }).confidence, 'certain');
  assert.equal(si.detectSoftware({ online: true, version: 'Mohist 1.20.1', forge: { forgeData: true } }).kind, 'hybrid');
  assert.equal(si.detectSoftware({ online: true, version: '1.21', forge: { neoforge: true } }).name, 'NeoForge');
  assert.equal(si.detectSoftware({ online: true, version: 'Requires MC 1.8 / 1.21' }).kind, 'proxy');
  assert.equal(si.detectSoftware({ online: true, version: '1.21.1' }).kind, 'vanilla');
  assert.equal(si.detectSoftware({ online: true, version: '§cMaintenance' }).confidence, 'unknown');
  assert.equal(si.detectSoftware({ online: false }).confidence, 'unknown');
});

test('instance version vs server version', () => {
  assert.equal(si.versionMatch('1.20.1', 'Paper 1.20.1').ok, true);
  assert.equal(si.versionMatch('1.19.4', 'Paper 1.20.1').ok, false);
  assert.equal(si.versionMatch('1.20.4', 'BungeeCord 1.8.x - 1.21.x').ok, true);
  assert.equal(si.versionMatch('1.20.1', '§aWelcome').ok, null);
});

const deps = (over = {}) => ({
  resolveSrv: async () => [], lookup: async () => ['203.0.113.5'], connect: async () => 12,
  ping: async () => ({ online: true, version: 'Paper 1.20.1', players: { online: 3, max: 20 }, latency: 30 }), ...over,
});
test('connection test: each step, stopping at the first failure with a reason', async () => {
  const ok = await si.connectionTest('play.example.com', { instanceMc: '1.20.1', deps: deps() });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.steps.map((s) => s.id), ['address', 'srv', 'dns', 'tcp', 'status', 'version']);
  assert.equal(ok.software.name, 'Paper');

  const srv = await si.connectionTest('example.com', { deps: deps({ resolveSrv: async () => [{ name: 'mc.example.com', port: 25570 }], connect: async (h, p) => { assert.equal(h, 'mc.example.com'); assert.equal(p, 25570); return 5; } }) });
  assert.match(srv.steps.find((s) => s.id === 'srv').text, /25570/);

  const nodns = await si.connectionTest('nope.invalid', { deps: deps({ lookup: async () => { const e = new Error('x'); e.code = 'ENOTFOUND'; throw e; } }) });
  assert.equal(nodns.ok, false); assert.match(nodns.summary, /doesn’t exist/);
  const refused = await si.connectionTest('1.2.3.4:25565', { deps: deps({ connect: async () => { const e = new Error('x'); e.code = 'ECONNREFUSED'; throw e; } }) });
  assert.match(refused.summary, /nothing listens/);
  assert.ok(!refused.steps.some((s) => s.id === 'dns'), 'an IP address needs no DNS');
  const old = await si.connectionTest('1.2.3.4', { instanceMc: '1.19.2', deps: deps() });
  assert.equal(old.ok, false); assert.match(old.summary, /Server is 1\.20\.1/);
  const full = await si.connectionTest('1.2.3.4', { deps: deps({ ping: async () => ({ online: true, version: '1.21', players: { online: 20, max: 20 } }) }) });
  assert.equal(full.ok, true, 'a full server is a note (2b2t and big networks report full and still queue you)');
  assert.match(full.steps.find((s) => s.id === 'slots').text, /full/);
  // CubeCraft (live, 2026-11-15) sends an empty legacy modinfo block: that's not Forge
  assert.notEqual(si.detectSoftware({ online: true, version: 'CubeCraft', forge: { fml: true, mods: 0 } }).name, 'Forge');
  assert.equal((await si.connectionTest('bad host:x', { deps: deps() })).ok, false);
});

test('uptime statistics', () => {
  const now = Date.UTC(2026, 10, 15, 12);
  const H = 3600e3;
  const samples = [];
  for (let h = 48; h >= 1; h--) samples.push({ t: now - h * H, up: !(h >= 10 && h <= 13), ms: 40 });
  const s = si.uptimeStats(samples, now);
  assert.equal(s.checks, 48);
  assert.equal(s.day, Math.round((20 / 24) * 1000) / 10);
  assert.equal(s.longestOutageMs, 4 * H);
  assert.equal(s.avgLatency, 40);
  assert.equal(s.online, true);
  assert.equal(si.uptimeHours(samples, now, 24).length, 24);
  assert.equal(si.uptimeStats([], now).day, null);
});

test('saved server profile: notes, instance, alerts, uptime from real pings, join history', async () => {
  const servers = require('../src/servers');
  const instances = require('../src/instances');
  const inst = instances.create({ name: 'SMP pack', versionId: '1.20.1', loader: { type: 'fabric' } });
  const { servers: list } = servers.save({ name: 'Test SMP', address: '127.0.0.1:1' });
  const id = list[0].id;
  assert.ok(list[0].updatedAt, 'edits are timestamped for sync');
  await servers.ping('127.0.0.1:1', 1500); // nothing listens on port 1: a real offline sample
  si.flush();
  si.joined('127.0.0.1:1', inst.id);
  const p = await si.setProfile(id, { notes: 'Ask Sam for whitelist', instanceId: inst.id, notify: true });
  assert.equal(p.server.notes, 'Ask Sam for whitelist');
  assert.equal(p.instance.name, 'SMP pack');
  assert.equal(p.server.notify, true);
  assert.equal(p.uptime.checks, 1); assert.equal(p.uptime.online, false);
  assert.equal(p.joins[0].instanceId, inst.id);
  await assert.rejects(si.setProfile(id, { instanceId: 'nope' }), /Instance not found/);
});

const mem = () => { let d = {}; return { read: () => JSON.parse(JSON.stringify(d)), write: (x) => { d = JSON.parse(JSON.stringify(x)); } }; };
test('notification inbox: categories, dedupe, read state, preferences', () => {
  let t = 1000; const delivered = [];
  const c = createCenter({ store: mem(), now: () => t, deliver: (i, o) => delivered.push([i.title, o.desktop]) });
  const a = c.add({ category: 'friend', title: 'Sam is on SMP', key: 'k1' });
  assert.ok(a.id);
  assert.equal(c.add({ category: 'friend', title: 'Sam is on SMP', key: 'k1' }), null, 'same key within 10 minutes');
  t += 11 * 60000;
  assert.ok(c.add({ category: 'friend', title: 'Sam is on SMP', key: 'k1' }));
  c.add({ category: 'backup', title: 'Backup saved' });
  assert.deepEqual(delivered.map((d) => d[1]), [true, true, false], 'backups don’t pop up on the desktop by default');
  assert.equal(c.unreadCount(), 3);
  c.markRead([a.id]); assert.equal(c.unreadCount(), 2);
  c.setPrefs({ minecraft: { enabled: false }, friend: { desktop: false } });
  assert.equal(c.add({ category: 'minecraft', title: 'x' }), null);
  c.add({ category: 'friend', title: 'Alex' });
  assert.equal(delivered.pop()[1], false);
  assert.equal(c.list({ category: 'backup' }).length, 1);
  c.markRead('all'); assert.equal(c.unreadCount(), 0);
  assert.throws(() => c.add({ category: 'spam', title: 'x' }), /Unknown/);
  for (let i = 0; i < 250; i++) c.add({ category: 'server', title: 'n' + i });
  assert.equal(c.list().length, 200, 'keeps the newest 200');
});

test('Minecraft and modpack update checks notify once', async () => {
  const sent = [];
  const notify = (n) => (sent.push(n), n);
  let r = await eco.checkMinecraft({ getManifest: async () => ({ latest: { release: '1.21.4', snapshot: '25w02a' } }), notify, showSnapshots: true, state: {} });
  assert.equal(sent.length, 0, 'the first check only remembers');
  r = await eco.checkMinecraft({ getManifest: async () => ({ latest: { release: '1.21.5', snapshot: '25w10a' } }), notify, showSnapshots: true, state: r });
  assert.deepEqual(sent.map((n) => n.title), ['Minecraft 1.21.5 is out', 'Snapshot 25w10a']);
  const insts = [{ id: 'p', name: 'Pack', modpack: { projectId: 'X' } }, { id: 'v', name: 'Vanilla' }];
  const versionsOf = async () => ({ updatable: true, current: 'v1', versions: [{ id: 'v1', date: '2026-01-01' }, { id: 'v2', name: 'Pack 2.0', date: '2026-02-01', type: 'release' }] });
  const m1 = await eco.checkModpacks({ instances: insts, versionsOf, notify, state: {} });
  assert.equal(m1.found, 1); assert.equal(sent.pop().title, 'Pack: update available');
  const m2 = await eco.checkModpacks({ instances: insts, versionsOf, notify, state: { packSeen: m1.packSeen } });
  assert.equal(m2.found, 0);
});
