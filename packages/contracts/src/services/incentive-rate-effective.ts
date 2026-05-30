// Pure helper — pick the incentive-rate row that's effective at a given
// moment for a single relationship (T-02-06 / F-014 / docs/05 §3.3).
//
// Used by:
//   - Server Action（新規 INSERT 時の整合性チェック、表示用 "現在有効な率"）
//   - Contract snapshot flow（契約日時点の率を抽出して契約に焼き付ける、SP-05）
//
// 重複期間が無い前提（Server Action 側で既存 open row を締める）なので、
// 関数は単一行 or null を返す。複数該当した場合は `effectiveFrom` 最大の行を
// 返す（防御的：本来到達しないが、データ整合バグで重複が残った場合のフェイル
// セーフ）。
//
// Effective window semantics (`Product` と同じ閉開区間):
//   `effectiveFrom <= asOf` AND (`effectiveTo` is null OR `asOf < effectiveTo`)

export interface EffectiveIncentiveRate {
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export function findEffectiveIncentiveRate<T extends EffectiveIncentiveRate>(
  rates: readonly T[],
  asOf: Date,
): T | null {
  const asOfTime = asOf.getTime();
  let best: T | null = null;
  for (const r of rates) {
    const from = r.effectiveFrom.getTime();
    if (from > asOfTime) continue;
    if (r.effectiveTo !== null && asOfTime >= r.effectiveTo.getTime()) continue;
    if (best === null || from > best.effectiveFrom.getTime()) {
      best = r;
    }
  }
  return best;
}
