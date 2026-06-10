-- Solar-SaaS — LanePreference 旧 comment 列の DROP (F-060 / docs/05 §3.4.3 migration B)
--
-- migration A (20260606000000_lane_preference_bottomup) で comment → note へ退避済み・
-- ローダ/アクション/シードの全参照を note へ移行完了後に実行。値退避済みのため情報損失なし。
ALTER TABLE "LanePreference" DROP COLUMN IF EXISTS "comment";
