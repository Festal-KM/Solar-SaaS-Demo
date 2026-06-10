-- Solar-SaaS — LanePreference / LanePreferenceItem ボトムアップ構造改訂 (F-060 / docs/05 §3.4.3 migration A)
--
-- 旧仕様（卸業者が作成した確定レーン(LineEvent)を二次店が priority 付けするトップダウン）
-- から、二次店が希望場所(venueLabel)・希望開催日(desiredDates)を自由記述で提出する
-- ボトムアップ構造へ。非破壊（既存行は UPDATE で埋める）。comment は本 migration では
-- note へ退避し残置（drop は migration B = 20260606010000_lane_preference_drop_comment）。
--
-- 適用順序（必須）: ADD COLUMN (NULL 許容) → UPDATE バックフィル → DROP NOT NULL (lineEventId)
--                 → 保険 UPDATE → SET NOT NULL (venueLabel)。NOT NULL 化は必ずバックフィル後。
-- RLS は 20260528050000_lane_preference を踏襲し再作成しない（列追加・NULL 化は述語に無影響）。

-- 1) 親ヘッダ: note 追加 + 旧 comment 値をコピー（comment は migration B まで残置）。
ALTER TABLE "LanePreference" ADD COLUMN IF NOT EXISTS "note" TEXT;
UPDATE "LanePreference" SET "note" = "comment" WHERE "comment" IS NOT NULL AND "note" IS NULL;

-- 2) 明細: 新規列を NULL 許容で追加（venueLabel も一旦 NULL 許容）。
ALTER TABLE "LanePreferenceItem" ADD COLUMN IF NOT EXISTS "venueLabel"      TEXT;
ALTER TABLE "LanePreferenceItem" ADD COLUMN IF NOT EXISTS "venueProviderId" TEXT;
ALTER TABLE "LanePreferenceItem" ADD COLUMN IF NOT EXISTS "storeId"         TEXT;
ALTER TABLE "LanePreferenceItem" ADD COLUMN IF NOT EXISTS "desiredDates"    JSONB;
ALTER TABLE "LanePreferenceItem" ADD COLUMN IF NOT EXISTS "memo"            TEXT;

-- 3) lineEventId を NULL 許容へ降格（任意リンク化）。
ALTER TABLE "LanePreferenceItem" ALTER COLUMN "lineEventId" DROP NOT NULL;

-- 4) 既存明細を確定レーン(LineEvent)からバックフィル
--    venueLabel ← LineEvent.name、venueProviderId ← LineEvent.venueProviderId、
--    desiredDates ← LineEvent.scheduledDates。
UPDATE "LanePreferenceItem" li
SET "venueLabel"      = COALESCE(le."name", '（未設定）'),
    "venueProviderId" = le."venueProviderId",
    "desiredDates"    = le."scheduledDates"
FROM "LineEvent" le
WHERE li."lineEventId" = le."id";

-- 5) リンク先 LineEvent が無い孤児明細の保険（venueLabel の NOT NULL 化前に NULL を潰す）。
UPDATE "LanePreferenceItem" SET "venueLabel" = '（未設定）' WHERE "venueLabel" IS NULL;

-- 6) バックフィル完了 → venueLabel を NOT NULL 化。
ALTER TABLE "LanePreferenceItem" ALTER COLUMN "venueLabel" SET NOT NULL;
