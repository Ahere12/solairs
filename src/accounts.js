// Accounts: offline + Microsoft (browser or device-code sign-in → Xbox Live → Minecraft services).
const crypto = require('crypto');
const { safeStorage } = require('electron');
const { paths, readJSON, writeJSON, getJSON, push } = require('./util');
const http = require('http');
const { shell } = require('electron');
const settings = require('./settings');
const config = require('./config');

const file = () => paths.file('accounts.json');
const load = () => readJSON(file(), { active: null, accounts: [] });
const store = (d) => writeJSON(file(), d);

function seal(obj) {
  const json = JSON.stringify(obj);
  if (safeStorage.isEncryptionAvailable()) return { enc: true, v: safeStorage.encryptString(json).toString('base64') };
  return { enc: false, v: Buffer.from(json).toString('base64') };
}
function unseal(blob) {
  if (!blob) return {};
  const buf = Buffer.from(blob.v, 'base64');
  try { return JSON.parse(blob.enc ? safeStorage.decryptString(buf) : buf.toString()); } catch { return {}; }
}
const publicView = (a) => ({ id: a.id, type: a.type, name: a.name, uuid: a.uuid, skinUrl: a.skinUrl || null, needsReauth: !!a.needsReauth });

function offlineUuid(name) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

function list() { const d = load(); return { active: d.active, accounts: d.accounts.map(publicView) }; }
function setActive(id) { const d = load(); d.active = id; store(d); return list(); }
function remove(id) {
  const d = load();
  d.accounts = d.accounts.filter((a) => a.id !== id);
  if (d.active === id) d.active = d.accounts[0]?.id || null;
  store(d);
  return list();
}
function addOffline(name) {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Username must be 3–16 characters: letters, numbers or _');
  const d = load();
  const uuid = offlineUuid(name);
  const id = 'offline-' + uuid;
  d.accounts = d.accounts.filter((a) => a.id !== id);
  d.accounts.push({ id, type: 'offline', name, uuid });
  d.active = id;
  store(d);
  return list();
}

// ---------- Microsoft ----------
// Flow: Microsoft OAuth (browser + PKCE, or device code) → Xbox Live → XSTS → Minecraft services.
const SCOPE = 'XboxLive.signin offline_access';
const MS_AUTHORIZE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize';
const MS_TOKEN = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const MS_DEVICE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode';
let pendingLogin = null;

// Solaris signs everyone in through ONE OAuth app owned by the Solaris developer (src/config.js).
// Players never see or provide a client ID.
const UNAVAILABLE = 'Microsoft sign-in isn’t available in this version of Solaris yet. Please update Solaris, or play offline in the meantime.';
function microsoftAvailable() { return !!config.MS_CLIENT_ID; }
function clientId() {
  if (!config.MS_CLIENT_ID) throw new Error(UNAVAILABLE);
  return config.MS_CLIENT_ID;
}
/** Problems with the Solaris app registration itself are the developer's to fix, not the player's. */
function appConfigProblem(code, text) {
  return code === 'unauthorized_client' || code === 'invalid_client' || /AADSTS(700016|7000218|70002|50011|700054|500113)/.test(text || '');
}
async function form(url, body) {
  return getJSON(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
}
async function postJSON(url, body, headers = {}) {
  return getJSON(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers }, body: JSON.stringify(body) });
}
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function oauthError(e) {
  try { const j = JSON.parse(e.body); return { code: j.error, text: j.error_description ? j.error_description.split('\r\n')[0] : j.error }; } catch { return { code: null, text: e.message }; }
}
/** Turns an OAuth failure into a message for players; developer-side problems are logged, not shown. */
function friendlyOAuth(e) {
  const { code, text } = oauthError(e);
  if (appConfigProblem(code, text)) {
    console.error('[Solaris] Microsoft OAuth app misconfigured:', code, text);
    return 'Microsoft sign-in is temporarily unavailable. Please try again later or update Solaris.';
  }
  console.error('[Solaris] Microsoft OAuth error:', code, text);
  if (code === 'invalid_grant') return 'That sign-in expired or was already used. Please sign in again.';
  if (code === 'interaction_required' || code === 'consent_required') return 'Microsoft needs you to finish signing in. Please try again.';
  if (code === 'temporarily_unavailable' || code === 'server_error') return 'Microsoft’s sign-in service is busy. Please try again in a moment.';
  return 'Microsoft sign-in failed. Please try again.';
}

