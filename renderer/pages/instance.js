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
      $('#icon-btn', el).onclick = (e) => contextMenu(e.clientX, e.clientY, [
        { label: 'Upload image…', icon: 'image', action: async () => { try { await api('instances:setIcon', inst.id); refreshInstances(); } catch (er) { toastErr(er); } } },
        ...EMOJIS.slice(0, 10).map((em) => ({ label: em === 'sun' ? 'Solaris' : em, icon: 'star', action: async () => { await api('instances:update', inst.id, { icon: em }); refreshInstances(); } })),
      ]);
    };
    el.innerHTML = `<div id="ihead" style="margin-bottom:22px"></div>
      <div class="tabs" id="itabs">
        <button data-t="content">Content</button><button data-t="worlds">Worlds</button><button data-t="console">Console</button><button data-t="settings">Settings</button>
      </div>
      <div id="ibody"></div>`;
    head();
    const show = (t) => {
      tab = t;
      $$('[data-t]', el).forEach((b) => b.classList.toggle('on', b.dataset.t === t));
      const body = $('#ibody', el);
      if (this.unsub) { this.unsub(); this.unsub = null; }
      this.unsub = this[t](body, inst) || null;
    };
    $$('[data-t]', el).forEach((b) => (b.onclick = () => show(b.dataset.t)));
    show(tab);
    ctx.on('instances', head);
    ctx.on('launch', (id) => id === inst.id && head());
    ctx.on('runs', head);
    return () => { if (this.unsub) this.unsub(); };
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
          <div class="info"><div class="title">${esc(m.name)} ${m.version ? `<span class="faint small">${esc(m.version)}</span>` : ''} ${up?.latest ? `<span class="chip accent">Update → ${esc(up.latest.version)}</span>` : ''}</div><div class="desc">${esc(m.file)}${m.description ? ' · ' + esc(m.description) : ''}</div></div>
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
      $$('[data-del]', box).forEach((b) => (b.onclick = async () => { if (await confirmDialog(`Move ${b.dataset.del} to the Recycle Bin?`, { danger: true, ok: T('Delete') })) { items = await api('instances:deleteContent', inst.id, kind, [b.dataset.del]); draw(); } }));
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
        if (b.dataset.b === 'del') { if (!(await confirmDialog(`Move ${files.length} file(s) to the Recycle Bin?`, { danger: true, ok: T('Delete') }))) return; items = await api('instances:deleteContent', inst.id, kind, files); }
        else items = await api('instances:setEnabled', inst.id, kind, files, b.dataset.b === 'on');
        selected.clear(); draw();
      }));
    };
    $$('[data-k]', body).forEach((b) => (b.onclick = () => { kind = b.dataset.k; updates = null; $$('[data-k]', body).forEach((x) => x.classList.toggle('on', x === b)); load(); }));
    $('#cf', body).oninput = (e) => { filter = e.target.value.toLowerCase(); draw(); };
    $('#browse', body).onclick = () => Router.go('browse', { type: kind === 'mods' ? 'mod' : kind === 'shaderpacks' ? 'shader' : 'resourcepack', instanceId: inst.id });
    $('#addf', body).onclick = async () => {
      const files = await api('dialog:open', { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Mods & packs', extensions: ['jar', 'zip', 'mrpack'] }] });
      if (files.length) { await api('instances:addFiles', inst.id, files, kind); load(); toast(`Added ${files.length} file(s)`); }
    };
    $('#upd', body).onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true; b.innerHTML = `${icon('refresh')}Checking…`;
      try {
        updates = await api('instances:checkUpdates', inst.id, kind);
        const n = updates.filter((u) => u.latest).length;
        toast(n ? `${n} update(s) available` : 'Everything is up to date', n ? 'info' : 'ok');
        draw();
        if (n > 1) {
          b.innerHTML = `${icon('download')}Update all (${n})`; b.disabled = false;
          b.onclick = async () => { b.disabled = true; for (const u of updates.filter((x) => x.latest)) { try { await api('instances:applyUpdate', inst.id, kind, u.file, u.latest.id); } catch (er) { toastErr(er); } } updates = null; toast('All updates installed'); load(); b.innerHTML = `${icon('refresh')}Check updates`; b.disabled = false; };
          return;
        }
      } catch (er) { toastErr(er); }
      b.disabled = false; b.innerHTML = `${icon('refresh')}Check updates`;
    };
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
    const onDrop = (e) => { e.preventDefault(); e.stopPropagation(); const files = [...e.dataTransfer.files].map((f) => window.solaris.pathForFile(f)); hideDrop(); api('instances:addFiles', inst.id, files).then((r) => { toast('Added ' + Object.entries(r).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ')); load(); if (r.modpacks) refreshInstances(); }).catch(toastErr); };
    body.addEventListener('drop', onDrop);
    body.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); showDrop(`Drop to add to ${inst.name}`); });
    load();
  },

  /* ---------- worlds ---------- */
  async worlds(body, inst) {
    body.innerHTML = '<div class="faint">Loading worlds…</div>';
    const ws = await api('instances:worlds', inst.id);
    body.innerHTML = ws.length ? `<div class="grid cols-wide">${ws.map((w) => `<div class="card row">
        ${w.icon ? `<img src="${w.icon}" style="width:56px;height:56px;border-radius:10px;image-rendering:pixelated">` : `<div class="mod-icon" style="width:56px;height:56px">${icon('world')}</div>`}
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
      <div class="setting"><div class="txt"><div class="t">Danger zone</div><div class="d">Delete moves the instance to the Recycle Bin.</div></div><div class="ctl"><button class="btn sm danger" id="s-del">${icon('trash')}${T('Delete')}</button></div></div>
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
        <p class="faint small">The newest stable loader version is used. Mods are not changed automatically — use Check updates afterwards.</p></div>`,
      footer: `<button class="btn ghost" data-c>${T('Cancel')}</button><button class="btn primary" data-s>${T('Save')}</button>`,
    });
    m.$('[data-c]').onclick = () => m.close();
    m.$('[data-s]').onclick = async () => {
      const mc = m.$('#cv-v').value, l = m.$('#cv-l').value;
      if (l !== 'vanilla') { const lv = await api('loaders:versions', l, mc); if (!lv.length) return toast(`${LOADER_NAMES[l]} is not available for ${mc}`, 'error'); }
      await api('instances:update', inst.id, { versionId: mc, loader: { type: l, version: null } });
      m.close(); await refreshInstances(); Router.reload(); toast('Version changed');
    };
  },
};

/* drag & drop overlay helpers */
let dropTimer;
function showDrop(text) {
  let d = $('.drop-overlay');
  if (!d) { d = document.createElement('div'); d.className = 'drop-overlay'; d.innerHTML = '<div></div>'; document.body.appendChild(d); }
  d.firstChild.textContent = text;
  clearTimeout(dropTimer); dropTimer = setTimeout(hideDrop, 300);
}
function hideDrop() { const d = $('.drop-overlay'); if (d) d.remove(); }
