// Solar-SaaS — イベント管理デモデータ投入スクリプト（本番デモ環境向け）。
//
// 目的: 「イベント開催 → 成果報告 → イベント獲得（アポ取り）顧客」が大量に
// 蓄積されている状態をデモ環境で再現する。営業のイベント一覧・イベント詳細
// （成果報告 / 参加顧客数）・顧客一覧が賑わうように、過去〜直近のイベントを
// 多数生成し、各イベントに START / END / RESULT(成果報告) と、イベント由来の
// 顧客 + アポイント（一部マエカク済）を紐づける。
//
// 設計上の制約:
//   - 全レコードは決定論的な id（"demoev_" prefix）で生成し、createMany +
//     skipDuplicates で冪等。再実行は安全（既存行はスキップ）。クリーンアップは
//     id LIKE 'demoev_%' の削除で可能（cleanup() を末尾に用意）。
//   - 本番デモ DB は 16-A（prefecture/city/...）マイグレーション未適用のため、
//     当該カラムには一切触れない。Customer は読み取りせず createMany のみ。
//   - SYSTEM_TENANT_CONTEXT（is_saas_admin）で withTenant を通し RLS を満たす。
//
// 実行: DATABASE_URL=<prod public proxy> pnpm -F @solar/db exec tsx prisma/seed-event-demo.ts
//   クリーンアップ: 上記に `-- --clean` を付与。

import "./seed-env.js";

import { rawPrisma, SYSTEM_TENANT_CONTEXT, withTenant } from "../src/index.js";

import type { TxClient } from "../src/with-tenant.js";

// ── 決定論的 PRNG（mulberry32）。再実行で同一データを得るため固定シード。 ──
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(20260602);
const rand = (min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min;
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;

const DAY = 24 * 60 * 60 * 1000;

// ── マスタ: 量販店チェーン（本部）+ 店舗。本番未シードのため自前で find-or-create。 ──
const CHAINS: Array<{
  name: string;
  area: string;
  contractType: "FIXED" | "PERFORMANCE" | "OTHER";
  fixedFee?: number;
  performanceRate?: number;
  stores: Array<{ name: string; area: string; address: string }>;
}> = [
  {
    name: "カインズ",
    area: "埼玉県",
    contractType: "FIXED",
    fixedFee: 80_000,
    stores: [
      { name: "浦和美園店", area: "埼玉県", address: "埼玉県さいたま市緑区美園5-50-1" },
      { name: "新所沢店", area: "埼玉県", address: "埼玉県所沢市けやき台2-32" },
      { name: "幕張店", area: "千葉県", address: "千葉県千葉市美浜区幕張西4-1-1" },
    ],
  },
  {
    name: "コメリパワー",
    area: "千葉県",
    contractType: "PERFORMANCE",
    performanceRate: 5,
    stores: [
      { name: "千葉ニュータウン店", area: "千葉県", address: "千葉県印西市中央北3-2" },
      { name: "船橋店", area: "千葉県", address: "千葉県船橋市行田3-1-1" },
    ],
  },
  {
    name: "ホームセンタームサシ",
    area: "神奈川県",
    contractType: "FIXED",
    fixedFee: 65_000,
    stores: [
      { name: "横浜瀬谷店", area: "神奈川県", address: "神奈川県横浜市瀬谷区中央6-1" },
      { name: "町田忠生店", area: "東京都", address: "東京都町田市忠生2-20-1" },
    ],
  },
  {
    name: "ヤマダデンキ",
    area: "東京都",
    contractType: "PERFORMANCE",
    performanceRate: 7,
    stores: [
      { name: "テックランド町田店", area: "東京都", address: "東京都町田市原町田6-12-20" },
      { name: "テックランド川越店", area: "埼玉県", address: "埼玉県川越市新宿町1-17-1" },
      { name: "テックランド千葉店", area: "千葉県", address: "千葉県千葉市中央区川崎町1-34" },
    ],
  },
  {
    name: "ベイシア",
    area: "群馬県",
    contractType: "OTHER",
    stores: [
      { name: "前橋みなみモール店", area: "群馬県", address: "群馬県前橋市新堀町909" },
      { name: "渋川店", area: "群馬県", address: "群馬県渋川市行幸田277-1" },
    ],
  },
  {
    name: "ロイヤルホームセンター",
    area: "埼玉県",
    contractType: "FIXED",
    fixedFee: 70_000,
    stores: [
      { name: "大宮店", area: "埼玉県", address: "埼玉県さいたま市北区櫛引町2-574" },
      { name: "千葉北店", area: "千葉県", address: "千葉県千葉市稲毛区六方町300" },
    ],
  },
];

// ── 顧客の氏名プール（姓・名）。 ──
const FAMILIES = [
  "佐藤","鈴木","高橋","田中","伊藤","渡辺","山本","中村","小林","加藤",
  "吉田","山田","佐々木","山口","松本","井上","木村","林","清水","森",
  "池田","橋本","石川","中島","前田","藤田","後藤","小川","岡田","長谷川",
  "村上","近藤","石井","斎藤","坂本","遠藤","青木","藤井","西村","福田",
];
const GIVENS = [
  "大輔","健一","翔太","直樹","拓也","洋平","亮","誠","博之","和也",
  "さやか","美咲","陽子","愛","結衣","麻衣","千尋","直美","優子","京子",
  "健太","裕子","真一","由美","隆","恵子","浩二","明美","聡","典子",
];

// ── 成果報告コメント。 ──
const RESULT_COMMENTS = [
  "天候に恵まれ来場者多数。蓄電池への関心が高く、好感触のアポを複数獲得。",
  "午前は客足が鈍かったが午後に挽回。電気代高騰の話題で足を止める方が多かった。",
  "近隣チラシの効果で家族連れの来場が目立った。次回は土曜開催を推奨。",
  "競合ブースと隣接し苦戦したが、シミュレーション提示で差別化できた。",
  "高齢層中心。補助金説明への反応が良く、後日訪問のアポにつながった。",
  "雨天により来場減。屋内導線の確保が課題。獲得効率は平均的。",
  "ファミリー層に蓄電池+V2Hの提案が刺さった。単価の高い見込みを確保。",
  "オープン直後から問い合わせ多数。要員2名では捌ききれず機会損失あり。",
];

// ── 商談プロファイル（顧客の進捗バリエーション）。重み付きで分配。 ──
type Bucket = "new" | "negotiating" | "likely" | "contracted" | "lost";
const BUCKET_WEIGHTS: Array<[Bucket, number]> = [
  ["new", 22],
  ["negotiating", 34],
  ["likely", 12],
  ["contracted", 24],
  ["lost", 8],
];
function pickBucket(): Bucket {
  const total = BUCKET_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [b, w] of BUCKET_WEIGHTS) {
    if (r < w) return b;
    r -= w;
  }
  return "negotiating";
}

