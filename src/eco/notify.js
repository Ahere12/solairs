// Astra Notifications — one inbox for everything Astra tells you about: friends, servers, modpack updates,
// integration problems, finished backups and new Minecraft versions.
//
// Each category can be turned off, or kept in the inbox without a desktop pop-up. The same thing reported twice
// within a few minutes (same `key`) is kept once. The inbox lives in notifications.json (newest 200).
//
// createCenter() is the plain logic (tested without Electron); the module's own functions wire it to Astra.

const CATEGORIES = {
  friend: { name: 'Friend activity', desktop: true },
  server: { name: 'Server availability', desktop: true },
  modpack: { name: 'Modpack updates', desktop: false },
  integration: { name: 'Integration problems', desktop: false },
  backup: { name: 'Backups', desktop: false },
  minecraft: { name: 'Minecraft updates', desktop: false },
};
const MAX = 200;
const DEDUPE_MS = 10 * 60000;

function createCenter({ store, deliver = () => {}, now = () => Date.now() }) {
  const load = () => { const d = store.read() || {}; return { items: Array.isArray(d.items) ? d.items : [], prefs: d.prefs || {}, seq: d.seq || 0 }; };
  const save = (d) => store.write(d);
  const prefsOf = (d) => Object.fromEntries(Object.entries(CATEGORIES).map(([k, c]) => [k, { enabled: d.prefs[k]?.enabled ?? true, desktop: d.prefs[k]?.desktop ?? c.desktop }]));

  return {
    CATEGORIES,
    /** Adds one. Returns it, or null when its category is off or it was just reported. */
    add({ category, title, body = '', key = null, action = null, desktop = true, toast = true }) {
      if (!CATEGORIES[category]) throw new Error(`Unknown notification category “${category}”`);
      if (!title) throw new Error('A notification needs a title');
      const d = load(), p = prefsOf(d)[category];
      if (!p.enabled) return null;
      const t = now();
      if (key && d.items.some((i) => i.key === key && t - i.at < DEDUPE_MS)) return null;
      const item = { id: `n${t.toString(36)}${(++d.seq).toString(36)}`, category, title: String(title).slice(0, 140), body: String(body || '').slice(0, 500), key, action: action || null, at: t, read: false };
      d.items = [item, ...d.items].slice(0, MAX);
      save(d);
      try { deliver(item, { desktop: desktop && p.desktop, toast }); } catch {}
      return item;
    },
    list({ category = null, unread = false, limit = MAX } = {}) {
      return load().items.filter((i) => (!category || i.category === category) && (!unread || !i.read)).slice(0, limit);
    },
    unreadCount() { return load().items.filter((i) => !i.read).length; },
    markRead(ids = 'all') {
      const d = load(), set = ids === 'all' ? null : new Set([].concat(ids));
      for (const i of d.items) if (!set || set.has(i.id)) i.read = true;
      save(d); return this.unreadCount();
    },
    remove(id) { const d = load(); d.items = d.items.filter((i) => i.id !== id); save(d); return true; },
    clear() { const d = load(); d.items = []; save(d); return true; },
    prefs() { return prefsOf(load()); },
    setPrefs(patch = {}) {
      const d = load();
      for (const [k, v] of Object.entries(patch)) {
        if (!CATEGORIES[k] || !v || typeof v !== 'object') continue;
        d.prefs[k] = { ...(d.prefs[k] || {}), ...('enabled' in v ? { enabled: !!v.enabled } : {}), ...('desktop' in v ? { desktop: !!v.desktop } : {}) };
      }
      save(d); return prefsOf(d);
    },
  };
}

// ---------- Astra ----------
let center = null;
function get() {
  if (center) return center;
  const { paths, readJSON, writeJSON, push } = require('../util');
  const file = () => paths.file('notifications.json');
  center = createCenter({
    store: { read: () => readJSON(file(), {}), write: (d) => writeJSON(file(), d) },
    deliver: (item, { desktop, toast = true }) => {
      push('notify:new', item);
      if (toast) push('toast', { type: item.category === 'integration' ? 'warn' : 'info', text: item.body ? `${item.title} — ${item.body}` : item.title });
      if (desktop) require('../connect/runtime').desktopNotify({ title: item.title, body: item.body, address: item.action?.kind === 'server' ? item.action.address : null });
    },
  });
  return center;
}
const add = (n) => { try { return get().add(n); } catch (e) { console.error('[Astra] notification:', e.message); return null; } };

module.exports = { createCenter, CATEGORIES, get, add };
