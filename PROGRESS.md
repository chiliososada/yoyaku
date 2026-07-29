# 開発進捗トラッカー（/loop 用・反復間で参照）

> 工業級マルチテナント予約 SaaS。各反復でこのファイルを更新し、次回はここから再開する。
> 作業ディレクトリ: `/Users/toyousoft/booking-saas`

## 🎉 コア完了条件はすべて達成済み（Iteration 6 終了時点）
ローカル起動 ✓ / デモ可能 ✓ / コア予約フロー完結 ✓ / 後台で管理(予約状態の書込+監査) ✓ / 並行防超卖 ✓ /
build ✓ lint ✓ test(58) ✓ typecheck ✓ E2E ✓ README ✓

## 🚀 本番デプロイ & 後台フォーム bugfix（追記）
- **本番デプロイ（hpe1 / yoyaku.arcs-ai.com）**: Supabase 不使用・自己ホスト。Kong Enterprise 配下で `docker-compose.prod.yml`
  （app→127.0.0.1:3200 / worker / postgres16 / redis7、PG・Redis 非公開）。Dockerfile に worker ステージ追加。手順 `docs/DEPLOY-hpe1.md`。
  ACME 自動 HTTPS、公網で予約作成+取消まで疎通。Auth プロキシ対応: Kong `preserve_host=true` + `AUTH_URL`/`NEXTAUTH_URL`。
- **bugfix: 後台フォーム checkbox（RHF ref 破棄）**:
  根因 = `CheckboxRow` が forwardRef でなく `{...register()}` の ref が破棄（コンソール warning で特定）。結果 (1) 既定 true の
  `requiresStaff`/`isActive` が未チェック表示 (2) 担当スタッフ1名時に staffIds が配列化されず「1名以上選択」refine を突破不可。
  修正 = `CheckboxRow` forwardRef 化 + 複数選択(staffIds/serviceIds)は `Controller`+`CheckboxGroup`（1〜N堅牢）。
  検証 = fresh dev で DOM 実測（既定チェック同期・単一選択の配列化）/ server は integration 緑 / 97 vitest 緑 / prod 反映（checksum一致・再ビルド）。
  注: プレビュープロキシでは Next server action POST が SameSite=Lax で /login になりブラウザ永続化 E2E 再現不可（prod 同源は正常）。

## 🔎 全体バグ監査（読み取り主体）+ 修正2件
監査範囲: 予約エンジン(占有/容量/lead/window/半開区間) / 予約書込(advisory lock/再判定/GiST/冪等) /
テナント隔離(service層 tenantId スコープ) / 公開API検証 / 時区表示(prod=UTC コンテナ) / キャンセル経路。
→ コア防御は健全と確認（容量は半開区間 [start,end) で back-to-back 非重複、時刻は全て shop.timezone 経由、
  merchant-mutation は全関数 assertShopInTenant/tenantId スコープ、キャンセルは二重/期限/解放すべて正しい）。
発見・修正した実バグ2件:
- **[P2] 予約ウィザードが idempotencyKey 未送信 + submit 同期ガード無し** → 高速二度押しで予約重複の恐れ
  （`disabled={submitting}` は再描画後にしか効かない）。修正: `submittingRef` 同期ガード + `crypto.randomUUID()` の
  冪等キーを送信（リトライ再利用・成功で無効）。バックエンドの冪等(既存返却)は既存テスト済み。prod で二重POST→1件を実証。
- **[P3] isoDateSchema が実在しない暦日を通過**（2026-02-31 等 → new Date ロールオーバーで誤結果）。
  修正: UTC 構築ラウンドトリップで実在日のみ許可。prod で 2026-02-31 → 400 を実証。
- テスト +13（validation.test.ts）→ 110 vitest 全緑 / tsc / lint / 4 E2E / build 全通。prod 反映済み（checksum一致）。

## 🐛 bugfix: 新規スタッフの既定シフト未生成 → 公開しても全枠 ×
症状: 店舗を公開・メニュー/スタッフ登録済みでも予約カレンダーが全日 ×（担当不在）。
根因: `resolveStaffWorkingIntervals` は「シフト行が無い = 終日非稼働」。demo はシード時に
スタッフへ RECURRING シフトを投入していたが、**後台フォームの createStaff は既定シフトを作らない**ため
新規スタッフは永久に予約不可だった（オンボーディングの罠）。
修正:
- `createStaff` で店舗の営業時間から RECURRING 既定シフトを自動生成（オーナーは「シフト設定」で調整可）。
- `scripts/backfill-staff-schedules.ts`（冪等）で既存のシフト未設定・稼働可スタッフを救済。Dockerfile worker へ scripts 追加。
- テスト +1（createStaff→7曜日シフト自動生成＋その場で指名予約可）→ 111 vitest 全緑。
- prod 実証: liu へ6曜日シフト補填 → 月曜 33枠 ○、指名 liu で実予約成功（¥3,200=カット¥3,000+指名¥200）→ 検証予約は削除済み。

## 🧭 オンボーディングの落とし穴を根絶（開業準備チェックリスト）
「設定したのに予約できない／公開しても×／設定画面が見つからない」という同種のつまずきを根本対策。
- **ダッシュボードに開業準備チェックリスト**（`getPublishReadiness` + `PublishChecklist`）を追加。
  予約受付に必要な7条件を判定し、不足項目を該当画面リンク付きで提示。全て満たすと緑「予約受付中」+ 公開URL を表示。
  判定: 営業時間 / 公開メニュー≥1 / 予約可能スタッフ≥1 / 全スタッフにシフト（isWorking行）/ 担当必須メニューに担当割当 /
  公開(PUBLISHED) / オンライン予約ON。「担当未割当メニュー」「シフト未設定スタッフ」は名前も表示。
- スタッフ一覧に「シフト」直リンク追加（従来は 一覧→名前→編集→シフト設定 と2階層深く発見困難だった）。
- テスト +5（publish-readiness.test.ts: 全揃いready / スタッフ0 / 下書き / シフト削除 / オンライン予約OFF）→ 116 vitest 全緑。
- prod 実証: toyousoft は7条件すべて充足 → ダッシュボードに「予約受付中」表示。
- 既知の残課題（別機能・今回対象外）: オーナーへの資格情報通知 / パスワード再設定（メール基盤が必要）。

## 🔐 資格情報の可視化 + パスワード再設定
- **① 商家作成後の資格情報表示**: プラットフォームで商家作成すると、成功画面に
  ログインURL / メール / 初期パスワード / 公開予約URL を表示（オーナーへ安全に連絡）。従来は即リダイレクトで不明だった。
- **② パスワード再設定**:
  - 自助フロー: `/forgot-password`（メール入力）→ トークン発行（生値はメール/リンクのみ、DBはsha256ハッシュ、60分・使い切り）
    → `/reset-password?token=` で新パスワード設定。ログイン画面に「パスワードをお忘れですか？」導線。
    列挙防止（存在有無を返さない）。**SMTP未設定時はリセットリンクをログ出力**して運用者が手動連絡可能。
  - 管理者リセット: プラットフォーム「ユーザー管理」に「PW再発行」ボタン。新パスワードを1度だけ表示（メール不要・即時）。
- Schema: `PasswordResetToken`（migration `20260705105655_password_reset`）。
- テスト +6（password-reset.test.ts: 発行/無効化 / 使い切り / 期限切れ / 管理者リセット / 管理者は対象外）→ **122 vitest 全緑**。
- prod 反映済み（migrate deploy 適用、公開ページ /forgot-password・/reset-password は 200、ログインに導線）。
- **SMTP 設定済み（実メール配信 稼働中）**: お名前.com `mail1026.onamae.ne.jp:465(SSL)` / `noreply@arcs-ai.com`。
  app・worker 両コンテナへ設定。`SMTP verify OK` + テスト送信 `250 queued` を確認。パスワード再設定・予約通知は実メールで送信される。
  （パスワードは .env.production のみ・リポジトリ外。）
- **メール認証（DNS）設定・検証済み**: arcs-ai.com に対し
  SPF（`v=spf1 include:_spf.onamae.ne.jp ~all`・送信IP 160.251.148.0/24 を包含）/
  DKIM（`default._domainkey` 2048bit、お名前自動署名）/ DMARC（`v=DMARC1; p=none; rua=mailto:noreply@arcs-ai.com`）
  の3点を Google/Cloudflare の公開リゾルバで確認済み。DMARC は監視(p=none)から開始。
  今後: 1週間ほど問題なければ p=quarantine → p=reject へ段階的に強化推奨。

## 📊 運営機能: 売上・実績レポート（月次）
方針決定: Stripe/LINE は当面見送り（既に「予約確認+24hリマインダー」メール稼働中で現地払い運用は成立）、運営機能を優先。
- `/admin/reports`（サイドバー「レポート」）: 月切替（前月/翌月、未来月は無効）。
  サマリ: 売上（確定+来店、キャンセル除外）/ 予約数 / 客単価 / 指名率（nominationFeeJpy>0）/ 新規・リピート顧客・リピート率。
  日別売上バー / スタッフ別実績（予約・指名・売上）/ メニュー別実績（BookingItem 価格スナップショットでコンボも正確）。
- `getMonthlyReport(tenantId, shopId, tz, "YYYY-MM")` を merchant-service に追加。全て tenantId スコープ、JST 月境界で集計。
- テスト +2（集計正確性・キャンセル除外・新規/リピート判定・月ナビ）→ 124 vitest 全緑。tsc/lint/build OK。
- Preview で実データ確認済み（¥27,000=田中¥22,500+鈴木¥4,500、カット6件、客単価¥4,500 整合）。

## 🛠 運営機能 第2弾（スケジュール / カルテ / 休眠顧客）
- **① 予約スケジュール**（`/admin/schedule`、サイドバー「スケジュール」）: 日次タイムライン。
  スタッフ×時間帯のレーンに予約ブロックを時刻で配置（占有 start→end、キャンセル/無断除外）。日付前後移動・今日、未割当レーン、
  状態色（確定/来店済/仮）、ブロッククリックで予約詳細へ。営業時間+予約を内包する範囲を自動算出、横スクロール対応。
  `getDaySchedule(tenantId, shopId, tz, date)` を追加（utcToZonedDateMinutes でローカル分に変換）。
- **② 顧客カルテ強化**（顧客詳細）: 来店回数 / 累計利用額 / 初回・最終来店 / 次回予約 を追加（来店実績=確定+来店、過去分）。
  「メモ・好み」を編集可能に（`updateCustomerNote` + `updateCustomerNoteAction`(CUSTOMER_WRITE) + `CustomerNoteForm`）。
- **③ 休眠顧客**（`/admin/customers/dormant`、顧客一覧に導線）: 最終来店から N日(60/90/180)以上・今後の予約なしを抽出。
  最終来店日新しい順、来店回数・累計・連絡先を表示（再来促進用）。`getDormantCustomers(tenantId, shopId, days)`。
