import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { isValidLineSignature } from '@/server/notifications/line';
import { buildManagerNotification } from '@/server/notifications/templates';

describe('LINE 署名検証', () => {
  const secret = 'test-channel-secret';
  const body = JSON.stringify({ events: [{ type: 'message' }] });
  const sign = (s: string, b: string) => crypto.createHmac('sha256', s).update(b).digest('base64');

  it('正しい署名を受理', () => {
    expect(isValidLineSignature(secret, body, sign(secret, body))).toBe(true);
  });
  it('誤った署名を拒否', () => {
    expect(isValidLineSignature(secret, body, sign('wrong-secret', body))).toBe(false);
  });
  it('署名なしを拒否', () => {
    expect(isValidLineSignature(secret, body, null)).toBe(false);
  });
  it('ボディ改竄を検知', () => {
    const sig = sign(secret, body);
    expect(isValidLineSignature(secret, body + 'x', sig)).toBe(false);
  });
});

describe('店長向け通知文面', () => {
  const base = {
    shopName: 'デモサロン',
    serviceName: 'カット',
    staffName: '田中',
    startAt: new Date('2026-09-08T01:00:00.000Z'),
    timezone: 'Asia/Tokyo',
    customerName: '山田',
    bookingId: 'bk_123',
  };

  it('新規/変更/キャンセルで別文面・件名', () => {
    const created = buildManagerNotification({ ...base, event: 'CREATED' });
    const resch = buildManagerNotification({ ...base, event: 'RESCHEDULED' });
    const cancel = buildManagerNotification({ ...base, event: 'CANCELLED' });

    expect(created.text).toContain('新規予約');
    expect(resch.text).toContain('変更');
    expect(cancel.text).toContain('キャンセル');
    expect(created.subject).not.toBe(resch.subject);

    // 顧客名・店名・後台リンクを含む
    expect(created.text).toContain('山田');
    expect(created.text).toContain('デモサロン');
    expect(created.text).toContain('/admin/bookings/bk_123');
  });
});
