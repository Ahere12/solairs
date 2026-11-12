/* Reusable UI: toasts, modals, menus, instance icons, player heads, launch helpers, shared dialogs. */

function toast(text, type = 'ok', ms = 3800) {
  if (type === 'ok' && State.settings && State.settings.notifications === false) return;
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = text;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .25s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 260); }, ms);
}
const toastErr = (e) => toast(e?.message || String(e), 'error', 6500);

function modal({ title, body = '', footer = '', wide = false, onClose } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}"><header><h2>${esc(title)}</h2><button class="icon-btn" data-close>${icon('close')}</button></header><div class="content">${body}</div>${footer ? `<footer>${footer}</footer>` : ''}</div>`;
  document.body.appendChild(back);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
  // Escape closes only the top-most dialog (and not while a lightbox is open on top of it)
  const onKey = (e) => { if (e.key === 'Escape' && !$('.lightbox') && [...document.querySelectorAll('.modal-back')].pop() === back) { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  back.querySelector('[data-close]').onclick = close;
  return { el: back.querySelector('.modal'), close, $: (s) => back.querySelector(s) };
}
function confirmDialog(text, { title = 'Are you sure?', ok = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({ title, body: `<p class="muted" style="white-space:pre-line">${esc(text)}</p>`, footer: `<button class="btn ghost" data-no>${T('Cancel')}</button><button class="btn ${danger ? 'danger solid' : 'primary'}" data-yes>${esc(ok)}</button>`, onClose: () => { if (!done) resolve(false); } });
    m.$('[data-no]').onclick = () => m.close();
    m.$('[data-yes]').onclick = () => { done = true; m.close(); resolve(true); };
    m.$('[data-yes]').focus();
  });
}
function promptDialog(title, { value = '', placeholder = '', ok = 'OK' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({ title, body: `<input type="text" style="width:100%" value="${esc(value)}" placeholder="${esc(placeholder)}">`, footer: `<button class="btn ghost" data-no>${T('Cancel')}</button><button class="btn primary" data-yes>${esc(ok)}</button>`, onClose: () => { if (!done) resolve(null); } });
    const inp = m.$('input');
    inp.focus(); inp.select();
    const submit = () => { done = true; m.close(); resolve(inp.value.trim()); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
    m.$('[data-no]').onclick = () => m.close();
    m.$('[data-yes]').onclick = submit;
  });
}

