# SP-07 — notifications + audit + e2e (通知 + 監査ログ + 仕上げ)

## 1. 目的

アプリ内通知（インボックス）、メール通知配信（Resend + React Email）、監査ログ記録・閲覧、Sentry の PII フィルタ、UC-01〜UC-05 の Playwright E2E を完成させ、Phase 1 (MVP) の本番投入準備を整える。`pm` 完了確認モードで `## PHASE_COMPLETE` を確認するための仕上げスプリント。

## 2. 対応機能 ID

P0：**F-052, F-053, F-055** + 横断（既存通知発火ポイントの接続、E2E、観測性整備）

参照：`docs/02 §1.8-F-052 §F-053 §F-055 §UC-01〜UC-05`, `docs/03 §4.4 §4.11 §14-6`, `docs/04 §1.3 S-049 §1.7 S-078〜S-085`, `docs/05 §3.7 §4.9 §5 §6.5 §6.7 §6.9 §10`

## 3. タスク一覧

| ID | 概要 | 受け入れ基準（要旨） | 対応機能 ID | 工数 |
|---|---|---|---|---|
| T-07-01 | Prisma schema 拡張（Notification / NotificationDelivery / NotificationPreference / AuditLog） | docs/05 §3.7 のテーブル、enum（NotificationType, NotificationChannel, DeliveryStatus, AuditAction）、RLS、`@@index([recipientUserId, readAt])` | F-052, F-053, F-055 | M |
| T-07-02 | NotificationService（dedupKey + 30 種類のイベント発火） | `notify(input)` API、dedupKey = `${type}:${userId}:${targetId}`、Assumption 13 の 1 時間以内重複排除、提案書 §9.1〜9.3 の主要 20 種を実装 | F-052 | L |
| T-07-03 | 既存業務 Server Action からの通知発火接続 | SP-03〜SP-06 で実装した主要 Server Action（イベント候補公開 / 開催体制決定 / マエカク結果連絡 / 契約成立 / 月次提出 等）に `notify(...)` 呼び出しを追加 | F-052, F-053, F-019, F-023, F-036, F-040, F-049 等 | M |
| T-07-04 | アプリ内通知 UI（ベル + インボックス）(S-078/S-079) | ヘッダにベル + 未読バッジ、`/notifications` 一覧、既読・全既読操作、30 秒ポーリング | F-052 | M |
| T-07-05 | メール送信（React Email + Resend + 再試行） | `packages/email/` に React Email テンプレート（招待 / パスワードリセット / 希望期限近接 / マエカク結果連絡 / 契約成立 / 月次提出 等 主要 8 種）、`notification.send_email` ジョブで Resend に送信、PII マスク適用 | F-053 | L |
| T-07-06 | 通知設定 UI (S-080) | `notification.updatePreferences(input)`、チャネル別（inApp/email/LINE は Phase 2 で disabled）× type 別 ON/OFF | F-052, F-053 | S |
| T-07-07 | リマインダ cron `reminder.dispatch` | docs/05 §5.2 — 希望期限 24h 前 / イベント前日 / 施工 7 日前 / 申請 14 日前 / マエカク 24h 未対応 / 月次未提出 の 6 種を 5 分間隔で実行 | F-052, F-053, 横断 | M |
| T-07-08 | AuditService + 主要 Server Action への監査ログ記録 | `apps/web/lib/audit/audit-service.ts` に `recordAudit(actor, action, target, before, after)`、SP-02〜SP-06 の重要 Server Action（マスタ変更 / プラン変更 / キャンセル / 粗利手動調整 / 月次確定 / unlock / REVEAL_PII 等）に記録呼び出しを追加 | F-055 | L |
| T-07-09 | 監査ログ閲覧画面 (S-084 / S-085) | `GET /api/audit-logs?actor=&action=&from=&to=&page=`、wholesaler_admin / saas_admin で閲覧、PII マスク適用、ログは追記専用（UPDATE/DELETE 不可） | F-055 | M |
| T-07-10 | Sentry PII フィルタ + 観測性仕上げ | `beforeSend` で電話・住所・氏名を匿名化（docs/03 §14-6）、ジョブキュー滞留・5xx > 1% アラート設定、UptimeRobot に本番 URL 登録 | docs/02 §5.4 / §5.3, docs/03 §14-6 | M |
| T-07-11 | UC-01〜UC-05 統合 E2E スイート整備 | 既存の各 UC spec が CI で安定 green、`pnpm exec playwright test` で並列実行可能、Storage state によるロール切替を共通 fixture 化 | UC-01〜UC-05 | M |
| T-07-12 | 本番投入リハーサル + ドキュメント整備 | Railway production プロジェクト構築、migration deploy、シード投入、UptimeRobot 監視、`docs/sprints/SP-07-*.md` 末尾にロールアウトチェックリスト記載 | 横断 | M |

