import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

const serverModule = await import('../server.mjs').catch(() => ({}));
const sample = { full_name: 'Owner/Repo', name: 'Repo', owner: { login: 'Owner', avatar_url: 'https://avatars.githubusercontent.com/u/1' }, description: 'Public project', html_url: 'https://github.com/Owner/Repo', stargazers_count: 100, forks_count: 2, language: 'JavaScript', topics: [], created_at: '2020-01-01T00:00:00Z', updated_at: '2026-10-11T00:00:00Z', pushed_at: '2026-10-11T00:00:00Z', archived: false, license: null };
async function setup(t, options = {}) {
  assert.equal(typeof serverModule.createApplication, 'function', 'HTTP application implementation is required');
  const root = await mkdtemp(join(tmpdir(), 'starscope-http-'));
  const publicDir = join(root, 'public');
  await mkdir(publicDir);
  await writeFile(join(publicDir, 'index.html'), '<!doctype html><title>StarScope</title>');
  await writeFile(join(root, 'secret.txt'), 'private-data');
  await symlink(join(root, 'secret.txt'), join(publicDir, 'leak.txt'));
  await mkdir(join(publicDir, 'a'));
  await mkdir(join(publicDir, 'inside'));
  await writeFile(join(publicDir, 'inside', 'asset.txt'), 'public asset');
  await symlink(join(publicDir, 'inside'), join(publicDir, 'a', 'a'));
  const app = await serverModule.createApplication({ dataDir: join(root, 'data'), publicDir, token: 'private-server-token', intervalMs: 0,
    now: () => Date.parse('2026-10-11T00:00:00Z'), fetchImpl: async (url) => new Response(JSON.stringify(new URL(url).pathname === '/search/repositories' ? { items: [sample], total_count: 1, incomplete_results: false } : sample)), ...options });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  return { app, origin, root };
}
async function json(origin, path, options) {
  const response = await fetch(origin + path, options);
  return { status: response.status, body: await response.json() };
}
const post = (body, origin) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });

test('HTTP monitor lifecycle accepts URLs, prevents duplicates, exports persisted data and removes', async (t) => {
  const { origin } = await setup(t);
  const created = await json(origin, '/api/monitors', post({ fullName: 'https://github.com/Owner/Repo.git' }, origin));
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.item.growth, { day: null, week: null, month: null });
  const duplicate = await json(origin, '/api/monitors', post({ fullName: 'owner/repo' }, origin));
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, 'MONITOR_EXISTS');
  const detail = await json(origin, '/api/repo?name=owner%2Frepo');
  assert.equal(detail.body.history.length, 1);
  assert.equal(detail.body.item.stars, 100);
  const exported = await json(origin, '/api/export');
  assert.equal(exported.body.version, 1);
  assert.equal(exported.body.monitors.length, 1);
  assert.equal(JSON.stringify(exported.body).includes('private-server-token'), false);
  const removed = await json(origin, '/api/monitors?repo=OWNER%2FREPO', { method: 'DELETE', headers: { Origin: origin } });
  assert.deepEqual(removed.body, { ok: true });
  assert.equal((await json(origin, '/api/monitors')).body.items.length, 0);
});

test('API errors are structured for malformed queries, JSON bodies and unsupported methods', async (t) => {
  const { origin } = await setup(t);
  for (const path of ['/api/repo?name=..%2Fsecret', '/api/rankings?topic=bad%20topic', '/api/rankings?new=yes', '/api/rankings?q=a&q=b']) {
    const result = await json(origin, path);
    assert.equal(result.status, 400, path);
    assert.equal(typeof result.body.error.code, 'string');
    assert.equal(typeof result.body.error.message, 'string');
  }
  assert.equal((await json(origin, '/api/monitors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' })).status, 400);
  assert.equal((await json(origin, '/api/monitors', { method: 'PATCH' })).status, 405);
  assert.equal((await json(origin, '/api/unknown')).status, 404);
});

test('foreign Origin and fetch-site mutations are rejected without changing persisted monitors', async (t) => {
  const { origin } = await setup(t);
  assert.equal((await json(origin, '/api/monitors', post({ fullName: 'Owner/Repo' }, 'https://evil.test'))).status, 403);
  const crossSite = post({ fullName: 'Owner/Repo' });
  crossSite.headers['Sec-Fetch-Site'] = 'cross-site';
  assert.equal((await json(origin, '/api/monitors', crossSite)).status, 403);
  assert.equal((await json(origin, '/api/monitors')).body.items.length, 0);
});

