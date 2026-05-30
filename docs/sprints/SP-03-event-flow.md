# SP-03 — event-flow (場所取り〜開催体制 + シフト)

## 1. 目的

場所提供元との交渉履歴、イベント候補登録・公開、二次店からの希望提出、卸業者側での希望状況確認、開催体制決定（自社/二次店/共同/中止）、イベント単位スコープ上書き、自社要員シフト割当（重複・必要人数充足チェック）までを実装する。docs/02 UC-01 の前半が成立する状態にする。

## 2. 対応機能 ID

P0：**F-017, F-018, F-019, F-020, F-021, F-022, F-023, F-024, F-025, F-026**

参照：`docs/02 §1.3 §1.4 §F-017〜F-026 §UC-01`, `docs/03 §15`, `docs/04 §1.3 S-021〜S-029 §1.4 S-053〜S-054 §1.5 S-058〜S-061`, `docs/05 §3.4 §4.5 §4.6 §6.3 §7.1`

## 3. タスク一覧

| ID | 概要 | 受け入れ基準（要旨） | 対応機能 ID | 工数 |
|---|---|---|---|---|
| T-03-01 | Prisma schema 拡張（VenueNegotiation / EventCandidate / EventCandidateVisibility / DealerPreference / Event / EventDealer / EventShift / EventChange） | docs/05 §3.4 の全テーブルが migration、enum 定義、RLS ポリシー、`@@unique([userId, startPlanned, endPlanned])` のシフト重複制約 | F-017〜F-025 | L |
| T-03-02 | 場所提供元対応一覧・詳細 (S-021/S-022) + Server Action | `venueNegotiation.{create,update,changeStatus,promoteToCandidate}`、ステータス遷移、対応履歴、二次店 403 | F-017 | M |
| T-03-03 | イベント候補登録・編集 (S-023/S-024) + Server Action | `eventCandidate.{create,update,publish,close,cancel}`、必須フィールド、対象年月・実施予定日・場所名・回答期限の検証、卸業者内部メモは二次店不可視 | F-018 | M |
| T-03-04 | イベント候補の二次店共有 (公開トグル + 対象二次店フィルタ) | `eventCandidate.updateVisibility(input)`、`EventCandidateVisibility` 更新、`event.publish_followups` ジョブを enqueue（通知本体は SP-07）、二次店向け API は固定費・成果報酬率・他社希望を含まない | F-019 | M |
| T-03-05 | 二次店向けイベント候補閲覧 (S-059) | `GET /api/event-candidates/visible?targetMonth=YYYY-MM`、自社関係の公開候補のみ、関係終了は除外、Vitest で他社情報非表示テスト 3 ケース | F-020 | M |
| T-03-06 | 二次店希望店舗回答 (S-060) | `dealerPreference.{submit,update,withdraw}`、対象年月＋希望店舗 1 件以上必須、期限後編集 409、同一店舗複数二次店応募可 | F-021 | M |
| T-03-07 | 二次店希望状況確認 (S-025/S-026) | `GET /api/dealer-preferences?eventCandidateId=...`、二次店別ビュー + 店舗別ビュー、未提出二次店の明示、期限超過の強調表示 | F-022 | M |
| T-03-08 | イベント開催体制決定 (S-027) | `eventDecision.decide(input)` + `eventDecision.changeMode(input)`、mode 別 Zod refine（二次店開催は担当二次店必須、共同は担当二次店＋必要人数必須）、決定履歴 (`EventChange`)、中止以外で `Event` 生成 | F-023 | L |
| T-03-09 | イベント単位スコープ上書き | `event.updateScopeOverride(input)`、`EventDealer.scopeOverride`、上書きは監査ログ、商談アクション判定に優先（SP-05 で使用） | F-024 | S |
| T-03-10 | 自社要員シフト割当 (S-028) | `shift.{assign,update,unassign}`、`end > start` refine、user × 時間帯重複は DB UNIQUE + アプリ事前チェックで 409、必要人数充足度表示 | F-025 | M |
| T-03-11 | 自分のシフト確認 (S-054 + 現場ダッシュボード S-053) | `GET /api/me/shifts?from=&to=`、wholesaler_field_staff は自分の割当のみ、当日分は最上段固定、スマホ最適化 (Sheet ベース) | F-026 | M |
| T-03-12 | E2E：UC-01 前半（場所提供元交渉 → 候補登録 → 公開 → 希望提出 → 開催体制決定 → シフト割当） | 1 つの Playwright spec で wholesaler_event_team / dealer_admin / wholesaler_admin の 3 ユーザーを切替えながら UC-01 step 1-7 まで通る | F-017〜F-025, UC-01 | M |