## 4. タスク詳細

### T-07-01 Prisma schema 拡張

- **何を実装**: docs/05 §3.7 の Notification / NotificationDelivery / NotificationPreference / AuditLog。enum 群を packages/contracts/enums.ts に追加。AuditLog は INSERT 専用とするため RLS ポリシーで UPDATE/DELETE を禁止（saas_admin のみ可）。
- **参照**: docs/05 §3.7 §3.9
- **完了判定**: migration green、AuditLog の UPDATE/DELETE が DB レベルでブロックされることを Vitest 2 ケース。

### T-07-02 NotificationService

- **何を実装**:
  - `apps/web/lib/notifications/notification-service.ts` に `notify({type, recipientUserIds, payload, channels, dedupKey?})`
  - dedupKey デフォルトは `${type}:${userId}:${targetId}`（docs/05 §15-6）
  - 1 時間以内に同一 dedupKey が存在すれば no-op（docs/02 §7-Assumption 13）
  - `NotificationDelivery` を channels（IN_APP / EMAIL / LINE-disabled）ごとに作成し、enqueue
- **参照**: docs/05 §6.7
- **完了判定**: Vitest で
  - 同一 dedupKey 1 時間以内の重複排除
  - 複数 recipient への配信
  - チャネル別 Delivery 作成
  3 ケース green。

### T-07-03 既存 Server Action への発火接続

- **何を実装**: 以下に `notify(...)` を追加：
  - F-019 イベント候補公開 → 対象二次店全員へ
  - F-023 開催体制決定 → 自社要員 + 対象二次店
  - F-036 マエカク結果連絡 → 対象二次店
  - F-040 契約成立 → 関連二次店 + wholesaler_admin
  - F-043 キャンセル → wholesaler_admin
  - F-049 月次コメント提出 → wholesaler_admin
  - F-050 月次確定 → 関連二次店
  - その他、docs/02 各機能の通知発火基準
- **参照**: docs/02 各機能受け入れ基準
- **完了判定**: 各接続後に Vitest で通知レコードが 1 件以上生成されることを確認。

### T-07-04 アプリ内通知 UI

- **何を実装**: 全レイアウトのヘッダに `<NotificationBell />` を追加（shadcn `Popover` + 未読バッジ）。`app/(common)/notifications/page.tsx` (S-078) と詳細 (S-079)。`notification.markRead(input)` で `{ids?: string[], all?: true}`。30 秒ポーリング（`useSWR` + `refreshInterval: 30000`）。
- **参照**: docs/02 §F-052、docs/04 §1.7
- **完了判定**: ベル → 未読 → 既読の体験が Playwright spec 1 件で確認。

### T-07-05 メール送信

- **何を実装**:
  - `packages/email/templates/` に React Email テンプレート 8 種
    - `InviteUser.tsx`, `ResetPassword.tsx`, `PreferenceDeadlineSoon.tsx`, `EventDecided.tsx`, `PreCallResult.tsx`, `ContractCreated.tsx`, `MonthlyReportSubmitted.tsx`, `MonthlyReportFinalized.tsx`
  - 全テンプレートで `MaskingService` を適用（電話下 4 桁・住所市区町村・氏名は姓のみ）
  - `notification.send_email` ジョブで Resend SDK 呼び出し、`maxAttempts: 3`、`1m → 5m → 30m` 再試行
  - 失敗時は `delivery.status=FAILED` + `lastError`、3 回失敗で WS_ADMIN へアプリ内通知
- **参照**: docs/02 §F-053、docs/03 §4.4、docs/05 §5.2
- **完了判定**: Vitest で
  - テンプレートに `purchasePrice` / フルアドレス / フル電話番号が含まれない
  - 再試行 3 回後の FAILED 遷移
  3 ケース green。

### T-07-06 通知設定 UI

