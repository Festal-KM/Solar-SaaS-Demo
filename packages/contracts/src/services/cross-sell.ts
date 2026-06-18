// F-063 クロスセル候補バッジ判定（docs/05 §17.8 / docs/01 §4.3）.
//
// 既設設備の現況（ヒアリング時点）から提案候補を導出する純関数。MVP は有無ベース
// （経年判定は Phase 2 / docs/02 Open Question 21）。判定は材料の可視化のみで、
// 自動提案・自動起票はしない（人間判断）。バッジ文言は labels.ts に集約（#2）。

import type { ExistingEquipmentDto } from "../dto/project-info.js";

export type CrossSellBadge = "ECO_CUTE_SUGGEST" | "BATTERY_SUGGEST" | "PV_EXPAND_SUGGEST";

// 二次店向け射影（詳細キー除外）でも判定できるよう、必要な 2 キーのみに依存する。
type ExistingEquipmentForBadge = Pick<ExistingEquipmentDto, "category" | "installed">;

/**
 * Derive cross-sell suggestion badges from existing-equipment presence
 * (docs/05 §17.8):
 *   GAS_WATER_HEATER.installed === 'YES' → 'ECO_CUTE_SUGGEST'
 *   ECO_CUTE.installed         === 'YES' → 'BATTERY_SUGGEST'
 *   PV.installed               === 'YES' → 'BATTERY_SUGGEST' + 'PV_EXPAND_SUGGEST'
 *
 * The result is de-duplicated and stable-ordered (ECO_CUTE → BATTERY → PV_EXPAND).
 */
export function deriveCrossSellBadges(
  eqs: readonly ExistingEquipmentForBadge[],
): CrossSellBadge[] {
  const set = new Set<CrossSellBadge>();
  for (const eq of eqs) {
    if (eq.installed !== "YES") continue;
    switch (eq.category) {
      case "GAS_WATER_HEATER":
        set.add("ECO_CUTE_SUGGEST");
        break;
      case "ECO_CUTE":
        set.add("BATTERY_SUGGEST");
        break;
      case "PV":
        set.add("BATTERY_SUGGEST");
        set.add("PV_EXPAND_SUGGEST");
        break;
    }
  }
  const order: CrossSellBadge[] = ["ECO_CUTE_SUGGEST", "BATTERY_SUGGEST", "PV_EXPAND_SUGGEST"];
  return order.filter((b) => set.has(b));
}
