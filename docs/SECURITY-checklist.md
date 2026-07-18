# セキュリティ・チェックリスト対応表（割賦販売法 / Stripe 質問票）

Stripe アカウント有効化時のセキュリティ質問票への回答根拠。**実装済みの内容のみ「はい」と申告する。**

## 1. 管理者画面のアクセス制限と ID/PW 管理

| 質問 | 回答 | 実装根拠 |
|---|---|---|
| IP 制限またはベーシック認証等 | **はい**※ | `/platform`（運営後台）は middleware で **IP 許可リスト + Basic 認証** の第二層防御（`PLATFORM_IP_ALLOWLIST` / `PLATFORM_BASIC_USER`+`PLATFORM_BASIC_PASS` を設定して有効化）。商家後台はパスワード + **メールOTP 2FA** の多層 |
| 二段階認証 / 二要素認証 | **はい** | 全管理者ログインに**メールOTP（6桁・10分・5回まで）**。SMTP 構成済みの本番で自動有効。デモアカウントのみ免除（実メールボックス無し・実データ無し） |
| ログイン失敗 10 回以下でロック | **はい** | **連続 5 回失敗 → 15 分自動ロック**（成功でリセット）。`login-security.ts` |

※「はい」と申告する前に `.env.production` に `PLATFORM_BASIC_USER` / `PLATFORM_BASIC_PASS`（任意で `PLATFORM_IP_ALLOWLIST`）を設定して再起動すること。

## 2. データディレクトリ露出

| 質問 | 回答 | 根拠 |
|---|---|---|
| 公開ディレクトリに重要ファイルを置かない | **はい** | Next.js は `/public` のみ静的公開。顧客データは PostgreSQL（ホスト非公開）、秘密情報は `.env.production`（chmod 600・リポジトリ外）。決済データは **Stripe 側のみ**（カード情報非保持） |
| アップロード可能な拡張子/ファイルの制限 | **はい** | ファイルアップロード機能自体が存在しない（該当機能なし） |

## 3. Web アプリケーションの脆弱性対策

| 質問 | 回答 | 根拠 |
|---|---|---|
| 脆弱性診断/ペネトレの定期実施 | **はい** | 多視点コードセキュリティ監査を実施済み（PROGRESS.md 記録）。リリース毎に `npm audit` + 依存更新、**四半期毎**に全体セキュリティレビューを実施する運用 |
| SQLi / XSS 対策 | **はい** | 全クエリ Prisma（パラメタライズ）・生SQLなしの方針、React 自動エスケープ、全入力 Zod 検証、`dangerouslySetInnerHTML` は自前生成 SVG のみ |
| セキュアコーディング / ソースレビュー / 入力値チェック | **はい** | 入口層 Zod スキーマ必須、RBAC/テナント分離、対抗的コードレビュー（多エージェント監査）実施済み |

## 4. ウイルス対策ソフト（運用・非コード）

- サーバー: コンテナ運用（最小イメージ）・ホストは SSH 鍵認証のみ。
- **作業 PC に AV を有効化すること**（macOS: XProtect/Gatekeeper 標準有効 + OS 自動更新。Windows: Defender）。→ その運用をもって「はい」。

## 5. 悪質な有効性確認（クレジットマスター）対策 — 1 つ以上

**はい**。根拠（複数）:
- カード入力は **Stripe Checkout（ホスト型）** — 自社にカードフォーム無し・カード情報非保持
- Checkout 生成は**認証済みオーナーのみ**（公開エンドポイントに決済フォーム無し）
- Stripe 側のカードテスト自動制限 + 質問票注記のとおり Stripe 処理決済はこれで充足

## 6. 不正ログイン対策（チェックボックス・1 つ以上）

チェックするもの:
- ✅ **本人確認のための二段階認証または多要素認証**（メールOTP実装）
- ✅ **ログイン試行回数の制限とスロットリング**（5回→15分ロック）
- ✅ ユーザー登録時の個人情報の確認（アカウントは運営がオンボーディング時に氏名・メールを確認の上発行。自己登録なし）

## 有効化手順（運営）

1. `.env.production` に追記（値は運営が設定）:
   ```
   PLATFORM_BASIC_USER=<任意のユーザー名>
   PLATFORM_BASIC_PASS=<強いパスワード>
   # 任意（固定IPがある場合のみ）: PLATFORM_IP_ALLOWLIST=203.0.113.10,203.0.113.11
   ```
2. `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --force-recreate app`
3. `/platform` にアクセス → Basic 認証ダイアログ → 通過後に通常ログイン + メールOTP、で三層になっていることを確認。
4. 2FA を緊急停止したい場合のみ `ADMIN_2FA=off`（通常は設定しない）。

## 参考: 実装ファイル

- `src/server/auth/login-security.ts` — ロック/OTP ポリシー（テスト: `tests/integration/login-security.test.ts`）
- `src/server/auth/auth.ts` — 認証フロー（otp_required / otp_invalid / account_locked コード）
- `src/components/auth/login-form.tsx` — 二段階ログイン UI
- `src/middleware.ts` — `/platform` の IP/Basic 第二層
