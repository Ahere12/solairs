// Astra Assistant — explains crashes, launcher errors and server connection problems, and suggests fixes.
//
// Always works on this PC: Astra's crash rules (src/crash.js), the mods named in the crash, Modpack Intelligence's
// checks of the instance, and the step-by-step server connection test.
// Optional: "Ask Claude" sends a short, cleaned-up summary (crash excerpt without your user name, paths or tokens,
// the mod list, Astra's own findings) to Anthropic's API for a written explanation — only when you press it, only with
// your own API key, and only if the Anthropic SDK is installed with Astra.
//
// The assistant never changes files by itself. Each suggested fix is a button; the reversible ones (turning a mod
// off or on) run only after the player confirms, through the normal instance functions.

const os = require('os');

// ---------- reading a crash ----------
/** Mods a crash report or log points at (mod ids, jar names), most likely first. */
function suspects(text) {
  const t = String(text || '');
  const found = new Map();
  const add = (id, why, weight) => {
    const k = String(id).trim().toLowerCase().replace(/\.jar$/, '');
    if (!k || k.length < 2 || /^(minecraft|java|forge|neoforge|fabric|fabricloader|mixin|null|unknown|mod)$/.test(k)) return;
    const cur = found.get(k) || { id: k, reasons: [], weight: 0 };
    if (!cur.reasons.includes(why)) cur.reasons.push(why);
    cur.weight += weight; found.set(k, cur);
  };
  const each = (re, fn) => { for (const m of t.matchAll(re)) fn(m); };
  each(/Suspected Mods?:\s*([^\n]+)/gi, (m) => { for (const x of m[1].matchAll(/\(([a-z0-9_.-]+)\)/gi)) add(x[1], 'named as a suspect in the crash report', 5); });
  each(/^\s*Suspected Mods?:\s*\n((?:\s+.+\n?){1,8})/gim, (m) => { for (const x of m[1].matchAll(/\(([a-z0-9_.-]+)\)/gi)) add(x[1], 'named as a suspect in the crash report', 5); });
  each(/from mod ([a-z0-9_.-]+)/gi, (m) => add(m[1], 'its Mixin failed', 4));
  each(/Mixin \[([a-z0-9_.-]+)\.mixins?\.json/gi, (m) => add(m[1].split('.')[0], 'its Mixin failed', 3));
  each(/Mod (?:ID|File):\s*'?([a-z0-9_.-]+)'?/gi, (m) => add(m[1], 'named in the crash', 2));
  each(/mod '([a-z0-9_.-]+)' (?:requires|is incompatible)/gi, (m) => add(m[1], 'its requirements aren’t met', 4));
  each(/Mod ([a-z0-9_.-]+) requires/gi, (m) => add(m[1], 'its requirements aren’t met', 4));
  each(/\b([a-z0-9_-]+)\.jar\b/gi, (m) => add(m[1], 'its file appears in the error', 1));
  return [...found.values()].sort((a, b) => b.weight - a.weight).slice(0, 8);
}

/** Removes what's personal: user name, home folder paths, access tokens, IP addresses, e-mail addresses. */
function scrub(text) {
  let t = String(text || '');
  const home = os.homedir(), user = os.userInfo().username;
  if (home) t = t.split(home).join('~');
  t = t.replace(/(--accessToken|--uuid|--xuid|--clientId)\s+\S+/g, '$1 [removed]');
  t = t.replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[token removed]');
  t = t.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (ip) => (/^(127|10|192\.168)\./.test(ip) ? ip : '[ip]'));
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]');
  if (user && user.length > 2) t = t.replace(new RegExp(user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[user]');
  return t;
}

/** The part of a long log that matters: the crash report header, the first exception and its causes. */
function excerpt(text, max = 12000) {
  const t = String(text || '');
  if (t.length <= max) return t;
  const lines = t.split(/\r?\n/);
  const keep = new Set();
  lines.forEach((l, i) => {
    if (/Exception|Error|Caused by|Description:|Suspected Mod|Mixin|FATAL|crash/i.test(l)) for (let j = Math.max(0, i - 2); j < Math.min(lines.length, i + 12); j++) keep.add(j);
  });
  const out = [...keep].sort((a, b) => a - b).map((i) => lines[i]).join('\n');
  return (out.length > max ? out.slice(0, max) : out) || t.slice(-max);
}

// ---------- launcher errors ----------
const ERRORS = [
  [/ENOTFOUND|EAI_AGAIN|getaddrinfo/i, 'No internet name lookup', 'Astra couldn’t find a website’s address. Check your internet connection; if other sites work, a DNS or VPN problem may block it.'],
  [/ETIMEDOUT|timed out|AbortError|no answer within/i, 'Timed out', 'A website or server didn’t answer in time. Try again; if it keeps happening, a firewall, VPN or slow connection may be in the way.'],
  [/ECONNREFUSED/i, 'Connection refused', 'The other side is reachable but nothing accepted the connection — the service or server is down, or the port is wrong.'],
  [/ECONNRESET|socket hang up/i, 'Connection dropped', 'The connection was cut off midway. Usually temporary — try again.'],
  [/ENOSPC|no space left/i, 'Disk full', 'The drive is full. Free up space, or move Astra’s data folder to another drive (Settings → Storage).'],
  [/EPERM|EACCES|operation not permitted|access is denied/i, 'No permission', 'Windows refused access to a file. An antivirus may be scanning it, or another program has it open. Close the game and try again; if it repeats, allow Astra’s folder in your antivirus.'],
  [/EBUSY|resource busy or locked/i, 'File in use', 'Another program (often OneDrive syncing, an antivirus, or a running game) is using the file. Close it, wait a moment, and try again.'],
  [/HTTP 401|HTTP 403|Unauthorized|Forbidden/i, 'Not allowed', 'A service refused the request. If it’s about your Microsoft account, sign out and back in; for CurseForge, check the API key in Settings.'],
  [/HTTP 404/i, 'Not found', 'The file or page doesn’t exist any more — the mod or version may have been removed. Pick another version.'],
  [/HTTP 429|rate limit/i, 'Too many requests', 'A service asked Astra to slow down. Wait a minute and try again.'],
  [/HTTP 5\d\d/i, 'Service problem', 'The service had an error on its side. Try again later.'],
  [/Could not start Java|java(\.exe)? .*not (found|recognized)|spawn .*java.* ENOENT/i, 'Java can’t start', 'The Java runtime is missing or broken. In Settings → Java, clear any custom path so Astra installs the right Java itself.'],
  [/version list|version_manifest/i, 'Version list unavailable', 'Astra couldn’t download Minecraft’s version list. Check your internet connection; it works offline once loaded before.'],
  [/sha1|checksum|hash mismatch|corrupt/i, 'Damaged download', 'A downloaded file didn’t match its checksum. Settings → Storage → Repair files, then try again.'],
  [/Xbox|XSTS|2148916233|2148916238/i, 'Xbox account problem', 'Microsoft sign-in needs an Xbox profile (create one at xbox.com), and child accounts need permission from a parent in Microsoft Family.'],
  [/doesn.t own|NOT_FOUND.*profile|no Minecraft profile/i, 'Minecraft not owned', 'This Microsoft account doesn’t own Minecraft: Java Edition, or hasn’t chosen a player name yet (minecraft.net).'],
  [/already running/i, 'Already running', 'That instance is already running — check the Console, or stop it first.'],
  [/CurseForge API key|curseforge/i, 'CurseForge not set up', 'Add your own CurseForge API key in Settings → Integrations (free at console.curseforge.com).'],
];
function explainError(message) {
  const m = String(message || '');
  const hits = ERRORS.filter(([re]) => re.test(m)).map(([, title, fix]) => ({ title, fix }));
  return { message: scrub(m).slice(0, 500), causes: hits.length ? hits : [{ title: 'Not a known error', fix: 'Astra doesn’t recognise this one. Try again; if it repeats, share the log (Console → Share log) when asking for help.' }] };
}

// ---------- putting it together ----------
/**
 * Crash: rules, suspects, and the instance's mod checks.
 * deps = { crash: { explainText }, check(instanceId) → modpack check, mods(instanceId) → [{file, manifest}] }
 */
function diagnoseCrash({ text, instanceId = null }, deps) {
  const base = deps.crash.explainText(text);
  const sus = suspects(text);
  let check = null, mods = [];
  if (instanceId) { try { check = deps.check(instanceId); mods = deps.mods(instanceId); } catch {} }
  // match suspects to installed files
  const byId = new Map(mods.filter((m) => m.manifest?.modId).map((m) => [m.manifest.modId, m]));
  const named = sus.map((s) => { const m = byId.get(s.id) || mods.find((x) => x.file.toLowerCase().replace(/\.jar(\.disabled)?$/, '').startsWith(s.id)); return { ...s, file: m?.file || null, name: m?.manifest?.name || null, enabled: m ? m.enabled !== false : null }; });
  const actions = [];
  for (const s of named.filter((x) => x.file && x.enabled).slice(0, 3)) actions.push({ kind: 'disable-mod', instanceId, file: s.file, label: `Turn off ${s.name || s.file}`, why: s.reasons[0], reversible: true });
  for (const f of (check?.findings || []).filter((x) => x.severity === 'error').slice(0, 6)) {
    if (f.fix?.kind === 'enable') actions.push({ kind: 'enable-mod', instanceId, file: f.fix.file, label: `Turn on ${f.fix.file}`, why: f.title, reversible: true });
    else if (f.fix?.kind === 'disable' || f.fix?.kind === 'disable-older') for (const file of [].concat(f.fix.file || f.fix.files || [])) actions.push({ kind: 'disable-mod', instanceId, file, label: `Turn off ${file}`, why: f.title, reversible: true });
    else if (f.fix?.kind === 'install') actions.push({ kind: 'find-mod', instanceId, modId: f.fix.id, label: `Find “${f.fix.id}” on Modrinth`, why: f.title, reversible: true });
  }
  if (base.corrupt) actions.push({ kind: 'repair', label: 'Repair game files on the next launch', why: 'A game file looks damaged.', reversible: true });
  if (base.causes.some((c) => /memory/i.test(c.title)) && instanceId) actions.push({ kind: 'open-settings', instanceId, label: 'Open the instance’s memory setting', why: 'Out of memory', reversible: true });
  const seen = new Set();
  return {
    kind: 'crash', description: base.description,
    causes: base.causes.length ? base.causes : [{ title: 'No known pattern', fix: 'Astra’s rules don’t recognise this crash. The suspects below and the instance check may still point at the cause.' }],
    suspects: named, findings: (check?.findings || []).slice(0, 12), health: check?.health || null,
    actions: actions.filter((a) => { const k = a.kind + (a.file || a.modId || ''); if (seen.has(k)) return false; seen.add(k); return true; }),
  };
}

// ---------- optional: Claude ----------
const MODEL = 'claude-opus-5-5';
function sdk() { try { return require('@anthropic-ai/sdk'); } catch { return null; } }
function aiStatus() {
  const S = sdk();
  const cfg = aiConfig();
  if (!S) return { available: false, configured: false, why: 'The Anthropic SDK isn’t included in this Astra build, so “Ask Claude” is off. Everything else works on this PC.' };
  if (!cfg.enabled || !cfg.key) return { available: true, configured: false, why: 'Turn it on and add your own Anthropic API key to use it.' };
  return { available: true, configured: true, model: MODEL };
}
const SYSTEM = 'You help players of Minecraft: Java Edition who use the Astra launcher. You get a crash report, launcher error or server connection test, the mod list, and the findings of Astra\'s own local checks. Explain in plain, friendly words what most likely went wrong and what to try, most likely fix first. Name specific mods when the evidence points at them, and say how sure you are. Mention fixes the player can do in Astra (turn a mod off, update it, install a missing dependency, change memory, repair files). Never tell them to download files from unofficial sites. Keep it under 250 words.';
/** Builds the message sent to Claude — also shown to the player before sending. */
function buildPrompt({ kind, text, local, mods = [] }) {
  const parts = [`Problem type: ${kind}`];
  if (local) parts.push(`Astra's local diagnosis:\n${JSON.stringify({ causes: local.causes, suspects: (local.suspects || []).map((s) => s.id), findings: (local.findings || []).map((f) => f.title), steps: local.steps?.map((s) => `${s.ok ? 'OK' : 'FAIL'} ${s.id}: ${s.text}`) }, null, 1)}`);
  if (mods.length) parts.push(`Mods (${mods.length}): ${mods.slice(0, 250).map((m) => `${m.manifest?.modId || m.file}${m.manifest?.version ? '@' + m.manifest.version : ''}${m.enabled === false ? ' (off)' : ''}`).join(', ')}`);
  if (text) parts.push(`Report:\n${scrub(excerpt(text))}`);
  return parts.join('\n\n');
}
/** One request to Claude. deps.client lets tests pass a fake client. */
async function askClaude(input, { client = null, key = null } = {}) {
  const S = sdk();
  if (!client) {
    if (!S) throw new Error('“Ask Claude” isn’t available in this build (the Anthropic SDK isn’t installed).');
    const cfg = aiConfig();
    if (!cfg.enabled || !(key || cfg.key)) throw new Error('Turn on “Ask Claude” and add your Anthropic API key first.');
    client = new S({ apiKey: key || cfg.key, maxRetries: 1, timeout: 120000 });
  }
  const content = buildPrompt(input);
  let res;
  try {
    res = await client.beta.messages.create({
      model: MODEL, max_tokens: 16000, system: SYSTEM,
      output_config: { effort: 'medium' },
      // if a safety check declines, Anthropic's API answers with a fallback model instead of nothing
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      messages: [{ role: 'user', content }],
    });
  } catch (e) {
    if (S && e instanceof S.AuthenticationError) throw new Error('Anthropic didn’t accept the API key — check it in the Assistant’s settings.');
    if (S && e instanceof S.RateLimitError) throw new Error('Anthropic asked Astra to slow down. Try again in a minute.');
    if (S && e instanceof S.APIConnectionError) throw new Error('Couldn’t reach Anthropic. Check your internet connection.');
    if (S && e instanceof S.APIError) throw new Error(`Anthropic answered with an error (${e.status}): ${String(e.message).slice(0, 200)}`);
    throw e;
  }
  if (res.stop_reason === 'refusal') return { text: null, refused: true, model: res.model };
  const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  return { text, refused: false, model: res.model, truncated: res.stop_reason === 'max_tokens' };
}

// ---------- Astra ----------
const util = () => require('../util');
const cfgFile = () => util().paths.file('assistant.json');
function seal(s) { const { safeStorage } = require('electron'); return safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(s).toString('base64') : null; }
function unseal(s) { try { const { safeStorage } = require('electron'); return s && s.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(s.slice(4), 'base64')) : ''; } catch { return ''; } }
function aiConfig() { const c = util().readJSON(cfgFile(), {}); return { enabled: !!c.enabled, key: unseal(c.key) }; }
function settings() { const c = aiConfig(); return { enabled: c.enabled, keySet: !!c.key, status: aiStatus() }; }
function setSettings({ enabled, key, clearKey } = {}) {
  const c = util().readJSON(cfgFile(), {});
  if (enabled != null) c.enabled = !!enabled;
  if (clearKey) delete c.key;
  else if (typeof key === 'string' && key.trim()) {
    if (!/^sk-ant-[\w-]{20,}$/.test(key.trim())) throw new Error('That doesn’t look like an Anthropic API key (it starts with sk-ant-).');
    const sealed = seal(key.trim());
    if (!sealed) throw new Error('This PC can’t store the key safely (no system key store), so it isn’t saved.');
    c.key = sealed;
  }
  util().writeJSON(cfgFile(), c);
  return settings();
}
/** The instance's check and mods are read first (without blocking Astra), then the diagnosis runs on them. */
async function realDeps(instanceId) {
  const mp = require('./modpack');
  let check = null, mods = [];
  if (instanceId) { try { check = await mp.check(instanceId); mods = await mp.modsOf(instanceId); } catch {} }
  return { crash: require('../crash'), check: () => check, mods: () => mods };
}
const modsFor = async (id) => { if (!id) return []; try { return await require('./modpack').modsOf(id); } catch { return []; } };
function crashFromRun(runId) {
  const launch = require('../launch');
  const runs = launch.list();
  const r = [...runs.history, ...runs.running].find((x) => x.runId === runId);
  if (!r) throw new Error('That game session isn’t in the Console any more.');
  let text = launch.logs(runId).join('\n');
  // add the newest crash report written during that session
  try {
    const fs = require('fs'), path = require('path');
    const d = path.join(require('../instances').get(r.instanceId).gameDir, 'crash-reports');
    const latest = fs.readdirSync(d).map((f) => ({ f, t: fs.statSync(path.join(d, f)).mtimeMs })).filter((x) => x.t >= (r.start || 0)).sort((a, b) => b.t - a.t)[0];
    if (latest) text = fs.readFileSync(path.join(d, latest.f), 'utf8') + '\n\n---- log ----\n' + text;
  } catch {}
  return { text, instanceId: r.instanceId };
}
async function crash({ text, instanceId, runId } = {}) {
  if (runId) ({ text, instanceId } = crashFromRun(runId));
  if (!String(text || '').trim()) throw new Error('Paste a crash report or log, or pick a game session.');
  return { ...diagnoseCrash({ text, instanceId }, await realDeps(instanceId)), instanceId: instanceId || null };
}
async function server(address, instanceId) {
  const t = await require('./serverinfo').test(address, instanceId);
  const actions = [];
  const failed = t.steps.find((s) => !s.ok);
  if (failed?.id === 'version' && instanceId) actions.push({ kind: 'open-settings', instanceId, label: 'Change this instance’s Minecraft version', reversible: true });
  return { kind: 'server', ...t, actions };
}
/** What would be sent to Claude, so the player can read it first. */
async function preview(input) {
  const mods = await modsFor(input.instanceId);
  return buildPrompt({ ...input, mods });
}
async function ask(input) {
  const mods = await modsFor(input.instanceId);
  return askClaude({ ...input, mods });
}
/** Runs one suggested fix after the player confirmed it in the UI. Only reversible actions exist. */
function apply(action = {}) {
  const instances = require('../instances');
  if (action.kind === 'disable-mod' || action.kind === 'enable-mod') {
    if (require('../launch').isBusy(action.instanceId)) throw new Error('Close the game first.');
    const on = action.kind === 'enable-mod';
    const file = String(action.file || '');
    const have = instances.listContent(action.instanceId, 'mods').find((m) => m.file === file);
    if (!have) throw new Error(`${file} isn’t in that instance any more.`);
    instances.setEnabled(action.instanceId, 'mods', [file], on);
    return { done: true, text: `${file} turned ${on ? 'on' : 'off'} (you can switch it back on the instance’s Content tab).` };
  }
  if (action.kind === 'repair') { require('fs').writeFileSync(util().paths.file('repair.flag'), new Date().toISOString()); return { done: true, text: 'Astra will check and repair the game files on the next launch.' }; }
  throw new Error('That suggestion is something to do yourself.');
}

module.exports = { suspects, scrub, excerpt, explainError, diagnoseCrash, buildPrompt, askClaude, aiStatus, MODEL, settings, setSettings, crash, server, preview, ask, apply };