- テスト +6（schedule 2 / dormant 2、reports は既存）→ **128 vitest 全緑**。tsc/lint/build OK。Preview で3画面とも実データ確認。
- **テストフレーク根治**: 統合テストが単一DBを共有し `fileParallelism`(既定true) でファイル並行実行 → 別ファイルの書込が
  booking-concurrency と競合し稀に失敗していた。`vitest.config.ts` に `fileParallelism: false` を追加して完全直列化
  （`singleFork` だけでは並行しうるのが原因）。8連続フル実行で 128/128 緑を確認。

## 🛠 運営機能 第3弾（CSV / スタッフランキング / 複数店舗）
- **④ CSVエクスポート**: `/admin/export/bookings?month=YYYY-MM`（route handler、middleware で認証保護）。
  月次の予約を CSV 出力（BOM付きUTF-8=Excel対応、日付/開始/終了はJST、コンボはメニュー連結、全ステータス）。レポート画面に「CSV」ボタン。
  ※ `formatInTz(instant, fmt, tz)` の引数順を取り違えて500になっていたのを修正（Preview で200・13列・実データ確認）。
- **⑤ スタッフ実績ランキング**: レポートの「スタッフ別」を順位表化（🥇🥈🥉、指名率・客単価を追加、売上降順）。
- **⑥ 複数店舗**: `getPrimaryShop` を Cookie(`selected_shop`)対応にし、**1か所の変更で全管理画面が選択店舗に追従**
  （テスト/worker 等リクエスト外は cookies() を try/catch で先頭店舗にフォールバック）。ヘッダに店舗スイッチャー
  （`ShopSwitcher` + `selectShopAction`）、`createShop`(プラン上限・slug一意・既定営業時間/容量ルール生成)、`/admin/shops/new`、SHOP_CREATE 権限。
  Preview で Cookie 切替により全画面が別店舗に追従・新店は実績0を確認。
- テスト +4（shops 2: プラン上限/slug一意/テナント隔離・既定生成、dormant/schedule は前弾）→ **130 vitest 全緑**。tsc/lint/build OK。

## 🔎 新規コード監査（第3弾機能）+ 修正3件
前回監査(コア)以降に追加した レポート/スケジュール/カルテ/休眠/CSV/複数店舗/パスワード再設定 を精査。
テナント隔離・時区・集計は健全（複数店舗は全管理画面が getPrimaryShop 経由で選択店に追従、cookie は当テナント店のみ有効）と確認。実バグ3件を修正:
- **[P2] CSVの数式インジェクション**: 顧客名が `=`/`+`/`-`/`@` 始まりだと Excel で数式実行される恐れ → `cell()` で該当セルに先頭 `'` を付与。prod 実証（`=SUM(9+9)` → `'=SUM(9+9)`）。
- **[P2] カルテ統計が take:50 依存**: `getCustomerDetail` の来店回数/累計/初回来店が「直近50件」からの集計で、50件超の常連で過少・初回来店が誤り → 全予約を aggregate/findFirst で集計するよう修正。テスト +2。
- **[P3] 月/日パラメータの範囲未検証**: `?month=2026-13` / `?date=2026-13-45` 等が Invalid Date → Prisma で 500 → reports/CSV/schedule の正規表現を月01-12・日01-31 に厳格化。
- → 132 vitest 全緑 / tsc / lint / build OK。prod 反映済み。

## 🔁 予約変更（改期）— 後台 + 顧客自助
- **エンジン `rescheduleBooking`**（booking-service.ts）: 既存予約を新日時（+任意で担当）へ移動。createBooking の機構
  （loadComboContext / computeChainOccupancy / computeAvailability / findAvailableStaff / advisory lock）を全面再利用。
  明細から serviceItems を復元 → ロック内で **旧明細を削除して占有解放 → 新枠を再判定 → 新明細を挿入** を原子的に実行
  （失敗はロールバックで復元）。RESCHEDULED イベント + BOOKING_RESCHEDULED 通知 + リマインド貼り直し。料金/指名料は据え置き。
  `loadOccupiedOverlapping`/`getDayAvailability` に `excludeBookingId` を追加し、プレビューで自身の占有を除外。
- **後台**: 予約詳細に「日時変更（改期）」パネル（`RescheduleForm`: 日付+担当+空き枠グリッド）。
  `rescheduleAvailabilityAction` / `rescheduleBookingAction`（BOOKING_UPDATE 権限 + 監査）。
- **顧客自助**: `/booking/[token]` に「日時を変更する」。公開API `GET/POST /api/public/bookings/[token]/{availability,reschedule}`
  （token で解決、担当維持、変更期限=キャンセル期限を強制）。`CustomerReschedule` コンポーネント。
- テスト +3（移動+旧枠解放 / 満席拒否+ロールバック / 顧客期限超過）→ 135 vitest 全緑。tsc/lint/build OK。
  Preview で顧客自助改期を E2E 実証（7/22→7/29 移動）。

## 👥 店員ログイン（受限後台）— オーナーが発行、スタッフは自分の予定中心
- **アカウント発行**（オーナーが設定）: スタッフ編集ページに「スタッフのログイン」パネル（`StaffLoginForm`）。
  メール+パスワードを設定 → `setStaffLogin`（merchant-mutation-service）が User を作成/更新し **Staff.userId で紐付け + 当該店舗の SHOP_STAFF Membership を付与**（トランザクション内、メール重複は CONFLICT 拒否）。無効化は `disableStaffLogin`（User を SUSPENDED、`authenticateUser`/`buildAuthContext` は ACTIVE のみ通す）。`setStaffLoginAction`/`disableStaffLoginAction`（STAFF_WRITE 権限 + 監査）。
- **権限（受限後台）**: SHOP_STAFF = 予約(read/create/update/cancel) + スケジュール(read) + 顧客(read) のみ。
  オーナー/店長専用（設定/スタッフ/メニュー/営業時間/休業/予約ルール/レポート/CSV/休眠/操作ログ/店舗追加）は権限なし。
- **URL 直打ちガード**（`middleware.ts`）: `/admin` 配下のオーナー専用パス→必要権限を判定し、不足時は `/admin/schedule` へリダイレクト。ダッシュボード `/admin` も analytics 権限なしのスタッフは自分の予定へ。プラットフォーム管理者は素通り。
- **ナビ絞り込み**（`admin-shell.tsx`）: 各項目に `perm?` を付与し、セッション権限で絞る。スタッフのサイドバーは **予約 / スケジュール / 顧客** のみ。
- **店舗スコープ**: `getPrimaryShop` を session 権限対応（動的 import で next-auth を遅延ロード＝テスト/worker の静的依存に含めない）。テナント全体権限なしのユーザーは自分のスコープ店舗のみ解決。レイアウトの店舗スイッチャーもスコープで絞る。
- **自分の予定**: `/admin/schedule` で `getStaffIdForUser` により本人レーンをハイライト（`自分` バッジ + 左罫線 + 淡色背景）。
- テスト +3（発行→権限/スコープ / 無効化→再発行(パス更新) / メール重複 CONFLICT）→ **138 vitest 全緑**。tsc/lint/build OK。
  **prod デプロイ済み**（yoyaku.arcs-ai.com、app 再ビルド+再起動、health 200 / /login 200 / /book/demo-salon 200）。
  検証用スタッフ: `staff@demo.test` / password123（田中 美咲・SHOP_STAFF・店舗スコープ付、prod DB で確認）。

## 🔎 バグ監査（4並列エージェント）+ 修正7件・据え置き2件
新機能（改期・店員ログイン・複数店舗）を中心に4領域を並列監査し、検証済みの実バグのみ修正。
- **[HIGH] 店舗越境の書込**（複数店舗テナント）: admin action は client の `shopId` で認可するが、service は `tenantId` のみで対象を解決していた → スコープ付き店長が別店舗のスタッフ/メニュー/ルール/シフト/ログインを改変可能だった。`updateStaff`/`softDeleteStaff`/`updateService`/`softDeleteService`/`updateCapacityRule`/`replaceStaffRecurringSchedule`/`addStaffOverride`/`deleteStaffOverride`/`setStaffLogin`/`disableStaffLogin` に `shopId` を通し WHERE に含め、越境は NOT_FOUND。`assertStaffInTenant`→`assertStaffInShop`。二店舗・同一テナントの拒否テスト +1。
- **[MED] 店舗越境の閲覧**: `/admin/bookings/[id]` は tenant スコープのみで、スコープ付きスタッフが別店舗予約の PII を閲覧可能だった（顧客カルテのクロス店舗リンク経由で到達）。詳細ページに `canAccessShop(user, booking.shop.id)` ガード（不可なら404）。
- **[MED] CSV エクスポートのサーバー側認可**: `/admin/export/bookings` はミドルウェア頼みだった → ハンドラにも `ANALYTICS_READ` 検証（403）を追加（多層防御）。
- **[MED] メニュー別「件数」水増し**: 分割施術(segments)は1予約でも複数 BookingItem 行になり、レポートの件数が水増しされていた（売上は先頭行のみ価格で正しい）。予約×メニューのユニーク数で集計。
- **[LOW] 締切/リードタイムの境界**: `differenceInHours` の切り捨てで境界が最大1時間ずれる → 絶対時間(ms)比較に変更（`satisfiesLeadTime`/`isCancellable`）。
- **[LOW] 店舗切替の防御**: `selectShopAction` はテナントのみ検証 → `canAccessShop` を追加（`getPrimaryShop` 側で既に再フィルタ済みだが多層防御）。
- **[防御] 店員ログインのテナント再割当**: `setStaffLogin` の User 更新前に「紐付く User が別テナントなら拒否」を追加。
- **据え置き2件（要判断/低優先）**: ①`partySize` が容量計算で無視され団体予約で過剰予約になりうる（ただし顧客ウィザードは partySize 未露出＝顧客からは到達不可。`maxConcurrent`=席数か予約数かの設計判断が必要なため、防超卖コア変更は保留）。②受付期間 `isWithinBookingWindow` が UTC 暦日で計算（JST 深夜境界で最大1日ズレ、低影響）。
- 全ゲート緑: **tsc ✓ / lint ✓ / vitest 139 ✓ / build ✓**。prod デプロイ済み（health 200 / 公開ページ 200）。

