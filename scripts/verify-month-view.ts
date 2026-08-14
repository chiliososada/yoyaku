/**
 * 月表示（予約スケジュール）のローカル検証。
 * 実行: npx tsx scripts/verify-month-view.ts
 * 前提: docker compose up -d → npm run db:seed → npm run dev
 *
 * 見た目の確認だけでなく、
 *  ① 日付セルのどこを押してもその日へ行けるか（行の高さいっぱいまでリンクが伸びているか）
 *  ② 休業日・当月外が背景色で見分けられるか
 *  ③ セルのクリックで日表示に降りられるか
 * を実測する。table で組んだ版は①が満たせず、下部に押せない余白が残っていた。
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000';
const OUT = join(process.cwd(), '.verify');
const EMAIL = 'owner@demo.test';
const PASSWORD = 'password123';

async function shot(page: Page, name: string) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  console.log(`✓ ${name}.png`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel('メールアドレス').fill(EMAIL);
  await page.getByLabel('パスワード', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await page.waitForURL('**/admin**', { timeout: 20_000 });

  for (const view of ['day', 'week', 'month'] as const) {
    await page.goto(`${BASE}/admin/schedule?view=${view}`, { waitUntil: 'networkidle' });
    const label = await page.locator('a[aria-label="前日"], a[aria-label="前週"], a[aria-label="前月"]')
      .locator('xpath=following-sibling::span[1]').innerText();
    console.log(`[${view}] 日付ラベル: ${label.trim()}`);
    await shot(page, `schedule-${view}`);
  }

  // --- 月グリッドのセルだけを対象に測る ---
  await page.goto(`${BASE}/admin/schedule?view=month`, { waitUntil: 'networkidle' });
  const cells = await page.evaluate(() => {
    const grid = document.querySelector('div.grid-cols-7:last-of-type');
    const links = [...(grid?.querySelectorAll(':scope > a') ?? [])] as HTMLElement[];
    return links.map((a) => {
      const r = a.getBoundingClientRect();
      return {
        href: a.getAttribute('href') ?? '',
        text: (a.innerText ?? '').replace(/\n+/g, ' ').trim(),
        top: Math.round(r.top),
        h: Math.round(r.height),
        bg: getComputedStyle(a).backgroundColor,
      };
    });
  });

  console.log(`セル数: ${cells.length}（6週なら42 / 5週なら35）`);
  const rows = new Map<number, number[]>();
  for (const c of cells) rows.set(c.top, [...(rows.get(c.top) ?? []), c.h]);
  for (const [top, hs] of rows) {
    const ok = Math.min(...hs) === Math.max(...hs);
    console.log(`  行 top=${top}: 高さ ${Math.min(...hs)}〜${Math.max(...hs)} ${ok ? '✓ 揃っている（全面クリック可）' : '✗ ずれ'}`);
  }

  console.log('背景色の種類:');
  const byBg = new Map<string, string[]>();
  for (const c of cells) {
    const day = c.text.split(' ')[0] ?? '';
    const kind = c.text.includes('定休日') || c.text.includes('休業') ? '休業' : '通常';
    byBg.set(c.bg, [...(byBg.get(c.bg) ?? []), `${day}(${kind})`]);
  }
  for (const [bg, days] of byBg) console.log(`  ${bg}: ${days.join(' ')}`);

  // --- クリックで日表示へ降りられるか ---
  const target = cells.find((c) => c.text.includes('予約')) ?? cells[20]!;
  await page.click(`a[href="${target.href}"]`);
  await page.waitForURL(`**${target.href}`, { timeout: 10_000 });
  console.log(`クリック ${target.text.split(' ')[0]}日 → ${new URL(page.url()).pathname}${new URL(page.url()).search} ✓`);
  await shot(page, 'schedule-day-from-month');

  // --- スタッフ1名に絞ったとき、セルに勤務時間が入るか ---
  await page.goto(`${BASE}/admin/schedule?view=month`, { waitUntil: 'networkidle' });
  const chip = page.locator('a[href*="staff="]').first();
  const chipName = (await chip.innerText()).trim();
  await chip.click();
  // クライアント側遷移は networkidle では待てない。URL が変わるまで待つ。
  await page.waitForURL(/staff=/, { timeout: 10_000 });
  await page.waitForLoadState('networkidle');
  const withTime = await page.locator('div.grid-cols-7:last-of-type > a', { hasText: /\d{1,2}:\d{2}–\d{1,2}:\d{2}/ }).count();
  const restDays = await page.locator('div.grid-cols-7:last-of-type > a', { hasText: '休み' }).count();
  console.log(`スタッフ「${chipName}」で絞り込み: 勤務時間が入ったセル ${withTime} / 休み ${restDays}`);
  console.log(`絞り込みが URL に残る: ${new URL(page.url()).search}`);
  await shot(page, 'schedule-month-staff');

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
