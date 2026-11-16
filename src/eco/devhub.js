// Astra Developer Hub — third-party integrations for Astra Connect.
//
// An integration is a folder with an `astra-integration.json` manifest (spec: docs/developer-hub.md, JSON schema:
// sdk/astra-integration.schema.json). It is *declarative*: it describes a status check (an HTTPS JSON API, or a
// Minecraft server ping), settings, and optional alerts. Astra runs the check itself — no third-party code ever
// runs inside Astra — and only with the permissions the player granted:
//
//   network:<host>   fetch https://<host>/… (exact host, or *.example.com for its subdomains)
//   ping             ping Minecraft servers (Server List Ping)
//   notifications    put alerts in the Astra inbox when the status changes
//
// Until every requested permission is granted, the integration shows "Needs setup" and does nothing.
// Installed integrations live in <data>/integrations/<id>/; grants and the error log in devhub.json.

const fs = require('fs');
const path = require('path');
const semver = require('./semver');

const MANIFEST = 'astra-integration.json';
const MANIFEST_VERSION = 1;
const CATEGORIES = ['maps', 'social', 'servers', 'player'];
const FIELD_TYPES = ['text', 'url', 'number', 'bool', 'select', 'secret'];
const MAX_BODY = 256 * 1024;
// names that only exist on a home or company network: an integration must never reach into it
const LOCAL_HOST = /(^|\.)(localhost|local|lan|home|internal|intranet|corp|home\.arpa)$/i;
/** Reads a fetch answer, stopping as soon as it is bigger than allowed (never holds a huge answer in memory). */
async function readCapped(res, max = MAX_BODY) {
  if (!res.body || typeof res.body.getReader !== 'function') { const t = await res.text(); if (t.length > max) throw new Error(`The answer is too big (more than ${max / 1024} KB).`); return t; }
  const len = Number(res.headers?.get?.('content-length'));
  if (len > max) { try { await res.body.cancel(); } catch {} throw new Error(`The answer is too big (${Math.round(len / 1024)} KB, at most ${max / 1024} KB).`); }
  const reader = res.body.getReader(), parts = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { try { await reader.cancel(); } catch {} throw new Error(`The answer is too big (more than ${max / 1024} KB).`); }
    parts.push(value);
  }
  return Buffer.concat(parts.map((p) => Buffer.from(p))).toString('utf8');
}
const PERM_RE = /^(network:(\*\.)?[a-z0-9.-]+\.[a-z]{2,}|ping|notifications)$/;

