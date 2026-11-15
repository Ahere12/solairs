// Solaris Connect: the integration registry and Solaris's own integrations.  Run: npm test
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { dataDir, cleanup } = require('./helpers/electron-stub');
const { createRegistry, validateDef, cleanValue, STATES } = require('../src/connect/registry');

after(cleanup);

const memStore = () => { let d = {}; return { read: () => JSON.parse(JSON.stringify(d)), write: (x) => { d = JSON.parse(JSON.stringify(x)); }, raw: () => d }; };
const base = { name: 'Test', description: 'A test integration', icon: 'link', category: 'servers', type: 'api' };

test('definitions are checked', () => {
  assert.throws(() => validateDef({ ...base, id: 'Bad Id', status() {} }), /id must be/);
  assert.throws(() => validateDef({ ...base, id: 'ok', category: 'nope', status() {} }), /unknown category/);
  assert.throws(() => validateDef({ ...base, id: 'ok', type: 'wizard', status() {} }), /type must be/);
  assert.throws(() => validateDef({ ...base, id: 'ok' }), /status\(\) is required/);
  assert.throws(() => validateDef({ ...base, id: 'ok', planned: true, status() {} }), /no status check/);
  assert.throws(() => validateDef({ ...base, id: 'ok', docs: 'http://x', status() {} }), /https/);
  assert.throws(() => validateDef({ ...base, id: 'ok', status() {}, config: [{ key: 'k', type: 'select' }] }), /needs options/);
  assert.throws(() => createRegistry({ store: memStore(), defs: [{ ...base, id: 'aa', status() {} }, { ...base, id: 'aa', status() {} }] }), /used twice/);
});

test('status is real: planned, unavailable, off, errors, hangs and nonsense', async () => {
  const store = memStore();
  const r = createRegistry({ store, timeout: 200, defs: [
    { ...base, id: 'good', defaultEnabled: true, status: () => ({ state: 'connected', text: 'Yes' }) },
    { ...base, id: 'later', planned: true },
    { ...base, id: 'never', unavailable: 'Needs a service' },
    { ...base, id: 'offbydefault', status: () => ({ state: 'connected' }) },
    { ...base, id: 'throws', defaultEnabled: true, status: () => { throw new Error('boom'); } },
    { ...base, id: 'hangs', defaultEnabled: true, status: () => new Promise(() => {}) },
    { ...base, id: 'nonsense', defaultEnabled: true, status: () => ({ state: 'awesome' }) },
  ] });
  assert.equal((await r.status('good')).state, 'connected');
  assert.deepEqual(await r.status('later'), { state: 'planned', text: 'Not built yet' });
  assert.equal((await r.status('never')).text, 'Needs a service');
  assert.equal((await r.status('offbydefault')).state, 'off');
  const t = await r.status('throws'); assert.equal(t.state, 'error'); assert.match(t.text, /boom/);
  const h = await r.status('hangs'); assert.equal(h.state, 'error'); assert.match(h.text, /no answer/);
  assert.equal((await r.status('nonsense')).state, 'error');
  const errs = (await r.get('throws')).errors; assert.equal(errs.length, 1, 'error recorded');
  await r.status('throws'); assert.equal((await r.get('throws')).errors.length, 1, 'the same error right away is not repeated');
  r.clearErrors('throws'); assert.equal((store.raw().errors || {}).throws, undefined, 'cleared');
  const all = await r.list(); assert.equal(all.length, 7); assert.ok(all.every((i) => STATES.includes(i.status.state)));
});

test('turning integrations on and off', async () => {
  const store = memStore(); let ext = false, hooked = null;
  const r = createRegistry({ store, defs: [
    { ...base, id: 'plain', status: () => ({ state: 'ready' }) },
    { ...base, id: 'linked', toggle: { get: () => ext, set: (v) => { ext = v; } }, onToggle: (v) => { hooked = v; }, status: () => ({ state: 'ready' }) },
    { ...base, id: 'core', core: true, status: () => ({ state: 'ready' }) },
    { ...base, id: 'later', planned: true },
  ] });
  assert.equal((await r.setEnabled('plain', true)).enabled, true);
  assert.equal(store.raw().enabled.plain, true, 'saved');
  assert.equal((await r.setEnabled('linked', true)).enabled, true); assert.equal(ext, true); assert.equal(hooked, true);
  await assert.rejects(r.setEnabled('core', false), /always on/);
  await assert.rejects(r.setEnabled('later', true), /isn’t built yet/);
  await assert.rejects(r.setEnabled('missing', true), /No integration/);
  assert.equal((await r.get('core')).canToggle, false);
});

