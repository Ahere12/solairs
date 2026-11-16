// Astra Modpack Intelligence — reads what every mod jar says about itself (its id, version, what it needs, what it
// can't run with, which mods it carries inside) and checks the whole instance against it:
//   missing dependencies · wrong dependency versions · wrong Minecraft / loader version · mods for another loader
//   duplicates (two files giving the same mod) · declared conflicts ("breaks" / "incompatible")
// plus outdated mods (Modrinth), a health score, recommendations and comparing two instances.
//
// Everything is read from the jar files on this PC. Nothing here changes a file: fixes are suggestions the player
// applies with a click (turn a mod off, install a missing one), through the existing instance functions.

const fs = require('fs');
const path = require('path');
const semver = require('./semver');

// ids a mod may depend on that are the game or the loader itself, not another mod file
const PLATFORM = {
  fabric: new Set(['minecraft', 'java', 'fabricloader', 'fabric-loader']),
  quilt: new Set(['minecraft', 'java', 'fabricloader', 'quilt_loader']),
  forge: new Set(['minecraft', 'forge', 'javafml', 'lowcodefml', 'mcp', 'fml']),
  neoforge: new Set(['minecraft', 'neoforge', 'javafml', 'lowcodefml', 'fml']),
};
const LOADER_NAMES = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge', vanilla: 'Vanilla' };

// ---------- reading jars ----------

function safeJSON(t) { try { return JSON.parse(String(t).replace(/^﻿/, '').replace(/[\u0000-\u001f]+/g, ' ')); } catch { return null; } }
const depList = (obj) => Object.entries(obj && typeof obj === 'object' ? obj : {}).map(([id, range]) => ({ id: String(id).toLowerCase(), range }));

