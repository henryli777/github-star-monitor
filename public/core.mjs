const compactNumber = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? compactNumber.format(value)
    : '—';
}

export function formatMoney(value, currency = 'USD') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
    }).format(value);
  } catch {
    return '—';
  }
}

export function normalizeRepoInput(value) {
  if (typeof value !== 'string') return '';
  const match = value.trim().match(/^(?:https:\/\/github\.com\/)?([^/]+)\/([^/]+)\/?$/i);
  if (!match) return '';
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, '');
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(owner)) return '';
  if (!/^[a-z\d_.-]{1,100}$/i.test(repo) || repo === '.' || repo === '..') return '';
  return `${owner}/${repo}`;
}

function descendingMetric(first, second) {
  const firstKnown = typeof first === 'number' && Number.isFinite(first);
  const secondKnown = typeof second === 'number' && Number.isFinite(second);
  if (!firstKnown) return secondKnown ? 1 : 0;
  if (!secondKnown) return -1;
  return second - first;
}

export function selectRevenues(items, { currency = 'USD', period = 'monthly', query = '' } = {}) {
  const latest = new Map();
  const needle = String(query).trim().toLowerCase();
  for (const item of items) {
    if (item.currency !== currency || item.period !== period) continue;
    const key = item.repo.toLowerCase();
    if (needle && !key.includes(needle)) continue;
    const previous = latest.get(key);
    if (!previous || item.date > previous.date) latest.set(key, item);
  }
  return [...latest.values()].sort((first, second) => descendingMetric(first.amount, second.amount));
}

export function filterRepos(items, { query = '', language = '', topic = '', sort = 'stars' } = {}) {
  const needle = String(query).trim().toLowerCase();
  const languageNeedle = String(language).trim().toLowerCase();
  const topicNeedle = String(topic).trim().toLowerCase();
  const filtered = items.filter((item) => {
    const topics = Array.isArray(item.topics) ? item.topics : [];
    const searchable = [item.fullName, item.name, item.description, ...topics].join(' ').toLowerCase();
    return (!needle || searchable.includes(needle))
      && (!languageNeedle || String(item.language ?? '').toLowerCase() === languageNeedle)
      && (!topicNeedle || topics.some((value) => String(value).toLowerCase() === topicNeedle));
  });
  const sortField = String(sort).replace(/^growth\./, '');
  const growthPeriod = ['day', 'week', 'month'].includes(sortField) ? sortField : null;
  return filtered.sort((first, second) => descendingMetric(
    growthPeriod ? first.growth?.[growthPeriod] : first.stars,
    growthPeriod ? second.growth?.[growthPeriod] : second.stars,
  ));
}

export function escapeHtml(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, (character) => entities[character]);
}

export function safeSourceUrl(value) {
  if (typeof value !== 'string') return '';
  const input = value.trim();
  if (/[\u0000-\u001f\u007f]/.test(input)) return '';
  try {
    const url = new URL(input);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    return url.href;
  } catch {
    return '';
  }
}

export function toCSV(headers, rows) {
  const cell = (value) => {
    let text = String(value ?? '');
    if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `\uFEFF${[headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}`;
}
