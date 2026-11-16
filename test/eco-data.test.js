// Astra Cloud & Sync, Analytics and Discover.  Run: npm test
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { dataDir, cleanup } = require('./helpers/electron-stub');
const bk = require('../src/eco/backup');
const an = require('../src/eco/analytics');
const dc = require('../src/eco/discovery');

const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-sync-test-'));
after(() => { cleanup(); fs.rmSync(syncDir, { recursive: true, force: true }); });

test('secrets never go into a backup or the sync folder', () => {
  const s = bk.stripSecrets({ theme: 'astra', curseforgeKey: 'abc', nested: { webhookUrl: 'https://x', ok: 1 }, list: [{ apiToken: 't', name: 'n' }] });
  assert.deepEqual(s, { theme: 'astra', nested: { ok: 1 }, list: [{ name: 'n' }] });
});

test('merging saved servers from two PCs', () => {
  const local = [{ id: 'a', address: 'one.net', name: 'One', updatedAt: 5 }, { id: 'b', address: 'two.net', updatedAt: 5 }];
  const remote = [{ id: 'x', address: 'ONE.net', name: 'One (renamed)', updatedAt: 9 }, { id: 'y', address: 'two.net', name: 'old', updatedAt: 1 }, { id: 'z', address: 'three.net' }, { id: 'w', address: 'gone.net' }];
  const m = bk.mergeServers(local, remote, { deleted: ['gone.net'] });
  assert.equal(m.servers.length, 3);
  assert.equal(m.servers.find((s) => s.address === 'one.net').name, 'One (renamed)', 'the newer edit wins');
  assert.equal(m.servers.find((s) => s.address === 'one.net').id, 'a', 'keeps this PC’s id');
  assert.equal(m.servers.find((s) => s.address === 'two.net').name, undefined, 'an older edit doesn’t win');
  assert.deepEqual(m.added.map((s) => s.address), ['three.net']);
});

