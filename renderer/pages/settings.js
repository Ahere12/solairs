const THEMES = {
  solar: { name: 'Solar', bg: '#0d0b12', panel: '#1f1a29', side: '#120f18' },
  eclipse: { name: 'Eclipse', bg: '#07070a', panel: '#181822', side: '#0b0b10' },
  nebula: { name: 'Nebula', bg: '#0a0d18', panel: '#19213d', side: '#0d1120' },
  dawn: { name: 'Dawn', bg: '#f6f1ea', panel: '#ffffff', side: '#efe8de' },
  custom: { name: 'Custom', bg: null, panel: null, side: null },
};
const ACCENTS = ['#ff9f1c', '#ff5e3a', '#ffd23f', '#3ddc84', '#2ec4b6', '#6aa8ff', '#8b5cf6', '#ff5ca8', '#e5e5e5'];
const KEY_LABELS = { 'nav.home': 'Go to Home', 'nav.library': 'Go to Library', 'nav.browse': 'Go to Browse', 'nav.solaris': 'Go to Solaris Client', 'nav.servers': 'Go to Servers', 'nav.skins': 'Go to Skins', 'nav.friends': 'Go to Friends', 'nav.console': 'Go to Console', 'nav.settings': 'Open Settings', 'play.selected': 'Play selected instance', 'search.focus': 'Focus search' };

