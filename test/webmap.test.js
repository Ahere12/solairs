// Astra Connect steps 3–4: web maps (BlueMap, Pl3xMap, Dynmap).  Run: npm test
// Each web map is faked with a small HTTP server that answers like the real one (same paths and JSON shapes as
// in their source code — see the comments at the top of src/connect/maps/*.js).
const { test, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { dataDir, cleanup } = require('./helpers/electron-stub');
const wm = require('../src/connect/webmap');
const { setConf, getConf } = require('../src/connect/maps/conf');

after(cleanup);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** routes: exact path → JSON, or a function(path) → JSON|undefined for path patterns */
function fakeMap(routes) {
  const srv = http.createServer((req, res) => {
    const p = req.url.split('?')[0];
    let body = routes[p];
    if (body === undefined && typeof routes.match === 'function') body = routes.match(p);
    if (body === undefined) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body));
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, base: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((c) => srv.close(c)) })));
}
const BLUEMAP = {
  '/settings.json': { version: '5.16', maps: ['world', 'world_the_end'], mapDataRoot: 'maps', liveDataRoot: 'maps' },
  '/maps/world/settings.json': { name: 'World' },
  '/maps/world_the_end/settings.json': { name: '§5The End' },
  '/maps/world/live/players.json': { players: [{ uuid: 'u1', name: 'Alex', foreign: false, position: { x: 10.4, y: 64, z: -5.6 } }, { uuid: 'u2', name: 'Steve', foreign: true, position: { x: 0, y: 0, z: 0 } }] },
  '/maps/world_the_end/live/players.json': { players: [] },
};
const PL3XMAP = {
  '/tiles/settings.json': {
    format: 'png', maxPlayers: 20,
    players: [{ name: '<gold>Alex', uuid: 'u1', displayName: 'Alex', world: 'minecraft:overworld', position: { x: 100, z: -40 } }, { name: 'Hidden', uuid: 'u3', displayName: 'Hidden' }],
    worldSettings: [{ name: 'minecraft:overworld', displayName: '<green>Overworld', type: 'overworld' }, { name: 'minecraft:the_nether', displayName: 'Nether', type: 'nether' }],
  },
};
const DYNMAP = {
  '/up/configuration': { title: 'My Dynmap', worlds: [{ name: 'world', title: 'World' }, { name: 'world_nether', title: 'Nether' }] },
  match: (p) => (/^\/up\/world\/world\/\d+$/.test(p) ? { players: [{ type: 'player', name: 'Alex', account: 'Alex', world: 'world_nether', x: 5.2, y: 70, z: 9.9 }, { name: 'Ghost', account: 'Ghost', world: '-some-other-bogus-world-', x: 0, y: 0, z: 0 }] } : undefined),
};

test('config helpers change one setting and keep the rest', () => {
  const core = '# accept-download: false is explained here\naccept-download: false\ndata: "bluemap"\n';
  assert.equal(setConf(core, 'accept-download', 'true'), '# accept-download: false is explained here\naccept-download: true\ndata: "bluemap"\n');
  assert.equal(setConf('# The port that…\nport: 8100\nsse-enabled: true\n', 'port', '8101'), '# The port that…\nport: 8101\nsse-enabled: true\n');
  assert.equal(setConf('enabled: true', 'port', '8102'), 'enabled: true\nport: 8102\n', 'a missing key is added');
  assert.equal(getConf('#webserver-bindaddress: 0.0.0.0\nwebserver-port: 8123\n', 'webserver-port'), '8123');
  const setYaml = require('../src/hostserver').setYaml;
  const y = setYaml('settings:\n  debug-mode: false\n  internal-webserver:\n    enabled: true\n    port: 8080\n', ['settings', 'internal-webserver', 'port'], '8081');
  assert.match(y, /^ {4}port: 8081$/m); assert.match(y, /enabled: true/);
});

