# SP-02 — masters (マスタ管理 + SaaS 運営者)

## 1. 目的

マスタ管理（場所提供元、商品＋価格履歴、施工業者、インセンティブ率、卸業者設定＝キャンセル期限・年度開始月）と、SaaS 運営者（テナント作成・プラン管理・請求状況閲覧）を実装する。商品マスタは適用期間履歴を持ち、契約明細スナップショット（SP-05 の F-041）が依存する。

## 2. 対応機能 ID

P0/P1：**F-004, F-005, F-011, F-012, F-013, F-014, F-015, F-016**

参照：`docs/02 §1.2 §F-004〜F-005 §F-011〜F-016`, `docs/03 §15`, `docs/04 §1.2 §1.3-S-042〜S-043 §1.3-S-052`, `docs/05 §3.3 §4.3 §4.4`

## 3. タスク一覧

| ID | 概要 | 受け入れ基準（要旨） | 対応機能 ID | 工数 |
|---|---|---|---|---|
| T-02-01 | Prisma schema 拡張（VenueProvider / Product / ProductPriceHistory / Installer / IncentiveRate） | docs/05 §3.3 のテーブル群が migration に追加、Decimal(14,2)/(5,2)、`@@index([wholesalerId, isActive])`、`effective_from < effective_to` 制約 | F-011, F-012, F-013, F-014 | M |
| T-02-02 | 場所提供元マスタ Server Action + 一覧 + 詳細・編集画面 (S-019/S-020) | `venueProvider.create/update/disable` Server Action、shadcn DataTable、二次店ロールは 403 で閲覧不可 | F-011 | M |
| T-02-03 | 商品・価格マスタ Server Action + 一覧 + 詳細・履歴画面 (S-042/S-043) | `product.create/update/retire`、適用期間で時系列管理、価格改定は新レコード追加（既存上書きしない）、`GET /api/products/active?asOf=...` で契約日時点の有効商品を返す | F-012 | L |
| T-02-04 | 商品マスタの二次店向け仕入値非開示テスト | dealer ロールの API レスポンスに `purchase_price` フィールドが含まれない（Prisma `select` で除去 or DTO 変換）。Vitest 統合テスト 3 ケース | F-012 | S |
| T-02-05 | 施工業者マスタ Server Action + 画面 (S-052 内のサブセクション) | `installer.create/update/disable`、削除時は論理停止、過去契約からの参照は保持 | F-013 | S |
| T-02-06 | インセンティブ率マスタ Server Action + 画面 (S-052 内) | `incentiveRate.create/update`、関係 (relationship_id) 単位で時系列管理、二次店ロールには対応関係の率のみ表示 | F-014 | M |
| T-02-07 | 卸業者設定（キャンセル期限 / 年度開始月 / piiMaskingMode / defaultIncentiveType）Server Action + 画面 (S-052 内) | `wholesalerSettings.update`、設定変更は監査ログ、過去契約の `cancelDeadline` は遡及しない | F-015, F-016 | M |
| T-02-08 | SaaS 運営者画面：テナント一覧・作成 (S-013/S-014/S-015) | `createTenantAction`、招待メール送信、同一メール重複作成は 409、招待 7 日経過で再発行可能 | F-004 | M |
| T-02-09 | SaaS 運営者画面：プラン管理 + 請求状況閲覧 (S-016/S-017) | `updatePlanAction`、プラン変更履歴 + 監査ログ、請求は外部運用（オフライン記録のみ）、`saas_admin` のみアクセス可 | F-005 | M |
| T-02-10 | マスタ管理ハブ画面 (S-052) ナビゲーション統合 | 二次店関係 / 施工業者 / インセンティブ率 / キャンセル期限 / 年度開始月のタブ統合、`wholesaler_admin` のみアクセス可 | F-009, F-010, F-013, F-014, F-015, F-016 | S |
| T-02-11 | 卸業者ダッシュボード骨組み (S-018) | shadcn ベースの空のカード群（未読通知 / 希望未提出 / マエカク未対応 / 月次サマリの placeholder）、後続スプリントで肉付け | F-022, F-034, F-048, F-052, F-056 placeholder | S |
| T-02-12 | マスタ系の E2E スモーク（Playwright） | 場所提供元 / 商品 / インセンティブ率の登録 → 一覧表示 → 編集が wholesaler_admin で動作、二次店ロールでアクセス時 403 | F-011, F-012, F-014 | M |

## 4. タスク詳細

### T-02-01 Prisma schema 拡張

