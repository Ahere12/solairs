/* Boot: shell chrome, navigation, events from the main process, keybinds, drag & drop. */
const NAV = [
  { section: 'Game' },
  { id: 'home', label: 'Home', icon: 'home', key: 'nav.home' },
  { id: 'library', label: 'Library', icon: 'library', key: 'nav.library' },
  { id: 'solaris', label: 'Solaris Client', icon: 'sun', key: 'nav.solaris' },
  { section: 'Discover' },
  { id: 'browse', label: 'Browse', icon: 'browse', key: 'nav.browse' },
  { id: 'servers', label: 'Servers', icon: 'servers', key: 'nav.servers' },
  { id: 'skins', label: 'Skins', icon: 'skins', key: 'nav.skins' },
  { id: 'gallery', label: 'Gallery', icon: 'gallery' },
  { section: 'Help' },
  { id: 'console', label: 'Console', icon: 'console', key: 'nav.console' },
  { id: 'changelog', label: 'Changelog', icon: 'changelog' },
  { id: 'roadmap', label: 'Roadmap', icon: 'roadmap' },
  { id: 'settings', label: 'Settings', icon: 'settings', key: 'nav.settings' },
];
const ROUTE_ALIAS = { instance: 'library' };

function renderNav() {
  const cur = Router.current ? ROUTE_ALIAS[Router.current.name] || Router.current.name : 'home';
  const running = Object.values(State.runs).filter((r) => r.running).length;
  $('#nav').innerHTML = NAV.map((n) => n.section
    ? `<div class="section-label">${esc(T(n.section))}</div>`
    : `<button class="nav-item ${cur === n.id ? 'active' : ''}" data-nav="${n.id}" title="${esc(State.settings.keybinds[n.key] || '')}">${icon(n.icon)}${esc(T(n.label))}${n.id === 'console' && running ? `<span class="count">${running}</span>` : ''}</button>`).join('');
  $$('[data-nav]').forEach((b) => (b.onclick = () => Router.go(b.dataset.nav)));
}
function renderAccountChip() {
  const chip = $('#account-chip');
  const a = State.accounts.accounts.find((x) => x.id === State.accounts.active);
  chip.innerHTML = `<div class="head" id="chip-head"></div><div class="meta"><div class="name">${a ? esc(a.name) : T('Add account')}</div><div class="type">${a ? (a.type === 'msa' ? 'Microsoft' : 'Offline') : 'Click to sign in'}</div></div>${icon('more')}`;
  renderHead($('#chip-head'), a);
  chip.onclick = openAccounts;
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
}

/* ---------- main-process events ---------- */
const on = window.solaris.on;
on('launch:status', (s) => {
  if (s.error) State.launch[s.instanceId] = { error: s.error };
  else if (s.stage) State.launch[s.instanceId] = { stage: s.stage, progress: s.progress, detail: s.detail };
  Bus.emit('launch', s.instanceId);
});
on('launch:started', ({ runId, instanceId, name }) => {
  delete State.launch[instanceId];
  const pre = State.runs[runId]?.lines || [];
  State.runs[runId] = { instanceId, name, start: Date.now(), lines: pre, running: true };
  Bus.emit('launch', instanceId); Bus.emit('runs');
  toast(`${name} is starting…`, 'info');
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
on('window:maximized', (m) => ($('#win-max').innerHTML = icon(m ? 'copy' : 'max')));

Bus.on('launch', renderTasks);
Bus.on('tasks', renderTasks);
Bus.on('runs', renderNav);
Bus.on('route', renderNav);
Bus.on('accounts', renderAccountChip);
Bus.on('settings', (s) => applyTheme(s));

/* ---------- keyboard, mouse, drag & drop ---------- */
document.addEventListener('keydown', (e) => {
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
window.addEventListener('mouseup', (e) => { if (e.button === 3) { e.preventDefault(); Router.back(); } if (e.button === 4) { e.preventDefault(); Router.forward(); } });
document.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); showDrop('Drop .mrpack or .solpack to import'); } });
document.addEventListener('drop', async (e) => {
  e.preventDefault(); hideDrop();
  const files = [...(e.dataTransfer?.files || [])].map((f) => window.solaris.pathForFile(f)).filter((f) => /\.(mrpack|solpack|skpack)$/i.test(f));
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
  $('#nav-back').onclick = () => Router.back();
  $('#nav-fwd').onclick = () => Router.forward();
  $('#win-min').onclick = () => api('win:minimize');
  $('#win-max').onclick = () => api('win:maximize');
  $('#win-close').onclick = () => api('win:close');
  $('.titlebar').ondblclick = (e) => { if (!e.target.closest('button')) api('win:maximize'); };

  [State.settings, State.info] = await Promise.all([api('settings:get'), api('app:info')]);
  applyTheme(State.settings);
  await Promise.all([refreshInstances(), refreshAccounts()]);
  try { const l = await api('launch:list'); for (const r of l.running) State.runs[r.runId] = { ...r, lines: await api('launch:logs', r.runId), running: true }; } catch {}
  renderNav(); renderAccountChip(); renderTasks();
  Router.go('home');
  if (State.settings.firstRun) {
    await saveSettings({ firstRun: false });
    if (!State.accounts.accounts.length) setTimeout(openAccounts, 400);
  }
})();
