import { describe, it, expect } from 'vitest';
import { buildBookingEmail } from '@/server/notifications/templates';

const base = {
  shopName: 'デモサロン',
  serviceName: 'カット',
  staffName: '田中',
  startAt: new Date('2026-06-15T00:00:00.000Z'), // 9:00 JST
  timezone: 'Asia/Tokyo',
  customerName: '山田 太郎',
  cancellationToken: 'tok_abc',
};

describe('email templates', () => {
  it('予約確定メール: 件名・本文・キャンセルリンク', () => {
    const { subject, text } = buildBookingEmail({ ...base, template: 'BOOKING_CONFIRMED' });
    expect(subject).toBe('【デモサロン】ご予約を承りました');
    expect(text).toContain('山田 太郎 様');
    expect(text).toContain('カット');
    expect(text).toContain('2026年6月15日(月) 09:00'); // Asia/Tokyo 表示
    expect(text).toContain('/booking/tok_abc');
  });

  it('キャンセルメール: 件名が変わる', () => {
    const { subject } = buildBookingEmail({ ...base, template: 'BOOKING_CANCELLED' });
    expect(subject).toBe('【デモサロン】ご予約をキャンセルしました');
  });

  it('担当未指定は おまかせ 表示', () => {
    const { text } = buildBookingEmail({ ...base, staffName: null, template: 'BOOKING_CONFIRMED' });
    expect(text).toContain('担当: おまかせ');
  });
});
