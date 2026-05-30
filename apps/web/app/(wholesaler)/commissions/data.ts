// 手数料一覧 — SAMPLE / PLACEHOLDER data.
//
// NOTE: This is static sample content only. There is no commission aggregation
// model wired yet — real data will come from the incentive domain
// (インセンティブ確定 → 手数料集計) as a follow-up. No auth / withTenant here
// because nothing touches the DB; this module is imported by the server page so
// the page stays a server component. When the aggregation lands, replace the
// in-memory arrays with a withTenant loader and gate it with assertCan.

import "server-only";

export type PaymentStatus = "pending" | "unpaid" | "partial" | "paid";

// 対応範囲: クロージングまで対応 / トスアップ（アポ獲得）のみ。
export type CaseScope = "closing" | "tossup";

export interface CommissionCase {
  id: string;
  customerName: string;
  contractAmount: number; // JPY
  scope: CaseScope;
  incentiveRate: number; // percent, e.g. 3 or 1.5
  fee: number; // JPY
  note: string; // 備考
}

export interface DealerCommissionSummary {
  id: string;
  dealerName: string;
  targetMonth: string; // YYYY-MM
  customerCount: number; // 対象顧客数
  closingCount: number; // クロージング件数
  tossUpCount: number; // トスアップ件数
  totalFee: number; // 手数料合計 JPY
  paymentStatus: PaymentStatus;
  updatedAt: string; // ISO
  cases: CommissionCase[];
}

export interface CommissionFilter {
  targetMonth?: string;
  dealerId?: string;
  paymentStatus?: string;
}

export interface DealerOption {
  id: string;
  dealerName: string;
}

// 対象顧客数 / クロージング件数 / トスアップ件数 / 手数料合計は明細から導出する。
function summarize(
  partial: Omit<
    DealerCommissionSummary,
    "customerCount" | "closingCount" | "tossUpCount" | "totalFee"
  >,
): DealerCommissionSummary {
  return {
    ...partial,
    customerCount: partial.cases.length,
    closingCount: partial.cases.filter((c) => c.scope === "closing").length,
    tossUpCount: partial.cases.filter((c) => c.scope === "tossup").length,
    totalFee: partial.cases.reduce((sum, c) => sum + c.fee, 0),
  };
}

// 対応範囲ごとの率（サンプル）: クロージング 3.0% / トスアップ 1.5%。
function mkCase(
  id: string,
  customerName: string,
  contractAmount: number,
  scope: CaseScope,
  note: string,
): CommissionCase {
  const incentiveRate = scope === "closing" ? 3 : 1.5;
  return {
    id,
    customerName,
    contractAmount,
    scope,
    incentiveRate,
    fee: Math.round((contractAmount * incentiveRate) / 100),
    note,
  };
}

const SAMPLE_DEALERS: DealerCommissionSummary[] = [
  summarize({
    id: "dlr-001",
    dealerName: "サンライズエナジー株式会社",
    targetMonth: "2026-06",
    paymentStatus: "pending",
    updatedAt: "2026-06-02T14:32:00+09:00",
    cases: [
      mkCase("case-1001", "山田 太郎", 2_800_000, "closing", "成約"),
      mkCase("case-1002", "佐藤 花子", 1_950_000, "tossup", "アポ獲得"),
      mkCase("case-1003", "鈴木 一郎", 3_200_000, "closing", "成約"),
      mkCase("case-1004", "田中 美咲", 1_500_000, "tossup", "見積提出"),
      mkCase("case-1005", "伊藤 健太", 2_100_000, "closing", "成約"),
      mkCase("case-1006", "渡辺 そら", 2_640_000, "closing", "成約"),
    ],
  }),
  summarize({
    id: "dlr-002",
    dealerName: "グリーンソル株式会社",
    targetMonth: "2026-06",
    paymentStatus: "paid",
    updatedAt: "2026-06-01T11:05:00+09:00",
    cases: [
      mkCase("case-2001", "田中 健太", 4_120_000, "closing", "成約"),
      mkCase("case-2002", "伊藤 由美", 2_640_000, "closing", "成約"),
      mkCase("case-2003", "渡辺 修", 1_980_000, "tossup", "アポ獲得"),
    ],
  }),
  summarize({
    id: "dlr-003",
    dealerName: "エコソリューションズ合同会社",
    targetMonth: "2026-06",
    paymentStatus: "partial",
    updatedAt: "2026-05-31T18:47:00+09:00",
    cases: [
      mkCase("case-3001", "中村 隆", 3_140_000, "closing", "成約"),
      mkCase("case-3002", "小林 さくら", 2_300_000, "tossup", "見積提出"),
      mkCase("case-3003", "加藤 大輔", 1_780_000, "tossup", "アポ獲得"),
      mkCase("case-3004", "吉田 真央", 2_220_000, "closing", "成約"),
      mkCase("case-3005", "山本 和也", 2_360_000, "closing", "成約"),
    ],
  }),
  summarize({
    id: "dlr-004",
    dealerName: "ソーラーパートナーズ株式会社",
    targetMonth: "2026-06",
    paymentStatus: "unpaid",
    updatedAt: "2026-05-30T09:18:00+09:00",
    cases: [
      mkCase("case-4001", "松本 翔", 3_960_000, "closing", "成約"),
      mkCase("case-4002", "井上 葵", 2_880_000, "tossup", "アポ獲得"),
      mkCase("case-4003", "木村 直樹", 2_840_000, "closing", "成約"),
    ],
  }),
];

// 二次店プルダウンの選択肢（サンプルデータから導出）。
export function listCommissionDealers(): DealerOption[] {
  return SAMPLE_DEALERS.map((d) => ({ id: d.id, dealerName: d.dealerName }));
}

// In-memory equality filtering over the sample data (targetMonth / dealer /
// paymentStatus). Returns a shallow copy so callers can't mutate the source.
export function listCommissions(filter: CommissionFilter = {}): DealerCommissionSummary[] {
  return SAMPLE_DEALERS.filter((d) => {
    if (filter.targetMonth && d.targetMonth !== filter.targetMonth) return false;
    if (filter.dealerId && d.id !== filter.dealerId) return false;
    if (filter.paymentStatus && d.paymentStatus !== filter.paymentStatus) return false;
    return true;
  }).map((d) => ({ ...d, cases: [...d.cases] }));
}
