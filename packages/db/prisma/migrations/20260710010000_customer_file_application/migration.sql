-- 各設置申請（Application）に関連ドキュメントを紐づける。CustomerFile に nullable FK を追加。
-- null は顧客レベルの汎用ファイル（従来どおり）。onDelete: SetNull で申請削除時もファイルは残す。
-- 非破壊: 既存テーブルへ nullable カラム + 索引を追加するのみ。

ALTER TABLE "CustomerFile" ADD COLUMN "applicationId" TEXT;

ALTER TABLE "CustomerFile"
  ADD CONSTRAINT "CustomerFile_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CustomerFile_applicationId_idx" ON "CustomerFile"("applicationId");
