/**
 * 既存の「シフト未設定」担当スタッフに、所属店舗の営業時間から既定シフトを補填する。
 * createStaff の既定シフト自動生成より前に作成されたスタッフの救済用（冪等: 既にシフトがあるスタッフは対象外）。
 *
 *   docker compose -f docker-compose.prod.yml --env-file .env.production \
 *     run --rm worker npx tsx scripts/backfill-staff-schedules.ts
 */
import { prisma } from '../src/lib/db';

async function main() {
  const staff = await prisma.staff.findMany({
    where: { deletedAt: null, isBookable: true },
    select: { id: true, name: true, shopId: true, tenantId: true },
  });

  let fixed = 0;
  for (const s of staff) {
    const scheduleCount = await prisma.staffSchedule.count({ where: { staffId: s.id } });
    if (scheduleCount > 0) continue; // 既に設定済みはスキップ

    const hours = await prisma.businessHours.findMany({
      where: { shopId: s.shopId },
      select: { dayOfWeek: true, openMinute: true, closeMinute: true },
    });
    if (hours.length === 0) {
      console.log(`- skip ${s.name} (${s.id}): 店舗に営業時間が未設定`);
      continue;
    }
    await prisma.staffSchedule.createMany({
      data: hours.map((h) => ({
        tenantId: s.tenantId,
        shopId: s.shopId,
        staffId: s.id,
        type: 'RECURRING' as const,
        dayOfWeek: h.dayOfWeek,
        startMinute: h.openMinute,
        endMinute: h.closeMinute,
        isWorking: true,
      })),
    });
    fixed++;
    console.log(`✓ ${s.name} (${s.id}): ${hours.length} 曜日分の既定シフトを補填`);
  }
  console.log(`\n完了: ${fixed} 名を補填（対象なしは 0）。`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
