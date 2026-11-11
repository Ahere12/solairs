/* Core helpers shared by every page: API, DOM, icons, i18n, router, global state. */
const api = (name, ...args) => window.solaris.call(name, ...args);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ---------- icons (stroke icons, 24×24) ---------- */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  library: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  browse: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  servers: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  skins: '<path d="M8 3h8l4 4-3 3v11H7V10L4 7z"/>',
  gallery: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  console: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  changelog: '<path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  roadmap: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  starFill: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" fill="currentColor"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  fwd: '<path d="m9 18 6-6-6-6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  min: '<path d="M5 12h14"/>',
  max: '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.3-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2 .6 3.2 2.5 3.5 5.5"/>',
  world: '<path d="M3 17 9 7l4 6 3-4 5 8z"/><circle cx="17" cy="5" r="2"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  palette: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1.3" fill="currentColor"/><circle cx="12" cy="7.5" r="1.3" fill="currentColor"/><circle cx="16" cy="10" r="1.3" fill="currentColor"/><path d="M12 21a3 3 0 0 1 0-6h2a3 3 0 0 0 3-3"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
  hdd: '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5 13 8 4h8l3 9M7 16.5h.01"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  bug: '<rect x="7" y="6" width="10" height="14" rx="5"/><path d="M12 10v10M3 13h4M17 13h4M5 7l3 2M19 7l-3 2M5 19l3-2M19 19l-3-2"/>',
  discord: '<path d="M8 17c-2 0-4-1-5-2 0-4 1-8 3-10 1-.5 2.5-1 4-1l.5 1c1-.2 2-.2 3 0l.5-1c1.5 0 3 .5 4 1 2 2 3 6 3 10-1 1-3 2-5 2l-1-2"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  sort: '<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>',
  wifi:'<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/>',
};
const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24">${ICONS[name] || ''}</svg>`;

/* ---------- formatting ---------- */
const fmtBytes = (b) => { if (!b) return '0 B'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(4, Math.floor(Math.log(b) / Math.log(1024))); return (b / 1024 ** i).toFixed(i ? 1 : 0) + ' ' + u[i]; };
const fmtNum = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n ?? 0));
const fmtDuration = (ms) => { const m = Math.floor((ms || 0) / 60000); if (m < 60) return m + 'm'; const h = Math.floor(m / 60); return h + 'h ' + (m % 60) + 'm'; };
const timeAgo = (t) => {
  if (!t) return T('never');
  const s = (Date.now() - t) / 1000;
  if (s < 60) return T('just now');
  const units = [[31536000, 'y'], [2592000, 'mo'], [86400, 'd'], [3600, 'h'], [60, 'm']];
  for (const [n, u] of units) if (s >= n) return Math.floor(s / n) + u + ' ' + T('ago');
  return '';
};
const fmtDate = (d) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T12:00:00' : d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const LOADER_NAMES = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge', legacyfabric: 'Legacy Fabric' };

/* Minecraft § formatting / chat component → HTML */
const MC_COLORS = { 0: '#000', 1: '#00a', 2: '#0a0', 3: '#0aa', 4: '#a00', 5: '#a0a', 6: '#fa0', 7: '#aaa', 8: '#555', 9: '#55f', a: '#5f5', b: '#5ff', c: '#f55', d: '#f5f', e: '#ff5', f: '#fff' };
const NAMED = { black: '0', dark_blue: '1', dark_green: '2', dark_aqua: '3', dark_red: '4', dark_purple: '5', gold: '6', gray: '7', dark_gray: '8', blue: '9', green: 'a', aqua: 'b', red: 'c', light_purple: 'd', yellow: 'e', white: 'f' };
function chatToLegacy(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  let s = '';
  if (c.color) s += NAMED[c.color] ? '§' + NAMED[c.color] : '';
  if (c.bold) s += '§l';
  s += c.text || '';
  for (const e of c.extra || []) s += chatToLegacy(e) + (c.color && NAMED[c.color] ? '§' + NAMED[c.color] : '§r');
  return s;
}
function motdHtml(motd) {
  const str = chatToLegacy(motd);
  let out = '', color = null, bold = false;
  for (const part of str.split(/(§.)/)) {
    const m = part.match(/^§(.)$/);
    if (m) { const k = m[1].toLowerCase(); if (MC_COLORS[k]) { color = MC_COLORS[k]; bold = false; } else if (k === 'l') bold = true; else if (k === 'r') { color = null; bold = false; } continue; }
    if (!part) continue;
    out += `<span style="${color ? 'color:' + color + ';' : ''}${bold ? 'font-weight:700;' : ''}">${esc(part)}</span>`;
  }
  return out;
}

