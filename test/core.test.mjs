import assert from 'node:assert/strict';
import test from 'node:test';
import * as core from '../public/core.mjs';

test('formats counts compactly without hiding zero', () => {
  assert.equal(typeof core.formatNumber, 'function');
  assert.equal(core.formatNumber(0), '0');
  assert.equal(core.formatNumber(999), '999');
  assert.equal(core.formatNumber(1234), '1.2K');
  assert.equal(core.formatNumber(2400000), '2.4M');
});

test('formats absent and invalid metrics as an em dash', () => {
  assert.equal(typeof core.formatNumber, 'function');
  for (const value of [null, undefined, NaN, Infinity, '']) {
    assert.equal(core.formatNumber(value), '—');
  }
});

test('formats disclosure amounts with Chinese currency formatting', () => {
  assert.equal(typeof core.formatMoney, 'function');
  assert.equal(core.formatMoney(1234.5, 'USD'), 'US$1,234.50');
  assert.equal(core.formatMoney(0, 'CNY'), '¥0.00');
  assert.equal(core.formatMoney(1234.5, 'EUR'), '€1,234.50');
  assert.equal(core.formatMoney(null, 'USD'), '—');
  assert.equal(core.formatMoney(NaN, 'CNY'), '—');
});

test('normalizes repository names and exact GitHub HTTPS URLs', () => {
  assert.equal(typeof core.normalizeRepoInput, 'function');
  const cases = [
    [' OpenAI/ChatGPT ', 'OpenAI/ChatGPT'],
    ['https://github.com/OpenAI/ChatGPT', 'OpenAI/ChatGPT'],
    ['https://github.com/OpenAI/ChatGPT/', 'OpenAI/ChatGPT'],
    ['https://github.com/OpenAI/ChatGPT.git', 'OpenAI/ChatGPT'],
    ['https://github.com/OpenAI/ChatGPT.git/', 'OpenAI/ChatGPT'],
    ['OpenAI/ChatGPT.git', 'OpenAI/ChatGPT'],
    ['some-org/.github', 'some-org/.github'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(core.normalizeRepoInput(input), expected, input);
  }
});

test('rejects ambiguous repository URLs and invalid names', () => {
  assert.equal(typeof core.normalizeRepoInput, 'function');
  const rejected = [
    '', null, {}, 'owner', 'owner/repo/tree/main', 'owner/repo?x=1',
    'http://github.com/owner/repo', 'https://example.com/owner/repo',
    'https://github.com.evil.test/owner/repo',
    'https://user:secret@github.com/owner/repo',
    'https://github.com:443/owner/repo',
    'https://github.com/owner/repo?q=x', 'https://github.com/owner/repo?',
    'https://github.com/owner/repo#readme', 'https://github.com/owner/repo#',
    'https://github.com/owner/repo//', 'https://github.com/owner/../repo',
    'https://github.com/owner/repo%2Fextra', 'owner/..', '-owner/repo',
    'owner/re po', 'https://github.com/owner/repo\n/x',
  ];
  for (const input of rejected) {
    assert.equal(core.normalizeRepoInput(input), '', String(input));
  }
});

test('keeps only the newest revenue disclosure per repository in the selected currency and period', () => {
  assert.equal(typeof core.selectRevenues, 'function');
  const items = [
    { id: 'old', repo: 'Org/First', amount: 900, currency: 'USD', period: 'monthly', date: '2025-01-01' },
    { id: 'new', repo: 'org/first', amount: 100, currency: 'USD', period: 'monthly', date: '2025-02-01' },
    { id: 'second', repo: 'Org/Second', amount: 200, currency: 'USD', period: 'monthly', date: '2025-01-01' },
    { id: 'other-currency', repo: 'Org/First', amount: 9999, currency: 'CNY', period: 'monthly', date: '2025-03-01' },
    { id: 'other-period', repo: 'Org/First', amount: 9999, currency: 'USD', period: 'yearly', date: '2025-03-01' },
  ];
  assert.deepEqual(core.selectRevenues(items).map((item) => item.id), ['second', 'new']);
  assert.deepEqual(core.selectRevenues(items, { currency: 'CNY' }).map((item) => item.id), ['other-currency']);
  assert.deepEqual(core.selectRevenues(items, { period: 'yearly' }).map((item) => item.id), ['other-period']);
  assert.deepEqual(items.map((item) => item.id), ['old', 'new', 'second', 'other-currency', 'other-period']);
});

test('searches repository revenue disclosures case insensitively and supports one-time periods', () => {
  assert.equal(typeof core.selectRevenues, 'function');
  const items = [
    { id: 'first', repo: 'Org/First', amount: 5, currency: 'USD', period: 'one-time', date: '2025-01-01' },
    { id: 'second', repo: 'Other/Second', amount: 10, currency: 'USD', period: 'one-time', date: '2025-01-01' },
  ];
  assert.deepEqual(core.selectRevenues(items, { period: 'one-time', query: '  ORG/FIR  ' }).map((item) => item.id), ['first']);
  assert.deepEqual(core.selectRevenues(items, { currency: 'EUR', period: 'one-time' }), []);
});

test('searches repository names descriptions and topics while applying language and topic filters', () => {
  assert.equal(typeof core.filterRepos, 'function');
  const items = [
    { fullName: 'Org/Alpha', name: 'Alpha', description: 'A fast editor', topics: ['Tools', 'Editor'], language: 'TypeScript', stars: 30 },
    { fullName: 'Org/Beta', name: 'Beta', description: 'Another utility', topics: ['tools'], language: 'Python', stars: 20 },
    { fullName: 'Other/Gamma', name: 'Gamma', description: null, topics: ['machine-learning'], language: null, stars: 10 },
  ];
  assert.deepEqual(core.filterRepos(items, { query: ' ALPHA ' }).map((item) => item.name), ['Alpha']);
  assert.deepEqual(core.filterRepos(items, { query: 'FAST' }).map((item) => item.name), ['Alpha']);
  assert.deepEqual(core.filterRepos(items, { query: 'MACHINE' }).map((item) => item.name), ['Gamma']);
  assert.deepEqual(core.filterRepos(items, { query: 'org', language: 'typescript', topic: 'tools' }).map((item) => item.name), ['Alpha']);
  assert.deepEqual(core.filterRepos(items, { topic: 'tool' }), []);
});

test('sorts stars descending without mutating the original repository list', () => {
  assert.equal(typeof core.filterRepos, 'function');
  const items = [
    { fullName: 'Org/Low', stars: 1 },
    { fullName: 'Org/High', stars: 20 },
    { fullName: 'Org/Unknown', stars: null },
    { fullName: 'Org/Zero', stars: 0 },
  ];
  assert.deepEqual(core.filterRepos(items).map((item) => item.fullName), ['Org/High', 'Org/Low', 'Org/Zero', 'Org/Unknown']);
  assert.deepEqual(items.map((item) => item.fullName), ['Org/Low', 'Org/High', 'Org/Unknown', 'Org/Zero']);
});

test('sorts every growth period with unknown values last even when growth is negative', () => {
  assert.equal(typeof core.filterRepos, 'function');
  const items = [
    { fullName: 'Org/A', growth: { day: -3, week: 1, month: 20 } },
    { fullName: 'Org/B', growth: { day: 0, week: 4, month: -2 } },
    { fullName: 'Org/C', growth: { day: null, week: null, month: null } },
    { fullName: 'Org/D' },
  ];
  assert.deepEqual(core.filterRepos(items, { sort: 'day' }).map((item) => item.fullName), ['Org/B', 'Org/A', 'Org/C', 'Org/D']);
  assert.deepEqual(core.filterRepos(items, { sort: 'week' }).map((item) => item.fullName), ['Org/B', 'Org/A', 'Org/C', 'Org/D']);
  assert.deepEqual(core.filterRepos(items, { sort: 'month' }).map((item) => item.fullName), ['Org/A', 'Org/B', 'Org/C', 'Org/D']);
});

test('accepts explicit growth property names as sort values', () => {
  const items = [
    { fullName: 'Org/Low', stars: 200, growth: { day: 1, week: 1, month: 1 } },
    { fullName: 'Org/High', stars: 100, growth: { day: 10, week: 10, month: 10 } },
  ];
  for (const sort of ['growth.day', 'growth.week', 'growth.month']) {
    assert.deepEqual(core.filterRepos(items, { sort }).map((item) => item.fullName), ['Org/High', 'Org/Low']);
  }
});

test('escapes untrusted text and attribute characters for HTML', () => {
  assert.equal(typeof core.escapeHtml, 'function');
  assert.equal(core.escapeHtml('<a href="x" onclick=\'bad\'>&'), '&lt;a href=&quot;x&quot; onclick=&#39;bad&#39;&gt;&amp;');
  assert.equal(core.escapeHtml(null), '');
  assert.equal(core.escapeHtml(0), '0');
});

test('accepts validated HTTP source links while excluding executable and credentialed URLs', () => {
  assert.equal(typeof core.safeSourceUrl, 'function');
  assert.equal(core.safeSourceUrl('https://example.com/revenue?q=monthly#detail'), 'https://example.com/revenue?q=monthly#detail');
  assert.equal(core.safeSourceUrl(' http://example.com/report '), 'http://example.com/report');
  const rejected = [
    null, '', '/relative/path', '//example.com', 'https://',
    'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd', 'ftp://example.com', 'https://user:secret@example.com/report',
    'https://example.com/\nreport',
  ];
  for (const input of rejected) assert.equal(core.safeSourceUrl(input), '', String(input));
});

test('exports BOM CSV with quoted commas quotes and line breaks', () => {
  assert.equal(typeof core.toCSV, 'function');
  const csv = core.toCSV(['repo', 'notes', 'amount'], [
    ['Org/Repo', 'hello, "world"\nnext', 0],
    ['Org/Other', null, 100],
  ]);
  assert.equal(csv, '\uFEFFrepo,notes,amount\r\nOrg/Repo,"hello, ""world""\nnext",0\r\nOrg/Other,,100');
});

test('neutralizes spreadsheet formulas including formulas after whitespace', () => {
  assert.equal(typeof core.toCSV, 'function');
  const csv = core.toCSV(['=header', 'normal'], [
    ['=SUM(A1:A2)', 'safe'],
    ['  +cmd', '\t-cmd'],
    ['\r\n@cmd', '-1'],
    ['\u00A0=1+1', '@cmd'],
  ]);
  assert.equal(csv, "\uFEFF'=header,normal\r\n'=SUM(A1:A2),safe\r\n'  +cmd,'\t-cmd\r\n\"'\r\n@cmd\",'-1\r\n'\u00A0=1+1,'@cmd");
});
