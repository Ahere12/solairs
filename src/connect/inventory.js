// Astra Connect — inventory viewer. Shows a player's inventory, armour, off hand and ender chest from the save files
// of worlds on this PC: hosted servers (world/playerdata/<uuid>.dat) and your singleplayer worlds (level.dat → Player).
// Only for worlds whose files are on this PC — that is the "server-side permission": you can only look into worlds
// you host or own. Read-only; nothing is changed. Bedrock worlds use another format and aren't read.
//
// Formats handled (Java):
//   · items 1.20.5+: { Slot, id, count, components: { "minecraft:custom_name", "minecraft:enchantments", "minecraft:damage",
//     "minecraft:max_damage", "minecraft:container": [{slot, item}], "minecraft:bundle_contents": [item] } }
//   · items before:  { Slot, id, Count, tag: { display: { Name }, Enchantments: [{id, lvl}], Damage, BlockEntityTag: { Items } } }
//   · armour/off hand 1.21.5+: "equipment": { head, chest, legs, feet, offhand }; before: Inventory slots 103–100 and -106
const fs = require('fs');
const path = require('path');
const nbt = require('./nbt');
const jar = require('./gamejar');
const saves = require('./saves');

/** Text from a custom name: a JSON string (1.13–1.21.4), a text component (1.21.5+) or plain text. */
function textOf(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.startsWith('{') || s.startsWith('[') || s.startsWith('"')) { try { return textOf(JSON.parse(s)); } catch {} }
    return s;
  }
  if (Array.isArray(v)) return v.map(textOf).join('');
  if (typeof v === 'object') return `${v.text ?? (v.translate || '')}${(v.extra || []).map(textOf).join('')}`;
  return String(v);
}
const num = (v) => (typeof v === 'bigint' ? Number(v) : Number(v) || 0);

/** One saved item → what the viewer shows. */
function item(raw, mc, depth = 0) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const id = String(raw.id).includes(':') ? String(raw.id) : `minecraft:${raw.id}`;
  const c = raw.components || {}, tag = raw.tag || {};
  const out = { id, count: num(raw.count ?? raw.Count ?? 1), name: jar.itemName(mc, id), customName: null, enchantments: [], damage: null, maxDamage: null, contents: null, icon: jar.icon(mc, id) };
  out.customName = textOf(c['minecraft:custom_name'] ?? c['minecraft:item_name'] ?? tag.display?.Name) || null;
  const en = c['minecraft:enchantments'] || c['minecraft:stored_enchantments'];
  const levels = en ? (en.levels && typeof en.levels === 'object' ? en.levels : en) : null; // 1.21.5 dropped "levels"
  if (levels && typeof levels === 'object') for (const [k, v] of Object.entries(levels)) if (k !== 'show_in_tooltip') out.enchantments.push({ id: k, name: jar.enchantmentName(mc, k), level: num(v) });
  for (const e of [...(tag.Enchantments || []), ...(tag.StoredEnchantments || [])]) if (e?.id) out.enchantments.push({ id: String(e.id), name: jar.enchantmentName(mc, e.id), level: num(e.lvl) });
  if (c['minecraft:damage'] != null || tag.Damage != null) out.damage = num(c['minecraft:damage'] ?? tag.Damage);
  if (c['minecraft:max_damage'] != null) out.maxDamage = num(c['minecraft:max_damage']);
  if (depth < 2) {
    const inner = c['minecraft:container'] ? c['minecraft:container'].map((e) => ({ ...item(e.item, mc, depth + 1), slot: num(e.slot) })).filter((x) => x.id)
      : c['minecraft:bundle_contents'] ? c['minecraft:bundle_contents'].map((e, i) => ({ ...item(e, mc, depth + 1), slot: i })).filter((x) => x.id)
      : tag.BlockEntityTag?.Items ? tag.BlockEntityTag.Items.map((e) => ({ ...item(e, mc, depth + 1), slot: num(e.Slot) })).filter((x) => x.id) : null;
    if (inner) out.contents = inner;
  }
  return out;
}

const DIMS = { 'minecraft:overworld': 'Overworld', 'minecraft:the_nether': 'Nether', 'minecraft:the_end': 'The End', 0: 'Overworld', [-1]: 'Nether', 1: 'The End' };
const MODES = ['Survival', 'Creative', 'Adventure', 'Spectator'];

/** A player's save: the playerdata file, or — in a singleplayer world — the player inside level.dat. */
function playerSave(w, uuid) {
  const f = path.join(w.dir, 'playerdata', `${uuid}.dat`);
  if (fs.existsSync(f)) return { data: nbt.readFile(f), saved: fs.statSync(f).mtimeMs, from: 'playerdata' };
  if (w.kind === 'instance') {
    const lf = path.join(w.dir, 'level.dat');
    const p = nbt.readFile(lf).Data?.Player;
    if (p) return { data: p, saved: fs.statSync(lf).mtimeMs, from: 'level.dat' };
  }
  return null;
}

/** Everything the inventory view shows for one player of one world. */
function inventory(key, uuid) {
  const u = String(uuid).toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(u)) throw new Error('Unknown player.');
  const w = saves.worlds().find((x) => x.key === key);
  if (!w) throw new Error('That world isn’t there any more.');
  const s = playerSave(w, u);
  if (!s) throw new Error('This player has no saved inventory in this world yet.');
  const p = s.data, mc = w.mc;
  const inv = (p.Inventory || []).map((e) => ({ slot: num(e.Slot), it: e }));
  const at = (n) => item(inv.find((e) => e.slot === n)?.it, mc);
  const eq = p.equipment || {};
  const fromEq = (k, oldSlot) => (eq[k] ? item(eq[k], mc) : at(oldSlot));
  const pos = Array.isArray(p.Pos) ? p.Pos.map((x) => Math.floor(num(x))) : null;
  let online = false;
  if (w.kind === 'server') { try { const st = require('../hostserver').get(w.ownerId); online = st.state === 'online'; } catch {} }
  return {
    world: { key: w.key, name: w.name, owner: w.owner, kind: w.kind, mc, serverId: w.kind === 'server' ? w.ownerId : null, serverOnline: online },
    uuid: u, saved: s.saved, from: s.from, names: jar.available(mc),
    hotbar: Array.from({ length: 9 }, (_, i) => at(i)),
    main: Array.from({ length: 27 }, (_, i) => at(9 + i)),
    armor: { head: fromEq('head', 103), chest: fromEq('chest', 102), legs: fromEq('legs', 101), feet: fromEq('feet', 100) },
    offhand: fromEq('offhand', -106),
    ender: Array.from({ length: 27 }, (_, i) => item((p.EnderItems || []).find((e) => num(e.Slot) === i), mc)),
    selected: num(p.SelectedItemSlot),
    health: p.Health != null ? Math.round(num(p.Health) * 10) / 10 : null, food: p.foodLevel != null ? num(p.foodLevel) : null, xpLevel: num(p.XpLevel),
    position: pos, dimension: DIMS[p.Dimension] || (p.Dimension ? jar.nice(p.Dimension) : null), mode: MODES[num(p.playerGameType)] || null,
  };
}

/** Hosted server: ask it to save now (players' files are written on save), so the view is current. */
async function saveNow(serverId) {
  const hs = require('../hostserver');
  if (hs.get(serverId).state !== 'online') throw new Error('The server isn’t running — what you see is already its latest save.');
  hs.command(serverId, 'save-all');
  await new Promise((r) => setTimeout(r, 2500));
  return true;
}

module.exports = { inventory, item, textOf, saveNow };
