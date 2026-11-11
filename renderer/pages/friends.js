/* Friends: players you follow, with their real skins and live "seen on server" status. */
Pages.friends = {
  skins: new Map(), // uuid -> Promise<skin info>
  async render(el, params, ctx) {
    const acct = State.accounts.accounts.find((a) => a.id === State.accounts.active);
    el.innerHTML = `
      <div class="page-head"><div><h1>${T('Friends')}</h1><div class="sub">Players you follow${acct ? ` · list for <b>${esc(acct.name)}</b>` : ''}</div></div>
        <div class="actions"><button class="btn" id="fr-status">${icon('refresh')}Check who’s online</button><button class="btn primary" id="fr-add">${icon('plus')}Add friend</button></div></div>
      ${acct?.type !== 'msa' ? `<div class="card notice" style="margin-bottom:12px">${icon('info')}<span>Friends work best with a Microsoft account — your list is saved per account, and friends can only see you on online-mode servers with a Microsoft account.</span></div>` : ''}
      <div class="search" style="max-width:320px;margin-bottom:12px">${icon('search')}<input type="search" id="fr-q" placeholder="${T('Search')}…"></div>
      <div class="friends-grid" id="fr-list"><div class="faint">Loading…</div></div>
      <p class="faint small" style="margin-top:14px">Minecraft: Java Edition has no official friends service, so “online” means Solaris saw the player in the live player list of a server it checked (Discover, My servers and Favourites). Big servers only show some of their players.</p>`;
    let list = [], q = '';
    const draw = () => {
      const box = $('#fr-list', el);
      const shown = list.filter((f) => !q || f.name.toLowerCase().includes(q) || (f.note || '').toLowerCase().includes(q));
      if (!list.length) { box.innerHTML = `<div class="empty" style="grid-column:1/-1">${icon('users')}<div>No friends yet.</div><div class="faint small">Add players by their Minecraft username.</div></div>`; return; }
      box.innerHTML = shown.map((f) => `<div class="friend-card ${f.online ? 'online' : ''}" data-u="${esc(f.uuid)}">
        <div class="head lg" data-head="${esc(f.uuid)}"></div>
        <div class="grow" style="min-width:0">
          <div class="row" style="gap:6px"><b class="ellipsis">${esc(f.name)}</b><span class="dot ${f.online ? "" : "off"}"></span></div>
          <div class="faint small ellipsis">${f.online ? `Online on <a href="#" data-srv="${esc(f.online.server)}">${esc(f.online.server)}</a>` : 'Not seen online recently'}</div>
          ${f.note ? `<div class="small muted ellipsis" title="${esc(f.note)}">${esc(f.note)}</div>` : ''}
        </div>
        ${f.online ? `<button class="btn sm primary" data-join="${esc(f.online.server)}">${icon('play')}Join</button>` : ''}
        <button class="icon-btn" data-more="${esc(f.uuid)}" title="More">${icon('more')}</button></div>`).join('') || '<div class="faint">No match.</div>';
      $$('[data-head]', box).forEach((h) => this.head(h, h.dataset.head));
      $$('[data-join]', box).forEach((b) => (b.onclick = () => Pages.servers.join(b.dataset.join)));
      $$('[data-srv]', box).forEach((a) => (a.onclick = (e) => { e.preventDefault(); Router.go('servers', { address: a.dataset.srv }); }));
      $$('[data-more]', box).forEach((b) => (b.onclick = (e) => {
        const f = list.find((x) => x.uuid === b.dataset.more);
        contextMenu(e.clientX, e.clientY, [
          { label: 'Save skin to wardrobe', icon: 'skins', action: async () => { try { await api('skins:addFromUsername', f.name); toast(`${f.name}’s skin added to your wardrobe`); } catch (er) { toastErr(er); } } },
          { label: 'Copy name', icon: 'copy', action: () => { api('clipboard:write', f.name); toast('Name copied'); } },
          { label: 'Copy UUID', icon: 'copy', action: () => { api('clipboard:write', f.uuid); toast('UUID copied'); } },
          { label: 'Edit note', icon: 'edit', action: async () => { const n = await promptDialog(`Note for ${f.name}`, { value: f.note || '', placeholder: 'e.g. plays on Hypixel', ok: T('Save') }); if (n !== null && n !== undefined) { list = await api('friends:note', f.uuid, n); draw(); } } },
          '-',
          { label: 'Remove friend', icon: 'trash', danger: true, action: async () => { if (await confirmDialog(`Remove ${f.name} from your friends?`, { danger: true, ok: 'Remove' })) { list = await api('friends:remove', f.uuid); draw(); } } },
        ]);
      }));
    };
    const load = async () => { list = await api('friends:list'); if (el.isConnected) draw(); };
    $('#fr-q', el).oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };
    $('#fr-add', el).onclick = async () => {
      const n = await promptDialog('Add friend', { placeholder: 'Minecraft username', ok: 'Add' });
      if (!n) return;
      try { list = await api('friends:add', n.trim()); draw(); toast('Friend added'); } catch (e) { toastErr(e); }
    };
    $('#fr-status', el).onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true; b.innerHTML = `${icon('refresh')}Checking servers…`;
      try {
        const d = await api('servers:list');
        const addrs = [...new Set([...d.servers.map((s) => s.address), ...d.featured.map((s) => s.address)])];
        await Promise.all(addrs.map((a) => api('servers:ping', a).catch(() => null)));
        await load();
        const n = list.filter((f) => f.online).length;
        toast(n ? `${n} friend${n > 1 ? 's' : ''} online` : 'None of your friends were seen online', n ? 'ok' : 'info');
      } finally { if (b.isConnected) { b.disabled = false; b.innerHTML = `${icon('refresh')}Check who’s online`; } }
    };
    ctx.on('accounts', () => Router.reload());
    await load();
  },
  /** Draw a friend's head from their real skin (falls back to their default skin). */
  head(el, uuid) {
    if (!this.skins.has(uuid)) this.skins.set(uuid, api('friends:skin', uuid).catch(() => null));
    this.skins.get(uuid).then((s) => { if (el.isConnected) renderHead(el, { uuid, name: s?.name || '?', skinUrl: s?.url || null }); });
  },
};
