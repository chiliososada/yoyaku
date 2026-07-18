/**
 * デモ/初期データ投入。冪等（再実行で重複しない）。
 *   - 権限・システムロール（rbac 定義から）
 *   - 料金プラン
 *   - プラットフォーム管理者
 *   - 2026 年 日本の祝日（参照カレンダー）
 *   - デモ商家「デモビューティー」/ 店舗「デモサロン 渋谷店」一式 + デモ予約
 *
 * tsx は tsconfig paths(@/*) を解決しないため相対 import を使う。
 */
import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  ALL_PERMISSIONS,
  PERMISSION_CATEGORY,
  SYSTEM_ROLES,
  PERMISSIONS,
} from '../src/lib/rbac';
import { zonedDateMinutesToUtc, isoDateAddDays, todayInZone, isoDateDayOfWeek } from '../src/lib/time';

const prisma = new PrismaClient();
const TZ = 'Asia/Tokyo';
const DEMO_PASSWORD = 'password123';
/** 本番シード: SEED_DEMO=false でデモ商家/デモ予約の投入をスキップ */
const SEED_DEMO = process.env.SEED_DEMO !== 'false';
/** プラットフォーム管理者の資格情報（本番では必ず環境変数で上書きすること） */
const PLATFORM_ADMIN_EMAIL = process.env.PLATFORM_ADMIN_EMAIL ?? 'admin@platform.test';
const PLATFORM_ADMIN_PASSWORD = process.env.PLATFORM_ADMIN_PASSWORD ?? DEMO_PASSWORD;

// 2026 年 日本の祝日
const HOLIDAYS_2026: { date: string; name: string }[] = [
  { date: '2026-01-01', name: '元日' },
  { date: '2026-01-12', name: '成人の日' },
  { date: '2026-02-11', name: '建国記念の日' },
  { date: '2026-02-23', name: '天皇誕生日' },
  { date: '2026-03-20', name: '春分の日' },
  { date: '2026-04-29', name: '昭和の日' },
  { date: '2026-05-03', name: '憲法記念日' },
  { date: '2026-05-04', name: 'みどりの日' },
  { date: '2026-05-05', name: 'こどもの日' },
  { date: '2026-05-06', name: '振替休日' },
  { date: '2026-07-20', name: '海の日' },
  { date: '2026-08-11', name: '山の日' },
  { date: '2026-09-21', name: '敬老の日' },
  { date: '2026-09-22', name: '国民の休日' },
  { date: '2026-09-23', name: '秋分の日' },
  { date: '2026-10-12', name: 'スポーツの日' },
  { date: '2026-11-03', name: '文化の日' },
  { date: '2026-11-23', name: '勤労感謝の日' },
];

function dateOnly(d: string): Date {
  return new Date(`${d}T00:00:00.000Z`);
}

async function seedPermissionsAndRoles() {
  console.log('· 権限・ロールを投入...');
  for (const code of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      update: { category: PERMISSION_CATEGORY[code] },
      create: { code, name: code, category: PERMISSION_CATEGORY[code] },
    });
  }
  const allPerms = await prisma.permission.findMany({ select: { id: true, code: true } });
  const permIdByCode = new Map(allPerms.map((p) => [p.code, p.id]));

  for (const def of SYSTEM_ROLES) {
    let role = await prisma.role.findFirst({
      where: { code: def.code, tenantId: null },
    });
    if (!role) {
      role = await prisma.role.create({
        data: { code: def.code, name: def.name, scope: def.scope, isSystem: true },
      });
    } else {
      role = await prisma.role.update({
        where: { id: role.id },
        data: { name: def.name, scope: def.scope, isSystem: true },
      });
    }
    // 権限を貼り直し
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: def.permissions
        .map((code) => permIdByCode.get(code))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role!.id, permissionId })),
      skipDuplicates: true,
    });
  }
}

async function seedPlans() {
  console.log('· 料金プランを投入...');
  const plans = [
    { code: 'FREE', name: 'フリー', priceJpy: 0, maxShops: 1, maxStaffPerShop: 3, maxBookingsPerMonth: 100, sortOrder: 0 },
    { code: 'STANDARD', name: 'スタンダード', priceJpy: 9800, maxShops: 3, maxStaffPerShop: 15, maxBookingsPerMonth: 3000, sortOrder: 1 },
    { code: 'PRO', name: 'プロ', priceJpy: 29800, maxShops: 20, maxStaffPerShop: 100, maxBookingsPerMonth: 50000, sortOrder: 2 },
  ];
  for (const p of plans) {
    await prisma.plan.upsert({ where: { code: p.code }, update: p, create: p });
  }
}