test('static route serves public index while rejecting traversal and symlink leaks', async (t) => {
  const { origin } = await setup(t);
  assert.equal((await fetch(origin)).status, 200);
  for (const path of ['/leak.txt', '/data/state.json', '/%2e%2e%2fsecret.txt', '/%2e%2e/secret.txt', '/%00']) {
    const status = await new Promise((resolve, reject) => {
      http.get(origin + path, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.ok([400, 403, 404].includes(status), `${path}: ${status}`);
  }
});

test('failed monitor refresh keeps prior data and returns named errors', async (t) => {
  let unavailable = false;
  let now = Date.parse('2026-10-11T00:00:00Z');
  const { app, origin, root } = await setup(t, { now: () => now, fetchImpl: async () => {
    if (unavailable) return new Response('{}', { status: 503 });
    return new Response(JSON.stringify(sample));
  } });
  await json(origin, '/api/monitors', post({ fullName: 'Owner/Repo' }, origin));
  unavailable = true;
  now = Date.parse('2026-10-11T01:00:00Z');
  const refresh = await json(origin, '/api/refresh', post({}, origin));
  assert.equal(refresh.status, 200);
  assert.equal(refresh.body.items[0].stars, 100);
  assert.equal(refresh.body.errors[0].repo, 'Owner/Repo');
  assert.equal(refresh.body.errors[0].code, 'GITHUB_UNAVAILABLE');
  assert.equal((await json(origin, '/api/repo?name=Owner%2FRepo')).body.history.length, 1);
  await app.close();
  const reopened = await serverModule.createApplication({ dataDir: join(root, 'data'), publicDir: join(root, 'public'), intervalMs: 0, now: () => now });
  t.after(() => reopened.close());
  await new Promise((resolve) => reopened.server.listen(0, '127.0.0.1', resolve));
  const reopenedOrigin = `http://127.0.0.1:${reopened.server.address().port}`;
  const monitored = (await json(reopenedOrigin, '/api/monitors')).body;
  assert.equal(monitored.items[0].fetchedAt, '2026-10-11T00:00:00.000Z');
  assert.equal(monitored.meta.lastRefreshAt, '2026-10-11T01:00:00.000Z');
  assert.equal(monitored.meta.errors[0].code, 'GITHUB_UNAVAILABLE');
});

test('revenue API records sourced disclosures, rejects duplicate and deletes by ID', async (t) => {
  const { origin } = await setup(t);
  const input = { repo: 'Owner/Repo', amount: 99.5, currency: 'CNY', period: 'yearly', date: '2026-10-01', sourceUrl: 'https://example.com/report', notes: '' };
  const created = await json(origin, '/api/revenues', post(input, origin));
  assert.equal(created.status, 201);
  assert.equal(created.body.item.amount, 99.5);
  assert.equal((await json(origin, '/api/revenues', post(input, origin))).status, 409);
  assert.equal((await json(origin, `/api/revenues?id=${created.body.item.id}`, { method: 'DELETE', headers: { Origin: origin } })).status, 200);
  assert.deepEqual((await json(origin, '/api/revenues')).body.items, []);
});

test('status reports configured token as a boolean without leaking its value', async (t) => {
  const { origin } = await setup(t);
  const result = await json(origin, '/api/status');
  assert.equal(result.body.tokenConfigured, true);
  assert.equal(result.body.refreshMinutes, 60);
  assert.equal(result.body.monitorCount, 0);
  assert.equal(result.body.lastRefreshAt, null);
  assert.equal(result.body.now, '2026-10-11T00:00:00.000Z');
  assert.equal(JSON.stringify(result.body).includes('private-server-token'), false);
});

test('nested symlinks with repeated directory names cannot bypass static access policy', async (t) => {
  const { origin } = await setup(t);
  assert.equal((await fetch(origin + '/a/a/asset.txt')).status, 403);
});

test('adding a monitor acquires a current snapshot instead of retimestamping a cached ranking', async (t) => {
  const { origin } = await setup(t, { fetchImpl: async (url) => {
    return new Response(JSON.stringify(new URL(url).pathname === '/search/repositories'
      ? { items: [sample], total_count: 1, incomplete_results: false }
      : { ...sample, stargazers_count: 200 }));
  } });
  await json(origin, '/api/rankings');
  const created = await json(origin, '/api/monitors', post({ fullName: 'Owner/Repo' }, origin));
  assert.equal(created.body.item.stars, 200);
  assert.equal((await json(origin, '/api/repo?name=Owner%2FRepo')).body.history[0].stars, 200);
});

test('scheduler refreshes monitored projects while running and close stops the timer', async (t) => {
  let calls = 0;
  const { app, origin } = await setup(t, { intervalMs: 15, now: Date.now, fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify({ ...sample, stargazers_count: 100 + calls }));
  } });
  await json(origin, '/api/monitors', post({ fullName: 'Owner/Repo' }, origin));
  const deadline = Date.now() + 1000;
  let items;
  do {
    await new Promise((resolve) => setTimeout(resolve, 10));
    items = (await json(origin, '/api/monitors')).body.items;
  } while (items[0].stars === 101 && Date.now() < deadline);
  assert.ok(items[0].stars > 101);
  await app.close();
  const stoppedAt = calls;
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(calls, stoppedAt);
});

test('monitor batches run at most three concurrent GitHub requests', async (t) => {
  let refreshing = false;
  let active = 0;
  let maximumActive = 0;
  const { origin } = await setup(t, { fetchImpl: async (url) => {
    const fullName = new URL(url).pathname.split('/').slice(2).join('/');
    if (refreshing) {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
    }
    return new Response(JSON.stringify({ ...sample, full_name: fullName, name: fullName.split('/')[1], stargazers_count: refreshing ? 200 : 100 }));
  } });
  for (let i = 0; i < 5; i++) assert.equal((await json(origin, '/api/monitors', post({ fullName: `Owner/Repo${i}` }, origin))).status, 201);
  refreshing = true;
  const refreshed = await json(origin, '/api/refresh', post({}, origin));
  assert.equal(maximumActive, 3);
  assert.equal(refreshed.body.items.length, 5);
  assert.ok(refreshed.body.items.every((item) => item.stars === 200));
  assert.deepEqual(refreshed.body.errors, []);
});

test('GitHub rename migrates the monitored identity and history to the canonical repository', async (t) => {
  let renamed = false;
  let now = Date.parse('2026-10-11T00:00:00Z');
  const { origin } = await setup(t, { now: () => now, fetchImpl: async () => new Response(JSON.stringify({
    ...sample, full_name: renamed ? 'Owner/New' : 'Owner/Old', name: renamed ? 'New' : 'Old', stargazers_count: renamed ? 110 : 100,
  })) });
  await json(origin, '/api/monitors', post({ fullName: 'Owner/Old' }, origin));
  renamed = true;
  now = Date.parse('2026-10-11T01:00:00Z');
  const refreshed = await json(origin, '/api/refresh', post({}, origin));
  assert.equal(refreshed.body.items[0].fullName, 'Owner/New');
  assert.equal(refreshed.body.items[0].stars, 110);
  assert.equal(refreshed.body.items.length, 1);
  const detail = (await json(origin, '/api/repo?name=Owner%2FOld')).body;
  assert.equal(detail.item.fullName, 'Owner/New');
  assert.deepEqual(detail.history, [
    { at: '2026-10-11T00:00:00.000Z', stars: 100, forks: 2 },
    { at: '2026-10-11T01:00:00.000Z', stars: 110, forks: 2 },
  ]);
});

test('an old refresh generation cannot overwrite a monitor removed and re-added while another request waits', async (t) => {
  let phase = 'initial';
  let releaseB;
  let bStarted;
  const blocked = new Promise((resolve) => { bStarted = resolve; });
  const { origin } = await setup(t, { fetchImpl: async (url) => {
    const fullName = new URL(url).pathname.split('/').slice(2).join('/');
    const payload = (stars) => new Response(JSON.stringify({ ...sample, full_name: fullName, name: fullName.split('/')[1], stargazers_count: stars }));
    if (phase === 'refresh' && fullName === 'Owner/B') {
      bStarted();
      return new Promise((resolve) => { releaseB = () => resolve(payload(120)); });
    }
    return payload(phase === 'initial' ? 100 : phase === 'refresh' ? 110 : 150);
  } });
  await json(origin, '/api/monitors', post({ fullName: 'Owner/A' }, origin));
  await json(origin, '/api/monitors', post({ fullName: 'Owner/B' }, origin));
  phase = 'refresh';
  const refreshing = json(origin, '/api/refresh', post({}, origin));
  await blocked;
  await json(origin, '/api/monitors?repo=Owner%2FA', { method: 'DELETE', headers: { Origin: origin } });
  phase = 'readded';
  const recreated = await json(origin, '/api/monitors', post({ fullName: 'Owner/A' }, origin));
  assert.equal(recreated.body.item.stars, 150);
  releaseB();
  const refreshed = await refreshing;
  assert.equal(refreshed.body.items.find((item) => item.fullName === 'Owner/A').stars, 150);
  assert.equal((await json(origin, '/api/repo?name=Owner%2FA')).body.history.at(-1).stars, 150);
});
