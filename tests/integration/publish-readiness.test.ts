/**
 * 開業準備チェック（getPublishReadiness）の統合テスト。
 * 「設定したのに予約できない」を検知できることを保証する。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { getPublishReadiness, getPrimaryShop } from '@/server/services/merchant-service';
import { seedScenario, cleanupTenant } from '../helpers/seed';

const createdTenants: string[] = [];
afterAll(async () => {
  for (const t of createdTenants) await cleanupTenant(t);
});

async function readinessFor(tenantId: string) {
  const shop = await getPrimaryShop(tenantId);
  return getPublishReadiness(tenantId, shop);
}

describe('getPublishReadiness', () => {
  it('メニュー・スタッフ・シフト・公開が揃えば ready=true', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    const r = await readinessFor(sc.tenantId);
    expect(r.ready).toBe(true);
    expect(Object.values(r.checks).every(Boolean)).toBe(true);
    expect(r.publicPath).toMatch(/^\/book\//);
  });

  it('スタッフ0名 → staff/shifts/menuStaff が false で not ready', async () => {
    const sc = await seedScenario({ staffCount: 0 });
    createdTenants.push(sc.tenantId);
    const r = await readinessFor(sc.tenantId);
    expect(r.ready).toBe(false);
    expect(r.checks.menu).toBe(true); // メニューはある
    expect(r.checks.staff).toBe(false);
    expect(r.checks.menuStaff).toBe(false); // 担当必須メニューに担当なし
  });

  it('下書き（未公開）→ published が false で not ready', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    await prisma.shop.update({ where: { id: sc.shopId }, data: { status: 'DRAFT' } });
    const r = await readinessFor(sc.tenantId);
    expect(r.ready).toBe(false);
    expect(r.checks.published).toBe(false);
    expect(r.checks.onlineBooking).toBe(true);
  });

  it('スタッフのシフトを削除 → shifts が false + 対象スタッフ名を返す', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    await prisma.staffSchedule.deleteMany({ where: { staffId: sc.staffIds[0]! } });
    const r = await readinessFor(sc.tenantId);
    expect(r.ready).toBe(false);
    expect(r.checks.shifts).toBe(false);
    expect(r.staffWithoutShift.length).toBe(1);
  });

  it('オンライン予約OFF → onlineBooking が false で not ready', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    await prisma.shop.update({ where: { id: sc.shopId }, data: { publicBookingEnabled: false } });
    const r = await readinessFor(sc.tenantId);
    expect(r.ready).toBe(false);
    expect(r.checks.onlineBooking).toBe(false);
  });
});
