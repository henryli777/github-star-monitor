import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const github = await import('../lib/github.mjs').catch(() => ({}));
const persistence = await import('../lib/store.mjs').catch(() => ({}));
const sample = {
  full_name: 'Example/Project', name: 'Project', owner: { login: 'Example', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
  description: 'A real repository', html_url: 'https://github.com/Example/Project', stargazers_count: 103, forks_count: 12,
  language: 'JavaScript', topics: ['tooling'], created_at: '2025-01-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  pushed_at: '2026-10-01T00:00:00Z', archived: false, license: { spdx_id: 'MIT' },
};
async function client(t, fetchImpl, options = {}) {
  assert.equal(typeof github.createGitHubClient, 'function', 'GitHub client implementation is required');
  assert.equal(typeof persistence.openStore, 'function', 'Durable cache implementation is required');
  const dataDir = await mkdtemp(join(tmpdir(), 'starscope-github-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = await persistence.openStore({ dataDir });
  return github.createGitHubClient({ store, fetchImpl, now: () => Date.parse('2026-10-11T10:00:00Z'), ...options });
}

test('repository names accept GitHub URLs and reject traversal or foreign hosts', () => {
  assert.equal(typeof github.normalizeRepoName, 'function', 'Repository input validation is required');
  assert.equal(github.normalizeRepoName(' https://github.com/Example/Project.git/ '), 'Example/Project');
  assert.equal(github.normalizeRepoName('Example/Project'), 'Example/Project');
  for (const input of ['../secret', 'owner/..', 'https://evil.test/owner/name', 'owner/name/issues', 'https://user:pass@github.com/o/r', 'owner/name?x=1', 'owner/name\n']) {
    assert.throws(() => github.normalizeRepoName(input), { code: 'INVALID_REPO' }, input);
  }
});

test('rankings emit the official scoped descending search and canonical Repo fields', async (t) => {
  const requests = [];
  const api = await client(t, async (url, options) => {
    requests.push({ url: new URL(url), headers: options.headers });
    return new Response(JSON.stringify({ items: [sample], total_count: 70, incomplete_results: false }), { status: 200 });
  }, { token: 'private-test-token' });
  const result = await api.rankings({ language: 'C++', topic: 'tools', q: 'compiler', new: '1' });
  assert.equal(requests[0].url.origin, 'https://api.github.com');
  assert.equal(requests[0].url.searchParams.get('q'), 'stars:>0 fork:false archived:false is:public language:"C++" topic:tools "compiler" created:>=2026-09-11');
  assert.equal(requests[0].url.searchParams.get('sort'), 'stars');
  assert.equal(requests[0].url.searchParams.get('order'), 'desc');
  assert.equal(requests[0].url.searchParams.get('per_page'), '50');
  assert.equal(requests[0].headers.Authorization, 'Bearer private-test-token');
  assert.deepEqual(result.items[0], {
    fullName: 'Example/Project', name: 'Project', owner: 'Example', description: 'A real repository', url: 'https://github.com/Example/Project',
    stars: 103, forks: 12, language: 'JavaScript', topics: ['tooling'], createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z', pushedAt: '2026-10-01T00:00:00Z', archived: false, license: 'MIT',
    ownerAvatar: 'https://avatars.githubusercontent.com/u/1',
  });
  assert.equal(result.meta.source, 'github-api');
  assert.equal(result.meta.stale, false);
  assert.equal(result.meta.totalCount, 70);
  assert.ok(result.meta.scope);
});

test('invalid search inputs fail before any upstream request', async (t) => {
  const api = await client(t, async () => assert.fail('Invalid input must not reach GitHub'));
  for (const params of [{ q: 'fork:true' }, { q: 'x'.repeat(121) }, { language: 'JS archived:true' }, { topic: '../tools' }, { new: 'yes' }, { fresh: 'true' }, { q: '\u0000' }]) {
    await assert.rejects(() => api.rankings(params), { code: 'INVALID_SEARCH' });
  }
});

test('unlisted repository details are cached and concurrent reads share an acquisition', async (t) => {
  let requests = 0;
  const api = await client(t, async () => {
    requests++;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return new Response(JSON.stringify(sample));
  });
  const results = await Promise.all(Array.from({ length: 4 }, () => api.repository('Example/Project')));
  assert.equal(requests, 1);
  assert.ok(results.every((result) => result.item.stars === 103));
  results[0].item.stars = 0;
  const cached = await api.repository('example/project');
  assert.equal(cached.item.stars, 103);
  assert.equal(cached.meta.source, 'cache');
  assert.equal(requests, 1);
});

test('repository detail cache expires and keeps the original time on upstream failure', async (t) => {
  let clock = Date.parse('2026-10-12T00:00:00Z');
  let requests = 0;
  const api = await client(t, async () => {
    requests++;
    return requests === 1 ? new Response(JSON.stringify(sample)) : new Response('{}', { status: 503 });
  }, { now: () => clock });
  const first = await api.repository('Example/Project');
  clock += 15 * 60000 + 1;
  const stale = await api.repository('Example/Project');
  assert.equal(requests, 2);
  assert.equal(stale.meta.stale, true);
  assert.equal(stale.meta.fetchedAt, first.meta.fetchedAt);
  assert.equal(stale.item.stars, 103);
});

test('public detail budget preserves cached reads and fresh monitor collection', async (t) => {
  let clock = Date.parse('2026-10-12T00:00:00Z');
  const api = await client(t, async (url) => new Response(JSON.stringify({ ...sample, full_name: new URL(url).pathname.split('/').slice(2).join('/') })), { now: () => clock, detailRequestLimit: 1 });
  await api.repository('Example/Project');
  await assert.rejects(() => api.repository('Example/Second'), { code: 'DETAIL_RATE_LIMIT' });
  assert.equal((await api.repository('Example/Project')).item.stars, 103);
  assert.equal((await api.repository('Example/Second', { fresh: true })).item.fullName, 'Example/Second');
  assert.equal((await api.repository('Example/Second')).meta.source, 'cache');
  clock += 3600000;
  assert.equal((await api.repository('Example/Third')).item.fullName, 'Example/Third');
});

test('failed details use a short retry cache and recover after its expiry', async (t) => {
  let clock = Date.parse('2026-10-12T00:00:00Z');
  let requests = 0;
  const api = await client(t, async () => { requests++; return requests === 1 ? new Response('{}', { status: 503 }) : new Response(JSON.stringify(sample)); }, { now: () => clock });
  await assert.rejects(() => api.repository('Example/Project'), { code: 'GITHUB_UNAVAILABLE' });
  await assert.rejects(() => api.repository('Example/Project'), { code: 'GITHUB_UNAVAILABLE' });
  assert.equal(requests, 1);
  clock += 30001;
  assert.equal((await api.repository('Example/Project')).item.stars, 103);
  assert.equal(requests, 2);
});

test('fresh requests use stale durable cache during rate limits and preserve fetched time', async (t) => {
  let requests = 0;
  const api = await client(t, async () => {
    requests++;
    if (requests === 1) return new Response(JSON.stringify({ items: [sample], total_count: 1, incomplete_results: false }));
    return new Response('{"message":"API rate limit exceeded"}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
  });
  const first = await api.rankings({});
  const cached = await api.rankings({});
  assert.equal(requests, 1);
  assert.equal(cached.meta.source, 'cache');
  assert.equal(cached.meta.stale, false);
  const stale = await api.rankings({ fresh: '1' });
  assert.deepEqual(stale.items, first.items);
  assert.equal(stale.meta.stale, true);
  assert.equal(stale.meta.fetchedAt, first.meta.fetchedAt);
  assert.match(stale.meta.warning, /限流/);
});

test('uncached rate limits and network failures have useful safe error codes', async (t) => {
  const limited = await client(t, async () => new Response('{}', { status: 429 }));
  await assert.rejects(() => limited.rankings({}), { code: 'GITHUB_RATE_LIMIT' });
  const broken = await client(t, async () => { throw new Error('private upstream details'); });
  await assert.rejects(() => broken.repository('owner/name'), (error) => error.code === 'GITHUB_UNAVAILABLE' && !error.message.includes('private upstream'));
});

test('upstream timeout aborts and returns stale cache when available', async (t) => {
  let successful = true;
  const api = await client(t, async (_url, { signal }) => {
    if (successful) return new Response(JSON.stringify({ items: [sample], total_count: 1, incomplete_results: false }));
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }, { timeoutMs: 20 });
  await api.rankings({});
  successful = false;
  const result = await api.rankings({ fresh: '1' });
  assert.equal(result.meta.stale, true);
  assert.match(result.meta.warning, /超时/);
});

test('configured token never exposes private repositories', async (t) => {
  const api = await client(t, async () => new Response(JSON.stringify({ ...sample, private: true })), { token: 'private-test-token' });
  await assert.rejects(() => api.repository('Example/Project'), { code: 'GITHUB_NOT_FOUND' });
});

test('expired concurrent rankings share one current acquisition', async (t) => {
  let clock = Date.parse('2026-10-15T00:00:00Z');
  let calls = 0;
  const api = await client(t, async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return new Response(JSON.stringify({ items: [{ ...sample, stargazers_count: 100 + calls }], total_count: 1 }));
  }, { now: () => clock });
  await api.rankings();
  clock += 15 * 60000;
  const results = await Promise.all([api.rankings(), api.rankings(), api.rankings({ fresh: '1' })]);
  assert.equal(calls, 2);
  assert.ok(results.every((result) => result.items[0].stars === 102 && !result.meta.stale));
});

test('search quota reset cools all ranking queries while preserving cache and core access', async (t) => {
  let clock = Date.parse('2026-10-15T00:00:00Z');
  let searchCalls = 0;
  let coreCalls = 0;
  const api = await client(t, async (url) => {
    if (new URL(url).pathname.startsWith('/repos/')) { coreCalls++; return new Response(JSON.stringify(sample)); }
    searchCalls++;
    if (searchCalls === 2) return new Response('{}', { status: 403, headers: {
      'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((clock + 120000) / 1000), 'x-ratelimit-resource': 'search',
    } });
    return new Response(JSON.stringify({ items: [sample], total_count: 1 }));
  }, { now: () => clock });
  const first = await api.rankings();
  clock += 15 * 60000;
  for (let index = 0; index < 3; index++) {
    const stale = await api.rankings({ fresh: '1' });
    assert.equal(stale.meta.stale, true);
    assert.equal(stale.meta.fetchedAt, first.meta.fetchedAt);
  }
  await assert.rejects(() => api.rankings({ new: '1' }), { code: 'GITHUB_RATE_LIMIT' });
  assert.equal(searchCalls, 2);
  assert.equal((await api.repository('Example/Project', { fresh: true })).item.stars, 103);
  assert.equal(coreCalls, 1);
  clock += 120000;
  assert.equal((await api.rankings()).meta.stale, false);
  assert.equal(searchCalls, 3);
});

test('Retry-After seconds and HTTP dates cool secondary limits across resources', async (t) => {
  for (const status of [429, 403]) {
    let clock = Date.parse('2026-10-15T00:00:00Z');
    let calls = 0;
    const api = await client(t, async () => {
      calls++;
      if (calls === 1) return new Response('{}', { status, headers: {
        'retry-after': status === 429 ? '120' : new Date(clock + 120000).toUTCString(),
        'x-ratelimit-remaining': '4',
      } });
      return new Response(JSON.stringify(sample));
    }, { now: () => clock });
    await assert.rejects(() => api.rankings(), { code: 'GITHUB_RATE_LIMIT' });
    clock += 60000;
    await assert.rejects(() => api.repository('Example/Project', { fresh: true }), { code: 'GITHUB_RATE_LIMIT' });
    assert.equal(calls, 1);
    clock += 60000;
    assert.equal((await api.repository('Example/Project', { fresh: true })).item.stars, 103);
    assert.equal(calls, 2);
  }
});

test('core quota cooldown protects fresh monitor collection without retimestamping cached details', async (t) => {
  let clock = Date.parse('2026-10-15T00:00:00Z');
  let calls = 0;
  const api = await client(t, async () => {
    calls++;
    if (calls === 2) return new Response('{}', { status: 403, headers: {
      'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((clock + 120000) / 1000),
    } });
    return new Response(JSON.stringify(sample));
  }, { now: () => clock });
  const initial = await api.repository('Example/Project');
  clock += 15 * 60000;
  await assert.rejects(() => api.repository('Example/Project', { fresh: true }), { code: 'GITHUB_RATE_LIMIT' });
  const stale = await api.repository('Example/Project');
  assert.equal(stale.meta.stale, true);
  assert.equal(stale.meta.fetchedAt, initial.meta.fetchedAt);
  await assert.rejects(() => api.repository('Example/Other', { fresh: true }), { code: 'GITHUB_RATE_LIMIT' });
  assert.equal(calls, 2);
  clock += 120000;
  assert.equal((await api.repository('Example/Project', { fresh: true })).meta.stale, false);
  assert.equal(calls, 3);
});

test('repeated network failures back off ranking reads and recover without changing stale timestamps', async (t) => {
  let clock = Date.parse('2026-10-15T00:00:00Z');
  let calls = 0;
  let offline = false;
  const api = await client(t, async () => {
    calls++;
    if (offline) throw new Error('offline');
    return new Response(JSON.stringify({ items: [sample], total_count: 1 }));
  }, { now: () => clock });
  const initial = await api.rankings();
  clock += 15 * 60000;
  offline = true;
  for (const [advance, expectedCalls] of [[0, 2], [30001, 3], [30001, 3], [30000, 4], [60000, 4]]) {
    clock += advance;
    const stale = await api.rankings();
    assert.equal(stale.meta.stale, true);
    assert.equal(stale.meta.fetchedAt, initial.meta.fetchedAt);
    assert.equal(calls, expectedCalls);
  }
  offline = false;
  clock += 60000;
  const recovered = await api.rankings();
  assert.equal(calls, 5);
  assert.equal(recovered.meta.stale, false);
  assert.notEqual(recovered.meta.fetchedAt, initial.meta.fetchedAt);
});

test('a successful pending search cannot erase a newer rate-limit cooldown', async (t) => {
  let releaseSuccess;
  let calls = 0;
  const api = await client(t, async (url) => {
    calls++;
    if (new URL(url).searchParams.get('q').includes('broken')) return new Response('{}', { status: 429, headers: { 'retry-after': '120' } });
    if (calls === 2) return new Promise((resolve) => { releaseSuccess = () => resolve(new Response(JSON.stringify({ items: [sample], total_count: 1 }))); });
    return new Response(JSON.stringify({ items: [sample], total_count: 1 }));
  });
  const broken = api.rankings({ q: 'broken' });
  const healthy = api.rankings({ q: 'healthy' });
  await assert.rejects(() => broken, { code: 'GITHUB_RATE_LIMIT' });
  releaseSuccess();
  await healthy;
  await assert.rejects(() => api.rankings({ q: 'another' }), { code: 'GITHUB_RATE_LIMIT' });
  assert.equal(calls, 2);
});
