import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEconomicScenarioForm, readScenarioPreference, writeScenarioPreference, economicCSVData } from '../public/economics-ui.mjs';
import { toCSV } from '../public/core.mjs';

const cases = {
  conservative: { activeRate: 0.01, paidRate: 0.005, monthlyPrice: 20 },
  base: { activeRate: 0.05, paidRate: 0.01, monthlyPrice: 50 },
  optimistic: { activeRate: 0.1, paidRate: 0.02, monthlyPrice: 100 },
};
const form = {
  currency: 'CNY',
  'conservative.activeRate': '1', 'conservative.paidRate': '0.5', 'conservative.monthlyPrice': '20',
  'base.activeRate': '5', 'base.paidRate': '1', 'base.monthlyPrice': '50',
  'optimistic.activeRate': '10', 'optimistic.paidRate': '2', 'optimistic.monthlyPrice': '100',
};

test('form percentages convert to ratios while zero remains a valid assumption', () => {
  assert.deepEqual(parseEconomicScenarioForm(form), { currency: 'CNY', cases });
  const zero = parseEconomicScenarioForm({ ...form, 'conservative.activeRate': '0', 'conservative.paidRate': '0', 'conservative.monthlyPrice': '0' });
  assert.deepEqual(zero.cases.conservative, { activeRate: 0, paidRate: 0, monthlyPrice: 0 });
});

test('blank and nonnumeric form values cannot silently become valid zero assumptions', () => {
  for (const value of ['', '  ', 'abc', 'Infinity']) {
    assert.throws(() => parseEconomicScenarioForm({ ...form, 'base.activeRate': value }), RangeError);
  }
});

test('unavailable or malformed storage falls back without changing the separate saved scenario', () => {
  const fallback = { currency: 'CNY' };
  const normalize = (value) => { if (!['CNY', 'USD'].includes(value.currency)) throw new RangeError('invalid'); return { ...value }; };
  assert.deepEqual(readScenarioPreference({ getItem() { throw new Error('denied'); } }, 'economic', normalize, fallback), fallback);
  assert.deepEqual(readScenarioPreference({ getItem() { return '{broken'; } }, 'economic', normalize, fallback), fallback);
  assert.deepEqual(readScenarioPreference({ getItem() { return '{"currency":"JPY"}'; } }, 'economic', normalize, fallback), fallback);
  const storage = new Map([['potential', '{"currency":"USD"}']]);
  const adapter = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  assert.equal(writeScenarioPreference(adapter, 'economic', fallback), true);
  assert.deepEqual(readScenarioPreference(adapter, 'economic', normalize, fallback), fallback);
  assert.equal(storage.get('potential'), '{"currency":"USD"}');
  assert.equal(writeScenarioPreference({ setItem() { throw new Error('denied'); } }, 'economic', fallback), false);
});

test('scenario CSV includes all cases, zero values, coverage, provenance and formula protection', () => {
  const repo = { fullName: '=danger/project', stars: 10000, url: 'https://github.com/owner/project', economic: { score: 42, category: '其他', coverage: 0.55, components: { attention: 80, adoption: null, maintenance: 0, category: 50 }, monthly: { conservative: 0, base: 250, optimistic: 2000 } } };
  const { headers, rows } = economicCSVData([repo], { scenario: { currency: 'CNY', cases }, sort: 'base', fetchedAt: '2026-10-12T00:00:00Z' });
  assert.equal(rows[0][headers.indexOf('保守模拟月收入')], 0);
  assert.equal(rows[0][headers.indexOf('指标完整度')], 0.55);
  assert.equal(rows[0][headers.indexOf('维护度分项')], 0);
  assert.equal(rows[0][headers.indexOf('采用度分项')], '未知');
  assert.equal(rows[0][headers.indexOf('保守假设活跃比例')], 0.01);
  assert.equal(rows[0][headers.indexOf('基准假设付费比例')], 0.01);
  assert.equal(rows[0][headers.indexOf('积极假设月客单价')], 100);
  assert.equal(rows[0][headers.indexOf('测算币种')], 'CNY');
  assert.equal(rows[0][headers.indexOf('指标采集时间')], '2026-10-12T00:00:00Z');
  assert.equal(rows[0][headers.indexOf('模拟标识')], '假设测算，非实际收入');
  assert.match(toCSV(headers, rows), /'=danger\/project/);
});