async function minecraftFromMsToken(msAccess) {
  const xbl = await postJSON('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msAccess },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
  });
  let xsts;
  try {
    xsts = await postJSON('https://xsts.auth.xboxlive.com/xsts/authorize', {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
    });
  } catch (e) {
    const code = (() => { try { return JSON.parse(e.body).XErr; } catch { return null; } })();
    const msgs = {
      2148916233: 'This Microsoft account has no Xbox profile. Sign in at minecraft.net once to create one.',
      2148916235: 'Xbox Live is not available in your country.',
      2148916238: 'This is a child account — it must be added to a Microsoft Family by an adult.',
    };
    throw new Error(msgs[code] || 'Xbox Live sign-in failed. Please try again.');
  }
  const uhs = xsts.DisplayClaims.xui[0].uhs;
  let mc;
  try {
    mc = await postJSON('https://api.minecraftservices.com/authentication/login_with_xbox', { identityToken: `XBL3.0 x=${uhs};${xsts.Token}` });
  } catch (e) {
    if (e.status === 403) {
      // Mojang has not (yet) approved the Solaris app for Minecraft services. Developer-side issue.
      console.error('[Solaris] login_with_xbox returned 403 — the Solaris client ID is not approved by Mojang yet.');
      throw new Error('Minecraft sign-in for Solaris is still being enabled by Mojang. Please try again later or update Solaris.');
    }
    if (e.status === 429) throw new Error('Too many sign-in attempts. Wait a minute and try again.');
    throw new Error('Minecraft services sign-in failed. Please try again.');
  }
  const auth = { headers: { Authorization: 'Bearer ' + mc.access_token } };
  let profile;
  try {
    profile = await getJSON('https://api.minecraftservices.com/minecraft/profile', auth);
  } catch (e) {
    if (e.status !== 404) throw new Error('Could not load your Minecraft profile. Please try again.');
    // No profile: either the game isn't owned, or it is owned but no username has been chosen yet.
    let owns = false;
    try { const ent = await getJSON('https://api.minecraftservices.com/entitlements/mcstore', auth); owns = (ent.items || []).some((i) => /minecraft/.test(i.name)); } catch {}
    throw new Error(owns
      ? 'You own Minecraft but haven’t picked a username yet. Open minecraft.net, sign in and create your profile, then try again.'
      : 'This Microsoft account doesn’t own Minecraft: Java Edition. Sign in with the account you bought it on, or buy it at minecraft.net.');
  }
  return { mcToken: mc.access_token, mcExpires: Date.now() + mc.expires_in * 1000, profile, xuid: xsts.DisplayClaims.xui[0].xid || '' };
}

function saveMsAccount(ms, mcData, cid) {
  const d = load();
  const { profile } = mcData;
  const id = 'msa-' + profile.id;
  const skin = (profile.skins || []).find((s) => s.state === 'ACTIVE');
  const acct = {
    id, type: 'msa', name: profile.name, uuid: profile.id, skinUrl: skin?.url || null,
    secret: seal({ cid, refresh: ms.refresh_token, mcToken: mcData.mcToken, mcExpires: mcData.mcExpires, xuid: mcData.xuid }),
  };
  d.accounts = d.accounts.filter((a) => a.id !== id);
  d.accounts.push(acct);
  d.active = id;
  store(d);
  return publicView(acct);
}

async function finishLogin(cid, ms, token) {
  const mcData = await minecraftFromMsToken(ms.access_token);
  const acct = saveMsAccount(ms, mcData, cid);
  if (!token.cancelled) push('account:login', { ok: true, account: acct });
}