## 🏷 監査ログの表記統一（操作コード→日本語）
- 操作ログに生コード（`customer.note.update` / `staff.login.set` / `booking.reschedule` / `shop.create` 等）や生リソース種別（`customer` / `staff`）が表示されていた（旧 inline マップに新機能分が未追加だった）。
- 共有モジュール `src/lib/audit-labels.ts`（`auditActionLabel`/`auditResourceLabel`、全29操作コード+12リソース種別）を新設し、商家 `/admin/logs` と運営 `/platform/audit` の両方で使用（表記を統一）。未知コードは生値フォールバックで壊れない。
- ユニットテスト +3（emit される全コードにラベルがある番人）→ **vitest 142 全緑**。tsc/lint/build OK。prod デプロイ済み（/admin/logs・/platform/audit は 307→/login、health 200）。

## 💴 売上を「実現主義」に統一（ダッシュボードの数字が高すぎた件）
- 症状: ダッシュボードの本日売上が「これから来る確定予約」まで計上して過大表示（例: 渋谷店=未来の確定4件¥18,500がそのまま売上に）。
- 方針（ユーザー決定）: **実現主義**。共有ヘルパー `realizedRevenueFilter(now)` = 「**来店完了(COMPLETED)は常に計上** + **確定(CONFIRMED)は開始時刻が過ぎたもののみ**」。キャンセル/無断/仮予約は除外、将来の確定予約は時間が来るまで非計上。**全売上指標に統一適用**。
- 修正: `getDashboardStats`(本日売上)・`getBookingTrend`(14日)・`getMonthlyReport`(売上/日別/スタッフ実績/メニュー別、`now` 注入可能) が同ヘルパーを使用。`getCustomerDetail`/`getDormantCustomers` は元々 `startAt < now` で対応済み。
- 予約「件数」（本日の予約/今後の予約）は計画値としてそのまま。CSV エクスポートは対账用に全ステータス維持。
- テスト +2（未来の確定は除外 / 来店完了は開始が未来でも計上）→ **vitest 144 全緑**。tsc/lint/build OK。

## 🏷 セール価格（割引）— 後台設定 + 予約ページで取り消し線表示
- スキーマ: `Service.salePriceJpy Int?`（null=セールなし）。migration `20260707120000_service_sale_price`。
- 後台: メニュー編集に「セール価格(円)」入力（任意・通常料金より安いこと=zod refine）。メニュー一覧はセール時に「通常価格取り消し線＋セール価格(rose)」表示。
- エンジン: `loadServiceContext` が実効価格（`salePriceJpy ?? priceJpy`）を返し、予約の請求額＝セール価格。オプション/指名料は割引対象外（通常価格加算）。
- 公開API: `PublicService.salePriceJpy` を追加。
- 顧客ウィザード(`booking-wizard.tsx`): メニューカードに **「N% OFF」赤バッジ + 通常価格取り消し線 + セール価格(太字rose)**、合計・明細もセール価格で計算。`effectivePrice`/`isOnSale` ヘルパー。
- テスト +4（予約はセール価格請求・オプション通常 / セール価格 zod: 空欄→null・安いと受理・通常料金以上は拒否）→ **vitest 148 全緑**。tsc/lint/build OK。
- ローカル preview で実機確認: カット ¥4,500→¥3,800(16%OFF)・カラー ¥8,000→¥6,800(15%OFF)、選択後の合計もセール価格。

## 📣 予約QR・集客物料（店頭掲示/SNS/チラシ）
- 店家が自店の予約ページ(`/book/[slug]`)へ誘導する QR を後台からダウンロードできる。
- ライブラリ: `qrcode`（純JS、standalone ビルド同梱）。`src/lib/qr.ts`: `qrToSvg`（ベクター）/`qrToPngDataUrl`（高解像度PNG）、濃紺 on 白・誤り訂正M。
- ページ `/admin/qr`（`予約QR・集客` ナビ、`SHOP_UPDATE` gate→スタッフ非表示・middleware でも保護）: `env.APP_BASE_URL/book/{slug}` を QR 化。未公開店舗には警告（設定へ誘導）。
- クライアント `QrMaterial`: ①**集客ポスター(PNG 1080×1350)** を canvas 合成（淡インディゴ地＋フローティングカード＋店名＋「ネットで24時間かんたんご予約」＋QR＋URL＋バッジ）。プレビュー表示＋ダウンロード。②QR 単体 PNG/SVG ダウンロード。③予約URL コピー。
- テスト +2（SVG/PNG 生成）→ **vitest 150 全緑**。tsc/lint/build OK。ローカル preview でオーナーログイン→ポスター/QR/URL 実機確認済。

## 🔔 店長通知（新規予約/変更/キャンセル）— LINE ＋ メール
- 目的: 顧客だけでなく**店長/オーナー/スタッフ**にも予約イベントを通知。各店舗**複数人・複数チャネル**が各自登録。
- 決定: LINE＋メール双方 / 新規＋変更＋キャンセル / 各店多接収人。**LINE Notify 停服のため Messaging API（単一プラットフォーム公式アカウント）**採用。
- 地基再利用: 既存の `notification_jobs` outbox + worker + `dispatch()`（`NotificationChannel.LINE` と `env.LINE_CHANNEL_ACCESS_TOKEN` は予約済みだった）。
- **DB**: `NotificationRecipient`（店舗×複数×EMAIL/LINE）＋ `LineLinkCode`（短期連携コード）+ migration `20260707130000`。
- **LINE クライアント** `src/server/notifications/line.ts`: `sendLineMessage`(push)/`replyLineMessage`(reply)/`isValidLineSignature`+`verifyLineSignature`(HMAC)、native fetch。env に `LINE_CHANNEL_SECRET`/`LINE_OA_BASIC_ID` 追加。
- **Webhook** `/api/line/webhook`: 署名検証 → message(連携コード→userId 登録→返信)/follow(案内)/unfollow(無効化)。常に 200。
- **connect フロー**: `/admin/notifications`（ナビ「通知設定」、`SHOP_UPDATE` gate + middleware 保護）でメール追加 or「LINE連携コード発行」→ 友だち追加 QR（`qr.ts` 再利用）＋コード表示 → 店長が送信で紐付く。
- **配信**: `booking-service` の createBooking/reschedule/cancel が同一Tx内で有効な通知先ごとに manager job 作成（`payload.audience=MANAGER`, event）。`notification-service.dispatch` に LINE 分岐 + audience 別文面（`buildManagerNotification`）。
- **メールは即日稼働（SMTP 設定済）。LINE はコード同梱で休眠、運営が公式アカウント設定→ env 投入で有効化**（コード改修不要）。
- テスト +9（署名検証・店長文面・3イベントの manager job 生成・連携コード発行/消費/期限）→ **vitest 160 全緑**。tsc/lint/build OK。
- **本番 LINE 有効化済み**: 運営が公式アカウント「Yoyaku」(`@489fvuuf`) の Messaging API を設定し、`.env.production` に token/secret/basicId 投入 → app+worker 再作成。検証: bot/info=200（token 有効）、webhook 署名 200/不正 401、`/admin/notifications` の LINE 区が有効化。残: LINE コンソールの Webhook「検証」＋実機連携で最終確認（店長が友だち追加→コード送信→予約でプッシュ）。

## 🔎 3視点フル監査（顧客/店長/店員）+ 全ボタン検査 → 修正9件
顧客・オーナー・店員の3視点で並列監査（各ボタン→ハンドラを追跡・検証）。全体ロジックとRBACは堅牢と確認。実在の欠陥のみ修正:
- **[顧客/MED] 「続けて予約する」が no-op**: 完了画面から同一ルートへ soft-nav しても wizard が `done` のまま固まる。`resetWizard`（state 初期化＋冪等キー新規化）を onClick に。→ **本番同等の実機E2Eで検証**（予約完了→リセット→メニュー選択に戻る）。
- **[顧客/LOW] 担当変更で選択枠が残る**: StaffChip の onClick で `setSlot(null)`（別担当で空き枠が変わるため）。
- **[顧客/LOW] 完了/無断キャンセルに「キャンセル期限切れ」の誤メッセージ**: `booking/[token]` を status で分岐（来店御礼 / 無断案内 / 期限切れ）。
- **[店員/MED] 顧客メモ 保存が死にボタン**: 店員は `CUSTOMER_WRITE` 無し→保存が Forbidden。`CustomerNoteForm` に `canEdit` を追加し、権限が無ければ読み取り専用表示。
- **[店員/LOW] 休眠顧客リンク / 店舗を追加リンク**が店員に見えて弾かれる: それぞれ `ANALYTICS_READ` / `SHOP_CREATE` で導線を gate。
- **[オーナー/MED] 店舗越境の読み取り**: `/admin/staff/[id]`・`/staff/[id]/schedule`・`/services/[id]` が tenant のみ scope。各 read が `shopId` を返すようにし、ページで `canAccessShop` ガード（`bookings/[id]` と同型）。スコープ付き店長が別店舗のスタッフ PII/メニュー設定を閲覧するのを防止。
- **[オーナー/LOW] reports/dormant** はミドルウェア頼み→ `ANALYTICS_READ` をサーバー側でも検証（多層防御）。
- 全ゲート緑: **tsc ✓ / lint ✓ / vitest 160 ✓ / build ✓**。「死にボタン/パラメータ不整合」は監査で他に無しと確認（全25 action 呼び出しの引数順・権限・revalidate 検証済み）。

