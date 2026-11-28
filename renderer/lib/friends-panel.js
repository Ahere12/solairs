/* Friends panel: slides out from the people icon next to the account. A compact list of the players you follow with
   live status, "Add a friend", a refresh, and its own settings. The full Friends page (play together, invites, notes)
   is one click away. The people icon shows how many friends are online.

   Java Edition has no official friends service: a friend is "online" when Astra sees them in the player list of a
   server it checks (your own servers live; your saved servers and Discover servers when it pings them). */
const USER_PLUS = '<svg class="i" viewBox="0 0 24 24"><circle cx="9" cy="8" r="4"/><path d="M2 21c.8-3.8 3.6-6 7-6s6.2 2.2 7 6M19 8v6M16 11h6"/></svg>';

const FriendsPanel = {
  el: null,
  list: [],
  view: 'list', // 'list' | 'settings'
  online: null, // Set of uuids online at the last check (null until the first load)
  checking: false,

  /** Started once at boot: keeps the badge and "came online" toasts current even while the panel is closed. */
  init() {
    this.refresh(false);
    setInterval(() => this.refresh(true), 60 * 1000); // local list + live players on your own servers: cheap
    setInterval(() => { if (State.settings?.friendsAutoCheck !== false && this.list.length) this.checkServers(true); }, 5 * 60 * 1000);
    Bus.on('accounts', () => { this.online = null; this.refresh(false); });
    Bus.on('route', () => this.close());
  },

  isOpen() { return !!this.el && !this.el.hidden; },
  toggle() { this.isOpen() ? this.close() : this.open(); },

  open() {
    if (!this.el) this.build();
    this.view = 'list';
    this.place();
    this.el.hidden = false;
    requestAnimationFrame(() => this.el.classList.add('in'));
    $('#who-friends')?.classList.add('on');
    this.draw();
    this.refresh(true);
  },
  close() {
    if (!this.isOpen()) return;
    this.el.classList.remove('in');
    $('#who-friends')?.classList.toggle('on', Router.current?.name === 'friends');
    setTimeout(() => { if (this.el && !this.el.classList.contains('in')) this.el.hidden = true; }, 180);
  },

  /** Sits right next to the sidebar, full height, like a second column. */
  place() {
    const side = $('.sidebar')?.getBoundingClientRect();
    if (side) { this.el.style.left = Math.round(side.right + 8) + 'px'; this.el.style.top = Math.round(side.top) + 'px'; this.el.style.bottom = Math.round(innerHeight - side.bottom) + 'px'; }
  },

  build() {
    const el = document.createElement('aside');
    el.id = 'friends-panel';
    el.hidden = true;
    el.setAttribute('aria-label', 'Friends');
    document.body.appendChild(el);
    this.el = el;
    // click outside closes it (the people icon toggles it itself)
    document.addEventListener('mousedown', (e) => {
      if (!this.isOpen() || el.contains(e.target) || e.target.closest('#who-friends') || e.target.closest('.modal-back,.ctx-menu')) return;
      this.close();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isOpen() && !$('.modal-back')) this.close(); });
    addEventListener('resize', () => this.isOpen() && this.place());
  },

  /** Reloads the list (and tells about friends who just came online). quiet=false: first load, no toasts. */
  async refresh(notify) {
    let list;
    try { list = await api('friends:list'); } catch { return; }
    this.apply(list, notify);
  },
  /** Takes a fresh friends list: toasts for friends who came online since the last one, badge, redraw. */
  apply(list, notify) {
    const now = new Set(list.filter((f) => f.online).map((f) => f.uuid));
    if (notify && this.online && State.settings?.friendsNotify !== false) {
      for (const f of list) if (f.online && !this.online.has(f.uuid)) {
        toast(`${f.name} is online — ${f.online.yourServer ? `on your server ${f.online.yourServer}` : `playing on ${f.online.server}`}`, 'info');
      }
    }
    this.online = now;
    this.list = list;
    this.badge();
    if (this.isOpen() && this.view === 'list') this.draw();
  },

  badge() {
    const b = $('#who-friends'); if (!b) return;
    const n = this.online ? this.online.size : 0;
    let c = b.querySelector('.fr-count');
    if (!n) { c?.remove(); b.title = T('Friends'); return; }
    if (!c) { c = document.createElement('span'); c.className = 'fr-count'; b.appendChild(c); }
    c.textContent = n > 9 ? '9+' : String(n);
    b.title = `${T('Friends')} — ${n} online`;
  },

  status(f) {
    if (!f.online) return { cls: 'off', text: 'Offline' };
    if (f.online.yourServer) return { cls: 'on', text: `On your server ${f.online.yourServer}` };
    return { cls: 'on', text: `Playing on ${f.online.server}` };
  },

  draw() {
    if (!this.el) return;
    if (this.view === 'settings') return this.drawSettings();
    const s = State.settings || {};
    const shown = this.list.filter((f) => f.online || s.friendsShowOffline !== false);
    const hidden = this.list.length - shown.length;
    this.el.innerHTML = `
      <header class="fp-head"><span class="fp-title">${icon('users')}<b>${esc(T('Friends'))}</b></span>
        <button class="icon-btn" data-fp="add" title="Add a friend">${USER_PLUS}</button>
        <button class="icon-btn ${this.checking ? 'spinning' : ''}" data-fp="check" title="Check who’s online">${icon('refresh')}</button>
        <button class="icon-btn" data-fp="settings" title="Friends settings">${icon('settings')}</button></header>
      <div class="fp-list">${shown.map((f) => {
        const st = this.status(f);
        return `<button class="fp-row" data-fr="${esc(f.uuid)}" title="${esc(f.note || f.name)}"><span class="head" data-head="${esc(f.uuid)}"></span>
          <span class="fp-who"><b class="ellipsis">${esc(f.name)}</b><small class="ellipsis"><i class="fp-dot ${st.cls}"></i>${esc(st.text)}</small></span>
          ${f.online ? `<span class="fp-join" data-join="${esc(f.online.server)}" title="Join ${esc(f.name)}">${icon('play')}</span>` : ''}</button>`;
      }).join('') || `<div class="fp-empty">${icon('users')}<b>${this.list.length ? 'No friends online' : 'No friends yet'}</b><span>${this.list.length ? 'Offline friends are hidden (Friends settings).' : 'Add players by their Minecraft username.'}</span>${this.list.length ? '' : `<button class="btn sm primary" data-fp="add">${USER_PLUS}Add a friend</button>`}</div>`}
        ${hidden && shown.length ? `<div class="fp-more faint small">${hidden} offline friend${hidden === 1 ? '' : 's'} hidden</div>` : ''}</div>
      <footer class="fp-foot"><a href="#" data-fp="page">Play together, invites & notes ${icon('fwd')}</a></footer>`;
    $$('[data-head]', this.el).forEach((h) => {
      const f = this.list.find((x) => x.uuid === h.dataset.head);
      if (f?.offline) renderHead(h, { uuid: f.uuid, name: f.name, skinUrl: null }); else Pages.friends.head(h, h.dataset.head);
    });
    $$('[data-fp]', this.el).forEach((b) => (b.onclick = (e) => { e.preventDefault(); this.action(b.dataset.fp, e); }));
    $$('[data-join]', this.el).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); this.close(); Pages.servers.join(b.dataset.join); }));
    $$('[data-fr]', this.el).forEach((b) => (b.onclick = (e) => this.menu(e, this.list.find((x) => x.uuid === b.dataset.fr))));
    $$('[data-fr]', this.el).forEach((b) => (b.oncontextmenu = (e) => { e.preventDefault(); this.menu(e, this.list.find((x) => x.uuid === b.dataset.fr)); }));
  },

  drawSettings() {
    const s = State.settings || {};
    const row = (key, title, desc) => `<label class="fp-set"><span><b>${title}</b><small>${desc}</small></span><span class="switch"><input type="checkbox" data-set="${key}" ${s[key] !== false ? 'checked' : ''}><span></span></span></label>`;
    this.el.innerHTML = `
      <header class="fp-head"><span class="fp-title">${icon('users')}<b>${esc(T('Friends'))}</b></span><button class="icon-btn" data-fp="back" title="Back">${icon('back')}</button></header>
      <div class="fp-sets">
        <div class="fp-group">
          ${row('friendsAutoCheck', 'Check who’s online', 'Every 5 minutes, look for your friends on your saved and Discover servers.')}
          ${row('friendsShowOffline', 'Show offline friends', 'List friends who aren’t online right now.')}
        </div>
        <div class="fp-group">
          ${row('friendsNotify', 'Online notifications', 'Show a toast when a friend comes online.')}
        </div>
        <p class="faint small fp-note">Minecraft: Java Edition has no official friends service, so Astra sees friends when they play on a server it checks — and live on servers you host.</p>
      </div>`;
    $('[data-fp="back"]', this.el).onclick = () => { this.view = 'list'; this.draw(); };
    $$('[data-set]', this.el).forEach((c) => (c.onchange = async () => { await saveSettings({ [c.dataset.set]: c.checked }); }));
  },

  async action(what, e) {
    if (what === 'add') return this.addDialog();
    if (what === 'check') return this.checkServers(false);
    if (what === 'settings') { this.view = 'settings'; return this.draw(); }
    if (what === 'page') { this.close(); return Router.go('friends'); }
  },

  /** Pings the servers friends may be on (saved + Discover), then reloads. quiet: no "nobody online" toast. */
  async checkServers(quiet) {
    if (this.checking) return;
    this.checking = true; if (this.isOpen() && this.view === 'list') this.draw();
    try {
      const d = await api('servers:list');
      const addrs = [...new Set([...(d.servers || []).map((s) => s.address), ...(d.featured || []).map((s) => s.address)])];
      await Promise.all(addrs.map((a) => api('servers:ping', a).catch(() => null)));
      await this.refresh(true);
      if (!quiet) { const n = this.online?.size || 0; toast(n ? `${n} friend${n > 1 ? 's' : ''} online` : 'None of your friends were seen online', n ? 'ok' : 'info'); }
    } finally { this.checking = false; if (this.isOpen() && this.view === 'list') this.draw(); }
  },

  menu(e, f) {
    if (!f) return;
    contextMenu(e.clientX, e.clientY, [
      ...(f.online ? [{ label: `Join ${f.name}`, icon: 'play', action: () => { this.close(); Pages.servers.join(f.online.server); } }] : []),
      ...(f.offline ? [] : [{ label: 'Save skin to wardrobe', icon: 'skins', action: async () => { try { await api('skins:addFromUsername', f.name); toast(`${f.name}’s skin added to your wardrobe`); } catch (er) { toastErr(er); } } }]),
      { label: 'Copy name', icon: 'copy', action: () => { api('clipboard:write', f.name); toast('Name copied'); } },
      { label: 'Edit note', icon: 'edit', action: async () => { const n = await promptDialog(`Note for ${f.name}`, { value: f.note || '', placeholder: 'e.g. plays on Hypixel', ok: T('Save') }); if (n !== null && n !== undefined) { this.list = await api('friends:note', f.uuid, n); this.draw(); } } },
      '-',
      { label: 'Remove friend', icon: 'trash', danger: true, action: async () => { if (await confirmDialog(`Remove ${f.name} from your friends?`, { danger: true, ok: 'Remove' })) { this.list = await api('friends:remove', f.uuid); this.online = new Set(this.list.filter((x) => x.online).map((x) => x.uuid)); this.badge(); this.draw(); } } },
    ]);
  },

  /** "Add a friend": just the username. The button turns on once it's a valid Minecraft name. */
  addDialog() {
    const m = modal({
      title: 'Add a friend',
      body: `<input type="text" id="af-name" class="af-input" maxlength="16" placeholder="Username" spellcheck="false" autocomplete="off">
        <label class="af-off"><input type="checkbox" id="af-off"><span>They play with an offline (cracked) account</span></label>`,
      footer: `<button class="btn ghost" data-x>${T('Cancel')}</button><button class="btn primary" data-go disabled>${USER_PLUS}Add</button>`,
    });
    m.el.classList.add('af-modal');
    m.el.querySelector('header').insertAdjacentHTML('afterbegin', `<span class="af-ic">${USER_PLUS}</span>`);
    const input = m.$('#af-name'), go = m.$('[data-go]');
    input.oninput = () => { const v = input.value.replace(/[^A-Za-z0-9_]/g, ''); if (v !== input.value) input.value = v; go.disabled = !/^[A-Za-z0-9_]{1,16}$/.test(v); };
    const add = async () => {
      if (go.disabled) return;
      const n = input.value.trim();
      go.disabled = true; go.innerHTML = `${icon('refresh', 'spin')}Adding…`;
      try {
        this.list = await api('friends:add', n, { offline: m.$('#af-off').checked });
        m.close(); toast(`${n} added`);
        this.online = new Set(this.list.filter((x) => x.online).map((x) => x.uuid)); this.badge();
        if (this.isOpen()) this.draw();
        Bus.emit('friends');
      } catch (er) { toastErr(er); go.disabled = false; go.innerHTML = `${USER_PLUS}Add`; }
    };
    m.$('[data-x]').onclick = () => m.close();
    go.onclick = add;
    input.onkeydown = (e) => { if (e.key === 'Enter') add(); };
    setTimeout(() => input.focus(), 50);
  },
};
