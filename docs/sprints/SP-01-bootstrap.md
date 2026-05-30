# SP-01 — bootstrap (基盤)

## 1. 目的

モノレポ初期化、Prisma スキーマ初版、Auth.js v5 + 2FA、テナント分離基盤（Prisma extension + PostgreSQL RLS）、Railway 環境（Web + Worker + Postgres）、観測性（Sentry + pino + UptimeRobot）、シードデータ、graphile-worker 起動、Resend / R2 接続確認までを完成させる。後続スプリント全てが並列着手できるよう、テナント基盤を最優先で固める。

## 2. 対応機能 ID

P0/P1 主要：**F-001, F-002, F-003, F-004, F-006, F-007, F-008, F-009, F-010**
横断・準備：認証・テナント・ロール・RLS・Prisma extension・graphile-worker 起動・Sentry/pino/UptimeRobot 配線・シード（F-005 はマスタ画面側を SP-02 で）

参照：`docs/02 §1.1`, `docs/02 §F-001〜F-010`, `docs/03 §4.1 §4.2`, `docs/05 §2 §3.2 §3.9 §6.6 §6.10 §10 §14-1`

## 3. タスク一覧

| ID | 概要 | 受け入れ基準（要旨） | 対応機能 ID | 工数 |
|---|---|---|---|---|
| T-01-01 | pnpm モノレポ初期化 + ディレクトリ構成 | `apps/web`, `apps/worker`, `packages/{db,contracts,auth,storage,email,ui}` が生成、`pnpm install` が通る、tsconfig path alias 動作 | 横断 | S |
| T-01-02 | Lint/Format/CI 雛形 (ESLint flat config + Prettier + husky + GitHub Actions) | `pnpm lint`, `pnpm format`, `pnpm typecheck` が green、PR で同 workflow が走る | 横断 | S |
| T-01-03 | Prisma schema 初版（認証・テナント・ロール・RLS 対象テーブル） | docs/05 §3.2 の Tenant/User/UserRole/Relationship/InviteCode/WholesalerSettings/LoginAttempt/TotpSecret/BackupCode が生成、`pnpm db:migrate dev` 成功 | F-004, F-006, F-007, F-009, F-010 | M |
| T-01-04 | PostgreSQL RLS ポリシー + Prisma Client extension | docs/05 §3.9 の RLS ポリシー DDL を migration に含める、Prisma `$extends` で `wholesalerId` / `relationshipId[]` 条件を全 findMany / findFirst に自動付与、Vitest で「他テナントデータ 0 件」テスト 5 件以上 green | F-009, docs/02 §4.8 | L |
| T-01-05 | Auth.js v5 + Credentials Provider + argon2 パスワード hash | `loginAction(input)` で正常ログイン・失敗 5 回 15 分ロック・`sessionVersion` 強制ログアウトが動作。Vitest で 3 ケース green | F-001 | M |
| T-01-06 | TOTP 2FA セットアップ + 検証 + バックアップコード | `setupTotpAction()` で QR + 8 個のバックアップコード発行、`verifyTotpAction()` で TOTP 検証、バックアップコード 1 個使用で無効化、`saas_admin` / `wholesaler_admin` は 2FA 未設定なら強制誘導 | F-002 | M |
| T-01-07 | パスワードリセット（メール）+ 招待トークン基盤 | 30 分有効リンクで `resetPasswordAction()` 成功、`InviteCode` + `acceptUserInviteAction()` 経路が動作、Vitest で期限切れ / 1 回限り検証 | F-003, F-006, F-007, F-008 | M |
| T-01-08 | `getTenantContext()` + `withTenant()` + `assertCan()` ガード | docs/05 §6.6 / §6.10 の API に従い、Server Action 冒頭の三段（getSession → assertCan → getTenantContext）を実装、`SET LOCAL app.current_wholesaler_id` が発行されることを統合テストで確認 | F-009, 横断認可 | M |
| T-01-09 | 共通レイアウト（auth / onboarding / role 別グループ）+ shadcn/ui 初期セットアップ | `app/(auth)/login/page.tsx`（S-001）、`app/(auth)/mfa/page.tsx`（S-002/S-003）、`(saas-admin)` / `(wholesaler)` / `(dealer)` / `(field)` / `(common)` のレイアウトファイル雛形、shadcn `Button`/`Input`/`Form`/`Dialog`/`Sheet` 導入 | S-001〜S-012 部分、F-001, F-002, F-003 | M |
| T-01-10 | graphile-worker 起動 + Resend + R2 接続確認 | `apps/worker` の bootstrap、`notification.send_email` ジョブが Resend のテストモードで送信可、R2 への pre-signed URL 発行が成功、`pnpm dev:worker` で常駐 | F-053 前準備, docs/03 §4.4 §4.5 §4.6 | M |
| T-01-11 | Sentry + pino + UptimeRobot 配線 + `/api/health` | Sentry が Web/Worker 両方で初期化、pino 構造化ログに request_id が乗る、`/api/health` が 200 を返し UptimeRobot 監視対象として登録、docs/03 §14-6 (PII フィルタ `beforeSend`) は TODO コメントで残置 | docs/02 §5.4, docs/05 §10 | S |
| T-01-12 | シードスクリプト（パイロット卸業者 1 社 + 二次店 3 社 + 関係 + 各ロールユーザー） | `pnpm db:seed` で再現可能、E2E フィクスチャとしても使える、Auth.js でログインまで通る | 横断 | M |

