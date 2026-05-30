// Pure aggregator for the dealer-preference status screen
// (T-03-07 / F-022 / docs/04 §1.3 S-025/S-026 / docs/05 §4.5).
//
// 入力:
//   - visibility: 公開対象の二次店関係 (EventCandidateVisibility.isVisible=true)
//   - preferences: 提出済み DealerPreference 行 (per relationship)
//   - deadlineAt: EventCandidate.deadlineAt
//   - now: 判定時刻 (テスト容易性のため明示注入)
//
// 出力:
//   - rows: 各公開対象二次店 1 行 = 1 サマリ。提出済みなら priority 等を含み、
//           未提出なら status は PENDING（期限前）/ OVERDUE（期限超過）。
//   - totals: 集計（公開対象数 / 提出数 / 未提出数 / 期限超過数）。
//
// 設計判断:
//   - 「公開対象 (visibility=true) だが未提出かつ deadline 超過」を OVERDUE と扱う
//     (docs/02 §F-022 受入基準「期限超過の未提出二次店を強調」)。
//   - 「提出済み」は deadline 超過後でも SUBMITTED のまま（取り下げは別フロー）。
//   - 「公開取消済み (isVisible=false)」は visibility 入力から除外する責務を呼び出し側
//     (data ローダ) が負う。本サービスは渡された visibility 行を「全て公開対象」と
//     見なして集計する。

export type PreferenceSubmissionStatus = "SUBMITTED" | "PENDING" | "OVERDUE";

export interface VisibilityInput {
  relationshipId: string;
  dealerId: string;
  dealerName: string;
}

export interface PreferenceInput {
  id: string;
  relationshipId: string;
  priority: number | null;
  availableDates: string[];
  availablePeople: number | null;
  comment: string | null;
  submittedAt: Date;
}

export interface DealerPreferenceSummaryRow {
  relationshipId: string;
  dealerId: string;
  dealerName: string;
  status: PreferenceSubmissionStatus;
  preference: {
    id: string;
    priority: number | null;
    availableDates: string[];
    availablePeople: number | null;
    comment: string | null;
    submittedAt: string;
  } | null;
}

export interface DealerPreferenceSummaryTotals {
  visible: number;
  submitted: number;
  pending: number;
  overdue: number;
}

export interface DealerPreferenceSummary {
  rows: DealerPreferenceSummaryRow[];
  totals: DealerPreferenceSummaryTotals;
}

export interface SummariseInput {
  visibility: readonly VisibilityInput[];
  preferences: readonly PreferenceInput[];
  deadlineAt: Date;
  now: Date;
}

/**
 * 二次店希望状況サマリを集計する純関数。
 *
 * - visibility は「公開対象 (isVisible=true)」のみが渡される前提。
 * - 提出済みは同一 relationshipId の preferences[] エントリで結合する。
 * - 期限超過 (`now >= deadlineAt`) かつ未提出 → status=OVERDUE。
 *   提出済みなら期限超過後でも SUBMITTED。
 * - rows の並び順は visibility の渡された順を保持する（呼び出し側で dealerName ソート）。
 */
export function summariseDealerPreferences(input: SummariseInput): DealerPreferenceSummary {
  const { visibility, preferences, deadlineAt, now } = input;
  const deadlinePassed = now.getTime() >= deadlineAt.getTime();
  const prefByRel = new Map<string, PreferenceInput>();
  for (const p of preferences) {
    prefByRel.set(p.relationshipId, p);
  }

  const rows: DealerPreferenceSummaryRow[] = visibility.map((v) => {
    const pref = prefByRel.get(v.relationshipId);
    if (pref) {
      return {
        relationshipId: v.relationshipId,
        dealerId: v.dealerId,
        dealerName: v.dealerName,
        status: "SUBMITTED" as const,
        preference: {
          id: pref.id,
          priority: pref.priority,
          availableDates: pref.availableDates,
          availablePeople: pref.availablePeople,
          comment: pref.comment,
          submittedAt: pref.submittedAt.toISOString(),
        },
      };
    }
    return {
      relationshipId: v.relationshipId,
      dealerId: v.dealerId,
      dealerName: v.dealerName,
      status: deadlinePassed ? ("OVERDUE" as const) : ("PENDING" as const),
      preference: null,
    };
  });

  const totals: DealerPreferenceSummaryTotals = {
    visible: rows.length,
    submitted: rows.filter((r) => r.status === "SUBMITTED").length,
    pending: rows.filter((r) => r.status === "PENDING").length,
    overdue: rows.filter((r) => r.status === "OVERDUE").length,
  };

  return { rows, totals };
}
