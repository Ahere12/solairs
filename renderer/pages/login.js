/* Sign-in gate: a full-window Microsoft / Offline login that must be completed before the launcher can be used.
   Shown whenever no account is active (first start, after signing out, or after removing the last account). */
const AuthGate = {
  el: null,
  viewer: null,
  tab: null,
  msOk: false,
  _seq: 0,

  isOpen() { return !!this.el && !this.el.hidden; },

  /** Shows or hides the gate to match the current account state. */
  sync() {
    if (State.accounts?.active) this.hide();
    else this.show();
  },

  async show() {
    if (this.isOpen()) { this.drawSaved(); this.previewName($('#ag-off', this.el).value); return; }
    if (!this.el) this.build();
    document.body.classList.add('gated');
    this.el.hidden = false;
    this.el.classList.remove('leaving');
    this.msOk = await api('accounts:microsoftAvailable').catch(() => false);
    this.setTab(this.tab || (this.msOk ? 'microsoft' : 'offline'));
    this.drawSaved();
    this.startViewer();
    const input = $('#ag-off', this.el);
    input.value = '';
    input.dispatchEvent(new Event('input')); // fresh form: empty name, button off, Steve preview
    this.previewName('');
  },

  hide() {
    if (!this.isOpen()) return;
    this.el.classList.add('leaving');
    setTimeout(() => Updater.whatsNew(), 450);
    document.body.classList.remove('gated');
    setTimeout(() => {
      if (!State.accounts?.active) return; // signed out again meanwhile
      this.el.hidden = true;
      this.el.classList.remove('leaving');
      this.stopViewer();
    }, 380);
  },

  build() {
    const el = document.createElement('section');
    el.id = 'auth-gate';
    el.hidden = true;
    el.innerHTML = `
      <div class="ag-art">
        <div class="ag-sun" aria-hidden="true"></div>
        <div class="ag-brand"><img src="../assets/icon.png" alt=""><div><b>Solaris</b><span>Minecraft: Java Edition launcher</span></div></div>
        <div class="ag-stage"><canvas id="ag-skin"></canvas><div class="ag-floor"></div></div>
        <div class="ag-name" id="ag-name"></div>
      </div>
      <div class="ag-panel">
        <div class="ag-card">
          <h1>Welcome</h1>
          <p class="muted">Sign in to start playing. You can add more accounts later.</p>
          <div class="ag-saved" id="ag-saved"></div>
          <div class="ag-tabs" role="tablist">
            <button role="tab" data-tab="microsoft">${MS_LOGO}<span>Microsoft</span></button>
            <button role="tab" data-tab="offline">${icon('user')}<span>Offline</span></button>
            <i class="ag-tab-ink"></i>
          </div>
          <div class="ag-pane" data-pane="microsoft">
            <button class="btn lg ag-ms" id="ag-ms">${MS_LOGO}Sign in with Microsoft</button>
            <p class="faint small" id="ag-ms-note"></p>
            <ul class="ag-perks">
              <li>${icon('check')}Online servers & Realms</li>
              <li>${icon('check')}Your own skin and capes</li>
              <li>${icon('check')}Solaris never sees your password</li>
            </ul>
            <p class="faint small"><a href="#" id="ag-code">Sign in with a code instead</a> — for when the browser can't reach this PC.</p>
          </div>
          <div class="ag-pane" data-pane="offline">
            <label class="ag-field">
              <span>Username</span>
              <div class="ag-input"><input type="text" id="ag-off" maxlength="16" spellcheck="false" autocomplete="off" placeholder="Steve"><em id="ag-count">0/16</em></div>
              <small id="ag-hint" class="faint">3–16 characters: letters, numbers or _</small>
            </label>
            <button class="btn primary lg ag-go" id="ag-play" disabled>${icon('play')}Play offline</button>
            <p class="faint small">Offline accounts play singleplayer and offline-mode servers. Online servers and custom skins need a Microsoft account that owns Minecraft.</p>
          </div>
        </div>
        <div class="ag-foot faint small"><span id="ag-ver"></span><a href="#" id="ag-buy">Don't own Minecraft? Get it at minecraft.net</a></div>
      </div>`;
    $('#app').appendChild(el);
    this.el = el;

    $$('[data-tab]', el).forEach((b) => (b.onclick = () => this.setTab(b.dataset.tab)));
    $('#ag-ver', el).textContent = State.info?.version ? 'Solaris ' + State.info.version : 'Solaris';
    $('#ag-buy', el).onclick = (e) => { e.preventDefault(); api('shell:open', 'https://www.minecraft.net/store/minecraft-java-bedrock-edition-pc'); };
    $('#ag-ms', el).onclick = () => this.msOk && microsoftLogin(null, null);
    $('#ag-code', el).onclick = (e) => { e.preventDefault(); if (this.msOk) microsoftLogin(null, null, 'code'); };

    const input = $('#ag-off', el);
    const preview = debounce((v) => this.previewName(v), 220);
    input.oninput = () => {
      const v = input.value.replace(/[^A-Za-z0-9_]/g, '');
      if (v !== input.value) input.value = v;
      const ok = /^[A-Za-z0-9_]{3,16}$/.test(v);
      $('#ag-count', el).textContent = `${v.length}/16`;
      $('#ag-play', el).disabled = !ok;
      $('.ag-input', el).classList.toggle('ok', ok);
      $('#ag-hint', el).textContent = v && !ok ? 'At least 3 characters' : '3–16 characters: letters, numbers or _';
      preview(v);
    };
    input.onkeydown = (e) => { if (e.key === 'Enter' && !$('#ag-play', el).disabled) this.playOffline(); };
    $('#ag-play', el).onclick = () => this.playOffline();
  },

  setTab(tab) {
    this.tab = tab;
    $$('[data-tab]', this.el).forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $$('[data-pane]', this.el).forEach((p) => (p.hidden = p.dataset.pane !== tab));
    this.el.querySelector('.ag-tabs').dataset.on = tab;
    const ms = $('#ag-ms', this.el);
    ms.disabled = !this.msOk;
    $('#ag-ms-note', this.el).textContent = this.msOk
      ? 'Opens Microsoft’s secure sign-in page in your browser. Use the account that owns Minecraft: Java Edition.'
      : 'Microsoft sign-in isn’t available in this version of Solaris yet. You can play offline meanwhile.';
    if (tab === 'offline') setTimeout(() => $('#ag-off', this.el)?.focus(), 30);
  },

  /** Accounts that were signed out but are still saved: one click to continue. */
  drawSaved() {
    const box = $('#ag-saved', this.el);
    const accts = State.accounts?.accounts || [];
    box.innerHTML = accts.length ? `<div class="faint small ag-label">Continue as</div>${accts.map((a) => `
      <div class="ag-acct"><button class="ag-acct-use" data-use="${esc(a.id)}"><span class="head" data-head="${esc(a.id)}"></span><span class="t"><b>${esc(a.name)}</b><small>${a.type === 'msa' ? 'Microsoft' : 'Offline'}${a.needsReauth ? ' · session expired' : ''}</small></span>${icon('fwd')}</button>
      <button class="icon-btn" data-forget="${esc(a.id)}" title="Remove from this PC">${icon('trash')}</button></div>`).join('')}
      <div class="ag-or"><span>or add another account</span></div>` : '';
    $$('[data-head]', box).forEach((h) => renderHead(h, accts.find((a) => a.id === h.dataset.head)));
    $$('[data-use]', box).forEach((b) => (b.onclick = async () => {
      const a = accts.find((x) => x.id === b.dataset.use);
      if (a?.needsReauth && this.msOk) { this.setTab('microsoft'); return microsoftLogin(null, null); }
      await api('accounts:setActive', b.dataset.use); await refreshAccounts();
    }));
    $$('[data-forget]', box).forEach((b) => (b.onclick = async () => {
      if (!(await confirmDialog('Remove this account from Solaris?', { danger: true, ok: 'Remove' }))) return;
      await api('accounts:remove', b.dataset.forget);
      await api('accounts:setActive', null); // removing must not sign anyone else in
      await refreshAccounts();
    }));
  },

  async playOffline() {
    const btn = $('#ag-play', this.el);
    const name = $('#ag-off', this.el).value.trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return;
    btn.disabled = true;
    const warnings = await api('accounts:checkOfflineName', name).catch(() => []);
    if (warnings.length && !(await confirmDialog(`${warnings.map((w) => '• ' + w).join('\n')}\n\nUse “${name}” anyway?`, { title: 'Unusual offline username', ok: 'Use anyway' }))) { btn.disabled = false; return; }
    try { await api('accounts:addOffline', name); await refreshAccounts(); toast(`Welcome, ${name}!`); }
    catch (e) { toastErr(e); btn.disabled = false; }
  },

  /* ---------- 3D player preview (skinview3d) ---------- */
  startViewer() {
    if (this.viewer || !window.skinview3d) return;
    try {
      const v = new skinview3d.SkinViewer({ canvas: $('#ag-skin', this.el), width: 300, height: 420 });
      v.zoom = 0.78;
      v.fov = 40;
      v.controls.enableZoom = false;
      if (!State.settings?.lowEndMode) { v.autoRotate = true; v.autoRotateSpeed = 0.5; v.animation = new skinview3d.IdleAnimation(); }
      this.viewer = v;
    } catch (e) { console.warn(e); }
  },
  stopViewer() { try { this.viewer?.dispose(); } catch {} this.viewer = null; },

  /** Shows the default skin Minecraft would give this offline name (or Steve while empty). */
  async previewName(name) {
    const seq = ++this._seq;
    $('#ag-name', this.el).textContent = name || '';
    if (!this.viewer) return;
    let skin = null;
    if (/^[A-Za-z0-9_]{3,16}$/.test(name)) {
      const uuid = await api('accounts:offlineUuid', name).catch(() => null);
      if (seq !== this._seq) return;
      skin = uuid ? McIcons.skinForUuid(uuid) : null;
    }
    skin = skin || McIcons.defaultSkin('steve', 'wide');
    this.el.classList.toggle('no-skin', !skin);
    if (skin) this.viewer.loadSkin(skin.src, { model: skin.model === 'slim' ? 'slim' : 'default' }).catch(() => {});
  },
};

Bus.on('accounts', () => AuthGate.sync());
