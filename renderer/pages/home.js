Pages.home = {
  async render(el, params, ctx) {
    const draw = () => {
      const insts = State.instances;
      const sel = insts.find((i) => i.id === State.settings.selectedInstance) || [...insts].sort((a, b) => b.lastPlayed - a.lastPlayed)[0];
      const recent = [...insts].sort((a, b) => (b.pinned - a.pinned) || (b.lastPlayed - a.lastPlayed)).slice(0, 6);
      const totalPlay = insts.reduce((s, i) => s + (i.playTime || 0), 0);
      const acct = State.accounts.accounts.find((a) => a.id === State.accounts.active);
      const hour = new Date().getHours();
      const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
      el.innerHTML = `
        <section class="hero">
          <div class="sunburst">${SUN_SVG.replace('class="sun"', 'width="100%" height="100%"')}</div>
          <div class="kicker">${esc(greet)}${acct ? ', ' + esc(acct.name) : ''}</div>
          <h1>${sel ? esc(sel.name) : 'Welcome to Solaris'}</h1>
          <div class="desc">${sel ? `Minecraft ${esc(sel.versionId)} · ${loaderLabel(sel)} · ${sel.lastPlayed ? `played ${fmtDuration(sel.playTime)} · last ${timeAgo(sel.lastPlayed)}` : 'never played'}` :'Create your first instance — or one-click the Solaris Client, an all-in-one performance modpack that keeps itself up to date.'}</div>
          <div class="play-row">
            ${sel ? `
              ${playButton(sel, { size: 'lg' })}
              <div class="inst-picker" id="pick">${instIcon(sel, 'sm')}<div><div class="t">${esc(sel.name)}</div><div class="s">${esc(sel.versionId)} · ${loaderLabel(sel)}</div></div><div class="grow"></div>${icon('fwd')}</div>
            ` : `<button class="btn primary lg play" id="first-solaris">${icon('sun')}Get Solaris Client</button><button class="btn lg" id="first-new">${icon('plus')}${T('New instance')}</button>`}
          </div>
          <div class="launch-status" id="lstatus">${sel ? esc(launchLabel(sel.id)) : ''}</div>
        </section>

        <div class="grid cols-3" style="margin-top:18px">
          <div class="card stat"><span class="v">${insts.length}</span><span class="l">Instances</span></div>
          <div class="card stat"><span class="v">${fmtDuration(totalPlay)}</span><span class="l">Total play time</span></div>
          <div class="card stat"><span class="v">${Object.values(State.runs).filter((r) => r.running).length}</span><span class="l">Running now</span></div>
        </div>

        ${recent.length ? `<h2>Jump back in</h2><div class="grid cols-auto" id="recent">${recent.map((i) => Pages.library.card(i)).join('')}</div>` : ''}

        <div class="grid cols-2" style="margin-top:8px">
          <div><h2>Featured servers</h2><div class="stack" id="featured"><div class="faint small">Pinging servers…</div></div></div>
          <div><h2>What's new in Solaris</h2><div class="card" id="news"></div></div>
        </div>`;
      if (sel) $('#pick', el).onclick = async () => { const i = await chooseInstance({ title: 'Select instance' }); if (i) { await saveSettings({ selectedInstance: i.id }); draw(); } };
      else { $('#first-new', el).onclick = () => openNewInstance(); $('#first-solaris', el).onclick = () => Router.go('solaris'); }
      Pages.library.bindCards(el);
      loadNews(); loadFeatured();
    };
    const loadNews = async () => {
      const log = await api('data:changelog');
      const r = log[0];
      if (!r || !$('#news', el)) return;
      const entries = r.groups.flatMap((g) => g.entries.map((e) => ({ ...e, area: g.area }))).slice(0, 6);
      $('#news', el).innerHTML = `<div class="row" style="margin-bottom:6px"><b>Solaris ${esc(r.version)}</b><span class="faint small">${fmtDate(r.date)}</span><div class="grow"></div><a href="#" id="all-news" class="small">Full changelog →</a></div>${entries.map((e) => `<div class="news-item"><span class="chip ${e.type === 'feature' ? 'accent' : e.type === 'bugfix' ? 'danger' : 'info'}">${esc(e.area)}</span><span class="small">${esc(e.text)}</span></div>`).join('')}`;
      $('#all-news', el).onclick = (e) => { e.preventDefault(); Router.go('changelog'); };
    };
    const loadFeatured = async () => {
      const { featured } = await api('servers:list');
      const box = $('#featured', el); if (!box) return;
      box.innerHTML = featured.slice(0, 4).map((s) => `<div class="server" data-addr="${esc(s.address)}"><img class="fav" alt=""><div class="grow" style="min-width:0"><div class="row"><b>${esc(s.name)}</b><span class="chip">${esc(s.region)}</span></div><div class="faint small mono">${esc(s.address)}</div></div><div class="players"><div class="n">—</div><div class="faint small">players</div></div><button class="btn sm" data-join="${esc(s.address)}">Join</button></div>`).join('');
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
    ctx.on('launch', (id) => { const s = $('#lstatus', el); if (s && id === State.settings.selectedInstance) s.textContent = launchLabel(id); if (!State.launch[id] || State.launch[id].error) draw(); });
    ctx.on('runs', draw);
  },
};
