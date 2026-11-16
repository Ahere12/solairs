// Astra Connect — the integration registry.
//
// Every integration is a plain definition object (see docs/connect.md). The registry checks the definitions,
// keeps each integration's on/off state, settings and recent errors, and asks each one for its *real* status.
// It never makes up a status: an integration that isn't built says so ("planned"), one that needs a service
// Astra doesn't have says so ("unavailable"), and a status check that throws or hangs becomes an error.
//
// Kept free of Electron and file paths so it can be tested on its own: storage and secret sealing are passed in.

const CATEGORIES = {
  maps: 'Maps & Navigation',
  social: 'Social',
  servers: 'Server Integrations',
  player: 'Player Utilities',
};
const TYPES = {
  mod: 'Minecraft mod',
  plugin: 'Server plugin',
  api: 'External API',
  local: 'Local companion',
  dashboard: 'Web dashboard',
};
// connected — working right now · ready — set up, nothing to show yet · needs-setup — the player has to do something
// off — turned off · error — something went wrong · unavailable — can't work (says why) · planned — not built yet
const STATES = ['connected', 'ready', 'needs-setup', 'off', 'error', 'unavailable', 'planned'];
const FIELD_TYPES = ['text', 'url', 'number', 'bool', 'select', 'secret'];
const STATUS_TIMEOUT = 5000;
const MAX_ERRORS = 20;

function validateDef(d) {
  const bad = (why) => { throw new Error(`Integration ${d && d.id ? `“${d.id}”` : '(no id)'}: ${why}`); };
  if (!d || typeof d !== 'object') bad('must be an object');
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(d.id || '')) bad('id must be lowercase letters, digits and dashes');
  for (const k of ['name', 'description', 'icon']) if (typeof d[k] !== 'string' || !d[k].trim()) bad(`${k} is required`);
  if (!CATEGORIES[d.category]) bad(`unknown category “${d.category}”`);
  const types = [].concat(d.type || []);
  if (!types.length || types.some((t) => !TYPES[t])) bad(`type must be one or more of ${Object.keys(TYPES).join(', ')}`);
  if (d.docs != null && !/^https:\/\/\S+$/.test(d.docs)) bad('docs must be an https:// link');
  if (d.planned || d.unavailable) { if (typeof d.status === 'function') bad('a planned/unavailable integration has no status check'); }
  else if (typeof d.status !== 'function') bad('status() is required');
  if (d.toggle && (typeof d.toggle.get !== 'function' || typeof d.toggle.set !== 'function')) bad('toggle needs get() and set()');
  if (d.details != null && typeof d.details !== 'function') bad('details must be a function');
  for (const f of d.config || []) {
    if (!/^[a-zA-Z][\w-]{0,40}$/.test(f.key || '')) bad('config field without a valid key');
    if (!FIELD_TYPES.includes(f.type)) bad(`config field “${f.key}” has unknown type “${f.type}”`);
    if (f.type === 'select' && !(Array.isArray(f.options) && f.options.length)) bad(`select field “${f.key}” needs options`);
  }
  return d;
}

/** Turns one typed-in config value into what is stored, or throws a message for the player. */
function cleanValue(f, v) {
  if (f.type === 'bool') return !!v;
  if (v == null || v === '') { if (f.required) throw new Error(`${f.label || f.key} is required.`); return f.type === 'number' ? null : ''; }
  if (f.type === 'number') {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${f.label || f.key} must be a number.`);
    if (f.min != null && n < f.min) throw new Error(`${f.label || f.key} must be at least ${f.min}.`);
    if (f.max != null && n > f.max) throw new Error(`${f.label || f.key} must be at most ${f.max}.`);
    return n;
  }
  const s = String(v).trim();
  if (s.length > (f.maxLength || 500)) throw new Error(`${f.label || f.key} is too long.`);
  if (f.type === 'url' && !/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(s)) throw new Error(`${f.label || f.key} must be a link starting with http:// or https://`);
  if (f.type === 'select' && !f.options.some((o) => (o.value ?? o) === s)) throw new Error(`${f.label || f.key}: pick one of the options.`);
  return s;
}

function withTimeout(p, ms) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`no answer within ${ms / 1000} s`)), ms); })]).finally(() => clearTimeout(t));
}