const CONTRACT_PLANS = [
  "太陽光 4.5kW + 蓄電池 7.0kWh",
  "太陽光 5.5kW 単体",
  "太陽光 4.0kW + 蓄電池 9.8kWh",
  "蓄電池 12.7kWh + V2H",
  "太陽光 6.0kW + 蓄電池 11.5kWh + HEMS",
];

interface Resolved {
  wholesalerId: string;
  creatorUserId: string;
  shiftUserIds: string[];
  relationshipIds: string[];
  storeByChain: Array<{ providerId: string; chain: (typeof CHAINS)[number] }>;
}

async function ensureMasters(tx: TxClient): Promise<Resolved> {
  // パイロット卸テナント。
  const pilot = await tx.tenant.findFirst({
    where: { name: "パイロット卸 株式会社", type: "WHOLESALER" },
    select: { id: true },
  });
  if (!pilot) throw new Error("パイロット卸テナントが見つかりません（先に db:seed を実行）");
  const wholesalerId = pilot.id;

  // 作成者ユーザ（卸管理者 → デモ → 任意）。
  const creator =
    (await tx.user.findFirst({
      where: { tenantId: wholesalerId, email: "wholesaler_admin@solar-saas.dev" },
      select: { id: true },
    })) ??
    (await tx.user.findFirst({
      where: { tenantId: wholesalerId, email: "demo@solar-saas.demo" },
      select: { id: true },
    })) ??
    (await tx.user.findFirst({ where: { tenantId: wholesalerId }, select: { id: true } }));
  if (!creator) throw new Error("パイロット卸のユーザが見つかりません");
  const creatorUserId = creator.id;

  // シフト割当用ユーザ（卸テナントの全ユーザ）。
  const users = await tx.user.findMany({
    where: { tenantId: wholesalerId },
    select: { id: true },
    take: 8,
  });
  const shiftUserIds = users.map((u) => u.id);

  // 関係（共同開催の二次店割当用）。
  const rels = await tx.relationship.findMany({
    where: { wholesalerId },
    select: { id: true },
  });
  const relationshipIds = rels.map((r) => r.id);

  // チェーン本部 + 店舗を find-or-create。
  const storeByChain: Resolved["storeByChain"] = [];
  for (const chain of CHAINS) {
    let provider = await tx.venueProvider.findFirst({
      where: { wholesalerId, name: chain.name },
      select: { id: true },
    });
    if (!provider) {
      provider = await tx.venueProvider.create({
        data: {
          wholesalerId,
          name: chain.name,
          area: chain.area,
          contractType: chain.contractType,
          ...(chain.fixedFee !== undefined ? { fixedFee: chain.fixedFee } : {}),
          ...(chain.performanceRate !== undefined ? { performanceRate: chain.performanceRate } : {}),
          isActive: true,
        },
        select: { id: true },
      });
    }
    for (const store of chain.stores) {
      const existingStore = await tx.store.findFirst({
        where: { wholesalerId, name: store.name },
        select: { id: true, venueProviderId: true },
      });
      if (!existingStore) {
        await tx.store.create({
          data: { wholesalerId, venueProviderId: provider.id, name: store.name, isActive: true },
        });
      } else if (existingStore.venueProviderId !== provider.id) {
        await tx.store.update({
          where: { id: existingStore.id },
          data: { venueProviderId: provider.id },
        });
      }
    }
    storeByChain.push({ providerId: provider.id, chain });
  }

  return { wholesalerId, creatorUserId, shiftUserIds, relationshipIds, storeByChain };
}

