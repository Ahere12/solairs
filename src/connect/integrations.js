// Astra Connect — the integrations Astra has. Each one wraps a feature that already exists in Astra and
// reports its real state; nothing here pretends to be connected. Things that aren't built yet are listed as
// "planned", and things that would need an online Astra service (which doesn't exist) as "unavailable".
// How to add one: docs/connect.md.

const DOCS = 'https://github.com/Ahere12/solairs/blob/main/docs/connect.md';
const lazy = (m) => () => require(m); // load Astra modules only when a status is asked for
const settings = lazy('../settings');
const discord = lazy('../discord');
const hosting = lazy('../hostserver');
const playit = lazy('../playit');
const friends = lazy('../friends');
const servers = lazy('../servers');
const instances = lazy('../instances');
const accounts = lazy('../accounts');

const n = (count, one, many = one + 's') => `${count} ${count === 1 ? one : many}`;
const hosted = () => hosting().list().filter((s) => !s.missing);
const running = () => hosted().filter((s) => s.state !== 'offline');
// software kinds, from Hosting (one place decides which server can run what)
const MOD_SERVERS = ['fabric', 'quilt', 'forge', 'neoforge'];
const PLUGIN_SERVERS = ['paper', 'purpur'];
/** A setting from settings.json used as a Connect setting (one source of truth, also shown in Settings). */
const setting = (key) => ({ get: () => settings().get()[key], set: (v) => { settings().set({ [key]: v }); } });

/** BlueMap, Pl3xMap and Dynmap: the same integration, each with its own map type from ./maps (one map per server). */
function webMap(pid, description) {
  const wmap = () => require('./webmap'), P = require('./maps/' + pid);
  const mine = () => hosted().filter((s) => { const w = wmap().wmOf(s); return w?.on && w.provider === pid; });
  const myLinks = () => require('../util').readJSON(require('../util').paths.file('maps.json'), []).filter((l) => (l.provider || 'bluemap') === pid);
  return {
    id: pid, name: P.name, icon: 'roadmap', category: 'maps', type: ['plugin', 'mod', 'dashboard'], core: true, description, docs: P.docs, page: 'maps',
    compat: { software: P.software, why: (s) => `${P.name} doesn’t run on ${s.softwareName || s.software} servers` },
    async status() {
      const on = mine(), saved = myLinks();
      if (!on.length && !saved.length) return { state: 'ready', text: 'Not on any server — turn it on in a server’s Map tab, or add a map link' };
      const live = await Promise.all(on.filter((s) => s.state === 'online').map((s) => wmap().info(s.id).then((i) => ({ s, i }))));
      const up = live.filter((x) => x.i.online);
      const bad = live.filter((x) => !x.i.online && x.i.error && !/yet/.test(x.i.error));
      if (bad.length) return { state: 'error', text: `${bad[0].s.name}: ${bad[0].i.error}` };
      const players = up.reduce((t, x) => t + x.i.maps.reduce((a, mp) => a + mp.players.length, 0), 0);
      const parts = [on.length ? `On ${n(on.length, 'server')}` : '', saved.length ? n(saved.length, 'map link') : '', up.length ? `${up.length} map${up.length === 1 ? '' : 's'} live · ${n(players, 'player')} on the map` : ''].filter(Boolean);
      return { state: up.length ? 'connected' : 'ready', text: parts.join(' · ') };
    },
    async details() {
      const rows = [];
      for (const s of mine()) {
        const i = await wmap().info(s.id);
        rows.push([s.name, i.url || '—', s.state !== 'online' ? 'Server is off' : i.online ? 'Live' : i.error || 'Starting', i.maps.map((mp) => mp.name).join(', ') || '—', String(i.maps.reduce((a, mp) => a + mp.players.length, 0))]);
      }
      return { columns: ['Server', 'Map address', 'Map', 'Worlds', 'Players on map'], rows, note: rows.length ? 'Open the Maps page to see them inside Astra.' : '' };
    },
  };
}

