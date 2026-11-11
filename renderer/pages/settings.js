const THEMES = {
  solar: { name: 'Solar', bg: '#0d0b12', panel: '#1f1a29', side: '#120f18' },
  eclipse: { name: 'Eclipse', bg: '#07070a', panel: '#181822', side: '#0b0b10' },
  nebula: { name: 'Nebula', bg: '#0a0d18', panel: '#19213d', side: '#0d1120' },
  dawn: { name: 'Dawn', bg: '#f6f1ea', panel: '#ffffff', side: '#efe8de' },
  custom: { name: 'Custom', bg: null, panel: null, side: null },
};
const ACCENTS = ['#ff9f1c', '#ff5e3a', '#ffd23f', '#3ddc84', '#2ec4b6', '#6aa8ff', '#8b5cf6', '#ff5ca8', '#e5e5e5'];
const KEY_LABELS = { 'nav.home': 'Go to Home', 'nav.library': 'Go to Library', 'nav.browse': 'Go to Browse', 'nav.solaris': 'Go to Solaris Client', 'nav.servers': 'Go to Servers', 'nav.skins': 'Go to Skins', 'nav.console': 'Go to Console', 'nav.settings': 'Open Settings', 'play.selected': 'Play selected instance', 'search.focus': 'Focus search' };

