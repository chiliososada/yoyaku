/**
 * Stripe Webhook 受け口。
 * 登録イベント（推奨）: checkout.session.completed / customer.subscription.created・updated・deleted / invoice.payment_failed
 * 署名検証に失敗したら 400。処理失敗は 500（Stripe が自動リトライ）。
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { verifyStripeSignature } from '@/server/billing/stripe';
import { processStripeEvent } from '@/server/billing/billing-service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const payload = await req.text();
  const signature = req.headers.get('stripe-signature');
  if (!verifyStripeSignature(payload, signature, secret)) {
    logger.warn('[billing] webhook signature verification failed');
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  try {
    const event = JSON.parse(payload) as { type: string; data: { object: Record<string, unknown> } };
    await processStripeEvent(event);
    return NextResponse.json({ received: true });
  } catch (e) {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, '[billing] webhook processing failed');
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}
