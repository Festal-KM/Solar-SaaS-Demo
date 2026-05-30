// S-033 — 卸業者側 顧客登録フォーム (T-04-06 / F-031 / docs/04 §1.3).

import { auth } from "@/auth";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { UnauthorizedError } from "@/lib/errors";
import { labels } from "@/lib/i18n/labels";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";

import { createCustomerAction } from "../actions";
import { CustomerForm } from "../customer-form";
import type { CustomerFormValues } from "../customer-form";

export const dynamic = "force-dynamic";

export default async function NewCustomerPage() {
  const session = await auth();
  if (!session?.user) {
    throw new UnauthorizedError({
      code: "INVALID_CREDENTIALS",
      message: "Session missing — sign in is required",
    });
  }
  const ctx = await getTenantContext();
  assertCan({
    user: {
      userId: ctx.actorUserId,
      roles: session.user.roles,
      isSaasAdmin: ctx.isSaasAdmin,
      tenantId: ctx.tenantId,
      wholesalerId: ctx.wholesalerId,
      dealerId: ctx.dealerId,
      relationshipIds: ctx.relationshipIds,
    },
    action: "customer.create",
  });

  const t = labels.customer;
  const bc = labels.breadcrumb.items;

  async function submitAction(values: CustomerFormValues) {
    "use server";
    return createCustomerAction({
      name: values.name,
      kana: values.kana,
      phone: values.phone,
      email: values.email,
      postalCode: values.postalCode,
      address: values.address,
      channel: values.channel,
      sourceEventId: values.sourceEventId,
      note: values.note,
    });
  }

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: bc.customers, href: "/customers" },
          { label: bc.customerNew },
        ]}
      />
      <h1 className="text-2xl font-semibold tracking-tight">{t.new}</h1>
      <CustomerForm
        mode={{ kind: "create" }}
        onSubmitAction={submitAction}
        redirectTo="/customers"
      />
    </div>
  );
}
