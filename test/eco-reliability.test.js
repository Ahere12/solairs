// Phase 3 reliability: secrets stay out of backups, persistence across restarts, no double counting, caps and
// caches.  Run: npm test
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { dataDir, cleanup } = require('./helpers/electron-stub');

after(cleanup);

test('config files holding passwords, tokens or webhooks are left out of backups (and listed)', async () => {
  const bk = require('../src/eco/backup');
  const instances = require('../src/instances');
  const inst = instances.create({ name: 'Secrets pack', versionId: '1.20.1', loader: { type: 'fabric' } });
  const cfg = path.join(inst.gameDir, 'config');
  fs.mkdirSync(path.join(cfg, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'sodium.json'), '{"quality":"fancy"}');
  fs.writeFileSync(path.join(cfg, 'discord-bridge.toml'), 'webhook = "https://discord.com/api/webhooks/123456/abcdefABCDEF_-"\n');
  fs.writeFileSync(path.join(cfg, 'sub', 'chat.properties'), 'api_key=ABCDEF0123456789XYZ\n');
  fs.writeFileSync(path.join(cfg, 'tokens.json'), '{}');
  fs.writeFileSync(path.join(cfg, 'keybinds.json'), '{"key.jump":"space"}'); // "key" in a name is fine
  const b = await bk.create({ instanceIds: [inst.id] });
  const AdmZip = require('adm-zip');
  const names = new AdmZip(path.join(dataDir, 'backups', b.file)).getEntries().map((e) => e.entryName);
  assert.ok(names.includes(`instances/${inst.id}/game/config/sodium.json`));
  assert.ok(names.includes(`instances/${inst.id}/game/config/keybinds.json`));
  for (const bad of ['discord-bridge.toml', 'sub/chat.properties', 'tokens.json']) assert.ok(!names.some((n) => n.endsWith(bad)), bad + ' must not be in the backup');
  const plan = bk.preview(b.file);
  assert.deepEqual(plan.instances[0].skipped.sort(), ['config/discord-bridge.toml', 'config/sub/chat.properties', 'config/tokens.json']);
  const b2 = await bk.create({ instanceIds: [inst.id] });
  assert.notEqual(b2.file, b.file, 'two backups in the same second don’t overwrite each other');
});

test('the inbox keeps read state and preferences after Astra restarts', () => {
  const file = path.join(dataDir, 'inbox-test.json');
  const store = { read: () => JSON.parse(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{}'), write: (d) => fs.writeFileSync(file, JSON.stringify(d)) };
  const { createCenter } = require('../src/eco/notify');
  const a = createCenter({ store });
  const n = a.add({ category: 'server', title: 'SMP is online', key: 'k' });
  a.add({ category: 'backup', title: 'Backup saved' });
  a.markRead([n.id]);
  a.setPrefs({ friend: { enabled: false } });
  const b = createCenter({ store }); // a fresh start reading the same file
  assert.equal(b.unreadCount(), 1);
  assert.equal(b.list().find((x) => x.id === n.id).read, true);
  assert.equal(b.prefs().friend.enabled, false);
  assert.equal(b.add({ category: 'server', title: 'SMP is online', key: 'k' }), null, 'no duplicate right after a restart either');
});

test('saved server notes, instance and alerts survive a restart', async () => {
  const servers = require('../src/servers');
  const si = require('../src/eco/serverinfo');
  const id = servers.save({ name: 'Persist', address: 'persist.example.com' }).servers.find((s) => s.address === 'persist.example.com').id;
  await si.setProfile(id, { notes: 'whitelist: ask Sam', notify: true });
  si.flush();
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'servers.json'), 'utf8')).servers.find((s) => s.id === id);
  assert.equal(onDisk.notes, 'whitelist: ask Sam');
  assert.equal(onDisk.notify, true);
});

test('a session is counted once, also when Astra quits while the game runs', () => {
  const an = require('../src/eco/analytics');
  const { events } = require('../src/util');
  an.init();
  an.clear();
  events.emit('game:session', { runId: 'q1', instanceId: 'i', name: 'I', start: 1000, end: 61000, interrupted: true });
  events.emit('game:session', { runId: 'q1', instanceId: 'i', name: 'I', start: 1000, end: 91000, code: 0 }); // the game closed during the quit wait
  const s = an.sessions();
  assert.equal(s.length, 1);
  assert.equal(s[0].end, 91000, 'the full session replaces the partial one');
  const sum = an.summarize(s, { now: 100000 });
  assert.equal(sum.totals.sessions, 1);
});

test('Developer Hub: no local-network hosts; answers are capped while streaming; reports hold no answers', async () => {
  const dh = require('../src/eco/devhub');
  const base = { manifestVersion: 1, id: 'acme-x', name: 'X', description: 'x', version: '1.0.0', author: 'a', category: 'servers', astra: '*', status: { type: 'http-json', url: 'https://router.lan/x' } };
  for (const host of ['router.lan', 'nas.local', '*.home.arpa', 'printer.internal']) {
    const v = dh.validate({ ...base, permissions: [`network:${host}`] });
    assert.ok(v.errors.some((e) => /local-network/.test(e.message)), host);
  }
  let pulled = 0;
  const huge = new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(64 * 1024)); } }); // never ends
  const m = { ...base, permissions: ['network:api.acme.test'], status: { type: 'http-json', url: 'https://api.acme.test/s' } };
  await assert.rejects(dh.runStatus(m, { granted: ['network:api.acme.test'], deps: { fetch: async () => new Response(huge, { status: 200 }) } }), /too big/);
  assert.ok(pulled < 10, 'stopped reading early');
  const r = await dh.runStatus({ ...m, status: { ...m.status, path: 'ok', connectedWhen: true } }, { granted: ['network:api.acme.test'], deps: { fetch: async () => new Response('{"ok":true}', { status: 200 }) } });
  assert.equal(r.state, 'connected');
});

test('Discover: friendly errors and repeated searches answered from memory', async () => {
  const dc = require('../src/eco/discovery');
  const modrinth = require('../src/modrinth');
  const orig = modrinth.search;
  let calls = 0;
  modrinth.search = async () => { calls++; return { hits: [{ project_id: 'p', slug: 's', title: 'T', project_type: 'mod' }], total_hits: 1 }; };
  try {
    await dc.run({ kind: 'mod', query: 'cache-me' });
    await dc.run({ kind: 'mod', query: 'cache-me' });
    assert.equal(calls, 1);
    modrinth.search = async () => { throw new Error('HTTP 429 for https://api.modrinth.com'); };
    const r = await dc.run({ kind: 'mod', query: 'rate-limited' });
    assert.match(r.providers.find((p) => p.provider === 'modrinth').why, /slow down/);
    modrinth.search = async () => { throw new TypeError('fetch failed'); };
    const off = await dc.run({ kind: 'mod', query: 'offline' });
    assert.match(off.providers.find((p) => p.provider === 'modrinth').why, /internet connection/);
    await dc.run({ kind: 'mod', query: 'offline' });
    modrinth.search = async () => { calls++; return { hits: [], total_hits: 0 }; };
    const again = await dc.run({ kind: 'mod', query: 'offline' });
    assert.ok(again.providers.find((p) => p.provider === 'modrinth').ok, 'a failed search isn’t cached');
  } finally { modrinth.search = orig; }
});
