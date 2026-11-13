/* Launcher self-update UI: titlebar chip, animated sidebar card while downloading, and an "installing" screen. */
const Updater = {
  state: { status: 'idle' },
  dismissed: false,

  init() {
    window.solaris.on('update:state', (s) => this.apply(s));
    api('update:state').then((s) => this.apply(s)).catch(() => {});
  },

  apply(s) {
    const was = this.state.status;
    this.state = s || { status: 'idle' };
    if (s.status === 'downloading' && was !== 'downloading') this.dismissed = false;
    if (s.status === 'ready' && was !== 'ready') toast(`Solaris ${s.version} is ready — restart to update`, 'info', 6000);
    if (s.status === 'installing') this.showInstalling();
    this.render();
  },

  render() {
    const s = this.state;
    const card = $('#update-card'), chip = $('#tb-update');
    if (!card || !chip) return;
    const active = ['downloading', 'ready', 'error'].includes(s.status) && !(s.status === 'error' && this.dismissed);
    card.hidden = !active;
    chip.hidden = !['downloading', 'ready'].includes(s.status);
    const pct = Math.max(0, Math.min(100, s.percent || 0));
    const C = 2 * Math.PI * 19; // ring circumference

    if (s.status === 'downloading') {
      chip.className = 'title-link tb-update dl';
      chip.innerHTML = `<span class="tb-ring" style="--p:${pct}"></span><span>Updating ${Math.floor(pct)}%</span>`;
      chip.title = `Downloading Solaris ${s.version}`;
      const drew = card.dataset.mode === 'dl';
      if (!drew) {
        card.dataset.mode = 'dl';
        card.className = 'update-card dl';
        card.innerHTML = `
          <div class="uc-top">
            <div class="uc-ring"><svg viewBox="0 0 44 44"><circle class="bg" cx="22" cy="22" r="19"/><circle class="fg" cx="22" cy="22" r="19" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>${icon('sun', 'uc-sun')}</div>
            <div class="uc-txt"><b>Downloading update</b><small class="uc-ver"></small></div>
            <span class="uc-pct"></span>
          </div>
          <div class="uc-bar"><div></div></div>
          <div class="uc-meta"><span class="uc-size"></span><span class="uc-speed"></span></div>
          <button class="uc-notes" hidden>${icon('changelog')}What’s in this update</button>`;
        $('.uc-notes', card).onclick = () => this.showNotes();
      }
      $('.uc-notes', card).hidden = !s.notes;
      $('.fg', card).style.strokeDashoffset = String(C * (1 - pct / 100));
      $('.uc-ver', card).textContent = `Solaris ${s.version || ''}`;
      $('.uc-pct', card).textContent = `${Math.floor(pct)}%`;
      $('.uc-bar > div', card).style.width = pct + '%';
      $('.uc-size', card).textContent = s.total ? `${fmtBytes(s.transferred)} / ${fmtBytes(s.total)}` : 'Starting…';
      $('.uc-speed', card).textContent = s.speed ? `${fmtBytes(s.speed)}/s` : '';
    } else if (s.status === 'ready') {
      chip.className = 'title-link tb-update ready';
      chip.innerHTML = `${icon('download')}<span>Restart to update</span>`;
      chip.title = `Solaris ${s.version} is downloaded`;
      chip.onclick = () => this.install();
      if (card.dataset.mode !== 'ready') {
        card.dataset.mode = 'ready';
        card.className = 'update-card ready';
        card.innerHTML = `
          <div class="uc-top">
            <div class="uc-ring done"><svg viewBox="0 0 44 44"><circle class="fg" cx="22" cy="22" r="19"/></svg>${icon('check', 'uc-sun')}</div>
            <div class="uc-txt"><b>Update ready</b><small>Solaris ${esc(s.version || '')}</small></div>
          </div>
          ${s.notes ? `<button class="uc-notes">${icon('changelog')}What’s in this update</button>` : ''}
          <button class="btn primary sm uc-go">${icon('download')}Restart & update</button>
          <button class="uc-later">Later — install when I close Solaris</button>`;
        $('.uc-go', card).onclick = () => this.install();
        if ($('.uc-notes', card)) $('.uc-notes', card).onclick = () => this.showNotes();
        $('.uc-later', card).onclick = () => { card.hidden = true; };
      }
    } else if (s.status === 'error') {
      card.dataset.mode = 'err';
      card.className = 'update-card err';
      card.innerHTML = `<div class="uc-top"><div class="uc-txt"><b>Update failed</b><small>${esc(s.error || '')}</small></div><button class="icon-btn" data-x>${icon('close')}</button></div>`;
      $('[data-x]', card).onclick = () => { this.dismissed = true; this.render(); };
    } else {
      card.dataset.mode = '';
    }
    if (s.status === 'downloading') chip.onclick = () => { $('#update-card').hidden = false; $('#update-card').classList.remove('flash'); void card.offsetWidth; card.classList.add('flash'); };
  },

  /** Release notes of the update being downloaded (from the GitHub release). */
  showNotes() {
    const s = this.state;
    const m = modal({
      title: `Solaris ${s.version || ''} — release notes`,
      body: `<div class="uc-notes-body">${esc(s.notes || 'No release notes.')}</div>`,
      footer: s.status === 'ready' ? `<button class="btn ghost" data-x>Later</button><button class="btn primary" data-go>${icon('download')}Restart & update</button>` : `<button class="btn primary" data-x>OK</button>`,
    });
    m.$('[data-x]').onclick = () => m.close();
    if (m.$('[data-go]')) m.$('[data-go]').onclick = () => { m.close(); this.install(); };
  },

  async install() {
    if (State.runs && Object.values(State.runs).some((r) => r.running)
      && !(await confirmDialog('A game is still running. Updating restarts Solaris — the game keeps running, but its log in the launcher will be lost.', { title: 'Restart to update?', ok: 'Restart & update' }))) return;
    this.showInstalling();
    api('update:install');
  },

  /** Once after an update (like OneLauncher / NoRisk): show this version's changelog. Not on a first install. */
  async whatsNew() {
    const v = State.info?.version, seen = State.settings?.lastSeenVersion;
    if (!v || seen === v) return;
    await saveSettings({ lastSeenVersion: v });
    if (!seen) return;
    const log = await api('data:changelog').catch(() => []);
    const r = log.find((x) => x.version === v);
    if (!r) return;
    const TYPE = { feature: ['accent', 'New'], improvement: ['info', 'Better'], bugfix: ['danger', 'Fixed'] };
    const m = modal({
      title: `What’s new in Solaris ${v}`,
      body: `<div class="wn-hero">${icon('sun')}<div><b>${esc(r.title || 'Solaris was updated')}</b><div class="faint small">Updated from ${esc(seen)} · ${fmtDate(r.date)}</div></div></div>
        ${r.groups.map((g) => `<div class="wn-area"><h4>${esc(g.area)}</h4>${g.entries.map((e) => `<div class="wn-entry"><span class="chip ${TYPE[e.type]?.[0] || ''}">${TYPE[e.type]?.[1] || esc(e.type)}</span><span>${esc(e.text)}</span></div>`).join('')}</div>`).join('')}`,
      footer: `<button class="btn ghost" data-all>Full changelog</button><button class="btn primary" data-ok>Let’s go</button>`,
    });
    m.$('[data-ok]').onclick = () => m.close();
    m.$('[data-all]').onclick = () => { m.close(); Router.go('changelog'); };
  },

  showInstalling() {
    if ($('#update-screen')) return;
    const el = document.createElement('div');
    el.id = 'update-screen';
    el.innerHTML = `<div class="us-sun"><i></i>${icon('sun')}</div>
      <h2>Installing Solaris ${esc(this.state.version || '')}</h2>
      <p class="muted">Solaris will reopen by itself in a moment.</p>
      <div class="progress indeterminate"><div></div></div>`;
    document.body.appendChild(el);
  },
};
Updater.init();