- **何を実装**: `app/(common)/settings/notifications/page.tsx` (S-080)。`notification.updatePreferences({channels, types})` Server Action。`NotificationPreference` テーブルで管理。LINE チャネルは Feature Flag `FEATURE_LINE_NOTIFICATIONS=false` で UI 上 disabled 表示。
- **参照**: docs/02 §F-052 §F-053 §F-054（Phase 2）、docs/04 §1.7
- **完了判定**: 設定が永続化、`notify` 時に preferences で除外される、Vitest 2 ケース。

### T-07-07 リマインダ cron

- **何を実装**: `apps/worker/src/tasks/reminder.dispatch.ts` で 6 種類のリマインダを 5 分間隔で実行。各々 dedupKey で重複防止。crontab (`*/5 * * * * reminder.dispatch`)。
- **参照**: docs/05 §5.2 §5.3
- **完了判定**: Vitest で 6 種の発火条件が独立に動作。

### T-07-08 AuditService + 接続

- **何を実装**:
  - `apps/web/lib/audit/audit-service.ts` に `recordAudit(actor, action, target, before, after)`
  - `AuditAction` enum: USER_INVITE, USER_REVOKE, ROLE_CHANGE, RELATIONSHIP_CREATE, RELATIONSHIP_SUSPEND, SCOPE_OVERRIDE, MASTER_UPDATE (venue/product/installer/incentive_rate), WHOLESALER_SETTINGS_UPDATE, PLAN_CHANGE, GROSS_PROFIT_MANUAL_ADJUST, INCENTIVE_ADJUST_JOINT, CONTRACT_CANCEL, MONTHLY_FINALIZE, MONTHLY_UNLOCK, REVEAL_PII
  - 上記アクションを行う Server Action 各々に `recordAudit` を埋め込む（最低 15 箇所）
  - PII マスキングを表示時に適用
- **参照**: docs/02 §F-055、docs/05 §6.9
- **完了判定**: 各アクション後に AuditLog が記録されることを Vitest 15 ケース。

### T-07-09 監査ログ閲覧画面

- **何を実装**: `app/(wholesaler)/audit-logs/page.tsx` (S-084) と `app/(saas-admin)/audit-logs/page.tsx` (S-085)。`GET /api/audit-logs?actor=&action=&from=&to=&page=`、shadcn DataTable + フィルタ。PII マスク済み表示、90 日以前はアーカイブ表示。
- **参照**: docs/02 §F-055
- **完了判定**: 編集・削除不可、PII マスク確認、Playwright spec 1 件。

### T-07-10 Sentry PII フィルタ + 観測性

- **何を実装**:
  - Sentry の `beforeSend` で電話番号・住所・氏名を正規表現で検出・置換（docs/03 §14-6）
  - Sentry alerts: 5xx > 1%/分、ジョブキュー滞留 > 100 件、DB 接続失敗 > 3 回連続
  - UptimeRobot に本番 URL 登録、業務時間帯（8:00–22:00 JST）重点監視設定
  - メトリクス `metrics` テーブルに日次バッチで KPI 書き込み（docs/03 §9.3）
- **参照**: docs/03 §14-6、docs/05 §10.2 §10.3 §10.4
- **完了判定**: dev エラーに電話番号がマスクされて届く、UptimeRobot 監視が稼働。

### T-07-11 UC-01〜UC-05 統合 E2E スイート

- **何を実装**: SP-03〜SP-06 で作成した UC spec を `tests/e2e/uc/` に整理、Storage state 切替を `tests/e2e/fixtures/auth.ts` で共通 fixture 化、`pnpm exec playwright test --workers=2` で並列実行。CI の `e2e` ジョブで main マージ前に必ず実行。
- **参照**: docs/02 §UC-01〜UC-05、docs/05 §11.3
- **完了判定**: 5 つの UC spec が CI で連続 10 回 green（flake 0）。

### T-07-12 本番投入リハーサル

- **何を実装**:
  - Railway production プロジェクト作成（Web + Worker + Postgres Pro）
  - `prisma migrate deploy` の releaseCommand 設定
  - Resend で本番送信ドメイン認証
  - R2 production bucket 作成
  - Sentry production プロジェクト分離
  - シード（パイロット卸業者分のみ）
  - 本書末尾に「ロールアウトチェックリスト」を追記
- **参照**: docs/03 §8.3 §9.2
- **完了判定**: 本番 URL に `wholesaler_admin` でログインでき、UC-01〜UC-05 を本番環境で 1 周走らせて手動検証。

## 5. テスト計画

**Vitest**：

