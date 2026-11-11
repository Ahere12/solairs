// Skin wardrobe and Microsoft profile skin/cape changes.
const fs = require('fs');
const path = require('path');
const { paths, readJSON, writeJSON, getJSON, request } = require('./util');
const accounts = require('./accounts');

const indexFile = () => path.join(paths.skins(), 'wardrobe.json');
const load = () => readJSON(indexFile(), []);
const store = (d) => writeJSON(indexFile(), d);
const toData = (file) => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');

function list() {
  return load().map((s) => ({ ...s, data: fs.existsSync(path.join(paths.skins(), s.file)) ? toData(path.join(paths.skins(), s.file)) : null }));
}
function isValidSkin(buf) {
  if (buf.slice(1, 4).toString() !== 'PNG') return false;
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  return w === 64 && (h === 64 || h === 32);
}
function addBuffer(buf, name, variant = 'classic') {
  if (!isValidSkin(buf)) throw new Error('Skins must be 64×64 or 64×32 PNG images');
  fs.mkdirSync(paths.skins(), { recursive: true });
  const id = 'skin-' + Date.now().toString(36);
  fs.writeFileSync(path.join(paths.skins(), id + '.png'), buf);
  const d = load(); d.unshift({ id, name, variant, file: id + '.png', added: Date.now() }); store(d);
  return list();
}
function addFile(file, variant) { return addBuffer(fs.readFileSync(file), path.basename(file, '.png'), variant); }
async function texturesFor(uuid) {
  const prof = await getJSON(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid.replace(/-/g, '')}`);
  const tex = JSON.parse(Buffer.from(prof.properties.find((p) => p.name === 'textures').value, 'base64').toString());
  return { name: prof.name, skin: tex.textures.SKIN?.url, slim: tex.textures.SKIN?.metadata?.model === 'slim', cape: tex.textures.CAPE?.url };
}
async function addFromUsername(username) {
  let prof;
  try { prof = await getJSON(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`); }
  catch { throw new Error(`No Minecraft player named "${username}"`); }
  const t = await texturesFor(prof.id);
  if (!t.skin) throw new Error('That player uses the default skin');
  const r = await request(t.skin.replace('http://', 'https://'));
  return addBuffer(Buffer.from(await r.arrayBuffer()), t.name, t.slim ? 'slim' : 'classic');
}
function remove(id) {
  const d = load(); const s = d.find((x) => x.id === id);
  if (s) { try { fs.unlinkSync(path.join(paths.skins(), s.file)); } catch {} }
  store(d.filter((x) => x.id !== id));
  return list();
}
function rename(id, patch) { const d = load(); const s = d.find((x) => x.id === id); if (s) Object.assign(s, patch); store(d); return list(); }

/** Current skin texture for the active account (data URL), cape URL and variant. */
async function current() {
  const a = accounts.active();
  if (!a) return null;
  try {
    const t = await texturesFor(a.uuid);
    const out = { variant: t.slim ? 'slim' : 'classic', skin: null, cape: null };
    if (t.skin) { const r = await request(t.skin.replace('http://', 'https://')); out.skin = 'data:image/png;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64'); }
    if (t.cape) { const r = await request(t.cape.replace('http://', 'https://')); out.cape = 'data:image/png;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64'); }
    return out;
  } catch { return { variant: 'classic', skin: null, cape: null }; }
}

async function apply(id) {
  const s = load().find((x) => x.id === id);
  if (!s) throw new Error('Skin not found');
  const auth = await accounts.getLaunchAuth();
  if (auth.type !== 'msa') throw new Error('Skins can only be uploaded for Microsoft accounts. Offline accounts use the default skin in-game.');
  const fd = new FormData();
  fd.append('variant', s.variant);
  fd.append('file', new Blob([fs.readFileSync(path.join(paths.skins(), s.file))], { type: 'image/png' }), 'skin.png');
  const r = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', { method: 'POST', headers: { Authorization: 'Bearer ' + auth.accessToken }, body: fd });
  if (!r.ok) throw new Error(`Skin upload failed (HTTP ${r.status})${r.status === 429 ? ' — too many changes, wait a minute.' : ''}`);
  return true;
}
async function capes() {
  const prof = await accounts.mcProfile();
  return prof ? prof.capes || [] : [];
}
async function setCape(capeId) {
  const auth = await accounts.getLaunchAuth();
  if (auth.type !== 'msa') throw new Error('Capes need a Microsoft account');
  const url = 'https://api.minecraftservices.com/minecraft/profile/capes/active';
  const r = capeId
    ? await fetch(url, { method: 'PUT', headers: { Authorization: 'Bearer ' + auth.accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ capeId }) })
    : await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer ' + auth.accessToken } });
  if (!r.ok) throw new Error(`Cape change failed (HTTP ${r.status})`);
  return true;
}

module.exports = { list, addFile, addFromUsername, remove, rename, current, apply, capes, setCape };
