// Read-only diagnostic for Microsoft → Xbox Live → XSTS → Minecraft Services sign-in.
// Uses the same client ID, scope and endpoints as Solaris (src/config.js, src/accounts.js) but does
// NOT touch Solaris's code, settings or saved accounts. Every token is redacted from the output.
//
// Usage: node tools/auth-diagnose.js [outfile]
const fs = require('fs');
const { MS_CLIENT_ID } = require('../src/config');

const OUT = process.argv[2];
const SCOPE = 'XboxLive.signin offline_access';
const lines = [];
const log = (...a) => { const l = a.join(' '); lines.push(l); console.log(l); if (OUT) fs.writeFileSync(OUT, lines.join('\n') + '\n'); };
const secrets = new Set();
const keep = (s) => { if (s && String(s).length > 12) secrets.add(String(s)); return s; };
const redact = (txt) => { let t = String(txt); for (const s of secrets) t = t.split(s).join('<REDACTED>'); return t.replace(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]*/g, '<REDACTED-JWT>').replace(/(EwA|M\.C\d)[\w.!*$-]{20,}/g, '<REDACTED-TOKEN>'); };

async function call(label, url, opts) {
  const r = await fetch(url, opts);
  const body = await r.text();
  const hdr = {};
  for (const k of ['content-type', 'www-authenticate', 'x-ms-request-id', 'x-err', 'correlation-id', 'request-id']) if (r.headers.get(k)) hdr[k] = r.headers.get(k);
  return { label, url, status: r.status, body, hdr };
}
const json = (b) => { try { return JSON.parse(b); } catch { return null; } };
const form = (o) => new URLSearchParams(o).toString();

(async () => {
  log(`# Solaris auth diagnostic — ${new Date().toISOString()}`);
  log(`client_id: ${MS_CLIENT_ID}   scope: ${SCOPE}   endpoint: login.microsoftonline.com/consumers`);

  // 1. Microsoft (device code — same app, same scope as the browser flow)
  let r = await call('devicecode', 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ client_id: MS_CLIENT_ID, scope: SCOPE }) });
  const dc = json(r.body);
  if (r.status !== 200) { log('DEVICECODE FAILED', r.status, redact(r.body)); return; }
  log(`\n>>> SIGN IN: open ${dc.verification_uri} and enter code  ${dc.user_code}  (expires in ${Math.round(dc.expires_in / 60)} min)\n`);
  let ms;
  const deadline = Date.now() + dc.expires_in * 1000;
  while (Date.now() < deadline) {
    await new Promise((s) => setTimeout(s, (dc.interval || 5) * 1000));
    r = await call('token', 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: MS_CLIENT_ID, device_code: dc.device_code }) });
    const j = json(r.body) || {};
    if (j.error === 'authorization_pending') continue;
    if (r.status !== 200) { log('MICROSOFT TOKEN FAILED', r.status, j.error, (j.error_description || '').split('\r\n')[0]); return; }
    ms = j; break;
  }
  if (!ms) { log('Timed out waiting for sign-in.'); return; }
  keep(ms.access_token); keep(ms.refresh_token); keep(ms.id_token);
  log(`[1] Microsoft token: OK  (token_type=${ms.token_type}, scope="${ms.scope}", expires_in=${ms.expires_in}s)`);

  // 2. Xbox Live user token
  r = await call('xbl', 'https://user.auth.xboxlive.com/user/authenticate', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-xbl-contract-version': '1' },
    body: JSON.stringify({ Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + ms.access_token }, RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' }) });
  const xbl = json(r.body);
  if (r.status !== 200) { log('[2] XBOX LIVE FAILED', r.status, JSON.stringify(r.hdr), redact(r.body)); return; }
  keep(xbl.Token);
  log(`[2] Xbox Live user token: OK  (Issued=${xbl.IssueInstant}, NotAfter=${xbl.NotAfter}, claims=${JSON.stringify(Object.keys(xbl.DisplayClaims?.xui?.[0] || {}))})`);

  // 3. XSTS for Minecraft Services
  const RP = 'rp://api.minecraftservices.com/';
  r = await call('xsts', 'https://xsts.auth.xboxlive.com/xsts/authorize', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-xbl-contract-version': '1' },
    body: JSON.stringify({ Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] }, RelyingParty: RP, TokenType: 'JWT' }) });
  const xsts = json(r.body);
  if (r.status !== 200) { log('[3] XSTS FAILED', r.status, JSON.stringify(r.hdr), redact(r.body)); return; }
  keep(xsts.Token);
  const xui = xsts.DisplayClaims?.xui?.[0] || {};
  const userHashMatches = xui.uhs === xbl.DisplayClaims?.xui?.[0]?.uhs;
  log(`[3] XSTS token: OK  (RelyingParty requested=${RP}, NotAfter=${xsts.NotAfter}, claim keys=${JSON.stringify(Object.keys(xui))}, uhs present=${!!xui.uhs}, uhs matches Xbox Live=${userHashMatches})`);

  // 4. Minecraft Services login_with_xbox
  const MC = 'https://api.minecraftservices.com/authentication/login_with_xbox';
  r = await call('mc', MC, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ identityToken: `XBL3.0 x=${xui.uhs};${xsts.Token}` }) });
  log(`[4] POST ${MC}`);
  log(`    HTTP ${r.status}   headers: ${JSON.stringify(r.hdr)}`);
  log(`    body: ${redact(r.body).slice(0, 1500) || '(empty)'}`);
  const mc = json(r.body);
  if (r.status !== 200) return;
  keep(mc.access_token);

  // 5. Entitlements + profile
  const auth = { headers: { Authorization: 'Bearer ' + mc.access_token } };
  r = await call('ent', 'https://api.minecraftservices.com/entitlements/mcstore', auth);
  log(`[5] GET /entitlements/mcstore → HTTP ${r.status}  items=${JSON.stringify((json(r.body)?.items || []).map((i) => i.name))}`);
  r = await call('profile', 'https://api.minecraftservices.com/minecraft/profile', auth);
  const p = json(r.body) || {};
  log(`[6] GET /minecraft/profile → HTTP ${r.status}  name=${p.name || '-'}  id=${p.id || '-'}  ${r.status !== 200 ? redact(r.body).slice(0, 300) : ''}`);
})().catch((e) => log('EXCEPTION', redact(e.stack)));
