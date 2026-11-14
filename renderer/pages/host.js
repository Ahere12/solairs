/* Hosting: create, run and manage Minecraft servers on this PC, and make them public (e4mc or playit.gg). */
const HOST_SW = [['vanilla', 'Vanilla'], ['paper', 'Paper'], ['purpur', 'Purpur'], ['fabric', 'Fabric'], ['forge', 'Forge'], ['neoforge', 'NeoForge']];
const HOST_E4MC = ['fabric', 'forge', 'neoforge'];
const fmtUp = (ms) => { if (!ms) return '—'; const s = Math.floor(ms / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`; };

Pages.host = {
  logs: new Map(), stats: new Map(), playit: null,

  async render(el, params, ctx) {
    if (params.id) return this.detail(el, params.id, ctx, params.tab);
    const draw = async () => {
      const [list, pl] = await Promise.all([api('hosted:list'), api('playit:status').catch(() => null)]);
      this.playit = pl;
      if (!el.isConnected) return;
      el.innerHTML = `
        <div class="page-head"><div><h1>Hosting</h1><div class="sub">Run Minecraft servers on this PC — friends join from anywhere, no paid hosting.</div></div>
          <div class="actions"><button class="btn primary" id="hs-new">${icon('plus')}New server</button></div></div>
        ${this.playitPanel(pl)}
        ${list.length ? `<div class="hs-grid">${list.map((s) => this.card(s)).join('')}</div>` : `
          <div class="hs-empty">
            <div class="hs-steps">
              <div><b>1</b><span>Create a server</span><small>Vanilla, Paper, Purpur, Fabric, Forge or NeoForge — Solaris downloads everything.</small></div>
              <div><b>2</b><span>Press Start</span><small>Java and the server files are set up automatically.</small></div>
              <div><b>3</b><span>Share the address</span><small>A public address appears here. Friends paste it into Multiplayer.</small></div>
            </div>
            <button class="btn primary lg" id="hs-new2">${icon('host')}Create your first server</button>
          </div>`}
        <p class="faint small" style="margin-top:18px">Your PC runs the servers, so they’re online while Solaris and your PC are on. Public addresses: <b>e4mc</b> (Fabric/Forge/NeoForge, no account) or <b>playit.gg</b> (any server, free account).</p>`;
      $('#hs-new', el).onclick = () => this.create();
      if ($('#hs-new2', el)) $('#hs-new2', el).onclick = () => this.create();
      this.bindPlayit(el, draw);
      this.bindCards(el, draw);
    };
    await draw();
    ctx.on('hosted', () => draw());
    ctx.on('playit', () => draw());
    ctx.on('hosted-stats', (s) => { const c = $(`[data-open="${CSS.escape(s.id)}"] .hs-stats`, el); if (c) c.innerHTML = this.statsHtml(s); });
  },

  playitPanel(pl) {
    if (!pl) return '';
    if (pl.claim && pl.claim.state === 'waiting') return `<div class="card hs-playit wait">${icon('globe')}<div class="grow"><b>Approve Solaris on playit.gg</b><div class="faint small">A browser tab opened. Sign in (or make a free account) and press <b>Add agent</b>. This page updates by itself.</div></div><button class="btn sm" data-pl="open">${icon('external')}Open again</button><button class="btn sm ghost" data-pl="cancel">${T('Cancel')}</button></div>`;
    if (pl.linked) {
      const a = pl.agent?.state;
      return `<div class="card hs-playit ok">${icon('globe')}<div class="grow"><b>playit.gg connected</b><div class="faint small">Agent: ${a === 'online' ? 'running' : a === 'connecting' ? 'connecting…' : 'starts with a server that uses playit.gg'}${pl.agent?.lastError ? ` · <span class="danger-text">${esc(pl.agent.lastError)}</span>` : ''}</div></div><button class="btn sm ghost" data-pl="dash">${icon('external')}Dashboard</button><button class="btn sm ghost" data-pl="unlink">Disconnect</button></div>`;
    }
    const msg = pl.claim?.state === 'rejected' ? 'You declined on playit.gg.' : pl.claim?.state === 'expired' ? 'The approval timed out.' : pl.claim?.state === 'error' ? esc(pl.claim.error || 'Something went wrong.') : '';
    return `<div class="card hs-playit">${icon('globe')}<div class="grow"><b>playit.gg — public address for any server</b><div class="faint small">Free. You approve this PC once on playit.gg, then Solaris creates the tunnels for you. ${msg}</div></div><button class="btn sm primary" data-pl="connect">${icon('link')}Connect playit.gg</button></div>`;
  },
  bindPlayit(root, redraw) {
    $$('[data-pl]', root).forEach((b) => (b.onclick = async () => {
      const a = b.dataset.pl;
      try {
        if (a === 'connect') { b.disabled = true; await api('playit:connect'); }
        if (a === 'open') api('shell:open', this.playit?.claim?.url);
        if (a === 'cancel') await api('playit:cancel');
        if (a === 'dash') api('shell:open', 'https://playit.gg/account/tunnels');
        if (a === 'unlink' && (await confirmDialog('Disconnect playit.gg from Solaris? Servers using playit.gg won’t be public until you connect again.', { ok: 'Disconnect' }))) await api('playit:unlink');
      } catch (e) { toastErr(e); }
      redraw && redraw();
    }));
  },

  statsHtml(s) {
    const st = s.stats || s;
    return `<span title="CPU">${icon('cpu')}${st.cpu != null ? Math.round(st.cpu) + '%' : '—'}</span><span title="Memory">${icon('hdd')}${st.ramMb ? (st.ramMb / 1024).toFixed(1) + ' GB' : '—'}</span><span title="Uptime">${icon('clock')}${fmtUp(st.uptime || (s.started ? Date.now() - s.started : 0))}</span>`;
  },
  stateChip(s) {
    const st = { offline: ['', 'Offline'], starting: ['warn', 'Starting…'], online: ['ok', 'Online'], stopping: ['warn', 'Stopping…'], restarting: ['warn', 'Restarting…'] }[s.state] || ['', s.state];
    return `<span class="chip ${st[0]}">${st[1]}</span>`;
  },
  card(s) {
    if (s.missing) return `<div class="hs-card"><div class="hs-top"><div class="hs-ic">${icon('alert')}</div><div class="grow"><b>${esc(s.name)}</b><div class="faint small">${esc(s.error)}</div></div></div><div class="hs-foot"><div class="grow"></div><button class="btn sm ghost" data-forget="${esc(s.id)}">Remove from list</button></div></div>`;
    const ts = s.tunnelStatus || {};
    return `<div class="hs-card ${s.state}" data-open="${esc(s.id)}">
      <div class="hs-top"><div class="hs-ic">${icon('host')}</div><div class="grow" style="min-width:0"><b class="ellipsis">${esc(s.name)}</b><div class="faint small">${esc(s.softwareName)} ${esc(s.mc)} · ${s.players.length}/${s.maxPlayers || '?'} players</div></div>${this.stateChip(s)}</div>
      <div class="hs-addr">${s.address ? `${icon('globe')}<span class="mono ellipsis">${esc(s.address)}</span><button class="icon-btn" data-copy="${esc(s.address)}" title="Copy address">${icon('copy')}</button>`
        : `${icon(ts.ok ? 'globe' : 'wifi')}<span class="faint small ellipsis">${esc(ts.text || '')}${s.tunnel === 'none' ? ` · ${esc(s.lan)}` : ''}</span>`}</div>
      <div class="hs-stats">${s.state === 'offline' ? '<span class="faint small">Stopped</span>' : this.statsHtml(s)}</div>
      <div class="hs-foot"><div class="grow"></div>
        ${s.state === 'offline' ? `<button class="btn sm primary" data-start="${esc(s.id)}">${icon('play')}Start</button>`
          : `<button class="btn sm" data-restart="${esc(s.id)}" ${s.state !== 'online' ? 'disabled' : ''} title="Restart">${icon('refresh')}</button><button class="btn sm" data-stop="${esc(s.id)}" ${/stopping|restarting/.test(s.state) ? 'disabled' : ''}>${icon('power')}Stop</button>`}
        <button class="icon-btn" data-more="${esc(s.id)}" title="More">${icon('more')}</button></div>
    </div>`;
  },
  bindCards(root, redraw) {
    $$('[data-open]', root).forEach((c) => (c.onclick = (e) => { if (e.target.closest('button')) return; Router.go('host', { id: c.dataset.open }); }));
    $$('[data-copy]', root).forEach((b) => (b.onclick = () => { api('clipboard:write', b.dataset.copy); toast('Address copied — friends paste it into Multiplayer → Add Server'); }));
    $$('[data-start]', root).forEach((b) => (b.onclick = () => this.start(b.dataset.start, b)));
    $$('[data-stop]', root).forEach((b) => (b.onclick = async () => { b.disabled = true; await api('hosted:stop', b.dataset.stop).catch(toastErr); }));
    $$('[data-restart]', root).forEach((b) => (b.onclick = async () => { b.disabled = true; await api('hosted:restart', b.dataset.restart).catch(toastErr); }));
    $$('[data-forget]', root).forEach((b) => (b.onclick = async () => { await api('hosted:remove', b.dataset.forget).catch(toastErr); redraw(); }));
    $$('[data-more]', root).forEach((b) => (b.onclick = (e) => {
      const id = b.dataset.more;
      contextMenu(e.clientX, e.clientY, [
        { label: 'Open', icon: 'host', action: () => Router.go('host', { id }) },
        { label: 'Settings', icon: 'sliders', action: () => Router.go('host', { id, tab: 'settings' }) },
        { label: 'Open folder', icon: 'folder', action: () => api('hosted:openFolder', id) },
        '-',
        { label: 'Delete', icon: 'trash', danger: true, action: () => this.remove(id) },
      ]);
    }));
  },
  async start(id, btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = `${icon('refresh', 'spin')}Starting`; }
    try { await api('hosted:start', id); } catch (e) { toastErr(e); if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = `${icon('play')}Start`; } }
  },
  async remove(id) {
    const s = await api('hosted:get', id).catch(() => null);
    if (!(await confirmDialog(`Delete ${s?.name || 'this server'} forever? Its folder, worlds and backups are removed. This can’t be undone.`, { danger: true, ok: 'Delete forever' }))) return;
    try { await api('hosted:remove', id); toast('Server deleted'); Router.go('host'); } catch (e) { toastErr(e); }
  },

  // ---------- create ----------
  async create() {
    const totalGb = (State.info?.totalMem || 8 * 1024 ** 3) / 1024 ** 3;
    const def = totalGb <= 8 ? 2048 : 4096;
    let sw = 'fabric', folder = null, pack = null;
    const m = modal({
      title: 'New server', wide: true,
      body: `<div class="hs-create">
        <label class="field">Name<input type="text" id="hc-name" maxlength="40" placeholder="My server"></label>
        <div class="field">Server software<div class="seg hc-sw">${HOST_SW.map(([k, n]) => `<button data-sw="${k}" class="${k === sw ? 'on' : ''}">${n}</button>`).join('')}</div><div class="faint small" id="hc-sw-note"></div></div>
        <div class="row"><label class="field grow">Minecraft version<select id="hc-mc"><option>Loading…</option></select></label>
          <label class="field" style="width:120px">Max players<input type="number" id="hc-max" min="1" max="200" value="10"></label>
          <label class="field" style="width:120px">Port<input type="number" id="hc-port" min="1024" max="65535" placeholder="auto"></label></div>
        <label class="field">Memory <span class="faint small" id="hc-memv">${def / 1024} GB</span><input type="range" id="hc-mem" min="1024" max="${Math.max(2048, Math.floor(totalGb * 0.7) * 1024)}" step="512" value="${def}"></label>
        <div class="field">Folder<div class="row"><span class="mono small grow ellipsis" id="hc-dir">Default (inside Solaris data)</span><button class="btn sm" id="hc-pick">${icon('folder')}Choose…</button></div></div>
        <div class="field">Public address<div class="seg" id="hc-tun"><button data-t="e4mc">e4mc (no account)</button><button data-t="playit">playit.gg</button><button data-t="none">Home network only</button></div><div class="faint small" id="hc-tun-note"></div></div>
        <div class="field" id="hc-pack-wrap">Modpack <span class="faint small">(optional, from Modrinth)</span><div class="row"><span class="grow small" id="hc-pack">None</span><button class="btn sm" id="hc-pack-pick">${icon('search')}Choose modpack…</button></div></div>
        <label class="row" style="gap:10px;align-items:flex-start"><input type="checkbox" id="hc-eula"><span>I accept the <a href="#" id="hc-eula-link">Minecraft EULA</a> — required to run a Minecraft server.</span></label>
      </div>`,
      footer: `<button class="btn ghost" data-x>${T('Cancel')}</button><button class="btn primary" data-go disabled>${icon('host')}Create server</button>`,
    });
    let tun = 'e4mc';
    const go = m.$('[data-go]');
    const setTun = (t) => {
      if (t === 'e4mc' && !HOST_E4MC.includes(sw)) t = 'playit';
      tun = t;
      $$('[data-t]', m.el).forEach((b) => { b.classList.toggle('on', b.dataset.t === t); b.disabled = b.dataset.t === 'e4mc' && !HOST_E4MC.includes(sw); });
      m.$('#hc-tun-note').innerHTML = t === 'e4mc' ? 'Instant public address, nothing to sign up for. Uses the free e4mc relay.'
        : t === 'playit' ? (this.playit?.linked ? 'playit.gg is connected — Solaris creates the tunnel when the server starts.' : 'Needs a free playit.gg account — you connect it once from the Hosting page.')
        : `Only people on your Wi-Fi/LAN can join (port ${m.$('#hc-port').value || 'auto'}).`;
    };
    const loadVersions = async () => {
      const sel = m.$('#hc-mc'); sel.innerHTML = '<option>Loading…</option>'; sel.disabled = true;
      try { const vs = await api('hosted:versions', sw); if (!m.el.isConnected) return; sel.innerHTML = vs.slice(0, 80).map((v) => `<option>${esc(v)}</option>`).join(''); }
      catch (e) { sel.innerHTML = '<option value="">Couldn’t load versions</option>'; toastErr(e); }
      sel.disabled = false;
    };
    const setSw = (k) => {
      sw = k; pack = null; m.$('#hc-pack').textContent = 'None';
      $$('[data-sw]', m.el).forEach((b) => b.classList.toggle('on', b.dataset.sw === k));
      m.$('#hc-sw-note').textContent = { vanilla: 'The official server — no mods or plugins.', paper: 'Fast, plugin server (Bukkit/Spigot/Paper plugins).', purpur: 'Paper with extra options and plugin support.', fabric: 'Lightweight mod server — great for performance mods and modpacks.', forge: 'Classic mod server for Forge mods and modpacks.', neoforge: 'Modern Forge fork for NeoForge mods and modpacks.' }[k];
      m.$('#hc-pack-wrap').classList.toggle('hidden', !['fabric', 'forge', 'neoforge'].includes(k));
      setTun(tun); loadVersions();
    };
    $$('[data-sw]', m.el).forEach((b) => (b.onclick = () => setSw(b.dataset.sw)));
    $$('[data-t]', m.el).forEach((b) => (b.onclick = () => setTun(b.dataset.t)));
    m.$('#hc-mem').oninput = (e) => (m.$('#hc-memv').textContent = `${e.target.value / 1024} GB`);
    m.$('#hc-pick').onclick = async () => { const [d] = await api('dialog:open', { title: 'Choose an empty folder for the server', properties: ['openDirectory', 'createDirectory'] }).catch(() => []); if (d) { folder = d; m.$('#hc-dir').textContent = d; } };
    m.$('#hc-eula').onchange = (e) => (go.disabled = !e.target.checked);
    m.$('#hc-eula-link').onclick = (e) => { e.preventDefault(); api('shell:open', 'https://www.minecraft.net/eula'); };
    m.$('#hc-pack-pick').onclick = async () => { const p = await this.pickModpack(sw, m.$('#hc-mc').value); if (p) { pack = p; m.$('#hc-pack').textContent = `${p.title} · ${p.versionName}`; } };
    m.$('[data-x]').onclick = () => m.close();
    go.onclick = async () => {
      go.disabled = true; go.innerHTML = `${icon('refresh', 'spin')}Setting up…`;
      try {
        const s = await api('hosted:create', { name: m.$('#hc-name').value.trim() || undefined, software: sw, mc: m.$('#hc-mc').value, memory: +m.$('#hc-mem').value, maxPlayers: +m.$('#hc-max').value, port: m.$('#hc-port').value ? +m.$('#hc-port').value : undefined, dir: folder, tunnel: tun, eula: m.$('#hc-eula').checked, modpack: pack ? { versionId: pack.versionId } : null });
        m.close();
        toast(`${s.name} is ready — press Start`);
        Router.go('host', { id: s.id });
      } catch (e) { toastErr(e); go.disabled = false; go.innerHTML = `${icon('host')}Create server`; }
    };
    setSw('fabric');
  },
  pickModpack(sw, mc) {
    return new Promise((resolve) => {
      let done = false;
      const m = modal({ title: `Modpacks for ${sw} ${mc}`, body: `<div class="search" style="margin-bottom:10px">${icon('search')}<input type="search" id="mp-q" placeholder="Search modpacks…"></div><div id="mp-list" class="stack" style="gap:6px"><div class="faint">Loading…</div></div>`, onClose: () => { if (!done) resolve(null); } });
      const load = debounce(async () => {
        const list = await api('hosted:searchModpacks', m.$('#mp-q').value, sw, mc).catch(() => []);
        const box = m.$('#mp-list'); if (!box) return;
        box.innerHTML = list.length ? list.map((p) => `<div class="list-row" data-mp="${esc(p.id)}" style="cursor:pointer"><img src="${esc(p.icon || '')}" style="width:36px;height:36px;border-radius:8px" alt=""><div class="info"><div class="title">${esc(p.title)}</div><div class="desc">${esc(p.description)}</div></div></div>`).join('') : `<div class="faint">No ${esc(sw)} modpacks for ${esc(mc)}.</div>`;
        $$('[data-mp]', box).forEach((r) => (r.onclick = async () => {
          const vs = await api('hosted:modpackVersions', r.dataset.mp, sw, mc).catch(() => []);
          if (!vs.length) return toast('No version of this modpack for that Minecraft version', 'warn');
          done = true; resolve({ title: list.find((p) => p.id === r.dataset.mp).title, versionId: vs[0].id, versionName: vs[0].number }); m.close();
        }));
      }, 300);
      m.$('#mp-q').oninput = load; load();
    });
  },

  // ---------- server page ----------
  async detail(el, id, ctx, tab = 'console') {
    let s;
    try { s = await api('hosted:get', id); } catch (e) { el.innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div><button class="btn sm" id="bk">← Back</button></div>`; $('#bk', el).onclick = () => Router.go('host'); return; }
    if (!this.logs.has(id) || !this.logs.get(id).length) this.logs.set(id, await api('hosted:logs', id).catch(() => []));
    const TABS = [['console', 'Console', 'console'], ['players', 'Players', 'users'], ['worlds', 'Worlds', 'world'], ['backups', 'Backups', 'download'], ['content', s.contentKind === 'plugins' ? 'Plugins' : 'Mods', 'package'], ['properties', 'Properties', 'list'], ['logs', 'Log files', 'file'], ['settings', 'Settings', 'sliders']].filter((t) => t[0] !== 'content' || s.contentKind !== 'none');
    el.innerHTML = `
      <div class="page-head"><div><a href="#" id="hs-back" class="small">← All servers</a><h1 class="row" style="gap:10px">${esc(s.name)} <span id="hs-chip">${this.stateChip(s)}</span></h1><div class="sub">${esc(s.softwareName)} ${esc(s.mc)} · port ${s.port}</div></div>
        <div class="actions" id="hs-actions"></div></div>
      <div class="card hs-share" id="hs-share"></div>
      <div class="hs-statbar" id="hs-statbar"></div>
      <div class="tabs hs-tabs">${TABS.map(([k, n, ic]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${icon(ic)}${n}</button>`).join('')}</div>
      <div id="hs-tab"></div>`;
    $('#hs-back', el).onclick = (e) => { e.preventDefault(); Router.go('host'); };
    const drawHead = () => {
      $('#hs-chip', el).innerHTML = this.stateChip(s);
      $('#hs-actions', el).innerHTML = s.state === 'offline' ? `<button class="btn primary lg play" id="a-start">${icon('play')}Start</button>`
        : `<button class="btn lg" id="a-join" ${s.state !== 'online' ? 'disabled' : ''}>${icon('sun')}Join</button><button class="btn lg" id="a-restart" ${s.state !== 'online' ? 'disabled' : ''}>${icon('refresh')}Restart</button><button class="btn lg danger" id="a-stop" ${/stopping|restarting/.test(s.state) ? 'disabled' : ''}>${icon('power')}Stop</button>`;
      if ($('#a-start', el)) $('#a-start', el).onclick = (e) => this.start(id, e.currentTarget);
      if ($('#a-stop', el)) $('#a-stop', el).onclick = (e) => { e.currentTarget.disabled = true; api('hosted:stop', id); };
      if ($('#a-restart', el)) $('#a-restart', el).onclick = (e) => { e.currentTarget.disabled = true; api('hosted:restart', id); };
      if ($('#a-join', el)) $('#a-join', el).onclick = () => Pages.servers.join(`localhost:${s.port}`);
      const ts = s.tunnelStatus || {}, share = $('#hs-share', el);
      share.className = `card hs-share ${s.address ? 'live' : ''}`;
      share.innerHTML = s.address
        ? `<div class="hs-live-dot"></div><div class="grow" style="min-width:0"><div class="faint small">${esc(ts.text)} — send this to friends</div><div class="hs-big mono ellipsis">${esc(s.address)}</div></div><button class="btn" data-c="addr">${icon('copy')}Copy</button><button class="btn primary" data-c="inv">${icon('users')}Invite link</button>`
        : `<div class="grow"><div class="faint small">${esc(ts.text || '')}</div><div class="hs-big mono">${esc(s.lan)}</div><div class="faint small">On this PC use <span class="mono">localhost:${s.port}</span>${s.tunnel === 'none' ? ' · friends on your network use your PC’s local IP' : ''}</div></div>${ts.needsLink ? `<button class="btn primary" id="hs-link">${icon('link')}Connect playit.gg</button>` : ''}`;
      $$('[data-c]', share).forEach((b) => (b.onclick = () => { const t = b.dataset.c === 'addr' ? s.address : `solaris://server/${s.address}`; api('clipboard:write', t); toast(b.dataset.c === 'addr' ? 'Address copied' : 'Invite link copied — friends with Solaris click it to join'); }));
      if ($('#hs-link', share)) $('#hs-link', share).onclick = async () => { try { await api('playit:connect'); toast('Approve Solaris in the browser tab that opened'); } catch (e) { toastErr(e); } };
      drawStats(this.stats.get(id) || s.stats);
    };
    const drawStats = (st) => {
      $('#hs-statbar', el).innerHTML = s.state === 'offline' ? '' : `<span>${icon('users')}<b>${s.players.length}</b>/${s.maxPlayers || '?'} players</span><span>${icon('cpu')}<b>${st?.cpu != null ? Math.round(st.cpu) + '%' : '—'}</b> CPU</span><span>${icon('hdd')}<b>${st?.ramMb ? (st.ramMb / 1024).toFixed(2) : '—'}</b> GB of ${(s.memory / 1024).toFixed(1)} GB</span><span>${icon('clock')}<b>${fmtUp(s.started ? Date.now() - s.started : 0)}</b> uptime</span>`;
    };
    drawHead();
    const box = $('#hs-tab', el);
    let cleanup = null;
    const showTab = async (k) => {
      tab = k; cleanup && cleanup(); cleanup = null;
      $$('[data-tab]', el).forEach((b) => b.classList.toggle('on', b.dataset.tab === k));
      box.innerHTML = '<div class="faint">Loading…</div>';
      try { cleanup = await this.tabs[k].call(this, box, id, s, ctx); } catch (e) { box.innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div></div>`; }
    };
    $$('[data-tab]', el).forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
    showTab(tab);
    ctx.on('hosted', (st) => { if (st && st.id === id) { const was = s.state; s = st; drawHead(); if (was !== s.state && ['players'].includes(tab)) showTab(tab); } });
    ctx.on('hosted-stats', (st) => { if (st.id === id) { this.stats.set(id, st); drawStats(st); } });
    ctx.on('playit', async () => { try { s = await api('hosted:get', id); drawHead(); } catch {} });
  },

  tabs: {
    console(box, id, s, ctx) {
      let auto = true, onlyErr = false;
      box.innerHTML = `<div class="row hs-con-bar"><label class="row small" style="gap:6px"><input type="checkbox" id="c-auto" checked>Auto-scroll</label><label class="row small" style="gap:6px"><input type="checkbox" id="c-err">Only warnings & errors</label><div class="grow"></div><button class="btn sm ghost" id="c-clear">${icon('trash')}Clear</button></div>
        <div class="console hs-console" id="hs-console"></div>
        <div class="row" style="margin-top:8px"><input type="text" id="hs-cmd" class="grow mono" placeholder="${s.state === 'offline' ? 'Start the server to send commands' : 'Command, e.g. say Hello · op Name · gamemode creative Name'}" spellcheck="false"><button class="btn" id="hs-send">${icon('send')}Send</button></div>`;
      const con = $('#hs-console', box);
      const cls = (l) => (/ERROR|Exception|FATAL/.test(l) ? 'e' : /WARN/.test(l) ? 'w' : /^\[Solaris\]|Domain assigned|Done \(/.test(l) ? 's' : /^> /.test(l) ? 'c' : '');
      const add = (lines) => {
        const frag = document.createDocumentFragment();
        for (const l of lines) { const c = cls(l); if (onlyErr && c !== 'e' && c !== 'w') continue; const d = document.createElement('div'); d.textContent = l; if (c) d.className = c; frag.appendChild(d); }
        con.appendChild(frag);
        let extra = con.childElementCount - 2000;
        while (extra-- > 0) con.firstChild.remove();
      };
      const redraw = () => { con.innerHTML = ''; add((this.logs.get(id) || []).slice(-2000)); if (auto) con.scrollTop = con.scrollHeight; };
      redraw();
      $('#c-auto', box).onchange = (e) => { auto = e.target.checked; if (auto) con.scrollTop = con.scrollHeight; };
      $('#c-err', box).onchange = (e) => { onlyErr = e.target.checked; redraw(); };
      $('#c-clear', box).onclick = () => { this.logs.set(id, []); con.innerHTML = ''; };
      const send = () => { const i = $('#hs-cmd', box); if (!i.value.trim()) return; api('hosted:command', id, i.value).catch(toastErr); i.value = ''; };
      $('#hs-send', box).onclick = send;
      $('#hs-cmd', box).onkeydown = (e) => { if (e.key === 'Enter') send(); };
      ctx.on('hosted-log', ({ id: lid, lines }) => { if (lid !== id || !con.isConnected) return; add(lines); if (auto) con.scrollTop = con.scrollHeight; });
    },

    async players(box, id, s) {
      const [wl, ops, props] = await Promise.all([api('hosted:people', id, 'whitelist'), api('hosted:people', id, 'ops'), api('hosted:settings', id)]);
      const head = (n) => `<img class="hs-head" src="https://mc-heads.net/avatar/${encodeURIComponent(n)}/24" alt="">`;
      box.innerHTML = `<div class="hs-cols">
        <div class="card"><h3>${icon('users')} Online now <span class="faint small">${s.players.length}</span></h3>${s.players.length ? s.players.map((p) => `<div class="row hs-person">${head(p)}<span class="grow">${esc(p)}</span><button class="btn sm ghost" data-op="${esc(p)}">Op</button><button class="btn sm ghost" data-kick="${esc(p)}">Kick</button></div>`).join('') : `<div class="faint small">${s.state === 'offline' ? 'The server is stopped.' : 'Nobody is online.'}</div>`}</div>
        <div class="card"><h3>${icon('shield')} Whitelist</h3>
          <label class="row small" style="gap:8px;margin-bottom:8px"><input type="checkbox" id="wl-on" ${props.props['white-list'] === 'true' ? 'checked' : ''}>Only whitelisted players can join</label>
          <div class="row"><input type="text" id="wl-name" class="grow" placeholder="Player name"><button class="btn sm primary" id="wl-add">${icon('plus')}Add</button></div>
          <div class="stack" style="gap:4px;margin-top:8px">${wl.map((p) => `<div class="row hs-person">${head(p.name)}<span class="grow">${esc(p.name)}</span><button class="icon-btn" data-wl-rm="${esc(p.name)}">${icon('close')}</button></div>`).join('') || '<div class="faint small">Nobody yet.</div>'}</div></div>
        <div class="card"><h3>${icon('key')} Operators</h3>
          <div class="row"><input type="text" id="op-name" class="grow" placeholder="Player name"><button class="btn sm primary" id="op-add">${icon('plus')}Add</button></div>
          <div class="stack" style="gap:4px;margin-top:8px">${ops.map((p) => `<div class="row hs-person">${head(p.name)}<span class="grow">${esc(p.name)}</span><span class="faint small">level ${p.level || 4}</span><button class="icon-btn" data-op-rm="${esc(p.name)}">${icon('close')}</button></div>`).join('') || '<div class="faint small">No operators.</div>'}</div></div>
      </div>`;
      const redo = () => this.tabs.players.call(this, box, id, s);
      $$('[data-kick]', box).forEach((b) => (b.onclick = () => api('hosted:command', id, `kick ${b.dataset.kick}`).catch(toastErr)));
      $$('[data-op]', box).forEach((b) => (b.onclick = async () => { await api('hosted:addPerson', id, 'ops', b.dataset.op).catch(toastErr); toast(`${b.dataset.op} is now an operator`); setTimeout(redo, 800); }));
      $('#wl-on', box).onchange = async (e) => { await api('hosted:setSettings', id, { props: { 'white-list': e.target.checked, 'enforce-whitelist': e.target.checked } }); if (s.state !== 'offline') api('hosted:command', id, `whitelist ${e.target.checked ? 'on' : 'off'}`); toast(e.target.checked ? 'Whitelist on' : 'Whitelist off'); };
      const add = (kind, input) => async () => { const n = $(input, box).value.trim(); if (!n) return; try { await api('hosted:addPerson', id, kind, n); toast(`${n} added`); setTimeout(redo, s.state === 'offline' ? 0 : 800); } catch (e) { toastErr(e); } };
      $('#wl-add', box).onclick = add('whitelist', '#wl-name');
      $('#op-add', box).onclick = add('ops', '#op-name');
      $$('[data-wl-rm]', box).forEach((b) => (b.onclick = async () => { await api('hosted:removePerson', id, 'whitelist', b.dataset.wlRm); setTimeout(redo, s.state === 'offline' ? 0 : 800); }));
      $$('[data-op-rm]', box).forEach((b) => (b.onclick = async () => { await api('hosted:removePerson', id, 'ops', b.dataset.opRm); setTimeout(redo, s.state === 'offline' ? 0 : 800); }));
    },

    async worlds(box, id, s) {
      const ws = await api('hosted:worlds', id);
      box.innerHTML = `<div class="card"><div class="row" style="margin-bottom:10px"><h3 class="grow" style="margin:0">${icon('world')} Worlds</h3><button class="btn sm" id="w-open">${icon('folder')}Open folder</button></div>
        ${ws.length ? ws.map((w) => `<div class="row hs-person">${icon('world')}<b class="grow">${esc(w.name)}</b>${w.active ? '<span class="chip ok">Active</span>' : `<button class="btn sm" data-w-use="${esc(w.name)}" ${s.state !== 'offline' ? 'disabled' : ''}>Use</button>`}<span class="faint small">${timeAgo(w.modified)}</span><button class="btn sm danger" data-w-del="${esc(w.name)}" ${s.state !== 'offline' ? 'disabled' : ''}>${icon('trash')}${w.active ? 'Reset' : 'Delete'}</button></div>`).join('') : '<div class="faint small">No world yet — it’s created the first time the server starts.</div>'}
        <p class="faint small">Stop the server to switch or delete worlds. Resetting the active world makes a fresh one on next start. Make a backup first if you might want it back.</p></div>`;
      $('#w-open', box).onclick = () => api('hosted:openFolder', id);
      $$('[data-w-use]', box).forEach((b) => (b.onclick = async () => { await api('hosted:setWorld', id, b.dataset.wUse).catch(toastErr); this.tabs.worlds.call(this, box, id, s); }));
      $$('[data-w-del]', box).forEach((b) => (b.onclick = async () => { if (await confirmDialog(`Delete the world “${b.dataset.wDel}” forever?`, { danger: true, ok: 'Delete forever' })) { await api('hosted:deleteWorld', id, b.dataset.wDel).catch(toastErr); this.tabs.worlds.call(this, box, id, s); } }));
    },

    async backups(box, id, s) {
      const list = await api('hosted:backups', id);
      box.innerHTML = `<div class="card"><div class="row" style="margin-bottom:10px"><h3 class="grow" style="margin:0">${icon('download')} Backups</h3><button class="btn sm" id="b-open">${icon('folder')}Folder</button><button class="btn sm primary" id="b-new">${icon('plus')}Back up now</button></div>
        ${list.length ? list.map((b) => `<div class="row hs-person">${icon('file')}<span class="grow mono small">${esc(b.file)}</span><span class="faint small">${fmtBytes(b.size)} · ${timeAgo(b.time)}</span><button class="btn sm" data-restore="${esc(b.file)}" ${s.state !== 'offline' ? 'disabled title="Stop the server first"' : ''}>Restore</button><button class="icon-btn" data-bdel="${esc(b.file)}">${icon('trash')}</button></div>`).join('') : '<div class="faint small">No backups yet.</div>'}
        <p class="faint small">Backups include your worlds, server.properties, whitelist and operators. You can back up while the server runs; restoring needs it stopped.</p></div>`;
      $('#b-open', box).onclick = () => api('hosted:openFolder', id, 'backups');
      $('#b-new', box).onclick = (e) => installFeedback(e.currentTarget, async () => { try { await api('hosted:backup', id); toast('Backup saved'); setTimeout(() => this.tabs.backups.call(this, box, id, s), 900); return { id, name: s.name }; } catch (er) { toastErr(er); return false; } });
      $$('[data-restore]', box).forEach((b) => (b.onclick = async () => { if (await confirmDialog(`Restore ${b.dataset.restore}? The current worlds are replaced by the backup.`, { danger: true, ok: 'Restore' })) { try { await api('hosted:restore', id, b.dataset.restore); toast('Backup restored'); } catch (e) { toastErr(e); } } }));
      $$('[data-bdel]', box).forEach((b) => (b.onclick = async () => { if (await confirmDialog(`Delete backup ${b.dataset.bdel}?`, { danger: true, ok: 'Delete' })) { await api('hosted:deleteBackup', id, b.dataset.bdel); this.tabs.backups.call(this, box, id, s); } }));
    },

    async content(box, id, s) {
      const what = s.contentKind === 'plugins' ? 'plugins' : 'mods';
      box.innerHTML = `<div class="hs-cols two">
        <div class="card"><h3>${icon('search')} Find ${what} <span class="faint small">for ${esc(s.softwareName)} ${esc(s.mc)} (Modrinth)</span></h3><div class="search" style="margin-bottom:10px">${icon('search')}<input type="search" id="ct-q" placeholder="Search ${what}…"></div><div id="ct-res" class="stack" style="gap:6px"></div></div>
        <div class="card"><h3>${icon('package')} Installed <span class="faint small" id="ct-n"></span></h3><div id="ct-inst" class="stack" style="gap:4px"></div><p class="faint small">Changes apply after a restart.</p></div></div>`;
      const drawInst = async (items) => {
        items = items || (await api('hosted:content', id));
        $('#ct-n', box).textContent = items.length;
        $('#ct-inst', box).innerHTML = items.map((c) => `<div class="row hs-person ${c.enabled ? '' : 'off'}"><span class="grow ellipsis" title="${esc(c.file)}">${esc(c.title)} <span class="faint small">${esc(c.version)}</span></span><label class="switch"><input type="checkbox" data-tg="${esc(c.file)}" ${c.enabled ? 'checked' : ''}><span></span></label><button class="icon-btn" data-rm="${esc(c.file)}">${icon('trash')}</button></div>`).join('') || `<div class="faint small">No ${what} yet.</div>`;
        $$('[data-tg]', box).forEach((c) => (c.onchange = async () => drawInst(await api('hosted:toggleContent', id, c.dataset.tg))));
        $$('[data-rm]', box).forEach((b) => (b.onclick = async () => drawInst(await api('hosted:removeContent', id, b.dataset.rm))));
      };
      const search = debounce(async () => {
        const res = $('#ct-res', box); if (!res) return;
        res.innerHTML = '<div class="faint small">Searching…</div>';
        try {
          const r = await api('hosted:search', id, $('#ct-q', box).value, 0);
          res.innerHTML = r.hits.map((h) => `<div class="list-row hs-res" data-pid="${esc(h.id)}"><img src="${esc(h.icon || '')}" alt=""><div class="info"><div class="title">${esc(h.title)}</div><div class="desc">${esc(h.description)}</div></div><button class="btn sm primary" data-inst="${esc(h.id)}">${icon('download')}Install</button></div>`).join('') || '<div class="faint small">Nothing found for this version.</div>';
          $$('[data-inst]', res).forEach((b) => { if (r.hits.find((h) => h.id === b.dataset.inst)?.installed) installFeedback.mark(b); b.onclick = () => installFeedback(b, async () => { try { const names = await api('hosted:install', id, b.dataset.inst); toast(`Installed ${names.join(', ')}`); drawInst(); return { id, name: s.name }; } catch (e) { toastErr(e); return false; } }); });
        } catch (e) { res.innerHTML = `<div class="faint small">${esc(e.message)}</div>`; }
      }, 300);
      $('#ct-q', box).oninput = search;
      search(); drawInst();
    },

    async properties(box, id, s) {
      const set = await api('hosted:settings', id);
      const keys = Object.keys(set.props).sort();
      box.innerHTML = `<div class="card"><div class="row" style="margin-bottom:10px"><h3 class="grow" style="margin:0">${icon('list')} server.properties</h3><div class="search" style="max-width:240px">${icon('search')}<input type="search" id="pp-q" placeholder="Filter…"></div><button class="btn sm primary" id="pp-save">${icon('check')}Save</button></div>
        ${keys.length ? `<div class="hs-props">${keys.map((k) => { const v = set.props[k]; return `<label class="hs-prop" data-k="${esc(k)}"><span class="mono small">${esc(k)}</span>${v === 'true' || v === 'false' ? `<label class="switch"><input type="checkbox" data-pk="${esc(k)}" ${v === 'true' ? 'checked' : ''}><span></span></label>` : `<input type="text" class="mono" data-pk="${esc(k)}" value="${esc(v)}">`}</label>`; }).join('')}</div>` : '<div class="faint small">server.properties is created the first time the server starts.</div>'}
        <p class="faint small">Changes apply the next time the server starts.</p></div>`;
      $('#pp-q', box).oninput = (e) => { const q = e.target.value.toLowerCase(); $$('[data-k]', box).forEach((r) => (r.style.display = r.dataset.k.includes(q) ? '' : 'none')); };
      $('#pp-save', box).onclick = async () => {
        const props = {}; $$('[data-pk]', box).forEach((i) => (props[i.dataset.pk] = i.type === 'checkbox' ? String(i.checked) : i.value));
        try { await api('hosted:setSettings', id, { props }); toast('Saved — restart the server to apply'); } catch (e) { toastErr(e); }
      };
    },

    async logs(box, id) {
      const files = await api('hosted:logFiles', id);
      box.innerHTML = `<div class="hs-cols logs"><div class="card stack" style="gap:2px">${files.map((f, i) => `<button class="hs-logf ${i === 0 ? 'on' : ''}" data-lf="${esc(f.file)}"><span class="mono small">${esc(f.file)}</span><span class="faint small">${timeAgo(f.time)}</span></button>`).join('') || '<div class="faint small">No log files yet.</div>'}</div><pre class="console hs-logview" id="lv"></pre></div>`;
      const show = async (f) => { $$('[data-lf]', box).forEach((b) => b.classList.toggle('on', b.dataset.lf === f)); const t = await api('hosted:readLog', id, f).catch((e) => e.message); const v = $('#lv', box); v.textContent = t; v.scrollTop = v.scrollHeight; };
      $$('[data-lf]', box).forEach((b) => (b.onclick = () => show(b.dataset.lf)));
      if (files[0]) show(files[0].file);
    },

    async settings(box, id, s) {
      const set = await api('hosted:settings', id);
      box.innerHTML = `<div class="hs-cols two">
        <div class="card stack"><h3>${icon('sliders')} General</h3>
          <label class="field">Name<input type="text" id="st-name" value="${esc(set.name)}" maxlength="40"></label>
          <label class="field">Message of the day<input type="text" id="st-motd" value="${esc(set.props.motd || '')}" maxlength="120"></label>
          <div class="row"><label class="field grow">Game mode<select id="st-gm">${['survival', 'creative', 'adventure', 'spectator'].map((g) => `<option ${set.props.gamemode === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
            <label class="field grow">Difficulty<select id="st-df">${['peaceful', 'easy', 'normal', 'hard'].map((g) => `<option ${set.props.difficulty === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label></div>
          <div class="row"><label class="field grow">Max players<input type="number" id="st-max" min="1" max="200" value="${esc(set.props['max-players'] || 10)}"></label>
            <label class="field grow">Port<input type="number" id="st-port" min="1024" max="65535" value="${set.port}"></label>
            <label class="field grow">Memory (MB)<input type="number" id="st-mem" min="1024" max="65536" step="512" value="${set.memory}"></label></div>
          <label class="row small" style="gap:8px"><input type="checkbox" id="st-pvp" ${set.props.pvp !== 'false' ? 'checked' : ''}>PvP</label>
          <label class="row small" style="gap:8px;align-items:flex-start"><input type="checkbox" id="st-online" ${set.props['online-mode'] !== 'false' ? 'checked' : ''}><span>Require Microsoft accounts<br><span class="faint">Off lets offline accounts join — anyone could use any name. Turn the whitelist on if you do this.</span></span></label>
          <div class="row"><div class="grow faint small">Applies on next start.</div><button class="btn primary" id="st-save">${icon('check')}Save</button></div></div>
        <div class="stack">
          <div class="card stack"><h3>${icon('globe')} Public address</h3>
            <div class="seg" id="st-tun"><button data-t="e4mc" ${HOST_E4MC.includes(set.software) ? '' : 'disabled'}>e4mc</button><button data-t="playit">playit.gg</button><button data-t="none">Home only</button></div>
            <div class="faint small">${HOST_E4MC.includes(set.software) ? 'e4mc: instant, no account. playit.gg: free account, stable address.' : 'e4mc needs Fabric/Forge/NeoForge — use playit.gg for this server.'}</div></div>
          <div class="card stack"><h3>${icon('folder')} Files</h3><div class="mono small" style="word-break:break-all">${esc(set.dir)}</div><div class="row"><button class="btn sm" id="st-folder">${icon('folder')}Open folder</button></div></div>
          <div class="card stack"><h3>${icon('trash')} Delete server</h3><div class="faint small">Removes the folder, worlds and backups forever.</div><div class="row"><button class="btn sm danger" id="st-del" ${s.state !== 'offline' ? 'disabled title="Stop the server first"' : ''}>${icon('trash')}Delete forever</button></div></div>
        </div></div>`;
      $$('#st-tun [data-t]', box).forEach((b) => { b.classList.toggle('on', b.dataset.t === set.tunnel); b.onclick = async () => { try { await api('hosted:setTunnel', id, b.dataset.t); toast('Public address setting saved'); this.tabs.settings.call(this, box, id, s); } catch (e) { toastErr(e); } }; });
      $('#st-folder', box).onclick = () => api('hosted:openFolder', id);
      $('#st-del', box).onclick = () => this.remove(id);
      $('#st-save', box).onclick = async () => {
        try {
          await api('hosted:setSettings', id, { name: $('#st-name', box).value.trim(), memory: +$('#st-mem', box).value, props: { motd: $('#st-motd', box).value, gamemode: $('#st-gm', box).value, difficulty: $('#st-df', box).value, 'max-players': $('#st-max', box).value, 'server-port': $('#st-port', box).value, pvp: $('#st-pvp', box).checked, 'online-mode': $('#st-online', box).checked } });
          toast('Saved — restart the server to apply');
        } catch (e) { toastErr(e); }
      };
    },
  },
};

window.solaris.on('hosted:state', (s) => Bus.emit('hosted', s));
window.solaris.on('hosted:stats', (s) => { Pages.host.stats.set(s.id, s); Bus.emit('hosted-stats', s); });
Bus.on('hosted-lines', (p) => { const l = Pages.host.logs.get(p.id) || []; l.push(...p.lines); if (l.length > 4000) l.splice(0, l.length - 4000); Pages.host.logs.set(p.id, l); Bus.emit('hosted-log', p); });
window.solaris.on('hosted:stopped', ({ crashed }) => { if (crashed) toast('A server stopped unexpectedly — check its console.', 'error', 7000); });
window.solaris.on('playit:state', (s) => { Pages.host.playit = s; Bus.emit('playit', s); });
window.solaris.on('hosted:playit-manual', ({ port, reason }) => {
  const m = modal({ title: 'Add a playit.gg tunnel', body: `<p class="muted">Solaris couldn’t create the tunnel automatically (${esc(reason)}).</p><p>On playit.gg, add a tunnel: type <b>Minecraft Java</b>, local address <b class="mono">127.0.0.1</b>, local port <b class="mono">${port}</b>. Solaris picks it up within a few seconds.</p>`, footer: `<button class="btn ghost" data-x>Later</button><button class="btn primary" data-go>${icon('external')}Open playit.gg</button>` });
  m.$('[data-x]').onclick = () => m.close();
  m.$('[data-go]').onclick = () => { api('shell:open', 'https://playit.gg/account/tunnels'); m.close(); };
});
