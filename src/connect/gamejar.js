// Reads names and pictures from the Minecraft game jar Solaris downloaded for a version (versions/<mc>/<mc>.jar):
// English names (assets/minecraft/lang/en_us.json) and item icons (assets/minecraft/textures/…). Read-only; when the
// jar isn't there, callers fall back to names made from ids and no icons.
const fs = require('fs');
const path = require('path');

const zips = new Map(); // mc -> AdmZip (the last two versions used)
function zip(mc) {
  if (!/^[\w.-]+$/.test(String(mc || ''))) return null;
  if (zips.has(mc)) return zips.get(mc);
  let z = null;
  try {
    const jar = path.join(require('../util').paths.versions(), mc, `${mc}.jar`);
    if (fs.existsSync(jar)) z = new (require('adm-zip'))(jar);
  } catch { z = null; }
  zips.set(mc, z);
  if (zips.size > 2) zips.delete(zips.keys().next().value);
  return z;
}
const text = (mc, entry) => { const z = zip(mc); if (!z) return null; try { const e = z.getEntry(entry); return e ? e.getData().toString('utf8') : null; } catch { return null; } };
const data = (mc, entry) => { const z = zip(mc); if (!z) return null; try { const e = z.getEntry(entry); return e ? e.getData() : null; } catch { return null; } };

const langs = new Map();
function lang(mc) {
  if (!langs.has(mc)) { let l = null; try { l = JSON.parse(text(mc, 'assets/minecraft/lang/en_us.json') || 'null'); } catch {} langs.set(mc, l); }
  return langs.get(mc);
}
const nice = (id) => String(id).replace(/^[\w-]+:/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
/** "minecraft:diamond_sword" → "Diamond Sword" (the game's own name when the jar is there). */
function itemName(mc, id) {
  const l = lang(mc), [ns, p] = String(id).includes(':') ? String(id).split(':') : ['minecraft', String(id)];
  return (l && (l[`item.${ns}.${p}`] || l[`block.${ns}.${p}`])) || nice(id);
}
function enchantmentName(mc, id) { const l = lang(mc), [ns, p] = String(id).includes(':') ? String(id).split(':') : ['minecraft', String(id)]; return (l && l[`enchantment.${ns}.${p}`]) || nice(id); }

// ---------- icons ----------
const icons = new Map(); // `${mc}|${id}` -> data URL | null
const tex = (ref) => { const r = String(ref).replace(/^minecraft:/, ''); return `assets/minecraft/textures/${r}.png`; };
function modelTextures(mc, model, depth = 0) {
  if (!model || depth > 6) return null;
  const j = (() => { try { return JSON.parse(text(mc, `assets/minecraft/models/${String(model).replace(/^minecraft:/, '')}.json`) || 'null'); } catch { return null; } })();
  if (!j) return null;
  const t = j.textures || {};
  const pick = t.layer0 || t.all || t.side || t.top || t.front || t.texture || t.particle || t.end || t.cross;
  if (pick && !String(pick).startsWith('#')) return pick;
  return j.parent ? modelTextures(mc, j.parent, depth + 1) : null;
}
/** A small PNG (data URL) for an item: its item texture, or the texture its model uses. Null when not found. */
function icon(mc, id) {
  const k = `${mc}|${id}`;
  if (icons.has(k)) return icons.get(k);
  let out = null;
  if (/^minecraft:[a-z0-9_]+$/.test(id) && zip(mc)) {
    const p = id.slice(10);
    const tries = [tex(`item/${p}`)];
    const m = modelTextures(mc, `item/${p}`) || modelTextures(mc, `block/${p}`);
    if (m) tries.push(tex(m));
    tries.push(tex(`block/${p}`));
    for (const t of tries) { const b = data(mc, t); if (b) { out = 'data:image/png;base64,' + b.toString('base64'); break; } }
  }
  icons.set(k, out);
  return out;
}

module.exports = { lang, itemName, enchantmentName, icon, nice, text, available: (mc) => !!zip(mc) };
