import { config } from "dotenv";
import { resolve } from "node:path";

// E2E データクリーンアップ — 契約タブ改修 spec（customer-contract-tab-revamp）が
// 契約あり顧客に残す「契約 #2 以降の余剰契約」と「追加した付帯商材(ACCESSORY)行」を
// 削除し、他 spec が前提とする「1 顧客 = 1 契約・付帯空」の不変条件へ戻す。
//
// 方針（テナント横断しない・破壊範囲を最小化）:
//   - 各顧客につき「最古に作成された契約」を 1 件だけ残し、それ以降の契約（テストが
//     『契約を追加』で生成したもの）を子テーブルごと削除する。
//   - 残した契約からは ACCESSORY 行のみ削除する（seed は ACCESSORY を作らないため、
//     残存している ACCESSORY はテストが追加したものに限られる。万一掃除漏れがあっても
//     付帯空状態前提の他 spec を汚染しない）。
//
// CLAUDE.md ハードルール「テスト前後に対象テナントの業務テーブルを truncate」に準拠。
// RLS を経由しない rawPrisma を使うのは seed/migration と同じ運用例外。

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
config({ path: resolve(REPO_ROOT, ".env.local") });

async function main(): Promise<void> {
  const { rawPrisma } = (await import("@solar/db")) as typeof import("@solar/db");

  // 顧客ごとに契約を createdAt 昇順で取得し、2 件目以降を削除対象にする。
  const customers = await rawPrisma.customer.findMany({
    select: {
      id: true,
      name: true,
      // createdAt 昇順で最古を先頭に。
      // （Contract は customerId に複数ぶら下がりうる。）
    },
  });

  let removedContracts = 0;
  let removedDeals = 0;
  let removedAccessories = 0;

  for (const customer of customers) {
    const contracts = await rawPrisma.contract.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, dealId: true },
    });
    if (contracts.length === 0) continue;

    // 最古 1 件は残す。残す契約からは ACCESSORY 行のみ削除（テスト追加分）。
    const [keep, ...extra] = contracts;
    const delAcc = await rawPrisma.contractEquipment.deleteMany({
      where: { contractId: keep!.id, category: "ACCESSORY" },
    });
    removedAccessories += delAcc.count;

    if (extra.length === 0) continue;

    const extraIds = extra.map((c) => c.id);
    for (const id of extraIds) {
      await rawPrisma.grossProfit.deleteMany({ where: { contractId: id } });
      await rawPrisma.contractEquipment.deleteMany({ where: { contractId: id } });
      await rawPrisma.contractPayment.deleteMany({ where: { contractId: id } });
      await rawPrisma.construction.deleteMany({ where: { contractId: id } });
      await rawPrisma.contractItem.deleteMany({ where: { contractId: id } });
      await rawPrisma.application.deleteMany({ where: { contractId: id } });
      await rawPrisma.incentive.deleteMany({ where: { contractId: id } });
      await rawPrisma.contractCancellation.deleteMany({ where: { contractId: id } });
    }
    const dc = await rawPrisma.contract.deleteMany({ where: { id: { in: extraIds } } });
    removedContracts += dc.count;

    // テストの「契約を追加」は最小 Deal+Contract を生成する。上で extra contract を
    // 削除済みなので、その Deal は contract=null の孤立 Deal になっている。孤立分のみ掃除。
    const dealIds = [...new Set(extra.map((c) => c.dealId).filter(Boolean))] as string[];
    if (dealIds.length) {
      const dd = await rawPrisma.deal.deleteMany({
        // Deal.contract は 1:1（dealId @unique）。契約削除後に孤立した Deal のみ削除。
        where: { id: { in: dealIds }, contract: { is: null } },
      });
      removedDeals += dd.count;
    }
  }

  console.log(
    `[cleanup-extra] removed: contracts=${removedContracts} deals=${removedDeals} accessories=${removedAccessories}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[cleanup-extra] failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
