// BlueMap (https://bluemap.bluecolored.de) — 3D web map. Checked against github.com/BlueMap-Minecraft/BlueMap:
//   · Modrinth swbUV1cr: Paper/Purpur plugin, Fabric/Forge/NeoForge mod.
//   · plugins/BlueMap/ (plugin) or config/bluemap/ (mod), written on its first start:
//       core.conf      accept-download: false — draws nothing until true (= accepting Mojang's EULA for the
//                      Minecraft client file it downloads for textures). Only set after the player agreed.
//       webserver.conf port: 8100
//   · GET /settings.json → { maps: [ids], mapDataRoot, liveDataRoot }
//     GET /<mapDataRoot>/<id>/settings.json → { name, … }
//     GET /<liveDataRoot>/<id>/live/players.json → { players: [{ uuid, name, foreign, position:{x,y,z} }] }
const fs = require('fs');
const path = require('path');
const { setConf } = require('./conf');

const dir = (m) => path.join(m.dir, ...(['paper', 'purpur'].includes(m.software) ? ['plugins', 'BlueMap'] : ['config', 'bluemap']));

module.exports = {
  id: 'bluemap', name: 'BlueMap', project: 'swbUV1cr', style: '3D map',
  software: ['paper', 'purpur', 'fabric', 'forge', 'neoforge'],
  defaultPort: 8100, needsDownload: true, reload: 'bluemap reload', docs: 'https://bluemap.bluecolored.de/wiki/',
  jar: /bluemap/i,
  // its first start says it needs the download accepted: set it right away and reload
  setupLine: (line) => /bluemap/i.test(line) && /accept|download/i.test(line),
  dir,
  /** Writes the port, and accept-download only when the player agreed. Returns true when a file changed. */
  writeConf(m, wm) {
    let changed = false;
    const core = path.join(dir(m), 'core.conf'), web = path.join(dir(m), 'webserver.conf');
    if (fs.existsSync(core) && wm.acceptDownload) { const t = fs.readFileSync(core, 'utf8'), n = setConf(t, 'accept-download', 'true'); if (n !== t) { fs.writeFileSync(core, n); changed = true; } }
    if (fs.existsSync(web)) { const t = fs.readFileSync(web, 'utf8'), n = setConf(t, 'port', String(wm.port)); if (n !== t) { fs.writeFileSync(web, n); changed = true; } }
    return changed;
  },
  configured(m) { try { return /^accept-download\s*:\s*true/m.test(fs.readFileSync(path.join(dir(m), 'core.conf'), 'utf8')); } catch { return false; } },
  async probe(base, getJSON) {
    const st = await getJSON(`${base}/settings.json`);
    if (!Array.isArray(st?.maps)) throw new Error('not a BlueMap map');
    const mapRoot = st.mapDataRoot || 'maps', liveRoot = st.liveDataRoot || 'maps';
    const maps = await Promise.all(st.maps.slice(0, 20).map(async (mid) => {
      const out = { id: String(mid), name: String(mid), players: [] };
      try { const ms = await getJSON(`${base}/${mapRoot}/${encodeURIComponent(mid)}/settings.json`); if (ms?.name) out.name = String(ms.name).replace(/§./g, ''); } catch {}
      try { const lp = await getJSON(`${base}/${liveRoot}/${encodeURIComponent(mid)}/live/players.json`); out.players = (lp.players || []).filter((p) => !p.foreign).map((p) => ({ name: String(p.name), x: Math.round(p.position?.x || 0), y: Math.round(p.position?.y || 0), z: Math.round(p.position?.z || 0) })); } catch {}
      return out;
    }));
    return { maps };
  },
};
