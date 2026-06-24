import { config } from "dotenv";
import { resolve } from "node:path";

// E2E データクリーンアップ — 契約状況タブ「設備追加で契約自動作成」テストが残す
// デモ用 Deal+Contract を削除する。saveProjectContractEquipmentAction は契約 0 件の
// 顧客に最小 Deal+Contract を生成して永続化するため、テスト後に当該顧客の業務データを
// 元の「契約 0 件」状態へ戻し、他 spec（未契約顧客の空状態を前提とする検証）への
// 汚染と再実行時のフレーク（前回生成契約の残存）を防ぐ。
//
// CLAUDE.md ハードルール「テスト前後に対象テナントの業務テーブルを truncate」に準拠。
// 対象は customerName で特定した顧客配下の Contract / Deal / 子テーブルのみ（テナント横断
// しない）。RLS を経由しない rawPrisma を使うのは seed/migration と同じ運用例外。

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
config({ path: resolve(REPO_ROOT, ".env.local") });

async function main(): Promise<void> {
  // 動的 import: dotenv の DATABASE_URL 注入後に @solar/db を読み込む。
  const { rawPrisma } = (await import("@solar/db")) as typeof import("@solar/db");

  const customerName = process.argv[2] ?? "佐藤 一馬";
  const customer = await rawPrisma.customer.findFirst({
    where: { name: customerName },
    select: { id: true, name: true },
  });
  if (!customer) {
    console.log(`[cleanup] customer "${customerName}" not found — nothing to do`);
    return;
  }

  const contracts = await rawPrisma.contract.findMany({
    where: { customerId: customer.id },
    select: { id: true, dealId: true },
  });
  for (const c of contracts) {
    await rawPrisma.grossProfit.deleteMany({ where: { contractId: c.id } });
    await rawPrisma.contractEquipment.deleteMany({ where: { contractId: c.id } });
    await rawPrisma.contractPayment.deleteMany({ where: { contractId: c.id } });
    await rawPrisma.construction.deleteMany({ where: { contractId: c.id } });
  }
  const delContracts = await rawPrisma.contract.deleteMany({ where: { customerId: customer.id } });
  const dealIds = [...new Set(contracts.map((c) => c.dealId).filter(Boolean))] as string[];
  const delDeals = dealIds.length
    ? await rawPrisma.deal.deleteMany({ where: { id: { in: dealIds } } })
    : { count: 0 };

  console.log(
    `[cleanup] "${customer.name}" (${customer.id}): contracts=${delContracts.count} deals=${delDeals.count}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[cleanup] failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
