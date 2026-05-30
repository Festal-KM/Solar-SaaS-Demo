# SP-05 — deals-contracts (商談 + 契約 + 粗利 + 施工 + 申請)

## 1. 目的

商談・クロージング管理、契約登録、契約明細スナップショット（docs/01 §9.3 の最重要要件）、粗利計算（自動 + 手動調整）、施工状況管理、補助金申請管理までを実装する。docs/02 UC-02 後半 + UC-03 が成立し、契約成立時にインセンティブ計算 (SP-06 の F-046) が起動可能な状態にする。

## 2. 対応機能 ID

P0：**F-038, F-039, F-040, F-041, F-042, F-044, F-045**

参照：`docs/02 §1.6 §F-038〜F-045 §UC-02 §UC-03`, `docs/04 §1.3 S-037〜S-041 S-044〜S-047 §1.5 S-065 S-067`, `docs/05 §3.6 §4.8 §6.1 §6.2 §6.4 §7.2`

## 3. タスク一覧

| ID | 概要 | 受け入れ基準（要旨） | 対応機能 ID | 工数 |
|---|---|---|---|---|
| T-05-01 | Prisma schema 拡張（Deal / Contract / ContractItem / GrossProfit / Construction / Application） | docs/05 §3.6 のテーブル + enum（DealStatus, ContractStatus, IncentiveTargetType, ConstructionStatus, ApplicationStatus）、RLS、`@@index([contractDate])` 等 | F-038〜F-045 | M |
| T-05-02 | DealerScopeService 完成 + 商談アクション認可 | `resolveScope(input)` を Prisma 依存で完成、`canDealerCloseDeal(scope, action)` 純関数で「アポ獲得まで」「初回訪問まで」「商談・クロージングまで」の判定、Vitest 9 ケース | F-024, F-038 | M |
| T-05-03 | 商談・クロージング管理 (S-037/S-038/S-067) | `deal.create/update/changeStatus`、スコープに基づくアクセス制御、ステータス遷移（初回訪問予定→訪問済み→提案中→見積提出→検討中→契約見込み→契約/失注）、「アポ獲得まで」二次店は閲覧のみ | F-038 | L |
| T-05-04 | 二次店商談・クロージング報告確認 (S-039) | `GET /api/deals?status=&page=`、wholesaler 側で二次店からの契約見込みステータス更新を一覧表示、`F-039` 通知（SP-07 で通知本体） | F-039 | S |
| T-05-05 | ContractSnapshotService 純関数化 | `packages/contracts/services/contract-snapshot.ts` に `snapshotItems(items, contractDate, products[])` `snapshotIncentiveRate(relationshipId, contractDate, rates[])` `computeCancelDeadline(settings, contractDate)` を純関数で実装、Vitest 5 ケース | F-040, F-041, F-015 | M |
| T-05-06 | 契約登録 (S-040/S-041) | `contract.create(input)` で契約日・契約金額・関連商談・自社開催フラグ、`cancelDeadline = 契約日 + wholesalerSettings.cancelDeadlineDays` を契約にスナップショット、関係単位インセンティブ率をスナップショット | F-040 | L |
| T-05-07 | 契約明細登録（価格スナップショット）(S-044) | `contractItem.replace(input)` で `items: ContractItemInput[]`、契約日時点の有効商品マスタから `snapshotPurchasePrice/dealerPrice/listPrice` をコピー、後続の商品マスタ改定が明細に影響しないことを Vitest 4 ケース | F-041 | L |
| T-05-08 | 粗利計算（自動 + 手動調整）(S-045) | `grossProfit.recalc(input)`、`computeGrossProfit(input)` 純関数（packages/contracts/services/incentive.ts）、案件粗利・卸粗利・粗利率・インセンティブ対象粗利の自動算出、手動調整は変更履歴 + 監査ログ（SP-07 で本格化、ここでは GrossProfit.manualAdjustedAt 記録） | F-042 | M |
| T-05-09 | 契約一覧・詳細統合表示 (S-040/S-041) | 契約 + 明細 + 粗利 + (placeholder)インセンティブ を統合表示、二次店は仕入値非表示 + 自社関与契約のみ閲覧 | F-040, F-041, F-042 | M |
| T-05-10 | 施工状況管理 (S-046) | `construction.create/update/changeStatus`、施工費用更新時に粗利を自動再計算（`grossProfit.recalc` を呼び出し）、ステータス遷移 | F-044 | M |
| T-05-11 | 補助金申請管理 (S-047) | `application.create/update/changeStatus`、ステータス遷移、補助金見込み額・確定額の入力 | F-045 | S |
| T-05-12 | E2E：UC-02 後半 + UC-03（商談 → 契約成立 → 契約明細 → 粗利計算）+ スナップショット不変性検証 | Playwright で wholesaler_direct_sales / wholesaler_admin を使い、契約成立 → 商品マスタ改定 → 過去契約の明細が不変であることを E2E で確認 | F-038〜F-042, UC-02, UC-03 | M |

