/**
 * 統合テスト用シードヘルパー。
 * 完結したテストシナリオ（テナント〜営業時間〜スタッフ〜容量ルール）を作る。
 */
import { prisma } from '@/lib/db';

export interface ScenarioOptions {
  shopCapacity?: number;
  serviceCapacity?: number;
  staffCount?: number;
  staffCapacity?: number;
  requiresStaff?: boolean;
  serviceDurationMin?: number;
  slotIntervalMin?: number;
  bookingWindowDays?: number;
  leadTimeMinHours?: number;
  /** 営業時間（全曜日共通）。分。 */
  openMinute?: number;
  closeMinute?: number;
}

export interface Scenario {
  tenantId: string;
  shopId: string;
  serviceId: string;
  staffIds: string[];
  timezone: string;
}

let counter = 0;

export async function seedScenario(opts: ScenarioOptions = {}): Promise<Scenario> {
  const {
    shopCapacity = 9999,
    serviceCapacity = 9999,
    staffCount = 1,
    staffCapacity = 1,
    requiresStaff = true,
    serviceDurationMin = 60,
    slotIntervalMin = 60,
    bookingWindowDays = 90,
    leadTimeMinHours = 1,
    openMinute = 540, // 9:00
    closeMinute = 1080, // 18:00
  } = opts;

  counter += 1;
  const suffix = `${Date.now()}_${counter}`;

  const tenant = await prisma.tenant.create({
    data: { slug: `test-tenant-${suffix}`, name: `Test Tenant ${suffix}`, status: 'ACTIVE' },
  });

  const shop = await prisma.shop.create({
    data: {
      tenantId: tenant.id,
      slug: `test-shop-${suffix}`,
      name: `Test Shop ${suffix}`,
      timezone: 'Asia/Tokyo',
      status: 'PUBLISHED',
      publicBookingEnabled: true,
      closeOnNationalHolidays: false,
      settings: { shopCapacity },
    },
  });

  // 全曜日 9-18 営業
  await prisma.businessHours.createMany({
    data: Array.from({ length: 7 }, (_, dow) => ({
      tenantId: tenant.id,
      shopId: shop.id,
      dayOfWeek: dow,
      openMinute,
      closeMinute,
    })),
  });

  const service = await prisma.service.create({
    data: {
      tenantId: tenant.id,
      shopId: shop.id,
      name: `Test Service ${suffix}`,
      durationMin: serviceDurationMin,
      capacity: serviceCapacity,
      requiresStaff,
      slotIntervalMin,
      priceJpy: 5000,
    },
  });

  const staffIds: string[] = [];
  for (let i = 0; i < staffCount; i++) {
    const staff = await prisma.staff.create({
      data: {
        tenantId: tenant.id,
        shopId: shop.id,
        name: `Staff ${i + 1} ${suffix}`,
        isBookable: true,
        capacity: staffCapacity,
        status: 'ACTIVE',
      },
    });
    staffIds.push(staff.id);
    await prisma.serviceStaff.create({ data: { serviceId: service.id, staffId: staff.id } });
    // 全曜日 9-18 稼働
    await prisma.staffSchedule.createMany({
      data: Array.from({ length: 7 }, (_, dow) => ({
        tenantId: tenant.id,
        shopId: shop.id,
        staffId: staff.id,
        type: 'RECURRING' as const,
        dayOfWeek: dow,
        startMinute: openMinute,
        endMinute: closeMinute,
        isWorking: true,
      })),
    });
  }

  // 容量ルール（SHOP / SERVICE）
  await prisma.bookingCapacityRule.create({
    data: {
      tenantId: tenant.id,
      shopId: shop.id,
      scope: 'SHOP',
      maxConcurrent: shopCapacity,
      slotIntervalMin,
      bookingWindowDays,
      leadTimeMinHours,
      cancellationDeadlineHours: 24,
    },
  });
  await prisma.bookingCapacityRule.create({
    data: {
      tenantId: tenant.id,
      shopId: shop.id,
      scope: 'SERVICE',
      serviceId: service.id,
      maxConcurrent: serviceCapacity,
      slotIntervalMin,
      bookingWindowDays,
      leadTimeMinHours,
      cancellationDeadlineHours: 24,
    },
  });

  return {
    tenantId: tenant.id,
    shopId: shop.id,
    serviceId: service.id,
    staffIds,
    timezone: 'Asia/Tokyo',
  };
}

export interface ExtraServiceOptions {
  name?: string;
  durationMin?: number;
  bufferAfterMin?: number;
  priceJpy?: number;
  capacity?: number;
  segments?: { offsetMin: number; durationMin: number }[];
  /** シナリオの staffIds のうち担当させるインデックス（省略時は全員） */
  staffIndexes?: number[];
  /** サービスオプション */
  options?: { name: string; priceJpy: number; extraDurationMin: number }[];
}

/** シナリオへ2つ目以降のサービスを追加（コンボ予約テスト用）。 */
export async function addServiceToScenario(
  sc: Scenario,
  opts: ExtraServiceOptions = {},
): Promise<{ serviceId: string; optionIds: string[] }> {
  counter += 1;
  const service = await prisma.service.create({
    data: {
      tenantId: sc.tenantId,
      shopId: sc.shopId,
      name: opts.name ?? `Extra Service ${counter}`,
      durationMin: opts.durationMin ?? 30,
      bufferAfterMin: opts.bufferAfterMin ?? 0,
      segments: opts.segments,
      capacity: opts.capacity ?? 9999,
      requiresStaff: true,
      slotIntervalMin: 60,
      priceJpy: opts.priceJpy ?? 3000,
    },
  });
  const idx = opts.staffIndexes ?? sc.staffIds.map((_, i) => i);
  for (const i of idx) {
    await prisma.serviceStaff.create({ data: { serviceId: service.id, staffId: sc.staffIds[i]! } });
  }
  const optionIds: string[] = [];
  for (const [i, o] of (opts.options ?? []).entries()) {
    const row = await prisma.serviceOption.create({
      data: {
        tenantId: sc.tenantId,
        serviceId: service.id,
        name: o.name,
        priceJpy: o.priceJpy,
        extraDurationMin: o.extraDurationMin,
        sortOrder: i,
      },
    });
    optionIds.push(row.id);
  }
  return { serviceId: service.id, optionIds };
}

/** テナント配下を一括削除（cascade）。 */
export async function cleanupTenant(tenantId: string): Promise<void> {
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

export { prisma };
