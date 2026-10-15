import assert from 'node:assert/strict';
import test from 'node:test';
import * as potential from '../public/potential.mjs';

const NOW = Date.parse('2026-10-12T00:00:00Z');
const DAY = 86400000;
const repo = Object.freeze({
  fullName: 'Org/Product', stars: 10000, forks: 1000,
  topics: Object.freeze(['saas']), description: 'Team collaboration app',
  pushedAt: '2026-10-01T00:00:00Z', archived: false,
});

function api(name) {
  assert.equal(typeof potential[name], 'function', `${name} must be implemented`);
  return potential[name];
}

test('uses the declared scenario to calculate monthly revenue from stars', () => {
  const evaluate = api('evaluatePotential');
  const result = evaluate(repo, { now: NOW });
  assert.equal(result.monthlyRevenue, 1000);
  assert.deepEqual(result.assumptions, { activeRate: 0.1, paidRate: 0.02, monthlyPrice: 50, currency: 'CNY' });
  assert.equal(result.category, '应用产品');
  assert.equal(result.components.category, 85);
  assert.ok(Number.isInteger(result.score) && result.score >= 0 && result.score <= 100);
});

test('merges partial scenarios with defaults without modifying the input', () => {
  const normalize = api('normalizeScenario');
  const input = Object.freeze({ monthlyPrice: 20, currency: 'USD' });
  assert.deepEqual(normalize(input), { activeRate: 0.1, paidRate: 0.02, monthlyPrice: 20, currency: 'USD' });
  assert.deepEqual(normalize(), { activeRate: 0.1, paidRate: 0.02, monthlyPrice: 50, currency: 'CNY' });
});

test('accepts inclusive scenario boundaries and each supported currency', () => {
  const normalize = api('normalizeScenario');
  for (const currency of ['CNY', 'USD', 'EUR']) {
    assert.deepEqual(normalize({ activeRate: 0, paidRate: 0, monthlyPrice: 0, currency }), { activeRate: 0, paidRate: 0, monthlyPrice: 0, currency });
    assert.deepEqual(normalize({ activeRate: 1, paidRate: 1, monthlyPrice: 100000, currency }), { activeRate: 1, paidRate: 1, monthlyPrice: 100000, currency });
  }
});

test('rejects invalid rates instead of coercing numbers or allowing nonfinite values', () => {
  const normalize = api('normalizeScenario');
  for (const key of ['activeRate', 'paidRate']) {
    for (const value of [-0.01, 1.01, NaN, Infinity, -Infinity, '0.1', null, undefined, true, {}]) {
      assert.throws(() => normalize({ [key]: value }), RangeError, `${key}: ${String(value)}`);
    }
  }
});

test('rejects invalid prices currencies and scenario containers', () => {
  const normalize = api('normalizeScenario');
  for (const monthlyPrice of [-1, 100001, NaN, Infinity, '50', null, undefined, false]) {
    assert.throws(() => normalize({ monthlyPrice }), RangeError);
  }
  for (const currency of ['cny', 'GBP', '', null, undefined, {}]) {
    assert.throws(() => normalize({ currency }), RangeError);
  }
  for (const input of [null, [], 1, 'scenario', true]) {
    assert.throws(() => normalize(input), RangeError);
  }
});

test('applies explicit assumptions including zero rates and nondefault currency', () => {
  const evaluate = api('evaluatePotential');
  const result = evaluate(repo, { now: NOW, scenario: { activeRate: 0.2, paidRate: 0.05, monthlyPrice: 20, currency: 'EUR' } });
  assert.equal(result.monthlyRevenue, 2000);
  assert.equal(result.assumptions.currency, 'EUR');
  assert.equal(evaluate(repo, { now: NOW, scenario: { paidRate: 0 } }).monthlyRevenue, 0);
  assert.throws(() => evaluate(repo, { now: NOW, scenario: { activeRate: Infinity } }), RangeError);
});

