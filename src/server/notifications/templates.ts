/**
 * 通知の本文テンプレート（メール等）。日本語。表示時刻は店舗TZ。
 */
import { env } from '@/lib/env';
import { formatBookingDateTime } from '@/lib/time';

export interface BookingEmailData {
  template: 'BOOKING_CONFIRMED' | 'BOOKING_CANCELLED' | 'BOOKING_REMINDER' | 'BOOKING_RESCHEDULED';
  shopName: string;
  serviceName: string;
  staffName: string | null;
  startAt: Date;
  timezone: string;
  customerName: string;
  cancellationToken: string;
}

export function buildBookingEmail(data: BookingEmailData): { subject: string; text: string } {
  const when = formatBookingDateTime(data.startAt, data.timezone);
  const staff = data.staffName ?? 'おまかせ';
  const manageUrl = `${env.APP_BASE_URL}/booking/${data.cancellationToken}`;

  const base = [
    `${data.customerName} 様`,
    '',
    `店舗: ${data.shopName}`,
    `メニュー: ${data.serviceName}`,
    `担当: ${staff}`,
    `日時: ${when}`,
    '',
    `ご予約の確認・キャンセルはこちら:`,
    manageUrl,
  ].join('\n');

  switch (data.template) {
    case 'BOOKING_CONFIRMED':
      return {
        subject: `【${data.shopName}】ご予約を承りました`,
        text: `ご予約ありがとうございます。下記の内容で承りました。\n\n${base}`,
      };
    case 'BOOKING_CANCELLED':
      return {
        subject: `【${data.shopName}】ご予約をキャンセルしました`,
        text: `下記のご予約をキャンセルいたしました。\n\n${base}`,
      };
    case 'BOOKING_REMINDER':
      return {
        subject: `【${data.shopName}】ご予約のリマインド`,
        text: `ご来店予定のリマインドです。\n\n${base}`,
      };
    case 'BOOKING_RESCHEDULED':
      return {
        subject: `【${data.shopName}】ご予約内容を変更しました`,
        text: `ご予約内容を変更いたしました。\n\n${base}`,
      };
  }
}

// ---- 店長向け通知（新規予約/変更/キャンセル）。顧客向けとは別文面。 ----
export type ManagerEvent = 'CREATED' | 'RESCHEDULED' | 'CANCELLED';

export interface ManagerNotificationData {
  event: ManagerEvent;
  shopName: string;
  serviceName: string;
  staffName: string | null;
  startAt: Date;
  timezone: string;
  customerName: string;
  bookingId: string;
}

export function buildManagerNotification(data: ManagerNotificationData): { subject: string; text: string } {
  const when = formatBookingDateTime(data.startAt, data.timezone);
  const staff = data.staffName ?? 'おまかせ';
  const adminUrl = `${env.APP_BASE_URL}/admin/bookings/${data.bookingId}`;
  const detail = [
    `お客様: ${data.customerName} 様`,
    `メニュー: ${data.serviceName}`,
    `担当: ${staff}`,
    `日時: ${when}`,
  ].join('\n');

  const head =
    data.event === 'CREATED'
      ? '🔔 新規予約が入りました'
      : data.event === 'RESCHEDULED'
        ? '🔄 予約が変更されました'
        : '❌ 予約がキャンセルされました';
  const subjectHead =
    data.event === 'CREATED' ? '新規予約' : data.event === 'RESCHEDULED' ? '予約変更' : '予約キャンセル';

  return {
    subject: `【${subjectHead}】${data.shopName} / ${data.customerName}様 / ${when}`,
    text: `${head}\n${data.shopName}\n\n${detail}\n\n▶ 詳細・対応はこちら:\n${adminUrl}`,
  };
}

/** 通知テンプレート → 店長イベント種別。 */
export function templateToManagerEvent(template: string): ManagerEvent {
  if (template === 'BOOKING_RESCHEDULED') return 'RESCHEDULED';
  if (template === 'BOOKING_CANCELLED') return 'CANCELLED';
  return 'CREATED';
}