test('settings are checked, and secrets are sealed and never sent back', async () => {
  const store = memStore(); let got = null;
  const r = createRegistry({ store, secrets: { seal: (s) => 'SEALED:' + Buffer.from(s).toString('base64'), unseal: (s) => Buffer.from(s.slice(7), 'base64').toString() }, defs: [{
    ...base, id: 'cfg', core: true, status: ({ config }) => { got = config; return { state: 'ready' }; },
    config: [{ key: 'url', type: 'url', label: 'Map link' }, { key: 'port', type: 'number', min: 1, max: 65535 }, { key: 'mode', type: 'select', options: ['a', 'b'] }, { key: 'token', type: 'secret' }, { key: 'flag', type: 'bool' }],
  }] });
  await assert.rejects(r.setConfig('cfg', { url: 'not a link' }), /must be a link/);
  await assert.rejects(r.setConfig('cfg', { port: 70000 }), /at most 65535/);
  await assert.rejects(r.setConfig('cfg', { mode: 'c' }), /pick one/);
  const v = await r.setConfig('cfg', { url: 'https://map.example.net', port: '8100', mode: 'b', token: 'hunter2', flag: 1 });
  assert.deepEqual(v.values, { url: 'https://map.example.net', port: 8100, mode: 'b', token: { set: true }, flag: true });
  assert.ok(!JSON.stringify(store.raw()).includes('hunter2'), 'secret not stored as plain text');
  assert.ok(!JSON.stringify(v).includes('hunter2'), 'secret not sent to the page');
  await r.status('cfg'); assert.equal(got.token, 'hunter2', 'the integration itself gets the real value');
  await r.setConfig('cfg', { token: '' }); await r.status('cfg'); assert.equal(got.token, 'hunter2', 'empty keeps the saved secret');
  await r.setConfig('cfg', { token: { clear: true } }); assert.deepEqual((await r.get('cfg')).values.token, { set: false });
  assert.equal(cleanValue({ key: 'x', type: 'bool' }, 'yes'), true);
});

test('compatibility with hosted servers', () => {
  const r = createRegistry({ store: memStore(), defs: [{ ...base, id: 'mod', status: () => ({ state: 'ready' }), compat: { software: ['fabric'] } }, { ...base, id: 'any', status: () => ({ state: 'ready' }) }] });
  const c = r.compatibility('mod', [{ id: 'a', name: 'A', software: 'fabric' }, { id: 'b', name: 'B', software: 'paper', softwareName: 'Paper' }]);
  assert.deepEqual(c.map((x) => x.ok), [true, false]); assert.match(c[1].why, /Paper/);
  assert.equal(r.compatibility('any', []), null);
});

test('Solaris’s own integrations: valid, and every status check works on a fresh install', async () => {
  const connect = require('../src/connect');
  const list = await connect.list();
  const ids = list.map((i) => i.id);
  for (const id of ['discord-rpc', 'friends', 'server-status', 'hosting', 'playit', 'simple-voice-chat', 'geyser', 'skins', 'screenshots', 'bluemap']) assert.ok(ids.includes(id), id);
  for (const i of list) {
    assert.ok(STATES.includes(i.status.state), `${i.id}: ${i.status.state}`);
    assert.notEqual(i.status.state, 'error', `${i.id} shouldn't fail on a fresh install: ${i.status.text}`);
    assert.ok(i.docs === null || /^https:\/\//.test(i.docs));
  }
  // nothing fresh is "connected" — there is nothing to be connected to yet
  assert.ok(!list.some((i) => i.status.state === 'connected' && !['discord-rpc'].includes(i.id)));
  assert.equal(list.find((i) => i.id === 'bluemap').status.state, 'ready');
  assert.equal(list.find((i) => i.id === 'pl3xmap').status.state, 'ready');
  assert.equal(list.find((i) => i.id === 'waypoints').status.state, 'planned');

  assert.equal(list.find((i) => i.id === 'presence-cloud').status.state, 'unavailable');
  // Discord Rich Presence is the same switch as Settings → Discord Rich Presence
  const settings = require('../src/settings');
  await connect.setEnabled('discord-rpc', false);
  assert.equal(settings.get().discordRpc, false);
  assert.equal((await connect.get('discord-rpc')).status.state, 'off');
  await connect.setConfig('discord-rpc', { showServer: false });
  assert.equal(settings.get().discordShowServer, false);
  assert.ok(fs.existsSync(path.join(dataDir, 'connect.json')));
});

test('a hosted server with a broken voice chat tunnel shows as a problem', async () => {
  const dir = path.join(dataDir, 'hosted', 'srv');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'hosted', 'servers.json'), JSON.stringify([{ id: 'srv', dir }]));
  fs.writeFileSync(path.join(dir, 'solaris-server.json'), JSON.stringify({ name: 'My Server', mc: '1.21.10', software: 'paper', port: 25565, tunnel: 'playit', voice: { on: true, port: 24454, error: 'playit.gg said no' } }));
  const connect = require('../src/connect');
  const v = await connect.get('simple-voice-chat');
  assert.equal(v.status.state, 'error'); assert.match(v.status.text, /My Server/);
  const c = await connect.compatibility('geyser');
  assert.deepEqual(c.map((x) => [x.name, x.ok]), [['My Server', true]]);
  assert.equal((await connect.get('hosting')).status.text, '1 server · 0 running');
});
