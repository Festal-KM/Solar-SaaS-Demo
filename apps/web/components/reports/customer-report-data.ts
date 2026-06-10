// イベント獲得顧客の「初訪アポフォーム」データ型 + デモ生成器。
//
// Google フォーム「住設事業部/加盟店-①初訪アポフォーム」準拠。顧客一覧の行
// クリックで開く閲覧ポップアップに表示する。一覧アイテムが持つ実データ
// （顧客名・エリア・担当者・次回アポ・マエカク有無）は overrides で反映し、
// 不足項目は seed（顧客 id）から決定論的に生成する。永続データ連携は今後の課題。

export type CustomerReportChannel = "催事" | "テレマ" | "訪販";

export interface CustomerReportData {
  franchiseNo: string; // 加盟店番号
  tossGetter: string; // トス獲得者
  closeCompany: string; // クローズ会社
  salesRep: string; // 営業担当者
  channel: CustomerReportChannel; // 販売チャネル
  eventDate: string; // 催事実施日（YYYY-MM-DD）
  venuePlace: string; // 催事場所
  eventType: string; // 催事種別（カインズ-W / カインズ-V）
  faceToFace: string; // 対面者（主権者 / 非主権者）
  customerName: string; // お客様名
  kana: string; // フリガナ
  maekakuPreferredAt: string | null; // マエカク電話希望日時（表示用）
  maekakuOperator: string; // マエカク実施者
  firstVisitAt: string; // 初回訪問アポ日時（表示用）
  landline: string | null; // 固定電話番号
  mobile: string; // 携帯番号
  postalCode: string; // 郵便番号
  prefecture: string; // 都道府県
  cityAddress: string; // 市区町村・番地
  note: string | null; // 備考
}

export interface CustomerReportOverrides {
  customerName?: string;
  area?: string | null;
  salesRep?: string;
  firstVisitAtIso?: string | null; // 次回アポ ISO
  firstVisitDisplay?: string; // 初回訪問アポ日時（表示文字列を直接指定）
  hasMaekaku?: boolean; // マエカク有無
}

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

const TOSS_GETTERS = ["佐々木 孝", "木村 光太郎", "近藤 優", "石井 健", "遠藤 拓海"];
const SALES_REPS = ["鳥居 佑馬", "橋爪 雅夫", "中川 翔太", "藤田 健一", "後藤 直樹"];
const VENUES = [
  "カインズ 浦和美園店",
  "カインズ 幕張店",
  "カインズ 新所沢店",
  "島忠ホームズ 川越店",
  "島忠ホームズ 東村山店",
  "カインズ 朝霞店",
];
const KANA_POOL = [
  "サトウ タロウ",
  "スズキ ハナコ",
  "タカハシ ケンイチ",
  "タナカ ミサキ",
  "イトウ ユウタ",
  "ワタナベ ユウコ",
  "ヤマモト ダイスケ",
  "ナカムラ アイ",
];
const CITY_ADDRESSES = [
  "世田谷区桜新町2-15-7",
  "杉並区高円寺南4-3-12",
  "横浜市港北区日吉本町1-22-5",
  "川口市芝新町8-14",
  "船橋市本町3-7-19",
  "前橋市天川大島町5-2-1",
];
const PREF_BY_AREA = (area: string | null): string => {
  if (!area) return "東京都";
  const m = area.match(/^(東京都|北海道|京都府|大阪府|.{2,3}県)/);
  return m ? m[1]! : "東京都";
};

const DOW = ["日", "月", "火", "水", "木", "金", "土"];
function fmtDateTimeIso(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}（${DOW[d.getDay()]}）${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtDate(y: number, m: number, d: number): string {
  const wd = new Date(y, m - 1, d).getDay();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}/${p(m)}/${p(d)}（${DOW[wd]}）`;
}

export function buildDemoCustomerReport(
  seed: string,
  ov: CustomerReportOverrides = {},
): CustomerReportData {
  const rng = makeRng(seed || "demo-customer");
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;
  const between = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

  const franchiseNo = `ERP${String(between(1, 70)).padStart(2, "0")}`;
  const closeCompany = `ERP${String(between(1, 70)).padStart(2, "0")}`;
  const eventY = 2026;
  const eventM = between(3, 6);
  const eventD = between(1, 27);

  const firstVisit =
    ov.firstVisitDisplay ??
    (ov.firstVisitAtIso
      ? fmtDateTimeIso(ov.firstVisitAtIso)
      : `${fmtDate(eventY, eventM, Math.min(28, eventD + between(3, 10)))} ${pick(["10:00", "13:00", "15:00", "18:00", "19:30"])}`);

  const maekakuPreferredAt =
    ov.hasMaekaku === false
      ? null
      : `${fmtDate(eventY, eventM, Math.min(28, eventD + between(1, 4)))} ${pick(["11:00", "14:00", "17:00", "20:00"])}`;

  return {
    franchiseNo,
    tossGetter: pick(TOSS_GETTERS),
    closeCompany,
    salesRep: ov.salesRep && ov.salesRep !== "—" ? ov.salesRep : pick(SALES_REPS),
    channel: "催事",
    eventDate: `${eventY}-${String(eventM).padStart(2, "0")}-${String(eventD).padStart(2, "0")}`,
    venuePlace: pick(VENUES),
    eventType: pick(["カインズ-W", "カインズ-V"]),
    faceToFace: rng() < 0.7 ? "主権者" : "非主権者",
    customerName: ov.customerName ?? "（未取得）",
    kana: pick(KANA_POOL),
    maekakuPreferredAt,
    maekakuOperator: rng() < 0.8 ? "バリューエコロジーコールセンター" : "その他",
    firstVisitAt: firstVisit,
    landline: rng() < 0.4 ? `03-${between(1000, 9999)}-${between(1000, 9999)}` : null,
    mobile: `090-${String(between(1000, 9999))}-${String(between(1000, 9999))}`,
    postalCode: `${between(100, 359)}-${String(between(0, 9999)).padStart(4, "0")}`,
    prefecture: PREF_BY_AREA(ov.area ?? null),
    cityAddress: pick(CITY_ADDRESSES),
    note: rng() < 0.5 ? pick(["蓄電池に強い関心。再訪時に見積提示予定。", "ご家族同席希望。", "現地調査の希望あり。"]) : null,
  };
}