async function seedHolidays() {
  console.log('· 2026年の祝日を投入...');
  await prisma.holiday.deleteMany({ where: { type: 'NATIONAL', country: 'JP', shopId: null } });
  await prisma.holiday.createMany({
    data: HOLIDAYS_2026.map((h) => ({
      date: dateOnly(h.date),
      name: h.name,
      type: 'NATIONAL' as const,
      country: 'JP',
    })),
    skipDuplicates: true,
  });
}

async function seedPlatformAdmin() {
  console.log('· プラットフォーム管理者を投入...');
  const passwordHash = bcrypt.hashSync(PLATFORM_ADMIN_PASSWORD, 10);
  const admin = await prisma.user.upsert({
    where: { email: PLATFORM_ADMIN_EMAIL },
    update: { passwordHash, isPlatformAdmin: true, status: 'ACTIVE' },
    create: {
      email: PLATFORM_ADMIN_EMAIL,
      name: 'プラットフォーム管理者',
      passwordHash,
      isPlatformAdmin: true,
      status: 'ACTIVE',
    },
  });
  const role = await prisma.role.findFirst({ where: { code: 'PLATFORM_ADMIN', tenantId: null } });
  if (role) {
    const exists = await prisma.membership.findFirst({
      where: { userId: admin.id, roleId: role.id, shopId: null },
    });
    if (!exists) {
      await prisma.membership.create({ data: { userId: admin.id, roleId: role.id } });
    }
  }
}

