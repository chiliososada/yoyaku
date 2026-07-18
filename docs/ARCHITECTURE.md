# アーキテクチャ解説

本書は実装の「難しい部分」— 防超卖（オーバーブッキング防止）、時刻、マルチテナント隔離、予約エンジン — を設計判断とともに解説する。運用・起動手順は [README](../README.md) を参照。

## 1. レイヤー構成

責務を一方向に依存させ、コア予約ロジックをフロント・入口から分離する。

```
app/ (src/app)                ページ。表示と入力収集のみ。
  │
入口層 (route handlers / server actions)
  │   認証・権限チェック・Zod 検証だけを行う。業務ロジックを持たない。
  │   例: src/app/api/public/.../route.ts, src/server/actions/*
  ▼
サービス層 (src/server/services)
  │   業務ロジック・トランザクション境界・防超卖制御。
  │   例: booking-service.ts (createBooking/cancelBooking), *-mutation-service.ts
  ▼
リポジトリ層 (src/server/repositories)
  │   DB アクセス。必ず tenantId / shopId でスコープ。DbClient(tx) を受け取る。
  ▼
ドメイン層 (src/domain/booking)
      予約ルールの純粋関数。DB/Prisma に非依存 → 単体テストが容易。
```

**重要な原則**
- 残数判定はサーバー（DB）で行う。フロントの `remaining` は表示専用で、作成時に必ず再判定する。
- 入口層は薄く。すべての入力は Zod、すべての管理 API は `requirePermission`。
- ドメイン層は「データを渡されて計算するだけ」。副作用なし。

## 2. 防超卖（最重要）

「2人が最後の1枠を同時に取る」を**多層防御**で防ぐ。すべて `createBooking` の単一トランザクション内（`src/server/services/booking-service.ts`）。

### 2.1 防御層

| # | 仕組み | 実装 | 守る対象 |
|---|--------|------|----------|
| 1 | **Advisory トランザクションロック** | `pg_advisory_xact_lock(hashtextextended('booking:{shopId}:{暦日}', 0))` | 同一店舗・同一日への並行作成を直列化 |
| 2 | **容量の再判定（権威チェック）** | ロック確立後に `booking_items` を読み直し、ドメインエンジンで店舗/サービス/スタッフ容量を再計算 | 容量 > 1 の超過（店舗・サービス枠） |
| 3 | **GiST 排他制約** | `EXCLUDE USING gist (staffId WITH =, tstzrange(startAt,endAt) WITH &&) WHERE active` | スタッフの二重予約（容量=1）を物理的に不可能化 |
| 4 | **一意制約** | `bookings.idempotencyKey UNIQUE` | 二重送信（同一リクエストの再試行） |

### 2.2 なぜこのロック粒度か

ロックキーは **(店舗, 暦日)**。理由:

- **正確性**: 容量は「ある瞬間の同時予約数」。長さの異なる予約が重なる場合、スロット単位のロックでは取りこぼす（例: 9:00-10:00 と 9:30-10:30 は別スロットだが競合する）。同一日を直列化すれば、容量再カウントが常に最新の占有を見る。
- **並行性**: 別の店舗・別の日は互いにブロックしない。1店舗の1日あたりの予約頻度は高くないため、直列化のコストは実用上問題ない。
- 物理行ロックではなく advisory ロックを使うのは、ロック対象の「行」が存在しない（これから作る予約の枠）ため。トランザクション終了で自動解放され、デッドロックの管理が容易。

`hashtextextended` のハッシュ衝突は、無関係な2予約が稀に直列化されるだけで**正確性には影響しない**（安全側）。

### 2.3 容量計算（ピーク並行数）

`src/domain/booking/capacity.ts` は半開区間 `[start, end)` のピーク重複数を区間端のスイープで算出する。半開区間では重複の極大が必ずいずれかの区間開始点で生じるため、候補点のみ評価すればよい。`remaining = capacity - peakOverlap`。

容量は3スコープで判定し、`remaining = min(店舗残, サービス残, スタッフ供給残)`:
- **店舗**: 当日の全占有に対するピーク
- **サービス**: 当該サービスの占有のみ
- **スタッフ**: 指名時はそのスタッフの空き、おまかせ時は「稼働中かつ空き」のスタッフ数

### 2.4 占有モデル（BookingItem）

予約の占有は `Booking`（ヘッダ）ではなく `BookingItem`（占有区間）で表す。1サービスが複数時間帯を占有するケース（例: カラーの塗布→放置→仕上げ。放置中は席のみ）に対応するため、`Service.segments`（`[{offsetMin,durationMin}]`）から複数の `BookingItem` を生成する。容量/排他判定はこの粒度で行う。

