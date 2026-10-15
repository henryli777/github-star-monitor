import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('support remains outside the horizontally scrolling mobile navigation', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<\/nav>\s*<a class="support-link sidebar-support"[^>]+href="https:\/\/support\.coinexo\.top\/\?project=starscope"/);
  assert.match(html, /class="icon support-heart"/);
});

test('public detail states have support without adding it to private forms', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');
  const detail = app.slice(app.indexOf('async function detailDialog('), app.indexOf('async function refresh('));
  assert.match(detail, /if \(!canWrite\(\)\) \$\('#modal'\)\.classList\.add\('public-detail'\)/);
  assert.match(app, /function openModal\(content\) \{[^\n]*classList\.remove\('public-detail'\)/);
  assert.match(html, /class="support-link dialog-support"/);
});
