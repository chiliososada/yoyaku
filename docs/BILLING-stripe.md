# Stripe サブスクリプション課金 — 運用手順

コードは **休眠デプロイ済み**（`STRIPE_SECRET_KEY` 未設定の間は完全に無効・誰もロックされない）。
以下の一次設定で有効化される。

## 仕組み（概要）

- 新規テナントは作成時に **30 日無料トライアル**（`trialEndsAt`）。
- 期限内に `/admin/billing` からプラン申込（Stripe Checkout）→ 以後自動更新。
- トライアル切れ & 未契約 → 商家後台は `/admin/billing` へリダイレクト（**公開予約ページは稼働継続**）。
- `past_due`（支払失敗・督促中）は警告付きで利用継続可。`canceled` でロック。
- 既存テナント（東陽salon・デモ）は migration で **課金免除** 済み。免除の切替はプラットフォーム後台 → 商家詳細 → 課金パネル。

## 一次設定（運営・約15分）

1. **Stripe アカウント**（本番モード有効化済みであること）
2. ダッシュボード → 商品カタログ → **商品を作成**
   - 例: 「スタンダードプラン」/ 継続 / 月次 / ¥5,000（税込み設定は Stripe Tax 併用可）
   - 作成後、価格の **Price ID**（`price_...`）をコピー
3. 本システムのプラットフォーム後台 → **プラン** → 対象プランを編集 → **Stripe Price ID** に貼り付け → 更新
   （Price ID を設定したプランだけが商家の申込画面に並ぶ）
4. ダッシュボード → 開発者 → **Webhook** → エンドポイント追加
   - URL: `https://yoyaku.arcs-ai.com/api/stripe/webhook`
   - イベント: `checkout.session.completed` / `customer.subscription.created` / `customer.subscription.updated` / `customer.subscription.deleted` / `invoice.payment_failed`
   - 作成後の **署名シークレット**（`whsec_...`）をコピー
5. ダッシュボード → 開発者 → APIキー → **シークレットキー**（`sk_live_...`）をコピー
6. hpe1 の `/home/ty002/booking-saas/.env.production` に追記（運営が手動で）:
   ```
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```
7. コンテナ再起動（ビルド不要・実行時読込）:
   ```bash
   cd ~/booking-saas
   docker compose -f docker-compose.prod.yml --env-file .env.production up -d --force-recreate app worker
   ```
8. 動作確認:
   - Webhook 画面から「テストイベント送信」→ 200
   - テスト商家（プラットフォームから新規作成）でログイン → `/admin/billing` にプランが並ぶ → テストカード `4242 4242 4242 4242` で申込 → 契約中表示・`tenants.stripeSubscriptionStatus=active`

## 日常運用

- **請求・入金・解約の実務はすべて Stripe ダッシュボード**（返金・クーポン・請求書 PDF も）。
- 商家側は `/admin/billing` の「お支払い方法・解約の管理」→ Stripe Billing Portal。
  ※ Portal は Stripe 側の設定（設定 → Billing → カスタマーポータル）を一度「保存」して有効化しておくこと。
- 特約商家（手動請求・無償）はプラットフォーム後台で **課金免除** を ON。

## トラブルシュート

- 申込後も「トライアル」のまま → Webhook 未達。Stripe の Webhook ログ（開発者 → Webhook → 対象 → ログ）で配信結果を確認。署名エラーなら `STRIPE_WEBHOOK_SECRET` を再確認。
- 誤ロックの緊急解除 → プラットフォーム後台で該当商家を課金免除 ON（即時反映）。
