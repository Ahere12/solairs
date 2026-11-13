// Skin wardrobe and Microsoft profile skin/cape changes.
const fs = require('fs');
const path = require('path');
const { paths, readJSON, writeJSON, getJSON, request } = require('./util');
const accounts = require('./accounts');
const settings = require('./settings');

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
  prof = await require('./util').profileByName(username);
  if (!prof) throw new Error(`No Minecraft player named "${username}"`);
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
  if (a.type !== 'msa') {
    // Offline: the "current" skin is the one picked in the wardrobe (shown in game through CustomSkinLoader).
    const o = offlineSkinFor(a.id);
    return o ? { variant: o.variant === 'slim' ? 'slim' : 'classic', skin: toData(o.file), cape: null, url: null, offline: true } : { variant: 'classic', skin: null, cape: null, url: null };
  }
  try {
    // Microsoft accounts: read the live profile (the session server caches skins for about a minute,
    // which made a successful change look like it hadn't worked).
    let t = null;
    if (a.type === 'msa') {
      try {
        const auth = await accounts.getLaunchAuth();
        const p = await getJSON('https://api.minecraftservices.com/minecraft/profile', { headers: { Authorization: 'Bearer ' + auth.accessToken } });
        const sk = (p.skins || []).find((x) => x.state === 'ACTIVE');
        const cp = (p.capes || []).find((x) => x.state === 'ACTIVE');
        t = { skin: sk?.url || null, slim: sk?.variant === 'SLIM', cape: cp?.url || null };
      } catch {}
    }
    if (!t) t = await texturesFor(a.uuid);
    const out = { variant: t.slim ? 'slim' : 'classic', skin: null, cape: null, url: t.skin || null };
    if (t.skin) { const r = await request(t.skin.replace('http://', 'https://')); out.skin = 'data:image/png;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64'); }
    if (t.cape) { const r = await request(t.cape.replace('http://', 'https://')); out.cape = 'data:image/png;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64'); }
    return out;
  } catch { return { variant: 'classic', skin: null, cape: null }; }
}

/**
 * Wear a wardrobe skin.
 * Microsoft accounts: upload to Mojang, then check Mojang's profile really shows the new skin (so "applied" is true).
 * Offline accounts: Mojang can't hold a skin for them — remember it, and launches hand it to the game through
 * CustomSkinLoader's local skin folder (see offlineSkinFor / launch.js).
 */
async function apply(id) {
  const s = load().find((x) => x.id === id);
  if (!s) throw new Error('Skin not found');
  const auth = await accounts.getLaunchAuth();
  if (auth.type !== 'msa') {
    const a = accounts.active();
    const map = { ...(settings.get().offlineSkins || {}), [a.id]: id };
    settings.set({ offlineSkins: map });
    return { offline: true, name: s.name };
  }
  const headers = { Authorization: 'Bearer ' + auth.accessToken };
  const before = await getJSON('https://api.minecraftservices.com/minecraft/profile', { headers }).catch(() => null);
  const beforeUrl = (before?.skins || []).find((x) => x.state === 'ACTIVE')?.url || null;
  const fd = new FormData();
  fd.append('variant', s.variant);
  fd.append('file', new Blob([fs.readFileSync(path.join(paths.skins(), s.file))], { type: 'image/png' }), 'skin.png');
  const r = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', { method: 'POST', headers, body: fd });
  if (r.status === 401) throw new Error('Your Microsoft sign-in expired. Sign in again from the account menu, then apply the skin.');
  if (r.status === 429) throw new Error('Too many skin changes — Mojang allows a few per minute. Wait a minute and try again.');
  if (!r.ok) throw new Error(`Mojang didn’t accept the skin (HTTP ${r.status}). Try again in a moment.`);
  let prof = null; try { prof = await r.json(); } catch {}
  for (let i = 0; i < 4; i++) {
    const nowUrl = (prof?.skins || []).find((x) => x.state === 'ACTIVE')?.url || null;
    if (nowUrl && nowUrl !== beforeUrl) { remember(id, nowUrl); return { ok: true, name: s.name, url: nowUrl }; }
    await new Promise((res) => setTimeout(res, 1200));
    prof = await getJSON('https://api.minecraftservices.com/minecraft/profile', { headers }).catch(() => null);
  }
  // Same texture as before (re-applying the skin you already wear) also counts as applied.
  if (beforeUrl && (prof?.skins || []).some((x) => x.state === 'ACTIVE' && x.url === beforeUrl)) { remember(id, beforeUrl); return { ok: true, name: s.name, url: beforeUrl, same: true }; }
  throw new Error('Mojang didn’t confirm the new skin yet. Press Refresh skin in a minute to check.');
}

/** Remembers which wardrobe skin a Microsoft account wears (matched by Mojang texture URL). */
function remember(id, url) {
  const a = accounts.active(); if (!a) return;
  settings.set({ wornSkins: { ...(settings.get().wornSkins || {}), [a.id]: { id, url } } });
}
/** Wardrobe skin id the active account is wearing right now, or null. */
function wearingId(currentUrl) {
  const a = accounts.active(); if (!a) return null;
  if (a.type !== 'msa') return (settings.get().offlineSkins || {})[a.id] || null;
  const w = (settings.get().wornSkins || {})[a.id];
  const norm = (u) => String(u || '').replace(/^http:/, 'https:');
  return w && currentUrl && norm(w.url) === norm(currentUrl) ? w.id : null;
}

/** The wardrobe skin chosen for an offline account (absolute PNG path + name), or null. */
function offlineSkinFor(accountId) {
  const id = (settings.get().offlineSkins || {})[accountId];
  const s = id && load().find((x) => x.id === id);
  const f = s && path.join(paths.skins(), s.file);
  return f && fs.existsSync(f) ? { file: f, variant: s.variant, name: s.name } : null;
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

module.exports = { wearingId, offlineSkinFor, list, addFile, addFromUsername, remove, rename, current, apply, capes, setCape };
