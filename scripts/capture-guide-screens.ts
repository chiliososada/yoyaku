/**
 * 使い方ガイド用スクリーンショット一括撮影。
 * 本番のデモアカウントで各画面を実写し public/guide/ へ保存する。
 * 実行: npx tsx scripts/capture-guide-screens.ts
 * 前提: デモテナントを一時的に「トライアル表示」にしておくと課金画面がガイド向けになる。
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.GUIDE_BASE_URL ?? 'https://yoyaku.arcs-ai.com';
const OUT = join(process.cwd(), 'public', 'guide');
const EMAIL = 'owner@demo.test';
const PASSWORD = 'password123';

async function shot(page: Page, name: string) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82 });
  console.log(`✓ ${name}.jpg`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

  // --- ログイン画面（未ログイン状態で撮影） ---
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await shot(page, '01-login');

  // ログイン実行
  await page.getByLabel('メールアドレス').fill(EMAIL);
  await page.getByLabel('パスワード').fill(PASSWORD);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await page.waitForURL('**/admin**', { timeout: 20_000 });

  // --- 管理画面 ---
  const adminPages: Array<[string, string]> = [
    ['/admin', '02-dashboard'],
    ['/admin/settings', '03-settings'],
    ['/admin/services', '04-services'],
    ['/admin/staff', '05-staff'],
    ['/admin/business-hours', '06-hours'],
    ['/admin/qr', '07-qr-web'],
    ['/admin/homepage', '18-homepage'],
    ['/admin/notifications', '09-notifications'],
    ['/admin/bookings', '10-bookings'],
    ['/admin/schedule', '11-schedule'],
    ['/admin/customers', '12-customers'],
    ['/admin/reports', '13-reports'],
    // 17-billing はここでは撮らない。本番のデモテナントは契約 active なので「ご契約中」表示になり、
    // ガイドに必要な「トライアル＋プラン選択」の画面にならないため。
    // 価格改定などで撮り直すときは**ローカル**で（本番データを触らずに済む）:
    //   1) .env.local に STRIPE_SECRET_KEY=<ダミー文字列>（isStripeConfigured() を true にするだけ）
    //   2) ローカルDBのプランへダミー stripePriceId を付与（プランカードの表示条件）＋本番と同じ上限値に揃える
    //   3) デモテナントを billingExempt=false / stripeSubscriptionStatus=null / trialEndsAt=+30日 に
    //   4) npm run dev → owner@demo.test でログインし /admin/billing を 1280x800 @2x jpeg q82 で撮影
    //   5) .env.local とダミー Price ID を消し、デモテナントを billingExempt=true に戻す
    // ガイドのピン座標（guide-steps.ts の 17-billing）は現行レイアウト前提。カード枚数が変わったら要確認。
  ];
  for (const [path, name] of adminPages) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    await shot(page, name);
    // QR ページは LINE 区画もスクロールして撮る
    if (name === '07-qr-web') {
      const line = page.getByText('LINE 予約 QR コード', { exact: false }).first();
      if (await line.count()) {
        await line.scrollIntoViewIfNeeded();
        await shot(page, '08-qr-line');
      }
    }
  }

  // --- 公開ホームページ（デモ店の専属HP） ---
  await page.goto(`${BASE}/demo-salon`, { waitUntil: 'networkidle' });
  await shot(page, '19-homepage-public');

  // --- お客様側の予約フロー ---
  await page.goto(`${BASE}/book/demo-salon`, { waitUntil: 'networkidle' });
  const firstSvc = page.locator('[data-testid="svc"]').first();
  await firstSvc.click();
  await shot(page, '14-book-menu');

  await page.locator('[data-testid="menu-next"]').click();
  await page.waitForSelector('[data-testid="slot"]', { timeout: 20_000 });
  await shot(page, '15-book-datetime');

  const slot = page.locator('[data-testid="slot"][data-available="true"]').first();
  await slot.click();
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.waitForSelector('text=お名前');
  await shot(page, '16-book-form');

  await browser.close();
  console.log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
