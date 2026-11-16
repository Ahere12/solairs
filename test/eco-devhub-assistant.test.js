// Astra Developer Hub and Assistant.  Run: npm test
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cleanup } = require('./helpers/electron-stub');
const dh = require('../src/eco/devhub');
const as = require('../src/eco/assistant');
const { createRegistry } = require('../src/connect/registry');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-devhub-test-'));
after(() => { cleanup(); fs.rmSync(work, { recursive: true, force: true }); });

const good = () => ({
  manifestVersion: 1, id: 'acme-status', name: 'Acme Status', description: 'Is the Acme network up?', version: '1.0.0', author: 'Acme',
  category: 'servers', astra: '*', permissions: ['network:api.acme.test', 'notifications'],
  config: [{ key: 'region', label: 'Region', type: 'select', options: ['eu', 'us'], default: 'eu' }],
  status: { type: 'http-json', url: 'https://api.acme.test/status?region={{config.region}}', path: 'data.online', connectedWhen: true, text: '{{data.players}} players online', textOtherwise: 'Acme is down' },
  notify: { title: 'Acme changed', body: 'Now: {{value}}' },
});

test('manifest validation: errors, warnings and compatibility', () => {
  assert.deepEqual(dh.validate(good(), { appVersion: '1.12.0' }).errors, []);
  const bad = dh.validate({ ...good(), id: 'Bad', version: 'x', category: 'games', permissions: ['filesystem'], status: { type: 'http-json', url: 'https://evil.test/x' }, extra: 1 }, { appVersion: '1.12.0' });
  const paths = bad.errors.map((e) => e.path);
  for (const p of ['id', 'version', 'category', 'permissions[0]', 'status.url']) assert.ok(paths.includes(p), `expected an error at ${p}`);
  assert.ok(bad.warnings.some((w) => w.path === 'extra'));
  assert.match(dh.validate({ ...good(), astra: '>=2.0.0' }, { appVersion: '1.12.0' }).errors[0].message, /Needs Astra/);
  assert.match(dh.validate({ ...good(), status: { type: 'server-ping', address: 'x' } }).errors[0].message, /ping/);
  assert.match(dh.validate({ ...good(), status: { ...good().status, url: 'https://{{config.region}}.acme.test/' } }).errors.map((e) => e.message).join(), /host can’t come from a setting/);
  assert.match(dh.validate({ ...good(), notify: { title: 'x' }, permissions: ['network:api.acme.test'] }).errors[0].message, /notifications/);
  assert.equal(dh.validate([]).ok, false);
});

test('host permissions', () => {
  assert.equal(dh.hostAllowed('api.acme.test', ['network:api.acme.test']), true);
  assert.equal(dh.hostAllowed('evil.test', ['network:api.acme.test']), false);
  assert.equal(dh.hostAllowed('eu.acme.test', ['network:*.acme.test']), true);
  assert.equal(dh.hostAllowed('acme.test.evil.io', ['network:*.acme.test']), false);
  assert.equal(dh.hostAllowed('xacme.test', ['network:*.acme.test']), false);
});