## 4. タスク詳細

### T-01-01 pnpm モノレポ初期化 + ディレクトリ構成

- **何を実装**: `pnpm-workspace.yaml`、ルート `package.json`、`apps/web/`、`apps/worker/`、`packages/db/`、`packages/contracts/`、`packages/auth/`、`packages/storage/`、`packages/email/`、`packages/ui/`、`tests/e2e/` の雛形。Next.js 15、TypeScript 5.6、Node 22 LTS。
- **参照**: docs/03 §2.1, §8.4、docs/05 §2.1
- **完了判定**: `pnpm install` が green、`pnpm -F web build` が成功（空ページで OK）、`tsc --noEmit` が全 workspace で通る。

### T-01-02 Lint/Format/CI 雛形

- **何を実装**: ESLint flat config (Next.js 公式 + `eslint-plugin-import`)、Prettier + `prettier-plugin-tailwindcss`、husky + lint-staged、GitHub Actions（typecheck / lint / unit / prisma-validate / build）。
- **参照**: docs/03 §2.5, §9.1
- **完了判定**: `pnpm lint`/`pnpm format --check`/`pnpm typecheck` が green、CI が PR で全 job 緑。

### T-01-03 Prisma schema 初版

- **何を実装**: `packages/db/prisma/schema.prisma` に docs/05 §3.2 のテーブル群（Tenant, WholesalerSettings, User, UserRole, Relationship, InviteCode, TotpSecret, BackupCode, LoginAttempt, AuditLog の最低限）。Decimal(14,2)/(5,2) 規約、enum の型化、`@@index` 付与。
- **参照**: docs/05 §3.1 §3.2、docs/02 §4.2
- **完了判定**: `pnpm db:migrate dev` 成功、`prisma generate` で型が出力、`pnpm typecheck` green。

### T-01-04 RLS ポリシー + Prisma Client extension

- **何を実装**:
  - migration に PostgreSQL の RLS DDL（docs/05 §3.9 をベース、`USING (wholesaler_id = current_setting('app.current_wholesaler_id')::text)` 等）を追加
  - `packages/db/src/extension.ts` に Prisma `$extends` を実装。`findMany` / `findFirst` / `findUnique` のクエリに `where: { wholesalerId | relationshipId: { in: [...] } }` を自動注入
  - `apps/web/lib/tenancy/with-tenant.ts` で `withTenant(ctx, fn)` を実装し、`tx.$executeRaw\`SET LOCAL app.current_wholesaler_id = ${ctx.wholesalerId}\`` を発行
- **参照**: docs/03 §4.2、docs/05 §3.9 §6.6
- **完了判定**: Vitest 統合テストで「テナント A コンテキストでテナント B のデータが返らない（0 件）」「`bypass=true` 経由で saas_admin はクロステナント取得可」「アプリ層をすり抜けても DB が 0 件で返す（RLS 単独）」を計 5 ケース以上 green。

### T-01-05 Auth.js v5 + Credentials Provider + argon2

- **何を実装**: `packages/auth/` に Auth.js v5 (`next-auth ^5.0.0-beta.25`) 設定、Credentials Provider、JWT セッション (`AUTH_SESSION_MAX_AGE_SEC=86400`)、`sessionVersion` チェック、`LoginAttempt` テーブルで失敗 5 回 / 15 分ロック、argon2id でパスワード hash。
- **参照**: docs/03 §4.1、docs/05 §3.2 §6.10 §6.10-AuthService、docs/02 §F-001 受け入れ基準
- **完了判定**: Vitest で (1) 正常ログイン (2) 5 回失敗で 15 分ロック (3) `sessionVersion` インクリメントで強制ログアウト の 3 シナリオが green。

### T-01-06 TOTP 2FA

