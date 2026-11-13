/* Host: run Minecraft servers on this PC and make them public without port forwarding (e4mc). */
Pages.host = {
  logs: new Map(), // id -> lines (kept while Solaris runs)
  async render(el, params, ctx) {
    if (params.id) return this.detail(el, params.id, ctx);
    const draw = async () => {
      const list = await api('hosted:list');
      if (!el.isConnected) return;
      el.innerHTML = `
        <div class="page-head"><div><h1>Host a server</h1><div class="sub">Run a Minecraft server on this PC — friends join from anywhere, no port forwarding, no account.</div></div>
          <div class="actions"><button class="btn primary" id="hs-new">${icon('plus')}New server</button></div></div>
        ${list.length ? `<div class="hs-grid">${list.map((s) => this.card(s)).join('')}</div>` : `
          <div class="hs-empty">
            <div class="hs-steps">
              <div><b>1</b><span>Create a server</span><small>Pick a Minecraft version — Solaris sets up a Fabric server with performance mods.</small></div>
              <div><b>2</b><span>Press Start</span><small>Java and the server files download automatically.</small></div>
              <div><b>3</b><span>Share the address</span><small>Solaris shows a public address like <span class="mono">abc.e4mc.link</span>. Friends paste it into Multiplayer.</small></div>
            </div>
            <button class="btn primary lg" id="hs-new2">${icon('host')}Create your first server</button>
          </div>`}
        <p class="faint small" style="margin-top:18px">Public addresses come from <b>e4mc</b>, a free open-source relay (no sign-up). Your PC runs the server, so it’s online only while Solaris and your PC are on. Big public servers are better on a real host.</p>`;
      $('#hs-new', el).onclick = () => this.create();
      if ($('#hs-new2', el)) $('#hs-new2', el).onclick = () => this.create();
      this.bindCards(el);
    };
    await draw();
    ctx.on('hosted', () => draw());
  },

  card(s) {
    const st = { offline: ['', 'Offline'], starting: ['warn', 'Starting…'], online: ['ok', 'Online'], stopping: ['warn', 'Stopping…'] }[s.state] || ['', s.state];
    return `<div class="hs-card ${s.state}" data-open="${esc(s.id)}">
      <div class="hs-top"><div class="hs-ic">${icon('host')}</div><div class="grow" style="min-width:0"><b class="ellipsis">${esc(s.name)}</b><div class="faint small">Fabric ${esc(s.mc)} · ${Math.round(s.memory / 1024 * 10) / 10} GB</div></div><span class="chip ${st[0]}">${st[1]}</span></div>
      <div class="hs-addr">${s.address ? `${icon('globe')}<span class="mono ellipsis">${esc(s.address)}</span><button class="icon-btn" data-copy="${esc(s.address)}" title="Copy address">${icon('copy')}</button>`
        : s.state === 'online' && s.public ? `${icon('globe')}<span class="faint small">Getting a public address…</span>`
        : `${icon('wifi')}<span class="faint small">${s.public ? 'Public when started' : `Local network only · ${esc(s.lan)}`}</span>`}</div>
      <div class="hs-foot"><span class="faint small">${icon('users')}${s.players.length} online</span><div class="grow"></div>
        ${s.state === 'offline' ? `<button class="btn sm primary" data-start="${esc(s.id)}">${icon('play')}Start</button>` : `<button class="btn sm" data-stop="${esc(s.id)}" ${s.state === 'stopping' ? 'disabled' : ''}>${icon('power')}Stop</button>`}</div>
    </div>`;
  },
  bindCards(root) {
    $$('[data-open]', root).forEach((c) => (c.onclick = (e) => { if (e.target.closest('button')) return; Router.go('host', { id: c.dataset.open }); }));
    $$('[data-copy]', root).forEach((b) => (b.onclick = () => { api('clipboard:write', b.dataset.copy); toast('Address copied — friends paste it into Multiplayer → Add Server'); }));
    $$('[data-start]', root).forEach((b) => (b.onclick = () => this.start(b.dataset.start, b)));
    $$('[data-stop]', root).forEach((b) => (b.onclick = async () => { b.disabled = true; await api('hosted:stop', b.dataset.stop).catch(toastErr); }));
  },
  async start(id, btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = `${icon('refresh', 'spin')}Starting`; }
    try { await api('hosted:start', id); } catch (e) { toastErr(e); if (btn) { btn.disabled = false; btn.innerHTML = `${icon('play')}Start`; } }
  },

  async create() {
    const versions = (await getVersions().catch(() => [])).filter((v) => v.type === 'release').slice(0, 40);
    const totalGb = (State.info?.totalMem || 8 * 1024 ** 3) / 1024 ** 3;
    const def = totalGb <= 8 ? 2048 : 4096;
    const m = modal({
      title: 'New server',
      body: `<div class="stack">
        <label class="field">Name<input type="text" id="hs-name" maxlength="40" placeholder="My server"></label>
        <label class="field">Minecraft version<select id="hs-mc">${versions.map((v) => `<option>${esc(v.id)}</option>`).join('')}</select></label>
        <label class="field">Memory <span class="faint small" id="hs-memv">${def / 1024} GB</span><input type="range" id="hs-mem" min="1024" max="${Math.max(2048, Math.floor(totalGb * 0.6) * 1024)}" step="512" value="${def}"></label>
        <label class="row" style="gap:10px;align-items:flex-start"><input type="checkbox" id="hs-public" checked><span><b>Go public</b> — friends anywhere can join with an address. No port forwarding.<br><span class="faint small">Uses e4mc. Turn off to keep it on your home network only.</span></span></label>
        <label class="row" style="gap:10px;align-items:flex-start"><input type="checkbox" id="hs-eula"><span>I accept the <a href="#" id="hs-eula-link">Minecraft EULA</a> — it’s required to run a Minecraft server.</span></label>
      </div>`,
      footer: `<button class="btn ghost" data-x>${T('Cancel')}</button><button class="btn primary" data-go disabled>${icon('host')}Create server</button>`,
    });
    const go = m.$('[data-go]');
    m.$('#hs-eula').onchange = (e) => (go.disabled = !e.target.checked);
    m.$('#hs-eula-link').onclick = (e) => { e.preventDefault(); api('shell:open', 'https://www.minecraft.net/eula'); };
    m.$('#hs-mem').oninput = (e) => (m.$('#hs-memv').textContent = `${e.target.value / 1024} GB`);
    m.$('[data-x]').onclick = () => m.close();
    go.onclick = async () => {
      go.disabled = true; go.innerHTML = `${icon('refresh', 'spin')}Setting up…`;
      try {
        const s = await api('hosted:create', { name: m.$('#hs-name').value.trim() || undefined, mc: m.$('#hs-mc').value, memory: +m.$('#hs-mem').value, makePublic: m.$('#hs-public').checked, eula: m.$('#hs-eula').checked });
        m.close();
        if (s.missingMods?.includes('e4mc')) toast(`Going public isn’t available for ${s.mc} yet — the server works on your home network.`, 'warn', 7000);
        else toast(`${s.name} is ready — press Start`);
        Router.go('host', { id: s.id });
      } catch (e) { toastErr(e); go.disabled = false; go.innerHTML = `${icon('host')}Create server`; }
    };
  },

  async detail(el, id, ctx) {
    let s = (await api('hosted:list')).find((x) => x.id === id);
    if (!s) { el.innerHTML = `<div class="empty">Server not found.</div>`; return; }
    if (!this.logs.has(id)) this.logs.set(id, await api('hosted:logs', id).catch(() => []));
    const set = await api('hosted:settings', id);
    el.innerHTML = `
      <div class="page-head"><div><a href="#" id="hs-back" class="small">← All servers</a><h1>${esc(s.name)}</h1><div class="sub">Fabric ${esc(s.mc)} · port ${s.port}</div></div>
        <div class="actions" id="hs-actions"></div></div>
      <div class="hs-detail">
        <div class="stack" style="min-width:0">
          <div class="card hs-share" id="hs-share"></div>
          <div class="console hs-console" id="hs-console"></div>
          <div class="row"><input type="text" id="hs-cmd" class="grow mono" placeholder="Type a server command, e.g. op YourName" spellcheck="false"><button class="btn" id="hs-send">${icon('send')}Send</button></div>
        </div>
        <div class="stack">
          <div class="card"><h3 style="margin:0 0 8px">${icon('users')} Players <span class="faint small" id="hs-pc"></span></h3><div id="hs-players" class="stack" style="gap:4px"></div></div>
          <div class="card stack">
            <h3 style="margin:0">${icon('sliders')} Settings</h3>
            <label class="field">Message of the day<input type="text" data-p="motd" value="${esc(set.motd || '')}" maxlength="80"></label>
            <div class="row">
              <label class="field grow">Game mode<select data-p="gamemode">${['survival', 'creative', 'adventure', 'spectator'].map((g) => `<option ${set.gamemode === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
              <label class="field grow">Difficulty<select data-p="difficulty">${['peaceful', 'easy', 'normal', 'hard'].map((g) => `<option ${set.difficulty === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
            </div>
            <div class="row">
              <label class="field grow">Max players<input type="number" data-p="max-players" min="1" max="100" value="${esc(set['max-players'] || 10)}"></label>
              <label class="field grow">Memory (MB)<input type="number" data-m="memory" min="1024" max="32768" step="512" value="${s.memory}"></label>
            </div>
            <label class="row" style="gap:8px"><input type="checkbox" data-pb="pvp" ${set.pvp !== 'false' ? 'checked' : ''}>PvP</label>
            <label class="row" style="gap:8px"><input type="checkbox" data-pb="white-list" ${set['white-list'] === 'true' ? 'checked' : ''}>Whitelist only <span class="faint small">(add players with “whitelist add Name”)</span></label>
            <label class="row" style="gap:8px"><input type="checkbox" id="hs-pub" ${s.public ? 'checked' : ''}>Public address (e4mc)</label>
            <label class="row" style="gap:8px;align-items:flex-start"><input type="checkbox" data-pb="online-mode" ${set['online-mode'] !== 'false' ? 'checked' : ''}><span>Require Microsoft accounts<br><span class="faint small">Off lets offline accounts join — anyone could join as any name. Use the whitelist.</span></span></label>
            <div class="faint small">Settings apply the next time the server starts.</div>
            <div class="row"><button class="btn sm" id="hs-folder">${icon('folder')}Open folder</button><div class="grow"></div><button class="btn sm danger" id="hs-del">${icon('trash')}Delete</button></div>
          </div>
        </div>
      </div>`;
    $('#hs-back', el).onclick = (e) => { e.preventDefault(); Router.go('host'); };
    const con = $('#hs-console', el);
    const addLine = (l) => { const d = document.createElement('div'); d.textContent = l; if (/WARN/.test(l)) d.className = 'w'; if (/ERROR|Exception/.test(l)) d.className = 'e'; if (/^\[Solaris\]|Domain assigned/.test(l)) d.className = 's'; con.appendChild(d); while (con.childElementCount > 1500) con.firstChild.remove(); };
    this.logs.get(id).forEach(addLine); con.scrollTop = con.scrollHeight;
    const drawState = () => {
      $('#hs-actions', el).innerHTML = s.state === 'offline' ? `<button class="btn primary lg play" id="hs-start">${icon('play')}Start</button>`
        : `<button class="btn lg" id="hs-join" ${s.state !== 'online' ? 'disabled' : ''}>${icon('sun')}Join</button><button class="btn lg danger" id="hs-stop" ${s.state === 'stopping' ? 'disabled' : ''}>${icon('power')}${s.state === 'stopping' ? 'Stopping…' : 'Stop'}</button>`;
      if ($('#hs-start', el)) $('#hs-start', el).onclick = (e) => this.start(id, e.currentTarget);
      if ($('#hs-stop', el)) $('#hs-stop', el).onclick = (e) => { e.currentTarget.disabled = true; api('hosted:stop', id); };
      if ($('#hs-join', el)) $('#hs-join', el).onclick = () => Pages.servers.join(`localhost:${s.port}`);
      const share = $('#hs-share', el);
      share.className = `card hs-share ${s.address ? 'live' : ''}`;
      share.innerHTML = s.address
        ? `<div class="hs-live-dot"></div><div class="grow" style="min-width:0"><div class="faint small">Public address — send this to friends</div><div class="hs-big mono ellipsis">${esc(s.address)}</div></div><button class="btn" data-c="addr">${icon('copy')}Copy</button><button class="btn primary" data-c="inv">${icon('users')}Invite link</button>`
        : `<div class="grow"><div class="faint small">${s.state === 'offline' ? 'Start the server to get its address.' : s.public ? (s.state === 'online' ? 'Getting a public address from e4mc…' : 'Starting…') : 'Local network only'}</div><div class="hs-big mono">${esc(s.lan)}</div></div>`;
      $$('[data-c]', share).forEach((b) => (b.onclick = () => { const t = b.dataset.c === 'addr' ? s.address : `solaris://server/${s.address}`; api('clipboard:write', t); toast(b.dataset.c === 'addr' ? 'Address copied' : 'Invite link copied — friends with Solaris click it to join'); }));
      $('#hs-pc', el).textContent = `${s.players.length} online`;
      $('#hs-players', el).innerHTML = s.players.length ? s.players.map((p) => `<div class="row" style="gap:8px"><img class="hs-head" src="https://mc-heads.net/avatar/${encodeURIComponent(p)}/24" alt=""><span class="grow">${esc(p)}</span><button class="icon-btn" data-kick="${esc(p)}" title="Kick">${icon('close')}</button></div>`).join('') : '<div class="faint small">Nobody yet.</div>';
      $$('[data-kick]', el).forEach((b) => (b.onclick = () => api('hosted:command', id, `kick ${b.dataset.kick}`).catch(toastErr)));
    };
    drawState();
    const send = () => { const i = $('#hs-cmd', el); if (!i.value.trim()) return; api('hosted:command', id, i.value).catch(toastErr); i.value = ''; };
    $('#hs-send', el).onclick = send;
    $('#hs-cmd', el).onkeydown = (e) => { if (e.key === 'Enter') send(); };
    const saveSet = debounce(async (patch) => { try { await api('hosted:setSettings', id, patch); toast('Saved — applies on next start'); } catch (e) { toastErr(e); } }, 500);
    $$('[data-p]', el).forEach((i) => (i.onchange = () => saveSet({ [i.dataset.p]: i.value })));
    $$('[data-pb]', el).forEach((i) => (i.onchange = () => saveSet({ [i.dataset.pb]: i.checked })));
    $$('[data-m]', el).forEach((i) => (i.onchange = () => saveSet({ memory: +i.value })));
    $('#hs-pub', el).onchange = async (e) => { try { s = { ...s, ...(await api('hosted:setPublic', id, e.target.checked)) }; toast(e.target.checked ? 'Public address on' : 'Local network only'); drawState(); } catch (er) { e.target.checked = !e.target.checked; toastErr(er); } };
    $('#hs-folder', el).onclick = () => api('hosted:openFolder', id);
    $('#hs-del', el).onclick = async () => { if (await confirmDialog(`Delete ${s.name}? Its folder and worlds go to the Recycle Bin.`, { danger: true, ok: 'Delete' })) { try { await api('hosted:remove', id); Router.go('host'); } catch (e) { toastErr(e); } } };
    ctx.on('hosted', (st) => { if (st && st.id === id) { s = st; drawState(); } });
    ctx.on('hosted-log', ({ id: lid, line }) => { if (lid !== id) return; const near = con.scrollTop + con.clientHeight > con.scrollHeight - 40; addLine(line); if (near) con.scrollTop = con.scrollHeight; });
  },
};

window.solaris.on('hosted:state', (s) => Bus.emit('hosted', s));
window.solaris.on('hosted:log', (p) => { const l = Pages.host.logs.get(p.id) || []; l.push(p.line); if (l.length > 3000) l.shift(); Pages.host.logs.set(p.id, l); Bus.emit('hosted-log', p); });
window.solaris.on('hosted:stopped', ({ id, crashed }) => { if (crashed) toast('The server stopped unexpectedly — check its console.', 'error', 7000); });
