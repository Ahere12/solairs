// Discord Rich Presence through Silent Client's discord-rpc (MIT, github.com/Silent-Client/discord-rpc).
// Uses Solaris's built-in Discord application (src/config.js). Reconnects by itself when Discord is started later.
// Loaded on first use: the library (with its websocket and fetch helpers) takes ~45 ms to load at startup.
//
// What friends see, most important first:
//   1. Playing  — instance, and live from the game log: main menu / singleplayer world / server / hosting for friends
//   2. Hosting  — a Solaris-hosted server with its player count (Discord's "2 of 10")
//   3. Launcher — what you're doing in Solaris (browsing mods, picking a skin …)
// Privacy settings (Settings → Integrations) and streamer mode hide instance names, servers and worlds.
const Client = function (opts) { const { Client: C } = require('silent-discord-rpc'); return new C(opts); };
const settings = require('./settings');
const { DISCORD_CLIENT_ID } = require('./config');

const RETRY_MS = 20000;
const BUTTONS = [{ label: 'Get Solaris', url: 'https://github.com/Ahere12/solairs/releases/latest' }];
const PAGES = {
  home: 'In the launcher', library: 'Organising instances', instance: 'Setting up an instance', browse: 'Browsing mods',
  solaris: 'Setting up Solaris Client', servers: 'Looking for a server', skins: 'Picking a skin', friends: 'Checking on friends',
  host: 'Managing servers', gallery: 'Looking at screenshots', console: 'Reading game logs', settings: 'Tweaking settings',
  changelog: 'Reading what’s new', roadmap: 'Reading the roadmap',
};

let client = null, ready = false, connecting = null, retryTimer = null, enabledState = false;
const launcherSince = Date.now();
let page = 'home';
const games = new Map();  // runId -> { inst, start, modded, account, mode: 'menu'|'single'|'multi', server, world, lanHost }
const hosted = new Map(); // server id -> { name, software, mc, players, max, address, since }

function enabled() { return !!(settings.get().discordRpc && DISCORD_CLIENT_ID); }

async function connect() {
  if (!enabled()) return false;
  if (ready) return true;
  if (connecting) return connecting;
  connecting = (async () => {
    const c = new Client({ transport: 'ipc' });
    c.on('disconnected', () => { if (client === c) { client = null; ready = false; scheduleRetry(); } });
    try {
      await c.login({ clientId: DISCORD_CLIENT_ID });
      client = c; ready = true;
      return true;
    } catch {
      try { c.destroy(); } catch {}
      scheduleRetry(); // Discord isn't running (yet)
      return false;
    }
  })();
  try { return await connecting; } finally { connecting = null; }
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  if (!enabledState || !enabled()) return;
  retryTimer = setTimeout(() => { if (!ready) update(); }, RETRY_MS);
}

// ---------- building the presence ----------
function activity() {
  const s = settings.get();
  const hide = !!s.streamerMode;
  const showInst = s.discordShowInstance !== false && !hide;
  const showServer = s.discordShowServer !== false && !hide;
  const g = [...games.values()].pop(); // the newest running game
  if (g) {
    const head = s.discordShowHead !== false && g.account?.type === 'msa' && g.account.uuid ? `https://mc-heads.net/avatar/${String(g.account.uuid).replace(/-/g, '')}/128` : null;
    const where = g.lanHost ? 'Hosting a world for friends'
      : g.mode === 'multi' ? (showServer && g.server ? `On ${g.server}` : 'In multiplayer')
      : g.mode === 'single' ? (showInst && g.world ? `In singleplayer · ${g.world}` : 'In singleplayer')
      : 'In the menus';
    const version = `Minecraft ${g.inst.versionId}${g.modded ? ' · ' + cap(g.inst.loader.type) : ''}`;
    return {
      details: showInst ? `Playing ${g.inst.name}` : 'Playing Minecraft',
      state: where,
      startTimestamp: g.start,
      ...(head
        ? { largeImageKey: head, largeImageText: hide ? 'Minecraft' : g.account.name, smallImageKey: 'solaris', smallImageText: version }
        : { largeImageKey: 'solaris', largeImageText: version }),
    };
  }
  const h = [...hosted.values()].pop();
  if (h) {
    return {
      details: showInst ? `Hosting ${h.name}` : 'Hosting a Minecraft server',
      state: showServer && h.address ? `Join at ${h.address}` : `${h.software} ${h.mc}`,
      startTimestamp: h.since,
      partySize: Math.max(1, h.players), partyMax: Math.max(h.players, h.max || 1),
      largeImageKey: 'solaris', largeImageText: `${h.software} ${h.mc} server · Solaris`,
    };
  }
  return {
    details: PAGES[page] || 'In the launcher',
    state: 'Solaris Launcher',
    startTimestamp: launcherSince,
    largeImageKey: 'solaris', largeImageText: 'Solaris Launcher',
  };
}
const cap = (x) => String(x || '').charAt(0).toUpperCase() + String(x || '').slice(1);

