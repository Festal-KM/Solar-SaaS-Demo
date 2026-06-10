// 成果報告（日報）のデータ型 + デモ用の決定論的生成器。
//
// Google フォーム「ES_日報」の項目に準拠。レーン/単発イベント共通で利用する。
// 本番の永続データ連携は今後の課題で、現状はイベント/日付をシードにした
// 決定論的なデモ値を生成する（同じイベント・日付では常に同じ内容になる）。
//
// 純粋な TS モジュール（"use client" なし）なので、Server Component からも
// Client Component からも import できる。

export type ResultReportCategory = "housing" | "realestate";
export type ResultReportChannel = "cainzW" | "cainzV" | "shimachu";

export interface ResultReportData {
  eventDate: string; // 催事実施日 (YYYY-MM-DD)
  franchiseNo: string; // 加盟店番号 (例: ERP12)
  category: ResultReportCategory; // 種別（住宅設備 / 不動産）
  venuePlace: string; // 催事場所（県 + 店舗）
  areaInFacility: string; // 施設内エリア
  startTime: string; // 稼働開始 (HH:MM)
  endTime: string; // 稼働終了 (HH:MM)
  lotteryTotal: number; // 抽選数
  lotteryBoth: number; // 抽選内訳_両面
  lotterySingle: number; // 抽選内訳_片面
  seatedTotal: number; // 着座数
  seatedBoth: number; // 着座内訳_両面
  seatedSingle: number; // 着座内訳_片面
  apptTotal: number; // アポ数
  apptBoth: number; // アポ内訳_両面
  apptSingle: number; // アポ内訳_片面
  salesChannel: ResultReportChannel; // 種別（販売チャネル）
  impression: string; // 所感
}

export interface ResultReportContext {
  date?: string | null; // 催事実施日（YYYY-MM-DD）
  venuePlace?: string | null; // 催事場所（県 + 店舗）
  channel?: ResultReportChannel; // 販売チャネル
}

