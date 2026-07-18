-- Webhook の順序逆転/再送で課金状態を巻き戻さないための番兵と、契約履歴 upsert の一意キー。
ALTER TABLE "tenants" ADD COLUMN "lastStripeEventAt" TIMESTAMPTZ(6);
-- PostgreSQL のユニーク制約は NULL を複数許容するため、既存の externalRef NULL 行はそのまま有効。
CREATE UNIQUE INDEX "subscriptions_externalRef_key" ON "subscriptions"("externalRef");
