/**
 * LINE Messaging API Webhook（公開・署名検証あり）。
 * - message(text): 連携コードを受け取り、送信者の userId を店舗の通知先(LINE)に登録し返信。
 * - follow: 友だち追加時の案内。
 * - unfollow: ブロック時、その userId の LINE 通知先を無効化。
 * 常に 200 を返す（署名不正のみ 401）。middleware は /admin,/platform のみ対象なので本経路は素通り。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { logger } from '@/lib/logger';
import { verifyLineSignature, replyLineMessage } from '@/server/notifications/line';
import { consumeLineLinkCode, deactivateLineUser } from '@/server/services/notification-recipient-service';

export const dynamic = 'force-dynamic';

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type?: string; text?: string };
}

const CODE_RE = /^[A-Za-z0-9]{4,10}$/;

async function handleEvent(ev: LineEvent): Promise<void> {
  const userId = ev.source?.userId;

  if (ev.type === 'follow' && ev.replyToken) {
    await replyLineMessage(
      ev.replyToken,
      '友だち追加ありがとうございます。\n管理画面で発行された「連携コード」をこのトークに送信すると、新しい予約の通知が届くようになります。',
    );
    return;
  }

  if (ev.type === 'unfollow' && userId) {
    await deactivateLineUser(userId);
    return;
  }

  if (ev.type === 'message' && ev.message?.type === 'text' && userId) {
    const text = (ev.message.text ?? '').trim();
    if (!CODE_RE.test(text)) {
      // コードらしくないメッセージには最小限の案内のみ
      if (ev.replyToken) {
        await replyLineMessage(ev.replyToken, '管理画面で発行された連携コードを送信してください。');
      }
      return;
    }
    const result = await consumeLineLinkCode(text, userId);
    if (ev.replyToken) {
      await replyLineMessage(
        ev.replyToken,
        result
          ? '連携が完了しました！\nこれから新規予約・変更・キャンセルをLINEでお知らせします。'
          : 'コードが確認できませんでした。期限切れか、すでに使用済みの可能性があります。管理画面で新しいコードを発行してください。',
      );
    }
    return;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const raw = await req.text();
  const signature = req.headers.get('x-line-signature');
  if (!verifyLineSignature(raw, signature)) {
    return new NextResponse('invalid signature', { status: 401 });
  }

  let events: LineEvent[] = [];
  try {
    events = (JSON.parse(raw)?.events as LineEvent[]) ?? [];
  } catch {
    return NextResponse.json({ ok: true });
  }

  for (const ev of events) {
    try {
      await handleEvent(ev);
    } catch (e) {
      logger.error({ err: e instanceof Error ? e.message : String(e), type: ev.type }, '[line webhook] event error');
    }
  }
  return NextResponse.json({ ok: true });
}
