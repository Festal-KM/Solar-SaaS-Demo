-- 商談履歴タブで手動管理する状況。
-- maekakuStatus: "present" | "absent"（マエカク済/未）、nextAction: 次回アクション（自由記述）。
-- 商談ステータスは既存の contractStatus を流用するため新カラムは追加しない。
ALTER TABLE "Customer" ADD COLUMN "maekakuStatus" TEXT;
ALTER TABLE "Customer" ADD COLUMN "nextAction" TEXT;
