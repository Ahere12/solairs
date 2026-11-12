/* Boot: shell chrome, navigation, events from the main process, keybinds, drag & drop. */
const NAV = [
  { id: 'home', label: 'Home', icon: 'home', key: 'nav.home' },
  { id: 'browse', label: 'Browse', icon: 'browse', key: 'nav.browse' },
  { id: 'servers', label: 'Servers', icon: 'servers', key: 'nav.servers' },
  { id: 'skins', label: 'Skins', icon: 'skins', key: 'nav.skins' },
  { id: 'friends', label: 'Friends', icon: 'users', key: 'nav.friends' },
  { id: 'solaris', label: 'Solaris Client', icon: 'sun', key: 'nav.solaris' },
  { id: 'library', label: 'Library', icon: 'box', key: 'nav.library', add: true },
];
const SIDE_TOOLS = [
  { id: 'console', label: 'Console', icon: 'console' },
  { id: 'gallery', label: 'Gallery', icon: 'gallery' },
  { id: 'changelog', label: 'Changelog', icon: 'changelog' },
  { id: 'roadmap', label: 'Roadmap', icon: 'roadmap' },
];
const ROUTE_ALIAS = { instance: 'library' };

function selectedInstance() {
  const insts = State.instances;
  return insts.find((i) => i.id === State.settings?.selectedInstance) || [...insts].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))[0] || null;
}
function renderNav() {
  const cur = Router.current ? ROUTE_ALIAS[Router.current.name] || Router.current.name : 'home';
  const running = Object.values(State.runs).filter((r) => r.running).length;
  $('#nav').innerHTML = NAV.map((n) => `<div class="nav-row"><button class="nav-item ${cur === n.id ? 'active' : ''}" data-nav="${n.id}" title="${esc(State.settings.keybinds[n.key] || '')}">${icon(n.icon)}<span>${esc(T(n.label))}</span></button>${n.add ? `<button class="icon-btn nav-add" id="nav-new" title="${esc(T('New instance'))}">${icon('plus')}</button>` : ''}</div>`).join('');
  $$('[data-nav]', $('#nav')).forEach((b) => (b.onclick = () => Router.go(b.dataset.nav)));
  $('#nav-new').onclick = () => openNewInstance();
  $('#side-tools').innerHTML = SIDE_TOOLS.map((n) => `<button class="icon-btn ${cur === n.id ? 'on' : ''}" data-tool="${n.id}" title="${esc(T(n.label))}">${icon(n.icon)}${n.id === 'console' && running ? `<span class="count">${running}</span>` : ''}</button>`).join('');
  $$('[data-tool]').forEach((b) => (b.onclick = () => Router.go(b.dataset.tool)));
  renderSideInstances();
  const st = $('#who-settings'); if (st) st.classList.toggle('on', cur === 'settings');
}
function renderSideInstances() {
  const box = $('#side-insts');
  if (!box || !State.settings) return;
  const cur = Router.current?.name === 'instance' ? Router.current.params.id : null;
  const list = [...State.instances].sort((a, b) => (b.pinned - a.pinned) || ((b.lastPlayed || 0) - (a.lastPlayed || 0))).slice(0, 12);
  box.innerHTML = list.map((i) => `<button class="side-inst ${cur === i.id ? 'active' : ''} ${State.settings.selectedInstance === i.id ? 'selected' : ''}" data-side-inst="${esc(i.id)}" title="${esc(i.name)} · ${esc(i.versionId)}">${instIcon(i, 'xs')}<span class="n">${esc(i.name)}</span>${isRunning(i.id) ? '<span class="dot pulse"></span>' : ''}</button>`).join('');
  $$('[data-side-inst]', box).forEach((b) => {
    const inst = State.instances.find((i) => i.id === b.dataset.sideInst);
    b.onclick = () => Router.go('instance', { id: inst.id });
    b.oncontextmenu = (e) => instanceMenu(e, inst);
  });
}
function renderSidePlay() {
  const box = $('#side-play');
  if (!box || !State.settings) return;
  const sel = selectedInstance();
  if (!sel) {
    box.innerHTML = `<button class="big-play" id="bp-new"><span class="pi">${icon('plus')}</span><span class="pt"><b>${esc(T('New instance'))}</b><small>Create your first instance</small></span></button>`;
    $('#bp-new').onclick = () => openNewInstance();
    return;
  }
  const running = isRunning(sel.id);
  const busy = State.launch[sel.id] && !State.launch[sel.id].error;
  const sub = busy ? launchLabel(sel.id) : `${sel.name} · ${loaderLabel(sel)} ${sel.versionId}`;
  box.innerHTML = `<div class="big-play-wrap"><button class="big-play ${running ? 'stop' : ''}" ${running ? `data-stop="${esc(sel.id)}"` : `data-play="${esc(sel.id)}"`} ${busy && !running ? 'disabled' : ''}>
      <span class="pi">${icon(running ? 'stop' : 'play')}</span>
      <span class="pt"><b>${running ? esc(T('Stop')).toUpperCase() : busy ? '…' : esc(T('Play')).toUpperCase()}</b><small>${esc(sub)}</small></span>
    </button><button class="big-play-pick" id="bp-pick" title="Choose instance"><svg class="i" viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg></button></div>`;
  $('#bp-pick').onclick = async () => { const i = await chooseInstance({ title: 'Select instance' }); if (i) { await saveSettings({ selectedInstance: i.id }); renderSideInstances(); } };
}
function renderAccountChip() {
  const chip = $('#account-chip');
  const a = State.accounts.accounts.find((x) => x.id === State.accounts.active);
  chip.innerHTML = `<button class="who" id="who" title="Accounts"><div class="head" id="chip-head"></div><div class="meta"><div class="type">${a ? (a.type === 'msa' ? 'Logged in as' : 'Offline account') : 'Not signed in'}</div><div class="name">${a ? esc(a.name) : T('Add account')}</div></div><svg class="i caret" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button>
    <button class="icon-btn" id="who-accts" title="Accounts">${icon('users')}</button>
    <button class="icon-btn" id="who-settings" title="${esc(T('Settings'))}">${icon('settings')}</button>`;
  renderHead($('#chip-head'), a);
  chip.classList.toggle('streamer', !!State.settings?.streamerMode);
  $('#who').onclick = openAccounts;
  $('#who-accts').onclick = openAccounts;
  $('#who-settings').onclick = () => Router.go('settings');
  $('#who-settings').classList.toggle('on', Router.current?.name === 'settings');
}
function renderTasks() {
  const items = [];
  for (const [id, s] of Object.entries(State.launch)) {
    const inst = State.instances.find((i) => i.id === id);
    if (!s.stage && !s.error) continue;
    items.push({ label: inst?.name || id, detail: s.error || s.stage + (s.detail ? ' · ' + s.detail : ''), progress: s.progress, error: !!s.error });
  }
  for (const t of Object.values(State.tasks)) items.push(t);
  $('#tasks').innerHTML = items.map((t) => `<div class="task ${t.error ? 'error' : ''}"><div class="label"><b>${esc(t.label)}</b>${t.progress != null ? `<span>${Math.round(t.progress * 100)}%</span>` : ''}</div>${t.detail ? `<div class="detail">${esc(t.detail)}</div>` : ''}${t.error ? '' : `<div class="progress ${t.progress == null ? 'indeterminate' : ''}"><div style="width:${(t.progress || 0) * 100}%"></div></div>`}</div>`).join('');
  renderSidePlay();
}

