/**
 * Markdown renderer for Modrinth descriptions and changelogs. Modrinth bodies mix Markdown with HTML (<a>, <img>,
 * <center>, <details> …): Markdown is turned into HTML first, then everything goes through safeHtml's allow-list,
 * so only basic formatting, https links and https images survive. Returns an HTML string.
 */
function miniMarkdown(md) {
  const blocks = [];
  const keep = (html) => `\u0000${blocks.push(html) - 1}\u0000`;
  let s = String(md || '').replace(/\r\n?/g, '\n');
  // code first, so nothing inside it is formatted
  s = s.replace(/```([^`\n]+?)```/g, (_m, code) => keep(`<code>${esc(code)}</code>`)); // ```inline``` on one line
  s = s.replace(/^[ \t]*```[^\n`]*\n([\s\S]*?)\n?[ \t]*```[ \t]*$/gm, (_m, code) => keep(`<pre><code>${esc(code)}</code></pre>`));
  s = s.replace(/`([^`\n]+)`/g, (_m, code) => keep(`<code>${esc(code)}</code>`));
  // images (also inside links: badges), then links
  const TITLE = String.raw`(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?`; // optional "title", 'title' or (title)
  s = s.replace(new RegExp(String.raw`!\[([^\]]*)\]\(\s*<?(https?:[^)\s>]+)>?` + TITLE + String.raw`\s*\)`, 'g'), (_m, alt, src) => `<img src="${esc(src)}" alt="${esc(alt)}">`);
  s = s.replace(new RegExp(String.raw`\[((?:[^\[\]]|<img[^>]*>)+)\]\(\s*<?(https?:[^)\s>]+)>?` + TITLE + String.raw`\s*\)`, 'g'), (_m, text, href) => `<a href="${esc(href)}">${text}</a>`);
  // a link written around another link ([[url](url)](url)): keep the outer one
  s = s.replace(new RegExp(String.raw`\[<a href="[^"]*">([^<]*)</a>\]\(\s*<?(https?:[^)\s>]+)>?` + TITLE + String.raw`\s*\)`, 'g'), (_m, text, href) => `<a href="${esc(href)}">${text}</a>`);
  // headings, rules, quotes, lists
  s = s.replace(/^(#{1,6})\s+(.*?)\s*#*$/gm, (_m, h, t) => `<h${Math.min(4, h.length)}>${t}</h${Math.min(4, h.length)}>`);
  s = s.replace(/^\s*([-*_])(\s*\1){2,}\s*$/gm, '<hr>');
  s = s.replace(/^>\s?(.*)$/gm, '<blockquote>$1</blockquote>');
  s = s.replace(/(?:^[ \t]*[-*+] .*(?:\n|$))+/gm, (list) => `<ul>${list.trim().split('\n').map((l) => `<li>${l.replace(/^[ \t]*[-*+] /, '')}</li>`).join('')}</ul>`);
  s = s.replace(/(?:^[ \t]*\d+[.)] .*(?:\n|$))+/gm, (list) => `<ol>${list.trim().split('\n').map((l) => `<li>${l.replace(/^[ \t]*\d+[.)] /, '')}</li>`).join('')}</ol>`);
  // emphasis
  s = s.replace(/\*{4,}/g, ''); // "****" (an empty bold) shows nothing on Modrinth either
  // bold may wrap onto the next line, but not across a blank line
  s = s.replace(/\*\*((?:(?!\n\n)[^*])+?)\*\*|__((?:(?!\n\n)[^_])+?)__/g, (_m, a, b) => `<b>${a || b}</b>`);
  s = s.replace(/(^|[\s(])\*([^*\s](?:[^*\n]*[^*\s])?)\*(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>'); // *word*, not 2 * 3 * 4
  s = s.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  // bare links
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)"']+)/g, (_m, pre, url) => `${pre}<a href="${esc(url)}">${esc(url)}</a>`);
  // paragraphs and line breaks (not right after block tags)
  s = s.replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>').replace(/(<\/(?:h\d|ul|ol|pre|blockquote)>|<hr>)(<br>)+/g, '$1');
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i) => blocks[+i]);
  const box = document.createElement('div');
  box.appendChild(safeHtml(s));
  return box.innerHTML;
}