## 4. タスク詳細

### T-05-01 Prisma schema 拡張

- **何を実装**: docs/05 §3.6 の 6 テーブル。`Contract` には `cancelDeadline`, `incentiveRateSnapshot`, `incentiveTargetTypeSnapshot`, `isSelfHosted` を含む。`ContractItem` には `snapshotPurchasePrice/dealerPrice/listPrice`。Decimal(14,2) 厳守、RLS ポリシーは Contract が `wholesalerId`、その他は contract 経由。
- **参照**: docs/05 §3.6 §3.9
- **完了判定**: migration green。

### T-05-02 DealerScopeService

- **何を実装**: `apps/web/lib/domain/dealer-scope.ts` に `DealerScopeService.resolveScope({relationshipId, eventId?})`。`EventDealer.scopeOverride ?? Relationship.defaultScope` を返す。`packages/contracts/services/dealer-scope.ts` に純関数 `canDealerCloseDeal(scope, action: 'visit'|'pitch'|'close'): boolean`。
- **参照**: docs/05 §6.4
- **完了判定**: Vitest で 3 スコープ × 3 アクション = 9 ケース green。

### T-05-03 商談・クロージング管理

- **何を実装**: `app/(wholesaler)/deals/` (S-037/S-038) と `app/(dealer)/deals/` (S-067)。`deal.create/update/changeStatus` Server Action。Server Action 冒頭で `DealerScopeService.resolveScope` → `canDealerCloseDeal` で認可判定。「アポ獲得まで」スコープの二次店は商談 update を 403。
- **参照**: docs/02 §F-038、docs/05 §4.8
- **完了判定**: スコープ別 403 が Vitest 3 ケース、ステータス遷移 7 種類、Playwright spec 1 件。

### T-05-04 二次店商談報告確認

- **何を実装**: `app/(wholesaler)/deals/dealer-reports/page.tsx` (S-039)。`GET /api/deals?status=&page=` で二次店所有の商談を絞込み一覧。`status=契約見込み` への遷移を強調表示。
- **参照**: docs/02 §F-039
- **完了判定**: 二次店所有の商談のみが表示、Vitest 2 ケース。

### T-05-05 ContractSnapshotService

- **何を実装**: `packages/contracts/services/contract-snapshot.ts` に純関数 3 つ。
  - `snapshotItems(items, contractDate, productsAvailable)`: contractDate 時点で適用中の商品をフィルタしコピー
  - `snapshotIncentiveRate(relationshipId, contractDate, rates)`: contractDate 時点で適用中の率を 1 件返す
  - `computeCancelDeadline(settings, contractDate)`: `contractDate + settings.cancelDeadlineDays` を返す
- **参照**: docs/05 §6.2
- **完了判定**: Vitest 5 ケース（契約日跨ぎ、率複数候補、設定変更後の不変性 等）。

### T-05-06 契約登録

- **何を実装**: `app/(wholesaler)/contracts/new/page.tsx` + `actions.ts`。`contract.create(input)` で `Contract` レコード生成、`ContractSnapshotService.snapshotIncentiveRate` と `computeCancelDeadline` を呼び出し、`isSelfHosted` を判定（自社開催由来 = `Event.mode === SELF`）。共同開催由来は `isSelfHosted=false` + `relationshipId` を保持。
- **参照**: docs/02 §F-040、docs/05 §6.2 §4.8
- **完了判定**: 必須バリデーション、スナップショット保持、Vitest 4 ケース。

### T-05-07 契約明細登録

