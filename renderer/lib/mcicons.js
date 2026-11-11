/* Real Minecraft icons, read at runtime from the player's own downloaded client jar
   (versions/<id>/<id>.jar). Nothing from Mojang is bundled with Solaris: textures are
   extracted on this machine, rendered (blocks as isometric cubes, items flat) and cached
   locally as small data URLs. */

// [key, label, kind, textures]  kind: 'cube' = {top, left, right} block faces, 'item' = flat texture
const MC_ICON_DEFS = [
  ['grass_block', 'Grass Block', 'cube', { top: 'block/grass_block_top#79c05a', side: 'block/grass_block_side' }],
  ['dirt', 'Dirt', 'cube', { all: 'block/dirt' }],
  ['stone', 'Stone', 'cube', { all: 'block/stone' }],
  ['cobblestone', 'Cobblestone', 'cube', { all: 'block/cobblestone' }],
  ['oak_log', 'Oak Log', 'cube', { top: 'block/oak_log_top', side: 'block/oak_log' }],
  ['oak_planks', 'Oak Planks', 'cube', { all: 'block/oak_planks' }],
  ['crafting_table', 'Crafting Table', 'cube', { top: 'block/crafting_table_top', left: 'block/crafting_table_front', right: 'block/crafting_table_side' }],
  ['furnace', 'Furnace', 'cube', { top: 'block/furnace_top', left: 'block/furnace_front', right: 'block/furnace_side' }],
  ['bookshelf', 'Bookshelf', 'cube', { top: 'block/oak_planks', side: 'block/bookshelf' }],
  ['tnt', 'TNT', 'cube', { top: 'block/tnt_top', side: 'block/tnt_side' }],
  ['bricks', 'Bricks', 'cube', { all: 'block/bricks' }],
  ['stone_bricks', 'Stone Bricks', 'cube', { all: 'block/stone_bricks' }],
  ['oak_leaves', 'Oak Leaves', 'cube', { all: 'block/oak_leaves#59ae30' }],
  ['sand', 'Sand', 'cube', { all: 'block/sand' }],
  ['snow_block', 'Snow', 'cube', { all: 'block/snow' }],
  ['ice', 'Ice', 'cube', { all: 'block/packed_ice' }],
  ['pumpkin', 'Pumpkin', 'cube', { top: 'block/pumpkin_top', left: 'block/carved_pumpkin', right: 'block/pumpkin_side' }],
  ['jack_o_lantern', "Jack o'Lantern", 'cube', { top: 'block/pumpkin_top', left: 'block/jack_o_lantern', right: 'block/pumpkin_side' }],
  ['melon', 'Melon', 'cube', { top: 'block/melon_top', side: 'block/melon_side' }],
  ['diamond_ore', 'Diamond Ore', 'cube', { all: 'block/diamond_ore' }],
  ['diamond_block', 'Diamond Block', 'cube', { all: 'block/diamond_block' }],
  ['emerald_block', 'Emerald Block', 'cube', { all: 'block/emerald_block' }],
  ['gold_block', 'Gold Block', 'cube', { all: 'block/gold_block' }],
  ['iron_block', 'Iron Block', 'cube', { all: 'block/iron_block' }],
  ['redstone_block', 'Redstone Block', 'cube', { all: 'block/redstone_block' }],
  ['lapis_block', 'Lapis Block', 'cube', { all: 'block/lapis_block' }],
  ['netherite_block', 'Netherite Block', 'cube', { all: 'block/netherite_block' }],
  ['obsidian', 'Obsidian', 'cube', { all: 'block/obsidian' }],
  ['crying_obsidian', 'Crying Obsidian', 'cube', { all: 'block/crying_obsidian' }],
  ['netherrack', 'Netherrack', 'cube', { all: 'block/netherrack' }],
  ['glowstone', 'Glowstone', 'cube', { all: 'block/glowstone' }],
  ['magma_block', 'Magma', 'cube', { all: 'block/magma' }],
  ['end_stone', 'End Stone', 'cube', { all: 'block/end_stone' }],
  ['purpur_block', 'Purpur', 'cube', { all: 'block/purpur_block' }],
  ['amethyst_block', 'Amethyst', 'cube', { all: 'block/amethyst_block' }],
  ['sculk', 'Sculk', 'cube', { all: 'block/sculk' }],
  ['cherry_planks', 'Cherry Planks', 'cube', { all: 'block/cherry_planks' }],
  ['honey_block', 'Honeycomb Block', 'cube', { all: 'block/honeycomb_block' }],
  ['slime_block', 'Slime Block', 'cube', { all: 'block/slime_block' }],
  ['command_block', 'Command Block', 'cube', { top: 'block/command_block_back', left: 'block/command_block_front', right: 'block/command_block_side' }],
  ['beacon', 'Beacon', 'cube', { all: 'block/beacon' }],
  ['diamond_sword', 'Diamond Sword', 'item', 'item/diamond_sword'],
  ['netherite_sword', 'Netherite Sword', 'item', 'item/netherite_sword'],
  ['diamond_pickaxe', 'Diamond Pickaxe', 'item', 'item/diamond_pickaxe'],
  ['iron_pickaxe', 'Iron Pickaxe', 'item', 'item/iron_pickaxe'],
  ['diamond_axe', 'Diamond Axe', 'item', 'item/diamond_axe'],
  ['bow', 'Bow', 'item', 'item/bow'],
  ['crossbow', 'Crossbow', 'item', 'item/crossbow_standby'],
  ['trident', 'Trident', 'item', 'item/trident'],
  ['mace', 'Mace', 'item', 'item/mace'],
  ['fishing_rod', 'Fishing Rod', 'item', 'item/fishing_rod'],
  ['iron_chestplate', 'Iron Chestplate', 'item', 'item/iron_chestplate'],
  ['diamond_helmet', 'Diamond Helmet', 'item', 'item/diamond_helmet'],
  ['elytra', 'Elytra', 'item', 'item/elytra'],
  ['diamond', 'Diamond', 'item', 'item/diamond'],
  ['emerald', 'Emerald', 'item', 'item/emerald'],
  ['gold_ingot', 'Gold Ingot', 'item', 'item/gold_ingot'],
  ['netherite_ingot', 'Netherite Ingot', 'item', 'item/netherite_ingot'],
  ['redstone', 'Redstone', 'item', 'item/redstone'],
  ['amethyst_shard', 'Amethyst Shard', 'item', 'item/amethyst_shard'],
  ['apple', 'Apple', 'item', 'item/apple'],
  ['golden_apple', 'Golden Apple', 'item', 'item/golden_apple'],
  ['bread', 'Bread', 'item', 'item/bread'],
  ['cake', 'Cake', 'item', 'item/cake'],
  ['cookie', 'Cookie', 'item', 'item/cookie'],
  ['ender_pearl', 'Ender Pearl', 'item', 'item/ender_pearl'],
  ['ender_eye', 'Eye of Ender', 'item', 'item/ender_eye'],
  ['nether_star', 'Nether Star', 'item', 'item/nether_star'],
  ['totem_of_undying', 'Totem of Undying', 'item', 'item/totem_of_undying'],
  ['heart_of_the_sea', 'Heart of the Sea', 'item', 'item/heart_of_the_sea'],
  ['experience_bottle', 'Bottle o’ Enchanting', 'item', 'item/experience_bottle'],
  ['enchanted_book', 'Enchanted Book', 'item', 'item/enchanted_book'],
  ['book', 'Book', 'item', 'item/book'],
  ['writable_book', 'Book and Quill', 'item', 'item/writable_book'],
  ['compass', 'Compass', 'item', 'item/compass_00'],
  ['clock', 'Clock', 'item', 'item/clock_00'],
  ['spyglass', 'Spyglass', 'item', 'item/spyglass'],
  ['map', 'Map', 'item', 'item/filled_map'],
  ['firework_rocket', 'Firework Rocket', 'item', 'item/firework_rocket'],
  ['water_bucket', 'Water Bucket', 'item', 'item/water_bucket'],
  ['lava_bucket', 'Lava Bucket', 'item', 'item/lava_bucket'],
  ['blaze_rod', 'Blaze Rod', 'item', 'item/blaze_rod'],
  ['blaze_powder', 'Blaze Powder', 'item', 'item/blaze_powder'],
  ['fire_charge', 'Fire Charge', 'item', 'item/fire_charge'],
  ['slime_ball', 'Slimeball', 'item', 'item/slime_ball'],
  ['snowball', 'Snowball', 'item', 'item/snowball'],
  ['bone', 'Bone', 'item', 'item/bone'],
  ['honeycomb', 'Honeycomb', 'item', 'item/honeycomb'],
  ['music_disc', 'Music Disc', 'item', 'item/music_disc_cat'],
  ['name_tag', 'Name Tag', 'item', 'item/name_tag'],
  ['saddle', 'Saddle', 'item', 'item/saddle'],
  ['lead', 'Lead', 'item', 'item/lead'],
  ['comparator', 'Comparator', 'item', 'item/comparator'],
  ['hopper', 'Hopper', 'item', 'item/hopper'],
  ['minecart', 'Minecart', 'item', 'item/minecart'],
  ['oak_boat', 'Oak Boat', 'item', 'item/oak_boat'],
  ['oak_sapling', 'Oak Sapling', 'item', 'block/oak_sapling'],
  ['red_mushroom', 'Red Mushroom', 'item', 'block/red_mushroom'],
  ['poppy', 'Poppy', 'item', 'block/poppy'],
  ['torch', 'Torch', 'item', 'block/torch'],
  ['sweet_berries', 'Sweet Berries', 'item', 'item/sweet_berries'],
];