/* ---------- main-process events ---------- */
const on = window.solaris.on;
on('launch:status', (s) => {
  if (s.error) {
    const errState = { error: s.error };
    State.launch[s.instanceId] = errState;
    // errors clear themselves (covers launches the UI didn't start, e.g. from the tray)
    setTimeout(() => { if (State.launch[s.instanceId] === errState) { delete State.launch[s.instanceId]; Bus.emit('launch', s.instanceId); } }, 6000);
  } else if (s.stage) State.launch[s.instanceId] = { stage: s.stage, progress: s.progress, detail: s.detail };
  Bus.emit('launch', s.instanceId);
});
on('launch:started', ({ runId, instanceId, name }) => {
  delete State.launch[instanceId];
  const pre = State.runs[runId]?.lines || [];
  State.runs[runId] = { instanceId, name, start: Date.now(), lines: pre, running: true };
  Bus.emit('launch', instanceId); Bus.emit('runs');
  toast(`${name} is starting…`, 'info');
  // the game files for this version now exist on disk — load Minecraft icons if we still have none
  if (!McIcons.ready()) McIcons.init().then((ok) => { if (ok) { Bus.emit('instances', State.instances); renderAccountChip(); } }).catch(() => {});
});
on('launch:exited', async ({ runId, instanceId, code, killed, analysis }) => {
  if (State.runs[runId]) State.runs[runId].running = false;
  Bus.emit('runs');
  await refreshInstances();
  if (analysis) showCrash({ instanceId, analysis, runId });
  else if (killed) toast('Game stopped', 'info');
});
on('game:log', ({ runId, instanceId, line }) => {
  const r = (State.runs[runId] = State.runs[runId] || { instanceId, name: State.instances.find((i) => i.id === instanceId)?.name || instanceId, start: Date.now(), lines: [], running: !runId.startsWith('install-') });
  r.lines.push(line);
  if (r.lines.length > 8000) r.lines.shift();
  Bus.emit('log', { runId, line });
});
on('task', (t) => {
  if (t.done) delete State.tasks[t.id]; else State.tasks[t.id] = { label: t.label, progress: t.progress, detail: t.detail };
  renderTasks();
});
on('toast', (t) => toast(t.text, t.type || 'info'));
// Background malware scan of a newly installed mod found something
on('safety:flagged', ({ instanceId, file, findings }) => {
  const inst = State.instances.find((i) => i.id === instanceId);
  const m = modal({ title: 'Suspicious mod found', body: `<div class="crash-cause"><b>${esc(file)}</b>${inst ? `<div class="faint small">in ${esc(inst.name)}</div>` : ''}${findings.map((f) => `<div class="small muted">• ${esc(f)}</div>`).join('')}</div>
    <p class="muted small">Solaris’s malware scan found signs that this mod may steal accounts or run hidden programs. It’s a heuristic check, so it can be wrong — but if you don’t fully trust where this file came from, turn it off or delete it.</p>`,
    footer: `<button class="btn ghost" data-keep>Keep it</button><button class="btn" data-off>${icon('eye')}Turn it off</button><button class="btn danger" data-del>${icon('trash')}Delete</button>` });
  m.$('[data-keep]').onclick = () => m.close();
  m.$('[data-off]').onclick = async () => { try { await api('safety:disable', instanceId, file); toast(`${file} turned off`); } catch (e) { toastErr(e); } m.close(); };
  m.$('[data-del]').onclick = async () => { try { await api('instances:deleteContent', instanceId, 'mods', [file]); toast(`${file} moved to the Recycle Bin`); } catch (e) { toastErr(e); } m.close(); };
});
on('window:maximized', (m) => ($('#win-max').innerHTML = icon(m ? 'copy' : 'max')));

