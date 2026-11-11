Pages.home = {
  async render(el, params, ctx) {
    let featuredPacks = null;
    const draw = () => {
      const insts = State.instances;
      const recent = [...insts].sort((a, b) => (b.pinned - a.pinned) || ((b.lastPlayed || 0) - (a.lastPlayed || 0))).slice(0, 10);
      const acct = State.accounts.accounts.find((a) => a.id === State.accounts.active);
      const hour = new Date().getHours();
      const greet = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
      const show = { packs: look(State.settings, 'homeModpacks'), servers: look(State.settings, 'homeServers'), playtime: look(State.settings, 'homePlaytime'), news: look(State.settings, 'homeNews') };
      const tagline =hour < 5 ? 'The sun will be up soon.' : hour < 12 ? 'A fresh day to build something.' : hour < 18 ? 'Plenty of daylight left.' : 'Golden hour — perfect for a session.';
      el.innerHTML = `
        <div class="dash-head">
          <div><h1>${esc(greet)}${acct ? ', ' + esc(acct.name) : ''}</h1><div class="sub">${esc(tagline)}</div></div>
          <button class="lib-link" id="to-lib">${icon('box')}<span><b>Browse Library</b><small>Explore your instances</small></span></button>
        </div>

        ${insts.length ? `
          <div class="quick-play">
            <span class="lbl">${icon('zap')}Quick Play</span>
            ${recent.map((i) => `<button class="qp ${isRunning(i.id) ? 'running' : ''}" ${isRunning(i.id) ? `data-stop="${esc(i.id)}"` : `data-play="${esc(i.id)}"`} title="${isRunning(i.id) ? 'Stop' : 'Play'} ${esc(i.name)} · ${esc(i.versionId)}">${instIcon(i, 'sm')}</button>`).join('')}
            <div class="grow"></div>
            <span class="launch-status" id="lstatus"></span>
          </div>` : `
          <section class="hero-strip">
            <div class="sunburst">${SUN_SVG.replace('class="sun"', 'width="100%" height="100%"')}</div>
            <div class="txt"><h2>Welcome to Solaris</h2><div class="muted">Create your first instance — or one-click the Solaris Client, an all-in-one performance modpack that keeps itself up to date.</div>
              <div class="row"><button class="btn primary" id="first-solaris">${icon('sun')}Get Solaris Client</button><button class="btn" id="first-new">${icon('plus')}${T('New instance')}</button></div></div>
          </section>`}

        ${show.packs ? `<div class="section-head"><h2>Explore modpacks</h2><div class="grow"></div><a href="#" id="to-browse" class="small">See all →</a></div>
        <div class="hub-grid" id="packs" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))"><div class="faint small">Loading…</div></div>` : ''}

        ${show.servers || show.playtime ? `<div class="dash-cols" ${show.servers && show.playtime ? '' : 'style="grid-template-columns:1fr"'}>
          ${show.servers ? `<div><div class="section-head"><h2>Servers</h2><div class="grow"></div><a href="#" id="to-servers" class="small">All servers →</a></div><div class="stack" id="featured" style="gap:6px"><div class="faint small">Pinging servers…</div></div></div>` : ''}
          ${show.playtime ? `<div><div class="section-head"><h2>Your Playtime</h2></div><div class="card playtime" id="ptime"></div></div>` : ''}
        </div>` : ''}

        ${show.news ? `<div class="section-head"><h2>What's new in Solaris</h2></div><div class="card" id="news"></div>` : ''}
        ${!show.packs && !show.servers && !show.playtime && !show.news ? `<p class="faint small" style="margin-top:24px">Home sections are hidden — turn them back on in <a href="#" id="to-look">Settings → Appearance</a>.</p>` : ''}`;
      $('#to-lib', el).onclick = () => Router.go('library');
      if ($('#to-browse', el)) $('#to-browse', el).onclick = (e) => { e.preventDefault(); Router.go('browse', { type: 'modpack' }); };
      if ($('#to-servers', el)) $('#to-servers', el).onclick = (e) => { e.preventDefault(); Router.go('servers'); };
      if ($('#to-look', el)) $('#to-look', el).onclick = (e) => { e.preventDefault(); Router.go('settings', { tab: 'appearance' }); };
      if (!insts.length) { $('#first-new', el).onclick = () => openNewInstance(); $('#first-solaris', el).onclick = () => Router.go('solaris'); }
      updateStatus();
      drawPlaytime(); loadPacks(); loadNews(); loadFeatured();
    };
    const updateStatus = () => {
      const s = $('#lstatus', el); if (!s) return;
      const id = Object.keys(State.launch).find((k) => State.launch[k]?.stage || State.launch[k]?.error);
      s.textContent = id ? `${State.instances.find((i) => i.id === id)?.name || ''} · ${launchLabel(id)}` : '';
    };
    const drawPlaytime = () => {
      const box = $('#ptime', el); if (!box) return;
      const insts = State.instances;
      const total = insts.reduce((s, i) => s + (i.playTime || 0), 0);
      const played = insts.filter((i) => i.playTime > 0);
      const top = [...insts].sort((a, b) => (b.playTime || 0) - (a.playTime || 0)).slice(0, 7);
      const max = Math.max(1, ...top.map((i) => i.playTime || 0));
      const longest = top[0];
      box.innerHTML = `
        <div class="big">${fmtDuration(total)}</div><div class="faint small">Across ${insts.length} instance${insts.length === 1 ? '' : 's'}</div>
        <div class="pt-bars">${top.length ? top.map((i) => `<div class="b" title="${esc(i.name)} · ${fmtDuration(i.playTime)}"><span class="faint small" style="font-size:10px">${i.playTime ? fmtDuration(i.playTime) : ''}</span><div class="bar ${i.playTime ? '' : 'zero'}" style="height:${Math.max(4, ((i.playTime || 0) / max) * 100)}%"></div><span class="lbl">${esc(i.name)}</span></div>`).join('') : '<div class="faint small" style="margin:auto">Play something to see stats here.</div>'}</div>
        <div class="pt-stats">
          <div><b>${played.length ? fmtDuration(total / played.length) : '0m'}</b><span>Avg per instance</span></div>
          <div><b title="${esc(longest?.name || '')}">${longest?.playTime ? esc(longest.name) : '—'}</b><span>Most played</span></div>
          <div><b>${Object.values(State.runs).filter((r) => r.running).length}</b><span>Running now</span></div>
        </div>`;
    };
    const loadPacks = async () => {
      const box = $('#packs', el); if (!box) return;
      try {
        featuredPacks = featuredPacks || (await api('modrinth:search', { query: '', type: 'modpack', sort: 'downloads', offset: 0 })).hits.slice(0, 4);
        if (!$('#packs', el)) return;
        box.innerHTML = featuredPacks.map((p) => Pages.browse.hubCard({ ...p, project_type: 'modpack' })).join('');
        Pages.browse.bindHub(box, 'modpack', null);
      } catch (e) { box.innerHTML = `<div class="faint small">Couldn't reach Modrinth (${esc(e.message)})</div>`; }
    };
    const loadNews = async () => {
      const log = await api('data:changelog');
      const r = log[0];
      if (!r || !$('#news', el)) return;
      const entries = r.groups.flatMap((g) => g.entries.map((e) => ({ ...e, area: g.area }))).slice(0, 5);
      $('#news', el).innerHTML = `<div class="row" style="margin-bottom:6px"><b>Solaris ${esc(r.version)}</b><span class="faint small">${fmtDate(r.date)}</span><div class="grow"></div><a href="#" id="all-news" class="small">Full changelog →</a></div>${entries.map((e) => `<div class="news-item"><span class="chip ${e.type === 'feature' ? 'accent' : e.type === 'bugfix' ? 'danger' : 'info'}">${esc(e.area)}</span><span class="small">${esc(e.text)}</span></div>`).join('')}`;
      $('#all-news', el).onclick = (e) => { e.preventDefault(); Router.go('changelog'); };
    };
    const loadFeatured = async () => {
      const { featured } = await api('servers:list');
      const box = $('#featured', el); if (!box) return;
      box.innerHTML = featured.slice(0, 5).map((s, n) => `<div class="srv-row" data-addr="${esc(s.address)}"><img class="fav" alt=""><div class="grow" style="min-width:0"><div class="row" style="gap:8px"><b style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.name)}</b><span class="chip">${esc(s.region)}</span></div><span class="pc">${icon('users')}<span class="n">—</span></span></div><span class="rank">#${n + 1}</span><button class="btn sm" data-join="${esc(s.address)}">Join</button></div>`).join('');
      $$('[data-join]', box).forEach((b) => (b.onclick = () => Pages.servers.join(b.dataset.join)));
      for (const row of $$('[data-addr]', box)) {
        api('servers:ping', row.dataset.addr).then((r) => {
          if (!r.online) { $('.n', row).textContent = 'offline'; return; }
          $('.n', row).textContent = fmtNum(r.players.online);
          if (r.favicon) $('.fav', row).src = r.favicon;
        }).catch(() => {});
      }
    };
    draw();
    ctx.on('instances', draw);
    ctx.on('launch', (id) => { updateStatus(); if (!State.launch[id] || State.launch[id].error) draw(); });
    ctx.on('runs', draw);
    let lastLook = '';
    ctx.on('settings', (s) => { const k = ['homeModpacks', 'homeServers', 'homePlaytime', 'homeNews'].map((x) => look(s, x)).join(); if (lastLook && k !== lastLook) draw(); lastLook = k; });
    lastLook = ['homeModpacks', 'homeServers', 'homePlaytime', 'homeNews'].map((x) => look(State.settings, x)).join();
  },
};
