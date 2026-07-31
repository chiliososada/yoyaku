/** 全管理画面を実際に開き、実行時エラー・500・空白ページを洗い出す（一時スクリプト）。 */
import { chromium, type Page } from '@playwright/test';
const BASE = 'http://localhost:3000';

const ADMIN = [
  '/admin', '/admin/bookings', '/admin/bookings/new', '/admin/schedule', '/admin/schedule?view=week',
  '/admin/reports', '/admin/customers', '/admin/customers/dormant', '/admin/staff', '/admin/staff/new',
  '/admin/services', '/admin/services/new', '/admin/business-hours', '/admin/calendar', '/admin/rules',
  '/admin/logs', '/admin/homepage', '/admin/homepage/preview', '/admin/qr', '/admin/notifications',
  '/admin/settings', '/admin/billing', '/admin/shops/new',
];
const PUBLIC = ['/', '/login', '/signup', '/forgot-password', '/guide', '/legal/tokushoho', '/legal/terms', '/legal/privacy', '/book/demo-salon', '/demo-salon'];

async function visit(page: Page, path: string, bag: string[]) {
  const consoleErrs: string[] = [];
  const onC = (m: any) => { if (m.type() === 'error') consoleErrs.push(m.text()); };
  const onE = (e: Error) => consoleErrs.push(`pageerror: ${e.message}`);
  page.on('console', onC); page.on('pageerror', onE);
  let status = 0;
  try {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30000 });
    status = res?.status() ?? 0;
  } catch (e) { bag.push(`${path} NAV_FAIL ${(e as Error).message.slice(0, 90)}`); }
  await page.waitForTimeout(400);
  const text = (await page.locator('body').innerText().catch(() => '')) || '';
  const url = page.url().replace(BASE, '');
  page.off('console', onC); page.off('pageerror', onE);

  const flags: string[] = [];
  if (status >= 500) flags.push(`HTTP${status}`);
  if (/Application error|client-side exception|Unhandled Runtime|Internal Server Error/i.test(text)) flags.push('RUNTIME_ERROR');
  if (text.trim().length < 40 && status < 400) flags.push(`NEARLY_EMPTY(${text.trim().length}b)`);
  // 明らかに未処理の英語エラーが日本語UIに出ていないか
  if (/\b(undefined|NaN|null)\b/.test(text) && !/undefined/i.test(path)) flags.push('RAW_VALUE_IN_TEXT');
  if (consoleErrs.length) flags.push(`CONSOLE(${consoleErrs.length}): ${consoleErrs.slice(0, 2).join(' | ').slice(0, 160)}`);
  if (url !== path) flags.push(`->${url}`);
  bag.push(`${flags.length ? 'FLAG' : ' ok '} ${path}  ${flags.join('  ')}`);
}

(async () => {
  const browser = await chromium.launch();
  const bag: string[] = [];

  const pub = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  bag.push('--- 公開ページ（未ログイン）---');
  for (const p of PUBLIC) await visit(pub, p, bag);
  await pub.close();

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel('メールアドレス').fill(process.env.E2E_EMAIL!);
  await page.getByLabel('パスワード').fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await page.waitForURL('**/admin**', { timeout: 30000 });
  bag.push('--- 管理画面（オーナー）---');
  for (const p of ADMIN) await visit(page, p, bag);

  // 詳細ページ（実IDで）
  await page.goto(`${BASE}/admin/bookings`, { waitUntil: 'networkidle' });
  const firstBooking = page.locator('a[href^="/admin/bookings/"]').first();
  if (await firstBooking.count()) {
    const href = await firstBooking.getAttribute('href');
    if (href && !href.endsWith('/new')) await visit(page, href, bag);
  }
  await page.goto(`${BASE}/admin/customers`, { waitUntil: 'networkidle' });
  const firstCust = page.locator('a[href^="/admin/customers/"]').first();
  if (await firstCust.count()) {
    const href = await firstCust.getAttribute('href');
    if (href && !href.includes('dormant')) await visit(page, href, bag);
  }
  await page.goto(`${BASE}/admin/staff`, { waitUntil: 'networkidle' });
  const firstStaff = page.locator('a[href^="/admin/staff/"]').first();
  if (await firstStaff.count()) {
    const href = await firstStaff.getAttribute('href');
    if (href && !href.endsWith('/new')) { await visit(page, href, bag); await visit(page, `${href}/schedule`, bag); }
  }

  console.log(bag.join('\n'));
  await browser.close();
})();
