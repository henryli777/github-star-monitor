import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeRepoName } from './github.mjs';
import { AppError } from './errors.mjs';

const DAY_MS = 86400000;
const clone = (value) => structuredClone(value);
const keyOf = (name) => normalizeRepoName(name).toLowerCase();
const initialState = () => ({ version: 1, monitors: [], history: {}, revenues: [], rankings: {}, lastRefreshAt: null, lastRefreshErrors: [] });
const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const validCount = (value) => Number.isSafeInteger(value) && value >= 0;
const shanghaiDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
function currentDate(now) {
  const parts = Object.fromEntries(shanghaiDate.formatToParts(new Date(now)).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function validateSavedState(state, now) {
  const validRepo = (repo) => {
    if (!repo || typeof repo !== 'object' || Array.isArray(repo)) return false;
    try { normalizeRepoName(repo.fullName); } catch { return false; }
    return typeof repo.name === 'string' && typeof repo.owner === 'string' && typeof repo.description === 'string'
      && repo.url === `https://github.com/${repo.fullName}` && validCount(repo.stars) && validCount(repo.forks)
      && (repo.language === null || typeof repo.language === 'string') && Array.isArray(repo.topics) && repo.topics.every((topic) => typeof topic === 'string')
      && (repo.createdAt === null || validTime(repo.createdAt)) && (repo.updatedAt === null || validTime(repo.updatedAt))
      && (repo.pushedAt === null || validTime(repo.pushedAt)) && typeof repo.archived === 'boolean'
      && (repo.license === null || typeof repo.license === 'string') && typeof repo.ownerAvatar === 'string';
  };
  if (state?.version !== 1 || !Array.isArray(state.monitors) || state.monitors.length > 30 || !Array.isArray(state.revenues)
      || !state.history || typeof state.history !== 'object' || Array.isArray(state.history)
      || !state.rankings || typeof state.rankings !== 'object' || Array.isArray(state.rankings)
      || !(state.lastRefreshAt === null || validTime(state.lastRefreshAt))) throw new Error('Unsupported state');
  if (state.lastRefreshErrors !== undefined && (!Array.isArray(state.lastRefreshErrors) || !state.lastRefreshErrors.every((error) => {
    try { normalizeRepoName(error?.repo); } catch { return false; }
    return typeof error.code === 'string' && typeof error.message === 'string';
  }))) throw new Error('Invalid refresh errors');
  const monitorKeys = new Set();
  for (const monitor of state.monitors) {
    if (!validRepo(monitor?.repo) || !validTime(monitor.fetchedAt) || monitorKeys.has(keyOf(monitor.repo.fullName))
        || (monitor.generation !== undefined && !/^[a-f0-9-]{36}$/.test(monitor.generation))) throw new Error('Invalid monitors');
    monitorKeys.add(keyOf(monitor.repo.fullName));
  }
  for (const [name, points] of Object.entries(state.history)) {
    normalizeRepoName(name);
    if (!Array.isArray(points) || !points.every((point) => validTime(point?.at) && validCount(point.stars) && validCount(point.forks))) throw new Error('Invalid snapshots');
  }
  for (const revenue of state.revenues) {
    validateRevenue(revenue, Math.max(now, Date.parse(revenue?.createdAt) || 0));
    if (!/^[a-f0-9-]{36}$/.test(revenue.id) || !validTime(revenue.createdAt)) throw new Error('Invalid revenues');
  }
  for (const ranking of Object.values(state.rankings)) {
    if (!Array.isArray(ranking?.items) || !ranking.items.every(validRepo) || !validTime(ranking.meta?.fetchedAt)
        || !validCount(ranking.meta?.totalCount) || typeof ranking.meta?.scope !== 'string') throw new Error('Invalid rankings');
  }
}

function validateRevenue(input, now) {
  const invalid = () => new AppError('INVALID_REVENUE', '请填写有效仓库、正数金额、币种、周期、非未来日期和 HTTP(S) 来源网址。');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  let repo;
  try { repo = normalizeRepoName(input.repo); } catch { throw invalid(); }
  if (typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount <= 0 || input.amount > Number.MAX_SAFE_INTEGER
      || !['USD', 'CNY', 'EUR'].includes(input.currency) || !['monthly', 'yearly', 'one-time'].includes(input.period)
      || typeof input.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw invalid();
  const date = new Date(`${input.date}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.date || input.date > currentDate(now)) throw invalid();
  let source;
  try { source = new URL(input.sourceUrl); } catch { throw invalid(); }
  if (typeof input.sourceUrl !== 'string' || /[\u0000-\u001f\u007f]/.test(input.sourceUrl)
      || !['https:', 'http:'].includes(source.protocol) || source.username || source.password || input.sourceUrl.length > 2000
      || (input.notes !== undefined && typeof input.notes !== 'string') || (input.notes || '').length > 2000) throw invalid();
  return { repo, amount: input.amount, currency: input.currency, period: input.period, date: input.date, sourceUrl: source.href, notes: (input.notes || '').trim() };
}

export async function openStore({ dataDir, now = Date.now, fsImpl = fs }) {
  await fsImpl.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, 'state.json');
  let state = initialState();
  try {
    const raw = await fsImpl.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    validateSavedState(parsed, now());
    state = parsed;
    state.lastRefreshErrors ??= [];
    for (const monitor of state.monitors) monitor.generation ??= randomUUID();
  } catch (error) {
    if (error.code !== 'ENOENT') throw new AppError('INVALID_DATA', '本地数据文件无法读取；请保留原文件并检查 data/state.json。', 500);
  }
  let pending = Promise.resolve();
  async function persist(next) {
    const temporary = join(dataDir, `.state-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fsImpl.open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(next, null, 2) + '\n', 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fsImpl.rename(temporary, file);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fsImpl.unlink(temporary).catch(() => {});
    }
  }
  function mutate(operation) {
    const task = pending.then(async () => {
      const next = clone(state);
      const result = operation(next);
      await persist(next);
      state = next;
      return clone(result);
    });
    pending = task.catch(() => {});
    return task;
  }
  function snapshot(next, repo, at) {
    const key = keyOf(repo.fullName);
    const samples = next.history[key] || [];
    const point = { at, stars: repo.stars, forks: repo.forks };
    const existing = samples.findIndex((sample) => sample.at === at);
    if (existing === -1) samples.push(point); else samples[existing] = point;
    const latestTime = Math.max(...samples.map((sample) => Date.parse(sample.at)));
    next.history[key] = samples.filter((sample) => Date.parse(sample.at) >= latestTime - 90 * DAY_MS).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }
  function growth(name) {
    const samples = state.history[keyOf(name)] || [];
    const latest = samples.at(-1);
    const output = { day: null, week: null, month: null };
    if (!latest) return output;
    for (const [period, days] of [['day', 1], ['week', 7], ['month', 30]]) {
      const target = Date.parse(latest.at) - days * DAY_MS;
      const baseline = samples.findLast((sample) => Date.parse(sample.at) <= target && target - Date.parse(sample.at) <= 2 * 60 * 60 * 1000);
      if (baseline) output[period] = latest.stars - baseline.stars;
    }
    return output;
  }
  function monitors() { return state.monitors.map(({ repo, fetchedAt }) => ({ ...clone(repo), fetchedAt, growth: growth(repo.fullName) })); }
  function refreshTargets() { return state.monitors.map(({ repo, generation, fetchedAt }) => ({ fullName: repo.fullName, generation, fetchedAt })); }
  function history(name) { return clone(state.history[keyOf(name)] || []); }
  async function addMonitor(repo) {
    const key = keyOf(repo.fullName);
    await mutate((next) => {
      if (next.monitors.some((item) => keyOf(item.repo.fullName) === key)) throw new AppError('MONITOR_EXISTS', '该仓库已在监控列表中。', 409);
      if (next.monitors.length >= 30) throw new AppError('MONITOR_LIMIT', '最多监控 30 个仓库，请先移除部分项目。', 409);
      const at = new Date(now()).toISOString();
      next.monitors.push({ repo: clone(repo), fetchedAt: at, generation: randomUUID() });
      snapshot(next, repo, at);
    });
    return monitors().find((item) => keyOf(item.fullName) === key);
  }
  function removeMonitor(name) {
    const key = keyOf(name);
    return mutate((next) => {
      const index = next.monitors.findIndex((item) => keyOf(item.repo.fullName) === key);
      if (index === -1) throw new AppError('MONITOR_NOT_FOUND', '该仓库不在监控列表中。', 404);
      next.monitors.splice(index, 1);
      return { ok: true };
    });
  }
  function recordRefresh(repos, errors = [], fetchedAtByRepo = {}) {
    return mutate((next) => {
      const at = new Date(now()).toISOString();
      for (const value of repos) {
        const observation = value.item ? value : { item: value, requestedFullName: value.fullName, fetchedAt: fetchedAtByRepo[keyOf(value.fullName)] || at };
        const repo = observation.item;
        const requestedKey = keyOf(observation.requestedFullName || repo.fullName);
        const canonicalKey = keyOf(repo.fullName);
        const index = next.monitors.findIndex((item) => keyOf(item.repo.fullName) === requestedKey);
        if (index === -1) continue;
        const original = next.monitors[index];
        if (observation.generation !== undefined && observation.generation !== original.generation) continue;
        const fetchedAt = observation.fetchedAt || at;
        if (!validTime(fetchedAt)) throw new AppError('INVALID_DATA', '采集时间无效。', 500);
        if (Date.parse(fetchedAt) < Date.parse(original.fetchedAt)) continue;
        if (canonicalKey !== requestedKey) {
          const merged = new Map([...(next.history[requestedKey] || []), ...(next.history[canonicalKey] || [])].map((point) => [point.at, point]));
          next.history[canonicalKey] = [...merged.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
          delete next.history[requestedKey];
          const canonicalIndex = next.monitors.findIndex((item) => keyOf(item.repo.fullName) === canonicalKey);
          if (canonicalIndex !== -1) {
            const canonical = next.monitors[canonicalIndex];
            // An alias response cannot supersede an equally timed acquisition by
            // the canonical monitor, which may have been removed and re-added.
            if (Date.parse(fetchedAt) > Date.parse(canonical.fetchedAt)) {
              next.monitors[canonicalIndex] = { repo: clone(repo), fetchedAt, generation: canonical.generation };
            }
            next.monitors.splice(index, 1);
            if (!next.history[canonicalKey].some((point) => point.at === fetchedAt)) snapshot(next, repo, fetchedAt);
            continue;
          }
        }
        next.monitors[index] = { repo: clone(repo), fetchedAt, generation: original.generation };
        snapshot(next, repo, fetchedAt);
      }
      next.lastRefreshAt = at;
      next.lastRefreshErrors = errors.filter((error) => next.monitors.some((monitor) => keyOf(monitor.repo.fullName) === keyOf(error.repo)
        && (error.generation === undefined || error.generation === monitor.generation))).map(({ repo, code, message }) => ({ repo, code, message }));
      return at;
    });
  }
  async function addRevenue(input) {
    const value = validateRevenue(input, now());
    return mutate((next) => {
      if (next.revenues.some((item) => keyOf(item.repo) === keyOf(value.repo) && item.currency === value.currency && item.period === value.period && item.date === value.date)) {
        throw new AppError('REVENUE_EXISTS', '同仓库、币种、周期和日期的披露已存在；请删除旧记录后重新录入。', 409);
      }
      const item = { id: randomUUID(), ...value, createdAt: new Date(now()).toISOString() };
      next.revenues.push(item);
      return item;
    });
  }
  function removeRevenue(id) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new AppError('INVALID_REVENUE', '收入记录 ID 无效。');
    return mutate((next) => {
      const index = next.revenues.findIndex((item) => item.id === id);
      if (index === -1) throw new AppError('REVENUE_NOT_FOUND', '收入披露记录不存在。', 404);
      next.revenues.splice(index, 1);
      return { ok: true };
    });
  }
  function ranking(query) { return state.rankings[query] ? clone(state.rankings[query]) : null; }
  function saveRanking(query, result) {
    return mutate((next) => {
      next.rankings[query] = clone(result);
      const entries = Object.entries(next.rankings).sort((a, b) => Date.parse(b[1].meta.fetchedAt) - Date.parse(a[1].meta.fetchedAt));
      next.rankings = Object.fromEntries(entries.slice(0, 50));
    });
  }
  function cachedRepo(name) {
    const key = keyOf(name);
    const candidates = state.monitors.filter((item) => keyOf(item.repo.fullName) === key).map(({ repo: item, fetchedAt }) => ({ item, fetchedAt }));
    for (const entry of Object.values(state.rankings)) {
      const item = entry.items.find((repo) => keyOf(repo.fullName) === key);
      if (item) candidates.push({ item, fetchedAt: entry.meta.fetchedAt });
    }
    candidates.sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt));
    return candidates[0] ? clone(candidates[0]) : null;
  }
  return { monitors, refreshTargets, history, growth, addMonitor, removeMonitor, recordRefresh, addRevenue, removeRevenue, ranking, saveRanking, cachedRepo,
    revenues: () => clone(state.revenues), lastRefreshAt: () => state.lastRefreshAt, refreshErrors: () => clone(state.lastRefreshErrors),
    exportData: () => ({ version: 1, exportedAt: new Date(now()).toISOString(), monitors: monitors().map((repo) => ({ ...repo, history: history(repo.fullName) })), revenues: clone(state.revenues) }),
  };
}
