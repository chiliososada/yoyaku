import { test, expect } from '@playwright/test';

/**
 * 公開予約フロー E2E。
 * 前提: docker compose 起動 + `npm run db:seed` 済み（demo-salon 存在）。
 * メニュー→空き日→空き枠→情報入力→確認→完了 を通す。
 */
test('顧客がオンラインで予約を完了できる', async ({ page }) => {
  await page.goto('/book/demo-salon');

  // 店舗名が表示される
  await expect(page.getByRole('heading', { name: 'デモサロン 渋谷店' })).toBeVisible();

  // メニュー選択（最初のサービス = カット）→ 選択後に「日時を選ぶ」で進む（複数選択対応UI）
  await page.getByTestId('svc').first().click();
  await expect(page.getByTestId('svc').first()).toHaveAttribute('data-selected', 'true');
  await page.getByTestId('menu-next').click();

  // 空きのある日付を探してクリック（満/休の日は disabled なのでスキップ）
  const days = page.getByTestId('day');
  const dayCount = await days.count();
  let found = false;
  for (let i = 0; i < dayCount; i++) {
    const day = days.nth(i);
    if (!(await day.isEnabled())) continue;
    await day.click();
    // スロット読み込み待ち（ローダー消滅 or スロット出現）
    await page.waitForTimeout(400);
    const available = page.locator('[data-testid="slot"][data-available="true"]');
    if ((await available.count()) > 0) {
      await available.first().click();
      found = true;
      break;
    }
  }
  expect(found, '予約可能な枠が見つかること').toBe(true);

  // 次へ → お客様情報
  await page.getByRole('button', { name: '次へ' }).click();
  await page.getByPlaceholder('山田 太郎').fill('E2E テスト太郎');
  await page.getByPlaceholder('090-1234-5678').fill('090-1234-5678');

  // 確認画面へ → 予約確定
  await page.getByRole('button', { name: '確認画面へ' }).click();
  await page.getByTestId('confirm').click();

  // 完了
  await expect(page.getByTestId('complete')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('link', { name: '予約を確認・キャンセル' })).toBeVisible();
});
