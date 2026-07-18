# 予約システム SaaS（booking-saas）

日本市場向け・商用運用を想定した**工業級マルチテナント予約システム SaaS**。
複数の商家（テナント）が、それぞれ独立した店舗・スタッフ・サービス・予約ルールを持ち、
高並行下でもオーバーブッキングしない予約エンジンを備える。

> ⚠️ 開発進行中。完了済み: 基盤 / DBスキーマ / 予約エンジン / **並行防超卖（オーバーブッキング防止）** / テスト。
> 進行中: 認証・入口層・管理画面・公開予約UI・E2E。最新状況は [`PROGRESS.md`](./PROGRESS.md)。

---

## 目次

- [主な特徴](#主な特徴)
- [技術スタック](#技術スタック)
- [アーキテクチャ](#アーキテクチャ)
- [防超卖（オーバーブッキング防止）戦略](#防超卖オーバーブッキング防止戦略)
- [ディレクトリ構成](#ディレクトリ構成)
- [セットアップ（ローカル起動）](#セットアップローカル起動)
- [環境変数](#環境変数)
- [データベース初期化](#データベース初期化)
- [スクリプト一覧](#スクリプト一覧)
- [テスト](#テスト)
- [デプロイ](#デプロイ)

---

## 主な特徴

- **マルチテナント**: 1プラットフォームで複数商家。全データを `tenantId` でスコープし隔離。
- **3階層の権限**: プラットフォーム管理者 / テナント（商家）管理者・店長 / スタッフ（RBAC）。
- **予約エンジン（Booking Engine）**: 営業時間・祝日・臨時休業・特別営業日・スタッフシフト・
  サービス時間・バッファ・複数時間帯占有・各種容量・受付期間/締切を統合してスロットを算出。
- **防超卖**: PostgreSQL の advisory lock + トランザクション内容量再判定 + GiST 排他制約 +
  一意制約による多層防御。並行テストで「最後の1枠の奪い合い」でも超過しないことを保証。
- **時刻はすべて UTC で保存**し、表示時に `Asia/Tokyo` へ変換（`date-fns-tz`）。
- **監査ログ / 操作ログ / ソフトデリート / エラー監視（Sentry 予約）**。
- **通知**: メール（SMTP / nodemailer、`SMTP_HOST` 設定で有効化）を実装。LINE / SMS は差込口を用意（予約枠）。
- **将来拡張の予約枠**: 決済（Stripe / 日本の決済）、LINE / SMS 通知。

## 技術スタック

| 領域 | 採用 |
| --- | --- |
| フレームワーク | Next.js 14（App Router） / TypeScript |
| DB | PostgreSQL 16 + Prisma 5 |
| キャッシュ/キュー | Redis 7 + BullMQ |
| 認証 | Auth.js (NextAuth v5) |
| 検証 | Zod / React Hook Form |
| UI | Tailwind CSS / shadcn/ui |
| 日時 | date-fns / date-fns-tz |
| テスト | Vitest（単体/統合）/ Playwright（E2E） |
| 品質 | ESLint / Prettier |
| 監視 | Sentry（予約） |
| インフラ | Docker Compose |

## アーキテクチャ

> 設計判断・防超卖の詳細は **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** を参照。

責務を明確に分離した階層構造:

```
app 層 (src/app)            … ページのみ。表示と入力収集。
  ↓
入口層 (server actions / route handlers)
                            … 認証・権限チェック・Zod 検証のみ。業務ロジックを持たない。
  ↓
サービス層 (src/server/services)
                            … 業務ロジック・トランザクション境界・防超卖制御。
  ↓
リポジトリ層 (src/server/repositories)
                            … DB アクセス。必ず tenantId / shopId でスコープ。
  ↓
ドメイン層 (src/domain)     … 予約ルールの純粋ロジック（DB非依存・単体テスト容易）。
```

**原則**:

- コア予約ロジックはフロントに置かない。残数判定もサーバー（DB）で行う。
- すべての入力は Zod で検証、すべての API で権限チェック。
- ドメイン層は純粋関数。サービス層が DB から取得したデータを渡して計算する。

## 防超卖（オーバーブッキング防止）戦略

予約作成 `createBooking` は**単一トランザクション**で以下を行う（多層防御）:

1. **Advisory ロック**: `pg_advisory_xact_lock(hash(shopId:暦日))` で
   同一店舗・同一日への並行予約を直列化。トランザクション終了で自動解放。
2. **容量再判定（権威チェック）**: ロック確立後に占有（`booking_items`）を読み直し、
   ドメインエンジンで店舗 / サービス / スタッフ各容量の残数を再計算。0 なら満席エラー。
3. **GiST 排他制約（DB最終防御）**: `booking_items` に
   `EXCLUDE USING gist (staffId WITH =, tstzrange(startAt,endAt) WITH &&) WHERE active`。
   スタッフの時間重複を**物理的に**不可能化（capacity=1 の二重予約を阻止）。
4. **一意制約**: `idempotencyKey` UNIQUE で二重送信を排除。

容量 > 1（店舗/サービス）の超過は 1+2 が担保し、容量 = 1（スタッフ）の二重予約は 3 が担保する。
→ `tests/integration/booking-concurrency.test.ts` で「8人が最後の1枠を同時取得 → 成功1件」
「店舗容量3で10件同時 → 成功3件」を検証済み。

## ディレクトリ構成

```
booking-saas/
├─ docker-compose.yml         # PostgreSQL + Redis
├─ prisma/
│  ├─ schema.prisma           # 全テーブル定義
│  ├─ migrations/             # init / 防超卖制約 / segments
│  └─ seed.ts                 # デモデータ投入（予定）
├─ src/
│  ├─ app/                    # Next.js ページ（予定）
│  ├─ domain/booking/         # 予約エンジン（純粋ロジック）★テスト済み
│  │  ├─ occupancy.ts         #   占有区間（複数時間帯・バッファ）
│  │  ├─ business-hours.ts    #   営業/休業/特別営業の解決
│  │  ├─ schedules.ts         #   スタッフシフト解決
│  │  ├─ rules.ts             #   受付期間/締切/キャンセル期限/容量統合
│  │  ├─ capacity.ts          #   ピーク並行数による残容量計算
│  │  └─ availability.ts      #   スロット可用性（エンジン本体）
│  ├─ server/
│  │  ├─ services/            # 業務ロジック（booking-service ★防超卖）
│  │  └─ repositories/        # DB アクセス（tenant scoped）
│  └─ lib/                    # env/db/redis/queue/time/errors/logger/rbac/monitoring
└─ tests/
   ├─ unit/                   # ドメイン単体テスト
   ├─ integration/            # 並行予約テスト（実DB）
   └─ e2e/                    # Playwright（予定）
```

## セットアップ（ローカル起動）

### 前提

- Node.js 18.18+（推奨 20 系）
- Docker / Docker Compose

### 手順

```bash
# 1) 依存インストール
npm install

# 2) 環境変数（サンプルをコピー）
cp .env.example .env
#   AUTH_SECRET は `openssl rand -base64 32` で生成して設定

# 3) インフラ起動（PostgreSQL + Redis）
docker compose up -d

# 4) DB マイグレーション適用 + デモデータ投入
npm run prisma:deploy
npm run db:seed          # ※ seed は実装予定

# 5) 開発サーバー起動
npm run dev              # http://localhost:3000
```

## デモ動線（seed 投入後）

| 画面 | URL | アカウント |
| --- | --- | --- |
| 公開予約（顧客） | `/book/demo-salon` | 不要 |
| 予約確認・キャンセル | `/booking/{token}`（予約完了画面のリンク） | 不要 |
| 商家後台 | `/admin` | `owner@demo.test` / `password123` |
| 〃 スタッフ | `/admin` | `staff@demo.test` / `password123` |
| プラットフォーム後台 | `/platform` | `admin@platform.test` / `password123` |

おすすめの確認手順:

1. `/book/demo-salon` でメニュー→日時→情報→確認→完了まで予約してみる（満席・休業日・締切の表示も確認）。
2. 完了画面の「予約を確認・キャンセル」からキャンセル（枠が解放される）。
3. `/admin` にオーナーでログイン → ダッシュボードの統計、予約一覧、状態変更、代理予約、各種設定編集を確認。
4. `/platform` に管理者でログイン → 商家作成、プラン編集、ユーザー停止、監査ログを確認。
5. 並行防超卖の確認: `npm run test:concurrency`。

## 環境変数

`.env.example` を参照。主なもの:

| 変数 | 説明 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 接続文字列 |
| `DIRECT_URL` | マイグレーション用（任意） |
| `REDIS_URL` / `REDIS_HOST` / `REDIS_PORT` | Redis 接続 |
| `AUTH_SECRET` | Auth.js のセッション署名鍵（本番必須） |
| `APP_BASE_URL` | 公開URL（キャンセルリンク生成等） |
| `APP_TIMEZONE` | 表示TZ（既定 `Asia/Tokyo`） |
| `SENTRY_DSN` | エラー監視（未設定なら無効） |
| `STRIPE_*` / `LINE_*` / `SMTP_*` | 将来拡張（予約枠） |

## データベース初期化

```bash
# マイグレーション作成（スキーマ変更時）
npm run prisma:migrate

# 本番/CI へ適用
npm run prisma:deploy

# 完全リセット（開発のみ・全データ削除）
npm run prisma:reset

# Prisma Studio（GUI）
npm run prisma:studio
```

主要テーブル: `tenants, plans, subscriptions, shops, users, roles, permissions,
memberships, staff, services, business_hours, staff_schedules, holidays,
special_business_days, booking_capacity_rules, customers, bookings, booking_items,
booking_events, audit_logs, notification_jobs, system_configs`。

## スクリプト一覧

| コマンド | 説明 |
| --- | --- |
| `npm run dev` | 開発サーバー |
| `npm run build` | 本番ビルド（prisma generate 含む） |
| `npm run start` | 本番起動 |
| `npm run lint` | ESLint |
| `npm run typecheck` | 型チェック |
| `npm run test` | 全テスト（Vitest） |
| `npm run test:concurrency` | 並行予約テストのみ |
| `npm run test:e2e` | E2E（Playwright） |
| `npm run worker` | 通知ジョブワーカー（BullMQ） |
| `npm run db:seed` | デモデータ投入 |

## テスト

```bash
# 単体（ドメインエンジン、DB不要）
npm run test:unit

# 統合（実DBが必要 — 先に docker compose up -d）
npm run test:integration

# 並行防超卖の検証
npm run test:concurrency
```

現状: **88 テスト合格**（ドメイン/メール単体 53 + 並行統合 5 + ライフサイクル統合 6 + 管理書込統合 8 + プラットフォーム書込統合 4 + 公開API入口層統合 7 + RBAC境界統合 5）+ **E2E 2シナリオ ×（PC Chrome / モバイル iPhone Safari）= 4実行**（Playwright: 公開予約フロー / 管理代理予約フロー）。
並行統合には「20件が容量5を奪い合い→成功厳密5件」「GiST 排他制約が重複スタッフ予約を DB レベルで拒否」を含む。

```bash
# E2E（要ビルド + DB seed。webServer が自動で next start）
npm run build && npm run test:e2e

# 通知ワーカー（BullMQ + アウトボックス掃き出し）
npm run worker
```

## デプロイ

- **アプリ**: 同梱の `Dockerfile`（マルチステージ / Next.js standalone）でイメージ化。
  `docker build -t booking-saas .` → 任意のコンテナ基盤（Cloud Run / ECS / k8s）へ。Vercel も可。
  通知ワーカーは別コンテナで `npm run worker` を常駐。
- **DB**: マネージド PostgreSQL（RDS / Cloud SQL / Supabase 等）。`btree_gist` 拡張が必要。
- **Redis**: マネージド Redis（ElastiCache / Memorystore 等）。BullMQ ワーカーを別プロセスで常駐。
- **マイグレーション**: デプロイ時に `npm run prisma:deploy`。
- **ヘルスチェック**: `GET /api/health`（DB/Redis 疎通を確認、正常 200 / 異常 503）。k8s の readiness/liveness プローブに利用可能。
- **監視**: `SENTRY_DSN` を設定し `@sentry/nextjs` を導入（`src/lib/monitoring.ts` の TODO 参照）。

---

ライセンス: Proprietary（商用 SaaS 想定）。