const PAGE = (title, text, ok) => `<!doctype html><meta charset="utf-8"><title>Solaris</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0d0b12;color:#f4efe6;font-family:Segoe UI,system-ui,sans-serif">
<div style="text-align:center;max-width:420px;padding:24px"><div style="font-size:56px">${ok ? '☀️' : '⚠️'}</div>
<h1 style="margin:8px 0;font-size:22px">${title}</h1><p style="color:#a49cb1">${text}</p></div></body>`;
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Browser sign-in (OAuth 2.0 authorization code + PKCE, RFC 8252 loopback redirect).
 * Opens Microsoft's sign-in page in the user's default browser; Microsoft redirects back to
 * http://localhost:<port> on this machine, where Solaris receives the code.
 */
async function browserLogin(cid, token) {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  // Listen on IPv4 and IPv6 loopback with the same port, since "localhost" may resolve to either.
  const servers = [];
  const listen = (host, port) => new Promise((res, rej) => { const s = http.createServer(); s.once('error', rej); s.listen(port, host, () => { servers.push(s); res(s.address().port); }); });
  // Registered redirect URI: http://localhost:25585/relogin (src/config.js).
  // If something else already uses 25585, fall back to a free port: Microsoft matches localhost
  // redirect URIs regardless of port, as long as the path (/relogin) is the same.
  let port;
  try { port = await listen('127.0.0.1', config.MS_REDIRECT_PORT); }
  catch (e) {
    if (e.code !== 'EADDRINUSE') throw e;
    console.warn(`[Solaris] Port ${config.MS_REDIRECT_PORT} is busy; using a free port for the sign-in callback.`);
    port = await listen('127.0.0.1', 0);
  }
  try { await listen('::1', port); } catch {}
  const redirectUri = `http://localhost:${port}${config.MS_REDIRECT_PATH}`;
  const closeAll = () => servers.forEach((s) => { try { s.close(); s.closeAllConnections?.(); } catch {} });

  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Sign-in timed out. Please try again.')), 10 * 60 * 1000);
    token.abort = () => { clearTimeout(timer); reject(new Error('CANCELLED')); };
    const handler = (req, resp) => {
      const u = new URL(req.url, redirectUri);
      if (u.pathname !== config.MS_REDIRECT_PATH) { resp.writeHead(404).end(); return; }
      const send = (title, text, ok) => { resp.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); resp.end(PAGE(title, text, ok)); };
      if (u.searchParams.get('state') !== state) { send('Sign-in failed', 'This sign-in link is not from Solaris. Start again from the launcher.', false); return; }
      clearTimeout(timer);
      const err = u.searchParams.get('error');
      if (err) {
        const desc = u.searchParams.get('error_description') || err;
        send('Sign-in cancelled', escHtml(desc.split('\r\n')[0]) + '<br>You can close this tab.', false);
        reject(new Error(err === 'access_denied' ? 'Sign-in was cancelled.' : friendlyOAuth({ body: JSON.stringify({ error: err, error_description: desc }) })));
        return;
      }
      send('Signed in to Solaris', 'You can close this tab and return to the launcher.', true);
      resolve(u.searchParams.get('code'));
    };
    servers.forEach((s) => s.on('request', handler));
    const q = new URLSearchParams({
      client_id: cid, response_type: 'code', redirect_uri: redirectUri, response_mode: 'query', scope: SCOPE,
      state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
    });
    const url = `${MS_AUTHORIZE}?${q}`;
    token.url = url;
    if (process.env.SOLARIS_NO_BROWSER) push('account:url', { url, redirectUri });
    else shell.openExternal(url);
  }).finally(() => setTimeout(closeAll, 1000));

  try {
    return await form(MS_TOKEN, { client_id: cid, grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, scope: SCOPE });
  } catch (e) { throw new Error(friendlyOAuth(e)); }
}

/**
 * Starts Microsoft sign-in. method: 'browser' (default) or 'code' (device code, for when the browser
 * cannot reach this computer). Completion is pushed as 'account:login'.
 */
