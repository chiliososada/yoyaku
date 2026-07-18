-- ============================================================================
-- 防超卖（オーバーブッキング防止）: DBレベルの多層防御
--
-- アプリ層(サービス層)の防御:
--   1) pg_advisory_xact_lock((リソース,スロット)) で同一枠への同時挿入を直列化
--   2) 同一トランザクション内で容量を再カウント（権威チェック）
--   3) idempotencyKey UNIQUE で二重送信を排除（schema 側で定義済み）
--
-- ここで追加する DB層の最終防御線（アプリにバグがあっても破られない保証）:
--   A) スタッフの時間重複を GiST 排他制約で禁止（capacity=1 の二重予約を物理的に不可能化）
--   B) bookings.status 変更時に booking_items.active を自動同期するトリガ
--      （キャンセル/No-Show で占有を解放し、排他制約の対象から外す）
--
-- 注: 店舗/サービス単位の capacity > 1 は排他制約では表現できないため、
--     上記アプリ層の advisory lock + 容量再カウントで担保する（並行テストで検証）。
-- ============================================================================

-- (A) スタッフ二重予約の物理的禁止。
-- active = true かつ staffId 非NULL の booking_items について、
-- 同一スタッフで時間範囲 [startAt, endAt) が重複する行の共存を許さない。
ALTER TABLE "booking_items"
  ADD CONSTRAINT "booking_items_no_staff_overlap"
  EXCLUDE USING gist (
    "staffId" WITH =,
    tstzrange("startAt", "endAt", '[)') WITH &&
  )
  WHERE ("active" = true AND "staffId" IS NOT NULL);

-- (B) booking_items.active を bookings.status に同期するトリガ。
-- サービス層も明示的に active を更新するが、直接の status 更新や将来の経路にも備えた backstop。
CREATE OR REPLACE FUNCTION sync_booking_item_active()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.status IN ('CANCELLED', 'NO_SHOW')) THEN
    UPDATE "booking_items"
      SET "active" = false
      WHERE "bookingId" = NEW.id AND "active" = true;
  ELSE
    UPDATE "booking_items"
      SET "active" = true
      WHERE "bookingId" = NEW.id AND "active" = false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_sync_booking_item_active"
  AFTER UPDATE OF "status" ON "bookings"
  FOR EACH ROW
  WHEN (OLD."status" IS DISTINCT FROM NEW."status")
  EXECUTE FUNCTION sync_booking_item_active();

-- 補助インデックス: active な占有のみを高速に集計するための部分インデックス。
-- availability / 容量再カウントのホットパスを支える。
CREATE INDEX "booking_items_active_shop_time_idx"
  ON "booking_items" ("shopId", "startAt", "endAt")
  WHERE ("active" = true);
