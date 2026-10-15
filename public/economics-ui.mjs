export const ECONOMIC_CASES = Object.freeze([
  { key: 'conservative', label: '保守' },
  { key: 'base', label: '基准' },
  { key: 'optimistic', label: '积极' },
]);

export function parseEconomicScenarioForm(values) {
  const cases = {};
  for (const { key } of ECONOMIC_CASES) {
    cases[key] = {};
    for (const field of ['activeRate', 'paidRate', 'monthlyPrice']) {
      const raw = values[`${key}.${field}`];
      if (typeof raw !== 'string' || !raw.trim() || !Number.isFinite(Number(raw))) {
        throw new RangeError('请填写三档完整且有效的数值。');
      }
      cases[key][field] = Number(raw) / (field === 'monthlyPrice' ? 1 : 100);
    }
  }
  return { currency: values.currency, cases };
}

export function readScenarioPreference(storage, key, normalize, fallback) {
  try {
    const saved = storage.getItem(key);
    return normalize(saved ? JSON.parse(saved) : fallback);
  } catch {
    return normalize(fallback);
  }
}

export function writeScenarioPreference(storage, key, scenario) {
  try { storage.setItem(key, JSON.stringify(scenario)); return true; }
  catch { return false; }
}

export function economicCSVData(repos, { scenario, sort = 'base', fetchedAt = '' }) {
  const headers = ['排名', '项目', '研究规则分', '粗类别', '关注度分项', '采用度分项', '维护度分项', '类别适配分项', '指标完整度', 'Star', '保守模拟月收入', '基准模拟月收入', '积极模拟月收入', '测算币种', '模拟标识'];
  for (const { label } of ECONOMIC_CASES) headers.push(`${label}假设活跃比例`, `${label}假设付费比例`, `${label}假设月客单价`);
  headers.push('校准状态', '成本口径', '排序', 'GitHub', '指标采集时间');
  const rows = repos.map((repo, index) => {
    const value = repo.economic;
    const row = [index + 1, repo.fullName, value.score, value.category, value.components.attention, value.components.adoption ?? '未知', value.components.maintenance ?? '未知', value.components.category, value.coverage, repo.stars, value.monthly.conservative, value.monthly.base, value.monthly.optimistic, scenario.currency, '假设测算，非实际收入'];
    for (const { key } of ECONOMIC_CASES) row.push(scenario.cases[key].activeRate, scenario.cases[key].paidRate, scenario.cases[key].monthlyPrice);
    row.push('未经真实收入样本校准；实际收入可能为零', '未扣除成本，非利润', sort === 'score' ? '研究规则分' : '基准模拟月收入', repo.url, repo.fetchedAt || fetchedAt);
    return row;
  });
  return { headers, rows };
}
