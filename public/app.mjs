import { formatNumber, formatMoney, normalizeRepoInput, selectRevenues, filterRepos, escapeHtml, safeSourceUrl, toCSV, snapshotAge } from './core.mjs';
import { createModalController } from './modal-controller.mjs';
import { createRefreshController } from './refresh-controller.mjs';
import { DEFAULT_SCENARIO, normalizeScenario, rankPotential, evaluatePotential } from './potential.mjs';
import { DEFAULT_ECONOMIC_SCENARIO, normalizeEconomicScenario, rankEconomicValues, evaluateEconomicValue } from './economics.mjs';
import { ECONOMIC_CASES, parseEconomicScenarioForm, readScenarioPreference, writeScenarioPreference, economicCSVData } from './economics-ui.mjs';

const $ = (selector) => document.querySelector(selector);
const e = escapeHtml;
const paths = {
  chart: '<path d="M4 19h16M6 15V9m6 6V5m6 10v-4"/>',
  sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4m-2-2h4"/>',
  wallet: '<path d="M20 8V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v12H6a3 3 0 0 1-3-3V6m17 6h-5v5h5m-2-2h.01"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  github: '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9c0-1.1-.3-1.9-1-2.4 3.4-.4 7-1.7 7-7.7 0-1.7-.6-3-1.6-4.1.2-1 .2-2.2-.2-3.9 0 0-1.2-.4-4.2 1.6a14.5 14.5 0 0 0-8 0C5 .6 3.8 1 3.8 1c-.4 1.7-.4 2.9-.2 3.9C2.6 6 2 7.3 2 9c0 6 3.6 7.3 7 7.7-.7.5-1 1.3-1 2.4V23" transform="translate(2 1) scale(.84)"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5zm-9 10 9 5 9-5M3 18l9 5 9-5"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3L7.5 14 3 9.6l6.2-.9z"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14-5L3 9m0-6v6h6m-5 4a8 8 0 0 0 14 5l3-3m0 6v-6h-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-16-2 20"/>',
  activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zm-4 9 3 3 5-6"/>',
  external: '<path d="M14 3h7v7m0-7L10 14m-3-9H3v16h16v-4"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.star}</svg>`;
function hydrateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); }); }
hydrateIcons();

const viewNames = { potential: '变现潜力', ranking: 'Star 排行', new: '新晋热门', revenue: '商业价值', monitors: '公开监控', sources: '数据说明' };
const scenarioStorageKey = 'starscope-potential-scenario-v1';
const economicStorageKey = 'starscope-economic-scenario-v1';
const economicStorage = { getItem: (key) => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) };
function readScenario() {
  try { const saved = localStorage.getItem(scenarioStorageKey); return normalizeScenario(saved ? JSON.parse(saved) : DEFAULT_SCENARIO); }
  catch { return normalizeScenario(DEFAULT_SCENARIO); }
}
const state = { view: 'potential', sort: 'stars', potentialSort: 'score', scenario: readScenario(), economicTab: 'scenario', economicSort: 'base', economicScenario: readScenarioPreference(economicStorage, economicStorageKey, normalizeEconomicScenario, DEFAULT_ECONOMIC_SCENARIO), query: '', language: '', topic: '', currency: 'USD', period: 'monthly', rankings: [], monitors: [], revenues: [], meta: null, status: null, monitorErrors: [], loading: true, error: '', syncError: '', busy: false, request: 0, workspaceRequest: 0 };
const initialView = location.hash.slice(1);
if (viewNames[initialView]) state.view = initialView;
let searchTimer, toastTimer;
const modalController = createModalController($('#modal'), (content) => { $('#modal-content').innerHTML = content; hydrateIcons($('#modal')); });