async function startMicrosoft({ method = 'browser' } = {}) {
  const cid = clientId();
  if (pendingLogin) cancelMicrosoft();
  const token = { cancelled: false };
  pendingLogin = token;
  if (method === 'browser') {
    (async () => {
      try { await finishLogin(cid, await browserLogin(cid, token), token); }
      catch (e) { if (!token.cancelled && e.message !== 'CANCELLED') push('account:login', { ok: false, error: e.message }); }
    })();
    await new Promise((r) => setTimeout(r, 50));
    return { mode: 'browser', url: token.url };
  }
  let dc;
  try { dc = await form(MS_DEVICE, { client_id: cid, scope: SCOPE }); }
  catch (e) { throw new Error(friendlyOAuth(e)); }
  (async () => {
    const deadline = Date.now() + dc.expires_in * 1000;
    let interval = (dc.interval || 5) * 1000;
    while (Date.now() < deadline && !token.cancelled) {
      await new Promise((r) => setTimeout(r, interval));
      try {
        let ms;
        try {
          ms = await form(MS_TOKEN, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: cid, device_code: dc.device_code });
        } catch (e) {
          const { code } = oauthError(e);
          if (code === 'authorization_pending') continue;
          if (code === 'slow_down') { interval += 5000; continue; }
          if (!token.cancelled) push('account:login', { ok: false, error: code === 'expired_token' ? 'The sign-in code expired.' : code === 'authorization_declined' ? 'Sign-in was cancelled.' : friendlyOAuth(e) });
          return;
        }
        await finishLogin(cid, ms, token);
        return;
      } catch (e) {
        if (!token.cancelled) push('account:login', { ok: false, error: e.message });
        return;
      }
    }
    if (!token.cancelled) push('account:login', { ok: false, error: 'The sign-in code expired.' });
  })();
  return { mode: 'code', userCode: dc.user_code, verificationUri: dc.verification_uri, expiresIn: dc.expires_in, message: dc.message };
}
function cancelMicrosoft() {
  if (pendingLogin) { pendingLogin.cancelled = true; if (pendingLogin.abort) pendingLogin.abort(); }
  pendingLogin = null;
  return true;
}

/** Returns launch credentials for the active account, refreshing Microsoft tokens if needed. */
async function getLaunchAuth() {
  const d = load();
  const a = d.accounts.find((x) => x.id === d.active);
  if (!a) throw new Error('Add an account before playing (Settings → Accounts, or the account menu).');
  if (a.type === 'offline') return { name: a.name, uuid: a.uuid.replace(/-/g, ''), accessToken: '0', userType: 'legacy', xuid: '0', type: 'offline' };
  const s = unseal(a.secret);
  if (!s.mcToken || !s.mcExpires || s.mcExpires < Date.now() + 120000) {
    // Refresh tokens are bound to the client ID that issued them.
    const cid = s.cid || clientId();
    let ms;
    try {
      ms = await form(MS_TOKEN, { grant_type: 'refresh_token', client_id: cid, refresh_token: s.refresh, scope: SCOPE });
    } catch {
      a.needsReauth = true; store(d);
      throw new Error(`Your Microsoft session for ${a.name} expired. Sign in again from the account menu.`);
    }
    ms.refresh_token = ms.refresh_token || s.refresh;
    const mcData = await minecraftFromMsToken(ms.access_token);
    saveMsAccount(ms, mcData, cid);
    return { name: mcData.profile.name, uuid: mcData.profile.id, accessToken: mcData.mcToken, userType: 'msa', xuid: mcData.xuid, type: 'msa' };
  }
  return { name: a.name, uuid: a.uuid, accessToken: s.mcToken, userType: 'msa', xuid: s.xuid || '0', type: 'msa' };
}
function active() { const d = load(); const a = d.accounts.find((x) => x.id === d.active); return a ? publicView(a) : null; }

/** Profile with skins/capes for the active Microsoft account. */
async function mcProfile() {
  const auth = await getLaunchAuth();
  if (auth.type !== 'msa') return null;
  return getJSON('https://api.minecraftservices.com/minecraft/profile', { headers: { Authorization: 'Bearer ' + auth.accessToken } });
}

module.exports = { list, setActive, remove, addOffline, startMicrosoft, cancelMicrosoft, getLaunchAuth, active, mcProfile, offlineUuid, microsoftAvailable };