## 📲 LINE ネイティブ予約 — Phase 1（薄 LIFF ＋ LINE 確認/リマインド）
戦略: B2B SaaS の楔として日本市場で最高レバレッジの動作＝**顧客が LINE 内で予約し、確認/リマインドを LINE で受ける**（メールより高開封率→ no-show 削減が商店への ROI 訴求）。既存の予約向導を **LIFF** で薄く包む「分階段・先薄」方式。プラットフォーム単一 OA「Yoyaku」を流用（店ごと OA は追加しない）。
- **通道択一（重複打擾なし）**: 下単に `lineUserId` があれば顧客通知は **LINE のみ**（確認＋24h リマインド）、無ければ従来の**メール**。改期/取消も同型（booking に userId 保存 → 参照）。
- **DB**: `Booking.customerLineUserId String?` + migration `20260711120000_booking_line_user`（ADD COLUMN）。
- **バリデーション**: `createBookingSchema` に `lineUserId` 追加、連絡先必須を **email || phone || lineUserId** に緩和。公開下単ルートが透traits。
- **エンジン** `booking-service.ts`: `createBooking` が `customerLineUserId` を保存＋通道分岐で顧客 job（確認/リマインド）を LINE/メール択一。`rescheduleBooking`（新リマインド＋変更通知）・`cancelBooking`（取消確認）も保存済み userId で LINE 分岐。`dispatch()` は既存の LINE 分岐（`sendLineMessage`＋`buildBookingEmail` の text）を流用。
- **フロント** `booking-wizard.tsx`（純粋な progressive enhancement）: `NEXT_PUBLIC_LIFF_ID` があり LINE アプリ内なら `@line/liff` を動的 import → `liff.init`→（アプリ内未ログインは `liff.login()`）→`getProfile()` で `{userId, displayName}` 取得。LINE モードは氏名を表示名で自動補完し**氏名/メール入力を省略**（電話は任意）、下単 POST に `lineUserId` を同送。LINE 外/未設定なら**従来のウェブ予約が完全に不変**で動作（`@line/liff` チャンクは `liffId` 未設定なら fetch されない）。
- **env/依存**: `NEXT_PUBLIC_LIFF_ID`（クライアント露出・任意）、`@line/liff@2.25.1`。
- 検証: 統合テスト `booking-line.test.ts`（lineUserId 付き→LINE 確認+リマインド2件・userId 保存 / 無し→メール / バリデーションが lineUserId 単独を許容）。全ゲート緑: **tsc ✓ / lint ✓ / vitest 164 ✓ / build ✓**。
- **本番有効化済み（2026-07-17）**: 運営が **LINE Login チャネル**（Provider「マイアークス株式会社」＝ Yoyaku Messaging API と同一 Provider → LIFF の userId が push の userId と一致）を作成し **LIFF app**（size=Full／endpoint=`https://yoyaku.arcs-ai.com`／scope=profile,openid）を追加、**LIFF ID `2010746384-L9UVfb7m`** を取得。
  - **実装修正（重要）**: `NEXT_PUBLIC_*` は**ビルド時インライン**で `env_file`（実行時）からは読めないため、LIFF ID を**サーバー側 `env` から `/book/[slug]` が読み取り→`BookingWizard` に prop 注入**する方式に変更（`liffId` prop）。これで値の変更は**コンテナ再起動のみ**で反映（再ビルド不要）。`.env.production` に `NEXT_PUBLIC_LIFF_ID=` 追記 → app 再ビルド → 入替。
  - **本番検証**: コンテナ env 到達 ✓／SSR HTML に LIFF ID 出力 ✓／health ok ✓。**回帰（最重要）**: 通常ブラウザ（LINE 外）で `/book/toyousoft` を実機 E2E → 日時→次へ→お客様情報が**氏名/メール入力＋「いずれかは必須」提示のまま**（LINE バナー非表示）＝ `liff.init` は走るが `isLoggedIn()`=false でウェブ予約へ綺麗にフォールバック、既存動線に無影響を確認。
  - **残（運営の実機タスク）**: ① LINE Login チャネル基本設定の「リンクされた公式アカウント」＝Yoyaku ＋ LIFF の**ボットリンク（加友達）On**（未加友達だと顧客への push が届かない）② スマホの LINE 内で `https://liff.line.me/2010746384-L9UVfb7m/book/toyousoft` を開き免入力予約→LINE 確認→（24h 前）リマインド受信を実機確認。
  - **実機不具合2件を修正（2026-07-17）**: ① チャネル「開発中」で 400 → LINE Login チャネルを**公開**に切替（コンソール操作、審査不要）。② LIFF パス転送が LP で止まる＋その後の**リロード無限ループ**。原因: (a) LIFF は `endpoint/?liff.state=/book/{slug}`（=トップ）へ一次リダイレクトするが LP で `liff.init()` を呼んでいなかった、(b) 一時対処の手動 `location.replace` はログイン文脈を落とし、目的ページで `isLoggedIn()=false` → ウィザードが `liff.login()` を呼ぶ→ **`liff.login()` は外部ブラウザ専用 API**（LIFF ブラウザ内で呼ぶとループ）。修正: LP に `LiffStateRedirect`（`liff.state` 有りのときだけ SDK を動的 import → `liff.init()` が自動ログイン込みで二次リダイレクト、失敗時のみ相対パス限定の手動遷移）＋ LP を `force-dynamic` 化（LIFF ID は実行時 env のため）＋ ウィザードから `liff.login()` を**削除**（LIFF 内は init が自動ログイン。未ログインなら静かにウェブ予約へフォールバック＝ループ構造そのものを排除）。検証: 外部ブラウザで `/?liff.state=%2Fbook%2Ftoyousoft` → `/book/toyousoft` へ遷移し**単一ナビゲーションで安定**（リロードなし・ウィザード描画）、通常 LP は no-op、全ゲート緑（tsc/lint/vitest 164/build）。
  - **✅ 実機 E2E 完了（2026-07-17 23:38 JST）**: 運営がスマホの LINE 内で LIFF URL → 東陽salon 予約向導 → **氏名が LINE 表示名で自動補完**（getProfile 動作）→ 免入力下単成功。DB 検証: booking に `customerLineUserId=Ue327…` 保存、notification_jobs は **顧客 LINE 確認 SENT ＋ 店長 LINE 通知 SENT** の2件（リマインドは開始まで24h未満のため設計どおり未作成）。**Phase 1 の全経路が本番で疎通**（LINE内予約 → LINE確認 → 店長LINE通知）。残る任意確認: 開始24h超の予約でリマインド受信、LINE コンソールの Webhook「検証」ボタン。
  - **LINE予約QR物料（2026-07-17 追加・本番検証済み）**: `/admin/qr` を二部構成に拡張 — ①ウェブ予約QR（従来・藍テーマ）②**LINE予約QR**（`https://liff.line.me/{LIFF_ID}/book/{slug}` をエンコード、LINE緑 #06C755 テーマのポスター1080×1350＋QR PNG/SVG＋URLコピー＋メリット説明）。`NEXT_PUBLIC_LIFF_ID` 未設定なら LINE 区画は非表示（プロパゲーション: page が実行時 env を読み `QrMaterial` に渡す）。`qr-material.tsx` は PosterTheme でテーマ化（PosterCard/UrlCopyRow に分解）。本番でオーナーとしてログインし、両区画・QR2枚・LIFF URL 表示を DOM 検証済み。全ゲート緑（tsc/lint/vitest 164/build）。
- 範囲外（Phase 2）: 店ごと OA / rich menu / LINE 内「マイ予約」改期UI / Flex カード / 決済。

## 🔎 全系統監査（6視点並列 + 対抗検証）→ 16件修正・本番展開（2026-07-18）
6次元（LINE/LIFF・予約エンジン・通知・セキュリティ・後台UX・顧客UX）の並列監査で 31 件検出 → 対抗検証（3票制）＋手動トリアージで実在バグのみ修正。全ゲート緑（tsc/lint/**vitest 165**/build）→ app+worker 再ビルドで本番展開・health 確認済み。
- **[確認済/MED] 店側キャンセルが顧客に一切通知されない**: `updateBookingStatus` が BOOKING_CANCELLED を `channel:EMAIL, recipient:''`（=worker がスキップ）で作成、`customerLineUserId` 未参照。LIFF 予約客はリマインドも無効化され**無通知でキャンセル**に。→ LINE 優先/メール代替で必ず通知（回帰テスト追加）。
- **[通知/HIGH×2+MED] outbox 強化 3 点**: ①`updateMany(status:PENDING→PROCESSING)` の原子クレームでスイープ重複時の二重送信を防止 ②worker クラッシュで PROCESSING に固着した行を 5 分後に PENDING へ回収（従来は永久ロスト） ③失敗リトライに指数バックオフ 2/4/8/16 分（従来 10 秒間隔で約 40 秒で 5 回使い切り→一時障害で永久 FAILED）。
- **[エンジン/MED×2] ①冪等リプレイを tenant/shop でスコープ**（他テナントのキー衝突/探索で予約+cancellationToken を返さない、2 箇所） **②改期を予約行 `FOR UPDATE`+状態再確認で直列化**（並行キャンセルとの競合で「CANCELLED なのに新明細 active」の幽霊占有を防止）。
- **[後台/HIGH] 店舗切替後のフォーム誤爆**: RHF の defaultValues は初回マウントのみ→切替後に**旧店舗の値を新店舗へ保存**。settings/business-hours に `key={shop.id}` で再マウント（rules は既に key あり）。
- **[後台/MED] ダッシュボード「直近の予約」が最遠未来 8 件**（desc）→ `order:'asc'` で直近順。`listBookings` の `?status=` 生値も enum 検証（不正値 500→無視）。
- **[後台/LOW×3] 通知設定の表示名 state がメール/LINE で共有**（片方入力が混入・追加で両方消える）→ 分離。DeleteSpecialDay/DeleteOverride ボタンの**失敗握り潰し**→ エラー表示。remove 失敗も表示。
- **[顧客/MED×3] ①向導の空き取得に連番ガード**（遅延レスポンスが別日の枠を上書き） ②再取得で消えた選択枠を自動解除（次へ→SLOT_FULL 直行を防止） ③**冪等キーを内容変更で無効化**（失敗→内容変更→再送で旧内容の予約が「再生」されるのを防止）。
- **[顧客/MED] 改期UIで日付変更後も旧日付の枠が残留**（枠は時刻表示のみ→誤った日へ変更）→ 日付変更で枠リストをクリア。
- **[セキュリティ/MED] liff.state フォールバックの `/\evil.com` バイパス**（ブラウザがプロトコル相対と解釈）→ URL 解析で同一 origin 厳密比較。
- **据え置き（実在するが設計判断/大改動、リスク順）**: ①公開下単の `lineUserId` 無検証（なりすまし予約で任意 userId に OA からプッシュ可能 — LIFF ID トークン検証の導入が本筋。userId は不可推測・友だち限定プッシュのため実害は限定的） ②改期時の明細再作成が現行カタログ価格でスナップショット（合計は凍結→内訳と不一致） ③予約受付窓がサーバー UTC 日基準（±9h ずれ） ④コンボのキャンセル期限が先頭サービスのみ ⑤カタログ無効化で既存予約が改期不能 ⑥後台改期の担当候補が適格性未フィルタ ⑦advisory lock が暦日スコープ（深夜跨ぎの容量エッジ） ⑧LINE 押し永久失敗時の代替チャネルなし（通道択一の設計どおり） ⑨カレンダー +2ヶ月固定 vs 店舗の bookingWindowDays。