const fakeFetch = (body, status = 200, seen = []) => async (url, o) => { seen.push({ url, o }); return { ok: status < 400, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) }; };
test('status checks run only with granted permissions', async () => {
  const seen = [];
  const r = await dh.runStatus(good(), { config: { region: 'eu & us' }, granted: ['network:api.acme.test'], deps: { fetch: fakeFetch({ data: { online: true, players: 12 } }, 200, seen) } });
  assert.deepEqual([r.state, r.text], ['connected', '12 players online']);
  assert.equal(seen[0].url, 'https://api.acme.test/status?region=eu%20%26%20us', 'settings are URL-encoded');
  assert.equal(seen[0].o.redirect, 'error', 'no redirects to other hosts');
  assert.equal((await dh.runStatus(good(), { config: {}, granted: ['network:api.acme.test'], deps: { fetch: fakeFetch({ data: { online: false } }) } })).text, 'Acme is down');
  await assert.rejects(dh.runStatus(good(), { config: {}, granted: [], deps: { fetch: fakeFetch({}) } }), /Not allowed/);
  assert.equal((await dh.runStatus(good(), { config: {}, granted: ['network:api.acme.test'], deps: { fetch: fakeFetch('<html>', 200) } })).state, 'error');
  assert.equal((await dh.runStatus(good(), { config: {}, granted: ['network:api.acme.test'], deps: { fetch: fakeFetch('{}', 503) } })).text, 'api.acme.test answered HTTP 503');
  await assert.rejects(dh.runStatus(good(), { config: {}, granted: ['network:api.acme.test'], deps: { fetch: fakeFetch('x'.repeat(300 * 1024)) } }), /too big/);
  const ping = { ...good(), permissions: ['ping'], config: [{ key: 'address', type: 'text' }], status: { type: 'server-ping', address: '{{config.address}}' }, notify: undefined };
  const pr = await dh.runStatus(ping, { config: { address: 'mc.test' }, granted: ['ping'], deps: { ping: async () => ({ online: true, players: { online: 2, max: 10 } }) } });
  assert.equal(pr.text, 'mc.test: 2/10 players');
  assert.equal(dh.matches(5, { gt: 3 }), true); assert.equal(dh.matches('up', ['up', 'ok']), true); assert.equal(dh.matches(null, { exists: false }), true);
});

test('as a Connect integration: needs setup until every permission is granted; status changes become alerts', async () => {
  let granted = [];
  let online = true;
  const alerts = [], traces = [];
  const def = dh.toDefinition(good(), { granted: () => granted, deps: { fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: { online, players: 1 } }) }) }, onTrace: (id, t) => traces.push(t), onStatusChange: (m, r) => alerts.push(r.state) });
  const mem = (() => { let d = {}; return { read: () => d, write: (x) => { d = x; } }; })();
  const reg = createRegistry({ defs: [def], store: mem });
  await reg.setEnabled('acme-status', true);
  let s = await reg.status('acme-status');
  assert.equal(s.state, 'needs-setup'); assert.match(s.text, /network:api\.acme\.test, notifications/);
  granted = ['network:api.acme.test', 'notifications'];
  assert.equal((await reg.status('acme-status')).state, 'connected');
  online = false;
  assert.equal((await reg.status('acme-status')).state, 'ready');
  assert.deepEqual(alerts, ['ready']);
  assert.equal(traces.length, 2);
  assert.equal((await reg.get('acme-status')).thirdParty.author, 'Acme');
});

test('install from a folder, grant, report, uninstall', async () => {
  const folder = path.join(work, 'acme');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, dh.MANIFEST), JSON.stringify(good()));
  assert.equal(dh.check(folder).ok, true);
  const it = dh.install(folder);
  assert.equal(it.id, 'acme-status');
  assert.ok(it.permissions.every((p) => !p.granted), 'nothing is granted on install');
  assert.ok(dh.definitions().some((d) => d.id === 'acme-status'));
  assert.ok((await require('../src/connect').list()).some((x) => x.id === 'acme-status'), 'shows up in Astra Connect');
  assert.equal(dh.setGrant('acme-status', 'notifications', true).permissions.find((p) => p.id === 'notifications').granted, true);
  assert.throws(() => dh.setGrant('acme-status', 'ping', true), /didn’t ask/);
  assert.match(dh.report('acme-status'), /"acme-status"/);
  const own = path.join(work, 'own'); fs.mkdirSync(own);
  fs.writeFileSync(path.join(own, dh.MANIFEST), JSON.stringify({ ...good(), id: 'discord-rpc' }));
  assert.throws(() => dh.install(own), /Astra’s own/);
  await dh.uninstall('acme-status');
  assert.equal(dh.list().length, 0);
  assert.throws(() => dh.install(work), /No astra-integration\.json/);
});

test('the SDK example manifest is valid', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'sdk', 'example', dh.MANIFEST), 'utf8'));
  assert.deepEqual(dh.validate(m, { appVersion: '1.12.0' }).errors, []);
});

