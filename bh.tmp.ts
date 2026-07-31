import { chromium } from '@playwright/test';
const BASE = 'http://localhost:3000';
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel('メールアドレス').fill(process.env.E2E_EMAIL!);
  await page.getByLabel('パスワード').fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await page.waitForURL('**/admin**', { timeout: 30000 });

  await page.goto(`${BASE}/admin/business-hours`, { waitUntil: 'networkidle' });
  const add = page.getByRole('button', { name: /時間帯を追加/ });
  // 同じ既定値（月 10:00-19:00）を2回足す = 完全に重なる
  await add.click(); await page.waitForTimeout(200);
  await add.click(); await page.waitForTimeout(200);
  await page.getByRole('button', { name: '保存' }).first().click();
  await page.waitForTimeout(1200);
  const t = await page.locator('body').innerText();
  const m = t.match(/[^\n]*重なっています[^\n]*/);
  console.log('overlap rejected:', !!m, m ? `「${m[0].trim()}」` : t.slice(-200).replace(/\n/g, ' '));

  // 終了 <= 開始 も弾かれるか
  await page.reload({ waitUntil: 'networkidle' });
  await add.click(); await page.waitForTimeout(200);
  const times = page.locator('input[type="time"]');
  const n = await times.count();
  await times.nth(n - 2).fill('19:00');
  await times.nth(n - 1).fill('10:00');
  await page.getByRole('button', { name: '保存' }).first().click();
  await page.waitForTimeout(1200);
  const t2 = await page.locator('body').innerText();
  const m2 = t2.match(/[^\n]*(終了|開始)[^\n]*/);
  console.log('reversed rejected:', /終了/.test(t2), m2 ? `「${m2[0].trim()}」` : t2.slice(-200).replace(/\n/g, ' '));
  await b.close();
})();