## 💳 Stripe サブスクリプション課金（自動化）— 休眠デプロイ済み（2026-07-18）
地推（対面営業）開始のための B2B 課金自動化。**`STRIPE_SECRET_KEY` 未設定の間は完全休眠**（全テナント無影響・誰もロックされない）。有効化手順は `docs/BILLING-stripe.md`。
- **モデル**: 新規テナント作成時に **30日無料トライアル**（`trialEndsAt`）→ `/admin/billing` から Stripe Checkout で申込 → webhook が `stripeSubscriptionStatus` 等を同期 → トライアル切れ&未契約は商家後台を `/admin/billing` へリダイレクト（**公開予約ページは稼働継続**）。`past_due` は警告付き猶予。既存2テナントは migration で**課金免除**（プラットフォーム後台の商家詳細でトグル可）。
- **実装**: `Tenant` に stripeCustomerId/-SubscriptionId/-SubscriptionStatus/currentPeriodEnd/billingExempt/trialEndsAt/lastStripeEventAt、`Plan.stripePriceId`（migration×2）。`src/server/billing/stripe.ts`（fetch 直・SDK 非依存: Checkout/Portal/顧客作成 + webhook 署名検証 HMAC timingSafeEqual・5分許容）。`billing-service.ts`（`evaluateBillingAccess` 純関数ゲート / `processStripeEvent` 同期 / checkout・portal）。`/api/stripe/webhook`（不正署名400・処理失敗500=Stripe再送・未設定503）。`/admin/billing`（状態カード+プラン申込+Portal、店員は案内のみ）+ ナビ（SHOP_CREATE）。課金ゲートは `requireTenantUser` に内蔵（billing ページと **layout は skip** — 全 admin ページが各自呼ぶことを確認済み）。プラットフォーム: プラン編集に Price ID 欄、商家詳細に課金パネル+免除トグル（監査ログ付き）。
- **対抗レビュー（4視点17検出）で3 HIGH を修正**: ①admin **layout** がゲートを適用→ロック商家が `/admin/billing` に到達不能の**無限リダイレクト**（layout を skip に。決済ページへの動線を保証） ②webhook の**順序逆転ガード**なし→解約→再契約後に旧サブスクの deleted 遅延再送で**支払中テナントをロック**（番兵 `lastStripeEventAt` + 「deleted は現行サブスクIDのみ適用」の二重ガード） ③`invoice.payment_failed` が canceled を **past_due（アクセス許可）に復活**（現に利用中ステータスのみ遷移+番兵）。加えて: 履歴 upsert を `externalRef` **unique** で原子化 / `current_period_end` の **Basil API（items 側）フォールバック** / checkout.completed の P2025→500 リトライ嵐を updateMany で回避 / **二重申込ブロック**（既契約は Checkout 拒否）/ `ensureStripeCustomer` の並行race対策。
- 検証: **vitest 192**（課金ゲート行列・署名検証・formエンコード・webhook同期・順序逆転・復活防止・Basil の 27 件含む）/ tsc / lint / build 全緑。本番: migration×2 適用・全テナント exempt 確認・webhook 503（休眠）・`/admin/billing` が「準備中」表示・`/admin` リダイレクトループ無しをブラウザ実測。
- **残（運営の一次設定・約15分**、`docs/BILLING-stripe.md` 参照）: Stripe 本番アカウント → 商品/価格作成 → Price ID をプラットフォーム後台のプランに登録 → Webhook エンドポイント登録 → `.env.production` に `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` → app+worker 再起動（再ビルド不要）。⚠️ トライアル時計は作成時から進むため、**キー設定は商家オンボーディング開始前に**。

## 🔐 ログインセキュリティ強化（割賦販売法/Stripe 質問票対応）— 本番展開済み（2026-07-18）
Stripe 有効化のセキュリティ質問票に**正直に「はい」と答えられる状態**を実装（対応表: `docs/SECURITY-checklist.md`）。
- **アカウントロック**: 連続 5 回失敗 → 15 分自動ロック（成功でリセット、質問票の「10回以下」を充足）。
- **二段階認証（メールOTP）**: パスワード通過後、6 桁コードをメール送信（10 分有効・5 回まで・ワンタイム消費・再送は 8 分グレース）。SMTP 構成済み本番で自動有効、`ADMIN_2FA=off` で緊急停止可。**デモアカウント（@demo.test）のみ migration で免除**（実メールボックス無し・地推デモ用に温存）。
- **認証フロー**: `login-security.ts` に集約（`authenticateWithPolicies` が typed outcome を返す）→ `auth.ts` は `CredentialsSignin` サブクラス（`otp_required`/`otp_invalid`/`account_locked`）で next-auth の `?code=` 経由でクライアントへ伝搬 → ログインフォームは二段階 UI（コード入力・再送・やり直し）。
- **/platform 第二層防御**: middleware に IP 許可リスト（`PLATFORM_IP_ALLOWLIST`）+ Basic 認証（`PLATFORM_BASIC_USER/PASS`、固定長比較）。env 未設定の間は休眠。**運営が env を設定してから質問票の該当項目を「はい」にする**。
- スキーマ: User に failedLoginCount/lockedUntil/loginOtp*/twoFactorExempt（migration `20260718110000`）。
- 検証: 統合テスト 8 件（ロック閾値・自動解除・リセット・OTP 消費/再利用不可/期限切れ/試行上限/免除）→ **vitest 200 全緑**、本番デプロイ後にデモオーナーのログイン直通（免除経路）をブラウザ実測。実アカウント（admin@／chiliososada@）は次回ログインからメールOTP。

## ✅ Stripe 課金 — テストモード全経路 E2E 疎通（2026-07-19）
運営が Stripe 本番アカウント取得（審査中）+ セキュリティ質問票対応（本書 🔐 参照）を完了。**テストモードで実環境フル検証済み**:
- 設定: テスト商品「スタンダードプラン ¥4,980/月」（`price_1TuZVk…`）を plans.STANDARD に紐付け（priceJpy も 4980 に整合）。webhook 送信先（5イベント・API 2026-06-24.dahlia）登録。`sk_test`/`whsec` を運営が `.env.production` へ投入 → app/worker 再作成。
- 検証済み経路: 未署名 webhook 400 ✓ → デモ商家に試用付与 → `/admin/billing` にトライアル帯+プラン札 ✓ → 申込ボタン → **Stripe Checkout（沙盒）へ遷移** ✓ → テストカード 4242 で決済 ✓ → `?checkout=success` 帰還時点で**既に「ご契約中」表示**（webhook 同期が先行完了）✓ → DB: `stripeSubscriptionStatus=active`・customer/subscription ID・`currentPeriodEnd=2026-08-18`・planId=STANDARD・契約履歴 ACTIVE 行 ✓。
- 後片付け: デモ商家は billingExempt=true に復元（テスト用サブスクは test モードのため実害なし）。
- **本番切替（審査通過後・約5分）**: Stripe を本番モードに切替 → 本番の商品/価格を作成し Price ID をプランに再登録 → 本番 webhook 送信先を登録 → `.env.production` の `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` を `sk_live_`/本番 `whsec_` に差替 → app/worker 再作成。※チャットに露出した `sk_test` はロール推奨、`PLATFORM_BASIC_PASS` もスクショ露出のため再生成推奨。

## 📄 商用運営の最終整備（法務・デモ資格情報・バックアップ）— 本番展開済み（2026-07-19）
- **法務3ページ**: `/legal/tokushoho`（特定商取引法に基づく表記 — 事業者/住所/連絡先/価格/支払/解約/返金条件）・`/legal/terms`（利用規約 11 条: 月額自動更新・不返金・データ帰属・免責上限3ヶ月・東京地裁管轄）・`/legal/privacy`（取得情報/目的/委託先 Stripe・LINE/安全管理/開示窓口）。共有 `legal/layout.tsx`。LP フッター（© マイアークス株式会社 + 3リンク）と `/admin/billing`（申込導線）からリンク。※雛形につき、正式運用拡大時は専門家レビュー推奨。
- **デモ資格情報の公開撤去**: LP とログインページに掲示していた `owner@demo.test / password123` 等を削除（アカウント自体は地推デモ用に存続・2FA免除・デモテナント隔離）。
- **日次DBバックアップ**: hpe1 に `~/backup/backup_booking.sh`（pg_dump→gzip・14日保持・ログ付き）+ cron 毎日 4:30 JST。初回実行で 18K ダンプ生成・gunzip -t 完整性 OK を確認。
- **監査（前回監査以降の差分）**: 認証チェーン（login-security/auth/auth.config/middleware/ログインフォーム）・課金収尾・法務ページを精査。auth.config は成功時のみ jwt 詰替でカスタムエラーと干渉なし ✓。既知の LOW 1件のみ: OTP 初回送信失敗時、8分グレース内の再送がスキップされ最大約2分待ち（許容・記録のみ）。ログインページに残っていたデモ資格情報の公開掲示を発見・撤去（今回の実修正1件）。
- 検証: 全ゲート緑（tsc/lint/**vitest 200**/build、法務3ページは静的生成）。本番: 3ページ 200 + 会社名表示 ✓、LP フッターにリンク ✓、LP/ログインのデモ資格情報 0 件 ✓、health ✓。
- Git: `chiliososada/yoyaku`（private）へ初回 push 済み。以降は機能完了ごとにローカル commit（push は運営が実行 or 権限付与で自動化）。

## 📖 使い方ガイド（/guide）— 地推用セルフオンボーディング（2026-07-19 本番展開）
商家がチラシ/QR から自力で使い方を理解できる**ステップ式ガイド**（説明コスト削減が目的）。
- **実写スクリーンショット 17 枚**: Playwright（`scripts/capture-guide-screens.ts`、1280×800 retina jpeg q82・計 2.6MB）で本番のデモアカウント画面を撮影 → `public/guide/`。課金画面は撮影時のみデモをトライアル表示に切替→復元。UI 変更時はスクリプト再実行で全量更新可。
- **ビューア** `/guide`（公開・静的）: 6 章タブ（はじめに/初期設定/集客する/毎日の運用/お客様の予約体験/ご契約）＋ STEP n/17 進捗バー＋**画像上の番号ピン**（% 座標、説明の番号バッジと対応）＋ヒント枠＋前へ/次へ/ドット/キーボード←→。モバイル完全対応（チラシの QR から携帯で閲覧想定）。データ駆動（`guide-steps.ts`）。
- 入口: LP ヒーロー第3ボタン「📖 使い方ガイド」・LP フッター・商家後台サイドバー下部（新規タブ）。
- 検証: 全ゲート緑（vitest 200）→ 本番で 200・画像配信・「次へ」遷移・章ジャンプ（ご契約→STEP17）・ピン位置（ダッシュボードの予約URL帯/課金のトライアル帯+申込ボタン）・モバイル表示をブラウザ実測。