// 生成行のバッファ。
interface Buffers {
  candidates: any[];
  events: any[];
  eventDealers: any[];
  shifts: any[];
  reports: any[];
  customers: any[];
  appointments: any[];
  preCalls: any[];
  deals: any[];
  contracts: any[];
  constructions: any[];
  applications: any[];
}

function ym(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function build(resolved: Resolved, now: Date): Buffers {
  const b: Buffers = {
    candidates: [], events: [], eventDealers: [], shifts: [], reports: [],
    customers: [], appointments: [], preCalls: [], deals: [], contracts: [],
    constructions: [], applications: [],
  };

  const NUM_EVENTS = 26;
  let custSeq = 0;
  let shiftMinute = 0;

  for (let i = 0; i < NUM_EVENTS; i++) {
    const dayOffset = 8 - i * 3; // +8..-67：直近3件は未来/当日、残りは過去。
    const isPast = dayOffset < 0;
    const isToday = dayOffset >= -1 && dayOffset <= 2; // 当日/開催中扱い。
    const eventDate = new Date(now.getTime() + dayOffset * DAY);
    eventDate.setHours(10, 0, 0, 0);

    const sc = resolved.storeByChain[i % resolved.storeByChain.length]!;
    const store = sc.chain.stores[i % sc.chain.stores.length]!;
    const mode = i % 3 === 0 ? "JOINT" : "SELF";
    const eventStatus = isPast ? "CLOSED" : isToday ? "ONGOING" : "PLANNED";
    const hasResult = isPast || isToday;

    const candId = `demoev_cand_${i}`;
    const evtId = `demoev_evt_${i}`;
    const decidedAt = new Date(eventDate.getTime() - 12 * DAY);

    b.candidates.push({
      id: candId,
      wholesalerId: resolved.wholesalerId,
      venueProviderId: sc.providerId,
      targetMonth: ym(eventDate),
      scheduledDate: eventDate,
      storeName: store.name,
      address: store.address,
      area: store.area,
      deadlineAt: new Date(eventDate.getTime() - 7 * DAY),
      contractType: sc.chain.contractType,
      status: "DECIDED",
      publishedAt: decidedAt,
      createdBy: resolved.creatorUserId,
      createdAt: new Date(decidedAt.getTime() - 5 * DAY),
    });

    b.events.push({
      id: evtId,
      wholesalerId: resolved.wholesalerId,
      eventCandidateId: candId,
      mode,
      requiredPeople: rand(2, 4),
      decidedBy: resolved.creatorUserId,
      decidedAt,
      status: eventStatus,
      note: mode === "JOINT" ? "二次店との共同開催" : null,
    });

    // 共同開催 → 二次店割当。
    if (mode === "JOINT" && resolved.relationshipIds.length > 0) {
      const relId = resolved.relationshipIds[i % resolved.relationshipIds.length]!;
      b.eventDealers.push({
        eventId: evtId,
        relationshipId: relId,
        assignedBy: resolved.creatorUserId,
        assignedAt: decidedAt,
      });
    }

    // シフト（2 名）。startPlanned は global minute offset で一意化。
    if (resolved.shiftUserIds.length > 0) {
      const roles = ["LEAD", "CATCH"] as const;
      for (let k = 0; k < 2; k++) {
        const uid = resolved.shiftUserIds[(i * 2 + k) % resolved.shiftUserIds.length]!;
        const start = new Date(eventDate);
        start.setHours(9, shiftMinute % 50, 0, 0);
        shiftMinute += 1;
        const end = new Date(start.getTime() + 8 * 60 * 60 * 1000);
        b.shifts.push({
          id: `demoev_shift_${i}_${k}`,
          eventId: evtId,
          userId: uid,
          role: roles[k]!,
          startPlanned: start,
          endPlanned: end,
          status: isPast ? "CHECKED_OUT" : "ASSIGNED",
        });
      }
    }

    // 成果報告（START / END / RESULT）。
    let validAppts = 0;
    if (hasResult) {
      const approachCount = rand(40, 140);
      const surveyCount = Math.max(10, Math.round(approachCount * (0.3 + rng() * 0.2)));
      const totalAppts = Math.max(3, Math.round(surveyCount * (0.2 + rng() * 0.2)));
      validAppts = Math.max(2, Math.round(totalAppts * (0.6 + rng() * 0.25)));
      const invalidAppts = Math.max(0, totalAppts - validAppts);

      b.reports.push({
        id: `demoev_rep_${i}_start`,
        eventId: evtId,
        type: "START",
        reporterUserId: resolved.creatorUserId,
        reporterOrgType: "WHOLESALER",
        payload: { comment: "設営完了、定刻に開始しました。", attachments: [] },
        createdAt: new Date(eventDate.getTime() + 30 * 60 * 1000),
      });
      b.reports.push({
        id: `demoev_rep_${i}_end`,
        eventId: evtId,
        type: "END",
        reporterUserId: resolved.creatorUserId,
        reporterOrgType: "WHOLESALER",
        payload: { comment: "撤収完了。トラブルなく終了。", attachments: [] },
        createdAt: new Date(eventDate.getTime() + 9 * 60 * 60 * 1000),
      });
      b.reports.push({
        id: `demoev_rep_${i}_result`,
        eventId: evtId,
        type: "RESULT",
        reporterUserId: resolved.creatorUserId,
        reporterOrgType: "WHOLESALER",
        payload: { approachCount, surveyCount, totalAppts, validAppts, invalidAppts, comment: pick(RESULT_COMMENTS) },
        createdAt: new Date(eventDate.getTime() + 10 * 60 * 60 * 1000),
      });
    }

    // イベント獲得（アポ取り）顧客。過去/当日イベントのみ。
    const numCustomers = hasResult ? Math.min(Math.max(validAppts, 3), 9) : 0;
    for (let j = 0; j < numCustomers; j++) {
      const family = FAMILIES[custSeq % FAMILIES.length]!;
      const given = GIVENS[(custSeq * 7 + i) % GIVENS.length]!;
      const custId = `demoev_c_${i}_${j}`;
      const bucket = pickBucket();
      const phone = `090-${String(4000 + custSeq).padStart(4, "0")}-${String(rand(1000, 9999))}`;
      custSeq += 1;

      const isContracted = bucket === "contracted";
      const isLost = bucket === "lost";
      const status =
        bucket === "new" ? "PRE_CALL_WAIT"
        : bucket === "negotiating" ? "IN_NEGOTIATION"
        : bucket === "likely" ? "IN_NEGOTIATION"
        : isContracted ? "CONTRACTED"
        : "LOST";
      const contractStatus = isContracted ? "contracted" : isLost ? "lost" : "negotiating";
      const maekakuStatus = pick(["pending", "done", "done", "unnecessary"] as const);
      const apptDate = new Date(eventDate.getTime() + (3 + j) * DAY);

      // 顧客（16-A カラムには触れない）。
      const cust: any = {
        id: custId,
        wholesalerId: resolved.wholesalerId,
        name: `${family} ${given}`,
        phone,
        address: `${store.address.replace(/[0-9-]+$/, "")}${rand(1, 30)}-${rand(1, 20)}`,
        area: store.area,
        channel: "EVENT",
        inflowRoute: "EVENT",
        sourceEventId: evtId,
        registeredByUserId: resolved.creatorUserId,
        registeredByOrgType: "WHOLESALER",
        status,
        note: `${sc.chain.name} ${store.name} の催事で獲得`,
        contractStatus,
        maekakuStatus,
        createdAt: new Date(eventDate.getTime() + 2 * 60 * 60 * 1000 + j * 5 * 60 * 1000),
      };
      if (bucket === "negotiating" || bucket === "likely") {
        cust.nextAction = pick(["見積提示のフォロー", "現地調査の日程調整", "補助金資料の送付", "再訪問アポ打診"]);
        cust.nextAppointmentAt = new Date(now.getTime() + rand(2, 20) * DAY);
        cust.contractPlan = pick(CONTRACT_PLANS);
        cust.contractExpectedDate = new Date(now.getTime() + rand(10, 40) * DAY);
      }
      if (isContracted) {
        cust.contractPlan = pick(CONTRACT_PLANS);
        cust.contractAmount = rand(28, 52) * 100_000; // 280万〜520万
        const r = rng();
        cust.constructionStatus = r < 0.34 ? "done" : r < 0.7 ? "in_progress" : "not_started";
        cust.constructionVendor = pick(["関東ソーラー設備", "東京エコ工事", "湘南電設"]);
        const s = rng();
        cust.subsidyStatus = s < 0.34 ? "granted" : s < 0.7 ? "applying" : "none";
        if (cust.subsidyStatus !== "none") cust.subsidyType = "国補助金（DR/子育てエコ）";
      }
      b.customers.push(cust);

      // アポイント。
      const apptStatus =
        isContracted ? "VISITED"
        : isLost ? "ABSENT"
        : bucket === "new" ? "UNCONFIRMED"
        : "VISITED";
      b.appointments.push({
        id: `demoev_a_${i}_${j}`,
        customerId: custId,
        eventId: evtId,
        scheduledAt: apptDate,
        location: store.address,
        acquiredByUserId: resolved.creatorUserId,
        acquiredOrgType: "WHOLESALER",
        appointmentType: "イベント獲得",
        status: apptStatus,
        createdAt: cust.createdAt,
      });

      // マエカク（PreCall）— done のみ APPROVED、pending は未作成。
      if (maekakuStatus === "done") {
        b.preCalls.push({
          id: `demoev_pc_${i}_${j}`,
          appointmentId: `demoev_a_${i}_${j}`,
          calledAt: new Date(apptDate.getTime() - 1 * DAY),
          result: isLost ? "ABSENT" : "APPROVED",
          personConfirmed: !isLost,
          calledByUserId: resolved.creatorUserId,
        });
      }

      // 商談（Deal）。new 以外。
      if (bucket !== "new") {
        const dealStatus =
          isContracted ? "CONTRACTED"
          : isLost ? "LOST"
          : bucket === "likely" ? "LIKELY_CONTRACT"
          : pick(["PROPOSING", "QUOTED", "CONSIDERING"] as const);
        const dealId = `demoev_d_${i}_${j}`;
        b.deals.push({
          id: dealId,
          customerId: custId,
          ownerType: "WHOLESALER",
          ownerUserId: resolved.creatorUserId,
          status: dealStatus,
          firstVisitAt: apptDate,
          ...(isLost ? { lostReason: pick(["他社で契約", "予算が合わず", "家族の反対", "連絡不通"]) } : {}),
          createdAt: cust.createdAt,
        });

        // 契約（Contract）+ 施工/申請。
        if (isContracted) {
          const contractDate = new Date(eventDate.getTime() + 6 * DAY);
          const amount = String(cust.contractAmount ?? 3_500_000);
          const ctrId = `demoev_ctr_${i}_${j}`;
          b.contracts.push({
            id: ctrId,
            wholesalerId: resolved.wholesalerId,
            dealId,
            customerId: custId,
            contractDate,
            contractAmount: amount,
            hasBattery: /蓄電池/.test(cust.contractPlan ?? ""),
            cancelDeadline: new Date(contractDate.getTime() + 8 * DAY),
            eventModeAtContract: mode,
            status: "CONTRACTED",
            createdBy: resolved.creatorUserId,
            createdAt: contractDate,
          });
          if (cust.constructionStatus && cust.constructionStatus !== "not_started") {
            b.constructions.push({
              id: `demoev_cons_${i}_${j}`,
              contractId: ctrId,
              status: cust.constructionStatus === "done" ? "DONE" : "CONSTRUCTING",
              fileKeys: [],
            });
          }
          if (cust.subsidyStatus && cust.subsidyStatus !== "none") {
            b.applications.push({
              id: `demoev_app_${i}_${j}`,
              contractId: ctrId,
              type: "国補助金",
              status: cust.subsidyStatus === "granted" ? "APPROVED" : "SUBMITTED",
              fileKeys: [],
            });
          }
        }
      }
    }
  }

  return b;
}

async function insertAll(tx: TxClient, b: Buffers): Promise<void> {
  const cm = async (label: string, fn: () => Promise<{ count: number }>) => {
    const r = await fn();
    console.info(`  ${label}: +${r.count}`);
  };
  await cm("EventCandidate", () => tx.eventCandidate.createMany({ data: b.candidates, skipDuplicates: true }));
  await cm("Event", () => tx.event.createMany({ data: b.events, skipDuplicates: true }));
  if (b.eventDealers.length)
    await cm("EventDealer", () => tx.eventDealer.createMany({ data: b.eventDealers, skipDuplicates: true }));
  if (b.shifts.length)
    await cm("EventShift", () => tx.eventShift.createMany({ data: b.shifts, skipDuplicates: true }));
  await cm("EventReport", () => tx.eventReport.createMany({ data: b.reports, skipDuplicates: true }));
  await cm("Customer", () => tx.customer.createMany({ data: b.customers, skipDuplicates: true }));
  await cm("Appointment", () => tx.appointment.createMany({ data: b.appointments, skipDuplicates: true }));
  if (b.preCalls.length)
    await cm("PreCall", () => tx.preCall.createMany({ data: b.preCalls, skipDuplicates: true }));
  if (b.deals.length)
    await cm("Deal", () => tx.deal.createMany({ data: b.deals, skipDuplicates: true }));
  if (b.contracts.length)
    await cm("Contract", () => tx.contract.createMany({ data: b.contracts, skipDuplicates: true }));
  if (b.constructions.length)
    await cm("Construction", () => tx.construction.createMany({ data: b.constructions, skipDuplicates: true }));
  if (b.applications.length)
    await cm("Application", () => tx.application.createMany({ data: b.applications, skipDuplicates: true }));
}

async function cleanup(): Promise<void> {
  // 依存の逆順で物理削除（id LIKE 'demoev_%'）。
  await withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    const like = { startsWith: "demoev_" };
    await tx.application.deleteMany({ where: { id: like } });
    await tx.construction.deleteMany({ where: { id: like } });
    await tx.contract.deleteMany({ where: { id: like } });
    await tx.deal.deleteMany({ where: { id: like } });
    await tx.preCall.deleteMany({ where: { id: like } });
    await tx.appointment.deleteMany({ where: { id: like } });
    await tx.customer.deleteMany({ where: { id: like } });
    await tx.eventReport.deleteMany({ where: { id: like } });
    await tx.eventShift.deleteMany({ where: { id: like } });
    await tx.eventDealer.deleteMany({ where: { eventId: like } });
    await tx.event.deleteMany({ where: { id: like } });
    await tx.eventCandidate.deleteMany({ where: { id: like } });
  }, { timeout: 300_000, maxWait: 60_000 });
  console.info("[seed-event-demo] cleanup done");
}