/** Allow-list sanitiser for CurseForge's HTML descriptions: only basic formatting, https links and images survive. */
function safeHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const OK = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'DEL', 'SUB', 'SUP', 'SMALL', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'IMG', 'CODE', 'PRE', 'BLOCKQUOTE', 'SPAN', 'DIV', 'CENTER', 'DETAILS', 'SUMMARY', 'HR', 'TABLE', 'TR', 'TD', 'TH', 'TBODY', 'THEAD']);
  const clean = (node) => {
    const frag = document.createDocumentFragment();
    for (const n of [...node.childNodes]) {
      if (n.nodeType === 3) { frag.appendChild(document.createTextNode(n.textContent)); continue; }
      if (n.nodeType !== 1) continue;
      if (!OK.has(n.tagName)) { if (!['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED'].includes(n.tagName)) frag.appendChild(clean(n)); continue; }
      const el = document.createElement(n.tagName);
      if (n.tagName === 'A' && /^https?:\/\//i.test(n.getAttribute('href') || '')) { el.setAttribute('href', n.getAttribute('href')); el.setAttribute('target', '_blank'); }
      if (n.tagName === 'IMG') {
        const src = n.getAttribute('src') || ''; if (!/^https:\/\//i.test(src)) continue;
        el.setAttribute('src', src); el.setAttribute('loading', 'lazy');
        if (n.getAttribute('alt')) el.setAttribute('alt', n.getAttribute('alt'));
        for (const a of ['width', 'height']) { const v = n.getAttribute(a); if (/^\d{1,4}%?$/.test(v || '')) el.setAttribute(a, v); } // badge / banner sizes
      }
      if (n.tagName === 'CENTER' || (n.tagName === 'DIV' && /center/i.test(n.getAttribute('align') || ''))) el.setAttribute('style', 'text-align:center');
      el.appendChild(clean(n));
      frag.appendChild(el);
    }
    return frag;
  };
  return clean(doc.body);
}

/** An SVG from Modrinth's API as an <img> data URL (no script can run from an image). currentColor gets `color`. */
function svgImg(svg, color = '#a1a1aa') {
  const s = String(svg || '').trim();
  if (!s.startsWith('<svg')) return '';
  let out = s.replace(/currentColor/g, color);
  // as an image an SVG needs its namespace; some of Modrinth's icons leave it out (they're meant to be inlined)
  if (!/^<svg[^>]*\sxmlns=/.test(out)) out = out.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  // icons drawn with no colour of their own would come out black
  if (!/(fill|stroke)=/.test(out)) out = out.replace(/^<svg/, `<svg fill="${color}"`);
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(out);
}

/** Installs started from the Content Hub this session — the download tray at the bottom of the page. */
const HubDownloads = {
  list: [], // { key, title, icon, state: 'busy' | 'ready' | 'failed', where }
  open: true,
  /** Runs an install and records it in the tray. `fn` resolves truthy on success (an instance, or true). */
  async track(p, fn) {
    const row = { key: `${p.source || 'modrinth'}:${p.project_id}:${Date.now()}`, title: p.title, icon: p.icon_url || null, state: 'busy', where: '' };
    this.list.unshift(row); this.list.splice(30); Bus.emit('hub-downloads');
    let res = false;
    try { res = await fn(); } catch (e) { toastErr(e); }
    row.state = res ? 'ready' : 'failed';
    if (res && res.name) row.where = res.name;
    if (res && res.id) row.instanceId = res.id;
    Bus.emit('hub-downloads');
    return res;
  },
  clear() { this.list = this.list.filter((r) => r.state === 'busy'); Bus.emit('hub-downloads'); },
  draw(box) {
    if (!box) return;
    if (!this.list.length) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    const busy = this.list.filter((r) => r.state === 'busy').length, done = this.list.filter((r) => r.state === 'ready').length, bad = this.list.filter((r) => r.state === 'failed').length;
    const head = [busy && `${busy} downloading`, done && `${done} completed`, bad && `${bad} failed`].filter(Boolean).join(' · ');
    box.innerHTML = `<div class="hub-tray-head">${icon(busy ? 'refresh' : 'download', busy ? 'spin' : '')}<b>${esc(head)}</b><div class="grow"></div>
        <button class="icon-btn" data-tray="clear" title="Clear finished">${icon('close')}</button><button class="icon-btn" data-tray="fold" title="${this.open ? 'Hide' : 'Show'}">${icon(this.open ? 'chevron-down' : 'chevron-up')}</button></div>
      ${this.open ? `<div class="hub-tray-list">${this.list.map((r) => `<div class="hub-tray-row" ${r.instanceId ? `data-open-inst="${esc(r.instanceId)}" title="Open ${esc(r.where)}"` : ""}>${r.icon ? `<img src="${esc(r.icon)}" alt="">` : `<div class="ph">${icon('box')}</div>`}<span class="ellipsis"><b>${esc(r.title)}</b>${r.where && r.where !== r.title ? ` <span class="faint small">→ ${esc(r.where)}</span>` : ''}</span>
        <span class="chip ${r.state === 'ready' ? 'ok' : r.state === 'failed' ? 'danger' : ''}">${r.state === 'ready' ? 'Ready' : r.state === 'failed' ? 'Failed' : 'Installing…'}</span></div>`).join('')}</div>` : ''}`;
    $('[data-tray="clear"]', box).onclick = () => this.clear();
    $$('[data-open-inst]', box).forEach((x) => (x.onclick = () => Router.go('instance', { id: x.dataset.openInst })));
    $('[data-tray="fold"]', box).onclick = () => { this.open = !this.open; this.draw(box); };
  },
};

Pages.browse = {
  TYPES: [['modpack', 'Modpacks'], ['mod', 'Mods'], ['resourcepack', 'Resource Packs'], ['shader', 'Shaders'], ['datapack', 'Datapacks'], ['map', 'Maps']],
  LOADERS: [['fabric', 'Fabric'], ['legacy-fabric', 'Legacy Fabric'], ['babric', 'Babric'], ['ornithe', 'Ornithe'], ['forge', 'Forge'], ['neoforge', 'NeoForge'], ['quilt', 'Quilt']],
  SORTS: [['relevance', 'Relevance'], ['downloads', 'Downloads'], ['follows', 'Follows'], ['newest', 'Newest'], ['updated', 'Recently updated']],
  /** A content-hub card: banner image, overlapping icon, source badge, title, downloads, description, author, install. */
  hubCard(p) {
    const banner = p.featured_gallery || (p.gallery && p.gallery[0]) || '';
    const cf = p.source === 'curseforge';
    return `<div class="hub-card" data-pid="${esc(p.project_id)}" data-ptype="${esc(p.project_type || '')}" data-src="${esc(p.source || 'modrinth')}">
      <div class="banner ${banner ? '' : 'blank'}" ${banner ? `style="background-image:url('${esc(banner)}')"` : ''}>${p.icon_url ? `<img class="pic" src="${esc(p.icon_url)}" loading="lazy" decoding="async" alt="">` : `<div class="pic"></div>`}<span class="src-badge ${cf ? 'cf' : 'mr'}" title="${cf ? 'CurseForge' : 'Modrinth'}">${icon(cf ? 'curseforge' : 'modrinth')}</span></div>
      <div class="body2">
        <div class="info"><div class="t"><b title="${esc(p.title)}">${esc(p.title)}</b><span class="dl">${icon('download')}${fmtNum(p.downloads)}</span></div>
        <div class="d">${esc(p.description)}</div></div>
        <div class="foot"><span class="by">${icon('user')}${esc(p.author)}</span><button class="btn sm primary" data-quick="${esc(p.project_id)}">${icon('download')}${T('Install')}</button></div>
      </div>
    </div>`;
  },
  /** One install from the hub: shows progress on the button and in the download tray. */
  installHit(btn, hit, type, target, extra) {
    const p = { ...hit, source: hit.source || 'modrinth' };
    return installFeedback(btn, () => HubDownloads.track(p, () => {
      if (type === 'map') return this.mapInstall(p.project_id, target);
      return (p.source === 'curseforge' ? this.cfInstall : this.install).call(this, p.project_id, type, target, extra);
    }));
  },
  bindHub(root, type, target, hits = []) {
    const find = (id) => hits.find((h) => String(h.project_id) === String(id)) || { project_id: id, title: id };
    $$('[data-pid]', root).forEach((c) => (c.onclick = (e) => { if (e.target.closest('button')) return; (c.dataset.src === 'curseforge' ? this.cfDetails : this.details).call(this, c.dataset.pid, c.dataset.ptype || type, target); }));
    $$('[data-quick]', root).forEach((b) => (b.onclick = () => { const c = b.closest('[data-pid]'); this.installHit(b, { ...find(b.dataset.quick), source: c?.dataset.src }, type === 'map' ? 'map' : c?.dataset.ptype || type, target); }));
    if (target) $$('[data-quick]', root).forEach((b) => { if (InstalledHere.has(target.id, b.dataset.quick)) installFeedback.mark(b); });
  },
  /** CurseForge maps (worlds) go into an instance's saves folder. */
  async mapInstall(projectId, target) {
    const inst = target || await chooseInstance({ title: 'Install map into…' });
    if (!inst) return false;
    await api('discover:install', { provider: 'curseforge', id: projectId, kind: 'map', instanceId: inst.id });
    toast(`Map installed in ${inst.name}`);
    return inst;
  },
  async render(el, params, ctx) {
    const target = params.instanceId ? State.instances.find((i) => i.id === params.instanceId) : null;
    const st = {
      type: params.type || (target ? 'mod' : 'modpack'), query: params.q || '', gameVersion: target?.versionId || '', loader: target && target.loader.type !== 'vanilla' ? target.loader.type : '',
      cat: '', sort: params.type || target ? 'relevance' : 'downloads', offset: 0, total: 0, source: params.source || State.settings.browseSource || 'modrinth',
    };
    if (target && st.type === 'modpack') st.type = 'mod';
    let view = localStorage.getItem('browse.view') || 'grid';
    let hits = [];
    const typeLabel = () => this.TYPES.find(([k]) => k === st.type)[1];
    const sideMode = document.documentElement.dataset.layout === 'classic';
    const sel = (id, opts, cls = '') => `<label class="hub-sel ${cls}">${cls === 'sort' ? icon('sort') : ''}<select id="${id}">${opts}</select></label>`;
    el.innerHTML = `<div class="hub-wrap ${sideMode ? 'side' : ''}"><div class="hub-main">
      <div class="page-head"><div><h1>${T('Content Hub')}</h1><div class="sub">${target ? `Installing into <b>${esc(target.name)}</b> · ${esc(target.versionId)} · ${loaderLabel(target)} <a href="#" id="clear-target">(any instance)</a>` : 'Find and install amazing modpacks, mods, and resources'}</div></div></div>
      <div class="search big">${icon('search')}<input type="search" id="q" value="${esc(st.query)}" placeholder="${T('Search')} ${esc(typeLabel().toLowerCase().replace(/s$/, ''))}…"></div>
      <div class="hub-bar">
        <h2 id="type-title">${esc(typeLabel().replace(/s$/, ''))}</h2><span class="cnt" id="count"></span>
        <div class="grow"></div>
        <div class="seg" id="src"><button data-src="modrinth">${icon('modrinth')}Modrinth</button><button data-src="curseforge">${icon('curseforge')}CurseForge</button></div>
        <div class="seg icons" id="view"><button data-v="grid" title="Grid">${icon('grid')}</button><button data-v="list" title="List">${icon('list')}</button></div>
      </div>
      <div class="hub-filters">
        ${sel('f-type', this.TYPES.filter(([k]) => !target || k !== 'modpack').map(([k, l]) => `<option value="${k}">${l}</option>`).join(''))}
        ${sel('f-cat', '<option value="">All Categories</option>')}
        ${sel('f-ver', '<option value="">Any Version</option>')}
        ${sel('f-loader', `<option value="">Any Loader</option>${this.LOADERS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}`)}
        ${sel('sort', this.SORTS.map(([k, l]) => `<option value="${k}">${l}</option>`).join(''), 'sort')}
      </div>
      <div class="hub-grid" id="results"></div>
      <div class="row" style="justify-content:center;margin-top:16px"><button class="btn hidden" id="more">Load more</button></div>
      <div class="hub-tray" id="tray" hidden></div></div>${sideMode ? '<aside class="hub-side" id="hub-side"></aside>' : ''}</div>`;
    if (target) $('#clear-target', el).onclick = (e) => { e.preventDefault(); Router.go('browse', { type: st.type }, { replace: true }); };
    $('#f-type', el).value = st.type;
    $('#sort', el).value = st.sort;
    const applyView = () => { $('#results', el).classList.toggle('as-list', view === 'list'); $$('[data-v]', el).forEach((b) => b.classList.toggle('on', b.dataset.v === view)); };
    applyView();
    const versions = (await getVersions().catch(() => [])).filter((v) => v.type === 'release'); // offline: still usable without the version list
    if (!el.isConnected) return;
    $('#f-ver', el).innerHTML += versions.map((v) => `<option>${esc(v.id)}</option>`).join('');
    $('#f-ver', el).value = st.gameVersion;
    $('#f-loader', el).value = st.loader;
    HubDownloads.draw($('#tray', el));
    ctx.on('hub-downloads', () => HubDownloads.draw($('#tray', el)));
    // Maps only exist on CurseForge
    const source = () => (st.type === 'map' ? 'curseforge' : st.source);
    const drawSrc = () => {
      $$('#src [data-src]', el).forEach((b) => { b.classList.toggle('on', b.dataset.src === source()); b.disabled = st.type === 'map' && b.dataset.src === 'modrinth'; b.title = b.disabled ? 'Maps come from CurseForge' : ''; });
    };
    $$('#src [data-src]', el).forEach((b) => (b.onclick = () => { if (b.disabled) return; st.source = b.dataset.src; st.cat = ''; saveSettings({ browseSource: st.source }); drawSrc(); drawCats(); search(); }));
    drawSrc();
    let tags = null;
    const catSeq = { n: 0 };
    let catOpts = []; // [value, label, icon url]
    const drawCats = async () => {
      const my = ++catSeq.n;
      const fc = $('#f-cat', el);
      let opts = [];
      try {
        if (source() === 'curseforge') {
          if (await api('curseforge:available')) opts = (await api('curseforge:categories', st.type === 'map' ? 'world' : st.type)).map((c) => [String(c.id), c.name, /^https:/.test(c.icon || '') ? c.icon : '']);
        } else {
          tags = tags || (await api('modrinth:tags').catch(() => ({ categories: [] })));
          opts = tags.categories.filter((c) => c.project_type === (st.type === 'datapack' ? 'mod' : st.type) && c.header !== 'resolutions')
            .map((c) => [c.name, c.name.replace(/-/g, ' ').replace(/^\w/, (m) => m.toUpperCase()), svgImg(c.icon, '#a1a1aa')]);
        }
      } catch {}
      if (my !== catSeq.n || !el.isConnected) return;
      fc.innerHTML = `<option value="">All Categories</option>` + opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
      fc.value = st.cat;
      catOpts = opts;
      drawSide();
      $('#f-loader', el).disabled = !['mod', 'modpack'].includes(st.type);
      $('#type-title', el).textContent = typeLabel().replace(/s$/, '');
      $('#q', el).placeholder = `${T('Search')} ${typeLabel().toLowerCase().replace(/s$/, '')}…`;
    };
    /** Filter panel (Classic layout): chips that drive the same filters as the dropdowns. */
    const LCOL = { fabric: '#dbb26f', 'legacy-fabric': '#dbb26f', babric: '#dbb26f', ornithe: '#e0c36b', forge: '#6f8fdb', neoforge: '#e3893b', quilt: '#b27de8' };
    const setSel = (id, v) => { const s = $(id, el); if (!s) return; s.value = v; s.dispatchEvent(new Event('change')); };
    const drawSide = () => {
      const side = $('#hub-side', el); if (!side) return;
      const chip = (attr, on, label, ic = '') => `<button class="hs-chip ${on ? 'on' : ''}" ${attr}>${ic ? `<img src="${esc(ic)}" alt="">` : ''}${esc(label)}</button>`;
      const lIcon = (k) => svgImg(tags?.loaders?.find((l) => l.name === k)?.icon, LCOL[k] || '#a1a1aa');
      side.innerHTML = `<div class="hs-head">${icon('sliders')}<b>Filters</b><div class="grow"></div><button class="hs-clear" id="hs-clear">${icon('close')}Clear</button></div>
        <div class="hs-sec"><h5>Source</h5><div class="seg hs-src">${['modrinth', 'curseforge'].map((s) => `<button data-hsrc="${s}" class="${source() === s ? 'on' : ''}" ${st.type === 'map' && s === 'modrinth' ? 'disabled' : ''}>${icon(s)}${s === 'modrinth' ? 'Modrinth' : 'CurseForge'}</button>`).join('')}</div></div>
        <div class="hs-sec"><h5>Content type</h5><div class="hs-chips">${this.TYPES.filter(([k]) => !target || k !== 'modpack').map(([k, l]) => chip(`data-htype="${k}"`, st.type === k, l)).join('')}</div></div>
        <div class="hs-sec"><h5>Game version</h5><select id="hs-ver">${$('#f-ver', el).innerHTML}</select></div>
        ${['mod', 'modpack'].includes(st.type) ? `<div class="hs-sec"><h5>Mod loaders</h5><div class="hs-chips">${this.LOADERS.map(([k, l]) => chip(`data-hload="${k}"`, st.loader === k, l, lIcon(k))).join('')}</div></div>` : ''}
        ${catOpts.length ? `<div class="hs-sec"><h5>Categories</h5><div class="hs-chips">${catOpts.map(([v, l, ic]) => chip(`data-hcat="${esc(v)}"`, st.cat === v, l, ic)).join('')}</div></div>` : ''}`;
      $('#hs-ver', side).value = st.gameVersion;
      $('#hs-ver', side).onchange = (e) => setSel('#f-ver', e.target.value);
      $$('[data-hsrc]', side).forEach((b) => (b.onclick = () => $(`#src [data-src="${b.dataset.hsrc}"]`, el).click()));
      $$('[data-htype]', side).forEach((b) => (b.onclick = () => setSel('#f-type', b.dataset.htype)));
      $$('[data-hload]', side).forEach((b) => (b.onclick = () => setSel('#f-loader', st.loader === b.dataset.hload ? '' : b.dataset.hload)));
      $$('[data-hcat]', side).forEach((b) => (b.onclick = () => setSel('#f-cat', st.cat === b.dataset.hcat ? '' : b.dataset.hcat)));
      $('#hs-clear', side).onclick = () => {
        st.cat = ''; st.gameVersion = target?.versionId || ''; st.loader = target && target.loader.type !== 'vanilla' ? target.loader.type : '';
        $('#f-cat', el).value = ''; $('#f-ver', el).value = st.gameVersion; $('#f-loader', el).value = st.loader;
        search();
      };
    };
    let seq = 0, loadingMore = false;
    const search = async (append = false) => {
      if (append && loadingMore) return;
      const my = append ? seq : ++seq;
      if (append) { loadingMore = true; $('#more', el).innerHTML = `${icon('refresh', 'spin')}Loading more…`; }
      if (!append) { st.offset = 0; hits = []; $('#results', el).innerHTML = '<div class="faint">Searching…</div>'; }
      const src = source();
      if (!append) drawSide();
      try {
        if (src === 'curseforge' && !(await api('curseforge:available'))) {
          if (my !== seq) return;
          $('#count', el).textContent = '';
          $('#more', el).classList.add('hidden');
          // connect right here, once — no trip to Settings
          $('#results', el).innerHTML = `<div class="card stack" style="grid-column:1/-1;max-width:560px;margin:8px auto"><div class="row" style="gap:10px">${icon('globe')}<b class="grow">Connect CurseForge</b></div>
            <div class="faint small">Paste your CurseForge API key once and every CurseForge mod, modpack and map shows up here. It’s encrypted on this PC.</div>
            <div class="row" style="gap:8px"><input type="password" id="cf-key-in" class="mono grow" placeholder="$2a$10$…" autocomplete="off" spellcheck="false"><button class="btn primary" id="cf-key-go">${icon('check')}Connect</button></div></div>`;
          const go = async () => {
            const b = $('#cf-key-go', el), v = $('#cf-key-in', el).value;
            if (!v.trim()) return;
            b.disabled = true; b.innerHTML = `${icon('refresh', 'spin')}Checking…`;
            try { State.settings = await api('curseforge:setKey', v); Bus.emit('settings', State.settings); toast('CurseForge connected'); drawCats(); search(); }
            catch (er) { toastErr(er); b.disabled = false; b.innerHTML = `${icon('check')}Connect`; }
          };
          $('#cf-key-go', el).onclick = go;
          $('#cf-key-in', el).onkeydown = (e) => { if (e.key === 'Enter') go(); };
          return;
        }
        const q = { query: st.query, type: st.type === 'map' ? 'world' : st.type, gameVersion: st.gameVersion, loader: ['mod', 'modpack'].includes(st.type) ? st.loader : '', sort: st.sort, offset: st.offset };
        if (src === 'curseforge') q.categoryId = st.cat; else q.categories = st.cat ? [st.cat] : [];
        const r = await api(src === 'curseforge' ? 'curseforge:search' : 'modrinth:search', q);
        if (my !== seq) return;
        st.total = r.total_hits;
        $('#count', el).textContent = `(${fmtNum(r.total_hits)} results)`;
        const page = r.hits.map((p) => ({ ...p, source: p.source || src, project_type: st.type === 'datapack' ? 'datapack' : st.type === 'map' ? 'map' : p.project_type || st.type }));
        hits.push(...page);
        const html = page.map((p) => this.hubCard(p)).join('');
        if (append) $('#results', el).insertAdjacentHTML('beforeend', html); else $('#results', el).innerHTML = html || `<div class="empty" style="grid-column:1/-1">${icon('search')}<div>Nothing found.</div></div>`;
        $('#more', el).classList.toggle('hidden', !r.hits.length || st.offset + r.hits.length >= st.total);
        this.bindHub($('#results', el), st.type, target, hits);
      } catch (e) {
        if (my !== seq) return;
        if (append) { st.offset -= 24; toastErr(e); } // keep what's shown; the button lets them try again
        else $('#results', el).innerHTML = `<div class="empty" style="grid-column:1/-1">${icon('alert')}<div>${esc(e.message)}</div></div>`;
      } finally {
        if (append) { loadingMore = false; if (el.isConnected) $('#more', el).textContent = 'Load more'; }
      }
      // tall window or short page: keep filling until the list scrolls
      const mb = $('#more', el);
      if (el.isConnected && mb && !mb.classList.contains('hidden') && mb.getBoundingClientRect().top < window.innerHeight + 600) setTimeout(() => mb.click(), 50);
    };
    // scrolling near the end loads the next page by itself
    const io = new IntersectionObserver((es) => { const mb = $('#more', el); if (es.some((e) => e.isIntersecting) && mb && !mb.classList.contains('hidden') && !loadingMore) mb.click(); }, { rootMargin: '0px 0px 600px 0px' });
    io.observe($('#more', el));
    $('#f-type', el).onchange = (e) => { st.type = e.target.value; st.cat = ''; drawSrc(); drawCats(); search(); };
    $('#f-cat', el).onchange = (e) => { st.cat = e.target.value; search(); };
    $$('[data-v]', el).forEach((b) => (b.onclick = () => { view = b.dataset.v; localStorage.setItem('browse.view', view); applyView(); }));
    $('#q', el).oninput = debounce((e) => { st.query = e.target.value; search(); }, 300);
    $('#sort', el).onchange = (e) => { st.sort = e.target.value; search(); };
    $('#f-ver', el).onchange = (e) => { st.gameVersion = e.target.value; search(); };
    $('#f-loader', el).onchange = (e) => { st.loader = e.target.value; search(); };
    $('#more', el).onclick = () => { if (loadingMore) return; st.offset += 24; search(true); };
    ctx.on('search-focus', () => $('#q', el).focus());
    if (sideMode && !tags) api('modrinth:tags').then((t) => { tags = tags || t; drawSide(); }).catch(() => {});
    drawCats(); search();
    return () => io.disconnect();
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
        $$('[data-iv]', m.el).forEach((b) => (b.onclick = () => { const v = vs.find((x) => x.id === b.dataset.iv); this.installHit(b, { project_id: id, title: p.title, icon_url: p.icon_url, source: 'modrinth' }, p.project_type, target, v); }));
      };
      $$('[data-dt]', m.el).forEach((b) => (b.onclick = () => { $$('[data-dt]', m.el).forEach((x) => x.classList.toggle('on', x === b)); b.dataset.dt === 'desc' ? showDesc() : showVersions(); }));
      $$('.gallery-strip img', m.el).forEach((img) => (img.onclick = () => lightbox(img.dataset.full)));
      m.$('[data-install]').onclick = (e) => this.installHit(e.currentTarget, { project_id: id, title: p.title, icon_url: p.icon_url, source: 'modrinth' }, p.project_type, target);
      if (target && InstalledHere.has(target.id, id)) installFeedback.mark(m.$('[data-install]'));
      m.$('[data-web]').onclick = () => api('shell:open', `https://modrinth.com/${p.project_type}/${p.slug}`);
      showDesc();
    } catch (e) { m.$('.content').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  },

  /* ---------- CurseForge ---------- */
  async cfDetails(id, type, target) {
    const m = modal({ title: 'Loading…', wide: true, body: '<div class="faint">Loading project…</div>' });
    try {
      const p = await api('curseforge:project', id);
      m.el.querySelector('header h2').textContent = p.title;
      m.$('.content').innerHTML = `
        <div class="row" style="gap:16px;margin-bottom:14px;align-items:flex-start">
          ${p.icon_url ? `<img src="${esc(p.icon_url)}" style="width:84px;height:84px;border-radius:16px">` : ''}
          <div class="grow"><div class="muted">${esc(p.description)}</div><div class="row wrap" style="margin-top:8px"><span class="chip src-cf">CurseForge</span><span class="chip">${icon('download')}${fmtNum(p.downloads)}</span><span class="chip">${icon('user')}${esc(p.author)}</span>${p.categories.slice(0, 5).map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div></div>
          <div class="stack"><button class="btn primary" data-install>${icon('download')}${T('Install')}</button>${p.url ? `<button class="btn ghost sm" data-web>${icon('globe')}CurseForge page</button>` : ''}</div>
        </div>
        ${p.gallery?.length ? `<div class="gallery-strip">${p.gallery.map((g) => `<img src="${esc(g)}" data-full="${esc(g)}" loading="lazy">`).join('')}</div>` : ''}
        <div class="tabs" style="margin-top:12px"><button class="on" data-dt="desc">Description</button><button data-dt="versions">Files</button></div>
        <div id="dt"></div>`;
      const showDesc = () => { m.$('#dt').innerHTML = '<div class="md"></div>'; m.$('#dt .md').appendChild(safeHtml(p.body_html)); };
      const showVersions = async () => {
        m.$('#dt').innerHTML = '<div class="faint">Loading files…</div>';
        const fs = await api('curseforge:files', id, target ? { gameVersion: target.versionId, loader: target.loader.type !== 'vanilla' ? target.loader.type : '' } : {});
        m.$('#dt').innerHTML = fs.length ? `<div class="list">${fs.map((f) => `<div class="list-row"><div class="info"><div class="title">${esc(f.name)} <span class="chip ${f.type === 'release' ? 'ok' : 'warn'}">${esc(f.type)}</span></div><div class="desc">${esc(f.gameVersions.slice(-4).join(', '))}${f.loaders.length ? ' · ' + esc(f.loaders.join(', ')) : ''} · ${fmtDate(f.date)}</div></div>
          <button class="btn sm" data-iv="${esc(f.id)}">${T('Install')}</button></div>`).join('')}</div>` : '<div class="empty">No files match this instance.</div>';
        $$('[data-iv]', m.el).forEach((b) => (b.onclick = () => this.installHit(b, { project_id: id, title: p.title, icon_url: p.icon_url, source: 'curseforge' }, type, target, fs.find((x) => x.id === b.dataset.iv))));
      };
      $$('[data-dt]', m.el).forEach((b) => (b.onclick = () => { $$('[data-dt]', m.el).forEach((x) => x.classList.toggle('on', x === b)); b.dataset.dt === 'desc' ? showDesc() : showVersions(); }));
      $$('.gallery-strip img', m.el).forEach((img) => (img.onclick = () => lightbox(img.dataset.full)));
      m.$('[data-install]').onclick = (e) => this.installHit(e.currentTarget, { project_id: id, title: p.title, icon_url: p.icon_url, source: 'curseforge' }, type, target);
      if (p.url) m.$('[data-web]').onclick = () => api('shell:open', p.url);
      showDesc();
    } catch (e) { m.$('.content').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  },
  async cfInstall(projectId, type, target, file = null) {
    if (type === 'modpack') {
      try {
        toast('Installing modpack — this can take a while', 'info');
        const inst = await api('curseforge:installModpack', { projectId, fileId: file?.id });
        await refreshInstances();
        toast(`Installed ${inst.name}`);
        // stay in the Content Hub: the download tray shows it as Ready (click it to open the instance)
        return inst;
      } catch (e) { toastErr(e); return false; }
    }
    let inst = target;
    if (!inst) {
      inst = await chooseInstance({
        title: 'Install into…',
        filter: (i) => (type !== 'mod' || i.loader.type !== 'vanilla') && (!file || !file.gameVersions.length || file.gameVersions.includes(i.versionId)),
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
    const key = 'install-cf-' + projectId;
    State.tasks[key] = { label: `Installing into ${inst.name}`, progress: null }; Bus.emit('tasks');
    try {
      const r = await api('curseforge:install', inst.id, { projectId, fileId: file?.id, world });
      toast(`Installed ${r.map((x) => x.file).join(', ')} in ${inst.name}`);
      return inst;
    } catch (e) { toastErr(e); return false; }
    finally { delete State.tasks[key]; Bus.emit('tasks'); }
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
        // stay in the Content Hub: the download tray shows it as Ready (click it to open the instance)
        return inst;
      } catch (e) { toastErr(e); return false; }
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
      toast(`Installed ${r.map((x) => x.file).join(', ')} in ${inst.name}`);
      return inst;
    } catch (e) { toastErr(e); return false; }
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