test('saturates logarithmic attention and adoption while retaining zero counts', () => {
  const evaluate = api('evaluatePotential');
  const zero = evaluate({ ...repo, stars: 0, forks: 0 }, { now: NOW });
  assert.equal(zero.components.attention, 0);
  assert.equal(zero.components.adoption, 0);
  assert.equal(zero.monthlyRevenue, 0);
  const upper = evaluate({ ...repo, stars: 100000, forks: 10000 }, { now: NOW });
  assert.equal(upper.components.attention, 100);
  assert.equal(upper.components.adoption, 100);
  const higher = evaluate({ ...repo, stars: 1000000, forks: 100000 }, { now: NOW });
  assert.equal(higher.components.attention, 100);
  assert.equal(higher.components.adoption, 100);
  assert.ok(evaluate({ ...repo, stars: 100 }, { now: NOW }).components.attention < evaluate({ ...repo, stars: 10000 }, { now: NOW }).components.attention);
});

test('rejects invalid stars so missing data cannot create a normal score or revenue', () => {
  const evaluate = api('evaluatePotential');
  for (const stars of [undefined, null, NaN, Infinity, -1, 1.5, '100', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => evaluate({ ...repo, stars }, { now: NOW }), RangeError, String(stars));
  }
});

test('keeps missing or invalid fork counts unknown and renormalizes known weights', () => {
  const evaluate = api('evaluatePotential');
  for (const forks of [undefined, null, NaN, Infinity, -1, '100', 1.5]) {
    const result = evaluate({ ...repo, stars: 100000, forks, topics: ['developer-tools'] }, { now: NOW });
    assert.equal(result.components.adoption, null);
    assert.equal(result.score, 100);
  }
});

test('keeps absent invalid and future pushes unknown instead of reporting activity', () => {
  const evaluate = api('evaluatePotential');
  for (const pushedAt of [undefined, null, '', 'invalid date', '2026-10-13T00:00:00Z', 0, {}, Infinity]) {
    const result = evaluate({ ...repo, stars: 100000, forks: 0, topics: ['developer-tools'], pushedAt }, { now: NOW });
    assert.equal(result.components.maintenance, null, String(pushedAt));
    assert.equal(result.score, 79, String(pushedAt));
  }
});

test('scores maintenance at all age boundaries with an injectable clock', () => {
  const evaluate = api('evaluatePotential');
  for (const [days, expected] of [[0, 100], [30, 100], [31, 80], [90, 80], [91, 60], [180, 60], [181, 35], [365, 35], [366, 0], [730, 0]]) {
    const result = evaluate({ ...repo, pushedAt: new Date(NOW - days * DAY).toISOString() }, { now: NOW });
    assert.equal(result.components.maintenance, expected, `${days} days`);
  }
  const fresh = evaluate(repo, { now: NOW });
  const stale = evaluate(repo, { now: NOW + 730 * DAY });
  assert.ok(fresh.score > stale.score);
});

test('keeps impossible calendar dates and ambiguous parser inputs unknown', () => {
  const evaluate = api('evaluatePotential');
  for (const pushedAt of ['2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z', '2026-04-31', '0', '10/01/2026']) {
    assert.equal(evaluate({ ...repo, pushedAt }, { now: NOW }).components.maintenance, null, pushedAt);
  }
  assert.equal(evaluate({ ...repo, pushedAt: '2026-10-01' }, { now: NOW }).components.maintenance, 100);
  assert.equal(evaluate({ ...repo, pushedAt: '2026-10-01T08:00:00+08:00' }, { now: NOW }).components.maintenance, 100);
});

test('archived repositories always have zero maintenance even with missing or fresh pushes', () => {
  const evaluate = api('evaluatePotential');
  for (const pushedAt of [undefined, repo.pushedAt, 'invalid date']) {
    const result = evaluate({ ...repo, archived: true, pushedAt }, { now: NOW });
    assert.equal(result.components.maintenance, 0);
    assert.ok(result.score < evaluate(repo, { now: NOW }).score);
  }
});

test('rejects invalid clock values that could silently manufacture activity', () => {
  const evaluate = api('evaluatePotential');
  for (const now of [NaN, Infinity, null, '2026-10-12', Number.MAX_VALUE]) {
    assert.throws(() => evaluate(repo, { now }), RangeError);
  }
});

