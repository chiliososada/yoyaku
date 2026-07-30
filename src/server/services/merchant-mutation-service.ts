/**
 * 商家後台の書込サービス。すべて tenantId / shopId スコープ（データ隔離 + 所有権検証）。
 * server actions から呼ばれる。複数書込はトランザクション。
 */
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { nowUtc } from '@/lib/time';
import type {
  StaffFormInput,
  ServiceFormInput,
  ShopSettingsInput,
  ShopCreateInput,
  SpecialDayInput,
  BusinessHoursInput,
  CapacityRuleInput,
  StaffScheduleInput,
  StaffOverrideInput,
} from '@/lib/validation/admin';

async function assertShopInTenant(tenantId: string, shopId: string) {
  const shop = await prisma.shop.findFirst({ where: { id: shopId, tenantId, deletedAt: null }, select: { id: true } });
  if (!shop) throw Errors.notFound('店舗が見つかりません。');
}

function dateOnly(d: string): Date {
  return new Date(`${d}T00:00:00.000Z`);
}

/**
 * 契約プランのスタッフ上限を検査。上限に達していれば CONFLICT。
 * プラン未設定時は既定 3 名（フリー相当）。createShop の maxShops 検査と同じ方針。
 *
 * 枠を消費するのは「在籍中（ACTIVE）」のみ。そのため
 *   - 新規作成: ACTIVE で作るときだけ検査
 *   - 更新: INACTIVE → ACTIVE の復帰時だけ検査
 * とする。これが無いと INACTIVE で大量に作ってから一括で ACTIVE に戻す抜け道ができる。
 */
async function assertStaffQuota(tenantId: string, shopId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { plan: { select: { maxStaffPerShop: true, name: true } } },
  });
  const max = tenant?.plan?.maxStaffPerShop ?? 3;
  // 在籍中（ACTIVE）のみを数える。退職者を INACTIVE で残す運用は普通なので、
  // それを枠に含めると「15名プランなのに10名しか雇えない」となり、
  // 実際には不要な上位プランへの変更を迫る誤った案内になる。
  const current = await prisma.staff.count({ where: { shopId, deletedAt: null, status: 'ACTIVE' } });
  if (current >= max) {
    throw Errors.conflict(
      'CONFLICT',
      `ご契約プラン（${tenant?.plan?.name ?? 'フリー'}）のスタッフ登録上限（1店舗あたり${max}名）に達しています。上位プランへの変更をご検討ください。`,
    );
  }
}

// ---- スタッフ ----
export async function createStaff(tenantId: string, shopId: string, input: StaffFormInput) {
  await assertShopInTenant(tenantId, shopId);
  // 停止中で登録する分には枠を消費しない（復帰時に updateStaff 側で検査する）
  if (input.status === 'ACTIVE') await assertStaffQuota(tenantId, shopId);
  return prisma.$transaction(async (tx) => {
    const staff = await tx.staff.create({
      data: {
        tenantId,
        shopId,
        name: input.name,
        displayName: input.displayName || null,
        email: input.email || null,
        phone: input.phone || null,
        bio: input.bio || null,
        isBookable: input.isBookable,
        capacity: input.capacity,
        nominationFeeJpy: input.nominationFeeJpy,
        status: input.status,
        sortOrder: input.sortOrder,
      },
    });
    if (input.serviceIds.length > 0) {
      const valid = await tx.service.findMany({
        where: { id: { in: input.serviceIds }, shopId, tenantId, deletedAt: null },
        select: { id: true },
      });
      await tx.serviceStaff.createMany({
        data: valid.map((s) => ({ serviceId: s.id, staffId: staff.id })),
        skipDuplicates: true,
      });
    }
    // 既定シフト: 店舗の営業時間をそのまま担当時間として登録する。
    // これが無いと「シフト未設定 = 終日非稼働」となり、公開しても全枠が予約不可（×）になるため。
    // オーナーは後から「シフト設定」で個別に調整できる。
    const hours = await tx.businessHours.findMany({
      where: { shopId },
      select: { dayOfWeek: true, openMinute: true, closeMinute: true },
    });
    if (hours.length > 0) {
      await tx.staffSchedule.createMany({
        data: hours.map((h) => ({
          tenantId,
          shopId,
          staffId: staff.id,
          type: 'RECURRING' as const,
          dayOfWeek: h.dayOfWeek,
          startMinute: h.openMinute,
          endMinute: h.closeMinute,
          isWorking: true,
        })),
      });
    }
    return staff;
  });
}

