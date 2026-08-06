import { test, expect } from '@playwright/test';

test.describe('News section', () => {
  test('header title matches section pages and week strip is compact', async ({ page }) => {
    await page.goto('/news');
    await expect(page.locator('.header')).toBeVisible();
    await expect(page.locator('.header__page-title')).toHaveText(/Новости|News/i);
    await expect(page.locator('.news-head__title')).toHaveCount(0);
    await expect(page.locator('.news-cal')).toHaveCount(0);
    const bar = page.locator('.news-bar');
    await expect(bar).toBeVisible();
    const box = await bar.boundingBox();
    expect(box.height).toBeLessThan(140);
    await expect(page.locator('.news-week__day')).toHaveCount(7);
  });

  test('SSR news index stays visually hidden and does not open a calendar-feed gap', async ({
    page
  }) => {
    await page.goto('/news');
    const index = page.locator('[data-news-ssr-index]');
    await expect(index).toHaveCount(1);
    await expect(index).toHaveClass(/news-ssr-index/);
    await expect(index).toHaveClass(/sr-only/);

    const metrics = await page.evaluate(() => {
      const bar = document.querySelector('.news-bar');
      const feed = document.querySelector('main.news-feed');
      const ssr = document.querySelector('[data-news-ssr-index]');
      if (!bar || !feed || !ssr) return null;
      const barBox = bar.getBoundingClientRect();
      const feedBox = feed.getBoundingClientRect();
      const ssrBox = ssr.getBoundingClientRect();
      const style = getComputedStyle(ssr);
      return {
        gap: feedBox.top - barBox.bottom,
        ssrHeight: ssrBox.height,
        ssrWidth: ssrBox.width,
        position: style.position,
        overflow: style.overflow
      };
    });
    expect(metrics).toBeTruthy();
    // Hidden clip box should be tiny; visible list used to push feed hundreds of px down
    expect(metrics.ssrHeight).toBeLessThanOrEqual(2);
    expect(metrics.ssrWidth).toBeLessThanOrEqual(2);
    expect(metrics.position).toBe('absolute');
    expect(metrics.gap).toBeLessThan(80);
  });

  test('feed shows on-site cards without external article links', async ({ page }) => {
    await page.goto('/news');
    await page.waitForSelector('.news-card, .news-empty', { timeout: 20000 });
    const cards = page.locator('.news-card');
    const count = await cards.count();
    test.skip(count === 0, 'no articles in feed yet');
    await expect(cards.first().locator('a[target="_blank"]')).toHaveCount(0);
    await expect(cards.first().locator('.news-card__title')).toBeVisible();
  });

  test('opening a card shows full article text on Sitrifor', async ({ page }) => {
    await page.goto('/news');
    await page.waitForSelector('.news-card', { timeout: 20000 });
    const first = page.locator('.news-card').first();
    await first.click();
    await expect(page).toHaveURL(/\/news\/a\/.+/);
    await expect(page.locator('.news-article__title')).toBeVisible();
    const body = page.locator('.news-article__body');
    await expect(body).toBeVisible();
    const text = (await body.innerText()).trim();
    expect(text.length).toBeGreaterThan(40);
    await expect(page.locator('.news-article__body a[href^="http"]')).toHaveCount(0);
  });

  test('News is in footer, not in menu', async ({ page }) => {
    await page.goto('/masters');
    await page.locator('[data-menu-toggle]').click();
    await expect(page.locator('.nav-drawer__panel [data-nav="news"]')).toHaveCount(0);
    await expect(page.locator('.site-footer__links a[href="/news"]')).toBeVisible();
  });

  test('reactions endpoint responds for an article', async ({ request, page }) => {
    await page.goto('/news');
    await page.waitForSelector('.news-card', { timeout: 20000 });
    const id = await page.locator('.news-card').first().getAttribute('data-id');
    const res = await request.post('/api/news/react', {
      data: { articleId: Number(id), reaction: 'smile', vid: 'pw_test_' + Date.now() }
    });
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.ok).toBeTruthy();
    expect(json.article?.reactions).toBeTruthy();
  });

  test('feed articles are tattoo-related', async ({ page }) => {
    await page.goto('/news');
    await page.waitForSelector('.news-card', { timeout: 20000 });
    const titles = await page.locator('.news-card__title').allTextContents();
    expect(titles.length).toBeGreaterThan(0);
    const joined = titles.join(' ').toLowerCase();
    const hasTattooSignal = /tattoo|тату|irezumi|blackwork|ink|sleeve|hannya|aftercare|artist|эскиз|мастер/.test(joined);
    expect(hasTattooSignal).toBeTruthy();
    expect(/disney\+|toy story|concert hall|love island/i.test(joined)).toBeFalsy();
  });

  test('language switch changes article titles', async ({ page, request }) => {
    await page.addInitScript(() => {
      localStorage.setItem('sitrifor_lang', 'ru');
    });
    await page.goto('/news');
    await page.waitForSelector('.news-card__title', { timeout: 20000 });
    const ru = (await page.locator('.news-card__title').first().innerText()).trim();
    expect(/[А-Яа-яЁё]/.test(ru)).toBeTruthy();

    const enWait = page.waitForResponse((r) => r.url().includes('/api/news/day?') && r.url().includes('lang=en') && r.ok(), { timeout: 15000 });
    await page.locator('[data-lang-switch="en"]').click();
    await enWait;
    await expect.poll(async () => (await page.locator('.news-card__title').first().innerText()).trim()).not.toEqual(ru);
    const en = (await page.locator('.news-card__title').first().innerText()).trim();
    expect(/[А-Яа-яЁё]/.test(en)).toBeFalsy();

    const deWait = page.waitForResponse((r) => r.url().includes('/api/news/day?') && r.url().includes('lang=de') && r.ok(), { timeout: 15000 });
    await page.locator('[data-lang-switch="de"]').click();
    await deWait;

    const api = await request.get('/api/news/item/new-outline-off-to-a-good-start?lang=de');
    expect(api.ok()).toBeTruthy();
    const deItem = await api.json();
    expect(deItem.title.toLowerCase()).toContain('neue');
  });

});
