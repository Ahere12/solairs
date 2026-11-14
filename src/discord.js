// Discord Rich Presence through Silent Client's discord-rpc (MIT, github.com/Silent-Client/discord-rpc).
// Uses Solaris's built-in Discord application (src/config.js). Reconnects by itself when Discord is started later.
// Loaded on first use: the library (with its websocket and fetch helpers) takes ~45 ms to load at startup.
const Client = function (opts) { const { Client: C } = require('silent-discord-rpc'); return new C(opts); };
const settings = require('./settings');
const { DISCORD_CLIENT_ID } = require('./config');

const RETRY_MS = 20000;
const BUTTONS = [{ label: 'Get Solaris', url: 'https://github.com/Ahere12/solairs/releases/latest' }];

let client = null, ready = false, connecting = null, retryTimer = null, current;

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
  if (!enabled() || current === undefined) return;
  retryTimer = setTimeout(() => { if (!ready) apply(); }, RETRY_MS);
}

async function apply() {
  if (!(await connect())) return;
  try {
    if (current) await client.setActivity({ ...current, buttons: BUTTONS, instance: false });
    else await client.clearActivity();
  } catch (e) { console.warn('[Solaris] Discord presence failed:', e?.message || e); }
}

/** activity: { details, state, startTimestamp, largeImageKey, largeImageText, smallImageKey, smallImageText } or null */
function setActivity(activity) { current = activity || null; return apply(); }

function idle() { return setActivity({ details: 'In the launcher', largeImageKey: 'solaris', largeImageText: 'Solaris Launcher' }); }

/**
 * "Playing" presence. Privacy settings decide whether the instance, the server and the player head are shown.
 * For Microsoft accounts the large image is the player's own head (an https image Discord loads itself).
 */
function playing({ inst, server, start, account, modded }) {
  const s = settings.get();
  const head = s.discordShowHead !== false && account?.type === 'msa' && account.uuid ? `https://mc-heads.net/avatar/${String(account.uuid).replace(/-/g, '')}/128` : null;
  const showInst = s.discordShowInstance !== false;
  return setActivity({
    details: showInst ? `Playing ${inst.name}` : 'Playing Minecraft',
    state: server && s.discordShowServer !== false ? `On ${server}` : `Minecraft ${inst.versionId}${modded ? ' · ' + inst.loader.type : ''}`,
    startTimestamp: start,
    ...(head
      ? { largeImageKey: head, largeImageText: s.streamerMode ? 'Minecraft' : account.name, smallImageKey: 'solaris', smallImageText: 'Solaris Launcher' }
      : { largeImageKey: 'solaris', largeImageText: 'Solaris Launcher' }),
  });
}

function disconnect() {
  current = undefined;
  clearTimeout(retryTimer);
  const c = client; client = null; ready = false;
  if (c) { c.clearActivity().catch(() => {}).finally(() => { try { c.destroy(); } catch {} }); }
}

module.exports = { setActivity, idle, playing, disconnect };
