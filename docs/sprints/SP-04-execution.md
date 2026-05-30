# SP-04 — execution (イベント実施 + 顧客 + アポ + マエカク)

## 1. 目的

開催体制決定済みイベントの配属表示、当日の開始・終了・成果報告、顧客登録（PII マスキング対応）、アポ管理、マエカク管理（コール部隊キュー）、マエカク結果連絡と二次店側確認までを実装する。docs/02 UC-01 後半 + UC-02 前半が成立する状態にする。

## 2. 対応機能 ID

P0：**F-027, F-028, F-029, F-030, F-031, F-032, F-033, F-034, F-035, F-036, F-037**

参照：`docs/02 §1.4-F-027〜F-030 §1.5 §UC-01 §UC-02`, `docs/03 §4.3 §4.6`, `docs/04 §1.3 S-029〜S-036 §1.4 S-055〜S-057 §1.5 S-061〜S-066 §1.6 S-073〜S-077`, `docs/05 §3.5 §4.6 §4.7 §6.5 §7.2`

## 3. タスク一覧

| ID | 概要 | 受け入れ基準（要旨） | 対応機能 ID | 工数 |
|---|---|---|---|---|
| T-04-01 | Prisma schema 拡張（EventReport / Customer / Appointment / PreCall / PreCallNotification） | docs/05 §3.5 のテーブル群、enum（EventReportType, CustomerStatus, AcquisitionChannel, AppointmentStatus, PreCallResult）、RLS、`@@index` | F-028〜F-037 | M |
| T-04-02 | 配属済みイベント一覧・詳細 (S-029/S-030/S-061/S-062) | `GET /api/events?status=&from=&to=` と `GET /api/events/[id]`、二次店は自社が担当・参加するイベントのみ表示 | F-027 | M |
| T-04-03 | イベント開始・終了報告 (S-031/S-056/S-063/S-076) | `eventReport.start/end(input)`、添付画像最大 5 枚（R2 pre-signed URL）、共同開催は二次店・自社両方から各 1 件、終了報告は開始未提出時に警告表示 | F-028, F-029 | M |
| T-04-04 | イベント成果報告 (S-031/S-056/S-063/S-076 続き) | `eventReport.result(input)`、声かけ・アンケート・アポ取得・有効アポ・無効アポを 0 以上整数、`有効 + 無効 <= アポ取得` バリデーション | F-030 | M |
| T-04-05 | MaskingService（PII マスキング純関数 + ViewerContext） | `packages/contracts/services/masking.ts` に `maskPhone/maskAddress/maskName` 純関数、ロール × `piiMaskingMode` のマトリクステスト 6 ケース、`apps/web/lib/masking/` に `revealPii()` Prisma 依存ラッパ（監査ログ TODO） | F-031, F-055 部分 | M |
| T-04-06 | 顧客登録・編集 (S-032/S-033/S-057/S-064/S-065/S-074) | `customer.create/update`、催事チャネルで `sourceEventId` 必須 refine、卸業者テナント内重複電話番号は警告（マージ候補提示は MVP では最小実装）、PII マスキング適用 | F-031 | L |
| T-04-07 | 顧客一覧・検索 (S-032/S-064) | `GET /api/customers?query=&status=&channel=&page=` ページネーション 50 件、二次店は自社関与の顧客のみ、shadcn DataTable + 検索バー | F-032 | M |
| T-04-08 | アポ登録・編集 + 一覧 (S-034/S-074/S-075) | `appointment.create/update/cancel`、顧客・訪問予定日時・アポ取得者・アポ取得組織必須、ステータス遷移（未確認→マエカク済み→訪問済み/キャンセル/不在/日程変更） | F-033, F-034 | M |
| T-04-09 | マエカク管理 (S-035) | `preCall.record(input)` Server Action、コール結果（承認/不在/折り返し/キャンセル/日程変更）でアポステータス自動更新、二次店ロールはマエカク履歴閲覧不可 | F-035 | M |
| T-04-10 | マエカク結果連絡 + 二次店確認 (S-036/S-066/S-077) | `preCallNotification.send/acknowledge(input)`、対象二次店（アポ獲得 + 担当）に通知レコード作成、二次店側で「確認済み」操作時に時刻記録、24h 未連絡で WS 側通知（SP-07 で実装、ここでは PreCallNotification ステータス管理のみ） | F-036, F-037 | M |
| T-04-11 | 現場要員ダッシュボード + アポ顧客登録（現場フォーム） (S-053/S-057) | wholesaler_field_staff 用のスマホ最適化ダッシュボード（今日のシフト + クイック報告 + クイックアポ登録）、Sheet ベースで再利用 | F-026, F-027, F-031, F-033 | M |
| T-04-12 | E2E：UC-01 後半 + UC-02 前半（イベント実施 → アポ → マエカク → 結果連絡） | Playwright で dealer_staff / wholesaler_call_team / dealer_admin を切替え、UC-01 step 8-10 + UC-02 step 1-5 を一気通貫 | F-027〜F-037, UC-01, UC-02 | M |