- **何を実装**: `app/(wholesaler)/contracts/[id]/items/page.tsx` (S-044)。`contractItem.replace(input)` Server Action。`GET /api/products/active?asOf={contractDate}` で当日有効商品を取得、`ContractSnapshotService.snapshotItems` でコピーして `ContractItem` を一括 INSERT。
- **参照**: docs/02 §F-041、docs/05 §6.2
- **完了判定**: 商品マスタの後続改定が明細に影響しないこと（Vitest で改定前後の `snapshotPurchasePrice` 比較）、契約日時点で適用中でない商品は選択不可（400）、Vitest 4 ケース。

### T-05-08 粗利計算

- **何を実装**: `packages/contracts/services/incentive.ts` に純関数 `computeGrossProfit(input): { purchaseTotal, dealerTotal, projectProfit, wholesaleProfit, profitRate, incentiveTargetProfit }`。`apps/web/lib/domain/incentive.ts` の `IncentiveService.recalcGrossProfit` で Prisma 経由で GrossProfit を upsert、手動調整時は `manualAdjustedBy/At` を記録。
- **参照**: docs/02 §F-042、docs/05 §6.1
- **完了判定**: Vitest で
  - 案件粗利 = 実販売価格 − 商品仕入値合計 − 施工費 − その他原価 − 値引き
  - 卸粗利 = 二次店卸値合計 − 商品仕入値合計
  - インセンティブ対象粗利の種別切替（PROJECT_PROFIT / WHOLESALE_PROFIT / MANUAL）
  - 粗利 0 円以下のケース
  4 ケース green。

### T-05-09 契約一覧・詳細統合表示

- **何を実装**: `app/(wholesaler)/contracts/` (S-040) と `app/(wholesaler)/contracts/[id]/page.tsx` (S-041)。契約基本情報 + 明細テーブル + 粗利カード + インセンティブ placeholder（SP-06 で接続）を統合。二次店向け `app/(dealer)/contracts/[id]/page.tsx` (S-065 内) は仕入値・施工費を非表示。
- **参照**: docs/02 §F-040〜F-042、docs/04 §1.3 §1.5
- **完了判定**: 二次店レスポンスに `snapshotPurchasePrice` が含まれない（Vitest）、Playwright spec 1 件。

### T-05-10 施工状況管理

- **何を実装**: `app/(wholesaler)/constructions/` (S-046)。`construction.create/update/changeStatus`。施工費用更新時に `grossProfit.recalc` を内部呼び出し（粗利再計算）。ステータス遷移（依頼前→依頼済→現地調査済→施工中→完了/中断）。
- **参照**: docs/02 §F-044
- **完了判定**: 施工費更新 → 粗利再計算が Vitest 2 ケース。

### T-05-11 補助金申請管理

- **何を実装**: `app/(wholesaler)/applications/` (S-047)。`application.create/update/changeStatus`。補助金見込み額 / 確定額の入力フィールド。
- **参照**: docs/02 §F-045
- **完了判定**: ステータス遷移、Vitest 2 ケース。

### T-05-12 E2E：UC-02 後半 + UC-03 + スナップショット不変性

- **何を実装**: `tests/e2e/uc02-3-contract.spec.ts` で
  1. UC-02 step 6-9: 商談ステータスを契約見込みに → 契約登録 → 契約明細 → 粗利計算
  2. UC-03 step 6: 商品マスタを後日改定 → 過去契約の明細が不変であることを assert
- **参照**: docs/02 §UC-02 §UC-03、docs/05 §11.3
- **完了判定**: spec 1 件が安定して green。

## 5. テスト計画

**Vitest**：

- `DealerScopeService` 9 ケース
- `ContractSnapshotService.snapshotItems / snapshotIncentiveRate / computeCancelDeadline` 計 7 ケース
- `computeGrossProfit` 4 ケース
- Contract 二次店向け DTO の仕入値非表示
- 施工費更新 → 粗利再計算

**Playwright**：

- `tests/e2e/uc02-3-contract.spec.ts`（UC-02 後半 + UC-03 + 商品マスタ改定後の不変性）
- `tests/e2e/dealer/contract-view.spec.ts`（仕入値非表示確認）

## 6. 完了判定

- 上記 12 タスク全て `## DONE`
- Vitest / Playwright が green
- UC-02 step 6-9 と UC-03 が E2E で通る
- 契約明細スナップショット（docs/01 §9.3）が商品マスタ改定後も不変
- 粗利計算が 4 つの分岐（PROJECT_PROFIT/WHOLESALE_PROFIT/MANUAL/0 円）で正しく動作
- SP-06 がインセンティブ自動計算 (F-046) に進める状態
