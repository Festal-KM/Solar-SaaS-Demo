"use server";

// replaceContractItemsAction — T-05-07 / F-041 / docs/05 §3.6 §4.8 §6.2.
//
// Full-replace strategy for a contract's line items. The action:
//   1. Fetches the Contract — only CONTRACTED status is writable.
//   2. Fetches each Product row (all records for the productIds in the request)
//      so the pure-function snapshotItems can determine the effective price at
//      contractDate.
//   3. Calls snapshotItems() — throws if any productId has no effective row at
//      contractDate. The caller must pre-validate via /api/products/active?asOf=.
//   4. Deletes all existing ContractItem rows for this contract.
//   5. Inserts new ContractItem rows with price snapshot columns.
//   6. Updates Contract.contractAmount = sum of (qty × snapshotListPrice)
//      (totalAmount tracks the agreed contract price derived from the line-items).
//
// wholesalerId is always taken from ctx — never from input.

import { revalidatePath } from "next/cache";

import {
  ContractItemReplaceSchema,
  snapshotItems,
  type ContractItemReplaceInput,
} from "@solar/contracts";

import { InvalidStateTransitionError, NotFoundError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

export const replaceContractItemsAction = withServerActionContext<
  ContractItemReplaceInput,
  { contractId: string; itemCount: number }
>(
  { action: "contract.update" },
  async ({ tx, input }) => {
    const parsed = ContractItemReplaceSchema.parse(input);

    // 1. Fetch Contract — must exist and be in CONTRACTED status.
    const contract = await tx.contract.findUnique({
      where: { id: parsed.contractId },
      select: {
        id: true,
        status: true,
        contractDate: true,
        wholesalerId: true,
      },
    });
    if (!contract) throw new NotFoundError("契約が見つかりません");
    if (contract.status !== "CONTRACTED") {
      throw new InvalidStateTransitionError(
        `契約明細の変更は CONTRACTED 状態の契約のみ許可されます（現在: ${contract.status}）`,
        { currentStatus: contract.status, requiredStatus: "CONTRACTED" },
      );
    }

    const contractDate = contract.contractDate;
    const productIds = [...new Set(parsed.items.map((i) => i.productId))];

    // 2. Fetch all relevant Product rows (all history records for these IDs so
    //    snapshotItems can find the version effective at contractDate).
    const productRows = await tx.product.findMany({
      where: {
        id: { in: productIds },
        wholesalerId: contract.wholesalerId,
      },
      select: {
        id: true,
        effectiveFrom: true,
        effectiveTo: true,
        isActive: true,
        name: true,
        maker: true,
        modelNo: true,
        unit: true,
        purchasePrice: true,
        dealerPrice: true,
        listPrice: true,
      },
    });

    // 3. Snapshot prices — pure function throws on missing effective row.
    const snapshotInputProducts = productRows.map((p) => ({
      productId: p.id,
      effectiveFrom: p.effectiveFrom,
      effectiveTo: p.effectiveTo,
      isActive: p.isActive,
      productName: p.name,
      maker: p.maker,
      modelNo: p.modelNo,
      unit: p.unit,
      purchasePrice: p.purchasePrice.toString(),
      dealerPrice: p.dealerPrice.toString(),
      listPrice: p.listPrice.toString(),
    }));

    const snapshots = snapshotItems(parsed.items, contractDate, snapshotInputProducts);

    // 4. Delete existing items.
    await tx.contractItem.deleteMany({
      where: { contractId: parsed.contractId },
    });

    // 5. Insert new items with snapshots.
    await tx.contractItem.createMany({
      data: snapshots.map((s) => ({
        contractId: parsed.contractId,
        productId: s.productId,
        productName: s.productName,
        maker: s.maker,
        modelNo: s.modelNo ?? null,
        qty: s.qty.toString(),
        unit: s.unit,
        snapshotPurchasePrice: s.snapshotPurchasePrice,
        snapshotDealerPrice: s.snapshotDealerPrice,
        snapshotListPrice: s.snapshotListPrice,
      })),
    });

    // 6. Update Contract.contractAmount = sum of subtotals (qty × listPrice).
    const totalAmount = snapshots
      .reduce((acc, s) => acc + Number(s.subtotal), 0)
      .toFixed(2);

    await tx.contract.update({
      where: { id: parsed.contractId },
      data: { contractAmount: totalAmount },
    });

    revalidatePath(`/contracts/${parsed.contractId}`);
    revalidatePath(`/contracts/${parsed.contractId}/items`);

    return { contractId: parsed.contractId, itemCount: snapshots.length };
  },
);
