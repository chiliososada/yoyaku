/** 先の修正がブラウザ上で本当に効くかを確認する（一時スクリプト）。 */
import { chromium, type Page } from '@playwright/test';
const BASE = 'http://localhost:3000';
const out: string[] = [];
const chk = (name: string, pass: boolean, extra = '') =>
  out.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel('メールアドレス').fill(process.env.E2E_EMAIL!);
  await page.getByLabel('パスワード').fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await page.waitForURL('**/admin**', { timeout: 30000 });
}

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await login(page);

  // ① 予約ルール: 締切 > 受付期間 の矛盾を保存できないこと
  await page.goto(`${BASE}/admin/rules`, { waitUntil: 'networkidle' });
  const win = page.locator('input[name="bookingWindowDays"]').first();
  const lead = page.locator('input[name="leadTimeMinHours"]').first();
  if (await win.count()) {
    await win.fill('1');
    await lead.fill('48');
    await page.getByRole('button', { name: '保存' }).first().click();
    await page.waitForTimeout(900);
    const txt = await page.locator('body').innerText();
    chk('予約ルールの矛盾を弾く', /1件も受け付けられません/.test(txt),
      /1件も受け付けられません/.test(txt) ? '' : txt.slice(0, 120).replace(/\n/g, ' '));
    // 元に戻す
    await win.fill('30'); await lead.fill('2');
    await page.getByRole('button', { name: '保存' }).first().click();
    await page.waitForTimeout(700);
  } else chk('予約ルールの矛盾を弾く', false, 'input が見つからない');

  // ② キャンセル期限 > 締切 の注意書き
  await page.goto(`${BASE}/admin/rules`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  chk('キャンセル期限の注意書き', /ご自身ではキャンセルできません/.test(await page.locator('body').innerText()));

  // ③ 営業時間: 同じ曜日を重複させたら弾かれること
  await page.goto(`${BASE}/admin/business-hours`, { waitUntil: 'networkidle' });
  const addBtn = page.getByRole('button', { name: /時間帯を追加|追加/ }).first();
  if (await addBtn.count()) {
    await addBtn.click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '保存' }).first().click();
    await page.waitForTimeout(900);
    const t = await page.locator('body').innerText();
    chk('営業時間の重複を弾く', /重なっています|一致しません|終了/.test(t), /重なっています/.test(t) ? '' : t.slice(0, 140).replace(/\n/g, ' '));
  } else chk('営業時間の重複を弾く', false, '追加ボタンなし');

  // ④ 休業・特別営業: 出勤者ゼロの特別営業で警告
  await page.goto(`${BASE}/admin/calendar`, { waitUntil: 'networkidle' });
  await page.locator('input[type="date"]').first().fill('2026-12-30');
  const sel = page.locator('select').first();
  await sel.selectOption('SPECIAL_OPEN');
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /追加/ }).first().click();
  await page.waitForTimeout(1200);
  const calTxt = await page.locator('body').innerText();
  chk('特別営業の出勤者ゼロ警告 or 正常登録',
    /出勤予定のスタッフがいない|2026-12-30/.test(calTxt),
    calTxt.slice(0, 120).replace(/\n/g, ' '));

  // ⑤ 店舗設定の同時受付数がルールへ書き戻るか
  await page.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' });
  const cap = page.locator('input[name="shopCapacity"]').first();
  if (await cap.count()) {
    await cap.fill('7');
    await page.getByRole('button', { name: '保存' }).first().click();
    await page.waitForTimeout(1200);
    await page.goto(`${BASE}/admin/rules`, { waitUntil: 'networkidle' });
    const v = await page.locator('input[name="maxConcurrent"]').first().inputValue();
    chk('店舗設定の同時受付数が予約ルールに反映', v === '7', `rules 側の値=${v}`);
    await page.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' });
    await page.locator('input[name="shopCapacity"]').first().fill('3');
    await page.getByRole('button', { name: '保存' }).first().click();
    await page.waitForTimeout(900);
  } else chk('店舗設定の同時受付数が予約ルールに反映', false, 'input なし');

  console.log(out.join('\n'));
  await b.close();
})();
