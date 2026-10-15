export const DEFAULT_SCENARIO = Object.freeze({
  activeRate: 0.1,
  paidRate: 0.02,
  monthlyPrice: 50,
  currency: 'CNY',
});

const WEIGHTS = Object.freeze({ attention: 30, adoption: 15, maintenance: 30, category: 25 });
const DAY = 86400000;
const CATEGORIES = [
  {
    name: '学习资料', score: 20,
    pattern: /\b(awesome|learn(?:ing)?|tutorials?|courses?|education(?:al)?|interviews?|cheat[- ]?sheets?|books?|resource[- ]lists?|examples?)\b|学习|教程|课程|资料|面试|书籍/i,
  },
  {
    name: '开发工具/基础设施', score: 100,
    pattern: /\b(developer[- ]tools?|devtools?|tooling|infrastructure|databases?|frameworks?|libraries|library|sdk|api|cli|cloud|devops|observability|monitoring|automation|kubernetes|docker)\b|开发工具|基础设施|数据库|开发框架|命令行|容器|运维/i,
  },
  {
    name: '应用产品', score: 85,
    pattern: /\b(apps?|applications?|saas|crm|cms|e[- ]?commerce|productivity|collaboration|note[- ]taking|chat|workflow|dashboard|assistant)\b|应用|产品|协作|任务管理|笔记|电商/i,
  },
];

export function normalizeScenario(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new RangeError('Scenario must be an object');
  }
  const scenario = {};
  for (const key of ['activeRate', 'paidRate', 'monthlyPrice', 'currency']) {
    scenario[key] = Object.hasOwn(input, key) ? input[key] : DEFAULT_SCENARIO[key];
  }
  for (const [key, maximum] of [['activeRate', 1], ['paidRate', 1], ['monthlyPrice', 100000]]) {
    const value = scenario[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
      throw new RangeError(`${key} must be a finite number between 0 and ${maximum}`);
    }
  }
  if (!['CNY', 'USD', 'EUR'].includes(scenario.currency)) {
    throw new RangeError('Currency must be CNY, USD or EUR');
  }
  return scenario;
}

function validCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function logarithmicScore(count, ceiling) {
  return Math.min(100, Math.log10(count + 1) / Math.log10(ceiling + 1) * 100);
}

function maintenanceScore(repo, now) {
  if (repo.archived === true) return 0;
  if (typeof repo.pushedAt !== 'string' || !repo.pushedAt.trim()) return null;
  const input = repo.pushedAt.trim();
  const date = input.match(/^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/);
  if (!date) return null;
  // Date.parse rolls impossible dates such as February 30 forward; verify the calendar first.
  const calendar = new Date(`${date[1]}-${date[2]}-${date[3]}T00:00:00Z`);
  if (calendar.getUTCFullYear() !== Number(date[1]) || calendar.getUTCMonth() + 1 !== Number(date[2]) || calendar.getUTCDate() !== Number(date[3])) return null;
  const pushed = Date.parse(input);
  if (!Number.isFinite(pushed) || pushed > now) return null;
  const age = (now - pushed) / DAY;
  if (age <= 30) return 100;
  if (age <= 90) return 80;
  if (age <= 180) return 60;
  if (age <= 365) return 35;
  return 0;
}

function classify(repo) {
  const topics = Array.isArray(repo.topics) ? repo.topics.filter((topic) => typeof topic === 'string') : [];
  const description = typeof repo.description === 'string' ? repo.description : '';
  const text = [...topics, description].join(' ');
  return CATEGORIES.find((category) => category.pattern.test(text)) ?? { name: '其他', score: 50 };
}

export function evaluatePotential(repo, { now = Date.now(), scenario = DEFAULT_SCENARIO } = {}) {
  const assumptions = normalizeScenario(scenario);
  if (!validCount(repo?.stars)) throw new RangeError('Repository stars must be a nonnegative safe integer');
  if (typeof now !== 'number' || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) {
    throw new RangeError('Now must be a valid timestamp in milliseconds');
  }
  const category = classify(repo);
  const components = {
    attention: logarithmicScore(repo.stars, 100000),
    adoption: validCount(repo.forks) ? logarithmicScore(repo.forks, 10000) : null,
    maintenance: maintenanceScore(repo, now),
    category: category.score,
  };

  // These manual rules are not calibrated against income data. Unknown metrics carry no weight.
  let weighted = 0;
  let knownWeight = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    if (components[key] === null) continue;
    weighted += components[key] * weight;
    knownWeight += weight;
  }
  const revenue = repo.stars * assumptions.activeRate * assumptions.paidRate * assumptions.monthlyPrice;
  return {
    score: Math.round(weighted / knownWeight),
    category: category.name,
    components,
    // This is a scenario calculation, not observed revenue or a financial forecast.
    monthlyRevenue: Number.isFinite(revenue) ? revenue : null,
    assumptions,
  };
}

export function rankPotential(repos, options = {}) {
  const now = options.now === undefined ? Date.now() : options.now;
  return repos.map((repo) => ({ ...repo, potential: evaluatePotential(repo, { ...options, now }) }))
    .sort((first, second) => {
      const metricOrder = second.potential.score - first.potential.score || second.stars - first.stars;
      if (metricOrder) return metricOrder;
      const firstName = typeof first.fullName === 'string' ? first.fullName : '';
      const secondName = typeof second.fullName === 'string' ? second.fullName : '';
      return firstName < secondName ? -1 : firstName > secondName ? 1 : 0;
    });
}
