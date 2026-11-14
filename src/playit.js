// playit.gg tunnels for hosted servers (every server type, incl. Vanilla/Paper/Purpur).
//
// How playit.gg officially works (checked against github.com/playit-cloud/playit-agent, packages/api_client/src/api.rs
// and packages/playitd): an agent is linked to a playit.gg account through a one-time "claim" — the player opens
// playit.gg/claim/<code> and approves it (signing in, or continuing as a guest, happens on playit.gg). There is no
// supported way for an app to approve itself, so Solaris does that one step in the browser and everything else
// automatically:
//   claim (once) → agent secret (stored encrypted) → official playitd agent → Minecraft Java tunnel per server
//   (POST /v1/tunnels/create with the agent key) → the real address from POST /v1/agents/rundata.
// The agent's own log tells us when it is really connected; nothing is shown as online before that.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { safeStorage, shell } = require('electron');
const { paths, readJSON, writeJSON, getJSON, download, push } = require('./util');

const API = 'https://api.playit.gg';
const file = () => paths.file('playit.json');
const VERSION = 'solaris-launcher';

let agent = null;            // { proc, state: starting|connected|reconnecting|offline, restarts, lastError, logPath, logPos }
let run = { tunnels: [], pending: [], notices: [], account: null }; // last /v1/agents/rundata
let agentId = null;
let pollTimer = null, logTimer = null;
let claim = null;            // { code, url, state: waiting|rejected|expired|error, error }
let claimWaiters = [];
let authProblem = null;      // set when playit.gg stops accepting this PC's key
const users = new Map();     // server id -> { port, name } — servers that need the agent right now

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

/** playit.gg stopped accepting this PC (removed on playit.gg, guest account expired …): forget the key, stop retrying. */
function keyRejected() {
  if (authProblem) return;
  authProblem = 'playit.gg no longer accepts this PC (it was removed from your playit.gg account, or the guest account ended). Connect playit.gg again.';
  stopAgent();
  try { fs.rmSync(file(), { force: true }); } catch {}
  run = { tunnels: [], pending: [], notices: [], account: null }; agentId = null;
  push('toast', { type: 'error', text: authProblem });
  emit();
}

async function call(p, body, secret = loadSecret()) {
  const r = await fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: 'Agent-Key ' + secret } : {}) }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(15000) });
  if (r.status === 429) throw new Error('playit.gg is busy (too many requests). Try again in a minute.');
  const j = await r.json().catch(() => null);
  if (!j) throw new Error(`playit.gg answered HTTP ${r.status}`);
  if (j.status === 'success') return j.data;
  const why = typeof j.data === 'string' ? j.data : j.data?.type || j.data?.message || JSON.stringify(j.data);
  if (secret && /InvalidAgentKey|NoLongerValid|AgentKeyNotFound/i.test(JSON.stringify(j))) { keyRejected(); throw new Error(authProblem); }
  const e = new Error(friendly(why)); e.playit = j.data; throw e;
}
/** playit.gg's error names → something a player can act on. */
function friendly(why) {
  const map = {
    RequiresVerifiedAccount: 'playit.gg wants you to verify your account (or turn your guest account into a free account) before it makes more tunnels. Open playit.gg, then try again.',
    RequiresPlayitPremium: 'playit.gg only allows this with playit Premium.',
    AgentVersionTooOld: 'playit.gg says this agent is too old — Solaris will download the newest one; try again.',
    AgentNotFound: 'playit.gg doesn’t know this PC any more. Connect playit.gg again.',
    InvalidTunnelConfig: 'playit.gg rejected the tunnel settings.',
    TunnelNameIsNotAscii: 'The tunnel name has characters playit.gg doesn’t allow.',
    RegionNotSupported: 'playit.gg doesn’t support that region for free accounts.',
  };
  return map[why] || 'playit.gg: ' + why;
}

