import { AppError } from './errors.mjs';

const CACHE_MS = 15 * 60 * 1000;
const CONTROL = /[\u0000-\u001f\u007f]/;
const SCOPE = 'GitHub 搜索 API 返回的前 50 个公开、非 Fork、未归档仓库，按 Star 降序；并非完整 GitHub 数据库。';

export function normalizeRepoName(value) {
  const invalid = () => new AppError('INVALID_REPO', '请输入 owner/repo 或完整 GitHub 仓库网址。');
  if (typeof value !== 'string' || CONTROL.test(value) || value.length > 300) throw invalid();
  let name = value.trim();
  if (/^https?:\/\//i.test(name)) {
    let url;
    try { url = new URL(name); } catch { throw invalid(); }
    if (url.hostname.toLowerCase() !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) throw invalid();
    name = url.pathname.replace(/^\//, '').replace(/\/$/, '').replace(/\.git$/, '');
  }
  const parts = name.split('/');
  if (parts.length !== 2 || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(parts[0]) || parts[0].includes('--')
      || !/^[A-Za-z0-9_.-]{1,100}$/.test(parts[1]) || ['.', '..'].includes(parts[1])) throw invalid();
  return parts.join('/');
}

function searchInput(input, now) {
  const invalid = () => new AppError('INVALID_SEARCH', '搜索条件无效：请使用简短关键词、语言或主题名称。');
  for (const key of Object.keys(input)) if (!['language', 'topic', 'q', 'new', 'fresh'].includes(key)) throw invalid();
  const values = {};
  for (const key of ['language', 'topic', 'q', 'new', 'fresh']) {
    if (input[key] !== undefined && typeof input[key] !== 'string') throw invalid();
    if (CONTROL.test(input[key] || '')) throw invalid();
    values[key] = (input[key] || '').trim();
  }
  if (values.language.length > 40 || /[:"<>]/.test(values.language)
      || (values.language && !/^[\p{L}\p{N} #+._-]+$/u.test(values.language))
      || values.q.length > 120 || /[:"<>]/.test(values.q)
      || (values.topic && !/^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/.test(values.topic))
      || !['', '1'].includes(values.new) || !['', '1'].includes(values.fresh)) throw invalid();
  const terms = ['stars:>0', 'fork:false', 'archived:false', 'is:public'];
  if (values.language) terms.push(`language:"${values.language}"`);
  if (values.topic) terms.push(`topic:${values.topic.toLowerCase()}`);
  if (values.q) terms.push(`"${values.q}"`);
  if (values.new) terms.push(`created:>=${new Date(now - 30 * 86400000).toISOString().slice(0, 10)}`);
  return { query: terms.join(' '), fresh: values.fresh === '1' };
}

function safeAvatar(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function mapRepo(value) {
  if (!value || typeof value !== 'object') throw new AppError('GITHUB_UNAVAILABLE', 'GitHub 返回了无效数据，请稍后重试。', 502);
  if (value.private === true) throw new AppError('GITHUB_NOT_FOUND', '未找到公开 GitHub 仓库，请检查名称。', 404);
  let fullName;
  try { fullName = normalizeRepoName(value.full_name); } catch { throw new AppError('GITHUB_UNAVAILABLE', 'GitHub 返回了无效仓库数据。', 502); }
  if (!Number.isSafeInteger(value.stargazers_count) || value.stargazers_count < 0 || !Number.isSafeInteger(value.forks_count) || value.forks_count < 0) {
    throw new AppError('GITHUB_UNAVAILABLE', 'GitHub 返回了无效统计数据。', 502);
  }
  return {
    fullName, name: fullName.split('/')[1], owner: fullName.split('/')[0], description: typeof value.description === 'string' ? value.description : '',
    url: `https://github.com/${fullName}`, stars: value.stargazers_count, forks: value.forks_count,
    language: typeof value.language === 'string' ? value.language : null,
    topics: Array.isArray(value.topics) ? value.topics.filter((topic) => typeof topic === 'string').slice(0, 100) : [],
    createdAt: typeof value.created_at === 'string' ? value.created_at : null, updatedAt: typeof value.updated_at === 'string' ? value.updated_at : null,
    pushedAt: typeof value.pushed_at === 'string' ? value.pushed_at : null, archived: value.archived === true,
    license: value.license?.spdx_id && value.license.spdx_id !== 'NOASSERTION' ? value.license.spdx_id : (value.license?.name || null),
    ownerAvatar: safeAvatar(value.owner?.avatar_url),
  };
}

export function createGitHubClient({ store, token = '', fetchImpl = fetch, now = Date.now, timeoutMs = 12000 }) {
  const inFlight = new Map();
  async function request(path, params) {
    const url = new URL(path, 'https://api.github.com');
    if (params) url.search = new URLSearchParams(params).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'StarScope-local' };
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const response = await fetchImpl(url.href, { headers, signal: controller.signal });
      if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
        throw new AppError('GITHUB_RATE_LIMIT', 'GitHub API 已限流，请稍后重试或在服务端配置 GITHUB_TOKEN。', 429);
      }
      if (response.status === 401) throw new AppError('GITHUB_AUTH', 'GitHub Token 无效，请检查服务端配置。', 502);
      if (response.status === 404) throw new AppError('GITHUB_NOT_FOUND', '未找到公开 GitHub 仓库，请检查名称。', 404);
      if (!response.ok) throw new AppError('GITHUB_UNAVAILABLE', 'GitHub 暂时无法访问，请稍后重试。', 502);
      try { return await response.json(); } catch {
        if (controller.signal.aborted) throw new AppError('GITHUB_TIMEOUT', 'GitHub 请求超时，请稍后重试。', 504);
        throw new AppError('GITHUB_UNAVAILABLE', 'GitHub 返回了无效数据，请稍后重试。', 502);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (controller.signal.aborted) throw new AppError('GITHUB_TIMEOUT', 'GitHub 请求超时，请稍后重试。', 504);
      throw new AppError('GITHUB_UNAVAILABLE', 'GitHub 网络请求失败，请稍后重试。', 502);
    } finally { clearTimeout(timer); }
  }
  async function rankings(input = {}) {
    const { query, fresh } = searchInput(input, now());
    const cached = store.ranking(query);
    if (!fresh && cached && now() - Date.parse(cached.meta.fetchedAt) < CACHE_MS) {
      return { ...cached, meta: { ...cached.meta, source: 'cache', stale: false } };
    }
    if (inFlight.has(query)) return inFlight.get(query);
    const operation = (async () => {
      try {
        const raw = await request('/search/repositories', { q: query, sort: 'stars', order: 'desc', per_page: '50' });
        if (!Array.isArray(raw.items) || !Number.isSafeInteger(raw.total_count)) throw new AppError('GITHUB_UNAVAILABLE', 'GitHub 返回了无效搜索数据。', 502);
        const result = { items: raw.items.slice(0, 50).map(mapRepo).sort((a, b) => b.stars - a.stars), meta: {
          source: 'github-api', fetchedAt: new Date(now()).toISOString(), stale: false, totalCount: raw.total_count, incompleteResults: raw.incomplete_results === true, scope: SCOPE,
        } };
        await store.saveRanking(query, result);
        return result;
      } catch (error) {
        if (cached && error instanceof AppError) return { ...cached, meta: { ...cached.meta, source: 'cache', stale: true, warning: error.message } };
        throw error;
      }
    })();
    inFlight.set(query, operation);
    try { return await operation; } finally { inFlight.delete(query); }
  }
  async function repository(value, { fresh = false } = {}) {
    const name = normalizeRepoName(value);
    const cached = store.cachedRepo(name);
    if (!fresh && cached && now() - Date.parse(cached.fetchedAt) < CACHE_MS) return { item: cached.item, meta: { source: 'cache', fetchedAt: cached.fetchedAt, stale: false } };
    try {
      const raw = await request(`/repos/${name.split('/').map(encodeURIComponent).join('/')}`);
      return { item: mapRepo(raw), meta: { source: 'github-api', fetchedAt: new Date(now()).toISOString(), stale: false } };
    } catch (error) {
      if (!fresh && cached && error instanceof AppError) return { item: cached.item, meta: { source: 'cache', fetchedAt: cached.fetchedAt, stale: true, warning: error.message } };
      throw error;
    }
  }
  return { rankings, repository };
}
