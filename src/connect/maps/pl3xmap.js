// Pl3xMap (https://github.com/granny/Pl3xMap) — fast 2D web map. Checked against its source:
//   · Modrinth 34T8oVNY: one jar for Paper/Purpur/Bukkit and Fabric/Quilt.
//   · Settings: plugins/Pl3xMap/config.yml (plugin, the plugin data folder) or config/pl3xmap/config.yml
//     (Fabric: gameDir/config/pl3xmap), written on its first start. The web map: settings.internal-webserver.port
//     (default 8080, bound to 0.0.0.0). No download from Mojang — it colours the map itself.
//   · GET /tiles/settings.json → { players: [{ name, uuid, displayName, world, position:{x,z} }],
//                                 worldSettings: [{ name, displayName, … }] }   (players are left out when hidden)
//   · Reload: "/map reload" (the command is "map", alias "pl3xmap").
const fs = require('fs');
const path = require('path');

const dir = (m) => path.join(m.dir, ...(['paper', 'purpur'].includes(m.software) ? ['plugins', 'Pl3xMap'] : ['config', 'pl3xmap']));
const yaml = () => require('../../hostserver').setYaml;

module.exports = {
  id: 'pl3xmap', name: 'Pl3xMap', project: '34T8oVNY', style: '2D map',
  software: ['paper', 'purpur', 'fabric', 'quilt'],
  defaultPort: 8080, needsDownload: false, reload: 'map reload', docs: 'https://github.com/granny/Pl3xMap/wiki',
  jar: /pl3xmap/i,
  dir,
  writeConf(m, wm) {
    const f = path.join(dir(m), 'config.yml');
    if (!fs.existsSync(f)) return false;
    const t = fs.readFileSync(f, 'utf8');
    let n = yaml()(t, ['settings', 'internal-webserver', 'port'], String(wm.port));
    n = yaml()(n, ['settings', 'web-address'], `http://localhost:${wm.port}`); // the address Pl3xMap puts in its own links
    if (n === t) return false;
    fs.writeFileSync(f, n);
    return true;
  },
  configured(m) { return fs.existsSync(path.join(dir(m), 'config.yml')); },
  async probe(base, getJSON) {
    const st = await getJSON(`${base}/tiles/settings.json`);
    if (!Array.isArray(st?.worldSettings)) throw new Error('not a Pl3xMap map');
    const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/§./g, '');
    const players = (st.players || []).filter((p) => p.world && p.position);
    return {
      maps: st.worldSettings.slice(0, 20).map((w) => ({
        id: String(w.name), name: strip(w.displayName) || String(w.name),
        players: players.filter((p) => p.world === w.name).map((p) => ({ name: strip(p.name), x: Math.round(p.position.x || 0), y: null, z: Math.round(p.position.z || 0) })),
      })),
    };
  },
};
