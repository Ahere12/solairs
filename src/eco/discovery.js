// Astra Discover — one search across every content provider Astra can really use, for every kind of content:
// mods, modpacks, resource packs, shaders, maps and community content (data packs, plugins, customization).
//
// Providers: Modrinth (always) and CurseForge (when a CurseForge API key is set in Settings → Integrations).
// A provider that doesn't have a kind of content (Modrinth has no maps) or isn't set up is listed with the reason,
// never filled with made-up results. Installing goes through the provider's own installer (src/modrinth.js,
// src/curseforge.js), so dependencies, records and updates work as they do in Browse.

const KINDS = {
  mod: { name: 'Mods', modrinth: 'mod', curseforge: 'mod' },
  modpack: { name: 'Modpacks', modrinth: 'modpack', curseforge: 'modpack' },
  resourcepack: { name: 'Resource packs', modrinth: 'resourcepack', curseforge: 'resourcepack' },
  shader: { name: 'Shaders', modrinth: 'shader', curseforge: 'shader' },
  map: { name: 'Maps', modrinth: null, curseforge: 'world' },
  community: { name: 'Community content', modrinth: ['datapack', 'plugin'], curseforge: ['datapack', 'customization'] },
};

/** Puts each provider's results in one shape. */
function normalize(provider, h) {
  if (provider === 'modrinth') {
    return { provider, id: h.project_id, slug: h.slug, title: h.title, description: h.description || '', author: h.author || '', icon: h.icon_url || null, downloads: h.downloads || 0, follows: h.follows || 0, updated: h.date_modified || null, type: h.project_type, categories: h.categories || [], versions: h.versions || [], url: `https://modrinth.com/${h.project_type}/${h.slug}` };
  }
  return { provider, id: String(h.project_id), slug: h.slug, title: h.title, description: h.description || '', author: h.author || '', icon: h.icon_url || null, downloads: h.downloads || 0, follows: h.follows || 0, updated: h.date_modified || null, type: h.project_type === 'world' ? 'map' : h.project_type, categories: h.categories || [], versions: [], url: h.url || null };
}

/** Same project on both providers (same name, roughly): keep one row that lists both. */
function mergeResults(lists, { sort = 'relevance' } = {}) {
  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const rows = new Map();
  // interleave so the first page shows both providers' best results
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) {
    const r = l[i]; if (!r) continue;
    const k = norm(r.title) + '|' + r.type;
    const have = rows.get(k);
    if (have) { have.alsoOn = [...(have.alsoOn || []), { provider: r.provider, id: r.id, url: r.url }]; have.downloads = Math.max(have.downloads, r.downloads); }
    else rows.set(k, { ...r });
  }
  const out = [...rows.values()];
  if (sort === 'downloads') out.sort((a, b) => b.downloads - a.downloads);
  else if (sort === 'updated') out.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
  return out;
}

/** Which providers can answer for a kind of content, and why not. */
function providers(kind, { curseforgeKey = false } = {}) {
  const k = KINDS[kind];
  if (!k) throw new Error(`Unknown content kind “${kind}”`);
  return [
    { id: 'modrinth', name: 'Modrinth', ok: !!k.modrinth, why: k.modrinth ? '' : `Modrinth doesn’t host ${k.name.toLowerCase()}.` },
    { id: 'curseforge', name: 'CurseForge', ok: !!k.curseforge && curseforgeKey, why: !k.curseforge ? `CurseForge doesn’t host ${k.name.toLowerCase()}.` : curseforgeKey ? '' : 'not connected (Settings → Integrations)' },
  ];
}

/**
 * deps = { modrinth: { search }, curseforge: { search, available } } — passed in for tests.
 * Each provider is asked in parallel; one that fails is reported with its error, the others still show.
 */
