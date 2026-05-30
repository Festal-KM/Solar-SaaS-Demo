-- Solar-SaaS — LanePreference / LanePreferenceItem (二次店レーン希望)
--
-- 二次店が月単位で、卸業者の作成したレーン(LineEvent)から参加希望を優先順位
-- 付きで提出する（F-060）。RLS は DealerPreference (20260525000000) と同じ
-- relationshipId ベース: 卸業者は自テナント配下の Relationship 経由で参照、
-- 二次店は current_relationship_ids GUC 経由で自分の分のみ、saas_admin は全件。
-- LanePreferenceItem は親 LanePreference 経由で同じ可視性。

-- CreateTable
CREATE TABLE "LanePreference" (
    "id" TEXT NOT NULL,
    "wholesalerId" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "targetMonth" TEXT NOT NULL,
    "comment" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedBy" TEXT NOT NULL,

    CONSTRAINT "LanePreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LanePreferenceItem" (
    "id" TEXT NOT NULL,
    "lanePreferenceId" TEXT NOT NULL,
    "lineEventId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,

    CONSTRAINT "LanePreferenceItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LanePreference_relationshipId_targetMonth_key" ON "LanePreference"("relationshipId", "targetMonth");
CREATE INDEX "LanePreference_wholesalerId_targetMonth_idx" ON "LanePreference"("wholesalerId", "targetMonth");
CREATE INDEX "LanePreferenceItem_lanePreferenceId_idx" ON "LanePreferenceItem"("lanePreferenceId");

-- AddForeignKey
ALTER TABLE "LanePreferenceItem" ADD CONSTRAINT "LanePreferenceItem_lanePreferenceId_fkey" FOREIGN KEY ("lanePreferenceId") REFERENCES "LanePreference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE "LanePreference"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LanePreference"     FORCE  ROW LEVEL SECURITY;
ALTER TABLE "LanePreferenceItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LanePreferenceItem" FORCE  ROW LEVEL SECURITY;

-- LanePreference — relationshipId ベース（DealerPreference と同じ三分岐）。
DROP POLICY IF EXISTS "LanePreference_isolation" ON "LanePreference";
CREATE POLICY "LanePreference_isolation" ON "LanePreference"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    current_setting('app.is_saas_admin', true)::text = 'true'
    OR (
      COALESCE(current_setting('app.current_dealer_id', true), '') = ''
      AND EXISTS (
        SELECT 1 FROM "Relationship" r
        WHERE r."id" = "LanePreference"."relationshipId"
          AND r."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
      )
    )
    OR "relationshipId" = ANY (
      string_to_array(
        COALESCE(current_setting('app.current_relationship_ids', true), ''),
        ','
      )
    )
  )
  WITH CHECK (
    current_setting('app.is_saas_admin', true)::text = 'true'
    OR (
      COALESCE(current_setting('app.current_dealer_id', true), '') = ''
      AND EXISTS (
        SELECT 1 FROM "Relationship" r
        WHERE r."id" = "LanePreference"."relationshipId"
          AND r."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
      )
    )
    OR "relationshipId" = ANY (
      string_to_array(
        COALESCE(current_setting('app.current_relationship_ids', true), ''),
        ','
      )
    )
  );

-- LanePreferenceItem — 親 LanePreference 経由で可視性を継承。
DROP POLICY IF EXISTS "LanePreferenceItem_isolation" ON "LanePreferenceItem";
CREATE POLICY "LanePreferenceItem_isolation" ON "LanePreferenceItem"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "LanePreference" lp
      WHERE lp."id" = "LanePreferenceItem"."lanePreferenceId"
        AND (
          current_setting('app.is_saas_admin', true)::text = 'true'
          OR (
            COALESCE(current_setting('app.current_dealer_id', true), '') = ''
            AND EXISTS (
              SELECT 1 FROM "Relationship" r
              WHERE r."id" = lp."relationshipId"
                AND r."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
            )
          )
          OR lp."relationshipId" = ANY (
            string_to_array(
              COALESCE(current_setting('app.current_relationship_ids', true), ''),
              ','
            )
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "LanePreference" lp
      WHERE lp."id" = "LanePreferenceItem"."lanePreferenceId"
        AND (
          current_setting('app.is_saas_admin', true)::text = 'true'
          OR (
            COALESCE(current_setting('app.current_dealer_id', true), '') = ''
            AND EXISTS (
              SELECT 1 FROM "Relationship" r
              WHERE r."id" = lp."relationshipId"
                AND r."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
            )
          )
          OR lp."relationshipId" = ANY (
            string_to_array(
              COALESCE(current_setting('app.current_relationship_ids', true), ''),
              ','
            )
          )
        )
    )
  );