/* ---------- i18n (instant language switching) ---------- */
const I18N = {
  es: { Home: 'Inicio', Library: 'Biblioteca', Browse: 'Explorar', 'Solaris Client': 'Solaris Client', Servers: 'Servidores', Skins: 'Aspectos', Gallery: 'Galería', Console: 'Consola', Changelog: 'Novedades', Roadmap: 'Hoja de ruta', Settings: 'Ajustes', Play: 'Jugar', Stop: 'Detener', 'New instance': 'Nueva instancia', Import: 'Importar', Search: 'Buscar', never: 'nunca', 'just now': 'ahora', ago: 'atrás', Install: 'Instalar', Cancel: 'Cancelar', Save: 'Guardar', Delete: 'Eliminar', 'Add account': 'Añadir cuenta', Discover: 'Descubrir', Game: 'Juego', Help: 'Ayuda' },
  fr: { Home: 'Accueil', Library: 'Bibliothèque', Browse: 'Parcourir', Servers: 'Serveurs', Skins: 'Skins', Gallery: 'Galerie', Console: 'Console', Changelog: 'Nouveautés', Roadmap: 'Feuille de route', Settings: 'Paramètres', Play: 'Jouer', Stop: 'Arrêter', 'New instance': 'Nouvelle instance', Import: 'Importer', Search: 'Rechercher', never: 'jamais', 'just now': "à l'instant", ago: '', Install: 'Installer', Cancel: 'Annuler', Save: 'Enregistrer', Delete: 'Supprimer', 'Add account': 'Ajouter un compte', Discover: 'Découvrir', Game: 'Jeu', Help: 'Aide' },
  de: { Home: 'Start', Library: 'Bibliothek', Browse: 'Entdecken', Servers: 'Server', Skins: 'Skins', Gallery: 'Galerie', Console: 'Konsole', Changelog: 'Änderungen', Roadmap: 'Roadmap', Settings: 'Einstellungen', Play: 'Spielen', Stop: 'Stoppen', 'New instance': 'Neue Instanz', Import: 'Importieren', Search: 'Suchen', never: 'nie', 'just now': 'gerade eben', ago: 'her', Install: 'Installieren', Cancel: 'Abbrechen', Save: 'Speichern', Delete: 'Löschen', 'Add account': 'Konto hinzufügen', Discover: 'Entdecken', Game: 'Spiel', Help: 'Hilfe' },
  pl: { Home: 'Start', Library: 'Biblioteka', Browse: 'Przeglądaj', Servers: 'Serwery', Skins: 'Skórki', Gallery: 'Galeria', Console: 'Konsola', Changelog: 'Lista zmian', Roadmap: 'Plan rozwoju', Settings: 'Ustawienia', Play: 'Graj', Stop: 'Zatrzymaj', 'New instance': 'Nowa instancja', Import: 'Importuj', Search: 'Szukaj', never: 'nigdy', 'just now': 'przed chwilą', ago: 'temu', Install: 'Zainstaluj', Cancel: 'Anuluj', Save: 'Zapisz', Delete: 'Usuń', 'Add account': 'Dodaj konto', Discover: 'Odkrywaj', Game: 'Gra', Help: 'Pomoc' },
};
const LANGS = { en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', pl: 'Polski' };
const T = (s) => (I18N[State.settings?.language]?.[s]) || s;

/* ---------- global state + events ---------- */
const State = {
  settings: null,
  accounts: { active: null, accounts: [] },
  instances: [],
  launch: {}, // instanceId -> { stage, progress, detail, error }
  runs: {}, // runId -> { instanceId, name, lines[], running }
  tasks: {}, // id -> { label, progress, detail }
  info: {},
};
const Bus = {
  h: {},
  on(ev, fn) { (this.h[ev] = this.h[ev] || new Set()).add(fn); return () => this.h[ev].delete(fn); },
  emit(ev, d) { for (const fn of this.h[ev] || []) { try { fn(d); } catch (e) { console.error(e); } } },
};

async function refreshInstances() { State.instances = await api('instances:list'); Bus.emit('instances', State.instances); return State.instances; }
async function refreshAccounts() { State.accounts = await api('accounts:list'); Bus.emit('accounts', State.accounts); return State.accounts; }
async function saveSettings(patch) { State.settings = await api('settings:set', patch); Bus.emit('settings', State.settings); return State.settings; }

/* ---------- router with back/forward history ---------- */
const Pages = {};
const Router = {
  stack: [], index: -1, current: null, cleanup: null,
  go(name, params = {}, { replace = false, record = true } = {}) {
    if (!Pages[name]) name = 'home';
    if (record) {
      if (replace && this.index >= 0) this.stack[this.index] = { name, params };
      else { this.stack = this.stack.slice(0, this.index + 1); this.stack.push({ name, params }); this.index = this.stack.length - 1; }
    }
    this.render(name, params);
  },
  back() { if (this.index > 0) { this.index--; const e = this.stack[this.index]; this.render(e.name, e.params); } },
  forward() { if (this.index < this.stack.length - 1) { this.index++; const e = this.stack[this.index]; this.render(e.name, e.params); } },
  reload() { const e = this.stack[this.index]; if (e) this.render(e.name, e.params); },
  render(name, params) {
    if (this.cleanup) { try { this.cleanup(); } catch {} this.cleanup = null; }
    this.current = { name, params };
    const main = $('#main');
    main.scrollTop = 0;
    main.innerHTML = '<div class="page"></div>';
    const el = main.firstElementChild;
    const page = Pages[name];
    const subs = [];
    const ctx = { on: (ev, fn) => subs.push(Bus.on(ev, fn)), params };
    Promise.resolve().then(() => page.render(el, params, ctx)).then((c) => { if (typeof c === 'function') subs.push(c); }).catch((e) => { el.innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div></div>`; });
    this.cleanup = () => subs.forEach((u) => u());
    Bus.emit('route', { name, params });
    $('#nav-back').disabled = this.index <= 0;
    $('#nav-fwd').disabled = this.index >= this.stack.length - 1;
  },
};
