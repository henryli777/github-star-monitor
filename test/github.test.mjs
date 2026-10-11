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
