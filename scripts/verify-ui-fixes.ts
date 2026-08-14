/**
 * 直近のUI修正をローカル実機で確認する。
 * 実行: npx tsx scripts/verify-ui-fixes.ts
 * 前提: docker compose up -d → npm run db:seed → npm run dev
 *
 * 対象:
 *  ① 郵便番号 → 住所の自動入力（入力時の自動実行 と 「住所入力」ボタン）
 *  ② 郵便番号欄の幅と、住所行の入力欄の高さが揃っているか（Field の align-content 修正）
 *  ③ 表示色のプリセット（カラーコードを知らなくても選べるか）
 *  ④ 画像のドラッグ&ドロップ
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000';
const OUT = join(process.cwd(), '.verify');
const EMAIL = 'owner@demo.test';
const PASSWORD = 'password123';

/** 1x1 の PNG（ドロップ検証用。実ファイルを用意せずに済ませる）。 */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  console.log(`  ✓ ${name}.png`);
}

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel('メールアドレス').fill(EMAIL);
  await page.getByLabel('パスワード', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await page.waitForURL('**/admin**', { timeout: 20_000 });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await login(page);

  // ---------- ① 郵便番号の自動入力 ----------
  console.log('① 郵便番号 → 住所');
  await page.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' });
  const postal = page.getByLabel('郵便番号');
  const pref = page.getByLabel('都道府県');
  const city = page.getByLabel('市区町村');

  await pref.fill('');
  await city.fill('');
  await postal.fill('');
  await postal.type('1500002', { delay: 30 });
  await page.waitForFunction(
    () => (document.querySelector('input[name="prefecture"]') as HTMLInputElement)?.value !== '',
    undefined,
    { timeout: 10_000 },
  );
  console.log(`  入力で自動: ${await pref.inputValue()} / ${await city.inputValue()}`);

  // 保存済みの番号を開き直した状況＝値が変わらないので自動では動かない。ボタンが効くこと。
  await pref.fill('');
  await city.fill('');
  await page.getByRole('button', { name: '住所入力' }).click();
  await page.waitForFunction(
    () => (document.querySelector('input[name="prefecture"]') as HTMLInputElement)?.value !== '',
    undefined,
    { timeout: 10_000 },
  );
  console.log(`  ボタンで  : ${await pref.inputValue()} / ${await city.inputValue()}`);

  // ---------- ② 幅と高さ ----------
  // tsx(esbuild) が名前付き関数に __name を注入するため、evaluate には文字列で渡す。
  const layout = (await page.evaluate(`
    (function () {
      var box = function (n) {
        var el = document.querySelector('input[name="' + n + '"]');
        if (!el) return null;
        var r = el.getBoundingClientRect();
        return { w: Math.round(r.width), top: Math.round(r.top) };
      };
      return { postal: box('postalCode'), pref: box('prefecture'), city: box('city'),
               addr: box('address'), phone: box('phone'), email: box('email') };
    })()
  `)) as Record<'postal' | 'pref' | 'city' | 'addr' | 'phone' | 'email', { w: number; top: number }>;
  console.log(`  郵便番号欄の幅: ${layout.postal.w}px（7桁が収まるか）`);
  const tops = [layout.pref.top, layout.city.top, layout.addr.top];
  console.log(`  住所行の入力欄 top: ${tops.join(', ')} → ずれ ${Math.max(...tops) - Math.min(...tops)}px`);
  console.log(`  電話/メール行 top: ${layout.phone.top}, ${layout.email.top} → ずれ ${Math.abs(layout.phone.top - layout.email.top)}px`);
  // ラベルを押したときに入力欄へ入るか（div で包んだことで切れていた紐付け）
  const labelOk = await page.evaluate(
    `(function(){var l=[].slice.call(document.querySelectorAll('label')).filter(function(x){return x.textContent.indexOf('郵便番号')===0})[0];
      if(!l) return 'ラベルが無い'; var t=document.getElementById(l.htmlFor); return t ? t.tagName+'#'+t.id : 'htmlFor='+l.htmlFor+' の要素が無い';})()`,
  );
  console.log(`  ラベル「郵便番号」の紐付け先: ${labelOk}`);
  await shot(page, 'settings-postal');

  // ---------- ③ 表示色 ----------
  console.log('③ 表示色のプリセット');
  await page.goto(`${BASE}/admin/services`, { waitUntil: 'networkidle' });
  await page.locator('a[href^="/admin/services/"]').first().click();
  await page.waitForURL(/\/admin\/services\/.+/, { timeout: 10_000 });
  const swatches = page.locator('button[aria-pressed]');
  const n = await swatches.count();
  const names = await swatches.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  console.log(`  見本の色: ${n}色 → ${names.join(' ')}`);
  await swatches.nth(4).click();
  const hex = await page.getByLabel('カラーコード').inputValue();
  console.log(`  「${names[4]}」を押す → カラーコード欄が ${hex} になる`);
  await shot(page, 'service-color');

  // ---------- ④ ドラッグ&ドロップ ----------
  console.log('④ 画像のドラッグ&ドロップ');
  await page.goto(`${BASE}/admin/homepage`, { waitUntil: 'networkidle' });
  const drop = page.locator('text=ドラッグ').first();
  console.log(`  ドロップ領域の案内: ${(await drop.count()) > 0 ? (await drop.innerText()).replace(/\n/g, ' ') : '見つからない'}`);

  const before = await page.locator('img').count();
  await page.evaluate(`
    (function () {
      var bin = atob('${PNG_B64}');
      var buf = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      var file = new File([buf], 'hero.png', { type: 'image/png' });
      var dt = new DataTransfer();
      dt.items.add(file);
      // ドロップのハンドラは <label> に付いている。祖先の <div> に投げても
      // イベントは上へしか伝わらないので届かない。
      var zones = [].slice.call(document.querySelectorAll('label')).filter(function (d) {
        return d.textContent && d.textContent.indexOf('ドラッグ') >= 0;
      });
      if (!zones.length) throw new Error('drop zone not found');
      ['dragenter', 'dragover', 'drop'].forEach(function (type) {
        zones[0].dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      });
    })()
  `);
  await page.waitForTimeout(2500);
  const after = await page.locator('img').count();
  const err = await page.locator('text=/画像|MB|失敗/').first().innerText().catch(() => '');
  console.log(`  ドロップ後の img 要素: ${before} → ${after} ${after > before ? '✓ 取り込まれた' : `（メッセージ: ${err.slice(0, 60)}）`}`);
  await shot(page, 'homepage-drop');

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
