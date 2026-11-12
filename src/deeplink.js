// solaris:// links (like NoRisk's deep links), e.g. from a website or a friend:
//   solaris://modrinth/<project slug or id>   → open that project in Browse (the player still clicks Install)
//   solaris://server/<host[:port]>            → offer to join that server
// Links only open pages and ask first — they never install or launch anything by themselves.
const { push } = require('./util');

const SCHEME = 'solaris';
let pending = null;

function parse(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  if (u.protocol !== SCHEME + ':') return null;
  const parts = [u.hostname, ...u.pathname.split('/')].map((s) => decodeURIComponent(s || '')).filter(Boolean);
  const [kind, value] = parts;
  if (kind === 'modrinth' && /^[A-Za-z0-9_.-]{2,64}$/.test(value || '')) return { kind: 'modrinth', id: value };
  if (kind === 'server' && /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(value || '')) return { kind: 'server', address: value };
  return { kind: 'unknown', url: String(url).slice(0, 200) };
}

/** Finds a solaris:// link in a command line (Windows/Linux pass it as an argument). */
function fromArgv(argv) { return (argv || []).find((a) => typeof a === 'string' && a.toLowerCase().startsWith(SCHEME + '://')) || null; }

function handle(url, rendererReady) {
  const link = parse(url);
  if (!link) return;
  if (rendererReady) push('deeplink', link);
  else pending = link;
}
function take() { const l = pending; pending = null; return l; }

/** Only the installed app claims solaris:// (dev and test runs must not take it over). The installer registers it too. */
function register(app) {
  if (app.isPackaged) app.setAsDefaultProtocolClient(SCHEME);
}

module.exports = { parse, fromArgv, handle, take, register, SCHEME };
