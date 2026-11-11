// Minimal Discord Rich Presence over local IPC (no dependencies).
const net = require('net');
const path = require('path');
const settings = require('./settings');

let sock = null, ready = false, connecting = null, pendingActivity;

function pipePath(i) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`;
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || '/tmp';
  return path.join(base, `discord-ipc-${i}`);
}
function frame(op, obj) {
  const data = Buffer.from(JSON.stringify(obj));
  const h = Buffer.alloc(8);
  h.writeInt32LE(op, 0); h.writeInt32LE(data.length, 4);
  return Buffer.concat([h, data]);
}
function tryConnect(i, clientId) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(pipePath(i));
    s.once('connect', () => { s.write(frame(0, { v: 1, client_id: clientId })); resolve(s); });
    s.once('error', reject);
  });
}
async function connect() {
  const { discordRpc, discordClientId } = settings.get();
  if (!discordRpc || !discordClientId) return false;
  if (sock) return ready;
  if (connecting) return connecting;
  connecting = (async () => {
    for (let i = 0; i < 10; i++) {
      try {
        sock = await tryConnect(i, discordClientId);
        sock.on('data', (buf) => {
          try { const msg = JSON.parse(buf.slice(8).toString()); if (msg.evt === 'READY') { ready = true; if (pendingActivity !== undefined) setActivity(pendingActivity); } } catch {}
        });
        sock.on('close', () => { sock = null; ready = false; });
        sock.on('error', () => {});
        return true;
      } catch {}
    }
    return false;
  })();
  const r = await connecting; connecting = null; return r;
}
async function setActivity(activity) {
  pendingActivity = activity;
  if (!(await connect()) || !ready) return;
  sock.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: activity || null }, nonce: String(Date.now()) + Math.random() }));
}
function idle() { return setActivity({ details: 'In the launcher', assets: { large_image: 'solaris', large_text: 'Solaris Launcher' } }); }
function disconnect() { try { sock && sock.destroy(); } catch {} sock = null; ready = false; }

module.exports = { setActivity, idle, disconnect };