- **何を実装**: `packages/auth/totp.ts` に `otpauth` + `qrcode` で QR 発行、`TotpSecret` テーブルへ保存（argon2 で hash）。`BackupCode` 8 個を 1 回使用で無効化。`saas_admin` / `wholesaler_admin` は `twoFactorRequired=true` で未設定ログイン時に `/mfa/setup` (S-003) へ強制誘導。
- **参照**: docs/03 §4.1、docs/05 §3.2 §6.10、docs/02 §F-002 受け入れ基準
- **完了判定**: Vitest で (1) TOTP コード検証成功・失敗 (2) バックアップコード 1 個使用で再利用不可 (3) 必須ロール未設定で `/mfa/setup` リダイレクト の 3 シナリオが green。

### T-01-07 パスワードリセット + 招待トークン

- **何を実装**: `requestPasswordResetAction` / `resetPasswordAction` を Server Action で実装、30 分有効トークン（argon2 hash 保存）、Resend テストモードでメール送信。`InviteCode`（卸業者発行、回数上限・有効期限）+ `acceptUserInviteAction(token, name, password, totpEnable)` を実装。
- **参照**: docs/02 §F-003 §F-006 §F-007 §F-008、docs/05 §6.10
- **完了判定**: Vitest で (1) リンク 30 分超過で失効 (2) 1 回限り使用 (3) 招待コード回数上限超過で 409 が green。

### T-01-08 `getTenantContext` + `withTenant` + `assertCan`

- **何を実装**: `apps/web/lib/tenancy/context.ts` に `getTenantContext()`（Auth.js セッションから userId/tenantId/roles/wholesalerId/relationshipIds/isSaasAdmin を解決）、`apps/web/lib/permissions/can.ts` に `assertCan({ user, action, resource })`（ロール表は docs/02 §2.1 / 提案書 §8 ベース）。
- **参照**: docs/05 §6.6 §6.10
- **完了判定**: Vitest 統合テストで dealer ユーザーが他卸業者の relationshipId にアクセスすると `403 forbidden` を返すこと、`saas_admin` は `isSaasAdmin=true` でバイパス可能であることを確認。

### T-01-09 共通レイアウト + shadcn/ui

- **何を実装**: docs/05 §2.1 の `app/` ディレクトリ構成に従い、`(auth)`/`(onboarding)`/`(saas-admin)`/`(wholesaler)`/`(field)`/`(dealer)`/`(common)` のレイアウトファイル雛形、shadcn/ui CLI で `Button`/`Input`/`Form`/`Dialog`/`Sheet`/`Sonner`/`Calendar` を導入。S-001 サインインページ、S-002/S-003 MFA ページ、S-006 ロック画面を最小実装（フォームは T-01-05/06 で接続済み）。
- **参照**: docs/04 §1.1 §2.1、docs/05 §2.1
- **完了判定**: Playwright スモークテストで `/login` `/mfa` `/locked` が描画される。

### T-01-10 graphile-worker + Resend + R2 接続確認

- **何を実装**: `apps/worker/src/index.ts` に graphile-worker の bootstrap、`tasks/notification.send_email.ts` をスタブ実装（Resend テストモード送信）、`packages/storage/src/r2.ts` に pre-signed PUT URL 発行関数。`pnpm dev:worker` で常駐し、Web から `enqueue('notification.send_email', ...)` で実際に送信される。
- **参照**: docs/03 §4.4 §4.5 §4.6、docs/05 §5.1 §5.4 §6.11
- **完了判定**: Vitest で Resend client がモック注入されジョブが SENT 状態に遷移、R2 pre-signed URL が 15 分の expiresIn で発行される。

### T-01-11 Sentry + pino + UptimeRobot + `/api/health`

- **何を実装**: `@sentry/nextjs` を Web/Worker で初期化（DSN は env）、pino ロガーを `packages/contracts/logger.ts` で共通化、AsyncLocalStorage で request_id 横断。`apps/web/app/api/health/route.ts` で 200 / DB ping を返す。`beforeSend` に PII フィルタは TODO（SP-07 で完成）。
- **参照**: docs/03 §4.11 §9.3、docs/05 §10
- **完了判定**: ローカルで Sentry に 5xx が届く（dev DSN）、`/api/health` が 200、UptimeRobot 登録手順を `docs/sprints/SP-01-bootstrap.md` 末尾に記載。

### T-01-12 シードスクリプト

- **何を実装**: `packages/db/prisma/seed.ts` でパイロット卸業者 1 社（"パイロット卸 株式会社"）+ 二次店 3 社 + 関係 3 件 + 各ロールユーザー（saas_admin / wholesaler_admin / wholesaler_event_team / wholesaler_call_team / wholesaler_direct_sales / wholesaler_field_staff / dealer_admin × 3 / dealer_staff × 3）+ パスワード `Pilot!2026` を投入。`pnpm db:seed` で再現可能。
- **参照**: docs/03 §8.1
- **完了判定**: シード後に Auth.js でログイン成功、Playwright E2E から再利用可能。