/** Light / dark / follow Windows. Light mode uses the Dawn palette; dark mode never shows Dawn. */
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
systemDark.addEventListener('change', () => { if (State.settings?.colorMode === 'system') applyTheme(State.settings); });
function effectiveTheme(s) {
  const mode = s.colorMode || 'dark';
  const light = mode === 'light' || (mode === 'system' && !systemDark.matches);
  if (light) return 'dawn';
  if (s.theme === 'dawn') return 'solar';
  return s.theme === 'custom' ? 'solar' : s.theme;
}
function applyTheme(s) {
  const root = document.documentElement;
  root.dataset.theme = effectiveTheme(s);
  root.style.setProperty('--accent', s.accent);
  const mix = (hex, amt) => { const n = parseInt(hex.slice(1), 16); const r = Math.min(255, (n >> 16) + amt), g = Math.min(255, ((n >> 8) & 255) + amt), b = Math.min(255, (n & 255) + amt); return `rgb(${r},${g},${b})`; };
  // derive a second gradient stop from the accent
  const n = parseInt(s.accent.slice(1), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  root.style.setProperty('--accent-2', `rgb(${Math.min(255, r + 10)},${Math.max(0, g - 60)},${Math.max(0, b - 20)})`);
  root.style.setProperty('--accent-ink', (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#1a0f02' : '#ffffff');
  // custom gradient: second colour + direction for buttons, the Play button and progress bars
  if (s.gradientOn && s.accent2) root.style.setProperty('--accent-2', s.accent2);
  root.style.setProperty('--grad-angle', (s.gradientOn ? (+s.gradientAngle || 120) : 120) + 'deg');
  for (const k of ['--bg', '--bg-2', '--panel', '--panel-2', '--panel-3', '--text']) root.style.removeProperty(k);
  if (s.theme === 'custom' && s.customTheme && effectiveTheme(s) !== 'dawn') {
    const c = s.customTheme;
    root.style.setProperty('--bg', c.bg); root.style.setProperty('--bg-2', c.bg);
    root.style.setProperty('--panel', c.panel); root.style.setProperty('--panel-2', mix(c.panel, 10)); root.style.setProperty('--panel-3', mix(c.panel, 24));
    root.style.setProperty('--text', c.text);
  }
  applyLook(s);
}

/* ---------- background & interface options (stored in settings, all optional) ---------- */
const BACKGROUNDS = {
  glow: { name: 'Solar glow' },
  sunset: { name: 'Sunset' },
  rays: { name: 'Sun rays' },
  aurora: { name: 'Aurora' },
  stars: { name: 'Night sky' },
  ember: { name: 'Embers' },
  plain: { name: 'Plain' },
  gradient: { name: 'Your gradient' },
  image: { name: 'Your image' },
};
const LOOK_DEFAULTS = { bgStyle: 'glow', bgImage: '', bgDim: 35, bgBlur: 0, panelOpacity: 100, uiScale: 100, cornerStyle: 'rounded', compactSidebar: false, reduceMotion: false, showSideInstances: true, homeModpacks: true, homeServers: true, homePlaytime: true, homeNews: true };
const look = (s, k) => (s?.[k] ?? LOOK_DEFAULTS[k]);
const fileUrl = (p) => 'file:///' + String(p).replace(/\\/g, '/').replace(/^\/+/, '').split('/').map((seg, i) => (i === 0 && /^[a-z]:$/i.test(seg) ? seg : encodeURIComponent(seg))).join('/');
function applyLook(s) {
  const root = document.documentElement;
  let style = look(s, 'bgStyle');
  if (!BACKGROUNDS[style] || (style === 'image' && !s.bgImage)) style = 'glow';
  root.dataset.bg = style;
  const img = $('#bg-layer .bg-img');
  if (img) img.style.backgroundImage = style === 'image' ? `url("${fileUrl(s.bgImage)}")` : '';
  root.style.setProperty('--bg-dim', style === 'image' ? String(look(s, 'bgDim') / 100) : '0');
  root.style.setProperty('--bg-blur', (style === 'image' ? look(s, 'bgBlur') : 0) + 'px');
  const op = Math.min(100, Math.max(40, +look(s, 'panelOpacity')));
  root.style.setProperty('--panel-mix', op + '%');
  root.toggleAttribute('data-glass', op < 100);
  const zoom = Math.min(150, Math.max(75, +look(s, 'uiScale'))) / 100;
  root.style.zoom = String(zoom);
  root.style.setProperty('--zoom', String(zoom));
  root.dataset.corners = look(s, 'cornerStyle');
  root.toggleAttribute('data-compact', !!look(s, 'compactSidebar'));
  root.toggleAttribute('data-reduce-motion', !!look(s, 'reduceMotion'));
  root.toggleAttribute('data-hide-side-insts', !look(s, 'showSideInstances'));
  root.dataset.layout = s.layout === 'classic' ? 'classic' : 'modern';
  // Low-end mode: no blur, no animations, plain background, no 3D skin animation
  root.toggleAttribute('data-lowend', !!s.lowEndMode);
  if (s.lowEndMode) { root.dataset.bg = style === 'image' ? 'image' : 'plain'; root.setAttribute('data-reduce-motion', ''); root.removeAttribute('data-glass'); }
  if (style === 'gradient') {
    root.style.setProperty('--bg-g1', s.bgGrad1 || '#1a0b16');
    root.style.setProperty('--bg-g2', s.bgGrad2 || '#2a120a');
    root.style.setProperty('--bg-gangle', (+s.bgGradAngle || 160) + 'deg');
  }
}

Pages.settings = {
  async render(el, params, ctx) {
    let tab = params.tab || 'general';
    const TABS = [['general', 'General', 'settings'], ['appearance', 'Appearance', 'palette'], ['java', 'Java & Memory', 'cpu'], ['performance', 'Performance', 'zap'], ['accounts', 'Accounts', 'user'], ['privacy', 'Privacy & safety', 'shield'], ['keybinds', 'Keybinds', 'key'], ['storage', 'Storage', 'hdd'], ['integrations', 'Integrations', 'link'], ['diagnostics', 'Diagnostics', 'bug'], ['about', 'About', 'info']];
    el.innerHTML = `<div class="page-head"><h1>${T('Settings')}</h1></div>
      <div class="settings"><nav>${TABS.map(([k, l, ic]) => `<button class="nav-item" data-st="${k}">${icon(ic)}${l}</button>`).join('')}</nav><div id="sbody"></div></div>`;
    const show = (t) => {
      tab = t;
      this.stopKeyCapture();
      $$('[data-st]', el).forEach((b) => b.classList.toggle('active', b.dataset.st === t));
      this[t]($('#sbody', el));
    };
    $$('[data-st]', el).forEach((b) => (b.onclick = () => show(b.dataset.st)));
    show(tab);
    return () => this.stopKeyCapture();
  },
  /* helpers */
  toggle(key, title, desc) {
    return `<div class="setting"><div class="txt"><div class="t">${title}</div><div class="d">${desc}</div></div><div class="ctl"><label class="switch"><input type="checkbox" data-bool="${key}" ${State.settings[key] ? 'checked' : ''}><span></span></label></div></div>`;
  },
  stopKeyCapture() {
    if (this._keyCapture) { document.removeEventListener('keydown', this._keyCapture, true); this._keyCapture = null; }
  },
  lookToggle(key, title, desc) {
    return `<div class="setting"><div class="txt"><div class="t">${title}</div><div class="d">${desc}</div></div><div class="ctl"><label class="switch"><input type="checkbox" data-look="${key}" ${look(State.settings, key) ? 'checked' : ''}><span></span></label></div></div>`;
  },
  bind(box) {
    $$('[data-bool]', box).forEach((c) => (c.onchange = async () => { await saveSettings({ [c.dataset.bool]: c.checked }); toast('Saved'); }));
    $$('[data-sel]', box).forEach((c) => (c.onchange = async () => { await saveSettings({ [c.dataset.sel]: c.value }); toast('Saved'); }));
    $$('[data-text]', box).forEach((c) => (c.onchange = async () => { await saveSettings({ [c.dataset.text]: c.value.trim() }); toast('Saved'); }));
  },

  general(box) {
    const s = State.settings;
    box.innerHTML = `<div class="card">
      <div class="setting"><div class="txt"><div class="t">Language</div><div class="d">Switches instantly.</div></div><div class="ctl"><select data-sel="language">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === s.language ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
      <div class="setting"><div class="txt"><div class="t">When the game starts</div><div class="d">What Solaris does with its window while you play.</div></div><div class="ctl"><select data-sel="launchBehavior"><option value="keep">Keep open</option><option value="minimize">Minimize</option><option value="hide">Hide (reopen when the game closes)</option></select></div></div>
      ${this.toggle('doubleClickLaunch', 'Double-click to launch', 'Double-clicking an instance card starts the game.')}
      ${this.toggle('startMinimized', 'Start minimized', 'Open Solaris in the background.')}
      ${this.toggle('openAtLogin', 'Launch on system startup', 'Start Solaris when you sign in to your computer.')}
      ${this.toggle('minimizeToTray', 'Close to tray', 'Closing the window keeps Solaris running in the system tray (right-click it to quick-launch).')}
      ${this.toggle('notifications', 'Notifications', 'Show confirmations, crash and download notifications.')}
      ${this.toggle('showSnapshots', 'Show snapshots', 'Include snapshots and old versions in version lists by default.')}
    </div>`;
    $('[data-sel="launchBehavior"]', box).value = s.launchBehavior;
    this.bind(box);
    $('[data-sel="language"]', box).addEventListener('change', () => setTimeout(() => { renderNav(); Router.reload(); }, 50));
  },

  appearance(box) {
    const s = State.settings;
    box.innerHTML = `<div class="card">
      <div class="setting"><div class="txt"><div class="t">Mode</div><div class="d">Light, dark, or follow your Windows setting.</div></div><div class="ctl"><div class="seg">${[['dark', 'Dark'], ['light', 'Light'], ['system', 'Match system']].map(([k, l]) => `<button data-mode="${k}" class="${(s.colorMode || 'dark') === k ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>
      <div class="setting"><div class="txt"><div class="t">Layout</div><div class="d">Modern: menu on the side. Classic: menu on top and a Play bar at the bottom.</div></div><div class="ctl"><div class="seg">${[['modern', 'Modern'], ['classic', 'Classic']].map(([k, l]) => `<button data-layout="${k}" class="${(s.layout || 'modern') === k ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>
    </div>
    <div class="card" style="margin-top:14px">
      <h3>Theme</h3><div class="row wrap" style="margin:10px 0 18px">${Object.entries(THEMES).map(([k, t]) => {
        const bg = t.bg || s.customTheme.bg, panel = t.panel || s.customTheme.panel, side = t.side || s.customTheme.bg;
        return `<div class="theme-card ${s.theme === k ? 'on' : ''}" data-theme="${k}"><div class="pv" style="background:${bg}"><div style="background:${side}"></div><div style="padding:8px;display:flex;flex-direction:column;gap:5px"><div style="height:10px;width:60%;border-radius:4px;background:${s.accent}"></div><div style="height:22px;border-radius:5px;background:${panel}"></div><div style="height:12px;width:70%;border-radius:4px;background:${panel}"></div></div></div><div class="n">${t.name}</div></div>`;
      }).join('')}</div>
      <h3>Accent colour</h3><div class="swatches" style="margin:10px 0 6px">${ACCENTS.map((c) => `<div class="swatch ${c === s.accent ? 'on' : ''}" data-accent="${c}" style="background:${c}"></div>`).join('')}<input type="color" id="acc" value="${s.accent}" title="Custom colour" style="width:34px;height:34px;border:0;background:none;padding:0;cursor:pointer"></div>
      <h3 style="margin-top:18px">Gradient</h3>
      <div class="setting"><div class="txt"><div class="t">Custom gradient</div><div class="d">Pick the second colour and direction used on buttons, the Play button and progress bars.</div></div><div class="ctl"><label class="switch"><input type="checkbox" id="grad-on" ${s.gradientOn ? 'checked' : ''}><span></span></label></div></div>
      <div id="grad-opts" class="${s.gradientOn ? '' : 'hidden'}"><div class="row wrap" style="gap:16px;align-items:center">
        <label class="field">Second colour<input type="color" id="grad-c2" value="${esc(s.accent2 || '#ff5e3a')}" style="width:80px;height:36px;border:0;background:none"></label>
        <label class="field grow">Direction: <span id="grad-av">${+s.gradientAngle || 120}°</span><input type="range" id="grad-a" min="0" max="360" step="5" value="${+s.gradientAngle || 120}"></label>
        <div class="grad-preview" style="background:linear-gradient(var(--grad-angle), var(--accent), var(--accent-2))"></div></div></div>
      <div id="custom" class="${s.theme === 'custom' ? '' : 'hidden'}"><h3 style="margin-top:18px">Custom theme</h3>
        <div class="row wrap">${[['bg', 'Background'], ['panel', 'Panels'], ['text', 'Text']].map(([k, l]) => `<label class="field">${l}<input type="color" data-ct="${k}" value="${s.customTheme[k]}" style="width:80px;height:36px;border:0;background:none"></label>`).join('')}</div></div>
      <p class="faint small" style="margin-top:16px">Changes preview live across the whole launcher.</p></div>

    <h2>Background</h2>
    <div class="card">
      <div class="bg-grid">${Object.entries(BACKGROUNDS).map(([k, b]) => `<button class="bg-card ${look(s, 'bgStyle') === k ? 'on' : ''}" data-bgs="${k}"><div class="pv" data-bg-preview="${k}" ${k === 'image' && s.bgImage ? `style="${esc(`background-image:url("${fileUrl(s.bgImage)}")`)}"` : ''}>${k === 'image' && !s.bgImage ? icon('image') : ''}</div><span>${b.name}</span></button>`).join('')}</div>
      <div id="img-opts" class="${look(s, 'bgStyle') === 'image' ? '' : 'hidden'}">
        <div class="setting"><div class="txt"><div class="t">Background image</div><div class="d mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.bgImage ? esc(s.bgImage) : 'No image chosen yet'}</div></div><div class="ctl"><button class="btn sm" id="bg-pick">${icon('image')}Choose image…</button>${s.bgImage ? `<button class="btn sm ghost" id="bg-clear">${icon('close')}</button>` : ''}</div></div>
        <div class="setting"><div class="txt"><div class="t">Darken: <span id="dimv">${look(s, 'bgDim')}</span>%</div><input type="range" min="0" max="90" step="5" value="${look(s, 'bgDim')}" data-range="bgDim" data-out="dimv"></div></div>
        <div class="setting"><div class="txt"><div class="t">Blur: <span id="blurv">${look(s, 'bgBlur')}</span>px</div><input type="range" min="0" max="24" step="1" value="${look(s, 'bgBlur')}" data-range="bgBlur" data-out="blurv"></div></div>
      </div>
      <div id="grad-bg-opts" class="${look(s, 'bgStyle') === 'gradient' ? '' : 'hidden'}"><div class="row wrap" style="gap:16px;align-items:center;padding:8px 0">
        <label class="field">From<input type="color" data-bgc="bgGrad1" value="${esc(s.bgGrad1 || '#1a0b16')}" style="width:70px;height:34px;border:0;background:none"></label>
        <label class="field">To<input type="color" data-bgc="bgGrad2" value="${esc(s.bgGrad2 || '#2a120a')}" style="width:70px;height:34px;border:0;background:none"></label>
        <label class="field grow">Direction: <span id="bgav">${+s.bgGradAngle || 160}°</span><input type="range" min="0" max="360" step="5" value="${+s.bgGradAngle || 160}" data-range="bgGradAngle" data-out="bgav"></label></div></div>
      <div class="setting"><div class="txt"><div class="t">Panel opacity: <span id="opv">${look(s, 'panelOpacity')}</span>%</div><div class="d">Lower it to let the background show through the sidebar and pages (frosted glass).</div><input type="range" min="40" max="100" step="5" value="${look(s, 'panelOpacity')}" data-range="panelOpacity" data-out="opv" style="margin-top:8px"></div></div>
    </div>

    <h2>Interface</h2>
    <div class="card">
      <div class="setting"><div class="txt"><div class="t">Interface size</div><div class="d">Scales the whole launcher.</div></div><div class="ctl"><div class="seg" id="scale">${[90, 100, 110, 125].map((n) => `<button data-scale="${n}" class="${+look(s, 'uiScale') === n ? 'on' : ''}">${n}%</button>`).join('')}</div></div></div>
      <div class="setting"><div class="txt"><div class="t">Corners</div><div class="d">How rounded cards, buttons and panels are.</div></div><div class="ctl"><div class="seg">${[['sharp', 'Sharp'], ['rounded', 'Rounded'], ['round', 'Extra round']].map(([k, l]) => `<button data-corner="${k}" class="${look(s, 'cornerStyle') === k ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>
      ${this.lookToggle('compactSidebar', 'Compact sidebar', 'Show only icons in the sidebar for more room.')}
      ${this.lookToggle('showSideInstances', 'Instances in sidebar', 'List your instances under the menu for one-click access.')}
      ${this.lookToggle('reduceMotion', 'Reduce motion', 'Turn off animations and transitions.')}
    </div>

    <h2>Instance tabs</h2>
    <div class="card">
      <p class="faint small" style="margin-top:0">Choose which tabs an instance page shows and in what order. Settings is always shown.</p>
      <div class="list" id="itab-list">${instanceTabConfig().map((t, i, a) => `<div class="list-row"><div class="info"><div class="title">${esc(t.label)}</div></div>
        <button class="icon-btn" data-tup="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">${icon('back')}</button><button class="icon-btn" data-tdown="${i}" ${i === a.length - 1 ? 'disabled' : ''} title="Move down">${icon('fwd')}</button>
        <label class="switch" title="Show"><input type="checkbox" data-tshow="${i}" ${t.hidden ? '' : 'checked'} ${t.id === 'settings' ? 'disabled' : ''}><span></span></label></div>`).join('')}</div>
      <div class="row" style="margin-top:10px"><button class="btn sm ghost" id="itab-reset">${icon('refresh')}Reset order</button></div>
    </div>

    <h2>Home page</h2>
    <div class="card">
      ${this.lookToggle('homeModpacks', 'Explore modpacks', 'Popular modpacks from Modrinth.')}
      ${this.lookToggle('homeServers', 'Servers', 'Featured servers with live player counts.')}
      ${this.lookToggle('homePlaytime', 'Your Playtime', 'Play time per instance.')}
      ${this.lookToggle('homeNews', "What's new", 'Latest Solaris changelog entries.')}
    </div>
    <div class="row" style="margin-top:14px"><button class="btn sm ghost" id="look-reset">${icon('refresh')}Reset appearance to defaults</button></div>`;
    const set = async (patch) => { await saveSettings(patch); applyTheme(State.settings); this.appearance(box); };
    $$('[data-bgs]', box).forEach((b) => (b.onclick = async () => {
      if (b.dataset.bgs === 'image' && !State.settings.bgImage) return pickImage();
      set({ bgStyle: b.dataset.bgs });
    }));
    const pickImage = async () => {
      const [f] = await api('dialog:open', { title: 'Choose a background image', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }], properties: ['openFile'] });
      if (f) set({ bgImage: f, bgStyle: 'image' });
    };
    if ($('#bg-pick', box)) $('#bg-pick', box).onclick = pickImage;
    if ($('#bg-clear', box)) $('#bg-clear', box).onclick = () => set({ bgImage: '', bgStyle: 'glow' });
    $$('[data-range]', box).forEach((r) => {
      r.oninput = () => { $('#' + r.dataset.out, box).textContent = r.value; applyLook({ ...State.settings, [r.dataset.range]: +r.value }); };
      r.onchange = () => saveSettings({ [r.dataset.range]: +r.value });
    });
    $$('[data-scale]', box).forEach((b) => (b.onclick = () => set({ uiScale: +b.dataset.scale })));
    $$('[data-corner]', box).forEach((b) => (b.onclick = () => set({ cornerStyle: b.dataset.corner })));
    $$('[data-look]', box).forEach((c) => (c.onchange = () => set({ [c.dataset.look]: c.checked })));
    $('#look-reset', box).onclick = () => set({ ...LOOK_DEFAULTS, theme: 'solar', accent: '#ff9f1c' });
    $$('[data-theme]', box).forEach((d) => (d.onclick = () => set(d.dataset.theme === 'dawn' ? { theme: 'dawn', colorMode: 'light' } : { theme: d.dataset.theme, ...(State.settings.colorMode === 'light' ? { colorMode: 'dark' } : {}) })));
    $$('[data-mode]', box).forEach((b) => (b.onclick = () => set({ colorMode: b.dataset.mode, ...(b.dataset.mode === 'dark' && State.settings.theme === 'dawn' ? { theme: 'solar' } : {}) })));
    $$('[data-layout]', box).forEach((b) => (b.onclick = () => set({ layout: b.dataset.layout })));
    $('#grad-on', box).onchange = (e) => set({ gradientOn: e.target.checked, accent2: State.settings.accent2 || '#ff5e3a' });
    $('#grad-c2', box).oninput = (e) => document.documentElement.style.setProperty('--accent-2', e.target.value);
    $('#grad-c2', box).onchange = (e) => set({ accent2: e.target.value });
    $('#grad-a', box).oninput = (e) => { $('#grad-av', box).textContent = e.target.value + '°'; document.documentElement.style.setProperty('--grad-angle', e.target.value + 'deg'); };
    $('#grad-a', box).onchange = (e) => saveSettings({ gradientAngle: +e.target.value });
    $$('[data-bgc]', box).forEach((c) => {
      c.oninput = () => applyLook({ ...State.settings, [c.dataset.bgc]: c.value });
      c.onchange = () => saveSettings({ [c.dataset.bgc]: c.value });
    });
    const tabsCfg = () => instanceTabConfig().map(({ id, hidden }) => ({ id, hidden: !!hidden }));
    $$('[data-tup],[data-tdown]', box).forEach((b) => (b.onclick = () => {
      const cfg = tabsCfg(), i = +(b.dataset.tup ?? b.dataset.tdown), j = b.dataset.tup !== undefined ? i - 1 : i + 1;
      [cfg[i], cfg[j]] = [cfg[j], cfg[i]];
      set({ instanceTabs: cfg });
    }));
    $$('[data-tshow]', box).forEach((c) => (c.onchange = () => { const cfg = tabsCfg(); cfg[+c.dataset.tshow].hidden = !c.checked; set({ instanceTabs: cfg }); }));
    $('#itab-reset', box).onclick = () => set({ instanceTabs: null });
    $$('[data-accent]', box).forEach((d) => (d.onclick = () => set({ accent: d.dataset.accent })));
    $('#acc', box).oninput = (e) => { document.documentElement.style.setProperty('--accent', e.target.value); };
    $('#acc', box).onchange = (e) => set({ accent: e.target.value });
    $$('[data-ct]', box).forEach((i) => {
      i.oninput = () => { const ct = { ...State.settings.customTheme, [i.dataset.ct]: i.value }; applyTheme({ ...State.settings, theme: 'custom', customTheme: ct }); };
      i.onchange = () => set({ customTheme: { ...State.settings.customTheme, [i.dataset.ct]: i.value } });
    });
  },

  async java(box) {
    const s = State.settings;
    const total = Math.floor((State.info.totalMem || 8 * 1024 ** 3) / 1024 / 1024);
    const auto = await api('settings:autoMemory', false);
    box.innerHTML = `<div class="card">
      ${this.toggle('autoMemory', 'Automatic memory', `Pick memory based on your ${Math.round(total / 1024)} GB of RAM (currently ${auto} MB, +1 GB for modded).`)}
      <div class="setting ${s.autoMemory ? 'hidden' : ''}" id="memrow"><div class="txt"><div class="t">Maximum memory: <span id="memv">${s.memoryMax}</span> MB</div><input type="range" id="mem" min="1024" max="${Math.min(total - 1024, 32768)}" step="256" value="${s.memoryMax}" style="margin-top:8px"></div></div>
      <div class="setting"><div class="txt"><div class="t">Java for all versions</div><div class="d">Empty = automatic: Solaris picks the right Java for each Minecraft version (recommended). A Java that is too old for a version is skipped automatically.</div></div><div class="ctl"><input type="text" data-text="javaPath" id="jp-all" value="${esc(s.javaPath)}" placeholder="Automatic" style="width:240px"><button class="btn sm" data-jpick="all" title="Browse">${icon('folder')}</button><button class="btn sm" data-jtest="all">Test</button></div></div>
      ${this.toggle('javaAutoInstall', 'Install Java automatically', 'Download the official Java runtime the first time a version needs it. Turn off to only use Java already installed on this PC.')}
    </div>
    <h2>Java per version</h2>
    <div class="card">
      <p class="faint small" style="margin-top:0">Optional: use your own Java for versions that need a specific Java. Minecraft 1.20.5+ needs Java 21, 1.17–1.20.4 needs Java 17, and 1.16 and older use Java 8.</p>
      ${[[21, 'Java 21', '1.20.5 and newer'], [17, 'Java 17', '1.17 – 1.20.4'], [8, 'Java 8', '1.16.5 and older']].map(([n, l, d]) => `<div class="setting"><div class="txt"><div class="t">${l}</div><div class="d">${d}</div></div><div class="ctl"><input type="text" id="jp-${n}" value="${esc(s.javaPaths?.[n] || '')}" placeholder="Automatic" style="width:240px" data-jmajor="${n}"><button class="btn sm" data-jpick="${n}" title="Browse">${icon('folder')}</button><button class="btn sm" data-jtest="${n}">Test</button></div></div>`).join('')}
      <div class="setting" style="flex-direction:column;align-items:stretch"><div class="txt"><div class="t">JVM arguments</div><div class="d">Plain text, applied to every instance unless it has its own.</div></div><textarea data-text="jvmArgs" rows="3">${esc(s.jvmArgs)}</textarea></div>
    </div>
    <h2>Installed Java</h2><div id="javas" class="list"><div class="list-row faint">Detecting…</div></div>
    <div class="row" style="margin-top:10px"><button class="btn sm" data-rt="java-runtime-delta">${icon('download')}Install Java 21</button><button class="btn sm" data-rt="java-runtime-gamma">Java 17</button><button class="btn sm" data-rt="jre-legacy">Java 8</button></div>`;
    this.bind(box);
    $('[data-bool="autoMemory"]', box).addEventListener('change', (e) => $('#memrow', box).classList.toggle('hidden', e.target.checked));
    $('#mem', box).oninput = (e) => ($('#memv', box).textContent = e.target.value);
    $('#mem', box).onchange = (e) => saveSettings({ memoryMax: +e.target.value });
    const saveMajor = (n, v) => saveSettings({ javaPaths: { ...(State.settings.javaPaths || {}), [n]: v } });
    $$('[data-jmajor]', box).forEach((i) => (i.onchange = async () => { await saveMajor(i.dataset.jmajor, i.value.trim()); toast('Saved'); }));
    $$('[data-jpick]', box).forEach((b) => (b.onclick = async () => {
      const [f] = await api('dialog:open', { title: 'Choose javaw.exe', properties: ['openFile'], filters: [{ name: 'Java', extensions: ['exe'] }, { name: 'All files', extensions: ['*'] }] });
      if (!f) return;
      const k = b.dataset.jpick;
      $('#jp-' + k, box).value = f;
      if (k === 'all') await saveSettings({ javaPath: f }); else await saveMajor(k, f);
      toast('Saved');
    }));
    $$('[data-jtest]', box).forEach((b) => (b.onclick = async () => {
      const k = b.dataset.jtest, p = $('#jp-' + k, box).value.trim();
      if (!p) return toast('Automatic Java — Solaris picks the right version for you', 'info');
      try {
        const r = await api('java:test', p);
        if (k !== 'all' && r.major !== +k) toast(`That is Java ${r.major}, not Java ${k}`, 'warn');
        else toast(`Works: Java ${r.version}${r.is64 ? ' (64-bit)' : ' (32-bit — use 64-bit for more memory)'}`, r.is64 ? 'ok' : 'warn');
      } catch (e) { toastErr(e); }
    }));
    $$('[data-rt]', box).forEach((b) => (b.onclick = async () => { b.disabled = true; try { await api('java:install', b.dataset.rt); toast('Java installed'); this.java(box); } catch (e) { toastErr(e); b.disabled = false; } }));
    const js = await api('java:detect');
    const jbox = $('#javas', box); if (!jbox) return;
    jbox.innerHTML = js.length ? js.map((j) => `<div class="list-row"><div class="mod-icon">${icon('cpu')}</div><div class="info"><div class="title">Java ${esc(j.version)} ${j.managed ? '<span class="chip accent">Solaris</span>' : ''}</div><div class="desc mono">${esc(j.path)}</div></div><button class="btn sm" data-use="${esc(j.path)}">Use globally</button></div>`).join('') : '<div class="list-row faint">No Java found — that\'s fine, Solaris installs it automatically.</div>';
    $$('[data-use]', jbox).forEach((b) => (b.onclick = async () => { await saveSettings({ javaPath: b.dataset.use }); toast('Java path set'); this.java(box); }));
  },

  async accounts(box) {
    const { accounts, active } = await refreshAccounts();
    box.innerHTML = `<div class="card">
      <div class="row"><h3 class="grow" style="margin:0">Accounts</h3><button class="btn sm primary" id="manage">${icon('user')}Manage accounts</button></div>
      <div class="stack" style="margin-top:12px">${accounts.map((a) => `<div class="row"><div class="head" data-h="${esc(a.id)}"></div><b>${esc(a.name)}</b><span class="chip">${a.type === 'msa' ? 'Microsoft' : 'Offline'}</span>${a.id === active ? '<span class="chip ok">Active</span>' : ''}</div>`).join('') || '<div class="faint">No accounts yet.</div>'}</div>
    </div>
    <h2>Microsoft sign-in</h2><div class="card">
      <div class="setting"><div class="txt"><div class="t">Status <span id="ms-status"></span></div><div class="d">Sign in from the account menu. You sign in on Microsoft’s own page; Solaris never sees your password.</div></div><div class="ctl"><button class="btn sm" id="ms-signin">${MS_LOGO}Sign in with Microsoft</button></div></div>
      <p class="faint small" style="margin-bottom:0">Privacy: Solaris talks directly to Microsoft, Xbox Live and Minecraft services. Tokens are encrypted on this computer and never sent anywhere else.</p>
    </div>`;
    $$('[data-h]', box).forEach((h) => renderHead(h, accounts.find((a) => a.id === h.dataset.h)));
    api('accounts:microsoftAvailable').then((ok) => {
      const el = $('#ms-status', box); if (el) el.innerHTML = ok ? '<span class="chip ok">Available</span>' : '<span class="chip warn">Coming in an update</span>';
      const b = $('#ms-signin', box); if (b) { b.disabled = !ok; b.onclick = () => microsoftLogin(null, () => this.accounts(box)); }
    });
    $('#manage', box).onclick = openAccounts;
    this.bind(box);
  },

  keybinds(box) {
    const kb = { ...State.settings.keybinds };
    box.innerHTML = `<div class="card">${Object.entries(KEY_LABELS).map(([k, l]) => `<div class="setting"><div class="txt"><div class="t">${l}</div></div><div class="ctl"><span class="kbd" data-kb="${k}">${esc(kb[k] || '—')}</span><button class="icon-btn" data-clear="${k}" title="Clear">${icon('close')}</button></div></div>`).join('')}
      <div class="row" style="justify-content:space-between;margin-top:12px"><span class="faint small">Click a shortcut, then press the new key combination. Alt+←/→ and mouse back/forward buttons navigate history.</span><button class="btn sm" id="kb-reset">Reset to defaults</button></div></div>`;
    this.stopKeyCapture();
    $$('[data-kb]', box).forEach((k) => (k.onclick = () => {
      this.stopKeyCapture();
      $$('.kbd', box).forEach((x) => { x.classList.remove('listening'); x.textContent = State.settings.keybinds[x.dataset.kb] || '—'; });
      k.classList.add('listening'); k.textContent = 'Press keys…';
      const h = async (e) => {
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
        e.preventDefault(); e.stopImmediatePropagation();
        this.stopKeyCapture();
        if (!box.isConnected) return;
        if (e.key === 'Escape') return this.keybinds(box);
        const combo = comboOf(e);
        await saveSettings({ keybinds: { ...State.settings.keybinds, [k.dataset.kb]: combo } });
        this.keybinds(box);
      };
      document.addEventListener('keydown', h, true);
      this._keyCapture = h;
    }));
    $$('[data-clear]', box).forEach((b) => (b.onclick = async () => { await saveSettings({ keybinds: { ...State.settings.keybinds, [b.dataset.clear]: '' } }); this.keybinds(box); }));
    $('#kb-reset', box).onclick = async () => { await saveSettings({ keybinds: {} }); State.settings = await api('settings:get'); this.keybinds(box); };
  },

  async storage(box) {
    box.innerHTML = `<div class="card"><div class="row"><h3 class="grow" style="margin:0">Disk usage</h3><span class="faint small mono" id="ddir"></span></div><div class="bar-chart" id="usage" style="margin-top:14px"><div class="faint">Calculating…</div></div></div>
      <div class="card" style="margin-top:14px">
        <div class="setting"><div class="txt"><div class="t">Clean up</div><div class="d">Removes the download cache, extracted natives, logs older than 14 days and game versions no instance uses.</div></div><div class="ctl"><button class="btn sm" id="clean">${icon('trash')}Clean up</button></div></div>
        <div class="setting"><div class="txt"><div class="t">Repair game files</div><div class="d">On the next launch, every game file is checked by checksum and damaged ones are downloaded again.</div></div><div class="ctl"><button class="btn sm" id="repair">${icon('refresh')}Repair</button></div></div>
        <div class="setting"><div class="txt"><div class="t">Data folder</div><div class="d">Move all instances, versions and settings to another drive. Solaris restarts afterwards.</div></div><div class="ctl"><button class="btn sm" id="open">${icon('folder')}Open</button><button class="btn sm" id="move">Move…</button><button class="btn sm ghost" id="resetdir">Reset location</button></div></div>
        <div class="setting"><div class="txt"><div class="t">Reset settings</div><div class="d">Restore every setting to its default. Instances and accounts are kept.</div></div><div class="ctl"><button class="btn sm danger" id="reset">Reset</button></div></div>
      </div>`;
    $('#ddir', box).textContent = State.info.dataDir;
    const u = await api('storage:usage');
    const max = Math.max(...u.map((x) => x.size), 1);
    const total = u.reduce((a, b) => a + b.size, 0);
    if ($('#usage', box)) $('#usage', box).innerHTML = u.sort((a, b) => b.size - a.size).map((x) => `<div class="b"><span>${esc(x.name)}</span><div class="track"><div class="fill" style="width:${(x.size / max) * 100}%"></div></div><span class="faint small" style="text-align:right">${fmtBytes(x.size)}</span></div>`).join('') + `<div class="b"><b>Total</b><span></span><b style="text-align:right">${fmtBytes(total)}</b></div>`;
    $('#clean', box).onclick = async () => { if (!(await confirmDialog('Remove cached and unused files?', { ok: 'Clean up' }))) return; try { const freed = await api('storage:cleanup'); toast(`Freed ${fmtBytes(freed)}`); this.storage(box); } catch (e) { toastErr(e); } };
    $('#repair', box).onclick = async () => { try { await api('storage:repair'); toast('Every game file will be checked and re-downloaded if damaged on the next launch'); } catch (e) { toastErr(e); } };
    $('#open', box).onclick = () => api('diag:openData');
    $('#move', box).onclick = async () => { if (await confirmDialog('Copy all Solaris data to a new folder and restart? The old folder is kept until you delete it.', { ok: 'Choose folder' })) api('storage:relocate').catch(toastErr); };
    $('#resetdir', box).onclick = async () => { if (await confirmDialog('Use the default data folder again and restart?')) api('storage:resetDataDir'); };
    $('#reset', box).onclick = async () => { if (await confirmDialog('Reset all settings to defaults?', { danger: true, ok: 'Reset' })) { State.settings = await api('settings:reset'); applyTheme(State.settings); renderNav(); toast('Settings reset'); } };
  },

  performance(box) {
    const s = State.settings;
    box.innerHTML = `<div class="card">
      ${this.toggle('lowEndMode', 'Low-end PC mode', 'Makes the launcher lighter: no blur, no animations, a plain background and a still 3D skin preview. Also turns on the JVM performance flags below.')}
      ${this.toggle('performanceMode', 'Game performance flags', 'Extra Java flags that help Minecraft run smoother on low-end machines.')}
      ${this.toggle('hardwareAcceleration', 'GPU acceleration', 'Draw the launcher with your graphics card. Turn off if the launcher flickers or shows a black window. Needs a restart.')}
      ${this.toggle('dedicatedGpu', 'Play on the dedicated GPU', 'Windows laptops: asks the system to run Minecraft on your high-performance graphics card.')}
      <div class="setting"><div class="txt"><div class="t">Parallel downloads</div><div class="d">How many files Solaris downloads at once. Lower this on slow or unstable connections.</div></div><div class="ctl"><select data-sel="concurrency">${[4, 8, 16, 32].map((n) => `<option ${n == s.concurrency ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
    </div>
    <div class="row" style="margin-top:12px"><button class="btn sm" id="hw-restart">${icon('refresh')}Restart Solaris now</button></div>`;
    this.bind(box);
    $('[data-bool="lowEndMode"]', box).addEventListener('change', async (e) => { if (e.target.checked && !State.settings.performanceMode) { await saveSettings({ performanceMode: true }); $('[data-bool="performanceMode"]', box).checked = true; } applyTheme(State.settings); });
    $('[data-sel="concurrency"]', box).onchange = async (e) => { await saveSettings({ concurrency: +e.target.value }); toast('Saved'); };
    $('#hw-restart', box).onclick = () => api('app:restart');
  },

  privacy(box) {
    box.innerHTML = `<h2 style="margin-top:0">Safety</h2><div class="card">
      ${this.toggle('autoScanMods', 'Scan new mods for malware', 'Every mod you install or drop in is checked for known malware (fractureiser, account stealers, hidden programs). You are warned if something looks wrong.')}
      <div class="setting"><div class="txt"><div class="t">Scan all instances</div><div class="d" id="scan-res">Check every mod in every instance now.</div></div><div class="ctl"><button class="btn sm primary" id="scan-now">${icon('shield')}Scan now</button></div></div>
      <p class="faint small" style="margin-bottom:0">The scan looks for known malware patterns. It is not a full antivirus — only install mods from sources you trust.</p>
    </div>
    <h2>Privacy</h2><div class="card">
      ${this.toggle('streamerMode', 'Streamer mode', 'Blur your account name in the sidebar and hide it from Discord.')}
      ${this.toggle('confirmLogUpload', 'Ask before uploading logs', 'Confirm before a log or crash report is uploaded to mclo.gs.')}
      ${this.toggle('discordShowInstance', 'Discord: show instance name', 'Show which instance you are playing. Off: just “Playing Minecraft”.')}
      ${this.toggle('discordShowServer', 'Discord: show server address', 'Show the server you joined.')}
      ${this.toggle('discordShowHead', 'Discord: show my player head', 'Microsoft accounts: your player head is shown as the Discord picture (loaded from mc-heads.net by Discord).')}
      <p class="faint small" style="margin-bottom:0">Solaris has no telemetry or analytics. It only talks to Microsoft/Mojang (sign-in, game files, skins), Modrinth/CurseForge (when you browse), servers you ping, and mclo.gs when you upload a log.</p>
    </div>`;
    this.bind(box);
    $('[data-bool="streamerMode"]', box).addEventListener('change', () => setTimeout(renderAccountChip, 50));
    $('#scan-now', box).onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true; b.innerHTML = `${icon('shield')}Scanning…`;
      try {
        const r = await api('safety:scanAll');
        const out = $('#scan-res', box); if (!out) return;
        out.innerHTML = r.flagged.length
          ? `<span style="color:var(--danger)">${r.flagged.length} suspicious file${r.flagged.length > 1 ? 's' : ''} in ${r.scanned} mods:</span>${r.flagged.map((f) => `<div class="crash-cause" style="margin-top:6px"><b>${esc(f.file)}</b> <span class="faint small">in ${esc(f.instanceName)}</span>${f.findings.map((x) => `<div class="small muted">• ${esc(x)}</div>`).join('')}<div class="row" style="margin-top:6px"><button class="btn sm" data-off="${esc(f.instanceId)}|${esc(f.file)}">Turn off</button><button class="btn sm danger" data-del="${esc(f.instanceId)}|${esc(f.file)}">${icon('trash')}Delete</button></div></div>`).join('')}`
          : `<span style="color:var(--ok)">All clear — scanned ${r.scanned} mod${r.scanned === 1 ? '' : 's'}, nothing suspicious.</span>`;
        $$('[data-off]', out).forEach((x) => (x.onclick = async () => { const [i, f] = x.dataset.off.split('|'); await api('safety:disable', i, f); x.closest('.crash-cause').remove(); toast('Turned off'); }));
        $$('[data-del]', out).forEach((x) => (x.onclick = async () => { const [i, f] = x.dataset.del.split('|'); await api('instances:deleteContent', i, 'mods', [f]); x.closest('.crash-cause').remove(); toast('Moved to the Recycle Bin'); }));
      } catch (er) { toastErr(er); }
      finally { if (b.isConnected) { b.disabled = false; b.innerHTML = `${icon('shield')}Scan now`; } }
    };
  },

  integrations(box) {
    const cfKey = State.settings.curseforgeKey || '';
    box.innerHTML = `<h2 style="margin-top:0">Mods & modpacks</h2><div class="card">
      <div class="setting"><div class="txt"><div class="t">Modrinth</div><div class="d">Mods, modpacks, resource packs, shaders and datapacks from Modrinth's public API.</div></div><div class="ctl"><span class="chip ok">Connected</span></div></div>
      <div class="setting"><div class="txt"><div class="t">CurseForge ${cfKey ? '<span class="chip ok">Connected</span>' : '<span class="chip">Needs a key</span>'}</div><div class="d">CurseForge only allows apps with an API key. Create a free key at <a href="#" id="cf-console">console.curseforge.com</a> (sign in → API keys) and paste it here. It is stored only on this computer.</div></div>
        <div class="ctl"><input type="password" id="cf-key" class="mono" value="${esc(cfKey)}" placeholder="$2a$10$…" style="width:220px" autocomplete="off"><button class="btn sm primary" id="cf-save">${T('Save')}</button>${cfKey ? `<button class="btn sm ghost" id="cf-clear">${icon('close')}</button>` : ''}</div></div>
    </div>
    <h2>Other services</h2><div class="card">
      ${this.toggle('discordRpc', 'Discord Rich Presence', 'Show what you are playing on your Discord profile.')}
      <div class="setting"><div class="txt"><div class="t">Discord application ID</div><div class="d">Create an application at discord.com/developers, upload an art asset named <span class="mono">solaris</span>, and paste its ID here.</div></div><div class="ctl"><input type="text" class="mono" data-text="discordClientId" value="${esc(State.settings.discordClientId)}" style="width:240px" placeholder="123456789012345678"></div></div>
      <div class="setting"><div class="txt"><div class="t">mclo.gs</div><div class="d">Used only when you upload a log or crash report.</div></div><div class="ctl"><span class="chip">On demand</span></div></div>
    </div>`;
    this.bind(box);
    $('#cf-console', box).onclick = (e) => { e.preventDefault(); api('shell:open', 'https://console.curseforge.com/'); };
    $('#cf-save', box).onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true; b.textContent = 'Checking…';
      try { State.settings = await api('curseforge:setKey', $('#cf-key', box).value.trim()); Bus.emit('settings', State.settings); toast('CurseForge connected'); this.integrations(box); }
      catch (er) { toastErr(er); b.disabled = false; b.textContent = T('Save'); }
    };
    if ($('#cf-clear', box)) $('#cf-clear', box).onclick = async () => { State.settings = await api('curseforge:setKey', ''); Bus.emit('settings', State.settings); this.integrations(box); };
  },

  async diagnostics(box) {
    box.innerHTML = `<div class="card"><div class="setting"><div class="txt"><div class="t">Hosts file check</div><div class="d" id="hosts">Checking whether Mojang/Microsoft domains are blocked…</div></div><div class="ctl"><button class="btn sm" id="recheck">${icon('refresh')}Re-check</button></div></div>
      <div class="setting"><div class="txt"><div class="t">Launcher logs</div><div class="d">Game logs for each session are stored in the logs folder.</div></div><div class="ctl"><button class="btn sm" id="logs">${icon('folder')}Open logs</button></div></div></div>`;
    const check = async () => {
      const r = await api('diag:hosts');
      $('#hosts', box).innerHTML = !r.readable ? 'Could not read the hosts file.' : r.issues.length
        ? `<span style="color:var(--danger)">Found ${r.issues.length} entr${r.issues.length > 1 ? 'ies' : 'y'} that may block sign-in or downloads:</span>${r.issues.map((i) => `<div class="mono small">line ${i.line}: ${esc(i.text)}</div>`).join('')}<div class="small">To repair, open <span class="mono">${esc(r.file)}</span> as administrator and remove or comment out (#) these lines.</div>`
        : `<span style="color:var(--ok)">All good — no Minecraft or Microsoft domains are redirected.</span>`;
    };
    $('#recheck', box).onclick = check;
    $('#logs', box).onclick = () => api('diag:openLogs');
    check();
  },

  about(box) {
    const i = State.info;
    box.innerHTML = `<div class="card" style="text-align:center;padding:36px">
      <img src="../assets/icon.png" style="width:96px;height:96px">
      <h1 style="margin:10px 0 4px">Solaris</h1><div class="muted">Version ${esc(i.version)} · Electron ${esc(i.electron)} · ${esc(i.platform)}-${esc(i.arch)}</div>
      <div class="row" style="justify-content:center;margin-top:18px"><button class="btn" id="cl">${icon('changelog')}${T('Changelog')}</button><button class="btn" id="rm">${icon('roadmap')}${T('Roadmap')}</button></div>
      <p class="faint small" style="margin-top:22px">Solaris is not affiliated with Mojang Studios or Microsoft. Minecraft is a trademark of Mojang Synergies AB.</p></div>`;
    $('#cl', box).onclick = () => Router.go('changelog');
    $('#rm', box).onclick = () => Router.go('roadmap');
  },
};

function comboOf(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (k === ' ') k = 'Space';
  parts.push(k);
  return parts.join('+');
}