// ---------- claim: link this PC to the player's playit.gg account (one time) ----------
async function startClaim() {
  if (claim && claim.state === 'waiting') { shell.openExternal(claim.url); return status(); }
  authProblem = null;
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
      if (s === 'UserRejected') { claim.state = 'rejected'; claimDone(new Error('You declined Solaris on playit.gg.')); return; }
      if (s === 'UserAccepted') {
        try {
          const ex = await call('/claim/exchange', { code }, null);
          saveSecret(ex.secret_key);
          claim = null;
          push('toast', { type: 'ok', text: 'playit.gg connected — your servers can go public now.' });
          claimDone(null);
          if (users.size) ensureAgent().catch(() => {});
        } catch (e) { claim.state = 'error'; claim.error = e.message; claimDone(e); }
        return;
      }
    }
    if (claim?.code === code) { claim.state = 'expired'; claimDone(new Error('The playit.gg approval timed out. Try again.')); }
  })();
  emit();
  return status();
}
function claimDone(err) { emit(); const w = claimWaiters; claimWaiters = []; for (const f of w) f(err); }
function cancelClaim() { if (claim) { claim = null; claimDone(new Error('playit.gg setup was cancelled.')); } return status(); }
/** Resolves once this PC is linked; opens the approval page if it isn't yet. */
async function waitForLink(onStep) {
  if (linked()) return;
  onStep && onStep('Approve Solaris on playit.gg (one time) — a browser tab opened');
  await startClaim();
  await new Promise((resolve, reject) => { if (linked()) return resolve(); claimWaiters.push((e) => (e ? reject(e) : resolve())); });
}
function unlink() {
  stopAgent();
  try { fs.rmSync(file(), { force: true }); } catch {}
  run = { tunnels: [], pending: [], notices: [], account: null }; agentId = null; authProblem = null;
  emit();
  return status();
}

// ---------- the official agent ----------
async function agentExe() {
  const dir = path.join(paths.cache(), 'playit');
  const win = process.platform === 'win32';
  const exe = path.join(dir, win ? 'playitd.exe' : 'playitd');
  if (fs.existsSync(exe)) return exe;
  // playit's release names its agent (playitd) per OS and CPU; "playit-linux-*" is the Linux build of playitd.
  const linuxArch = { x64: 'amd64', arm64: 'aarch64', arm: 'armv7', ia32: 'i686' }[process.arch];
  const names = win ? [/^playitd-windows-x86_64-signed\.exe$/, /^playitd-windows-x86_64\.exe$/]
    : process.platform === 'linux' && linuxArch ? [new RegExp(`^playit-linux-${linuxArch}$`)] : [];
  if (!names.length) throw new Error('playit.gg hosting from Solaris works on Windows and Linux.');
  let rel;
  try { rel = await getJSON('https://api.github.com/repos/playit-cloud/playit-agent/releases/latest'); }
  catch (e) { throw new Error('Couldn’t reach GitHub to download the playit.gg agent. Check your internet connection and try again.'); }
  let a = null;
  for (const re of names) { a = (rel.assets || []).find((x) => re.test(x.name)); if (a) break; }
  if (!a) throw new Error('Couldn’t find the playit.gg agent download for this computer.');
  push('task', { id: 'playit', label: 'Downloading playit.gg agent', progress: null });
  const tmp = exe + '.download';
  try {
    await download(a.browser_download_url, tmp, { size: a.size });
    // GitHub publishes a SHA-256 for every release file: the agent must match it exactly.
    const want = String(a.digest || '').replace(/^sha256:/i, '').toLowerCase();
    if (want) {
      const got = crypto.createHash('sha256').update(fs.readFileSync(tmp)).digest('hex');
      if (got !== want) throw new Error('The downloaded playit.gg agent didn’t match its official checksum, so Solaris didn’t use it. Try again.');
    }
    fs.renameSync(tmp, exe);
  } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch {} throw e; }
  finally { push('task', { id: 'playit', done: true }); }
  if (!win) fs.chmodSync(exe, 0o755);
  return exe;
}

async function ensureAgent() {
  const secret = loadSecret();
  if (!secret) throw new Error(authProblem || 'Connect playit.gg first (Hosting → playit.gg → Connect).');
  if (agent?.proc) return;
  const exe = await agentExe();
  if (agent?.proc) return; // started meanwhile
  const logDir = path.join(paths.cache(), 'playit', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, 'playitd.log');
  let logPos = 0; try { logPos = fs.statSync(logPath).size; } catch {}
  agent = { proc: null, state: 'starting', restarts: agent?.restarts || 0, lastError: null, logPath, logPos, since: Date.now() };
  // The agent's control socket: a named pipe on Windows, a socket file elsewhere.
  const socket = process.platform === 'win32' ? `\\\\.\\pipe\\solaris-playitd-${process.pid}` : path.join(require('os').tmpdir(), `solaris-playitd-${process.pid}.sock`);
  if (process.platform !== 'win32') { try { fs.rmSync(socket, { force: true }); } catch {} }
  const proc = spawn(exe, ['--secret', secret, '--log-path', logPath, '--socket-path', socket], { windowsHide: true });
  agent.proc = proc;
  proc.stdout.on('data', () => {}); proc.stderr.on('data', () => {});
  proc.on('error', (e) => { if (agent) agent.lastError = 'The playit.gg agent couldn’t start: ' + e.message; });
  proc.on('close', () => {
    if (agent?.proc !== proc) return; // replaced or stopped on purpose
    const was = agent;
    agent = { proc: null, state: 'offline', restarts: (was.restarts || 0) + 1, lastError: was.lastError || 'The playit.gg agent stopped.' };
    stopWatching(); emit();
    // Crashed while servers still need it: start it again (backing off to 30 s), unless the key was rejected.
    if (users.size && linked() && !authProblem) setTimeout(() => { if (users.size && !agent?.proc) ensureAgent().catch(() => {}); }, Math.min(30000, 2000 * agent.restarts));
  });
  startWatching();
  emit();
}
function stopAgent() {
  if (agent?.proc) { const p = agent.proc; agent = { proc: null, state: 'offline', restarts: 0 }; try { p.kill(); } catch {} }
  stopWatching(); emit();
}
async function restartAgent() {
  stopAgent();
  await new Promise((r) => setTimeout(r, 800));
  if (users.size) await ensureAgent();
  return status();
}

