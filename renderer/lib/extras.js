/* Extras inspired by other launchers (ideas only, own code):
   - Splash screen while Solaris starts (OneLauncher's splash curtain)
   - Seasonal snow (NoRisk's snow effect)
   - solaris:// links (NoRisk's deep links)
   - Minecraft news cards for Home (NoRisk / Silent news feed) */

/* ---------- splash ---------- */
const Splash = {
  step(text) { const s = $('#splash .sp-step'); if (s) s.textContent = text; },
  done() {
    const el = $('#splash');
    if (!el || el.classList.contains('out')) return;
    el.classList.add('out');
    setTimeout(() => el.remove(), 600);
  },
};
setTimeout(() => Splash.done(), 12000); // never stay stuck behind the splash

/* ---------- seasonal snow ---------- */
const Snow = {
  canvas: null, flakes: [], raf: 0, on: false,
  sync(s) {
    const want = !!look(s, 'snow') && !look(s, 'reduceMotion') && !s.lowEndMode;
    if (want === this.on) return;
    this.on = want;
    want ? this.start() : this.stop();
  },
  start() {
    const c = (this.canvas = document.createElement('canvas'));
    c.id = 'snow';
    document.body.appendChild(c);
    const resize = () => { c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio; };
    resize();
    this._resize = resize;
    addEventListener('resize', resize);
    const n = Math.round(Math.min(110, innerWidth / 14));
    this.flakes = Array.from({ length: n }, () => this.flake(true));
    const ctx = c.getContext('2d');
    let last = performance.now();
    const tick = (t) => {
      const dt = Math.min(50, t - last) / 16.7; last = t;
      if (!document.hidden) {
        const d = devicePixelRatio;
        ctx.clearRect(0, 0, c.width, c.height);
        for (const f of this.flakes) {
          f.y += f.vy * dt; f.phase += 0.02 * dt; f.x += (Math.sin(f.phase) * 0.4 + f.vx) * dt;
          if (f.y > innerHeight + 8) Object.assign(f, this.flake(false));
          ctx.globalAlpha = f.a;
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(f.x * d, f.y * d, f.r * d, 0, Math.PI * 2); ctx.fill();
        }
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  },
  flake(anywhere) {
    const r = 0.8 + Math.random() * 2.2;
    return { x: Math.random() * innerWidth, y: anywhere ? Math.random() * innerHeight : -10, r, vy: 0.35 + r * 0.25, vx: (Math.random() - 0.5) * 0.3, a: 0.25 + Math.random() * 0.5, phase: Math.random() * 6 };
  },
  stop() {
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this._resize || (() => {}));
    this.canvas?.remove(); this.canvas = null; this.flakes = [];
  },
};
Bus.on('settings', (s) => Snow.sync(s));

/* ---------- solaris:// links ---------- */
const DeepLinks = {
  queue: [],
  init() {
    window.solaris.on('deeplink', (l) => this.open(l));
    Bus.on('accounts', () => { if (State.accounts?.active) this.flush(); });
  },
  async takePending() { const l = await api('deeplink:take').catch(() => null); if (l) this.open(l); },
  open(link) {
    if (!State.accounts?.active || AuthGate.isOpen()) { this.queue.push(link); toast('Sign in first — the link will open right after.', 'info'); return; }
    this.run(link);
  },
  flush() { const q = this.queue.splice(0); setTimeout(() => q.forEach((l) => this.run(l)), 600); },
  async run(link) {
    if (link.kind === 'modrinth') {
      Router.go('browse', { type: 'modpack' });
      setTimeout(() => Pages.browse.details(link.id, undefined, null), 150);
    } else if (link.kind === 'server') {
      if (await confirmDialog(`A link wants to join the server ${link.address}.\n\nOnly join servers you trust.`, { title: 'Join server?', ok: 'Choose instance' })) Pages.servers.join(link.address);
    } else toast('Solaris couldn’t open that link.', 'error');
  },
};
DeepLinks.init();

/* ---------- Minecraft news (Home) ---------- */
function mcNewsCards(items) {
  return items.map((n) => `<button class="mcn-card" data-link="${esc(n.link || '')}" title="${esc(n.title)}">
      <div class="mcn-img" ${n.image ? `style="background-image:url('${esc(n.image)}')"` : ''}><span class="chip">${esc(n.tag || 'news')}</span></div>
      <div class="mcn-body"><div class="faint small">${fmtDate(n.date)}</div><b>${esc(n.title)}</b><p>${esc(n.text)}</p></div>
    </button>`).join('');
}
function bindMcNews(root) {
  $$('[data-link]', root).forEach((b) => (b.onclick = () => { if (b.dataset.link) api('shell:open', b.dataset.link); }));
}
