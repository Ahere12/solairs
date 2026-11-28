// Friends list: Minecraft players you follow, looked up through Mojang's public profile API.
// There is no official "online friends" API for Java Edition, so "online" means Solaris saw the player
// in the live player list of a server it pinged (your servers, favourites and Discover).
const settings = require('./settings');
const { paths, readJSON, writeJSON, getJSON } = require('./util');
const accounts = require('./accounts');
const presence = require('./presence');

const file = () => paths.file('friends.json');
const load = () => readJSON(file(), { lists: {} });
const listKey = () => { const a = accounts.active(); return a ? a.id : 'none'; };
const seen = new Map(); // lower-case name -> { server, t }

const ORDER = { singleplayer: 0, multiplayer: 0, playing: 1, launcher: 2, offline: 3 };
function localList() {
  const d = load();
  return (d.lists[listKey()] || []).map((f) => {
    const s = seen.get(f.name.toLowerCase());
    const on = s && Date.now() - s.t < 5 * 60000;
    return { ...f, status: on ? 'multiplayer' : 'offline', server: on ? s.server : null, since: on ? s.t : null, local: true };
  });
}
/**
 * Everything the friends panel shows. With a friends service: live statuses and requests from it,
 * plus your local notes. Without one: your local list with "seen on server" statuses.
 */
async function list() {
  const local = localList();
  let remote = null, error = null;
  try { remote = await presence.remote(); } catch (e) { error = e.message; }
  let friends = local;
  if (remote) {
    const notes = new Map(local.map((f) => [f.uuid, f]));
    friends = (remote.friends || []).map((f) => ({ ...f, note: notes.get(f.uuid)?.note || '', status: f.status || 'offline' }));
    // players you followed locally who aren't friends on the service yet keep their "seen on server" status
    for (const f of local) if (!friends.some((x) => x.uuid === f.uuid) && !(remote.outgoing || []).some((x) => x.uuid === f.uuid)) friends.push(f);
  }
  friends.sort((a, b) => (ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3) || a.name.localeCompare(b.name));
  const s = settings.get();
  return {
    mode: remote ? 'online' : 'local', error,
    serviceAvailable: presence.enabled(),
    participate: s.friendsParticipate !== false,
    friends, incoming: remote?.incoming || [], outgoing: remote?.outgoing || [],
    self: presence.current(),
  };
}
function withList(fn) { const d = load(); const k = listKey(); d.lists[k] = d.lists[k] || []; fn(d.lists[k]); writeJSON(file(), d); return list(); }

async function add(name) {
  name = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{2,16}$/.test(name)) throw new Error('Enter a Minecraft username (letters, numbers and _).');
  let prof;
  try { prof = await getJSON('https://api.mojang.com/users/profiles/minecraft/' + encodeURIComponent(name)); }
  catch { prof = null; }
  if (!prof?.id) throw new Error(`No Minecraft account is called “${name}”.`);
  const uuid = prof.id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  if (uuid === accounts.active()?.uuid) throw new Error('That’s you!');
  // With a friends service, adding someone sends them a friend request.
  if (await presence.remote().catch(() => null)) { await presence.sendRequest(prof.name); return list(); }
  return withList((l) => { if (!l.some((f) => f.uuid === uuid)) l.push({ uuid, name: prof.name, added: Date.now(), note: '' }); });
}
async function remove(uuid) {
  if (await presence.remote().catch(() => null)) await presence.unfriend(uuid).catch(() => {});
  return withList((l) => { const i = l.findIndex((f) => f.uuid === uuid); if (i >= 0) l.splice(i, 1); });
}
async function respond(uuid, acceptIt) { await (acceptIt ? presence.accept(uuid) : presence.decline(uuid)); return list(); }
// notes are kept locally, also for friends that only exist on the friends service
const setNote = (uuid, note, name) => withList((l) => { let f = l.find((x) => x.uuid === uuid); if (!f && name) l.push((f = { uuid, name, added: Date.now(), note: '' })); if (f) f.note = String(note || '').slice(0, 120); });

/** Skin texture URL for a profile (for heads/previews). */
async function skin(uuid) {
  const p = await getJSON('https://sessionserver.mojang.com/session/minecraft/profile/' + uuid.replace(/-/g, ''));
  const tex = (p.properties || []).find((x) => x.name === 'textures');
  if (!tex) return null;
  const j = JSON.parse(Buffer.from(tex.value, 'base64').toString('utf8'));
  return { name: p.name, url: j.textures?.SKIN?.url?.replace(/^http:/, 'https:') || null, slim: j.textures?.SKIN?.metadata?.model === 'slim' };
}

/** Called with every server ping: remember which friends are in the sampled player list. */
function notePlayers(server, names) { for (const n of names || []) if (typeof n === 'string') seen.set(n.toLowerCase(), { server, t: Date.now() }); }

module.exports = { list, add, remove, respond, setNote, skin, notePlayers };
