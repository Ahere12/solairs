// playit.gg tunnels for hosted servers (works for every server type, incl. Vanilla/Paper/Purpur).
// playit.gg is free but needs an account: the player approves this PC once in the browser ("claim").
// Agent: the official playitd daemon from github.com/playit-cloud/playit-agent (BSD-2-Clause), run with --secret.
// API: https://api.playit.gg (same calls the official agent makes; see packages/api_client/src/api.rs there).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { safeStorage, shell } = require('electron');
const { paths, readJSON, writeJSON, getJSON, download, push } = require('./util');

const API = 'https://api.playit.gg';
const file = () => paths.file('playit.json');
const VERSION = 'solaris-launcher';

let agent = null;           // { proc, state, restarts, lastError }
let tunnels = [];           // last rundata tunnels
let agentId = null;
let pollTimer = null;
let claim = null;           // { code, url, state }
const wanted = new Map();   // port -> server name (servers that are running with playit)

// ---------- secret ----------
function loadSecret() {
  const d = readJSON(file(), {});
  if (!d.secret) return null;
  try { return d.enc ? safeStorage.decryptString(Buffer.from(d.secret, 'base64')) : Buffer.from(d.secret, 'base64').toString(); } catch { return null; }
}
function saveSecret(secret) {
  const enc = safeStorage.isEncryptionAvailable();
  writeJSON(file(), { enc, secret: (enc ? safeStorage.encryptString(secret) : Buffer.from(secret)).toString('base64'), linked: Date.now() });
}
const linked = () => !!loadSecret();

async function call(p, body, secret = loadSecret()) {
  const r = await fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: 'Agent-Key ' + secret } : {}) }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(15000) });
  if (r.status === 429) throw new Error('playit.gg is busy (too many requests). Try again in a minute.');
  const j = await r.json().catch(() => null);
  if (!j) throw new Error(`playit.gg answered HTTP ${r.status}`);
  if (j.status === 'success') return j.data;
  const why = typeof j.data === 'string' ? j.data : JSON.stringify(j.data);
  if (/InvalidAgentKey|NoLongerValid/.test(why)) { unlink(); throw new Error('This PC was removed from your playit.gg account. Connect playit.gg again.'); }
  const e = new Error('playit.gg: ' + why); e.playit = j.data; throw e;
}

// ---------- claim (link this PC to the player's playit.gg account) ----------
async function startClaim() {
  if (claim && claim.state === 'waiting') return status();
  const code = crypto.randomBytes(5).toString('hex');
  claim = { code, url: `https://playit.gg/claim/${code}`, state: 'waiting' };
  await call('/claim/setup', { code, agent_type: 'self-managed', version: VERSION }, null);
  shell.openExternal(claim.url);
  (async () => {
    const until = Date.now() + 10 * 60 * 1000;
    while (claim?.code === code && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 2500));
      let s;
      try { s = await call('/claim/setup', { code, agent_type: 'self-managed', version: VERSION }, null); } catch { continue; }
      if (s === 'UserRejected') { claim.state = 'rejected'; emit(); return; }
      if (s === 'UserAccepted') {
        try {
          const ex = await call('/claim/exchange', { code }, null);
          saveSecret(ex.secret_key);
          claim = null; emit();
          push('toast', { type: 'ok', text: 'playit.gg connected — your servers can go public now.' });
          if (wanted.size) ensureAgent().catch(() => {});
        } catch (e) { claim.state = 'error'; claim.error = e.message; emit(); }
        return;
      }
    }
    if (claim?.code === code) { claim.state = 'expired'; emit(); }
  })();
  emit();
  return status();
}
function cancelClaim() { claim = null; emit(); return status(); }
function unlink() {
  stopAgent();
  try { fs.rmSync(file(), { force: true }); } catch {}
  tunnels = []; agentId = null; emit();
  return status();
}