// Discord accepts about 5 presence updates per 20 s: collect changes and send at most one every 4 s.
let sendTimer = null, lastSent = 0, lastKey = '';
function update() {
  if (!enabledState) return;
  if (sendTimer) return;
  const wait = Math.max(300, 4000 - (Date.now() - lastSent));
  sendTimer = setTimeout(async () => {
    sendTimer = null;
    if (!enabledState || !(await connect())) return;
    const a = activity();
    const key = JSON.stringify(a);
    if (key === lastKey) return;
    lastSent = Date.now();
    try { await client.setActivity({ ...a, buttons: BUTTONS, instance: false }); lastKey = key; }
    catch (e) { console.warn('[Solaris] Discord presence failed:', e?.message || e); }
  }, wait);
  sendTimer.unref?.();
}

// ---------- public API ----------
/** Turn presence on (Settings or app start). */
function idle() { enabledState = enabled(); lastKey = ''; update(); }
function disconnect() {
  enabledState = false;
  clearTimeout(retryTimer); clearTimeout(sendTimer); sendTimer = null; lastKey = '';
  const c = client; client = null; ready = false;
  if (c) { c.clearActivity().catch(() => {}).finally(() => { try { c.destroy(); } catch {} }); }
}
/** The launcher page the player is on. */
function setPage(name) { if (PAGES[name] && name !== page) { page = name; update(); } }

/** A game started (launch.js). */
function playing({ runId, inst, server, world, start, account, modded }) {
  games.set(runId || inst.id, { inst, start, account, modded, mode: server ? 'multi' : world ? 'single' : 'menu', server: server || null, world: world || null, lanHost: false });
  if (!enabledState) idle(); else update();
}
function gameEnded(runId) { if (games.delete(runId)) update(); }

/** Follows the game log to tell where the player is (menus, a world, a server). */
function fromGameLog(runId, line) {
  const g = games.get(runId); if (!g) return;
  let m;
  const before = `${g.mode}|${g.server}|${g.world}|${g.lanHost}`;
  if ((m = line.match(/Connecting to ([^\s,]+), (\d+)/))) { g.mode = 'multi'; g.server = m[2] === '25565' ? m[1] : `${m[1]}:${m[2]}`; g.world = null; g.lanHost = false; }
  else if (/Starting integrated minecraft server/i.test(line)) { g.mode = 'single'; g.server = null; g.world = null; }
  else if (g.mode === 'single' && !g.world && (m = line.match(/ServerLevel\[(.{1,48}?)\]/))) g.world = m[1];
  else if (/Stopping singleplayer server|Stopping server/i.test(line) && g.mode === 'single') { g.mode = 'menu'; g.world = null; g.lanHost = false; }
  else if (/Started serving on \d+|Local game hosted on domain|Domain assigned:/i.test(line) && g.mode === 'single') g.lanHost = true;
  else if (/Local game no longer publicly hosted/i.test(line)) g.lanHost = false;
  if (before !== `${g.mode}|${g.server}|${g.world}|${g.lanHost}`) update();
}

/** Hosted servers (hostserver.js): running state, players and address. null removes it. */
function setHosted(id, info) {
  if (!info) { if (hosted.delete(id)) update(); return; }
  const prev = hosted.get(id);
  hosted.set(id, { since: prev?.since || Date.now(), ...info });
  if (!prev || JSON.stringify(prev) !== JSON.stringify(hosted.get(id))) { if (!enabledState) idle(); else update(); }
}

/** Back-compat: set an explicit activity. */
function setActivity() { return update(); }

module.exports = { setActivity, idle, playing, gameEnded, fromGameLog, setHosted, setPage, disconnect };