## 4. タスク詳細

### T-04-01 Prisma schema 拡張

- **何を実装**: docs/05 §3.5 の `EventReport`, `Customer`, `Appointment`, `PreCall`, `PreCallNotification`。enum 群を `packages/contracts/enums.ts` に集約。RLS は Customer (`wholesalerId`)、Appointment (customer 経由)、PreCallNotification (`relationshipId`) を設定。
- **参照**: docs/05 §3.5 §3.9
- **完了判定**: migration green、Vitest 統合テストでテナント分離が機能。

### T-04-02 配属済みイベント一覧・詳細

- **何を実装**: `app/(wholesaler)/events/` と `app/(dealer)/events/`。`GET /api/events?status=&from=&to=` で権限フィルタ：wholesaler は全イベント、dealer は `EventDealer.relationshipId IN myRelationships` のもの。詳細は報告状況・担当者・シフト・関連顧客を統合表示。
- **参照**: docs/02 §F-027、docs/05 §4.6
- **完了判定**: 二次店ロールで他社開催イベントが見えない、Vitest 3 ケース、Playwright spec 1 件。

### T-04-03 イベント開始・終了報告

- **何を実装**: S-031 / S-056 / S-063 / S-076。`eventReport.start/end(input)` Server Action。添付画像は `POST /api/files/presign` でキー発行 → クライアントから R2 への直 PUT → サーバで keys を `EventReport.payload.attachments` に保存。max 5 枚、各 10MB。
- **参照**: docs/02 §F-028 §F-029、docs/05 §4.6 §8.2 §8.3
- **完了判定**: 1 イベント / 二次店または自社で 1 件、共同は両方 1 件、Vitest 3 ケース。Playwright で添付モック。

### T-04-04 イベント成果報告

- **何を実装**: `eventReport.result(input)`、payload に声かけ数・アンケート数・アポ取得数・有効アポ数・無効アポ数・コメント。Zod refine で `validAppts + invalidAppts <= totalAppts`、全項目 0 以上整数。
- **参照**: docs/02 §F-030、docs/05 §4.6
- **完了判定**: バリデーション 4 ケース。

### T-04-05 MaskingService

- **何を実装**: `packages/contracts/services/masking.ts` に純関数 `maskPhone(phone, viewer)`、`maskAddress(address, viewer)`、`maskName(name, viewer)`。`ViewerContext = { role, tenantType, isSelfTenant, piiMaskingMode }`。`apps/web/lib/masking/reveal.ts` に Prisma 依存 `revealPii(customerId, viewer, reason)`（監査ログ書き込みは SP-07 で本格化、ここでは TODO コメント + 最低限のログ）。
- **参照**: docs/03 §4.3、docs/05 §6.5
- **完了判定**: Vitest で WHOLESALER_ADMIN×FULL / DEALER_ADMIN×MASKED / SAAS_ADMIN×強制マスク / WS×PARTIAL の組合せで 6 ケース green。

### T-04-06 顧客登録・編集

- **何を実装**: `app/(wholesaler)/customers/` と `app/(dealer)/customers/`。`customer.create/update` で氏名・フリガナ・電話・住所等を保存。`channel === EVENT` のとき `sourceEventId` 必須を Zod refine。同一卸業者テナント内で電話番号重複時は警告表示（MVP は単純な重複検出のみ）。
- **参照**: docs/02 §F-031、docs/05 §3.5 §4.7
- **完了判定**: 催事チャネル × sourceEventId 未指定で 400、PII マスキングが描画時に適用される、Vitest 4 ケース。

