Pages.library = {
  card(i) {
    const running = isRunning(i.id);
    const status = launchLabel(i.id);
    const loader = i.loader?.type || 'vanilla';
    return `<div class="inst-card ${running ? 'running' : ''} ${State.settings.selectedInstance === i.id ? 'selected' : ''}" data-inst="${esc(i.id)}">
      <div class="top">${instIcon(i)}
        <span class="when">${i.pinned ? `<span class="pin" title="Pinned">${icon('starFill')}</span>` : ''}${icon('calendar')}${i.lastPlayed ? esc(timeAgo(i.lastPlayed)) : 'Never'}</span>
      </div>
      <div class="name">${esc(i.name)}</div>
      <div class="ptime">${running ? '<span class="dot pulse"></span><span style="color:var(--ok)">Running</span>' : `${icon('clock')}${fmtDuration(i.playTime)}`}${i.solarisModules ? ' <span class="chip warn">Solaris</span>' : ''}</div>
      <div class="bottom">
        <span class="chip ${loader !== 'vanilla' ? 'accent' : 'ok'}">${icon(loader === 'vanilla' ? 'box' : 'layers')}${loaderLabel(i)}</span>
        <span class="chip vchip">${esc(i.versionId)}</span>
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
    let view = localStorage.getItem('lib.view') || 'grid';
    el.innerHTML = `
      <div class="page-head">
        <div><h1>${T('Library')}</h1><div class="sub">Manage your Minecraft instances</div></div>
        <div class="actions">
          <button class="btn" id="imp">${icon('download')}${T('Import')}</button>
          <button class="btn primary" id="new">${icon('plus')}${T('New instance')}</button>
        </div>
      </div>
      <div class="search big">${icon('search')}<input type="search" id="q" placeholder="Search instances…"></div>
      <div class="section-head">
        <h2>Instances</h2><span class="cnt" id="cnt"></span>
        <div class="seg" id="filter" style="margin-left:8px"><button data-g="all" class="on">All</button><button data-g="modded">Modded</button><button data-g="vanilla">Vanilla</button><button data-g="running">Running</button></div>
        <div class="grow"></div>
        <select id="sort"><option value="recent">Last played</option><option value="name">Name</option><option value="created">Newest</option><option value="playtime">Most played</option><option value="version">Version</option></select>
        <div class="seg icons" id="view"><button data-v="grid" title="Grid">${icon('grid')}</button><button data-v="list" title="List">${icon('list')}</button></div>
      </div>
      <div id="grid"></div>`;
    $('#sort', el).value = sort;
    const draw = () => {
      let list = State.instances.filter((i) => !query || (i.name + ' ' + i.versionId + ' ' + i.loader?.type).toLowerCase().includes(query));
      if (group === 'modded') list = list.filter((i) => i.loader?.type !== 'vanilla');
      if (group === 'vanilla') list = list.filter((i) => i.loader?.type === 'vanilla');
      if (group === 'running') list = list.filter((i) => isRunning(i.id));
      const cmp = { recent: (a, b) => b.lastPlayed - a.lastPlayed, name: (a, b) => a.name.localeCompare(b.name), created: (a, b) => b.created - a.created, playtime: (a, b) => b.playTime - a.playTime, version: (a, b) => b.versionId.localeCompare(a.versionId, undefined, { numeric: true }) }[sort];
      list.sort((a, b) => (b.pinned - a.pinned) || cmp(a, b));
      $('#cnt', el).textContent = `(${list.length} found)`;
      $$('[data-v]', el).forEach((b) => b.classList.toggle('on', b.dataset.v === view));
      const grid = $('#grid', el);
      grid.className = view === 'list' ? 'inst-list' : 'grid cols-auto';
      grid.innerHTML = list.length ? list.map((i) => this.card(i)).join('') : `<div class="empty" style="grid-column:1/-1">${icon('library')}<div>${State.instances.length ? 'No instances match.' : 'No instances yet. Create one or import from another launcher.'}</div></div>`;
      this.bindCards(grid);
      if (params.spotlight) { const c = $(`[data-inst="${CSS.escape(params.spotlight)}"]`, grid); if (c) { c.classList.add('spotlight'); c.scrollIntoView({ block: 'center' }); } params.spotlight = null; }
    };
    $('#q', el).oninput = (e) => { query = e.target.value.toLowerCase(); draw(); };
    $('#sort', el).onchange = (e) => { sort = e.target.value; localStorage.setItem('lib.sort', sort); draw(); };
    $$('[data-g]', el).forEach((b) => (b.onclick = () => { group = b.dataset.g; $$('[data-g]', el).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
    $$('[data-v]', el).forEach((b) => (b.onclick = () => { view = b.dataset.v; localStorage.setItem('lib.view', view); draw(); }));
    $('#new', el).onclick = () => openNewInstance();
    $('#imp', el).onclick = () => openImport();
    draw();
    ctx.on('instances', draw);
    ctx.on('launch', draw);
    ctx.on('runs', draw);
    ctx.on('settings', draw);
    ctx.on('search-focus', () => $('#q', el).focus());
  },
};
