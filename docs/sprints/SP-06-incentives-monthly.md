# SP-06 — incentives-monthly (インセンティブ + キャンセル + 月次クローズ + BI)

## 1. 目的

契約成立時のインセンティブ自動計算、共同開催インセンティブ手動調整、契約キャンセル処理（期限内取消／期限後負調整）、月次集計（graphile-worker cron）、月次報告コメント・確定、二次店向け成績・インセンティブ確認、BI ダッシュボードを実装する。docs/02 UC-04 + UC-05 が成立し、月次クローズが回る状態にする。

## 2. 対応機能 ID

P0/P1：**F-043, F-046, F-047, F-048, F-049, F-050, F-051, F-056**

参照：`docs/02 §1.7 §1.8-F-056 §F-043 §F-046〜F-051 §UC-04 §UC-05`, `docs/03 §4.5 §4.7`, `docs/04 §1.3 S-048〜S-051 §1.5 S-068〜S-070`, `docs/05 §3.6 §3.7 §4.8 §4.9 §5 §6.1 §6.8 §7.3 §7.4`

## 3. タスク一覧

| ID | 概要 | 受け入れ基準（要旨） | 対応機能 ID | 工数 |
|---|---|---|---|---|
| T-06-01 | Prisma schema 拡張（Incentive / IncentiveAdjustment / ContractCancellation / MonthlyReport） | docs/05 §3.6 §3.7 のテーブル、enum（IncentiveStatus, AdjustmentKind, MonthlyReportStatus, MonthlyScope）、RLS、`@@index([relationshipId, settledMonth])` | F-043, F-046, F-048 | M |
| T-06-02 | IncentiveService.finalizeForContract（契約成立時の自動計算）(F-046) | `computeIncentiveAmount` 純関数 + Prisma ラッパ、契約成立時に呼び出し、自社開催・キャンセル・粗利 0 以下は 0 円、共同開催は `status=DRAFT` で下書き、Vitest 5 ケース | F-046 | L |
| T-06-03 | 共同開催インセンティブ手動調整 (S-050 タブ) | `incentive.adjustJoint(input)` Server Action、`distributions: {relationshipId, amount, reason}[]`、確定で `IncentiveAdjustment` レコード生成、監査ログ TODO（SP-07 で本格化） | F-047 | M |
| T-06-04 | 契約キャンセル処理 (S-040 / S-041 内 + S-050 タブ) (F-043) | `contract.cancel(input)`、期限内は `Incentive.status=CANCELLED`、期限後は `IncentiveAdjustment(kind=NEGATIVE_AFTER_DEADLINE, appliedMonth=翌月)` を作成、Vitest 4 ケース | F-043 | M |
| T-06-05 | graphile-worker タスク `incentive.calculate` + `incentive.cancel_or_negative_adjust` | docs/05 §5.2 の payload / max_attempts / 冪等性キーで実装、`enqueue` から呼び出し可能、Vitest でジョブ単体テスト | F-046, F-043 | M |
| T-06-06 | MonthlyReportService.aggregate + graphile-worker タスク `monthly.aggregate` | docs/05 §6.8 §5.2、対象月 × 全 scope（SELF/DEALER/JOINT/ALL）× 関係単位で `MonthlyReport` を UPSERT、集計 SQL は raw SQL 化、100 二次店 / 1,000 契約で < 5s | F-048 | L |
| T-06-07 | 月次集計画面・月次報告一覧 (S-048) + 詳細 (S-049) | `GET /api/monthly-reports?targetMonth=YYYY-MM&scope=`、卸業者ビュー（自社/二次店/共同/全体 4 区分）、Recharts で時系列棒グラフ | F-048 | M |
| T-06-08 | 月次報告コメント提出 + 確認 (S-049 / S-068) | `monthlyReport.submitComment(input)`（dealer_admin）、`monthlyReport.review(input)`（wholesaler_admin）、ステータス遷移（下書き→提出済み→確認済み→確定） | F-049 | M |
| T-06-09 | 月次報告確定・ロック (S-049) | `monthlyReport.finalize(input)` Server Action、集計値スナップショット保存、確定後の手動調整は 409、`monthlyReport.unlock` は wholesaler_admin のみで監査ログ | F-050 | M |
| T-06-10 | 二次店向け成績・インセンティブ確認 (S-069 / S-070) | `app/(dealer)/monthly/page.tsx` (S-069) と `app/(dealer)/incentives/page.tsx` (S-070)、仕入値非表示、卸業者ごとに独立表示 | F-051, F-046 | M |
| T-06-11 | BI ダッシュボード (S-051) | Recharts で売上・粗利・契約数・成約率の時系列、ランキング、期間/体制/二次店フィルタ、卸業者ロールごとの権限フィルタ | F-056 | M |
| T-06-12 | E2E：UC-04（キャンセル）+ UC-05（月次クローズ） | Playwright で 期限内キャンセル取消 / 期限後負調整 + 月次集計 → コメント提出 → 確定 → 二次店確認 を一気通貫 | F-043, F-046〜F-051, UC-04, UC-05 | L |