export async function updateStaff(tenantId: string, shopId: string, staffId: string, input: StaffFormInput) {
  // shopId を WHERE に含めることで、店舗越境（別店舗のスタッフID）を NOT_FOUND で弾く。
  const existing = await prisma.staff.findFirst({ where: { id: staffId, tenantId, shopId, deletedAt: null }, select: { id: true, shopId: true, status: true } });
  if (!existing) throw Errors.notFound('スタッフが見つかりません。');
  // 停止中 → 在籍 への復帰は枠を1つ消費する。ここを見ないと
  // 「INACTIVE で大量に作ってから一括で ACTIVE に戻す」で上限を回避できてしまう。
  if (existing.status !== 'ACTIVE' && input.status === 'ACTIVE') {
    await assertStaffQuota(tenantId, shopId);
  }
  return prisma.$transaction(async (tx) => {
    const staff = await tx.staff.update({
      where: { id: staffId },
      data: {
        name: input.name,
        displayName: input.displayName || null,
        email: input.email || null,
        phone: input.phone || null,
        bio: input.bio || null,
        isBookable: input.isBookable,
        capacity: input.capacity,
        nominationFeeJpy: input.nominationFeeJpy,
        status: input.status,
        sortOrder: input.sortOrder,
      },
    });
    // 担当サービスを貼り直し
    await tx.serviceStaff.deleteMany({ where: { staffId } });
    if (input.serviceIds.length > 0) {
      const valid = await tx.service.findMany({
        where: { id: { in: input.serviceIds }, shopId: existing.shopId, tenantId, deletedAt: null },
        select: { id: true },
      });
      await tx.serviceStaff.createMany({
        data: valid.map((s) => ({ serviceId: s.id, staffId })),
        skipDuplicates: true,
      });
    }
    return staff;
  });
}

export async function softDeleteStaff(tenantId: string, shopId: string, staffId: string) {
  const existing = await prisma.staff.findFirst({
    where: { id: staffId, tenantId, shopId, deletedAt: null },
    select: { id: true, userId: true },
  });
  if (!existing) throw Errors.notFound('スタッフが見つかりません。');
  await prisma.$transaction(async (tx) => {
    await tx.staff.update({ where: { id: staffId }, data: { deletedAt: nowUtc(), status: 'INACTIVE', isBookable: false } });
    // 削除したスタッフのログインも失効させる（放置すると退職者が最大7日ログインできてしまう）。
    if (existing.userId) {
      await tx.user.update({ where: { id: existing.userId }, data: { status: 'SUSPENDED', sessionEpoch: { increment: 1 } } });
    }
  });
}

/**
 * スタッフのログインアカウントを作成/更新（オーナーがメール+パスワードを設定）。
 * User を作成/更新し、Staff.userId で紐付け、SHOP_STAFF の Membership（当該店舗）を付与する。
 */