## 🏠 店舗専用ホームページ（ルート `/{slug}`）— SEO + 地推用（2026-07-25 本番展開）
「まだHPを持たない店舗にHPごと提供」する地推の武器 + SEO 導線。
- **DB**: `ShopProfile`（Shop と 1:1 — キャッチコピー/紹介文/こだわり/アクセス/支払方法/SNS/画像キー/showAddress）+ `shops.slug` を**グローバル unique 化** + 予約語リスト（admin/api/book/legal 等はスラッグ不可）。
- **公開ページ** `/[slug]`（ルート直下・force-dynamic）: hero/メニュー/スタッフ/こだわり/営業時間/アクセス/SNS/予約CTA。`generateMetadata` + **JSON-LD LocalBusiness** + 動的 `sitemap.ts`/`robots.ts`（公開店舗のみ列挙）。
- **画像**: `/api/uploads`（SHOP_UPDATE + 店舗スコープ検証、sharp で webp 変換・`fit:'inside'` 最大2000px=切り抜きなし）→ Docker named volume `uploads_data` に保存、配信は `/uploads/[key]`（immutable キャッシュ）。
- **後台エディタ** `/admin/homepage`（ナビ「ホームページ」）: 全項目フォーム + 画像アップロード UI（hero/logo/gallery）+ プレビューリンク。
- **本番で踏んだ穴3つ（今後の教訓）**: ① rsync の `--exclude uploads`（非アンカー）が `src/app/api/uploads/` の**ソースまで除外**し 500 → `--exclude '/uploads'` にアンカー化 ② named volume が root 所有で非rootアプリが EACCES → Dockerfile で `mkdir+chown` を USER 切替前に実行 ③ hero が二重クロップで不格好 → アップロードは無切り抜き + 表示は min-height + 適応スクリム に変更。
- 検証: 全ゲート緑 → 本番で公開ページ/JSON-LD/sitemap/画像アップロード〜表示まで実測済み。

## 📮 通知の信頼性強化 + 失敗可視化 + Kong レート制限（2026-07-27 本番展開）
- **NOTIF①** 送信タイムアウト（SMTP 30s/LINE 15s の AbortController）→ ハング時の二重送信を防止。
- **NOTIF②** リトライを最大 9 回・指数バックオフ上限延長（一時障害を乗り切る）+ `notification_jobs.bookingId` index。
- **NOTIF③** リマインダー送信時刻をジッター分散（同時刻集中による SMTP スロットリング回避）。
- **VIS①** `/admin/notifications` に**失敗通知の可視化 + 再送ボタン**（オペレータが気付ける）。
- **VIS②** Kong に `/api/public` 専用 route（`strip_path=false`）+ **per-IP レート制限**（local policy）。公開予約 API の濫用防御。
- 検証: vitest 全緑 + 本番反映済み。

## 💳 Stripe 本番切替（LIVE 課金稼働開始）（2026-07-28）
Stripe 審査通過 → 本番モードへ切替完了。**実カードで課金できる状態**。
- 本番商品/価格: スタンダード ¥9,800/月（`price_1Ty0imGV54gVtfHZLZGcKDC4`）・プロ ¥29,800/月（`price_1Ty0pbGV54gVtfHZmO3f7m99`）をプランに紐付け。本番 webhook 送信先登録。`sk_live`/`whsec` は運営が `.env.production` へ直接投入（チャット/リポジトリに非露出）→ app/worker 再作成。
- 口座登録は**カタカナ名義**が必要（銀行審査エラーで判明）。
- テストモード価格からの移行: Stripe の price は**不変オブジェクト**のため新規作成して差替（旧 price はアーカイブ）。

## 🧱 P0 課金基盤 —「顧客が来る前にしか作れないもの」（2026-07-28 本番展開）
地推開始前の不可逆項目を先に整備（ロードマップ Phase 0、詳細は `~/.claude/plans/snazzy-inventing-cook.md`）。
- **P0-a 追記専用の課金台帳 `BillingEvent`**: 全遷移（TRIAL_STARTED/SUBSCRIPTION_CREATED/UPDATED/PLAN_CHANGED/CANCELED/PAYMENT_SUCCEEDED/FAILED）を**発生時点の金額・プラン名スナップショット付き**で追記。`stripeEventId` unique + P2002 握り潰しで再送冪等。`invoice.paid` ハンドラ追加＝**実入金が DB に残る**（従来は皆無）。価格改定しても過去の MRR が書き換わらない。
- **P0-b 解約の表現**: webhook が `tenant.status` を ACTIVE↔CANCELLED に遷移（従来は作成時 ACTIVE のまま死んだフィールド＝解約率が集計不能だった）。`/platform` の契約中/解約数を実データ化。
- **P0-c プラン上限の強制**: `maxStaffPerShop`（ACTIVE スタッフのみカウント・その場拒否・上位プラン案内文言）/ `maxBookingsPerMonth`（**オンライン予約のみ**対象、10% 猶予帯 = 顧客の予約を安易に止めない、後台からの登録は常に可、顧客向け文面に課金事情を出さない）。`0=無制限`（バリデーション/フォーム/一覧対応）。FREE プランは isActive=false に（「30日間無料トライアル」の建付けと整合）。
- **P0-d トライアル残日数の引継ぎ**: `createCheckoutSession` に `trial_period_days`（残日数切り上げ）。トライアル3日目に契約しても残り27日を失わない。
- **[HIGH] 二重課金バグ修正（3層防御）**: `startCheckout` ガードが webhook 専用フィールドのみ参照で **Checkout完了〜webhook同期の窓で二本目を作れた** → ①ガードを `stripeSubscriptionId && status∉{canceled,incomplete_expired}` に拡大 ② checkout 成功帰還時はプラン札を非表示 ③ Stripe Idempotency-Key（10分バケット）④ `checkout.session.completed` が暫定 'incomplete' を先置き。同秒後退イベントのガード（active→incomplete の逆行拒否）も追加。**本番で4状態すべて実測済み**。
- 検証: **vitest 246 全緑**（billing-history 統合 11 件含む）→ 本番反映。

## 💴 P1 価格改定 ¥4,980 → ¥9,800（2026-07-28）
競合実勢（¥9,790〜19,690）と訪問営業の経済性（LTV/CAC）から改定。既存契約はグランドファザリング（0件のため実影響なし）。
- seed/プラン: STANDARD ¥9,800・有料プランの月間予約 0=無制限。コーポレートサイト（arcshomepage）の価格表記 6 箇所を更新。
- 商業価値の結論（調査済み）: 売却価値は**コードではなく MRR×成長×創業者非依存の獲得経路**。0件=~¥0、100件=¥1,000万〜3,500万。→ **方針: これ以上作らず、有料10件を取る（Phase 2）**。

## 🔐 FIX-A セッション即時失効（HIGH）+ FIX-B 6件（2026-07-29 本番展開）
全体監査で確認した実バグを修正。**tsc ✓ / lint ✓ / vitest 257 ✓ / build ✓** → 本番反映・検証済み。
- **FIX-A（HIGH）**: JWT セッションが発行後**一切再検証されず**、停止/ログイン無効化/パスワードリセット後も既発行トークンが最長30日有効だった。
  - `users.sessionEpoch Int @default(0)`（migration `20260728120000_session_epoch`）を JWT に刻印し、**`getSessionUser` が毎リクエストで DB と照合**（status≠ACTIVE / 論理削除 / epoch 不一致 → 未ログイン扱い。全保護ページ/action/upload はここに合流）。
  - **epoch++ の失効トリガ5箇所**: `disableStaffLogin` / `softDeleteStaff`（退職者のログインも停止＝従来は放置されていた）/ `setUserStatus(SUSPENDED)`（ACTIVE 復帰は据え置き）/ `adminResetPassword` / `resetPasswordWithToken`。
  - `session.maxAge` 30日→**7日**。既存ログインは epoch=0 一致で無影響（強制ログアウトなし）。
  - テスト: `session-revocation.test.ts` 7件（5トリガ + 照合意味論 + レガシートークン互換）。
- **FIX-B**: ①月間クォータ検査を `createBooking` 内（冪等リプレイの**後**・PUBLIC 限定）へ移動 — リトライを新規1件と誤カウントして弾く問題を解消（`booking-quota-gate.test.ts` 2件） ②受付期間(window)の暦日差を**店舗TZ**で計算（UTC 暦日だと JST 深夜帯で1日ズレ — 据え置きだった既知課題を解消） ③改期時の指名スタッフ検証を createBooking と同等に（他店舗/停止/削除済みの staffId 割当を防止） ④アップロードの Content-Length を必須化（ヘッダ欠落で事前チェックを迂回する メモリDoS を封鎖、411 返却） ⑤課金台帳の初回契約分類 — checkout の 'incomplete' 先置き + trial とのプラン差で PLAN_CHANGED/UPDATED に化けていた → **Stripe イベント種別（created）を分類の権威に**（billing-history +2件） ⑥月間クォータの集計月を JST 暦月に（`monthStartInZone` 新設）。
- **デプロイの教訓**: 3コマンド（rsync → build+入替 → migrate）を**逐次待ち**で実行すること。build 完了前に migrate を叩くと空振りし、**新コード稼働×列なし**の危険な窓ができる（今回発生 → 即補修。列存在・health 200・保護ルート 307/401・エラーログ0 を verified）。

## ▶ 次の一手 — Phase 2: 作らない、売る
コード側は売却価値に必要な基盤（課金台帳/解約表現/上限強制/セキュリティ）まで完了。**以降の価値はコードでなく課金顧客数**。
1. **有料10件の獲得**（billingExempt=false かつ active を10件）。訪問数/成約時間（実CAC）・断り理由 Top3・刺さった一言を記録。
2. この期間、**新機能は作らない**（要望は記録のみ）。
3. 10件到達後: トライアル/督促メール（1〜2日）→ 指標ダッシュボード（0.5〜1日）→ セルフサーブ登録（2〜4日）。
4. 撤退ライン: 3か月で10件未達なら「価格/対象業種/撤退」を再評価（機能追加では解決しない）。
※ E2E は production build 前提（`npm run dev` 後は `npm run build` してから `test:e2e`）。

## ✅ 完了済みデモ動線（手動確認可）
- `docker compose up -d` → `npm run db:seed` → `npm run dev`
- ランディング `/` → `/book/demo-salon`（予約ウィザード）→ `/booking/[token]`（確認・キャンセル）
- ログイン情報: admin@platform.test / owner@demo.test / staff@demo.test（全て password123）

## 🏁 ループ終了（ゴール達成・Iteration 20 で最終検収完了）
完了条件（可本地运行/可演示/コア予約フロー/後台管理/防超卖）は Iteration 6 で達成、以降 14 反復で工業級まで拡張。
最終全ゲート緑: **build ✓ / lint ✓ / typecheck ✓ / vitest 88 ✓ / E2E 2 ✓**。クリーンスレート初期化も検証済み。
残るは要件で「予約枠/将来拡張」と明記された Sentry・LINE・SMS・Stripe のみ（実装不要）。
→ 自走ループは目的達成のため停止。続きが必要なら `/loop` を再実行。

