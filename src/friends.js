// Friends list: Minecraft players you follow, looked up through Mojang's public profile API.
// There is no official "online friends" API for Java Edition, so "online" means Solaris saw the player
// in the live player list of a server it pinged (your servers, favourites and Discover).
const { paths, readJSON, writeJSON, getJSON } = require('./util');
const accounts = require('./accounts');

const file = () => paths.file('friends.json');
const load = () => readJSON(file(), { lists: {} });
const listKey = () => { const a = accounts.active(); return a ? a.id : 'none'; };
const seen = new Map(); // lower-case name -> { server, t }

function list() {
  const d = load();
  const out = (d.lists[listKey()] || []).map((f) => {
    const s = seen.get(f.name.toLowerCase());
    return { ...f, online: s && Date.now() - s.t < 5 * 60000 ? { server: s.server, since: s.t } : null };
  });
  return out.sort((a, b) => (!!b.online - !!a.online) || a.name.localeCompare(b.name));
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
  return withList((l) => { if (!l.some((f) => f.uuid === uuid)) l.push({ uuid, name: prof.name, added: Date.now(), note: '' }); });
}
const remove = (uuid) => withList((l) => { const i = l.findIndex((f) => f.uuid === uuid); if (i >= 0) l.splice(i, 1); });
const setNote = (uuid, note) => withList((l) => { const f = l.find((x) => x.uuid === uuid); if (f) f.note = String(note || '').slice(0, 120); });

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

module.exports = { list, add, remove, setNote, skin, notePlayers };
