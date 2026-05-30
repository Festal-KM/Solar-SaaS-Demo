// 卸業者側 顧客編集フォーム (T-04-06 / F-031 / docs/04 §1.3).

import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { UnauthorizedError } from "@/lib/errors";
import { labels } from "@/lib/i18n/labels";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@solar/db";

import { updateCustomerAction } from "../../actions";
import { CustomerForm } from "../../customer-form";
import type { CustomerFormInitial, CustomerFormValues } from "../../customer-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditCustomerPage({ params }: PageProps) {
  const { id } = await params;

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
    action: "customer.update",
  });

  const row = await withTenant(ctx, (tx) =>
    tx.customer.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        kana: true,
        phone: true,
        email: true,
        postalCode: true,
        address: true,
        channel: true,
        sourceEventId: true,
        note: true,
      },
    }),
  );

  if (!row) {
    notFound();
  }

  const initial: CustomerFormInitial = {
    name: row.name,
    kana: row.kana ?? undefined,
    phone: row.phone,
    email: row.email ?? undefined,
    postalCode: row.postalCode ?? undefined,
    address: row.address ?? undefined,
    channel: row.channel as CustomerFormInitial["channel"],
    sourceEventId: row.sourceEventId ?? undefined,
    note: row.note ?? undefined,
  };

  const t = labels.customer;
  const bc = labels.breadcrumb.items;

  async function submitAction(values: CustomerFormValues) {
    "use server";
    if (!values.id) throw new Error("id required for update");
    return updateCustomerAction({
      id: values.id,
      name: values.name,
      kana: values.kana,
      phone: values.phone,
      email: values.email,
      postalCode: values.postalCode,
      address: values.address,
      note: values.note,
    });
  }

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: bc.customers, href: "/customers" },
          { label: bc.customerEdit },
        ]}
      />
      <div className="flex items-center gap-4">
        <Button asChild variant="outline" size="sm">
          <Link href="/customers">{t.listTitle}</Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{t.edit}</h1>
      </div>
      <CustomerForm
        mode={{ kind: "edit", id: row.id, initial }}
        onSubmitAction={submitAction}
      />
    </div>
  );
}