// The emoji icons Solaris used before → their real Minecraft counterpart.
const EMOJI_TO_MC = { '🧱': 'grass_block', '⛏️': 'diamond_pickaxe', '🗡️': 'diamond_sword', '🏹': 'bow', '🛡️': 'iron_chestplate', '🌲': 'oak_log', '🌋': 'magma_block', '🏰': 'stone_bricks', '🐉': 'ender_eye', '🧪': 'experience_bottle', '💎': 'diamond', '🔥': 'blaze_powder', '❄️': 'snowball', '🌙': 'clock', '⭐': 'nether_star', '🚀': 'firework_rocket', '🧭': 'compass', '🌸': 'cherry_planks', '🍄': 'red_mushroom', '🐺': 'bone', '🐝': 'honeycomb', '⚙️': 'redstone_block', '🎮': 'command_block', '🏝️': 'sand', '🌊': 'water_bucket', '👾': 'ender_pearl', '🌱': 'oak_sapling', '🌍': 'grass_block' };

const McIcons = {
  KEY: 'solaris.mcicons.v2',
  icons: {}, // key -> data URL
  source: null, // version id the textures came from
  loading: null,
  defs: MC_ICON_DEFS,
  /** 'mc:<key>' -> data URL (or null when textures aren't loaded) */
  url(ic) {
    if (!ic) return null;
    const k = ic.startsWith('mc:') ? ic.slice(3) : EMOJI_TO_MC[ic];
    return (k && this.icons[k]) || null;
  },
  defaultFor(inst) { return this.icons[inst?.loader?.type && inst.loader.type !== 'vanilla' ? 'crafting_table' : 'grass_block'] || null; },
  ready() { return Object.keys(this.icons).length > 0; },

  loadCache() {
    try { const c = JSON.parse(localStorage.getItem(this.KEY) || 'null'); if (c && c.icons) { this.icons = c.icons; this.source = c.source; } } catch {}
  },
  /** Finds a downloaded client jar and extracts the icon set (once; cached afterwards). */
  async init({ force = false } = {}) {
    this.loadCache();
    if (this.ready() && !force) return true;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const root = State.info?.dataDir;
      if (!root) return false;
      const ids = [...new Set([...State.instances].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)).flatMap((i) => [i.versionId, i.launchVersionId]).filter(Boolean))];
      try { const l = await api('versions:latest'); if (l?.release) ids.push(l.release); if (l?.snapshot) ids.push(l.snapshot); } catch {}
      for (const id of ids) {
        const url = fileUrl(`${root}/versions/${id}/${id}.jar`);
        let buf;
        try { const r = await fetch(url); if (!r.ok) continue; buf = await r.arrayBuffer(); } catch { continue; }
        try {
          const icons = await this.extract(buf);
          if (Object.keys(icons).length < 10) continue;
          this.icons = icons; this.source = id;
          try { localStorage.setItem(this.KEY, JSON.stringify({ source: id, icons })); } catch {}
          return true;
        } catch (e) { console.warn('mcicons', id, e); }
      }
      return false;
    })();
    try { return await this.loading; } finally { this.loading = null; }
  },

  /* ---------- zip reading (central directory + raw deflate) ---------- */
  zipIndex(buf) {
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not a zip');
    let count = dv.getUint16(eocd + 10, true), off = dv.getUint32(eocd + 16, true);
    // zip64 end-of-central-directory locator
    if (off === 0xffffffff || count === 0xffff) {
      const loc = eocd - 20;
      if (dv.getUint32(loc, true) === 0x07064b50) { const z = Number(dv.getBigUint64(loc + 8, true)); count = Number(dv.getBigUint64(z + 32, true)); off = Number(dv.getBigUint64(z + 48, true)); }
    }
    const dec = new TextDecoder();
    const map = new Map();
    for (let n = 0; n < count && dv.getUint32(off, true) === 0x02014b50; n++) {
      const method = dv.getUint16(off + 10, true), comp = dv.getUint32(off + 20, true);
      const nl = dv.getUint16(off + 28, true), el = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true);
      const local = dv.getUint32(off + 42, true);
      const name = dec.decode(new Uint8Array(buf, off + 46, nl));
      if (name.startsWith('assets/minecraft/textures/')) map.set(name, { method, comp, local });
      off += 46 + nl + el + cl;
    }
    return map;
  },
  async readEntry(buf, e) {
    const dv = new DataView(buf);
    const start = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
    const raw = new Uint8Array(buf, start, e.comp);
    if (e.method === 0) return new Blob([raw], { type: 'image/png' });
    const ds = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Blob([await new Response(ds).arrayBuffer()], { type: 'image/png' });
  },

  /* ---------- rendering ---------- */
  async extract(buf) {
    const idx = this.zipIndex(buf);
    const cache = {};
    const tex = async (spec) => {
      const [p, tint] = spec.split('#');
      if (p in cache) return cache[p] && (tint ? this.tint(cache[p], '#' + tint) : cache[p]);
      const [kind, name] = p.split('/');
      const e = idx.get(`assets/minecraft/textures/${kind}/${name}.png`) || idx.get(`assets/minecraft/textures/${kind}s/${name}.png`);
      if (!e) { cache[p] = null; return null; }
      try { cache[p] = await this.square(await createImageBitmap(await this.readEntry(buf, e))); } catch { cache[p] = null; }
      return cache[p] && (tint ? this.tint(cache[p], '#' + tint) : cache[p]);
    };
    const out = {};
    for (const [key, , kind, t] of MC_ICON_DEFS) {
      try {
        if (kind === 'item') { const img = await tex(t); if (img) out[key] = this.flat(img); continue; }
        const top = await tex(t.top || t.all), left = await tex(t.left || t.side || t.all), right = await tex(t.right || t.side || t.all);
        if (top && left && right) out[key] = this.cube(top, left, right);
      } catch {}
    }
    return out;
  },
  /** First frame of (possibly animated) textures as a 16×16-ish square canvas. */
  square(bmp) {
    const s = bmp.width;
    const c = document.createElement('canvas'); c.width = s; c.height = s;
    c.getContext('2d').drawImage(bmp, 0, 0, s, s, 0, 0, s, s);
    return c;
  },
  tint(src, color) {
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'multiply'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(src, 0, 0);
    return c;
  },
  flat(img) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, 0, img.width, img.height, 4, 4, 56, 56);
    return c.toDataURL('image/png');
  },
  /** Isometric block: top face + two shaded side faces. */
  cube(top, left, right) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    // each face is drawn on its own layer so the shading only darkens that face
    const draw = (img, m, shade) => {
      const l = document.createElement('canvas'); l.width = 64; l.height = 64;
      const lg = l.getContext('2d'); lg.imageSmoothingEnabled = false;
      lg.setTransform(...m);
      lg.drawImage(img, 0, 0, img.width, img.height, 0, 0, 16, 16);
      if (shade) { lg.setTransform(1, 0, 0, 1, 0, 0); lg.globalCompositeOperation = 'source-atop'; lg.fillStyle = `rgba(0,0,0,${shade})`; lg.fillRect(0, 0, 64, 64); }
      g.drawImage(l, 0, 0);
    };
    const k = 28 / 16, h = 14 / 16;
    draw(top, [k, -h, k, h, 4, 18], 0);
    draw(left, [k, h, 0, k, 4, 18], 0.22);
    draw(right, [k, -h, 0, k, 32, 32], 0.4);
    return c.toDataURL('image/png');
  },
};
McIcons.loadCache();
