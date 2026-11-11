Pages.servers = {
  async join(address) {
    const pick = State.instances.find((i) => i.id === State.settings.selectedInstance);
    const inst = await chooseInstance({ title: `Join ${address} with…`, note: pick ? '' : 'Pick the instance to launch.' });
    if (inst) play(inst.id, { server: address });
  },
  async render(el, params, ctx) {
    if (params.address) return this.detail(el, params.address);
    let data = await api('servers:list');
    let tab = params.tab || 'featured', region = 'all', tag = 'all', q = '';
    const pings = {};
    el.innerHTML = `
      <div class="page-head"><div><h1>${T('Servers')}</h1><div class="sub">Find, ping and join servers</div></div>
        <div class="actions"><button class="btn" id="refresh">${icon('refresh')}Refresh</button><button class="btn primary" id="add">${icon('plus')}Add server</button></div></div>
      <div class="tabs"><button data-tab="featured">Discover</button><button data-tab="mine">My servers</button><button data-tab="favorites">Favourites</button></div>
      <div class="sticky-bar" id="fbar"></div>
      <div class="stack" id="slist"></div>`;
    const all = () => [...data.featured.map((s) => ({ ...s, featured: true, favorite: data.servers.some((x) => x.address === s.address && x.favorite) })), ...data.servers];
    const drawBar = () => {
      const regions = [...new Set(data.featured.map((s) => s.region))], tags = [...new Set(data.featured.flatMap((s) => s.tags))];
      $('#fbar', el).innerHTML = `<div class="search" style="width:260px">${icon('search')}<input type="search" id="sq" placeholder="${T('Search')}…" value="${esc(q)}"></div>
        ${tab === 'featured' ? `<div class="seg">${['all', ...regions].map((r) => `<button data-region="${r}" class="${r === region ? 'on' : ''}">${r === 'all' ? 'All regions' : r}</button>`).join('')}</div>
        <select id="tag"><option value="all">All tags</option>${tags.map((t) => `<option ${t === tag ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}`;
      $('#sq', el).oninput = (e) => { q = e.target.value.toLowerCase(); drawList(); };
      $$('[data-region]', el).forEach((b) => (b.onclick = () => { region = b.dataset.region; drawBar(); drawList(); }));
      const t = $('#tag', el); if (t) t.onchange = (e) => { tag = e.target.value; drawList(); };
    };
    const row = (s) => {
      const p = pings[s.address];
      return `<div class="server" data-addr="${esc(s.address)}">
        <img class="fav" ${p?.favicon ? `src="${esc(p.favicon)}"` : ''} alt="">
        <div class="grow" style="min-width:0">
          <div class="row"><b style="cursor:pointer" data-detail="${esc(s.address)}">${esc(s.name)}</b>${s.region ? `<span class="chip">${esc(s.region)}</span>` : ''}${(s.tags || []).slice(0, 3).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}${p?.version ? `<span class="faint small">${esc(p.version)}</span>` : ''}</div>
          <div class="motd">${p ? (p.online ? motdHtml(p.motd) : `<span style="color:var(--danger)">Offline · ${esc(p.error || '')}</span>`) : '<span class="faint">Pinging…</span>'}</div>
        </div>
        <div class="players">${p?.online ? `<div class="n">${fmtNum(p.players.online)}<span class="faint small"> / ${fmtNum(p.players.max)}</span></div><div class="faint small">${p.latency != null ? icon('wifi') + ' ' + p.latency + ' ms' : ''}</div>` : '<div class="n faint">—</div>'}</div>
        <button class="icon-btn" data-fav="${esc(s.address)}" title="Favourite" style="color:${s.favorite ? 'var(--accent)' : ''}">${icon(s.favorite ? 'starFill' : 'star')}</button>
        <button class="icon-btn" data-copy="${esc(s.address)}" title="Copy IP">${icon('copy')}</button>
        <button class="icon-btn" data-detail="${esc(s.address)}" title="Statistics">${icon('chart')}</button>
        ${s.id ? `<button class="icon-btn" data-rm="${esc(s.id)}" title="Remove">${icon('trash')}</button>` : ''}
        <button class="btn sm primary" data-join="${esc(s.address)}">${icon('play')}Join</button></div>`;
    };
    const drawList = () => {
      let list = tab === 'featured' ? all().filter((s) => s.featured) : tab === 'mine' ? data.servers : all().filter((s) => s.favorite);
      const seen = new Set(); list = list.filter((s) => (seen.has(s.address) ? false : seen.add(s.address)));
      if (tab === 'featured') list = list.filter((s) => (region === 'all' || s.region === region) && (tag === 'all' || s.tags.includes(tag)));
      if (q) list = list.filter((s) => (s.name + ' ' + s.address + ' ' + (s.tags || []).join(' ')).toLowerCase().includes(q));
      $('#slist', el).innerHTML = list.length ? list.map(row).join('') : `<div class="empty">${icon('servers')}<div>${tab === 'mine' ? 'Add your favourite servers with “Add server”.' : 'No servers here yet.'}</div></div>`;
      $$('[data-join]', el).forEach((b) => (b.onclick = () => this.join(b.dataset.join)));
      $$('[data-copy]', el).forEach((b) => (b.onclick = () => { api('clipboard:write', b.dataset.copy); toast('IP copied'); }));
      $$('[data-detail]', el).forEach((b) => (b.onclick = () => Router.go('servers', { address: b.dataset.detail })));
      $$('[data-rm]', el).forEach((b) => (b.onclick = async () => { data = await api('servers:remove', b.dataset.rm); drawList(); }));
      $$('[data-fav]', el).forEach((b) => (b.onclick = async () => {
        const addr = b.dataset.fav;
        const existing = data.servers.find((s) => s.address === addr);
        const f = data.featured.find((s) => s.address === addr);
        data = await api('servers:save', existing ? { ...existing, favorite: !existing.favorite } : { name: f?.name || addr, address: addr, favorite: true });
        drawList();
      }));
      for (const s of list) if (!(s.address in pings)) ping(s.address);
    };
    const ping = async (address) => {
      pings[address] = null;
      try { pings[address] = await api('servers:ping', address); } catch (e) { pings[address] = { online: false, error: e.message }; }
      if (el.isConnected) redraw();
    };
    const redraw = debounce(() => drawList(), 120);
    $$('[data-tab]', el).forEach((b) => (b.onclick = () => { tab = b.dataset.tab; $$('[data-tab]', el).forEach((x) => x.classList.toggle('on', x === b)); drawBar(); drawList(); }));
    $(`[data-tab="${tab}"]`, el).classList.add('on');
    $('#refresh', el).onclick = () => { for (const k in pings) delete pings[k]; drawList(); };
    $('#add', el).onclick = () => {
      const m = modal({ title: 'Add server', body: `<div class="stack"><label class="field">Name<input type="text" id="sn" placeholder="My server"></label><label class="field">Address<input type="text" id="sa" placeholder="play.example.com:25565"></label></div>`, footer: `<button class="btn primary" data-s>${T('Save')}</button>` });
      m.$('#sa').focus();
      m.$('[data-s]').onclick = async () => { try { data = await api('servers:save', { name: m.$('#sn').value.trim() || m.$('#sa').value.trim(), address: m.$('#sa').value.trim() }); m.close(); tab = 'mine'; $$('[data-tab]', el).forEach((x) => x.classList.toggle('on', x.dataset.tab === 'mine')); drawBar(); drawList(); } catch (e) { toastErr(e); } };
    };
    drawBar(); drawList();
    const t = setInterval(() => { for (const k in pings) delete pings[k]; drawList(); }, 60000);
    return () => clearInterval(t);
  },

  async detail(el, address) {
    el.innerHTML = `<div class="page-head"><button class="btn ghost" id="bk">${icon('back')}Servers</button></div><div id="sd"><div class="faint">Pinging ${esc(address)}…</div></div>`;
    $('#bk', el).onclick = () => Router.back();
    const draw = async () => {
      const p = await api('servers:ping', address).catch((e) => ({ online: false, error: e.message }));
      const hist = await api('servers:history', address);
      const featured = (await api('servers:list')).featured.find((s) => s.address === address);
      $('#sd', el).innerHTML = `
        <div class="row" style="gap:18px;margin-bottom:20px">
          ${p.favicon ? `<img src="${esc(p.favicon)}" style="width:84px;height:84px;border-radius:14px;image-rendering:pixelated">` : `<div class="inst-icon lg">${icon('servers')}</div>`}
          <div class="grow"><h1 style="margin:0">${esc(featured?.name || address)}</h1><div class="mono faint">${esc(address)}</div><div class="motd" style="margin-top:6px;font-family:var(--mono)">${p.online ? motdHtml(p.motd) : 'Offline'}</div></div>
          <button class="btn" id="cp">${icon('copy')}Copy IP</button><button class="btn primary lg" id="jn">${icon('play')}Join</button>
        </div>
        <div class="grid cols-3">
          <div class="card stat"><span class="v">${p.online ? fmtNum(p.players.online) : '—'}</span><span class="l">Players online${p.online ? ` of ${fmtNum(p.players.max)}` : ''}</span></div>
          <div class="card stat"><span class="v">${p.latency != null ? p.latency + ' ms' : '—'}</span><span class="l">Ping</span></div>
          <div class="card stat"><span class="v" style="font-size:16px">${esc(p.version || '—')}</span><span class="l">Version${featured ? ' · ' + esc(featured.version) : ''}</span></div>
        </div>
        <h2>${icon('chart')} Player count history</h2><div class="card">${sparkline(hist)}</div>
        ${p.players?.sample?.length ? `<h2>Some players online</h2><div class="row wrap">${p.players.sample.map((n) => `<span class="chip">${esc(n)}</span>`).join('')}</div>` : ''}
        ${featured ? `<h2>Tags</h2><div class="row wrap"><span class="chip">${esc(featured.region)}</span>${featured.tags.map((t) => `<span class="chip accent">${esc(t)}</span>`).join('')}</div>` : ''}`;
      $('#cp', el).onclick = () => { api('clipboard:write', address); toast('IP copied'); };
      $('#jn', el).onclick = () => this.join(address);
    };
    await draw();
    const t = setInterval(draw, 60000);
    return () => clearInterval(t);
  },
};
