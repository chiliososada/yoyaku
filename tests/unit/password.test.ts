/**
 * パスワード条件（登録・再設定・スタッフ・テナント作成で共通）。
 * 入口ごとに条件が違うと、登録できたパスワードが再設定で弾かれる。
 */
import { describe, it, expect } from 'vitest';
import { passwordSchema, checkPassword, PASSWORD_MIN } from '@/lib/validation/password';

const msgOf = (v: string) => {
  const r = passwordSchema.safeParse(v);
  return r.success ? '' : r.error.issues.map((i) => i.message).join(' / ');
};

describe('passwordSchema', () => {
  it('6文字・大文字小文字数字を満たせば通る', () => {
    expect(passwordSchema.safeParse('Abc123').success).toBe(true);
    expect(passwordSchema.safeParse('Yoyaku2026').success).toBe(true);
  });

  it('記号を含んでもよい（必須ではない）', () => {
    expect(passwordSchema.safeParse('Abc123!@#').success).toBe(true);
  });

  it('5文字は短すぎる（境界）', () => {
    expect(passwordSchema.safeParse('Abc12').success).toBe(false);
    expect(msgOf('Abc12')).toContain('6文字以上');
  });

  it('大文字が無いと弾く', () => {
    expect(msgOf('abc123')).toContain('大文字');
  });

  it('小文字が無いと弾く', () => {
    expect(msgOf('ABC123')).toContain('小文字');
  });

  it('数字が無いと弾く', () => {
    expect(msgOf('Abcdef')).toContain('数字');
  });

  it('不足が複数あるときは1文にまとめる（何度も往復させない）', () => {
    const m = msgOf('abcdef');
    expect(m).toContain('大文字');
    expect(m).toContain('数字');
    expect(m).not.toContain('小文字'); // 満たしている分は挙げない
  });

  it('長すぎるものは弾く', () => {
    expect(passwordSchema.safeParse('Aa1' + 'x'.repeat(200)).success).toBe(false);
  });
});

describe('checkPassword（入力中の表示用）', () => {
  it('項目ごとの充足を返す', () => {
    expect(checkPassword('Abc123')).toEqual({
      lengthOk: true, upperOk: true, lowerOk: true, digitOk: true, ok: true,
    });
    expect(checkPassword('abc')).toEqual({
      lengthOk: false, upperOk: false, lowerOk: true, digitOk: false, ok: false,
    });
  });

  it('スキーマの判定と一致する（画面とサーバーで食い違わない）', () => {
    for (const v of ['', 'a', 'Abc12', 'Abc123', 'ABCDEF', 'abcdef', '123456', 'Aa1zzz']) {
      expect(checkPassword(v).ok).toBe(passwordSchema.safeParse(v).success);
    }
  });

  it('PASSWORD_MIN と実際の判定が一致', () => {
    expect(checkPassword('Ab1' + 'c'.repeat(PASSWORD_MIN - 4)).lengthOk).toBe(false);
    expect(checkPassword('Ab1' + 'c'.repeat(PASSWORD_MIN - 3)).lengthOk).toBe(true);
  });
});
