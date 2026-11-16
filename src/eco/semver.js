// Version numbers and version ranges as mods write them.
//
// Fabric/Quilt (fabric.mod.json "depends"): ">=0.15.0", "~1.20.1", "^3.0", "1.20.x", "*", "<1.21 >=1.20", or an array
// of those (any one may match). Forge/NeoForge (mods.toml "versionRange"): Maven ranges "[1.20,1.21)", "[47,)",
// "(,2.0]", "[1.20.1]", several joined by commas.
//
// satisfies() answers true / false, or null when it can't tell (a snapshot name like "24w14a", a range it can't read).
// A "can't tell" is never reported as a problem.

/** "1.20.1" → { nums: [1,20,1], pre: null }, "0.15.11+build.3" → [0,15,11], "1.21-pre1" → pre "pre1". Null if no number. */
function parse(v) {
  const s = String(v ?? '').trim().replace(/^v(?=\d)/i, '').split('+')[0];
  if (/^\d{2}w\d{2}[a-z~]$/i.test(s)) return null; // a snapshot name (24w14a) has no order we can compare
  // The numbers are read greedily (1.20.2 is never "1.20" + pre-release "2"). A pre-release follows a dash ("1.21-pre1")
  // or starts with a letter ("1.21pre1", "1.0.0.beta"). A bare trailing dash ("<1.20.2-", Fabric's way of saying
  // "below 1.20.2 and its pre-releases") is the lowest pre-release: pre "".
  const m = s.match(/^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z][0-9A-Za-z.-]*)?|\.?([A-Za-z][0-9A-Za-z.-]*))?$/);
  if (!m) return null;
  const pre = m[2] ?? m[3] ?? (/-$/.test(s) ? '' : null);
  return { nums: m[1].split('.').map(Number), pre };
}

/** -1, 0, 1, or null when either isn't a version number. "1.20" equals "1.20.0"; "1.21-pre1" is before "1.21". */
function compare(a, b) {
  const x = typeof a === 'object' && a ? a : parse(a), y = typeof b === 'object' && b ? b : parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] || 0) - (y.nums[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  const xp = x.pre != null, yp = y.pre != null; // '' (a bare trailing dash) is a pre-release too, the lowest one
  if (xp && !yp) return -1;
  if (!xp && yp) return 1;
  if (xp && yp && x.pre !== y.pre) {
    if (x.pre === '') return -1;
    if (y.pre === '') return 1;
    const [pa, pb] = [x.pre, y.pre].map((p) => p.split(/[.-]/));
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if (pa[i] == null) return -1;
      if (pb[i] == null) return 1;
      const na = /^\d+$/.test(pa[i]), nb = /^\d+$/.test(pb[i]);
      if (na && nb && +pa[i] !== +pb[i]) return +pa[i] < +pb[i] ? -1 : 1;
      if (pa[i] !== pb[i]) return na ? -1 : nb ? 1 : pa[i] < pb[i] ? -1 : 1;
    }
  }
  return 0;
}

/** One Fabric comparator against a version. */
function fabricOne(ver, c) {
  c = c.trim();
  if (!c || c === '*') return true;
  const m = c.match(/^(>=|<=|>|<|=|~|\^)?\s*(.+)$/);
  const op = m[1] || '=', target = m[2];
  // wildcards: 1.20.x / 1.20.* / 1.x
  if (/(^|\.)[xX*](\.|$)/.test(target) && (op === '=' || !m[1])) {
    const head = target.split('.').filter((p) => !/^[xX*]$/.test(p));
    const v = parse(ver); if (!v) return null;
    if (head.some((p) => !/^\d+$/.test(p))) return null;
    return head.every((p, i) => (v.nums[i] || 0) === Number(p));
  }
  const t = parse(target);
  if (!t) return null;
  const cmp = compare(ver, t);
  if (cmp == null) return null;
  switch (op) {
    case '>=': return cmp >= 0;
    case '<=': return cmp <= 0;
    case '>': return cmp > 0;
    case '<': return cmp < 0;
    case '=': return cmp === 0;
    case '~': { // same major.minor, at least this
      const upper = { nums: [t.nums[0], (t.nums[1] || 0) + 1], pre: null };
      return cmp >= 0 && compare(ver, upper) < 0;
    }
    case '^': { // same major, at least this
      const upper = { nums: [t.nums[0] + 1], pre: null };
      return cmp >= 0 && compare(ver, upper) < 0;
    }
  }
  return null;
}

/** Fabric/Quilt predicate: a string (space-separated = all must match) or an array (any may match). */
function fabricSatisfies(ver, range) {
  if (range == null) return true;
  const ors = Array.isArray(range) ? range : [range];
  if (!ors.length) return true;
  let unknown = false;
  for (const r of ors) {
    if (typeof r !== 'string') { unknown = true; continue; }
    // "1.20 - 1.20.4" (hyphen range) is allowed by Fabric
    const hy = r.match(/^\s*(\S+)\s+-\s+(\S+)\s*$/);
    const parts = hy ? [`>=${hy[1]}`, `<=${hy[2]}`] : r.trim().split(/\s+/);
    const res = parts.map((p) => fabricOne(ver, p));
    if (res.every((x) => x === true)) return true;
    if (!res.includes(false)) unknown = true;
  }
  return unknown ? null : false;
}

/** Maven range used by Forge and NeoForge. A bare version ("1.0") is a soft requirement: anything matches. */
function mavenSatisfies(ver, range) {
  const r = String(range ?? '').trim();
  if (!r || r === '*') return true;
  if (!/^[[(]/.test(r)) return true;
  const sets = r.match(/[[(][^\])]*[\])]/g);
  if (!sets) return null;
  let unknown = false;
  for (const s of sets) {
    const lo = s[0], hi = s[s.length - 1];
    const inner = s.slice(1, -1);
    if (!inner.includes(',')) { // [1.20.1] exact
      const c = compare(ver, inner.trim());
      if (c == null) { unknown = true; continue; }
      if (c === 0) return true;
      continue;
    }
    const [a, b] = inner.split(',').map((x) => x.trim());
    let ok = true;
    if (a) { const c = compare(ver, a); if (c == null) { unknown = true; continue; } if (lo === '[' ? c < 0 : c <= 0) ok = false; }
    if (b) { const c = compare(ver, b); if (c == null) { unknown = true; continue; } if (hi === ']' ? c > 0 : c >= 0) ok = false; }
    if (ok) return true;
  }
  return unknown ? null : false;
}

function satisfies(ver, range, style = 'fabric') {
  if (ver == null || ver === '') return null;
  return style === 'maven' ? mavenSatisfies(ver, range) : fabricSatisfies(ver, range);
}

/** A range written for people: "[1.20,1.21)" → "1.20 or newer, before 1.21". */
function describe(range, style = 'fabric') {
  if (range == null || range === '' || range === '*') return 'any version';
  if (Array.isArray(range)) return range.map((r) => describe(r, style)).join(' or ');
  if (style === 'maven') {
    const m = String(range).match(/^([[(])([^,\])]*)(,([^\])]*))?([\])])$/);
    if (!m) return String(range);
    if (m[3] == null) return m[2];
    const parts = [];
    if (m[2]) parts.push(`${m[2]}${m[1] === '[' ? ' or newer' : ' (newer than)'}`);
    if (m[4]) parts.push(`${m[5] === ']' ? 'up to ' : 'before '}${m[4]}`);
    return parts.join(', ') || 'any version';
  }
  return String(range);
}

module.exports = { parse, compare, satisfies, fabricSatisfies, mavenSatisfies, describe };