- **何を実装**: docs/05 §3.3 の `VenueProvider`, `Product`, `ProductPriceHistory`, `Installer`, `IncentiveRate` を追加。複合インデックス（`wholesalerId, effectiveFrom`）と Postgres CHECK 制約（`effective_from < effective_to`）。
- **参照**: docs/05 §3.3、docs/02 §4.3
- **完了判定**: `pnpm db:migrate dev` 成功、`prisma generate` 型出力、関係エンティティに対する RLS ポリシーも migration に追加。

### T-02-02 場所提供元マスタ

- **何を実装**: `apps/web/app/(wholesaler)/masters/venue-providers/` 配下に一覧 (S-019)、詳細・編集 (S-020) ページ。Server Action `venueProvider.create/update/disable` を `apps/web/app/(wholesaler)/masters/venue-providers/actions.ts` に集約。Zod スキーマは `packages/contracts/schemas/venue-provider.ts`。
- **参照**: docs/02 §F-011、docs/04 §1.3、docs/05 §4.4
- **完了判定**: shadcn DataTable で一覧、名称・住所必須バリデーション、二次店ロール 403、Vitest で CRUD 3 ケース green。

### T-02-03 商品・価格マスタ

- **何を実装**: `apps/web/app/(wholesaler)/masters/products/` 配下に一覧 + 詳細 + 履歴。Server Action `product.create/update/retire`。`packages/contracts/services/product-effective.ts` に「契約日時点で有効な商品」純関数。GET API `app/api/products/active/route.ts` で `?asOf=ISO` を受け取る。
- **参照**: docs/02 §F-012、docs/05 §3.3 §4.4
- **完了判定**: 価格改定は新レコード追加、`effectiveTo <= effectiveFrom` は 400、`/api/products/active?asOf=2026-06-01` が当日有効商品のみ返す、Vitest 5 ケース green。

### T-02-04 仕入値非開示

- **何を実装**: `packages/contracts/dto/product.ts` で `ProductForDealerDto`（`purchasePrice` を含まない）と `ProductForWholesalerDto`（含む）を分離。Server Action 戻り値で viewer ロールに応じて DTO を切り替え。
- **参照**: docs/03 §4.3、docs/05 §6.5 関連
- **完了判定**: Vitest で dealer ロールのレスポンスに `purchasePrice` キーが存在しないことを確認。E2E でも検証（Playwright で API レスポンスの shape を assert）。

### T-02-05 施工業者マスタ

- **何を実装**: `apps/web/app/(wholesaler)/masters/installers/` 配下に一覧 + 詳細。Server Action `installer.create/update/disable`。論理停止 (`isActive=false`)、過去契約からの参照は保持。
- **参照**: docs/02 §F-013、docs/05 §3.3
- **完了判定**: 名称必須、`disable` 後も `findUnique` で取得可、Vitest 2 ケース。

### T-02-06 インセンティブ率マスタ

- **何を実装**: S-052 内の「インセンティブ率」タブ。`incentiveRate.create/update` Server Action。`relationshipId` ごとに `targetProfitType`（PROJECT_PROFIT / WHOLESALE_PROFIT / MANUAL）+ `rate(%)` + `effectiveFrom/To` を保持。dealer ロールへの API は対応関係の率のみ返す。
- **参照**: docs/02 §F-014、docs/05 §3.3 §4.4
- **完了判定**: Vitest で「dealer A の `relationship` に紐づく率のみ取得」「他関係の率は 0 件」を 3 ケース green。

### T-02-07 卸業者設定

- **何を実装**: S-052 内の「卸業者設定」タブ。`wholesalerSettings.update` Server Action。`cancelDeadlineDays`（デフォルト 8）、`fiscalYearStartMonth`（1-12）、`piiMaskingMode`、`defaultIncentiveType`。変更時は `AuditLog`（SP-07 で本格対応、ここでは UPDATE 履歴を最低限保存）。
- **参照**: docs/02 §F-015 §F-016、docs/05 §3.2
- **完了判定**: バリデーション（`cancelDeadlineDays >= 1`, `1 <= fiscalYearStartMonth <= 12`）、設定変更後も既存契約の `cancelDeadline` は不変、Vitest 3 ケース。

### T-02-08 SaaS 運営者：テナント一覧・作成

- **何を実装**: `apps/web/app/(saas-admin)/tenants/` 配下に一覧 (S-014)、新規作成 + 詳細 (S-015)。`createTenantAction` で卸業者テナント + `wholesaler_admin` ユーザー + 招待メール送信。`saas_admin` 以外は 403。
- **参照**: docs/02 §F-004、docs/04 §1.2、docs/05 §4.3
- **完了判定**: 同一メール重複 409、招待 7 日経過後の再発行 API が動作、Vitest 3 ケース。