Bus.on('launch', renderTasks);
Bus.on('tasks', renderTasks);
Bus.on('runs', renderNav);
Bus.on('runs', renderSidePlay);
Bus.on('route', renderNav);
Bus.on('instances', renderSideInstances);
Bus.on('instances', renderSidePlay);
Bus.on('settings', renderSidePlay);
Bus.on('settings', renderSideInstances);
Bus.on('accounts', renderAccountChip);
Bus.on('settings', (s) => applyTheme(s));

/* ---------- keyboard, mouse, drag & drop ---------- */
document.addEventListener('keydown', (e) => {
  if ($('.modal-back') || $('.lightbox') || AuthGate.isOpen()) return; // don't navigate behind an open dialog or the sign-in screen
  if (e.altKey && e.key === 'ArrowLeft') { Router.back(); return; }
  if (e.altKey && e.key === 'ArrowRight') { Router.forward(); return; }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) && !e.ctrlKey) return;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
  const combo = comboOf(e);
  const action = Object.entries(State.settings.keybinds).find(([, v]) => v && v.toLowerCase() === combo.toLowerCase())?.[0];
  if (!action) return;
  e.preventDefault();
  if (action.startsWith('nav.')) Router.go(action.slice(4));
  else if (action === 'play.selected' && State.settings.selectedInstance) play(State.settings.selectedInstance);
  else if (action === 'search.focus') { if (!['library', 'browse'].includes(Router.current?.name)) Router.go('browse'); setTimeout(() => Bus.emit('search-focus'), 50); }
});
window.addEventListener('mouseup', (e) => { if (AuthGate.isOpen()) return; if (e.button === 3) { e.preventDefault(); Router.back(); } if (e.button === 4) { e.preventDefault(); Router.forward(); } });
document.addEventListener('dragover', (e) => { if (!AuthGate.isOpen() && e.dataTransfer?.types.includes('Files')) { e.preventDefault(); showDrop('Drop .mrpack or .solpack to import'); } });
document.addEventListener('drop', async (e) => {
  e.preventDefault(); hideDrop();
  if (AuthGate.isOpen()) return;
  const files = [...(e.dataTransfer?.files || [])].map((f) => window.solaris.pathForFile(f)).filter((f) => /\.(mrpack|solpack|zip)$/i.test(f));
  if (!files.length) return toast('Drop mods onto an instance page. Here you can drop .mrpack or .solpack files.', 'info');
  for (const f of files) await importFile(f);
});

