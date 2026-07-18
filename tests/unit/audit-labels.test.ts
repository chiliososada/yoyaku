import { describe, it, expect } from 'vitest';
import {
  auditActionLabel,
  auditResourceLabel,
  AUDIT_ACTION_LABEL,
  AUDIT_RESOURCE_LABEL,
} from '@/lib/audit-labels';

/**
 * 実際に emit される全操作コード（audit()/writeAudit() の action 引数）。
 * 新しい監査操作を追加したらここに足すこと。ラベル欠落（コード生表示）を防ぐ番人。
 */
const EMITTED_ACTIONS = [
  'shop.create', 'shop.update',
  'staff.create', 'staff.update', 'staff.delete', 'staff.login.set', 'staff.login.disable',
  'service.create', 'service.update', 'service.delete',
  'businessHours.replace', 'specialDay.upsert', 'specialDay.delete', 'capacityRule.update',
  'staffSchedule.replace', 'staffSchedule.override', 'staffSchedule.override.delete',
  'booking.create.admin', 'booking.reschedule',
  'booking.status.confirmed', 'booking.status.completed', 'booking.status.cancelled', 'booking.status.no_show',
  'customer.note.update',
  'tenant.create', 'plan.update', 'user.status.active', 'user.status.suspended', 'user.password.reset',
];

const EMITTED_RESOURCES = [
  'shop', 'staff', 'service', 'business_hours', 'special_business_day', 'booking_capacity_rule',
  'staff_schedule', 'booking', 'customer', 'tenant', 'user', 'plan',
];

describe('監査ログのラベル', () => {
  it('emit される全操作コードに日本語ラベルがある（生コードにフォールバックしない）', () => {
    for (const code of EMITTED_ACTIONS) {
      expect(AUDIT_ACTION_LABEL[code], `未定義の操作ラベル: ${code}`).toBeTruthy();
      expect(auditActionLabel(code)).not.toBe(code);
    }
  });

  it('emit される全リソース種別に日本語ラベルがある', () => {
    for (const r of EMITTED_RESOURCES) {
      expect(AUDIT_RESOURCE_LABEL[r], `未定義のリソースラベル: ${r}`).toBeTruthy();
      expect(auditResourceLabel(r)).not.toBe(r);
    }
  });

  it('未知コード/種別はそのまま返す（取りこぼしても壊れない）', () => {
    expect(auditActionLabel('foo.bar.unknown')).toBe('foo.bar.unknown');
    expect(auditResourceLabel('unknown_resource')).toBe('unknown_resource');
  });
});
