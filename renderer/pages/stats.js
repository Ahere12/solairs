/* Stats (Solaris Connect): players' statistics and advancements from the save files of your worlds and servers. */
const statDur = (ms) => { const m = Math.floor((ms || 0) / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const toRoman = (n) => (n >= 1 && n <= 10 ? ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n - 1] : String(n));
const ADV_TABS = { story: 'Minecraft', nether: 'Nether', end: 'The End', adventure: 'Adventure', husbandry: 'Husbandry' };

Pages.stats = {
  sel: { world: null, player: null },

  async render(el, params) {
    if (params.world) this.sel = { world: params.world, player: params.player || null, name: params.name || null, view: params.view || null };
    el.innerHTML = `<div class="page-head"><div><a href="#" id="st-back" class="small">← Solaris Connect</a><h1>Stats</h1><div class="sub">Play time, deaths, distance, mining, advancements and inventories — read from the save files of your worlds and the servers you host.</div></div></div>
      <div class="maps-layout"><div class="stack maps-side" id="st-side"><div class="faint">Loading…</div></div><div id="st-main"></div></div>`;
    $('#st-back', el).onclick = (e) => { e.preventDefault(); Router.go('connect'); };
    const worlds = await api('stats:worlds').catch((e) => (toastErr(e), []));
    if (!el.isConnected) return;
    const withStats = worlds.filter((w) => w.players);
    if (!this.sel.world || (this.sel.world !== '*' && !worlds.some((w) => w.key === this.sel.world))) this.sel = { world: withStats[0]?.key || null, player: null };
    const row = (w) => `<button class="maps-item ${this.sel.world === w.key ? 'on' : ''}" data-w="${esc(w.key)}">${icon(w.kind === 'server' ? 'host' : 'world')}<span class="grow" style="min-width:0"><b class="ellipsis">${esc(w.name)}</b><span class="faint small ellipsis">${esc(w.owner)} · ${esc(w.mc)} · ${w.players ? `${w.players} player${w.players === 1 ? '' : 's'}` : 'no stats yet'}</span></span></button>`;
    $('#st-side', el).innerHTML = `<div class="card stack" style="gap:4px"><button class="maps-item ${this.sel.world === '*' ? 'on' : ''}" data-w="*">${icon('clock')}<span class="grow"><b>All worlds</b><span class="faint small">Play time per player</span></span></button></div>
      <div class="card stack" style="gap:4px"><h4 style="margin:0 0 4px">Servers you host</h4>${worlds.filter((w) => w.kind === 'server').map(row).join('') || '<div class="faint small">None yet.</div>'}</div>
      <div class="card stack" style="gap:4px"><h4 style="margin:0 0 4px">Singleplayer worlds</h4>${worlds.filter((w) => w.kind === 'instance').map(row).join('') || '<div class="faint small">None yet.</div>'}</div>
      <p class="faint small">Minecraft saves stats while you play and when you leave. Bedrock worlds use another format and aren’t shown.</p>`;
    $$('[data-w]', el).forEach((b) => (b.onclick = () => { this.sel = { world: b.dataset.w, player: null }; this.render(el, {}); }));
    const main = $('#st-main', el);
    if (!this.sel.world) { main.innerHTML = `<div class="empty">${icon('chart')}<div>No stats yet — the game saves them while you play a world or a server.</div></div>`; return; }
    if (this.sel.world === '*') return this.totals(main);
    if (this.sel.player) return this.player(main, el);
    return this.world(main, el);
  },

  async totals(main) {
    main.innerHTML = '<div class="faint">Adding it all up…</div>';
    const t = await api('stats:totals').catch((e) => (toastErr(e), []));
    main.innerHTML = `<div class="card"><h3 style="margin:0 0 8px">${icon('clock')} Play time in all worlds</h3>${t.length ? `<table class="hs-ptable"><tr><th>Player</th><th>Play time</th><th>Worlds</th><th>Deaths</th></tr>${t.map((p) => `<tr><td><b>${esc(p.name || p.uuid.slice(0, 8))}</b></td><td>${statDur(p.playMs)}</td><td>${p.worlds}</td><td>${p.deaths}</td></tr>`).join('')}</table>` : '<div class="faint small">No stats yet.</div>'}
      <p class="faint small">From each world’s own stats. Play time in Solaris instances (including multiplayer) is in Library.</p></div>`;
  },

  async world(main, el) {
    main.innerHTML = '<div class="faint">Reading the world…</div>';
    let d; try { d = await api('stats:players', this.sel.world); } catch (e) { main.innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div></div>`; return; }
    const L = d.world.level || {};
    main.innerHTML = `<div class="card"><div class="row" style="gap:10px;margin-bottom:8px"><div class="grow"><h3 style="margin:0">${esc(d.world.name)}</h3><div class="faint small">${esc(d.world.kind === 'server' ? 'Server' : 'Instance')}: ${esc(d.world.owner)} · ${esc(L.version || d.world.mc)}${L.mode ? ` · ${esc(L.mode)}` : ''}${L.hardcore ? ' · Hardcore' : ''}${L.day ? ` · day ${L.day}` : ''}${L.lastPlayed ? ` · last saved ${timeAgo(L.lastPlayed)}` : ''}</div></div></div>
      ${d.players.length ? `<table class="hs-ptable"><tr><th>Player</th><th>Play time</th><th>Deaths</th><th>Advancements</th><th>Last saved</th></tr>${d.players.map((p) => `<tr class="st-row" data-p="${esc(p.uuid)}" style="cursor:pointer"><td><b>${esc(p.name || p.uuid.slice(0, 8) + '…')}</b>${p.offline ? ' <span class="chip">offline account</span>' : ''}</td><td>${statDur(p.playMs)}</td><td>${p.deaths}</td><td>${p.advancementsDone}</td><td class="faint small">${p.lastSaved ? timeAgo(p.lastSaved) : '—'}</td></tr>`).join('')}</table>` : '<div class="faint small">Nobody has stats in this world yet.</div>'}
      ${d.players.some((p) => p.offline) && d.players.some((p) => !p.offline) ? '<p class="faint small">The same name twice? Microsoft and offline accounts have different IDs, so the game keeps separate stats for each.</p>' : ''}</div>`;
    $$('[data-p]', main).forEach((r) => (r.onclick = () => { this.sel.player = r.dataset.p; this.render(el, {}); }));
    // opened from a server's Players tab: go straight to that player (their newest stats if they have two IDs)
    if (this.sel.name) {
      const want = this.sel.name.toLowerCase(); this.sel.name = null;
      const hit = d.players.filter((p) => (p.name || '').toLowerCase() === want).sort((a, b) => (b.lastSaved || 0) - (a.lastSaved || 0))[0];
      if (hit) { this.sel.player = hit.uuid; return this.render(el, {}); }
      this.sel.view = null;
      toast(`No stats for ${want} in this world yet`, 'info');
    }
  },

  /** Stats | Inventory switch above a player. */
  playerBar(main, el, name, worldName, owner) {
    return `<div class="row" style="gap:10px;margin-bottom:10px"><button class="btn sm ghost" id="st-up">${icon('back')}Players</button><h3 class="grow" style="margin:0">${esc(name)} <span class="faint small">in ${esc(worldName)} (${esc(owner)})</span></h3>
      <div class="hs-filter"><button data-view="stats" class="${this.sel.view !== 'inv' ? 'on' : ''}">Stats</button><button data-view="inv" class="${this.sel.view === 'inv' ? 'on' : ''}">Inventory</button></div></div>`;
  },
  bindBar(main, el) {
    $('#st-up', main).onclick = () => { this.sel.player = null; this.sel.view = null; this.render(el, {}); };
    $$('[data-view]', main).forEach((b) => (b.onclick = () => { this.sel.view = b.dataset.view; this.render(el, {}); }));
  },

  /** Inventory, armour, off hand and ender chest from the player's save (read-only). */
  async inventory(main, el) {
    main.innerHTML = '<div class="faint">Reading the save…</div>';
    let v; try { v = await api('stats:inventory', this.sel.world, this.sel.player); } catch (e) { main.innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div><button class="btn sm" id="st-up">${icon('back')}Players</button></div>`; $('#st-up', main).onclick = () => { this.sel.player = null; this.sel.view = null; this.render(el, {}); }; return; }
    const name = (await api('stats:players', this.sel.world).catch(() => ({ players: [] }))).players.find((p) => p.uuid === v.uuid)?.name || v.uuid.slice(0, 8);
    const items = [];
    const slot = (it, extra = '', ph = '') => {
      if (!it) return `<div class="inv-slot empty ${extra}">${ph ? `<span class="inv-ph">${ph}</span>` : ''}</div>`;
      items.push(it); const n = items.length - 1;
      const dmg = it.damage && it.maxDamage ? 1 - it.damage / it.maxDamage : null;
      return `<button class="inv-slot ${extra} ${it.enchantments.length ? 'ench' : ''}" data-it="${n}" title="${esc(it.customName || it.name)}${it.count > 1 ? ` ×${it.count}` : ''}">${it.icon ? `<img src="${it.icon}" alt="">` : `<span class="inv-ph">${esc(it.name.slice(0, 2))}</span>`}${it.count > 1 ? `<b>${it.count}</b>` : ''}${dmg != null ? `<i class="inv-dmg" style="width:${Math.round(dmg * 100)}%"></i>` : ''}</button>`;
    };
    const ARM = [['head', 'Helmet'], ['chest', 'Chest'], ['legs', 'Legs'], ['feet', 'Boots']];
    main.innerHTML = `${this.playerBar(main, el, name, v.world.name, v.world.owner)}
      <div class="card stack">
        <div class="row small" style="gap:14px;flex-wrap:wrap">${v.health != null ? `<span>❤ <b>${v.health}</b>/20</span>` : ''}${v.food != null ? `<span>🍗 <b>${v.food}</b>/20</span>` : ''}<span>XP level <b>${v.xpLevel}</b></span>${v.mode ? `<span>${esc(v.mode)}</span>` : ''}${v.dimension ? `<span>${esc(v.dimension)}</span>` : ''}${v.position ? `<span class="mono">${v.position.join(' ')}</span>` : ''}<span class="grow"></span>
          <span class="faint">saved ${timeAgo(v.saved)}</span>${v.world.serverOnline ? `<button class="btn sm" id="inv-save" title="Asks the server to save, then reads again">${icon('refresh')}Save &amp; refresh</button>` : ''}</div>
        <div class="inv-wrap">
          <div class="inv-col">${ARM.map(([k, l]) => slot(v.armor[k], 'armor', l[0])).join('')}<div style="height:10px"></div>${slot(v.offhand, 'armor', 'Off')}</div>
          <div class="stack" style="gap:10px"><div><div class="faint small">Inventory</div><div class="inv-grid">${v.main.map((it) => slot(it)).join('')}</div></div>
            <div><div class="faint small">Hotbar</div><div class="inv-grid">${v.hotbar.map((it, i) => slot(it, i === v.selected ? 'sel' : '')).join('')}</div></div>
            <div><div class="faint small">Ender chest</div><div class="inv-grid">${v.ender.map((it) => slot(it)).join('')}</div></div></div>
          <div class="card inv-detail" id="inv-detail"><div class="faint small">Click an item to see it.</div></div>
        </div>
        <p class="faint small">Read-only, from ${v.from === 'level.dat' ? 'the world’s level.dat (singleplayer)' : 'the server’s player save'}. ${v.world.kind === 'server' ? 'Players’ files are written when the server saves (every few minutes and when they leave).' : ''}${v.names ? '' : ` Solaris doesn’t have Minecraft ${esc(v.world.mc)}’s files, so names are made from item ids and there are no pictures.`}</p></div>`;
    this.bindBar(main, el);
    const detail = (it) => `<div class="row" style="gap:10px">${it.icon ? `<img class="inv-big" src="${it.icon}" alt="">` : ''}<div><b>${esc(it.customName || it.name)}</b>${it.customName ? `<div class="faint small">${esc(it.name)}</div>` : ''}<div class="faint small mono">${esc(it.id)}${it.count > 1 ? ` ×${it.count}` : ''}</div></div></div>
      ${it.enchantments.length ? `<div class="small" style="margin-top:6px">${it.enchantments.map((e) => `<div class="ench-text">${esc(e.name)} ${e.level > 1 ? toRoman(e.level) : ''}</div>`).join('')}</div>` : ''}
      ${it.damage ? `<div class="small" style="margin-top:6px">Durability: ${it.maxDamage ? `${it.maxDamage - it.damage} / ${it.maxDamage}` : `${it.damage} used`}</div>` : ''}
      ${it.contents ? `<div class="faint small" style="margin-top:8px">Inside (${it.contents.length})</div><div class="inv-grid small-grid">${it.contents.map((x) => `<div class="inv-slot" title="${esc(x.customName || x.name)}${x.count > 1 ? ` ×${x.count}` : ''}">${x.icon ? `<img src="${x.icon}" alt="">` : `<span class="inv-ph">${esc(x.name.slice(0, 2))}</span>`}${x.count > 1 ? `<b>${x.count}</b>` : ''}</div>`).join('')}</div>` : ''}`;
    $$('[data-it]', main).forEach((b) => (b.onclick = () => { $$('[data-it]', main).forEach((x) => x.classList.toggle('on', x === b)); $('#inv-detail', main).innerHTML = detail(items[+b.dataset.it]); }));
    if ($('#inv-save', main)) $('#inv-save', main).onclick = async (e) => { e.currentTarget.disabled = true; try { await api('stats:saveNow', v.world.serverId); } catch (er) { toastErr(er); } this.render(el, {}); };
  },

  async player(main, el) {
    if (this.sel.view === 'inv') return this.inventory(main, el);
    main.innerHTML = '<div class="faint">Reading stats…</div>';
    let p; try { p = await api('stats:player', this.sel.world, this.sel.player); } catch (e) { main.innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div></div>`; return; }
    const s = p.stats, a = p.advancements;
    const tile = (label, v) => `<div class="hs-tile"><div class="faint small">${label}</div><div class="v">${v}</div></div>`;
    const list = (title, l, unit = '') => `<div class="card"><h4 style="margin:0 0 6px">${title}</h4>${l.length ? l.map((x) => `<div class="row small"><span class="grow">${esc(x.name)}</span><b>${x.count.toLocaleString()}${unit}</b></div>`).join('') : '<div class="faint small">Nothing yet.</div>'}</div>`;
    const tabs = [...new Set(a.list.map((x) => x.tab))];
    main.innerHTML = `${this.playerBar(main, el, p.name || p.uuid, p.world.name, p.world.owner)}
      <div class="hs-tiles">${tile('Play time', statDur(s.playMs))}${tile('Deaths', s.deaths)}${tile('Mobs killed', s.mobKills.toLocaleString())}${tile('Distance', `${s.distanceKm} km`)}${tile('Blocks mined', s.blocksMined.toLocaleString())}${tile('Items crafted', s.itemsCrafted.toLocaleString())}${tile('Jumps', s.jumps.toLocaleString())}${tile('Since last death', s.sinceDeathMs != null ? statDur(s.sinceDeathMs) : '—')}${s.playerKills ? tile('Players killed', s.playerKills) : ''}${s.flownKm ? tile('Flown', `${s.flownKm} km`) : ''}${s.tradedWithVillagers ? tile('Villager trades', s.tradedWithVillagers) : ''}</div>
      <div class="st-lists">${list('Most mined', s.topMined)}${list('Most killed', s.topKilled)}${list('Killed by', s.topKilledBy)}${list('Most crafted', s.topCrafted)}</div>
      <div class="card" style="margin-top:12px"><div class="row" style="gap:10px"><h3 class="grow" style="margin:0">${icon('star')} Advancements</h3><b>${a.done}${a.total ? ` / ${a.total}` : ''}</b></div>
        ${a.total ? `<div class="hs-pregen-bar" style="margin:8px 0"><div style="width:${Math.min(100, (a.done / a.total) * 100)}%"></div></div>` : `<p class="faint small">Solaris doesn’t have Minecraft ${esc(p.world.mc)}’s files, so it can’t list the advancements not done yet or their real names.</p>`}
        ${tabs.map((t) => { const l = a.list.filter((x) => x.tab === t); return `<details ${t === 'story' ? 'open' : ''}><summary><b>${esc(ADV_TABS[t] || t)}</b> <span class="faint small">${l.filter((x) => x.done).length}/${l.length}</span></summary><div class="st-adv">${l.map((x) => `<div class="st-adv-item ${x.done ? 'done' : ''} ${x.frame}" title="${esc(x.description)}">${icon(x.done ? 'check' : 'close')}<span class="grow"><b>${esc(x.title)}</b><span class="faint small">${esc(x.description.split('\n')[0])}</span></span>${x.when ? `<span class="faint small">${new Date(x.when).toLocaleDateString()}</span>` : ''}</div>`).join('')}</div></details>`; }).join('')}</div>`;
    this.bindBar(main, el);
  },
};