// Watch the agent: its log says when it is really connected (or why not), the API gives tunnels and addresses.
function startWatching() {
  stopWatching();
  refresh().catch(() => {});
  pollTimer = setInterval(() => refresh().catch((e) => { if (agent) agent.lastError = e.message; emit(); }), 8000);
  logTimer = setInterval(readLog, 1000);
}
function stopWatching() { clearInterval(pollTimer); clearInterval(logTimer); pollTimer = logTimer = null; }
function readLog() {
  if (!agent?.proc || !agent.logPath) return;
  let size; try { size = fs.statSync(agent.logPath).size; } catch { return; }
  if (size < agent.logPos) agent.logPos = 0; // log was rotated
  if (size === agent.logPos) return;
  const fd = fs.openSync(agent.logPath, 'r');
  const buf = Buffer.alloc(Math.min(size - agent.logPos, 256 * 1024));
  try { fs.readSync(fd, buf, 0, buf.length, agent.logPos); } finally { fs.closeSync(fd); }
  agent.logPos += buf.length;
  const before = agent.state;
  for (const line of buf.toString('utf8').split(/\r?\n/)) {
    if (/InvalidAgentKey|configured agent secret is no longer valid/i.test(line)) { keyRejected(); return; }
    if (/playit connected|tunnel state updated|New TCP Client/i.test(line)) { agent.state = 'connected'; agent.lastError = null; }
    else if (/timeout waiting for pong|failed to authenticate|failed to reload_control_addr/i.test(line) && agent.state === 'connected') agent.state = 'reconnecting';
    else if (/ERROR/.test(line) && !/failed to (send initial ping|ping tunnel server)|NetworkUnreachable/i.test(line)) {
      agent.lastError = line.replace(/^\S+\s+ERROR\s+\S+:\s*/, '').replace(/secret[^\s]*/gi, '').slice(0, 160);
    }
  }
  if (agent.state !== before) { refresh().catch(() => {}); emit(); }
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
  run = { tunnels: d.tunnels || [], pending: d.pending || [], notices: d.notices || [], account: d.permissions?.account_status || null };
  emit();
}

/**
 * The Minecraft Java tunnel for a server: re-uses the one saved for it (or one already pointing at its port), and
 * only creates a new one when there is none. Waits until playit.gg has given it a real public address.
 */
async function ensureTunnel({ port, name, tunnelId }, onStep) {
  if (!(port >= 1 && port <= 65535)) throw new Error(`Invalid local port ${port}.`);
  await refresh();
  let t = run.tunnels.find((x) => x.id === tunnelId);
  if (t && portOf(t) !== port) {
    // the server's port changed: retire the old tunnel (best effort) and make one for the new port
    call('/tunnels/delete', { tunnel_id: t.id }).catch(() => {});
    t = null; tunnelId = null;
  }
  if (!t) t = run.tunnels.find((x) => portOf(x) === port);
  let id = t?.id || (run.pending.some((p) => p.id === tunnelId) ? tunnelId : null);
  if (!id) {
    onStep && onStep('Creating public tunnel…');
    try {
      const made = await call('/v1/tunnels/create', {
        name: `Solaris ${String(name || 'server')}`.replace(/[^\x20-\x7e]/g, '').slice(0, 40),
        ports: { type: 'tunnel-type', details: 'minecraft-java' },
        origin: { type: 'agent', data: { agent_id: agentId, config: { fields: [{ name: 'local_ip', value: '127.0.0.1' }, { name: 'local_port', value: String(port) }] } } },
        enabled: true, alloc: null, firewall_id: null,
      });
      id = made?.id || made;
    } catch (e) {
      // e.g. account limits: the player can still add it on playit.gg by hand — Solaris picks it up by port.
      push('hosted:playit-manual', { port, name, reason: e.message });
      throw e;
    }
  }
  // wait for the public address
  onStep && onStep('Waiting for public address…');
  const until = Date.now() + 120000;
  for (;;) {
    await refresh().catch(() => {});
    t = run.tunnels.find((x) => x.id === id);
    if (t && t.display_address) return { tunnelId: t.id, address: t.display_address, disabled: t.disabled_reason || null };
    const p = run.pending.find((x) => x.id === id);
    if (p?.status_msg && onStep) onStep('Waiting for public address… (' + p.status_msg + ')');
    if (Date.now() > until) throw new Error('playit.gg hasn’t given the tunnel an address yet. It usually appears within a minute — Solaris keeps checking while the server runs.');
    await new Promise((r) => setTimeout(r, 2500));
  }
}
/** Waits until the agent reports it is connected to playit.gg (or fails). */
async function waitConnected(ms = 45000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (authProblem) throw new Error(authProblem);
    if (agent?.state === 'connected') return;
    if (!agent?.proc && agent?.lastError) throw new Error(agent.lastError);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('The playit.gg agent couldn’t connect. Check your internet connection (or firewall) and use “Restart tunnel”.');
}

