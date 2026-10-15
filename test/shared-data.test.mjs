import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');
const sharedFunctions = source.slice(source.indexOf('async function reloadWorkspace('), source.indexOf('const sharedRefresh ='));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(api) {
  const state = {
    request: 0, workspaceRequest: 0, loading: false, busy: false, view: 'ranking', query: '', language: '', topic: '',
    monitors: [], revenues: [], monitorErrors: [], rankings: [], meta: null, status: null, error: '', syncError: '',
  };
  const area = { scrollLeft: 0, scrollTop: 0 };
  const functions = new Function('state', 'api', '$', 'window', 'usesRankings', 'toast', 'renderTable',
    `${sharedFunctions}\nreturn { reloadWorkspace, readSharedData, applySharedData };`);
  return {
    state,
    ...functions(state, api, () => area, { scrollX: 0, scrollY: 0, scrollTo() {} }, () => true, () => {}, () => {}),
  };
}

const responses = {
  old: {
    '/api/monitors': { items: [{ fullName: 'Old/Repo', stars: 10, fetchedAt: '2026-10-15T00:00:00Z' }], meta: { errors: [] } },
    '/api/revenues': { items: [{ id: 'old-record' }] },
    '/api/status': { readOnly: false, monitorCount: 1, lastRefreshAt: '2026-10-15T00:00:00Z' },
  },
  current: {
    '/api/monitors': { items: [{ fullName: 'New/Repo', stars: 20, fetchedAt: '2026-10-15T00:10:00Z' }], meta: { errors: [] } },
    '/api/revenues': { items: [{ id: 'new-record' }] },
    '/api/status': { readOnly: false, monitorCount: 1, lastRefreshAt: '2026-10-15T00:10:00Z' },
  },
};

test('automatic reads request only cached rankings and preserve active filters and scenario inputs', async () => {
  const requests = [];
  const app = setup(async (path) => {
    requests.push(path);
    return path.startsWith('/api/rankings?') ? { items: [], meta: { fetchedAt: '2026-10-15T00:10:00Z' } } : responses.current[path];
  });
  const scenario = { monthlyPrice: 12, activeRate: 0.2 };
  Object.assign(app.state, { query: 'active input', language: 'JavaScript', topic: 'tools', scenario });
  app.applySharedData(await app.readSharedData());
  const params = new URL(requests.find((path) => path.startsWith('/api/rankings?')), 'https://example.test').searchParams;
  assert.equal(params.get('cached'), '1');
  assert.equal(params.get('q'), 'active input');
  assert.equal(params.get('language'), 'JavaScript');
  assert.equal(params.get('topic'), 'tools');
  assert.equal(app.state.query, 'active input');
  assert.equal(app.state.language, 'JavaScript');
  assert.equal(app.state.topic, 'tools');
  assert.equal(app.state.scenario, scenario);
});

test('a slow automatic batch cannot replace workspace data reloaded after management', async () => {
  const ranking = deferred();
  let phase = 'old';
  const app = setup(async (path) => path.startsWith('/api/rankings?') ? ranking.promise : responses[phase][path]);
  const pending = app.readSharedData();
  const rankingRequest = app.state.request;
  phase = 'current';
  await app.reloadWorkspace();
  assert.equal(app.state.request, rankingRequest, 'workspace reload must not invalidate a ranking request');
  ranking.resolve({ items: [{ fullName: 'Old/Repo', stars: 10 }], meta: { fetchedAt: '2026-10-15T00:00:00Z' } });
  app.applySharedData(await pending);
  assert.deepEqual(app.state.monitors.map((repo) => repo.fullName), ['New/Repo']);
  assert.deepEqual(app.state.revenues.map((record) => record.id), ['new-record']);
  assert.equal(app.state.status.lastRefreshAt, '2026-10-15T00:10:00Z');
});

test('an older overlapping workspace reload cannot replace a newer completed reload', async () => {
  const pending = Object.fromEntries(Object.keys(responses.old).map((path) => [path, deferred()]));
  let phase = 'old';
  const app = setup(async (path) => phase === 'old' ? pending[path].promise : responses.current[path]);
  const oldReload = app.reloadWorkspace();
  phase = 'current';
  await app.reloadWorkspace();
  for (const [path, request] of Object.entries(pending)) request.resolve(responses.old[path]);
  await oldReload;
  assert.deepEqual(app.state.monitors.map((repo) => repo.fullName), ['New/Repo']);
  assert.deepEqual(app.state.revenues.map((record) => record.id), ['new-record']);
  assert.equal(app.state.status.lastRefreshAt, '2026-10-15T00:10:00Z');
});