/**
 * @param defs     integration definitions
 * @param store    { read(): object, write(obj) } — where on/off, settings and errors are kept
 * @param secrets  { seal(string): string, unseal(string): string } — secret settings are only stored sealed
 */
function createRegistry({ defs = [], store, secrets = { seal: (s) => s, unseal: (s) => s }, timeout = STATUS_TIMEOUT } = {}) {
  if (!store) throw new Error('createRegistry needs a store');
  const byId = new Map();
  for (const d of defs) {
    validateDef(d);
    if (byId.has(d.id)) throw new Error(`Integration id “${d.id}” is used twice.`);
    byId.set(d.id, d);
  }
  const load = () => { const s = store.read() || {}; return { enabled: s.enabled || {}, config: s.config || {}, errors: s.errors || {} }; };
  const need = (id) => { const d = byId.get(id); if (!d) throw new Error(`No integration called “${id}”.`); return d; };

  const isEnabled = (d, st = load()) => {
    if (d.planned || d.unavailable) return false;
    if (d.toggle) { try { return !!d.toggle.get(); } catch { return false; } }
    if (d.core) return true;
    return st.enabled[d.id] ?? !!d.defaultEnabled;
  };
  /** Settings as the integration itself uses them (secrets unsealed). Only ever used in the main process. */
  function configOf(d, st = load()) {
    const saved = st.config[d.id] || {}, out = {};
    for (const f of d.config || []) {
      if (f.from) { try { out[f.key] = f.from.get(); } catch { out[f.key] = f.default ?? null; } continue; }
      const v = saved[f.key];
      if (f.type === 'secret') { try { out[f.key] = v ? secrets.unseal(v) : ''; } catch { out[f.key] = ''; } }
      else out[f.key] = v ?? f.default ?? (f.type === 'bool' ? false : '');
    }
    return out;
  }
  /** What the page may see: a secret is only ever "set" or "not set". */
  function publicConfig(d, st) {
    const c = configOf(d, st);
    for (const f of d.config || []) if (f.type === 'secret') c[f.key] = { set: !!c[f.key] };
    return c;
  }
  function recordError(id, message) {
    const st = store.read() || {};
    st.errors = st.errors || {};
    const list = st.errors[id] || [];
    if (list[0]?.message === message && Date.now() - list[0].at < 60000) return; // the same problem again right away
    st.errors[id] = [{ at: Date.now(), message: String(message).slice(0, 500) }, ...list].slice(0, MAX_ERRORS);
    store.write(st);
  }

  async function status(id) {
    const d = need(id), st = load();
    if (d.planned) return { state: 'planned', text: d.planned === true ? 'Not built yet' : d.planned };
    if (d.unavailable) return { state: 'unavailable', text: d.unavailable };
    if (!isEnabled(d, st)) return { state: 'off', text: 'Turned off' };
    try {
      const s = await withTimeout(Promise.resolve().then(() => d.status({ config: configOf(d, st) })), timeout);
      if (!s || !STATES.includes(s.state)) throw new Error('gave an unknown status');
      if (s.state === 'error' && s.text) recordError(id, s.text);
      return { state: s.state, text: String(s.text || ''), detail: s.detail || null, at: Date.now() };
    } catch (e) {
      const text = `Couldn’t check: ${e.message}`;
      recordError(id, text);
      return { state: 'error', text, at: Date.now() };
    }
  }

  function view(d, st, s) {
    return {
      id: d.id, name: d.name, description: d.description, icon: d.icon, category: d.category, categoryName: CATEGORIES[d.category],
      types: [].concat(d.type).map((t) => ({ id: t, name: TYPES[t] })), docs: d.docs || null, page: d.page || null,
      compat: d.compat ? { software: d.compat.software || null, note: d.compat.note || '' } : null,
      canToggle: !d.planned && !d.unavailable && !d.core, core: !!d.core, enabled: isEnabled(d, st),
      config: (d.config || []).map((f) => ({ key: f.key, label: f.label || f.key, type: f.type, help: f.help || '', options: f.options || null, min: f.min ?? null, max: f.max ?? null })),
      hasDetails: typeof d.details === 'function', values: publicConfig(d, st), errors: (st.errors[d.id] || []).slice(0, 5), status: s || null,
    };
  }

  return {
    CATEGORIES, TYPES, STATES,
    ids: () => [...byId.keys()],
    async list({ withStatus = true } = {}) {
      const st = load();
      const statuses = withStatus ? await Promise.all([...byId.keys()].map((id) => status(id))) : [];
      const fresh = load(); // status checks may have recorded errors
      return [...byId.values()].map((d, i) => view(d, fresh, statuses[i] || null));
    },
    async get(id) { const d = need(id); const s = await status(id); return view(d, load(), s); },
    status,
    async setEnabled(id, on) {
      const d = need(id);
      if (d.planned || d.unavailable) throw new Error(`${d.name} can’t be turned on: ${d.planned ? 'it isn’t built yet' : d.unavailable}`);
      if (d.core) throw new Error(`${d.name} is part of Astra and is always on.`);
      if (d.toggle) await d.toggle.set(!!on);
      else { const st = store.read() || {}; st.enabled = { ...(st.enabled || {}), [id]: !!on }; store.write(st); }
      if (d.onToggle) await d.onToggle(!!on);
      return this.get(id);
    },
    async setConfig(id, patch = {}) {
      const d = need(id);
      const st = store.read() || {};
      const saved = { ...((st.config || {})[id] || {}) };
      const forward = {};
      for (const f of d.config || []) {
        if (!(f.key in patch)) continue;
        if (f.type === 'secret') {
          const v = patch[f.key];
          if (v && typeof v === 'object' && v.clear) delete saved[f.key];
          else if (typeof v === 'string' && v.trim()) saved[f.key] = secrets.seal(cleanValue({ ...f, type: 'text' }, v));
          continue; // empty = keep the saved one
        }
        const v = cleanValue(f, patch[f.key]);
        if (f.from) forward[f.key] = v; else saved[f.key] = v;
      }
      for (const f of d.config || []) if (f.from && f.key in forward) await f.from.set(forward[f.key]);
      st.config = { ...(st.config || {}), [id]: saved };
      store.write(st);
      if (d.onConfig) await d.onConfig(configOf(d, load()));
      return this.get(id);
    },
    /** The integration's settings while it's on, otherwise null — for things running in the background. */
    active(id) { const d = byId.get(id); if (!d) return null; const st = load(); return isEnabled(d, st) ? configOf(d, st) : null; },
    /** A live table for the details window: { columns: [..], rows: [[..]], note }. Only while the integration is on. */
    async details(id) {
      const d = need(id);
      if (typeof d.details !== 'function') return null;
      const st = load();
      if (!isEnabled(d, st)) return null;
      const t = await withTimeout(Promise.resolve().then(() => d.details({ config: configOf(d, st) })), timeout);
      if (!t) return null;
      if (!Array.isArray(t.columns) || !Array.isArray(t.rows) || t.rows.some((r) => !Array.isArray(r) || r.length !== t.columns.length)) throw new Error(`${d.name}: details() gave a broken table`);
      return { columns: t.columns.map(String), rows: t.rows.map((r) => r.map((c) => (c == null ? '' : String(c)))), note: t.note ? String(t.note) : '' };
    },
    clearErrors(id) { need(id); const st = store.read() || {}; if (st.errors) { delete st.errors[id]; store.write(st); } return []; },
    /** Which of the player's hosted servers can use this integration, and why not. */
    compatibility(id, servers = []) {
      const d = need(id);
      if (!d.compat?.software) return null;
      return servers.map((s) => ({ id: s.id, name: s.name, software: s.software, ok: d.compat.software.includes(s.software), why: d.compat.software.includes(s.software) ? '' : (d.compat.why ? d.compat.why(s) : `Doesn’t run on ${s.softwareName || s.software} servers`) }));
    },
  };
}

module.exports = { createRegistry, validateDef, cleanValue, CATEGORIES, TYPES, STATES };
