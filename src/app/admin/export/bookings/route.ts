import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser, hasPermission } from '@/server/auth/authorize';
import { getPrimaryShop, getBookingsForExport } from '@/server/services/merchant-service';
import { PERMISSIONS } from '@/lib/rbac';
import { formatInTz, todayInZone } from '@/lib/time';
import { BOOKING_STATUS_LABEL } from '@/lib/booking-display';

export const dynamic = 'force-dynamic';

const isMonth = (s: string | null): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/**
 * 1セルをCSV用にエスケープ。
 * - 数式インジェクション対策: =,+,-,@,TAB,CR で始まる値は先頭に ' を付け、表計算ソフトで数式実行されないようにする。
 * - カンマ・改行・引用符を含む値は引用符で囲む。
 */
function cell(v: string | number | null | undefined): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Excel/Sheets が数値と解釈して先頭ゼロを落とす列（電話番号・予約番号）用。
 * 09012345678 が 9012345678 になると、対帳のために出した CSV から
 * 客に電話をかけられない（しかも一見それらしい数字なので気づきにくい）。
 * 先頭に ' を付けるとテキストとして固定される（cell と同じ方式）。
 */
function textCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  if (s === '') return '';
  return cell(`'${s}`.replace(/^''/, "'"));
}

const HEADERS = [
  '予約番号', '日付', '開始', '終了', '顧客名', 'メール', '電話',
  'メニュー', '担当', '状態', '人数', '料金(円)', '指名料(円)',
];

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user?.tenantId) return new NextResponse('Unauthorized', { status: 401 });
  // 全社の予約 PII を返すため、ミドルウェアだけに頼らずサーバー側でも権限を検証（多層防御）。
  if (!hasPermission(user, PERMISSIONS.ANALYTICS_READ)) return new NextResponse('Forbidden', { status: 403 });

  const shop = await getPrimaryShop(user.tenantId);
  const tz = shop.timezone;
  const monthParam = req.nextUrl.searchParams.get('month');
  const month = isMonth(monthParam) ? monthParam : todayInZone(tz).slice(0, 7);

  const bookings = await getBookingsForExport(user.tenantId, shop.id, tz, month);

  const lines = [HEADERS.map(cell).join(',')];
  for (const b of bookings) {
    // コンボ予約はメニュー名を「A + B」で連結
    const seen = new Set<string>();
    const names: string[] = [];
    for (const it of b.items) {
      if (!seen.has(it.service.name)) {
        seen.add(it.service.name);
        names.push(it.service.name);
      }
    }
    const menu = names.length > 0 ? names.join(' + ') : b.service.name;
    lines.push(
      [
        b.id.slice(-8).toUpperCase(), // 英数字混在だが数字のみになり得るのでテキスト固定（下の map で扱う）
        formatInTz(b.startAt, 'yyyy-MM-dd', tz),
        formatInTz(b.startAt, 'HH:mm', tz),
        formatInTz(b.endAt, 'HH:mm', tz),
        b.customerName,
        b.customerEmail ?? '',
        b.customerPhone ?? '',
        menu,
        b.staff?.displayName ?? b.staff?.name ?? 'おまかせ',
        BOOKING_STATUS_LABEL[b.status] ?? b.status,
        b.partySize,
        b.totalPriceJpy,
        b.nominationFeeJpy,
      ]
        // 電話(index 6)と予約番号(index 0)はテキスト固定、それ以外は通常のエスケープ
        .map((v, i) => (i === 0 || i === 6 ? textCell(v) : cell(v)))
        .join(','),
    );
  }

  // BOM 付き（Excel が UTF-8 を正しく認識するため）
  const csv = '﻿' + lines.join('\r\n');
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bookings_${month}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
