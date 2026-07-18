/**
 * 監査ログの表示ラベル（操作コード・リソース種別 → 日本語）。
 * 商家後台(/admin/logs) と 運営コンソール(/platform/audit) で共用し、表記を統一する。
 * 新しい audit(...) / writeAudit(...) を追加したら、ここにもラベルを追記すること。
 */

/** 操作コード → 日本語ラベル。 */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  // 店舗
  'shop.create': '店舗の追加',
  'shop.update': '店舗設定の更新',
  // スタッフ
  'staff.create': 'スタッフ登録',
  'staff.update': 'スタッフ更新',
  'staff.delete': 'スタッフ削除',
  'staff.login.set': 'スタッフのログイン設定',
  'staff.login.disable': 'スタッフのログイン無効化',
  // メニュー
  'service.create': 'メニュー登録',
  'service.update': 'メニュー更新',
  'service.delete': 'メニュー削除',
  // 営業時間 / 特別営業日 / 予約ルール
  'businessHours.replace': '営業時間の更新',
  'specialDay.upsert': '特別営業日の設定',
  'specialDay.delete': '特別営業日の削除',
  'capacityRule.update': '予約ルールの更新',
  // シフト
  'staffSchedule.replace': 'シフトの更新',
  'staffSchedule.override': 'シフトの上書き',
  'staffSchedule.override.delete': 'シフト上書きの削除',
  // 予約
  'booking.create.admin': '代理予約の登録',
  'booking.reschedule': '予約日時の変更',
  'booking.status.confirmed': '予約を確定に変更',
  'booking.status.completed': '予約を来店完了に変更',
  'booking.status.cancelled': '予約をキャンセルに変更',
  'booking.status.no_show': '予約を無断キャンセルに変更',
  // 顧客
  'customer.note.update': '顧客メモの更新',
  // 運営（プラットフォーム管理）
  'tenant.create': '商家の登録',
  'plan.update': 'プランの更新',
  'user.status.active': 'ユーザーを有効化',
  'user.status.suspended': 'ユーザーを停止',
  'user.password.reset': 'パスワードの再発行',
};

/** リソース種別 → 日本語ラベル。 */
export const AUDIT_RESOURCE_LABEL: Record<string, string> = {
  shop: '店舗',
  staff: 'スタッフ',
  service: 'メニュー',
  business_hours: '営業時間',
  special_business_day: '特別営業日',
  booking_capacity_rule: '予約ルール',
  staff_schedule: 'シフト',
  booking: '予約',
  customer: '顧客',
  tenant: '商家',
  user: 'ユーザー',
  plan: 'プラン',
};

/** 操作コードを日本語ラベルへ。未知コードはそのまま返す（新機能の取りこぼしでも壊れない）。 */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? action;
}

/** リソース種別を日本語ラベルへ。未知種別はそのまま返す。 */
export function auditResourceLabel(resourceType: string): string {
  return AUDIT_RESOURCE_LABEL[resourceType] ?? resourceType;
}