- NotificationService dedupKey 3 ケース
- メールテンプレートの PII マスク 3 ケース
- AuditLog UPDATE/DELETE 拒否 2 ケース
- 各業務アクションの監査ログ記録 15 ケース
- 通知設定の preferences フィルタ 2 ケース

**Playwright**：

- UC-01〜UC-05 統合 E2E（5 spec、CI 並列実行）
- `tests/e2e/notifications/inbox.spec.ts`
- `tests/e2e/audit-logs/wholesaler-view.spec.ts`

## 6. 完了判定

- 上記 12 タスク全て `## DONE`
- Vitest / Playwright が CI で連続 green
- UC-01〜UC-05 の全 spec が安定（flake 0、10 回連続 green）
- アプリ内通知 + メール通知 + 監査ログが全業務フローで発火・記録される
- Sentry PII フィルタが有効、UptimeRobot で本番監視
- 本番環境に Railway デプロイ済み、パイロット卸業者シード投入済み
- 本書末尾のロールアウトチェックリストが全項目チェック済み
- `pm` 完了確認モードで Phase 1 (MVP) 全体を検証し `## PHASE_COMPLETE` 出力

## 7. ロールアウトチェックリスト（本番投入前）

### インフラ構築

- [ ] Railway production プロジェクト作成（Web サービス + Worker サービス + Postgres Pro プラン）
- [ ] Railway 環境変数設定（`railway.toml` + `.env.example` の全項目を Railway ダッシュボードで設定）
  - `DATABASE_URL` / `DIRECT_URL` — Railway Postgres 接続文字列（自動注入）
  - `AUTH_SECRET` — `openssl rand -base64 32` で生成
  - `AUTH_URL` / `NEXT_PUBLIC_APP_URL` — 本番カスタムドメイン
  - `AUTH_TRUST_HOST=true` — Railway プロキシ対応
  - `PII_ENCRYPTION_KEY` — `openssl rand -hex 32` で生成
  - `NODE_ENV=production`
  - `RESEND_API_KEY` / `RESEND_FROM_ADDRESS` / `RESEND_FROM`
  - `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_PUBLIC_BASE_URL`
  - `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_ENVIRONMENT=production`
  - `LOG_LEVEL=info` / `LOG_PRETTY=false`
  - `WORKER_CONCURRENCY` / `WORKER_POLL_INTERVAL_MS`
  - `FEATURE_LINE_NOTIFICATIONS=false` / `FEATURE_CSV_IMPORT=false`
- [ ] Postgres Pro プラン契約・バックアップスケジュール（日次）確認
- [ ] Web サービス Release Command を `pnpm db:migrate:deploy` に設定
- [ ] Worker サービスの Start Command を `pnpm --filter @solar/worker start` に設定

### DB・シード

- [ ] `prisma migrate deploy` が Release Command 経由で正常実行されることを確認
- [ ] `pnpm db:seed` 実行 — 初期 SaaS admin アカウント + パイロット卸業者テナントを投入
- [ ] パイロット卸業者の `wholesaler_admin` 初回ログイン手順書を共有

### 外部サービス

- [ ] Resend ドメイン認証（SPF / DKIM / DMARC）完了・送信テスト
- [ ] R2 production bucket 作成・CORS 設定・CDN 経路（`R2_PUBLIC_BASE_URL`）確認
- [ ] Sentry production プロジェクト作成・`beforeSend` PII フィルタ有効・アラート設定
  - 5xx > 1%/分
  - ジョブキュー滞留 > 100 件
  - DB 接続失敗 > 3 回連続
- [ ] UptimeRobot 監視設定（本番 URL、業務時間帯 8:00–22:00 JST 重点監視）

### セキュリティ・運用

- [ ] 2FA 必須化を強制（`saas_admin` / `wholesaler_admin`）
- [ ] 障害復旧手順（migration rollback / 前バージョン即時切替）を Runbook 化
- [ ] 業務時間帯（8:00–22:00 JST）監視体制の確認

### 動作確認

- [ ] smoke test — ログイン → ダッシュボード → マスタ登録（商品・会場・施工業者）の基本フロー確認
- [ ] UC-01〜UC-05 を本番環境で手動 1 周（金額・粗利・インセンティブ確定の数値を検算）
- [ ] アプリ内通知 + メール通知がイベント発火で届くことを確認
- [ ] 監査ログが主要アクション後に記録されることを確認

### 後続計画

- [ ] Phase 2 (LINE / CSV / BI 強化) ロードマップを `docs/dev-plan.md` に追記