function contextMenu(x, y, items) {
  $$('.ctx-menu').forEach((m) => m.remove());
  const m = document.createElement('div');
  m.className = 'ctx-menu';
  m.innerHTML = items.map((it, i) => (it === '-' ? '<hr>' : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${icon(it.icon || 'fwd')}${esc(it.label)}</button>`)).join('');
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  m.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; m.remove(); items[+b.dataset.i].action(); };
  setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off); } }), 0);
}

/* ---------- visuals ---------- */
const SUN_SVG = `<svg class="sun" viewBox="0 0 100 100"><defs><radialGradient id="sg" cx="40%" cy="40%"><stop offset="0" stop-color="#ffe08a"/><stop offset="1" stop-color="#ff7a1a"/></radialGradient></defs>${Array.from({ length: 12 }, (_, i) => `<rect x="48" y="2" width="4" height="16" rx="2" fill="#ff9f1c" opacity=".85" transform="rotate(${i * 30} 50 50)"/>`).join('')}<circle cx="50" cy="50" r="26" fill="url(#sg)"/></svg>`;
function instIcon(inst, size = '') {
  const ic = inst?.icon;
  const mc = typeof McIcons !== 'undefined' ? (ic ? McIcons.url(ic) : McIcons.defaultFor(inst)) : null;
  let inner;
  if (mc) return `<div class="inst-icon mc ${size}"><img src="${mc}" alt=""></div>`;
  if (!ic) inner = '🧱';
  else if (ic === 'sun') inner = SUN_SVG;
  else if (ic.startsWith('mc:')) inner = '🧱';
  else if (/^(data:|https?:)/.test(ic)) inner = `<img src="${esc(ic)}" alt="">`;
  else inner = esc(ic);
  return `<div class="inst-icon ${size}">${inner}</div>`;
}
function loaderLabel(inst) { return LOADER_NAMES[inst.loader?.type || 'vanilla']; }
function instMeta(inst) {
  return `<span class="chip">${esc(inst.versionId)}</span><span class="chip ${inst.loader?.type !== 'vanilla' ? 'accent' : ''}">${loaderLabel(inst)}</span>${inst.solarisModules ? '<span class="chip warn">Solaris</span>' : ''}`;
}

/** Draws the face of a Minecraft skin (with hat layer) on a canvas, at 8× so it scales down crisply. */
function drawHead(canvas, src) {
  const ctx = canvas.getContext('2d');
  canvas.width = 64; canvas.height = 64;
  const img = new Image();
  img.onload = () => {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 64, 64);
    // Like Minecraft, ignore a hat layer that is completely solid (old 64×32 skins such as Notch's fill it with black).
    let drawHat = true;
    try {
      const t = document.createElement('canvas'); t.width = 8; t.height = 8;
      const tc = t.getContext('2d'); tc.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8);
      const px = tc.getImageData(0, 0, 8, 8).data;
      let opaque = true; for (let i = 3; i < px.length; i += 4) if (px[i] < 128) { opaque = false; break; }
      if (opaque && img.naturalHeight === 32) drawHat = false;
    } catch {}
    if (drawHat) ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 64, 64);
  };
  if (/^https:/.test(src)) img.crossOrigin = 'anonymous';
  img.src = src;
}
/** 3D snapshot of a skin (one shared off-screen skinview3d viewer, results cached) — used for wardrobe tiles. */
const SkinShots = {
  viewer: null, cache: new Map(), chain: Promise.resolve(),
  key(src, slim) { let h = 2166136261; for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 16777619); return (slim ? 's' : 'w') + (h >>> 0) + ':' + src.length; },
  render(src, slim) {
    if (!src || !window.skinview3d) return Promise.resolve(null);
    const k = this.key(src, slim);
    if (this.cache.has(k)) return this.cache.get(k);
    const p = (this.chain = this.chain.then(async () => {
      if (!this.viewer) {
        const c = document.createElement('canvas');
        this.viewer = new skinview3d.SkinViewer({ canvas: c, width: 200, height: 300, preserveDrawingBuffer: true, renderPaused: true });
        this.viewer.fov = 38; this.viewer.zoom = 0.92;
        this.viewer.playerObject.rotation.y = 0.55;
        try { this.viewer.playerObject.skin.leftArm.rotation.z = 0.06; this.viewer.playerObject.skin.rightArm.rotation.z = -0.06; } catch {}
      }
      await this.viewer.loadSkin(src, { model: slim ? 'slim' : 'default' });
      this.viewer.render();
      return this.viewer.canvas.toDataURL('image/png');
    }).catch(() => null));
    this.cache.set(k, p);
    return p;
  },
};
/** 2D front render of a full skin onto a 16×32 canvas. */
function drawSkinFront(canvas, src, slim) {
  const ctx = canvas.getContext('2d');
  canvas.width = 16; canvas.height = 32;
  const img = new Image();
  img.onload = () => {
    ctx.imageSmoothingEnabled = false;
    const modern = img.height === 64;
    const aw = slim ? 3 : 4;
    const d = (sx, sy, w, h, dx, dy) => ctx.drawImage(img, sx, sy, w, h, dx, dy, w, h);
    d(8, 8, 8, 8, 4, 0); d(20, 20, 8, 12, 4, 8);
    d(44, 20, aw, 12, 4 - aw, 8);
    if (modern) d(36, 52, aw, 12, 12, 8); else { ctx.save(); ctx.scale(-1, 1); ctx.drawImage(img, 44, 20, aw, 12, -12 - aw, 8, aw, 12); ctx.restore(); }
    d(4, 20, 4, 12, 4, 20);
    if (modern) d(20, 52, 4, 12, 8, 20); else { ctx.save(); ctx.scale(-1, 1); ctx.drawImage(img, 4, 20, 4, 12, -12, 20, 4, 12); ctx.restore(); }
    d(40, 8, 8, 8, 4, 0);
    if (modern) { d(20, 36, 8, 12, 4, 8); d(44, 36, aw, 12, 4 - aw, 8); d(52, 52, aw, 12, 12, 8); d(4, 36, 4, 12, 4, 20); d(4, 52, 4, 12, 8, 20); }
  };
  img.src = src;
}
const headCache = {};
async function accountHead(acct) {
  if (!acct) return null;
  return headCache[acct.id] || null;
}
function renderHead(el, acct) {
  el.innerHTML = '';
  if (!acct) { el.textContent = '?'; return; }
  const c = document.createElement('canvas');
  el.appendChild(c);
  if (acct.skinUrl) { drawHead(c, acct.skinUrl.replace('http://', 'https://')); return; }
  // no custom skin: the same default skin Minecraft gives this player (real texture from the game files)
  const d = typeof McIcons !== 'undefined' ? McIcons.skinForUuid(acct.uuid) : null;
  if (d) drawHead(c, d.src);
  else { el.innerHTML = ''; el.textContent = (acct.name || '?')[0].toUpperCase(); }
}

/**
 * Cape loader with animated-cape support (idea from Silent Client's skinview3d fork, MIT).
 * An animated cape is a strip of normal 64×32 (2:1) cape frames stacked vertically; frames play every `delay` ms.
 */
function loadCape(viewer, src, { delay = 100 } = {}) {
  if (!viewer) return Promise.resolve(0);
  clearInterval(viewer._capeTimer); viewer._capeTimer = null;
  if (!src) { viewer.resetCape(); return Promise.resolve(0); }
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const w = img.naturalWidth, fh = Math.round(w / 2), n = Math.floor(img.naturalHeight / fh);
      if (n <= 1) { viewer.loadCape(img); resolve(1); return; }
      const frames = Array.from({ length: n }, (_, i) => {
        const c = document.createElement('canvas'); c.width = w; c.height = fh;
        c.getContext('2d').drawImage(img, 0, i * fh, w, fh, 0, 0, w, fh);
        return c;
      });
      let i = 0;
      viewer.loadCape(frames[0]);
      viewer._capeTimer = setInterval(() => { i = (i + 1) % n; viewer.loadCape(frames[i]); }, Math.max(16, delay));
      resolve(n);
    };
    img.onerror = () => { viewer.resetCape(); resolve(0); };
    img.src = src;
  });
}

function sparkline(points, { w = 600, h = 140 } = {}) {
  if (!points.length) return `<div class="empty small">No data yet — player counts are recorded each time you view this server.</div>`;
  const xs = points.map((p) => p.t), ys = points.map((p) => p.n);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1, y1 = Math.max(...ys, 1);
  const px = (t) => (x1 === x0 ? w / 2 : ((t - x0) / (x1 - x0)) * (w - 20) + 10), py = (n) => h - 18 - (n / y1) * (h - 34);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${px(p.t).toFixed(1)},${py(p.n).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="sp" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L${px(xs[xs.length - 1])},${h - 18} L${px(xs[0])},${h - 18} Z" fill="url(#sp)"/>
    <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
    <text x="10" y="14" fill="var(--muted)" font-size="11">peak ${fmtNum(y1)}</text>
    <text x="10" y="${h - 4}" fill="var(--faint)" font-size="10">${new Date(x0).toLocaleString()}</text>
    <text x="${w - 10}" y="${h - 4}" fill="var(--faint)" font-size="10" text-anchor="end">${new Date(x1).toLocaleString()}</text></svg>`;
}

/* ---------- launching ---------- */
async function play(instanceId, opts = {}) {
  if (!State.accounts.active) { openAccounts(); toast('Add an account first', 'warn'); return; }
  // one game per instance: ignore repeat clicks / shortcuts while it is starting or running
  if (isRunning(instanceId)) { toast('That instance is already running', 'info'); return; }
  if (State.launch[instanceId] && !State.launch[instanceId].error) return;
  State.launch[instanceId] = { stage: 'Starting', progress: null };
  Bus.emit('launch', instanceId);
  await saveSettings({ selectedInstance: instanceId });
  try { await api('launch:start', instanceId, opts); }
  catch (e) {
    // the main process already pushed the error state (and clears it after a few seconds)
    if (!State.launch[instanceId]?.error) {
      const errState = (State.launch[instanceId] = { error: e.message }); Bus.emit('launch', instanceId);
      setTimeout(() => { if (State.launch[instanceId] === errState) { delete State.launch[instanceId]; Bus.emit('launch', instanceId); } }, 6000);
    }
    toastErr(e);
  }
}
function runsFor(instanceId) { return Object.entries(State.runs).filter(([, r]) => r.instanceId === instanceId && r.running).map(([id]) => id); }
function stopInstance(instanceId) { for (const runId of runsFor(instanceId)) api('launch:stop', runId); }
function isRunning(instanceId) { return runsFor(instanceId).length > 0; }
function launchLabel(instanceId) {
  const s = State.launch[instanceId];
  if (!s) return '';
  if (s.error) return '⚠ ' + s.error;
  return s.stage + (s.progress != null ? ` · ${Math.round(s.progress * 100)}%` : '') + (s.detail ? ` · ${s.detail}` : '');
}
/** A play / stop / progress button bound to an instance. */
function playButton(inst, { size = '' } = {}) {
  const busy = State.launch[inst.id] && !State.launch[inst.id].error;
  if (isRunning(inst.id)) return `<button class="btn stop ${size}" data-stop="${esc(inst.id)}">${icon('stop')}${T('Stop')}</button>`;
  return `<button class="btn primary ${size} ${size === 'lg' ? 'play' : ''}" data-play="${esc(inst.id)}" ${busy ? 'disabled' : ''}>${icon('play')}${busy ? '…' : T('Play')}</button>`;
}
document.addEventListener('click', (e) => {
  const p = e.target.closest('[data-play]');
  if (p) { e.stopPropagation(); play(p.dataset.play); return; }
  const s = e.target.closest('[data-stop]');
  if (s) { e.stopPropagation(); stopInstance(s.dataset.stop); }
}, true);

function showCrash({ instanceId, analysis, runId }) {
  const inst = State.instances.find((i) => i.id === instanceId);
  const m = modal({
    title: `${inst?.name || 'Minecraft'} crashed`,
    wide: true,
    body: `<div class="row" style="margin-bottom:12px"><span class="chip danger">Exit code ${analysis.code} · ${esc(analysis.hex)}</span>${analysis.codeMeaning ? `<span class="muted small">${esc(analysis.codeMeaning)}</span>` : ''}</div>
      ${analysis.description ? `<p class="muted">Crash report: <b>${esc(analysis.description)}</b></p>` : ''}
      <h3>What probably happened</h3>
      ${analysis.causes.map((c) => `<div class="crash-cause"><b>${esc(c.title)}</b><div class="muted small">${esc(c.fix)}</div></div>`).join('')}`,
    footer: `${analysis.crashReport ? `<button class="btn ghost" data-report>${icon('folder')}Open crash report</button>` : ''}<button class="btn" data-share>${icon('share')}Share log</button><button class="btn" data-console>${icon('console')}Open console</button><button class="btn primary" data-retry>${icon('play')}Try again</button>`,
  });
  if (analysis.crashReport) m.$('[data-report]').onclick = () => api('shell:showItem', analysis.crashReport);
  m.$('[data-console]').onclick = () => { m.close(); Router.go('console', { runId }); };
  m.$('[data-retry]').onclick = () => { m.close(); play(instanceId); };
  m.$('[data-share]').onclick = () => shareLog(runId);
}
async function shareLog(runId) {
  const lines = State.runs[runId]?.lines?.length ? State.runs[runId].lines : await api('launch:logs', runId).catch(() => []);
  return shareText(lines.join('\n'));
}
/** Upload text (a game log or crash report) to mclo.gs. Asks first unless turned off in Privacy & safety. */
async function shareText(text) {
  if (State.settings.confirmLogUpload !== false) {
    const ok = await confirmDialog('This uploads the log publicly to mclo.gs so you can share the link (access tokens are already hidden; mclo.gs hides IP addresses). Continue?', { title: 'Upload to mclo.gs', ok: 'Upload' });
    if (!ok) return;
  }
  try {
    const url = await api('logs:share', text);
    toast('Log uploaded — link copied: ' + url);
    api('shell:open', url);
  } catch (e) { toastErr(e); }
}

/* ---------- accounts dialog ---------- */
const MS_LOGO = '<svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>';

function openAccounts() {
  const m = modal({ title: 'Accounts', body: '<div id="acct-body"></div>' });
  const draw = async () => {
    const [{ active, accounts }, msOk] = await Promise.all([refreshAccounts(), api('accounts:microsoftAvailable').catch(() => false)]);
    m.$('#acct-body').innerHTML = `
      ${accounts.length ? `<div class="stack" style="margin-bottom:18px">${accounts.map((a) => `<div class="list-row" style="border:1px solid var(--border);border-radius:12px">
          <div class="head" data-head="${esc(a.id)}"></div>
          <div class="info"><div class="title">${esc(a.name)} ${a.id === active ? '<span class="chip ok">Active</span>' : ''} ${a.needsReauth ? '<span class="chip danger">Session expired</span>' : ''}</div><div class="desc">${a.type === 'msa' ? 'Microsoft account' : 'Offline account'}</div></div>
          ${a.needsReauth && msOk ? `<button class="btn sm primary" data-reauth>Sign in again</button>` : ''}
          ${a.id !== active ? `<button class="btn sm" data-use="${esc(a.id)}">Use</button>` : ''}
          <button class="icon-btn" data-rm="${esc(a.id)}" title="Remove">${icon('trash')}</button></div>`).join('')}</div>` : ''}
      <button class="btn lg" data-ms style="width:100%;background:#fff;color:#1b1b1b;border:0" ${msOk ? '' : 'disabled'}>${MS_LOGO}Sign in with Microsoft</button>
      ${msOk ? '<div class="faint small" style="text-align:center;margin-top:8px">Uses Microsoft’s secure sign-in page. Solaris never sees your password.</div>'
        : '<div class="faint small" style="text-align:center;margin-top:8px">Microsoft sign-in isn’t available in this version of Solaris yet. Update Solaris to enable it — you can play offline meanwhile.</div>'}
      <div class="row" style="margin:18px 0 10px"><div class="grow" style="height:1px;background:var(--border)"></div><span class="faint small">or play offline</span><div class="grow" style="height:1px;background:var(--border)"></div></div>
      <div class="row"><input type="text" class="grow" id="off-name" placeholder="Username (3–16 characters)" maxlength="16"><button class="btn" data-off>Add offline</button></div>
      <div class="faint small" style="margin-top:8px">Offline accounts play singleplayer and offline-mode servers. Online servers and skins need a Microsoft account that owns Minecraft.</div>
      ${active ? `<button class="btn ghost" data-signout style="width:100%;margin-top:16px">${icon('logout')}Sign out</button>` : ''}`;
    $$('[data-head]', m.el).forEach((el) => renderHead(el, accounts.find((a) => a.id === el.dataset.head)));
    $$('[data-use]', m.el).forEach((b) => (b.onclick = async () => { await api('accounts:setActive', b.dataset.use); draw(); }));
    $$('[data-rm]', m.el).forEach((b) => (b.onclick = async () => { if (await confirmDialog('Remove this account from Solaris?', { danger: true, ok: 'Remove' })) { await api('accounts:remove', b.dataset.rm); draw(); } }));
    $$('[data-reauth]', m.el).forEach((b) => (b.onclick = () => microsoftLogin(m, draw)));
    m.$('[data-off]').onclick = async () => {
      const name = m.$('#off-name').value.trim();
      const btn = m.$('[data-off]');
      if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return toast('Username must be 3–16 characters: letters, numbers or _', 'error');
      btn.disabled = true;
      // warn about unusual names (staff names, real premium accounts, odd underscores) — still allowed
      const warnings = await api('accounts:checkOfflineName', name).catch(() => []);
      btn.disabled = false;
      if (warnings.length && !(await confirmDialog(`${warnings.map((w) => '• ' + w).join('\n')}\n\nAdd “${name}” anyway?`, { title: 'Unusual offline username', ok: 'Add anyway' }))) return;
      try { await api('accounts:addOffline', name); toast('Account added'); draw(); } catch (e) { toastErr(e); }
    };
    if (m.$('[data-signout]')) m.$('[data-signout]').onclick = async () => { await api('accounts:setActive', null); m.close(); await refreshAccounts(); };
    m.$('#off-name').onkeydown = (e) => { if (e.key === 'Enter') m.$('[data-off]').click(); };
    if (msOk) m.$('[data-ms]').onclick = () => microsoftLogin(m, draw);
  };
  draw();
}
/** Waits for the main process to report the sign-in result. */
function awaitLogin(m, redraw) {
  const off = window.solaris.on('account:login', (r) => {
    off();
    if (r.ok) { toast(`Signed in as ${r.account.name}`); m.close(); redraw && redraw(); refreshAccounts(); }
    else { toast(r.error, 'error', 9000); m.close(); }
  });
  return off;
}
/** Microsoft sign-in: opens Microsoft's page in the browser; Solaris finishes automatically. */
async function microsoftLogin(parent, redraw, method = 'browser') {
  let info;
  try { info = await api('accounts:startMicrosoft', { method }); }
  catch (e) { toastErr(e); return; }
  if (info.mode === 'browser') {
    let off = () => {};
    const m = modal({
      title: 'Sign in with Microsoft',
      body: `<div style="text-align:center;padding:6px 0 4px">${icon('globe', 'big-ic')}
        <p style="font-size:15px;margin:10px 0 4px"><b>Continue in your browser</b></p>
        <p class="muted" style="margin:0">Sign in with the Microsoft account that owns Minecraft: Java Edition and allow Solaris. You'll come back here automatically.</p></div>
        <div class="row" style="margin-top:16px"><div class="progress indeterminate grow"><div></div></div><span class="faint small">Waiting for Microsoft…</span></div>
        <p class="faint small" style="margin-top:14px">Browser didn't open? <a href="#" data-reopen>Open it again</a> · Signing in on another device? <a href="#" data-code>Use a code instead</a></p>`,
      footer: `<button class="btn ghost" data-cancel>${T('Cancel')}</button>`,
      onClose: () => { off(); api('accounts:cancelMicrosoft'); },
    });
    m.$('[data-cancel]').onclick = () => m.close();
    m.$('[data-reopen]').onclick = (e) => { e.preventDefault(); if (info.url) api('shell:open', info.url); };
    m.$('[data-code]').onclick = (e) => { e.preventDefault(); m.close(); microsoftLogin(parent, redraw, 'code'); };
    off = awaitLogin(m, redraw);
    return;
  }
  const m = modal({
    title: 'Sign in with Microsoft',
    body: `<p class="muted">On any device, open <b>${esc(info.verificationUri)}</b> and enter this code:</p><div class="code-box">${esc(info.userCode)}</div><div class="row" style="margin-top:14px"><div class="progress indeterminate grow"><div></div></div><span class="faint small">Waiting for you to finish signing in…</span></div>`,
    footer: `<button class="btn ghost" data-cancel>${T('Cancel')}</button><button class="btn primary" data-open>${icon('copy')}Copy code & open browser</button>`,
    onClose: () => { off(); api('accounts:cancelMicrosoft'); },
  });
  m.$('[data-open]').onclick = () => { api('clipboard:write', info.userCode); api('shell:open', info.verificationUri); };
  m.$('[data-cancel]').onclick = () => m.close();
  const off = awaitLogin(m, redraw);
}

/* ---------- new instance dialog ---------- */
const EMOJIS = ['🧱', '⛏️', '🗡️', '🏹', '🛡️', '🌲', '🌋', '🏰', '🐉', '🧪', '💎', '🔥', '❄️', '🌙', '⭐', '🚀', '🧭', '🌸', '🍄', '🐺', '🐝', '⚙️', '🎮', '🏝️', '🌊', '👾', 'sun'];
let versionCache = null;
async function getVersions() { if (!versionCache) versionCache = await api('versions:list'); return versionCache; }

async function openNewInstance(preset = {}) {
  const m = modal({
    title: T('New instance'),
    body: `<div class="stack">
      <div class="row" style="align-items:flex-start;gap:14px">
        <div id="ni-icon" style="cursor:pointer" title="Change icon"></div>
        <label class="field grow">Name<input type="text" id="ni-name" placeholder="My world" value="${esc(preset.name || '')}"></label>
      </div>
      <div class="row">
        <label class="field grow">Minecraft version<select id="ni-version"><option>Loading…</option></select></label>
        <label class="field" style="padding-top:20px;flex-direction:row;align-items:center"><input type="checkbox" id="ni-snap"> Snapshots &amp; old</label>
      </div>
      <label class="field">Mod loader<div class="seg" id="ni-loader"></div></label>
      <label class="field" id="ni-lv-wrap">Loader version<select id="ni-lv"></select></label>
      <div class="faint small" id="ni-note"></div>
    </div>`,
    footer: `<button class="btn ghost" data-import>${icon('upload')}${T('Import')}…</button><div class="grow"></div><button class="btn ghost" data-cancel>${T('Cancel')}</button><button class="btn primary" data-create>${icon('plus')}Create</button>`,
  });
  let loader = preset.loader || 'vanilla';
  // until the player picks one, the icon follows the loader: grass block for vanilla, crafting table for modded
  let iconPicked = !!preset.icon;
  const autoIcon = () => (McIcons.ready() ? (loader === 'vanilla' ? 'mc:grass_block' : 'mc:crafting_table') : '🧱');
  let chosenIcon = preset.icon || autoIcon();
  const drawIcon = () => (m.$('#ni-icon').innerHTML = instIcon({ icon: chosenIcon }, 'lg'));
  drawIcon();
  m.$('#ni-icon').onclick = async () => { const ic = await pickIcon(chosenIcon); if (ic) { chosenIcon = ic; iconPicked = true; drawIcon(); } };
  const syncIcon = () => { if (!iconPicked) { chosenIcon = autoIcon(); drawIcon(); } };
  const versions = await getVersions();
  const fillVersions = () => {
    const snap = m.$('#ni-snap').checked;
    m.$('#ni-version').innerHTML = versions.filter((v) => snap || v.type === 'release').map((v) => `<option value="${esc(v.id)}">${esc(v.id)}${v.type !== 'release' ? ' (' + v.type.replace('old_', '') + ')' : ''}</option>`).join('');
    if (preset.versionId) m.$('#ni-version').value = preset.versionId;
  };
  fillVersions();
  m.$('#ni-snap').onchange = () => { fillVersions(); refreshLoaders(); };
  const loaderTypes = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge', 'legacyfabric'];
  const support = {};
  const refreshLoaders = async () => {
    const mc = m.$('#ni-version').value;
    m.$('#ni-loader').innerHTML = loaderTypes.map((l) => `<button data-l="${l}" class="${l === loader ? 'on' : ''}" ${l !== 'vanilla' ? 'disabled style="opacity:.4"' : ''}>${LOADER_NAMES[l]}</button>`).join('');
    bindLoader();
    await Promise.all(loaderTypes.slice(1).map(async (l) => {
      try { support[l] = await api('loaders:versions', l, mc); } catch { support[l] = []; }
      if (m.$('#ni-version').value !== mc) return;
      const b = m.$(`[data-l="${l}"]`);
      if (b && support[l].length) { b.disabled = false; b.style.opacity = ''; }
      else if (b) b.title = `Not available for ${mc}`;
    }));
    if (loader !== 'vanilla' && !support[loader]?.length) loader = 'vanilla';
    $$('[data-l]', m.el).forEach((b) => b.classList.toggle('on', b.dataset.l === loader));
    fillLoaderVersions();
  };
  const bindLoader = () => $$('[data-l]', m.el).forEach((b) => (b.onclick = () => { loader = b.dataset.l; $$('[data-l]', m.el).forEach((x) => x.classList.toggle('on', x === b)); fillLoaderVersions(); syncIcon(); }));
  const fillLoaderVersions = () => {
    const wrap = m.$('#ni-lv-wrap');
    wrap.classList.toggle('hidden', loader === 'vanilla');
    const list = support[loader] || [];
    m.$('#ni-lv').innerHTML = list.slice(0, 200).map((v) => `<option value="${esc(v.version)}">${esc(v.label || v.version)}${v.recommended ? ' ★ recommended' : v.stable === false ? ' (beta)' : ''}</option>`).join('');
    const pick = list.find((v) => v.recommended) || list.find((v) => v.stable) || list[0];
    if (pick) m.$('#ni-lv').value = pick.version;
    m.$('#ni-note').textContent = loader === 'forge' || loader === 'neoforge' ? `${LOADER_NAMES[loader]} runs its official installer on first launch (needs a minute).` : '';
  };
  m.$('#ni-version').onchange = refreshLoaders;
  refreshLoaders();
  m.$('[data-cancel]').onclick = () => m.close();
  m.$('[data-import]').onclick = () => { m.close(); openImport(); };
  m.$('[data-create]').onclick = async (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;
    const versionId = m.$('#ni-version').value;
    if (!versionId || versionId === 'Loading…') return toast('Pick a Minecraft version first', 'warn');
    const name = m.$('#ni-name').value.trim() || `${LOADER_NAMES[loader]} ${versionId}`;
    if (loader !== 'vanilla' && !m.$('#ni-lv').value) return toast(`Pick a ${LOADER_NAMES[loader]} version first`, 'warn');
    btn.disabled = true;
    try {
      const inst = await api('instances:create', { name, versionId, loader: { type: loader, version: loader === 'vanilla' ? null : m.$('#ni-lv').value }, icon: chosenIcon });
      m.close();
      await refreshInstances();
      toast(`Created ${inst.name}`);
      Router.go('library', { spotlight: inst.id });
    } catch (er) { toastErr(er); btn.disabled = false; }
  };
  m.$('#ni-name').onkeydown = (e) => { if (e.key === 'Enter') m.$('[data-create]').click(); };
  m.$('#ni-name').focus();
}

/* ---------- import dialog ---------- */
function openImport() {
  const m = modal({
    title: T('Import'),
    body: `<div class="stack">
      <button class="btn" data-file style="justify-content:flex-start">${icon('box')}Modpack file (Modrinth .mrpack, CurseForge .zip, Solaris .solpack)</button>
      <button class="btn" data-official style="justify-content:flex-start">${icon('download')}Official Minecraft Launcher profiles</button>
      <button class="btn" data-mmc style="justify-content:flex-start">${icon('folder')}MultiMC / Prism Launcher instances folder</button>
      <button class="btn" data-cfapp style="justify-content:flex-start">${icon('layers')}CurseForge app instances</button>
      <div id="imp-list"></div>
      <div class="faint small">Tip: you can also drag & drop .mrpack / .zip / .solpack files anywhere in Solaris.</div></div>`,
  });
  m.$('[data-cfapp]').onclick = async () => {
    let items = await api('import:cfScan');
    let dir = null;
    if (!items.length) {
      [dir] = await api('dialog:open', { properties: ['openDirectory'], title: 'Select the CurseForge "Instances" folder (curseforge\\minecraft\\Instances)' });
      if (!dir) return;
      items = await api('import:cfScan', dir);
    }
    pickList(items, (keys) => api('import:cf', keys, dir));
  };
  m.$('[data-file]').onclick = async () => {
    const files = await api('dialog:open', { filters: [{ name: 'Modpacks', extensions: ['mrpack', 'zip', 'solpack'] }], properties: ['openFile', 'multiSelections'] });
    m.close();
    for (const f of files) await importFile(f);
  };
  const pickList = (items, onImport) => {
    m.$('#imp-list').innerHTML = items.length ? `<div class="list">${items.map((p, i) => `<label class="list-row"><input type="checkbox" data-k="${i}" checked><div class="info"><div class="title">${esc(p.name)}</div><div class="desc">${esc(p.lastVersionId || p.versionId || '')} ${p.loader ? '· ' + esc(LOADER_NAMES[p.loader.type]) : ''}</div></div></label>`).join('')}</div><button class="btn primary" style="margin-top:10px" data-go>Import selected</button>` : '<div class="empty small">Nothing found to import.</div>';
    if (items.length) m.$('[data-go]').onclick = async () => {
      const keys = $$('[data-k]', m.el).filter((c) => c.checked).map((c) => items[+c.dataset.k].key);
      try { const r = await onImport(keys); toast(`Imported ${r.length} instance(s)`); m.close(); await refreshInstances(); Router.go('library'); } catch (e) { toastErr(e); }
    };
  };
  m.$('[data-official]').onclick = async () => pickList(await api('import:officialScan'), (keys) => api('import:official', keys));
  m.$('[data-mmc]').onclick = async () => {
    const [dir] = await api('dialog:open', { properties: ['openDirectory'], title: 'Select the "instances" folder of MultiMC or Prism Launcher' });
    if (dir) pickList(await api('import:mmcScan', dir), (keys) => api('import:mmc', dir, keys));
  };
}
async function importFile(f) {
  try {
    State.tasks['import'] = { label: 'Importing ' + f.split(/[\\/]/).pop(), progress: null };
    Bus.emit('tasks');
    const inst = await api('instances:importFile', f);
    toast(`Imported ${inst.name}`);
    await refreshInstances();
    Router.go('library', { spotlight: inst.id });
  } catch (e) { toastErr(e); }
  finally { delete State.tasks['import']; Bus.emit('tasks'); }
}

/* ---------- choose instance dialog ---------- */
function chooseInstance({ title = 'Choose an instance', filter = () => true, note = '' } = {}) {
  return new Promise((resolve) => {
    const list = State.instances.filter(filter);
    let done = false;
    const m = modal({
      title,
      body: `${note ? `<p class="muted small">${esc(note)}</p>` : ''}${list.length ? `<div class="list">${list.map((i) => `<div class="list-row" style="cursor:pointer" data-id="${esc(i.id)}">${instIcon(i, 'sm')}<div class="info"><div class="title">${esc(i.name)}</div><div class="desc">${esc(i.versionId)} · ${loaderLabel(i)}</div></div>${icon('fwd')}</div>`).join('')}</div>` : '<div class="empty small">No compatible instances. Create one first.</div>'}`,
      footer: `<button class="btn" data-new>${icon('plus')}${T('New instance')}</button>`,
      onClose: () => { if (!done) resolve(null); },
    });
    $$('[data-id]', m.el).forEach((r) => (r.onclick = () => { done = true; m.close(); resolve(State.instances.find((i) => i.id === r.dataset.id)); }));
    m.$('[data-new]').onclick = () => { m.close(); openNewInstance(); };
  });
}

/* ---------- instance context menu ---------- */
function instanceMenu(e, inst) {
  e.preventDefault();
  contextMenu(e.clientX, e.clientY, [
    isRunning(inst.id) ? { label: T('Stop'), icon: 'stop', action: () => stopInstance(inst.id) } : { label: T('Play'), icon: 'play', action: () => play(inst.id) },
    { label: 'Open', icon: 'fwd', action: () => Router.go('instance', { id: inst.id }) },
    { label: inst.pinned ? 'Unpin' : 'Pin to top', icon: 'star', action: async () => { await api('instances:update', inst.id, { pinned: !inst.pinned }); refreshInstances(); } },
    { label: 'Open folder', icon: 'folder', action: () => api('instances:openFolder', inst.id) },
    { label: 'Change icon…', icon: 'image', action: () => changeInstanceIcon(inst) },
    '-',
    { label: 'Duplicate…', icon: 'copy', action: () => duplicateDialog(inst) },
    { label: 'Share (.solpack)', icon: 'share', action: () => api('instances:export', inst.id).catch(toastErr) },
    '-',
    { label: T('Delete'), icon: 'trash', danger: true, action: () => deleteInstance(inst) },
  ]);
}
/* ---------- icon picker: real Minecraft icons (from the player's own game files), emoji, or an image ---------- */
function pickIcon(current, { allowUpload = false } = {}) {
  return new Promise((resolve) => {
    let done = false, tab = 'mc', q = '';
    const m = modal({ title: 'Choose an icon', wide: true, body: `<div class="row" style="margin-bottom:12px"><div class="tabs" style="margin:0"><button data-pt="mc" class="on">Minecraft</button><button data-pt="emoji">Emoji</button></div><div class="search grow">${icon('search')}<input type="search" id="pi-q" placeholder="Search icons…"></div>${allowUpload ? `<button class="btn sm" data-up>${icon('upload')}Upload image…</button>` : ''}</div><div id="pi-body"></div>`,
      onClose: () => { if (!done) resolve(null); } });
    const finish = (v) => { done = true; m.close(); resolve(v); };
    const draw = () => {
      const box = m.$('#pi-body');
      if (tab === 'emoji') {
        box.innerHTML = `<div class="emoji-grid">${EMOJIS.map((e) => `<button data-v="${e}" class="${e === current ? 'on' : ''}" title="${e === 'sun' ? 'Solaris' : e}">${e === 'sun' ? '☀️' : e}</button>`).join('')}</div>`;
      } else if (!McIcons.ready()) {
        box.innerHTML = `<div class="empty">${icon('box')}<div><b>Minecraft icons load from your game files</b></div><div class="faint small" style="max-width:420px;margin:6px auto 12px">Solaris uses the real textures from a Minecraft version you've downloaded. Play any instance once, then come back — or try loading now.</div><button class="btn sm primary" data-load>${icon('refresh')}Load Minecraft icons</button></div>`;
        m.$('[data-load]').onclick = async (e) => { e.currentTarget.disabled = true; e.currentTarget.textContent = 'Loading…'; const ok = await McIcons.init({ force: true }); if (ok) Bus.emit('instances', State.instances); else toast('No downloaded Minecraft version found yet — play an instance once first.', 'warn', 6000); draw(); };
      } else {
        const list = McIcons.defs.filter(([k, label]) => McIcons.icons[k] && (!q || label.toLowerCase().includes(q) || k.includes(q)));
        box.innerHTML = list.length ? `<div class="mc-grid">${list.map(([k, label]) => `<button data-v="mc:${k}" class="${current === 'mc:' + k ? 'on' : ''}" title="${esc(label)}"><img src="${McIcons.icons[k]}" alt=""><span>${esc(label)}</span></button>`).join('')}</div><p class="faint small" style="margin-top:10px">Textures come from your own Minecraft ${esc(McIcons.source || '')} files.</p>` : '<div class="empty small">No icons match.</div>';
      }
      $$('[data-v]', box).forEach((b) => (b.onclick = () => finish(b.dataset.v)));
    };
    $$('[data-pt]', m.el).forEach((b) => (b.onclick = () => { tab = b.dataset.pt; $$('[data-pt]', m.el).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
    m.$('#pi-q').oninput = (e) => { q = e.target.value.toLowerCase().trim(); if (tab !== 'mc') { tab = 'mc'; $$('[data-pt]', m.el).forEach((x) => x.classList.toggle('on', x.dataset.pt === 'mc')); } draw(); };
    if (allowUpload) m.$('[data-up]').onclick = () => finish('__upload__');
    draw();
    m.$('#pi-q').focus();
  });
}
async function changeInstanceIcon(inst) {
  const ic = await pickIcon(inst.icon, { allowUpload: true });
  if (!ic) return;
  try {
    if (ic === '__upload__') await api('instances:setIcon', inst.id);
    else await api('instances:update', inst.id, { icon: ic });
    await refreshInstances();
  } catch (e) { toastErr(e); }
}
async function deleteInstance(inst) {
  if (isRunning(inst.id)) return toast(`Close ${inst.name} before deleting it.`, 'warn');
  if (!(await confirmDialog(`"${inst.name}" and its worlds will be moved to the Recycle Bin.`, { title: `Delete ${inst.name}?`, ok: T('Delete'), danger: true }))) return;
  try { await api('instances:delete', inst.id); } catch (e) { return toastErr(e); }
  toast('Instance moved to the Recycle Bin');
  await refreshInstances();
  if (Router.current?.name === 'instance') Router.go('library', {}, { replace: true });
}
function duplicateDialog(inst) {
  const parts = [['mods', 'Mods'], ['config', 'Config'], ['resourcepacks', 'Resource packs'], ['shaderpacks', 'Shaders'], ['saves', 'Worlds'], ['options.txt', 'Game options'], ['screenshots', 'Screenshots']];
  const m = modal({
    title: `Duplicate ${inst.name}`,
    body: `<div class="stack"><label class="field">New name<input type="text" id="dup-name" value="${esc(inst.name)} (copy)"></label>
      <div class="field">Copy<div class="row wrap">${parts.map(([k, l]) => `<label class="chip toggle on"><input type="checkbox" data-part="${k}" checked style="display:none">${l}</label>`).join('')}</div></div></div>`,
    footer: `<button class="btn ghost" data-cancel>${T('Cancel')}</button><button class="btn primary" data-go>${icon('copy')}Duplicate</button>`,
  });
  $$('.chip.toggle', m.el).forEach((c) => (c.onclick = (e) => { e.preventDefault(); const cb = c.querySelector('input'); cb.checked = !cb.checked; c.classList.toggle('on', cb.checked); }));
  m.$('[data-cancel]').onclick = () => m.close();
  m.$('[data-go]').onclick = async () => {
    const include = $$('[data-part]', m.el).filter((c) => c.checked).map((c) => c.dataset.part);
    try { const c = await api('instances:duplicate', inst.id, { name: m.$('#dup-name').value.trim(), include }); m.close(); await refreshInstances(); toast('Duplicated'); Router.go('library', { spotlight: c.id }); }
    catch (e) { toastErr(e); }
  };
}
