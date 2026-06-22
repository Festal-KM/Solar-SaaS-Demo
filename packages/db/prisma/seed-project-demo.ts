// Solar-SaaS — 顧客「案件情報」デモデータ投入スクリプト（本番デモ環境向け）。
//
// 目的: 顧客詳細「案件情報」タブ（F-061 / docs/05 §16）が賑わうように、既存の
// Contract に対して運用ステータス・コール・支払い（ContractPayment）・設備
// （ContractEquipment）・工事候補日などのデモ値を補完する。
//
// 設計上の制約:
//   - 既存 Contract のみを拡張する（Contract 自体は作らない）。冪等:
//       * Contract / 代表 Construction 拡張列 … 毎回 update（同値で安定）
//       * ContractPayment … payment 未作成のときのみ create（1:1）
//       * ContractEquipment … equipment 0 件のときのみ create
//   - SYSTEM_TENANT_CONTEXT（is_saas_admin）で withTenant を通し RLS を満たす。
//   - 対象テナントは名前 "株式会社サンライズソーラー"（seed.ts の TENANT_KEY と一致）。
//
// 実行: DATABASE_URL=<prod public proxy> pnpm -F @solar/db exec tsx prisma/seed-project-demo.ts

import "./seed-env.js";

import { rawPrisma, SYSTEM_TENANT_CONTEXT, withTenant } from "../src/index.js";

import type { TxClient } from "../src/with-tenant.js";

const PILOT_NAME = "株式会社サンライズソーラー";

async function seedContractProjectData(
  tx: TxClient,
  args: { wholesalerId: string; now: Date },
): Promise<{ payments: number; equipment: number; contracts: number }> {
  const { wholesalerId, now } = args;
  const day = (offset: number): Date => new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);

  const contracts = await tx.contract.findMany({
    where: { wholesalerId },
    select: {
      id: true,
      contractDate: true,
      payment: { select: { id: true } },
      equipment: { select: { id: true } },
      constructions: { select: { id: true, status: true } },
    },
  });

  let i = 0;
  let payments = 0;
  let equipment = 0;
  for (const c of contracts) {
    const seq = i++;
    const completed = c.constructions.some((con) => con.status === "DONE");
    const constructing = c.constructions.some(
      (con) => con.status === "CONSTRUCTING" || con.status === "SURVEYED",
    );

    await tx.contract.update({
      where: { id: c.id },
      data: {
        docsUrl: `https://docs.example.com/contracts/${c.id.slice(-8)}.pdf`,
        equipmentSerialId: `EQ-${100000 + seq * 137}`,
        loanReviewCallAt: day(-3),
        thankYouCallAt: completed ? day(-1) : null,
        callStatus: completed ? "DONE" : constructing ? "SCHEDULED" : "NONE",
        defectStatus: seq % 3 === 0 ? "OPEN" : "NONE",
        defectDetail: seq % 3 === 0 ? "申請書類の押印漏れ。再取得を依頼。" : null,
        postCompletionStatus: completed ? "DONE" : constructing ? "IN_PROGRESS" : "NONE",
      },
    });

    const rep = c.constructions[0];
    if (rep) {
      await tx.construction.update({
        where: { id: rep.id },
        data: {
          surveyDate: day(-7),
          startedDate: constructing || completed ? day(-5) : null,
          completedDate: completed ? day(-1) : null,
          powerSaleStartDate: completed ? day(10) : null,
          surveyCandidates: [day(-9).toISOString(), day(-8).toISOString()],
          constructionCandidates: [day(-6).toISOString(), day(-5).toISOString()],
          vendorName: "サンプル施工 株式会社",
        },
      });
    }

    if (!c.payment) {
      await tx.contractPayment.create({
        data: {
          contractId: c.id,
          paymentStatus: completed ? "PAID" : seq % 2 === 0 ? "PARTIAL" : "UNPAID",
          paymentCount: [1, 60, 120, 180][seq % 4],
          loanCompany: ["ジャックス", "アプラス", "オリコ", "現金一括"][seq % 4],
          downPayment: (seq % 5) * 100000,
          creditLifeInsurance: seq % 2 === 0,
          loanNote: seq % 2 === 0 ? "事前審査承認済み。本審査は契約後に申請。" : null,
          depositDate: completed ? day(-2) : null,
          dealerPayoutDate: completed ? day(5) : null,
        },
      });
      payments += 1;
    }

    if (c.equipment.length === 0) {
      await tx.contractEquipment.create({
        data: {
          contractId: c.id,
          category: "PV",
          contracted: true,
          manufacturer: ["長州産業", "カナディアンソーラー", "Qセルズ"][seq % 3],
          model: `CS-${400 + (seq % 60)}MB`,
          capacity: `${(3.5 + (seq % 4)).toFixed(1)} kW`,
          quantity: 8 + (seq % 16),
          installLocation: ["屋外（北側）", "屋内（玄関収納）", "屋外（車庫横）"][seq % 3],
          warrantyStandard: true,
          warrantyExtended: seq % 2 === 0,
          attributes: { pvOutputWarranty: true, pvOption: seq % 2 === 0 ? "HEMS" : "なし" },
        },
      });
      equipment += 1;
      if (seq % 2 === 0) {
        await tx.contractEquipment.create({
          data: {
            contractId: c.id,
            category: "BT",
            contracted: true,
            manufacturer: ["長州産業", "ニチコン", "オムロン"][seq % 3],
            model: `ET-${40 + (seq % 60)}B3`,
            capacity: `${(6.5 + (seq % 10)).toFixed(1)} kWh`,
            installLocation: ["屋外", "屋内（階段下）", "車庫"][seq % 3],
            warrantyDisaster: true,
            warrantyExtended: true,
          },
        });
        equipment += 1;
      }
    }
  }

  return { payments, equipment, contracts: contracts.length };
}

async function main(): Promise<void> {
  const now = new Date();
  const result = await withTenant(
    SYSTEM_TENANT_CONTEXT,
    async (tx) => {
      const pilot = await tx.tenant.findFirst({
        where: { name: PILOT_NAME, type: "WHOLESALER" },
        select: { id: true },
      });
      if (!pilot) {
        throw new Error(`対象テナントが見つかりません: ${PILOT_NAME}`);
      }
      return seedContractProjectData(tx, { wholesalerId: pilot.id, now });
    },
    // 公開プロキシ経由は遅く、47 契約 × 複数 update が 5s 既定を超えるため延長。
    { timeout: 300_000, maxWait: 30_000 },
  );

  console.log(
    `[seed-project-demo] done — contracts=${result.contracts}, ContractPayment(+${result.payments}), ContractEquipment(+${result.equipment})`,
  );
}

main()
  .then(async () => {
    await rawPrisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await rawPrisma.$disconnect();
    process.exit(1);
  });