// ---------- the manifest ----------
/** Checks a manifest. Errors stop it from installing; warnings are advice. */
function validate(m, { appVersion = null } = {}) {
  const errors = [], warnings = [];
  const err = (p, msg) => errors.push({ path: p, message: msg }), warn = (p, msg) => warnings.push({ path: p, message: msg });
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, errors: [{ path: '', message: 'The manifest must be a JSON object.' }], warnings };
  if (m.manifestVersion !== MANIFEST_VERSION) err('manifestVersion', `Must be ${MANIFEST_VERSION}.`);
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(m.id || '')) err('id', 'Lowercase letters, digits and dashes, 2–41 characters.');
  else if (!m.id.includes('-')) warn('id', 'Use a prefix with a dash (e.g. “acme-status”) so it can’t clash with Astra’s own integrations.');
  for (const k of ['name', 'description', 'author']) if (typeof m[k] !== 'string' || !m[k].trim()) err(k, 'Required.');
  if (typeof m.name === 'string' && m.name.length > 60) err('name', 'At most 60 characters.');
  if (!semver.parse(m.version)) err('version', 'A version number like 1.0.0.');
  if (m.homepage != null && !/^https:\/\/\S+$/.test(m.homepage)) err('homepage', 'Must be an https:// link.');
  if (!CATEGORIES.includes(m.category)) err('category', `One of ${CATEGORIES.join(', ')}.`);
  if (m.icon != null && !/^[a-z][a-z0-9-]{0,30}$/.test(m.icon)) err('icon', 'An Astra icon name (e.g. “link”, “servers”).');
  // compatibility
  if (typeof m.astra !== 'string' || !m.astra.trim()) err('astra', 'Which Astra versions it works with, e.g. ">=1.12.0".');
  else if (appVersion) { const ok = semver.satisfies(appVersion, m.astra); if (ok === false) err('astra', `Needs Astra ${m.astra}; this is ${appVersion}.`); if (ok === null) warn('astra', 'Astra can’t read this version range.'); }
  if (m.minecraft != null && typeof m.minecraft !== 'string' && !Array.isArray(m.minecraft)) err('minecraft', 'A version range, e.g. ">=1.20".');
  // permissions
  const perms = Array.isArray(m.permissions) ? m.permissions : (err('permissions', 'A list (may be empty).'), []);
  perms.forEach((p, i) => {
    if (typeof p !== 'string' || !PERM_RE.test(p)) return err(`permissions[${i}]`, `Unknown permission “${p}”. Use network:<host>, ping or notifications.`);
    if (p.startsWith('network:') && LOCAL_HOST.test(p.slice(8).replace(/^\*\./, ''))) err(`permissions[${i}]`, `${p.slice(8)} is a local-network name — integrations may only use public internet services.`);
  });
  if (new Set(perms).size !== perms.length) warn('permissions', 'A permission is listed twice.');
  // settings
  const keys = new Set();
  (Array.isArray(m.config) ? m.config : m.config == null ? [] : (err('config', 'A list of fields.'), [])).forEach((f, i) => {
    const p = `config[${i}]`;
    if (!f || !/^[a-zA-Z][\w-]{0,40}$/.test(f.key || '')) return err(p, 'Each field needs a key (letters, digits, - and _).');
    if (keys.has(f.key)) err(p, `Key “${f.key}” is used twice.`); keys.add(f.key);
    if (!FIELD_TYPES.includes(f.type)) err(p + '.type', `One of ${FIELD_TYPES.join(', ')}.`);
    if (f.type === 'select' && !(Array.isArray(f.options) && f.options.length)) err(p + '.options', 'A select field needs options.');
  });
  // the status check
  const s = m.status;
  const usesTemplate = (str) => (String(str).match(/{{\s*config\.([\w-]+)\s*}}/g) || []).map((x) => x.replace(/{{\s*config\.|\s*}}/g, ''));
  if (!s || typeof s !== 'object') err('status', 'Required: { "type": "http-json", … } or { "type": "server-ping", … }.');
  else if (s.type === 'http-json') {
    if (typeof s.url !== 'string' || !/^https:\/\/[^\s/]+/.test(s.url)) err('status.url', 'Must start with https://');
    else {
      const host = hostOf(s.url);
      if (host && !host.includes('{{') && !perms.some((p) => p.startsWith('network:') && hostAllowed(host, [p]))) err('status.url', `Calls ${host} but the permissions don’t include network:${host}.`);
      for (const k of usesTemplate(s.url)) if (!keys.has(k)) err('status.url', `Uses {{config.${k}}} but there's no such setting.`);
      if (/{{/.test(hostOf(s.url) || '')) err('status.url', 'The host can’t come from a setting (permissions are granted per host).');
    }
    if (s.connectedWhen == null) warn('status.connectedWhen', 'Without it, any answer counts as connected.');
    if (s.path != null && typeof s.path !== 'string') err('status.path', 'A dotted path like "data.online".');
  } else if (s.type === 'server-ping') {
    if (!perms.includes('ping')) err('status', 'A server-ping check needs the “ping” permission.');
    if (typeof s.address !== 'string' || !s.address.trim()) err('status.address', 'The server address, or {{config.address}}.');
    else for (const k of usesTemplate(s.address)) if (!keys.has(k)) err('status.address', `Uses {{config.${k}}} but there's no such setting.`);
  } else err('status.type', 'Either "http-json" or "server-ping".');
  if (m.notify != null) {
    if (!perms.includes('notifications')) err('notify', 'Alerts need the “notifications” permission.');
    if (!m.notify || typeof m.notify.title !== 'string') err('notify.title', 'Required.');
  }
  if (m.details != null) {
    const d = m.details;
    if (!d || d.type !== 'http-json' || typeof d.url !== 'string' || !/^https:\/\//.test(d.url)) err('details', 'Only { "type": "http-json", "url": "https://…", "rows": "path", "columns": [...] }.');
    else if (!perms.some((p) => p.startsWith('network:') && hostAllowed(hostOf(d.url), [p]))) err('details.url', `Calls ${hostOf(d.url)} without its network permission.`);
    if (!Array.isArray(d?.columns) || !d.columns.length || d.columns.some((c) => !c || typeof c.label !== 'string' || typeof c.path !== 'string')) err('details.columns', 'A list of { "label", "path" }.');
  }
  for (const k of Object.keys(m)) if (!['$schema', 'manifestVersion', 'id', 'name', 'description', 'version', 'author', 'homepage', 'category', 'icon', 'astra', 'minecraft', 'permissions', 'config', 'status', 'details', 'notify'].includes(k)) warn(k, 'Astra doesn’t know this field and ignores it.');
  return { ok: !errors.length, errors, warnings };
}

function hostOf(url) { const m = String(url).match(/^https:\/\/([^/:?#]+)/i); return m ? m[1].toLowerCase() : null; }
function hostAllowed(host, granted) {
  if (!host) return false;
  return granted.some((p) => {
    if (!p.startsWith('network:')) return false;
    const h = p.slice(8);
    return h.startsWith('*.') ? host === h.slice(2) || host.endsWith(h.slice(1)) : host === h;
  });
}
/** "a.b[0].c" out of an object. */
function pick(obj, p) {
  if (p == null || p === '') return obj;
  let cur = obj;
  for (const part of String(p).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)) { if (cur == null) return undefined; cur = cur[part]; }
  return cur;
}
/** {{config.x}} (URL-encoded inside links), {{value}}, {{any.path}} from the answer. */
function render(tpl, { config = {}, data = {}, value, url = false }) {
  return String(tpl ?? '').replace(/{{\s*([\w.[\]-]+)\s*}}/g, (_, k) => {
    let v = k.startsWith('config.') ? config[k.slice(7)] : k === 'value' ? value : pick(data, k);
    if (v == null) v = '';
    if (typeof v === 'object') v = JSON.stringify(v);
    return url ? encodeURIComponent(String(v)) : String(v).slice(0, 200);
  });
}
function matches(value, cond) {
  if (cond == null) return true;
  if (Array.isArray(cond)) return cond.some((c) => matches(value, c));
  if (cond && typeof cond === 'object') {
    if ('gt' in cond) return Number(value) > cond.gt;
    if ('gte' in cond) return Number(value) >= cond.gte;
    if ('lt' in cond) return Number(value) < cond.lt;
    if ('not' in cond) return !matches(value, cond.not);
    if ('exists' in cond) return (value != null) === !!cond.exists;
    return false;
  }
  return value === cond;
}

/**
 * Runs a manifest's status check. deps = { fetch, ping }. granted = permissions the player allowed.
 * Returns { state, text, detail, trace } — trace says what was asked and answered (for the tester and error log).
 */
async function runStatus(m, { config = {}, granted = [], deps }) {
  const s = m.status, trace = {};
  if (s.type === 'server-ping') {
    if (!granted.includes('ping')) throw new Error('The “ping” permission isn’t granted.');
    const address = render(s.address, { config }).trim();
    if (!address) return { state: 'needs-setup', text: 'Enter a server address in its settings.', trace };
    trace.request = { ping: address };
    const r = await deps.ping(address);
    trace.response = { online: r.online, players: r.players, version: r.version, error: r.error };
    if (!r.online) return { state: 'ready', text: `${address} is offline (${r.error || 'no answer'})`, trace };
    return { state: 'connected', text: s.text ? render(s.text, { config, data: r }) : `${address}: ${r.players?.online ?? 0}/${r.players?.max ?? '?'} players`, trace };
  }
  // http-json
  for (const f of m.config || []) if (f.required && (config[f.key] == null || config[f.key] === '')) return { state: 'needs-setup', text: `Fill in “${f.label || f.key}” in its settings.`, trace };
  const url = render(s.url, { config, url: true });
  const host = hostOf(url);
  if (!/^https:\/\//i.test(url) || !hostAllowed(host, granted)) throw new Error(`Not allowed to contact ${host || url}.`);
  trace.request = { url: url.replace(/([?&](?:key|token|secret|apikey|api_key)=)[^&]+/gi, '$1…') };
  const headers = { Accept: 'application/json' };
  for (const [k, v] of Object.entries(s.headers || {})) if (/^[\w-]{1,40}$/.test(k) && !/^(host|cookie)$/i.test(k)) headers[k] = render(v, { config });
  const t0 = Date.now();
  const res = await deps.fetch(url, { headers, redirect: 'error' });
  trace.ms = Date.now() - t0; trace.httpStatus = res.status;
  const text = await readCapped(res);
  if (text.length > MAX_BODY) throw new Error(`The answer is too big (${Math.round(text.length / 1024)} KB, at most ${MAX_BODY / 1024} KB).`);
  trace.body = text.slice(0, 2000);
  if (!res.ok) return { state: 'error', text: `${host} answered HTTP ${res.status}`, trace };
  let data; try { data = JSON.parse(text); } catch { return { state: 'error', text: `${host} didn’t answer with JSON`, trace }; }
  const value = pick(data, s.path);
  trace.value = value;
  const ok = matches(value, s.connectedWhen);
  return { state: ok ? 'connected' : (s.otherwise === 'error' ? 'error' : 'ready'), text: render(ok ? (s.text || 'Connected') : (s.textOtherwise || s.text || 'Not connected'), { config, data, value }), trace };
}

async function runDetails(m, { config = {}, granted = [], deps }) {
  const d = m.details; if (!d) return null;
  const url = render(d.url, { config, url: true });
  if (!hostAllowed(hostOf(url), granted)) throw new Error(`Not allowed to contact ${hostOf(url)}.`);
  const res = await deps.fetch(url, { headers: { Accept: 'application/json' }, redirect: 'error' });
  const text = await readCapped(res);
  if (!res.ok || text.length > MAX_BODY) throw new Error(`${hostOf(url)} answered HTTP ${res.status}`);
  let json; try { json = JSON.parse(text); } catch { throw new Error(`${hostOf(url)} didn’t answer with JSON`); }
  const rows = pick(json, d.rows);
  if (!Array.isArray(rows)) throw new Error(`“${d.rows}” in the answer isn’t a list.`);
  return { columns: d.columns.map((c) => c.label), rows: rows.slice(0, 200).map((r) => d.columns.map((c) => { const v = pick(r, c.path); return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); })), note: d.note || '' };
}

/** Turns an installed manifest into an Astra Connect registry definition. */
function toDefinition(m, { granted = () => [], deps, onTrace = () => {}, onStatusChange = () => {} }) {
  const missing = () => (m.permissions || []).filter((p) => !granted().includes(p));
  let last = null;
  return {
    id: m.id, name: m.name, description: m.description, icon: m.icon || 'link', category: m.category, type: 'api',
    docs: m.homepage || undefined, thirdParty: { author: m.author, version: m.version, permissions: m.permissions || [] },
    config: (m.config || []).map((f) => ({ key: f.key, label: f.label || f.key, type: f.type, help: f.help || '', options: f.options, min: f.min, max: f.max, default: f.default, required: !!f.required })),
    async status({ config }) {
      const need = missing();
      if (need.length) return { state: 'needs-setup', text: `Waiting for your OK: ${need.join(', ')} (Developer Hub → Installed)` };
      try {
        const r = await runStatus(m, { config, granted: granted(), deps });
        onTrace(m.id, { at: Date.now(), ok: r.state !== 'error', state: r.state, text: r.text, trace: r.trace });
        if (last && last !== r.state && m.notify && granted().includes('notifications')) onStatusChange(m, r, last);
        last = r.state;
        return { state: r.state, text: r.text };
      } catch (e) { onTrace(m.id, { at: Date.now(), ok: false, state: 'error', text: e.message }); throw e; }
    },
    details: m.details ? ({ config }) => (missing().length ? null : runDetails(m, { config, granted: granted(), deps })) : undefined,
  };
}

// ---------- Astra ----------
const util = () => require('../util');
const dir = () => util().paths.file('integrations');
const stateFile = () => util().paths.file('devhub.json');
const loadState = () => ({ installed: {}, logs: {}, ...util().readJSON(stateFile(), {}) });
const saveState = (s) => util().writeJSON(stateFile(), s);
function appVersion() { try { return require('electron').app.getVersion(); } catch { return null; } }
function readManifestDir(folder) {
  const f = path.join(folder, MANIFEST);
  if (!fs.existsSync(f)) throw new Error(`No ${MANIFEST} in ${folder}.`);
  if (fs.statSync(f).size > 64 * 1024) throw new Error(`${MANIFEST} is too big (64 KB at most).`);
  try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch (e) { throw new Error(`${MANIFEST} isn’t valid JSON: ${e.message}`); }
}
function realDeps() {
  return { fetch: (url, o) => fetch(url, { ...o, signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Astra-Launcher (integration)', ...(o.headers || {}) } }), ping: (a) => require('../servers').ping(a) };
}
function log(id, entry) {
  const s = loadState();
  s.logs[id] = [entry, ...(s.logs[id] || []).filter((x) => !(x.ok && entry.ok && x.text === entry.text))].slice(0, 30);
  saveState(s);
}
/** Registry definitions for every installed integration whose manifest is still valid. */
function definitions() {
  const s = loadState(), out = [];
  for (const [id, rec] of Object.entries(s.installed)) {
    let m; try { m = readManifestDir(path.join(dir(), id)); } catch { continue; }
    const v = validate(m, { appVersion: appVersion() });
    if (!v.ok || m.id !== id) continue;
    out.push(toDefinition(m, {
      granted: () => loadState().installed[id]?.granted || [], deps: realDeps(), onTrace: log,
      onStatusChange: (mm, r) => require('./notify').add({ category: 'integration', title: render(mm.notify.title, { data: {}, value: r.state }), body: render(mm.notify.body || r.text, { value: r.state }), key: `devhub:${mm.id}:${r.state}`, action: { kind: 'route', page: 'connect' } }),
    }));
  }
  return out;
}
function list() {
  const s = loadState();
  return Object.entries(s.installed).map(([id, rec]) => {
    let m = null, v = null;
    try { m = readManifestDir(path.join(dir(), id)); v = validate(m, { appVersion: appVersion() }); } catch (e) { v = { ok: false, errors: [{ path: '', message: e.message }], warnings: [] }; }
    const perms = m?.permissions || [];
    return { id, name: m?.name || id, version: m?.version || null, author: m?.author || null, description: m?.description || '', homepage: m?.homepage || null, permissions: perms.map((p) => ({ id: p, granted: (rec.granted || []).includes(p), text: describePermission(p) })), valid: v.ok, errors: v.errors, warnings: v.warnings, installedAt: rec.installedAt, log: (s.logs[id] || []).slice(0, 10) };
  });
}
function describePermission(p) {
  if (p === 'ping') return 'Ping Minecraft servers (see if they are online and who plays)';
  if (p === 'notifications') return 'Put alerts in your Astra inbox';
  if (p.startsWith('network:')) return `Connect to ${p.slice(8)} over the internet (HTTPS)`;
  return p;
}
/** Checks a folder without installing it (the testing tool). */
function check(folder) {
  const m = readManifestDir(folder);
  return { manifest: { id: m.id, name: m.name, version: m.version, permissions: m.permissions || [] }, ...validate(m, { appVersion: appVersion() }) };
}
/** Runs the folder's status check once, with its declared permissions and the given settings — nothing is saved. */
async function dryRun(folder, config = {}) {
  const m = readManifestDir(folder);
  const v = validate(m, { appVersion: appVersion() });
  if (!v.ok) return { ok: false, validation: v };
  const t0 = Date.now();
  try {
    const r = await runStatus(m, { config, granted: m.permissions || [], deps: realDeps() });
    let details = null; if (m.details) { try { details = await runDetails(m, { config, granted: m.permissions || [], deps: realDeps() }); } catch (e) { details = { error: e.message }; } }
    return { ok: true, validation: v, result: { state: r.state, text: r.text }, trace: r.trace, details, ms: Date.now() - t0 };
  } catch (e) { return { ok: false, validation: v, error: e.message, ms: Date.now() - t0 }; }
}
/** Copies a checked integration folder into Astra. Nothing is granted yet — the player approves each permission. */
function install(folder) {
  const c = check(folder);
  if (!c.ok) throw new Error(`Can’t install: ${c.errors.map((e) => `${e.path ? e.path + ': ' : ''}${e.message}`).join(' · ')}`);
  const id = c.manifest.id;
  if (require('../connect/integrations').INTEGRATIONS.some((d) => d.id === id)) throw new Error(`“${id}” is the id of one of Astra’s own integrations.`);
  const to = path.join(dir(), id);
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(folder)) { // the manifest and small files (an icon, a readme) only
    const p = path.join(folder, f);
    if (fs.statSync(p).isFile() && fs.statSync(p).size < 512 * 1024) fs.copyFileSync(p, path.join(to, f));
  }
  const s = loadState();
  const prev = s.installed[id];
  s.installed[id] = { installedAt: Date.now(), granted: (prev?.granted || []).filter((p) => c.manifest.permissions.includes(p)) };
  saveState(s);
  require('../connect').reload();
  return list().find((x) => x.id === id);
}
function setGrant(id, permission, on) {
  const s = loadState(); const rec = s.installed[id];
  if (!rec) throw new Error('That integration isn’t installed.');
  const m = readManifestDir(path.join(dir(), id));
  if (!(m.permissions || []).includes(permission)) throw new Error('It didn’t ask for that permission.');
  rec.granted = on ? [...new Set([...(rec.granted || []), permission])] : (rec.granted || []).filter((p) => p !== permission);
  saveState(s);
  return list().find((x) => x.id === id);
}
async function uninstall(id) {
  const s = loadState();
  if (!s.installed[id]) throw new Error('That integration isn’t installed.');
  delete s.installed[id]; delete s.logs[id]; saveState(s);
  const p = path.join(dir(), path.basename(id));
  try { await require('electron').shell.trashItem(p); } catch { fs.rmSync(p, { recursive: true, force: true }); }
  require('../connect').reload();
  return list();
}
/** A JSON report for the integration's developer: manifest, validation, the last checks and errors (no settings). */
function report(id) {
  const it = list().find((x) => x.id === id);
  if (!it) throw new Error('That integration isn’t installed.');
  return JSON.stringify({ astra: appVersion(), platform: process.platform, integration: { id: it.id, version: it.version, valid: it.valid, errors: it.errors, warnings: it.warnings, permissions: it.permissions }, log: (loadState().logs[id] || []).map(({ trace, ...rest }) => ({ ...rest, httpStatus: trace?.httpStatus ?? null, ms: trace?.ms ?? null })) }, null, 2); // no answers or links: they may hold the player's data
}

module.exports = { MANIFEST, MANIFEST_VERSION, validate, hostOf, hostAllowed, pick, render, matches, runStatus, runDetails, toDefinition, definitions, list, check, dryRun, install, setGrant, uninstall, report, describePermission };
