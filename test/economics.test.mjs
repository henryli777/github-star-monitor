import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePotential } from '../public/potential.mjs';

const economics = await import('../public/economics.mjs').catch((error) => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const NOW = Date.parse('2026-10-12T00:00:00Z');
const DAY = 86400000;
const CASES = ['conservative', 'base', 'optimistic'];
const DEFAULTS = {
  currency: 'CNY',
  cases: {
    conservative: { activeRate: 0.01, paidRate: 0.005, monthlyPrice: 20 },
    base: { activeRate: 0.05, paidRate: 0.01, monthlyPrice: 50 },
    optimistic: { activeRate: 0.1, paidRate: 0.02, monthlyPrice: 100 },
  },
};
const repo = Object.freeze({
  fullName: 'Org/Product', stars: 10000, forks: 1000,
  topics: Object.freeze(['saas']), description: 'Team collaboration app',
  pushedAt: '2026-10-01T00:00:00Z', archived: false,
});

function api(name) {
  assert.equal(typeof economics[name], 'function', `${name} must be implemented`);
  return economics[name];
}

test('exports deeply frozen declared three-case defaults', () => {
  assert.deepEqual(economics.DEFAULT_ECONOMIC_SCENARIO, DEFAULTS);
  assert.ok(Object.isFrozen(economics.DEFAULT_ECONOMIC_SCENARIO));
  assert.ok(Object.isFrozen(economics.DEFAULT_ECONOMIC_SCENARIO.cases));
  for (const name of CASES) assert.ok(Object.isFrozen(economics.DEFAULT_ECONOMIC_SCENARIO.cases[name]));
});

test('normalizes defaults and deeply merges partial assumptions without changing input', () => {
  const normalize = api('normalizeEconomicScenario');
  const input = Object.freeze({
    currency: 'USD',
    cases: Object.freeze({ base: Object.freeze({ monthlyPrice: 60 }) }),
  });
  const result = normalize(input);
  assert.deepEqual(result, {
    ...DEFAULTS, currency: 'USD',
    cases: { ...DEFAULTS.cases, base: { ...DEFAULTS.cases.base, monthlyPrice: 60 } },
  });
  assert.deepEqual(normalize(), DEFAULTS);
  assert.deepEqual(input, { currency: 'USD', cases: { base: { monthlyPrice: 60 } } });
  assert.notEqual(result, input);
  assert.notEqual(result.cases, input.cases);
  assert.notEqual(result.cases.base, input.cases.base);
  assert.notEqual(result.cases.conservative, economics.DEFAULT_ECONOMIC_SCENARIO.cases.conservative);
});

test('rejects invalid scenario, cases, and individual-case containers', () => {
  const normalize = api('normalizeEconomicScenario');
  for (const invalid of [null, [], 1, 'scenario', true]) {
    assert.throws(() => normalize(invalid), RangeError);
    assert.throws(() => normalize({ cases: invalid }), RangeError);
    for (const name of CASES) assert.throws(() => normalize({ cases: { [name]: invalid } }), RangeError);
  }
  assert.throws(() => normalize({ cases: undefined }), RangeError);
  for (const name of CASES) assert.throws(() => normalize({ cases: { [name]: undefined } }), RangeError);
});

test('rejects invalid numeric assumptions without coercion', () => {
  const normalize = api('normalizeEconomicScenario');
  for (const name of CASES) {
    for (const key of ['activeRate', 'paidRate']) {
      for (const value of [-0.01, 1.01, NaN, Infinity, -Infinity, '0.1', null, undefined, true, {}]) {
        assert.throws(() => normalize({ cases: { [name]: { [key]: value } } }), RangeError, `${name}.${key}: ${String(value)}`);
      }
    }
    for (const monthlyPrice of [-1, 100001, NaN, Infinity, '50', null, undefined, false]) {
      assert.throws(() => normalize({ cases: { [name]: { monthlyPrice } } }), RangeError);
    }
  }
});

test('accepts inclusive numeric boundaries and only declared currencies', () => {
  const normalize = api('normalizeEconomicScenario');
  for (const currency of ['CNY', 'USD', 'EUR']) {
    for (const values of [{ activeRate: 0, paidRate: 0, monthlyPrice: 0 }, { activeRate: 1, paidRate: 1, monthlyPrice: 100000 }]) {
      const input = { currency, cases: Object.fromEntries(CASES.map((name) => [name, values])) };
      assert.deepEqual(normalize(input), input);
    }
  }
  for (const currency of ['cny', 'GBP', '', null, undefined, {}]) {
    assert.throws(() => normalize({ currency }), RangeError);
  }
});

test('enforces monotonic per-star amounts while allowing individual assumptions to cross', () => {
  const normalize = api('normalizeEconomicScenario');
  assert.throws(() => normalize({ cases: { conservative: { monthlyPrice: 100000 } } }), RangeError);
  assert.throws(() => normalize({ cases: { base: { activeRate: 0 } } }), RangeError);
  assert.throws(() => normalize({ cases: { optimistic: { monthlyPrice: 1 } } }), RangeError);
  const crossed = {
    cases: {
      conservative: { activeRate: 1, paidRate: 0.001, monthlyPrice: 1 },
      base: { activeRate: 0.001, paidRate: 1, monthlyPrice: 2 },
      optimistic: { activeRate: 0.1, paidRate: 0.1, monthlyPrice: 1 },
    },
  };
  assert.deepEqual(normalize(crossed).cases, crossed.cases);
  const equal = { activeRate: 0, paidRate: 1, monthlyPrice: 100000 };
  assert.deepEqual(normalize({ cases: Object.fromEntries(CASES.map((name) => [name, equal])) }).cases.base, equal);
});

test('calculates 10000-star monthly cases as 10, 250, and 2000', () => {
  const result = api('evaluateEconomicValue')(repo, { now: NOW });
  assert.deepEqual(result.monthly, { conservative: 10, base: 250, optimistic: 2000 });
  assert.deepEqual(result.assumptions, DEFAULTS);
  assert.equal(result.coverage, 1);
});

test('retains the existing potential score category and components for known stars', () => {
  const evaluate = api('evaluateEconomicValue');
  for (const item of [repo, { ...repo, archived: true }, { ...repo, forks: null }, { ...repo, topics: ['awesome'], pushedAt: null }]) {
    const existing = evaluatePotential(item, { now: NOW });
    const result = evaluate(item, { now: NOW });
    assert.equal(result.score, existing.score);
    assert.equal(result.category, existing.category);
    assert.deepEqual(result.components, existing.components);
  }
});

test('uses currency solely as a denomination label without converting monthly amounts', () => {
  const evaluate = api('evaluateEconomicValue');
  for (const currency of ['CNY', 'USD', 'EUR']) {
    const result = evaluate(repo, { now: NOW, scenario: { currency } });
    assert.deepEqual(result.monthly, { conservative: 10, base: 250, optimistic: 2000 });
    assert.equal(result.assumptions.currency, currency);
  }
});

test('keeps zero stars and zero assumption factors as real zero values', () => {
  const evaluate = api('evaluateEconomicValue');
  assert.deepEqual(evaluate({ ...repo, stars: 0, forks: 0 }, { now: NOW }).monthly, { conservative: 0, base: 0, optimistic: 0 });
  for (const factor of ['activeRate', 'paidRate', 'monthlyPrice']) {
    const cases = Object.fromEntries(CASES.map((name) => [name, { [factor]: 0 }]));
    assert.deepEqual(evaluate(repo, { now: NOW, scenario: { cases } }).monthly, { conservative: 0, base: 0, optimistic: 0 });
  }
});

test('does not multiply monthly scenarios by fork activity archive status or category', () => {
  const evaluate = api('evaluateEconomicValue');
  for (const item of [
    { ...repo, forks: 0 }, { ...repo, forks: 100000 },
    { ...repo, archived: true }, { ...repo, pushedAt: '2020-01-01T00:00:00Z' },
    { ...repo, topics: ['awesome'], description: 'Tutorials' },
    { ...repo, topics: ['developer-tools'], description: 'Database' },
  ]) {
    assert.deepEqual(evaluate(item, { now: NOW }).monthly, { conservative: 10, base: 250, optimistic: 2000 });
  }
});

test('rejects missing or invalid stars consistently with the existing potential model', () => {
  const evaluate = api('evaluateEconomicValue');
  for (const stars of [undefined, null, NaN, Infinity, -1, 1.5, '100', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => evaluate({ ...repo, stars }, { now: NOW }), RangeError);
  }
});

test('measures coverage from known stars forks and maintenance only', () => {
  const evaluate = api('evaluateEconomicValue');
  assert.equal(evaluate({ ...repo, forks: undefined }, { now: NOW }).coverage, 2 / 3);
  assert.equal(evaluate({ ...repo, pushedAt: undefined }, { now: NOW }).coverage, 2 / 3);
  assert.equal(evaluate({ ...repo, forks: undefined, pushedAt: undefined }, { now: NOW }).coverage, 1 / 3);
  const empty = evaluate({ stars: 0 }, { now: NOW });
  assert.equal(empty.coverage, 1 / 3);
  assert.equal(empty.components.attention, 0);
  assert.equal(empty.components.adoption, null);
  assert.equal(empty.components.maintenance, null);
  for (const topics of [[], ['saas'], ['developer-tools']]) {
    assert.equal(evaluate({ stars: 0, topics }, { now: NOW }).coverage, 1 / 3);
  }
});

test('marks invalid or future pushed times unknown and archived maintenance known zero', () => {
  const evaluate = api('evaluateEconomicValue');
  for (const pushedAt of [undefined, null, '', 'invalid date', '2026-10-13T00:00:00Z', '2026-02-30T00:00:00Z', '0', 0, {}]) {
    const result = evaluate({ ...repo, pushedAt }, { now: NOW });
    assert.equal(result.components.maintenance, null);
    assert.equal(result.coverage, 2 / 3);
  }
  const archived = evaluate({ ...repo, archived: true, pushedAt: undefined }, { now: NOW });
  assert.equal(archived.components.maintenance, 0);
  assert.equal(archived.coverage, 1);
});

test('honors explicit clocks without silently replacing invalid timestamps', () => {
  const evaluate = api('evaluateEconomicValue');
  assert.equal(evaluate(repo, { now: NOW }).components.maintenance, 100);
  assert.equal(evaluate(repo, { now: NOW + 730 * DAY }).components.maintenance, 0);
  assert.equal(evaluate(repo, { now: NOW - 30 * DAY }).components.maintenance, null);
  for (const now of [null, NaN, Infinity, '2026-10-12', Number.MAX_VALUE]) {
    assert.throws(() => evaluate(repo, { now }), RangeError);
    assert.throws(() => evaluate({}, { now }), RangeError);
  }
});

test('retains calculation precision for fractional amounts and maximum valid counts', () => {
  const evaluate = api('evaluateEconomicValue');
  const result = evaluate({ ...repo, stars: 123 }, { now: NOW });
  for (const name of CASES) {
    const assumptions = DEFAULTS.cases[name];
    assert.equal(result.monthly[name], 123 * assumptions.activeRate * assumptions.paidRate * assumptions.monthlyPrice);
  }
  const maximum = evaluate({ ...repo, stars: Number.MAX_SAFE_INTEGER }, { now: NOW });
  assert.ok(CASES.every((name) => Number.isFinite(maximum.monthly[name])));
});

test('ranks by base monthly amount by default with zero amounts and lexical ties', () => {
  const rank = api('rankEconomicValues');
  const items = Object.freeze([
    Object.freeze({ ...repo, fullName: 'Org/Zeta', stars: 100 }),
    Object.freeze({ ...repo, fullName: 'Org/Bravo', stars: 10000 }),
    Object.freeze({ ...repo, fullName: 'Org/Alpha', stars: 10000 }),
    Object.freeze({ ...repo, fullName: 'Org/Zero', stars: 0 }),
  ]);
  const sorted = rank(items, Object.freeze({ now: NOW }));
  assert.deepEqual(sorted.map((item) => item.fullName), ['Org/Alpha', 'Org/Bravo', 'Org/Zeta', 'Org/Zero']);
  assert.deepEqual(items.map((item) => item.fullName), ['Org/Zeta', 'Org/Bravo', 'Org/Alpha', 'Org/Zero']);
  assert.notEqual(sorted, items);
  assert.ok(sorted.every((item) => !items.includes(item) && Object.hasOwn(item, 'economic')));
  assert.ok(items.every((item) => !Object.hasOwn(item, 'economic')));
});

test('supports score sorting independently of monthly amount and uses name ties', () => {
  const rank = api('rankEconomicValues');
  const items = [
    { ...repo, fullName: 'Org/Large', stars: 100000, topics: ['awesome'], pushedAt: '2020-01-01T00:00:00Z' },
    { ...repo, fullName: 'Org/Bravo', stars: 10000, forks: 10000, topics: ['developer-tools'] },
    { ...repo, fullName: 'Org/Alpha', stars: 10000, forks: 10000, topics: ['developer-tools'] },
  ];
  assert.equal(rank(items, { now: NOW })[0].fullName, 'Org/Large');
  assert.deepEqual(rank(items, { now: NOW, sort: 'score' }).map((item) => item.fullName), ['Org/Alpha', 'Org/Bravo', 'Org/Large']);
});

test('keeps exact ties stable and supports empty ranking inputs', () => {
  const rank = api('rankEconomicValues');
  const items = [{ ...repo, marker: 'first' }, { ...repo, marker: 'second' }];
  for (const sort of ['base', 'score']) {
    assert.deepEqual(rank(items, { now: NOW, sort }).map((item) => item.marker), ['first', 'second']);
    assert.deepEqual(rank([], { now: NOW, sort }), []);
  }
});

test('ranking validates assumptions clocks and sort including empty inputs', () => {
  const rank = api('rankEconomicValues');
  for (const now of [null, NaN, Infinity, '2026-10-12']) {
    assert.throws(() => rank([repo], { now }), RangeError);
    assert.throws(() => rank([], { now }), RangeError);
  }
  for (const sort of [null, '', 'optimistic', 'stars', 0]) {
    assert.throws(() => rank([repo], { now: NOW, sort }), RangeError);
  }
  assert.throws(() => rank([], { now: NOW, scenario: { cases: { base: { activeRate: -1 } } } }), RangeError);
  assert.throws(() => rank([{ ...repo, stars: null }], { now: NOW }), RangeError);
});