test('backup → change → restore only what was chosen, with a safety backup first', async () => {
  const instances = require('../src/instances');
  const settings = require('../src/settings');
  const servers = require('../src/servers');
  const inst = instances.create({ name: 'Backed up', versionId: '1.20.1', loader: { type: 'fabric' } });
  fs.writeFileSync(path.join(inst.gameDir, 'options.txt'), 'fov:70\n');
  fs.mkdirSync(path.join(inst.gameDir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(inst.gameDir, 'config', 'sodium.json'), '{"a":1}');
  fs.mkdirSync(path.join(inst.gameDir, 'saves', 'World'), { recursive: true });
  settings.set({ theme: 'dawn', curseforgeKey: 'secret-key-123' });
  servers.save({ address: 'keep.example.com', name: 'Keep' });

  const b = await bk.create({ note: 'test' });
  assert.equal(b.kind, 'manual'); assert.equal(b.instances, 1); assert.ok(b.valid);
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(path.join(dataDir, 'backups', b.file));
  const names = zip.getEntries().map((e) => e.entryName);
  assert.ok(names.includes(`instances/${inst.id}/game/options.txt`));
  assert.ok(names.includes(`instances/${inst.id}/game/config/sodium.json`));
  assert.ok(!names.some((n) => n.includes('saves/')), 'worlds are not in this backup');
  assert.ok(!names.some((n) => /accounts\.json|connect\.json|playit\.json/.test(n)));
  assert.ok(!zip.readAsText('data/settings.json').includes('secret-key-123'), 'API keys are stripped');

  fs.writeFileSync(path.join(inst.gameDir, 'options.txt'), 'fov:110\n');
  settings.set({ theme: 'astra' });
  const plan = bk.preview(b.file);
  assert.deepEqual(plan.instances.map((i) => [i.id, i.exists]), [[inst.id, true]]);
  await assert.rejects(bk.restore(b.file, {}), /Choose what to restore/);
  const r = await bk.restore(b.file, { instances: [inst.id] });
  assert.deepEqual(r.restored, [inst.id]);
  assert.equal(fs.readFileSync(path.join(inst.gameDir, 'options.txt'), 'utf8'), 'fov:70\n');
  assert.equal(settings.get().theme, 'astra', 'settings weren’t chosen, so they stay');
  assert.ok(r.safetyBackup && bk.listBackups().some((x) => x.file === r.safetyBackup && x.kind === 'pre-restore'));
  await bk.restore(b.file, { data: ['settings'] });
  assert.equal(settings.get().theme, 'dawn');
  assert.equal(settings.get().curseforgeKey, 'secret-key-123', 'this PC’s key is kept');
  assert.throws(() => bk.preview('../settings.json'), /doesn’t exist/);
});

test('sync folder: send, preview, receive', async () => {
  assert.equal(bk.syncState().configured, false);
  assert.equal(bk.syncState().cloud.available, false, 'no Astra cloud account is pretended');
  assert.throws(() => bk.setPrefs({ syncDir: dataDir }), /outside the Astra data folder/);
  bk.setPrefs({ syncDir: syncDir });
  const pushed = await bk.syncPush();
  assert.ok(fs.existsSync(path.join(syncDir, 'astra-sync.json')));
  assert.ok(fs.existsSync(path.join(syncDir, 'backups', pushed.backup)));
  // another PC changed the theme and added a server
  const f = path.join(syncDir, 'astra-sync.json');
  const remote = JSON.parse(fs.readFileSync(f, 'utf8'));
  remote.device = 'Laptop'; remote.settings.theme = 'astra'; remote.servers.push({ id: 'r1', address: 'new.example.com', name: 'New', updatedAt: Date.now() });
  fs.writeFileSync(f, JSON.stringify(remote));
  const pv = bk.syncPreview();
  assert.deepEqual(pv.settings, ['theme']); assert.deepEqual(pv.serversAdded, ['New']);
  await bk.syncPull();
  assert.equal(require('../src/settings').get().theme, 'astra');
  assert.ok(require('../src/servers').list().servers.some((s) => s.address === 'new.example.com'));
});

test('analytics from sessions', () => {
  const now = new Date(2026, 10, 15, 20, 0).getTime();
  const H = 3600e3, D = 864e5;
  const s = (inst, start, h, more = {}) => ({ runId: inst + start, instanceId: inst, name: inst, mc: inst === 'a' ? '1.20.1' : '1.21', start, end: start + h * H, launchMs: 8000, ...more });
  const sessions = [s('a', now - 2 * H, 1), s('a', now - D - 2 * H, 2, { crashed: true, crash: 'Out of memory', launchMs: 12000 }), s('b', now - 3 * D, 0.5, { server: 'mc.example.com' }), s('a', now - 40 * D, 3)];
  const r = an.summarize(sessions, { now, instances: [{ id: 'a', name: 'Alpha', playTime: 100 * H }] });
  assert.equal(r.totals.sessions, 4);
  assert.equal(r.totals.week, 3.5 * H);
  assert.equal(r.totals.crashRate, 25);
  assert.equal(r.totals.streakDays, 2);
  assert.equal(r.totals.lifetimeMs, 100 * H);
  assert.equal(r.instances[0].name, 'Alpha'); assert.equal(r.instances[0].ms, 6 * H);
  assert.equal(r.instances.find((i) => i.instanceId === 'b').deleted, true);
  assert.equal(r.perDay.length, 30); assert.equal(r.perDay[29].ms, H);
  assert.deepEqual(r.crashes, [{ title: 'Out of memory', n: 1 }]);
  assert.equal(r.servers[0].address, 'mc.example.com');
  assert.equal(r.weeks.length, 8); assert.equal(r.weeks[7].sessions, 3);
  // a session across midnight counts on both days
  const mid = new Date(2026, 10, 15, 0, 0).getTime();
  const pd = an.perDay([{ start: mid - H, end: mid + H }], 3, now);
  assert.deepEqual(pd.slice(1).map((d) => d.ms), [H, H]);
});

test('sessions are recorded from the launcher’s game events', () => {
  const { events } = require('../src/util');
  an.init();
  events.emit('game:session', { runId: 'r1', instanceId: 'x', name: 'X', start: 1000, end: 61000, code: 0 });
  events.emit('game:session', { runId: 'r2', instanceId: 'x', start: 5, end: 1 }); // nonsense is ignored
  assert.deepEqual(an.sessions().map((x) => x.runId), ['r1']);
});

test('discover: providers, honest gaps, merged results, a failing provider', async () => {
  assert.deepEqual(dc.providers('map', { curseforgeKey: false }).map((p) => p.ok), [false, false]);
  assert.match(dc.providers('map', { curseforgeKey: false })[0].why, /doesn’t host maps/);
  const calls = [];
  const deps = {
    modrinth: { search: async (q) => { calls.push(['mr', q.type]); return { hits: [{ project_id: 'm1', slug: 'sodium', title: 'Sodium', downloads: 10, project_type: 'mod' }], total_hits: 1 }; } },
    curseforge: { available: () => true, search: async (q) => { calls.push(['cf', q.type]); return { hits: [{ project_id: '9', title: 'Sodium', downloads: 50, project_type: 'mod' }, { project_id: '8', title: 'Iris', downloads: 5, project_type: 'mod' }], total_hits: 2 }; } },
  };
  const r = await dc.search({ kind: 'mod', query: 'sodium' }, deps);
  assert.equal(r.results.length, 2, 'the same mod on both providers is one row');
  assert.equal(r.results[0].alsoOn[0].provider, 'curseforge');
  assert.equal(r.results[0].downloads, 50);
  const com = await dc.search({ kind: 'community' }, deps);
  assert.ok(calls.some((c) => c[1] === 'datapack') && calls.some((c) => c[1] === 'plugin') && calls.some((c) => c[1] === 'customization'));
  assert.ok(com.providers.every((p) => p.ok));
  const broken = await dc.search({ kind: 'mod' }, { ...deps, curseforge: { available: () => true, search: async () => { throw new Error('HTTP 500'); } } });
  assert.equal(broken.results.length, 1);
  assert.match(broken.providers.find((p) => p.provider === 'curseforge').why, /HTTP 500/);
  const maps = await dc.search({ kind: 'map' }, { ...deps, curseforge: { ...deps.curseforge, search: async (q) => { assert.equal(q.type, 'world'); return { hits: [{ project_id: '1', title: 'Skyblock', project_type: 'world' }] }; } } });
  assert.equal(maps.results[0].type, 'map');
  assert.equal(maps.providers.find((p) => p.provider === 'modrinth').ok, false);
});