## 追加対応（ユーザーフィードバック）
- **P1 三点セット実装（サロン/リラク実用化）**:
  1) **コンボ予約**: 複数メニュー連続予約（最大3件）。エンジンを ChainPart（サービス連鎖）へ一般化 — 占有はサービス毎に連結、service容量はサービス別に判定、おまかせは全サービス共通担当の交差集合から割当、指名は全担当可を検証。既存単品は「長さ1の連鎖」で完全後方互換（既存37統合テスト無変更で緑）。
  2) **オプション（追加メニュー）**: ServiceOption + BookingItemOption（価格/名称スナップショット）。延長分は最終セグメントへ反映され空き判定にも効く。後台のメニュー編集にオプション行エディタ。
  3) **指名料**: Staff.nominationFeeJpy。指名時のみ合計へ加算（おまかせ自動割当は無料）。チップに「指名+¥xxx」バッジ、後台スタッフ編集に入力欄。
  - UI: メニュー多選カード（✓/ring）+ オプション展開 + 固定合計バー（名称・約X分・¥Y）、確認画面と公開詳細に明細内訳（サービス/オプション/指名料/合計）。
  - テスト +12（チェーン占有単体2 / コンボ統合5 / 既存修正含む）→ **97 vitest + 4 E2E 全緑**。
- **整站UI刷新**: ランディング（indigoグラデhero+特性カード+入口カード）、ログイン（アイコンバッジ+シャドウカード）、
  管理シェル（slate-950サイドバー+アクティブ左バー+アバターヘッダ）、StatCard（彩底アイコン）。Preview で確認済み。

- **UI 全体の美化**: ブランドカラーを洗練インディゴへ（globals.css の CSS 変数を一括更新 → 全体に波及）。
  予約ウィザード刷新: 接続線付きステッパー（完了✓/現在リング/未了）、ヘッダ（アイコンバッジ + sticky 半透明 + グラデ背景）、
  メニューカード（カラー側帯 + 所要pill + 価格 + ホバーリフト）、担当チップ、完了画面（成功グラデ + 大アイコン）。
  デスクトップ/モバイル(375px)を Preview で確認。build/lint/typecheck/test(90)/E2E(2) すべて緑。

- **日付選択を月カレンダー UI に刷新**: 横スクロールの日付ストリップ →「カレンダーらしい」月グリッドへ。
  前月/次月ナビ（当月〜+2ヶ月）、日曜赤・土曜青、過去日グレー、当月の○△×/休マーク、選択日ハイライト、凡例。
  モバイル(375px)で7列自動フィット・タップしやすいセル。`buildMonthGrid`/`addMonths` ヘルパー + 月単位の空き状況フェッチ（前回取得をマージ）。
  build/lint/E2E 緑、Preview でデスクトップ/モバイル確認済み。

- **日付の空き状況（○△×）**: 「項目を選ぶ前に満席だと無意味」というUXフィードバックに対応。
  サービス選択後、日付ストリップに ○空き/△残少/×満・休 を表示し、満/休の日は選択不可＋自動で最初の空き日へ移動。
  - 領域モデル上、空き時間はサービスに依存して算出されるため「サービス→日時」の順は維持（ホットペッパー等と同様）。満席は日付段階で可視化して解決。
  - 実装: repository `loadRangeContext`（範囲一括ロード, 数クエリ） + service `getDateAvailabilitySummary`（getDayAvailability と同一エンジン） + `GET /api/public/shops/[slug]/date-availability` + wizard 日付ストリップ。
  - test +2（OPEN/FULL/CLOSED 判定・範囲長）→ **90テスト緑**。E2E は disabled 日をスキップ対応。

## 全体ゴール（完了条件）

- [x] **ローカルで起動・デモ可能** ✅（docker + seed + dev で公開予約が動作）
- [x] **コア予約フロー完結**（公開予約 → 確認 → 完了 → キャンセル）✅ API+UI 動作確認済み
- [x] **並行予約の防超卖ロジック完成 + テスト緑** ✅（最重要・完了）
- [x] `npm run build` ✅ / `npm run lint` ✅ / `npm run test` 緑（58件）/ `npm run typecheck` ✅ / E2E ✅
- [x] **後台で管理可能**（認証+RBAC+全画面閲覧 + 予約状態の書込管理 + 監査ログ）✅ ※残: 各種編集フォーム(Iter7+)
- [x] README 完備

## 現在の起動状態（再開時の前提）
- docker compose: postgres(5432) + redis(6379) **起動中・healthy**
- DB: migration 3本適用済み（init / booking_anti_oversell / service_segments）
- Prisma client 生成済み
- .env 作成済み（.env.example のデフォルト値）
- まだ app/ ディレクトリ無し → `next build`/`next dev` は未実行（次イテレーションで app シェル作成）

## フェーズ進捗

### ✅ Iteration 1（基盤）— 完了
- [x] 環境確認（Node23 / Docker / 8core）
- [x] プロジェクト雛形・全設定ファイル（ts/next/tailwind/eslint/prettier/vitest/playwright）
- [x] `npm install`（661 packages, exit 0）
- [x] docker-compose（postgres16 + redis7, btree_gist 対応, TZ=UTC）
- [x] **Prisma schema 全テーブル**（tenants…notification_jobs + RBAC + plan/subscription/system_config）
  - 多租户 tenantId / ソフトデリート / UTC timestamptz / 占有区間=BookingItem モデル
  - schema valid 🚀

### ✅ Iteration 2（コア lib + ドメイン）— 完了
- [x] lib: env(zod), db, redis, queue(bullmq), time(UTC↔Asia/Tokyo), errors(日本語/code), logger(pino), monitoring(Sentry予約), rbac(権限カタログ+システムロール), utils
- [x] domain/booking: types, occupancy(複数時間帯+buffer), business-hours(祝日/臨時休業/特別営業), schedules(シフト解決), rules(window/lead/cancel/容量統合), capacity(ピーク並行スイープ), availability(エンジン本体)
- [x] domain ユニットテスト **50件 緑**

### ✅ Iteration 3（防超卖コア）— 完了 ★最重要
- [x] migration: init(25表) + btree_gist + **GiST排他制約** booking_items_no_staff_overlap + active同期トリガ + 部分index + service.segments
- [x] 排他制約を生SQLで検証（重複INSERT→23P01で拒否）
- [x] repository 層（tenant scoped, advisory lock helper）
- [x] **BookingService.createBooking**: Txn + advisory lock(shop,日) + ロック後容量再判定(エンジン再利用) + おまかせ割当 + 排他制約兜底 + idempotency
- [x] getDayAvailability（公開/管理用）
- [x] **並行テスト 3件 緑**: 8人→1成功 / 店舗容量3で10件→3成功 / idempotency重複→1件。**超卖ゼロ確認**
- [x] typecheck 緑 / 全 **53テスト緑**
- [x] README 作成

### ✅ Iteration 4（app シェル + seed + 公開予約フロー）— 完了
- [x] app シェル: layout(Noto Sans JP/ja), globals.css(shadcn変数), ランディング `/`
- [x] shadcn/ui: button/card/input/label/badge + cn
- [x] **`npm run build` 緑 / `npm run lint` 緑**
- [x] seed: 22権限/4ロール/63権限割当/3プラン/18祝日(2026)/デモ商家一式/デモ予約/3ユーザー
- [x] 入口層: Zod スキーマ + API helper + route handlers 5本（shop/availability/bookings/booking詳細/cancel）
- [x] 公開サービス層: getPublicShop / resolveShopIds / getBookingByToken / cancelBooking
- [x] **公開予約UI**: BookingWizard（メニュー→日時→情報→確認→完了, 満席/休業/不可を明示）+ 予約確認/キャンセルページ
- [x] **API e2e 手動検証**: 作成→満席化→キャンセル→復活（active同期トリガ込み）

### ✅ Iteration 5（認証 + 管理後台）— 完了
- [x] **Auth.js v5**（credentials/JWT, Edge安全な auth.config 分離）: auth.config/auth/route/middleware/session-loader/authorize
- [x] セッションに tenantId/isPlatformAdmin/permissions[]/shopScopes[]/tenantWide を格納（RBAC）
- [x] middleware で /admin /platform を保護。ログインページ + LoginForm + logout action
- [x] 監査ログサービス（writeAudit）
- [x] **商家後台 9ページ**: ダッシュボード/予約/顧客/スタッフ/メニュー/営業時間/休業特別営業/予約ルール/店舗設定（全て実データ・tenant隔離）
- [x] **プラットフォーム後台 6ページ**: ダッシュボード/商家/プラン/ユーザー/監査ログ/システム設定
- [x] AdminShell（サイドバー+モバイル対応）, 共通UI（PageHeader/StatCard/Table/StatusPill）
- [x] **認証フロー e2e 手動検証**: 未ログイン→307/login, ログイン→session(権限付), /admin 200, 非platform→/platform は307/admin, platform admin→/platform 200
- [x] **build / lint / test(53) / typecheck すべて緑**

### ✅ Iteration 6（後台書込 + 通知 + E2E）— 完了
- [x] 予約管理サービス（updateBookingStatus: 状態遷移検証 + Txn + event + 通知outbox）+ getBookingForAdmin
- [x] server actions（'use server' + Zod + requirePermission + assertShopAccess + writeAudit + revalidate）
- [x] 管理 予約詳細ページ /admin/bookings/[id]（状態管理ボタン: 完了/No-Show/キャンセル, 占有枠表示, 操作履歴）
- [x] **通知 worker**（BullMQ Worker + notification_jobs アウトボックス 10秒スイープ）→ 実DBで処理確認（2件 SENT）
- [x] 通知サービス（dispatch スタブ, LINE/メール/SMS 差込口）
- [x] **統合テスト 5件**（availability/満席/状態遷移/管理キャンセル枠解放/トークンキャンセル/キャンセル期限）
- [x] **E2E（Playwright）1件 緑**: 公開予約フロー完走（実ブラウザ）
- [x] next を 14.2.21→**14.2.35**（セキュリティパッチ）
- [x] **build / lint / test(58) / E2E / typecheck すべて緑**

### ✅ Iteration 7（管理 CRUD 編集フォーム）— 完了
- [x] 管理書込 Zod スキーマ（staff/service(segments)/shopSettings/specialDay/businessHours）
- [x] merchant-mutation-service（create/update/softDelete + tenant/shop 所有権検証 + Txn）
- [x] admin-actions（'use server' + Zod再検証 + requirePermission + assertShopAccess + writeAudit + revalidate）
- [x] **React Hook Form + zodResolver** フォーム: StaffForm / ServiceForm(useFieldArray segments) / ShopSettingsForm / SpecialDayForm + 削除ボタン群 + form-kit
- [x] ページ: staff new/[id], services new/[id], settings(編集化), calendar(追加/削除) + 一覧に新規/編集リンク
- [x] **統合テスト +6**（staff/service/settings/specialDay/businessHours CRUD + **テナント隔離**）
- [x] 全CRUD画面のレンダリング確認（認証下）
- [x] **build / lint / test(64) / typecheck すべて緑**

