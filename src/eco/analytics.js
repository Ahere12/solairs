// Astra Analytics — every game session Astra starts is recorded on this PC (sessions.json, newest 2000):
// instance, start/end, how long the launch took, exit code, crash cause, server or world joined.
// From those: play time per day, per instance and per Minecraft version, session history, launch-time and
// crash-rate trends. World statistics come from the worlds' own save files (Astra Connect → Stats).
//
// Nothing leaves this PC. Sessions from before this feature existed aren't known (only each instance's total play
// time, which the summary shows separately).

const DAY = 864e5;
const MAX = 2000;

const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Splits a session over the days it covers, so a session past midnight counts on both days. */
function perDay(sessions, days = 30, now = Date.now()) {
  const out = new Map();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) out.set(dayKey(start.getTime() - i * DAY), 0);
  for (const s of sessions) {
    let a = s.start; const b = s.end;
    while (a < b) {
      const mid = new Date(a); mid.setHours(24, 0, 0, 0);
      const end = Math.min(b, mid.getTime());
      const k = dayKey(a);
      if (out.has(k)) out.set(k, out.get(k) + (end - a));
      a = end;
    }
  }
  return [...out.entries()].map(([day, ms]) => ({ day, ms }));
}

function median(xs) { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); }

/** Everything the Analytics page shows, from a list of sessions (oldest or newest first, doesn't matter). */
function summarize(sessions, { now = Date.now(), instances = [] } = {}) {
  const all = sessions.filter((s) => s && s.end > s.start).sort((a, b) => b.start - a.start);
  const dur = (s) => s.end - s.start;
  const within = (ms) => all.filter((s) => s.start >= now - ms);
  const total = (l) => l.reduce((t, s) => t + dur(s), 0);

  const byInst = new Map();
  for (const s of all) {
    const r = byInst.get(s.instanceId) || { instanceId: s.instanceId, name: s.name, sessions: 0, ms: 0, crashes: 0, last: 0 };
    r.sessions++; r.ms += dur(s); if (s.crashed) r.crashes++; r.last = Math.max(r.last, s.end); r.name = r.name || s.name;
    byInst.set(s.instanceId, r);
  }
  const names = new Map(instances.map((i) => [i.id, i.name]));
  const instanceUsage = [...byInst.values()].map((r) => ({ ...r, name: names.get(r.instanceId) || r.name, deleted: instances.length ? !names.has(r.instanceId) : false })).sort((a, b) => b.ms - a.ms);

  const byVer = new Map();
  for (const s of all) byVer.set(s.mc || '?', (byVer.get(s.mc || '?') || 0) + dur(s));

  // weekly trend of the last 8 weeks: median launch time, crash rate, average session
  const weeks = [];
  for (let w = 7; w >= 0; w--) {
    const a = now - (w + 1) * 7 * DAY, b = now - w * 7 * DAY;
    const l = all.filter((s) => s.start >= a && s.start < b);
    weeks.push({
      from: a, sessions: l.length,
      launchMs: median(l.map((s) => s.launchMs).filter((x) => Number.isFinite(x) && x >= 0)),
      crashRate: l.length ? Math.round((l.filter((s) => s.crashed).length / l.length) * 100) : null,
      avgSessionMs: l.length ? Math.round(total(l) / l.length) : null,
    });
  }
  const crashes = new Map();
  for (const s of all.filter((x) => x.crashed && x.crash)) crashes.set(s.crash, (crashes.get(s.crash) || 0) + 1);
  const servers = new Map();
  for (const s of all.filter((x) => x.server)) { const r = servers.get(s.server) || { address: s.server, sessions: 0, ms: 0 }; r.sessions++; r.ms += dur(s); servers.set(s.server, r); }

  // streak: consecutive days up to today with play
  const days = new Set(all.map((s) => dayKey(s.start)));
  let streak = 0; for (let d = 0; d < 400; d++) { if (days.has(dayKey(now - d * DAY))) streak++; else if (d > 0 || streak) break; }

  return {
    totals: {
      sessions: all.length, ms: total(all), week: total(within(7 * DAY)), month: total(within(30 * DAY)),
      avgSessionMs: all.length ? Math.round(total(all) / all.length) : 0, longestMs: all.length ? Math.max(...all.map(dur)) : 0,
      crashRate: all.length ? Math.round((all.filter((s) => s.crashed).length / all.length) * 100) : 0,
      medianLaunchMs: median(all.map((s) => s.launchMs).filter((x) => Number.isFinite(x) && x >= 0)),
      streakDays: streak, since: all.length ? all[all.length - 1].start : null,
      lifetimeMs: instances.reduce((t, i) => t + (i.playTime || 0), 0), // includes play before session tracking
    },
    perDay: perDay(all, 30, now),
    instances: instanceUsage,
    versions: [...byVer.entries()].map(([mc, ms]) => ({ mc, ms })).sort((a, b) => b.ms - a.ms),
    weeks, crashes: [...crashes.entries()].map(([title, n]) => ({ title, n })).sort((a, b) => b.n - a.n),
    servers: [...servers.values()].sort((a, b) => b.ms - a.ms).slice(0, 10),
    recent: all.slice(0, 50),
  };
}

// ---------- Astra ----------
function store() {
  const { paths, readJSON, writeJSON } = require('../util');
  const f = paths.file('sessions.json');
  return { read: () => readJSON(f, { sessions: [] }), write: (d) => writeJSON(f, d) };
}
function record(s) {
  if (!s || !s.instanceId || !(s.end > s.start)) return;
  const st = store(), d = st.read();
  d.sessions = [{ ...s, lines: undefined }, ...(d.sessions || []).filter((x) => x.runId !== s.runId)].slice(0, MAX);
  st.write(d);
}
let started = false;
function init() {
  if (started) return; started = true;
  require('../util').events.on('game:session', (s) => { try { record(s); } catch (e) { console.error('[Astra] analytics:', e.message); } });
}
function overview() {
  const instances = require('../instances').list();
  return summarize(store().read().sessions || [], { instances });
}
function sessions({ instanceId = null, limit = 200 } = {}) {
  return (store().read().sessions || []).filter((s) => !instanceId || s.instanceId === instanceId).slice(0, limit);
}
/** Worlds and players from save files (Astra Connect's reader), summed up. */
async function worlds() {
  const saves = require('../connect/saves');
  const list = saves.worlds();
  let totals = [];
  try { totals = await saves.totals(); } catch {}
  return { worlds: list.length, withStats: list.filter((w) => w.players).length, servers: list.filter((w) => w.kind === 'server').length, topPlayers: totals.slice(0, 5) };
}
function clear() { store().write({ sessions: [] }); return true; }

module.exports = { summarize, perDay, record, init, overview, sessions, worlds, clear };