// ---------- used by hostserver.js ----------
/** Create Server / Start / Restart tunnel: link (once), start the agent, make the tunnel, get the address. */
async function setupServer({ id, port, name, tunnelId }, onStep) {
  users.set(id, { port, name });
  try {
    await waitForLink(onStep);
    onStep && onStep(fs.existsSync(path.join(paths.cache(), 'playit', process.platform === 'win32' ? 'playitd.exe' : 'playitd')) ? 'Starting playit.gg agent…' : 'Installing playit.gg…');
    await ensureAgent();
    onStep && onStep('Starting playit.gg agent…');
    await waitConnected();
    return await ensureTunnel({ port, name, tunnelId }, onStep);
  } finally { emit(); }
}
/** The server no longer needs its tunnel (stopped, or "Stop tunnel"): stop the agent when nothing else needs it. */
function releaseServer(id) {
  users.delete(id);
  if (!users.size) stopAgent();
  emit();
}
/** Tunnel state for a server's dashboard. Never "online" unless the agent is connected and the server runs. */
function statusFor(m, serverRunning, stopped) {
  if (authProblem) return { ok: false, state: 'error', text: 'playit.gg needs to be connected again', needsLink: true };
  if (!linked()) return { ok: false, state: 'off', text: claim?.state === 'waiting' ? 'Waiting for you to approve Solaris on playit.gg' : 'playit.gg not connected', needsLink: claim?.state !== 'waiting' };
  if (stopped) return { ok: false, state: 'off', text: 'Tunnel stopped — the server is only on your network' };
  if (!serverRunning) return { ok: false, state: 'off', text: m.playitAddress ? 'Public again when the server starts' : 'Public when the server starts (playit.gg)' };
  const t = run.tunnels.find((x) => x.id === m.playitTunnelId) || run.tunnels.find((x) => portOf(x) === m.port);
  if (!agent?.proc) return { ok: false, state: 'warn', text: agent?.lastError ? 'playit.gg agent stopped — ' + agent.lastError : 'Starting the playit.gg agent…' };
  if (agent.state === 'starting') return { ok: false, state: 'warn', text: 'Connecting to playit.gg…' };
  if (agent.state === 'reconnecting') return { ok: false, state: 'warn', text: 'playit.gg reconnecting…' };
  if (!t) return { ok: false, state: 'warn', text: run.pending.length ? 'Waiting for the public address…' : 'Setting up the playit.gg tunnel…' };
  if (t.disabled_reason) return { ok: false, state: 'error', text: 'playit.gg turned this tunnel off: ' + t.disabled_reason };
  return { ok: true, state: 'ok', text: 'Public via playit.gg' };
}
/** The live address for a server (only from playit.gg's own data). */
function liveAddress(m) {
  const t = run.tunnels.find((x) => x.id === m.playitTunnelId) || run.tunnels.find((x) => portOf(x) === m.port);
  return t?.display_address || null;
}
function status() {
  return {
    linked: linked(), problem: authProblem,
    claim: claim ? { url: claim.url, state: claim.state, error: claim.error } : null,
    agent: agent ? { state: agent.proc ? agent.state : 'offline', restarts: agent.restarts, lastError: agent.lastError } : { state: 'offline' },
    account: run.account,
    notices: (run.notices || []).map((n) => ({ message: n.message, link: n.resolve_link || null })),
    tunnels: run.tunnels.map((t) => ({ id: t.id, name: t.name, address: t.display_address, port: portOf(t), disabled: t.disabled_reason || null })),
  };
}
function emit() { push('playit:state', status()); }

module.exports = { status, startClaim, cancelClaim, unlink, setupServer, releaseServer, statusFor, liveAddress, stopAgent, restartAgent, refresh, waitForLink };