/* ---------- boot ---------- */
(async function boot() {
  $('#nav-back').innerHTML = icon('back');
  $('#nav-fwd').innerHTML = icon('fwd');
  $('#win-min').innerHTML = icon('min');
  $('#win-max').innerHTML = icon('max');
  $('#win-close').innerHTML = icon('close');
  $('#tb-changelog').innerHTML = icon('star') + '<span>What&#39;s new</span>';
  $('#tb-changelog').onclick = () => Router.go('changelog');
  $('#nav-back').onclick = () => Router.back();
  $('#nav-fwd').onclick = () => Router.forward();
  $('#win-min').onclick = () => api('win:minimize');
  $('#win-max').onclick = () => api('win:maximize');
  $('#win-close').onclick = () => api('win:close');
  $('.titlebar').ondblclick = (e) => { if (!e.target.closest('button')) api('win:maximize'); };

  [State.settings, State.info] = await Promise.all([api('settings:get'), api('app:info')]);
  applyTheme(State.settings);
  $('#app-ver').textContent = State.info.version ? State.info.version : '';
  await Promise.all([refreshInstances(), refreshAccounts(), McIcons.loadCache().catch(() => false)]);
  try { const l = await api('launch:list'); for (const r of l.running) State.runs[r.runId] = { ...r, lines: await api('launch:logs', r.runId), running: true }; } catch {}
  renderNav(); renderAccountChip(); renderTasks(); renderSidePlay();
  // real Minecraft icons from the player's own game files (cached after the first time)
  if (!McIcons.ready()) McIcons.init().then((ok) => { if (ok) { Bus.emit('instances', State.instances); renderAccountChip(); } }).catch(() => {});
  Router.go('home');
  if (State.settings.firstRun) await saveSettings({ firstRun: false });
  AuthGate.sync(); // sign-in screen first: the launcher can't be used without an account
  if (State.accounts.active) Updater.whatsNew(); // otherwise shown right after signing in
})();