const INTEGRATIONS = [
  // ---------------- Social ----------------
  {
    id: 'discord-rpc', name: 'Discord Rich Presence', icon: 'discord', category: 'social', type: 'local',
    description: 'Shows on your Discord profile what you play — the instance, the server or world, and servers you host with their player count.',
    docs: `${DOCS}#discord-rich-presence`, page: 'settings',
    toggle: setting('discordRpc'),
    onToggle: (on) => (on ? discord().idle() : discord().disconnect()),
    config: [
      { key: 'showInstance', label: 'Show the instance name', type: 'bool', from: setting('discordShowInstance') },
      { key: 'showServer', label: 'Show the server or world', type: 'bool', from: setting('discordShowServer') },
      { key: 'showHead', label: 'Show your Minecraft head', type: 'bool', from: setting('discordShowHead') },
    ],
    onConfig: () => discord().setActivity(),
    status() {
      const s = discord().status();
      if (!s.hasApp) return { state: 'unavailable', text: 'This build of Astra has no Discord application' };
      if (s.connected) return { state: 'connected', text: 'Connected to Discord' };
      return { state: 'needs-setup', text: 'Discord isn’t running — Astra connects by itself when it starts' };
    },
  },
  {
    id: 'friends', name: 'Friends', icon: 'users', category: 'social', type: 'api', core: true,
    description: 'Players you follow, with their skins from Mojang. They show as online when Astra sees them on a server (yours, a favourite or one you checked) — Java Edition has no official online-friends service.',
    docs: `${DOCS}#friends`, page: 'friends',
    status() {
      const list = friends().list();
      if (!list.length) return { state: 'needs-setup', text: 'No friends added yet' };
      const on = list.filter((f) => f.online).length;
      return { state: on ? 'connected' : 'ready', text: `${n(list.length, 'friend')} · ${on} online now` };
    },
  },
  {
    id: 'invites', name: 'Invite links & join codes', icon: 'link', category: 'social', type: 'local', core: true,
    description: 'astra:// links and JOIN- codes: send one to a friend and Astra opens the right server (and warns about account types). They travel through any chat — Astra has no inbox of its own.',
    docs: `${DOCS}#invite-links`, page: 'host',
    status() {
      const pub = running().filter((s) => s.address);
      return pub.length ? { state: 'connected', text: `${n(pub.length, 'server')} you host can be shared right now` } : { state: 'ready', text: 'Ready — start a public server to share it' };
    },
  },
  {
    id: 'presence-cloud', name: 'Astra online status & inbox', icon: 'globe', category: 'social', type: 'api',
    description: 'Seeing which Astra friends are online anywhere, sending invites to their Astra and sharing screenshots inside Astra.',
    unavailable: 'Needs an online Astra service, which doesn’t exist. Use invite links, join codes and Discord instead.',
  },

  // ---------------- Server integrations ----------------
  {
    id: 'server-status', name: 'Server status', icon: 'servers', category: 'servers', type: 'api', core: true,
    description: 'Live status, player counts, version and ping for any Java server, using Minecraft’s own Server List Ping — the same way the game’s server list works.',
    docs: `${DOCS}#server-status`, page: 'servers',
    status() {
      const l = servers().list().servers || [];
      return l.length ? { state: 'ready', text: `${n(l.length, 'saved server')} · ${l.filter((s) => s.favorite).length} favourite` } : { state: 'needs-setup', text: 'No saved servers yet' };
    },
  },
  {
    id: 'server-watch', name: 'Server monitoring', icon: 'servers', category: 'servers', type: 'api',
    description: 'Checks the servers you saved every few minutes (with Server List Ping) and tells you when one comes online, goes offline, or a friend joins it.',
    docs: `${DOCS}#server-monitoring`, page: 'servers',
    config: [
      { key: 'watch', label: 'Servers to watch', type: 'select', default: 'favorites', options: [{ value: 'favorites', label: 'Favourites' }, { value: 'all', label: 'All saved servers' }] },
      { key: 'intervalMin', label: 'Check every (minutes)', type: 'number', default: 5, min: 1, max: 60 },
      { key: 'notifyOnline', label: 'Tell me when a server comes online', type: 'bool', default: true },
      { key: 'notifyOffline', label: 'Tell me when a server goes offline', type: 'bool', default: true },
      { key: 'notifyFriends', label: 'Tell me when a friend joins one', type: 'bool', default: true, help: 'Servers only show some player names (often up to 12), so a friend on a big server may be missed.' },
    ],
    onToggle: () => require('./index').restartWatch(),
    onConfig: () => require('./index').restartWatch(),
    status({ config }) {
      const saved = servers().list().servers || [];
      const watched = config.watch === 'all' ? saved : saved.filter((s) => s.favorite);
      if (!watched.length) return { state: 'needs-setup', text: config.watch === 'all' ? 'No saved servers — add some on the Servers page' : 'No favourite servers — star some on the Servers page' };
      const v = require('./runtime').watcher.view();
      if (!v.lastRun) return { state: 'ready', text: `Watching ${n(watched.length, 'server')} — first check in a moment` };
      const on = v.servers.filter((s) => s.online).length;
      return { state: on ? 'connected' : 'ready', text: `Watching ${n(watched.length, 'server')} · ${on} online` };
    },
    details({ config }) {
      const v = require('./runtime').watcher.view();
      const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
      return {
        columns: ['Server', 'Status', 'Players', 'Ping', 'For'],
        rows: v.servers.map((s) => [s.name, s.online ? 'Online' : `Offline (${s.error})`, s.online ? `${s.players}/${s.max}` : '—', s.latency != null ? `${s.latency} ms` : '—', ago(s.since)]),
        note: v.lastRun ? `Last checked ${ago(v.lastRun) === 'just now' ? 'just now' : `${ago(v.lastRun)} ago`}. Checks again every ${config.intervalMin || 5} min.` :'The first check runs a few seconds after it’s turned on.',
      };
    },
  },
  {
    id: 'server-alerts', name: 'Desktop alerts for your servers', icon: 'alert', category: 'servers', type: 'local', defaultEnabled: true,
    description: 'A desktop notification when a server you host goes online, stops, crashes, or someone joins — while Astra is in the background or the tray.',
    docs: `${DOCS}#desktop-alerts`, page: 'host',
    config: [
      { key: 'online', label: 'Server is online', type: 'bool', default: true },
      { key: 'crash', label: 'Server crashed', type: 'bool', default: true },
      { key: 'stop', label: 'Server stopped', type: 'bool', default: false },
      { key: 'join', label: 'A player joined', type: 'bool', default: false },
      { key: 'leave', label: 'A player left', type: 'bool', default: false },
    ],
    status({ config }) {
      if (!settings().get().notifications) return { state: 'needs-setup', text: 'Notifications are off in Settings — turn them on to get alerts' };
      const on = ['online', 'crash', 'stop', 'join', 'leave'].filter((k) => config[k]);
      if (!on.length) return { state: 'needs-setup', text: 'No alerts picked' };
      const c = hosted().length;
      return c ? { state: running().length ? 'connected' : 'ready', text: `For ${n(c, 'server')}: ${on.join(', ')}` } : { state: 'ready', text: 'Ready — no hosted servers yet' };
    },
  },
  {
    id: 'hosting', name: 'Hosting', icon: 'host', category: 'servers', type: 'local', core: true,
    description: 'Servers that run on this PC: console, players, backups, scheduler, performance graph, crash help and alerts.',
    docs: `${DOCS}#hosting`, page: 'host',
    status() {
      const all = hosted(), on = running();
      if (!all.length) return { state: 'needs-setup', text: 'No servers yet' };
      return { state: on.length ? 'connected' : 'ready', text: `${n(all.length, 'server')} · ${on.length} running` };
    },
  },
  {
    id: 'playit', name: 'playit.gg', icon: 'globe', category: 'servers', type: 'api', core: true,
    description: 'Free tunnels that give your hosted servers a public address — Java, voice chat and Bedrock — without opening ports on your router.',
    docs: 'https://playit.gg/support', page: 'host',
    status() {
      const s = playit().status();
      if (s.problem) return { state: 'error', text: s.problem };
      if (!s.linked) return { state: 'needs-setup', text: s.claim?.state === 'waiting' ? 'Waiting for you to approve Astra on playit.gg' : 'Not connected — connect it on the Hosting page' };
      const a = s.agent?.state;
      return { state: a === 'connected' ? 'connected' : 'ready', text: a === 'connected' ? 'Connected — tunnels are live' : 'Connected — the agent starts with a server that uses it' };
    },
  },
  {
    id: 'e4mc', name: 'e4mc', icon: 'globe', category: 'servers', type: 'mod', core: true,
    description: 'An instant public address through the free e4mc relay, with no account. Astra installs the mod on the server.',
    docs: 'https://modrinth.com/mod/e4mc', page: 'host',
    compat: { software: MOD_SERVERS, why: () => 'e4mc is a mod — only Fabric, Quilt, Forge and NeoForge servers' },
    status() {
      const l = hosted().filter((s) => s.tunnel === 'e4mc');
      return l.length ? { state: l.some((s) => s.address) ? 'connected' : 'ready', text: `Used by ${n(l.length, 'server')}` } : { state: 'ready', text: 'Not used by any server' };
    },
  },
  {
    id: 'simple-voice-chat', name: 'Simple Voice Chat', icon: 'mic', category: 'servers', type: ['mod', 'plugin'], core: true,
    description: 'Proximity voice chat. Astra installs it on the server, makes the UDP tunnel on playit.gg and sets voice_host — players need the mod in their game too.',
    docs: 'https://modrepo.de/minecraft/voicechat/wiki', page: 'host',
    compat: { software: [...PLUGIN_SERVERS, ...MOD_SERVERS], why: (s) => `${s.softwareName || s.software} servers can’t run mods or plugins` },
    status() {
      const l = hosted().filter((s) => s.voice?.on);
      if (!l.length) return { state: 'ready', text: 'Not on any server — turn it on in a server’s Settings' };
      const bad = l.filter((s) => s.tunnel === 'playit' && s.voice.error && !s.voice.manualAddress);
      if (bad.length) return { state: 'error', text: `${bad.map((s) => s.name).join(', ')}: ${bad[0].voice.error}` };
      return { state: running().some((s) => s.voice?.on) ? 'connected' : 'ready', text: `On ${n(l.length, 'server')}` };
    },
  },
  {
    id: 'geyser', name: 'Bedrock players (Geyser)', icon: 'globe', category: 'servers', type: ['plugin', 'mod'], core: true,
    description: 'Lets phone, console and Windows (Bedrock Edition) players join a Java server, through Geyser + Floodgate. Astra sets it up and makes the tunnel.',
    docs: 'https://geysermc.org/wiki/geyser/', page: 'host',
    compat: { software: ['paper', 'purpur', 'fabric', 'quilt', 'neoforge'], why: (s) => `Geyser doesn’t run on ${s.softwareName || s.software} servers` },
    status() {
      const l = hosted().filter((s) => s.bedrock?.on);
      if (!l.length) return { state: 'ready', text: 'Not on any server' };
      const bad = l.filter((s) => s.bedrock.error);
      if (bad.length) return { state: 'error', text: `${bad[0].name}: ${bad[0].bedrock.error}` };
      return { state: running().some((s) => s.bedrock?.on) ? 'connected' : 'ready', text: `On ${n(l.length, 'server')}` };
    },
  },
  {
    id: 'bedrock-server', name: 'Bedrock Dedicated Server', icon: 'globe', category: 'servers', type: 'local', core: true,
    description: 'Mojang’s own Bedrock server, hosted on this PC — for friends on phones, consoles and Windows. Windows and Linux only.',
    docs: 'https://www.minecraft.net/en-us/download/server/bedrock', page: 'host',
    status() {
      if (!['win32', 'linux'].includes(process.platform)) return { state: 'unavailable', text: 'Mojang’s Bedrock server only runs on Windows and Linux' };
      const l = hosted().filter((s) => s.software === 'bedrock');
      return l.length ? { state: running().some((s) => s.software === 'bedrock') ? 'connected' : 'ready', text: n(l.length, 'Bedrock server') } : { state: 'ready', text: 'No Bedrock servers yet' };
    },
  },
  {
    id: 'discord-alerts', name: 'Discord server alerts', icon: 'discord', category: 'servers', type: 'api', core: true,
    description: 'Posts to a Discord channel (through a webhook) when a hosted server goes online, stops, crashes, or someone joins. The webhook link stays private on this PC.',
    docs: 'https://support.discord.com/hc/en-us/articles/228383668', page: 'host',
    status() {
      const l = hosted().filter((s) => s.discord?.url);
      return l.length ? { state: 'ready', text: `Set up for ${n(l.length, 'server')}` } : { state: 'needs-setup', text: 'Not set up — add a webhook in a server’s Settings' };
    },
  },
  {
    id: 'spark', name: 'spark lag check', icon: 'chart', category: 'servers', type: ['mod', 'plugin'], core: true,
    description: 'Measures TPS and tick time on a hosted server and makes a report that shows what causes lag. Astra installs spark when you press Lag check.',
    docs: 'https://spark.lucko.me/docs', page: 'host',
    compat: { software: [...PLUGIN_SERVERS, ...MOD_SERVERS], why: (s) => `spark can’t run on ${s.softwareName || s.software} servers` },
    status() {
      const ok = hosted().filter((s) => [...PLUGIN_SERVERS, ...MOD_SERVERS].includes(s.software));
      return ok.length ? { state: 'ready', text: `Available on ${n(ok.length, 'server')} (Lag check on the server page)` } : { state: 'ready', text: 'No server that can run it yet' };
    },
  },

  // ---------------- Player utilities ----------------
  {
    id: 'skins', name: 'Skins & capes', icon: 'skins', category: 'player', type: 'api', core: true,
    description: '3D skin viewer and wardrobe; changes your skin and cape on your Microsoft account through Minecraft’s services.',
    docs: `${DOCS}#skins`, page: 'skins',
    status() {
      const a = accounts().active();
      if (!a) return { state: 'needs-setup', text: 'Add an account first' };
      return a.type === 'msa' ? { state: 'connected', text: `Signed in as ${a.name}` } : { state: 'ready', text: `${a.name} is an offline account — skins show in Astra and in modded games only` };
    },
  },
  {
    id: 'player-stats', name: 'Player statistics & advancements', icon: 'chart', category: 'player', type: 'local', core: true,
    description: 'Play time, deaths, distance, mined blocks, mobs and advancements of every player — read from the save files of your singleplayer worlds and hosted servers (Java worlds).',
    docs: `${DOCS}#player-statistics`, page: 'stats',
    status() {
      const ws = require('./saves').worlds(), withStats = ws.filter((w) => w.players);
      if (!ws.length) return { state: 'needs-setup', text: 'No worlds yet — play a world or start a hosted server' };
      if (!withStats.length) return { state: 'ready', text: `${n(ws.length, 'world')} — no stats saved yet (the game saves them while you play)` };
      return { state: 'ready', text: `${n(withStats.length, 'world')} with stats · ${n(withStats.reduce((a, w) => a + w.players, 0), 'player')}` };
    },
    details() {
      const ws = require('./saves').worlds().filter((w) => w.players);
      return { columns: ['World', 'From', 'Version', 'Players'], rows: ws.map((w) => [w.name, `${w.kind === 'server' ? 'Server' : 'Instance'}: ${w.owner}`, w.mc, String(w.players)]), note: 'Open the Stats page for each player’s numbers and advancements.' };
    },
  },
  {
    id: 'inventory-viewer', name: 'Inventory viewer', icon: 'box', category: 'player', type: 'local', core: true,
    description: 'A player’s inventory, armour, off hand and ender chest — with shulker box and bundle contents — from the save files of servers you host and your singleplayer worlds. Read-only.',
    docs: `${DOCS}#inventory-viewer`, page: 'stats',
    status() {
      const ws = require('./saves').worlds();
      const fs = require('fs'), path = require('path');
      const players = ws.reduce((a, w) => { try { return a + fs.readdirSync(path.join(w.dir, 'playerdata')).filter((f) => /\.dat$/.test(f)).length; } catch { return a; } }, 0);
      if (!ws.length) return { state: 'needs-setup', text: 'No worlds yet' };
      return { state: 'ready', text: players ? `${n(players, 'saved player')} in ${n(ws.filter((w) => w.kind === 'server').length, 'server world')} — open a player on the Stats page` : 'No player saves yet — they’re written while people play' };
    },
  },
  {
    id: 'screenshots', name: 'Screenshot gallery', icon: 'gallery', category: 'player', type: 'local', core: true,
    description: 'Every screenshot from every instance in one place.',
    docs: `${DOCS}#screenshots`, page: 'gallery',
    status() { const c = instances().screenshots().length; return { state: c ? 'ready' : 'needs-setup', text: c ? n(c, 'screenshot') : 'No screenshots yet — press F2 in the game' }; },
  },
  {
    id: 'playtime', name: 'Play time', icon: 'clock', category: 'player', type: 'local', core: true,
    description: 'How long you played each instance (and how long players spent on your hosted servers).',
    docs: `${DOCS}#play-time`, page: 'library',
    status() {
      const ms = instances().list().reduce((t, i) => t + (i.playTime || 0), 0), h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
      return { state: ms ? 'ready' : 'needs-setup', text: ms ? `${h} h ${m} min played in Astra` : 'Nothing played yet' };
    },
  },
  {
    id: 'worlds', name: 'World management', icon: 'world', category: 'player', type: 'local', core: true,
    description: 'Singleplayer worlds of each instance, and hosted servers’ worlds: switch, import, reset and back up.',
    docs: `${DOCS}#worlds`, page: 'library',
    status() { const c = instances().list().length; return { state: 'ready', text: `${n(c, 'instance')} · ${n(hosted().length, 'hosted server')}` }; },
  },

  // ---------------- Maps & navigation ----------------
  webMap('bluemap', '3D web map of a hosted server’s world, opened inside Astra with live player positions. Also opens the BlueMap maps of servers you play on.'),
  webMap('pl3xmap', 'Fast 2D web map of a hosted server’s world (like a satellite view), inside Astra with live player positions. Also opens Pl3xMap maps of servers you play on.'),
  webMap('dynmap', 'The classic web map — flat and 3D views, inside Astra with live player positions. Also opens Dynmap maps of servers you play on.'),

  // ---------------- Not built yet (step by step, see docs/connect.md) ----------------
  {
    id: 'waypoints', name: 'Waypoints & coordinates', icon: 'roadmap', category: 'maps', type: 'local', core: true,
    description: 'Save places — or take them from save files: where a player is, their last death, their bed, the world spawn — and share them as a code or plain text. On a server you host, teleport a player there or post it in chat.',
    docs: `${DOCS}#waypoints`, page: 'waypoints',
    status() {
      const l = require('./waypoints').list();
      if (!l.length) return { state: 'ready', text: 'No waypoints yet — add one, or paste a code a friend sent' };
      const places = new Set(l.map((w) => w.place || '')).size;
      return { state: 'ready', text: `${n(l.length, 'waypoint')} in ${n(places, 'place')}` };
    },
  },

];

module.exports = { INTEGRATIONS };
