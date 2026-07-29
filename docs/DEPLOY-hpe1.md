# hpe1 本番デプロイ手順（yoyaku.arcs-ai.com）

稼働構成: **DNS(お名前.com) → 218.225.210.160 → Kong Enterprise(80/443, ACME自動証明書) → 127.0.0.1:3200 → Docker Compose スタック**

- サーバー: hpe1（Tailscale `100.78.187.97` / LAN `192.168.0.213`、ユーザー `ty002`）
- 配置場所: `/home/ty002/booking-saas/`
- 秘密情報: `/home/ty002/booking-saas/.env.production`（chmod 600、リポジトリ外）
- コンテナ: `app`(Next standalone, 127.0.0.1:3200) / `worker`(BullMQ) / `postgres:16` / `redis:7`（PG/Redis はホスト非公開）

## 更新デプロイ（コード変更時）

```bash
# 1) Mac から同期
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude .env --exclude '.env.*' \
  --exclude test-results --exclude playwright-report --exclude coverage \
  -e "ssh -i ~/.ssh/mykey" ./ ty002@100.78.187.97:/home/ty002/booking-saas/

# 2) サーバーで再ビルド + 入替
ssh -i ~/.ssh/mykey ty002@100.78.187.97
cd ~/booking-saas
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# 3) スキーマ変更がある場合のみ
docker compose -f docker-compose.prod.yml --env-file .env.production \
  run --rm worker npx prisma migrate deploy
```

## 運用コマンド

```bash
cd ~/booking-saas
# 状態 / ログ
docker compose -f docker-compose.prod.yml --env-file .env.production ps
docker logs -f booking-saas-app-1
docker logs -f booking-saas-worker-1
# ヘルスチェック
curl -s http://127.0.0.1:3200/api/health
# DB バックアップ
docker exec booking-saas-postgres-1 pg_dump -U booking booking_saas | gzip > ~/backup/booking_$(date +%F).sql.gz
```

## Kong（設定済み・参考）

Kong は**ホスト側に常駐し他プロジェクトも捌いている**。変更は必ず booking-saas の
service / route にスコープすること（全体適用は他サイトを巻き込む）。Admin API: `localhost:8001`

- service `booking-saas` → `http://127.0.0.1:3200`
- route `booking-saas` hosts=`yoyaku.arcs-ai.com`（パス指定なし＝全体受け）
- route `booking-saas-public` hosts=`yoyaku.arcs-ai.com` paths=`/api/public` **strip_path=false**
  - ⚠️ `strip_path` を true にすると `/api/public` が剥がれて上流に届き、公開APIが全滅する
- ACME plugin (`8ccbe896-…`) の `config.domains` に `yoyaku.arcs-ai.com` 追加済み。
  証明書は自動更新（Let's Encrypt）。手動再発行: `curl -X POST localhost:8001/acme -d host=yoyaku.arcs-ai.com`

### レート制限（スクレイパーで全テナントが落ちるのを防ぐ）

アプリ側にレート制限は無く、公開エンドポイントは誰でも叩ける。Node は単一プロセスのため
1台のスクレイパーが event loop を飽和させると**全店舗が同時に落ちる**。Kong 層で IP 単位に制限する。

| route | minute | hour | 対象 |
|---|---|---|---|
| `booking-saas-public` | 300 | 6,000 | `/api/public/*`（空き状況など高コスト） |
| `booking-saas` | 1,200 | 30,000 | それ以外の全体（人間は到達しない兜底） |

`policy=local`（ワーカーごとのカウンタ）・`limit_by=ip`・`fault_tolerant=true`。
公開APIを 300/min にしているのは、日本のモバイルキャリアが CGNAT で
複数の顧客が同一IPになりうるため（厳しすぎると実顧客を弾く）。

確認: `curl -D - -o /dev/null https://yoyaku.arcs-ai.com/api/public/shops/demo-salon | grep -i ratelimit`

**取り消し（元に戻す）**:
```bash
# プラグインだけ外す
for r in booking-saas-public booking-saas; do
  id=$(curl -s localhost:8001/routes/$r/plugins | python3 -c "import json,sys;d=json.load(sys.stdin)['data'];print(next((p['id'] for p in d if p['name']=='rate-limiting'),''))")
  [ -n "$id" ] && curl -s -X DELETE localhost:8001/plugins/$id
done
# 公開API用ルートごと削除（元の単一ルート構成に戻す）
curl -s -X DELETE localhost:8001/routes/booking-saas-public
```

## アカウント

- プラットフォーム管理者: `admin@toyousoft.co.jp`（パスワードは `.env.production` の `PLATFORM_ADMIN_PASSWORD`）
- デモ商家（`owner@demo.test` / `staff@demo.test`、password123）は検収用。
  **正式運用開始時にプラットフォーム管理画面から停止するか、デモ商家ごと削除すること。**

## 本番シードのやり直し（必要時）

```bash
# デモ商家なしで基礎データのみ
docker compose -f docker-compose.prod.yml --env-file .env.production \
  run --rm -e SEED_DEMO=false worker npx tsx prisma/seed.ts
```