async function seedDemoTenant() {
  console.log('· デモ商家を再構築...');
  // 冪等のため既存デモテナントは cascade 削除して作り直す
  const existing = await prisma.tenant.findUnique({ where: { slug: 'demo-beauty' } });
  if (existing) await prisma.tenant.delete({ where: { id: existing.id } });

  const proPlan = await prisma.plan.findUnique({ where: { code: 'PRO' } });
  const tenant = await prisma.tenant.create({
    data: {
      slug: 'demo-beauty',
      name: 'デモビューティー株式会社',
      status: 'ACTIVE',
      planId: proPlan?.id ?? null,
      settings: { brandColor: '#0f172a' },
    },
  });

  const shop = await prisma.shop.create({
    data: {
      tenantId: tenant.id,
      slug: 'demo-salon',
      name: 'デモサロン 渋谷店',
      description: '渋谷駅徒歩5分。カット・カラー・ヘッドスパの総合サロン。',
      phone: '03-1234-5678',
      email: 'shibuya@demo-beauty.test',
      postalCode: '150-0002',
      prefecture: '東京都',
      city: '渋谷区',
      address: '渋谷1-2-3 デモビル4F',
      timezone: TZ,
      status: 'PUBLISHED',
      publicBookingEnabled: true,
      closeOnNationalHolidays: true,
      settings: { shopCapacity: 3 },
    },
  });

  // 営業時間: 月曜定休、火〜日 10:00-19:00（水曜は 13:00-14:00 を昼休みで分割してデモ）
  const openDays = [0, 2, 3, 4, 5, 6]; // 日,火,水,木,金,土
  const bhData: Prisma.BusinessHoursCreateManyInput[] = [];
  for (const dow of openDays) {
    if (dow === 3) {
      // 水曜: 昼休み分割
      bhData.push({ tenantId: tenant.id, shopId: shop.id, dayOfWeek: dow, openMinute: 600, closeMinute: 780 });
      bhData.push({ tenantId: tenant.id, shopId: shop.id, dayOfWeek: dow, openMinute: 840, closeMinute: 1140 });
    } else {
      bhData.push({ tenantId: tenant.id, shopId: shop.id, dayOfWeek: dow, openMinute: 600, closeMinute: 1140 });
    }
  }
  await prisma.businessHours.createMany({ data: bhData });

  // スタッフ（指名料つき）
  const staffDefs = [
    { name: '田中 美咲', displayName: '田中', bio: 'スタイリスト歴10年。トレンドカラーが得意。', nominationFeeJpy: 500 },
    { name: '鈴木 健太', displayName: '鈴木', bio: 'メンズカット・ヘッドスパ担当。', nominationFeeJpy: 300 },
    { name: '佐藤 由美', displayName: '佐藤', bio: 'ヘッドスパ・トリートメント専門。', nominationFeeJpy: 0 },
  ];
  const staff = [];
  for (let i = 0; i < staffDefs.length; i++) {
    const s = await prisma.staff.create({
      data: {
        tenantId: tenant.id,
        shopId: shop.id,
        name: staffDefs[i]!.name,
        displayName: staffDefs[i]!.displayName,
        bio: staffDefs[i]!.bio,
        isBookable: true,
        capacity: 1,
        nominationFeeJpy: staffDefs[i]!.nominationFeeJpy,
        sortOrder: i,
        status: 'ACTIVE',
      },
    });
    staff.push(s);
    // シフト: 営業日と同じ 10:00-19:00（水曜のみ分割せず通し）
    await prisma.staffSchedule.createMany({
      data: openDays.map((dow) => ({
        tenantId: tenant.id,
        shopId: shop.id,
        staffId: s.id,
        type: 'RECURRING' as const,
        dayOfWeek: dow,
        startMinute: 600,
        endMinute: 1140,
        isWorking: true,
      })),
    });
  }

  // サービス（カラーは多時間帯占有 segments）
  const cut = await prisma.service.create({
    data: {
      tenantId: tenant.id, shopId: shop.id, name: 'カット', category: 'ヘア',
      description: 'シャンプー・ブロー込み。', durationMin: 60, bufferAfterMin: 10,
      priceJpy: 4500, capacity: 1, requiresStaff: true, slotIntervalMin: 30, color: '#2563eb', sortOrder: 0,
    },
  });
  const color = await prisma.service.create({
    data: {
      tenantId: tenant.id, shopId: shop.id, name: 'カラー', category: 'ヘア',
      description: '薬剤塗布→放置→仕上げ。放置中は席のみ使用。',
      durationMin: 120,
      segments: [{ offsetMin: 0, durationMin: 40 }, { offsetMin: 60, durationMin: 60 }],
      bufferAfterMin: 10, priceJpy: 8000, capacity: 1, requiresStaff: true, slotIntervalMin: 30, color: '#db2777', sortOrder: 1,
    },
  });
  const spa = await prisma.service.create({
    data: {
      tenantId: tenant.id, shopId: shop.id, name: 'ヘッドスパ', category: 'スパ',
      description: 'リラクゼーション。2席同時施術可。', durationMin: 45, bufferAfterMin: 5,
      priceJpy: 3500, capacity: 2, requiresStaff: true, slotIntervalMin: 15, color: '#16a34a', sortOrder: 2,
    },
  });

  // サービスオプション（追加メニュー）
  await prisma.serviceOption.createMany({
    data: [
      { tenantId: tenant.id, serviceId: color.id, name: 'トリートメント追加', priceJpy: 1500, extraDurationMin: 15, sortOrder: 0 },
      { tenantId: tenant.id, serviceId: color.id, name: '前処理ケア', priceJpy: 800, extraDurationMin: 0, sortOrder: 1 },
      { tenantId: tenant.id, serviceId: spa.id, name: 'アロマオイル', priceJpy: 500, extraDurationMin: 0, sortOrder: 0 },
      { tenantId: tenant.id, serviceId: spa.id, name: '延長10分', priceJpy: 1000, extraDurationMin: 10, sortOrder: 1 },
    ],
  });

  // 担当割当
  const link = (serviceId: string, staffId: string) =>
    prisma.serviceStaff.create({ data: { serviceId, staffId } });
  await Promise.all([
    link(cut.id, staff[0]!.id), link(cut.id, staff[1]!.id), link(cut.id, staff[2]!.id),
    link(color.id, staff[0]!.id), link(color.id, staff[1]!.id),
    link(spa.id, staff[1]!.id), link(spa.id, staff[2]!.id),
  ]);

  // 容量ルール
  await prisma.bookingCapacityRule.create({
    data: {
      tenantId: tenant.id, shopId: shop.id, scope: 'SHOP', maxConcurrent: 3,
      slotIntervalMin: 30, bookingWindowDays: 30, leadTimeMinHours: 2, cancellationDeadlineHours: 24,
    },
  });
  for (const sv of [cut, color, spa]) {
    await prisma.bookingCapacityRule.create({
      data: {
        tenantId: tenant.id, shopId: shop.id, scope: 'SERVICE', serviceId: sv.id,
        maxConcurrent: sv.capacity, slotIntervalMin: sv.slotIntervalMin,
        bookingWindowDays: 30, leadTimeMinHours: 2, cancellationDeadlineHours: 24,
      },
    });
  }

  // 特別営業日デモ: 翌々週の月曜(定休)を特別営業、別の日を臨時休業
  const today = todayInZone(TZ);
  const specialOpen = nextWeekday(today, 1, 8); // 8日以降の最初の月曜
  const tempClosed = isoDateAddDays(today, 10);
  await prisma.specialBusinessDay.create({
    data: { tenantId: tenant.id, shopId: shop.id, date: dateOnly(specialOpen), type: 'SPECIAL_OPEN', openMinute: 660, closeMinute: 1020, reason: '特別営業（祝前日）' },
  });
  await prisma.specialBusinessDay.create({
    data: { tenantId: tenant.id, shopId: shop.id, date: dateOnly(tempClosed), type: 'CLOSED', reason: '研修のため臨時休業' },
  });

  // テナントユーザー（オーナー / スタッフ）
  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const owner = await prisma.user.upsert({
    where: { email: 'owner@demo.test' },
    update: { passwordHash, tenantId: tenant.id, status: 'ACTIVE' },
    create: { email: 'owner@demo.test', name: 'デモ オーナー', passwordHash, tenantId: tenant.id, status: 'ACTIVE' },
  });
  const ownerRole = await prisma.role.findFirst({ where: { code: 'TENANT_OWNER', tenantId: null } });
  if (ownerRole) {
    await prisma.membership.create({ data: { userId: owner.id, roleId: ownerRole.id } });
  }
  const staffUser = await prisma.user.upsert({
    where: { email: 'staff@demo.test' },
    update: { passwordHash, tenantId: tenant.id, status: 'ACTIVE' },
    create: { email: 'staff@demo.test', name: '田中 美咲', passwordHash, tenantId: tenant.id, status: 'ACTIVE' },
  });
  await prisma.staff.update({ where: { id: staff[0]!.id }, data: { userId: staffUser.id } });
  const staffRole = await prisma.role.findFirst({ where: { code: 'SHOP_STAFF', tenantId: null } });
  if (staffRole) {
    await prisma.membership.create({ data: { userId: staffUser.id, roleId: staffRole.id, shopId: shop.id } });
  }

  // デモ予約（直近の営業日に数件）
  await seedDemoBookings(tenant.id, shop.id, cut, staff);

  console.log(`  → 店舗: ${shop.name} (/book/${shop.slug})`);
}

