Pages.instance = {
  async render(el, params, ctx) {
    let inst = await api('instances:get', params.id);
    let tab = params.tab || 'content';
    const statusText = () => {
      if (isRunning(inst.id)) return 'Playing now';
      const l = State.launch[inst.id];
      if (l?.error) return 'Launch failed';
      if (l?.stage) return launchLabel(inst.id);
      return 'Ready to play';
    };
    const head = () => {
      inst = State.instances.find((i) => i.id === inst.id) || inst;
      const lt = inst.loader?.type || 'vanilla';
      $('#ihead', el).innerHTML = `
        <div class="ih-top">
          <button class="ih-icon" id="icon-btn" title="Change icon">${instIcon(inst, 'lg')}</button>
          <div class="ih-title">
            <div class="ih-chip">${icon(lt === 'vanilla' ? 'box' : 'layers')}<b>${esc(loaderLabel(inst))}</b><span class="sep"></span><span class="mono">MC ${esc(inst.versionId)}</span></div>
            <h1 title="${esc(inst.name)}">${esc(inst.name)}</h1>
          </div>
          <div class="grow"></div>
          ${inst.modpack?.manual?.length ? `<button class="btn" id="cf-manual" title="Files the authors only allow from the CurseForge website">${icon('download')}${inst.modpack.manual.length} file${inst.modpack.manual.length === 1 ? '' : 's'} to add</button>` : ''}
          <div class="ih-play">${playButton(inst, { size: 'lg' })}</div>
        </div>
        <div class="ih-stats">
          <div class="ih-stat"><span>Status</span><b class="launch-status">${esc(statusText())}</b></div>
          <div class="ih-stat"><span>Last played</span><b>${inst.lastPlayed ? esc(timeAgo(inst.lastPlayed)) : 'Never'}</b></div>
          <div class="ih-stat"><span>Playtime</span><b>${icon('clock')}${esc(fmtDuration(inst.playTime || 0))}</b></div>
          <button class="ih-act" id="isettings">${icon('settings')}<span>Instance Settings</span></button>
          <button class="ih-act" id="more">${icon('more')}<span>More</span></button>
        </div>`;
      const mb = $('#cf-manual', el); if (mb) mb.onclick = () => cfManualDialog(inst.id, inst.modpack.manual);
      $('#more', el).onclick = (e) => instanceMoreMenu(e, inst);
      $('#isettings', el).onclick = () => instanceSettings(inst);
      $('#icon-btn', el).onclick = () => changeInstanceIcon(inst);
    };
    el.innerHTML = `<div id="ihead" class="inst-hero ih-card"></div>
      <div class="tabs ih-tabs" id="itabs">${instanceTabs().map((t) => `<button data-t="${t.id}">${icon(INSTANCE_TAB_ICONS[t.id] || 'file')}${esc(t.label)}</button>`).join('')}</div>
      <div id="ibody"></div>`;
    head();
    if (tab === 'settings') { instanceSettings(inst, params.section || 'general'); tab = 'content'; }
    if (!instanceTabs().some((t) => t.id === tab)) tab = instanceTabs()[0]?.id || 'content';
    const show = (t) => {
      tab = t;
      $$('[data-t]', el).forEach((b) => b.classList.toggle('on', b.dataset.t === t));
      const body = $('#ibody', el);
      body.ondrop = null; body.ondragover = null;
      if (typeof this.unsub === 'function') this.unsub();
      this.unsub = null;
      // async tabs (worlds/files) return a Promise — only keep real cleanup functions
      const r = this[t](body, inst);
      if (typeof r === 'function') this.unsub = r;
      else if (r && typeof r.then === 'function') r.then((fn) => { if (typeof fn === 'function') { if (tab === t) this.unsub = fn; else fn(); } }).catch((e) => { body.innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div></div>`; });
    };
    $$('[data-t]', el).forEach((b) => (b.onclick = () => show(b.dataset.t)));
    show(tab);
    // linking / unlinking changes what the Content tab allows
    let linked = !!inst.modpack;
    ctx.on('instances', () => { head(); const now = !!(State.instances.find((i) => i.id === inst.id) || inst).modpack; if (now !== linked) { linked = now; if (tab === 'content') show('content'); } });
    ctx.on('launch', (id) => id === inst.id && head());
    ctx.on('runs', head);
    return () => { if (typeof this.unsub === 'function') this.unsub(); this.unsub = null; };
  },

  /* ---------- content ---------- */
  content(body, instIn) {
    const inst = State.instances.find((i) => i.id === instIn.id) || instIn;
    const KINDS = [['mods', 'Mods', 'box'], ['resourcepacks', 'Resource Packs', 'palette'], ['shaderpacks', 'Shaders', 'sparkles'], ['datapacks', 'Data Packs', 'file']];
    const linked = !!inst.modpack;
    const canUpdateOne = !linked || !!inst.allowModUpdates;
    let kind = 'mods', items = [], selected = new Set(), lastIdx = -1, filter = '', updates = null, counts = {};
    const mp = inst.modpack;
    const mpSrc = mp ? (mp.source === 'curseforge' ? 'CurseForge' : 'Modrinth') : '';
    body.innerHTML = `
      ${linked ? `<div class="mp-bar">
        <div class="mp-ic">${instIcon(inst, 'sm')}</div>${icon('link')}<b class="ellipsis">${esc(mp.name)}</b><span class="mono faint small">${esc(mp.version || '')}</span><span class="faint small">${icon(mp.source === 'curseforge' ? 'curseforge' : 'modrinth')}${mpSrc}</span>
        <div class="grow"></div>
        <button class="btn sm ghost" id="mp-open">${icon('external')}Open link</button>
        <button class="btn sm primary" id="mp-upd">${icon('refresh')}Update</button>
        <button class="btn sm ghost" id="mp-unlink">${icon('unlink')}Unlink</button>
      </div>` : ''}
      <div class="ct-bar">
        <button class="icon-btn ct-all" id="sel-all" title="Select all">${icon('check')}</button>
        <div class="ct-kinds" id="kinds">${KINDS.map(([k, l, ic]) => `<button data-k="${k}" class="${k === kind ? 'on' : ''}">${icon(ic)}${l}<span class="n" data-n="${k}"></span></button>`).join('')}</div>
        <div class="search ct-search">${icon('search')}<input type="search" id="cf" placeholder="Search installed mods…"></div>
        <button class="icon-btn" id="reload" title="Reload">${icon('refresh')}</button>
        <button class="icon-btn" id="tools" title="Tools">${icon('more')}</button>
        <button class="btn primary" id="add">${icon('plus')}Add</button>
      </div>
      <div id="bulk"></div>
      <div id="clist"></div>
      <div class="faint small" style="margin-top:10px">${linked ? `Linked to <b>${esc(mp.name)}</b>: mods come from the modpack. Unlink it to add your own content.` : 'Tip: Ctrl/Shift+Click to select several · drop .jar / .zip files here to install them.'}</div>`;
    const kindLabel = () => KINDS.find(([k]) => k === kind)[1].toLowerCase();
    const loadCounts = async () => {
      try { counts = await api('instances:contentCounts', inst.id); } catch { counts = {}; }
      for (const [k] of KINDS) { const n = $(`[data-n="${k}"]`, body); if (n) n.textContent = counts[k] ? counts[k] : ''; }
    };
    const load = async () => { items = await api('instances:content', inst.id, kind); selected.clear(); draw(); loadCounts(); };
    const projectUrl = (m) => (m.projectId ? ((m.via || m.source) === 'curseforge' ? `https://www.curseforge.com/projects/${m.projectId}` : `https://modrinth.com/project/${m.projectId}`) : null);
    const draw = () => {
      const list = items.filter((m) => !filter || (m.name + ' ' + m.file + ' ' + (m.description || '')).toLowerCase().includes(filter));
      const box = $('#clist', body);
      if (!list.length) {
        box.innerHTML = `<div class="empty">${icon('box')}<div>${filter ? 'Nothing matches your search.' : `No ${kindLabel()} installed.`}</div>${inst.loader.type === 'vanilla' && kind === 'mods' ? '<div class="faint small">This is a vanilla instance — mods need Fabric, Quilt, Forge or NeoForge.</div>' : ''}${kind === 'datapacks' && !filter ? '<div class="faint small">Global data packs here need a mod like Paxi or Global Packs. Data packs for one world go in that world’s folder.</div>' : ''}</div>`;
        drawBulk(); return;
      }
      box.innerHTML = `<div class="ct-list">${list.map((m, i) => {
        const up = updates && updates.find((u) => u.file === m.file);
        const url = projectUrl(m);
        return `<div class="ct-row ${m.enabled ? '' : 'disabled'} ${selected.has(m.file) ? 'selected' : ''}" data-i="${i}" data-file="${esc(m.file)}">
          ${m.icon ? `<img class="mod-icon" src="${esc(m.icon)}" alt="">` : `<div class="mod-icon">${icon(kind === 'mods' ? 'box' : 'image')}</div>`}
          <div class="info"><div class="title"><b>${esc(m.name)}</b>${m.version ? `<span class="ver mono">${esc(m.version)}</span>` : ''}${m.source !== 'manual' && m.source !== 'modpack' ? sourceChip(m) : ''}${up?.latest ? `<span class="chip accent">Update → ${esc(up.latest.version)}</span>` : ''}</div>
            <div class="desc" title="${esc(m.file)}">${esc(m.description || m.file)}</div></div>
          ${up?.latest ? `<button class="btn sm" data-apply="${esc(m.file)}">${icon('download')}Update</button>` : ''}
          ${url ? `<button class="icon-btn" data-web="${esc(url)}" title="Open project page">${icon('external')}</button>` : '<span class="icon-btn ph"></span>'}
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
      $$('[data-web]', box).forEach((b) => (b.onclick = () => api('shell:open', b.dataset.web)));
      $$('[data-toggle]', box).forEach((c) => (c.onchange = async () => { items = await api('instances:setEnabled', inst.id, kind, [c.dataset.toggle], c.checked); draw(); }));
      $$('[data-del]', box).forEach((b) => (b.onclick = async () => { if (await confirmDialog(`Move ${b.dataset.del} to the ${TRASH}?`, { danger: true, ok: T('Delete') })) { items = await api('instances:deleteContent', inst.id, kind, [b.dataset.del]); draw(); loadCounts(); } }));
      $$('[data-apply]', box).forEach((b) => (b.onclick = async () => {
        const u = updates.find((x) => x.file === b.dataset.apply);
        b.disabled = true;
        try { await api('instances:applyUpdate', inst.id, kind, u.file, u.latest.id); updates = updates.filter((x) => x !== u); toast(`Updated ${u.name}`); load(); } catch (e) { toastErr(e); b.disabled = false; }
      }));
      drawBulk();
    };
    const drawBulk = () => {
      const bar = $('#bulk', body);
      $('#sel-all', body).classList.toggle('on', !!items.length && selected.size === items.length);
      if (!selected.size) { bar.innerHTML = ''; return; }
      bar.innerHTML = `<div class="bulk-bar" style="margin-bottom:10px"><b>${selected.size} selected</b><div class="grow"></div>
        <button class="btn sm" data-b="on">${icon('check')}Enable</button><button class="btn sm" data-b="off">${icon('eye')}Disable</button>
        <button class="btn sm danger" data-b="del">${icon('trash')}Delete</button><button class="btn sm ghost" data-b="clear">Clear</button></div>`;
      $$('[data-b]', bar).forEach((b) => (b.onclick = async () => {
        const files = [...selected];
        if (b.dataset.b === 'clear') { selected.clear(); return draw(); }
        if (b.dataset.b === 'del') { if (!(await confirmDialog(`Move ${files.length} file(s) to the ${TRASH}?`, { danger: true, ok: T('Delete') }))) return; items = await api('instances:deleteContent', inst.id, kind, files); loadCounts(); }
        else items = await api('instances:setEnabled', inst.id, kind, files, b.dataset.b === 'on');
        selected.clear(); draw();
      }));
    };
    $('#sel-all', body).onclick = () => { if (selected.size === items.length) selected.clear(); else items.forEach((m) => selected.add(m.file)); draw(); };
    $$('[data-k]', body).forEach((b) => (b.onclick = () => {
      kind = b.dataset.k; updates = null; lastIdx = -1;
      $$('[data-k]', body).forEach((x) => x.classList.toggle('on', x === b));
      $('#cf', body).placeholder = `Search installed ${kindLabel()}…`;
      load();
    }));
    $('#cf', body).oninput = (e) => { filter = e.target.value.toLowerCase(); draw(); };
    $('#reload', body).onclick = () => { updates = null; load(); };
    /** Content can't be added while the instance follows a modpack: offer to unlink. */
    const needUnlink = async () => {
      if (!linked) return false;
      if (await confirmDialog(`${inst.name} is linked to the ${mp.name} modpack, so its content is managed by the modpack and locked. Unlink it to add your own mods and packs? (Everything installed stays; it just stops receiving modpack updates.)`, { title: 'Unlink modpack to add content', ok: 'Unlink' })) {
        try { await api('instances:unlink', inst.id); await refreshInstances(); toast(`${inst.name} is unlinked — add anything you like`); } catch (e) { toastErr(e); }
      }
      return true;
    };
    const addFiles = async () => {
      if (await needUnlink()) return;
      const files = await api('dialog:open', { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Mods & packs', extensions: ['jar', 'zip', 'mrpack'] }] });
      if (files.length) { try { reportAdded(await api('instances:addFiles', inst.id, files, kind)); } catch (er) { toastErr(er); } load(); }
    };
    const browse = async () => { if (await needUnlink()) return; Router.go('browse', { type: kind === 'mods' ? 'mod' : kind === 'shaderpacks' ? 'shader' : kind === 'datapacks' ? 'datapack' : 'resourcepack', instanceId: inst.id }); };
    $('#add', body).onclick = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      contextMenu(r.left, r.bottom + 4, [
        { label: `Browse ${kindLabel()} in the Content Hub`, icon: 'browse', action: browse },
        { label: 'Add files from this PC…', icon: 'upload', action: addFiles },
      ]);
    };
    const checkUpdates = async (btnLabel) => {
      if (!canUpdateOne) return toast(`Mods in ${mp.name} update with the modpack. Turn on “Allow updating individual mods” in Instance Settings to update them one by one.`, 'info', 7000);
      toast('Checking for updates…', 'info');
      try {
        updates = await api('instances:checkUpdates', inst.id, kind);
        const todo = updates.filter((u) => u.latest);
        draw();
        if (!todo.length) return toast('Everything is up to date', 'ok');
        if (todo.length > 1 && await confirmDialog(`${todo.length} updates available. Install them all now?`, { title: btnLabel || 'Updates', ok: `Update all (${todo.length})` })) {
          let done = 0;
          for (const u of todo) { try { await api('instances:applyUpdate', inst.id, kind, u.file, u.latest.id); done++; } catch (er) { toastErr(er); } }
          updates = null; toast(`${done} update(s) installed`); load();
        } else toast(`${todo.length} update(s) available — use the Update buttons`, 'info');
      } catch (er) { toastErr(er); }
    };
    $('#tools', body).onclick = (e) => contextMenu(e.clientX, e.clientY, [
      { label: 'Check for updates', icon: 'refresh', action: () => checkUpdates() },
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
      ...(inst.loader?.type && inst.loader.type !== 'vanilla' ? [{ label: 'Mod health check', icon: 'shield', action: () => Router.go('modhealth', { id: inst.id }) }] : []),
      { label: 'Open folder', icon: 'folder', action: () => api('instances:openFolder', inst.id, CONTENT_DIR_NAMES[kind] || kind) },
    ]);
    if (linked) {
      $('#mp-open', body).onclick = async () => {
        let url = mp.url || null;
        if (!url && mp.source !== 'curseforge' && mp.projectId) url = `https://modrinth.com/modpack/${mp.projectId}`;
        if (!url && mp.source === 'curseforge' && mp.projectId) url = `https://www.curseforge.com/projects/${mp.projectId}`;
        if (url) api('shell:open', url); else toast('This modpack has no web page', 'info');
      };
      $('#mp-upd', body).onclick = () => modpackUpdates(inst, load);
      $('#mp-unlink', body).onclick = () => unlinkModpack(inst);
    }
    const onDrop = async (e) => {
      e.preventDefault(); e.stopPropagation(); hideDrop();
      const files = [...e.dataTransfer.files].map((f) => window.solaris.pathForFile(f));
      if (await needUnlink()) return;
      api('instances:addFiles', inst.id, files).then((r) => { reportAdded(r); load(); if (r.modpacks) refreshInstances(); }).catch(toastErr);
    };
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
};

/** Instance tabs in the user's order (Settings → Appearance → Instance tabs); hidden ones are left out. */
const INSTANCE_TABS = [['content', 'Content'], ['worlds', 'Worlds'], ['screenshots', 'Gallery'], ['files', 'Files'], ['logs', 'Logs'], ['console', 'Console']];
const INSTANCE_TAB_ICONS = { content: 'layers', worlds: 'world', screenshots: 'image', files: 'folder', logs: 'file', console: 'console' };
const CONTENT_DIR_NAMES = { mods: 'mods', resourcepacks: 'resourcepacks', shaderpacks: 'shaderpacks', datapacks: 'datapacks' };
function instanceTabConfig() {
  const saved = Array.isArray(State.settings?.instanceTabs) ? State.settings.instanceTabs.filter((t) => INSTANCE_TABS.some(([id]) => id === t.id)) : [];
  for (const [id] of INSTANCE_TABS) if (!saved.some((t) => t.id === id)) saved.push({ id, hidden: false });
  return saved.map((t) => ({ ...t, label: INSTANCE_TABS.find(([id]) => id === t.id)[1] }));
}
function instanceTabs() {
  const list = instanceTabConfig().filter((t) => !t.hidden || t.id === 'content'); // Content can't be hidden
  return list.length ? list : [{ id: 'content', label: 'Content' }];
}

/** Stop following the modpack: version and content unlock, files stay. */
async function unlinkModpack(inst) {
  if (!inst.modpack) return false;
  if (!(await confirmDialog(`Unlink ${inst.name} from the ${inst.modpack.name} modpack?\n\nEverything installed stays. The instance stops receiving modpack updates, and you can change its version and add your own mods, resource packs and shaders.`, { title: 'Unlink modpack', ok: 'Unlink', danger: true }))) return false;
  try { await api('instances:unlink', inst.id); await refreshInstances(); toast(`${inst.name} unlinked from ${inst.modpack.name}`); return true; }
  catch (e) { toastErr(e); return false; }
}

/** The "More" menu on an instance page. */
function instanceMoreMenu(e, inst) {
  const r = e.currentTarget.getBoundingClientRect();
  contextMenu(r.left, r.bottom + 4, [
    { label: 'Open folder', icon: 'folder', action: () => api('instances:openFolder', inst.id) },
    { label: 'Export…', icon: 'share', action: () => exportInstanceDialog(inst) },
    { label: 'Create shortcut', icon: 'external', action: () => createInstanceShortcut(inst) },
    { label: 'Duplicate…', icon: 'copy', action: () => duplicateDialog(inst) },
    { label: inst.pinned ? 'Unpin' : 'Pin to top', icon: 'star', action: async () => { await api('instances:update', inst.id, { pinned: !inst.pinned }); refreshInstances(); } },
    { label: inst.modpack ? 'Host this modpack…' : 'Host as a server…', icon: 'servers', action: () => hostInstanceDialog(inst) },
    '-',
    { label: T('Delete'), icon: 'trash', danger: true, action: () => deleteInstance(inst) },
  ]);
}

/** Desktop shortcut that launches the instance. Minecraft block icons are drawn here and sent along as a picture. */
async function createInstanceShortcut(inst) {
  let picture = null;
  try {
    const tmp = document.createElement('div'); tmp.innerHTML = instIcon(inst, 'lg');
    const img = tmp.querySelector('img');
    if (img?.src) {
      picture = await new Promise((res) => {
        const im = new Image();
        im.onload = () => { try { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(im, 0, 0, 256, 256); res(c.toDataURL('image/png')); } catch { res(null); } };
        im.onerror = () => res(null);
        im.src = img.src;
      });
    }
  } catch {}
  try {
    const r = await api('instances:shortcut', inst.id, picture);
    const m = modal({ title: r.iconFallback ? 'Shortcut created' : 'Shortcut created',
      body: `<div class="row" style="gap:12px;align-items:flex-start">${icon(r.iconFallback ? 'alert' : 'check')}<p class="muted" style="margin:0">${r.iconFallback ? 'Shortcut saved, but the instance icon couldn’t be used. The app icon was used instead.' : `“${esc(inst.name)}” is on your desktop — double-click it to play.`}</p></div>`,
      footer: `<button class="btn" data-x>Close</button>` });
    m.$('[data-x]').onclick = () => m.close();
  } catch (e) { toastErr(e); }
}

/** Export as a .solpack with a pack name, version number and a file tree to pick what goes in. */
async function exportInstanceDialog(inst) {
  const m = modal({ title: 'Export instance', wide: true, body: '<div class="faint">Reading the instance folder…</div>' });
  m.el.classList.add('export-modal');
  let tree;
  try { tree = await api('instances:exportTree', inst.id); } catch (e) { m.$('.content').innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div></div>`; return; }
  // private or huge by default: saves (worlds), screenshots, backups, server lists stay out unless ticked
  const OFF = new Set(['saves', 'screenshots', 'backups', 'servers.dat', 'servers.dat_old', 'usercache.json', 'command_history.txt', '.cache', 'shortcut-icon.ico', 'shortcut-icon.png']);
  const checked = new Map(tree.map((t) => [t.rel, !OFF.has(t.name)]));
  const sizes = new Map(tree.map((t) => [t.rel, t.size]));
  const open = new Map(); // rel -> children (loaded)
  m.$('.content').innerHTML = `
    <div class="ex-head">${instIcon(inst, 'lg')}
      <label class="field grow">Pack name<input type="text" id="ex-name" maxlength="64" value="${esc(inst.name)}"></label>
      <label class="field" style="width:150px">Version number<input type="text" id="ex-ver" maxlength="32" value="1.0.0"></label></div>
    <div class="row" style="margin:12px 0 6px"><span class="faint small grow">Configure which files are included in this export</span><span class="faint small" id="ex-size"></span></div>
    <div class="ex-tree"><div class="ex-row ex-top"><label><input type="checkbox" id="ex-all"></label><span class="grow small faint">NAME</span><span class="small faint">SIZE</span></div><div id="ex-list"></div></div>`;
  const footer = document.createElement('footer');
  footer.innerHTML = `<button class="btn ghost" data-x>${T('Cancel')}</button><button class="btn primary" data-go>${icon('upload')}Export</button>`;
  m.el.appendChild(footer);
  const parentOf = (rel) => rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : null;
  const isOn = (rel) => { for (let r = rel; r; r = parentOf(r)) if (checked.has(r)) return checked.get(r); return false; };
  const total = () => {
    let sum = 0;
    const walk = (list) => { for (const t of list) { if (open.has(t.rel) && t.dir) walk(open.get(t.rel)); else if (isOn(t.rel)) sum += t.size || 0; } };
    walk(tree);
    return sum;
  };
  const row = (t, depth) => {
    const kids = open.get(t.rel);
    const on = isOn(t.rel);
    const partial = kids && kids.some((k) => isOn(k.rel) !== on);
    return `<div class="ex-row" style="padding-left:${10 + depth * 20}px">
        <label><input type="checkbox" data-c="${esc(t.rel)}" ${on ? 'checked' : ''} ${partial ? 'data-partial' : ''}></label>
        ${t.dir ? `<button class="ex-tw ${kids ? 'open' : ''}" data-tw="${esc(t.rel)}" ${t.children ? '' : 'disabled'}>${icon('fwd')}</button>` : '<span class="ex-tw"></span>'}
        ${icon(t.dir ? 'folder' : 'file')}<span class="grow ellipsis">${esc(t.name)}${t.dir && t.children ? ` <span class="faint small">${t.count ?? t.children}${t.count != null ? '' : ''}</span>` : ''}</span>
        <span class="faint small">${t.dir && !t.size ? '' : fmtBytes(t.size || 0)}</span></div>`
      + (kids ? kids.map((k) => row(k, depth + 1)).join('') : '');
  };
  const draw = () => {
    m.$('#ex-list').innerHTML = tree.map((t) => row(t, 0)).join('');
    $$('[data-partial]', m.el).forEach((c) => (c.indeterminate = true));
    const all = tree.every((t) => isOn(t.rel)), none = tree.every((t) => !isOn(t.rel));
    m.$('#ex-all').checked = all; m.$('#ex-all').indeterminate = !all && !none;
    m.$('#ex-size').textContent = `Estimated size: ${fmtBytes(total())}`;
    $$('[data-c]', m.el).forEach((c) => (c.onchange = () => {
      const rel = c.dataset.c;
      // ticking a folder sets everything under it
      for (const k of [...checked.keys()]) if (k.startsWith(rel + '/')) checked.delete(k);
      checked.set(rel, c.checked);
      draw();
    }));
    $$('[data-tw]', m.el).forEach((b) => (b.onclick = async () => {
      const rel = b.dataset.tw;
      if (open.has(rel)) { open.delete(rel); return draw(); }
      try {
        const r = await api('files:list', inst.id, rel);
        const on = isOn(rel);
        open.set(rel, r.entries.map((e) => ({ name: e.name, rel: e.rel, dir: e.dir, size: e.dir ? 0 : e.size, children: e.dir ? 1 : 0 })));
        for (const e of open.get(rel)) if (!checked.has(e.rel)) checked.set(e.rel, on);
        draw();
      } catch (e) { toastErr(e); }
    }));
  };
  m.$('#ex-all').onchange = (e) => { checked.clear(); for (const t of tree) checked.set(t.rel, e.target.checked); draw(); };
  draw();
  m.el.querySelector('[data-x]').onclick = () => m.close();
  m.el.querySelector('[data-go]').onclick = async (e) => {
    // the smallest set of ticked paths: a ticked folder whose parent is ticked too is covered by the parent
    const include = [];
    const walk = (list) => { for (const t of list) { const kids = open.get(t.rel); if (kids && kids.some((k) => isOn(k.rel) !== isOn(t.rel))) walk(kids); else if (kids && t.dir) { if (isOn(t.rel)) include.push(t.rel); } else if (isOn(t.rel)) include.push(t.rel); } };
    walk(tree);
    if (!include.length) return toast('Tick at least one file or folder to export', 'warn');
    const b = e.currentTarget; b.disabled = true; b.innerHTML = `${icon('refresh', 'spin')}Exporting…`;
    try {
      const dest = await api('instances:export', inst.id, include, { name: m.$('#ex-name').value.trim() || inst.name, version: m.$('#ex-ver').value.trim() || '1.0.0' });
      if (dest) { toast('Exported — share the .solpack file; anyone can drop it on Astra to import it'); m.close(); return; }
    } catch (er) { toastErr(er); }
    if (b.isConnected) { b.disabled = false; b.innerHTML = `${icon('upload')}Export`; }
  };
}

/* ---------- Instance Settings (dialog) ---------- */
const MC_KEY_LABELS = {
  'key.forward': 'Walk Forward', 'key.left': 'Strafe Left', 'key.back': 'Walk Backward', 'key.right': 'Strafe Right', 'key.jump': 'Jump', 'key.sneak': 'Sneak', 'key.sprint': 'Sprint',
  'key.inventory': 'Open/Close Inventory', 'key.swapOffhand': 'Swap Item With Offhand', 'key.drop': 'Drop Selected Item', 'key.use': 'Use Item/Place Block', 'key.attack': 'Attack/Destroy', 'key.pickItem': 'Pick Block',
  'key.chat': 'Open Chat', 'key.playerlist': 'List Players', 'key.command': 'Open Command', 'key.socialInteractions': 'Social Interactions Screen',
  'key.screenshot': 'Take Screenshot', 'key.togglePerspective': 'Toggle Perspective', 'key.smoothCamera': 'Toggle Cinematic Camera', 'key.fullscreen': 'Toggle Fullscreen', 'key.spectatorOutlines': 'Highlight Players (Spectators)', 'key.advancements': 'Advancements',
  'key.saveToolbarActivator': 'Save Hotbar Activator', 'key.loadToolbarActivator': 'Load Hotbar Activator',
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`key.hotbar.${n}`, `Hotbar Slot ${n}`])),
};
const MC_KEY_DEFAULTS = {
  'key.forward': 'key.keyboard.w', 'key.left': 'key.keyboard.a', 'key.back': 'key.keyboard.s', 'key.right': 'key.keyboard.d', 'key.jump': 'key.keyboard.space', 'key.sneak': 'key.keyboard.left.shift', 'key.sprint': 'key.keyboard.left.control',
  'key.inventory': 'key.keyboard.e', 'key.swapOffhand': 'key.keyboard.f', 'key.drop': 'key.keyboard.q', 'key.use': 'key.mouse.right', 'key.attack': 'key.mouse.left', 'key.pickItem': 'key.mouse.middle',
  'key.chat': 'key.keyboard.t', 'key.playerlist': 'key.keyboard.tab', 'key.command': 'key.keyboard.slash', 'key.socialInteractions': 'key.keyboard.p',
  'key.screenshot': 'key.keyboard.f2', 'key.togglePerspective': 'key.keyboard.f5', 'key.smoothCamera': 'key.keyboard.unknown', 'key.fullscreen': 'key.keyboard.f11', 'key.spectatorOutlines': 'key.keyboard.unknown', 'key.advancements': 'key.keyboard.l',
  'key.saveToolbarActivator': 'key.keyboard.c', 'key.loadToolbarActivator': 'key.keyboard.x',
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`key.hotbar.${n}`, `key.keyboard.${n}`])),
};
const MC_KEY_GROUPS = [
  ['Movement', ['key.forward', 'key.left', 'key.back', 'key.right', 'key.jump', 'key.sneak', 'key.sprint']],
  ['Gameplay', ['key.attack', 'key.use', 'key.pickItem']],
  ['Inventory', ['key.inventory', 'key.swapOffhand', 'key.drop', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `key.hotbar.${n}`)]],
  ['Multiplayer', ['key.chat', 'key.playerlist', 'key.command', 'key.socialInteractions']],
  ['Miscellaneous', ['key.screenshot', 'key.togglePerspective', 'key.smoothCamera', 'key.fullscreen', 'key.spectatorOutlines', 'key.advancements']],
  ['Creative Mode', ['key.saveToolbarActivator', 'key.loadToolbarActivator']],
];
/** Browser key event → Minecraft's options.txt key name. */
function mcKeyFromEvent(e) {
  const c = e.code || '';
  if (/^Key[A-Z]$/.test(c)) return 'key.keyboard.' + c.slice(3).toLowerCase();
  if (/^Digit\d$/.test(c)) return 'key.keyboard.' + c.slice(5);
  if (/^F\d{1,2}$/.test(c)) return 'key.keyboard.' + c.toLowerCase();
  if (/^Numpad\d$/.test(c)) return 'key.keyboard.keypad.' + c.slice(6);
  const map = {
    Space: 'space', ShiftLeft: 'left.shift', ShiftRight: 'right.shift', ControlLeft: 'left.control', ControlRight: 'right.control', AltLeft: 'left.alt', AltRight: 'right.alt',
    Tab: 'tab', Enter: 'enter', Backspace: 'backspace', CapsLock: 'caps.lock', Backquote: 'grave.accent', Slash: 'slash', Backslash: 'backslash', Period: 'period', Comma: 'comma',
    Semicolon: 'semicolon', Quote: 'apostrophe', BracketLeft: 'left.bracket', BracketRight: 'right.bracket', Minus: 'minus', Equal: 'equal', ArrowUp: 'up', ArrowDown: 'down',
    ArrowLeft: 'left', ArrowRight: 'right', Insert: 'insert', Delete: 'delete', Home: 'home', End: 'end', PageUp: 'page.up', PageDown: 'page.down', MetaLeft: 'left.win', MetaRight: 'right.win',
    NumpadAdd: 'keypad.add', NumpadSubtract: 'keypad.subtract', NumpadMultiply: 'keypad.multiply', NumpadDivide: 'keypad.divide', NumpadEnter: 'keypad.enter', NumpadDecimal: 'keypad.decimal',
  };
  return map[c] ? 'key.keyboard.' + map[c] : null;
}
function mcKeyLabel(k) {
  if (!k || k === 'key.keyboard.unknown') return 'Not bound';
  const m = k.match(/^key\.mouse\.(.+)$/);
  if (m) return { left: 'Left Button', right: 'Right Button', middle: 'Middle Button' }[m[1]] || `Mouse Button ${m[1]}`;
  // key.keyboard.left.shift → "Left Shift", key.keyboard.f2 → "F2", key.keyboard.w → "W"
  return k.replace(/^key\.keyboard\./, '').split('.').map((p) => (p.length <= 2 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1))).join(' ');
}
const prettyKeyId = (id) => MC_KEY_LABELS[id] || id.replace(/^key\./, '').replace(/[._]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase());

async function instanceSettings(instIn, section = 'general') {
  let inst = State.instances.find((i) => i.id === instIn.id) || instIn;
  const s = State.settings;
  const SECTIONS = [['general', 'General', 'grid'], ['installation', 'Installation', 'package'], ['window', 'Window', 'monitor'], ['controls', 'Controls', 'keyboard'], ['java', 'Java & Memory', 'coffee'], ['hooks', 'Launch Hooks', 'terminal']];
  const m = modal({ title: 'Instance Settings', wide: true, body: '' });
  m.el.classList.add('iset');
  m.el.innerHTML = `<aside class="iset-side"><h2>Instance Settings</h2><nav>${SECTIONS.map(([k, l, ic]) => `<button data-sec="${k}">${icon(ic)}${l}</button>`).join('')}</nav><div class="grow"></div><div class="iset-meta faint small" id="iset-meta"></div></aside>
    <section class="iset-main"><button class="icon-btn iset-x" data-close-x>${icon('close')}</button><div class="iset-body" id="iset-body"></div>
      <footer><button class="btn ghost" data-cancel>${T('Cancel')}</button><button class="btn primary" data-save>${icon('check')}Save changes</button></footer></section>`;
  const close = m.close;
  m.el.querySelector('[data-close-x]').onclick = close;
  m.el.querySelector('[data-cancel]').onclick = close;
  // everything the player changes, saved together with "Save changes"
  const d = {
    name: inst.name, icon: inst.icon, allowModUpdates: !!inst.allowModUpdates,
    versionId: inst.versionId, loader: { type: inst.loader?.type || 'vanilla', version: inst.loader?.version || null },
    resolution: { width: inst.resolution?.width || 0, height: inst.resolution?.height || 0, fullscreen: !!inst.resolution?.fullscreen },
    launchBehavior: inst.launchBehavior || '', discordRpc: inst.discordRpc || '',
    memory: inst.memory?.max || 0, javaPath: inst.javaPath || '', jvmArgs: inst.jvmArgs || '', envVars: inst.envVars || '',
    hooks: { enabled: !!inst.hooks?.enabled, pre: inst.hooks?.pre || '', wrapper: inst.hooks?.wrapper || '', post: inst.hooks?.post || '' },
  };
  let keys = null, keysText = null, keysDirty = false; // options.txt key bindings
  const meta = () => (m.$('#iset-meta').innerHTML = `Minecraft ${esc(d.versionId)}<br>${esc(LOADER_NAMES[d.loader.type] || d.loader.type)}${d.loader.version ? ' ' + esc(d.loader.version) : ''}`);
  meta();
  const sw = (id, on, extra = '') => `<label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} ${extra}><span></span></label>`;
  const box = () => m.$('#iset-body');
  let cur = section;
  const SEC = {
    general() {
      const mp = inst.modpack;
      box().innerHTML = `<h3>General</h3><div class="sub">Instance name, icon and actions</div>
        <div class="iset-row2"><div><div class="lbl">Icon</div><button class="iset-icon" id="g-icon" title="Change icon">${instIcon({ ...inst, icon: d.icon }, 'lg')}</button></div>
          <label class="field grow"><span class="lbl">Instance Name</span><input type="text" id="g-name" maxlength="64" value="${esc(d.name)}"></label></div>
        ${mp ? `<hr><h4>Linked Modpack</h4><div class="sub">This instance was installed from a modpack and receives its updates.</div>
          <div class="iset-card row">${instIcon(inst, 'sm')}<div class="grow"><b>${esc(mp.name)}</b><div class="faint small">${esc(mp.version || '')} · ${mp.source === 'curseforge' ? 'CurseForge' : 'Modrinth'}</div></div><button class="btn sm danger" id="g-unlink">${icon('unlink')}Unlink</button></div>
          <div class="iset-card row"><div class="grow"><b>Allow updating individual mods</b><div class="faint small">Update pack mods individually instead of via the modpack version</div></div>${sw('g-ind', d.allowModUpdates)}</div>`
        : inst.unlinkedModpack ? `<hr><h4>Linked Modpack</h4><div class="faint small">Unlinked from ${esc(inst.unlinkedModpack.name)} ${esc(inst.unlinkedModpack.version || '')}. The version and content are yours to change.</div>` : ''}
        <hr><h4>Instance Actions</h4><div class="sub">Repair or delete this instance. These actions cannot be undone.</div>
        <button class="iset-action" id="g-repair"><span class="ia-ic warn">${icon('wrench')}</span><span><b>Repair Instance</b><small>Fix corrupted files and download missing assets</small></span></button>
        <button class="iset-action" id="g-delete"><span class="ia-ic danger">${icon('trash')}</span><span><b>Delete Instance</b><small>Permanently remove this instance and its files</small></span></button>`;
      m.$('#g-name').oninput = (e) => (d.name = e.target.value);
      m.$('#g-icon').onclick = async () => { let ic = await pickIcon(d.icon, { allowUpload: true }); if (ic === '__upload__') { try { const u = await api('instances:setIcon', inst.id); ic = u ? u.icon : null; } catch (er) { toastErr(er); ic = null; } } if (ic) { d.icon = ic; m.$('#g-icon').innerHTML = instIcon({ ...inst, icon: d.icon }, 'lg'); } };
      if (m.$('#g-ind')) m.$('#g-ind').onchange = (e) => (d.allowModUpdates = e.target.checked);
      if (m.$('#g-unlink')) m.$('#g-unlink').onclick = async () => { if (await unlinkModpack(inst)) { inst = State.instances.find((i) => i.id === inst.id) || inst; SEC.general(); } };
      m.$('#g-repair').onclick = async () => {
        if (!(await confirmDialog(`Check every game file of ${inst.name} and re-download anything missing or damaged the next time you press Play?`, { title: 'Repair instance', ok: 'Repair' }))) return;
        try { await api('instances:repair', inst.id); toast('Repair scheduled — press Play to check and fix the game files'); } catch (e) { toastErr(e); }
      };
      m.$('#g-delete').onclick = async () => { close(); deleteInstance(inst); };
    },
    async installation() {
      const locked = !!inst.modpack;
      box().innerHTML = `<h3>Installation</h3><div class="sub">Game version, modloader and loader version</div>
        ${locked ? `<div class="iset-warn">This instance is linked to a modpack, so its version is locked. To change the version, unlink the modpack from the instance first.</div>` : ''}
        <div class="iset-card"><div class="row"><b class="grow">Minecraft Version</b><span class="faint small">Show snapshots and old versions</span>${sw('i-snap', false, locked ? 'disabled' : '')}</div><select id="i-ver" ${locked ? 'disabled' : ''}><option>${esc(d.versionId)}</option></select></div>
        <div class="iset-card"><b>Mod Loader</b><div class="iset-loaders" id="i-loaders"></div>
          <div id="i-lv-wrap"><b id="i-lv-label">Loader Version</b><select id="i-lv" ${locked ? 'disabled' : ''}></select></div>
          <div id="i-of" class="hidden"><div class="row" style="margin-top:8px"><button class="btn sm" data-of-get>${icon('globe')}Get OptiFine</button><button class="btn sm primary" data-of-imp>${icon('upload')}Import OptiFine…</button></div></div></div>
        <p class="faint small">Changing the version doesn’t change your mods — check for updates afterwards.</p>`;
      const versions = await getVersions().catch(() => []);
      if (cur !== 'installation') return;
      const fillVersions = () => {
        const snap = m.$('#i-snap').checked;
        const list = versions.filter((v) => snap || v.type === 'release' || v.id === d.versionId);
        m.$('#i-ver').innerHTML = list.map((v) => `<option value="${esc(v.id)}">${esc(v.id)}${v.type !== 'release' ? ' (' + esc(v.type.replace('old_', '')) + ')' : ''}</option>`).join('') || `<option>${esc(d.versionId)}</option>`;
        m.$('#i-ver').value = d.versionId;
      };
      const LOADERS = ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt', 'legacyfabric', 'optifine'].filter((l) => LOADER_NAMES[l]);
      const support = {};
      const drawLoaders = () => {
        m.$('#i-loaders').innerHTML = LOADERS.map((l) => `<button data-l="${l}" class="ld-${l} ${l === d.loader.type ? 'on' : ''}" ${locked || (l !== 'vanilla' && l !== 'optifine' && support[l] && !support[l].length) ? 'disabled' : ''}>${esc(LOADER_NAMES[l])}</button>`).join('');
        $$('[data-l]', m.el).forEach((b) => (b.onclick = () => { d.loader = { type: b.dataset.l, version: null }; drawLoaders(); fillLv(); meta(); }));
        m.$('#i-of').classList.toggle('hidden', d.loader.type !== 'optifine' || locked);
      };
      const fillLv = async () => {
        const t = d.loader.type, mc = d.versionId;
        m.$('#i-lv-wrap').classList.toggle('hidden', t === 'vanilla');
        if (t === 'vanilla') return;
        m.$('#i-lv-label').textContent = `${LOADER_NAMES[t]} Version`;
        if (!support[t]) { m.$('#i-lv').innerHTML = '<option>Loading…</option>'; try { support[t] = await api('loaders:versions', t, mc); } catch { support[t] = []; } if (d.versionId !== mc || d.loader.type !== t) return; }
        const list = support[t];
        m.$('#i-lv').innerHTML = list.length ? list.slice(0, 200).map((v) => `<option value="${esc(v.version)}">${esc(v.label || v.version)}${v.recommended ? ' ★ recommended' : v.stable === false ? ' (beta)' : ''}</option>`).join('') : `<option value="">Not available for ${esc(mc)}</option>`;
        const pick = (d.loader.version && list.find((v) => v.version === d.loader.version)) || list.find((v) => v.recommended) || list.find((v) => v.stable) || list[0];
        if (pick) { m.$('#i-lv').value = pick.version; d.loader.version = pick.version; } else d.loader.version = null;
        meta();
      };
      fillVersions(); drawLoaders(); fillLv();
      // which loaders exist for this version (buttons for missing ones are greyed out)
      const probe = async () => { const mc = d.versionId; await Promise.all(LOADERS.filter((l) => l !== 'vanilla' && l !== 'optifine').map(async (l) => { if (support[l]) return; try { support[l] = await api('loaders:versions', l, mc); } catch { support[l] = []; } })); if (d.versionId === mc && cur === 'installation') drawLoaders(); };
      if (!locked) probe();
      m.$('#i-snap').onchange = fillVersions;
      m.$('#i-ver').onchange = (e) => { d.versionId = e.target.value; for (const k of Object.keys(support)) delete support[k]; d.loader.version = null; drawLoaders(); fillLv(); probe(); meta(); };
      m.$('#i-lv').onchange = (e) => { d.loader.version = e.target.value || null; meta(); };
      m.$('[data-of-get]').onclick = () => api('shell:open', 'https://optifine.net/downloads');
      m.$('[data-of-imp]').onclick = async () => { const info = await importOptiFine(); if (info) { d.versionId = info.mc; delete support.optifine; fillVersions(); fillLv(); meta(); } };
    },
    window() {
      const r = d.resolution;
      const presets = [[0, 0, 'Auto'], [854, 480], [1280, 720], [1366, 768], [1920, 1080], [2560, 1440]];
      box().innerHTML = `<h3>Window</h3><div class="sub">Resolution and display settings</div>
        <div class="iset-card row"><div class="grow"><b>Fullscreen</b><div class="faint small">Launch the game in fullscreen mode</div></div>${sw('w-fs', r.fullscreen)}</div>
        <div class="iset-card"><div class="row"><input type="number" id="w-w" min="0" max="16384" placeholder="Width" value="${r.width || ''}" class="grow"><span class="faint">×</span><input type="number" id="w-h" min="0" max="16384" placeholder="Height" value="${r.height || ''}" class="grow"></div>
          <div class="iset-presets">${presets.map(([w, h, l]) => `<button data-pw="${w}" data-ph="${h}">${l || `${w}×${h}`}</button>`).join('')}</div></div>
        <div class="iset-card row"><div class="grow"><b>Launcher visibility on launch</b><div class="faint small">What the launcher should do when this instance starts</div></div>
          <select id="w-lb"><option value="">Use global setting</option><option value="keep">Keep open</option><option value="minimize">Minimize</option><option value="hide">Hide (comes back when the game closes)</option></select></div>
        <div class="iset-card row"><div class="grow"><b>Discord Rich Presence</b><div class="faint small">Override the global Discord activity setting for this instance. Currently ${s.discordRpc ? 'enabled' : 'disabled'} globally</div></div>
          <select id="w-rpc"><option value="">Use global setting</option><option value="off">Off for this instance</option></select></div>`;
      const markPreset = () => $$('[data-pw]', m.el).forEach((b) => b.classList.toggle('on', +b.dataset.pw === (r.width || 0) && +b.dataset.ph === (r.height || 0)));
      markPreset();
      m.$('#w-fs').onchange = (e) => (r.fullscreen = e.target.checked);
      m.$('#w-w').oninput = (e) => { r.width = Math.max(0, +e.target.value || 0); markPreset(); };
      m.$('#w-h').oninput = (e) => { r.height = Math.max(0, +e.target.value || 0); markPreset(); };
      $$('[data-pw]', m.el).forEach((b) => (b.onclick = () => { r.width = +b.dataset.pw; r.height = +b.dataset.ph; m.$('#w-w').value = r.width || ''; m.$('#w-h').value = r.height || ''; markPreset(); }));
      m.$('#w-lb').value = d.launchBehavior; m.$('#w-lb').onchange = (e) => (d.launchBehavior = e.target.value);
      m.$('#w-rpc').value = d.discordRpc; m.$('#w-rpc').onchange = (e) => (d.discordRpc = e.target.value);
    },
    async controls() {
      box().innerHTML = `<h3>Controls</h3><div class="sub">Change the keys used in game</div><div class="faint">Reading options.txt…</div>`;
      if (!keys) {
        keys = {}; keysText = '';
        try { keysText = (await api('files:read', inst.id, 'options.txt')).text || ''; } catch { keysText = ''; }
        for (const line of keysText.split(/\r?\n/)) { const mm = line.match(/^key_(key\.[^:]+):(.+)$/); if (mm) keys[mm[1]] = mm[2].trim(); }
      }
      if (cur !== 'controls') return;
      const known = new Set(MC_KEY_GROUPS.flatMap(([, ids]) => ids));
      const modKeys = Object.keys(keys).filter((k) => !known.has(k)).sort();
      const groups = [...MC_KEY_GROUPS, ...(modKeys.length ? [['Mods', modKeys]] : [])];
      const draw = (q = '') => {
        const val = (id) => keys[id] || MC_KEY_DEFAULTS[id] || 'key.keyboard.unknown';
        m.$('#k-list').innerHTML = groups.map(([g, ids]) => {
          const shown = ids.filter((id) => !q || prettyKeyId(id).toLowerCase().includes(q) || mcKeyLabel(val(id)).toLowerCase().includes(q));
          return shown.length ? `<div class="k-group">${esc(g)}</div>${shown.map((id) => `<div class="k-row"><span class="grow">${esc(prettyKeyId(id))}</span>${keys[id] && MC_KEY_DEFAULTS[id] && keys[id] !== MC_KEY_DEFAULTS[id] ? `<button class="icon-btn" data-kreset="${esc(id)}" title="Reset to ${esc(mcKeyLabel(MC_KEY_DEFAULTS[id]))}">${icon('history')}</button>` : ''}<button class="k-key" data-key="${esc(id)}">${esc(mcKeyLabel(val(id)))}</button></div>`).join('')}` : '';
        }).join('') || '<div class="faint">No controls match.</div>';
        $$('[data-kreset]', m.el).forEach((b) => (b.onclick = () => { keys[b.dataset.kreset] = MC_KEY_DEFAULTS[b.dataset.kreset]; keysDirty = true; draw(m.$('#k-q').value.toLowerCase()); }));
        $$('[data-key]', m.el).forEach((b) => (b.onclick = () => {
          $$('.k-key.listening', m.el).forEach((x) => x.classList.remove('listening'));
          b.classList.add('listening'); b.textContent = 'Press a key…';
          const id = b.dataset.key;
          const done = (v) => { document.removeEventListener('keydown', onKey, true); b.removeEventListener('mousedown', onMouse); if (v) { keys[id] = v; keysDirty = true; } draw(m.$('#k-q').value.toLowerCase()); };
          const onKey = (e) => { e.preventDefault(); e.stopPropagation(); if (e.key === 'Escape') return done('key.keyboard.unknown'); const v = mcKeyFromEvent(e); if (v) done(v); };
          const onMouse = (e) => { if (e.button === 0) return; e.preventDefault(); done(`key.mouse.${['left', 'middle', 'right'][e.button] || e.button + 1}`); };
          setTimeout(() => { document.addEventListener('keydown', onKey, true); b.addEventListener('mousedown', onMouse); }, 0);
        }));
      };
      box().innerHTML = `<h3>Controls</h3><div class="sub">Change the keys used in game${keysText ? '' : ' — this instance hasn’t been played yet, so Minecraft’s default keys are shown'}</div>
        <div class="row" style="gap:8px;margin-bottom:10px"><div class="search grow">${icon('search')}<input type="search" id="k-q" placeholder="Search controls"></div><button class="btn" id="k-reset">${icon('history')}Reset all</button></div>
        <div id="k-list" class="k-list"></div><p class="faint small">Esc unbinds a key. Right/middle mouse buttons can be bound by clicking with them.</p>`;
      m.$('#k-q').oninput = (e) => draw(e.target.value.toLowerCase());
      m.$('#k-reset').onclick = () => { for (const id of Object.keys(MC_KEY_DEFAULTS)) keys[id] = MC_KEY_DEFAULTS[id]; keysDirty = true; draw(m.$('#k-q').value.toLowerCase()); };
      draw();
    },
    async java() {
      const autoMem = await api('settings:autoMemory', d.loader.type !== 'vanilla').catch(() => 4096);
      if (cur !== 'java') return;
      const totalMb = Math.floor((State.info.totalMem || 8 * 1024 ** 3) / 1024 / 1024);
      const memText = () => (d.memory ? `${(d.memory / 1024).toFixed(1)} GB` : `Automatic (${(autoMem / 1024).toFixed(1)} GB)`);
      box().innerHTML = `<h3>Java &amp; Memory</h3><div class="sub">Memory, Java runtime and arguments</div>
        <div class="iset-card"><div class="row"><b class="grow">Memory</b><b id="j-mem-l">${memText()}</b><button class="btn sm ghost" id="j-auto">Auto</button></div>
          <input type="range" id="j-mem" min="0" max="${Math.max(2048, Math.min(totalMb - 1024, 32768))}" step="256" value="${d.memory}"><div class="faint small">0 = automatic, based on your ${Math.round(totalMb / 1024)} GB of RAM</div></div>
        <div class="iset-card"><b>Java executable</b><div class="faint small">Leave empty to use the right Java for this version (recommended).</div>
          <div class="row" style="gap:8px;margin-top:6px"><input type="text" id="j-path" class="grow mono" placeholder="Automatic" value="${esc(d.javaPath)}"><button class="btn sm" id="j-pick">${icon('folder')}</button></div></div>
        <div class="iset-card"><b>JVM Arguments</b><div class="faint small">Replaces the default arguments from Settings for this instance. Empty = use the defaults.</div><textarea id="j-args" rows="3" class="mono" placeholder="${esc(s.jvmArgs || '')}">${esc(d.jvmArgs)}</textarea></div>
        <div class="iset-card"><b>Environment Variables</b><div class="faint small">One KEY=value per line. When set, these replace the defaults from Settings entirely.</div><textarea id="j-env" rows="3" class="mono" placeholder="KEY=value&#10;ANOTHER_KEY=another_value">${esc(d.envVars)}</textarea></div>`;
      m.$('#j-mem').oninput = (e) => { d.memory = +e.target.value; m.$('#j-mem-l').textContent = memText(); };
      m.$('#j-auto').onclick = () => { d.memory = 0; m.$('#j-mem').value = 0; m.$('#j-mem-l').textContent = memText(); };
      m.$('#j-path').oninput = (e) => (d.javaPath = e.target.value);
      m.$('#j-pick').onclick = async () => { const [f] = await api('dialog:open', { properties: ['openFile'], filters: [{ name: 'Java', extensions: ['exe', '*'] }] }); if (f) { d.javaPath = f; m.$('#j-path').value = f; } };
      m.$('#j-args').oninput = (e) => (d.jvmArgs = e.target.value);
      m.$('#j-env').oninput = (e) => (d.envVars = e.target.value);
    },
    hooks() {
      const h = d.hooks;
      const gpu = !!s.dedicatedGpu;
      box().innerHTML = `<h3>Launch Hooks</h3><div class="sub">Pre-launch and post-exit commands</div>
        <div class="iset-card row"><div class="grow"><b>Enable Custom Launch Hooks</b><div class="faint small">Run custom commands before and after launching the game</div></div>${sw('h-on', h.enabled)}</div>
        <div class="iset-card stack ${h.enabled ? '' : 'dim'}" id="h-box">
          <div class="row"><div class="grow"><b>Pre-Launch Command</b><div class="faint small">Runs before the game starts, the launch waits for it to finish</div></div><input type="text" class="mono" id="h-pre" value="${esc(h.pre)}" placeholder="${esc(s.hookPre || '')}"></div>
          <div class="row"><div class="grow"><b>Wrapper Command</b><div class="faint small">${gpu ? 'Not available while Use dedicated GPU is enabled' : 'Starts Java through this program (e.g. prime-run, gamemoderun)'}</div></div><input type="text" class="mono" id="h-wrap" value="${esc(h.wrapper)}" placeholder="${esc(s.hookWrapper || '')}" ${gpu ? 'disabled' : ''}></div>
          <div class="row"><div class="grow"><b>Post-Exit Command</b><div class="faint small">Runs after the game has closed</div></div><input type="text" class="mono" id="h-post" value="${esc(h.post)}" placeholder="${esc(s.hookPost || '')}"></div>
        </div>
        <p class="faint small">Commands run in your system shell with INST_NAME, INST_ID, INST_DIR, INST_MC_VER and INST_JAVA set. Defaults for every instance are in Settings → Default options.</p>`;
      const sync = () => { m.$('#h-box').classList.toggle('dim', !h.enabled); for (const id of ['#h-pre', '#h-wrap', '#h-post']) m.$(id).disabled = !h.enabled || (id === '#h-wrap' && gpu); };
      sync();
      m.$('#h-on').onchange = (e) => { h.enabled = e.target.checked; sync(); };
      m.$('#h-pre').oninput = (e) => (h.pre = e.target.value);
      m.$('#h-wrap').oninput = (e) => (h.wrapper = e.target.value);
      m.$('#h-post').oninput = (e) => (h.post = e.target.value);
    },
  };
  const show = (k) => {
    cur = k;
    $$('[data-sec]', m.el).forEach((b) => b.classList.toggle('on', b.dataset.sec === k));
    Promise.resolve(SEC[k]()).catch((e) => { box().innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div></div>`; });
  };
  $$('[data-sec]', m.el).forEach((b) => (b.onclick = () => show(b.dataset.sec)));
  show(SEC[section] ? section : 'general');
  m.el.querySelector('[data-save]').onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      inst = State.instances.find((i) => i.id === inst.id) || inst;
      const patch = {
        name: d.name.trim() || inst.name, icon: d.icon, allowModUpdates: d.allowModUpdates,
        resolution: d.resolution.width || d.resolution.height || d.resolution.fullscreen ? { ...d.resolution } : null,
        launchBehavior: d.launchBehavior, discordRpc: d.discordRpc,
        memory: d.memory ? { max: d.memory, min: Math.min(1024, d.memory) } : null,
        javaPath: d.javaPath.trim(), jvmArgs: d.jvmArgs.trim(), envVars: d.envVars.trim(),
        hooks: { enabled: d.hooks.enabled, pre: d.hooks.pre.trim(), wrapper: d.hooks.wrapper.trim(), post: d.hooks.post.trim() },
      };
      if (!inst.modpack && (d.versionId !== inst.versionId || d.loader.type !== (inst.loader?.type || 'vanilla') || (d.loader.version || null) !== (inst.loader?.version || null))) {
        if (d.loader.type !== 'vanilla' && !d.loader.version) throw new Error(`${LOADER_NAMES[d.loader.type]} isn’t available for ${d.versionId} — pick another loader or version (Installation).`);
        if (isRunning(inst.id)) throw new Error('Close the game before changing its version.');
        patch.versionId = d.versionId; patch.loader = { type: d.loader.type, version: d.loader.version };
      }
      await api('instances:update', inst.id, patch);
      if (keysDirty) {
        // write the bindings back into options.txt, keeping every other line as it was
        const lines = keysText ? keysText.split(/\r?\n/) : [];
        const seen = new Set();
        const out = lines.map((l) => { const mm = l.match(/^key_(key\.[^:]+):/); if (mm && keys[mm[1]]) { seen.add(mm[1]); return `key_${mm[1]}:${keys[mm[1]]}`; } return l; });
        for (const [id, v] of Object.entries(keys)) if (!seen.has(id)) out.push(`key_${id}:${v}`);
        await api('files:write', inst.id, 'options.txt', out.filter((l, i) => l || i < out.length - 1).join('\n') + '\n');
      }
      await refreshInstances();
      toast('Settings saved');
      close();
    } catch (er) { toastErr(er); b.disabled = false; }
  };
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