export async function setStaffLogin(tenantId: string, shopId: string, staffId: string, email: string, password: string) {
  const staff = await prisma.staff.findFirst({
    where: { id: staffId, tenantId, shopId, deletedAt: null },
    select: { id: true, shopId: true, userId: true, name: true },
  });
  if (!staff) throw Errors.notFound('スタッフが見つかりません。');

  const emailOwner = await prisma.user.findUnique({ where: { email: email.trim() }, select: { id: true } });
  if (emailOwner && emailOwner.id !== staff.userId) {
    throw Errors.conflict('CONFLICT', 'このメールアドレスは既に使われています。');
  }
  const role = await prisma.role.findFirst({ where: { code: 'SHOP_STAFF', tenantId: null }, select: { id: true } });
  if (!role) throw Errors.internal(new Error('SHOP_STAFF role missing (run seed)'));
  const passwordHash = bcrypt.hashSync(password, 10);

  return prisma.$transaction(async (tx) => {
    let userId = staff.userId;
    if (userId) {
      // 多層防御: 紐付く User が別テナント所属なら再テナント化・パスワード上書きを拒否。
      const linked = await tx.user.findUnique({ where: { id: userId }, select: { tenantId: true } });
      if (linked && linked.tenantId && linked.tenantId !== tenantId) {
        throw Errors.conflict('CONFLICT', 'このスタッフは別テナントのアカウントに紐付いています。');
      }
      await tx.user.update({ where: { id: userId }, data: { email: email.trim(), passwordHash, tenantId, status: 'ACTIVE' } });
    } else {
      const user = await tx.user.create({ data: { email: email.trim(), name: staff.name, passwordHash, tenantId, status: 'ACTIVE' } });
      userId = user.id;
      await tx.staff.update({ where: { id: staffId }, data: { userId } });
    }
    const existing = await tx.membership.findFirst({ where: { userId, roleId: role.id, shopId: staff.shopId }, select: { id: true } });
    if (!existing) await tx.membership.create({ data: { userId, roleId: role.id, shopId: staff.shopId } });
    return { userId, email: email.trim() };
  });
}

/** スタッフのログインを無効化（User を停止）。再有効化は setStaffLogin で。 */
export async function disableStaffLogin(tenantId: string, shopId: string, staffId: string) {
  const staff = await prisma.staff.findFirst({ where: { id: staffId, tenantId, shopId, deletedAt: null }, select: { userId: true } });
  if (!staff?.userId) return;
  // sessionEpoch を進めて既存 JWT を即時失効（無効化後も最大7日ログインできてしまう穴を塞ぐ）。
  await prisma.user.update({ where: { id: staff.userId }, data: { status: 'SUSPENDED', sessionEpoch: { increment: 1 } } });
}

// ---- サービス ----
export async function createService(tenantId: string, shopId: string, input: ServiceFormInput) {
  await assertShopInTenant(tenantId, shopId);
  return prisma.$transaction(async (tx) => {
    const service = await tx.service.create({
      data: {
        tenantId,
        shopId,
        name: input.name,
        category: input.category || null,
        description: input.description || null,
        durationMin: input.durationMin,
        segments: input.segments && input.segments.length > 0 ? input.segments : undefined,
        bufferAfterMin: input.bufferAfterMin,
        priceJpy: input.priceJpy,
        salePriceJpy: input.salePriceJpy ?? null,
        capacity: input.capacity,
        requiresStaff: input.requiresStaff,
        slotIntervalMin: input.slotIntervalMin,
        color: input.color || null,
        isActive: input.isActive,
        sortOrder: input.sortOrder,
      },
    });
    if (input.staffIds.length > 0) {
      const valid = await tx.staff.findMany({
        where: { id: { in: input.staffIds }, shopId, tenantId, deletedAt: null },
        select: { id: true },
      });
      await tx.serviceStaff.createMany({
        data: valid.map((s) => ({ serviceId: service.id, staffId: s.id })),
        skipDuplicates: true,
      });
    }
    if (input.options.length > 0) {
      await tx.serviceOption.createMany({
        data: input.options.map((o, i) => ({
          tenantId,
          serviceId: service.id,
          name: o.name,
          priceJpy: o.priceJpy,
          extraDurationMin: o.extraDurationMin,
          sortOrder: i,
        })),
      });
    }
    return service;
  });
}

