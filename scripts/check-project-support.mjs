async (page) => {
  const base = new URL(page.url()).origin;
  const run = Date.now();
  await page.route('**/*', (route) => route.continue());
  const product = (await page.title()).includes('XScope') ? 'xscope' : 'starscope';
  const routes = product === 'starscope'
    ? ['potential', 'ranking', 'new', 'revenue', 'monitors', 'sources']
    : ['overview', 'sources', 'ranking', 'monitoring', 'revenue', 'settings', 'help'];
  const failures = [];
  let checks = 0;
  async function check(label, selector = 'a[href^="https://support.coinexo.top/"]') {
    const result = await page.evaluate(({ selector, product }) => {
      const links = [...document.querySelectorAll(selector)];
      const visible = links.filter((link) => {
        const r = link.getBoundingClientRect();
        const style = getComputedStyle(link);
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return style.display !== 'none' && style.visibility !== 'hidden'
          && r.width > 0 && r.height >= 24 && r.x >= 0 && r.y >= 0
          && r.right <= innerWidth && r.bottom <= innerHeight && link.contains(hit);
      });
      return {
        usable: visible.some((link) => link.textContent.includes('支持项目')
          && new URL(link.href).searchParams.get('project') === product
          && link.target === '_blank' && link.rel.includes('noopener')),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    }, { selector, product });
    checks++;
    if (!result.usable || result.overflow) failures.push({ label, ...result });
  }
  for (const { width, height } of [{ width: 1440, height: 900 }, { width: 800, height: 900 }, { width: 701, height: 900 }, { width: 390, height: 900 }, { width: 320, height: 900 }, { width: 1366, height: 300 }]) {
    await page.setViewportSize({ width, height });
    for (const route of routes) {
      await page.goto(`${base}/?support-check=${run}#${route}`);
      const active = product === 'starscope' ? `.nav-item.active[data-view="${route}"]` : `.navigation a.active[data-page="${route}"]`;
      await page.locator(active).waitFor({ state: 'attached' });
      for (const y of [0, 500, 1000]) {
        await page.evaluate((y) => new Promise((resolve) => {
          window.scrollTo(0, y);
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }), y);
        await check(`${product}:${width}x${height}:${route}:${y}`);
      }
    }
  }
  if (product === 'starscope') {
    const repo = { fullName: 'support-check/project', name: 'project', owner: 'support-check', stars: 1200, forks: 50, language: 'JavaScript', topics: [], description: 'Browser regression fixture', url: 'https://github.com/support-check/project' };
    await page.route('**/api/rankings?*', (route) => route.fulfill({ json: { items: [repo], meta: { fetchedAt: new Date().toISOString() } } }));
    let pending;
    let notifyRequest;
    const requested = new Promise((resolve) => { notifyRequest = resolve; });
    await page.route('**/api/repo?*', (route) => { pending = route; notifyRequest(); });
    await page.goto(`${base}/?support-check=detail#ranking`);
    await page.locator('.repo-name[data-action="detail"]').first().click();
    await requested;
    await check('starscope:detail-loading', '#modal a[href^="https://support.coinexo.top/"]');
    await pending.fulfill({ json: { item: repo, history: [] } });
    await page.locator('#modal .detail-header').waitFor();
    await check('starscope:detail-success', '#modal a[href^="https://support.coinexo.top/"]');
    await page.locator('#modal-close').click();
    await page.unroute('**/api/repo?*');
    await page.route('**/api/repo?*', (route) => route.fulfill({ status: 503, json: { error: { message: 'Support detail regression: unavailable' } } }));
    await page.locator('.repo-name[data-action="detail"]').first().click();
    await page.locator('#modal .form-error').waitFor();
    await check('starscope:detail-error', '#modal a[href^="https://support.coinexo.top/"]');
    await page.locator('#modal-close').click();
    await page.unroute('**/api/repo?*');
    await page.unroute('**/api/rankings?*');
  }
  await page.route('**/api/**', (route) => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Support regression: unavailable' } }),
  }));
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/?support-check=error-${width}#${routes[0]}`);
    await check(`${product}:${width}:initial-loading`);
    await page.locator(product === 'starscope' ? '#table-area[aria-busy="false"]' : '#main .empty-state').waitFor({ state: 'attached' });
    await check(`${product}:${width}:data-error`);
  }
  await page.unroute('**/api/**');
  await page.goto(`${base}/#${routes[0]}`);
  console.log(JSON.stringify({ product, checks, failures }, null, 2));
  if (failures.length) throw new Error(`${failures.length} project support checks failed`);
  return { product, checks, failures };
}
