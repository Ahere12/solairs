// Astra Connect — server monitoring. Pings the servers you saved (favourites, or all of them) every few minutes
// with Minecraft's own Server List Ping (src/servers.js) and reports changes: a server came online or went offline,
// or a friend showed up in its player list. A server that doesn't answer is "offline", never an error of Astra's.
//
// Built from parts that are passed in (ping, the server list, friends, how to notify) so it can be tested without
// a network or Electron.

const key = (a) => String(a).trim().toLowerCase();

function createWatcher({ ping, savedServers, friendNames = () => [], notify = () => {}, onChange = () => {}, concurrency = 4 }) {
  const state = new Map(); // address -> { name, address, online, players, max, latency, version, sample, since, at, error }
  let timer = null, running = false, lastRun = null, cfgFn = null;

  const targets = (cfg) => {
    const all = savedServers() || [];
    const l = cfg.watch === 'all' ? all : all.filter((s) => s.favorite || s.notify); // favourites + servers with alerts on (Server details)
    const seen = new Set();
    return l.filter((s) => s.address && !seen.has(key(s.address)) && seen.add(key(s.address)));
  };

  /** One round: ping every watched server, compare with the last answer, tell about changes. */
  async function checkAll(cfg) {
    if (running) return;
    running = true;
    try {
      const list = targets(cfg);
      // servers no longer watched are forgotten
      for (const k of [...state.keys()]) if (!list.some((s) => key(s.address) === k)) state.delete(k);
      const friends = new Set(friendNames().map((n) => n.toLowerCase()));
      let i = 0;
      await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, async () => {
        while (i < list.length) {
          const s = list[i++], k = key(s.address), prev = state.get(k);
          let r;
          try { r = await ping(s.address); } catch (e) { r = { online: false, error: e.message }; }
          if (!r || typeof r !== 'object') r = { online: false, error: 'No answer' };
          const now = Date.now();
          const cur = {
            name: s.name || s.address, address: s.address, online: !!r.online, players: r.players?.online ?? null, max: r.players?.max ?? null,
            latency: r.latency ?? null, version: r.version || '', sample: r.players?.sample || [], at: now,
            since: prev && prev.online === !!r.online ? prev.since : now, error: r.online ? null : r.error || 'No answer',
          };
          state.set(k, cur);
          if (prev && prev.online !== cur.online) {
            if (cur.online && cfg.notifyOnline) notify({ kind: 'online', title: `${cur.name} is online`, body: `${cur.players ?? 0}/${cur.max ?? '?'} players${cur.version ? ` · ${cur.version}` : ''}`, address: cur.address });
            if (!cur.online && cfg.notifyOffline) notify({ kind: 'offline', title: `${cur.name} went offline`, body: 'It stopped answering.', address: cur.address });
          }
          if (cfg.notifyFriends && cur.online) {
            const before = new Set((prev?.online ? prev.sample : []).map((n) => n.toLowerCase()));
            for (const n of cur.sample) if (friends.has(n.toLowerCase()) && !before.has(n.toLowerCase()) && prev) notify({ kind: 'friend', title: `${n} is on ${cur.name}`, body: 'Your friend just joined.', address: cur.address });
          }
        }
      }));
      lastRun = Date.now();
      onChange(view());
    } finally { running = false; }
  }

  function view() {
    return { lastRun, servers: [...state.values()].sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name)) };
  }
  function schedule() {
    clearTimeout(timer);
    if (!cfgFn) return;
    const cfg = cfgFn();
    if (!cfg) return; // turned off
    const ms = Math.max(1, Math.min(60, Number(cfg.intervalMin) || 5)) * 60000;
    timer = setTimeout(async () => { try { const c = cfgFn(); if (c) await checkAll(c); } catch {} schedule(); }, ms);
    timer.unref?.();
  }
  return {
    checkAll, view,
    /** getConfig() returns the settings while monitoring is on, or null when it's off. */
    start(getConfig, { firstAfter = 10000 } = {}) {
      cfgFn = getConfig; clearTimeout(timer);
      if (!cfgFn()) return;
      timer = setTimeout(async () => { try { const c = cfgFn(); if (c) await checkAll(c); } catch {} schedule(); }, firstAfter);
      timer.unref?.();
    },
    stop() { clearTimeout(timer); timer = null; cfgFn = null; state.clear(); },
    get active() { return !!cfgFn; },
  };
}

module.exports = { createWatcher };