async function main(): Promise<void> {
  if (process.argv.includes("--clean")) {
    await cleanup();
    return;
  }
  console.info("[seed-event-demo] start");
  const now = new Date();
  const summary = await withTenant(
    SYSTEM_TENANT_CONTEXT,
    async (tx) => {
      const resolved = await ensureMasters(tx);
      const buffers = build(resolved, now);
      console.info(
        `[seed-event-demo] generated: events=${buffers.events.length}, reports=${buffers.reports.length}, ` +
          `customers=${buffers.customers.length}, appointments=${buffers.appointments.length}, ` +
          `deals=${buffers.deals.length}, contracts=${buffers.contracts.length}`,
      );
      await insertAll(tx, buffers);
      return {
        events: buffers.events.length,
        customers: buffers.customers.length,
        reports: buffers.reports.length,
      };
    },
    { timeout: 300_000, maxWait: 60_000 },
  );
  console.info(
    `[seed-event-demo] complete: events=${summary.events}, customers=${summary.customers}, reports=${summary.reports}`,
  );
}

const invokedAsScript =
  process.argv[1]?.replace(/\\/g, "/").endsWith("/prisma/seed-event-demo.ts") ?? false;

if (invokedAsScript) {
  main()
    .catch((err) => {
      console.error("seed-event-demo: failed", err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await rawPrisma.$disconnect();
    });
}