## 4. タスク詳細

### T-06-01 Prisma schema 拡張

- **何を実装**: docs/05 §3.6 (Incentive, IncentiveAdjustment, ContractCancellation) + §3.7 (MonthlyReport)。enum 群（IncentiveStatus: DRAFT/FINALIZED/CANCELLED/NEGATIVE, AdjustmentKind, MonthlyReportStatus, MonthlyScope）。`MonthlyReport` には `aggregated: Json`, `comments: Json`, `finalizedAt`, `relationshipId?`, `scope`。
- **参照**: docs/05 §3.6 §3.7 §3.9
- **完了判定**: migration green、RLS ポリシー。

### T-06-02 IncentiveService.finalizeForContract

- **何を実装**:
  - `packages/contracts/services/incentive.ts` の `computeIncentiveAmount(input)` 純関数を完成
  - `apps/web/lib/domain/incentive.ts` の `IncentiveService.finalizeForContract(contractId, actor)` で粗利・関係率スナップショットを取得し `Incentive` を UPSERT
  - 自社開催のみ (`isSelfHosted && relationshipId === null`)、キャンセル、粗利 ≤ 0 → amount = 0
  - 共同開催 (`isJoint = true`) → `status=DRAFT` で下書き、複数 relationship に分配の下書き値（`卸粗利 × 関係率`）を提示
- **参照**: docs/02 §F-046、docs/05 §6.1
- **完了判定**: Vitest で
  - 自社開催 → 0 円
  - 二次店開催 → `target_profit × rate / 100`
  - 共同開催 → DRAFT 状態
  - 粗利 0 以下 → 0 円
  - 率未設定 → 警告 + 0 円
  5 ケース green。

### T-06-03 共同開催手動調整

- **何を実装**: S-050 内のタブ「共同開催調整」。`incentive.adjustJoint({contractId, distributions: [{relationshipId, amount, reason}]})` Server Action。`IncentiveService.adjustJoint` で `Incentive` 更新 + `IncentiveAdjustment(kind=JOINT_MANUAL)` レコード生成。手動調整しないと月次確定 (F-050) に進めない。
- **参照**: docs/02 §F-047、docs/05 §6.1
- **完了判定**: Vitest で手動調整未済の DRAFT インセンティブが月次確定をブロックする 1 ケース。

### T-06-04 契約キャンセル処理

- **何を実装**: `app/(wholesaler)/contracts/[id]/cancel/page.tsx` または S-040 / S-041 内ボタンから `contract.cancel({contractId, cancelledAt, reason})`。`IncentiveService.cancelContract` で
  - `cancelledAt <= cancelDeadline` → `Incentive.status=CANCELLED`、`ContractCancellation(isWithinDeadline=true)`
  - `cancelledAt > cancelDeadline` → `IncentiveAdjustment(kind=NEGATIVE_AFTER_DEADLINE, appliedMonth=翌月)`、`ContractCancellation(isWithinDeadline=false)`
  - 契約ステータスを CANCELLED に変更、月次集計から除外
- **参照**: docs/02 §F-043、docs/05 §6.1 §7.3
- **完了判定**: Vitest で期限内/期限後 4 ケース green。

### T-06-05 graphile-worker タスク

- **何を実装**: `apps/worker/src/tasks/incentive.calculate.ts` と `apps/worker/src/tasks/incentive.cancel_or_negative_adjust.ts`。各々 Zod でペイロード検証、`IncentiveService` を呼び出し、jobKey で冪等性確保（docs/05 §5.4）。
- **参照**: docs/05 §5.2 §5.4
- **完了判定**: ジョブが enqueue → 実行 → 完了。冪等性キー重複時はスキップ。Vitest 2 ケース。

### T-06-06 MonthlyReportService.aggregate

- **何を実装**:
  - `apps/web/lib/domain/monthly-report.ts` に `MonthlyReportService.aggregate(wholesalerId, targetMonth, scopes?)`
  - `gross_profits / incentives / event_reports / contracts` を raw SQL で集約（docs/05 §6.8）
  - 集計項目: 実施イベント数、対応店舗数、稼働日数、声かけ数、アンケート数、アポ数、有効アポ数、マエカク通過数、初回訪問数、商談数、契約数、契約金額、粗利、インセンティブ見込み額
  - 4 scope（SELF/DEALER/JOINT/ALL）× 関係単位で `MonthlyReport` を UPSERT
  - graphile-worker タスク `monthly.aggregate` から呼び出し、cron `0 2 1 * *` で月末翌日 2:00 JST 自動実行
