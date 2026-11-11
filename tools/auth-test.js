// Tests Microsoft sign-in plumbing without real credentials.
// SOLARIS_DATA_DIR=<tmp> SOLARIS_MS_CLIENT_ID=<any guid> SOLARIS_NO_BROWSER=1 electron tools/auth-test.js
const { app } = require('electron');
app.whenReady().then(async () => {
  const { events } = require('../src/util');
  const accounts = require('../src/accounts');
  const next = (ch) => new Promise((r) => { const h = (c, p) => { if (c === ch) { events.off('send', h); r(p); } }; events.on('send', h); });
  const ok = (name, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  try {
    console.log('microsoft available:', accounts.microsoftAvailable());

    // 1. Browser flow: authorize URL is well-formed
    let urlP = next('account:url');
    await accounts.startMicrosoft({ method: 'browser' });
    let { url, redirectUri } = await urlP;
    const u = new URL(url);
    ok('authorize URL', u.host === 'login.microsoftonline.com' && u.searchParams.get('code_challenge_method') === 'S256' && u.searchParams.get('redirect_uri') === redirectUri, redirectUri);
    ok('redirect URI is exactly the registered one', redirectUri === 'http://localhost:25585/relogin', redirectUri);
    const state = u.searchParams.get('state');

    // 1b. Microsoft itself accepts the redirect URI Solaris sends (no sign-in, just loads the form)
    {
      let next2 = url, verdict = 'unknown';
      for (let i = 0; i < 6; i++) {
        const rr = await fetch(next2, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' } });
        const loc = rr.headers.get('location');
        if (loc) { const d = decodeURIComponent(loc); if (/invalid_request/.test(d) && /redirect_uri/.test(d)) { verdict = 'rejected'; break; } next2 = new URL(loc, next2).toString(); continue; }
        const body = await rr.text();
        verdict = /redirect_uri/i.test(body) && /not valid|invalid_request/i.test(body) ? 'rejected' : /loginfmt|PPFT|ServerData/i.test(body) ? 'accepted' : 'HTTP ' + rr.status;
        break;
      }
      ok('Microsoft accepts the redirect URI', verdict === 'accepted', verdict);
    }

    // 2. Wrong state is rejected and the flow keeps waiting; other paths 404
    let r = await fetch(`${redirectUri}?code=x&state=forged`);
    ok('forged state rejected', /not from Solaris/.test(await r.text()));
    r = await fetch(`http://localhost:25585/?code=x&state=${state}`);
    ok('only /relogin is handled', r.status === 404, 'HTTP ' + r.status);

    // 3. IPv6 loopback works too
    const port = new URL(redirectUri).port;
    try { r = await fetch(`http://[::1]:${port}/relogin?state=forged`); ok('IPv6 loopback listening', r.status === 200); } catch (e) { ok('IPv6 loopback listening', false, e.message); }

    // 4. User cancels on Microsoft's page → clean error
    let loginP = next('account:login');
    r = await fetch(`${redirectUri}?error=access_denied&error_description=The+user+cancelled&state=${state}`);
    await r.text();
    let res = await loginP;
    ok('access_denied handled', !res.ok && res.error === 'Sign-in was cancelled.', res.error);

    // 5. New flow: a code comes back → token exchange reaches Microsoft (fails: fake code/client)
    urlP = next('account:url');
    await accounts.startMicrosoft({ method: 'browser' });
    ({ url, redirectUri } = await urlP);
    loginP = next('account:login');
    r = await fetch(`${redirectUri}?code=FAKECODE&state=${new URL(url).searchParams.get('state')}`);
    ok('success page shown', /Signed in to Solaris/.test(await r.text()));
    res = await loginP;
    ok('token exchange reached Microsoft', !res.ok && /expired or was already used|Microsoft sign-in failed. Please try again./.test(res.error) && !/AADSTS/.test(res.error), res.error.slice(0, 140));

    // 6. Cancel from the launcher closes the loopback server
    urlP = next('account:url');
    await accounts.startMicrosoft({ method: 'browser' });
    ({ redirectUri } = await urlP);
    accounts.cancelMicrosoft();
    await new Promise((s) => setTimeout(s, 1500));
    try { await fetch(redirectUri, { signal: AbortSignal.timeout(2000) }); ok('server closed after cancel', false); } catch { ok('server closed after cancel', true); }

    // 6b. Port 25585 busy (another program) → falls back to a free port with the same /relogin path
    {
      const blocker = require('http').createServer(() => {});
      await new Promise((res) => blocker.listen(25585, '127.0.0.1', res));
      urlP = next('account:url');
      await accounts.startMicrosoft({ method: 'browser' });
      ({ redirectUri } = await urlP);
      ok('busy port falls back, keeps /relogin', /^http:\/\/localhost:\d+\/relogin$/.test(redirectUri) && !redirectUri.includes(':25585/'), redirectUri);
      accounts.cancelMicrosoft();
      blocker.close();
      await new Promise((s) => setTimeout(s, 1500));
    }

    // 7. Device-code fallback ("Use a code instead"). Works when "Allow public client flows" is on;
    //    otherwise players get a friendly message instead of Azure jargon.
    try {
      const dc = await accounts.startMicrosoft({ method: 'code' });
      ok('device code issued by Microsoft', !!dc.userCode && /microsoft\.com/.test(dc.verificationUri), `code ${dc.userCode} at ${dc.verificationUri}`);
      accounts.cancelMicrosoft();
    } catch (e) { ok('device code error is player-friendly', /temporarily unavailable/.test(e.message) && !/AADSTS|Azure|client/i.test(e.message), e.message); }

    // 8. A build with no client ID refuses cleanly with a player-friendly message
    require('../src/config').MS_CLIENT_ID = '';
    ok('microsoftAvailable() false without ID', accounts.microsoftAvailable() === false);
    try { await accounts.startMicrosoft({ method: 'browser' }); ok('no-ID build', false, 'unexpected success'); }
    catch (e) { ok('no-ID build shows friendly message', /isn’t available in this version/.test(e.message) && !/Azure|client ID/i.test(e.message), e.message); }
  } catch (e) { console.log('FAIL exception', e.stack); }
  app.exit(0);
});