function applyTheme(s) {
  const root = document.documentElement;
  root.dataset.theme = s.theme === 'custom' ? 'solar' : s.theme;
  root.style.setProperty('--accent', s.accent);
  const mix = (hex, amt) => { const n = parseInt(hex.slice(1), 16); const r = Math.min(255, (n >> 16) + amt), g = Math.min(255, ((n >> 8) & 255) + amt), b = Math.min(255, (n & 255) + amt); return `rgb(${r},${g},${b})`; };
  // derive a second gradient stop from the accent
  const n = parseInt(s.accent.slice(1), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  root.style.setProperty('--accent-2', `rgb(${Math.min(255, r + 10)},${Math.max(0, g - 60)},${Math.max(0, b - 20)})`);
  root.style.setProperty('--accent-ink', (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#1a0f02' : '#ffffff');
  for (const k of ['--bg', '--bg-2', '--panel', '--panel-2', '--panel-3', '--text']) root.style.removeProperty(k);
  if (s.theme === 'custom' && s.customTheme) {
    const c = s.customTheme;
    root.style.setProperty('--bg', c.bg); root.style.setProperty('--bg-2', c.bg);
    root.style.setProperty('--panel', c.panel); root.style.setProperty('--panel-2', mix(c.panel, 10)); root.style.setProperty('--panel-3', mix(c.panel, 24));
    root.style.setProperty('--text', c.text);
  }
}

Pages.settings = {
  async render(el, params, ctx) {
    let tab = params.tab || 'general';
    const TABS = [['general', 'General', 'settings'], ['appearance', 'Appearance', 'palette'], ['java', 'Java & Memory', 'cpu'], ['accounts', 'Accounts', 'user'], ['keybinds', 'Keybinds', 'key'], ['storage', 'Storage', 'hdd'], ['integrations', 'Integrations', 'link'], ['diagnostics', 'Diagnostics', 'bug'], ['about', 'About', 'info']];
    el.innerHTML = `<div class="page-head"><h1>${T('Settings')}</h1></div>
      <div class="settings"><nav>${TABS.map(([k, l, ic]) => `<button class="nav-item" data-st="${k}">${icon(ic)}${l}</button>`).join('')}</nav><div id="sbody"></div></div>`;
    const show = (t) => {
      tab = t;
      $$('[data-st]', el).forEach((b) => b.classList.toggle('active', b.dataset.st === t));
      this[t]($('#sbody', el));
    };
    $$('[data-st]', el).forEach((b) => (b.onclick = () => show(b.dataset.st)));
    show(tab);
  },
  /* helpers */
  toggle(key, title, desc) {
    return `<div class="setting"><div class="txt"><div class="t">${title}</div><div class="d">${desc}</div></div><div class="ctl"><label class="switch"><input type="checkbox" data-bool="${key}" ${State.settings[key] ? 'checked' : ''}><span></span></label></div></div>`;
  },
  bind(box) {
    $$('[data-bool]', box).forEach((c) => (c.onchange = async () => { await saveSettings({ [c.dataset.bool]: c.checked }); toast('Saved'); }));
    $$('[data-sel]', box).forEach((c) => (c.onchange = async () => { await saveSettings({ [c.dataset.sel]: c.value }); toast('Saved'); }));
    $$('[data-text]', box).forEach((c) => (c.onchange = async () => { await saveSettings({ [c.dataset.text]: c.value.trim() }); toast('Saved'); }));
  },

  general(box) {
    const s = State.settings;
    box.innerHTML = `<div class="card">
      <div class="setting"><div class="txt"><div class="t">Language</div><div class="d">Switches instantly.</div></div><div class="ctl"><select data-sel="language">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === s.language ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
      <div class="setting"><div class="txt"><div class="t">When the game starts</div><div class="d">What Solaris does with its window while you play.</div></div><div class="ctl"><select data-sel="launchBehavior"><option value="keep">Keep open</option><option value="minimize">Minimize</option><option value="hide">Hide (reopen when the game closes)</option></select></div></div>
      ${this.toggle('doubleClickLaunch', 'Double-click to launch', 'Double-clicking an instance card starts the game.')}
      ${this.toggle('startMinimized', 'Start minimized', 'Open Solaris in the background.')}
      ${this.toggle('openAtLogin', 'Launch on system startup', 'Start Solaris when you sign in to your computer.')}
      ${this.toggle('minimizeToTray', 'Close to tray', 'Closing the window keeps Solaris running in the system tray (right-click it to quick-launch).')}
      ${this.toggle('notifications', 'Notifications', 'Show confirmations, crash and download notifications.')}
      ${this.toggle('showSnapshots', 'Show snapshots', 'Include snapshots and old versions in version lists by default.')}
    </div>`;
    $('[data-sel="launchBehavior"]', box).value = s.launchBehavior;
    this.bind(box);
    $('[data-sel="language"]', box).addEventListener('change', () => setTimeout(() => { renderNav(); Router.reload(); }, 50));
  },

  appearance(box) {
    const s = State.settings;
    box.innerHTML = `<div class="card">
      <h3>Theme</h3><div class="row wrap" style="margin:10px 0 18px">${Object.entries(THEMES).map(([k, t]) => {
        const bg = t.bg || s.customTheme.bg, panel = t.panel || s.customTheme.panel, side = t.side || s.customTheme.bg;
        return `<div class="theme-card ${s.theme === k ? 'on' : ''}" data-theme="${k}"><div class="pv" style="background:${bg}"><div style="background:${side}"></div><div style="padding:8px;display:flex;flex-direction:column;gap:5px"><div style="height:10px;width:60%;border-radius:4px;background:${s.accent}"></div><div style="height:22px;border-radius:5px;background:${panel}"></div><div style="height:12px;width:70%;border-radius:4px;background:${panel}"></div></div></div><div class="n">${t.name}</div></div>`;
      }).join('')}</div>
      <h3>Accent colour</h3><div class="swatches" style="margin:10px 0 6px">${ACCENTS.map((c) => `<div class="swatch ${c === s.accent ? 'on' : ''}" data-accent="${c}" style="background:${c}"></div>`).join('')}<input type="color" id="acc" value="${s.accent}" title="Custom colour" style="width:34px;height:34px;border:0;background:none;padding:0;cursor:pointer"></div>
      <div id="custom" class="${s.theme === 'custom' ? '' : 'hidden'}"><h3 style="margin-top:18px">Custom theme</h3>
        <div class="row wrap">${[['bg', 'Background'], ['panel', 'Panels'], ['text', 'Text']].map(([k, l]) => `<label class="field">${l}<input type="color" data-ct="${k}" value="${s.customTheme[k]}" style="width:80px;height:36px;border:0;background:none"></label>`).join('')}</div></div>
      <p class="faint small" style="margin-top:16px">Changes preview live across the whole launcher.</p></div>`;
    const set = async (patch) => { await saveSettings(patch); applyTheme(State.settings); this.appearance(box); };
    $$('[data-theme]', box).forEach((d) => (d.onclick = () => set({ theme: d.dataset.theme })));
    $$('[data-accent]', box).forEach((d) => (d.onclick = () => set({ accent: d.dataset.accent })));
    $('#acc', box).oninput = (e) => { document.documentElement.style.setProperty('--accent', e.target.value); };
    $('#acc', box).onchange = (e) => set({ accent: e.target.value });
    $$('[data-ct]', box).forEach((i) => {
      i.oninput = () => { const ct = { ...State.settings.customTheme, [i.dataset.ct]: i.value }; applyTheme({ ...State.settings, theme: 'custom', customTheme: ct }); };
      i.onchange = () => set({ customTheme: { ...State.settings.customTheme, [i.dataset.ct]: i.value } });
    });
  },

  async java(box) {
    const s = State.settings;
    const total = Math.floor((State.info.totalMem || 8 * 1024 ** 3) / 1024 / 1024);
    const auto = await api('settings:autoMemory', false);
    box.innerHTML = `<div class="card">
      ${this.toggle('autoMemory', 'Automatic memory', `Pick memory based on your ${Math.round(total / 1024)} GB of RAM (currently ${auto} MB, +1 GB for modded).`)}
      <div class="setting ${s.autoMemory ? 'hidden' : ''}" id="memrow"><div class="txt"><div class="t">Maximum memory: <span id="memv">${s.memoryMax}</span> MB</div><input type="range" id="mem" min="1024" max="${Math.min(total - 1024, 32768)}" step="256" value="${s.memoryMax}" style="margin-top:8px"></div></div>
      <div class="setting"><div class="txt"><div class="t">Java executable</div><div class="d">Empty = Solaris downloads the official runtime each version needs (recommended).</div></div><div class="ctl"><input type="text" data-text="javaPath" value="${esc(s.javaPath)}" placeholder="Automatic" style="width:280px"></div></div>
      <div class="setting" style="flex-direction:column;align-items:stretch"><div class="txt"><div class="t">JVM arguments</div><div class="d">Plain text, applied to every instance unless it has its own.</div></div><textarea data-text="jvmArgs" rows="3">${esc(s.jvmArgs)}</textarea></div>
      ${this.toggle('performanceMode', 'Performance mode', 'Extra JVM flags tuned for low-end machines.')}
      ${this.toggle('dedicatedGpu', 'Use dedicated GPU', 'Windows: asks the system to run Java on your high-performance graphics card.')}
      <div class="setting"><div class="txt"><div class="t">Parallel downloads</div><div class="d">Lower this on slow or unstable connections.</div></div><div class="ctl"><select data-sel="concurrency">${[4, 8, 16, 32].map((n) => `<option ${n == s.concurrency ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
    </div>
    <h2>Installed Java</h2><div id="javas" class="list"><div class="list-row faint">Detecting…</div></div>
    <div class="row" style="margin-top:10px"><button class="btn sm" data-rt="java-runtime-delta">${icon('download')}Install Java 21</button><button class="btn sm" data-rt="java-runtime-gamma">Java 17</button><button class="btn sm" data-rt="jre-legacy">Java 8</button></div>`;
    this.bind(box);
    $('[data-bool="autoMemory"]', box).addEventListener('change', (e) => $('#memrow', box).classList.toggle('hidden', e.target.checked));
    $('#mem', box).oninput = (e) => ($('#memv', box).textContent = e.target.value);
    $('#mem', box).onchange = (e) => saveSettings({ memoryMax: +e.target.value });
    $$('[data-rt]', box).forEach((b) => (b.onclick = async () => { b.disabled = true; try { await api('java:install', b.dataset.rt); toast('Java installed'); this.java(box); } catch (e) { toastErr(e); b.disabled = false; } }));
    const js = await api('java:detect');
    const jbox = $('#javas', box); if (!jbox) return;
    jbox.innerHTML = js.length ? js.map((j) => `<div class="list-row"><div class="mod-icon">${icon('cpu')}</div><div class="info"><div class="title">Java ${esc(j.version)} ${j.managed ? '<span class="chip accent">Solaris</span>' : ''}</div><div class="desc mono">${esc(j.path)}</div></div><button class="btn sm" data-use="${esc(j.path)}">Use globally</button></div>`).join('') : '<div class="list-row faint">No Java found — that\'s fine, Solaris installs it automatically.</div>';
    $$('[data-use]', jbox).forEach((b) => (b.onclick = async () => { await saveSettings({ javaPath: b.dataset.use }); toast('Java path set'); this.java(box); }));
  },

  async accounts(box) {
    const { accounts, active } = await refreshAccounts();
    box.innerHTML = `<div class="card">
      <div class="row"><h3 class="grow" style="margin:0">Accounts</h3><button class="btn sm primary" id="manage">${icon('user')}Manage accounts</button></div>
      <div class="stack" style="margin-top:12px">${accounts.map((a) => `<div class="row"><div class="head" data-h="${esc(a.id)}"></div><b>${esc(a.name)}</b><span class="chip">${a.type === 'msa' ? 'Microsoft' : 'Offline'}</span>${a.id === active ? '<span class="chip ok">Active</span>' : ''}</div>`).join('') || '<div class="faint">No accounts yet.</div>'}</div>
    </div>
    <h2>Microsoft sign-in</h2><div class="card">
      <div class="setting"><div class="txt"><div class="t">Status <span id="ms-status"></span></div><div class="d">Sign in from the account menu. You sign in on Microsoft’s own page; Solaris never sees your password.</div></div><div class="ctl"><button class="btn sm" id="ms-signin">${MS_LOGO}Sign in with Microsoft</button></div></div>
      <p class="faint small" style="margin-bottom:0">Privacy: Solaris talks directly to Microsoft, Xbox Live and Minecraft services. Tokens are encrypted on this computer and never sent anywhere else.</p>
    </div>`;
    $$('[data-h]', box).forEach((h) => renderHead(h, accounts.find((a) => a.id === h.dataset.h)));
    api('accounts:microsoftAvailable').then((ok) => {
      const el = $('#ms-status', box); if (el) el.innerHTML = ok ? '<span class="chip ok">Available</span>' : '<span class="chip warn">Coming in an update</span>';
      const b = $('#ms-signin', box); if (b) { b.disabled = !ok; b.onclick = () => microsoftLogin(null, () => this.accounts(box)); }
    });
    $('#manage', box).onclick = openAccounts;
    this.bind(box);
  },

  keybinds(box) {
    const kb = { ...State.settings.keybinds };
    box.innerHTML = `<div class="card">${Object.entries(KEY_LABELS).map(([k, l]) => `<div class="setting"><div class="txt"><div class="t">${l}</div></div><div class="ctl"><span class="kbd" data-kb="${k}">${esc(kb[k] || '—')}</span><button class="icon-btn" data-clear="${k}" title="Clear">${icon('close')}</button></div></div>`).join('')}
      <div class="row" style="justify-content:space-between;margin-top:12px"><span class="faint small">Click a shortcut, then press the new key combination. Alt+←/→ and mouse back/forward buttons navigate history.</span><button class="btn sm" id="kb-reset">Reset to defaults</button></div></div>`;
    $$('[data-kb]', box).forEach((k) => (k.onclick = () => {
      $$('.kbd', box).forEach((x) => x.classList.remove('listening'));
      k.classList.add('listening'); k.textContent = 'Press keys…';
      const h = async (e) => {
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        document.removeEventListener('keydown', h, true);
        if (e.key === 'Escape') return this.keybinds(box);
        const combo = comboOf(e);
        await saveSettings({ keybinds: { ...State.settings.keybinds, [k.dataset.kb]: combo } });
        this.keybinds(box);
      };
      document.addEventListener('keydown', h, true);
    }));
    $$('[data-clear]', box).forEach((b) => (b.onclick = async () => { await saveSettings({ keybinds: { ...State.settings.keybinds, [b.dataset.clear]: '' } }); this.keybinds(box); }));
    $('#kb-reset', box).onclick = async () => { await saveSettings({ keybinds: {} }); State.settings = await api('settings:get'); this.keybinds(box); };
  },

  async storage(box) {
    box.innerHTML = `<div class="card"><div class="row"><h3 class="grow" style="margin:0">Disk usage</h3><span class="faint small mono" id="ddir"></span></div><div class="bar-chart" id="usage" style="margin-top:14px"><div class="faint">Calculating…</div></div></div>
      <div class="card" style="margin-top:14px">
        <div class="setting"><div class="txt"><div class="t">Clean up</div><div class="d">Removes the download cache, extracted natives, logs older than 14 days and game versions no instance uses.</div></div><div class="ctl"><button class="btn sm" id="clean">${icon('trash')}Clean up</button></div></div>
        <div class="setting"><div class="txt"><div class="t">Repair game files</div><div class="d">Forces natives to be re-extracted and files re-checked on next launch.</div></div><div class="ctl"><button class="btn sm" id="repair">${icon('refresh')}Repair</button></div></div>
        <div class="setting"><div class="txt"><div class="t">Data folder</div><div class="d">Move all instances, versions and settings to another drive. Solaris restarts afterwards.</div></div><div class="ctl"><button class="btn sm" id="open">${icon('folder')}Open</button><button class="btn sm" id="move">Move…</button><button class="btn sm ghost" id="resetdir">Reset location</button></div></div>
        <div class="setting"><div class="txt"><div class="t">Reset settings</div><div class="d">Restore every setting to its default. Instances and accounts are kept.</div></div><div class="ctl"><button class="btn sm danger" id="reset">Reset</button></div></div>
      </div>`;
    $('#ddir', box).textContent = State.info.dataDir;
    const u = await api('storage:usage');
    const max = Math.max(...u.map((x) => x.size), 1);
    const total = u.reduce((a, b) => a + b.size, 0);
    if ($('#usage', box)) $('#usage', box).innerHTML = u.sort((a, b) => b.size - a.size).map((x) => `<div class="b"><span>${esc(x.name)}</span><div class="track"><div class="fill" style="width:${(x.size / max) * 100}%"></div></div><span class="faint small" style="text-align:right">${fmtBytes(x.size)}</span></div>`).join('') + `<div class="b"><b>Total</b><span></span><b style="text-align:right">${fmtBytes(total)}</b></div>`;
    $('#clean', box).onclick = async () => { if (!(await confirmDialog('Remove cached and unused files?', { ok: 'Clean up' }))) return; const freed = await api('storage:cleanup'); toast(`Freed ${fmtBytes(freed)}`); this.storage(box); };
    $('#repair', box).onclick = async () => { await api('storage:repair'); toast('Files will be repaired on next launch'); };
    $('#open', box).onclick = () => api('diag:openData');
    $('#move', box).onclick = async () => { if (await confirmDialog('Copy all Solaris data to a new folder and restart? The old folder is kept until you delete it.', { ok: 'Choose folder' })) api('storage:relocate').catch(toastErr); };
    $('#resetdir', box).onclick = async () => { if (await confirmDialog('Use the default data folder again and restart?')) api('storage:resetDataDir'); };
    $('#reset', box).onclick = async () => { if (await confirmDialog('Reset all settings to defaults?', { danger: true, ok: 'Reset' })) { State.settings = await api('settings:reset'); applyTheme(State.settings); renderNav(); toast('Settings reset'); } };
  },

  integrations(box) {
    box.innerHTML = `<div class="card">
      ${this.toggle('discordRpc', 'Discord Rich Presence', 'Show what you are playing on your Discord profile.')}
      <div class="setting"><div class="txt"><div class="t">Discord application ID</div><div class="d">Create an application at discord.com/developers, upload an art asset named <span class="mono">solaris</span>, and paste its ID here.</div></div><div class="ctl"><input type="text" class="mono" data-text="discordClientId" value="${esc(State.settings.discordClientId)}" style="width:240px" placeholder="123456789012345678"></div></div>
      <div class="setting"><div class="txt"><div class="t">Modrinth</div><div class="d">Mods, modpacks, resource packs, shaders and datapacks come from Modrinth's public API.</div></div><div class="ctl"><span class="chip ok">Connected</span></div></div>
      <div class="setting"><div class="txt"><div class="t">mclo.gs</div><div class="d">Used only when you press “Share log”.</div></div><div class="ctl"><span class="chip">On demand</span></div></div>
    </div>`;
    this.bind(box);
  },

  async diagnostics(box) {
    box.innerHTML = `<div class="card"><div class="setting"><div class="txt"><div class="t">Hosts file check</div><div class="d" id="hosts">Checking whether Mojang/Microsoft domains are blocked…</div></div><div class="ctl"><button class="btn sm" id="recheck">${icon('refresh')}Re-check</button></div></div>
      <div class="setting"><div class="txt"><div class="t">Launcher logs</div><div class="d">Game logs for each session are stored in the logs folder.</div></div><div class="ctl"><button class="btn sm" id="logs">${icon('folder')}Open logs</button></div></div></div>`;
    const check = async () => {
      const r = await api('diag:hosts');
      $('#hosts', box).innerHTML = !r.readable ? 'Could not read the hosts file.' : r.issues.length
        ? `<span style="color:var(--danger)">Found ${r.issues.length} entr${r.issues.length > 1 ? 'ies' : 'y'} that may block sign-in or downloads:</span>${r.issues.map((i) => `<div class="mono small">line ${i.line}: ${esc(i.text)}</div>`).join('')}<div class="small">To repair, open <span class="mono">${esc(r.file)}</span> as administrator and remove or comment out (#) these lines.</div>`
        : `<span style="color:var(--ok)">All good — no Minecraft or Microsoft domains are redirected.</span>`;
    };
    $('#recheck', box).onclick = check;
    $('#logs', box).onclick = () => api('diag:openLogs');
    check();
  },

  about(box) {
    const i = State.info;
    box.innerHTML = `<div class="card" style="text-align:center;padding:36px">
      <img src="../assets/icon.png" style="width:96px;height:96px">
      <h1 style="margin:10px 0 4px">Solaris</h1><div class="muted">Version ${esc(i.version)} · Electron ${esc(i.electron)} · ${esc(i.platform)}-${esc(i.arch)}</div>
      <div class="row" style="justify-content:center;margin-top:18px"><button class="btn" id="cl">${icon('changelog')}${T('Changelog')}</button><button class="btn" id="rm">${icon('roadmap')}${T('Roadmap')}</button></div>
      <p class="faint small" style="margin-top:22px">Solaris is not affiliated with Mojang Studios or Microsoft. Minecraft is a trademark of Mojang Synergies AB.</p></div>`;
    $('#cl', box).onclick = () => Router.go('changelog');
    $('#rm', box).onclick = () => Router.go('roadmap');
  },
};

function comboOf(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (k === ' ') k = 'Space';
  parts.push(k);
  return parts.join('+');
}