// ---------- agent process ----------
async function agentExe() {
  const dir = path.join(paths.cache(), 'playit');
  const win = process.platform === 'win32';
  const exe = path.join(dir, win ? 'playitd.exe' : 'playitd');
  if (fs.existsSync(exe)) return exe;
  // playit's release names its agent (playitd) per OS and CPU; "playit-linux-*" is the Linux build of playitd.
  const linuxArch = { x64: 'amd64', arm64: 'aarch64', arm: 'armv7', ia32: 'i686' }[process.arch];
  const wanted = win ? [/^playitd-windows-x86_64-signed\.exe$/, /^playitd-windows-x86_64\.exe$/]
    : process.platform === 'linux' && linuxArch ? [new RegExp(`^playit-linux-${linuxArch}$`)] : [];
  if (!wanted.length) throw new Error('playit.gg hosting from Solaris works on Windows and Linux.');
  const rel = await getJSON('https://api.github.com/repos/playit-cloud/playit-agent/releases/latest');
  let a = null;
  for (const re of wanted) { a = (rel.assets || []).find((x) => re.test(x.name)); if (a) break; }
  if (!a) throw new Error('Couldn’t find the playit.gg agent download.');
  push('task', { id: 'playit', label: 'Downloading playit.gg agent', progress: null });
  try { await download(a.browser_download_url, exe, { size: a.size }); } finally { push('task', { id: 'playit', done: true }); }
  if (!win) fs.chmodSync(exe, 0o755);
  return exe;
}
async function ensureAgent() {
  const secret = loadSecret();
  if (!secret) throw new Error('Connect playit.gg first (Host → playit.gg → Connect).');
  if (agent?.proc) return;
  const exe = await agentExe();
  const restarts = agent?.restarts || 0;
  agent = { proc: null, state: 'connecting', restarts, lastError: null };
  const logDir = path.join(paths.cache(), 'playit', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  // The agent's control socket: a named pipe on Windows, a socket file elsewhere.
  const socket = process.platform === 'win32' ? `\\\\.\\pipe\\solaris-playitd-${process.pid}` : path.join(require('os').tmpdir(), `solaris-playitd-${process.pid}.sock`);
  if (process.platform !== 'win32') { try { fs.rmSync(socket, { force: true }); } catch {} }
  const proc = spawn(exe, ['--secret', secret, '--log-path', path.join(logDir, 'playitd.log'), '--socket-path', socket], { windowsHide: true });
  agent.proc = proc;
  const onOut = (d) => { const s = String(d); if (/error|failed/i.test(s)) agent.lastError = s.trim().split(/\r?\n/).pop().slice(0, 200); };
  proc.stdout.on('data', onOut); proc.stderr.on('data', onOut);
  proc.on('error', (e) => { agent.lastError = e.message; });
  proc.on('close', () => {
    const was = agent; agent = { proc: null, state: 'offline', restarts: (was?.restarts || 0) + 1, lastError: was?.lastError };
    emit();
    // Reconnect while servers still want a tunnel (back off up to 30 s)
    if (wanted.size && linked()) setTimeout(() => ensureAgent().catch(() => {}), Math.min(30000, 2000 * agent.restarts));
  });
  emit();
  startPolling();
}
function stopAgent() {
  if (agent?.proc) { const p = agent.proc; agent = { proc: null, state: 'offline', restarts: 0 }; try { p.kill(); } catch {} }
  stopPolling(); emit();
}

// ---------- tunnels ----------
function portOf(t) {
  const f = (t.agent_config?.fields || []).find((x) => /port/i.test(x.name));
  return f ? Number(f.value) : null;
}
async function refresh() {
  if (!linked()) return;
  const d = await call('/v1/agents/rundata', {});
  agentId = d.agent_id;
  tunnels = d.tunnels || [];
  if (agent) agent.state = agent.proc ? 'online' : agent.state;
  emit();
}
function startPolling() { stopPolling(); refresh().catch(() => {}); pollTimer = setInterval(() => refresh().catch((e) => { if (agent) agent.lastError = e.message; emit(); }), 10000); }
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

async function ensureTunnel(port, name) {
  await refresh();
  if (tunnels.some((t) => portOf(t) === port)) return;
  try {
    await call('/v1/tunnels/create', {
      name: `Solaris ${String(name).slice(0, 20)}`.replace(/[^\x20-\x7e]/g, ''),
      ports: { type: 'tunnel-type', details: 'minecraft-java' },
      origin: { type: 'agent', data: { agent_id: agentId, config: { fields: [{ name: 'local_ip', value: '127.0.0.1' }, { name: 'local_port', value: String(port) }] } } },
      enabled: true, alloc: null, firewall_id: null,
    });
    await refresh();
  } catch (e) {
    // Could not create it automatically (e.g. account limits) — the player can add it on playit.gg.
    push('hosted:playit-manual', { port, name, reason: e.message });
    throw new Error(`Add a “Minecraft Java” tunnel to local port ${port} on playit.gg (${e.message}).`);
  }
}

// called by hostserver
async function serverStarted(port, name) {
  wanted.set(port, name);
  if (!linked()) { emit(); throw new Error('not connected — open Host → playit.gg to connect your free account.'); }
  await ensureAgent();
  await ensureTunnel(port, name);
}
function serverStopped(port) {
  wanted.delete(port);
  if (!wanted.size) stopAgent(); // nothing to tunnel: don't keep the agent running
  emit();
}
function addressFor(port) {
  const t = tunnels.find((x) => portOf(x) === port);
  return t && !t.disabled_reason && wanted.has(port) ? t.display_address : null;
}
function statusFor(port, serverRunning) {
  if (!linked()) return { ok: false, text: 'playit.gg not connected', needsLink: true };
  if (!serverRunning) return { ok: false, text: 'Public when started (playit.gg)' };
  const t = tunnels.find((x) => portOf(x) === port);
  if (!agent?.proc) return { ok: false, text: agent?.restarts ? 'playit.gg reconnecting…' : 'playit.gg starting…' };
  if (!t) return { ok: false, text: 'Setting up the playit.gg tunnel…' };
  if (t.disabled_reason) return { ok: false, text: 'playit.gg: ' + t.disabled_reason };
  return { ok: true, text: 'Public via playit.gg' };
}
function status() {
  return {
    linked: linked(), claim: claim ? { url: claim.url, state: claim.state, error: claim.error } : null,
    agent: agent ? { state: agent.proc ? agent.state : 'offline', restarts: agent.restarts, lastError: agent.lastError } : { state: 'offline' },
    tunnels: tunnels.map((t) => ({ name: t.name, address: t.display_address, port: portOf(t), disabled: t.disabled_reason || null })),
  };
}
function emit() { push('playit:state', status()); }

module.exports = { status, startClaim, cancelClaim, unlink, serverStarted, serverStopped, addressFor, statusFor, stopAgent, refresh };