### T-02-09 SaaS 運営者：プラン管理

- **何を実装**: `(saas-admin)/plans/` (S-016) と `(saas-admin)/billing/` (S-017)。`updatePlanAction({tenantId, plan, billingStatus})`。プラン enum は `PILOT|SMALL|MEDIUM|LARGE`（docs/05 §3.2）。請求状況はオフライン記録（テキストフィールド + ステータス）。
- **参照**: docs/02 §F-005、docs/05 §3.2 §4.3
- **完了判定**: プラン変更で `AuditLog`（最低限）、`saas_admin` のみ 200、wholesaler_admin で 403。

### T-02-10 マスタ管理ハブ (S-052)

- **何を実装**: `app/(wholesaler)/masters/page.tsx` で shadcn Tabs を使い、二次店関係 (F-009 placeholder)、施工業者、インセンティブ率、卸業者設定の 4 タブを統合表示。各タブの中身は T-02-05 〜 T-02-07 を埋め込み。
- **参照**: docs/04 §1.3 S-052
- **完了判定**: `wholesaler_admin` のみアクセス可、4 タブ全て描画。

### T-02-11 卸業者ダッシュボード骨組み

- **何を実装**: `app/(wholesaler)/page.tsx`（S-018）に未読通知 / 希望未提出 / マエカク未対応 / 月次サマリ の 4 カード placeholder。実データは後続スプリントで接続。
- **参照**: docs/04 §1.3 S-018
- **完了判定**: ログイン後にダッシュボードが描画され、ナビゲーション動作。

### T-02-12 E2E スモーク

- **何を実装**: `tests/e2e/masters/` 配下に Playwright spec。`wholesaler_admin` で場所提供元・商品・インセンティブ率の登録 → 一覧表示 → 編集、dealer_admin でマスタ系 URL アクセスして 403/リダイレクトを確認。
- **参照**: docs/05 §11.3
- **完了判定**: 3 spec が green。

## 5. テスト計画

**Vitest**：

- マスタ CRUD 単体テスト（venue-providers / products / installers / incentive-rates / wholesaler-settings）
- 商品の時系列取得（`asOf` クエリ）
- 二次店向けレスポンスの `purchasePrice` 非開示

**Playwright**：

- `tests/e2e/masters/venue-providers.spec.ts`
- `tests/e2e/masters/products.spec.ts`（仕入値マスク含む）
- `tests/e2e/masters/incentive-rates.spec.ts`
- `tests/e2e/saas-admin/tenants.spec.ts`

## 6. 完了判定

- 上記 12 タスク全て `## DONE`
- Vitest / Playwright が green
- パイロット卸業者シードに対し、wholesaler_admin で全マスタを登録・編集・閲覧できる
- 二次店ロールが仕入値を取得できないことが E2E で確認できる
- SaaS 運営者が新規卸業者テナントを作成できる
- SP-03 がイベント候補登録で場所提供元マスタ・商品マスタを参照可能な状態

## 7. 次スプリントへの申し送り

### SP-03 以降への前提

- マスタ 5 種（場所提供元 / 商品・価格 / 施工業者 / インセンティブ率 / 卸業者設定）+ SaaS 運営者画面（テナント / プラン / 請求状況）が稼働済み
- `withTenant` + RLS の二重防御がマスタ系全テーブルで検証済み
- `dashboard.read` / `masters.read` 等の権限ポリシーが `apps/web/lib/permissions/can.ts` に追加済み
- 卸業者ダッシュボード骨組み (S-018) は 4 カード placeholder、本実装は SP-03 (希望提出) / SP-04 (マエカク) / SP-06 (月次)

### SP-03 が引き継ぐべき未解決事項

- 二次店関係マスタ (F-009/F-010) の本実装（SP-02 はハブ内 placeholder のみ）
- `wholesalerSettings` の `defaultIncentiveType` 列は Prisma schema に未追加（T-02-07 で扱わず）。SP-06 (インセンティブ計算) で必要なら追加
- E2E は `workers: 1` 固定（並列実行の test isolation は SP-03 で再評価）

### SP-07 で扱う未消化

- `tenant.update_plan` / `wholesalerSettings.update` の AuditLog 仕様拡張（SP-07 で `SETTINGS_CHANGE` 等の enum 追加検討）
- 招待トークンの `revokedAt` 列追加（T-02-08 で `acceptedAt = now` を失効マーカに流用、SP-07 で正式列に置換）
- `defaultEmailClient` の Resend production 接続（T-01-10 で stub のみ）