test('classifies repository topics and descriptions without asserting paid traction', () => {
  const evaluate = api('evaluatePotential');
  for (const [topics, description, category, score] of [
    [['developer-tools'], '', '开发工具/基础设施', 100],
    [['database'], '', '开发工具/基础设施', 100],
    [[], 'A distributed database for teams', '开发工具/基础设施', 100],
    [['saas'], '', '应用产品', 85],
    [[], '团队协作和任务管理应用', '应用产品', 85],
    [['awesome', 'docker'], '', '学习资料', 20],
    [[], 'A tutorial for learning databases', '学习资料', 20],
    [['developer-tools'], 'Interactive roadmaps, guides and other educational content to help developers grow in their careers.', '学习资料', 20],
    [[], '面试学习资料与课程', '学习资料', 20],
    [[], '', '其他', 50],
    [[], 'An appealing experiment', '其他', 50],
  ]) {
    const result = evaluate({ ...repo, topics, description }, { now: NOW });
    assert.equal(result.category, category, description || topics.join(','));
    assert.equal(result.components.category, score);
  }
});

test('ignores malformed topics and descriptions without stringifying arbitrary objects', () => {
  const evaluate = api('evaluatePotential');
  const hostile = Object.freeze({ toString() { throw new Error('must not stringify'); } });
  for (const topics of [null, undefined, {}, 'saas', hostile, [null, 1, hostile, ['saas']]]) {
    const result = evaluate({ ...repo, topics, description: hostile }, { now: NOW });
    assert.equal(result.category, '其他');
  }
  assert.equal(evaluate({ ...repo, topics: [hostile, 'SAAS'], description: hostile }, { now: NOW }).category, '应用产品');
});

test('combines known components with the declared weights', () => {
  const evaluate = api('evaluatePotential');
  const result = evaluate({ ...repo, stars: 100000, forks: 0, topics: ['saas'], pushedAt: '2025-01-01T00:00:00Z' }, { now: NOW });
  assert.deepEqual(result.components, { attention: 100, adoption: 0, maintenance: 0, category: 85 });
  assert.equal(result.score, 51);
});

test('ranks potential before stars and resolves ties lexically without mutating repositories', () => {
  const rank = api('rankPotential');
  const options = Object.freeze({ now: NOW });
  const items = Object.freeze([
    Object.freeze({ ...repo, fullName: 'Org/Zeta', stars: 100000, topics: ['awesome'], pushedAt: '2025-01-01T00:00:00Z' }),
    Object.freeze({ ...repo, fullName: 'Org/Bravo', stars: 100000, forks: 10000, topics: ['developer-tools'] }),
    Object.freeze({ ...repo, fullName: 'Org/Alpha', stars: 100000, forks: 10000, topics: ['developer-tools'] }),
    Object.freeze({ ...repo, fullName: 'Org/Highest', stars: 100001, forks: 10000, topics: ['developer-tools'] }),
  ]);
  const sorted = rank(items, options);
  assert.deepEqual(sorted.map((item) => item.fullName), ['Org/Highest', 'Org/Alpha', 'Org/Bravo', 'Org/Zeta']);
  assert.deepEqual(items.map((item) => item.fullName), ['Org/Zeta', 'Org/Bravo', 'Org/Alpha', 'Org/Highest']);
  assert.notEqual(sorted, items);
  assert.ok(sorted.every((item) => !items.includes(item) && Number.isInteger(item.potential.score)));
  assert.ok(items.every((item) => !Object.hasOwn(item, 'potential')));
});

test('keeps equal ranking keys in their input order and accepts empty arrays', () => {
  const rank = api('rankPotential');
  const items = [{ ...repo, marker: 'first' }, { ...repo, marker: 'second' }];
  assert.deepEqual(rank(items, { now: NOW }).map((item) => item.marker), ['first', 'second']);
  assert.deepEqual(rank([], { now: NOW }), []);
});

test('ranking does not replace explicitly invalid clocks with the current time', () => {
  const rank = api('rankPotential');
  for (const now of [null, NaN, Infinity, '2026-10-12']) {
    assert.throws(() => rank([repo], { now }), RangeError);
  }
});
