import { test, expect } from '@playwright/test';

/**
 * 管理フロー E2E: オーナーがログイン → 代理予約を登録 → 予約詳細へ。
 * 前提: docker compose 起動 + `npm run db:seed` 済み（owner@demo.test / password123）。
 */
function addDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

test('オーナーがログインして代理予約を登録できる', async ({ page }) => {
  // ログイン
  await page.goto('/login');
  await page.getByLabel('メールアドレス').fill('owner@demo.test');
  await page.getByLabel('パスワード').fill('password123');
  await page.getByRole('button', { name: 'ログイン' }).click();
  await page.waitForURL('**/admin', { timeout: 15000 });

  // 代理予約ページ
  await page.goto('/admin/bookings/new');
  await expect(page.getByRole('heading', { name: '代理予約の登録' })).toBeVisible();

  // メニュー選択（カット）— select は combobox ロールで一意に特定
  await page.getByRole('combobox', { name: /メニュー/ }).selectOption({ label: 'カット' });

  // 空きのある日を探す
  let found = false;
  for (let i = 3; i < 14; i++) {
    await page.getByLabel(/日付/).fill(addDays(i));
    await page.getByRole('button', { name: '空き枠を表示' }).click();
    await page.waitForTimeout(500);
    const avail = page.locator('[data-testid="admin-slot"][data-available="true"]');
    if ((await avail.count()) > 0) {
      await avail.first().click();
      found = true;
      break;
    }
  }
  expect(found, '予約可能な枠が見つかること').toBe(true);

  // 顧客名 → 登録
  await page.getByLabel(/お客様名/).fill('E2E 管理 予約');
  await page.getByRole('button', { name: '予約を登録' }).click();

  // 予約詳細へ遷移
  await expect(page.getByRole('heading', { name: '予約詳細' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('E2E 管理 予約')).toBeVisible();
});