- **参照**: docs/02 §F-048、docs/05 §5.2 §5.3 §6.8 §7.4
- **完了判定**: 100 二次店 / 1,000 契約のシードで `< 5s` を Vitest performance test で確認、ALL = SELF + DEALER + JOINT が保証される、Vitest 4 ケース。

### T-06-07 月次集計画面

- **何を実装**: `app/(wholesaler)/monthly-reports/` (S-048) + `app/(wholesaler)/monthly-reports/[id]/page.tsx` (S-049)。Recharts で時系列棒グラフ、Tabs で 4 scope 切替、二次店ロールは自社分のみ。
- **参照**: docs/02 §F-048、docs/04 §1.3 S-048/S-049
- **完了判定**: 全 scope × フィルタが動作、Playwright spec 1 件。

### T-06-08 月次報告コメント

- **何を実装**: dealer 側 (S-068) で `monthlyReport.submitComment({reportId, comments: {主な成果, 課題, 改善アクション, 翌月重点店舗, 翌月施策, 二次店コメント}})`、wholesaler 側 (S-049) で `monthlyReport.review({reportId})`。
- **参照**: docs/02 §F-049
- **完了判定**: ステータス遷移（下書き→提出済み→確認済み→確定）、Vitest 3 ケース。

### T-06-09 月次報告確定・ロック

- **何を実装**: S-049 内の「確定」ボタンから `monthlyReport.finalize({wholesalerId, targetMonth, scopes})`。集計値スナップショットを `MonthlyReport.aggregated` に固定、`status=FINALIZED`、`finalizedAt` 記録。確定済み月の `grossProfit.recalc` / `incentive.adjustJoint` は `IncentiveLockedError` 409。`monthlyReport.unlock({reportId, reason})` は wholesaler_admin のみで監査ログ。
- **参照**: docs/02 §F-050、docs/05 §5.2 §6.1
- **完了判定**: 確定後の書込ロック、unlock の権限制御、Vitest 4 ケース。

### T-06-10 二次店向け成績・インセンティブ確認

- **何を実装**: `app/(dealer)/monthly/page.tsx` (S-069) で自社の月次成績を Recharts 表示、`app/(dealer)/incentives/page.tsx` (S-070) でインセンティブ確定額・下書き額・取消・負調整を表示。`relationship` ごとに切替（多対多）。仕入値は API レスポンスに含まれない。
- **参照**: docs/02 §F-051、docs/04 §1.5
- **完了判定**: 他社二次店情報・仕入値の非開示を Vitest で確認、Playwright spec 1 件。

### T-06-11 BI ダッシュボード

- **何を実装**: `app/(wholesaler)/bi/page.tsx` (S-051)。Recharts で売上・粗利・契約数・成約率の時系列、ランキング（二次店別 / 店舗別）。期間/体制/二次店フィルタ。ロール別権限フィルタ（wholesaler_event_team は自社開催のみ等）。
- **参照**: docs/02 §F-056、docs/04 §1.3 S-051
- **完了判定**: 各グラフが描画、フィルタ動作、Playwright spec 1 件。

### T-06-12 E2E：UC-04 + UC-05

- **何を実装**: `tests/e2e/uc04-cancellation.spec.ts`（期限内/期限後の 2 シナリオ）と `tests/e2e/uc05-monthly-close.spec.ts`（月次集計 → コメント → 確定 → 二次店確認）。
- **参照**: docs/02 §UC-04 §UC-05
- **完了判定**: 両 spec が安定して green。

## 5. テスト計画

**Vitest**：

- `computeIncentiveAmount` 5 ケース（自社/二次店/共同/0 円/率未設定）
- `IncentiveService.cancelContract` 4 ケース（期限内/期限後/重複/未契約）
- `MonthlyReportService.aggregate` 4 ケース（4 scope）+ パフォーマンステスト（100 二次店 / 1,000 契約 < 5s）
- 月次確定後の書込ロック 4 ケース

**Playwright**：

- `tests/e2e/uc04-cancellation.spec.ts`
- `tests/e2e/uc05-monthly-close.spec.ts`
- `tests/e2e/dealer/monthly-view.spec.ts`（仕入値非表示）

## 6. 完了判定

- 上記 12 タスク全て `## DONE`
- Vitest / Playwright が green
- UC-04 と UC-05 が E2E で通る
- 契約成立 → インセンティブ自動計算 → キャンセル取消／負調整 → 月次集計 → 確定 が一気通貫で動作
- BI ダッシュボードが Recharts で描画され、ロール別フィルタが効く
- SP-07 が通知 + 監査ログ + 横断 E2E に進める状態
