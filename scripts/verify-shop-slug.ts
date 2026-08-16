/**
 * 公開URL(slug)の変更をローカル実機で確認する。
 * 実行: npx tsx scripts/verify-shop-slug.ts
 * 前提: docker compose up -d → npm run db:seed → npm run dev
 *
 * 確認する筋:
 *  ① 店舗設定に公開URL欄があり、現在のURLが入っている
 *  ② 変更しようとすると「旧URLは開けなくなる」警告が出る（変更していないときは出ない）
 *  ③ 日本語・予約語・先頭ハイフンは日本語のエラーで止まる
 *  ④ 保存すると新URLで公開ページと予約ページが開き、旧URLは404になる
 *  ⑤ URLを触らずに保存しても「使用中」と言われない（自己重複の罠）
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '@/lib/db';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000';
const OUT = join(process.cwd(), '.verify');
const EMAIL = 'owner@demo.test';
const PASSWORD = 'password123';

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

/** 保存して結果メッセージを読む。 */
async function save(page: Page): Promise<string> {
  await page.getByRole('button', { name: '保存' }).click();
  const ok = page.locator('text=保存しました').first();
  const ng = page.locator('.text-destructive, [class*="border-destructive"]').first();
  await Promise.race([
    ok.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => null),
    ng.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => null),
  ]);
  await page.waitForTimeout(600);
  if (await ok.isVisible().catch(() => false)) return 'saved';
  const err = await page
    .locator('p.text-destructive, div[role="alert"]')
    .allInnerTexts()
    .catch(() => []);
  return err.join(' / ') || 'unknown';
}

async function status(page: Page, path: string): Promise<number> {
  const res = await page.request.get(`${BASE}${path}`, { maxRedirects: 0 });
  return res.status();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await login(page);

  // ---------- ① 欄があり、現在のURLが入っている ----------
  console.log('① 公開URL欄');
  await page.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' });
  const slug = page.getByLabel('公開URL');
  const original = await slug.inputValue();
  console.log(`  現在の公開URL: ${original}`);

  // ---------- ② 変更時だけ警告 ----------
  console.log('② 変更したときの警告');
  const warn = page.locator('text=これまでのURLは開けなくなります');
  console.log(
    `  変更前の警告表示: ${(await warn.count()) > 0 ? '出ている（NG）' : '出ていない（OK）'}`,
  );
  await slug.fill('shinbashi-test');
  await page.waitForTimeout(300);
  console.log(
    `  変更後の警告表示: ${(await warn.count()) > 0 ? '出ている（OK）' : '出ていない（NG）'}`,
  );
  const preview = await page
    .locator('code')
    .allInnerTexts()
    .catch(() => []);
  console.log(`  URLプレビュー: ${preview.join(' → ')}`);
  await shot(page, 'slug-warning');

  // ---------- ③ 不正な入力は日本語で止まる ----------
  console.log('③ 不正な入力');
  for (const bad of ['新橋店', 'admin', '-shinbashi', 'a']) {
    await slug.fill(bad);
    const r = await save(page);
    console.log(`  「${bad}」 → ${r === 'saved' ? '保存された（NG）' : r}`);
  }

  // ---------- ④⑤ 保存して新URLが開く / 旧URLが消える ----------
  // 改名した瞬間から復元までを try/finally で囲む。途中で throw しても
  // デモ店の公開URLが変わったまま残ると、/book/demo-salon を前提にした
  // 他のスクリプトや E2E が黙って404になる。
  try {
    console.log('④ 保存後の公開ページ');
    const next = `shinbashi-${Date.now().toString(36).slice(-6)}`;
    await slug.fill(next);
    const r = await save(page);
    console.log(`  「${next}」で保存 → ${r}`);
    console.log(`  新 /${next}        : ${await status(page, `/${next}`)}`);
    console.log(`  新 /book/${next}   : ${await status(page, `/book/${next}`)}`);
    console.log(
      `  旧 /${original}    : ${await status(page, `/${original}`)}（404が期待値・自動転送は無い）`,
    );
    console.log(`  旧 /book/${original}: ${await status(page, `/book/${original}`)}`);
    await shot(page, 'slug-saved');

    console.log('⑤ URLを変えずに保存');
    await page.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' });
    const r2 = await save(page);
    console.log(
      `  そのまま保存 → ${r2}${r2 === 'saved' ? '（OK: 自分自身を重複と数えていない）' : '（NG）'}`,
    );
  } finally {
    // 自分が手放したURLへは戻せる（別店舗には再割当されない）
    await page.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' }).catch(() => {});
    await page
      .getByLabel('公開URL')
      .fill(original)
      .catch(() => {});
    const r3 = await save(page).catch((e) => `復元に失敗: ${String(e)}`);
    console.log(`  元の ${original} へ戻す → ${r3}`);
  }

  // ---------- ⑥ 大文字で保存すると入力欄も小文字に揃う ----------
  console.log('⑥ 大文字入力の後始末');
  await page.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' });
  await page.getByLabel('公開URL').fill(original.toUpperCase());
  const r6 = await save(page);
  const shown = await page.getByLabel('公開URL').inputValue();
  console.log(`  「${original.toUpperCase()}」で保存 → ${r6} / 入力欄の表示: ${shown}`);
  console.log(
    `  画面のURLが実在するか: ${(await status(page, `/${shown}`)) === 200 ? '200（OK）' : '開けない（NG）'}`,
  );

  // ---------- ⑦ 他店が使用中のURLは、その欄にエラーが出る ----------
  console.log('⑦ 他店のURLを入れたとき');
  const scratchSlug = `taken-${Date.now().toString(36).slice(-6)}`;
  const t = await prisma.tenant.create({
    data: { slug: `verify-${Date.now().toString(36)}`, name: '検証用', status: 'ACTIVE' },
  });
  try {
    await prisma.shop.create({
      data: {
        tenantId: t.id,
        slug: scratchSlug,
        name: '検証用店舗',
        timezone: 'Asia/Tokyo',
        settings: {},
      },
    });
    await page.getByLabel('公開URL').fill(scratchSlug);
    const r7 = await save(page);
    const fieldErr = await page
      .locator('p.text-destructive')
      .first()
      .innerText()
      .catch(() => '(なし)');
    const focused = await page.evaluate('document.activeElement && document.activeElement.id');
    console.log(`  結果: ${r7 === 'saved' ? '保存された（NG）' : 'blocked'}`);
    console.log(`  欄に出たエラー: ${fieldErr}`);
    console.log(
      `  フォーカス位置: ${focused}${focused === 'slug' ? '（OK: 該当欄へ移動）' : '（NG）'}`,
    );
    await shot(page, 'slug-conflict');
  } finally {
    await prisma.tenant.delete({ where: { id: t.id } }).catch(() => {});
    await page.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' }).catch(() => {});
    await page
      .getByLabel('公開URL')
      .fill(original)
      .catch(() => {});
    await save(page).catch(() => {});
    await prisma.$disconnect().catch(() => {});
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
