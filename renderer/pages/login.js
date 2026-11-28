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
    this.setTab('choose');
    this.drawSaved();
    await loadSkinview();
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

  // One centered card on the night sky: "Welcome to Astra — add a new account to continue", with a Microsoft and an
  // Offline button. Offline opens the username step inside the same card.
  build() {
    const el = document.createElement('section');
    el.id = 'auth-gate';
    el.className = 'ag-sky starfield';
    el.hidden = true;
    el.innerHTML = `
      <div class="ag-box">
        <div class="ag-pane" data-pane="choose">
          <img class="ag-logo" src="../assets/icon.png" alt="">
          <h1>Welcome to Astra</h1>
          <p class="muted">Add a new account to continue</p>
          <div class="ag-saved" id="ag-saved"></div>
          <div class="ag-choice">
            <button class="btn ag-ms" id="ag-ms">${MS_LOGO}Microsoft</button>
            <button class="btn ag-off-btn" id="ag-to-off"><img src="../assets/icon.png" alt="">Offline</button>
          </div>
          <p class="faint small ag-sub" id="ag-ms-note"></p>
          <p class="faint small ag-sub"><a href="#" id="ag-code">Sign in with a code instead</a></p>
        </div>
        <div class="ag-pane" data-pane="offline" hidden>
          <button class="icon-btn ag-back" id="ag-back" title="Back">${icon('back')}</button>
          <img class="ag-logo" src="../assets/icon.png" alt="">
          <h1>Play offline</h1>
          <p class="muted">Pick a username for this PC</p>
          <label class="ag-field">
            <div class="ag-input"><input type="text" id="ag-off" maxlength="16" spellcheck="false" autocomplete="off" placeholder="Username"><em id="ag-count">0/16</em></div>
            <small id="ag-hint" class="faint">3–16 characters: letters, numbers or _</small>
          </label>
          <button class="btn primary lg ag-go" id="ag-play" disabled>${icon('play')}Play offline</button>
          <p class="faint small ag-sub">Offline accounts play singleplayer and offline-mode servers. Online servers and custom skins need a Microsoft account that owns Minecraft.</p>
        </div>
        <div class="ag-name" id="ag-name" hidden></div>
      </div>
      <div class="ag-legal"><span>© ${new Date().getFullYear()} Astra · <a href="#" id="ag-buy">Don’t own Minecraft? Get it at minecraft.net</a></span><span>NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.</span></div>
      <div class="ag-corner" id="ag-ver"></div>`;
    $('#app').appendChild(el);
    this.el = el;

    $('#ag-ver', el).textContent = State.info?.version ? 'v' + State.info.version : '';
    $('#ag-buy', el).onclick = (e) => { e.preventDefault(); api('shell:open', 'https://www.minecraft.net/store/minecraft-java-bedrock-edition-pc'); };
    $('#ag-ms', el).onclick = () => this.msOk && microsoftLogin(null, null);
    $('#ag-code', el).onclick = (e) => { e.preventDefault(); if (this.msOk) microsoftLogin(null, null, 'code'); };
    $('#ag-to-off', el).onclick = () => this.setTab('offline');
    $('#ag-back', el).onclick = () => this.setTab('choose');

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

  /** 'choose' (Microsoft / Offline) or 'offline' (the username step). 'microsoft' is the choose step too. */
  setTab(tab) {
    if (tab !== 'offline') tab = 'choose';
    this.tab = tab;
    $$('[data-pane]', this.el).forEach((p) => (p.hidden = p.dataset.pane !== tab));
    const ms = $('#ag-ms', this.el);
    ms.disabled = !this.msOk;
    const note = $('#ag-ms-note', this.el);
    note.textContent = this.msOk ? '' : 'Microsoft sign-in isn’t available in this version of Astra yet — play offline meanwhile.';
    note.hidden = this.msOk;
    $('#ag-code', this.el).parentElement.hidden = !this.msOk;
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
      if (!(await confirmDialog('Remove this account from Astra?', { danger: true, ok: 'Remove' }))) return;
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
