/* Astra ecosystem pages, part 2: Discover, Cloud & Sync, the notification inbox, Server details. Backend: src/eco/. */

/* ---------- Discover ---------- */
Pages.discover = {
  state: { kind: 'mod', q: '', sort: 'relevance', inst: null, source: (() => { try { return localStorage.getItem('discover.source') || 'all'; } catch { return 'all'; } })() },
  async render(el) {
    const st = this.state;
    const kinds = await api('discover:kinds');
    el.innerHTML = `<div class="page-head"><div><h1>Discover</h1><div class="sub">One search across Modrinth and CurseForge — mods, modpacks, resource packs, shaders, maps and community content.</div></div></div>
      <div class="tabs">${kinds.map((k) => `<button data-k="${k.id}" class="${k.id === st.kind ? 'on' : ''}">${esc(k.name)}</button>`).join('')}</div>
      <div class="sticky-bar"><span class="seg" id="dsrc"><button data-src="all">Both</button><button data-src="modrinth">Modrinth</button><button data-src="curseforge">CurseForge</button></span><div class="search" style="width:300px">${icon('search')}<input type="search" id="dq" placeholder="${T('Search')}…" value="${esc(st.q)}"></div>
        <select id="ds"><option value="relevance">Best match</option><option value="downloads">Most downloaded</option><option value="updated">Recently updated</option></select>
        <select id="di"><option value="">Any version</option>${State.instances.map((i) => `<option value="${esc(i.id)}" ${st.inst === i.id ? 'selected' : ''}>For ${esc(i.name)} (${esc(i.versionId)})</option>`).join('')}</select></div>
      <div id="dprov" class="row wrap" style="margin:8px 0"></div><div id="dres" class="grid cols-wide"></div>
      <div id="dmore" class="row" style="justify-content:center;margin:18px 0 8px;min-height:36px"></div>`;
    $('#ds', el).value = st.sort;
    const drawSrc = () => $$('#dsrc [data-src]', el).forEach((b) => b.classList.toggle('on', b.dataset.src === st.source));
    $$('#dsrc [data-src]', el).forEach((b) => (b.onclick = () => { st.source = b.dataset.src; try { localStorage.setItem('discover.source', st.source); } catch {} drawSrc(); run(); }));
    drawSrc();
    $$('[data-k]', el).forEach((b) => (b.onclick = () => { st.kind = b.dataset.k; $$('[data-k]', el).forEach((x) => x.classList.toggle('on', x === b)); run(); }));
    $('#dq', el).oninput = debounce((e) => { st.q = e.target.value; run(); }, 350);
    $('#ds', el).onchange = (e) => { st.sort = e.target.value; run(); };
    $('#di', el).onchange = (e) => { st.inst = e.target.value || null; run(); };
    let seq = 0, page = 0, more = false, loading = false, results = [], seen = new Set();
    const key = (h) => String(h.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '') + '|' + h.type;
    const card = (h, i) => `<div class="card eco-hit"><div class="row">${h.icon ? `<img src="${esc(h.icon)}" alt="" loading="lazy">` : `<div class="inst-icon sm">${icon('box')}</div>`}<div class="grow" style="min-width:0"><b class="ellipsis">${esc(h.title)}</b><div class="faint small">${esc(h.author || '')} · ${fmtNum(h.downloads)} downloads</div></div></div>
          <div class="muted small eco-clamp">${esc(h.description)}</div>
          <div class="row"><span class="chip">${h.provider === 'modrinth' ? 'Modrinth' : 'CurseForge'}</span>${(h.alsoOn || []).map((a) => `<span class="chip">${a.provider === 'modrinth' ? 'Modrinth' : 'CurseForge'}</span>`).join('')}<span class="grow"></span>${h.url ? `<button class="icon-btn" data-open="${i}" title="Open page">${icon('external')}</button>` : ''}<button class="btn sm primary" data-inst="${i}">${icon('download')}${st.kind === 'modpack' ? 'Install pack' : 'Install'}</button></div></div>`;
    const bind = (root) => {
      $$('[data-open]', root).forEach((b) => (b.onclick = () => api('shell:open', results[+b.dataset.open].url)));
      $$('[data-inst]', root).forEach((b) => (b.onclick = async () => {
        const h = results[+b.dataset.inst];
        const inst = State.instances.find((i) => i.id === st.inst);
        let instanceId = null, world = null;
        if (st.kind !== 'modpack') {
          const pick = inst || await chooseInstance({ title: `Install ${h.title} into…`, filter: (x) => st.kind !== 'mod' || x.loader?.type !== 'vanilla' });
          if (!pick) return; instanceId = pick.id;
          if (h.type === 'datapack') {
            const worlds = await api('instances:worlds', pick.id);
            if (!worlds.length) return toast('Data packs go into a world — this instance has none yet.', 'info');
            world = worlds.length === 1 ? worlds[0].name : await promptDialog('Which world? (' + worlds.map((w) => w.name).join(', ') + ')', { value: worlds[0].name });
            if (!world) return;
          }
        }
        const html = b.innerHTML; b.disabled = true; b.innerHTML = icon('refresh', 'spin');
        try { await api('discover:install', { provider: h.provider, id: h.id, kind: st.kind === 'community' ? h.type : st.kind, instanceId, world }); b.innerHTML = icon('check') + T('Installed'); toast(`${h.title} installed`); if (st.kind === 'modpack') refreshInstances(); }
        catch (e) { toastErr(e); b.disabled = false; b.innerHTML = html; }
      }));
    };
    const footer = (text, retry) => {
      const f = $('#dmore', el); if (!f) return;
      f.innerHTML = loading ? `<span class="faint">${icon('refresh', 'spin')} Loading more…</span>`
        : retry ? `<span class="faint small">${esc(text)}</span><button class="btn sm" id="dretry">Try again</button>`
        : more ? '<button class="btn" id="dload">Load more</button>'
        : results.length ? `<span class="faint small">That’s everything — ${fmtNum(results.length)} results.</span>` : '';
      if ($('#dload', f)) $('#dload', f).onclick = () => run(true);
      if ($('#dretry', f)) $('#dretry', f).onclick = () => { more = true; run(true); };
    };
    const near = () => { const f = $('#dmore', el); return !!f && f.getBoundingClientRect().top < window.innerHeight + 600; };
    // One page at a time: a new search starts at page 0; scrolling near the bottom loads the next page.
    const run = async (append = false) => {
      if (append && (loading || !more)) return;
      const my = append ? seq : ++seq;
      const inst = State.instances.find((i) => i.id === st.inst);
      if (!append) { page = 0; more = false; results = []; seen = new Set(); $('#dres', el).innerHTML = '<div class="faint">Searching…</div>'; }
      loading = true; footer();
      let r;
      try { r = await api('discover:search', { kind: st.kind, query: st.q, sort: st.sort, gameVersion: inst?.versionId, loader: inst?.loader?.type, limit: 24, page: append ? page + 1 : 0, source: st.source }); }
      catch (e) {
        if (my !== seq || !el.isConnected) return;
        loading = false;
        if (append) { more = false; footer(e.message, true); } else { $('#dres', el).innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div></div>`; footer(); }
        return;
      }
      if (my !== seq || !el.isConnected) return;
      loading = false;
      if (append) page += 1;
      more = !!r.more;
      $('#dprov', el).innerHTML = r.providers.map((p) => `<span class="chip ${p.ok ? 'ok' : ''}" title="${esc(p.why || '')}">${esc(p.name)}${p.ok ? ` · ${fmtNum(p.total)}` : ` · ${esc(p.why)}`}</span>`).join('');
      const fresh = r.results.filter((h) => !seen.has(key(h)) && seen.add(key(h)));
      const from = results.length; results.push(...fresh);
      if (!append) $('#dres', el).innerHTML = fresh.length ? '' : `<div class="empty">${icon('search')}<div>${r.providers.every((p) => !p.ok) ? esc(r.providers.map((p) => p.why).join(' ')) : 'Nothing found.'}</div></div>`;
      const tmp = document.createElement('div'); tmp.innerHTML = fresh.map((h, i) => card(h, from + i)).join('');
      bind(tmp);
      $('#dres', el).append(...tmp.children);
      footer();
      // a page that was mostly duplicates, or a tall window: keep filling until the list can scroll
      if (more && near()) setTimeout(() => run(true), 50);
    };
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) run(true); }, { rootMargin: '0px 0px 600px 0px' });
    io.observe($('#dmore', el));
    run();
    return () => io.disconnect();
  },
};

/* ---------- Cloud & Sync ---------- */
Pages.backups = {
  async render(el) {
    el.innerHTML = `<div class="page-head"><div><h1>Backups & Sync</h1><div class="sub">Versioned backups of your settings, saved servers, friends, waypoints and every instance’s setup (options, config, mod list). Worlds and sign-ins aren’t included.</div></div>
      <div class="actions"><button class="btn" id="bk-open">${icon('folder')}Open folder</button><button class="btn primary" id="bk-new">${icon('plus')}Back up now</button></div></div><div id="bk"></div>`;
    $('#bk-open', el).onclick = () => api('backup:openFolder');
    $('#bk-new', el).onclick = (e) => ecoBusy(e.currentTarget, async () => { await api('backup:create', {}); toast('Backup saved'); draw(); });
    const draw = async () => {
      const [list, p, sync] = await Promise.all([api('backup:list'), api('backup:prefs'), api('sync:state')]);
      if (!el.isConnected) return;
      $('#bk', el).innerHTML = `<div class="grid cols-2">
        <div class="card stack"><h3 style="margin:0">${icon('clock')} Automatic backups</h3>
          <div class="row"><span class="grow">Back up automatically</span><label class="switch"><input type="checkbox" id="bk-auto" ${p.auto ? 'checked' : ''}><span></span></label></div>
          <div class="row"><span class="grow">Every</span><select id="bk-every">${[6, 12, 24, 72, 168].map((h) => `<option value="${h}" ${p.everyHours === h ? 'selected' : ''}>${h < 24 ? h + ' hours' : h === 24 ? 'day' : h === 72 ? '3 days' : 'week'}</option>`).join('')}</select></div>
          <div class="row"><span class="grow">Keep the newest</span><select id="bk-keep">${[5, 10, 20, 50].map((n) => `<option ${p.keep === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <p class="faint small">Backups you make yourself are never deleted automatically.</p></div>
        <div class="card stack"><h3 style="margin:0">${icon('globe')} Sync between PCs</h3>
          ${sync.configured ? `<div class="small">Sync folder: <span class="mono">${esc(sync.dir)}</span> ${sync.reachable ? '' : '<span class="chip danger">not found</span>'}</div>
            <div class="faint small">${sync.remote ? `Last sent by <b>${esc(sync.remote.device)}</b> ${timeAgo(sync.remote.updated)}` : 'Nothing sent yet.'}${sync.lastPull ? ` · received here ${timeAgo(sync.lastPull)}` : ''}</div>
            <div class="row wrap"><button class="btn sm" id="sy-push">${icon('upload')}Send this PC’s setup</button><button class="btn sm" id="sy-pull">${icon('download')}Get from sync folder…</button><button class="btn sm ghost" id="sy-dir">${icon('folder')}Change folder</button></div>`
          : `<p class="muted small">Astra has no online accounts, so there is nothing to sign in to. Choose a folder that your cloud drive already syncs (OneDrive, Dropbox, Google Drive, iCloud Drive or a network folder) — Astra keeps its sync file and backups there, and your drive moves them between PCs.</p><button class="btn" id="sy-dir">${icon('folder')}Choose sync folder</button>`}
        </div></div>
        <h2>Backups</h2>${list.length ? `<div class="card"><table class="hs-ptable"><tr><th>When</th><th>Kind</th><th>Instances</th><th>Size</th><th></th></tr>${list.map((b) => `<tr><td>${new Date(b.created).toLocaleString()}<div class="faint small">${esc(b.note || '')}</div></td><td><span class="chip ${b.kind === 'manual' ? 'accent' : ''}">${esc({ manual: 'Manual', auto: 'Automatic', 'pre-restore': 'Before restore' }[b.kind] || b.kind)}</span></td><td>${b.instances}</td><td class="faint small">${fmtBytes(b.size)}</td><td><div class="row" style="justify-content:flex-end;flex-wrap:nowrap"><button class="btn sm" data-rs="${esc(b.file)}" ${b.valid ? '' : 'disabled'}>${icon('refresh')}Restore…</button> <button class="icon-btn" data-rm="${esc(b.file)}" title="Delete">${icon('trash')}</button></div></td></tr>`).join('')}</table></div>`
          : `<div class="empty">${icon('hdd')}<div>No backups yet.</div></div>`}`;
      const save = async (patch) => { try { await api('backup:setPrefs', patch); } catch (e) { toastErr(e); } };
      $('#bk-auto', el).onchange = (e) => save({ auto: e.target.checked });
      $('#bk-every', el).onchange = (e) => save({ everyHours: +e.target.value });
      $('#bk-keep', el).onchange = (e) => save({ keep: +e.target.value });
      $('#sy-dir', el).onclick = async () => { try { if (await api('backup:chooseSyncDir')) draw(); } catch (e) { toastErr(e); } };
      const push = $('#sy-push', el); if (push) push.onclick = () => ecoBusy(push, async () => { await api('sync:push'); toast('Sent to the sync folder'); draw(); });
      const pull = $('#sy-pull', el); if (pull) pull.onclick = () => this.pull(draw);
      $$('[data-rm]', el).forEach((b) => (b.onclick = async () => { if (await confirmDialog(`Delete this backup? It goes to the ${TRASH}.`, { title: 'Delete backup', ok: 'Delete', danger: true })) { await api('backup:remove', b.dataset.rm); draw(); } }));
      $$('[data-rs]', el).forEach((b) => (b.onclick = () => this.restore(b.dataset.rs, draw)));
    };
    draw();
  },
  async restore(file, done) {
    let plan; try { plan = await api('backup:preview', file); } catch (e) { return toastErr(e); }
    const m = modal({ title: 'Restore backup', wide: true, body: `<p class="muted small">From ${new Date(plan.created).toLocaleString()}${plan.device ? ` on ${esc(plan.device)}` : ''}. Choose what to bring back — everything else stays as it is. Astra backs up the current state first.</p>
      <div class="grid cols-2"><div class="card stack"><b>Astra</b>${plan.data.map((d) => `<label class="row"><input type="checkbox" data-part="${esc(d.part)}"> ${esc(d.label)}</label>`).join('') || '<span class="faint small">—</span>'}</div>
      <div class="card stack"><b>Instances</b>${plan.instances.map((i) => `<label class="row"><input type="checkbox" data-inst="${esc(i.id)}"> ${esc(i.name)} <span class="faint small">${i.exists ? 'options, config, servers list' : 'not on this PC — made again (without mod files)'}${i.skipped.length ? ` · ${i.skipped.length} config file${i.skipped.length === 1 ? '' : 's'} with passwords or keys weren’t backed up` : ''}</span></label>`).join('') || '<span class="faint small">—</span>'}</div></div>
      <p class="faint small">Settings keep this PC’s data folder, memory, Java and keys. Restoring an instance overwrites its options.txt, config files and server list.</p>`,
      footer: `<button class="btn ghost" data-no>${T('Cancel')}</button><button class="btn primary" data-go>${icon('refresh')}Restore selected</button>` });
    m.$('[data-no]').onclick = () => m.close();
    m.$('[data-go]').onclick = async () => {
      const choice = { data: $$('[data-part]', m.el).filter((c) => c.checked).map((c) => c.dataset.part), instances: $$('[data-inst]', m.el).filter((c) => c.checked).map((c) => c.dataset.inst) };
      if (!choice.data.length && !choice.instances.length) return toast('Choose what to restore', 'info');
      try { const r = await api('backup:restore', file, choice); m.close(); toast(`Restored ${r.restored.length} item${r.restored.length === 1 ? '' : 's'}`); State.settings = await api('settings:get'); Bus.emit('settings', State.settings); refreshInstances(); done && done(); } catch (e) { toastErr(e); }
    };
  },
  async pull(done) {
    let pv; try { pv = await api('sync:preview'); } catch (e) { return toastErr(e); }
    if (pv.empty) return toast('The sync folder is empty — send a setup from another PC first.', 'info');
    const m = modal({ title: `Get setup from ${pv.device}`, wide: true, body: `<p class="muted small">Sent ${timeAgo(pv.updated)}${pv.sameDevice ? ' (by this PC)' : ''}. Astra backs up the current state first.</p>
      <label class="row"><input type="checkbox" id="pu-s" checked> Settings${pv.settings.length ? `: ${esc(pv.settings.join(', '))}` : ' (no changes)'}</label>
      <label class="row"><input type="checkbox" id="pu-v" checked> Saved servers${pv.serversAdded.length || pv.serversUpdated.length ? `: ${pv.serversAdded.length} new, ${pv.serversUpdated.length} changed` : ' (no changes)'}</label>
      ${pv.backups.length ? `<h4>Backups in the sync folder</h4>${pv.backups.slice(0, 8).map((b) => `<div class="row"><span class="grow mono small">${esc(b)}</span><button class="btn sm" data-imp="${esc(b)}">${icon('download')}Copy here</button></div>`).join('')}<p class="faint small">Copied backups appear in your list; restore instances from there.</p>` : ''}`,
      footer: `<button class="btn ghost" data-no>${T('Cancel')}</button><button class="btn primary" data-go>${icon('download')}Apply</button>` });
    m.$('[data-no]').onclick = () => m.close();
    $$('[data-imp]', m.el).forEach((b) => (b.onclick = async () => { try { await api('sync:importBackup', b.dataset.imp); b.disabled = true; b.textContent = 'Copied'; done && done(); } catch (e) { toastErr(e); } }));
    m.$('[data-go]').onclick = async () => { try { await api('sync:pull', { settings: m.$('#pu-s').checked, servers: m.$('#pu-v').checked }); m.close(); toast('Synced'); State.settings = await api('settings:get'); Bus.emit('settings', State.settings); done && done(); } catch (e) { toastErr(e); } };
  },
};

/* ---------- Notifications: titlebar bell + inbox ---------- */
// Lucide "bell" (ISC License, Copyright (c) Lucide Contributors), same icon set as lib/icons.js
if (!ICONS.bell) ICONS.bell = '<path d="M10.268 21a2 2 0 0 0 3.464 0" /><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />';
const Inbox = {
  count: 0,
  async init() {
    const tb = $('#tb-changelog'); if (!tb || $('#tb-inbox')) return;
    const b = document.createElement('button');
    b.className = 'title-link'; b.id = 'tb-inbox'; b.title = 'Notifications';
    tb.parentNode.insertBefore(b, tb);
    b.onclick = () => this.open();
    window.solaris.on('notify:new', () => this.refresh());
    this.refresh();
  },
  async refresh() { try { this.count = await api('notify:unread'); } catch {} const b = $('#tb-inbox'); if (b) b.innerHTML = `${icon('bell')}${this.count ? `<span class="count">${this.count > 99 ? '99+' : this.count}</span>` : ''}`; },
  async open() {
    const [items, p] = await Promise.all([api('notify:list', { limit: 100 }), api('notify:prefs')]);
    const m = modal({ title: 'Notifications', wide: true, body: `<div class="tabs"><button data-v="in" class="on">Inbox</button><button data-v="prefs">What to tell me</button></div><div id="ib"></div>`, footer: `<button class="btn ghost" data-clear>${icon('trash')}Clear all</button><button class="btn" data-read>${icon('check')}Mark all read</button>` });
    const box = m.$('#ib');
    const inbox = () => {
      box.innerHTML = items.length ? `<div class="stack">${items.map((n, i) => `<div class="row card eco-note ${n.read ? '' : 'unread'}" data-n="${i}" style="padding:10px;${n.action ? 'cursor:pointer' : ''}"><span class="chip">${esc(p.categories[n.category]?.name || n.category)}</span><div class="grow" style="min-width:0"><b>${esc(n.title)}</b>${n.body ? `<div class="faint small">${esc(n.body)}</div>` : ''}</div><span class="faint small">${timeAgo(n.at)}</span><button class="icon-btn" data-del="${esc(n.id)}" title="Remove">${icon('close')}</button></div>`).join('')}</div>` : `<div class="empty">${icon('check')}<div>Nothing new.</div></div>`;
      $$('[data-n]', box).forEach((r) => (r.onclick = (e) => {
        if (e.target.closest('[data-del]')) return;
        const n = items[+r.dataset.n]; api('notify:read', [n.id]).then(() => this.refresh());
        if (!n.action) return;
        m.close();
        if (n.action.kind === 'server') Pages.servers.join(n.action.address);
        else if (n.action.kind === 'route') Router.go(n.action.page, n.action.params || {});
      }));
      $$('[data-del]', box).forEach((b) => (b.onclick = async () => { await api('notify:remove', b.dataset.del); items.splice(items.findIndex((x) => x.id === b.dataset.del), 1); inbox(); this.refresh(); }));
    };
    const prefs = () => {
      box.innerHTML = `<table class="hs-ptable"><tr><th>Category</th><th>In Astra</th><th>Desktop pop-up</th></tr>${Object.entries(p.categories).map(([k, c]) => `<tr><td>${esc(c.name)}</td><td><label class="switch"><input type="checkbox" data-pk="${k}" data-f="enabled" ${p.prefs[k].enabled ? 'checked' : ''}><span></span></label></td><td><label class="switch"><input type="checkbox" data-pk="${k}" data-f="desktop" ${p.prefs[k].desktop ? 'checked' : ''}><span></span></label></td></tr>`).join('')}</table>
        <p class="faint small">Desktop pop-ups only appear while Astra is in the background and Settings → Notifications is on. Server and friend alerts come from Astra Connect → Server monitoring (and a server’s “Alerts” switch in its details).</p>`;
      $$('[data-pk]', box).forEach((c) => (c.onchange = async () => { p.prefs = await api('notify:setPrefs', { [c.dataset.pk]: { [c.dataset.f]: c.checked } }); }));
    };
    $$('[data-v]', m.el).forEach((b) => (b.onclick = () => { $$('[data-v]', m.el).forEach((x) => x.classList.toggle('on', x === b)); b.dataset.v === 'in' ? inbox() : prefs(); }));
    m.$('[data-read]').onclick = async () => { await api('notify:read', 'all'); items.forEach((n) => (n.read = true)); inbox(); this.refresh(); };
    m.$('[data-clear]').onclick = async () => { await api('notify:clear'); items.length = 0; inbox(); this.refresh(); };
    inbox();
  },
};

/* ---------- Server details (saved servers) ---------- */
async function openServerDetails(serverId) {
  const m = modal({ title: 'Server details', wide: true, body: '<div class="faint">Loading…</div>' });
  const draw = async () => {
    let p; try { p = await api('srv:profile', serverId); } catch (e) { m.$('.content').innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div></div>`; return; }
    const live = await api('srv:live', p.server.address).catch(() => null);
    const u = p.uptime;
    const pct = (x) => (x == null ? '—' : x + '%');
    m.$('.content').innerHTML = `<div class="row" style="margin-bottom:10px"><div class="grow"><h3 style="margin:0">${esc(p.server.name)}</h3><div class="mono faint small">${esc(p.server.address)}</div></div>
        ${live?.online ? `<span class="chip ok">Online · ${live.players.online}/${live.players.max}</span>` : '<span class="chip danger">Offline</span>'}${live?.software?.name ? `<span class="chip" title="${esc(live.software.hint)}">${esc(live.software.name)}${live.software.confidence === 'likely' ? '?' : ''}</span>` : ''}</div>
      <div class="grid cols-3"><div class="card stat"><span class="v">${pct(u.day)}</span><span class="l">Online, last 24 h · ${pct(u.week)} 7 days</span></div>
        <div class="card stat"><span class="v">${u.avgLatency != null ? u.avgLatency + ' ms' : '—'}</span><span class="l">Average ping · ${u.checks} checks</span></div>
        <div class="card stat"><span class="v">${u.longestOutageMs ? fmtDuration(u.longestOutageMs) : '—'}</span><span class="l">Longest outage${u.lastOnline ? ` · last seen online ${timeAgo(u.lastOnline)}` : ''}</span></div></div>
      <div class="card" style="margin-top:10px"><div class="faint small">Last 7 days (each bar is an hour; empty = not checked)</div><div class="eco-hours">${p.hours.map((h) => `<i style="background:${h == null ? 'var(--panel-3)' : h >= 0.99 ? 'var(--ok)' : h > 0 ? 'var(--warn)' : 'var(--danger)'}"></i>`).join('')}</div></div>
      ${live?.players?.sample?.length ? `<div class="row wrap" style="margin-top:8px"><span class="faint small">Playing now:</span>${live.players.sample.map((n) => `<span class="chip">${esc(n)}</span>`).join('')}</div>` : ''}
      <div class="grid cols-2" style="margin-top:12px"><div class="stack">
        <label class="field">Play with instance<select id="sd-inst"><option value="">Ask every time</option>${State.instances.map((i) => `<option value="${esc(i.id)}" ${p.server.instanceId === i.id ? 'selected' : ''}>${esc(i.name)} (${esc(i.versionId)})</option>`).join('')}</select></label>
        <div class="row"><span class="grow">Alerts when it goes online / offline</span><label class="switch"><input type="checkbox" id="sd-notify" ${p.server.notify ? 'checked' : ''}><span></span></label></div>
        <label class="field">Notes<textarea id="sd-notes" rows="3">${esc(p.server.notes || '')}</textarea></label></div>
        <div class="stack"><b class="small">Join history</b>${p.joins.length ? p.joins.slice(0, 8).map((j) => `<div class="small">${timeAgo(j.at)} · ${esc(State.instances.find((i) => i.id === j.instanceId)?.name || 'instance')}</div>`).join('') : '<div class="faint small">You haven’t joined it from Astra yet.</div>'}</div></div>`;
    m.$('#sd-inst').onchange = async (e) => { try { await api('srv:setProfile', serverId, { instanceId: e.target.value || null }); toast('Saved'); } catch (er) { toastErr(er); } };
    m.$('#sd-notes').onchange = (e) => api('srv:setProfile', serverId, { notes: e.target.value }).catch(toastErr);
    m.$('#sd-notify').onchange = async (e) => {
      try { await api('srv:setProfile', serverId, { notify: e.target.checked }); } catch (er) { return toastErr(er); }
      if (e.target.checked) { const w = await api('connect:get', 'server-watch').catch(() => null); if (w && !w.enabled && await confirmDialog('Alerts need Astra Connect’s server monitoring, which is off. Turn it on? (It pings your favourite and alert servers every few minutes.)', { title: 'Server monitoring', ok: 'Turn on' })) { await api('connect:setEnabled', 'server-watch', true); toast('Server monitoring is on'); } }
    };
  };
  const foot = document.createElement('footer');
  foot.innerHTML = `<button class="btn" data-test>${icon('wifi')}Test connection</button><button class="btn primary" data-join>${icon('play')}Join</button>`;
  m.el.appendChild(foot);
  foot.querySelector('[data-test]').onclick = async () => { const s = (await api('servers:list')).servers.find((x) => x.id === serverId); m.close(); Router.go('assistant', { tab: 'server', address: s?.address }); };
  foot.querySelector('[data-join]').onclick = async () => { const s = (await api('servers:list')).servers.find((x) => x.id === serverId); if (!s) return; m.close(); Pages.servers.join(s.address, s.instanceId ? { instance: s.instanceId } : {}); };
  draw();
}