async function api(path, options = {}) {
  if (!canWrite() && !['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase())) throw new Error('公开站点只提供查看，管理操作请在本机进行。');
  const { timeoutMs = 25000, ...requestOptions } = options;
  const response = await fetch(path, { ...requestOptions, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, signal: AbortSignal.timeout(timeoutMs) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || `请求失败（${response.status}）`);
  return payload;
}
function toast(message, error = false) {
  clearTimeout(toastTimer);
  const el = $('#toast'); el.textContent = message; el.classList.toggle('error', error); el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, error ? 7000 : 3500);
}
function localDate(value, time = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return '尚未采集';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', ...(time ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}) }).format(new Date(value));
}
function today() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function relativeDate(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 86400000));
  if (days < 1) return '今天'; if (days < 30) return `${days} 天前`; if (days < 365) return `${Math.floor(days / 30)} 月前`; return `${Math.floor(days / 365)} 年前`;
}
function canWrite() { return state.status?.readOnly === false; }
function isEconomicScenario() { return state.view === 'revenue' && state.economicTab === 'scenario'; }
function isDisclosure() { return state.view === 'revenue' && state.economicTab === 'disclosed'; }
function usesRankings() { return (['potential', 'ranking', 'new'].includes(state.view) || isEconomicScenario()) && state.sort === 'stars'; }
function usesMonitors() { return state.view === 'monitors' || state.view === 'ranking' && state.sort !== 'stars'; }
function scenarioPercent(value) { return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(value * 100); }
function coveragePercent(value) { return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value * 100); }
function renderScenarioSummary() {
  const scenario = state.scenario;
  $('#scenario-summary').textContent = `活跃 ${scenarioPercent(scenario.activeRate)}% · 付费 ${scenarioPercent(scenario.paidRate)}% · 假设月客单价 ${formatMoney(scenario.monthlyPrice, scenario.currency)} ${scenario.currency}`;
  document.querySelectorAll('[data-potential-sort]').forEach((button) => { const active = button.dataset.potentialSort === state.potentialSort; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
}
function populateScenarioForm() {
  $('#scenario-active').value = state.scenario.activeRate * 100;
  $('#scenario-paid').value = state.scenario.paidRate * 100;
  $('#scenario-price').value = state.scenario.monthlyPrice;
  $('#scenario-currency').value = state.scenario.currency;
  $('#scenario-error').hidden = true;
  $('#scenario-form').querySelectorAll('[aria-invalid]').forEach((input) => input.removeAttribute('aria-invalid'));
}
function updateScenario() {
  const form = $('#scenario-form'), error = $('#scenario-error');
  const inputs = [...form.querySelectorAll('input')];
  const invalid = inputs.filter((input) => input.value.trim() === '' || !input.validity.valid || !Number.isFinite(Number(input.value)));
  inputs.forEach((input) => input.setAttribute('aria-invalid', String(invalid.includes(input))));
  if (invalid.length) {
    error.textContent = '活跃与付费比例须为 0–100，月客单价须为 0–100000。当前继续显示上一次有效假设的模拟月收入。';
    error.hidden = false; return;
  }
  try {
    state.scenario = normalizeScenario({ activeRate: Number($('#scenario-active').value) / 100, paidRate: Number($('#scenario-paid').value) / 100, monthlyPrice: Number($('#scenario-price').value), currency: $('#scenario-currency').value });
    error.hidden = true;
    try { localStorage.setItem(scenarioStorageKey, JSON.stringify(state.scenario)); } catch {}
    renderTable();
  } catch (failure) { error.textContent = failure.message; error.hidden = false; }
}
function renderEconomicScenarioSummary() {
  const scenario = state.economicScenario;
  $('#economic-scenario-summary').textContent = ECONOMIC_CASES.map(({ key, label }) => `${label}：活跃 ${scenarioPercent(scenario.cases[key].activeRate)}% × 付费 ${scenarioPercent(scenario.cases[key].paidRate)}% × ${formatMoney(scenario.cases[key].monthlyPrice, scenario.currency)}`).join(' · ');
  $('#economic-sort').value = state.economicSort;
  document.querySelectorAll('[data-economic-tab]').forEach((button) => {
    const active = button.dataset.economicTab === state.economicTab;
    button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
  });
}
function populateEconomicScenarioForm() {
  const form = $('#economic-scenario-form');
  for (const { key } of ECONOMIC_CASES) for (const field of ['activeRate', 'paidRate', 'monthlyPrice']) form.elements.namedItem(`${key}.${field}`).value = state.economicScenario.cases[key][field] * (field === 'monthlyPrice' ? 1 : 100);
  $('#economic-scenario-currency').value = state.economicScenario.currency;
  $('#economic-scenario-error').hidden = true;
  form.querySelectorAll('[aria-invalid]').forEach((input) => input.removeAttribute('aria-invalid'));
}
function updateEconomicScenario() {
  const form = $('#economic-scenario-form'), error = $('#economic-scenario-error'), inputs = [...form.querySelectorAll('input')];
  const invalid = inputs.filter((input) => !input.value.trim() || !input.validity.valid || !Number.isFinite(Number(input.value)));
  inputs.forEach((input) => input.setAttribute('aria-invalid', String(invalid.includes(input))));
  if (invalid.length) {
    error.textContent = '活跃与付费比例须为 0–100，月客单价须为 0–100000。当前继续显示上一次有效假设的测算结果。';
    error.hidden = false; return;
  }
  try {
    const scenario = normalizeEconomicScenario(parseEconomicScenarioForm(Object.fromEntries(new FormData(form))));
    state.economicScenario = scenario;
    error.hidden = true;
    writeScenarioPreference(economicStorage, economicStorageKey, scenario);
    renderTable();
  } catch {
    error.textContent = '三档每 Star 模拟金额须满足保守 ≤ 基准 ≤ 积极；请调整比例或月客单价。当前继续显示上一次有效假设的测算结果。';
    error.hidden = false;
  }
}
function isMonitored(name) { return state.monitors.some((repo) => repo.fullName.toLowerCase() === name.toLowerCase()); }
function avatar(repo, index = 0) { const initials = (repo.owner || repo.repo?.split('/')[0] || repo.fullName?.split('/')[0] || '?').slice(0, 2).toUpperCase(); return `<span class="repo-avatar avatar-tone-${index % 5}">${e(initials)}</span>`; }
function growthHTML(value) { if (value == null) return '<span class="metric-null" title="真实历史不足">—</span>'; return `<span class="${value >= 0 ? 'growth-positive' : 'growth-negative'}">${value > 0 ? '+' : ''}${e(formatNumber(value))}</span>`; }
function monitorButton(repo) { if (!canWrite()) return ''; const saved = isMonitored(repo.fullName); return `<button class="table-monitor-button ${saved ? 'saved' : ''}" data-action="${saved ? 'remove-monitor' : 'monitor'}" data-repo="${e(repo.fullName)}" aria-label="${saved ? '移除监控' : '监控'} ${e(repo.fullName)}" title="${saved ? '已监控，点击移除' : '添加到监控'}">${icon(saved ? 'check' : 'plus')}</button>`; }
function visibleRepos() {
  const fromMonitors = usesMonitors();
  const items = fromMonitors ? state.monitors : state.rankings;
  const filtered = filterRepos(items, { query: fromMonitors || state.view === 'potential' || isEconomicScenario() ? state.query : '', language: state.language, topic: state.topic, sort: state.sort });
  if (isEconomicScenario()) return rankEconomicValues(filtered, { now: Date.now(), scenario: state.economicScenario, sort: state.economicSort });
  if (state.view !== 'potential') return filtered;
  const ranked = rankPotential(filtered, { now: Date.now(), scenario: state.scenario });
  if (state.potentialSort === 'score') return ranked;
  return ranked.sort((first, second) => (state.potentialSort === 'revenue' ? second.potential.monthlyRevenue - first.potential.monthlyRevenue : 0) || second.stars - first.stars || (first.fullName < second.fullName ? -1 : first.fullName > second.fullName ? 1 : 0));
}
function renderStats() {
  $('#stat-projects').textContent = state.loading && !state.rankings.length ? '—' : String(state.rankings.length);
  $('#stat-stars').textContent = state.rankings.length ? formatNumber(state.rankings.reduce((sum, repo) => sum + repo.stars, 0)) : '—';
  $('#stat-monitors').textContent = state.monitors.length;
  $('#nav-monitor-count').textContent = state.monitors.length;
  $('#stat-revenues').textContent = state.revenues.length;
  $('#hero-date').textContent = state.meta?.fetchedAt ? `采集于 ${localDate(state.meta.fetchedAt, true)} · ${snapshotAge(state.meta.fetchedAt)}` : '公开仓库 · 来源可查';
  $('#connection-label').textContent = canWrite() ? state.status?.tokenConfigured ? 'Token 已配置 · 本机管理' : '公开 API · 本机管理' : '公开查看 · 只读';
  $('.connection-version').textContent = `v${state.status?.version || '1.1'}`;
  $('#stat-project-label').textContent = state.view === 'new' ? '新晋榜单项目' : '当前榜单项目';
}
function renderFeatured() {
  const repos = state.rankings.slice(0, 3);
  $('#featured-projects').innerHTML = repos.length ? repos.map((repo, index) => `<article class="featured-item"><div class="featured-top">${avatar(repo, index)}<button class="featured-name" data-action="detail" data-repo="${e(repo.fullName)}">${e(repo.name)}</button></div><p>${e(repo.description || '这个项目暂未填写简介。')}</p><div class="featured-meta"><span><span class="language-dot" data-language="${e(repo.language || '')}"></span>${e(repo.language || '未标注语言')}</span><span class="featured-star">☆ ${e(formatNumber(repo.stars))}</span></div></article>`).join('') : '<p class="muted featured-empty">加载真实榜单后，这里会展示当前排名靠前的项目。</p>';
}
function renderChrome() {
  viewNames.monitors = canWrite() ? '我的监控' : '公开监控';
  document.title = `${viewNames[state.view]} · StarScope`;
  document.querySelectorAll('.nav-item').forEach((btn) => { const active = btn.dataset.view === state.view; btn.classList.toggle('active', active); if (active) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current'); });
  $('#breadcrumb-current').textContent = viewNames[state.view];
  const titles = {
    potential: ['发现开源的<span>变现潜力。</span>', '用透明规则观察项目潜力；模拟月收入是统一假设测算，未经收入样本校准。'],
    ranking: ['看见开源的<span>下一颗明星。</span>', '从热门项目到潜力新作，用真实数据找到值得关注的开源力量。'],
    new: ['新项目，<span>大有可为。</span>', '发现最近 30 天诞生的开源项目，看见尚未被充分发现的潜力。'],
    revenue: ['商业价值，<span>从假设到披露。</span>', '依据真实 GitHub 指标做三档月收入场景测算。未经真实收入样本校准，实际收入可能为零，未扣成本。'],
    monitors: ['记录热爱，<span>看见成长。</span>', canWrite() ? '把值得关注的项目留在这里，用真实快照追踪它们的每一步。' : '查看公开监控项目的真实快照，随着历史积累观察 Star 净增长。'],
    sources: ['信任数字，<span>先了解出处。</span>', '透明的数据来源、清晰的统计口径，让每一次发现都有依据。']
  };
  $('#hero-title').innerHTML = titles[state.view][0]; $('#hero-description').textContent = titles[state.view][1];
  const isIncome = state.view === 'revenue', isSources = state.view === 'sources', isPotential = state.view === 'potential', isDisclosed = isDisclosure(), isEconomic = isEconomicScenario();
  $('#rank-tabs').hidden = !['ranking', 'monitors'].includes(state.view);
  $('#potential-tabs').hidden = !isPotential;
  $('#scenario-section').hidden = !isPotential;
  $('#economic-tabs').hidden = !isIncome;
  $('#economic-scenario-section').hidden = !isEconomic;
  $('#economic-sort-row').hidden = !isEconomic;
  $('#filters').hidden = isSources;
  $('#language-wrap').hidden = isDisclosed;
  $('#currency-wrap').hidden = !isDisclosed;
  $('#period-wrap').hidden = !isDisclosed;
  $('#category-row').hidden = isDisclosed || isSources;
  $('#discovery-column').hidden = isSources;
  $('#content-layout').classList.toggle('sources-layout', isSources);
  $('#export-button').hidden = isSources;
  $('#export-button').disabled = state.loading && usesRankings();
  document.querySelectorAll('[data-admin]').forEach((element) => { element.hidden = !canWrite(); });
  $('#refresh-button').hidden = !canWrite() || isSources || isDisclosed;
  $('#context-add').hidden = !canWrite() || !(state.view === 'monitors' || isDisclosed);
  $('#context-add').innerHTML = `${icon('plus')}<span>${isDisclosed ? '记录收入' : '添加项目'}</span>`;
  $('#search-input').placeholder = isDisclosed ? '搜索项目收入披露…' : usesMonitors() ? '搜索已监控的项目…' : '搜索 GitHub 项目、作者或关键词…';
  if ($('#search-input').value !== state.query) $('#search-input').value = state.query;
  $('#language-select').value = state.language;
  document.querySelectorAll('[data-sort]').forEach((btn) => { btn.classList.toggle('active', btn.dataset.sort === state.sort); btn.setAttribute('aria-pressed', String(btn.dataset.sort === state.sort)); });
  document.querySelectorAll('[data-topic]').forEach((btn) => { btn.classList.toggle('active', btn.dataset.topic === state.topic); btn.setAttribute('aria-pressed', String(btn.dataset.topic === state.topic)); });
  $('#tabs-note').textContent = usesMonitors() ? `仅统计${canWrite() ? '' : '公开'}监控项目` : '公开仓库 · 排除 Fork';
  const heading = $('#panel-title');
  if (state.view === 'ranking') heading.innerHTML = state.sort === 'stars' ? 'Star 排行榜<span class="heading-tag">TOP 50</span>' : `监控增长榜<span class="heading-tag">${{ day: '24 小时', week: '7 天', month: '30 天' }[state.sort]}</span>`;
  else heading.innerHTML = `${e(viewNames[state.view])}${isPotential ? '榜<span class="heading-tag">规则分</span>' : state.view === 'new' ? '<span class="heading-tag">近 30 天</span>' : isIncome ? `<span class="heading-tag">${isEconomic ? '假设测算' : '附来源披露'}</span>` : ''}`;
  $('#panel-description').textContent = state.view === 'ranking' && state.sort !== 'stars' ? '只比较已有完整时间基线的真实监控快照' : ({ potential: '规则分评估项目潜力，模拟月收入单独按统一假设测算', ranking: '发现最受开发者喜爱的开源项目', new: '按 Star 排序，发现近期创建的热门项目', revenue: isEconomic ? '研究规则分与三档模拟月收入 · 完整度为三项真实指标已知比例' : '按同币种、同周期的最新真实披露排序', monitors: canWrite() ? '关注、记录和持续追踪你的开源收藏' : '服务端公开观察列表 · 等待历史积累后产生净增长', sources: '每一个指标的来源与统计边界' }[state.view]);
  $('#monitor-view-label').textContent = viewNames.monitors;
  $('#stat-monitor-label').textContent = `${canWrite() ? '我的' : '公开'}监控项目`;
  $('#monitor-promo-title').textContent = canWrite() ? '喜欢它，就关注它。' : '公开观察，持续记录。';
  $('#monitor-promo-description').textContent = canWrite() ? '把项目加入监控，持续记录 Star 变化，积累属于你的开源观察。' : '公开站点展示服务端监控列表。新加入的项目需要积累历史快照，才能比较日、周、月净增长。';
  renderScenarioSummary(); renderEconomicScenarioSummary(); renderStats(); renderFeatured();
}
function skeleton() { return Array.from({ length: 5 }, () => '<div class="skeleton-row"><div class="skeleton avatar"></div><div class="skeleton-stack"><div class="skeleton text"></div><div class="skeleton small"></div></div><div class="skeleton metric"></div></div>').join(''); }
function empty(title, description, action = '', actionText = '') { const showAction = action && (canWrite() || action === 'retry'); return `<div class="empty-state"><div class="empty-icon">${icon(state.view === 'revenue' ? 'wallet' : 'search')}</div><h3>${e(title)}</h3><p>${e(description)}</p>${showAction ? `<button class="primary-button" data-action="${action}">${icon('plus')}${e(actionText)}</button>` : ''}</div>`; }
function componentLabel(value) { return value == null ? '未知' : `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value)} / 100`; }
function potentialBreakdown(potential) {
  return `<div class="potential-breakdown">${[['attention', '关注度', 30], ['adoption', '采用度', 15], ['maintenance', '维护度', 30], ['category', '类别适配', 25]].map(([key, label, weight]) => `<div><span>${label} · 权重 ${weight}%</span><strong>${e(componentLabel(potential.components[key]))}</strong></div>`).join('')}</div><p class="potential-method-note">缺失分项标为“未知”，规则分按已知权重归一。主题与简介用于粗分类，不代表项目已提供付费产品；分数与模拟月收入均未经收入样本校准。</p>`;
}
function potentialTable(repos) {
  return `<table class="rank-table potential-table"><thead><tr><th scope="col">排名</th><th scope="col" class="repo-col">开源项目</th><th scope="col" class="score-col">潜力规则分</th><th scope="col" class="metric-col">Star 数</th><th scope="col" class="simulated-col">模拟月收入 (${e(state.scenario.currency)})</th><th scope="col" class="potential-category-col">粗类别 / 维护</th>${canWrite() ? '<th scope="col" class="action-col">关注</th>' : ''}</tr></thead><tbody>${repos.map((repo, index) => {
    const potential = repo.potential, split = repo.fullName.split('/');
    const breakdown = `关注度 ${componentLabel(potential.components.attention)}（30%）；采用度 ${componentLabel(potential.components.adoption)}（15%）；维护度 ${componentLabel(potential.components.maintenance)}（30%）；类别适配 ${componentLabel(potential.components.category)}（25%）。缺失分项按已知权重归一。`;
    return `<tr><td><span class="rank-number ${index < 3 ? `top-rank rank-${index + 1}` : ''}">${String(index + 1).padStart(2, '0')}</span></td><td><div class="repo-cell">${avatar(repo, index)}<div class="repo-info"><button class="repo-name" data-action="detail" data-repo="${e(repo.fullName)}" title="${e(repo.fullName)}"><span class="repo-owner">${e(split[0])} / </span>${e(split[1])}</button><p class="repo-desc" title="${e(repo.description || '')}">${e(repo.description || '暂无项目简介')}</p><div class="repo-tags"><span><span class="language-dot" data-language="${e(repo.language || '')}"></span>${e(repo.language || '未标注')}</span><span class="repo-topic">主题粗分类</span></div></div></div></td><td class="metric potential-score-cell" title="${e(breakdown)}"><strong class="potential-score">${e(potential.score)}<span> / 100</span></strong><span class="potential-label">透明规则分</span></td><td class="metric"><span class="star-number" title="${e(repo.stars.toLocaleString('zh-CN'))}"><span>☆</span>${e(formatNumber(repo.stars))}</span></td><td class="metric simulated-cell"><strong class="simulated-amount">${e(formatMoney(potential.monthlyRevenue, state.scenario.currency))}</strong><span class="simulation-label">假设测算 · ${e(state.scenario.currency)}</span><span class="simulation-label">未经收入样本校准</span></td><td><span class="potential-category">${e(potential.category)}</span><span class="potential-maintenance">${potential.components.maintenance == null ? '推送时间未知' : repo.archived ? '已归档' : `推送 ${e(relativeDate(repo.pushedAt))}`}</span></td>${canWrite() ? `<td>${monitorButton(repo)}</td>` : ''}</tr>`;
  }).join('')}</tbody></table>`;
}
function economicAssumption(scenario, key) {
  const item = scenario.cases[key];
  return `活跃 ${scenarioPercent(item.activeRate)}% × 付费 ${scenarioPercent(item.paidRate)}% × 月客单价 ${formatMoney(item.monthlyPrice, scenario.currency)} ${scenario.currency}`;
}
function economicTable(repos) {
  const currency = state.economicScenario.currency;
  return `<table class="rank-table economic-table"><thead><tr><th scope="col">排名</th><th scope="col" class="repo-col">开源项目 / Star</th><th scope="col" class="score-col">研究规则分</th>${ECONOMIC_CASES.map(({ label }) => `<th scope="col" class="economic-amount-col">${label}月收入<span class="economic-column-note">模拟 · ${e(currency)}</span></th>`).join('')}<th scope="col" class="coverage-col">指标完整度</th><th scope="col" class="source-col">GitHub</th></tr></thead><tbody>${repos.map((repo, index) => {
    const value = repo.economic, split = repo.fullName.split('/'), url = safeSourceUrl(repo.url) || `https://github.com/${repo.fullName.split('/').map(encodeURIComponent).join('/')}`;
    const breakdown = `关注度 ${componentLabel(value.components.attention)}（30%）；采用度 ${componentLabel(value.components.adoption)}（15%）；维护度 ${componentLabel(value.components.maintenance)}（30%）；类别适配 ${componentLabel(value.components.category)}（25%）。缺失分项按已知权重归一。`;
    return `<tr><td><span class="rank-number ${index < 3 ? `top-rank rank-${index + 1}` : ''}">${String(index + 1).padStart(2, '0')}</span></td><td><div class="repo-cell">${avatar(repo, index)}<div class="repo-info"><button class="repo-name" data-action="detail" data-repo="${e(repo.fullName)}" title="${e(repo.fullName)}"><span class="repo-owner">${e(split[0])} / </span>${e(split[1])}</button><p class="repo-desc" title="${e(repo.description || '')}">${e(repo.description || '暂无项目简介')}</p><div class="repo-tags"><span><span class="language-dot" data-language="${e(repo.language || '')}"></span>${e(repo.language || '未标注')}</span><span>☆ ${e(formatNumber(repo.stars))}</span></div></div></div></td><td class="metric" title="${e(breakdown)}"><strong class="potential-score">${e(value.score)}<span> / 100</span></strong><span class="potential-label">${e(value.category)}</span></td>${ECONOMIC_CASES.map(({ key }) => `<td class="metric economic-amount-cell" title="${e(economicAssumption(state.economicScenario, key))}"><strong class="simulated-amount">${e(formatMoney(value.monthly[key], currency))}</strong><span class="simulation-label">假设测算</span></td>`).join('')}<td class="metric" title="Star、Fork、维护三项真实指标的已知比例；不代表预测可靠程度"><strong class="coverage-value">${e(coveragePercent(value.coverage))}%</strong><span class="potential-label">真实指标已知比例</span></td><td><a class="source-anchor economic-github" href="${e(url)}" target="_blank" rel="noopener noreferrer" aria-label="在 GitHub 查看 ${e(repo.fullName)}" title="在 GitHub 查看 ${e(repo.fullName)}">${icon('external')}</a></td></tr>`;
  }).join('')}</tbody></table>`;
}
function repoTable(repos) {
  const growth = state.sort !== 'stars';
  return `<table class="rank-table"><thead><tr><th scope="col">排名</th><th scope="col" class="repo-col">开源项目</th><th scope="col" class="metric-col">${growth ? { day: '日净增长', week: '周净增长', month: '月净增长' }[state.sort] : 'Star 数'}</th><th scope="col" class="forks-col">Fork</th><th scope="col" class="updated-col">最近推送</th>${canWrite() ? '<th scope="col" class="action-col"><span aria-label="监控">关注</span></th>' : ''}</tr></thead><tbody>${repos.map((repo, i) => {
    const split = repo.fullName.split('/');
    const topics = (repo.topics || []).slice(0, 2);
    return `<tr><td><span class="rank-number ${i < 3 ? `top-rank rank-${i + 1}` : ''}">${String(i + 1).padStart(2, '0')}</span></td><td><div class="repo-cell">${avatar(repo, i)}<div class="repo-info"><button class="repo-name" data-action="detail" data-repo="${e(repo.fullName)}" title="${e(repo.fullName)}"><span class="repo-owner">${e(split[0])} / </span>${e(split[1])}</button><p class="repo-desc" title="${e(repo.description || '')}">${e(repo.description || '暂无项目简介')}</p><div class="repo-tags"><span><span class="language-dot" data-language="${e(repo.language || '')}"></span>${e(repo.language || '未标注')}</span>${topics.map((topic) => `<span class="repo-topic">${e(topic)}</span>`).join('')}${repo.fetchedAt && (state.view === 'monitors' || state.sort !== 'stars') ? `<span class="collection-time" title="实际采集于 ${e(repo.fetchedAt)}">采集 ${e(localDate(repo.fetchedAt, true))}</span>` : ''}</div></div></div></td><td class="metric"><span class="star-number" title="${e(growth ? repo.growth?.[state.sort] == null ? '历史不足' : String(repo.growth[state.sort]) : repo.stars.toLocaleString('zh-CN'))}">${growth ? growthHTML(repo.growth?.[state.sort]) : `<span>☆</span>${e(formatNumber(repo.stars))}`}</span></td><td class="metric forks-cell muted">${e(formatNumber(repo.forks))}</td><td class="updated-cell"><span class="update-label" title="${e(repo.pushedAt || '')}">${e(relativeDate(repo.pushedAt))}</span></td>${canWrite() ? `<td>${monitorButton(repo)}</td>` : ''}</tr>`;
  }).join('')}</tbody></table>`;
}
function revenueTable(records) {
  return `<table class="rank-table revenue-table"><thead><tr><th scope="col">排名</th><th scope="col" class="repo-col">项目 / 披露口径</th><th scope="col" class="amount-col">${state.period === 'monthly' ? '月度' : state.period === 'yearly' ? '年度' : '单次'}披露金额</th><th scope="col" class="date-col">披露日期</th><th scope="col" class="source-col">来源</th>${canWrite() ? '<th scope="col" class="action-col">操作</th>' : ''}</tr></thead><tbody>${records.map((record, i) => `<tr><td><span class="rank-number ${i < 3 ? `top-rank rank-${i + 1}` : ''}">${String(i + 1).padStart(2, '0')}</span></td><td><div class="repo-cell">${avatar(record, i)}<div class="repo-info"><button class="repo-name" data-action="detail" data-repo="${e(record.repo)}">${e(record.repo)}</button><div class="revenue-note" title="${e(record.notes || '')}">${e(record.notes || '来源方披露 · 未经本站审计')}</div><div class="revenue-label-row"><span class="revenue-badge">披露声明</span></div></div></div></td><td class="metric"><span class="revenue-amount">${e(formatMoney(record.amount, record.currency))}</span></td><td class="date-cell"><span class="update-label">${e(record.date)}</span></td><td><a class="source-anchor" href="${e(safeSourceUrl(record.sourceUrl))}" target="_blank" rel="noopener noreferrer">原文 ${icon('external')}</a></td>${canWrite() ? `<td><button class="table-monitor-button" data-action="remove-revenue" data-id="${e(record.id)}" aria-label="删除 ${e(record.repo)} 收入记录">${icon('trash')}</button></td>` : ''}</tr>`).join('')}</tbody></table>`;
}
function renderSources() {
  return `<div class="sources-content">
    <section class="source-block"><h3>${icon('github')} GitHub 官方数据</h3><p>项目 Star、Fork、语言、简介、主题及更新时间来自 <a href="https://docs.github.com/en/rest/search/search?apiVersion=2022-11-28#search-repositories" target="_blank" rel="noopener noreferrer">GitHub REST API</a>。榜单排除 Fork 与已归档仓库，取按 Star 降序排列的前 50 个搜索结果。潜力榜与商业价值场景测算在这批真实项目中重新排序，不能代表整个 GitHub。选择语言、主题或关键词后，排名只对应当前查询。</p><p>“新晋热门”指最近 30 天创建的仓库，并不等于近 30 天增长最快。GitHub 搜索可能返回不完整结果，页面会显示此状态。</p><div class="source-info-grid"><div class="source-info"><span>榜单缓存</span>15 分钟；请求失败时保留缓存</div><div class="source-info"><span>最近采集</span>${e(localDate(state.meta?.fetchedAt, true))}</div><div class="source-info"><span>服务端认证</span>${state.status?.tokenConfigured ? '已配置 Token，权限以实际请求为准' : '公开接口，无需登录即可尝试'}</div><div class="source-info"><span>当前访问模式</span>${canWrite() ? '本机管理，可维护监控与披露记录' : '公开只读，管理操作仅在本机开放'}</div></div><p>未认证的常规接口通常为每小时 60 次，搜索接口另有限额。服务端配置 Token 可提高额度，具体仍取决于 GitHub 的限制；密钥不会发给浏览器。</p></section>
    <section class="source-block"><h3>${icon('chart')} 变现潜力规则与模拟月收入</h3><p>规则分为 0–100：关注度 30%、采用度 15%、维护度 30%、类别适配 25%。关注度按 log10(Star + 1) 计算，10 万 Star 达到分项上限；采用度按 log10(Fork + 1) 计算，1 万 Fork 达到上限。维护度按最近推送距今不超过 30、90、180、365 天分别记 100、80、60、35 分，超过一年或归档记 0 分。Fork 或推送时间缺失时分项标记未知，总分按已知权重归一。</p><p>类别按 topics 和项目简介粗分：开发工具/基础设施 100 分、应用产品 85 分、学习资料 20 分、其他 50 分；学习类标签优先。类别不代表项目已有付费产品。规则分并未使用真实收入样本校准，也不表示成功概率。</p><p>模拟月收入 = Star × 假设活跃用户比例 × 假设付费比例 × 假设月客单价。Star 不是用户数，用户数也不是付费人数。这是未经收入样本校准的假设测算，不能视为项目实际收入或预测。统一参数下，模拟金额仍按 Star 高低排列。CNY、USD、EUR 只作为假设的计价单位，不进行汇率转换或跨币种比较。</p><p>默认假设为活跃比例 10%、付费比例 2%、月客单价 CNY 50；例如 10,000 Star 对应模拟月收入 CNY 1,000，未经收入样本校准。参数只保存在当前浏览器，CSV 导出附带模拟标记和完整假设。</p></section>
    <section class="source-block"><h3>${icon('activity')} 监控与净增长</h3><p>服务运行期间，每小时尝试为已监控项目采集一次真实快照。关闭浏览器不影响正在运行的服务；停止服务后采集也会停止。最多监控 30 个项目。</p><p>日、周、月增长分别比较 24 小时、7 天、30 天前的快照。只有目标时间附近已有有效基线，才会显示净增长；首个快照及历史不足均显示“—”。取消 Star 可能造成负增长。增长榜只覆盖${canWrite() ? '当前' : '公开'}监控列表，不能代表整个 GitHub。</p></section>
    <section class="source-block"><h3>${icon('wallet')} 商业价值场景测算</h3><p>研究规则分复用潜力榜的关注度、采用度、维护度、类别适配规则，未经真实收入样本校准，不表示商业成功概率。指标完整度是 Star、Fork、维护三项真实指标的已知比例，即已知项数除以 3；例如 Fork 与推送时间缺失时为 33.3%。推断的类别不计入真实指标，完整度也不表示收入预测的可信度。</p><p>保守、基准、积极三档分别按 Star × 假设活跃比例 × 假设付费比例 × 假设月客单价测算月收入。默认保守为 1% × 0.5% × CNY 20，基准为 5% × 1% × CNY 50，积极为 10% × 2% × CNY 100；10,000 Star 分别对应 CNY 10、250、2,000。三档每 Star 金额必须非递减。统一参数下，按基准模拟月收入排序仍与 Star 排序一致。</p><p>Star 不是实际用户数，付费转化与价格均是假设。三档不来自统计置信区间，未经真实收入样本校准，实际收入可能为零；金额未扣成本，不代表利润或公司估值。币种仅为假设计价单位，不做汇率换算。参数保存在当前访客浏览器，与潜力页参数独立；场景 CSV 包含完整三档假设、币种、模拟标识、指标分项、完整度及实际采集时间。测算结果不会写入收入披露记录。</p></section>
    <section class="source-block"><h3>${icon('wallet')} 真实披露与商业口径</h3><p>GitHub 接口不提供项目收入。商业价值页的“真实披露”标签仅按手动录入的来源声明排序，包含披露日期、币种、周期和原文链接。每个项目在同币种、同周期下采用最新记录，不累加历史披露，也不转换币种。场景测算不参与该榜单；暂无披露表示没有记录，不表示项目收入为零。</p><p>MRR、ARR 是收入运行率，与实际到账收入、利润和融资额不同。记录时请在“披露口径”中注明。数字由来源方披露，本站未进行财务审计。</p><p>公开参考：<a href="https://ghost.org/about/" target="_blank" rel="noopener noreferrer">Ghost 官方财务页面</a>在 2026-10-11 采集时显示 MRR $927,714、ARR $11,132,578。原文只标注“$”，未明确币种，故此参考不纳入 USD/CNY/EUR 排名；原文也未标注披露日期。</p></section>
    <section class="source-block"><h3>${icon('database')} 服务端保存与导出</h3><p>监控项目、采集快照、收入记录和榜单缓存保存于服务端 <code>data/</code>，不依赖当前浏览器。公开站点展示这一服务的公开监控和披露数据，管理操作在本机进行。榜单右上角可导出当前视图的 CSV，顶栏下载按钮可下载完整公开工作空间 JSON。</p><p>备份包含项目与披露记录，不包含 GitHub Token。首版不提供登录、支付功能或个人私有工作空间。</p></section></div>`;
}
function renderTable() {
  renderTableContent();
  if (state.syncError && !state.loading) {
    const notice = $('#data-notice');
    notice.textContent = `${notice.hidden ? '' : `${notice.textContent} `}${state.syncError}`;
    notice.hidden = false; notice.classList.add('warning');
  }
}
function renderTableContent() {
  renderChrome();
  const area = $('#table-area'), notice = $('#data-notice');
  area.setAttribute('aria-busy', String(state.loading)); notice.hidden = true; notice.classList.remove('warning');
  if (state.view === 'sources') { area.innerHTML = renderSources(); $('#panel-footer').hidden = true; return; }
  $('#panel-footer').hidden = false;
  if (isEconomicScenario()) { notice.hidden = false; notice.textContent = '全部金额均为假设场景测算，未经真实收入样本校准。Star 不等于用户数，实际收入可能为零；未扣成本，不代表利润。指标完整度为 Star、Fork、维护三项真实指标的已知比例。'; }
  if (state.loading && usesRankings()) { area.innerHTML = skeleton(); $('#result-count').textContent = '正在获取 GitHub 真实数据…'; $('#fetched-time').textContent = '来源：GitHub REST API'; return; }
  if (state.error && usesRankings()) { area.innerHTML = empty('暂时无法获取榜单', state.error, 'retry', '重新获取'); $('#result-count').textContent = '请检查网络或 GitHub API 额度'; $('#fetched-time').textContent = '未产生新数据'; return; }
  if (isDisclosure()) {
    const records = selectRevenues(state.revenues, { currency: state.currency, period: state.period, query: state.query });
    notice.hidden = false; notice.textContent = '仅比较同币种、同周期的最新披露。金额属于来源方声明，未经本站审计；请注明 MRR / ARR / 实收等口径。';
    area.innerHTML = records.length ? revenueTable(records) : empty(state.revenues.length ? '这个筛选下暂无真实披露' : '暂无真实收入披露', '没有披露记录不表示收入为零。GitHub 不公开项目收入；有来源的项目方披露会在此独立展示。', 'revenue', '记录收入披露');
    $('#result-count').textContent = `${records.length} 个项目 · ${state.currency} · ${{ monthly: '月度披露', yearly: '年度披露', 'one-time': '单次收入' }[state.period]}`;
    $('#fetched-time').textContent = '口径：来源方披露 · 每项目采用最新记录'; return;
  }
  const repos = visibleRepos();
  const fromMonitors = usesMonitors();
  if (fromMonitors) {
    notice.hidden = false;
    notice.textContent = state.sort === 'stars' ? '服务运行时每小时采集。首次加入仅建立基线；历史积累后才会产生真实净增长。' : `增长榜仅覆盖已监控项目。${{ day: '24 小时', week: '7 天', month: '30 天' }[state.sort]}历史不足的项目显示“—”，并排在已有数据的项目之后。`;
    const failures = state.monitorErrors.filter((error) => isMonitored(error.repo));
    const staleCount = repos.filter((repo) => !repo.fetchedAt || Date.now() - Date.parse(repo.fetchedAt) > 90 * 60000).length;
    if (failures.length || staleCount) {
      notice.classList.add('warning');
      notice.textContent += ` ${failures.length ? `最近刷新有 ${failures.length} 个项目请求失败。` : ''}${staleCount ? `${staleCount} 个项目的采集数据已超过 90 分钟。` : ''}以下保留旧快照，项目旁可查看实际采集时间。`;
    }
  }
  else if (state.meta?.stale || state.meta?.incompleteResults) { notice.hidden = false; notice.classList.add('warning'); notice.textContent = `${state.meta.stale ? '以下为已保存的历史缓存数据。' : ''}${state.meta.incompleteResults ? 'GitHub 标记当前搜索结果可能不完整。' : ''}请以显示的采集时间为准。`; }
  else if (state.view === 'new') { notice.hidden = false; notice.textContent = '最近 30 天创建的公开仓库，按当前 Star 数排列。这是新项目榜，历史增长需另行监控。'; }
  if (state.view === 'potential') {
    notice.hidden = false;
    const warning = `${state.meta?.stale ? '当前为缓存数据。' : ''}${state.meta?.incompleteResults ? 'GitHub 标记结果可能不完整。' : ''}`;
    notice.textContent = `潜力分按关注度 30%、采用度 15%、维护度 30%、类别适配 25% 计算，缺失分项按已知权重归一。模拟月收入为统一假设测算，未经收入样本校准，不代表实际收入；类别不代表已有付费产品。${warning}`;
    notice.classList.toggle('warning', !!warning);
  }
  if (isEconomicScenario()) {
    const warning = `${state.meta?.stale ? '当前为缓存数据。' : ''}${state.meta?.incompleteResults ? 'GitHub 标记结果可能不完整。' : ''}`;
    notice.textContent = `全部金额均为假设场景测算，未经真实收入样本校准。Star 不等于用户数，实际收入可能为零；未扣成本，不代表利润。指标完整度为 Star、Fork、维护三项真实指标的已知比例。${warning}`;
    notice.hidden = false; notice.classList.toggle('warning', !!warning);
  }
  area.innerHTML = repos.length ? state.view === 'potential' ? potentialTable(repos) : isEconomicScenario() ? economicTable(repos) : repoTable(repos) : fromMonitors && !state.monitors.length ? empty(canWrite() ? '把值得关注的项目留在这里' : '公开监控正在准备', canWrite() ? '输入 GitHub 仓库地址开始监控。真实快照保存在服务端，随着时间积累可查看 Star 趋势。' : '服务端开始采集后，项目和真实快照将在这里展示。净增长需要等待历史积累。', 'add', '添加监控项目') : empty('没有找到匹配项目', fromMonitors ? '试试其他关键词或语言。' : '试试更短的关键词，或切换语言与主题分类。');
  $('#result-count').textContent = fromMonitors ? `显示 ${repos.length} / ${state.monitors.length} 个监控项目` : `显示 ${repos.length} 个项目${state.meta?.totalCount != null ? ` · 匹配 ${state.meta.totalCount.toLocaleString('zh-CN')} 个` : ''}`;
  const successfulTimes = state.monitors.map((repo) => repo.fetchedAt).filter((value) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now()).sort();
  const latestSuccess = successfulTimes.at(-1);
  $('#fetched-time').textContent = fromMonitors ? `最近成功采集：${localDate(latestSuccess, true)} · ${snapshotAge(latestSuccess)} · 最近采集尝试：${localDate(state.status?.lastRefreshAt, true)}` : `${state.meta?.source === 'cache' ? '缓存' : 'GitHub API'} · ${localDate(state.meta?.fetchedAt, true)} · ${snapshotAge(state.meta?.fetchedAt)}`;
}
async function reloadWorkspace() {
  const workspaceSequence = ++state.workspaceRequest;
  const results = await Promise.allSettled([api('/api/monitors'), api('/api/revenues'), api('/api/status')]);
  if (workspaceSequence !== state.workspaceRequest) return;
  const keys = ['monitors', 'revenues', 'status'];
  results.forEach((result, i) => { if (result.status === 'fulfilled') { state[keys[i]] = i === 2 ? result.value : result.value.items; if (i === 0) state.monitorErrors = result.value.meta?.errors || []; } });
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length) toast('工作空间读取失败，请检查服务状态。', true);
  renderTable();
}
async function readSharedData(monitorsOnly = false) {
  const sequence = ++state.request;
  const workspaceSequence = state.workspaceRequest;
  const reads = [['monitors', api('/api/monitors')], ['status', api('/api/status')]];
  if (!monitorsOnly) {
    reads.push(['revenues', api('/api/revenues')]);
    if (usesRankings()) {
      const params = new URLSearchParams({ q: state.query, language: state.language, topic: state.topic, cached: '1' });
      if (state.view === 'new') params.set('new', '1');
      reads.push(['rankings', api(`/api/rankings?${params}`)]);
    }
  }
  const results = await Promise.allSettled(reads.map(([, request]) => request));
  return { sequence, workspaceSequence, results: results.map((result, index) => ({ key: reads[index][0], ...result })) };
}
function applySharedData(batch) {
  if (!batch || batch.sequence !== state.request || batch.workspaceSequence !== state.workspaceRequest || state.loading || state.busy) return;
  const area = $('#table-area'), position = { x: window.scrollX, y: window.scrollY, left: area.scrollLeft, top: area.scrollTop };
  for (const result of batch.results) {
    if (result.status !== 'fulfilled') continue;
    if (result.key === 'rankings') { state.rankings = result.value.items; state.meta = result.value.meta; state.error = ''; }
    else if (result.key === 'monitors') { state.monitors = result.value.items; state.monitorErrors = result.value.meta?.errors || []; }
    else if (result.key === 'revenues') state.revenues = result.value.items;
    else state.status = result.value;
  }
  state.syncError = batch.results.some((result) => result.status === 'rejected') ? '部分数据暂未同步，保留上次成功的数据与原采集时间。' : '';
  renderTable();
  area.scrollLeft = position.left; area.scrollTop = position.top;
  if (window.scrollX !== position.x || window.scrollY !== position.y) window.scrollTo(position.x, position.y);
}
const sharedRefresh = createRefreshController({
  read: () => state.loading || state.busy ? null : readSharedData(),
  apply: applySharedData,
  isVisible: () => document.visibilityState !== 'hidden',
});
async function loadRankings(fresh = false) {
  const sequence = ++state.request;
  state.loading = true; state.error = ''; renderTable();
  const params = new URLSearchParams({ q: state.query, language: state.language, topic: state.topic });
  if (state.view === 'new') params.set('new', '1');
  if (fresh && canWrite()) params.set('fresh', '1');
  try { const result = await api(`/api/rankings?${params}`); if (sequence !== state.request) return; state.rankings = result.items; state.meta = result.meta; }
  catch (error) { if (sequence !== state.request) return; state.error = error.message; state.rankings = []; state.meta = null; }
  finally { if (sequence === state.request) { state.loading = false; renderTable(); } }
}
async function setView(view) {
  if (!viewNames[view]) return;
  clearTimeout(searchTimer); state.request++; state.loading = false;
  state.view = view; state.sort = 'stars'; state.query = ''; state.language = ''; state.topic = ''; state.error = '';
  state.loading = usesRankings();
  history.replaceState(null, '', `#${view}`); renderTable();
  if (usesRankings()) await loadRankings();
  else if (usesMonitors()) applySharedData(await readSharedData(true));
}
async function setEconomicTab(tab) {
  if (!['scenario', 'disclosed'].includes(tab) || state.economicTab === tab) return;
  clearTimeout(searchTimer); state.request++; state.economicTab = tab;
  state.query = ''; state.language = ''; state.topic = ''; state.error = ''; state.loading = usesRankings();
  renderTable();
  if (usesRankings()) await loadRankings();
}
function openModal(content) { $('#modal').classList.remove('public-detail'); return modalController.open(content); }
function closeModal(owner) { return modalController.close(owner); }
function formError(form, message) { let target = form.querySelector('.form-error'); if (!target) { target = document.createElement('div'); target.className = 'form-error'; target.setAttribute('role', 'alert'); form.querySelector('.form-actions').before(target); } target.textContent = message; }
function addDialog() {
  if (!canWrite()) return toast('公开站点只提供查看，管理操作请在本机进行。', true);
  const owner = openModal(`<div class="modal-eyebrow">你的开源观察列表</div><h2 id="modal-title" class="modal-title">关注一个好项目。</h2><p class="modal-description">从现在开始积累真实快照。首次采集建立基线，历史数据不会被补造。</p><form id="add-form"><div class="form-row"><label for="repo-input">GitHub 仓库</label><input id="repo-input" name="repo" placeholder="facebook/react 或 GitHub 仓库链接" required autocomplete="off" maxlength="250"><p class="form-hint">例如：https://github.com/facebook/react · 最多监控 30 个项目</p></div><div class="form-actions"><button type="button" class="outline-button" data-action="close">取消</button><button type="submit" class="primary-button">开始监控 ${icon('plus')}</button></div></form>`);
  $('#repo-input').focus();
  $('#add-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; const repo = normalizeRepoInput(form.elements.repo.value); if (!repo) return formError(form, '请输入有效的 owner/repo，或完整 GitHub 仓库链接。'); const button = form.querySelector('[type=submit]'); button.disabled = true; button.textContent = '正在获取真实指标…'; try { await api('/api/monitors', { method: 'POST', body: JSON.stringify({ fullName: repo }) }); closeModal(owner); await reloadWorkspace(); toast('已加入监控，首个真实快照已保存。'); } catch (error) { formError(form, error.message); } finally { button.disabled = false; button.innerHTML = `开始监控 ${icon('plus')}`; } });
}
async function addMonitor(name) {
  if (!canWrite()) return toast('公开站点只提供查看，管理操作请在本机进行。', true);
  if (state.busy) return; state.busy = true;
  try { await api('/api/monitors', { method: 'POST', body: JSON.stringify({ fullName: name }) }); await reloadWorkspace(); toast('已加入监控，开始积累真实 Star 快照。'); }
  catch (error) { toast(error.message, true); } finally { state.busy = false; }
}
function revenueDialog() {
  if (!canWrite()) return toast('公开站点只提供查看，管理操作请在本机进行。', true);
  const owner = openModal(`<div class="modal-eyebrow">有来源的商业披露</div><h2 id="modal-title" class="modal-title">让收入排名有依据。</h2><p class="modal-description">仅记录项目方公开披露或你有权记录的真实数字。不同币种、周期分别排名，最新记录替代历史记录参与排行。</p><form id="revenue-form"><div class="form-row"><label for="income-repo">GitHub 仓库</label><input id="income-repo" name="repo" placeholder="owner/repo" required maxlength="250" autocomplete="off"></div><div class="form-grid"><div class="form-row"><label for="income-amount">披露金额</label><input id="income-amount" name="amount" type="number" min="0.01" step="0.01" max="1000000000000" placeholder="0.00" required></div><div class="form-row"><label for="income-currency">币种</label><select id="income-currency" name="currency"><option value="USD">美元 USD</option><option value="CNY">人民币 CNY</option><option value="EUR">欧元 EUR</option></select></div><div class="form-row"><label for="income-period">统计周期</label><select id="income-period" name="period"><option value="monthly">月度披露</option><option value="yearly">年度披露</option><option value="one-time">单次收入</option></select></div><div class="form-row"><label for="income-date">披露日期</label><input id="income-date" name="date" type="date" required max="${today()}" value="${today()}"></div></div><div class="form-row"><label for="income-source">来源链接</label><input id="income-source" name="sourceUrl" type="url" placeholder="https://项目官网/公开财务页面" required maxlength="2000"><p class="form-hint">请填写可核对的原文地址。GitHub Star 数不能用来推算收入。</p></div><div class="form-row"><label for="income-notes">披露口径与备注</label><textarea id="income-notes" name="notes" placeholder="例如：MRR（月度经常性收入运行率），不是实际到账收入或利润。" maxlength="1000"></textarea></div><div class="form-actions"><button type="button" class="outline-button" data-action="close">取消</button><button type="submit" class="primary-button">保存披露记录</button></div></form>`);
  $('#income-currency').value = state.currency; $('#income-period').value = state.period;
  $('#income-repo').focus();
  $('#revenue-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); values.repo = normalizeRepoInput(values.repo); values.amount = Number(values.amount); if (!values.repo) return formError(form, '请输入有效的 GitHub 仓库名称。'); if (!safeSourceUrl(values.sourceUrl)) return formError(form, '请填写 http 或 https 来源链接。'); const button = form.querySelector('[type=submit]'); button.disabled = true; try { await api('/api/revenues', { method: 'POST', body: JSON.stringify(values) }); closeModal(owner); await reloadWorkspace(); toast('收入披露已保存。'); } catch (error) { formError(form, error.message); } finally { button.disabled = false; } });
}
function confirmRemove(type, value) {
  if (!canWrite()) return toast('公开站点只提供查看，管理操作请在本机进行。', true);
  const income = type === 'revenue';
  const record = income ? state.revenues.find((item) => item.id === value) : null;
  const label = income ? record?.repo || '收入记录' : value;
  const owner = openModal(`<div class="modal-eyebrow">工作空间管理</div><h2 id="modal-title" class="modal-title">${income ? '删除这份收入披露？' : '移除这个监控项目？'}</h2><p class="modal-description">${e(label)}<br>${income ? '这份本地披露记录将被删除。可以先下载工作空间备份。' : '项目将停止采集；已有快照保留在本地，再次添加后可继续使用。'}</p><div class="form-actions"><button class="outline-button" data-action="close">取消</button><button class="primary-button" id="confirm-remove">确认${income ? '删除' : '移除'}</button></div>`);
  $('#confirm-remove').addEventListener('click', async (event) => { const button = event.currentTarget; button.disabled = true; try { await api(income ? `/api/revenues?id=${encodeURIComponent(value)}` : `/api/monitors?repo=${encodeURIComponent(value)}`, { method: 'DELETE' }); closeModal(owner); await reloadWorkspace(); toast(income ? '披露记录已删除。' : '项目已移除监控。'); } catch (error) { toast(error.message, true); button.disabled = false; } });
}
function chart(history) {
  const entries = (history || []).filter((item) => Number.isFinite(item.stars) && Number.isFinite(Date.parse(item.at))).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (entries.length < 2) return '<div class="chart-empty">真实趋势，从第一个快照开始。<br>积累至少两个快照后，这里会显示 Star 变化。</div>';
  const values = entries.map((item) => item.stars), min = Math.min(...values), max = Math.max(...values);
  const start = Date.parse(entries[0].at), end = Date.parse(entries.at(-1).at);
  const points = entries.map((item) => `${25 + (Date.parse(item.at) - start) / (end - start || 1) * 450},${92 - (item.stars - min) / (max - min || 1) * 67}`).join(' ');
  return `<svg class="history-chart" viewBox="0 0 500 130" role="img" aria-label="Star 真实采集趋势，${e(entries[0].at)} 至 ${e(entries.at(-1).at)}，${entries.length} 个快照"><path d="M25 30h450M25 61h450M25 92h450" stroke="#e8f0e5" stroke-dasharray="3 4" fill="none"/><polygon points="25,100 ${points} 475,100" fill="#e5f3e3"/><polyline points="${points}" stroke="#7bb283" stroke-width="2" fill="none"/><text x="25" y="119" fill="#a1b29a" font-size="9">${e(localDate(entries[0].at, true))}</text><text x="475" y="119" fill="#a1b29a" text-anchor="end" font-size="9">${e(localDate(entries.at(-1).at, true))}</text><text x="475" y="18" fill="#92ab8d" text-anchor="end" font-size="9">${e(formatNumber(min))} — ${e(formatNumber(max))} Star</text></svg>`;
}
async function detailDialog(name) {
  const detailView = state.view, detailEconomic = isEconomicScenario();
  const potentialScenario = normalizeScenario(state.scenario), economicScenario = normalizeEconomicScenario(state.economicScenario);
  const owner = openModal(`<div class="modal-eyebrow">项目详情</div><h2 id="modal-title" class="modal-title">${e(name)}</h2><div class="loading-detail"><div class="skeleton-row"><div class="skeleton avatar"></div><div class="skeleton-stack"><div class="skeleton text"></div><div class="skeleton small"></div></div></div></div><p class="modal-description">正在读取真实项目指标…</p>`);
  try {
    if (!canWrite()) $('#modal').classList.add('public-detail');
    const result = await api(`/api/repo?name=${encodeURIComponent(name)}`); if (!modalController.isCurrent(owner)) return;
    const repo = result.item, monitored = isMonitored(repo.fullName);
    const potential = detailView === 'potential' ? evaluatePotential(repo, { now: Date.now(), scenario: potentialScenario }) : null;
    const economic = detailEconomic ? evaluateEconomicValue(repo, { now: Date.now(), scenario: economicScenario }) : null;
    const potentialDetail = potential ? `<section class="detail-potential"><h3>变现潜力 · 透明规则</h3><div class="detail-potential-top"><div><span>潜力规则分</span><strong>${e(potential.score)} <small>/ 100</small></strong><span>${e(potential.category)} · 主题粗分类</span></div><div><span>模拟月收入 · ${e(potentialScenario.currency)}</span><strong class="simulated-amount">${e(formatMoney(potential.monthlyRevenue, potentialScenario.currency))}</strong><span>假设测算 · 未经收入样本校准</span></div></div>${potentialBreakdown(potential)}<p class="potential-method-note">本次假设：活跃 ${scenarioPercent(potentialScenario.activeRate)}% × 付费 ${scenarioPercent(potentialScenario.paidRate)}% × 假设月客单价 ${e(formatMoney(potentialScenario.monthlyPrice, potentialScenario.currency))} ${e(potentialScenario.currency)}。模拟金额不代表实际收入。</p></section>` : economic ? `<section class="detail-potential detail-economic"><h3>商业价值 · 三档假设测算</h3><div class="detail-economic-score"><div><span>研究规则分</span><strong>${e(economic.score)} <small>/ 100</small></strong></div><div><span>指标完整度 · 三项真实指标</span><strong>${e(coveragePercent(economic.coverage))}%</strong></div></div><p class="potential-method-note">${e(economic.category)} · 主题粗分类。完整度是 Star、Fork、维护三项的已知比例，不表示收入预测可靠程度。</p><div class="detail-economic-cases">${ECONOMIC_CASES.map(({ key, label }) => `<div><span>${label}模拟月收入 · ${e(economicScenario.currency)}</span><strong class="simulated-amount">${e(formatMoney(economic.monthly[key], economicScenario.currency))}</strong><p>${e(economicAssumption(economicScenario, key))}</p></div>`).join('')}</div>${potentialBreakdown(economic)}<p class="potential-method-note">全部金额为场景假设，未经真实收入样本校准；实际收入可能为零。未扣成本，不代表利润；不做汇率换算，不代表公司估值。</p></section>` : '';
    const fullURL = safeSourceUrl(repo.url) || `https://github.com/${repo.fullName.split('/').map(encodeURIComponent).join('/')}`;
    $('#modal-content').innerHTML = `<div class="modal-eyebrow">GitHub 项目观察</div><div class="detail-header">${avatar(repo)}<h2 id="modal-title" class="modal-title">${e(repo.fullName)}</h2></div><p class="modal-description">${e(repo.description || '这个项目暂未填写简介。')}</p><div class="detail-metrics"><div class="detail-metric"><span>Star 总数</span><strong>${e(formatNumber(repo.stars))}</strong></div><div class="detail-metric"><span>Fork 数</span><strong>${e(formatNumber(repo.forks))}</strong></div><div class="detail-metric"><span>主语言</span><strong class="main-language">${e(repo.language || '未标注')}</strong></div></div>${potentialDetail}<div class="detail-topics">${(repo.topics || []).slice(0, 10).map((topic) => `<span class="repo-topic">${e(topic)}</span>`).join('')}</div><div class="detail-chart-title"><span>Star 真实采集趋势</span><span>${result.history?.length || 0} 个快照</span></div>${chart(result.history)}<div class="detail-growth"><span>日增长 ${growthHTML(result.growth?.day)}</span><span>周增长 ${growthHTML(result.growth?.week)}</span><span>月增长 ${growthHTML(result.growth?.month)}</span></div><p class="detail-meta">创建于 ${e(localDate(repo.createdAt))} · 最近推送 ${e(relativeDate(repo.pushedAt))}<br>许可证：${e(repo.license || '未标注')} · ${monitored ? `已加入${canWrite() ? '' : '公开'}监控` : '尚未监控，历史增长未知'}<br>采集时间：${e(localDate(result.meta?.fetchedAt || result.history?.at(-1)?.at, true))}${result.meta?.stale ? ' · 过期缓存' : ''}</p><div class="form-actions detail-actions"><a class="detail-link" href="${e(fullURL)}" target="_blank" rel="noopener noreferrer">在 GitHub 查看 ${icon('external')}</a>${canWrite() ? `<button class="primary-button" id="detail-monitor">${icon(monitored ? 'check' : 'plus')}${monitored ? '已监控' : '加入监控'}</button>` : ''}</div>`;
    const monitor = $('#detail-monitor');
    if (monitor) { monitor.disabled = monitored; monitor.addEventListener('click', async (event) => { const button = event.currentTarget; button.disabled = true; await addMonitor(repo.fullName); if (isMonitored(repo.fullName)) button.innerHTML = `${icon('check')}已监控`; else button.disabled = false; }); }
  } catch (error) { if (!modalController.isCurrent(owner)) return; $('#modal-content').innerHTML = `<div class="modal-eyebrow">项目详情</div><h2 id="modal-title" class="modal-title">${e(name)}</h2><div class="form-error">${e(error.message)}</div><div class="form-actions"><button class="outline-button" data-action="close">关闭</button></div>`; }
}
async function refresh() {
  if (!canWrite()) return toast('公开站点只提供查看，管理操作请在本机进行。', true);
  if (state.busy) return;
  state.busy = true; $('#refresh-button').disabled = true; $('#refresh-button').classList.add('spinning');
  try {
    if (usesMonitors()) { const result = await api('/api/refresh', { method: 'POST', body: JSON.stringify({}), timeoutMs: 390000 }); await reloadWorkspace(); toast(result.errors?.length ? `刷新完成，${result.errors.length} 个项目请求失败，已保留旧数据。` : '监控指标已刷新，真实快照已保存。', !!result.errors?.length); }
    else { await loadRankings(true); if (!state.error) toast(state.meta?.stale ? '上游暂时不可用，仍显示已有缓存。' : '已更新 GitHub 排行榜。', !!state.meta?.stale); }
  } catch (error) { toast(error.message, true); }
  finally { state.busy = false; $('#refresh-button').disabled = false; $('#refresh-button').classList.remove('spinning'); }
}
function downloadBlob(content, filename, type) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function exportCSV() {
  let headers, rows;
  if (state.view === 'potential') { headers = ['排名', '项目', '潜力规则分', '关注度分项', '采用度分项', '维护度分项', '类别适配分项', '粗类别', 'Star', '模拟月收入', '测算币种', '模拟标记', '假设活跃比例', '假设付费比例', '假设月客单价', '校准状态', '排序', 'GitHub', '指标采集时间']; rows = visibleRepos().map((repo, i) => [i + 1, repo.fullName, repo.potential.score, repo.potential.components.attention, repo.potential.components.adoption ?? '未知', repo.potential.components.maintenance ?? '未知', repo.potential.components.category, repo.potential.category, repo.stars, repo.potential.monthlyRevenue, state.scenario.currency, '假设测算，非实际收入', state.scenario.activeRate, state.scenario.paidRate, state.scenario.monthlyPrice, '未经收入样本校准', { score: '潜力分', revenue: '模拟金额', stars: 'Star' }[state.potentialSort], repo.url, state.meta?.fetchedAt ?? '']); }
  else if (isEconomicScenario()) { ({ headers, rows } = economicCSVData(visibleRepos(), { scenario: state.economicScenario, sort: state.economicSort, fetchedAt: state.meta?.fetchedAt ?? '' })); }
  else if (isDisclosure()) { headers = ['排名', '项目', '真实披露金额', '币种', '周期', '披露日期', '来源', '披露口径']; rows = selectRevenues(state.revenues, { currency: state.currency, period: state.period, query: state.query }).map((record, i) => [i + 1, record.repo, record.amount, record.currency, record.period, record.date, record.sourceUrl, record.notes]); }
  else { headers = ['排名', '项目', 'Star', 'Fork', '语言', '日净增长', '周净增长', '月净增长', 'GitHub', '指标采集时间']; rows = visibleRepos().map((repo, i) => [i + 1, repo.fullName, repo.stars, repo.forks, repo.language, repo.growth?.day ?? '', repo.growth?.week ?? '', repo.growth?.month ?? '', repo.url, (state.view === 'monitors' || state.sort !== 'stars') ? (repo.fetchedAt ?? '') : (state.meta?.fetchedAt ?? '')]); }
  if (!rows.length) return toast('当前视图没有可导出的记录。');
  downloadBlob(toCSV(headers, rows), `starscope-${state.view}${state.view === 'revenue' ? `-${state.economicTab}` : ''}-${today()}.csv`, 'text/csv;charset=utf-8'); toast('当前榜单已导出。');
}

document.addEventListener('click', (event) => {
  const view = event.target.closest('[data-view]'); if (view) { setView(view.dataset.view); return; }
  const economicTab = event.target.closest('[data-economic-tab]'); if (economicTab) { setEconomicTab(economicTab.dataset.economicTab); return; }
  const potentialSort = event.target.closest('[data-potential-sort]'); if (potentialSort) { state.potentialSort = potentialSort.dataset.potentialSort; renderTable(); return; }
  const sort = event.target.closest('[data-sort]'); if (sort) { clearTimeout(searchTimer); state.request++; state.loading = false; state.sort = sort.dataset.sort; state.query = ''; renderTable(); if (state.sort === 'stars' && state.view === 'ranking') loadRankings(); else if (usesMonitors()) readSharedData(true).then(applySharedData); return; }
  const category = event.target.closest('[data-topic]'); if (category) { clearTimeout(searchTimer); state.topic = category.dataset.topic; if (usesRankings()) loadRankings(); else renderTable(); return; }
  const target = event.target.closest('[data-action]'); if (!target) return;
  const { action, repo, id } = target.dataset;
  if (action === 'add') addDialog(); else if (action === 'revenue') revenueDialog(); else if (action === 'close') closeModal(); else if (action === 'monitor') addMonitor(repo); else if (action === 'remove-monitor') confirmRemove('monitor', repo); else if (action === 'remove-revenue') confirmRemove('revenue', id); else if (action === 'detail') detailDialog(repo); else if (action === 'retry') loadRankings();
});
$('#modal-close').addEventListener('click', () => closeModal());
$('#modal').addEventListener('cancel', (event) => { event.preventDefault(); closeModal(); });
$('#modal').addEventListener('click', (event) => { if (event.target === $('#modal')) { const rect = $('#modal').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeModal(); } });
$('#search-input').addEventListener('input', (event) => { state.query = event.target.value; clearTimeout(searchTimer); if (usesRankings()) { state.request++; state.loading = true; state.error = ''; renderTable(); searchTimer = setTimeout(() => loadRankings(), 550); } else renderTable(); });
$('#language-select').addEventListener('change', (event) => { clearTimeout(searchTimer); state.language = event.target.value; if (usesRankings()) loadRankings(); else renderTable(); });
$('#scenario-form').addEventListener('submit', (event) => { event.preventDefault(); updateScenario(); });
$('#scenario-form').addEventListener('input', (event) => { if (event.target.matches('input')) updateScenario(); });
$('#scenario-currency').addEventListener('change', updateScenario);
$('#scenario-reset').addEventListener('click', () => { state.scenario = normalizeScenario(DEFAULT_SCENARIO); populateScenarioForm(); try { localStorage.setItem(scenarioStorageKey, JSON.stringify(state.scenario)); } catch {} renderTable(); });
$('#economic-scenario-form').addEventListener('submit', (event) => { event.preventDefault(); updateEconomicScenario(); });
$('#economic-scenario-form').addEventListener('input', (event) => { if (event.target.matches('input')) updateEconomicScenario(); });
$('#economic-scenario-currency').addEventListener('change', updateEconomicScenario);
$('#economic-scenario-reset').addEventListener('click', () => { state.economicScenario = normalizeEconomicScenario(DEFAULT_ECONOMIC_SCENARIO); populateEconomicScenarioForm(); writeScenarioPreference(economicStorage, economicStorageKey, state.economicScenario); renderTable(); });
$('#economic-sort').addEventListener('change', (event) => { state.economicSort = event.target.value; renderTable(); });
$('#economic-tabs').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tab = event.target.closest('[data-economic-tab]'); if (!tab) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 'scenario' : event.key === 'End' ? 'disclosed' : tab.dataset.economicTab === 'scenario' ? 'disclosed' : 'scenario';
  setEconomicTab(next); document.querySelector(`[data-economic-tab="${next}"]`).focus();
});
$('#currency-select').addEventListener('change', (event) => { state.currency = event.target.value; renderTable(); });
$('#period-select').addEventListener('change', (event) => { state.period = event.target.value; renderTable(); });
$('#context-add').addEventListener('click', () => state.view === 'revenue' ? revenueDialog() : addDialog());
$('#refresh-button').addEventListener('click', refresh);
$('#export-button').addEventListener('click', exportCSV);
$('#export-backup').addEventListener('click', async () => { try { const data = await api('/api/export'); downloadBlob(JSON.stringify(data, null, 2), `starscope-backup-${today()}.json`, 'application/json'); toast('工作空间备份已下载。'); } catch (error) { toast(error.message, true); } });
document.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (state.view === 'sources') setView('potential'); $('#search-input').focus(); } });
window.addEventListener('hashchange', () => { const view = location.hash.slice(1); if (viewNames[view] && view !== state.view) setView(view); });
document.addEventListener('visibilitychange', () => { sharedRefresh.visibilityChanged(); });
window.addEventListener('focus', () => { sharedRefresh.online(); });
window.addEventListener('online', () => { sharedRefresh.online(); });
window.addEventListener('pagehide', () => { sharedRefresh.stop(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) { sharedRefresh.start(); sharedRefresh.online(); } });

populateScenarioForm();
populateEconomicScenarioForm();
renderTable();
await reloadWorkspace();
if (usesRankings()) await loadRankings();
else { state.loading = false; renderTable(); }
sharedRefresh.start();
