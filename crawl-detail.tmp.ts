import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const BASE = 'http://localhost:3000';
const ids = JSON.parse(readFileSync('/tmp/ids.json', 'utf8'));
const paths = [
  `/admin/bookings/${ids.b}`,
  `/admin/customers/${ids.c}`,
  `/admin/staff/${ids.s}`,
  `/admin/staff/${ids.s}/schedule`,
  `/admin/services/${ids.sv}`,
  `/admin/export/bookings?month=2026-07`,
];
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel('メールアドレス').fill(process.env.E2E_EMAIL!);
  await page.getByLabel('パスワード').fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await page.waitForURL('**/admin**', { timeout: 30000 });

  for (const p of paths) {
    const bad: string[] = [];
    page.on('pageerror', (e) => bad.push(`pageerror: ${e.message}`));
    let status = 0;
    try {
      const r = await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle', timeout: 25000 });
      status = r?.status() ?? 0;
    } catch (e) { bad.push(`NAV ${(e as Error).message.slice(0, 60)}`); }
    await page.waitForTimeout(300);
    const txt = await page.locator('body').innerText().catch(() => '');
    const err = /Application error|client-side exception|Internal Server Error/i.test(txt);
    console.log(`${status} ${err || bad.length ? 'FLAG' : 'ok '} ${p} ${bad.join('|')}`);
    page.removeAllListeners('pageerror');
  }

  // CSV の中身を実際に取得して検査
  const csvRes = await page.request.get(`${BASE}/admin/export/bookings?month=2026-07`);
  const body = await csvRes.text();
  console.log('--- CSV ---');
  console.log('status', csvRes.status(), 'ctype', csvRes.headers()['content-type']);
  console.log('BOM:', body.charCodeAt(0) === 0xfeff);
  console.log(body.split('\n').slice(0, 4).join('\n'));
  await b.close();
})();
