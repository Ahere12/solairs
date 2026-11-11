/* Tiny, safe markdown renderer for Modrinth descriptions (escapes first, then formats). */
function miniMarkdown(md) {
  let s = esc(md || '');
  s = s.replace(/&lt;img[^&]*?src=&quot;(https:[^&]+?)&quot;[^&]*?&gt;/gi, '<img src="$1">');
  s = s.replace(/&lt;\/?[a-z][^&]*?&gt;/gi, '');
  s = s.replace(/!\[([^\]]*)\]\((https:[^)\s]+)\)/g, '<img src="$2" alt="$1">');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  s = s.replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/^\s*[-*] (.*)$/gm, '• $1');
  return s.replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
}

Pages.browse = {
  TYPES: [['mod', 'Mods'], ['modpack', 'Modpacks'], ['resourcepack', 'Resource Packs'], ['shader', 'Shaders'], ['datapack', 'Datapacks']],
  /** A content-hub card: banner image, overlapping icon, title, downloads, description, author, install. */
  hubCard(p) {
    const banner = p.featured_gallery || (p.gallery && p.gallery[0]) || '';
    return `<div class="hub-card" data-pid="${esc(p.project_id)}" data-ptype="${esc(p.project_type || '')}">
      <div class="banner ${banner ? '' : 'blank'}" ${banner ? `style="background-image:url('${esc(banner)}')"` : ''}>${p.icon_url ? `<img class="pic" src="${esc(p.icon_url)}" loading="lazy" alt="">` : `<div class="pic"></div>`}</div>
      <div class="body2">
        <div class="info"><div class="t"><b title="${esc(p.title)}">${esc(p.title)}</b><span class="dl">${icon('download')}${fmtNum(p.downloads)}</span></div>
        <div class="d">${esc(p.description)}</div></div>
        <div class="foot"><span class="by">${icon('user')}${esc(p.author)}</span><button class="btn sm primary" data-quick="${esc(p.project_id)}">${icon('download')}${T('Install')}</button></div>
      </div>
    </div>`;
  },
  bindHub(root, type, target) {
    $$('[data-pid]', root).forEach((c) => (c.onclick = (e) => { if (e.target.closest('button')) return; this.details(c.dataset.pid, c.dataset.ptype || type, target); }));
    $$('[data-quick]', root).forEach((b) => (b.onclick = () => { const c = b.closest('[data-pid]'); this.install(b.dataset.quick, c?.dataset.ptype || type, target); }));
  },
  async render(el, params, ctx) {
    const target = params.instanceId ? State.instances.find((i) => i.id === params.instanceId) : null;
    const st = { type: params.type || 'mod', query: '', gameVersion: target?.versionId || '', loader: target && target.loader.type !== 'vanilla' ? target.loader.type : '', cats: new Set(), sort: 'relevance', offset: 0, total: 0 };
    let view = localStorage.getItem('browse.view') || 'grid';
    const typeLabel = () => this.TYPES.find(([k]) => k === st.type)[1];
    el.innerHTML = `
      <div class="page-head"><div><h1>${T('Browse')}</h1><div class="sub">${target ? `Installing into <b>${esc(target.name)}</b> · ${esc(target.versionId)} · ${loaderLabel(target)} <a href="#" id="clear-target">(any instance)</a>` : 'Find and install modpacks, mods, shaders and resource packs'}</div></div></div>
      <div class="search big">${icon('search')}<input type="search" id="q" placeholder="${T('Search')} ${esc(typeLabel().toLowerCase())}…"></div>
      <div class="hub-bar">
        <h2 id="type-title">${esc(typeLabel())}</h2><span class="cnt" id="count"></span>
        <div class="grow"></div>
        <span class="chip">${icon('globe')}Modrinth</span>
        <div class="seg icons" id="view"><button data-v="grid" title="Grid">${icon('grid')}</button><button data-v="list" title="List">${icon('list')}</button></div>
      </div>
      <div class="hub-filters">
        <select id="f-type">${this.TYPES.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
        <select id="f-cat"><option value="">All categories</option></select>
        <select id="f-ver"><option value="">Any version</option></select>
        <select id="f-loader"><option value="">Any loader</option><option value="fabric">Fabric</option><option value="quilt">Quilt</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option></select>
        <select id="sort"><option value="relevance">Relevance</option><option value="downloads">Downloads</option><option value="follows">Follows</option><option value="newest">Newest</option><option value="updated">Recently updated</option></select>
      </div>
      <div class="hub-grid" id="results"></div>
      <div class="row" style="justify-content:center;margin-top:16px"><button class="btn hidden" id="more">Load more</button></div>`;
    if (target) $('#clear-target', el).onclick = (e) => { e.preventDefault(); Router.go('browse', { type: st.type }, { replace: true }); };
    $('#f-type', el).value = st.type;
    const applyView = () => { $('#results', el).classList.toggle('as-list', view === 'list'); $$('[data-v]', el).forEach((b) => b.classList.toggle('on', b.dataset.v === view)); };
    applyView();
    const versions = (await getVersions()).filter((v) => v.type === 'release');
    $('#f-ver', el).innerHTML += versions.map((v) => `<option>${esc(v.id)}</option>`).join('');
    $('#f-ver', el).value = st.gameVersion;
    $('#f-loader', el).value = st.loader;
    let tags = null;
    const drawCats = async () => {
      tags = tags || (await api('modrinth:tags').catch(() => ({ categories: [] })));
      const cats = tags.categories.filter((c) => c.project_type === (st.type === 'datapack' ? 'mod' : st.type) && c.header !== 'resolutions');
      $('#f-cat', el).innerHTML = `<option value="">All categories</option>` + cats.map((c) => `<option value="${esc(c.name)}">${esc(c.name.replace(/-/g, ' ').replace(/^\w/, (m) => m.toUpperCase()))}</option>`).join('');
      $('#f-cat', el).value = [...st.cats][0] || '';
      $('#f-loader', el).disabled = !['mod', 'modpack'].includes(st.type);
      $('#type-title', el).textContent = typeLabel();
      $('#q', el).placeholder = `${T('Search')} ${typeLabel().toLowerCase()}…`;
    };
    let seq = 0;
    const search = async (append = false) => {
      const my = ++seq;
      if (!append) { st.offset = 0; $('#results', el).innerHTML = '<div class="faint">Searching…</div>'; }
      try {
        const r = await api('modrinth:search', { query: st.query, type: st.type, gameVersion: st.gameVersion, loader: st.loader, categories: [...st.cats], sort: st.sort, offset: st.offset });
        if (my !== seq) return;
        st.total = r.total_hits;
        $('#count', el).textContent = `(${fmtNum(r.total_hits)} results)`;
        const html = r.hits.map((p) => this.hubCard({ ...p, project_type: st.type === 'datapack' ? 'datapack' : p.project_type || st.type })).join('');
        if (append) $('#results', el).insertAdjacentHTML('beforeend', html); else $('#results', el).innerHTML = html || `<div class="empty" style="grid-column:1/-1">${icon('search')}<div>Nothing found.</div></div>`;
        $('#more', el).classList.toggle('hidden', st.offset + r.hits.length >= st.total);
        this.bindHub($('#results', el), st.type, target);
      } catch (e) { $('#results', el).innerHTML = `<div class="empty" style="grid-column:1/-1">${icon('alert')}<div>${esc(e.message)}</div></div>`; }
    };
    $('#f-type', el).onchange = (e) => { st.type = e.target.value; st.cats.clear(); drawCats(); search(); };
    $('#f-cat', el).onchange = (e) => { st.cats.clear(); if (e.target.value) st.cats.add(e.target.value); search(); };
    $$('[data-v]', el).forEach((b) => (b.onclick = () => { view = b.dataset.v; localStorage.setItem('browse.view', view); applyView(); }));
    $('#q', el).oninput = debounce((e) => { st.query = e.target.value; search(); }, 300);
    $('#sort', el).onchange = (e) => { st.sort = e.target.value; search(); };
    $('#f-ver', el).onchange = (e) => { st.gameVersion = e.target.value; search(); };
    $('#f-loader', el).onchange = (e) => { st.loader = e.target.value; search(); };
    $('#more', el).onclick = () => { st.offset += 24; search(true); };
    ctx.on('search-focus', () => $('#q', el).focus());
    drawCats(); search();
  },

  async details(id, type, target) {
    const m = modal({ title: 'Loading…', wide: true, body: '<div class="faint">Loading project…</div>' });
    try {
      const p = await api('modrinth:project', id);
      m.el.querySelector('header h2').textContent = p.title;
      m.$('.content').innerHTML = `
        <div class="row" style="gap:16px;margin-bottom:14px;align-items:flex-start">
          ${p.icon_url ? `<img src="${esc(p.icon_url)}" style="width:84px;height:84px;border-radius:16px">` : ''}
          <div class="grow"><div class="muted">${esc(p.description)}</div><div class="row wrap" style="margin-top:8px"><span class="chip">${icon('download')}${fmtNum(p.downloads)}</span><span class="chip">${icon('star')}${fmtNum(p.followers)}</span>${p.categories.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}${p.client_side === 'unsupported' ? '<span class="chip warn">Server-side</span>' : ''}</div></div>
          <div class="stack"><button class="btn primary" data-install>${icon('download')}${T('Install')}</button><button class="btn ghost sm" data-web>${icon('globe')}Modrinth page</button></div>
        </div>
        ${p.gallery?.length ? `<div class="gallery-strip">${p.gallery.map((g) => `<img src="${esc(g.url)}" data-full="${esc(g.raw_url || g.url)}" loading="lazy">`).join('')}</div>` : ''}
        <div class="tabs" style="margin-top:12px"><button class="on" data-dt="desc">Description</button><button data-dt="versions">Versions</button></div>
        <div id="dt"></div>`;
      const showDesc = () => (m.$('#dt').innerHTML = `<div class="md">${miniMarkdown(p.body)}</div>`);
      const showVersions = async () => {
        m.$('#dt').innerHTML = '<div class="faint">Loading versions…</div>';
        const vs = await api('modrinth:versions', id, {});
        m.$('#dt').innerHTML = `<div class="list">${vs.slice(0, 60).map((v) => `<div class="list-row"><div class="info"><div class="title">${esc(v.name || v.version_number)} <span class="chip ${v.version_type === 'release' ? 'ok' : 'warn'}">${esc(v.version_type)}</span></div><div class="desc">${esc(v.game_versions.slice(-4).join(', '))} · ${esc(v.loaders.join(', '))} · ${fmtDate(v.date_published)}</div></div>
          <button class="btn sm ghost" data-cl="${esc(v.id)}">Changelog</button><button class="btn sm" data-iv="${esc(v.id)}">${T('Install')}</button></div>`).join('')}</div>`;
        $$('[data-cl]', m.el).forEach((b) => (b.onclick = () => { const v = vs.find((x) => x.id === b.dataset.cl); modal({ title: `${p.title} ${v.version_number}`, body: `<div class="md">${miniMarkdown(v.changelog || 'No changelog provided.')}</div>` }); }));
        $$('[data-iv]', m.el).forEach((b) => (b.onclick = () => { const v = vs.find((x) => x.id === b.dataset.iv); this.install(id, p.project_type, target, v); }));
      };
      $$('[data-dt]', m.el).forEach((b) => (b.onclick = () => { $$('[data-dt]', m.el).forEach((x) => x.classList.toggle('on', x === b)); b.dataset.dt === 'desc' ? showDesc() : showVersions(); }));
      $$('.gallery-strip img', m.el).forEach((img) => (img.onclick = () => lightbox(img.dataset.full)));
      m.$('[data-install]').onclick = () => this.install(id, p.project_type, target);
      m.$('[data-web]').onclick = () => api('shell:open', `https://modrinth.com/${p.project_type}/${p.slug}`);
      showDesc();
    } catch (e) { m.$('.content').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  },

  async install(projectId, type, target, version = null) {
    if (type === 'modpack') {
      try {
        let vid = version?.id;
        if (!vid) { const vs = await api('modrinth:versions', projectId, {}); vid = (vs.find((v) => v.version_type === 'release') || vs[0])?.id; }
        if (!vid) return toast('No versions available', 'error');
        toast('Installing modpack — this can take a while', 'info');
        const inst = await api('modrinth:installModpack', { versionId: vid });
        await refreshInstances();
        toast(`Installed ${inst.name}`);
        Router.go('library', { spotlight: inst.id });
      } catch (e) { toastErr(e); }
      return;
    }
    let inst = target;
    if (!inst) {
      const compatLoaders = type === 'mod' ? (version ? version.loaders : null) : null;
      inst = await chooseInstance({
        title: `Install into…`,
        filter: (i) => (type !== 'mod' || i.loader.type !== 'vanilla') && (!version || version.game_versions.includes(i.versionId)) && (!compatLoaders || compatLoaders.includes(i.loader.type) || (i.loader.type === 'quilt' && compatLoaders.includes('fabric'))),
        note: type === 'mod' ? 'Only modded instances are shown.' : '',
      });
      if (!inst) return;
    }
    let world;
    if (type === 'datapack') {
      const ws = await api('instances:worlds', inst.id);
      if (!ws.length) return toast('This instance has no worlds yet — play once first.', 'warn');
      world = await new Promise((res) => {
        const m = modal({ title: 'Install datapack into world', body: `<div class="list">${ws.map((w) => `<div class="list-row" style="cursor:pointer" data-w="${esc(w.name)}">${icon('world')}<div class="info"><div class="title">${esc(w.name)}</div></div></div>`).join('')}</div>`, onClose: () => res(null) });
        $$('[data-w]', m.el).forEach((r) => (r.onclick = () => { res(r.dataset.w); m.close(); }));
      });
      if (!world) return;
    }
    const key = 'install-' + projectId;
    State.tasks[key] = { label: `Installing into ${inst.name}`, progress: null }; Bus.emit('tasks');
    try {
      const r = await api('modrinth:install', inst.id, { projectId, versionId: version?.id, projectType: type, world });
      toast(`Installed ${r.map((x) => x.file).join(', ')}`);
    } catch (e) { toastErr(e); }
    finally { delete State.tasks[key]; Bus.emit('tasks'); }
  },
};

function lightbox(src, actions = '') {
  const d = document.createElement('div');
  d.className = 'lightbox';
  d.innerHTML = `<div><img src="${esc(src)}"><div class="bar">${actions}<button class="btn" data-x>${icon('close')}Close</button></div></div>`;
  document.body.appendChild(d);
  const close = () => { d.remove(); document.removeEventListener('keydown', k); };
  const k = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', k);
  d.onclick = (e) => { if (e.target === d || e.target.closest('[data-x]')) close(); };
  return { el: d, close };
}
