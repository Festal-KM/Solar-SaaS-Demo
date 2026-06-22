-- Construction.surveyStatus: dedicated 現地調査ステータス, separate from the
-- 施工ステータス enum (Construction.status). Non-destructive ADD COLUMN (nullable).
-- Domain: not_surveyed / scheduled / surveyed.
ALTER TABLE "Construction" ADD COLUMN "surveyStatus" TEXT;