## 4. タスク詳細

### T-03-01 Prisma schema 拡張

- **何を実装**: docs/05 §3.4 の 8 テーブル + 関連 enum（EventCandidateStatus, EventMode, DealerScope, EventReportType 等）を migration。RLS ポリシーを VenueNegotiation/EventCandidate/Event は `wholesalerId`、DealerPreference/EventCandidateVisibility/EventDealer は `relationshipId` ベースで追加。シフトの DB UNIQUE 制約 `@@unique([userId, startPlanned])` + tstzrange 排他制約は migration 内で raw SQL。
- **参照**: docs/05 §3.4 §3.9
- **完了判定**: migration green、RLS ポリシーが Vitest 統合テストで他テナント分離を確認。

### T-03-02 場所提供元対応

- **何を実装**: `app/(wholesaler)/venue-negotiations/` に一覧 (S-021) と詳細・対応履歴 (S-022)。Server Action でステータス遷移（未連絡→調整中→条件確認中→実施可→確定 / 実施不可 / 中止）。「確定」ステータスのみイベント候補登録ボタンが活性化。
- **参照**: docs/02 §F-017、docs/05 §4.5
- **完了判定**: 状態機械バリデーション（不正遷移は 422）、二次店 403、Vitest 4 ケース。

### T-03-03 イベント候補登録・編集

- **何を実装**: `app/(wholesaler)/event-candidates/` (S-023/S-024)。Server Action でステータス遷移（下書き→希望受付中→希望受付終了→開催体制決定済み / 中止）。卸業者内部メモ・固定費・成果報酬率を Prisma `select omit` で二次店向け DTO から除外。
- **参照**: docs/02 §F-018、docs/05 §4.5
- **完了判定**: 必須バリデーション、内部メモが二次店 API で漏れない、Vitest 4 ケース。

### T-03-04 二次店共有 + ジョブ enqueue

- **何を実装**: 公開トグル UI（S-023 から S-027 への前段）。`eventCandidate.updateVisibility`。`enqueue('event.publish_followups', {eventCandidateId})` で通知ジョブを発火（SP-07 で通知本体を実装、ここでは graphile-worker ジョブ登録のみ）。
- **参照**: docs/02 §F-019、docs/05 §5.2
- **完了判定**: 公開取消で二次店側 API から消える、Vitest 3 ケース、ジョブ enqueue が job_keys に記録される。

### T-03-05 二次店向け候補閲覧

- **何を実装**: `app/(dealer)/event-candidates/` (S-059)。`GET /api/event-candidates/visible?targetMonth=YYYY-MM` を実装、自社の `relationshipIds` でフィルタ、`EventCandidateDealerViewDto` を返す（仕入値・固定費・成果報酬率・他社希望を含まない）。関係終了済み卸業者の候補は除外。
- **参照**: docs/02 §F-020、docs/05 §4.5
- **完了判定**: Vitest で他社二次店情報・固定費・成果報酬率が API レスポンスに含まれないことを 3 ケースで確認。

### T-03-06 二次店希望提出

- **何を実装**: `app/(dealer)/event-candidates/[id]/preference/page.tsx` (S-060)。`dealerPreference.submit/update/withdraw`、shadcn Form + Calendar。同一イベント候補に対する重複提出は更新扱い。期限後編集は 409。
- **参照**: docs/02 §F-021、docs/05 §4.5
- **完了判定**: 期限後 409、同一店舗に複数二次店応募可（DB UNIQUE は `(eventCandidateId, relationshipId)` のみ）、Vitest 4 ケース。

### T-03-07 二次店希望状況確認

- **何を実装**: `app/(wholesaler)/event-candidates/[id]/preferences/page.tsx` (S-025/S-026)。Server Action で `eventCandidate.fetchPreferences` を実装、レスポンスを「二次店別」「店舗別」の 2 ビューで表示（Tabs）。未提出二次店リストを期限超過時は赤系強調（shadcn Badge `destructive`）。
- **参照**: docs/02 §F-022、docs/05 §4.5
- **完了判定**: 期限超過の二次店が `destructive` バッジで表示、Playwright spec 1 件 green。

