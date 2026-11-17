// Discover keeps loading when you scroll: page n asks each provider/type for its own n-th slice, and says when there's more.
const test = require('node:test');
const assert = require('node:assert');
const { search } = require('../src/eco/discovery');

function fakeDeps(totals, { cf = false } = {}) {
  const asked = [];
  const make = (provider) => async ({ type, offset, limit }) => {
    asked.push({ provider, type, offset, limit });
    const total = totals[`${provider}:${type}`] ?? 0;
    const n = Math.max(0, Math.min(limit, total - offset));
    return { total_hits: total, hits: Array.from({ length: n }, (_, i) => ({ project_id: `${provider}-${type}-${offset + i}`, title: `${provider} ${type} ${offset + i}`, project_type: type })) };
  };
  return { asked, deps: { modrinth: { search: make('modrinth') }, curseforge: { search: make('curseforge'), available: () => cf } } };
}

test('page 0, 1, 2 ask for the next slice each time and stop when the provider runs out', async () => {
  const { asked, deps } = fakeDeps({ 'modrinth:mod': 60 });
  const p0 = await search({ kind: 'mod', limit: 24, page: 0 }, deps);
  const p1 = await search({ kind: 'mod', limit: 24, page: 1 }, deps);
  const p2 = await search({ kind: 'mod', limit: 24, page: 2 }, deps);
  assert.deepStrictEqual(asked.map((a) => a.offset), [0, 24, 48]);
  assert.strictEqual(p0.results.length, 24); assert.strictEqual(p0.more, true);
  assert.strictEqual(p1.more, true);
  assert.strictEqual(p2.results.length, 12); assert.strictEqual(p2.more, false);
});

test('a kind made of two types pages each type by its own slice (no skipped results)', async () => {
  const { asked, deps } = fakeDeps({ 'modrinth:datapack': 100, 'modrinth:plugin': 100 });
  await search({ kind: 'community', limit: 24, page: 1 }, deps);
  assert.deepStrictEqual(asked.map((a) => [a.type, a.offset, a.limit]).sort(), [['datapack', 12, 12], ['plugin', 12, 12]]);
});

test('more stays on while any provider still has results', async () => {
  const { deps } = fakeDeps({ 'modrinth:mod': 10, 'curseforge:mod': 500 }, { cf: true });
  const r = await search({ kind: 'mod', limit: 24, page: 0 }, deps);
  assert.strictEqual(r.more, true);
});

test('old callers that pass offset still work', async () => {
  const { asked, deps } = fakeDeps({ 'modrinth:mod': 100 });
  await search({ kind: 'mod', limit: 24, offset: 48 }, deps);
  assert.strictEqual(asked[0].offset, 48);
});