`BookingItem.active` 列が排他制約・容量集計の対象を制御する。キャンセル/No-Show で `false` になり占有が解放される。アプリ層が明示更新するほか、`bookings.status` 変更トリガ（`trg_sync_booking_item_active`）が backstop として同期する。

### 2.5 テストによる保証

- アプリ層（1+2）: `tests/integration/booking-concurrency.test.ts` — 8人/20人が同時に最後の枠を奪い合い、成功数が容量と厳密一致、DB オーバーブッキングゼロ。
- DB層（3）: 同テストで、アプリ層を迂回した重複スタッフ占有の直接挿入が `23P01`(exclusion_violation) で拒否されることを検証。

## 3. 時刻の扱い

- **保存・計算はすべて UTC**（`timestamptz`）。表示時のみ `Asia/Tokyo` へ変換（`date-fns-tz`）。
- **営業時間・シフトは「店舗ローカルの 0:00 からの分」(0–1440) を整数で保持**。日付ごとに UTC instant へ変換する（`zonedDateMinutesToUtc`）。タイムゾーン跨ぎや将来の多国対応で破綻しないため。
- 暦日（祝日・特別営業日）は `@db.Date`。
- 変換ロジックは `src/lib/time.ts` に集約し、`tests/unit/time.test.ts` で 9:00 JST = 00:00 UTC 等を検証。

## 4. マルチテナント・データ隔離

- ほぼ全テーブルに `tenantId`。リポジトリ層のクエリは必ず `tenantId`（書込系は所有権も）でスコープ。
- セッションに `tenantId / isPlatformAdmin / permissions[] / shopScopes[] / tenantWide` を載せ（`src/server/auth`）、`requirePermission` / `assertShopAccess` で入口を守る。
- `tests/integration/rbac-actions.test.ts` が「権限なし→FORBIDDEN」「別テナント→拒否」を検証。
- 追加の防御としては DB の RLS（Row-Level Security）も適用可能（将来）。

## 5. 予約エンジン（ドメイン層）

`src/domain/booking/` は純粋関数のみ:
- `business-hours.ts`: 営業時間 + 祝日 + 臨時休業 + 特別営業日 から、その日の有効営業区間を解決。
- `schedules.ts`: スタッフシフト（曜日 RECURRING + 特定日 OVERRIDE）から稼働区間を解決。
- `occupancy.ts`: サービス + buffer から占有区間を計算（複数セグメント対応）。
- `rules.ts`: 受付期間・締切・キャンセル期限・容量の統合。
- `availability.ts`: 上記を束ねてスロットの available/remaining/reason を算出（満席・休業・締切超過も明示）。

サービス層が DB から材料を集めてこれらに渡す。DB を持たないので高速かつテストが容易（`tests/unit/*`）。

## 6. 非同期処理（通知）

**Transactional Outbox**: `createBooking` 等が同一トランザクションで `notification_jobs`(PENDING) を作る → 確実に記録される。`src/server/queue/worker.ts`（BullMQ Worker）が、キュー投入分の即時処理に加えて outbox を定期スイープし、`scheduledAt <= now` のものを送信する。リマインドは開始24h前の `scheduledAt` で投入され、キャンセル時に無効化される。

メール（SMTP/nodemailer）は実装済み（`SMTP_HOST` 未設定ならログのみ）。LINE/SMS は同じ dispatch 差込口に追加するだけ。

## 7. 拡張ポイント（予約枠）

| 機能 | 差込口 |
|------|--------|
| エラー監視 (Sentry) | `src/lib/monitoring.ts`（DSN 設定 + `@sentry/nextjs` 導入で有効化） |
| 決済 (Stripe) | `Booking`/`notification_jobs` に外部参照列を用意。env も予約済み |
| LINE / SMS 通知 | `notification-service.ts` の `dispatch()` にチャネル追加 |

## 8. テスト戦略

| 種別 | 対象 | 例 |
|------|------|-----|
| 単体 | ドメイン純粋関数・時刻・メールテンプレート | `tests/unit/*` |
| 統合(並行) | 防超卖（アプリ+DB） | `booking-concurrency.test.ts` |
| 統合(ライフサイクル) | 作成→満席→状態遷移→キャンセル→解放、リマインド | `booking-lifecycle.test.ts` |
| 統合(入口) | route handler の Zod/エラー応答 | `public-api.test.ts` |
| 統合(RBAC) | action の権限拒否 | `rbac-actions.test.ts` |
| 統合(書込) | 商家/プラットフォームの CRUD・隔離 | `*-mutation.test.ts` |
| E2E | 公開予約フロー / 管理代理予約フロー | `tests/e2e/*` |