/** The [[mods]] and [[dependencies.<id>]] tables of a mods.toml, without a full TOML parser. */
function parseModsToml(txt) {
  const mods = [], deps = [];
  let cur = null;
  const val = (line) => {
    const m = line.match(/^\s*([\w-]+)\s*=\s*(.+?)\s*(#.*)?$/);
    if (!m) return null;
    let v = m[2].trim();
    if (/^"(.*)"$/.test(v)) v = v.slice(1, -1); else if (/^'(.*)'$/.test(v)) v = v.slice(1, -1);
    else if (v === 'true' || v === 'false') v = v === 'true';
    return [m[1], v];
  };
  for (const line of String(txt).split(/\r?\n/)) {
    const h = line.match(/^\s*\[\[\s*([\w.-]+)\s*\]\]/);
    if (h) {
      if (h[1] === 'mods') { cur = {}; mods.push(cur); }
      else if (h[1].startsWith('dependencies.')) { cur = { owner: h[1].slice(13).toLowerCase() }; deps.push(cur); }
      else cur = null;
      continue;
    }
    if (/^\s*\[/.test(line)) { cur = null; continue; }
    if (!cur) continue;
    const kv = val(line);
    if (kv) cur[kv[0]] = kv[1];
  }
  return { mods, deps };
}

/** Reads one mod jar (or a buffer of one). Returns null for files that aren't mods. */
function readManifest(fileOrBuffer, AdmZip = require('adm-zip'), depth = 0) {
  let zip;
  try { zip = new AdmZip(fileOrBuffer); } catch { return { error: 'Not a readable jar (damaged or not a zip)' }; }
  const txt = (n) => { const e = zip.getEntry(n); return e ? zip.readAsText(e) : null; };
  const nestedOf = (paths) => {
    if (depth > 1) return [];
    const out = [];
    for (const p of paths) {
      const e = zip.getEntry(String(p).replace(/^\//, ''));
      if (!e || e.header.size > 64 * 1024 * 1024) continue;
      try { const m = readManifest(e.getData(), AdmZip, depth + 1); if (m && m.modId) out.push(m, ...(m.nested || [])); } catch {}
    }
    return out.map((m) => ({ modId: m.modId, version: m.version, provides: m.provides || [] }));
  };

  const fab = txt('fabric.mod.json');
  if (fab) {
    const j = safeJSON(fab);
    if (!j || !j.id) return { error: 'fabric.mod.json can’t be read' };
    return {
      loader: 'fabric', modId: String(j.id).toLowerCase(), name: j.name || j.id, version: j.version != null ? String(j.version) : null, style: 'fabric',
      depends: depList(j.depends), recommends: depList(j.recommends), breaks: depList(j.breaks).map((d) => ({ ...d, hard: true })).concat(depList(j.conflicts).map((d) => ({ ...d, hard: false }))),
      provides: (j.provides || []).map((p) => String(p).toLowerCase()), environment: j.environment || '*',
      nested: nestedOf((j.jars || []).map((x) => x && x.file).filter(Boolean)),
    };
  }
  const quilt = txt('quilt.mod.json');
  if (quilt) {
    const j = safeJSON(quilt)?.quilt_loader;
    if (!j || !j.id) return { error: 'quilt.mod.json can’t be read' };
    const qdeps = (arr) => (arr || []).map((d) => (typeof d === 'string' ? { id: d, range: '*' } : { id: d.id, range: d.versions ?? '*', optional: !!d.optional })).filter((d) => d.id).map((d) => ({ ...d, id: String(d.id).replace(/^.*:/, '').toLowerCase() }));
    return {
      loader: 'quilt', modId: String(j.id).toLowerCase(), name: j.metadata?.name || j.id, version: j.version != null ? String(j.version) : null, style: 'fabric',
      depends: qdeps(j.depends).filter((d) => !d.optional), recommends: qdeps(j.depends).filter((d) => d.optional), breaks: qdeps(j.breaks).map((d) => ({ ...d, hard: true })),
      provides: (j.provides || []).map((p) => String(typeof p === 'string' ? p : p.id).toLowerCase()),
      nested: nestedOf((j.jars || []).map((x) => (typeof x === 'string' ? x : x && x.file)).filter(Boolean)),
    };
  }
  const neo = txt('META-INF/neoforge.mods.toml'), forge = txt('META-INF/mods.toml');
  if (neo || forge) {
    const { mods, deps } = parseModsToml(neo || forge);
    if (!mods.length || !mods[0].modId) return { error: 'mods.toml has no mod id' };
    const jarVer = (() => { const mf = txt('META-INF/MANIFEST.MF') || ''; return (mf.match(/^Implementation-Version:\s*(.+)$/m) || [])[1]?.trim() || null; })();
    const verOf = (m) => (m.version && !/\$\{/.test(m.version) ? String(m.version) : jarVer);
    const main = mods[0], ids = new Set(mods.map((m) => String(m.modId).toLowerCase()));
    const kind = (d) => {
      const t = String(d.type || '').toLowerCase();
      if (t) return t; // required | optional | incompatible | discouraged
      return d.mandatory === false ? 'optional' : 'required';
    };
    const forMine = deps.filter((d) => ids.has(d.owner) && d.modId);
    const nestedJars = zip.getEntries().filter((e) => /^META-INF\/jarjar\/[^/]+\.jar$/i.test(e.entryName)).map((e) => e.entryName);
    return {
      loader: neo ? 'neoforge' : 'forge', modId: String(main.modId).toLowerCase(), name: main.displayName || main.modId, version: verOf(main), style: 'maven',
      depends: forMine.filter((d) => kind(d) === 'required').map((d) => ({ id: String(d.modId).toLowerCase(), range: d.versionRange || '*', side: d.side || 'BOTH' })),
      recommends: forMine.filter((d) => kind(d) === 'optional').map((d) => ({ id: String(d.modId).toLowerCase(), range: d.versionRange || '*' })),
      breaks: forMine.filter((d) => ['incompatible', 'discouraged'].includes(kind(d))).map((d) => ({ id: String(d.modId).toLowerCase(), range: d.versionRange || '*', hard: kind(d) === 'incompatible', reason: d.reason || '' })),
      provides: mods.slice(1).map((m) => String(m.modId).toLowerCase()),
      nested: nestedOf(nestedJars),
    };
  }
  const mcmod = txt('mcmod.info');
  if (mcmod) {
    const j = safeJSON(mcmod); const m = Array.isArray(j) ? j[0] : (j?.modList || [])[0];
    if (m?.modid) return { loader: 'forge', legacy: true, modId: String(m.modid).toLowerCase(), name: m.name || m.modid, version: m.version || null, style: 'maven', depends: [], recommends: [], breaks: [], provides: [], nested: [] };
  }
  return null; // a jar without mod metadata (a library or not a mod)
}

// ---------- the checks ----------

/**
 * @param mods  [{ file, enabled, manifest }] — manifest from readManifest (or null / { error })
 * @param env   { mc, loader: { type, version } }
 * @returns { findings: [...], counts, provided }
 */
function analyze(mods, env = {}) {
  const loader = env.loader?.type || 'vanilla';
  const findings = [];
  const add = (f) => findings.push(f);
  const active = mods.filter((m) => m.enabled !== false);
  // which mod ids exist (with their version), counting what each jar carries inside and "provides"
  const provided = new Map(); // id → [{ version, file, via }]
  const give = (id, version, file, via) => { if (!id) return; const k = String(id).toLowerCase(); (provided.get(k) || provided.set(k, []).get(k)).push({ version, file, via }); };
  for (const m of active) {
    const mf = m.manifest;
    if (!mf || mf.error) continue;
    give(mf.modId, mf.version, m.file, 'file');
    for (const p of mf.provides || []) give(p, mf.version, m.file, 'provides');
    for (const n of mf.nested || []) { give(n.modId, n.version, m.file, 'inside'); for (const p of n.provides || []) give(p, n.version, m.file, 'inside'); }
  }
  // Fabric API's old id
  if (provided.has('fabric-api') && !provided.has('fabric')) provided.set('fabric', provided.get('fabric-api'));
  const disabledBy = new Map();
  for (const m of mods.filter((x) => x.enabled === false)) if (m.manifest?.modId) disabledBy.set(m.manifest.modId, m.file);

  const platform = PLATFORM[loader] || new Set(['minecraft', 'java']);
  const platformVersion = (id) => {
    if (id === 'minecraft') return env.mc || null;
    if (id === 'java') return env.java ? String(env.java) : null;
    return env.loader?.version || null; // the loader itself
  };

  for (const m of active) {
    const mf = m.manifest;
    if (!mf) continue;
    if (mf.error) { add({ type: 'unreadable', severity: 'warning', file: m.file, title: `${m.file} can’t be read`, detail: mf.error, fix: { kind: 'disable', file: m.file } }); continue; }
    const who = { file: m.file, modId: mf.modId, name: mf.name };

    // made for another loader
    if (loader !== 'vanilla') {
      const ok = mf.loader === loader || (loader === 'quilt' && mf.loader === 'fabric');
      if (!ok) add({ type: 'wrong-loader', severity: 'error', ...who, title: `${mf.name} is a ${LOADER_NAMES[mf.loader] || mf.loader} mod`, detail: `This instance uses ${LOADER_NAMES[loader]}. The mod won’t load here.`, fix: { kind: 'disable', file: m.file } });
    } else {
      add({ type: 'wrong-loader', severity: 'error', ...who, title: `${mf.name} needs a mod loader`, detail: 'This is a Vanilla instance — mods only load with Fabric, Quilt, Forge or NeoForge.', fix: { kind: 'disable', file: m.file } });
      continue;
    }

    for (const d of mf.depends || []) {
      if (d.id === 'java' && !env.java) continue;
      if (platform.has(d.id) || ((loader === 'forge' || loader === 'neoforge') && ['forge', 'neoforge'].includes(d.id))) {
        if ((loader === 'forge' && d.id === 'neoforge') || (loader === 'neoforge' && d.id === 'forge' && mf.loader === 'forge')) continue; // reported as wrong loader
        const have = platformVersion(d.id);
        const ok = semver.satisfies(have, d.range, mf.style);
        if (ok === false) {
          const what = d.id === 'minecraft' ? 'Minecraft' : d.id === 'java' ? 'Java' : `${LOADER_NAMES[loader]} loader`;
          add({ type: d.id === 'minecraft' ? 'wrong-minecraft' : 'wrong-loader-version', severity: 'error', ...who, title: `${mf.name} needs ${what} ${semver.describe(d.range, mf.style)}`, detail: `This instance has ${what} ${have}.`, fix: d.id === 'minecraft' ? { kind: 'update', file: m.file } : { kind: 'loader', need: d.range } });
        }
        continue;
      }
      const have = provided.get(d.id);
      if (!have) {
        const off = disabledBy.get(d.id);
        add({ type: 'missing-dependency', severity: 'error', ...who, dep: d.id, range: d.range, title: `${mf.name} needs “${d.id}”`, detail: off ? `${off} provides it but is turned off.` : `No installed mod provides “${d.id}” (${semver.describe(d.range, mf.style)}).`, fix: off ? { kind: 'enable', file: off } : { kind: 'install', id: d.id } });
        continue;
      }
      const results = have.map((h) => semver.satisfies(h.version, d.range, mf.style));
      if (!results.includes(true) && results.includes(false)) {
        add({ type: 'dependency-version', severity: 'error', ...who, dep: d.id, range: d.range, title: `${mf.name} needs ${d.id} ${semver.describe(d.range, mf.style)}`, detail: `Installed: ${have.map((h) => `${h.version || '?'} (${h.file})`).join(', ')}.`, fix: { kind: 'update', file: have[0].file, id: d.id } });
      }
    }

    for (const b of mf.breaks || []) {
      const have = provided.get(b.id);
      if (!have) continue;
      // another copy of this same mod "providing" the id isn't a conflict to report: the duplicate finding covers it
      const sameMod = new Set(active.filter((x) => x.manifest?.modId === mf.modId).map((x) => x.file));
      const hits = have.filter((h) => !sameMod.has(h.file) && semver.satisfies(h.version, b.range, mf.style) !== false);
      if (!hits.length) continue;
      add({ type: 'conflict', severity: b.hard ? 'error' : 'warning', ...who, other: b.id, otherFile: hits[0].file, title: `${mf.name} ${b.hard ? 'can’t run with' : 'may not work well with'} ${b.id}`, detail: `${b.reason ? b.reason + ' ' : ''}The mod itself says so${b.range && b.range !== '*' ? ` (for ${b.id} ${semver.describe(b.range, mf.style)})` : ''}. ${hits[0].file} has it.`, fix: { kind: 'choose', files: [m.file, hits[0].file] } });
    }
  }

  // two files giving the same mod (only real files, not jar-in-jar copies — loaders pick the newest of those)
  const byId = new Map();
  for (const m of active) { const id = m.manifest?.modId; if (id) (byId.get(id) || byId.set(id, []).get(id)).push(m); }
  for (const [id, list] of byId) {
    if (list.length < 2) continue;
    // keep the newest copy made for this Minecraft version (a newer copy for another version would just fail)
    const fits = (m) => { const d = (m.manifest.depends || []).find((x) => x.id === 'minecraft'); return !d || semver.satisfies(env.mc, d.range, m.manifest.style) !== false ? 1 : 0; };
    const sorted = [...list].sort((a, b) => (fits(b) - fits(a)) || (semver.compare(b.manifest.version, a.manifest.version) ?? 0) || (b.mtime || 0) - (a.mtime || 0));
    add({ type: 'duplicate', severity: 'error', modId: id, name: list[0].manifest.name, files: list.map((m) => m.file), title: `${list[0].manifest.name} is installed ${list.length} times`, detail: list.map((m) => `${m.file} (${m.manifest.version || '?'})`).join(', '), fix: { kind: 'disable-older', keep: sorted[0].file, files: sorted.slice(1).map((m) => m.file) } });
  }

  // two copies of one mod report the same thing twice: once is enough (the duplicate itself is its own finding)
  const seenF = new Set();
  for (let i = findings.length - 1; i >= 0; i--) {
    const f = findings[i];
    const k = f.type === 'duplicate' || f.type === 'unreadable' ? f.type + '|' + (f.modId || f.file) : `${f.type}|${f.modId}|${f.dep || ''}|${f.other || ''}`;
    if (seenF.has(k)) findings.splice(i, 1); else seenF.add(k);
  }
  const order = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    findings,
    counts: {
      mods: mods.length, enabled: active.length, readable: active.filter((m) => m.manifest && !m.manifest.error).length,
      notMods: active.filter((m) => !m.manifest).length,
      errors: findings.filter((f) => f.severity === 'error').length, warnings: findings.filter((f) => f.severity === 'warning').length,
    },
  };
}

/** 0–100 and a word for it. Outdated mods count a little, problems a lot. */
function health({ findings = [], outdated = null }) {
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  let score = 100 - Math.min(75, errors * 20) - Math.min(20, warnings * 5) - Math.min(10, (outdated || 0) * 1);
  score = Math.max(0, Math.round(score));
  const grade = errors ? (score < 40 ? 'broken' : 'needs-attention') : warnings || outdated ? 'good' : 'healthy';
  const label = { broken: 'Won’t start', 'needs-attention': 'Needs attention', good: 'Good', healthy: 'Healthy' }[grade];
  return { score, grade, label };
}

/** What to do, in plain words, most important first. */
function recommendations(findings, { outdated = 0 } = {}) {
  const out = [];
  const by = (t) => findings.filter((f) => f.type === t);
  const missing = by('missing-dependency');
  if (missing.length) out.push({ priority: 1, text: `Install ${[...new Set(missing.map((f) => f.dep))].slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''} — ${missing.length === 1 ? 'a mod needs it' : 'mods need them'} to start.` });
  if (by('duplicate').length) out.push({ priority: 1, text: 'Turn off the older copy of each duplicate mod (Astra keeps the newest).' });
  if (by('wrong-loader').length) out.push({ priority: 1, text: 'Turn off mods made for another loader, or move them to an instance with that loader.' });
  if (by('wrong-minecraft').length) out.push({ priority: 2, text: 'Some mods are for another Minecraft version — check for updates, or turn them off.' });
  if (by('dependency-version').length) out.push({ priority: 2, text: 'Update the mods other mods need a newer version of.' });
  if (by('wrong-loader-version').length) out.push({ priority: 2, text: 'Update the loader: Instance → Settings → Loader version.' });
  if (by('conflict').some((f) => f.severity === 'error')) out.push({ priority: 2, text: 'Two mods say they can’t run together — keep only one of them.' });
  if (by('conflict').some((f) => f.severity === 'warning')) out.push({ priority: 3, text: 'Some mods may misbehave together. If you see glitches, try without one of them.' });
  if (outdated) out.push({ priority: 3, text: `${outdated} mod${outdated === 1 ? ' has' : 's have'} an update on Modrinth.` });
  return out.sort((a, b) => a.priority - b.priority);
}

/** Differences between two mod lists (by mod id; files without an id by file name). */
function compare(a, b) {
  const key = (m) => m.manifest?.modId || 'file:' + String(m.file).replace(/\.disabled$/, '').toLowerCase();
  const mapOf = (l) => { // with duplicates, the newest copy stands for the mod
    const map = new Map();
    for (const m of l.filter((x) => x.enabled !== false)) { const k = key(m), have = map.get(k); if (!have || semver.compare(m.manifest?.version, have.manifest?.version) === 1) map.set(k, m); }
    return map;
  };
  const A = mapOf(a), B = mapOf(b);
  const row = (m) => ({ id: key(m), name: m.manifest?.name || m.file, version: m.manifest?.version || null, file: m.file });
  const onlyA = [], onlyB = [], different = [], same = [];
  for (const [k, m] of A) {
    if (!B.has(k)) { onlyA.push(row(m)); continue; }
    const n = B.get(k);
    const va = m.manifest?.version || null, vb = n.manifest?.version || null;
    if (va !== vb) different.push({ id: k, name: m.manifest?.name || m.file, a: va, b: vb, newer: semver.compare(va, vb) === 1 ? 'a' : semver.compare(va, vb) === -1 ? 'b' : null });
    else same.push(row(m));
  }
  for (const [k, m] of B) if (!A.has(k)) onlyB.push(row(m));
  const byName = (x, y) => String(x.name).localeCompare(String(y.name));
  return { onlyA: onlyA.sort(byName), onlyB: onlyB.sort(byName), different: different.sort(byName), same: same.length };
}

// ---------- instances (Electron side) ----------

const cache = new Map(); // path:size:mtime → manifest
function manifestOf(file) {
  let st; try { st = fs.statSync(file); } catch { return null; }
  const k = `${file}:${st.size}:${st.mtimeMs}`;
  if (cache.has(k)) return cache.get(k);
  const m = readManifest(file);
  cache.set(k, m);
  if (cache.size > 4000) cache.delete(cache.keys().next().value);
  return m;
}
/** The instance's mod jars with their manifests. Lets other work run between jars, so a 300-mod pack read for the
 *  first time doesn't freeze Astra (later checks come from the cache). */
async function modsOf(instanceId) {
  // the folder is listed here (not with instances.listContent, which reads every jar's details in one go)
  const dir = path.join(require('../instances').get(instanceId).gameDir, 'mods');
  let names = [];
  try { names = (await fs.promises.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && /\.jar(\.disabled)?$/i.test(e.name)).map((e) => e.name).sort(); } catch {}
  const out = [];
  for (const file of names) {
    const full = path.join(dir, file);
    let mtime = 0; try { mtime = (await fs.promises.stat(full)).mtimeMs; } catch { continue; }
    out.push({ file, enabled: !/\.disabled$/i.test(file), mtime, manifest: manifestOf(full) });
    await new Promise((r) => setImmediate(r)); // one jar at a time, then let the rest of Astra run
  }
  return out;
}
function envOf(inst) { return { mc: inst.versionId, loader: { type: inst.loader?.type || 'vanilla', version: inst.loader?.version || null } }; }

async function check(instanceId) {
  const inst = require('../instances').get(instanceId);
  const mods = await modsOf(instanceId);
  const r = analyze(mods, envOf(inst));
  return { instance: { id: inst.id, name: inst.name, mc: inst.versionId, loader: inst.loader }, ...r, health: health(r), recommendations: recommendations(r.findings), checkedAt: Date.now() };
}
/** Same, plus outdated mods from Modrinth (needs the internet). */
async function checkWithUpdates(instanceId) {
  const base = await check(instanceId);
  let updates = [], updatesError = null;
  try { updates = (await require('../modrinth').checkUpdates(instanceId, 'mods')).filter((u) => u.latest); }
  catch (e) { updatesError = `Couldn’t check Modrinth: ${e.message}`; }
  return { ...base, updates, updatesError, health: health({ findings: base.findings, outdated: updates.length }), recommendations: recommendations(base.findings, { outdated: updates.length }) };
}
async function compareInstances(a, b) {
  const instances = require('../instances');
  const A = instances.get(a), B = instances.get(b);
  return { a: { id: A.id, name: A.name, mc: A.versionId, loader: A.loader }, b: { id: B.id, name: B.name, mc: B.versionId, loader: B.loader }, ...compare(await modsOf(a), await modsOf(b)) };
}
/** Modrinth projects that may be a missing mod id, for the player to pick from (nothing is installed here). */
async function findMissing(instanceId, modId) {
  const inst = require('../instances').get(instanceId);
  const modrinth = require('../modrinth');
  const out = [];
  try { const p = await modrinth.project(modId); if (p && p.project_type === 'mod') out.push({ id: p.id, slug: p.slug, title: p.title, description: p.description, icon: p.icon_url, exact: true }); } catch {}
  try {
    const r = await modrinth.search({ query: modId.replace(/[_-]/g, ' '), type: 'mod', gameVersion: inst.versionId, loader: inst.loader?.type, limit: 5 });
    for (const h of r.hits || []) if (!out.some((o) => o.id === h.project_id)) out.push({ id: h.project_id, slug: h.slug, title: h.title, description: h.description, icon: h.icon_url, exact: h.slug === modId });
  } catch (e) { if (!out.length) throw new Error(`Couldn’t search Modrinth: ${e.message}`); }
  return out;
}

module.exports = { readManifest, parseModsToml, analyze, health, recommendations, compare, check, checkWithUpdates, compareInstances, findMissing, modsOf };
