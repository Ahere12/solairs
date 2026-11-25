/* Hosting: create, run and manage Minecraft servers on this PC, and make them public (e4mc or playit.gg). */
const HOST_SW = [['vanilla', 'Vanilla'], ['paper', 'Paper'], ['purpur', 'Purpur'], ['fabric', 'Fabric'], ['quilt', 'Quilt'], ['forge', 'Forge'], ['neoforge', 'NeoForge'], ['bedrock', 'Bedrock']];
const HOST_KIND = { vanilla: 'none', paper: 'plugins', purpur: 'plugins', fabric: 'mods', quilt: 'mods', forge: 'mods', neoforge: 'mods', bedrock: 'none' };
const HOST_E4MC = ['fabric', 'quilt', 'forge', 'neoforge'];
const HOST_BEDROCK = ['paper', 'purpur', 'fabric', 'quilt', 'neoforge']; // Geyser runs on these
// New server → Server Type cards: [type, name, performance, plugins, mods, what it is]
const HOST_TYPES = [
  ['paper', 'Paper', 'Excellent', true, false, 'The most popular plugin server — fast.'],
  ['purpur', 'Purpur', 'Excellent', true, false, 'Paper with extra options.'],
  ['vanilla', 'Vanilla', 'Good', false, false, 'The official Minecraft server.'],
  ['modpack', 'Modpack', 'Good', false, true, 'A ready-made modpack from Modrinth or CurseForge, for the Minecraft version you pick.'],
  ['fabric', 'Fabric', 'Good', false, true, 'Light mod server, great with performance mods.'],
  ['quilt', 'Quilt', 'Good', false, true, 'Fabric-compatible mod server.'],
  ['neoforge', 'NeoForge', 'Good', false, true, 'Modern Forge mods.'],
  ['forge', 'Forge', 'Moderate', false, true, 'Classic Forge mods and modpacks.'],
  ['bedrock', 'Bedrock', 'High', false, false, 'Mojang’s Bedrock server — phones, consoles, Windows.'],
];
// After a settings save: say what changed straight away, and offer a restart only for what really needs one.
const HOST_SET_NAMES = { 'max-players': 'max players', 'view-distance': 'view distance', 'simulation-distance': 'simulation distance', 'tick-distance': 'simulation distance', motd: 'message of the day', 'server-port': 'port', 'online-mode': 'account check', hardcore: 'hardcore', 'allow-flight': 'flight', 'generate-structures': 'structures', 'enable-command-block': 'command blocks', 'spawn-protection': 'spawn protection', 'force-gamemode': 'forced game mode', memory: 'memory', pvp: 'PvP', 'spawn-monsters': 'monsters', 'allow-nether': 'Nether', 'spawn-animals': 'animals' };
function hostSaved(id, res) {
  const a = res?.applied;
  if (!a || a.offline) return toast('Saved');
  const later = [...new Set(a.restart.map((k) => HOST_SET_NAMES[k] || k.replace(/-/g, ' ')))];
  if (!later.length) return toast(a.live.length ? 'Changed now — no restart needed' : 'Saved');
  toast(`${a.live.length ? 'The rest changed now. ' : 'Saved. '}${later.join(', ')} ${later.length > 1 ? 'change' : 'changes'} when the server restarts.`, 'info', 9000, { label: 'Restart now', run: () => api('hosted:restart', id).catch(toastErr) });
}
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
          <div class="actions">${this.popBtn()}<button class="btn" id="hs-joincode">${icon('users')}Join with code</button><button class="btn" id="hs-paste">${icon('download')}Use setup code</button><button class="btn" id="hs-import" title="A server exported from Astra (Settings → Move to another PC)">${icon('upload')}Import server</button><button class="btn primary" id="hs-new">${icon('plus')}New server</button></div></div>
        ${this.playitPanel(pl)}
        ${list.length ? `<div class="hs-grid">${list.map((s) => this.card(s)).join('')}</div>` : `
          <div class="hs-empty">
            <div class="hs-steps">
              <div><b>1</b><span>Create a server</span><small>Paper, Purpur, Vanilla, a modpack, Fabric, Quilt, Forge, NeoForge or Bedrock — Astra downloads everything.</small></div>
              <div><b>2</b><span>Press Start</span><small>Java and the server files are set up automatically.</small></div>
              <div><b>3</b><span>Share the address</span><small>A public address appears here. Friends paste it into Multiplayer.</small></div>
            </div>
            <button class="btn primary lg" id="hs-new2">${icon('host')}Create your first server</button>
          </div>`}
        <p class="faint small" style="margin-top:18px">Your PC runs the servers, so they’re online while Astra and your PC are on. Public addresses: <b>e4mc</b> (Fabric/Forge/NeoForge, no account) or <b>playit.gg</b> (any server, free account).</p>`;
      $('#hs-new', el).onclick = () => this.create();
      if ($('#hs-new2', el)) $('#hs-new2', el).onclick = () => this.create();
      this.bindPop(el);
      $('#hs-paste', el).onclick = () => this.pasteSetupCode();
      $('#hs-import', el).onclick = async (e) => {
        const [f] = await api('dialog:open', { title: 'Pick a server exported from Astra', properties: ['openFile'], filters: [{ name: 'Astra server', extensions: ['zip'] }] }).catch(() => []);
        if (!f) return;
        const b = e.currentTarget; b.disabled = true; b.innerHTML = `${icon('refresh', 'spin')}Importing…`;
        try { const s = await api('hosted:import', f); toast(`Imported “${s.name}” — press Start`); Router.go('host', { id: s.id }); } catch (er) { toastErr(er); b.disabled = false; b.innerHTML = `${icon('upload')}Import server`; }
      };
      $('#hs-joincode', el).onclick = () => this.joinWithCode();
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
    if (pl.claim && pl.claim.state === 'waiting') return `<div class="card hs-playit wait">${icon('globe')}<div class="grow"><b>Approve Astra on playit.gg</b><div class="faint small">A browser tab opened. Sign in (or make a free account) and press <b>Add agent</b>. This page updates by itself.</div></div><button class="btn sm" data-pl="open">${icon('external')}Open again</button><button class="btn sm ghost" data-pl="cancel">${T('Cancel')}</button></div>`;
    if (pl.linked) {
      const a = pl.agent?.state;
      const agentText = { connected: 'connected', starting: 'connecting…', reconnecting: 'reconnecting…' }[a] || 'starts with a server that uses playit.gg';
      const notices = (pl.notices || []).map((n) => `<div class="small warn-text">${icon('alert')} ${esc(n.message)}${n.link ? ` <a href="#" data-pl-notice="${esc(n.link)}">Fix on playit.gg</a>` : ''}</div>`).join('');
      return `<div class="card hs-playit ok">${icon('globe')}<div class="grow"><b>playit.gg connected</b>${pl.account === 'guest' ? ' <span class="chip">guest account</span>' : ''}<div class="faint small">Agent: ${agentText}${pl.agent?.lastError && a !== 'connected' ? ` · <span class="danger-text">${esc(pl.agent.lastError)}</span>` : ''}</div>${notices}</div><button class="btn sm ghost" data-pl="dash">${icon('external')}Dashboard</button><button class="btn sm ghost" data-pl="unlink">Disconnect</button></div>`;
    }
    if (pl.problem) return `<div class="card hs-playit wait">${icon('alert')}<div class="grow"><b>Connect playit.gg again</b><div class="faint small">${esc(pl.problem)}</div></div><button class="btn sm ghost" data-pl="key">${icon('key')}Setup code</button><button class="btn sm primary" data-pl="connect">${icon('link')}Connect playit.gg</button></div>`;
    const msg = pl.claim?.state === 'rejected' ? 'You declined on playit.gg.' : pl.claim?.state === 'expired' ? 'The approval timed out.' : pl.claim?.state === 'error' ? esc(pl.claim.error || 'Something went wrong.') : '';
    return `<div class="card hs-playit">${icon('globe')}<div class="grow"><b>playit.gg — public address for any server</b><div class="faint small">Free. Approve this PC once on playit.gg (or paste a setup code), then Astra makes the tunnels for you — including voice chat. ${msg}</div></div><button class="btn sm ghost" data-pl="key">${icon('key')}Setup code</button><button class="btn sm primary" data-pl="connect">${icon('link')}Connect playit.gg</button></div>`;
  },
  bindPlayit(root, redraw) {
    $$('[data-pl-notice]', root).forEach((l) => (l.onclick = (e) => { e.preventDefault(); api('shell:open', l.dataset.plNotice); }));
    $$('[data-pl]', root).forEach((b) => (b.onclick = async () => {
      const a = b.dataset.pl;
      try {
        if (a === 'connect') { b.disabled = true; await api('playit:connect'); }
        if (a === 'key') return this.playitKey(redraw);
        if (a === 'open') api('shell:open', this.playit?.claim?.url);
        if (a === 'cancel') await api('playit:cancel');
        if (a === 'dash') api('shell:open', 'https://playit.gg/account/tunnels');
        if (a === 'unlink' && (await confirmDialog('Disconnect playit.gg from Astra? Servers using playit.gg won’t be public until you connect again.', { ok: 'Disconnect' }))) await api('playit:unlink');
      } catch (e) { toastErr(e); }
      redraw && redraw();
    }));
  },

  /** "Pop out": Hosting in its own window. Inside that window the same spot brings the main Astra window back. */
  popBtn(id = '') {
    return typeof POPOUT !== 'undefined' && POPOUT === 'host'
      ? `<button class="btn" data-pop="main" title="Show the main Astra window">${icon('home')}Astra</button>`
      : `<button class="btn" data-pop="host" data-pop-id="${esc(id)}" title="Open Hosting in its own window">${icon('external')}Pop out</button>`;
  },
  bindPop(root) {
    $$('[data-pop]', root).forEach((b) => (b.onclick = () => (b.dataset.pop === 'main' ? api('win:showMain') : api('win:popHost', b.dataset.popId ? { id: b.dataset.popId } : {}))));
  },
  /** Link playit.gg with a secret key from the playit.gg website instead of the browser approval. */
  playitKey(redraw) {
    const m = modal({
      title: 'playit.gg setup code',
      body: `<ol class="small" style="margin:0 0 12px 18px;line-height:1.7">
          <li>On <a href="#" data-open-agents>playit.gg → Agents</a>, press <b>Add Agent</b>.</li>
          <li>Pick <b>Docker</b> / <b>self-managed</b> — playit.gg shows a <b>SECRET_KEY</b>.</li>
          <li>Copy that key and paste it here.</li></ol>
        <input type="password" id="pk-key" class="mono" style="width:100%" placeholder="Paste the secret key" spellcheck="false" autocomplete="off">
        <p class="faint small">The key is checked with playit.gg and saved encrypted on this PC only.</p>`,
      footer: `<button class="btn ghost" data-x>${T('Cancel')}</button><button class="btn primary" data-go>${icon('link')}Connect</button>`,
    });
    m.$('[data-open-agents]').onclick = (e) => { e.preventDefault(); api('shell:open', 'https://playit.gg/account/agents'); };
    m.$('[data-x]').onclick = () => m.close();
    const go = m.$('[data-go]');
    go.onclick = async () => {
      go.disabled = true; go.innerHTML = `${icon('refresh', 'spin')}Checking…`;
      try { await api('playit:useKey', m.$('#pk-key').value); m.close(); redraw && redraw(); }
      catch (e) { toastErr(e); go.disabled = false; go.innerHTML = `${icon('link')}Connect`; }
    };
    setTimeout(() => m.$('#pk-key')?.focus(), 50);
  },
  /** Paste a Astra setup code (SOLARIS-…) and open New server with everything filled in. */
  pasteSetupCode() {
    const m = modal({
      title: 'Use a setup code',
      body: `<p class="muted small">A setup code holds a whole server setup — software, version, game settings, mods/plugins, voice chat and schedules. Get one from a server’s <b>Settings → Setup code</b>.</p><textarea id="sc-code" class="mono" rows="4" style="width:100%" placeholder="SOLARIS-…" spellcheck="false"></textarea>`,
      footer: `<button class="btn ghost" data-x>${T('Cancel')}</button><button class="btn primary" data-go>${icon('plus')}Continue</button>`,
    });
    m.$('[data-x]').onclick = () => m.close();
    m.$('[data-go]').onclick = async () => {
      try { const t = await api('hosted:readSetupCode', m.$('#sc-code').value); m.close(); this.create(t); } catch (e) { toastErr(e); }
    };
  },
  /** A friend's join code (JOIN-…): straight into the game. */
  joinWithCode() {
    const m = modal({
      title: 'Join with code',
      body: `<p class="muted small">Paste the join code your friend sent you (it starts with <span class="mono">JOIN-</span>). A normal server address works too.</p><input type="text" id="jc-code" class="mono" style="width:100%" placeholder="JOIN-…" spellcheck="false">`,
      footer: `<button class="btn ghost" data-x>${T('Cancel')}</button><button class="btn primary" data-go>${icon('play')}Join</button>`,
    });
    m.$('[data-x]').onclick = () => m.close();
    m.$('[data-go]').onclick = async () => {
      const v = m.$('#jc-code').value.trim();
      try {
        const j = /^JOIN-/i.test(v) ? await api('hosted:readJoinCode', v) : /^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(v) ? { address: v } : null;
        if (!j) throw new Error('That isn’t a join code or server address.');
        if (!(await Pages.friends.accountCheck(j))) return;
        m.close();
        Pages.servers.join(j.address, { mc: j.mc || undefined, modded: j.modded || '' });
      } catch (e) { toastErr(e); }
    };
    setTimeout(() => m.$('#jc-code')?.focus(), 50);
  },

  /** Readiness check: is this server (modpack) ready to run, with no issues? One-click fixes, Fix all, Start. */
  async showCheck(id, s) {
    const m = modal({ title: `Check ${s?.name || 'server'}`, wide: true, body: `<div id="ck-body"><p class="muted">${icon('refresh', 'spin')} Checking the server — mods, required mods, loader, memory, last crash…</p></div>`,
      footer: `<button class="btn" data-x>${T('Close')}</button><button class="btn" data-all hidden>${icon('zap')}Fix all</button><button class="btn primary" data-start>${icon('play')}Start</button>` });
    m.$('[data-x]').onclick = () => m.close();
    m.$('[data-start]').onclick = () => { m.close(); this.start(id); };
    const run = async () => {
      const body = m.$('#ck-body'); if (!body) return;
      let r;
      try { r = await api('hosted:check', id); } catch (e) { body.innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div></div>`; return; }
      if (!body.isConnected) return;
      const bad = r.checks.filter((c) => !c.ok);
      body.innerHTML = `<div class="ck-head ${r.ready ? 'ok' : 'bad'}">${icon(r.ready ? 'check' : 'alert')}<div><b>${r.ready ? 'Ready to run — no issues found' : (() => { const n = bad.filter((c) => c.level !== 'warn').length || bad.length; return `${n} issue${n === 1 ? '' : 's'} to fix`; })()}</b><div class="faint small">${r.ready ? (bad.length ? 'A few suggestions below.' : 'Everything Astra checks is fine.') : 'Fix them here, then press Start.'}</div></div></div>
        <div class="ck-list">${[...bad, ...r.checks.filter((c) => c.ok)].map((c) => `<div class="ck-row ${c.ok ? 'ok' : c.level}"><span class="ck-ic">${icon(c.ok ? 'check' : 'alert')}</span><div class="grow"><b>${esc(c.title)}</b>${c.detail ? `<div class="faint small">${esc(c.detail)}</div>` : ''}</div>${!c.ok && c.fix ? `<button class="btn sm primary" data-fx="${r.checks.indexOf(c)}">${esc(c.fix.label)}</button>` : ''}</div>`).join('')}</div>`;
      const fixes = r.checks.filter((c) => !c.ok && c.fix && c.fix.type !== 'manual');
      const all = m.$('[data-all]'); all.hidden = fixes.length < 2; all.disabled = false; all.innerHTML = `${icon('zap')}Fix all`;
      const apply = async (c, b) => {
        if (c.fix.type === 'manual') { toast('Install the modpack as an instance once (Content Hub) — Astra copies those files to the server from it.', 'info', 8000); return; }
        if (b) { b.disabled = true; b.innerHTML = `${icon('refresh', 'spin')}Fixing…`; }
        try { toast(await api('hosted:applyFix', id, c.fix)); } catch (e) { toastErr(e); }
      };
      $$('[data-fx]', body).forEach((b) => (b.onclick = async () => { await apply(r.checks[+b.dataset.fx], b); run(); }));
      // Fix all: one fix can reveal the next (turning a mod on shows what it needs), so repeat until nothing's left
      m.$('[data-all]').onclick = async (e) => {
        const b = e.currentTarget; b.disabled = true; b.innerHTML = `${icon('refresh', 'spin')}Fixing…`;
        let todo = fixes;
        for (let pass = 0; pass < 4 && todo.length; pass++) {
          for (const c of todo) await apply(c);
          const again = await api('hosted:check', id).catch(() => null);
          todo = again ? again.checks.filter((c) => !c.ok && c.fix && !['manual', 'install', 'memory'].includes(c.fix.type)) : [];
        }
        run();
      };
    };
    run();
  },
  /** "Why did it stop?": plain-words reasons from the last run's log, each with a one-click fix when there is one. */
  async showDiagnosis(id, pre = null) {
    let d = pre;
    if (!d) { try { d = await api('hosted:diagnose', id); } catch (e) { return toastErr(e); } }
    const m = modal({
      title: `Why ${d.name} stopped`,
      body: !d.hasLog ? '<p class="muted">Astra has no log from this server yet — start it once first.</p>'
        : d.normal ? `<p>${icon('check')} The last run ended normally — it was stopped, it didn’t crash. Nothing to fix.</p>`
        : `${d.findings.length ? `<div class="stack" style="gap:8px">${d.findings.map((f, i) => `<div class="card row" style="gap:10px;padding:10px 12px">${icon('alert')}<span class="grow">${esc(f.text)}</span>${f.fix ? `<button class="btn sm primary" data-fix="${i}">${esc(f.fix.label)}</button>` : ''}</div>`).join('')}</div>`
          : '<p class="muted">Astra didn’t find a known cause. The last errors from the log are below — the Console tab and Log files show everything.</p>'}
          ${d.errors.length ? `<details style="margin-top:12px" ${d.findings.length ? '' : 'open'}><summary class="small">Last errors in the log</summary><pre class="console" style="max-height:220px;overflow:auto;white-space:pre-wrap">${esc(d.errors.join('\n'))}</pre></details>` : ''}
          <p class="faint small" style="margin-top:10px">After a fix, press Start to try again.</p>`,
      footer: `<button class="btn" data-x>${T('Close')}</button><button class="btn primary" data-start>${icon('play')}Start</button>`,
    });
    m.$('[data-x]').onclick = () => m.close();
    m.$('[data-start]').onclick = () => { m.close(); this.start(id); };
    $$('[data-fix]', m.el).forEach((b) => (b.onclick = async () => {
      const f = d.findings[+b.dataset.fix].fix;
      if (f.type === 'backups') { m.close(); return Router.go('host', { id, tab: 'backups' }); }
      b.disabled = true; b.innerHTML = `${icon('refresh', 'spin')}Fixing…`;
      try { toast(await api('hosted:applyFix', id, f)); b.innerHTML = `${icon('check')}Done`; } catch (e) { toastErr(e); b.disabled = false; b.textContent = f.label; }
    }));
  },
  /** Lag check: TPS, tick time and CPU in plain words, plus a spark report that shows what takes the time. */
  async lagCheck(id, s) {
    const m = modal({ title: `Lag check — ${s.name}`, body: `<div id="lg-body"><p class="muted">${icon('refresh', 'spin')} Measuring for about 30 seconds… keep playing normally, it doesn’t stop the server.</p></div>`, footer: `<button class="btn" data-x>${T('Close')}</button>` });
    m.$('[data-x]').onclick = () => m.close();
    const body = m.$('#lg-body');
    try {
      const r = await api('hosted:lagCheck', id);
      if (!body.isConnected) return;
      if (r.installed) { body.innerHTML = `<p>${esc(r.message)}</p>`; return; }
      const tile = (label, v, good) => `<div class="card" style="padding:10px 12px;text-align:center"><div class="faint small">${label}</div><div style="font-size:22px;font-weight:700" class="${good == null ? '' : good ? 'ok-text' : 'warn-text'}">${v ?? '—'}</div></div>`;
      body.innerHTML = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
          ${tile('TPS (20 is perfect)', r.tps, r.tps == null ? null : r.tps >= 19.5)}${tile('Tick time (ms)', r.msptMedian, r.msptMedian == null ? null : r.msptMedian < 40)}${tile('Slowest ticks (ms)', r.mspt95, r.mspt95 == null ? null : r.mspt95 < 50)}${tile('CPU', r.cpu != null ? r.cpu + '%' : null, r.cpu == null ? null : r.cpu < 85)}</div>
        <ul style="margin:12px 0 0 18px;line-height:1.6">${r.verdict.map((v) => `<li>${esc(v)}</li>`).join('') || '<li>No problems found.</li>'}</ul>
        ${r.url ? `<p style="margin-top:10px">${icon('chart')} <a href="#" data-report>Open the spark report</a> <span class="faint small">— the biggest bars are what uses the most time (a mod, plugin, or lots of mobs/redstone in one place).</span></p>` : '<p class="faint small">The detailed spark report couldn’t be made (spark needs internet to upload it).</p>'}`;
      const a = $('[data-report]', body); if (a) a.onclick = (e) => { e.preventDefault(); api('shell:open', r.url); };
    } catch (e) { if (body.isConnected) body.innerHTML = `<p class="danger-text">${esc(e.message)}</p>`; }
  },
  /** One game instance with the server's version, loader and mods (plus voice chat), to play on it. */
  async makeInstance(id, s, btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = `${icon('refresh', 'spin')}Making…`; }
    try {
      const r = await api('hosted:makeInstance', id);
      await refreshInstances();
      toast(`${r.updated ? 'Updated' : 'Made'} “${r.instance.name}”${r.added.length ? ` with ${r.added.length} mod${r.added.length === 1 ? '' : 's'}` : ''}. Press Join to play on ${s.name}.`, 'ok', 8000);
      if (r.skipped.length) toast(`Left out: ${r.skipped.join('; ')}`, 'info', 10000);
      return r;
    } catch (e) { toastErr(e); } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = `${icon('library')}Make game instance`; } }
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
        : s.knownAddress ? `<span class="hs-tdot ${esc(ts.state || 'off')}" title="${esc(ts.text || '')}"></span><span class="mono ellipsis" style="opacity:.6" title="${esc(ts.text || '')}">${esc(s.knownAddress)}</span><button class="icon-btn" data-copy="${esc(s.knownAddress)}" title="Copy address">${icon('copy')}</button>`
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
  /** Step-by-step joining instructions for friends. */
  howToJoin(s, addr) {
    if (s.bedrockServer) {
      const [host, port] = String(addr).split(/:(?=\d+$)/);
      const m = modal({
        title: `Join ${s.name}`,
        body: `<div class="hs-join"><ol>
          <li>Open <b>Minecraft</b> (Bedrock Edition — phone, Xbox, PlayStation, Switch or Windows), version <b>${esc(s.mc)}</b> or close to it.</li>
          <li>Press <b>Play</b> → <b>Servers</b> → <b>Add Server</b>.</li>
          <li>Server Address: <span class="mono">${esc(host)}</span> · Port: <span class="mono">${esc(port || '19132')}</span></li>
          <li>Save, then join.</li></ol>
          <p class="faint small">Consoles can only add servers through a phone or PC trick (like the “BedrockTogether” app). Java players can’t join a Bedrock server.</p></div>`,
        footer: `<button class="btn" data-x>${T('Close')}</button><button class="btn primary" data-copy>${icon('copy')}Copy address</button>`,
      });
      m.$('[data-x]').onclick = () => m.close();
      m.$('[data-copy]').onclick = () => { api('clipboard:write', addr); toast('Address copied'); };
      return;
    }
    const m = modal({
      title: `Join ${s.name}`,
      body: `<div class="hs-join">
        <ol>
          <li>Open <b>Minecraft: Java Edition ${esc(s.mc)}</b>${s.contentKind === 'mods' ? ` with the same mods (${esc(s.softwareName)})` : ''}.</li>
          <li>Click <b>Multiplayer</b> → <b>Add Server</b>.</li>
          <li>Paste this address into <b>Server Address</b>: <span class="mono">${esc(addr)}</span></li>
          <li>Click <b>Done</b>, then double-click the server to join.</li>
        </ol>
        <p class="faint small">The address works while ${esc(s.name)} is running in Astra and its tunnel is online (green light). ${s.tunnel === 'playit' ? 'It stays the same every time, so friends only add it once.' : ''} If the whitelist is on, add your friends in the Players tab first.</p></div>`,
      footer: `<button class="btn" data-x>${T('Close')}</button><button class="btn primary" data-copy>${icon('copy')}Copy address</button><button class="btn" data-copyall>${icon('copy')}Copy instructions</button>`,
    });
    m.$('[data-x]').onclick = () => m.close();
    m.$('[data-copy]').onclick = () => { api('clipboard:write', addr); toast('Address copied'); };
    m.$('[data-copyall]').onclick = () => { api('clipboard:write', `Join my Minecraft server "${s.name}" (Java ${s.mc}):\nMultiplayer → Add Server → Server Address: ${addr}`); toast('Instructions copied — paste them to your friends'); };
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
  async create(pre = null) {
    const totalMb = Math.round((State.info?.totalMem || 8 * 1024 ** 3) / 1048576);
    const def = totalMb <= 8192 ? 2048 : 4096;
    let sw = 'paper', mode = 'paper', folder = null, pack = null, preContent = [], worldSrc = null, step = 1, tun = 'playit', wantMc = null;
    const sel = (id, opts, cur) => `<select id="${id}">${opts.map(([v, n]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
    const yes = `<span class="ok-text">✓</span>`, no = `<span class="faint">✗</span>`;
    const card = ([k, n, perf, plugins, mods, d]) => `<button class="hc-type" data-type="${k}"><div class="row" style="gap:8px"><span class="hc-type-ic">${icon(k === 'bedrock' ? 'globe' : k === 'modpack' ? 'package' : 'host')}</span><b class="grow">${n}</b></div>
      <div class="small faint">${esc(d)}</div><div class="small">Performance <b class="hc-perf ${perf.toLowerCase()}">${perf}</b></div>
      <div class="small">${plugins ? yes : no} Plugins&nbsp;&nbsp;${mods ? yes : no} Mods</div></button>`;
    const STEPS = ['Server Type', 'World', 'Performance', 'Review'];
    const m = modal({
      title: 'New server', wide: true,
      body: `<div class="hs-create">
        <div class="hc-stepper">${STEPS.map((n, i) => `<div class="hc-st" data-st="${i + 1}"><b>${i + 1}</b><span>${n}</span></div>`).join('')}</div>
        <section class="hc-step" data-step="1">
          <div class="row hc-codebar"><span class="faint small grow">${icon('key')} Have a setup code? Paste it to fill everything in.</span><input type="text" id="hc-code" class="mono" style="width:260px" placeholder="SOLARIS-…" spellcheck="false"><button class="btn sm" id="hc-code-use">Use</button></div>
          <h3 style="margin:4px 0 0">Server Type Setup</h3><div class="faint small">Select the type of Minecraft server you want to run</div>
          <div class="hc-types">${HOST_TYPES.map(card).join('')}</div>
          <div class="field hidden" id="hc-pack-wrap">Modpack <span class="faint small">(Modrinth or CurseForge)</span>
            <div class="row" style="gap:8px"><div class="seg" id="hc-pl">${['fabric', 'quilt', 'forge', 'neoforge'].map((l) => `<button data-pl="${l}">${HOST_SW.find((x) => x[0] === l)[1]}</button>`).join('')}</div><label class="row small" style="gap:6px">Minecraft<select id="hc-pack-mc"><option>Loading…</option></select></label><span class="grow small" id="hc-pack">None picked</span><button class="btn sm primary" id="hc-pack-pick">${icon('search')}Choose modpack…</button></div></div>
          <div class="faint small" id="hc-sw-note"></div>
        </section>
        <section class="hc-step hidden" data-step="2">
          <div class="row"><label class="field grow">Server name<input type="text" id="hc-name" maxlength="40" placeholder="My server"></label>
            <label class="field grow">Minecraft version<select id="hc-mc"><option>Loading…</option></select></label></div>
          <div class="row"><label class="field grow">Game mode${sel('hc-gm', [['survival', 'Survival'], ['creative', 'Creative'], ['adventure', 'Adventure'], ['spectator', 'Spectator']], 'survival')}</label>
            <label class="field grow">Difficulty${sel('hc-df', [['peaceful', 'Peaceful'], ['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], 'normal')}</label>
            <label class="field grow">World type${sel('hc-lt', [['minecraft:normal', 'Normal'], ['minecraft:flat', 'Superflat'], ['minecraft:large_biomes', 'Large biomes'], ['minecraft:amplified', 'Amplified']], 'minecraft:normal')}</label></div>
          <label class="field">World seed <span class="faint small">(blank = random)</span><input type="text" id="hc-seed" maxlength="60"></label>
          <label class="field">Message of the day <span class="faint small">(shown in the server list)</span><input type="text" id="hc-motd" maxlength="120" placeholder="${esc('<name> — hosted with Astra')}"></label>
          <div class="hc-checks" id="hc-java-checks">
            <label><input type="checkbox" id="hc-pvp" checked>PvP</label>
            <label><input type="checkbox" id="hc-hc">Hardcore</label>
            <label><input type="checkbox" id="hc-cb">Command blocks</label>
            <label><input type="checkbox" id="hc-fly">Allow flying (for mods)</label>
          </div>
          <div class="field">Start with a world from your PC <span class="faint small">(optional — singleplayer world folder, .zip${'' /* .mcworld for Bedrock */} or .mcworld)</span>
            <div class="row"><span class="mono small grow ellipsis" id="hc-world">A new world</span><button class="btn sm" id="hc-world-dir">${icon('folder')}Folder…</button><button class="btn sm" id="hc-world-zip">${icon('file')}File…</button><button class="btn sm ghost hidden" id="hc-world-clear">${icon('close')}</button></div></div>
        </section>
        <section class="hc-step hidden" data-step="3">
          <div class="field" id="hc-mem-wrap">Memory (RAM) <b id="hc-memv"></b>
            <input type="range" id="hc-mem" min="1024" max="${Math.max(2048, Math.floor((totalMb * 0.75) / 512) * 512)}" step="512" value="${def}">
            <div class="row small faint"><span>1 GB</span><span class="grow"></span><span>Available: ${(totalMb / 1024).toFixed(0)} GB</span></div>
            <div class="small" id="hc-memhint"></div></div>
          <div class="row"><label class="field grow">Max players<input type="number" id="hc-max" min="1" max="200" value="10"></label>
            <label class="field grow">View distance<input type="number" id="hc-vd" min="3" max="32" value="10"></label>
            <label class="field grow" id="hc-sd-wrap">Simulation distance<input type="number" id="hc-sd" min="3" max="32" value="8"></label>
            <label class="field grow">Port<input type="number" id="hc-port" min="1024" max="65535" placeholder="auto"></label></div>
          <div class="field">Public address<div class="seg" id="hc-tun"><button data-t="playit">Playit.gg</button><button data-t="e4mc">e4mc</button><button data-t="none">Home network only</button></div><div class="faint small" id="hc-tun-note"></div></div>
          <label class="field" id="hc-tname-wrap">Tunnel name on playit.gg <span class="faint small">(optional)</span><input type="text" id="hc-tname" maxlength="40" placeholder="Same as the server name"></label>
          <div class="hc-checks">
            <label><input type="checkbox" id="hc-wl">Whitelist (only added players)</label>
            <label id="hc-off-wrap" title="Lets offline/cracked accounts join. Anyone could use any name — turn the whitelist on too."><input type="checkbox" id="hc-off">Allow offline (cracked) accounts</label>
          </div>
          <details class="hc-more" id="hc-extras-wrap" open><summary><b>Extras</b> <span class="faint small">installed for you</span></summary>
            <label class="hc-voice"><input type="checkbox" id="hc-voice" checked><span><b>Simple Voice Chat</b> — proximity voice chat. Astra installs it, makes the UDP tunnel on playit.gg and sets <span class="mono">voice_host</span> automatically.</span></label>
            <label class="hc-voice" id="hc-bedrock-wrap"><input type="checkbox" id="hc-bedrock"><span><b>Bedrock players</b> — friends on phone, Xbox, PlayStation, Switch and Windows can join too (Geyser + Floodgate). Astra makes the playit.gg tunnel for them.</span></label>
            <div class="hc-checks" id="hc-extras"></div></details>
          <details class="hc-more"><summary><b>Automation &amp; folder</b></summary>
            <div class="hc-checks"><label><input type="checkbox" id="hc-auto">Start this server automatically (also when Windows starts)</label><label><input type="checkbox" id="hc-crash">Restart it if it crashes</label></div>
            <div class="row"><label class="field grow">Auto backup every${sel('hc-bk', [['0', 'Off'], ['1', '1 hour'], ['3', '3 hours'], ['6', '6 hours'], ['12', '12 hours'], ['24', 'Day']], '0')}</label>
              <label class="field grow">Auto restart every${sel('hc-rs', [['0', 'Off'], ['6', '6 hours'], ['12', '12 hours'], ['24', 'Day']], '0')}</label></div>
            <div class="field">Folder<div class="row"><span class="mono small grow ellipsis" id="hc-dir">Default (inside Astra data)</span><button class="btn sm" id="hc-pick">${icon('folder')}Choose…</button></div></div></details>
        </section>
        <section class="hc-step hidden" data-step="4">
          <h3 style="margin:0">Review</h3><div class="hc-review" id="hc-review"></div>
          <label class="row" style="gap:10px;align-items:flex-start"><input type="checkbox" id="hc-eula"><span>I accept the <a href="#" id="hc-eula-link">Minecraft EULA</a> — required to run a Minecraft server.</span></label>
          <div class="hc-progress hidden" id="hc-progress"></div>
        </section>
      </div>`,
      footer: `<button class="btn ghost" data-x>${T('Cancel')}</button><div class="grow"></div><button class="btn" data-back>${icon('back')}Back</button><button class="btn primary" data-next>Next${icon('fwd')}</button><button class="btn primary hidden" data-go disabled>${icon('host')}Create server</button>`,
    });
    const go = m.$('[data-go]'), next = m.$('[data-next]'), back = m.$('[data-back]');
    const bds = () => sw === 'bedrock';
    const memHint = () => {
      const v = +m.$('#hc-mem').value, kind = mode === 'modpack' ? 'pack' : HOST_KIND[sw];
      const [lo, hi, what] = { pack: [8192, 12288, 'a modpack server'], mods: [6144, 10240, 'a modded server'], plugins: [4096, 8192, 'a plugin server'], none: [2048, 4096, 'a vanilla server'] }[kind] || [4096, 8192, 'this server'];
      const lo2 = Math.min(lo, +m.$('#hc-mem').max), hi2 = Math.min(hi, +m.$('#hc-mem').max);
      m.$('#hc-memv').textContent = `${(v / 1024).toFixed(1)} GB`;
      m.$('#hc-memhint').innerHTML = v < lo2 ? `<span class="warn-text">${icon('alert')} Below the ${(lo2 / 1024).toFixed(0)}–${(hi2 / 1024).toFixed(0)} GB that runs ${what} smoothly.</span>` : v > hi2 + 2048 ? `<span class="faint">More than ${what} needs — your PC keeps less for itself and the game.</span>` : `<span class="ok-text">${icon('check')} Optimal RAM — in the ${(lo2 / 1024).toFixed(0)}–${(hi2 / 1024).toFixed(0)} GB range for ${what}.</span>`;
    };
    const setTun = (t) => {
      if (t === 'e4mc' && !HOST_E4MC.includes(sw)) t = 'playit';
      tun = t;
      $$('[data-t]', m.el).forEach((b) => { b.classList.toggle('on', b.dataset.t === t); b.disabled = b.dataset.t === 'e4mc' && !HOST_E4MC.includes(sw); });
      m.$('#hc-tname-wrap').classList.toggle('hidden', t !== 'playit');
      m.$('#hc-tun-note').innerHTML = t === 'playit'
        ? `<b>Playit.gg</b> — Automatically generate a public ${bds() ? 'Bedrock' : 'Minecraft'} server address using Playit.gg. No manual tunnel configuration required.${this.playit?.linked ? '' : '<br>The first time, playit.gg asks you to approve Astra once in your browser (sign in or continue as a guest).'}`
        : t === 'e4mc' ? 'Instant public address through the free e4mc relay, nothing to sign up for (Fabric, Quilt, Forge and NeoForge).'
        : `Only people on your Wi-Fi/LAN can join (port ${m.$('#hc-port').value || 'auto'}).`;
    };
    // Live progress while the server is created: every step Astra reports, the current one highlighted.
    const steps = [];
    const prog = m.$('#hc-progress');
    const drawProg = (err) => {
      prog.classList.remove('hidden');
      const waitingClaim = this.playit?.claim?.state === 'waiting';
      prog.innerHTML = steps.map((s, i) => `<div class="st ${i === steps.length - 1 ? (err ? 'err' : 'now') : ''}">${icon(i < steps.length - 1 ? 'check' : err ? 'alert' : 'refresh', i === steps.length - 1 && !err ? 'spin' : '')}<span>${esc(s)}</span></div>`).join('')
        + (err ? `<div class="st err">${icon('alert')}<span>${esc(err)}</span></div>` : '')
        + (waitingClaim && !err ? `<div class="acts"><button class="btn sm primary" data-pl-open>${icon('external')}Open playit.gg approval</button><button class="btn sm ghost" data-pl-cancel>${T('Cancel')}</button></div>` : '');
      const o = prog.querySelector('[data-pl-open]'); if (o) o.onclick = () => api('shell:open', this.playit.claim.url);
      const c = prog.querySelector('[data-pl-cancel]'); if (c) c.onclick = () => api('playit:cancel');
    };
    const gone = () => { if (m.el.isConnected) return false; offTask(); offPl(); return true; }; // closed with × or Esc
    const offTask = window.solaris.on('task', (t) => { if (gone()) return; if (t.id === 'hosted-create' && t.detail && steps[steps.length - 1] !== t.detail) { steps.push(t.detail); drawProg(); } });
    const offPl = window.solaris.on('playit:state', () => { if (gone()) return; if (steps.length) drawProg(); });
    const closeModal = m.close; m.close = () => { offTask(); offPl(); closeModal(); };
    let versionsFor = null;
    const loadVersions = async () => {
      const vsel = m.$('#hc-mc');
      // keep the version the player already chose (a modpack's version first) when the list reloads
      const keep = pack?.mc || (vsel.value && vsel.value !== 'Loading…' ? vsel.value : null);
      vsel.innerHTML = '<option>Loading…</option>'; vsel.disabled = true;
      syncPackMc();
      const forSw = sw; versionsFor = sw;
      try {
        const vs = await api('hosted:versions', sw); if (!m.el.isConnected || versionsFor !== forSw) return;
        const pickV = wantMc || (keep && vs.includes(keep) ? keep : null);
        const list = vs.slice(0, 80); if (pickV && !list.includes(pickV) && vs.includes(pickV)) list.unshift(pickV);
        vsel.innerHTML = list.map((v) => `<option ${v === pickV ? 'selected' : ''}>${esc(v)}</option>`).join('');
        if (pack?.mc && vsel.value !== pack.mc) clearPack(`Modpack cleared — ${HOST_SW.find((x) => x[0] === sw)[1]} has no Minecraft ${pack.mc}.`);
        syncPackMc();
        if (wantMc && !vs.includes(wantMc)) toast(`${HOST_SW.find((x) => x[0] === sw)[1]} has no Minecraft ${wantMc} — pick another version.`, 'warn');
        wantMc = null;
      } catch (e) { vsel.innerHTML = '<option value="">Couldn’t load versions</option>'; toastErr(e); }
      vsel.disabled = bds(); // Mojang only offers the newest Bedrock server
      syncPackMc();
    };
    // the modpack row has its own Minecraft version box (step 1), the same list and value as step 2's
    const syncPackMc = () => { const a = m.$('#hc-mc'), b = m.$('#hc-pack-mc'); if (!a || !b) return; b.innerHTML = a.innerHTML; b.value = a.value; b.disabled = a.disabled; };
    const clearPack = (why) => { if (!pack) return; pack = null; m.$('#hc-pack').textContent = 'None picked'; if (why) toast(why, 'info'); };
    // Starter mods/plugins that fit each kind of server, by Modrinth project ID (setup codes store the same IDs).
    const EXTRAS = {
      plugins: [['hXiIvTyT', 'EssentialsX', 'homes, warps, /tpa, kits'], ['Vebnzrzj', 'LuckPerms', 'permissions and ranks'], ['fALzjamp', 'Chunky', 'pre-generate the world, less lag'], ['1u6JkXh5', 'WorldEdit', 'build tools'], ['P1OZGk5p', 'ViaVersion', 'newer game versions can join']],
      mods: [['Vebnzrzj', 'LuckPerms', 'permissions and ranks'], ['fALzjamp', 'Chunky', 'pre-generate the world, less lag'], ['l6YH9Als', 'spark', 'find what causes lag'], ['1u6JkXh5', 'WorldEdit', 'build tools']],
    };
    const drawExtras = () => {
      const kind = HOST_KIND[sw];
      m.$('#hc-extras-wrap').classList.toggle('hidden', kind === 'none');
      m.$('#hc-bedrock-wrap').classList.toggle('hidden', !HOST_BEDROCK.includes(sw));
      m.$('#hc-extras').innerHTML = (EXTRAS[kind] || []).map(([k, n, d]) => `<label title="${esc(d)}"><input type="checkbox" data-ex="${k}" ${preContent.includes(k) ? 'checked' : ''}>${n} <span class="faint small">${esc(d)}</span></label>`).join('');
    };
    const NOTES = { vanilla: 'The official server — no mods or plugins (no voice chat either).', paper: 'Fast plugin server (Bukkit/Spigot/Paper plugins).', purpur: 'Paper with extra options and plugin support.', fabric: 'Lightweight mod server — great for performance mods and modpacks.', quilt: 'Fabric-compatible mod server (most Fabric mods work).', forge: 'Classic mod server for Forge mods and modpacks.', neoforge: 'Modern Forge fork for NeoForge mods and modpacks.', bedrock: 'Mojang’s own Bedrock server: friends on phones, Xbox, PlayStation, Switch and Windows join directly. Always the newest Bedrock version. No mods or plugins, and Java players can’t join (for both, pick Paper or Fabric and tick “Bedrock players”).' };
    const setSw = (k) => {
      sw = k;
      $$('[data-pl]', m.el).forEach((b) => b.classList.toggle('on', b.dataset.pl === k));
      m.$('#hc-sw-note').textContent = mode === 'modpack' ? 'Pick the mod loader, then the modpack — Astra installs the pack’s server files.' : NOTES[k];
      const b = bds();
      m.$('#hc-mem-wrap').classList.toggle('hidden', b); m.$('#hc-sd-wrap').classList.toggle('hidden', b);
      m.$('#hc-java-checks').classList.toggle('hidden', b); m.$('#hc-off-wrap').classList.toggle('hidden', b);
      m.$('#hc-lt').querySelectorAll('option').forEach((o) => (o.hidden = b && /large|amplified/.test(o.value)));
      if (b && /large|amplified/.test(m.$('#hc-lt').value)) m.$('#hc-lt').value = 'minecraft:normal';
      drawExtras(); setTun(tun); memHint(); loadVersions();
    };
    const setMode = (k) => {
      mode = k;
      $$('[data-type]', m.el).forEach((c) => c.classList.toggle('on', c.dataset.type === k));
      m.$('#hc-pack-wrap').classList.toggle('hidden', k !== 'modpack');
      if (k !== 'modpack') { pack = null; m.$('#hc-pack').textContent = 'None picked'; }
      setSw(k === 'modpack' ? (['fabric', 'quilt', 'forge', 'neoforge'].includes(sw) ? sw : 'fabric') : k);
    };
    // Fill the dialog from a setup code.
    const applyPre = (t) => {
      wantMc = t.mc || null; preContent = t.content || [];
      if (t.name) m.$('#hc-name').value = t.name;
      m.$('#hc-max').value = t.maxPlayers || 10;
      const mem = m.$('#hc-mem'); mem.value = Math.min(+mem.max, t.memory || def);
      const p = t.props || {};
      if (p.gamemode) m.$('#hc-gm').value = p.gamemode;
      if (p.difficulty) m.$('#hc-df').value = p.difficulty;
      if (p['level-type'] && $(`#hc-lt option[value="${CSS.escape(p['level-type'])}"]`, m.el)) m.$('#hc-lt').value = p['level-type'];
      if (p['level-seed']) m.$('#hc-seed').value = p['level-seed'];
      if (p['view-distance']) m.$('#hc-vd').value = p['view-distance'];
      if (p['simulation-distance']) m.$('#hc-sd').value = p['simulation-distance'];
      m.$('#hc-pvp').checked = p.pvp !== 'false'; m.$('#hc-hc').checked = p.hardcore === 'true'; m.$('#hc-fly').checked = p['allow-flight'] === 'true';
      m.$('#hc-cb').checked = p['enable-command-block'] === 'true'; m.$('#hc-wl').checked = p['white-list'] === 'true'; m.$('#hc-off').checked = p['online-mode'] === 'false';
      m.$('#hc-voice').checked = !!t.voice; m.$('#hc-bedrock').checked = !!t.bedrock;
      m.$('#hc-bk').value = String(t.schedule?.backupHours || 0); m.$('#hc-rs').value = String(t.schedule?.restartHours || 0);
      if (t.tunnel) tun = t.tunnel;
      if (t.modpack) { mode = 'modpack'; sw = t.software; setMode('modpack'); pack = { versionId: t.modpack.versionId }; m.$('#hc-pack').textContent = 'Modpack from the setup code'; }
      else setMode(t.software || 'paper');
      const extra = preContent.filter((c) => !$(`[data-ex="${CSS.escape(c)}"]`, m.el));
      if (extra.length) m.$('#hc-sw-note').textContent += ` · The setup code also adds ${extra.length} more mod${extra.length === 1 ? '' : 's'}/plugin${extra.length === 1 ? '' : 's'}.`;
      toast('Setup code loaded — check each step, then press Create server');
    };
    // ---- steps
    const review = () => {
      const row = (k, v) => `<div class="row"><span class="faint grow">${k}</span><b>${v}</b></div>`;
      const tick = (id) => m.$(id).checked;
      const extras = [...(tick('#hc-voice') && HOST_KIND[sw] !== 'none' ? ['Simple Voice Chat'] : []), ...(tick('#hc-bedrock') && HOST_BEDROCK.includes(sw) ? ['Bedrock players'] : []), ...$$('[data-ex]', m.el).filter((b) => b.checked).map((b) => b.parentElement.firstChild.nextSibling.textContent.trim())];
      m.$('#hc-review').innerHTML = row('Server type', `${HOST_SW.find((x) => x[0] === sw)[1]}${pack ? ' · modpack' : ''}`) + row('Name', esc(m.$('#hc-name').value.trim() || `${HOST_SW.find((x) => x[0] === sw)[1]} ${m.$('#hc-mc').value}`))
        + row('Minecraft version', esc(m.$('#hc-mc').value)) + row('World', `${esc(m.$('#hc-gm').selectedOptions[0].text)} · ${esc(m.$('#hc-df').selectedOptions[0].text)} · ${esc(m.$('#hc-lt').selectedOptions[0].text)}${worldSrc ? ' · from your PC' : ''}`)
        + (bds() ? '' : row('Memory', `${(+m.$('#hc-mem').value / 1024).toFixed(1)} GB`)) + row('Players', `up to ${esc(m.$('#hc-max').value)}${tick('#hc-wl') ? ' · whitelist on' : ''}`)
        + row('Public address', tun === 'playit' ? 'playit.gg' : tun === 'e4mc' ? 'e4mc' : 'Home network only') + (extras.length ? row('Extras', esc(extras.join(', '))) : '');
    };
    const showStep = (n) => {
      if (n > 1 && mode === 'modpack' && !pack) return toast('Choose a modpack first', 'warn');
      if (n > 2 && !m.$('#hc-mc').value) return toast('Pick a Minecraft version', 'warn');
      step = n;
      $$('.hc-step', m.el).forEach((s) => s.classList.toggle('hidden', +s.dataset.step !== n));
      $$('[data-st]', m.el).forEach((s) => { s.classList.toggle('on', +s.dataset.st === n); s.classList.toggle('done', +s.dataset.st < n); });
      back.classList.toggle('hidden', n === 1); next.classList.toggle('hidden', n === 4); go.classList.toggle('hidden', n !== 4);
      if (n === 4) review();
    };
    $$('[data-st]', m.el).forEach((s) => (s.onclick = () => { if (+s.dataset.st < step) showStep(+s.dataset.st); }));
    next.onclick = () => showStep(step + 1);
    back.onclick = () => showStep(step - 1);
    m.$('#hc-code-use').onclick = async () => { try { applyPre(await api('hosted:readSetupCode', m.$('#hc-code').value)); } catch (e) { toastErr(e); } };
    $$('[data-type]', m.el).forEach((b) => (b.onclick = () => setMode(b.dataset.type)));
    $$('[data-pl]', m.el).forEach((b) => (b.onclick = () => { if (b.dataset.pl !== sw) { pack = null; m.$('#hc-pack').textContent = 'None picked'; } setSw(b.dataset.pl); }));
    $$('[data-t]', m.el).forEach((b) => (b.onclick = () => setTun(b.dataset.t)));
    m.$('#hc-mem').oninput = memHint;
    m.$('#hc-pick').onclick = async () => { const [d] = await api('dialog:open', { title: 'Choose an empty folder for the server', properties: ['openDirectory', 'createDirectory'] }).catch(() => []); if (d) { folder = d; m.$('#hc-dir').textContent = d; } };
    const setWorld = (p) => { worldSrc = p; m.$('#hc-world').textContent = p || 'A new world'; m.$('#hc-world-clear').classList.toggle('hidden', !p); };
    m.$('#hc-world-dir').onclick = async () => { const [d] = await api('dialog:open', { title: 'Pick a world folder (it has level.dat inside)', properties: ['openDirectory'] }).catch(() => []); if (d) setWorld(d); };
    m.$('#hc-world-zip').onclick = async () => { const [f] = await api('dialog:open', { title: 'Pick a world file', properties: ['openFile'], filters: [{ name: 'World', extensions: ['zip', 'mcworld'] }] }).catch(() => []); if (f) setWorld(f); };
    m.$('#hc-world-clear').onclick = () => setWorld(null);
    m.$('#hc-pack-mc').onchange = (e) => { m.$('#hc-mc').value = e.target.value; clearPack(); };
    m.$('#hc-mc').addEventListener('change', (e) => { const b = m.$('#hc-pack-mc'); if (b) b.value = e.target.value; if (pack?.mc && pack.mc !== e.target.value) clearPack(`Modpack cleared — it was for Minecraft ${pack.mc}. Pick one for ${e.target.value}.`); });
    m.$('#hc-eula').onchange = (e) => (go.disabled = !e.target.checked);
    m.$('#hc-eula-link').onclick = (e) => { e.preventDefault(); api('shell:open', 'https://www.minecraft.net/eula'); };
    m.$('#hc-pack-pick').onclick = async () => {
      const mc = m.$('#hc-pack-mc').value;
      if (!mc || m.$('#hc-pack-mc').disabled || mc === 'Loading…') return toast('Wait for the versions to load', 'info');
      m.$('#hc-mc').value = mc;
      const p = await this.pickModpack(sw, mc);
      if (p) { pack = { ...p, mc }; m.$('#hc-pack').textContent = `${p.title} · ${p.versionName} · Minecraft ${mc}`; if (!m.$('#hc-name').value) m.$('#hc-name').value = p.title.slice(0, 40); }
    };
    m.$('[data-x]').onclick = () => m.close();
    go.onclick = async () => {
      go.disabled = true; back.disabled = true; go.innerHTML = `${icon('refresh', 'spin')}Setting up…`;
      steps.length = 0;
      try {
        const ticked = $$('[data-ex]', m.el).filter((b) => b.checked).map((b) => b.dataset.ex);
        const shown = $$('[data-ex]', m.el).map((b) => b.dataset.ex);
        const content = [...ticked, ...preContent.filter((c) => !shown.includes(c))];
        const props = {
          gamemode: m.$('#hc-gm').value, difficulty: m.$('#hc-df').value, 'level-type': m.$('#hc-lt').value, 'level-seed': m.$('#hc-seed').value.trim(),
          'view-distance': Math.max(3, Math.min(32, +m.$('#hc-vd').value || 10)), 'white-list': m.$('#hc-wl').checked,
        };
        if (!bds()) Object.assign(props, { 'simulation-distance': Math.max(3, Math.min(32, +m.$('#hc-sd').value || 8)), pvp: m.$('#hc-pvp').checked, hardcore: m.$('#hc-hc').checked, 'allow-flight': m.$('#hc-fly').checked, 'enable-command-block': m.$('#hc-cb').checked, 'online-mode': !m.$('#hc-off').checked });
        if (m.$('#hc-motd').value.trim()) props.motd = m.$('#hc-motd').value.trim();
        let s = await api('hosted:create', {
          name: m.$('#hc-name').value.trim() || undefined, software: sw, mc: pack?.mc || m.$('#hc-mc').value, memory: +m.$('#hc-mem').value, maxPlayers: +m.$('#hc-max').value,
          port: m.$('#hc-port').value ? +m.$('#hc-port').value : undefined, dir: folder, tunnel: tun, eula: m.$('#hc-eula').checked, modpack: pack ? { versionId: pack.versionId } : null,
          props, tunnelName: tun === 'playit' ? m.$('#hc-tname').value.trim() : '', content, voice: HOST_KIND[sw] !== 'none' && m.$('#hc-voice').checked, bedrock: HOST_BEDROCK.includes(sw) && m.$('#hc-bedrock').checked,
          autoStart: m.$('#hc-auto').checked, schedule: { backupHours: +m.$('#hc-bk').value, restartHours: +m.$('#hc-rs').value, keepBackups: 10 },
        });
        if (m.$('#hc-crash').checked) await api('hosted:setSettings', s.id, { restartOnCrash: true }).catch(() => {});
        if (worldSrc) {
          try { const w = await api('hosted:importWorld', s.id, worldSrc); await api('hosted:setWorld', s.id, w.name); } catch (e) { toast(`The server is ready, but the world couldn’t be added: ${e.message} Add it later in the Worlds tab.`, 'warn', 10000); }
        }
        m.close();
        toast(s.knownAddress ? `${s.name} is installed — public address ${s.knownAddress}.` : `${s.name} is installed`);
        Router.go('host', { id: s.id });
        // a modpack server: show right away whether it's ready to run, with one-click fixes
        if (pack) setTimeout(() => this.showCheck(s.id, s), 400);
      } catch (e) { drawProg(e.message); toastErr(e); go.disabled = false; back.disabled = false; go.innerHTML = `${icon('refresh')}Try again`; }
    };
    if (pre) applyPre(pre); else setMode('paper');
    showStep(1);
  },
  /** Mods tab → Client mods: what players need in their game, plus extra game-only mods for the play instance. */
  async clientModsPanel(root, id, s) {
    let d; try { d = await api('hosted:clientMods', id); } catch (e) { root.innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div></div>`; return; }
    const row = (x, rm) => `<div class="row hs-person">${x.icon ? `<img src="${esc(x.icon)}" alt="" style="width:22px;height:22px;border-radius:5px">` : icon('package')}<span class="grow ellipsis">${esc(x.title)}</span>${x.required === false ? '<span class="faint small">optional</span>' : ''}${rm ? `<button class="icon-btn" data-cm-rm="${esc(x.id)}" title="Remove">${icon('trash')}</button>` : ''}</div>`;
    root.innerHTML = `<div class="hs-cols two">
      <div class="stack">
        <div class="card"><h3>${icon('users')} Players need <span class="faint small">${d.needed.length}</span></h3><div class="faint small" style="margin-bottom:8px">Mods from this server that also run in the game — friends need them to join. <b>Make game instance</b> puts them all in one game instance, ready to play.</div>
          ${d.needed.map((x) => row(x)).join('') || '<div class="faint small">None — players can join with plain Minecraft.</div>'}
          ${d.serverOnly.length ? `<details style="margin-top:8px"><summary class="small faint">${d.serverOnly.length} server-only mod${d.serverOnly.length === 1 ? '' : 's'} (players don’t need)</summary><div class="small faint">${esc(d.serverOnly.join(', '))}</div></details>` : ''}
          ${d.unknown.length ? `<details style="margin-top:4px"><summary class="small warn-text">${d.unknown.length} not on Modrinth</summary><div class="small faint">${esc(d.unknown.join(', '))} — Astra can’t tell if players need these; copy them into the instance yourself if they do.</div></details>` : ''}
          <div class="row" style="margin-top:10px"><div class="grow"></div><button class="btn sm primary" id="cm-inst">${icon('library')}Make game instance</button></div></div>
        <div class="card"><h3>${icon('plus')} Extra client mods <span class="faint small">${d.extra.length}</span></h3><div class="faint small" style="margin-bottom:8px">Game-only mods you want in the play instance too (minimap, zoom, shaders support…). The server doesn’t run them.</div>
          ${d.extra.map((x) => row(x, true)).join('') || '<div class="faint small">None yet — search on the right.</div>'}</div>
      </div>
      <div class="card"><h3>${icon('search')} Find client mods <span class="faint small">${esc(d.loader)} ${esc(d.mc)}</span></h3><div class="search" style="margin-bottom:10px">${icon('search')}<input type="search" id="cm-q" placeholder="Search client mods…"></div><div id="cm-res" class="stack" style="gap:6px"></div></div></div>`;
    const redo = () => this.clientModsPanel(root, id, s);
    $('#cm-inst', root).onclick = (e) => this.makeInstance(id, s, e.currentTarget);
    $$('[data-cm-rm]', root).forEach((b) => (b.onclick = async () => { await api('hosted:removeClientMod', id, b.dataset.cmRm).catch(toastErr); redo(); }));
    const search = debounce(async () => {
      const res = $('#cm-res', root); if (!res) return;
      res.innerHTML = '<div class="faint small">Searching…</div>';
      try {
        const hits = await api('hosted:searchClientMods', id, $('#cm-q', root).value);
        res.innerHTML = hits.map((h) => `<div class="list-row hs-res"><img src="${esc(h.icon || '')}" alt=""><div class="info"><div class="title">${esc(h.title)}</div><div class="desc">${esc(h.description)}</div></div><button class="btn sm ${h.added ? '' : 'primary'}" data-cm-add="${esc(h.id)}" ${h.added ? 'disabled' : ''}>${h.added ? 'Added' : `${icon('plus')}Add`}</button></div>`).join('') || '<div class="faint small">Nothing found for this version.</div>';
        $$('[data-cm-add]', res).forEach((b) => (b.onclick = async () => { b.disabled = true; try { await api('hosted:addClientMod', id, b.dataset.cmAdd); toast('Added — press Make game instance to put it in the play instance'); redo(); } catch (e) { toastErr(e); b.disabled = false; } }));
      } catch (e) { res.innerHTML = `<div class="faint small">${esc(e.message)}</div>`; }
    }, 300);
    $('#cm-q', root).oninput = search; search();
  },
  /** Copy mods from one of your instances into a hosted server: pick the instance, tick the mods, Copy. */
  async copyMods(id, s, report) {
    const sources = await api('hosted:modSources', id).catch((e) => (toastErr(e), null));
    if (!sources) return;
    const m = modal({ title: `Copy mods into ${s.name}`, body: `<p class="muted small">Pick one of your ${esc(s.softwareName)} instances. Mods that only work in the game (like minimaps or shaders) are left out for you.</p><div id="cm-body"></div>`, footer: `<button class="btn" data-x>Cancel</button><button class="btn primary" data-copy disabled>${icon('download')}Copy</button>` });
    m.$('[data-x]').onclick = () => m.close();
    const body = m.$('#cm-body'), go = m.$('[data-copy]');
    const pickInst = () => {
      go.disabled = true;
      body.innerHTML = sources.length ? `<div class="list">${sources.map((i) => `<div class="list-row" style="cursor:pointer" data-inst="${esc(i.id)}"><div class="info"><div class="title">${esc(i.name)}</div><div class="desc">${esc(i.mc)} · ${i.count} mod${i.count === 1 ? '' : 's'}${i.sameVersion ? '' : ` · <span class="warn-text">server is ${esc(s.mc)}</span>`}</div></div>${icon('fwd')}</div>`).join('')}</div>`
        : `<div class="empty small">None of your instances use ${esc(s.softwareName)} with mods yet.</div>`;
      $$('[data-inst]', body).forEach((r) => (r.onclick = () => pickMods(r.dataset.inst)));
    };
    const pickMods = async (instId) => {
      body.innerHTML = `<div class="faint">${icon('refresh', 'spin')} Checking mods…</div>`;
      let d; try { d = await api('hosted:instanceMods', id, instId); } catch (e) { toastErr(e); return pickInst(); }
      const ok = d.mods.filter((x) => !x.why);
      body.innerHTML = `<div class="row" style="margin-bottom:8px"><button class="btn sm ghost" data-back>${icon('back')}Instances</button><b class="grow ellipsis">${esc(d.name)} <span class="faint small">${esc(d.mc)}</span></b>${ok.length ? `<label class="row small" style="gap:6px"><input type="checkbox" id="cm-all" checked>All</label>` : ''}</div>
        ${d.sameVersion ? '' : `<p class="warn-text small">This instance is Minecraft ${esc(d.mc)} but the server is ${esc(s.mc)} — mods made for another version may stop the server from starting.</p>`}
        <div class="stack" style="gap:2px;max-height:52vh;overflow:auto">${d.mods.map((x) => `<label class="row hs-person ${x.why ? 'off' : ''}" style="gap:8px" ${x.why ? `title="${esc(x.why)}"` : ''}>
          <input type="checkbox" data-f="${esc(x.file)}" ${x.why ? 'disabled' : x.otherVersion ? '' : 'checked'}>${x.icon ? `<img src="${esc(x.icon)}" alt="" style="width:20px;height:20px;border-radius:4px">` : ''}
          <span class="grow ellipsis">${esc(x.name)} <span class="faint small">${esc(x.version)}</span></span>
          ${x.why ? `<span class="faint small">${esc(x.why)}</span>` : x.otherVersion ? `<span class="warn-text small" title="Mods for another Minecraft version usually stop the server from starting">made for ${esc(x.otherVersion)}</span>` : x.onServer ? '<span class="chip">on server — update</span>' : ''}</label>`).join('') || '<div class="faint small">This instance has no mods turned on.</div>'}</div>`;
      $('[data-back]', body).onclick = pickInst;
      const boxes = $$('[data-f]:not([disabled])', body);
      const sync = () => { const n = boxes.filter((b) => b.checked).length; go.disabled = !n; go.innerHTML = `${icon('download')}Copy ${n} mod${n === 1 ? '' : 's'}`; const a = $('#cm-all', body); if (a) a.checked = n === boxes.length; };
      boxes.forEach((b) => (b.onchange = sync));
      const all = $('#cm-all', body); if (all) all.onchange = () => { boxes.forEach((b) => (b.checked = all.checked)); sync(); };
      sync();
      go.onclick = async () => {
        go.disabled = true; go.innerHTML = `${icon('refresh', 'spin')}Copying…`;
        try { report(await api('hosted:copyFromInstance', id, instId, boxes.filter((b) => b.checked).map((b) => b.dataset.f))); m.close(); } catch (e) { toastErr(e); sync(); }
      };
    };
    // one instance with the same version: go straight to its mods
    const same = sources.filter((i) => i.sameVersion);
    if (same.length === 1 && sources.length === 1) pickMods(same[0].id); else pickInst();
  },
  pickModpack(sw, mc) {
    return new Promise((resolve) => {
      let done = false;
      let src = 'modrinth';
      const m = modal({ title: `Modpacks for ${sw} ${mc}`, body: `<div class="row" style="gap:8px;margin-bottom:10px"><div class="search grow">${icon('search')}<input type="search" id="mp-q" placeholder="Search modpacks…"></div><span class="seg" id="mp-src"><button data-src="modrinth" class="on">Modrinth</button><button data-src="curseforge">CurseForge</button></span></div><div id="mp-list" class="stack" style="gap:6px"><div class="faint">Loading…</div></div>`, onClose: () => { if (!done) resolve(null); } });
      const load = debounce(async () => {
        const box0 = m.$('#mp-list'); if (box0) box0.innerHTML = '<div class="faint">Loading…</div>';
        let err = null;
        const list = await api('hosted:searchModpacks', m.$('#mp-q').value, sw, mc, src).catch((e) => { err = e; return []; });
        const box = m.$('#mp-list'); if (!box) return;
        box.innerHTML = list.length ? list.map((p) => `<div class="list-row" data-mp="${esc(p.id)}" style="cursor:pointer"><img src="${esc(p.icon || '')}" style="width:36px;height:36px;border-radius:8px" alt=""><div class="info"><div class="title">${esc(p.title)}</div><div class="desc">${esc(p.description)}</div></div></div>`).join('') : `<div class="faint">${err ? esc(err.message) : `No ${esc(sw)} modpacks for ${esc(mc)} on ${src === 'curseforge' ? 'CurseForge' : 'Modrinth'}.`}</div>`;
        $$('[data-mp]', box).forEach((r) => (r.onclick = async () => {
          const vs = await api('hosted:modpackVersions', r.dataset.mp, sw, mc).catch(() => []);
          if (!vs.length) return toast('No version of this modpack for that Minecraft version', 'warn');
          done = true; resolve({ title: list.find((p) => p.id === r.dataset.mp).title, versionId: vs[0].id, versionName: vs[0].number }); m.close();
        }));
      }, 300);
      m.$('#mp-q').oninput = load;
      $$('#mp-src [data-src]', m.el).forEach((b) => (b.onclick = () => { src = b.dataset.src; $$('#mp-src [data-src]', m.el).forEach((x) => x.classList.toggle('on', x === b)); load(); }));
      load();
    });
  },

  // ---------- server page ----------
  async detail(el, id, ctx, tab = 'console') {
    let s;
    try { s = await api('hosted:get', id); } catch (e) { el.innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div><button class="btn sm" id="bk">← Back</button></div>`; $('#bk', el).onclick = () => Router.go('host'); return; }
    if (!this.logs.has(id) || !this.logs.get(id).length) this.logs.set(id, await api('hosted:logs', id).catch(() => []));
    const TABS = [['console', 'Console', 'console'], ['performance', 'Performance', 'chart'], ['players', 'Players', 'users'], ['worlds', 'Worlds', 'world'], ['map', 'Map', 'roadmap'], ['backups', 'Backups', 'download'], ['content', s.contentKind === 'plugins' ? 'Plugins' : 'Mods', 'package'], ['scheduler', 'Scheduler', 'clock'], ['tunnels', 'Tunnels', 'globe'], ['properties', 'Properties', 'list'], ['logs', 'Log files', 'file'], ['settings', 'Settings', 'sliders']]
      .filter((t) => (t[0] !== 'content' || s.contentKind !== 'none') && (t[0] !== 'tunnels' || s.tunnel === 'playit') && (t[0] !== 'map' || ['paper', 'purpur', 'fabric', 'quilt', 'forge', 'neoforge'].includes(s.software)));
    if (!TABS.some((t) => t[0] === tab)) tab = 'console';
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
      $('#hs-actions', el).innerHTML = this.popBtn(id).replace('class="btn"', 'class="btn lg"') + `<button class="btn lg" id="a-check" title="Is this server ready, with no issues? Checks mods, required mods, loader, memory">${icon('shield')}Check</button>` + (s.state === 'offline' ? `<button class="btn lg" id="a-why" title="Read the last run’s log and explain what went wrong">${icon('bug')}Why did it stop?</button><button class="btn primary lg play" id="a-start">${icon('play')}Start</button>`
        : `${s.bedrockServer ? '' : `<button class="btn lg" id="a-lag" ${s.state !== 'online' ? 'disabled' : ''} title="Measure lag and find what causes it">${icon('chart')}Lag check</button><button class="btn lg" id="a-join" ${s.state !== 'online' ? 'disabled' : ''}>${icon('sun')}Join</button>`}<button class="btn lg" id="a-restart" ${s.state !== 'online' ? 'disabled' : ''}>${icon('refresh')}Restart</button><button class="btn lg danger" id="a-stop" ${/stopping|restarting/.test(s.state) ? 'disabled' : ''}>${icon('power')}Stop</button>`);
      this.bindPop($('#hs-actions', el));
      if ($('#a-why', el)) $('#a-why', el).onclick = () => this.showDiagnosis(id);
      if ($('#a-check', el)) $('#a-check', el).onclick = () => this.showCheck(id, s);
      if ($('#a-lag', el)) $('#a-lag', el).onclick = () => this.lagCheck(id, s);
      if ($('#a-start', el)) $('#a-start', el).onclick = (e) => this.start(id, e.currentTarget);
      if ($('#a-stop', el)) $('#a-stop', el).onclick = (e) => { e.currentTarget.disabled = true; api('hosted:stop', id).catch(toastErr); };
      if ($('#a-restart', el)) $('#a-restart', el).onclick = (e) => { e.currentTarget.disabled = true; api('hosted:restart', id).catch(toastErr); };
      if ($('#a-join', el)) $('#a-join', el).onclick = () => Pages.servers.join(`localhost:${s.port}`, { mc: s.mc, modded: s.contentKind === 'mods' ? s.softwareName : '', instance: s.playInstance });
      const ts = s.tunnelStatus || {}, share = $('#hs-share', el);
      const pl = s.tunnel === 'playit';
      const addr = s.address || s.knownAddress; // live address, or the saved playit.gg one while not public
      share.className = `card hs-share ${s.address ? 'live' : ''}`;
      // Tunnel panel: status light, the real address (only from playit.gg / e4mc), and the tunnel controls.
      const btns = pl ? `<div class="hs-tun-btns">
          ${ts.needsLink ? `<button class="btn primary" id="hs-link">${icon('link')}Connect playit.gg</button>` : ''}
          ${!ts.needsLink ? `<button class="btn sm" id="hs-trestart" ${s.tunnelBusy ? 'disabled' : ''} title="Restart the playit.gg agent and check the tunnel">${icon('refresh', s.tunnelBusy ? 'spin' : '')}${s.tunnelBusy ? 'Working…' : 'Restart tunnel'}</button>` : ''}
          ${!ts.needsLink ? (s.playitStopped ? `<button class="btn sm" id="hs-tstart">${icon('play')}Start tunnel</button>` : `<button class="btn sm" id="hs-tstop" ${s.state === 'offline' ? 'disabled title="The tunnel only runs while the server runs"' : ''}>${icon('power')}Stop tunnel</button>`) : ''}
        </div>` : '';
      const joinBtns = addr ? `<button class="btn" data-c="addr">${icon('copy')}Copy</button>${s.bedrockServer ? '' : `<button class="btn" data-c="code" title="A short code friends paste into Astra → Hosting → Join with code">${icon('key')}Join code</button>`}<button class="btn" data-c="how">${icon('info')}How to join</button>${s.address ? `<button class="btn primary" data-c="inv">${icon('users')}Invite link</button>` : ''}` : '';
      const vc = s.voice?.on ? `<div class="small hs-voice-line">${icon('mic')} Voice chat: ${s.tunnel !== 'playit' ? '<span class="faint">on your network only — use playit.gg for friends outside</span>' : (s.voice.manualAddress || s.voice.address) ? `<span class="mono">${esc(s.voice.manualAddress || s.voice.address)}</span> <span class="faint">(UDP → port ${s.voice.port}, set as voice_host)</span>` : s.voice.error ? `<span class="danger-text">Not connected yet — playit.gg didn’t make the tunnel.</span> <a href="#" data-c="vfix">How to fix</a>` : '<span class="faint">the UDP tunnel is made when the server starts</span>'}</div>` : '';
      const br = s.bedrock?.on ? (() => {
        const [bh, bp] = String(s.bedrock.address || '').split(/:(?=\d+$)/);
        return `<div class="small hs-voice-line">${icon('globe')} Bedrock: ${s.tunnel !== 'playit' ? `<span class="faint">on your network only (port ${s.bedrock.port}) — use playit.gg for friends outside</span>` : s.bedrock.address ? `<span class="faint">Server address</span> <span class="mono">${esc(bh)}</span> <span class="faint">Port</span> <span class="mono">${esc(bp || '')}</span> <button class="icon-btn" data-c="bedrock" title="Copy Bedrock address">${icon('copy')}</button>` : s.bedrock.error ? `<span class="danger-text">${esc(s.bedrock.error)}</span>` : '<span class="faint">the Bedrock tunnel is made when the server starts</span>'}</div>`;
      })() : '';
      share.innerHTML = addr
        ? `<div class="hs-tdot ${esc(ts.state || 'off')}" title="${esc(ts.text || '')}"></div><div class="grow" style="min-width:0"><div class="faint small">${esc(ts.text || '')}${s.address ? ' — send this to friends' : ''}</div><div class="hs-big mono ellipsis ${s.address ? '' : 'dim'}">${esc(addr)}</div>${s.address ? '' : `<div class="faint small">This is your server’s ${pl ? 'playit.gg' : ''} address — it works while the server and its tunnel are running.</div>`}${vc}${br}</div>${joinBtns}${btns}`
        : `<div class="hs-tdot ${esc(ts.state || 'off')}"></div><div class="grow"><div class="faint small">${esc(ts.text || '')}</div><div class="hs-big mono">${esc(s.lan)}</div><div class="faint small">On this PC use <span class="mono">localhost:${s.port}</span>${s.tunnel === 'none' ? ' · friends on your network use your PC’s local IP' : ''}${s.playitSetupError && !s.address ? ` · <span class="danger-text">${esc(s.playitSetupError)}</span>` : ''}</div>${vc}${br}</div>${btns}`;
      $$('[data-c]', share).forEach((b) => (b.onclick = () => {
        if (b.dataset.c === 'how') return this.howToJoin(s, addr);
        if (b.dataset.c === 'vfix') return Router.go('host', { id, tab: 'settings' });
        if (b.dataset.c === 'bedrock') { api('clipboard:write', s.bedrock.address); return toast('Bedrock address copied — in Minecraft Bedrock: Play → Servers → Add Server, then put the part before the colon in Server Address and the number in Port', 'info', 10000); }
        if (b.dataset.c === 'code') return api('hosted:joinCode', id).then((c) => { api('clipboard:write', c); toast(`Join code copied: ${c} — friends paste it in Astra → Hosting → Join with code`, 'info', 9000); }).catch(toastErr);
        const t = b.dataset.c === 'addr' ? addr : `astra://server/${addr}`;
        api('clipboard:write', t); toast(b.dataset.c === 'addr' ? 'Address copied' : 'Invite link copied — friends with Astra click it to join');
      }));
      if ($('#hs-link', share)) $('#hs-link', share).onclick = async () => { try { await api('playit:connect'); toast('Approve Astra in the browser tab that opened'); } catch (e) { toastErr(e); } };
      const tbtn = (sel, call, done) => { const b = $(sel, share); if (b) b.onclick = async () => { b.disabled = true; try { s = await api(call, id); if (done) toast(done); } catch (e) { toastErr(e); } drawHead(); }; };
      tbtn('#hs-trestart', 'hosted:tunnelRestart', 'playit.gg tunnel checked');
      tbtn('#hs-tstop', 'hosted:tunnelStop', 'Tunnel stopped — the server is only on your network now');
      tbtn('#hs-tstart', 'hosted:tunnelStart', 'Tunnel started');
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
    // Players tab follows joins/leaves too, not only start/stop.
    ctx.on('hosted', (st) => { if (st && st.id === id) { const was = s.state, wasPl = s.players.join(','); s = st; drawHead(); if (tab === 'players' && (was !== s.state || wasPl !== s.players.join(','))) showTab(tab); } });
    ctx.on('hosted-stats', (st) => { if (st.id === id) { this.stats.set(id, st); drawStats(st); } });
    ctx.on('playit', async () => { try { s = await api('hosted:get', id); drawHead(); } catch {} });
  },

  tabs: {
    map(box, id, s) { return Pages.maps.serverTab(box, id, s); },
    console(box, id, s, ctx) {
      let auto = true, onlyErr = false;
      box.innerHTML = `<div class="row hs-con-bar"><label class="row small" style="gap:6px"><input type="checkbox" id="c-auto" checked>Auto-scroll</label><label class="row small" style="gap:6px"><input type="checkbox" id="c-err">Only warnings & errors</label><div class="grow"></div><button class="btn sm ghost" id="c-clear">${icon('trash')}Clear</button></div>
        <div class="console hs-console" id="hs-console"></div>
        <div class="row" style="margin-top:8px"><input type="text" id="hs-cmd" class="grow mono" placeholder="${s.state === 'offline' ? 'Start the server to send commands' : 'Command, e.g. say Hello · op Name · gamemode creative Name'}" spellcheck="false"><button class="btn" id="hs-send">${icon('send')}Send</button></div>`;
      const con = $('#hs-console', box);
      const cls = (l) => (/ERROR|Exception|FATAL/.test(l) ? 'e' : /WARN/.test(l) ? 'w' : /^\[Astra\]|Domain assigned|Done \(/.test(l) ? 's' : /^> /.test(l) ? 'c' : '');
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
      const [wl, ops, props, banned, all] = await Promise.all([api('hosted:people', id, 'whitelist'), api('hosted:people', id, 'ops'), api('hosted:settings', id), api('hosted:bans', id).catch(() => []), api('hosted:players', id).catch(() => [])]);
      const pf = this.playerFilter || (this.playerFilter = { q: '', f: 'all' });
      const head = (n) => `<img class="hs-head" src="https://mc-heads.net/avatar/${encodeURIComponent(n)}/24" alt="">`;
      const isOp = (n) => ops.some((o) => o.name.toLowerCase() === n.toLowerCase());
      const dur = (ms) => { const m = Math.round((ms || 0) / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
      const FILTERS = [['all', 'All'], ['online', 'Online'], ['op', 'Operators'], ['whitelisted', s.bedrockServer ? 'Allow list' : 'Whitelisted'], ...(s.bedrockServer ? [] : [['banned', 'Banned']])];
      box.innerHTML = `<div class="card" style="margin-bottom:12px"><div class="row" style="gap:10px;margin-bottom:8px;flex-wrap:wrap"><div class="grow"><h3 style="margin:0">${icon('users')} Player Management</h3><div class="faint small">Manage players, whitelist, operators, and bans</div></div>
          <div class="search" style="max-width:220px">${icon('search')}<input type="search" id="pm-q" placeholder="Search players..." value="${esc(pf.q)}"></div>
          <div class="hs-filter">${FILTERS.map(([k, n]) => `<button data-pf="${k}" class="${pf.f === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
          <div id="pm-list"></div></div>
        <div class="hs-cols">
        <div class="card"><h3>${icon('users')} Online now <span class="faint small">${s.players.length}</span></h3>${s.players.length ? s.players.map((p) => `<div class="row hs-person">${head(p)}<span class="grow ellipsis">${esc(p)}${isOp(p) ? ' <span class="chip">op</span>' : ''}</span>
            <select class="hs-gm" data-gm="${esc(p)}" title="Game mode"><option value="">Mode…</option><option>survival</option><option>creative</option><option>adventure</option><option>spectator</option></select>
            <button class="icon-btn" data-pmore="${esc(p)}" title="More">${icon('more')}</button></div>`).join('') : `<div class="faint small">${s.state === 'offline' ? 'The server is stopped.' : 'Nobody is online.'}</div>`}
          ${banned.length ? `<h3 style="margin-top:14px">${icon('alert')} Banned</h3>${banned.map((b) => `<div class="row hs-person">${head(b.name)}<span class="grow ellipsis" title="${esc(b.reason)}">${esc(b.name)}</span><button class="btn sm ghost" data-pardon="${esc(b.name)}">Unban</button></div>`).join('')}` : ''}</div>
        <div class="card"><h3>${icon('shield')} ${s.bedrockServer ? 'Allow list' : 'Whitelist'}</h3>
          <label class="row small" style="gap:8px;margin-bottom:8px"><input type="checkbox" id="wl-on" ${(s.bedrockServer ? props.props['allow-list'] : props.props['white-list']) === 'true' ? 'checked' : ''}>Only ${s.bedrockServer ? 'players on the list' : 'whitelisted players'} can join</label>
          <div class="row"><input type="text" id="wl-name" class="grow" placeholder="Player name"><button class="btn sm primary" id="wl-add">${icon('plus')}Add</button></div>
          <div class="stack" style="gap:4px;margin-top:8px">${wl.map((p) => `<div class="row hs-person">${head(p.name)}<span class="grow">${esc(p.name)}</span><button class="icon-btn" data-wl-rm="${esc(p.name)}">${icon('close')}</button></div>`).join('') || '<div class="faint small">Nobody yet.</div>'}</div></div>
        <div class="card"><h3>${icon('key')} Operators</h3>
          <div class="row"><input type="text" id="op-name" class="grow" placeholder="Player name"><button class="btn sm primary" id="op-add">${icon('plus')}Add</button></div>
          <div class="stack" style="gap:4px;margin-top:8px">${ops.map((p) => `<div class="row hs-person">${head(p.name)}<span class="grow">${esc(p.name)}</span><span class="faint small">level ${p.level || 4}</span><button class="icon-btn" data-op-rm="${esc(p.name)}">${icon('close')}</button></div>`).join('') || '<div class="faint small">No operators.</div>'}</div></div>
      </div>`;
      const redo = () => this.tabs.players.call(this, box, id, s);
      const drawAll = () => {
        const q = pf.q.trim().toLowerCase();
        const rows = all.filter((p) => (!q || p.name.toLowerCase().includes(q)) && (pf.f === 'all' || p[pf.f]));
        $('#pm-list', box).innerHTML = rows.length ? `<div class="faint small" style="margin-bottom:4px">${rows.length} player${rows.length === 1 ? '' : 's'}</div><table class="hs-ptable"><tr><th>Player</th><th>Status</th><th>Last seen</th><th>Play time</th><th></th></tr>${rows.map((p) => `<tr><td><div class="row" style="gap:8px">${s.bedrockServer ? icon('users') : head(p.name)}<b>${esc(p.name)}</b></div></td>
            <td>${p.online ? '<span class="chip ok">Online</span> ' : ''}${p.op ? '<span class="chip">Operator</span> ' : ''}${p.whitelisted ? `<span class="chip">${s.bedrockServer ? 'Allow list' : 'Whitelisted'}</span> ` : ''}${p.banned ? '<span class="chip danger">Banned</span>' : ''}</td>
            <td class="small faint">${p.online ? 'now' : p.last ? timeAgo(p.last) : '—'}</td><td class="small">${p.playMs ? dur(p.playMs) : '—'}</td><td><button class="icon-btn" data-pa="${esc(p.name)}" title="Actions">${icon('more')}</button></td></tr>`).join('')}</table>`
          : `<div class="faint small" style="padding:10px 0">${all.length ? 'No players match.' : '0 players — No players found. Everyone who joins shows up here.'}</div>`;
        $$('[data-pa]', box).forEach((b) => (b.onclick = (e) => {
          const p = all.find((x) => x.name === b.dataset.pa); const n = p.name;
          const live = s.state === 'online';
          contextMenu(e.clientX, e.clientY, [
            p.whitelisted ? { label: s.bedrockServer ? 'Remove from allow list' : 'Remove from whitelist', icon: 'shield', action: async () => { await api('hosted:removePerson', id, 'whitelist', n).catch(toastErr); setTimeout(redo, 600); } }
              : { label: s.bedrockServer ? 'Add to allow list' : 'Add to whitelist', icon: 'shield', action: async () => { try { await api('hosted:addPerson', id, 'whitelist', n); toast(`${n} added`); } catch (er) { toastErr(er); } setTimeout(redo, 600); } },
            p.op ? { label: 'Remove operator', icon: 'key', action: async () => { await api('hosted:removePerson', id, 'ops', n).catch(toastErr); setTimeout(redo, 800); } }
              : { label: 'Make operator', icon: 'key', action: async () => { try { await api('hosted:addPerson', id, 'ops', n); toast(`${n} is now an operator`); } catch (er) { toastErr(er); } setTimeout(redo, 800); } },
            ...(s.bedrockServer ? [] : [{ label: 'Stats & advancements', icon: 'chart', action: () => Router.go('stats', { world: `s:${id}:${props.props['level-name'] || 'world'}`, name: n }) }, { label: 'Inventory', icon: 'box', action: () => Router.go('stats', { world: `s:${id}:${props.props['level-name'] || 'world'}`, name: n, view: 'inv' }) }]),
            ...(p.online ? [{ label: 'Kick', icon: 'logout', action: () => cmd(s.bedrockServer ? `kick "${n}"` : `kick ${n}`, `${n} kicked`) }] : []),
            ...(s.bedrockServer ? [] : [p.banned ? { label: 'Unban', icon: 'check', action: async () => { await api('hosted:pardon', id, n).catch(toastErr); toast(`${n} unbanned`); setTimeout(redo, live ? 800 : 0); } }
              : { label: 'Ban', icon: 'alert', danger: true, action: async () => { if (!live) return toast('Start the server to ban players', 'info'); if (await confirmDialog(`Ban ${n} from ${s.name}?`, { danger: true, ok: 'Ban' })) { cmd(`ban ${n}`, `${n} banned`); setTimeout(redo, 900); } } }]),
          ]);
        }));
      };
      drawAll();
      $('#pm-q', box).oninput = (e) => { pf.q = e.target.value; drawAll(); };
      $$('[data-pf]', box).forEach((b) => (b.onclick = () => { pf.f = b.dataset.pf; $$('[data-pf]', box).forEach((x) => x.classList.toggle('on', x === b)); drawAll(); }));
      const cmd = (c, done) => api('hosted:command', id, c).then(() => done && toast(done)).catch(toastErr);
      $$('[data-gm]', box).forEach((sl) => (sl.onchange = () => { if (sl.value) cmd(`gamemode ${sl.value} ${sl.dataset.gm}`, `${sl.dataset.gm} → ${sl.value}`); sl.value = ''; }));
      $$('[data-pardon]', box).forEach((b) => (b.onclick = async () => { await api('hosted:pardon', id, b.dataset.pardon).catch(toastErr); toast(`${b.dataset.pardon} unbanned`); setTimeout(redo, s.state === 'offline' ? 0 : 800); }));
      $$('[data-pmore]', box).forEach((b) => (b.onclick = (e) => {
        const p = b.dataset.pmore, owner = State.accounts?.accounts?.find((a) => a.id === State.accounts.active)?.name;
        contextMenu(e.clientX, e.clientY, [
          isOp(p) ? { label: 'Remove operator', icon: 'key', action: async () => { await api('hosted:removePerson', id, 'ops', p).catch(toastErr); toast(`${p} is no longer an operator`); setTimeout(redo, 800); } }
            : { label: 'Make operator', icon: 'key', action: async () => { await api('hosted:addPerson', id, 'ops', p).catch(toastErr); toast(`${p} is now an operator`); setTimeout(redo, 800); } },
          ...(owner && owner !== p ? [{ label: `Teleport to ${owner}`, icon: 'fwd', action: () => cmd(`tp ${p} ${owner}`, `${p} teleported`) }, { label: `Teleport ${owner} here`, icon: 'back', action: () => cmd(`tp ${owner} ${p}`, `Teleported to ${p}`) }] : []),
          { label: 'Heal', icon: 'heart', action: () => cmd(`effect give ${p} minecraft:instant_health 1 10 true`, `${p} healed`) },
          { label: 'Send message…', icon: 'edit', action: async () => { const t = await promptDialog(`Message to ${p}`, { placeholder: 'Message', ok: 'Send' }); if (t) cmd(`tell ${p} ${t}`, 'Sent'); } },
          '-',
          { label: 'Kick', icon: 'logout', action: () => cmd(`kick ${p}`, `${p} kicked`) },
          { label: 'Ban', icon: 'alert', danger: true, action: async () => { if (await confirmDialog(`Ban ${p} from ${s.name}? They can’t join again until you unban them.`, { danger: true, ok: 'Ban' })) { cmd(`ban ${p}`, `${p} banned`); setTimeout(redo, 900); } } },
        ]);
      }));
      $('#wl-on', box).onchange = async (e) => { await api('hosted:setSettings', id, { props: { 'white-list': e.target.checked, 'enforce-whitelist': e.target.checked } }); if (s.state !== 'offline') api('hosted:command', id, `${s.bedrockServer ? 'allowlist' : 'whitelist'} ${e.target.checked ? 'on' : 'off'}`); toast(e.target.checked ? 'Whitelist on' : 'Whitelist off'); };
      const add = (kind, input) => async () => { const n = $(input, box).value.trim(); if (!n) return; try { await api('hosted:addPerson', id, kind, n); toast(`${n} added`); setTimeout(redo, s.state === 'offline' ? 0 : 800); } catch (e) { toastErr(e); } };
      $('#wl-add', box).onclick = add('whitelist', '#wl-name');
      $('#op-add', box).onclick = add('ops', '#op-name');
      $$('[data-wl-rm]', box).forEach((b) => (b.onclick = async () => { await api('hosted:removePerson', id, 'whitelist', b.dataset.wlRm); setTimeout(redo, s.state === 'offline' ? 0 : 800); }));
      $$('[data-op-rm]', box).forEach((b) => (b.onclick = async () => { await api('hosted:removePerson', id, 'ops', b.dataset.opRm); setTimeout(redo, s.state === 'offline' ? 0 : 800); }));
    },

    async worlds(box, id, s, ctx) {
      const ws = await api('hosted:worlds', id);
      box.innerHTML = `<div class="card"><div class="row" style="margin-bottom:10px"><h3 class="grow" style="margin:0">${icon('world')} Worlds</h3><button class="btn sm" id="w-imp-dir" ${s.state !== 'offline' ? 'disabled title="Stop the server first"' : ''}>${icon('download')}Import world folder</button><button class="btn sm" id="w-imp-zip" ${s.state !== 'offline' ? 'disabled title="Stop the server first"' : ''}>${icon('file')}Import .zip${s.bedrockServer ? ' / .mcworld' : ''}</button><button class="btn sm" id="w-open">${icon('folder')}Open folder</button></div>
        ${ws.length ? ws.map((w) => `<div class="row hs-person">${icon('world')}<b class="grow">${esc(w.name)}</b>${w.active ? '<span class="chip ok">Active</span>' : `<button class="btn sm" data-w-use="${esc(w.name)}" ${s.state !== 'offline' ? 'disabled' : ''}>Use</button>`}<span class="faint small">${timeAgo(w.modified)}</span><button class="btn sm danger" data-w-del="${esc(w.name)}" ${s.state !== 'offline' ? 'disabled' : ''}>${icon('trash')}${w.active ? 'Reset' : 'Delete'}</button></div>`).join('') : '<div class="faint small">No world yet — it’s created the first time the server starts.</div>'}
        <p class="faint small">Stop the server to switch or delete worlds. Resetting the active world makes a fresh one on next start. Make a backup first if you might want it back.</p></div>
        ${s.contentKind !== 'none' ? `<div class="card stack" style="margin-top:12px" id="pg-card"></div>` : ''}`;
      const pg = $('#pg-card', box);
      if (pg) {
        const drawPg = (c) => {
          const run = c && (c.state === 'running' || c.state === 'paused');
          pg.innerHTML = `<h3 style="margin:0">${icon('world')} Pre-generate the world <span class="faint small">(Chunky)</span></h3>
            <div class="faint small">Makes the land around spawn ahead of time, so exploring doesn’t lag for players. It runs while the server is online; players can stay on.</div>
            ${run || c?.state === 'done' ? `<div class="row" style="gap:10px"><div class="hs-pregen-bar grow"><div style="width:${Math.min(100, c.percent || 0)}%"></div></div><b class="small">${(c.percent || 0).toFixed(1)}%</b>${c.eta && run ? `<span class="faint small">about ${esc(c.eta)} left</span>` : ''}${c.state === 'paused' ? '<span class="chip">Paused</span>' : ''}${c.state === 'done' ? '<span class="chip ok">Finished</span>' : ''}</div>` : ''}
            <div class="row" style="gap:8px">${run ? `${c.state === 'paused' ? `<button class="btn sm primary" data-pg="continue">${icon('play')}Continue</button>` : `<button class="btn sm" data-pg="pause">${icon('stop')}Pause</button>`}<button class="btn sm ghost" data-pg="cancel">${T('Cancel')}</button>`
              : `<label class="row small" style="gap:6px">Area<select id="pg-r"><option value="1000">Small — 2 × 2 km</option><option value="2000" selected>Medium — 4 × 4 km</option><option value="5000">Large — 10 × 10 km</option></select></label><button class="btn sm primary" data-pg="start">${icon('play')}Start</button>`}</div>`;
          $$('[data-pg]', pg).forEach((b) => (b.onclick = async () => {
            b.disabled = true;
            try { const r = await api('hosted:pregen', id, { action: b.dataset.pg, radius: +($('#pg-r', pg)?.value || 2000) }); if (r.installed) toast(r.message, 'info', 9000); else drawPg(r.chunky); } catch (e) { toastErr(e); b.disabled = false; }
          }));
        };
        drawPg(s.chunky);
        if (ctx) ctx.on('hosted-chunky', (c) => { if (c.id === id && pg.isConnected) drawPg(c); });
      }
      $('#w-open', box).onclick = () => api('hosted:openFolder', id, s.bedrockServer ? 'worlds' : '');
      const imp = async (pick) => {
        const [p] = await pick().catch(() => []); if (!p) return;
        try { const r = await api('hosted:importWorld', id, p); if (await confirmDialog(`Imported “${r.name}”. Play on it now? (The current world stays — you can switch back any time.)`, { ok: 'Use this world' })) await api('hosted:setWorld', id, r.name); this.tabs.worlds.call(this, box, id, s); } catch (e) { toastErr(e); }
      };
      $('#w-imp-dir', box).onclick = () => imp(() => api('dialog:open', { title: 'Pick a world folder (it has level.dat inside)', properties: ['openDirectory'] }));
      $('#w-imp-zip', box).onclick = () => imp(() => api('dialog:open', { title: 'Pick a world file', properties: ['openFile'], filters: [{ name: 'World', extensions: s.bedrockServer ? ['zip', 'mcworld'] : ['zip'] }] }));
      $$('[data-w-use]', box).forEach((b) => (b.onclick = async () => { await api('hosted:setWorld', id, b.dataset.wUse).catch(toastErr); this.tabs.worlds.call(this, box, id, s); }));
      $$('[data-w-del]', box).forEach((b) => (b.onclick = async () => { if (await confirmDialog(`Delete the world “${b.dataset.wDel}” forever?`, { danger: true, ok: 'Delete forever' })) { await api('hosted:deleteWorld', id, b.dataset.wDel).catch(toastErr); this.tabs.worlds.call(this, box, id, s); } }));
    },

    async backups(box, id, s) {
      const [list, set] = await Promise.all([api('hosted:backups', id), api('hosted:settings', id)]);
      const sc = set.schedule || {};
      const cd = (t) => { const ms = Math.max(0, t - Date.now()); const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), x = Math.floor((ms % 60000) / 1000); return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; };
      box.innerHTML = `<div class="card"><div class="row" style="margin-bottom:10px"><h3 class="grow" style="margin:0">${icon('download')} Backups</h3><button class="btn sm" id="b-open">${icon('folder')}Folder</button><button class="btn sm primary" id="b-new">${icon('plus')}Back up now</button></div>
        ${list.length ? list.map((b) => `<div class="row hs-person">${icon('file')}<span class="grow mono small">${esc(b.file)}</span><span class="faint small">${fmtBytes(b.size)} · ${timeAgo(b.time)}</span><button class="btn sm" data-restore="${esc(b.file)}" ${s.state !== 'offline' ? 'disabled title="Stop the server first"' : ''}>Restore</button><button class="icon-btn" data-bdel="${esc(b.file)}">${icon('trash')}</button></div>`).join('') : '<div class="faint small">No backups yet.</div>'}
        <p class="faint small">Backups include your worlds, server.properties, whitelist and operators. You can back up while the server runs; restoring needs it stopped. Automatic backups start with “auto-”.</p></div>
        <div class="card stack" style="margin-top:12px"><h3 style="margin:0">${icon('clock')} Auto-Backup Settings</h3><div class="faint small">Automatically create backups on a schedule</div>
          <div class="row"><label class="field grow">Back up every<select id="ab-h">${[[0, 'Off'], [1, '1 hour'], [2, '2 hours'], [3, '3 hours'], [6, '6 hours'], [12, '12 hours'], [24, 'Day']].map(([v, n]) => `<option value="${v}" ${(sc.backupHours || 0) === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            <label class="field" style="width:130px">Keep newest<input type="number" id="ab-keep" min="1" max="100" value="${sc.keepBackups || 10}"></label><button class="btn sm primary" id="ab-save" style="align-self:flex-end">${icon('check')}Save</button></div>
          <div class="small" id="ab-next">${!sc.backupHours ? '<span class="faint">Auto backups are off.</span>' : s.nextBackupAt ? `Next backup: <b class="mono" id="ab-cd">${cd(s.nextBackupAt)}</b> <span class="faint">· scheduled for ${new Date(s.nextBackupAt).toLocaleString()}</span>` : '<span class="warn-text">Auto backups are paused while the server is offline.</span>'}</div>
          <div class="faint small">Auto backups save your server automatically at set intervals while the server is online. Only the oldest automatic backups are deleted when the limit is reached. Manual backups are never deleted automatically.</div></div>`;
      $('#ab-save', box).onclick = async () => { try { await api('hosted:setSchedule', id, { ...sc, backupHours: +$('#ab-h', box).value, keepBackups: +$('#ab-keep', box).value }); toast('Auto-backup saved'); s = await api('hosted:get', id); this.tabs.backups.call(this, box, id, s); } catch (e) { toastErr(e); } };
      if (s.nextBackupAt) { const tick = setInterval(() => { const c = $('#ab-cd', box); if (!c) return clearInterval(tick); c.textContent = cd(s.nextBackupAt); }, 1000); }
      $('#b-open', box).onclick = () => api('hosted:openFolder', id, 'backups');
      $('#b-new', box).onclick = (e) => installFeedback(e.currentTarget, async () => { try { await api('hosted:backup', id); toast('Backup saved'); setTimeout(() => this.tabs.backups.call(this, box, id, s), 900); return { id, name: s.name }; } catch (er) { toastErr(er); return false; } });
      $$('[data-restore]', box).forEach((b) => (b.onclick = async () => { if (await confirmDialog(`Restore ${b.dataset.restore}? The current worlds are replaced by the backup.`, { danger: true, ok: 'Restore' })) { try { await api('hosted:restore', id, b.dataset.restore); toast('Backup restored'); } catch (e) { toastErr(e); } } }));
      $$('[data-bdel]', box).forEach((b) => (b.onclick = async () => { if (await confirmDialog(`Delete backup ${b.dataset.bdel}?`, { danger: true, ok: 'Delete' })) { await api('hosted:deleteBackup', id, b.dataset.bdel); this.tabs.backups.call(this, box, id, s); } }));
    },

    async content(box, id, s) {
      const what = s.contentKind === 'plugins' ? 'plugins' : 'mods';
      const sub = what === 'mods' ? this.contentSub || 'server' : 'server';
      const subBar = what === 'mods' ? `<div class="hs-filter" style="margin-bottom:10px"><button data-sub="server" class="${sub === 'server' ? 'on' : ''}">Server mods</button><button data-sub="client" class="${sub === 'client' ? 'on' : ''}">Client mods</button></div>` : '';
      const bindSub = () => $$('[data-sub]', box).forEach((b) => (b.onclick = () => { this.contentSub = b.dataset.sub; this.tabs.content.call(this, box, id, s); }));
      if (sub === 'client') { box.innerHTML = subBar + '<div id="cm-root"><div class="faint">Checking the server’s mods…</div></div>'; bindSub(); return this.clientModsPanel($('#cm-root', box), id, s); }
      box.innerHTML = subBar + `<div class="hs-cols two" id="ct-root">
        <div class="card"><h3 class="row" style="gap:8px;flex-wrap:wrap">${icon('search')}<span class="grow">Find ${what} <span class="faint small">for ${esc(s.softwareName)} ${esc(s.mc)}</span></span><span class="seg" id="ct-src"><button data-src="modrinth">Modrinth</button><button data-src="curseforge">CurseForge</button></span></h3><div class="search" style="margin-bottom:10px">${icon('search')}<input type="search" id="ct-q" placeholder="Search ${what}…"></div><div id="ct-res" class="stack" style="gap:6px"></div></div>
        <div class="card"><h3 class="row" style="gap:8px">${icon('package')}<span class="grow">Installed <span class="faint small" id="ct-n"></span></span><button class="icon-btn" id="ct-open" title="Open the ${what} folder">${icon('folder')}</button></h3>
          <div class="row wrap" style="gap:6px;margin-bottom:10px">${what === 'mods' ? `<button class="btn sm primary" id="ct-from">${icon('library')}Copy from an instance</button>` : ''}<button class="btn sm" id="ct-files">${icon('upload')}Add files from PC</button></div>
          <div id="ct-inst" class="stack" style="gap:4px"></div><p class="faint small">You can also drag .jar files here. Changes apply after a restart.</p></div></div>`;
      const report = (r) => {
        if (r.added.length) toast(`Added ${r.added.length > 3 ? `${r.added.length} ${what}` : r.added.join(', ')} — restart the server to use ${r.added.length > 1 ? 'them' : 'it'}`);
        if (r.warnings?.length) toast(`${r.warnings.map((w) => `${w.name} is made for Minecraft ${w.made}`).join('; ')} — this server is ${s.mc}, so it may not start. Remove ${r.warnings.length > 1 ? 'them' : 'it'} if it crashes.`, 'warn', 12000);
        if (r.skipped.length) toast(`Skipped ${r.skipped.map((x) => `${x.name} (${x.why})`).join('; ')}`, 'warn', 10000);
        if (!r.added.length && !r.skipped.length) toast(`Nothing to add — pick .jar ${what}.`, 'info');
        drawInst(r.items);
      };
      const addFiles = (files) => api('hosted:addFiles', id, files).then(report).catch(toastErr);
      $('#ct-files', box).onclick = async () => { const f = await api('dialog:open', { title: `Add ${what} to ${s.name}`, properties: ['openFile', 'multiSelections'], filters: [{ name: what === 'mods' ? 'Mods' : 'Plugins', extensions: ['jar'] }] }).catch(() => []); if (f?.length) addFiles(f); };
      $('#ct-open', box).onclick = () => api('hosted:openFolder', id, what);
      if ($('#ct-from', box)) $('#ct-from', box).onclick = () => this.copyMods(id, s, report);
      const root = $('#ct-root', box);
      root.ondragover = (e) => { if (!e.dataTransfer?.types.includes('Files')) return; e.preventDefault(); e.stopPropagation(); showDrop(`Drop to add to ${s.name}`); };
      root.ondrop = (e) => { e.preventDefault(); e.stopPropagation(); hideDrop(); const files = [...e.dataTransfer.files].map((f) => window.solaris.pathForFile(f)).filter(Boolean); if (files.length) addFiles(files); };
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
          const src = this.contentSrc || 'modrinth';
          const r = await api('hosted:search', id, $('#ct-q', box).value, 0, src);
          res.innerHTML = r.hits.map((h) => `<div class="list-row hs-res" data-pid="${esc(h.id)}"><img src="${esc(h.icon || '')}" alt=""><div class="info"><div class="title">${esc(h.title)}</div><div class="desc">${esc(h.description)}</div></div><button class="btn sm primary" data-inst="${esc(h.id)}">${icon('download')}Install</button></div>`).join('') || '<div class="faint small">Nothing found for this version.</div>';
          $$('[data-inst]', res).forEach((b) => { if (r.hits.find((h) => h.id === b.dataset.inst)?.installed) installFeedback.mark(b); b.onclick = () => installFeedback(b, async () => { try { const names = await api('hosted:install', id, b.dataset.inst); toast(`Installed ${names.join(', ')}`); drawInst(); return { id, name: s.name }; } catch (e) { toastErr(e); return false; } }); });
        } catch (e) { res.innerHTML = `<div class="faint small">${esc(e.message)}</div>`; }
      }, 300);
      $('#ct-q', box).oninput = search;
      const drawSrc = () => $$('#ct-src [data-src]', box).forEach((b) => b.classList.toggle('on', b.dataset.src === (this.contentSrc || 'modrinth')));
      $$('#ct-src [data-src]', box).forEach((b) => (b.onclick = () => { this.contentSrc = b.dataset.src; try { localStorage.setItem('host.contentSrc', b.dataset.src); } catch {} drawSrc(); search(); }));
      if (!this.contentSrc) { try { this.contentSrc = localStorage.getItem('host.contentSrc') || 'modrinth'; } catch { this.contentSrc = 'modrinth'; } }
      drawSrc();
      bindSub();
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
        try { hostSaved(id, await api('hosted:setSettings', id, { props })); } catch (e) { toastErr(e); }
      };
    },

    async logs(box, id) {
      const files = await api('hosted:logFiles', id);
      box.innerHTML = `<div class="hs-cols logs"><div class="card stack" style="gap:2px">${files.map((f, i) => `<button class="hs-logf ${i === 0 ? 'on' : ''}" data-lf="${esc(f.file)}"><span class="mono small">${esc(f.file)}</span><span class="faint small">${timeAgo(f.time)}</span></button>`).join('') || '<div class="faint small">No log files yet.</div>'}</div><pre class="console hs-logview" id="lv"></pre></div>`;
      const show = async (f) => { $$('[data-lf]', box).forEach((b) => b.classList.toggle('on', b.dataset.lf === f)); const t = await api('hosted:readLog', id, f).catch((e) => e.message); const v = $('#lv', box); v.textContent = t; v.scrollTop = v.scrollHeight; };
      $$('[data-lf]', box).forEach((b) => (b.onclick = () => show(b.dataset.lf)));
      if (files[0]) show(files[0].file);
    },

    /** Performance: CPU, RAM, uptime, players and a graph of the last 30 minutes. */
    async performance(box, id, s, ctx) {
      let p = await api('hosted:perf', id);
      box.innerHTML = `<div class="stack"><div class="card"><h3 style="margin:0 0 4px">${icon('chart')} Server Performance</h3><div class="faint small">Real-time performance monitoring</div></div>
        <div class="hs-tiles" id="pf-tiles"></div>
        <div class="card"><div class="row" style="margin-bottom:8px"><h3 class="grow" style="margin:0">Performance Graph</h3><div class="hs-legend"><span><i style="background:var(--accent)"></i>CPU %</span><span><i style="background:#60a5fa"></i>RAM % of ${p.bedrockServer ? 'PC' : 'allocated'}</span><span><i style="background:#4ade80"></i>Players</span></div></div><div id="pf-graph"></div></div></div>`;
      const draw = () => {
        if (!$('#pf-tiles', box)) return; // another tab is open now
        const tile = (label, v, sub = '') => `<div class="hs-tile"><div class="faint small">${label}</div><div class="v">${v}</div>${sub ? `<div class="faint small">${sub}</div>` : ''}</div>`;
        const ramMax = p.bedrockServer ? p.totalMemMb : p.memory;
        $('#pf-tiles', box).innerHTML = tile('CPU Usage', p.cpu != null ? `${p.cpu.toFixed(1)}%` : '0.0%', `${p.cores} cores`) + tile('RAM Usage', `${p.ramMb} MB`, `of ${(ramMax / 1024).toFixed(1)} GB`)
          + tile('Server Uptime', p.state === 'offline' ? '0s' : fmtUp(p.uptime), p.state === 'offline' ? '<span class="chip">Offline</span>' : `<span class="chip ok">${esc(p.state)}</span>`) + tile('Players', `${p.players}/${p.maxPlayers}`);
        const g = $('#pf-graph', box);
        if (!p.history.length) { g.innerHTML = `<div class="faint small" style="padding:40px 0;text-align:center">${p.state === 'offline' ? 'Start the server to see the graph.' : 'Collecting the first numbers…'}</div>`; return; }
        const W = 800, H = 200, pad = 26, h = p.history, t0 = h[0].t, t1 = Math.max(h[h.length - 1].t, t0 + 60000);
        const x = (t) => pad + ((t - t0) / (t1 - t0)) * (W - pad - 6), y = (v) => H - 18 - (Math.max(0, Math.min(100, v)) / 100) * (H - 30);
        const line = (f, color) => `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" points="${h.filter((q) => f(q) != null).map((q) => `${x(q.t).toFixed(1)},${y(f(q)).toFixed(1)}`).join(' ')}"/>`;
        const maxPl = Math.max(1, p.maxPlayers);
        g.innerHTML = `<svg class="hs-graph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${[0, 25, 50, 75, 100].map((v) => `<line class="grid" x1="${pad}" x2="${W - 6}" y1="${y(v)}" y2="${y(v)}"/><text x="2" y="${y(v) + 3}">${v}%</text>`).join('')}
          ${line((q) => q.cpu, 'var(--accent)')}${line((q) => (q.ram / ramMax) * 100, '#60a5fa')}${line((q) => (q.players / maxPl) * 100, '#4ade80')}
          <text x="${pad}" y="${H - 3}">${new Date(t0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</text><text x="${W - 50}" y="${H - 3}">${new Date(t1).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</text></svg>`;
      };
      draw();
      ctx.on('hosted-stats', async (st) => { if (st.id !== id || !box.isConnected) return; try { p = await api('hosted:perf', id); draw(); } catch {} });
      ctx.on('hosted', async (st) => { if (st?.id !== id || !box.isConnected) return; try { p = await api('hosted:perf', id); draw(); } catch {} });
    },

    /** Task Scheduler: the player's own timed commands, messages, restarts and backups. */
    async scheduler(box, id, s) {
      const list = await api('hosted:tasks', id);
      const ACT = { command: 'Run command', say: 'Send message', restart: 'Restart server', backup: 'Back up', stop: 'Stop server', start: 'Start server' };
      const when = (t) => (t.when.type === 'every' ? `Every ${t.when.minutes % 1440 === 0 ? `${t.when.minutes / 1440} day${t.when.minutes === 1440 ? '' : 's'}` : t.when.minutes % 60 === 0 ? `${t.when.minutes / 60} hour${t.when.minutes === 60 ? '' : 's'}` : `${t.when.minutes} min`}` : t.when.type === 'daily' ? `Daily at ${t.when.time}` : 'When the server starts');
      const set = await api('hosted:settings', id), sc = set.schedule || {};
      box.innerHTML = `<div class="card stack" style="margin-bottom:12px"><div class="row"><div class="grow"><h3 style="margin:0">${icon('refresh')} Automatic restart</h3><div class="faint small">Restarting now and then keeps a busy server fast. Players get a 1-minute warning.</div></div>
          <select id="tk-rs">${[[0, 'Off'], [6, 'Every 6 hours'], [12, 'Every 12 hours'], [24, 'Every day']].map(([v, n]) => `<option value="${v}" ${(sc.restartHours || 0) === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
        <div class="card"><div class="row" style="margin-bottom:6px"><div class="grow"><h3 style="margin:0">${icon('clock')} Task Scheduler</h3><div class="faint small">Schedule commands to run automatically on your server</div></div><button class="btn sm primary" id="tk-new">${icon('plus')}New task</button></div>
        ${list.length ? `<table class="hs-ptable"><tr><th>Task</th><th>Does</th><th>When</th><th>Last run</th><th>On</th><th></th></tr>${list.map((t) => `<tr><td><b>${esc(t.name || ACT[t.action])}</b></td><td class="small">${esc(ACT[t.action])}${t.command ? ` <span class="mono faint">${esc(t.command.split('\n')[0].slice(0, 40))}${t.command.includes('\n') ? ' …' : ''}</span>` : ''}</td><td class="small">${esc(when(t))}</td><td class="small faint">${t.last ? timeAgo(t.last) : '—'}</td>
          <td><label class="switch"><input type="checkbox" data-tk-on="${esc(t.id)}" ${t.enabled ? 'checked' : ''}><span></span></label></td>
          <td style="white-space:nowrap"><button class="icon-btn" data-tk-run="${esc(t.id)}" title="Run now">${icon('play')}</button><button class="icon-btn" data-tk-edit="${esc(t.id)}" title="Edit">${icon('edit')}</button><button class="icon-btn" data-tk-del="${esc(t.id)}" title="Delete">${icon('trash')}</button></td></tr>`).join('')}</table>`
          : `<div class="empty small">${icon('clock')}<div><b>No scheduled tasks</b><br>Create a task to automate server commands and startup</div></div>`}
        <p class="faint small">Tasks run while Astra is open. “Start server” tasks run while the server is off; everything else while it’s online. Restart and stop warn players a minute before.</p></div>`;
      const redo = () => this.tabs.scheduler.call(this, box, id, s);
      $('#tk-rs', box).onchange = async (e) => { try { await api('hosted:setSchedule', id, { ...sc, restartHours: +e.target.value }); toast(+e.target.value ? 'Automatic restart on' : 'Automatic restart off'); } catch (er) { toastErr(er); } };
      const edit = (t = null) => {
        const m = modal({
          title: t ? 'Edit task' : 'New task',
          body: `<div class="stack">
            <label class="field">Name <span class="faint small">(optional)</span><input type="text" id="tk-name" maxlength="60" value="${esc(t?.name || '')}" placeholder="e.g. Morning message"></label>
            <label class="field">What it does<select id="tk-act">${Object.entries(ACT).map(([k, n]) => `<option value="${k}" ${t?.action === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            <label class="field" id="tk-cmd-wrap"><span id="tk-cmd-label">Command</span><textarea id="tk-cmd" class="mono" rows="3" placeholder="time set day&#10;weather clear">${esc(t?.command || '')}</textarea><span class="faint small" id="tk-cmd-hint">One command per line, without the /.</span></label>
            <div class="row"><label class="field grow">When<select id="tk-when"><option value="every">Every…</option><option value="daily">Every day at…</option><option value="start">When the server starts</option></select></label>
              <label class="field" id="tk-min-wrap" style="width:150px">Minutes<input type="number" id="tk-min" min="1" max="10080" value="${t?.when.minutes || 60}"></label>
              <label class="field" id="tk-time-wrap" style="width:150px">Time<input type="time" id="tk-time" value="${t?.when.time || '04:00'}"></label></div></div>`,
          footer: `<button class="btn ghost" data-x>${T('Cancel')}</button><button class="btn primary" data-go>${icon('check')}Save task</button>`,
        });
        if (t) m.$('#tk-when').value = t.when.type;
        const sync = () => {
          const a = m.$('#tk-act').value, w = m.$('#tk-when').value;
          m.$('#tk-cmd-wrap').classList.toggle('hidden', a !== 'command' && a !== 'say');
          m.$('#tk-cmd-label').textContent = a === 'say' ? 'Message' : 'Command'; m.$('#tk-cmd-hint').classList.toggle('hidden', a === 'say');
          m.$('#tk-min-wrap').classList.toggle('hidden', w !== 'every'); m.$('#tk-time-wrap').classList.toggle('hidden', w !== 'daily');
          m.$('#tk-when').querySelector('[value=start]').disabled = a === 'start';
        };
        m.$('#tk-act').onchange = sync; m.$('#tk-when').onchange = sync; sync();
        m.$('[data-x]').onclick = () => m.close();
        m.$('[data-go]').onclick = async () => {
          try {
            await api('hosted:saveTask', id, { id: t?.id, name: m.$('#tk-name').value, action: m.$('#tk-act').value, command: m.$('#tk-cmd').value, enabled: t ? t.enabled : true, when: { type: m.$('#tk-when').value, minutes: +m.$('#tk-min').value, time: m.$('#tk-time').value } });
            m.close(); toast('Task saved'); redo();
          } catch (e) { toastErr(e); }
        };
      };
      $('#tk-new', box).onclick = () => edit();
      $$('[data-tk-edit]', box).forEach((b) => (b.onclick = () => edit(list.find((t) => t.id === b.dataset.tkEdit))));
      $$('[data-tk-del]', box).forEach((b) => (b.onclick = async () => { if (await confirmDialog('Delete this task?', { danger: true, ok: 'Delete' })) { await api('hosted:deleteTask', id, b.dataset.tkDel).catch(toastErr); redo(); } }));
      $$('[data-tk-on]', box).forEach((c) => (c.onchange = async () => { const t = list.find((x) => x.id === c.dataset.tkOn); try { await api('hosted:saveTask', id, { ...t, enabled: c.checked }); } catch (e) { toastErr(e); } }));
      $$('[data-tk-run]', box).forEach((b) => (b.onclick = async () => { b.disabled = true; try { await api('hosted:runTask', id, b.dataset.tkRun); toast('Task ran'); redo(); } catch (e) { toastErr(e); b.disabled = false; } }));
    },

    /** Tunnels on the playit.gg account: what each one is, its address, which server uses it; on/off and delete. */
    async tunnels(box, id, s) {
      let d; try { d = await api('playit:tunnels'); } catch (e) { d = { linked: true, tunnels: [], error: e.message }; }
      if (!d.linked) {
        box.innerHTML = `<div class="card"><h3 style="margin:0">${icon('globe')} Tunnel Management</h3><p class="faint">Connect playit.gg on the Hosting page first — then Astra makes and shows the tunnels here.</p><button class="btn primary" id="tn-go">${icon('link')}Connect playit.gg</button></div>`;
        $('#tn-go', box).onclick = async () => { try { await api('playit:connect'); toast('Approve Astra in the browser tab that opened'); } catch (e) { toastErr(e); } };
        return;
      }
      const servers = await api('hosted:list').catch(() => []);
      const usedBy = (t) => {
        for (const v of servers) {
          if (t.id === v.playitTunnelId || (!t.udp && t.localPort === v.port && v.software !== 'bedrock')) return `${v.name}`;
          if (v.software === 'bedrock' && (t.id === v.playitTunnelId || t.localPort === v.port)) return `${v.name}`;
          if (v.voice && (t.id === v.voice.tunnelId || (t.udp && t.localPort === v.voice.port))) return `${v.name} · voice chat`;
          if (v.bedrock && (t.id === v.bedrock.tunnelId || (t.udp && t.localPort === v.bedrock.port))) return `${v.name} · Bedrock`;
          if (v.pack && t.id === v.pack.tunnelId) return `${v.name} · resource pack`;
        }
        return null;
      };
      const tcp = d.tunnels.filter((t) => !t.udp).length, udp = d.tunnels.length - tcp;
      box.innerHTML = `<div class="card"><div class="row" style="margin-bottom:6px"><div class="grow"><h3 style="margin:0">${icon('globe')} Tunnel Management</h3><div class="faint small">Create and manage tunnels for server access</div></div>
          <span class="chip">Java: ${tcp}</span><span class="chip">UDP: ${udp}</span><button class="btn sm" id="tn-add">${icon('plus')}Add on playit.gg</button><button class="btn sm" id="tn-refresh">${icon('refresh')}</button></div>
        ${d.error ? `<p class="danger-text small">${esc(d.error)}</p>` : ''}
        ${d.tunnels.length ? `<table class="hs-ptable"><tr><th>Type</th><th>Public address</th><th>Local port</th><th>Used by</th><th>Enable</th><th></th></tr>${d.tunnels.map((t) => { const u = usedBy(t); return `<tr><td>${esc(t.typeName)}${t.name ? `<div class="faint small">${esc(t.name)}</div>` : ''}</td><td class="mono small">${t.address ? `${esc(t.address)} <button class="icon-btn" data-tn-copy="${esc(t.address)}" title="Copy">${icon('copy')}</button>` : '<span class="faint">waiting…</span>'}${t.disabledReason ? `<div class="danger-text small">${esc(t.disabledReason)}</div>` : ''}</td><td class="mono">${t.localPort ?? '—'}</td><td class="small">${u ? esc(u) : '<span class="faint">not used by a Astra server</span>'}</td>
          <td><label class="switch"><input type="checkbox" data-tn-on="${esc(t.id)}" ${t.enabled ? 'checked' : ''}><span></span></label></td><td><button class="icon-btn" data-tn-del="${esc(t.id)}" data-used="${esc(u || '')}" title="Delete tunnel">${icon('trash')}</button></td></tr>`; }).join('')}</table>`
          : '<div class="faint small">No tunnels yet — Astra makes them when a server that uses playit.gg starts.</div>'}
        <p class="faint small">Free playit.gg accounts can only have a few tunnels. Deleting a server in Astra deletes its tunnels too. A tunnel that’s off isn’t reachable until you turn it on again.</p></div>`;
      const redo = () => this.tabs.tunnels.call(this, box, id, s);
      $('#tn-refresh', box).onclick = redo;
      $('#tn-add', box).onclick = () => api('shell:open', 'https://playit.gg/account/tunnels');
      $$('[data-tn-copy]', box).forEach((b) => (b.onclick = () => { api('clipboard:write', b.dataset.tnCopy); toast('Address copied'); }));
      $$('[data-tn-on]', box).forEach((c) => (c.onchange = async () => { c.disabled = true; try { await api('playit:enableTunnel', c.dataset.tnOn, c.checked); toast(c.checked ? 'Tunnel on' : 'Tunnel off'); } catch (e) { toastErr(e); c.checked = !c.checked; } c.disabled = false; }));
      $$('[data-tn-del]', box).forEach((b) => (b.onclick = async () => {
        const used = b.dataset.used;
        if (!(await confirmDialog(used ? `Delete this tunnel? ${used} uses it — Astra makes a new one (with a NEW address) the next time that server starts.` : 'Delete this tunnel from your playit.gg account?', { danger: true, ok: 'Delete tunnel' }))) return;
        try { await api('playit:removeTunnel', b.dataset.tnDel); toast('Tunnel deleted'); redo(); } catch (e) { toastErr(e); }
      }));
    },
    async settings(box, id, s) {
      const set = await api('hosted:settings', id);
      const bds = set.bedrockServer, P = set.props;
      // [property, label, kind, info]; kind: bool | number | select:a,b,c
      const SECTIONS = bds ? {
        gameplay: [['gamemode', 'Game mode', 'select:survival,creative,adventure', ''], ['difficulty', 'Difficulty', 'select:peaceful,easy,normal,hard', ''], ['allow-cheats', 'Cheats (commands)', 'bool', 'Lets operators use commands like /give and /gamemode'], ['force-gamemode', 'Force game mode', 'bool', 'Players always join in the server’s game mode'], ['texturepack-required', 'Require the world’s packs', 'bool', 'Players must download the world’s resource/behaviour packs']],
        performance: [['max-players', 'Max players', 'number', ''], ['view-distance', 'View distance', 'number', 'Chunks players see (lower = less lag)'], ['tick-distance', 'Simulation distance', 'number', 'Chunks where mobs and crops move (4–12)'], ['max-threads', 'Max CPU threads', 'number', '0 = as many as it wants']],
        security: [['allow-list', 'Allow list (whitelist)', 'bool', 'Only players on the list can join'], ['online-mode', 'Require Xbox sign-in', 'bool', 'Players must be signed in to Xbox'], ['player-idle-timeout', 'Kick idle players after (min)', 'number', '0 = never'], ['default-player-permission-level', 'New players are', 'select:visitor,member,operator', '']],
      } : {
        gameplay: [['gamemode', 'Game mode', 'select:survival,creative,adventure,spectator', ''], ['difficulty', 'Difficulty', 'select:peaceful,easy,normal,hard', ''], ['pvp', 'PvP', 'bool', 'Players can hurt each other'], ['hardcore', 'Hardcore', 'bool', 'One life — players become spectators when they die'],
          ['allow-flight', 'Allow flight', 'bool', 'Some mods need it; otherwise players are kicked for flying'], ['allow-nether', 'Nether', 'bool', 'Players can go to the Nether'], ['spawn-monsters', 'Monsters', 'bool', 'Hostile mobs spawn'], ['spawn-animals', 'Animals', 'bool', 'Animals spawn'],
          ['generate-structures', 'Structures', 'bool', 'Villages, temples… in new land'], ['enable-command-block', 'Command blocks', 'bool', ''], ['force-gamemode', 'Force game mode', 'bool', 'Players always join in the server’s game mode'], ['spawn-protection', 'Spawn protection', 'number', 'Blocks around spawn only operators can change (0 = off)']],
        performance: [['max-players', 'Max players', 'number', ''], ['view-distance', 'View distance', 'number', 'Chunks players see (lower = less lag)'], ['simulation-distance', 'Simulation distance', 'number', 'Chunks where mobs and crops move (lower = less lag)'], ['entity-broadcast-range-percentage', 'Entity range %', 'number', 'How far away players see mobs (lower = less lag)'], ['sync-chunk-writes', 'Safe chunk saving', 'bool', 'Safer saves, a little slower']],
        security: [['white-list', 'Whitelist', 'bool', 'Only added players can join'], ['online-mode', 'Require Microsoft accounts', 'bool', 'Off lets offline (cracked) accounts join — anyone could use any name, so turn the whitelist on too. Everyone keeps their progress; Astra moves it over.'], ['enforce-secure-profile', 'Secure chat profiles', 'bool', 'Off lets players with chat reporting turned off join'],
          ['hide-online-players', 'Hide who is online', 'bool', 'The server list doesn’t show player names'], ['prevent-proxy-connections', 'Block VPN/proxy logins', 'bool', ''], ['player-idle-timeout', 'Kick idle players after (min)', 'number', '0 = never']],
      };
      const field = ([k, label, kind, info]) => {
        const v = P[k] ?? '';
        const ctl = kind === 'bool' ? `<label class="switch"><input type="checkbox" data-p="${k}" ${v === 'true' ? 'checked' : ''}><span></span></label><span class="faint small" style="width:60px">${v === 'true' ? 'Enabled' : 'Disabled'}</span>`
          : kind === 'number' ? `<input type="number" data-p="${k}" value="${esc(v)}">`
          : `<select data-p="${k}">${kind.slice(7).split(',').map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
        return `<div class="hs-set"><span class="grow">${label}${info ? ` <span class="info" title="${esc(info)}">${icon('info')}</span>` : ''}</span>${ctl}</div>`;
      };
      const known = Object.keys(P).length > 3; // the server has written its full server.properties (it started once)
      const has = ([k]) => !known || k in P || ['gamemode', 'difficulty', 'max-players'].includes(k);
      const section = (key, ic, title, sub, extra = '') => `<div class="card stack" data-sec="${key}"><div class="row"><div class="grow"><h3 style="margin:0">${icon(ic)} ${title}</h3><div class="faint small">${sub}</div></div><button class="btn sm primary" data-save="${key}">${icon('check')}Save</button></div><div class="hs-set-grid">${SECTIONS[key].filter(has).map(field).join('')}</div>${extra}</div>`;
      const maxMem = Math.max(2048, Math.floor((set.totalMemMb * 0.75) / 512) * 512);
      const memCard = bds ? '' : `<div class="field" style="margin-top:6px">Memory (RAM) <b id="st-memv"></b><input type="range" id="st-mem" min="1024" max="${maxMem}" step="512" value="${Math.min(maxMem, set.memory)}"><div class="row small faint"><span>1 GB</span><span class="grow"></span><span>Available: ${(set.totalMemMb / 1024).toFixed(0)} GB</span></div><div class="small" id="st-memhint"></div></div>`;
      const java = bds ? '' : `<div class="card stack"><h3 style="margin:0">${icon('console')} Startup &amp; JVM</h3><div class="faint small">Control startup behavior and advanced JVM options</div>
          <div class="field">Java<div class="row" style="gap:8px"><span class="mono small grow ellipsis" id="st-java">${set.javaPath ? esc(set.javaPath) : 'Automatic — Astra picks and installs the right Java for this version'}</span><button class="btn sm" id="st-java-pick">${icon('folder')}Choose…</button>${set.javaPath ? `<button class="btn sm ghost" id="st-java-auto">Automatic</button>` : ''}</div></div>
          <div class="hs-set"><span class="grow">Optimized flags (Aikar’s) <span class="info" title="The garbage-collector settings most Minecraft hosts use: fewer lag spikes on busy servers">${icon('info')}</span></span><label class="switch"><input type="checkbox" id="st-aikar" ${set.aikar ? 'checked' : ''}><span></span></label></div>
          <div class="hs-set"><span class="grow">Restart after a crash <span class="info" title="Starts the server again 10 seconds after it crashes (at most 3 times in 10 minutes)">${icon('info')}</span></span><label class="switch"><input type="checkbox" id="st-crash" ${set.restartOnCrash ? 'checked' : ''}><span></span></label></div>
          <div class="hs-set"><span class="grow">Start automatically <span class="info" title="Starts when Astra opens — and Astra opens in the tray when Windows starts">${icon('info')}</span></span><label class="switch"><input type="checkbox" id="st-auto" ${set.autoStart ? 'checked' : ''}><span></span></label></div>
          <label class="field">Extra JVM arguments<input type="text" id="st-jvm" class="mono" value="${esc(set.jvmArgs)}" placeholder="e.g. -XX:+UseG1GC -Xss1M" spellcheck="false"><span class="faint small">Memory is set with the slider above, so -Xmx/-Xms are left out.</span></label>
          <div class="row"><div class="grow faint small">Applies on next start.</div><button class="btn sm primary" id="st-jvm-save">${icon('check')}Save</button></div></div>`;
      const pack = bds ? '' : `<div class="card stack"><h3 style="margin:0">${icon('package')} Resource pack</h3>
          ${set.pack ? `<div class="row" style="gap:8px">${icon('file')}<b class="grow ellipsis">${esc(set.pack.name)}</b><span class="faint small">${fmtBytes(set.pack.size || 0)}</span><button class="btn sm ghost danger" id="rp-rm">${icon('trash')}Remove</button></div>
            <div class="small">${set.pack.url ? `Players download it from <span class="mono">${esc(set.pack.url)}</span>` : '<span class="faint">The download link is made when the server starts (playit.gg tunnel).</span>'}</div>
            ${set.pack.type === 'file' && set.tunnel === 'e4mc' ? '<div class="small warn-text">e4mc can’t share files — friends outside your network won’t get the pack. Use playit.gg, or paste a download link instead.</div>' : ''}`
            : '<div class="faint small">No pack configured. Upload a .zip (max 250 MB) — Astra shares it with players — or paste a direct download link.</div>'}
          <div class="row" style="gap:8px"><button class="btn sm" id="rp-file">${icon('upload')}Upload Resource Pack</button><input type="text" id="rp-url" class="grow mono" placeholder="…or a direct link (https://…/pack.zip)" spellcheck="false"><button class="btn sm" id="rp-url-go">Use link</button></div>
          <div class="hs-set"><span class="grow">Players must accept it</span><label class="switch"><input type="checkbox" id="rp-req" ${set.pack?.required ? 'checked' : ''}><span></span></label></div>
          <label class="field">Message when it asks <span class="faint small">(optional)</span><input type="text" id="rp-prompt" maxlength="200" value="${esc(set.pack?.prompt || '')}"></label>
          ${set.pack ? `<div class="row"><div class="grow faint small">Applies on next start.</div><button class="btn sm primary" id="rp-save">${icon('check')}Save</button></div>` : ''}</div>`;
      box.innerHTML = `<div class="hs-cols two">
        <div class="stack">
          <div class="card stack"><div class="row"><div class="grow"><h3 style="margin:0">${icon('sliders')} General</h3><div class="faint small">Configure your Minecraft server properties</div></div><button class="btn sm primary" id="st-save">${icon('check')}Save</button></div>
            <label class="field">Name<input type="text" id="st-name" value="${esc(set.name)}" maxlength="40"></label>
            <label class="field">${bds ? 'Server name in the list' : 'Message of the day'}<input type="text" id="st-motd" value="${esc(bds ? P['server-name'] || '' : P.motd || '')}" maxlength="120"></label>
            <label class="field">Port<input type="number" id="st-port" min="1024" max="65535" value="${set.port}"></label></div>
          ${section('gameplay', 'sun', 'Gameplay', 'General gameplay settings')}
          ${section('performance', 'chart', 'Performance', 'Optimize your server’s performance', memCard)}
          ${section('security', 'shield', 'Security', 'Access control and security settings')}
          ${java}
          ${pack}
        </div>
        <div class="stack">
          <div class="card stack"><h3>${icon('globe')} Public address</h3>
            <div class="seg" id="st-tun"><button data-t="e4mc" ${HOST_E4MC.includes(set.software) ? '' : 'disabled'}>e4mc</button><button data-t="playit">playit.gg</button><button data-t="none">Home only</button></div>
            <div class="faint small">${HOST_E4MC.includes(set.software) ? 'e4mc: instant, no account. playit.gg: free account, stable address.' : 'e4mc needs Fabric/Quilt/Forge/NeoForge — use playit.gg for this server.'}</div>
            ${set.tunnel === 'playit' ? `<div class="row"><label class="field grow">Tunnel name on playit.gg<input type="text" id="st-tname" maxlength="40" value="${esc(set.tunnelName)}" placeholder="${esc(set.name)}"></label><button class="btn sm" id="st-tname-save" style="align-self:flex-end">Save</button></div>` : ''}</div>
          ${HOST_KIND[set.software] !== 'none' ? `<div class="card stack"><h3>${icon('mic')} Voice chat</h3>
            <label class="row small" style="gap:8px;align-items:flex-start"><label class="switch"><input type="checkbox" id="st-voice" ${set.voice?.on ? 'checked' : ''}><span></span></label><span><b>Simple Voice Chat</b><br><span class="faint">Installs the ${s.contentKind === 'plugins' ? 'plugin' : 'mod'}, makes a UDP tunnel on playit.gg and sets voice_host for you. Friends need the Simple Voice Chat mod in their game too.</span></span></label>
            ${set.voice?.on ? `<div class="small">UDP port <span class="mono">${set.voice.port}</span>${set.tunnel === 'playit' ? ` · voice_host <span class="mono">${esc(set.voice.manualAddress || set.voice.address || 'not set yet')}</span>` : ' · <span class="faint">only on your network (playit.gg needed for friends outside)</span>'}</div>${set.voice.error && !set.voice.manualAddress ? `<div class="small danger-text">${esc(set.voice.error)}</div><div class="row" style="gap:8px"><button class="btn sm primary" id="st-v-playit">${icon('external')}Open playit.gg tunnels</button><button class="btn sm" id="st-v-retry">${icon('refresh')}I made it — check again</button></div>` : ''}${set.tunnel === 'playit' ? `<div class="faint small">Made the voice tunnel yourself? Paste its address (with the port, as playit.gg shows it):</div><div class="row" style="gap:8px"><input type="text" id="st-v-addr" class="mono grow" placeholder="e.g. scooter-unanimous.tun.ply.gg:50761 — empty = automatic" value="${esc(set.voice.manualAddress || '')}" spellcheck="false"><button class="btn sm" id="st-v-save">${icon('check')}Save</button></div>` : ''}` : ''}</div>` : ''}
          ${HOST_BEDROCK.includes(set.software) ? `<div class="card stack"><h3>${icon('globe')} Bedrock players</h3>
            <label class="row small" style="gap:8px;align-items:flex-start"><label class="switch"><input type="checkbox" id="st-bedrock" ${set.bedrock?.on ? 'checked' : ''}><span></span></label><span><b>Let Bedrock Edition join</b><br><span class="faint">Phone, Xbox, PlayStation, Switch and Windows players join with Geyser + Floodgate (no Java account needed). Astra makes the playit.gg tunnel and sets Geyser up.</span></span></label>
            ${set.bedrock?.on ? `<div class="small">Port <span class="mono">${set.bedrock.port}</span>${set.tunnel === 'playit' ? ` · public <span class="mono">${esc(set.bedrock.address || 'set on next start')}</span>` : ' · <span class="faint">only on your network (playit.gg needed for friends outside)</span>'}</div>${set.bedrock.error ? `<div class="small danger-text">${esc(set.bedrock.error)}</div>` : ''}<div class="faint small">With the whitelist on, add Bedrock friends in the console with <span class="mono">fwhitelist add Name</span>.</div>` : ''}</div>` : ''}
          <div class="card stack"><h3>${icon('discord')} Discord alerts</h3>
            <div class="faint small">Post to a Discord channel when the server goes online or stops, crashes, or someone joins. In Discord: Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.</div>
            <input type="password" id="st-dc-url" class="mono" placeholder="https://discord.com/api/webhooks/…" value="${esc(set.discord?.url || '')}" spellcheck="false" autocomplete="off">
            <div class="hc-checks">${[['online', 'Online'], ['stop', 'Stopped'], ['crash', 'Crashed'], ['join', 'Player joined'], ['leave', 'Player left']].map(([k, n]) => `<label><input type="checkbox" data-dc="${k}" ${set.discord ? (set.discord.events?.[k] ? 'checked' : '') : k === 'join' || k === 'leave' ? '' : 'checked'}>${n}</label>`).join('')}</div>
            <div class="row" style="gap:8px"><div class="grow"></div><button class="btn sm" id="st-dc-test">${icon('discord')}Send test</button><button class="btn sm primary" id="st-dc-save">${icon('check')}Save</button></div></div>
          ${bds ? '' : `<div class="card stack"><h3>${icon('library')} Game instance for this server</h3>
            <div class="faint small">Makes an instance with Minecraft ${esc(set.mc)}${s.contentKind === 'mods' ? `, ${esc(s.softwareName)} and the server’s mods (server-only ones left out)` : ''}${set.voice?.on ? ', plus the voice chat mod' : ''}. <b>Join</b> then uses it straight away.</div>
            <div class="row" style="gap:8px">${set.playInstance && State.instances.some((i) => i.id === set.playInstance) ? `<span class="chip ok">${esc(State.instances.find((i) => i.id === set.playInstance).name)}</span>` : ''}<div class="grow"></div><button class="btn sm primary" id="st-inst">${icon('library')}${set.playInstance ? 'Make it again' : 'Make game instance'}</button></div></div>`}
          <div class="card stack"><h3>${icon('key')} Setup code</h3><div class="faint small">One code with this server’s whole setup (software, version, game settings, mods/plugins, voice chat, schedules). Paste it in <b>Hosting → Use setup code</b> to make the same server again, or send it to a friend. It doesn’t contain your world or any passwords.</div><div class="row"><button class="btn sm" id="st-code">${icon('copy')}Copy setup code</button></div></div>
          <div class="card stack"><h3>${icon('folder')} Files</h3><div class="mono small" style="word-break:break-all">${esc(set.dir)}</div><div class="row"><button class="btn sm" id="st-folder">${icon('folder')}Open folder</button></div></div>
          <div class="card stack"><h3>${icon('copy')} Copy Server</h3><div class="faint small">Create a filesystem copy of this server and add it to the server list. Server: <b>${esc(set.name)}</b></div><div class="row"><button class="btn sm" id="st-copy" ${s.state !== 'offline' ? 'disabled title="Stop the server first"' : ''}>${icon('copy')}Copy server</button></div></div>
          <div class="card stack"><h3>${icon('upload')} Move to another PC</h3><div class="faint small">Saves the whole server (world, settings, mods, players) as one .zip. On the other PC: <b>Hosting → Import server</b>. Let a friend host it while you’re away, then move it back.</div><div class="row"><button class="btn sm" id="st-export" ${s.state !== 'offline' ? 'disabled title="Stop the server first"' : ''}>${icon('upload')}Export server…</button></div></div>
          <div class="card stack"><h3>${icon('trash')} Delete Server</h3><div class="faint small">Permanently delete this server and all its files. Server: <b>${esc(set.name)}</b></div><div class="small warn-text">${icon('alert')} This action cannot be undone. All server files, configurations, worlds, backups and its playit.gg tunnels are permanently deleted.</div><div class="row"><button class="btn sm danger" id="st-del" ${s.state !== 'offline' ? 'disabled title="Stop the server first"' : ''}>${icon('trash')}Delete forever</button></div></div>
        </div></div>`;
      const again = () => this.tabs.settings.call(this, box, id, s);
      // property sections
      $$('[data-p]', box).forEach((i) => { if (i.type === 'checkbox') i.onchange = () => (i.parentElement.nextElementSibling.textContent = i.checked ? 'Enabled' : 'Disabled'); });
      $$('[data-save]', box).forEach((b) => (b.onclick = async () => {
        const props = {};
        $$('[data-p]', $(`[data-sec="${b.dataset.save}"]`, box)).forEach((i) => (props[i.dataset.p] = i.type === 'checkbox' ? String(i.checked) : i.value));
        if ('white-list' in props) props['enforce-whitelist'] = props['white-list'];
        const patch = { props };
        if (b.dataset.save === 'performance' && $('#st-mem', box)) patch.memory = +$('#st-mem', box).value;
        try { hostSaved(id, await api('hosted:setSettings', id, patch)); } catch (e) { toastErr(e); }
      }));
      const mem = $('#st-mem', box);
      if (mem) {
        const hint = () => {
          const v = +mem.value, kind = set.modded ? 'mods' : HOST_KIND[set.software];
          const [lo, hi, what] = { mods: [6144, 10240, 'a modded server'], plugins: [4096, 8192, 'a plugin server'], none: [2048, 4096, 'a vanilla server'] }[kind] || [4096, 8192, 'this server'];
          const lo2 = Math.min(lo, +mem.max), hi2 = Math.min(hi, +mem.max);
          $('#st-memv', box).textContent = `${v} MB`;
          $('#st-memhint', box).innerHTML = v < lo2 ? `<span class="warn-text">${icon('alert')} Below the ${lo2}–${hi2} MB that runs ${what} smoothly.</span>` : v > hi2 + 2048 ? `<span class="faint">More than ${what} needs.</span>` : `<span class="ok-text">${icon('check')} Optimal RAM Setting — you’re in the optimal range of ${lo2}–${hi2} MB for ${what}.</span>`;
        };
        mem.oninput = hint; hint();
      }
      $('#st-save', box).onclick = async () => {
        try {
          hostSaved(id, await api('hosted:setSettings', id, { name: $('#st-name', box).value.trim(), props: { [bds ? 'server-name' : 'motd']: $('#st-motd', box).value, 'server-port': $('#st-port', box).value } }));
        } catch (e) { toastErr(e); }
      };
      // startup & JVM
      if ($('#st-java-pick', box)) $('#st-java-pick', box).onclick = async () => { const [f] = await api('dialog:open', { title: 'Pick java.exe (or javaw.exe)', properties: ['openFile'], filters: /Win/.test(navigator.platform) ? [{ name: 'Java', extensions: ['exe'] }] : [] }).catch(() => []); if (f) { try { await api('hosted:setSettings', id, { javaPath: f }); toast('Java saved — used from the next start (if it’s new enough for this version)'); again(); } catch (e) { toastErr(e); } } };
      if ($('#st-java-auto', box)) $('#st-java-auto', box).onclick = async () => { await api('hosted:setSettings', id, { javaPath: '' }).catch(toastErr); toast('Java: automatic'); again(); };
      if ($('#st-jvm-save', box)) $('#st-jvm-save', box).onclick = async () => { try { const r = await api('hosted:setSettings', id, { jvmArgs: $('#st-jvm', box).value, aikar: $('#st-aikar', box).checked, restartOnCrash: $('#st-crash', box).checked }); $('#st-jvm', box).value = r.jvmArgs; toast('Saved — applies on next start'); } catch (e) { toastErr(e); } };
      if ($('#st-auto', box)) $('#st-auto', box).onchange = async (e) => { try { await api('hosted:setAutoStart', id, e.target.checked); toast(e.target.checked ? 'This server starts when Windows starts' : 'Auto start off'); } catch (er) { toastErr(er); } };
      // resource pack
      const packOpts = () => ({ required: $('#rp-req', box)?.checked, prompt: $('#rp-prompt', box)?.value || '' });
      const packDo = async (b, o, msg) => { b.disabled = true; const t = b.innerHTML; b.innerHTML = `${icon('refresh', 'spin')}Working…`; try { await api('hosted:setPack', id, { ...packOpts(), ...o }); toast(msg); again(); } catch (e) { toastErr(e); b.disabled = false; b.innerHTML = t; } };
      if ($('#rp-file', box)) $('#rp-file', box).onclick = async (e) => { const b = e.currentTarget; const [f] = await api('dialog:open', { title: 'Pick the resource pack (.zip)', properties: ['openFile'], filters: [{ name: 'Resource pack', extensions: ['zip'] }] }).catch(() => []); if (f) packDo(b, { file: f }, 'Resource pack added — players get it from the next start'); };
      if ($('#rp-url-go', box)) $('#rp-url-go', box).onclick = (e) => packDo(e.currentTarget, { url: $('#rp-url', box).value }, 'Resource pack link saved — players get it from the next start');
      if ($('#rp-save', box)) $('#rp-save', box).onclick = (e) => packDo(e.currentTarget, {}, 'Saved');
      if ($('#rp-rm', box)) $('#rp-rm', box).onclick = (e) => packDo(e.currentTarget, { remove: true }, 'Resource pack removed');
      // public address, voice, bedrock
      $$('#st-tun [data-t]', box).forEach((b) => { b.classList.toggle('on', b.dataset.t === set.tunnel); b.onclick = async () => { try { const r = await api('hosted:setTunnel', id, b.dataset.t); if (r?.needsRestart) toast('Saved — e4mc changes when the server restarts', 'info', 9000, { label: 'Restart now', run: () => api('hosted:restart', id).catch(toastErr) }); else toast(s.state === 'offline' ? 'Public address setting saved' : b.dataset.t === 'none' ? 'Tunnel closed — home network only now' : 'Making it public now — no restart needed'); again(); } catch (e) { toastErr(e); } }; });
      if ($('#st-tname-save', box)) $('#st-tname-save', box).onclick = async () => { try { await api('hosted:setSettings', id, { tunnelName: $('#st-tname', box).value }); toast('Saved — a new tunnel name shows on playit.gg for new tunnels'); } catch (e) { toastErr(e); } };
      if ($('#st-voice', box)) $('#st-voice', box).onchange = async (e) => {
        const on = e.target.checked; e.target.disabled = true;
        try { s = await api('hosted:setVoice', id, on); toast(on ? (s.voice?.address ? `Voice chat ready — ${s.voice.address}` : 'Voice chat added — it’s fully set up when the server starts') : 'Voice chat removed'); } catch (er) { toastErr(er); }
        again();
      };
      if ($('#st-bedrock', box)) $('#st-bedrock', box).onchange = async (e) => {
        const on = e.target.checked; e.target.disabled = true;
        try { s = await api('hosted:setBedrock', id, on); toast(on ? (s.bedrock?.address ? `Bedrock ready — ${s.bedrock.address}` : 'Bedrock support added — it’s fully set up when the server starts') : 'Bedrock support removed'); } catch (er) { toastErr(er); }
        again();
      };
      if ($('#st-v-playit', box)) $('#st-v-playit', box).onclick = () => api('shell:open', 'https://playit.gg/account/tunnels');
      if ($('#st-v-retry', box)) $('#st-v-retry', box).onclick = async (e) => { e.currentTarget.disabled = true; try { s = await api('hosted:tunnelRestart', id); toast(s.voice?.address ? `Voice chat tunnel found — ${s.voice.address}` : s.voice?.error ? 'Still no voice chat tunnel — see the steps' : 'Checked'); } catch (er) { toastErr(er); } again(); };
      if ($('#st-v-save', box)) $('#st-v-save', box).onclick = async () => { try { s = await api('hosted:setVoiceAddress', id, $('#st-v-addr', box).value); toast(s.voice?.manualAddress ? 'Voice chat address saved — restart the server to use it' : 'Voice chat address set back to automatic'); again(); } catch (e) { toastErr(e); } };
      // discord, instance, code, files, copy, export, delete
      const dcEvents = () => Object.fromEntries($$('[data-dc]', box).map((c) => [c.dataset.dc, c.checked]));
      $('#st-dc-save', box).onclick = async () => { try { await api('hosted:setDiscord', id, { url: $('#st-dc-url', box).value, events: dcEvents() }); toast($('#st-dc-url', box).value.trim() ? 'Discord alerts saved' : 'Discord alerts off'); } catch (e) { toastErr(e); } };
      $('#st-dc-test', box).onclick = async (e) => { const b = e.currentTarget; b.disabled = true; try { await api('hosted:testDiscord', id, $('#st-dc-url', box).value); toast('Test sent — check your Discord channel'); } catch (er) { toastErr(er); } b.disabled = false; };
      if ($('#st-inst', box)) $('#st-inst', box).onclick = async (e) => { if (await this.makeInstance(id, s, e.currentTarget)) again(); };
      $('#st-code', box).onclick = async () => { try { api('clipboard:write', await api('hosted:setupCode', id)); toast('Setup code copied'); } catch (e) { toastErr(e); } };
      $('#st-folder', box).onclick = () => api('hosted:openFolder', id);
      $('#st-copy', box).onclick = async (e) => { const b = e.currentTarget; b.disabled = true; b.innerHTML = `${icon('refresh', 'spin')}Copying…`; try { const c = await api('hosted:copy', id); toast(`Made “${c.name}” (port ${c.port})`); Router.go('host', { id: c.id }); } catch (er) { toastErr(er); b.disabled = false; b.innerHTML = `${icon('copy')}Copy server`; } };
      $('#st-export', box).onclick = async (e) => {
        const dest = await api('dialog:save', { title: 'Save the server as', defaultPath: `${set.name.replace(/[^\w .-]/g, '')}.solaris-server.zip`, filters: [{ name: 'Astra server', extensions: ['zip'] }] }).catch(() => null);
        if (!dest) return;
        const b = e.currentTarget; b.disabled = true; b.innerHTML = `${icon('refresh', 'spin')}Saving…`;
        try { const r = await api('hosted:export', id, dest); toast(`Saved ${fmtBytes(r.size)} — import it on the other PC with Hosting → Import server`, 'ok', 9000); } catch (er) { toastErr(er); }
        b.disabled = false; b.innerHTML = `${icon('upload')}Export server…`;
      };
      $('#st-del', box).onclick = () => this.remove(id);
    },
  },
};

window.solaris.on('hosted:state', (s) => Bus.emit('hosted', s));
window.solaris.on('hosted:stats', (s) => { Pages.host.stats.set(s.id, s); Bus.emit('hosted-stats', s); });
Bus.on('hosted-lines', (p) => { const l = Pages.host.logs.get(p.id) || []; l.push(...p.lines); if (l.length > 4000) l.splice(0, l.length - 4000); Pages.host.logs.set(p.id, l); Bus.emit('hosted-log', p); });
// A server stopped by itself: say why (from its log) with the fix right there.
window.solaris.on('hosted:crash', (d) => {
  const why = d.findings?.[0]?.text;
  toast(`${d.name} stopped unexpectedly${why ? ' — ' + why : '.'}`, 'error', 12000, { label: d.findings?.length ? 'See why and fix' : 'See why', run: () => Pages.host.showDiagnosis(d.id, d) });
});
window.solaris.on('hosted:chunky', (c) => Bus.emit('hosted-chunky', c));
// Someone was turned away by the whitelist (often the owner after a modpack turned it on): offer the fix right there.
window.solaris.on('hosted:notWhitelisted', ({ id, name }) => {
  toast(`${name} couldn’t join — they’re not on this server’s whitelist.`, 'warn', 12000, {
    label: 'Add to whitelist',
    run: async () => { try { await api('hosted:addPerson', id, 'whitelist', name); toast(`${name} added — they can join now`); } catch (e) { toastErr(e); } },
  });
});
window.solaris.on('playit:state', (s) => { Pages.host.playit = s; Bus.emit('playit', s); });
// Someone with an offline (cracked) account was turned away because the server needs Microsoft accounts.
window.solaris.on('hosted:offlineKick', ({ id, name }) => {
  toast(`${name} couldn’t join — they use an offline account, and this server only allows Microsoft accounts.`, 'warn', 15000, {
    label: 'Allow offline accounts',
    run: () => {
      const m = modal({
        title: 'Allow offline accounts?',
        body: `<p>Players with offline (cracked) accounts can join. Minecraft can’t check who they really are, so anyone could use any name.</p>
          <label class="row small" style="gap:8px;align-items:flex-start"><input type="checkbox" id="ao-wl" checked><span><b>Turn the whitelist on and add ${esc(name)}</b> (recommended)<br><span class="faint">Only you and the players you add can join. You can add more in the Players tab.</span></span></label>
          <p class="faint small">Everyone keeps their inventory and progress — Astra moves it over. The server restarts.</p>`,
        footer: `<button class="btn ghost" data-x>${T('Cancel')}</button><button class="btn primary" data-go>Allow offline accounts</button>`,
      });
      m.$('[data-x]').onclick = () => m.close();
      m.$('[data-go]').onclick = async () => {
        const b = m.$('[data-go]'); b.disabled = true;
        const wl = m.$('#ao-wl').checked;
        try { await api('hosted:allowOffline', id, { whitelist: wl, name }); m.close(); toast(`Offline accounts allowed${wl ? ` — ${name} is on the whitelist` : ''}. The server restarts if it’s running.`); }
        catch (e) { toastErr(e); b.disabled = false; }
      };
    },
  });
});
window.solaris.on('hosted:playit-manual', ({ port, reason }) => {
  const m = modal({ title: 'Add a playit.gg tunnel', body: `<p class="muted">Astra couldn’t create the tunnel automatically (${esc(reason)}).</p><p>On playit.gg, add a tunnel: type <b>Minecraft Java</b>, local address <b class="mono">127.0.0.1</b>, local port <b class="mono">${port}</b>. Astra picks it up within a few seconds.</p>`, footer: `<button class="btn ghost" data-x>Later</button><button class="btn primary" data-go>${icon('external')}Open playit.gg</button>` });
  m.$('[data-x]').onclick = () => m.close();
  m.$('[data-go]').onclick = () => { api('shell:open', 'https://playit.gg/account/tunnels'); m.close(); };
});
