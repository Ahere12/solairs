// Astra Connect — what runs in the background: the server watcher and desktop alerts. Started by index.js init().
const { events, push } = require('../util');
const { createWatcher } = require('./watch');

/** A desktop notification, only when notifications are on (Settings) and Astra isn't the window in front. */
function desktopNotify({ title, body, address }) {
  try {
    const { Notification, BrowserWindow } = require('electron');
    if (!require('../settings').get().notifications || !Notification.isSupported()) return false;
    if (BrowserWindow?.getFocusedWindow?.()) return false; // Astra is in front: the in-app toast is enough
    const n = new Notification({ title: String(title).slice(0, 100), body: String(body || '').slice(0, 200) });
    if (address) n.on('click', () => { events.emit('window', 'restore'); push('deeplink', { kind: 'server', address }); }); // click: offer to join it
    n.show();
    return true;
  } catch { return false; }
}

const watcher = createWatcher({
  ping: (a) => require('../servers').ping(a),
  savedServers: () => require('../servers').list().servers,
  friendNames: () => require('../friends').list().map((f) => f.name),
  // into the Astra inbox (it shows the toast and, if allowed for that category, the desktop notification)
  notify: (n) => require('../eco/notify').add({ category: n.kind === 'friend' ? 'friend' : 'server', title: n.title, body: n.body, key: `watch:${n.kind}:${n.address}:${n.title}`, action: n.address ? { kind: 'server', address: n.address } : null }),
  onChange: (v) => push('connect:watch', v),
});

let started = false;
/** active(id) gives an integration's settings while it's on, otherwise null. */
function init(active) {
  if (started) return;
  started = true;
  watcher.start(() => active('server-watch'));
  events.on('hosted:event', (e) => {
    const cfg = active('server-alerts');
    if (cfg && cfg[e.event]) desktopNotify({ title: e.name, body: e.text });
    // the inbox keeps a record of hosted servers going online / crashing (no second pop-up: the alert above is it)
    if (['online', 'crash', 'stop'].includes(e.event)) require('../eco/notify').add({ category: 'server', title: e.name, body: e.text, key: `hosted:${e.id}:${e.event}`, desktop: false });
  });
}
function restartWatch(active) { if (!started) return; watcher.stop(); watcher.start(() => active('server-watch'), { firstAfter: 500 }); }

module.exports = { init, restartWatch, watcher, desktopNotify };
