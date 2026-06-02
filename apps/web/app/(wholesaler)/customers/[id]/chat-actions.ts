"use server";

// 顧客チャット（CustomerMessage）Server Action — 顧客詳細「チャット」タブ.
//
// 三段イディオム: auth → assertCan('customer.update') → withTenant tx。
// customerId は input から受けるが、RLS が Customer.wholesalerId 経由の相関 EXISTS で
// テナント分離を強制する。投稿者は ctx.actorUserId（なりすまし不可）。

import { revalidatePath } from "next/cache";

import { CustomerMessageCreateSchema } from "@solar/contracts";
import type { CustomerMessageCreateInput } from "@solar/contracts";

import { NotFoundError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

const DETAIL_PATH = (id: string) => `/customers/${id}`;

export interface CreateCustomerMessageResult {
  id: string;
}

export const createCustomerMessage = withServerActionContext<
  CustomerMessageCreateInput,
  CreateCustomerMessageResult
>(
  { action: "customer.update" },
  async ({ tx, ctx, input }) => {
    const parsed = CustomerMessageCreateSchema.parse(input);

    const customer = await tx.customer.findUnique({
      where: { id: parsed.customerId },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundError("顧客が見つかりません");
    }

    const message = await tx.customerMessage.create({
      data: {
        customerId: parsed.customerId,
        authorUserId: ctx.actorUserId,
        body: parsed.body,
      },
      select: { id: true },
    });

    revalidatePath(DETAIL_PATH(parsed.customerId));
    return { id: message.id };
  },
);