/** start 以降で曜日 dow かつ minDaysAhead 日以上先の最初の日付。 */
function nextWeekday(start: string, dow: number, minDaysAhead: number): string {
  let d = isoDateAddDays(start, minDaysAhead);
  for (let i = 0; i < 14; i++) {
    if (isoDateDayOfWeek(d) === dow) return d;
    d = isoDateAddDays(d, 1);
  }
  return d;
}

async function seedDemoBookings(
  tenantId: string,
  shopId: string,
  cut: { id: string; priceJpy: number; durationMin: number; bufferAfterMin: number },
  staff: { id: string }[],
) {
  const today = todayInZone(TZ);
  // 直近で月曜(定休)でない営業日を選ぶ
  let day = isoDateAddDays(today, 2);
  for (let i = 0; i < 7 && isoDateDayOfWeek(day) === 1; i++) day = isoDateAddDays(day, 1);

  const slots = [
    { minute: 660, staffIdx: 0 }, // 11:00 田中
    { minute: 780, staffIdx: 1 }, // 13:00 鈴木
  ];
  for (let i = 0; i < slots.length; i++) {
    const startAt = zonedDateMinutesToUtc(day, slots[i]!.minute, TZ);
    const serviceEndAt = new Date(startAt.getTime() + cut.durationMin * 60_000);
    const endAt = new Date(serviceEndAt.getTime() + cut.bufferAfterMin * 60_000);
    const customer = await prisma.customer.create({
      data: { tenantId, shopId, name: `デモ顧客${i + 1}`, email: `demo-customer${i + 1}@example.com`, phone: '090-0000-000' + i },
    });
    await prisma.booking.create({
      data: {
        tenantId, shopId, customerId: customer.id, serviceId: cut.id, staffId: staff[slots[i]!.staffIdx]!.id,
        status: 'CONFIRMED', source: 'ADMIN', startAt, endAt, partySize: 1, totalPriceJpy: cut.priceJpy,
        customerName: customer.name, customerEmail: customer.email, customerPhone: customer.phone,
        confirmedAt: new Date(),
        items: {
          create: {
            tenantId, shopId, serviceId: cut.id, staffId: staff[slots[i]!.staffIdx]!.id,
            startAt, endAt, serviceEndAt, bufferAfterMin: cut.bufferAfterMin, priceJpy: cut.priceJpy, active: true, sortOrder: 0,
          },
        },
        events: { create: { tenantId, type: 'CREATED', toStatus: 'CONFIRMED', actorType: 'SYSTEM', payload: { seed: true } } },
      },
    });
  }
}

async function main() {
  console.log(`🌱 seeding... (SEED_DEMO=${SEED_DEMO})`);
  await seedPermissionsAndRoles();
  await seedPlans();
  await seedHolidays();
  await seedPlatformAdmin();
  if (SEED_DEMO) {
    await seedDemoTenant();
  } else {
    console.log('· SEED_DEMO=false のためデモ商家はスキップ');
  }
  console.log('✅ seed 完了');
  console.log(`   プラットフォーム管理者: ${PLATFORM_ADMIN_EMAIL} / ${process.env.PLATFORM_ADMIN_PASSWORD ? '(環境変数で設定)' : DEMO_PASSWORD}`);
  if (SEED_DEMO) {
    console.log('   商家オーナー:          owner@demo.test / ' + DEMO_PASSWORD);
    console.log('   店舗スタッフ:          staff@demo.test / ' + DEMO_PASSWORD);
  }
}

main()
  .catch((e) => {
    console.error('❌ seed 失敗:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