/** オプションを同期（id ありは更新、なしは新規、フォームに無いものはソフト削除）。 */
async function syncServiceOptions(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  tenantId: string,
  serviceId: string,
  options: ServiceFormInput['options'],
) {
  const existing = await tx.serviceOption.findMany({
    where: { serviceId, tenantId, deletedAt: null },
    select: { id: true },
  });
  const keepIds = new Set(options.filter((o) => o.id).map((o) => o.id!));
  const toRemove = existing.filter((e) => !keepIds.has(e.id)).map((e) => e.id);
  if (toRemove.length > 0) {
    // 過去予約のスナップショット(BookingItemOption)は残るためソフト削除でよい
    await tx.serviceOption.updateMany({
      where: { id: { in: toRemove } },
      data: { deletedAt: nowUtc(), isActive: false },
    });
  }
  for (let i = 0; i < options.length; i++) {
    const o = options[i]!;
    if (o.id && existing.some((e) => e.id === o.id)) {
      await tx.serviceOption.update({
        where: { id: o.id },
        data: { name: o.name, priceJpy: o.priceJpy, extraDurationMin: o.extraDurationMin, sortOrder: i },
      });
    } else {
      await tx.serviceOption.create({
        data: {
          tenantId,
          serviceId,
          name: o.name,
          priceJpy: o.priceJpy,
          extraDurationMin: o.extraDurationMin,
          sortOrder: i,
        },
      });
    }
  }
}

export async function updateService(tenantId: string, shopId: string, serviceId: string, input: ServiceFormInput) {
  const existing = await prisma.service.findFirst({ where: { id: serviceId, tenantId, shopId, deletedAt: null }, select: { id: true, shopId: true } });
  if (!existing) throw Errors.notFound('メニューが見つかりません。');
  return prisma.$transaction(async (tx) => {
    const service = await tx.service.update({
      where: { id: serviceId },
      data: {
        name: input.name,
        category: input.category || null,
        description: input.description || null,
        durationMin: input.durationMin,
        segments: input.segments && input.segments.length > 0 ? input.segments : undefined,
        bufferAfterMin: input.bufferAfterMin,
        priceJpy: input.priceJpy,
        salePriceJpy: input.salePriceJpy ?? null,
        capacity: input.capacity,
        requiresStaff: input.requiresStaff,
        slotIntervalMin: input.slotIntervalMin,
        color: input.color || null,
        isActive: input.isActive,
        sortOrder: input.sortOrder,
      },
    });
    await tx.serviceStaff.deleteMany({ where: { serviceId } });
    if (input.staffIds.length > 0) {
      const valid = await tx.staff.findMany({
        where: { id: { in: input.staffIds }, shopId: existing.shopId, tenantId, deletedAt: null },
        select: { id: true },
      });
      await tx.serviceStaff.createMany({
        data: valid.map((s) => ({ serviceId, staffId: s.id })),
        skipDuplicates: true,
      });
    }
    await syncServiceOptions(tx, tenantId, serviceId, input.options);
    return service;
  });
}

export async function softDeleteService(tenantId: string, shopId: string, serviceId: string) {
  const existing = await prisma.service.findFirst({ where: { id: serviceId, tenantId, shopId, deletedAt: null }, select: { id: true } });
  if (!existing) throw Errors.notFound('メニューが見つかりません。');
  await prisma.service.update({ where: { id: serviceId }, data: { deletedAt: nowUtc(), isActive: false } });
}

// ---- 店舗（複数店舗対応: 新規追加）----
/** テナントに店舗を追加。プラン上限・slug 一意を検証し、既定の営業時間/容量ルールも作成。 */
export async function createShop(tenantId: string, input: ShopCreateInput) {
  const slugTaken = await prisma.shop.findFirst({ where: { slug: input.slug }, select: { id: true } });
  if (slugTaken) throw Errors.conflict('CONFLICT', '店舗slugは既に使用されています。');

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { plan: { select: { maxShops: true } } },
  });
  const maxShops = tenant?.plan?.maxShops ?? 1;
  const current = await prisma.shop.count({ where: { tenantId, deletedAt: null } });
  if (current >= maxShops) {
    throw Errors.conflict('CONFLICT', `ご契約プランの店舗数上限（${maxShops}店舗）に達しています。`);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const shop = await tx.shop.create({
        data: {
          tenantId,
          slug: input.slug,
          name: input.name,
          timezone: input.timezone || 'Asia/Tokyo',
          status: 'DRAFT',
          publicBookingEnabled: false,
          closeOnNationalHolidays: true,
          settings: { shopCapacity: 1 },
        },
      });
      await tx.businessHours.createMany({
        data: [1, 2, 3, 4, 5, 6].map((dow) => ({ tenantId, shopId: shop.id, dayOfWeek: dow, openMinute: 600, closeMinute: 1140 })),
      });
      await tx.bookingCapacityRule.create({
        data: { tenantId, shopId: shop.id, scope: 'SHOP', maxConcurrent: 1, slotIntervalMin: 30, bookingWindowDays: 30, leadTimeMinHours: 2, cancellationDeadlineHours: 24 },
      });
      return shop;
    });
  } catch (e) {
    // 事前チェックと create の間の競合（shops_slug_key）→ 友好的な CONFLICT に変換
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw Errors.conflict('CONFLICT', '店舗slugは既に使用されています。');
    }
    throw e;
  }
}

