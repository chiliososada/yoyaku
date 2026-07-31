import { chromium } from '@playwright/test';
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage();
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
  await page.getByLabel('メールアドレス').fill(process.env.E2E_EMAIL!);
  await page.getByLabel('パスワード').fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await page.waitForURL('**/admin**', { timeout: 30000 });
  const r = await page.request.get('http://localhost:3000/admin/export/bookings?month=2026-07');
  const body = await r.text();
  for (const line of body.split('\n')) if (line.includes('evil.example')) console.log('ROW:', line);
  await b.close();
})();