### T-04-07 顧客一覧・検索

- **何を実装**: S-032 / S-064。`GET /api/customers?query=&status=&channel=&page=` で 50 件/ページ、`PagedCustomerDto`。検索は氏名・電話・住所部分一致。二次店は `owner_relationship_id IN myRelationships` のみ。
- **参照**: docs/02 §F-032、docs/05 §4.7
- **完了判定**: ページネーション動作、検索ヒット、二次店フィルタが Vitest 3 ケース。

### T-04-08 アポ登録・編集 + 一覧

- **何を実装**: `app/(wholesaler)/appointments/` (S-034) と `app/(dealer)/appointments/` (S-075)。`appointment.create/update/cancel`、`AppointmentSchema` に必須項目バリデーション。一覧はステータス・期間フィルタ。
- **参照**: docs/02 §F-033 §F-034、docs/05 §4.7
- **完了判定**: 必須バリデーション、ステータス遷移 5 種、Vitest 4 ケース。

### T-04-09 マエカク管理

- **何を実装**: `app/(wholesaler)/pre-calls/` (S-035)。`preCall.record(input)` で `PreCall` レコード作成、結果に応じて `Appointment.status` を自動更新（キャンセル→キャンセル、日程変更→日程変更）。二次店ロールは `/pre-calls` URL に 403。
- **参照**: docs/02 §F-035、docs/05 §4.7
- **完了判定**: コール結果ごとの Appointment 自動更新を Vitest 5 ケース。

### T-04-10 マエカク結果連絡 + 二次店確認

- **何を実装**: `app/(wholesaler)/pre-call-notifications/` (S-036) と `app/(dealer)/pre-call-notifications/` (S-066/S-077)。`preCallNotification.send` で対象二次店ごとに `PreCallNotification` レコード作成、status=未連絡。`preCallNotification.acknowledge` で status=確認済み + 確認時刻記録。
- **参照**: docs/02 §F-036 §F-037、docs/05 §4.7
- **完了判定**: 他社案件が二次店側に表示されない、Vitest 3 ケース、Playwright spec 1 件。

### T-04-11 現場要員ダッシュボード + 現場フォーム

- **何を実装**: `app/(field)/page.tsx` (S-053) に今日のシフト + クイック報告ボタン + クイックアポ登録ボタン。`app/(field)/events/[id]/page.tsx` (S-055)。アポ登録は Sheet で開く現場用ミニフォーム (S-057)。
- **参照**: docs/02 §F-026 §F-027 §F-031 §F-033、docs/04 §1.4
- **完了判定**: スマホビューポート (375px) で操作完結、Playwright モバイル spec。

### T-04-12 E2E：UC-01 後半 + UC-02 前半

- **何を実装**: `tests/e2e/uc01-2-event-execution.spec.ts`（UC-01 step 8-10：開始・終了・成果報告 + アポ顧客登録）と `tests/e2e/uc02-precall.spec.ts`（UC-02 step 1-5：アポ登録 → マエカク → 結果連絡 → 二次店確認）。
- **参照**: docs/02 §UC-01 §UC-02
- **完了判定**: 両 spec が安定して green。

## 5. テスト計画

**Vitest**：

- MaskingService 6 ケース（ロール × piiMaskingMode）
- Customer create（催事チャネル × sourceEventId）バリデーション
- EventReport の Type 別ルール（共同開催は 1 件ずつ）
- Appointment 状態機械
- PreCall 結果 → Appointment 自動更新
- PreCallNotification の二次店フィルタ

**Playwright**：

- `tests/e2e/uc01-2-event-execution.spec.ts`
- `tests/e2e/uc02-precall.spec.ts`
- `tests/e2e/field/mobile-flow.spec.ts`（スマホビューポートで現場フロー）

## 6. 完了判定

- 上記 12 タスク全て `## DONE`
- Vitest / Playwright が green
- UC-01 step 8-10 と UC-02 step 1-5 が E2E で通る
- 現場要員がスマホで開始 → 終了 → 成果報告 → アポ顧客登録までスムーズに完結
- 二次店ロールがマエカク結果を確認できるが履歴は閲覧できない
- SP-05 が商談・契約に進める状態（顧客・アポ・マエカク完了レコードが存在）
