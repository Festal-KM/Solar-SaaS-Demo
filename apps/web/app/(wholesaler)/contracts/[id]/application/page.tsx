// S-047 — 補助金申請管理 (T-05-11 / F-045 / docs/04 §1.3).
//
// RSC data loader:
//   • Contract header + status
//   • Application records for the contract
//
// Client interactions (ApplicationForm):
//   • 申請登録: createApplicationAction
//   • 情報更新: updateApplicationAction
//   • ステータス変更: changeApplicationStatusAction (APPROVED requires confirmedAmount)

import "server-only";

import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { labels } from "@/lib/i18n/labels";
import type { ApplicationStatus } from "@solar/db";

import { ApplicationForm } from "./ApplicationForm";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

interface ApplicationRow {
  id: string;
  status: ApplicationStatus;
  type: string;
  agency: string | null;
  plannedDate: string | null;
  submittedDate: string | null;
  approvedDate: string | null;
  estimatedAmount: string | null;
  confirmedAmount: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PageData {
  contractId: string;
  contractDate: string;
  contractStatus: string;
  contractAmount: string;
  applications: ApplicationRow[];
}

async function loadPageData(contractId: string): Promise<PageData | null> {
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
    action: "application.read",
  });

  return withTenant(ctx, async (tx) => {
    const contract = await tx.contract.findUnique({
      where: { id: contractId },
      select: {
        id: true,
        contractDate: true,
        status: true,
        contractAmount: true,
      },
    });
    if (!contract) return null;

    const applications = await tx.application.findMany({
      where: { contractId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        type: true,
        agency: true,
        plannedDate: true,
        submittedDate: true,
        approvedDate: true,
        status: true,
        expectedAmount: true,
        grantedAmount: true,
        note: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      contractId: contract.id,
      contractDate: contract.contractDate.toISOString(),
      contractStatus: contract.status,
      contractAmount: contract.contractAmount.toString(),
      applications: applications.map((a) => ({
        id: a.id,
        status: a.status,
        type: a.type,
        agency: a.agency,
        plannedDate: a.plannedDate?.toISOString() ?? null,
        submittedDate: a.submittedDate?.toISOString() ?? null,
        approvedDate: a.approvedDate?.toISOString() ?? null,
        estimatedAmount: a.expectedAmount?.toString() ?? null,
        confirmedAmount: a.grantedAmount?.toString() ?? null,
        note: a.note,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      })),
    };
  });
}

export default async function ApplicationPage({ params }: PageProps) {
  const { id } = await params;
  const data = await loadPageData(id);
  if (!data) notFound();

  const t = labels.application;
  const c = labels.common;
  const bc = labels.breadcrumb.items;

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: bc.contracts, href: "/contracts" },
          { label: bc.contractDetail, href: `/contracts/${id}` },
          { label: bc.contractApplication },
        ]}
      />
      <div className="flex items-center gap-4">
        <Button asChild variant="outline" size="sm">
          <Link href={`/contracts/${id}`}>{t.backToContract}</Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
      </div>

      {/* Contract header */}
      <div className="border-border rounded-md border p-4 space-y-2">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{labels.contract.fields.contractDate}</dt>
          <dd>{new Date(data.contractDate).toLocaleDateString("ja-JP")}</dd>
          <dt className="text-muted-foreground">{labels.contract.fields.totalAmount}</dt>
          <dd>
            {Number(data.contractAmount).toLocaleString("ja-JP")} {c.currencySuffix}
          </dd>
          <dt className="text-muted-foreground">{labels.contract.fields.status}</dt>
          <dd>
            {labels.contract.statuses[data.contractStatus as keyof typeof labels.contract.statuses] ??
              data.contractStatus}
          </dd>
        </dl>
      </div>

      {/* Application list */}
      {data.applications.length === 0 ? (
        <div className="border-border rounded-md border p-6 text-center space-y-2">
          <p className="text-sm text-muted-foreground">{t.empty}</p>
          <p className="text-sm text-muted-foreground">{t.emptyCta}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.applications.map((app) => (
            <div key={app.id} className="border-border rounded-md border p-4 space-y-2">
              <div className="flex items-center gap-3">
                <span className="font-medium text-sm">{app.type}</span>
                <span className="text-xs rounded-full bg-secondary text-secondary-foreground px-2 py-0.5">
                  {t.statuses[app.status]}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {app.agency && (
                  <>
                    <dt className="text-muted-foreground">{t.fields.agency}</dt>
                    <dd>{app.agency}</dd>
                  </>
                )}
                {app.plannedDate && (
                  <>
                    <dt className="text-muted-foreground">{t.fields.plannedDate}</dt>
                    <dd>{new Date(app.plannedDate).toLocaleDateString("ja-JP")}</dd>
                  </>
                )}
                {app.submittedDate && (
                  <>
                    <dt className="text-muted-foreground">{t.fields.submittedDate}</dt>
                    <dd>{new Date(app.submittedDate).toLocaleDateString("ja-JP")}</dd>
                  </>
                )}
                {app.approvedDate && (
                  <>
                    <dt className="text-muted-foreground">{t.fields.approvedDate}</dt>
                    <dd>{new Date(app.approvedDate).toLocaleDateString("ja-JP")}</dd>
                  </>
                )}
                {app.estimatedAmount && (
                  <>
                    <dt className="text-muted-foreground">{t.fields.estimatedAmount}</dt>
                    <dd>{Number(app.estimatedAmount).toLocaleString("ja-JP")} {c.currencySuffix}</dd>
                  </>
                )}
                {app.confirmedAmount && (
                  <>
                    <dt className="text-muted-foreground">{t.fields.confirmedAmount}</dt>
                    <dd>{Number(app.confirmedAmount).toLocaleString("ja-JP")} {c.currencySuffix}</dd>
                  </>
                )}
                {app.note && (
                  <>
                    <dt className="text-muted-foreground">{t.fields.note}</dt>
                    <dd className="whitespace-pre-wrap">{app.note}</dd>
                  </>
                )}
              </dl>
            </div>
          ))}
        </div>
      )}

      {/* Form for create / edit / status change */}
      {data.contractStatus !== "CANCELLED" && (
        <ApplicationForm
          contractId={data.contractId}
          applications={data.applications}
        />
      )}
    </div>
  );
}
