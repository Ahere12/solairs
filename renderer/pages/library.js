Pages.library = {
  card(i) {
    const running = isRunning(i.id);
    const status = launchLabel(i.id);
    return `<div class="inst-card ${running ? 'running' : ''}" data-inst="${esc(i.id)}">
      ${i.pinned ? `<span class="pin">${icon('starFill')}</span>` : ''}
      <div class="top">${instIcon(i)}<div style="min-width:0"><div class="name">${esc(i.name)}</div><div class="meta">${instMeta(i)}</div></div></div>
      <div class="bottom">
        ${running ? '<span class="dot pulse"></span><span class="small" style="color:var(--ok)">Running</span>' : `<span class="faint small">${i.lastPlayed ? 'Played ' + timeAgo(i.lastPlayed) : 'Never played'}${i.playTime ? ' · ' + fmtDuration(i.playTime) : ''}</span>`}
        <span class="card-play">${playButton(i, { size: 'sm' })}</span>
      </div>
      ${status ? `<div class="status-line">${esc(status)}</div>` : ''}
    </div>`;
  },
  bindCards(root) {
    $$('[data-inst]', root).forEach((c) => {
      const inst = State.instances.find((i) => i.id === c.dataset.inst);
      c.onclick = (e) => { if (e.target.closest('button')) return; Router.go('instance', { id: inst.id }); };
      c.ondblclick = (e) => { if (e.target.closest('button')) return; if (State.settings.doubleClickLaunch && !isRunning(inst.id)) play(inst.id); };
      c.oncontextmenu = (e) => instanceMenu(e, inst);
    });
  },
  async render(el, params, ctx) {
    let query = '', sort = localStorage.getItem('lib.sort') || 'recent', group = 'all';
    el.innerHTML = `
      <div class="page-head">
        <div><h1>${T('Library')}</h1><div class="sub">All your Minecraft instances</div></div>
        <div class="actions">
          <button class="btn" id="imp">${icon('upload')}${T('Import')}</button>
          <button class="btn primary" id="new">${icon('plus')}${T('New instance')}</button>
        </div>
      </div>
      <div class="sticky-bar">
        <div class="search grow" style="max-width:360px">${icon('search')}<input type="search" id="q" placeholder="${T('Search')}…"></div>
        <div class="seg" id="filter"><button data-g="all" class="on">All</button><button data-g="modded">Modded</button><button data-g="vanilla">Vanilla</button><button data-g="running">Running</button></div>
        <div class="grow"></div>
        <select id="sort"><option value="recent">Last played</option><option value="name">Name</option><option value="created">Newest</option><option value="playtime">Most played</option><option value="version">Version</option></select>
      </div>
      <div id="grid" class="grid cols-auto"></div>`;
    $('#sort', el).value = sort;
    const draw = () => {
      let list = State.instances.filter((i) => !query || (i.name + ' ' + i.versionId + ' ' + i.loader?.type).toLowerCase().includes(query));
      if (group === 'modded') list = list.filter((i) => i.loader?.type !== 'vanilla');
      if (group === 'vanilla') list = list.filter((i) => i.loader?.type === 'vanilla');
      if (group === 'running') list = list.filter((i) => isRunning(i.id));
      const cmp = { recent: (a, b) => b.lastPlayed - a.lastPlayed, name: (a, b) => a.name.localeCompare(b.name), created: (a, b) => b.created - a.created, playtime: (a, b) => b.playTime - a.playTime, version: (a, b) => b.versionId.localeCompare(a.versionId, undefined, { numeric: true }) }[sort];
      list.sort((a, b) => (b.pinned - a.pinned) || cmp(a, b));
      const grid = $('#grid', el);
      grid.innerHTML = list.length ? list.map((i) => this.card(i)).join('') : `<div class="empty" style="grid-column:1/-1">${icon('library')}<div>${State.instances.length ? 'No instances match.' : 'No instances yet. Create one or import from another launcher.'}</div></div>`;
      this.bindCards(grid);
      if (params.spotlight) { const c = $(`[data-inst="${CSS.escape(params.spotlight)}"]`, grid); if (c) { c.classList.add('spotlight'); c.scrollIntoView({ block: 'center' }); } params.spotlight = null; }
    };
    $('#q', el).oninput = (e) => { query = e.target.value.toLowerCase(); draw(); };
    $('#sort', el).onchange = (e) => { sort = e.target.value; localStorage.setItem('lib.sort', sort); draw(); };
    $$('[data-g]', el).forEach((b) => (b.onclick = () => { group = b.dataset.g; $$('[data-g]', el).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
    $('#new', el).onclick = () => openNewInstance();
    $('#imp', el).onclick = () => openImport();
    draw();
    ctx.on('instances', draw);
    ctx.on('launch', draw);
    ctx.on('runs', draw);
    ctx.on('search-focus', () => $('#q', el).focus());
  },
};
