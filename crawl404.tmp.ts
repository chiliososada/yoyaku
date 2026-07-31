import { chromium } from '@playwright/test';
const BASE = 'http://localhost:3000';
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const bad: string[] = [];
  page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });
  page.on('pageerror', (e) => bad.push(`pageerror: ${e.message}`));
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel('メールアドレス').fill(process.env.E2E_EMAIL!);
  await page.getByLabel('パスワード').fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await page.waitForURL('**/admin**', { timeout: 30000 });
  for (const p of ['/admin/export', '/admin/shops', '/admin/reports', '/admin/customers']) {
    bad.length = 0;
    await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    console.log(`== ${p}`, bad.length ? bad.join(' | ') : 'clean');
  }
  await b.close();
})();