// ---- 店舗設定 ----
export async function updateShopSettings(tenantId: string, shopId: string, input: ShopSettingsInput) {
  const existing = await prisma.shop.findFirst({ where: { id: shopId, tenantId, deletedAt: null }, select: { id: true, settings: true } });
  if (!existing) throw Errors.notFound('店舗が見つかりません。');
  const settings = { ...((existing.settings as Record<string, unknown>) ?? {}), shopCapacity: input.shopCapacity };
  return prisma.shop.update({
    where: { id: shopId },
    data: {
      name: input.name,
      description: input.description || null,
      phone: input.phone || null,
      email: input.email || null,
      postalCode: input.postalCode || null,
      prefecture: input.prefecture || null,
      city: input.city || null,
      address: input.address || null,
      status: input.status,
      publicBookingEnabled: input.publicBookingEnabled,
      closeOnNationalHolidays: input.closeOnNationalHolidays,
      settings,
    },
  });
}

// ---- 特別営業日 ----
export async function addSpecialDay(tenantId: string, shopId: string, input: SpecialDayInput) {
  await assertShopInTenant(tenantId, shopId);
  return prisma.specialBusinessDay.upsert({
    where: { shopId_date: { shopId, date: dateOnly(input.date) } },
    update: {
      type: input.type,
      openMinute: input.type === 'CLOSED' ? null : (input.openMinute ?? null),
      closeMinute: input.type === 'CLOSED' ? null : (input.closeMinute ?? null),
      reason: input.reason || null,
    },
    create: {
      tenantId,
      shopId,
      date: dateOnly(input.date),
      type: input.type,
      openMinute: input.type === 'CLOSED' ? null : (input.openMinute ?? null),
      closeMinute: input.type === 'CLOSED' ? null : (input.closeMinute ?? null),
      reason: input.reason || null,
    },
  });
}

export async function deleteSpecialDay(tenantId: string, shopId: string, id: string) {
  const existing = await prisma.specialBusinessDay.findFirst({ where: { id, shopId, tenantId }, select: { id: true } });
  if (!existing) throw Errors.notFound('対象が見つかりません。');
  await prisma.specialBusinessDay.delete({ where: { id } });
}

// ---- 容量ルール ----
export async function updateCapacityRule(tenantId: string, shopId: string, ruleId: string, input: CapacityRuleInput) {
  const existing = await prisma.bookingCapacityRule.findFirst({ where: { id: ruleId, tenantId, shopId }, select: { id: true } });
  if (!existing) throw Errors.notFound('予約ルールが見つかりません。');
  return prisma.bookingCapacityRule.update({
    where: { id: ruleId },
    data: {
      maxConcurrent: input.maxConcurrent,
      slotIntervalMin: input.slotIntervalMin,
      bookingWindowDays: input.bookingWindowDays,
      leadTimeMinHours: input.leadTimeMinHours,
      cancellationDeadlineHours: input.cancellationDeadlineHours,
    },
  });
}

// ---- スタッフシフト ----
async function assertStaffInShop(tenantId: string, shopId: string, staffId: string): Promise<void> {
  const staff = await prisma.staff.findFirst({ where: { id: staffId, tenantId, shopId, deletedAt: null }, select: { id: true } });
  if (!staff) throw Errors.notFound('スタッフが見つかりません。');
}

