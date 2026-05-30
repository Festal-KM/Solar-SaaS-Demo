// Zod schemas for the dealer preference workflow (T-03-06 / F-021 /
// docs/05 §4.5).
//
// DealerPreference は (eventCandidateId, relationshipId) UNIQUE。同じ
// 二次店から同じ候補への重複提出は許されず、二度目以降は更新扱い。
// 受入基準 (docs/02 §F-021):
//   - 対象年月 + 1 件以上の候補に対する希望が必須 — 「1 件以上」の担保は
//     UI 側で「複数 EventCandidate に対して個別に submit する」形で行う
//     (= 単一画面で複数の preference 入力をまとめて送る形は採らない)。
//   - 回答期限後の編集試行は 409
//   - 同一店舗に複数二次店の希望は許可（DB UNIQUE は
//     (eventCandidateId, relationshipId) のみ）
//
// 状態機械はアプリ層で：
//   - EventCandidate.status === 'OPEN' のときのみ submit / update / withdraw 可。
//   - 期限超過 (deadlineAt < now()) は DealerPreferenceClosedError (409,
//     DEADLINE_PASSED) を投げる（Zod は時刻を検証しない — submitTime を
//     schema 側で握っていない）。

import { z } from "zod";

// YYYY-MM. EventCandidate.targetMonth と同じ形式 (docs/05 §3.4)。
const targetMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "対象年月は YYYY-MM 形式で入力してください");

// Date or string acceptor — Server Action がそのまま withTenant tx で Date を
// 使うため、ここで Date に正規化する。
const dateLike = z.union([z.string(), z.date()]).transform((v, ctx) => {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "日付の形式が正しくありません" });
    return z.NEVER;
  }
  return d;
});

// 0〜3 程度の優先順位。Prisma 側は Int? なので範囲は緩く、UI 側で 0..3 に丸める。
// 任意項目。
const priority = z.number().int().min(0).max(10).optional();

// 対応可能日 (Date[]) — 最大 31 件 (1 ヶ月分以上は無意味)。
const availableDates = z.array(dateLike).max(31, "対応可能日は 31 件までです").optional();

// 対応可能人数 (例: 2 名)。
const staffCount = z.number().int().min(0).max(999).optional();

const note = z.string().trim().max(2000).optional();

// 提出 (新規 + upsert 更新どちらも同一ペイロード形式)。
// `eventCandidateId` と `relationshipId` はパス経由でも渡せるが、Server Action は
// 単一の input オブジェクトを受け取るため schema にも含める。
export const DealerPreferenceSubmitSchema = z.object({
  eventCandidateId: z.string().min(1, "イベント候補 ID が必要です"),
  relationshipId: z.string().min(1, "二次店関係 ID が必要です"),
  targetMonth,
  priority,
  availableDates,
  staffCount,
  note,
});
export type DealerPreferenceSubmit = z.infer<typeof DealerPreferenceSubmitSchema>;

// 更新ペイロード。eventCandidateId / relationshipId は同定キーなので必須。
export const DealerPreferenceUpdateSchema = z.object({
  eventCandidateId: z.string().min(1, "イベント候補 ID が必要です"),
  relationshipId: z.string().min(1, "二次店関係 ID が必要です"),
  targetMonth: targetMonth.optional(),
  priority,
  availableDates,
  staffCount,
  note,
});
export type DealerPreferenceUpdate = z.infer<typeof DealerPreferenceUpdateSchema>;

// 取り下げ。OPEN かつ期限内なら delete、それ以外は DealerPreferenceClosedError
// (409, DEADLINE_PASSED) もしくは InvalidStateTransitionError (422)。
export const DealerPreferenceWithdrawSchema = z.object({
  eventCandidateId: z.string().min(1, "イベント候補 ID が必要です"),
  relationshipId: z.string().min(1, "二次店関係 ID が必要です"),
});
export type DealerPreferenceWithdraw = z.infer<typeof DealerPreferenceWithdrawSchema>;
