/**
 * ドロップされたファイルの選別。
 * 黙って無視すると「落としたのに何も起きない」になり、店主は原因に辿り着けない。
 */
import { describe, it, expect } from 'vitest';
import { screenImageFiles, MAX_IMAGE_BYTES } from '@/components/admin/use-image-drop';

const file = (name: string, type: string, size: number) =>
  ({ name, type, size }) as unknown as File;

describe('screenImageFiles', () => {
  it('画像はそのまま通す', () => {
    const r = screenImageFiles([file('a.jpg', 'image/jpeg', 1000), file('b.png', 'image/png', 2000)]);
    expect(r.accepted).toHaveLength(2);
    expect(r.error).toBeNull();
  });

  it('画像以外は理由を添えて弾く', () => {
    const r = screenImageFiles([file('資料.pdf', 'application/pdf', 100)]);
    expect(r.accepted).toHaveLength(0);
    expect(r.error).toContain('画像ファイルではありません');
    expect(r.error).toContain('資料.pdf');
  });

  it('12MB超は理由を添えて弾く', () => {
    const r = screenImageFiles([file('大.jpg', 'image/jpeg', MAX_IMAGE_BYTES + 1)]);
    expect(r.accepted).toHaveLength(0);
    expect(r.error).toContain('12MB');
    expect(r.error).toContain('大.jpg');
  });

  it('ちょうど12MBは通す（境界）', () => {
    const r = screenImageFiles([file('境界.jpg', 'image/jpeg', MAX_IMAGE_BYTES)]);
    expect(r.accepted).toHaveLength(1);
    expect(r.error).toBeNull();
  });

  it('通るものと弾くものが混ざっても、通るものは取り込む', () => {
    const r = screenImageFiles([
      file('ok.jpg', 'image/jpeg', 1000),
      file('x.txt', 'text/plain', 10),
      file('big.png', 'image/png', MAX_IMAGE_BYTES + 1),
    ]);
    expect(r.accepted.map((f) => f.name)).toEqual(['ok.jpg']);
    expect(r.error).toContain('画像ファイルではありません');
    expect(r.error).toContain('12MB');
  });

  it('件数が多いときは先頭3件までを挙げる', () => {
    const r = screenImageFiles(
      ['a', 'b', 'c', 'd'].map((n) => file(`${n}.txt`, 'text/plain', 10)),
    );
    expect(r.error).toContain('ほか');
    expect(r.error).not.toContain('d.txt');
  });

  it('空配列でもエラーにしない', () => {
    expect(screenImageFiles([])).toEqual({ accepted: [], error: null });
  });

  it('HEIC など type が付く画像も image/* なら通す', () => {
    expect(screenImageFiles([file('IMG.heic', 'image/heic', 5000)]).accepted).toHaveLength(1);
  });
});