test('each map type is read the way it serves its data', async () => {
  const bm = await fakeMap(BLUEMAP), pl = await fakeMap(PL3XMAP), dy = await fakeMap(DYNMAP);
  const b = await wm.probe(bm.base);
  assert.equal(b.provider, 'bluemap');
  assert.deepEqual(b.maps.map((m) => [m.id, m.name]), [['world', 'World'], ['world_the_end', 'The End']]);
  assert.deepEqual(b.maps[0].players, [{ name: 'Alex', x: 10, y: 64, z: -6 }], 'players in other worlds (foreign) are left out');
  const p = await wm.probe(pl.base);
  assert.equal(p.provider, 'pl3xmap');
  assert.deepEqual(p.maps.map((m) => [m.id, m.name]), [['minecraft:overworld', 'Overworld'], ['minecraft:the_nether', 'Nether']]);
  assert.deepEqual(p.maps[0].players, [{ name: 'Alex', x: 100, y: null, z: -40 }], 'hidden players (no world/position) are left out');
  const d = await wm.probe(dy.base);
  assert.equal(d.provider, 'dynmap');
  assert.deepEqual(d.maps.map((m) => [m.id, m.name]), [['world', 'World'], ['world_nether', 'Nether']]);
  assert.deepEqual(d.maps[1].players, [{ name: 'Alex', x: 5, y: 70, z: 10 }], 'players go to their own world; hidden ones are left out');
  await assert.rejects(wm.probe(bm.base, 'dynmap'), /isn’t a Dynmap web map/);
  const other = await fakeMap({ '/settings.json': { hello: 1 } });
  await assert.rejects(wm.probe(other.base), /isn’t a BlueMap, Pl3xMap or Dynmap/);
  await Promise.all([bm.close(), pl.close(), dy.close(), other.close()]);
});

test('map links: any of the three, only real maps are saved, live state shown', async () => {
  const pl = await fakeMap(PL3XMAP), dy = await fakeMap(DYNMAP);
  await assert.rejects(wm.addLink('not a link'), /web address/);
  await assert.rejects(wm.addLink('http://127.0.0.1:1'), /fetch failed|ECONNREFUSED/i);
  let l = await wm.addLink(pl.base + '/#world', 'Friends’ server');
  l = await wm.addLink(dy.base + '/');
  assert.deepEqual(l.map((x) => [x.provider, x.online, x.maps.length]), [['pl3xmap', true, 2], ['dynmap', true, 2]]);
  l = await wm.addLink(dy.base); assert.equal(l.length, 2, 'the same map is not added twice');
  await dy.close();
  l = await wm.listLinks(); assert.equal(l.find((x) => x.provider === 'dynmap').online, false, 'a map that stops answering shows as offline');
  for (const x of l) await wm.removeLink(x.id);
  assert.equal((await wm.listLinks()).length, 0);
  await pl.close();
});

