import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const module = await import('../lib/store.mjs').catch(() => ({}));
const repo = { fullName: 'Owner/Repo', name: 'Repo', owner: 'Owner', description: '', url: 'https://github.com/Owner/Repo', stars: 100, forks: 2, language: null, topics: [], createdAt: '2020-01-01T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z', pushedAt: null, archived: false, license: null, ownerAvatar: '' };
async function setup(t, options = {}) {
  assert.equal(typeof module.openStore, 'function', 'Store implementation is required');
  const dataDir = await fs.mkdtemp(join(tmpdir(), 'starscope-store-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  return { dataDir, store: await module.openStore({ dataDir, now: () => Date.parse('2026-10-11T00:00:00Z'), ...options }) };
}
const disclosure = { repo: 'Owner/Repo', amount: 1000, currency: 'USD', period: 'monthly', date: '2026-10-10', sourceUrl: 'https://example.com/revenue', notes: 'Public disclosure' };

test('first monitor snapshot has unknown growth and survives a process restart', async (t) => {
  const { store, dataDir } = await setup(t);
  const item = await store.addMonitor(repo);
  assert.deepEqual(item.growth, { day: null, week: null, month: null });
  const reopened = await module.openStore({ dataDir });
  assert.equal(reopened.monitors()[0].fullName, 'Owner/Repo');
  assert.equal(reopened.history('owner/repo').length, 1);
  assert.equal(reopened.history('owner/repo')[0].stars, 100);
});

test('case-insensitive duplicate monitors are rejected and a thirtieth is the last allowed', async (t) => {
  const { store } = await setup(t);
  await store.addMonitor(repo);
  await assert.rejects(() => store.addMonitor({ ...repo, fullName: 'owner/repo' }), { code: 'MONITOR_EXISTS' });
  for (let i = 1; i < 30; i++) await store.addMonitor({ ...repo, fullName: `Owner/Repo${i}` });
  await assert.rejects(() => store.addMonitor({ ...repo, fullName: 'Owner/Repo30' }), { code: 'MONITOR_LIMIT' });
  assert.equal(store.monitors().length, 30);
});

test('growth uses covered day/week/month baselines and preserves negative net stars', async (t) => {
  let now = Date.parse('2026-09-11T00:00:00Z');
  const { store } = await setup(t, { now: () => now });
  await store.addMonitor({ ...repo, stars: 20 });
  now = Date.parse('2026-10-04T00:00:00Z');
  await store.recordRefresh([{ ...repo, stars: 80 }]);
  now = Date.parse('2026-10-10T00:00:00Z');
  await store.recordRefresh([{ ...repo, stars: 110 }]);
  now = Date.parse('2026-10-11T00:00:00Z');
  await store.recordRefresh([repo]);
  assert.deepEqual(store.monitors()[0].growth, { day: -10, week: 20, month: 80 });
});

test('old snapshots across offline gaps do not pretend to be daily or weekly growth', async (t) => {
  let now = Date.parse('2026-09-01T00:00:00Z');
  const { store } = await setup(t, { now: () => now });
  await store.addMonitor(repo);
  now = Date.parse('2026-10-11T00:00:00Z');
  await store.recordRefresh([{ ...repo, stars: 150 }]);
  assert.deepEqual(store.monitors()[0].growth, { day: null, week: null, month: null });
});

test('refreshing only successful repos retains failed project history', async (t) => {
  const { store } = await setup(t);
  await store.addMonitor(repo);
  await store.addMonitor({ ...repo, fullName: 'Another/Project', stars: 10 });
  await store.recordRefresh([{ ...repo, stars: 120 }]);
  assert.equal(store.monitors().find((item) => item.fullName === 'Another/Project').stars, 10);
  assert.equal(store.history('Another/Project').length, 1);
});

test('income validates dates, currency, period, source and amount without inventing records', async (t) => {
  const { store } = await setup(t);
  assert.deepEqual(store.revenues(), []);
  const item = await store.addRevenue(disclosure);
  assert.equal(item.amount, 1000);
  assert.equal(item.currency, 'USD');
  assert.equal(item.period, 'monthly');
  assert.ok(item.id);
  assert.equal(item.createdAt, '2026-10-11T00:00:00.000Z');
  for (const update of [{ amount: 0 }, { amount: -1 }, { amount: '1000' }, { amount: Infinity }, { currency: 'BTC' }, { period: 'weekly' }, { date: '2026-02-30' }, { date: '2026-10-12' }, { sourceUrl: 'javascript:alert(1)' }, { sourceUrl: 'https://user:pass@example.com/' }, { sourceUrl: 'https://example.com/\n' }, { repo: '../../secret' }]) {
    await assert.rejects(() => store.addRevenue({ ...disclosure, ...update }), { code: 'INVALID_REVENUE' });
  }
});

test('duplicate disclosures are rejected while distinct currencies and periods stay separate', async (t) => {
  const { store } = await setup(t);
  await store.addRevenue(disclosure);
  await assert.rejects(() => store.addRevenue({ ...disclosure, repo: 'owner/repo', amount: 2000 }), { code: 'REVENUE_EXISTS' });
  await store.addRevenue({ ...disclosure, currency: 'EUR' });
  await store.addRevenue({ ...disclosure, period: 'yearly' });
  assert.equal(store.revenues().length, 3);
  assert.deepEqual(store.revenues().map((item) => [item.currency, item.period]).sort(), [['EUR', 'monthly'], ['USD', 'monthly'], ['USD', 'yearly']]);
});

test('concurrent writes persist whole JSON and failed atomic replacement leaves the previous state', async (t) => {
  let failRename = false;
  const fsImpl = { ...fs, rename: async (...args) => { if (failRename) throw new Error('disk write failed'); return fs.rename(...args); } };
  const { store, dataDir } = await setup(t, { fsImpl });
  await Promise.all(Array.from({ length: 5 }, (_, i) => store.addRevenue({ ...disclosure, repo: `Owner/Repo${i}` })));
  const before = await fs.readFile(join(dataDir, 'state.json'), 'utf8');
  assert.equal(JSON.parse(before).revenues.length, 5);
  failRename = true;
  await assert.rejects(() => store.addRevenue({ ...disclosure, repo: 'Owner/Rejected' }));
  assert.equal(store.revenues().length, 5);
  assert.equal(await fs.readFile(join(dataDir, 'state.json'), 'utf8'), before);
  assert.deepEqual((await fs.readdir(dataDir)).filter((name) => name.includes('.tmp')), []);
});

test('corrupt persistence refuses startup instead of overwriting existing user data', async (t) => {
  const { dataDir } = await setup(t);
  await fs.writeFile(join(dataDir, 'state.json'), '{broken');
  await assert.rejects(() => module.openStore({ dataDir }), { code: 'INVALID_DATA' });
  assert.equal(await fs.readFile(join(dataDir, 'state.json'), 'utf8'), '{broken');
});

test('valid JSON with malformed persisted monitor records refuses startup', async (t) => {
  const { dataDir } = await setup(t);
  const raw = JSON.stringify({ version: 1, monitors: [{ repo: {} }], history: {}, revenues: [], rankings: {}, lastRefreshAt: null });
  await fs.writeFile(join(dataDir, 'state.json'), raw);
  await assert.rejects(() => module.openStore({ dataDir }), { code: 'INVALID_DATA' });
  assert.equal(await fs.readFile(join(dataDir, 'state.json'), 'utf8'), raw);
});

test('Shanghai calendar date accepts local today before UTC midnight and rejects local tomorrow', async (t) => {
  const { store } = await setup(t, { now: () => Date.parse('2026-10-10T16:30:00Z') });
  const item = await store.addRevenue({ ...disclosure, date: '2026-10-11' });
  assert.equal(item.date, '2026-10-11');
  await assert.rejects(() => store.addRevenue({ ...disclosure, date: '2026-10-12' }), { code: 'INVALID_REVENUE' });
});

test('failed refresh attempt preserves per-project acquisition time and errors across a restart', async (t) => {
  let now = Date.parse('2026-10-11T00:00:00Z');
  const { store, dataDir } = await setup(t, { now: () => now });
  await store.addMonitor(repo);
  assert.equal(store.monitors()[0].fetchedAt, '2026-10-11T00:00:00.000Z');
  now = Date.parse('2026-10-11T01:00:00Z');
  await store.recordRefresh([], [{ repo: 'Owner/Repo', code: 'GITHUB_UNAVAILABLE', message: 'GitHub 暂时无法访问。' }]);
  const reopened = await module.openStore({ dataDir, now: () => now });
  assert.equal(reopened.monitors()[0].fetchedAt, '2026-10-11T00:00:00.000Z');
  assert.equal(reopened.lastRefreshAt(), '2026-10-11T01:00:00.000Z');
  assert.deepEqual(reopened.refreshErrors(), [{ repo: 'Owner/Repo', code: 'GITHUB_UNAVAILABLE', message: 'GitHub 暂时无法访问。' }]);
  await reopened.recordRefresh([{ ...repo, stars: 120 }], []);
  assert.equal(reopened.monitors()[0].fetchedAt, '2026-10-11T01:00:00.000Z');
  assert.deepEqual(reopened.refreshErrors(), []);
});

test('removing a monitor stops collection while retaining its real snapshots', async (t) => {
  const { store } = await setup(t);
  await store.addMonitor(repo);
  await store.removeMonitor('owner/repo');
  assert.deepEqual(store.monitors(), []);
  assert.deepEqual(store.history('owner/repo'), [{ at: '2026-10-11T00:00:00.000Z', stars: 100, forks: 2 }]);
  await store.recordRefresh([{ ...repo, stars: 120 }]);
  assert.deepEqual(store.history('owner/repo'), [{ at: '2026-10-11T00:00:00.000Z', stars: 100, forks: 2 }]);
});

test('batch refresh retains each successful repository acquisition time', async (t) => {
  let now = Date.parse('2026-10-11T00:00:00Z');
  const { store } = await setup(t, { now: () => now });
  await store.addMonitor(repo);
  await store.addMonitor({ ...repo, fullName: 'Another/Project', stars: 10 });
  now = Date.parse('2026-10-11T02:00:00Z');
  await store.recordRefresh([{ ...repo, stars: 120 }, { ...repo, fullName: 'Another/Project', stars: 30 }], [], {
    'owner/repo': '2026-10-11T01:00:00.000Z', 'another/project': '2026-10-11T01:10:00.000Z',
  });
  assert.equal(store.monitors().find((item) => item.fullName === 'Owner/Repo').fetchedAt, '2026-10-11T01:00:00.000Z');
  assert.equal(store.monitors().find((item) => item.fullName === 'Another/Project').fetchedAt, '2026-10-11T01:10:00.000Z');
  assert.equal(store.history('owner/repo').at(-1).at, '2026-10-11T01:00:00.000Z');
  assert.equal(store.lastRefreshAt(), '2026-10-11T02:00:00.000Z');
});

test('rename collision merges history without duplicating or regressing the canonical monitor', async (t) => {
  let now = Date.parse('2026-10-11T00:00:00Z');
  const { store } = await setup(t, { now: () => now });
  await store.addMonitor({ ...repo, fullName: 'Owner/Old', stars: 100 });
  now = Date.parse('2026-10-11T02:00:00Z');
  await store.addMonitor({ ...repo, fullName: 'Owner/New', stars: 150 });
  const old = store.refreshTargets?.().find((item) => item.fullName === 'Owner/Old');
  now = Date.parse('2026-10-11T03:00:00Z');
  await store.recordRefresh([{ item: { ...repo, fullName: 'Owner/New', stars: 110 }, requestedFullName: 'Owner/Old',
    generation: old?.generation, fetchedAt: '2026-10-11T01:00:00.000Z' }]);
  assert.equal(store.monitors().length, 1);
  assert.equal(store.monitors()[0].fullName, 'Owner/New');
  assert.equal(store.monitors()[0].stars, 150);
  assert.equal(store.monitors()[0].fetchedAt, '2026-10-11T02:00:00.000Z');
  assert.deepEqual(store.history('Owner/New').map((item) => item.stars), [100, 110, 150]);
  assert.deepEqual(store.history('Owner/Old'), []);
});

test('an acquisition older than a current snapshot cannot move repository data or fetchedAt backwards', async (t) => {
  let now = Date.parse('2026-10-11T02:00:00Z');
  const { store } = await setup(t, { now: () => now });
  await store.addMonitor({ ...repo, stars: 150 });
  const target = store.refreshTargets?.()[0];
  now = Date.parse('2026-10-11T03:00:00Z');
  await store.recordRefresh([{ item: { ...repo, stars: 110 }, requestedFullName: 'Owner/Repo', generation: target?.generation,
    fetchedAt: '2026-10-11T01:00:00.000Z' }]);
  assert.equal(store.monitors()[0].stars, 150);
  assert.equal(store.monitors()[0].fetchedAt, '2026-10-11T02:00:00.000Z');
  assert.deepEqual(store.history('Owner/Repo').map((item) => item.stars), [150]);
});

test('an alias collision cannot overwrite a re-added canonical monitor or its history at the same timestamp', async (t) => {
  const { store } = await setup(t);
  await store.addMonitor({ ...repo, fullName: 'Owner/Old', stars: 100 });
  await store.addMonitor({ ...repo, fullName: 'Owner/Canonical', stars: 150 });
  const targets = store.refreshTargets();
  const old = targets.find((item) => item.fullName === 'Owner/Old');
  const canonical = targets.find((item) => item.fullName === 'Owner/Canonical');
  await store.removeMonitor('Owner/Canonical');
  await store.addMonitor({ ...repo, fullName: 'Owner/Canonical', stars: 160 });
  await store.recordRefresh([
    { item: { ...repo, fullName: 'Owner/Canonical', stars: 110 }, requestedFullName: 'Owner/Old', generation: old.generation, fetchedAt: '2026-10-11T00:00:00.000Z' },
    { item: { ...repo, fullName: 'Owner/Canonical', stars: 120 }, requestedFullName: 'Owner/Canonical', generation: canonical.generation, fetchedAt: '2026-10-11T00:00:00.000Z' },
  ]);
  assert.equal(store.monitors().length, 1);
  assert.equal(store.monitors()[0].fullName, 'Owner/Canonical');
  assert.equal(store.monitors()[0].stars, 160);
  assert.equal(store.monitors()[0].fetchedAt, '2026-10-11T00:00:00.000Z');
  assert.deepEqual(store.history('Owner/Canonical'), [{ at: '2026-10-11T00:00:00.000Z', stars: 160, forks: 2 }]);
});