### ✅ Iteration 8（営業時間/容量ルール編集 + 代理予約）— 完了
- [x] 営業時間 編集UI（BusinessHoursForm: useFieldArray, 曜日別複数区間, HH:mm↔分）
- [x] 容量ルール 編集UI（CapacityRuleForm: scope別, updateCapacityRule service+action）
- [x] **管理代理予約**: adminAvailabilityAction + adminCreateBookingAction(source=ADMIN) + AdminBookingForm + /admin/bookings/new（既存 createBooking 流用 = 防超卖も効く）
- [x] 一覧に「代理予約」ボタン
- [x] **統合テスト +1**（容量ルール更新 + テナント隔離）→ test 65
- [x] 全新規画面レンダリング確認（認証下）
- [x] **build / lint / test(65) / typecheck すべて緑**

### ✅ Iteration 9（データ統計 + プラットフォーム書込）— 完了
- [x] **データ統計**: 商家ダッシュボードに 14日 予約トレンド（軽量SVG BarChart）+ 売上 + ステータス内訳（90日）。merchant-service に getBookingTrend / getStatusBreakdown
- [x] **プラットフォーム書込サービス**: createTenant（tenant+初期shop+営業時間+容量ルール+ownerユーザー+TENANT_OWNERメンバー, 一意性検証, Txn）/ setUserStatus / updatePlan
- [x] platform-actions（requirePermission + writeAudit）+ 商家作成フォーム/ページ + 一覧に「新規商家」
- [x] **統合テスト +4**（商家作成→オーナーが TENANT_OWNER 権限取得 / 重複拒否 / ユーザー停止+管理者保護 / プラン編集）→ test 69
- [x] ダッシュボード統計・商家作成ページのレンダリング確認
- [x] **build / lint / test(69) / typecheck すべて緑**

### ✅ Iteration 10（プラットフォームUI配線 + SMTPメール送信）— 完了
- [x] プラットフォーム UI: ユーザー停止/有効化ボタン（/platform/users）、プラン編集フォーム+ページ（/platform/plans/[id]）
- [x] **SMTP メール送信**: nodemailer 導入、email.ts（lazy transport, env ガード）、templates.ts（確定/キャンセル/リマインド/変更の日本語本文+キャンセルリンク）
- [x] notification-service が EMAIL を予約詳細から本文生成→SMTP送信（未設定ならログ）。**実DBで end-to-end 確認**（worker が件名「【…】ご予約を承りました」を生成、SENT）
- [x] **メールテンプレート単体テスト +3** → test 72
- [x] **build / lint / test(72) / typecheck すべて緑**

### ✅ Iteration 11（管理E2E + アクセシビリティ + README）— 完了
- [x] **管理フロー E2E**（Playwright）: ログイン→代理予約→予約詳細。**緑**（公開フローと合わせ E2E 2件）
- [x] アクセシビリティ: form-kit `Field` が useId+cloneElement で label と入力を紐付け（htmlFor/id + aria-invalid）
- [x] README にデモ動線表（URL/アカウント）+ 確認手順を追記
- [x] **build / lint / test(72) / E2E(2) / typecheck すべて緑**

### ✅ Iteration 12（スタッフシフト編集 + 顧客詳細）— 完了
- [x] **スタッフシフト編集 UI**（排班完成）: 曜日シフト全置換 + 特定日 出勤/欠勤 override。schema/service/action/UI（/admin/staff/[id]/schedule）
- [x] **顧客詳細ページ**（/admin/customers/[id]）: 顧客情報 + 累計利用額 + 予約履歴
- [x] **統合テスト +1**: シフト編集→エンジン連動（欠勤 override で当日全スロット予約不可）→ test 73
- [x] 新規ページのレンダリング確認
- [x] **build / lint / test(73) / typecheck すべて緑**

### ✅ Iteration 13（リマインド通知 + 平台商家詳細）— 完了
- [x] **リマインド通知のスケジュール**: 予約作成時に開始24h前の BOOKING_REMINDER を scheduledAt 付き outbox 投入。キャンセル/No-Show で未送信リマインドを無効化（公開/管理 両経路）
- [x] worker は scheduledAt<=now のみ送信 → 時刻到来までリマインドは送られない
- [x] **平台 商家詳細**（/platform/tenants/[id]）: 店舗/ユーザー一覧 + 予約数 + 予約ページリンク。一覧から遷移
- [x] **統合テスト +1**: リマインドが24h前にスケジュール + キャンセルで無効化 → test 74
- [x] **build / lint / test(74) / typecheck すべて緑**

### ✅ Iteration 14（ヘルスチェック + Dockerfile + 全量検収）— 完了
- [x] **ヘルスチェック** `GET /api/health`（DB+Redis 疎通, 正常200/異常503）→ 実測 200 確認
- [x] **本番 Dockerfile**（マルチステージ / standalone）+ .dockerignore。standalone 産物（server.js/内蔵node_modules/static）を検証
- [x] **最終全量検収すべて緑**: build ✓ / typecheck ✓ / lint ✓ / vitest(74) ✓ / E2E(2) ✓
- [x] README にヘルスチェック/Dockerfile を追記

### ✅ Iteration 15（公開API入口層の集成テスト）— 完了
- [x] **route handler 集成テスト +7**（tests/integration/public-api.test.ts）: NextRequest で GET shop(200/404) / GET availability(200/400検証×2) / POST booking(400 refine / 201) を直接検証 → route()包装 + Zod + エラー正規化を網羅
- [x] test 81（12ファイル）/ lint 緑
- [x] README テスト件数を 81 に更新（正確な内訳）

### ✅ Iteration 16（RBAC 境界テスト）— 完了
- [x] **RBAC 境界 集成テスト +5**（tests/integration/rbac-actions.test.ts）: auth() を vi.mock し updateShopSettingsAction で 未ログイン→UNAUTHORIZED / 権限なし→FORBIDDEN / 店舗スコープ外→FORBIDDEN / 別テナント→拒否 / 正当→成功+DB更新 を検証。mock 漏れなし（全13ファイル緑）
- [x] test 86（13ファイル）/ lint 緑。README 件数更新

### ✅ Iteration 17（商家 操作ログ ビュー）— 完了
- [x] 商家後台に **操作ログ**（/admin/logs）: tenantId スコープの監査ログを実行者/操作/対象/日時で一覧。AUDIT_READ 権限ゲート（無権限はメッセージ）。ナビに追加。実データで描画確認
- [x] merchant-service.listTenantAuditLogs。action の日本語ラベル化
- [x] build / lint / test(86) 緑

### ✅ Iteration 18（防超卖コアのテスト強化）— 完了
- [x] **高並行ストレス**: 20件が容量5を同時に奪い合い → 成功厳密5件・DBオーバーブッキングゼロ
- [x] **GiST 排他制約の自動テスト**（DB最終防御線）: アプリ層を迂回して同一スタッフ重複を直接挿入 → 23P01 で拒否されることを検証（Iter3 の手動確認を自動化）
- [x] 並行統合 5件に拡充 → test **88** / lint 緑。README 更新

### ✅ Iteration 19（アーキテクチャ深掘り文書）— 完了
- [x] **docs/ARCHITECTURE.md**: レイヤー責務 / 防超卖の多層防御（ロック粒度の根拠・ピーク並行容量・占有モデル）/ 時刻モデル / マルチテナント隔離 / 予約エンジン / Outbox通知 / 拡張点 / テスト戦略
- [x] README から導線。文書内の参照（トリガ名/制約名/ファイルパス）を実在確認
- [x] コード変更なし → test 88 / build / lint 緑のまま

### ✅ Iteration 20（クリーンスレートからの初期化検収）— 完了
- [x] **`prisma migrate reset --force`** で空DBから全3 migration を順次再適用 + seed 自動実行が成功
- [x] reset 後も btree_gist 拡張 / 排他制約 / トリガ / 25テーブルが存在、seed データ正常（22権限/4ロール/18祝日/デモ商家一式）
- [x] 新DB上で **全88テスト緑** → migration 順序・防超卖DB対象の再現性・seed 冪等性・README 手順を実証
- [x] 「数据库初始化 / 可本地运行」をゼロから再現確認

### 🔜 Iteration 21+（余白・任意）— 次やる
- simplify（共有 Row）/ （将来拡張枠）Sentry・LINE・SMS・Stripe。要件は完全充足・全ゲート緑。
- [ ] Auth.js v5（credentials, JWT）+ RBAC 権限チェック
- [ ] server actions / route handlers（Zod 入口）+ 監査ログ
- [ ] availability API / booking API + 集成テスト

### 🔜 Iteration 5（UI）
- [ ] shadcn/ui 基盤 + globals.css + レイアウト
- [ ] 公開予約フロー（店舗→サービス→スタッフ→日付→時間→入力→確認→完了→キャンセル）
- [ ] 商家後台（店舗/スタッフ/サービス/営業時間/休業/容量/予約一覧/顧客/統計）
- [ ] プラットフォーム後台（商家/プラン/ユーザー/設定/監査ログ）

### 🔜 Iteration 6（仕上げ）
- [ ] seed（デモテナント/店舗/スタッフ/サービス/祝日2026 + デモ予約）
- [ ] E2E（Playwright）公開予約フロー
- [ ] build/test/lint 全緑化、エラー修正
- [ ] README（起動/デプロイ/環境変数/DB初期化）完成
- [ ] next を 14.2.21 → 最新パッチ（セキュリティ）へ更新

## 重要な設計判断（再開時に思い出すこと）

- **防超卖戦略（多層防御）**:
  1. `pg_advisory_xact_lock(hashtextextended(resourceKey))` で (リソース, スロット) 単位に直列化
  2. 同一Txn内で容量を再カウント（権威チェック）
  3. staff の二重予約は GiST 排他制約 `EXCLUDE USING gist (staff_id WITH =, tstzrange(start,end) WITH &&) WHERE active` でDBが保証
  4. `idempotencyKey` unique で二重送信防止
- **占有区間 = BookingItem**。容量/重複は item 粒度。`active` 列で排他対象を制御（キャンセルで false、トリガで同期）。
- **時刻**: 保存UTC。営業時間/シフトは「店舗ローカル分(0-1440)」整数。表示は date-fns-tz で Asia/Tokyo。
- **データ隔離**: リポジトリ層で必ず tenantId スコープ。+ 任意で RLS migration（defense-in-depth）。
- **層**: app(page) → actions/route(入口・Zod) → service(業務) → repository(DB) → domain(ルール)。
- バージョン注意: next-auth=5.0.0-beta.25, prisma=5.22, next=14.2.21(要パッチ更新), date-fns=3。

## 既知の TODO / リスク
- next@14.2.21 セキュリティ告警 → 最終で 14.2.x 最新へ。
- Sentry/Stripe/LINE/SMS は抽象化のみ実装（予約枠）。実送信は未配線。
- Node23 は Next14 の公式範囲外だが現状動作。問題出たら nvm で 20 系に。
