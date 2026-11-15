// Solaris Connect — web maps (BlueMap, Pl3xMap, Dynmap) for hosted servers, and map links to other servers' maps.
// One web map per server. Each map type lives in ./maps/<id>.js (what it is, where its settings are, how to read
// its web map); this file installs it, keeps its port and settings right, and checks the map is really up.
//
// Saved per server as m.webmap = { provider, on, port, acceptDownload } (servers from before keep m.bluemap).
const fs = require('fs');
const net = require('net');
const { setConf } = require('./maps/conf');

const PROVIDERS = { bluemap: require('./maps/bluemap'), pl3xmap: require('./maps/pl3xmap'), dynmap: require('./maps/dynmap') };
const host = () => require('../hostserver');
const util = () => require('../util');

/** The server's web map settings (also reads the older BlueMap-only setting). */
function wmOf(s) {
  if (s.webmap?.provider) return s.webmap;
  if (s.bluemap) return { provider: 'bluemap', ...s.bluemap };
  return null;
}
const jarOf = (id, p) => { try { return host().installedContent(id).find((c) => p.jar.test(c.file) || c.projectId === p.project) || null; } catch { return null; } };
const providersFor = (software) => Object.values(PROVIDERS).filter((p) => p.software.includes(software)).map((p) => ({ id: p.id, name: p.name, style: p.style, needsDownload: p.needsDownload, docs: p.docs }));

async function getJSON(url, ms = 2500) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const portFree = (port) => new Promise((resolve) => { const s = net.createServer(); s.once('error', () => resolve(false)); s.listen(port, '0.0.0.0', () => s.close(() => resolve(true))); });
async function freePort(selfId, from) {
  const used = new Set(host().list().filter((s) => s.id !== selfId).flatMap((s) => [s.port, wmOf(s)?.port, s.voice?.port, s.bedrock?.port, s.pack?.port]).filter(Boolean));
  for (let p = from; p < from + 200; p++) if (!used.has(p) && (await portFree(p))) return p;
  throw new Error('No free port for the web map.');
}
function lanIp() {
  for (const l of Object.values(require('os').networkInterfaces())) for (const a of l || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return null;
}

/** Map tab → Turn on: installs the chosen map (only one per server) and remembers the player's answers. */
async function enable(id, { provider = 'bluemap', acceptDownload = false } = {}) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error('Pick BlueMap, Pl3xMap or Dynmap.');
  const s = host().get(id);
  if (!p.software.includes(s.software)) throw new Error(`${p.name} doesn’t run on ${s.softwareName} servers — it needs ${p.software.map((x) => x[0].toUpperCase() + x.slice(1)).join(', ').replace('Neoforge', 'NeoForge')}.`);
  if (p.needsDownload && !acceptDownload) throw new Error(`${p.name} needs the Minecraft textures to draw the map. Tick the box to accept Mojang’s EULA and let it download them.`);
  // another map type on? turn it off first (two web maps would both draw the whole world)
  const cur = wmOf(s);
  if (cur?.on && cur.provider !== provider) disable(id);
  const jar = jarOf(id, p);
  if (!jar) {
    try { await host().installContent(id, p.project); }
    catch (e) { throw new Error(`${p.name} couldn’t be installed: ${e.message}`); }
  } else if (!jar.enabled) host().toggleContent(id, jar.file);
  const port = cur?.provider === provider && cur.port ? cur.port : await freePort(id, p.defaultPort);
  const wm = { provider, on: true, port, acceptDownload: !!acceptDownload };
  const v = host().patchMeta(id, { webmap: wm, bluemap: undefined });
  try { p.writeConf(v, wm); } catch {}
  return info(id);
}
/** Turns the map off (the mod/plugin is disabled, the drawn map stays on disk). */
function disable(id) {
  const s = host().get(id), wm = wmOf(s);
  if (!wm) return info(id);
  const p = PROVIDERS[wm.provider], jar = p && jarOf(id, p);
  if (jar && jar.enabled) host().toggleContent(id, jar.file);
  host().patchMeta(id, { webmap: { ...wm, on: false }, bluemap: undefined });
  return info(id);
}

/** Asks a web map itself what it is and who is on it. With no type given, tries each type. */
async function probe(base, provider = null) {
  const list = provider ? [PROVIDERS[provider]] : Object.values(PROVIDERS);
  let last = null;
  for (const p of list) {
    try { const r = await p.probe(base, getJSON); return { provider: p.id, providerName: p.name, ...r }; }
    catch (e) { last = e; if (e.name === 'TimeoutError' || /ECONNREFUSED|ENOTFOUND|fetch failed/i.test(String(e.cause?.code || e.message))) throw e; }
  }
  throw new Error(provider ? `That isn’t a ${PROVIDERS[provider].name} web map.` : 'That isn’t a BlueMap, Pl3xMap or Dynmap web map.' + (last ? '' : ''));
}
const unreachable = (e) => e.name === 'TimeoutError' || /ECONNREFUSED|fetch failed/i.test(String(e.cause?.code || e.message));