test('hosted servers: right map for the server, the download question, files set up on first start, one map at a time', async () => {
  const hs = require('../src/hostserver');
  const mk = (id, software) => {
    const dir = path.join(dataDir, 'hosted', id); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'solaris-server.json'), JSON.stringify({ name: id, mc: '1.21.10', software, port: 25565, tunnel: 'none' }));
    return { id, dir };
  };
  const servers = [mk('paper-srv', 'paper'), mk('vanilla-srv', 'vanilla'), mk('neo-srv', 'neoforge'), mk('quilt-srv', 'quilt')];
  fs.writeFileSync(path.join(dataDir, 'hosted', 'servers.json'), JSON.stringify(servers));
  assert.deepEqual(wm.providersFor('paper').map((p) => p.id), ['bluemap', 'pl3xmap', 'dynmap']);
  assert.deepEqual(wm.providersFor('neoforge').map((p) => p.id), ['bluemap']);
  assert.deepEqual(wm.providersFor('quilt').map((p) => p.id), ['pl3xmap']);
  assert.equal((await wm.info('vanilla-srv')).supported, false);
  await assert.rejects(wm.enable('paper-srv', { provider: 'bluemap' }), /EULA/);
  await assert.rejects(wm.enable('neo-srv', { provider: 'dynmap' }), /Dynmap doesn’t run on NeoForge/);
  await assert.rejects(wm.enable('vanilla-srv', { provider: 'pl3xmap' }), /doesn’t run on Vanilla/);

  // pretend Pl3xMap is installed and on (installing needs the internet; the real test does that)
  const plug = path.join(servers[0].dir, 'plugins'); fs.mkdirSync(plug, { recursive: true }); fs.writeFileSync(path.join(plug, 'Pl3xMap-1.21.10-538.jar'), 'x');
  hs.patchMeta('paper-srv', { webmap: { provider: 'pl3xmap', on: true, port: 8090 } });
  // Pl3xMap's first start writes config.yml; when the server has started, Astra sets the port and reloads it
  const conf = path.join(plug, 'Pl3xMap'); fs.mkdirSync(conf, { recursive: true });
  fs.writeFileSync(path.join(conf, 'config.yml'), 'settings:\n  debug-mode: false\n  web-address: http://localhost:8080\n  internal-webserver:\n    enabled: true\n    bind: 0.0.0.0\n    port: 8080\n');
  for (const h of hs.hooks.line) h('paper-srv', '[12:00:00 INFO]: Done (3.2s)! For help, type "help"');
  await sleep(1800);
  const y = fs.readFileSync(path.join(conf, 'config.yml'), 'utf8');
  assert.match(y, /^ {4}port: 8090$/m); assert.match(y, /web-address: http:\/\/localhost:8090/);
  const i = await wm.info('paper-srv');
  assert.equal(i.on, true); assert.equal(i.provider, 'pl3xmap'); assert.equal(i.url, 'http://localhost:8090/'); assert.equal(i.online, false, 'server is off');

  // switching to Dynmap turns Pl3xMap off (Dynmap's own jar is "installed" here too)
  fs.writeFileSync(path.join(plug, 'Dynmap-3.8-spigot.jar'), 'x');
  const d = await wm.enable('paper-srv', { provider: 'dynmap' });
  assert.equal(d.provider, 'dynmap'); assert.equal(d.on, true); assert.ok(d.port >= 8123);
  assert.ok(fs.existsSync(path.join(plug, 'Pl3xMap-1.21.10-538.jar.disabled')), 'the other map is turned off');
  const dc = path.join(plug, 'dynmap'); fs.mkdirSync(dc, { recursive: true }); fs.writeFileSync(path.join(dc, 'configuration.txt'), '#webserver-bindaddress: 0.0.0.0\nwebserver-port: 8123\ndisable-webserver: false\n');
  for (const h of hs.hooks.beforeStart) h(hs.get('paper-srv'));
  assert.equal(getConf(fs.readFileSync(path.join(dc, 'configuration.txt'), 'utf8'), 'webserver-port'), String(d.port));

  // BlueMap: accept-download only with the player's answer
  fs.writeFileSync(path.join(plug, 'bluemap-5.16-paper.jar'), 'x');
  await wm.enable('paper-srv', { provider: 'bluemap', acceptDownload: true });
  const bc = path.join(plug, 'BlueMap'); fs.mkdirSync(bc, { recursive: true });
  fs.writeFileSync(path.join(bc, 'core.conf'), '# …\naccept-download: false\n'); fs.writeFileSync(path.join(bc, 'webserver.conf'), 'port: 8100\n');
  for (const h of hs.hooks.beforeStart) h(hs.get('paper-srv')); // a new run
  for (const h of hs.hooks.line) h('paper-srv', '[BlueMap] BlueMap is missing important resources! You must accept the required file download in order for BlueMap to work!');
  await sleep(1800);
  assert.match(fs.readFileSync(path.join(bc, 'core.conf'), 'utf8'), /^accept-download: true$/m);
  assert.ok(fs.existsSync(path.join(plug, 'Dynmap-3.8-spigot.jar.disabled')));
  assert.equal((await wm.info('paper-srv')).configured, true);
  wm.disable('paper-srv');
  assert.ok(fs.existsSync(path.join(plug, 'bluemap-5.16-paper.jar.disabled')));
  assert.equal((await wm.info('paper-srv')).on, false);
});

test('servers set up before step 4 (BlueMap only) still work', async () => {
  const hs = require('../src/hostserver');
  const dir = path.join(dataDir, 'hosted', 'old-srv'); fs.mkdirSync(path.join(dir, 'mods'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'solaris-server.json'), JSON.stringify({ name: 'Old', mc: '1.21.10', software: 'fabric', port: 25570, tunnel: 'none', bluemap: { on: true, port: 8105, acceptDownload: true } }));
  fs.writeFileSync(path.join(dir, 'mods', 'bluemap-5.16-fabric.jar'), 'x');
  const idx = JSON.parse(fs.readFileSync(path.join(dataDir, 'hosted', 'servers.json'), 'utf8')); idx.push({ id: 'old-srv', dir });
  fs.writeFileSync(path.join(dataDir, 'hosted', 'servers.json'), JSON.stringify(idx));
  const i = await wm.info('old-srv');
  assert.equal(i.provider, 'bluemap'); assert.equal(i.on, true); assert.equal(i.port, 8105);
  const connect = require('../src/connect');
  assert.equal((await connect.get('bluemap')).status.text.startsWith('On 1 server'), true);
  assert.equal(hs.get('old-srv').bluemap.port, 8105);
});