async function search({ kind = 'mod', query = '', gameVersion, loader, sort = 'relevance', limit = 20, offset = 0, page = null } = {}, deps) {
  // page n asks every provider/type for its own n-th slice, so scrolling on keeps going until every provider runs out
  if (page == null) page = Math.floor(offset / Math.max(1, limit));
  const k = KINDS[kind];
  const prov = providers(kind, { curseforgeKey: deps.curseforge.available() });
  const status = [];
  const asks = [];
  let more = false;
  const mrSort = { relevance: 'relevance', downloads: 'downloads', updated: 'updated', newest: 'newest' }[sort] || 'relevance';
  for (const p of prov) {
    if (!p.ok) { status.push({ provider: p.id, name: p.name, ok: false, why: p.why }); continue; }
    const types = [].concat(k[p.id]);
    asks.push(Promise.all(types.map(async (type) => {
      const per = Math.max(5, Math.ceil(limit / types.length)), off = page * per;
      if (p.id === 'modrinth') {
        const r = await deps.modrinth.search({ query, type, gameVersion: kind === 'modpack' ? undefined : gameVersion, loader: kind === 'mod' ? loader : undefined, sort: mrSort, offset: off, limit: per });
        if ((r.total_hits || 0) > off + per) more = true;
        return { hits: (r.hits || []).map((h) => normalize('modrinth', h)), total: r.total_hits || 0 };
      }
      const r = await deps.curseforge.search({ query, type, gameVersion: kind === 'mod' || kind === 'resourcepack' || kind === 'shader' ? gameVersion : undefined, loader: kind === 'mod' ? loader : undefined, sort: sort === 'updated' ? 'updated' : sort, offset: off, limit: per });
      if ((r.total_hits || 0) > off + per && off + 2 * per <= 10000) more = true; // CurseForge stops at 10,000
      return { hits: (r.hits || []).map((h) => normalize('curseforge', h)), total: r.total_hits || 0 };
    })).then((parts) => {
      status.push({ provider: p.id, name: p.name, ok: true, total: parts.reduce((t, x) => t + x.total, 0) });
      return parts.flatMap((x) => x.hits);
    }).catch((e) => { status.push({ provider: p.id, name: p.name, ok: false, failed: true, why: friendly(p.name, e) }); return []; }));
  }
  const lists = await Promise.all(asks);
  return { kind, kindName: k.name, page, more, results: mergeResults(lists, { sort }), providers: status.sort((a, b) => a.provider.localeCompare(b.provider)) };
}

/** A provider error in words a player understands. */
function friendly(name, e) {
  const m = String(e?.message || e);
  if (/HTTP 429/.test(m)) return `${name} asked Astra to slow down — try again in a minute.`;
  if (/HTTP 40[13]/.test(m)) return `${name} refused the request${name === 'CurseForge' ? ' — check the API key in Settings → Integrations' : ''}.`;
  if (/HTTP 5\d\d/.test(m)) return `${name} is having problems right now (${m.match(/HTTP \d+/)[0]}).`;
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|timeout|aborted/i.test(m)) return `Couldn’t reach ${name} — check your internet connection.`;
  return `Couldn’t reach ${name}: ${m.slice(0, 120)}`;
}

// ---------- Astra ----------
function deps() {
  return { modrinth: require('../modrinth'), curseforge: require('../curseforge') };
}
// The same search within two minutes (switching tabs, typing back) is answered from memory. Failed searches aren't kept.
const cache = new Map();
async function run(q = {}) {
  const k = JSON.stringify([q.kind, q.query, q.sort, q.gameVersion, q.loader, q.limit, q.offset, q.page, require('../curseforge').available()]);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < 120000) return hit.value;
  const value = await search(q, deps());
  if (!value.providers.some((p) => p.failed)) { cache.set(k, { at: Date.now(), value }); if (cache.size > 60) cache.delete(cache.keys().next().value); }
  return value;
}
/** Installs one result into an instance with that provider's installer. Modpacks become a new instance. */
async function install({ provider, id, kind, instanceId, world }) {
  if (provider === 'modrinth') {
    if (kind === 'modpack') { const versions = await require('../modrinth').versions(id); if (!versions[0]) throw new Error('This modpack has no versions.'); return require('../modrinth').installModpack({ versionId: versions[0].id }); }
    const pt = { mod: 'mod', resourcepack: 'resourcepack', shader: 'shader' }[kind];
    const proj = !pt ? await require('../modrinth').project(id) : null;
    const type = pt || proj.project_type;
    if (type === 'plugin') throw new Error('This is a server plugin — add it to a server you host (Hosting → a server → Content).');
    return require('../modrinth').install(instanceId, { projectId: id, projectType: type, world });
  }
  if (provider === 'curseforge') {
    if (kind === 'modpack') return require('../curseforge').installModpack({ projectId: id });
    if (kind === 'map') return require('../curseforge').installMap(instanceId, { projectId: id });
    return require('../curseforge').install(instanceId, { projectId: id, world });
  }
  throw new Error('Unknown provider');
}
function kinds() { return Object.entries(KINDS).map(([id, k]) => ({ id, name: k.name, providers: providers(id, { curseforgeKey: require('../curseforge').available() }) })); }

module.exports = { KINDS, normalize, mergeResults, providers, search, run, install, kinds };