/** Everything the Map tab and Solaris Connect show for one hosted server. */
async function info(id) {
  const s = host().get(id);
  const wm = wmOf(s), p = wm && PROVIDERS[wm.provider], jar = p && jarOf(id, p);
  const out = { providers: providersFor(s.software), supported: providersFor(s.software).length > 0, provider: wm?.provider || null, providerName: p?.name || null,
    on: !!(wm?.on && jar?.enabled), installed: !!jar, port: wm?.port || null, state: s.state, url: null, lanUrl: null, online: false, maps: [], error: null, configured: false };
  if (!out.on) return out;
  out.url = `http://localhost:${wm.port}/`;
  const ip = lanIp(); if (ip) out.lanUrl = `http://${ip}:${wm.port}/`;
  try { out.configured = p.configured(s); } catch {}
  if (s.state !== 'online') return out;
  try { const r = await probe(`http://127.0.0.1:${wm.port}`, wm.provider); out.online = true; out.maps = r.maps; }
  catch (e) { out.error = unreachable(e) ? 'The web map isn’t answering yet' : e.message; }
  return out;
}

// ---------- Hosting hooks: the map's own settings files (written on its first start) ----------
const done = new Set(); // servers whose map settings were checked this run
function fix(id, why) {
  let s; try { s = host().get(id); } catch { return; }
  const wm = wmOf(s), p = wm?.on && PROVIDERS[wm.provider];
  if (!p) return;
  try {
    if (p.writeConf(s, wm)) {
      host().logLine(id, `[Solaris] ${p.name} set up (web map on port ${wm.port}${p.needsDownload ? ', download accepted' : ''}) — reloading ${p.name}.`);
      host().command(id, p.reload);
    }
  } catch (e) { host().logLine(id, `[Solaris] Couldn’t set up ${p.name}: ${e.message}`); }
}
function register(hooks) {
  hooks.beforeStart.add((m) => { done.delete(m.id); const wm = wmOf(m); if (wm?.on && PROVIDERS[wm.provider]) PROVIDERS[wm.provider].writeConf(m, wm); });
  hooks.line.add((id, line) => {
    if (done.has(id)) return;
    let s; try { s = host().get(id); } catch { return; }
    const wm = wmOf(s), p = wm?.on && PROVIDERS[wm.provider];
    if (!p) return;
    // BlueMap says right away that it needs the download; for the others, when the server has finished starting
    if ((p.setupLine && p.setupLine(line)) || /Done \([\d.,]+s\)!|Server started\./.test(line)) { done.add(id); setTimeout(() => fix(id), 1500); }
  });
}

// ---------- map links (web maps of servers you play on) ----------
const linksFile = () => util().paths.file('maps.json');
const links = () => util().readJSON(linksFile(), []);
function cleanUrl(u) {
  const s = String(u || '').trim().replace(/#.*$/, '').replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+(\/\S*)?$/i.test(s)) throw new Error('Paste the map’s web address, starting with http:// or https://');
  return s;
}
async function addLink(url, name) {
  const base = cleanUrl(url);
  const r = await probe(base); // only real BlueMap / Pl3xMap / Dynmap maps
  const list = links().filter((l) => l.url !== base);
  list.push({ id: Math.random().toString(36).slice(2, 10), url: base, provider: r.provider, name: String(name || '').trim().slice(0, 40) || new URL(base).host, added: Date.now() });
  util().writeJSON(linksFile(), list.slice(-30));
  return listLinks();
}
function removeLink(lid) { util().writeJSON(linksFile(), links().filter((l) => l.id !== lid)); return listLinks(); }
async function listLinks() {
  return Promise.all(links().map(async (l) => {
    const provider = l.provider || 'bluemap';
    try { const r = await probe(l.url, provider); return { ...l, provider, providerName: PROVIDERS[provider].name, online: true, maps: r.maps }; }
    catch (e) { return { ...l, provider, providerName: PROVIDERS[provider]?.name, online: false, maps: [], error: e.name === 'TimeoutError' ? 'No answer' : unreachable(e) ? 'Not answering' : e.message }; }
  }));
}

module.exports = { PROVIDERS, providersFor, wmOf, enable, disable, info, register, probe, addLink, removeLink, listLinks, setConf };
