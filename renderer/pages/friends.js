/* Friends panel: a drawer that slides in beside the page (opened from the sidebar), with live statuses,
   friend requests, an "Add a friend" dialog and friends settings. */
const STATUS_TEXT = {
  singleplayer: () => 'In singleplayer',
  multiplayer: (f) => (f.server ? `Playing on ${f.server}` : 'In multiplayer'),
  playing: () => 'Playing Minecraft',
  launcher: () => 'In the launcher',
  offline: () => 'Offline',
};
const isOnline = (f) => f && f.status && f.status !== 'offline';
const statusText = (f) => (STATUS_TEXT[f.status] || STATUS_TEXT.offline)(f);

const Friends = {
  open: false,
  view: 'list', // list | settings
  data: null,
  skins: new Map(), // uuid -> Promise<skin info>
  prev: null, // uuid -> online, for "came online" toasts
  timer: null,

  init() {
    const d = document.createElement('aside');
    d.className = 'friends-drawer';
    d.id = 'friends-drawer';
    d.setAttribute('aria-label', 'Friends');
    $('.body').appendChild(d);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.open && !$('.modal-back')) this.toggle(false); });
    document.addEventListener('mousedown', (e) => {
      if (!this.open || $('.modal-back') || $('.ctx-menu')) return;
      if (!d.contains(e.target) && !e.target.closest('[data-friends-btn]')) this.toggle(false);
    });
    window.solaris.on('presence:self', () => { if (this.open) this.draw(); });
    Bus.on('accounts', () => { this.prev = null; this.refresh(); });
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 60000);
  },
  toggle(force) {
    this.open = force ?? !this.open;
    if (this.open) { this.view = 'list'; this.draw(); this.refresh(); }
    $('#friends-drawer').classList.toggle('open', this.open);
    renderNav();
  },
  /** Number shown on the sidebar button: incoming friend requests. */
  badge() { return this.data?.incoming?.length || 0; },

  async refresh() {
    let d;
    try { d = await api('friends:list'); } catch { return; }
    // toast when a friend comes online (not on the first load)
    const now = new Map(d.friends.map((f) => [f.uuid, isOnline(f)]));
    if (this.prev && State.settings.friendsNotify !== false) {
      for (const f of d.friends) if (now.get(f.uuid) && this.prev.get(f.uuid) === false) toast(`${f.name} is online · ${statusText(f)}`, 'info');
      const known = new Set((this.data?.incoming || []).map((r) => r.uuid));
      for (const r of d.incoming) if (!known.has(r.uuid)) toast(`${r.name} sent you a friend request`, 'info');
    }
    this.prev = now;
    this.data = d;
    renderNav();
    if (this.open) this.draw();
  },

  draw() {
    const el = $('#friends-drawer');
    if (!el) return;
    if (this.view === 'settings') return this.drawSettings(el);
    const d = this.data;
    el.innerHTML = `<header class="fd-head"><span class="fd-title">${icon('users')}<b>${T('Friends')}</b></span>
        <button class="icon-btn" data-fd-add title="Add a friend">${icon('userPlus')}</button>
        <button class="icon-btn" data-fd-refresh title="Refresh">${icon('refresh')}</button>
        <button class="icon-btn" data-fd-settings title="Friends settings">${icon('settings')}</button></header>
      <div class="fd-body">${!d ? '<div class="faint small fd-pad">Loading…</div>' : this.listHtml(d)}</div>`;
    el.querySelector('[data-fd-add]').onclick = () => this.addDialog();
    el.querySelector('[data-fd-settings]').onclick = () => { this.view = 'settings'; this.draw(); };
    el.querySelector('[data-fd-refresh]').onclick = (e) => this.checkOnline(e.currentTarget);
    if (!d) return;
    $$('[data-head]', el).forEach((h) => this.head(h, h.dataset.head));
    $$('[data-accept]', el).forEach((b) => (b.onclick = () => this.respond(b.dataset.accept, true)));
    $$('[data-decline]', el).forEach((b) => (b.onclick = () => this.respond(b.dataset.decline, false)));
    $$('[data-cancel-req]', el).forEach((b) => (b.onclick = () => this.respond(b.dataset.cancelReq, false)));
    $$('[data-friend]', el).forEach((row) => {
      const f = d.friends.find((x) => x.uuid === row.dataset.friend);
      row.oncontextmenu = (e) => { e.preventDefault(); this.menu(e, f); };
      row.querySelector('[data-more]').onclick = (e) => { e.stopPropagation(); this.menu(e, f); };
      const j = row.querySelector('[data-join]');
      if (j) j.onclick = (e) => { e.stopPropagation(); Pages.servers.join(f.server); };
    });
    const add2 = el.querySelector('[data-fd-add2]');
    if (add2) add2.onclick = () => this.addDialog();
    const set = el.querySelector('[data-fd-open-settings]');
    if (set) set.onclick = (e) => { e.preventDefault(); this.view = 'settings'; this.draw(); };
  },
  listHtml(d) {
    const row = (f) => `<div class="fd-row ${isOnline(f) ? 'on' : ''}" data-friend="${esc(f.uuid)}" title="${esc(f.note || f.name)}">
        <div class="head" data-head="${esc(f.uuid)}"></div>
        <div class="fd-meta"><b class="ellipsis">${esc(f.name)}</b><span class="fd-status ellipsis"><span class="dot ${isOnline(f) ? '' : 'off'}"></span>${esc(statusText(f))}</span></div>
        ${f.status === 'multiplayer' && f.server ? `<button class="icon-btn fd-join" data-join title="Join ${esc(f.server)}">${icon('play')}</button>` : ''}
        <button class="icon-btn fd-more" data-more title="More">${icon('more')}</button></div>`;
    const req = (r, out) => `<div class="fd-row req"><div class="head" data-head="${esc(r.uuid)}"></div>
        <div class="fd-meta"><b class="ellipsis">${esc(r.name)}</b><span class="fd-status">${out ? 'Request sent' : 'Wants to be friends'}</span></div>
        ${out ? `<button class="icon-btn" data-cancel-req="${esc(r.uuid)}" title="Cancel request">${icon('close')}</button>`
        : `<button class="icon-btn ok" data-accept="${esc(r.uuid)}" title="Accept">${icon('check')}</button><button class="icon-btn" data-decline="${esc(r.uuid)}" title="Decline">${icon('close')}</button>`}</div>`;
    let h = '';
    if (!d.participate) h += `<div class="fd-note">${icon('eye')}<span>You’re hidden from the friends list. <a href="#" data-fd-open-settings>Change</a></span></div>`;
    else if (d.error) h += `<div class="fd-note warn">${icon('alert')}<span>${esc(d.error)}</span></div>`;
    if (d.incoming.length) h += `<div class="fd-sec">Friend requests · ${d.incoming.length}</div>${d.incoming.map((r) => req(r, false)).join('')}`;
    const on = d.friends.filter(isOnline), off = d.friends.filter((f) => !isOnline(f));
    if (d.incoming.length || d.outgoing.length) h += `<div class="fd-sec">Friends</div>`;
    h += on.map(row).join('') + off.map(row).join('');
    if (!d.friends.length) h += `<div class="fd-empty">${icon('users')}<div>No friends yet</div><div class="faint small">Add players by their Minecraft username.</div><button class="btn sm primary" data-fd-add2>${icon('userPlus')}Add a friend</button></div>`;
    if (d.outgoing.length) h += `<div class="fd-sec">Pending</div>${d.outgoing.map((r) => req(r, true)).join('')}`;
    if (d.mode === 'local' && d.friends.length) h += `<p class="faint small fd-pad">Friends show as online when Astra sees them on a server you’ve checked. Press ${icon('refresh', 'inline')} to check now.</p>`;
    return h;
  },
  drawSettings(el) {
    const s = State.settings;
    const sw = (key, t, dsc) => `<label class="fd-set"><span class="txt"><b>${t}</b><small>${dsc}</small></span><span class="switch"><input type="checkbox" data-fs="${key}" ${s[key] !== false ? 'checked' : ''}><span></span></span></label>`;
    el.innerHTML = `<header class="fd-head"><span class="fd-title">${icon('users')}<b>${T('Friends')}</b></span><button class="icon-btn" data-fd-back title="Back">${icon('arrowLeft')}</button></header>
      <div class="fd-body fd-settings">
        <div class="fd-card">${sw('friendsParticipate', 'Participate in friends list', 'Let others see you and add you as a friend.')}${sw('friendsAllowRequests', 'Allow friend requests', 'Let other players send you friend requests.')}</div>
        <div class="fd-card">${sw('friendsNotify', 'Online notifications', 'Show a toast when a friend comes online.')}</div>
        ${this.data && !this.data.serviceAvailable ? '<p class="faint small fd-pad">Friend requests and live statuses need the friends service, which isn’t set up in this version yet. Until then, your friends list is kept on this computer.</p>' : ''}
      </div>`;
    el.querySelector('[data-fd-back]').onclick = () => { this.view = 'list'; this.draw(); };
    $$('[data-fs]', el).forEach((c) => (c.onchange = async () => {
      await saveSettings({ [c.dataset.fs]: c.checked });
      if (c.dataset.fs === 'friendsParticipate') this.refresh();
    }));
  },

  addDialog() {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal add-friend" role="dialog" aria-label="Add a friend">
      <header><span class="af-ic">${icon('userPlus')}</span><h2>Add a friend</h2><button class="icon-btn" data-close title="Close">${icon('close')}</button></header>
      <div class="content"><input type="text" id="af-name" placeholder="Username" maxlength="16" spellcheck="false" autocomplete="off"><div class="af-err" id="af-err"></div></div>
      <footer><button class="btn" data-cancel>${T('Cancel')}</button><button class="btn primary" data-add disabled>${icon('userPlus')}Add</button></footer></div>`;
    document.body.appendChild(back);
    const inp = back.querySelector('#af-name'), add = back.querySelector('[data-add]'), err = back.querySelector('#af-err');
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    back.querySelector('[data-close]').onclick = close;
    back.querySelector('[data-cancel]').onclick = close;
    inp.oninput = () => { add.disabled = !/^[A-Za-z0-9_]{2,16}$/.test(inp.value.trim()); err.textContent = ''; };
    const submit = async () => {
      if (add.disabled) return;
      add.disabled = true; add.innerHTML = `${icon('refresh', 'spin')}Adding…`;
      try {
        const name = inp.value.trim();
        const d = await api('friends:add', name);
        this.data = d; renderNav(); if (this.open) this.draw();
        toast(d.mode === 'online' ? `Friend request sent to ${name}` : `${name} added to your friends`);
        close();
      } catch (e) { err.textContent = e.message; add.disabled = false; add.innerHTML = `${icon('userPlus')}Add`; inp.focus(); }
    };
    inp.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
    add.onclick = submit;
    inp.focus();
  },
  async respond(uuid, ok) {
    try { this.data = await api('friends:respond', uuid, ok); this.prev = null; renderNav(); this.draw(); this.refresh(); }
    catch (e) { toastErr(e); }
  },
  async checkOnline(b) {
    b.disabled = true; b.classList.add('spinning');
    try {
      // local mode: ping your servers so friends seen in their player lists show as online
      if (this.data?.mode !== 'online') {
        const d = await api('servers:list');
        const addrs = [...new Set([...d.servers.map((s) => s.address), ...d.featured.map((s) => s.address)])];
        await Promise.all(addrs.map((a) => api('servers:ping', a).catch(() => null)));
      }
      await this.refresh();
    } finally { b.disabled = false; b.classList.remove('spinning'); }
  },
  menu(e, f) {
    const items = [];
    if (f.status === 'multiplayer' && f.server) items.push({ label: `Join ${f.server}`, icon: 'play', action: () => Pages.servers.join(f.server) });
    items.push(
      { label: 'Save skin to wardrobe', icon: 'skins', action: async () => { try { await api('skins:addFromUsername', f.name); toast(`${f.name}’s skin added to your wardrobe`); } catch (er) { toastErr(er); } } },
      { label: 'Copy name', icon: 'copy', action: () => { api('clipboard:write', f.name); toast('Name copied'); } },
      { label: f.note ? 'Edit note' : 'Add note', icon: 'edit', action: async () => { const n = await promptDialog(`Note for ${f.name}`, { value: f.note || '', placeholder: 'e.g. plays on Hypixel', ok: T('Save') }); if (n !== null && n !== undefined) { await api('friends:note', f.uuid, n, f.name); this.refresh(); } } },
      '-',
      { label: 'Remove friend', icon: 'trash', danger: true, action: async () => { if (await confirmDialog(`Remove ${f.name} from your friends?`, { danger: true, ok: 'Remove' })) { this.data = await api('friends:remove', f.uuid); this.draw(); } } },
    );
    contextMenu(e.clientX, e.clientY, items);
  },
  /** Draw a friend's head from their real skin (falls back to their default skin). */
  head(el, uuid) {
    if (!this.skins.has(uuid)) this.skins.set(uuid, api('friends:skin', uuid).catch(() => null));
    this.skins.get(uuid).then((s) => { if (el.isConnected) renderHead(el, { uuid, name: s?.name || '?', skinUrl: s?.url || null }); });
  },
};
