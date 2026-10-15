import { evaluatePotential } from './potential.mjs';

export const DEFAULT_ECONOMIC_SCENARIO = Object.freeze({
  currency: 'CNY',
  cases: Object.freeze({
    conservative: Object.freeze({ activeRate: 0.01, paidRate: 0.005, monthlyPrice: 20 }),
    base: Object.freeze({ activeRate: 0.05, paidRate: 0.01, monthlyPrice: 50 }),
    optimistic: Object.freeze({ activeRate: 0.1, paidRate: 0.02, monthlyPrice: 100 }),
  }),
});

const CASE_NAMES = Object.keys(DEFAULT_ECONOMIC_SCENARIO.cases);
const FACTOR_LIMITS = { activeRate: 1, paidRate: 1, monthlyPrice: 100000 };

function requireObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RangeError(`${label} must be an object`);
  }
}

export function normalizeEconomicScenario(input = {}) {
  requireObject(input, 'Scenario');
  const currency = Object.hasOwn(input, 'currency') ? input.currency : DEFAULT_ECONOMIC_SCENARIO.currency;
  if (!['CNY', 'USD', 'EUR'].includes(currency)) {
    throw new RangeError('Currency must be CNY, USD or EUR');
  }
  const suppliedCases = Object.hasOwn(input, 'cases') ? input.cases : {};
  requireObject(suppliedCases, 'Scenario cases');
  const cases = {};
  let previousCoefficient = 0;
  for (const name of CASE_NAMES) {
    const suppliedCase = Object.hasOwn(suppliedCases, name) ? suppliedCases[name] : {};
    requireObject(suppliedCase, `${name} case`);
    const assumptions = {};
    for (const [factor, maximum] of Object.entries(FACTOR_LIMITS)) {
      const value = Object.hasOwn(suppliedCase, factor) ? suppliedCase[factor] : DEFAULT_ECONOMIC_SCENARIO.cases[name][factor];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
        throw new RangeError(`${name}.${factor} must be a finite number between 0 and ${maximum}`);
      }
      assumptions[factor] = value;
    }
    const coefficient = assumptions.activeRate * assumptions.paidRate * assumptions.monthlyPrice;
    if (coefficient < previousCoefficient) {
      throw new RangeError('Per-star monthly amounts must not decrease from conservative to optimistic');
    }
    cases[name] = assumptions;
    previousCoefficient = coefficient;
  }
  return { currency, cases };
}

export function evaluateEconomicValue(repo, { now = Date.now(), scenario = DEFAULT_ECONOMIC_SCENARIO } = {}) {
  const assumptions = normalizeEconomicScenario(scenario);
  const { score, category, components } = evaluatePotential(repo, { now });
  const monthly = {};
  for (const name of CASE_NAMES) {
    const { activeRate, paidRate, monthlyPrice } = assumptions.cases[name];
    const amount = repo.stars * activeRate * paidRate * monthlyPrice;
    monthly[name] = Number.isFinite(amount) ? amount : null;
  }
  // Coverage records observed metrics; inferred category does not add evidence.
  const knownMetrics = ['attention', 'adoption', 'maintenance'].filter((name) => components[name] !== null).length;
  return { score, category, components, coverage: knownMetrics / 3, monthly, assumptions };
}

export function rankEconomicValues(repos, { now = Date.now(), scenario = DEFAULT_ECONOMIC_SCENARIO, sort = 'base' } = {}) {
  const assumptions = normalizeEconomicScenario(scenario);
  if (typeof now !== 'number' || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) {
    throw new RangeError('Now must be a valid timestamp in milliseconds');
  }
  if (!['base', 'score'].includes(sort)) throw new RangeError('Sort must be base or score');
  return repos.map((repo) => ({ ...repo, economic: evaluateEconomicValue(repo, { now, scenario: assumptions }) }))
    .sort((first, second) => {
      const firstValue = sort === 'score' ? first.economic.score : first.economic.monthly.base;
      const secondValue = sort === 'score' ? second.economic.score : second.economic.monthly.base;
      const firstKnown = Number.isFinite(firstValue);
      const secondKnown = Number.isFinite(secondValue);
      if (firstKnown !== secondKnown) return firstKnown ? -1 : 1;
      if (firstKnown && firstValue !== secondValue) return secondValue - firstValue;
      const firstName = typeof first.fullName === 'string' ? first.fullName : '';
      const secondName = typeof second.fullName === 'string' ? second.fullName : '';
      return firstName < secondName ? -1 : firstName > secondName ? 1 : 0;
    });
}