// 文字列シード → 32bit ハッシュ → mulberry32 PRNG（決定論的）。
function makeRng(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AREAS = [
  "1階エレベーター前",
  "正面入口横",
  "2階催事スペース",
  "レジ前特設ブース",
  "屋外駐車場テント",
  "フードコート横",
];

const PLACES = [
  "群馬県 前橋みなみモール店",
  "埼玉県 浦和美園店",
  "千葉県 幕張店",
  "神奈川県 横浜瀬谷店",
  "東京都 テックランド町田店",
  "栃木県 宇都宮インターパーク店",
  "茨城県 つくば研究学園店",
];

const IMPRESSIONS = [
  "天候に恵まれ来場者多数。蓄電池への関心が高く、好感触のアポを複数獲得。次回も同枠を希望。",
  "午前は客足が鈍かったが午後に挽回。電気代高騰の話題で足を止める方が多かった。",
  "ファミリー層に蓄電池＋V2H の提案が刺さった。単価の高い見込みを確保できた。",
  "高齢層中心。補助金説明への反応が良く、後日訪問のアポにつながった。",
  "オープン直後から問い合わせ多数。要員2名では捌ききれず、増員を検討したい。",
  "競合ブースと隣接し苦戦したが、シミュレーション提示で差別化できた。",
];

const CHANNELS: ResultReportChannel[] = ["cainzW", "cainzV", "shimachu"];

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// イベント/日付をシードにした決定論的なデモ成果報告を生成する。
export function buildDemoResultReport(seed: string, ctx: ResultReportContext = {}): ResultReportData {
  const rng = makeRng(seed || "demo");
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;
  const between = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
  const split = (total: number, ratioMin: number, ratioMax: number): [number, number] => {
    const both = Math.round(total * (ratioMin + rng() * (ratioMax - ratioMin)));
    return [both, Math.max(0, total - both)];
  };

  const lotteryTotal = between(28, 96);
  const [lotteryBoth, lotterySingle] = split(lotteryTotal, 0.4, 0.65);
  const seatedTotal = Math.max(4, Math.round(lotteryTotal * (0.4 + rng() * 0.25)));
  const [seatedBoth, seatedSingle] = split(seatedTotal, 0.4, 0.65);
  const apptTotal = Math.max(2, Math.round(seatedTotal * (0.3 + rng() * 0.25)));
  const [apptBoth, apptSingle] = split(apptTotal, 0.4, 0.65);

  const startHour = pick(["09:30", "10:00", "10:00", "11:00"]);
  const endHour = pick(["17:00", "18:00", "18:00", "19:00"]);

  return {
    eventDate: ctx.date ?? todayStr(),
    franchiseNo: `ERP${String(between(1, 70)).padStart(2, "0")}`,
    category: rng() < 0.82 ? "housing" : "realestate",
    venuePlace: ctx.venuePlace ?? pick(PLACES),
    areaInFacility: pick(AREAS),
    startTime: startHour,
    endTime: endHour,
    lotteryTotal,
    lotteryBoth,
    lotterySingle,
    seatedTotal,
    seatedBoth,
    seatedSingle,
    apptTotal,
    apptBoth,
    apptSingle,
    salesChannel: ctx.channel ?? pick(CHANNELS),
    impression: pick(IMPRESSIONS),
  };
}

// 開始 / 終了報告（コメント主体の簡易レポート）。
export interface EventBasicReport {
  submitter: string;
  submittedAt: string; // 表示用文字列（YYYY/MM/DD HH:MM）
  comment: string;
}

// 1 イベント（1 開催日）の報告一式：開始 / 終了 / 成果（日報）。
export interface EventReportsBundle {
  start: EventBasicReport;
  end: EventBasicReport;
  result: ResultReportData;
}

const REPORTERS = ["イベント班 田中", "イベント班 佐藤", "コール班 鈴木", "直販 高橋"];
const START_COMMENTS = [
  "設営完了、定刻に開始しました。来場者の出足は良好です。",
  "ブース設営完了。チラシ配布を開始しました。",
  "設営完了。隣接催事もあり人通りは多めです。",
];
const END_COMMENTS = [
  "撤収完了。大きなトラブルなく終了しました。",
  "終了。獲得アポのフォローは明日以降に実施します。",
  "撤収完了。雨天で午後の客足はやや鈍化しました。",
];

// イベントで獲得したアポ顧客（アポ取り顧客一覧の 1 行）。
export interface AcquiredCustomer {
  name: string; // 顧客名
  dateTime: string; // アポ日時（表示用）
  address: string; // 住所（市区まで）
  memo: string; // メモ（状況）
}

const APPT_FAMILIES = [
  "佐藤","鈴木","高橋","田中","伊藤","渡辺","山本","中村","小林","加藤",
  "吉田","山田","佐々木","松本","井上","木村","林","清水","森","池田",
];
const APPT_GIVENS = [
  "大輔","健一","翔太","直樹","美咲","陽子","結衣","真一","裕子","隆",
  "聡","典子","和也","愛","健太","恵子","浩二","明美","拓也","真由美",
];
const APPT_CITIES = [
  "東京都世田谷区","東京都杉並区","神奈川県横浜市港北区","神奈川県川崎市宮前区",
  "埼玉県さいたま市見沼区","埼玉県川口市","千葉県船橋市","千葉県松戸市",
  "群馬県前橋市","栃木県宇都宮市",
];
const APPT_MEMOS = [
  "マエカク済 / 訪問予定",
  "見込み高（太陽光＋蓄電池）",
  "再アプローチ予定",
  "ローン審査の連絡待ち",
  "現地調査の日程を調整中",
  "ご家族同席で再提案予定",
  "他社相見積もり中",
];
const DOW2 = ["日", "月", "火", "水", "木", "金", "土"];

function fmtApptDateTime(baseDate: string, addDays: number, hh: number, mm: number): string {
  const [y, m, d] = baseDate.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d! + addDays);
  return `${dt.getMonth() + 1}/${String(dt.getDate()).padStart(2, "0")}（${DOW2[dt.getDay()]}）${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// イベントで獲得したアポ顧客を決定論的に生成。count は成果報告のアポ数に揃える想定。
export function buildDemoAppointments(
  seed: string,
  count: number,
  ctx: ResultReportContext = {},
): AcquiredCustomer[] {
  const rng = makeRng(`${seed}-appts`);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;
  const between = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
  const base = ctx.date ?? todayStr();
  const n = Math.max(0, Math.min(count, 12));
  const rows: AcquiredCustomer[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      name: `${pick(APPT_FAMILIES)} ${pick(APPT_GIVENS)}`,
      dateTime: fmtApptDateTime(base, between(1, 12), pick([10, 11, 13, 14, 15, 16, 18, 19]), pick([0, 30])),
      address: pick(APPT_CITIES),
      memo: pick(APPT_MEMOS),
    });
  }
  return rows;
}

// 開始 / 終了 / 成果 をまとめて生成（決定論的）。成果から稼働時刻を引き継ぐ。
export function buildDemoEventReports(
  seed: string,
  ctx: ResultReportContext = {},
): EventReportsBundle {
  const result = buildDemoResultReport(seed, ctx);
  const rng = makeRng(`${seed}-reports`);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;
  const reporter = pick(REPORTERS);
  const dateStr = result.eventDate.replace(/-/g, "/");
  return {
    start: {
      submitter: reporter,
      submittedAt: `${dateStr} ${result.startTime}`,
      comment: pick(START_COMMENTS),
    },
    end: {
      submitter: reporter,
      submittedAt: `${dateStr} ${result.endTime}`,
      comment: pick(END_COMMENTS),
    },
    result,
  };
}