// ---------- assistant ----------
const CRASH = `---- Minecraft Crash Report ----
Description: Mod loading error has occurred

java.lang.RuntimeException: Mixin transformation of net.minecraft.client.render.WorldRenderer failed
Caused by: org.spongepowered.asm.mixin.injection.throwables.InvalidInjectionException: Critical injection failure: @Inject annotation on renderSky could not find any targets matching 'render' in sodium.mixins.json:WorldRendererMixin from mod sodium
Suspected Mods: Sodium (sodium), Iris (iris)
	at C:\\Users\\${os.userInfo().username}\\AppData\\Roaming\\.solaris\\instances\\x
--accessToken eyJhbGciOiJIUzI1NiJ9xxxxxxxx.eyJzdWIiOiIxMjM0NTY3ODkwIn0xxxx.abcdefghijklmno`;

test('reads the suspects out of a crash', () => {
  const s = as.suspects(CRASH);
  assert.equal(s[0].id, 'sodium');
  assert.ok(s.some((x) => x.id === 'iris'));
  assert.ok(s[0].reasons.some((r) => /Mixin/.test(r)));
});

test('nothing personal is sent', () => {
  const t = as.scrub(CRASH + '\nplayer me@example.com joined from 203.0.113.9');
  assert.ok(!t.includes(os.userInfo().username) || os.userInfo().username.length <= 2);
  assert.ok(!t.includes(os.homedir()));
  assert.match(t, /--accessToken \[removed\]/);
  assert.ok(!t.includes('me@example.com')); assert.ok(!t.includes('203.0.113.9'));
});

test('crash diagnosis combines rules, suspects and the instance check into reversible actions', () => {
  const mods = [{ file: 'sodium-0.5.jar', enabled: true, manifest: { modId: 'sodium', name: 'Sodium' } }, { file: 'lib.jar.disabled', enabled: false, manifest: { modId: 'lib' } }];
  const check = { findings: [{ severity: 'error', title: 'X needs “lib”', fix: { kind: 'enable', file: 'lib.jar.disabled' } }, { severity: 'error', title: 'Y needs “cloth”', fix: { kind: 'install', id: 'cloth' } }], health: { score: 50 } };
  const d = as.diagnoseCrash({ text: CRASH, instanceId: 'i1' }, { crash: require('../src/crash'), check: () => check, mods: () => mods });
  assert.ok(d.causes.some((c) => /Mixin/.test(c.title)));
  assert.equal(d.suspects[0].file, 'sodium-0.5.jar');
  assert.deepEqual(d.actions.map((a) => a.kind), ['disable-mod', 'enable-mod', 'find-mod']);
  assert.ok(d.actions.every((a) => a.reversible));
});

test('launcher errors in plain words', () => {
  assert.equal(as.explainError('getaddrinfo ENOTFOUND api.modrinth.com').causes[0].title, 'No internet name lookup');
  assert.equal(as.explainError('EBUSY: resource busy or locked').causes[0].title, 'File in use');
  assert.equal(as.explainError('???').causes[0].title, 'Not a known error');
});

test('Ask Claude: the request, refusals, and an unavailable SDK', async () => {
  let req = null;
  const client = { beta: { messages: { create: async (r) => { req = r; return { stop_reason: 'end_turn', model: r.model, content: [{ type: 'text', text: 'Sodium is too old.' }] }; } } } };
  const r = await as.askClaude({ kind: 'crash', text: CRASH, local: { causes: [{ title: 'Mod conflict' }] }, mods: [{ file: 'a.jar', manifest: { modId: 'sodium', version: '0.5' } }] }, { client });
  assert.equal(r.text, 'Sodium is too old.');
  assert.equal(req.model, as.MODEL);
  assert.equal(req.fallbacks, 'default');
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.ok(!('thinking' in req) && !('temperature' in req));
  assert.match(req.messages[0].content, /sodium@0\.5/);
  assert.match(req.messages[0].content, /\[removed\]/);
  const refused = await as.askClaude({ kind: 'crash', text: 'x' }, { client: { beta: { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } } } });
  assert.equal(refused.refused, true); assert.equal(refused.text, null);
  let hasSdk = true; try { require.resolve('@anthropic-ai/sdk'); } catch { hasSdk = false; }
  if (!hasSdk) {
    assert.equal(as.aiStatus().available, false);
    await assert.rejects(as.askClaude({ kind: 'crash', text: 'x' }), /isn’t available/);
  }
});
