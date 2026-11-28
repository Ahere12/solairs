// Friends presence: what you're doing right now ("In singleplayer", "Playing on mc.hypixel.net", ...)
// and, when a friends service is configured (config.FRIENDS_API), sharing it with friends plus
// friend requests.
//
// Without a service, Solaris still tracks your own status. Friends then show as "Online on <server>"
// when Solaris saw them in a server's live player list, or "Offline" otherwise.
//
// Service protocol (JSON over HTTPS, all routes under FRIENDS_API):
//   POST /v1/auth/challenge                 -> { serverId }
//   (client calls Mojang's sessionserver /join with that serverId, exactly like joining a server)
//   POST /v1/auth/verify   { name, serverId } -> { token }   (service checks Mojang's /hasJoined)
//   PUT  /v1/presence      { status, server, instance, visible, allowRequests }
//   GET  /v1/friends       -> { friends: [{ uuid, name, status, server, since }], incoming: [{ uuid, name }], outgoing: [{ uuid, name }] }
//   POST /v1/friends/requests            { name }
//   POST /v1/friends/requests/:uuid/accept
//   DELETE /v1/friends/requests/:uuid    (decline incoming or cancel outgoing)
//   DELETE /v1/friends/:uuid
// The Minecraft access token never leaves this computer: identity is proven through Mojang's
// join/hasJoined handshake, the same way a Minecraft server checks who you are.
const config = require('./config');
const settings = require('./settings');
const accounts = require('./accounts');
const { push, request, getJSON } = require('./util');

const base = () => String(process.env.SOLARIS_FRIENDS_API || config.FRIENDS_API || '').replace(/\/+$/, '');
const enabled = () => !!base();

/* ---------- your own status, read from the running game's log ---------- */
const games = new Map(); // runId -> { status, server, instance, start }
let launcherOpen = true;

function current() {
  const s = settings.get();
  if (s.friendsParticipate === false) return { status: 'offline' };
  const runs = [...games.values()].sort((a, b) => b.start - a.start);
  const g = runs.find((r) => r.status !== 'menu') || runs[0];
  if (!g) return { status: launcherOpen ? 'launcher' : 'offline' };
  return { status: g.status === 'menu' ? 'playing' : g.status, server: g.server || null, instance: g.instance };
}
function changed() { push('presence:self', current()); sendPresence().catch(() => {}); }

function gameStarted(runId, { instance, server }) {
  games.set(runId, { status: server ? 'multiplayer' : 'menu', server: server || null, instance, start: Date.now() });
  changed();
}
const RX = {
  single: /Starting integrated minecraft server|Preparing start region for dimension/i,
  connect: /Connecting to ([^\s,]+), ?(\d+)/i,
  leaveSingle: /Stopping server|Stopping singleplayer server/i,
  leaveMulti: /Disconnecting from server|\[CHAT\] .*disconnect|Lost connection|Disconnected from server/i,
};
function gameLine(runId, line) {
  const g = games.get(runId);
  if (!g) return;
  let m;
  if (RX.single.test(line)) { if (g.status === 'singleplayer') return; g.status = 'singleplayer'; g.server = null; }
  else if ((m = line.match(RX.connect))) { const srv = m[2] === '25565' ? m[1] : `${m[1]}:${m[2]}`; if (g.status === 'multiplayer' && g.server === srv) return; g.status = 'multiplayer'; g.server = srv; }
  else if (g.status === 'singleplayer' && RX.leaveSingle.test(line)) { g.status = 'menu'; }
  else if (g.status === 'multiplayer' && RX.leaveMulti.test(line)) { g.status = 'menu'; g.server = null; }
  else return;
  changed();
}
function gameExited(runId) { if (games.delete(runId)) changed(); }

/* ---------- friends service client ---------- */
let session = null; // { uuid, token }

async function call(method, route, body, retry = true) {
  const tok = await login();
  const r = await request(base() + route, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401 && retry) { session = null; return call(method, route, body, false); }
  let data = null; try { data = r.status === 204 ? null : await r.json(); } catch {}
  if (!r.ok) throw new Error(data?.error || `The friends service answered HTTP ${r.status}.`);
  return data;
}
async function login() {
  const a = accounts.active();
  if (!a) throw new Error('Add an account to use friends.');
  if (a.type !== 'msa') throw new Error('Online friends need a Microsoft account.');
  if (session && session.uuid === a.uuid) return session.token;
  const { serverId } = await getJSON(base() + '/v1/auth/challenge', { method: 'POST' });
  const auth = await accounts.getLaunchAuth();
  const r = await request('https://sessionserver.mojang.com/session/minecraft/join', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: auth.accessToken, selectedProfile: String(auth.uuid).replace(/-/g, ''), serverId }),
  });
  if (!r.ok) throw new Error('Mojang couldn’t confirm your account for the friends service.');
  const v = await getJSON(base() + '/v1/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: auth.name, serverId }) });
  session = { uuid: a.uuid, token: v.token };
  return v.token;
}
async function sendPresence() {
  if (!enabled() || accounts.active()?.type !== 'msa') return;
  const s = settings.get();
  const st = current();
  await call('PUT', '/v1/presence', {
    status: st.status, server: s.discordShowServer === false ? null : st.server || null,
    instance: s.discordShowInstance === false ? null : st.instance || null,
    visible: s.friendsParticipate !== false, allowRequests: s.friendsAllowRequests !== false,
  });
}
/** Remote friends + requests, or null when no service is configured / usable for this account. */
async function remote() {
  if (!enabled() || accounts.active()?.type !== 'msa' || settings.get().friendsParticipate === false) return null;
  return call('GET', '/v1/friends');
}
const sendRequest = (name) => call('POST', '/v1/friends/requests', { name });
const accept = (uuid) => call('POST', `/v1/friends/requests/${encodeURIComponent(uuid)}/accept`);
const decline = (uuid) => call('DELETE', `/v1/friends/requests/${encodeURIComponent(uuid)}`);
const unfriend = (uuid) => call('DELETE', `/v1/friends/${encodeURIComponent(uuid)}`);

// heartbeat so friends see you as online; the service should expire presence after ~3 minutes without one
let timer = null;
function start() {
  if (timer) return;
  timer = setInterval(() => sendPresence().catch(() => {}), 60000);
  sendPresence().catch(() => {});
}
async function shutdown() {
  launcherOpen = false; games.clear();
  clearInterval(timer); timer = null;
  try { await Promise.race([sendPresence(), new Promise((r) => setTimeout(r, 1500))]); } catch {}
}
function accountChanged() { session = null; sendPresence().catch(() => {}); }

module.exports = { enabled, current, gameStarted, gameLine, gameExited, remote, sendRequest, accept, decline, unfriend, sendPresence, start, shutdown, accountChanged };