## 5. テスト計画

**Vitest（unit + integration）**：

- `packages/auth/__tests__/login.test.ts` — F-001 正常ログイン、5 回失敗ロック、`sessionVersion` 強制ログアウト
- `packages/auth/__tests__/totp.test.ts` — F-002 TOTP 検証、バックアップコード使用、必須ロールリダイレクト
- `packages/auth/__tests__/reset.test.ts` — F-003 リンク期限切れ、1 回限り
- `packages/db/__tests__/tenant-isolation.test.ts` — F-009 / docs/02 §4.8 テナント分離 5 ケース
- `apps/web/lib/permissions/__tests__/assert-can.test.ts` — 横断認可

**Playwright（E2E スモーク）**：

- `tests/e2e/auth/login.spec.ts` — ログイン → MFA → ダッシュボード（ロール別）への遷移を 3 ロールで確認
- `tests/e2e/health.spec.ts` — `/api/health` 200

## 6. 完了判定

- 上記 12 タスクすべて `## DONE` で完了
- Vitest スイートが green、Playwright スモークが green
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm exec playwright test` が CI で連続 green
- パイロット卸業者シードでログインし、`(wholesaler)` レイアウトの空ダッシュボードが表示できる
- `apps/worker` が常駐しメール送信ジョブを enqueue→Resend テストモード送信できる
- Sentry に dev エラーが届き、`/api/health` 200 が UptimeRobot に登録されている
- 後続 SP-02 以降がテナント分離を前提に着手可能な状態

## 7. UptimeRobot 登録手順（T-01-11）

外形監視は無料枠の **UptimeRobot** を MVP 期間中使用する（docs/03 §4.11, docs/05 §10.4）。実 UptimeRobot への登録は本ドキュメント執筆時点では人間オペレータの手作業。Slack 連携と業務時間外ミュートは SP-07 で完成させる。

### 7.1 監視対象

| Monitor 名 | URL | Type | Interval | 期待ステータス |
|---|---|---|---|---|
| `solar-saas-health` | `https://<railway-prod>.up.railway.app/api/health` | HTTP(S) | 5 minutes | 200 OK |
| `solar-saas-login`（任意） | `https://<railway-prod>.up.railway.app/login` | HTTP(S) | 5 minutes | 200 OK |

`<railway-prod>` は Railway Web サービスのデプロイ URL（または独自ドメイン）で置換する。

### 7.2 登録ステップ

1. <https://uptimerobot.com/> にログイン（運営チーム共通アカウント）
2. `+ New Monitor` → `Monitor Type: HTTPS`
3. `Friendly Name`: `solar-saas-health`
4. `URL (or IP)`: 上記表の URL
5. `Monitoring Interval`: 5 minutes（無料枠の最短）
6. `Monitor Timeout`: 30 seconds
7. `HTTP Method`: GET
8. `Custom HTTP Headers` は SP-07 で追加（Bearer 等は SP-01 時点では不要、`/api/health` は無認証）
9. `Alert Contacts To Notify`: SP-07 で Slack webhook を追加するまで Email のみ
10. `Create Monitor`

### 7.3 業務時間帯のミュート設定（SP-07 で完成）

docs/02 §5.1 の SLA は 08:00–22:00 JST。それ以外の時間帯（22:00–08:00 JST）は致命的障害以外のアラートを抑止する。

- UptimeRobot Pro なら `Maintenance Windows` で毎日 22:00–08:00 JST を登録（Cron: `0 13 * * *` UTC start / `0 23 * * *` UTC end）
- 無料枠の場合は SP-07 で導入予定の Slack ルーティング側で時刻フィルタを掛ける
- 重大障害（5 分以上連続 5xx）は時間帯に関わらず即時通知

### 7.4 通知連携

- Email: 運営チーム共通アドレス（SP-07 で正式決定）
- Slack: `#solar-saas-alerts` — SP-07 で Webhook URL を `.env` に追加し UptimeRobot の `Alert Contact` に登録
- LINE: Phase 2 で検討（F-054 と同インフラ）

### 7.5 健全性確認

登録後、最初の 1 周期（5 分以内）で `Up` に遷移することを確認。`Down` のままなら：

- Railway デプロイ URL を再確認
- `/api/health` を curl で叩いて 200 が返るか確認（`curl -i https://...`）
- 503 が返るなら DB 接続不可 → Railway PostgreSQL の `DATABASE_URL` を疑う
