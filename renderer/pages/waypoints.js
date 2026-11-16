/* Waypoints (Astra Connect): saved places, places from save files, sharing codes, and /tp on servers you host. */
const WP_DIMS = [['minecraft:overworld', 'Overworld'], ['minecraft:the_nether', 'Nether'], ['minecraft:the_end', 'The End']];
const WP_COLORS = ['#7c9cff', '#4ade80', '#fbbf24', '#f87171', '#c084fc', '#22d3ee', '#ffffff'];
const wpDim = (d) => (WP_DIMS.find((x) => x[0] === d) || [d, String(d).replace(/^[^:]+:/, '')])[1];
const wpText = (w) => `${w.name} — ${w.x} ${w.y ?? '~'} ${w.z} (${wpDim(w.dimension)})`;

Pages.waypoints = {
  q: '', picked: new Set(),

  async render(el, params) {
    el.innerHTML = `<div class="page-head"><div><a href="#" id="wp-back" class="small">← Astra Connect</a><h1>Waypoints</h1><div class="sub">Save places, take them from your save files, and share them with friends as a code.</div></div>
        <div class="actions"><button class="btn" id="wp-paste">${icon('download')}Paste a code</button><button class="btn primary" id="wp-new">${icon('plus')}New waypoint</button></div></div>
      <div class="maps-layout"><div class="stack maps-side" id="wp-side"></div><div id="wp-main"><div class="faint">Loading…</div></div></div>`;
    $('#wp-back', el).onclick = (e) => { e.preventDefault(); Router.go('connect'); };
    const [list, worlds, servers] = await Promise.all([api('wp:list'), api('stats:worlds').catch(() => []), api('hosted:list').catch(() => [])]);
    if (!el.isConnected) return;
    // places a waypoint can belong to: your servers' and singleplayer worlds, saved servers you play on, or anywhere
    const saved = (await api('servers:list').catch(() => ({ servers: [] }))).servers || [];
    const PLACES = [['', 'Anywhere'], ...worlds.map((w) => [w.key, `${w.kind === 'server' ? 'Server' : 'World'}: ${w.owner}${w.kind === 'instance' ? ` — ${w.name}` : ''}`]), ...saved.map((s) => [`addr:${s.address}`, `Saved server: ${s.name || s.address}`])];
    const placeName = (p) => (PLACES.find((x) => x[0] === p) || [p, p.startsWith('addr:') ? p.slice(5) : p || 'Anywhere'])[1];
    const live = (p) => { const m = /^s:([^:]+):/.exec(p || ''); const s = m && servers.find((x) => x.id === m[1]); return s && s.state === 'online' ? s : null; };

    // ---- left: places from save files
    $('#wp-side', el).innerHTML = `<div class="card stack" style="gap:6px"><h4 style="margin:0">${icon('world')} From your save files</h4>
        <div class="faint small">World spawn, and a player’s position, last death and bed.</div>
        <select id="wp-src-world"><option value="">Pick a world…</option>${worlds.map((w) => `<option value="${esc(w.key)}" ${params.place === w.key ? 'selected' : ''}>${esc(w.owner)}${w.kind === 'instance' ? ` — ${esc(w.name)}` : ''}</option>`).join('')}</select>
        <select id="wp-src-player" disabled><option value="">World only</option></select>
        <div id="wp-src-list" class="stack" style="gap:4px"></div></div>
      <p class="faint small">Waypoints stay on this PC. Share them with <b>Copy code</b> — friends paste it here with <b>Paste a code</b>. Plain coordinates (“Base 120 64 -340”) work too.</p>`;
    const srcWorld = $('#wp-src-world', el), srcPlayer = $('#wp-src-player', el), srcList = $('#wp-src-list', el);
    const showPlaces = async () => {
      srcList.innerHTML = srcWorld.value ? '<div class="faint small">Reading…</div>' : '';
      if (!srcWorld.value) return;
      try {
        const r = await api('wp:places', srcWorld.value, srcPlayer.value || null);
        srcList.innerHTML = r.places.map((p, i) => `<div class="row small hs-person"><span class="grow"><b>${esc(p.name)}</b><span class="faint mono"> ${p.x} ${p.y ?? '~'} ${p.z} · ${esc(wpDim(p.dimension))}</span></span><button class="btn sm" data-take="${i}">${icon('plus')}Save</button></div>`).join('') || '<div class="faint small">Nothing found in this save.</div>';
        $$('[data-take]', srcList).forEach((b) => (b.onclick = () => { const p = r.places[+b.dataset.take]; const who = srcPlayer.selectedOptions[0]?.dataset.name; this.edit(el, { name: who && p.kind !== 'spawn' ? `${who}’s ${p.name.toLowerCase()}` : p.name, x: p.x, y: p.y, z: p.z, dimension: p.dimension, place: srcWorld.value, from: p.kind }, PLACES); }));
      } catch (e) { srcList.innerHTML = `<div class="danger-text small">${esc(e.message)}</div>`; }
    };
    srcWorld.onchange = async () => {
      srcPlayer.innerHTML = '<option value="">World only</option>'; srcPlayer.disabled = !srcWorld.value;
      if (srcWorld.value) { try { const d = await api('stats:players', srcWorld.value); srcPlayer.innerHTML += d.players.map((p) => `<option value="${esc(p.uuid)}" data-name="${esc(p.name || '')}" ${params.player === p.uuid ? 'selected' : ''}>${esc(p.name || p.uuid.slice(0, 8))}${p.offline ? ' (offline account)' : ''}</option>`).join(''); } catch {} }
      showPlaces();
    };
    srcPlayer.onchange = showPlaces;
    if (params.place) srcWorld.onchange();

    // ---- right: your waypoints
    const main = $('#wp-main', el);
    const draw = () => {
      const q = this.q.trim().toLowerCase();
      const shown = list.filter((w) => !q || `${w.name} ${w.note} ${placeName(w.place)}`.toLowerCase().includes(q));
      const groups = [...new Set(shown.map((w) => w.place || ''))];
      main.innerHTML = `<div class="row" style="gap:8px;margin-bottom:10px"><div class="search grow">${icon('search')}<input type="search" id="wp-q" placeholder="Search waypoints…" value="${esc(this.q)}"></div>
          <button class="btn sm" id="wp-share" ${this.picked.size ? '' : 'disabled'}>${icon('copy')}Copy code for ${this.picked.size || ''} picked</button></div>
        ${list.length ? groups.map((g) => { const srv = live(g); return `<div class="card" style="margin-bottom:10px"><div class="row" style="margin-bottom:6px"><h4 class="grow" style="margin:0">${esc(placeName(g))}</h4>${srv ? `<span class="chip ok">${esc(srv.name)} is online</span>` : ''}</div>
          ${shown.filter((w) => (w.place || '') === g).map((w) => `<div class="row hs-person wp-row" style="gap:10px"><input type="checkbox" data-pick="${esc(w.id)}" ${this.picked.has(w.id) ? 'checked' : ''}><i class="wp-dot" style="background:${esc(w.color)}"></i>
            <span class="grow" style="min-width:0"><b>${esc(w.name)}</b> <span class="mono small">${w.x} ${w.y ?? '~'} ${w.z}</span> <span class="faint small">${esc(wpDim(w.dimension))}</span>${w.note ? `<div class="faint small ellipsis">${esc(w.note)}</div>` : ''}</span>
            ${srv ? `<button class="btn sm" data-tp="${esc(w.id)}" title="Teleport an online player here">${icon('fwd')}Teleport</button><button class="icon-btn" data-say="${esc(w.id)}" title="Post in the server chat">${icon('users')}</button>` : ''}
            <button class="icon-btn" data-more="${esc(w.id)}" title="More">${icon('more')}</button></div>`).join('')}</div>`; }).join('')
          : `<div class="empty">${icon('roadmap')}<div><b>No waypoints yet</b><br>Add one, take one from a save file on the left, or paste a code a friend sent.</div></div>`}`;
      $('#wp-q', main).oninput = (e) => { this.q = e.target.value; const pos = e.target.selectionStart; draw(); const i = $('#wp-q', main); i.focus(); i.setSelectionRange(pos, pos); };
      $$('[data-pick]', main).forEach((c) => (c.onchange = () => { c.checked ? this.picked.add(c.dataset.pick) : this.picked.delete(c.dataset.pick); draw(); }));
      $('#wp-share', main).onclick = async () => { try { const code = await api('wp:encode', [...this.picked]); api('clipboard:write', code); toast(`Code copied for ${this.picked.size} waypoint${this.picked.size === 1 ? '' : 's'} — friends paste it in Astra → Waypoints → Paste a code`, 'ok', 8000); } catch (e) { toastErr(e); } };
      $$('[data-tp]', main).forEach((b) => (b.onclick = () => this.teleport(b.dataset.tp, live(list.find((w) => w.id === b.dataset.tp).place))));
      $$('[data-say]', main).forEach((b) => (b.onclick = async () => { try { await api('wp:announce', b.dataset.say); toast('Posted in the server chat'); } catch (e) { toastErr(e); } }));
      $$('[data-more]', main).forEach((b) => (b.onclick = (e) => {
        const w = list.find((x) => x.id === b.dataset.more);
        contextMenu(e.clientX, e.clientY, [
          { label: 'Copy code', icon: 'key', action: async () => { api('clipboard:write', await api('wp:encode', [w.id])); toast('Code copied'); } },
          { label: 'Copy for chat', icon: 'copy', action: () => { api('clipboard:write', wpText(w)); toast('Copied'); } },
          { label: 'Copy /tp command', icon: 'console', action: () => { api('clipboard:write', `/execute in ${w.dimension} run tp @s ${w.x} ${w.y ?? '~'} ${w.z}`); toast('Copied — operators can paste it in the game chat'); } },
          '-',
          { label: 'Edit', icon: 'edit', action: () => this.edit(el, w, PLACES) },
          { label: 'Delete', icon: 'trash', danger: true, action: async () => { await api('wp:remove', w.id); this.picked.delete(w.id); this.render(el, {}); } },
        ]);
      }));
    };
    draw();
    $('#wp-new', el).onclick = () => this.edit(el, {}, PLACES);
    $('#wp-paste', el).onclick = () => this.paste(el, PLACES);
  },

  edit(el, w, PLACES) {
    const m = modal({
      title: w.id ? 'Edit waypoint' : 'New waypoint',
      body: `<div class="stack">
        <label class="field">Name<input type="text" id="we-name" maxlength="40" value="${esc(w.name || '')}" placeholder="e.g. Base"></label>
        <div class="row"><label class="field grow">X<input type="number" id="we-x" value="${w.x ?? ''}"></label><label class="field grow">Y <span class="faint small">(optional)</span><input type="number" id="we-y" value="${w.y ?? ''}"></label><label class="field grow">Z<input type="number" id="we-z" value="${w.z ?? ''}"></label></div>
        <div class="row"><label class="field grow">Dimension<select id="we-dim">${WP_DIMS.map(([k, n]) => `<option value="${k}" ${k === (w.dimension || 'minecraft:overworld') ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="field grow">Place<select id="we-place">${PLACES.map(([k, n]) => `<option value="${esc(k)}" ${k === (w.place || '') ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label></div>
        <div class="field">Colour<div class="row" style="gap:6px">${WP_COLORS.map((c) => `<button class="wp-color ${c === (w.color || WP_COLORS[0]) ? 'on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}</div></div>
        <label class="field">Note <span class="faint small">(optional)</span><input type="text" id="we-note" maxlength="200" value="${esc(w.note || '')}"></label></div>`,
      footer: `<button class="btn ghost" data-x>${T('Cancel')}</button><button class="btn primary" data-go>${icon('check')}Save</button>`,
    });
    let color = w.color || WP_COLORS[0];
    $$('[data-c]', m.el).forEach((b) => (b.onclick = () => { color = b.dataset.c; $$('[data-c]', m.el).forEach((x) => x.classList.toggle('on', x === b)); }));
    m.$('[data-x]').onclick = () => m.close();
    m.$('[data-go]').onclick = async () => {
      try { await api('wp:save', { ...w, name: m.$('#we-name').value, x: m.$('#we-x').value, y: m.$('#we-y').value, z: m.$('#we-z').value, dimension: m.$('#we-dim').value, place: m.$('#we-place').value, color, note: m.$('#we-note').value }); m.close(); toast('Waypoint saved'); this.render(el, {}); }
      catch (e) { toastErr(e); }
    };
    setTimeout(() => m.$('#we-name')?.focus(), 50);
  },

  paste(el, PLACES) {
    const m = modal({
      title: 'Paste a waypoint code',
      body: `<p class="muted small">Paste an <span class="mono">ASTRA-WP-</span> code a friend sent — or plain coordinates like “Base 120 64 -340”.</p>
        <textarea id="wpp-text" class="mono" rows="3" style="width:100%" spellcheck="false"></textarea>
        <label class="field">Save to<select id="wpp-place">${PLACES.map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join('')}</select></label>
        <div id="wpp-preview" class="stack" style="gap:4px"></div>`,
      footer: `<button class="btn ghost" data-x>${T('Cancel')}</button><button class="btn primary" data-go disabled>${icon('download')}Save</button>`,
    });
    let found = [];
    const go = m.$('[data-go]');
    m.$('#wpp-text').oninput = debounce(async () => {
      const t = m.$('#wpp-text').value.trim(), pv = m.$('#wpp-preview');
      if (!t) { pv.innerHTML = ''; go.disabled = true; return; }
      try { found = await api('wp:decode', t); pv.innerHTML = found.map((w) => `<div class="row small hs-person"><i class="wp-dot" style="background:${esc(w.color)}"></i><b class="grow">${esc(w.name)}</b><span class="mono">${w.x} ${w.y ?? '~'} ${w.z}</span><span class="faint">${esc(wpDim(w.dimension))}</span></div>`).join(''); go.disabled = false; go.innerHTML = `${icon('download')}Save ${found.length}`; }
      catch (e) { pv.innerHTML = `<div class="danger-text small">${esc(e.message)}</div>`; go.disabled = true; }
    }, 250);
    m.$('[data-x]').onclick = () => m.close();
    go.onclick = async () => {
      try { for (const w of found) await api('wp:save', { ...w, id: null, place: m.$('#wpp-place').value }); m.close(); toast(`Saved ${found.length} waypoint${found.length === 1 ? '' : 's'}`); this.render(el, {}); }
      catch (e) { toastErr(e); }
    };
    setTimeout(() => m.$('#wpp-text')?.focus(), 50);
  },

  async teleport(id, srv) {
    if (!srv) return toast('The server isn’t running', 'info');
    const s = await api('hosted:get', srv.id).catch(() => srv);
    if (!s.players.length) return toast('Nobody is online on ' + s.name, 'info');
    const m = modal({ title: 'Teleport to waypoint', body: `<label class="field">Player<select id="wt-p">${s.players.map((p) => `<option>${esc(p)}</option>`).join('')}</select></label><p class="faint small">Runs <span class="mono">/tp</span> on ${esc(s.name)} (in the waypoint’s dimension).</p>`, footer: `<button class="btn ghost" data-x>${T('Cancel')}</button><button class="btn primary" data-go>${icon('fwd')}Teleport</button>` });
    m.$('[data-x]').onclick = () => m.close();
    m.$('[data-go]').onclick = async () => { try { await api('wp:teleport', id, m.$('#wt-p').value); m.close(); toast(`${m.$('#wt-p')?.value || 'Player'} teleported`); } catch (e) { toastErr(e); } };
  },
};
