Pages.instance = {
  async render(el, params, ctx) {
    let inst = await api('instances:get', params.id);
    let tab = params.tab || 'content';
    const head = () => {
      inst = State.instances.find((i) => i.id === inst.id) || inst;
      $('#ihead', el).innerHTML = `
        <div class="row" style="gap:18px;align-items:center">
          <div id="icon-btn" style="cursor:pointer" title="Change icon">${instIcon(inst, 'lg')}</div>
          <div style="min-width:0">
            <h1 style="margin:0;font-size:28px">${esc(inst.name)}</h1>
            <div class="row wrap" style="margin-top:6px">${instMeta(inst)}${inst.modpack ? `<span class="chip info">${esc(inst.modpack.name)} ${esc(inst.modpack.version || '')}</span>` : ''}${inst.importedFrom ? `<span class="chip">from ${esc(inst.importedFrom)}</span>` : ''}
              <span class="faint small">${fmtDuration(inst.playTime)} played · last ${timeAgo(inst.lastPlayed)}</span></div>
            <div class="launch-status" style="margin-top:6px">${esc(launchLabel(inst.id))}</div>
          </div>
          <div class="grow"></div>
          <button class="icon-btn" id="fold" title="Open folder">${icon('folder')}</button>
          <button class="icon-btn" id="more" title="More">${icon('more')}</button>
          ${playButton(inst, { size: 'lg' })}
        </div>`;
      $('#fold', el).onclick = () => api('instances:openFolder', inst.id);
      $('#more', el).onclick = (e) => instanceMenu(e, inst);
      $('#icon-btn', el).onclick = () => changeInstanceIcon(inst);
    };
    el.innerHTML = `<div id="ihead" class="inst-hero"></div>
      <div class="tabs" id="itabs">${instanceTabs().map((t) => `<button data-t="${t.id}">${esc(t.label)}</button>`).join('')}</div>
      <div id="ibody"></div>`;
    head();
    if (!instanceTabs().some((t) => t.id === tab)) tab = instanceTabs()[0]?.id || 'content';
    const show = (t) => {
      tab = t;
      $$('[data-t]', el).forEach((b) => b.classList.toggle('on', b.dataset.t === t));
      const body = $('#ibody', el);
      body.ondrop = null; body.ondragover = null;
      if (typeof this.unsub === 'function') this.unsub();
      this.unsub = null;
      // async tabs (worlds/settings) return a Promise — only keep real cleanup functions
      const r = this[t](body, inst);
      if (typeof r === 'function') this.unsub = r;
      else if (r && typeof r.then === 'function') r.then((fn) => { if (typeof fn === 'function') { if (tab === t) this.unsub = fn; else fn(); } }).catch((e) => { body.innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div></div>`; });
    };
    $$('[data-t]', el).forEach((b) => (b.onclick = () => show(b.dataset.t)));
    show(tab);
    ctx.on('instances', head);
    ctx.on('launch', (id) => id === inst.id && head());
    ctx.on('runs', head);
    return () => { if (typeof this.unsub === 'function') this.unsub(); this.unsub = null; };
  },

  /* ---------- content ---------- */
  content(body, inst) {
    let kind = 'mods', items = [], selected = new Set(), lastIdx = -1, filter = '', updates = null;
    body.innerHTML = `
      <div class="sticky-bar">
        <div class="seg" id="kinds"><button data-k="mods" class="on">Mods</button><button data-k="resourcepacks">Resource packs</button><button data-k="shaderpacks">Shaders</button></div>
        <div class="search" style="width:220px">${icon('search')}<input type="search" id="cf" placeholder="Filter…"></div>
        <div class="grow"></div>
        <button class="btn sm" id="upd">${icon('refresh')}Check updates</button>
        ${inst.modpack ? `<button class="btn sm" id="mp-upd">${icon('layers')}Modpack updates</button>` : ''}
        <button class="btn sm" id="tools">${icon('shield')}Tools</button>
        <button class="btn sm" id="addf">${icon('upload')}Add files</button>
        <button class="btn sm primary" id="browse">${icon('browse')}Browse</button>
      </div>
      <div id="bulk"></div>
      <div id="clist"></div>
      <div class="faint small" style="margin-top:10px">Tip: Ctrl/Shift+Click to select several · drop .jar / .zip files here to install them.</div>`;
    const load = async () => { items = await api('instances:content', inst.id, kind); selected.clear(); draw(); };
    const draw = () => {
      const list = items.filter((m) => !filter || (m.name + ' ' + m.file).toLowerCase().includes(filter));
      const box = $('#clist', body);
      if (!list.length) { box.innerHTML = `<div class="empty">${icon('box')}<div>No ${kind === 'mods' ? 'mods' : kind === 'shaderpacks' ? 'shader packs' : 'resource packs'} installed.</div>${inst.loader.type === 'vanilla' && kind === 'mods' ? '<div class="faint small">This is a vanilla instance — mods need Fabric, Quilt, Forge or NeoForge.</div>' : ''}</div>`; drawBulk(); return; }
      box.innerHTML = `<div class="list">${list.map((m, i) => {
        const up = updates && updates.find((u) => u.file === m.file);
        return `<div class="list-row ${m.enabled ? '' : 'disabled'} ${selected.has(m.file) ? 'selected' : ''}" data-i="${i}" data-file="${esc(m.file)}">
          ${m.icon ? `<img class="mod-icon" src="${esc(m.icon)}">` : `<div class="mod-icon">${icon(kind === 'mods' ? 'box' : 'image')}</div>`}
          <div class="info"><div class="title">${esc(m.name)} ${m.version ? `<span class="faint small">${esc(m.version)}</span>` : ''} ${sourceChip(m)} ${up?.latest ? `<span class="chip accent">Update → ${esc(up.latest.version)}</span>` : ''}</div><div class="desc">${esc(m.file)}${m.description ? ' · ' + esc(m.description) : ''}</div></div>
          <span class="faint small">${fmtBytes(m.size)}</span>
          ${up?.latest ? `<button class="btn sm" data-apply="${esc(m.file)}">${icon('download')}Update</button>` : ''}
          <label class="switch" title="${m.enabled ? 'Disable' : 'Enable'}"><input type="checkbox" data-toggle="${esc(m.file)}" ${m.enabled ? 'checked' : ''}><span></span></label>
          <button class="icon-btn" data-del="${esc(m.file)}" title="Delete">${icon('trash')}</button>
        </div>`;
      }).join('')}</div>`;
      $$('[data-i]', box).forEach((row) => (row.onclick = (e) => {
        if (e.target.closest('button,label,input')) return;
        const i = +row.dataset.i, f = row.dataset.file;
        if (e.shiftKey && lastIdx >= 0) { const [a, b] = [Math.min(lastIdx, i), Math.max(lastIdx, i)]; for (let k = a; k <= b; k++) selected.add(list[k].file); }
        else if (e.ctrlKey || e.metaKey) { selected.has(f) ? selected.delete(f) : selected.add(f); }
        else { const only = selected.size === 1 && selected.has(f); selected.clear(); if (!only) selected.add(f); }
        lastIdx = i; draw();
      }));
      $$('[data-toggle]', box).forEach((c) => (c.onchange = async () => { items = await api('instances:setEnabled', inst.id, kind, [c.dataset.toggle], c.checked); draw(); }));
      $$('[data-del]', box).forEach((b) => (b.onclick = async () => { if (await confirmDialog(`Move ${b.dataset.del} to the ${TRASH}?`, { danger: true, ok: T('Delete') })) { items = await api('instances:deleteContent', inst.id, kind, [b.dataset.del]); draw(); } }));
      $$('[data-apply]', box).forEach((b) => (b.onclick = async () => {
        const u = updates.find((x) => x.file === b.dataset.apply);
        b.disabled = true;
        try { await api('instances:applyUpdate', inst.id, kind, u.file, u.latest.id); updates = updates.filter((x) => x !== u); toast(`Updated ${u.name}`); load(); } catch (e) { toastErr(e); b.disabled = false; }
      }));
      drawBulk();
    };
    const drawBulk = () => {
      const bar = $('#bulk', body);
      if (!selected.size) { bar.innerHTML = ''; return; }
      bar.innerHTML = `<div class="bulk-bar" style="margin-bottom:10px"><b>${selected.size} selected</b><div class="grow"></div>
        <button class="btn sm" data-b="on">${icon('check')}Enable</button><button class="btn sm" data-b="off">${icon('eye')}Disable</button>
        <button class="btn sm danger" data-b="del">${icon('trash')}Delete</button><button class="btn sm ghost" data-b="clear">Clear</button></div>`;
      $$('[data-b]', bar).forEach((b) => (b.onclick = async () => {
        const files = [...selected];
        if (b.dataset.b === 'clear') { selected.clear(); return draw(); }
        if (b.dataset.b === 'del') { if (!(await confirmDialog(`Move ${files.length} file(s) to the ${TRASH}?`, { danger: true, ok: T('Delete') }))) return; items = await api('instances:deleteContent', inst.id, kind, files); }
        else items = await api('instances:setEnabled', inst.id, kind, files, b.dataset.b === 'on');
        selected.clear(); draw();
      }));
    };
    $$('[data-k]', body).forEach((b) => (b.onclick = () => { kind = b.dataset.k; updates = null; lastIdx = -1; resetUpd(); $$('[data-k]', body).forEach((x) => x.classList.toggle('on', x === b)); load(); }));
    $('#cf', body).oninput = (e) => { filter = e.target.value.toLowerCase(); draw(); };
    $('#browse', body).onclick = () => Router.go('browse', { type: kind === 'mods' ? 'mod' : kind === 'shaderpacks' ? 'shader' : 'resourcepack', instanceId: inst.id });
    $('#addf', body).onclick = async () => {
      const files = await api('dialog:open', { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Mods & packs', extensions: ['jar', 'zip', 'mrpack'] }] });
      if (files.length) { try { reportAdded(await api('instances:addFiles', inst.id, files, kind)); } catch (er) { toastErr(er); } load(); }
    };
    const updBtn = $('#upd', body);
    const resetUpd = () => { updBtn.disabled = false; updBtn.innerHTML = `${icon('refresh')}Check updates`; updBtn.onclick = checkUpdates; };
    const updateAll = async () => {
      updBtn.disabled = true;
      const todo = (updates || []).filter((x) => x.latest);
      let done = 0;
      for (const u of todo) {
        updBtn.innerHTML = `${icon('download')}Updating ${++done}/${todo.length}…`;
        try { await api('instances:applyUpdate', inst.id, kind, u.file, u.latest.id); } catch (er) { toastErr(er); }
      }
      updates = null; toast('All updates installed'); resetUpd(); load();
    };
    const checkUpdates = async () => {
      updBtn.disabled = true; updBtn.innerHTML = `${icon('refresh')}Checking…`;
      try {
        updates = await api('instances:checkUpdates', inst.id, kind);
        const n = updates.filter((u) => u.latest).length;
        toast(n ? `${n} update(s) available` : 'Everything is up to date', n ? 'info' : 'ok');
        draw();
        if (n > 1) { updBtn.innerHTML = `${icon('download')}Update all (${n})`; updBtn.disabled = false; updBtn.onclick = updateAll; return; }
      } catch (er) { toastErr(er); }
      resetUpd();
    };
    updBtn.onclick = checkUpdates;
    if ($('#mp-upd', body)) $('#mp-upd', body).onclick = () => modpackUpdates(inst, load);
    $('#tools', body).onclick = (e) => contextMenu(e.clientX, e.clientY, [
      { label: 'Find duplicate mods', icon: 'copy', action: async () => {
        const d = await api('instances:duplicates', inst.id);
        if (!d.length) return toast('No duplicate mods found');
        const m = modal({ title: 'Duplicate mods', body: d.map((x) => `<div class="card" style="margin-bottom:8px"><b>${esc(x.modId)}</b>${x.files.map((f) => `<div class="row small"><span class="mono grow">${esc(f.file)}</span><span class="faint">${esc(f.version || '')}</span></div>`).join('')}</div>`).join(''), footer: `<button class="btn primary" data-fix>Keep newest, remove others</button>` });
        m.$('[data-fix]').onclick = async () => { const del = d.flatMap((x) => [...x.files].sort((a, b) => b.mtime - a.mtime).slice(1).map((f) => f.file)); await api('instances:deleteContent', inst.id, 'mods', del); m.close(); toast(`Removed ${del.length} duplicate(s)`); load(); };
      } },
      { label: 'Scan for malware', icon: 'shield', action: async () => {
        toast('Scanning mods…', 'info');
        const r = await api('instances:scan', inst.id);
        const bad = r.filter((x) => !x.ok);
        modal({ title: bad.length ? `${bad.length} suspicious file(s)` : 'No threats found', body: `<p class="muted small">Heuristic scan for known malware indicators (fractureiser, credential stealers, webhook exfiltration). It is not a full antivirus.</p>${bad.length ? bad.map((x) => `<div class="crash-cause"><b>${esc(x.file)}</b>${x.findings.map((f) => `<div class="small muted">• ${esc(f)}</div>`).join('')}</div>`).join('') : `<div class="row">${icon('shield')}<span>Scanned ${r.length} mod(s) — all clean.</span></div>`}` });
      } },
      { label: 'Open folder', icon: 'folder', action: () => api('instances:openFolder', inst.id, kind) },
    ]);
    const onDrop = (e) => { e.preventDefault(); e.stopPropagation(); const files = [...e.dataTransfer.files].map((f) => window.solaris.pathForFile(f)); hideDrop(); api('instances:addFiles', inst.id, files).then((r) => { reportAdded(r); load(); if (r.modpacks) refreshInstances(); }).catch(toastErr); };
    // assign (not addEventListener) so switching tabs never stacks duplicate handlers
    body.ondrop = onDrop;
    body.ondragover = (e) => { if (!e.dataTransfer?.types.includes('Files')) return; e.preventDefault(); e.stopPropagation(); showDrop(`Drop to add to ${inst.name}`); };
    load();
  },

  /* ---------- worlds ---------- */
  async worlds(body, inst) {
    body.innerHTML = '<div class="faint">Loading worlds…</div>';
    const ws = await api('instances:worlds', inst.id);
    body.innerHTML = ws.length ? `<div class="grid cols-wide">${ws.map((w) => `<div class="card row">
        ${w.icon ? `<img src="${esc(w.icon)}" style="width:56px;height:56px;border-radius:10px;image-rendering:pixelated">` : `<div class="mod-icon" style="width:56px;height:56px">${icon('world')}</div>`}
        <div class="grow" style="min-width:0"><b>${esc(w.name)}</b><div class="faint small">Played ${timeAgo(w.lastPlayed)}</div></div>
        <button class="icon-btn" data-open="${esc(w.path)}" title="Open folder">${icon('folder')}</button>
        <button class="btn sm primary" data-qp="${esc(w.name)}">${icon('play')}Quick Play</button></div>`).join('')}</div>
        <p class="faint small">Quick Play opens the world directly (Minecraft 1.20+). Older versions start at the title screen.</p>`
      : `<div class="empty">${icon('world')}<div>No worlds yet — play once to create one.</div></div>`;
    $$('[data-open]', body).forEach((b) => (b.onclick = () => api('shell:openPath', b.dataset.open)));
    $$('[data-qp]', body).forEach((b) => (b.onclick = () => play(inst.id, { world: b.dataset.qp })));
  },

  /* ---------- console ---------- */
  console(body, inst) {
    const runs = Object.entries(State.runs).filter(([, r]) => r.instanceId === inst.id);
    const runId = runs.length ? runs[runs.length - 1][0] : null;
    if (!runId) { body.innerHTML = `<div class="empty">${icon('console')}<div>No logs yet for this session. Launch the game to see live output.</div></div>`; return; }
    return Pages.console.mount(body, runId);
  },

  /* ---------- files (built-in file explorer) ---------- */
  async files(body, inst, rel = '') {
    body.innerHTML = '<div class="faint">Loading…</div>';
    let r;
    try { r = await api('files:list', inst.id, rel); } catch (e) { if (rel) return this.files(body, inst, ''); throw e; }
    const crumbs = [{ name: inst.name, rel: '' }, ...r.rel.split('/').filter(Boolean).map((p, i, a) => ({ name: p, rel: a.slice(0, i + 1).join('/') }))];
    body.innerHTML = `<div class="sticky-bar">
        <div class="crumbs">${crumbs.map((c, i) => `<button class="crumb" data-go="${esc(c.rel)}">${i === 0 ? icon('folder') : ''}${esc(c.name)}</button>`).join('<span class="faint">/</span>')}</div>
        <div class="grow"></div>
        <button class="btn sm" id="fx-new">${icon('plus')}Folder</button>
        <button class="btn sm" id="fx-reveal">${icon('folder')}Show in folder</button>
      </div>
      <div class="list files-list">${r.rel ? `<div class="list-row file-row" data-up>${icon('back')}<div class="info"><div class="title">..</div></div></div>` : ''}
      ${r.entries.map((e) => `<div class="list-row file-row" data-rel="${esc(e.rel)}" data-dir="${e.dir ? 1 : ''}">
        <div class="mod-icon">${icon(e.dir ? 'folder' : /\.(png|jpe?g)$/i.test(e.name) ? 'image' : /\.(jar|zip)$/i.test(e.name) ? 'box' : 'file')}</div>
        <div class="info"><div class="title">${esc(e.name)}</div><div class="desc">${e.dir ? 'Folder' : fmtBytes(e.size)} · ${fmtDate(e.mtime)}</div></div>
        <button class="icon-btn" data-more="${esc(e.rel)}" title="More">${icon('more')}</button></div>`).join('') || '<div class="empty">This folder is empty.</div>'}</div>`;
    const go = (p) => this.files(body, inst, p);
    $$('[data-go]', body).forEach((b) => (b.onclick = () => go(b.dataset.go)));
    if ($('[data-up]', body)) $('[data-up]', body).onclick = () => go(r.rel.split('/').slice(0, -1).join('/'));
    $('#fx-reveal', body).onclick = () => (r.rel ? api('files:open', inst.id, r.rel) : api('instances:openFolder', inst.id));
    $('#fx-new', body).onclick = async () => { const n = await promptDialog('New folder', { placeholder: 'Folder name', ok: 'Create' }); if (n) { try { await api('files:mkdir', inst.id, r.rel, n.trim()); go(r.rel); } catch (e) { toastErr(e); } } };
    const openEntry = async (e) => {
      if (e.dir) return go(e.rel);
      if (/\.(png|jpe?g|gif)$/i.test(e.name)) return lightbox(fileUrl(inst.gameDir + '/' + e.rel));
      if (/\.(txt|log|gz|json|json5|toml|cfg|conf|properties|ini|ya?ml|mcmeta|md|csv|snbt|xml)$/i.test(e.name)) return this.viewFile(inst, e.rel, () => go(r.rel));
      api('files:open', inst.id, e.rel);
    };
    $$('[data-rel]', body).forEach((row) => {
      const e = r.entries.find((x) => x.rel === row.dataset.rel);
      row.ondblclick = () => openEntry(e);
      row.onclick = (ev) => { if (ev.target.closest('button')) return; if (e.dir) go(e.rel); };
      const menu = (ev) => contextMenu(ev.clientX, ev.clientY, [
        { label: e.dir ? 'Open' : 'View / open', icon: 'eye', action: () => openEntry(e) },
        { label: 'Open with default app', icon: 'external', action: () => api('files:open', inst.id, e.rel) },
        { label: 'Show in folder', icon: 'folder', action: () => api('files:reveal', inst.id, e.rel) },
        { label: 'Copy path', icon: 'copy', action: () => { api('clipboard:write', inst.gameDir + '\\' + e.rel.replace(/\//g, '\\')); toast('Path copied'); } },
        { label: 'Rename', icon: 'edit', action: async () => { const n = await promptDialog('Rename', { value: e.name, ok: 'Rename' }); if (n && n !== e.name) { try { await api('files:rename', inst.id, e.rel, n.trim()); go(r.rel); } catch (er) { toastErr(er); } } } },
        { label: `Move to ${TRASH}`, icon: 'trash', danger: true, action: async () => { if (await confirmDialog(`Move “${e.name}” to the ${TRASH}?`, { danger: true, ok: T('Delete') })) { try { await api('files:trash', inst.id, e.rel); go(r.rel); } catch (er) { toastErr(er); } } } },
      ]);
      row.oncontextmenu = (ev) => { ev.preventDefault(); menu(ev); };
      $('[data-more]', row).onclick = menu;
    });
  },
  async viewFile(inst, rel, onSaved) {
    let f;
    try { f = await api('files:read', inst.id, rel); } catch (e) { return toastErr(e); }
    const editable = !/\.(gz|log)$/i.test(rel) && !f.truncated;
    const m = modal({ title: rel.split('/').pop(), wide: true,
      body: `<textarea class="mono file-view" spellcheck="false" ${editable ? '' : 'readonly'}>${esc(f.text)}</textarea>`,
      footer: `<span class="faint small grow">${fmtBytes(f.size)}${editable ? '' : ' · read-only'}</span>
        ${/(logs|crash-reports)\//.test(rel) || /hs_err/.test(rel) ? `<button class="btn" data-share>${icon('upload')}Upload to mclo.gs</button>` : ''}
        <button class="btn" data-copy>${icon('copy')}Copy</button>${editable ? `<button class="btn primary" data-save>${icon('check')}${T('Save')}</button>` : ''}` });
    if (m.$('[data-share]')) m.$('[data-share]').onclick = () => shareText(f.text);
    m.$('[data-copy]').onclick = () => { api('clipboard:write', f.text); toast('Copied'); };
    if (editable) m.$('[data-save]').onclick = async () => { try { await api('files:write', inst.id, rel, m.$('textarea').value); toast('Saved'); m.close(); onSaved && onSaved(); } catch (e) { toastErr(e); } };
  },

  /* ---------- screenshots (this instance only) ---------- */
  async screenshots(body, inst) {
    body.innerHTML = '<div class="faint">Loading screenshots…</div>';
    const shots = (await api('gallery:list')).filter((s) => s.instanceId === inst.id);
    body.innerHTML = shots.length ? `<div class="row" style="margin-bottom:10px"><span class="faint small grow">${shots.length} screenshot${shots.length > 1 ? 's' : ''} · press F2 in-game to take one</span><button class="btn sm" id="sh-open">${icon('folder')}Open folder</button></div>
      <div class="shots-grid">${shots.map((s, i) => `<button class="shot-tile" data-i="${i}"><img src="${esc(fileUrl(s.path))}" loading="lazy" alt=""><span>${fmtDate(s.mtime)}</span></button>`).join('')}</div>`
      : `<div class="empty">${icon('image')}<div>No screenshots yet — press F2 in-game to take one.</div></div>`;
    if ($('#sh-open', body)) $('#sh-open', body).onclick = () => api('instances:openFolder', inst.id, 'screenshots');
    $$('[data-i]', body).forEach((b) => (b.onclick = () => {
      const s = shots[+b.dataset.i];
      const lb = lightbox(fileUrl(s.path), `<button class="btn" data-show>${icon('folder')}Show in folder</button><button class="btn danger" data-del>${icon('trash')}${T('Delete')}</button>`);
      $('[data-show]', lb.el).onclick = () => api('shell:showItem', s.path);
      $('[data-del]', lb.el).onclick = async () => { await api('gallery:delete', s.path); lb.close(); this.screenshots(body, inst); };
    }));
  },

  /* ---------- logs & crash reports ---------- */
  async logs(body, inst) {
    body.innerHTML = '<div class="faint">Loading logs…</div>';
    const list = await api('files:logs', inst.id);
    body.innerHTML = list.length ? `<p class="faint small" style="margin-top:0">Crash reports and game logs for this instance. Upload one to mclo.gs to get a link you can share when asking for help.</p>
      <div class="list">${list.map((l) => `<div class="list-row" data-rel="${esc(l.rel)}">
        <div class="mod-icon" style="color:${l.kind === 'crash' ? 'var(--danger)' : ''}">${icon(l.kind === 'crash' ? 'alert' : 'console')}</div>
        <div class="info"><div class="title">${esc(l.name)} ${l.kind === 'crash' ? '<span class="chip danger">Crash</span>' : ''}</div><div class="desc">${fmtDate(l.mtime)} · ${timeAgo(l.mtime)} · ${fmtBytes(l.size)}</div></div>
        <button class="btn sm" data-view="${esc(l.rel)}">${icon('eye')}View</button>
        <button class="btn sm" data-up="${esc(l.rel)}">${icon('upload')}Upload</button></div>`).join('')}</div>`
      : `<div class="empty">${icon('console')}<div>No logs or crash reports yet.</div></div>`;
    $$('[data-view]', body).forEach((b) => (b.onclick = () => this.viewFile(inst, b.dataset.view)));
    $$('[data-up]', body).forEach((b) => (b.onclick = async () => { try { shareText((await api('files:read', inst.id, b.dataset.up)).text); } catch (e) { toastErr(e); } }));
  },

  /* ---------- settings ---------- */
  async settings(body, inst) {
    const s = State.settings;
    const autoMem = await api('settings:autoMemory', inst.loader.type !== 'vanilla');
    const totalMb = Math.floor((State.info.totalMem || 8 * 1024 ** 3) / 1024 / 1024);
    const mem = inst.memory?.max || 0;
    body.innerHTML = `<div class="card" style="max-width:860px">
      <div class="setting"><div class="txt"><div class="t">Name</div></div><div class="ctl"><input type="text" id="s-name" value="${esc(inst.name)}" style="width:280px"></div></div>
      <div class="setting"><div class="txt"><div class="t">Version & loader</div><div class="d">${esc(inst.versionId)} · ${loaderLabel(inst)} ${inst.loader.version ? esc(inst.loader.version) : ''}</div></div><div class="ctl"><button class="btn sm" id="s-ver">${icon('edit')}Change</button></div></div>
      <div class="setting"><div class="txt"><div class="t">Memory</div><div class="d">${mem ? `${mem} MB` : `Automatic (${autoMem} MB based on your ${Math.round(totalMb / 1024)} GB RAM)`}</div>
        <input type="range" id="s-mem" min="0" max="${Math.min(totalMb - 1024, 32768)}" step="256" value="${mem}" style="margin-top:8px"></div><div class="ctl"><button class="btn sm ghost" id="s-mem-auto">Auto</button></div></div>
      <div class="setting"><div class="txt"><div class="t">Java executable</div><div class="d">Leave empty to use the official runtime for this version (recommended).</div></div><div class="ctl"><input type="text" id="s-java" value="${esc(inst.javaPath || '')}" placeholder="Automatic" style="width:260px"><button class="btn sm" id="s-java-pick">${icon('folder')}</button></div></div>
      <div class="setting" style="flex-direction:column;align-items:stretch"><div class="txt"><div class="t">JVM arguments</div><div class="d">Overrides the global arguments for this instance. Empty = use global.</div></div><textarea id="s-jvm" rows="3" placeholder="${esc(s.jvmArgs)}">${esc(inst.jvmArgs || '')}</textarea></div>
      <div class="setting"><div class="txt"><div class="t">Window size</div><div class="d">0 = default</div></div><div class="ctl"><input type="number" id="s-w" value="${inst.resolution?.width || 0}" style="width:90px">×<input type="number" id="s-h" value="${inst.resolution?.height || 0}" style="width:90px"><label class="row small"><input type="checkbox" id="s-fs" ${inst.resolution?.fullscreen ? 'checked' : ''}>Fullscreen</label></div></div>
      ${inst.externalGameDir ? `<div class="setting"><div class="txt"><div class="t">Game directory</div><div class="d mono">${esc(inst.externalGameDir)}</div></div></div>` : ''}
      <div class="setting"><div class="txt"><div class="t">Danger zone</div><div class="d">Delete removes the instance and its worlds forever.</div></div><div class="ctl"><button class="btn sm danger" id="s-del">${icon('trash')}${T('Delete')}</button></div></div>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn primary" id="s-save">${icon('check')}${T('Save')}</button></div>
    </div>`;
    const memLabel = () => { const v = +$('#s-mem', body).value; $('.d', $('#s-mem', body).parentElement).textContent = v ? `${v} MB` : `Automatic (${autoMem} MB)`; };
    $('#s-mem', body).oninput = memLabel;
    $('#s-mem-auto', body).onclick = () => { $('#s-mem', body).value = 0; memLabel(); };
    $('#s-java-pick', body).onclick = async () => { const [f] = await api('dialog:open', { properties: ['openFile'], filters: [{ name: 'Java', extensions: ['exe', '*'] }] }); if (f) $('#s-java', body).value = f; };
    $('#s-del', body).onclick = () => deleteInstance(inst);
    $('#s-ver', body).onclick = () => this.changeVersion(inst);
    $('#s-save', body).onclick = async () => {
      const v = +$('#s-mem', body).value, w = +$('#s-w', body).value, h = +$('#s-h', body).value;
      await api('instances:update', inst.id, {
        name: $('#s-name', body).value.trim() || inst.name,
        memory: v ? { max: v, min: Math.min(1024, v) } : null,
        javaPath: $('#s-java', body).value.trim(),
        jvmArgs: $('#s-jvm', body).value.trim(),
        resolution: w || h || $('#s-fs', body).checked ? { width: w, height: h, fullscreen: $('#s-fs', body).checked } : null,
      });
      await refreshInstances();
      toast('Settings saved');
    };
  },
  async changeVersion(inst) {
    const versions = await getVersions();
    const m = modal({
      title: 'Change version',
      body: `<div class="stack"><label class="field">Minecraft version<select id="cv-v">${versions.filter((v) => v.type === 'release' || v.id === inst.versionId).map((v) => `<option ${v.id === inst.versionId ? 'selected' : ''}>${esc(v.id)}</option>`).join('')}</select></label>
        <label class="field">Loader<select id="cv-l">${Object.entries(LOADER_NAMES).map(([k, v]) => `<option value="${k}" ${k === inst.loader.type ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <div id="cv-of" class="hidden"><div class="row"><button class="btn sm" data-of-get>${icon('globe')}Get OptiFine</button><button class="btn sm primary" data-of-imp>${icon('upload')}Import OptiFine…</button></div><div class="faint small" style="margin-top:6px">OptiFine is for vanilla play — it doesn’t run Fabric or Forge mods.</div></div>
        <p class="faint small">The newest stable loader version is used. Mods are not changed automatically — use Check updates afterwards.</p></div>`,
      footer: `<button class="btn ghost" data-c>${T('Cancel')}</button><button class="btn primary" data-s>${T('Save')}</button>`,
    });
    m.$('[data-c]').onclick = () => m.close();
    const ofShow = () => m.$('#cv-of').classList.toggle('hidden', m.$('#cv-l').value !== 'optifine');
    m.$('#cv-l').onchange = ofShow; ofShow();
    m.$('[data-of-get]').onclick = () => api('shell:open', 'https://optifine.net/downloads');
    m.$('[data-of-imp]').onclick = async () => { const info = await importOptiFine(); if (info) m.$('#cv-v').value = info.mc; };
    m.$('[data-s]').onclick = async () => {
      const mc = m.$('#cv-v').value, l = m.$('#cv-l').value;
      if (l !== 'vanilla') { const lv = await api('loaders:versions', l, mc); if (!lv.length) return toast(l === 'optifine' ? `Import OptiFine for ${mc} first (Get OptiFine → Import OptiFine…)` : `${LOADER_NAMES[l]} is not available for ${mc}`, 'error'); }
      await api('instances:update', inst.id, { versionId: mc, loader: { type: l, version: null } });
      m.close(); await refreshInstances(); Router.reload(); toast('Version changed');
    };
  },
};

/** Instance tabs in the user's order (Settings → Appearance → Instance tabs); hidden ones are left out. */
const INSTANCE_TABS = [['content', 'Content'], ['worlds', 'Worlds'], ['files', 'Files'], ['screenshots', 'Screenshots'], ['logs', 'Logs'], ['console', 'Console'], ['settings', 'Settings']];
function instanceTabConfig() {
  const saved = Array.isArray(State.settings?.instanceTabs) ? State.settings.instanceTabs.filter((t) => INSTANCE_TABS.some(([id]) => id === t.id)) : [];
  for (const [id] of INSTANCE_TABS) if (!saved.some((t) => t.id === id)) saved.push({ id, hidden: false });
  return saved.map((t) => ({ ...t, label: INSTANCE_TABS.find(([id]) => id === t.id)[1] }));
}
function instanceTabs() {
  const list = instanceTabConfig().filter((t) => !t.hidden || t.id === 'settings'); // Settings can't be hidden (it holds Delete)
  return list.length ? list : [{ id: 'settings', label: 'Settings' }];
}
/** Modpack versions: update to the newest, or switch to any other version of the pack. */
async function modpackUpdates(inst, onDone) {
  const m = modal({ title: `${inst.modpack.name} versions`, wide: true, body: '<div class="faint">Checking for modpack updates…</div>' });
  let r;
  try { r = await api('modpack:versions', inst.id); } catch (e) { m.$('.content').innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div></div>`; return; }
  if (!r.updatable) { m.$('.content').innerHTML = `<div class="empty">${icon('info')}<div>${esc(r.reason)}</div></div>`; return; }
  const curIdx = r.versions.findIndex((v) => v.id === r.current);
  const newer = curIdx === -1 ? 0 : curIdx;
  m.$('.content').innerHTML = `<p class="muted small" style="margin-top:0">${newer > 0 ? `<b style="color:var(--accent)">${newer} newer version${newer > 1 ? 's' : ''} available.</b> ` : curIdx === 0 ? '<b>You have the newest version.</b> ' : ''}Updating replaces the pack’s own mods and configs. Your worlds, settings, screenshots and mods you added yourself are kept; mods you turned off stay off.</p>
    <div class="list">${r.versions.slice(0, 40).map((v) => `<div class="list-row ${v.id === r.current ? 'selected' : ''}"><div class="info"><div class="title">${esc(v.name || v.number)} <span class="chip ${v.type === 'release' ? 'ok' : 'warn'}">${esc(v.type)}</span>${v.id === r.current ? ' <span class="chip accent">Installed</span>' : ''}</div><div class="desc">${esc((v.gameVersions || []).slice(-3).join(', '))} · ${fmtDate(v.date)}</div></div>
      ${v.changelog ? `<button class="btn sm ghost" data-cl="${esc(v.id)}">Changelog</button>` : ''}${v.id === r.current ? '' : `<button class="btn sm ${r.versions.indexOf(v) < Math.max(curIdx, 0) || curIdx === -1 ? 'primary' : ''}" data-sw="${esc(v.id)}">${icon('download')}${r.versions.indexOf(v) < curIdx || curIdx === -1 ? 'Update' : 'Switch'}</button>`}</div>`).join('')}</div>`;
  $$('[data-cl]', m.el).forEach((b) => (b.onclick = () => { const v = r.versions.find((x) => x.id === b.dataset.cl); modal({ title: v.name || v.number, body: `<div class="md">${miniMarkdown(v.changelog)}</div>` }); }));
  $$('[data-sw]', m.el).forEach((b) => (b.onclick = async () => {
    const v = r.versions.find((x) => x.id === b.dataset.sw);
    if (!(await confirmDialog(`Switch ${inst.name} to ${v.name || v.number}?`, { ok: 'Update' }))) return;
    m.close();
    try { await api('modpack:update', inst.id, v.id); await refreshInstances(); toast(`${inst.name} is now on ${v.name || v.number}`); onDone && onDone(); }
    catch (e) { toastErr(e); }
  }));
}

/** Small coloured badge: where a mod/pack came from. */
function sourceChip(m) {
  const map = { modrinth: ['Modrinth', 'src-mr'], curseforge: ['CurseForge', 'src-cf'], modpack: ['Modpack', 'src-pack'], manual: ['Added by you', 'src-manual'] };
  const [label, cls] = map[m.source] || map.manual;
  return `<span class="chip src ${cls}" title="Source: ${esc(label)}${m.via ? ' (' + esc(m.via) + ')' : ''}">${esc(label)}</span>`;
}

/** Toast for instances:addFiles results (datapacks are explained instead of being copied somewhere useless). */
function reportAdded(r) {
  const NAMES = { mods: 'mod', resourcepacks: 'resource pack', shaderpacks: 'shader pack', modpacks: 'modpack' };
  const parts = Object.entries(r || {}).filter(([k, v]) => v && NAMES[k]).map(([k, v]) => `${v} ${NAMES[k]}${v > 1 ? 's' : ''}`);
  if (parts.length) toast('Added ' + parts.join(', '));
  if (r?.skippedDatapacks) toast(`Datapacks only work inside a world — install ${r.skippedDatapacks > 1 ? 'them' : 'it'} from Browse → Datapacks and pick a world, or copy into saves/<world>/datapacks.`, 'warn', 9000);
  if (!parts.length && !r?.skippedDatapacks) toast('Nothing to add — drop .jar mods, resource/shader pack .zip files or .mrpack modpacks.', 'info');
}

/* drag & drop overlay helpers */
let dropTimer;
function showDrop(text) {
  let d = $('.drop-overlay');
  if (!d) { d = document.createElement('div'); d.className = 'drop-overlay'; d.innerHTML = '<div></div>'; document.body.appendChild(d); }
  d.firstChild.textContent = text;
  clearTimeout(dropTimer); dropTimer = setTimeout(hideDrop, 300);
}
function hideDrop() { const d = $('.drop-overlay'); if (d) d.remove(); }
