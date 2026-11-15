// Dynmap (https://github.com/webbukkit/dynmap) — the classic web map. Checked against its source:
//   · Modrinth fRQREgAc: Paper/Spigot plugin, Fabric and Forge mods (per Minecraft version).
//   · Settings: plugins/dynmap/configuration.txt (plugin) or dynmap/configuration.txt in the server folder
//     (Fabric/Forge use new File("dynmap")), written on its first start. The web map: "webserver-port: 8123".
//     It ships its own textures — nothing is downloaded from Mojang.
//   · GET /up/configuration → { title, worlds: [{ name, title, … }] }
//     GET /up/world/<world>/<timestamp> → { players: [{ name, account, world, x, y, z, … }] }
//     (players Dynmap hides are given the world "-some-other-bogus-world-")
//   · Reload: "/dynmap reload".
const fs = require('fs');
const path = require('path');
const { setConf } = require('./conf');

const dir = (m) => path.join(m.dir, ...(['paper', 'purpur'].includes(m.software) ? ['plugins', 'dynmap'] : ['dynmap']));

module.exports = {
  id: 'dynmap', name: 'Dynmap', project: 'fRQREgAc', style: 'Classic map',
  software: ['paper', 'purpur', 'fabric', 'forge'],
  defaultPort: 8123, needsDownload: false, reload: 'dynmap reload', docs: 'https://github.com/webbukkit/dynmap/wiki',
  jar: /dynmap/i,
  dir,
  writeConf(m, wm) {
    const f = path.join(dir(m), 'configuration.txt');
    if (!fs.existsSync(f)) return false;
    const t = fs.readFileSync(f, 'utf8'), n = setConf(t, 'webserver-port', String(wm.port));
    if (n === t) return false;
    fs.writeFileSync(f, n);
    return true;
  },
  configured(m) { return fs.existsSync(path.join(dir(m), 'configuration.txt')); },
  async probe(base, getJSON) {
    const cfg = await getJSON(`${base}/up/configuration`);
    if (!Array.isArray(cfg?.worlds)) throw new Error('not a Dynmap map');
    // one update for any world lists every player with the world they're in
    let players = [];
    if (cfg.worlds[0]) { try { const u = await getJSON(`${base}/up/world/${encodeURIComponent(cfg.worlds[0].name)}/${Date.now()}`); players = (u.players || []).filter((p) => p.world && p.world !== '-some-other-bogus-world-'); } catch {} }
    const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/§./g, '');
    return {
      maps: cfg.worlds.slice(0, 20).map((w) => ({
        id: String(w.name), name: strip(w.title) || String(w.name),
        players: players.filter((p) => p.world === w.name).map((p) => ({ name: strip(p.name) || String(p.account), x: Math.round(p.x || 0), y: Math.round(p.y || 0), z: Math.round(p.z || 0) })),
      })),
    };
  },
};