/** スタッフの曜日シフト（RECURRING）を全置換。 */
export async function replaceStaffRecurringSchedule(tenantId: string, shopId: string, staffId: string, input: StaffScheduleInput) {
  await assertStaffInShop(tenantId, shopId, staffId);
  // 黙って捨てない（API 直叩き対策）。捨てるとその曜日の出勤が理由不明で消える。
  const bad = input.rows.find((r) => r.endMinute <= r.startMinute);
  if (bad) {
    throw Errors.validation(
      `${['日', '月', '火', '水', '木', '金', '土'][bad.dayOfWeek]}曜: 終了時刻は開始時刻より後にしてください。`,
    );
  }
  const rows = input.rows;
  return prisma.$transaction(async (tx) => {
    await tx.staffSchedule.deleteMany({ where: { staffId, type: 'RECURRING' } });
    if (rows.length > 0) {
      await tx.staffSchedule.createMany({
        data: rows.map((r) => ({
          tenantId, shopId, staffId, type: 'RECURRING' as const,
          dayOfWeek: r.dayOfWeek, startMinute: r.startMinute, endMinute: r.endMinute, isWorking: true,
        })),
      });
    }
  });
}

/** 特定日の出勤/欠勤（OVERRIDE）を追加（同日があれば置換）。 */
export async function addStaffOverride(tenantId: string, shopId: string, staffId: string, input: StaffOverrideInput) {
  await assertStaffInShop(tenantId, shopId, staffId);
  const date = dateOnly(input.date);
  return prisma.$transaction(async (tx) => {
    await tx.staffSchedule.deleteMany({ where: { staffId, type: 'OVERRIDE', date } });
    return tx.staffSchedule.create({
      data: {
        tenantId, shopId, staffId, type: 'OVERRIDE', date,
        isWorking: input.isWorking,
        startMinute: input.isWorking ? (input.startMinute ?? null) : null,
        endMinute: input.isWorking ? (input.endMinute ?? null) : null,
        note: input.note || null,
      },
    });
  });
}

export async function deleteStaffOverride(tenantId: string, shopId: string, scheduleId: string) {
  const existing = await prisma.staffSchedule.findFirst({ where: { id: scheduleId, tenantId, shopId, type: 'OVERRIDE' }, select: { id: true } });
  if (!existing) throw Errors.notFound('対象が見つかりません。');
  await prisma.staffSchedule.delete({ where: { id: scheduleId } });
}

// ---- 顧客カルテ ----
/** 顧客のメモ（好み・接客メモ等）を更新。 */
export async function updateCustomerNote(tenantId: string, customerId: string, note: string) {
  const c = await prisma.customer.findFirst({ where: { id: customerId, tenantId, deletedAt: null }, select: { id: true } });
  if (!c) throw Errors.notFound('顧客が見つかりません。');
  await prisma.customer.update({ where: { id: customerId }, data: { note: note.trim() || null } });
}

// ---- 営業時間（全置換） ----
export async function replaceBusinessHours(tenantId: string, shopId: string, input: BusinessHoursInput) {
  await assertShopInTenant(tenantId, shopId);
  // 不正行を黙って捨てない（API 直叩き対策）。捨てると保存は成功したように見えて
  // その曜日だけが理由不明で定休になり、店主が原因に辿り着けない。
  const invalid = input.rows.find((r) => r.closeMinute <= r.openMinute);
  if (invalid) {
    throw Errors.validation(
      `${['日', '月', '火', '水', '木', '金', '土'][invalid.dayOfWeek]}曜: 終了時刻は開始時刻より後にしてください。`,
    );
  }
  const rows = input.rows;
  return prisma.$transaction(async (tx) => {
    await tx.businessHours.deleteMany({ where: { shopId } });
    if (rows.length > 0) {
      await tx.businessHours.createMany({
        data: rows.map((r) => ({ tenantId, shopId, dayOfWeek: r.dayOfWeek, openMinute: r.openMinute, closeMinute: r.closeMinute })),
      });
    }
  });
}