### T-03-08 イベント開催体制決定

- **何を実装**: `app/(wholesaler)/event-candidates/[id]/decide/page.tsx` (S-027)。Server Action `eventDecision.decide(input)`。Zod schema を mode 別に refine：`mode=DEALER_HOSTED` は `dealerRelationshipIds.length>=1`、`mode=JOINT` は `dealerRelationshipIds + requiredPeople`。中止以外で `Event` を生成、`EventChange` に決定履歴。決定後にシフト割当画面 (S-028) へ自動遷移。
- **参照**: docs/02 §F-023、docs/05 §3.4 §4.5 §6.3
- **完了判定**: mode 別バリデーション 4 ケース（自社 / 二次店 / 共同 / 中止）、`EventChange` レコード生成、Vitest 4 ケース。

### T-03-09 イベント単位スコープ上書き

- **何を実装**: S-027 / S-030 から `event.updateScopeOverride({eventId, relationshipId, scope, reason})`。`EventDealer.scopeOverride` に保存。商談アクション判定（SP-05）で `DealerScopeService.resolveScope` が `eventDealer.scopeOverride ?? relationship.defaultScope` を返すこと。
- **参照**: docs/02 §F-024、docs/05 §6.4
- **完了判定**: Vitest で「上書きあり」「上書きなし → デフォルト」の 2 ケース green。

### T-03-10 自社要員シフト割当

- **何を実装**: `app/(wholesaler)/events/[id]/shifts/page.tsx` (S-028)。Server Action `shift.assign/update/unassign`。`end > start` の Zod refine、user × 時間帯重複は事前 `findFirst` + DB UNIQUE 二重チェック、409 を返す。必要人数充足度バッジ表示。
- **参照**: docs/02 §F-025、docs/05 §4.6 §6.3
- **完了判定**: 重複 409、`start >= end` 400、必要人数未達でアラート表示、Vitest 4 ケース。

### T-03-11 自分のシフト確認

- **何を実装**: `app/(field)/page.tsx`（S-053 ダッシュボード）+ `app/(field)/shifts/page.tsx` (S-054)。`GET /api/me/shifts?from=&to=` で自分の割当のみ返す。スマホ向けに Sheet ベースの当日カード、当日分は最上段固定。期間フィルタ（今日 / 今週 / カスタム）。
- **参照**: docs/02 §F-026、docs/04 §1.4
- **完了判定**: 他人のシフトが含まれないことを Vitest で確認、Playwright モバイルビューポートで描画確認。

### T-03-12 E2E：UC-01 前半

- **何を実装**: `tests/e2e/uc01-event-flow.spec.ts`。Storage state でロール切替（wholesaler_event_team / dealer_admin / wholesaler_admin）し、UC-01 step 1 〜 7（場所提供元交渉 → 候補登録 → 公開 → 希望提出 → 状況確認 → 開催体制決定 → シフト割当）を一気通貫で実行。
- **参照**: docs/02 §UC-01
- **完了判定**: spec 1 件が安定して green。

## 5. テスト計画

**Vitest**：

- VenueNegotiation 状態機械
- EventCandidate 公開トグル + 二次店 DTO の機密情報非開示
- DealerPreference 期限後 409、複数二次店応募
- EventDecision mode 別 refine（4 シナリオ）
- Shift 重複 409、`end > start` 400
- `DealerScopeService.resolveScope`（上書きあり/なし）

**Playwright**：

- `tests/e2e/uc01-event-flow.spec.ts`（UC-01 step 1-7）
- `tests/e2e/dealer/event-candidates.spec.ts`（二次店向け閲覧）

## 6. 完了判定

- 上記 12 タスク全て `## DONE`
- Vitest / Playwright が green
- UC-01 の step 1-7 が E2E で通る
- 場所提供元交渉 → イベント候補登録 → 公開 → 希望提出 → 開催体制決定 → シフト割当 の主要ユースケースが手動操作でも一気通貫で動作する
- SP-04 がイベント実施・報告・顧客登録に進める状態（`Event` レコードが存在）
