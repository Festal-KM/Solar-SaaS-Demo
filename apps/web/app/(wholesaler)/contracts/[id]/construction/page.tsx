// S-046 — 施工管理 (T-05-10 / F-044 / docs/04 §1.3).
//
// RSC data loader:
//   • Contract header + status
//   • Construction records for the contract
//   • Installer list for the picker
//
// Client interactions (ConstructionForm):
//   • 施工登録: createConstructionAction
//   • 情報更新: updateConstructionAction (fee change triggers gross-profit recalc)
//   • ステータス変更: changeConstructionStatusAction

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
import type { ConstructionStatus } from "@solar/db";

import { ConstructionForm } from "./ConstructionForm";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

interface InstallerOption {
  id: string;
  name: string;
}

interface ConstructionRow {
  id: string;
  status: ConstructionStatus;
  installerId: string | null;
  installerName: string | null;
  fee: string | null;
  surveyDate: string | null;
  plannedDate: string | null;
  completedDate: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PageData {
  contractId: string;
  contractDate: string;
  contractStatus: string;
  contractAmount: string;
  constructions: ConstructionRow[];
  installers: InstallerOption[];
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
    action: "construction.read",
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

    const [constructions, installers] = await Promise.all([
      tx.construction.findMany({
        where: { contractId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          status: true,
          installerId: true,
          fee: true,
          surveyDate: true,
          plannedDate: true,
          completedDate: true,
          note: true,
          createdAt: true,
          updatedAt: true,
          installer: { select: { name: true } },
        },
      }),
      tx.installer.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);

    return {
      contractId: contract.id,
      contractDate: contract.contractDate.toISOString(),
      contractStatus: contract.status,
      contractAmount: contract.contractAmount.toString(),
      constructions: constructions.map((c) => ({
        id: c.id,
        status: c.status,
        installerId: c.installerId,
        installerName: c.installer?.name ?? null,
        fee: c.fee?.toString() ?? null,
        surveyDate: c.surveyDate?.toISOString() ?? null,
        plannedDate: c.plannedDate?.toISOString() ?? null,
        completedDate: c.completedDate?.toISOString() ?? null,
        note: c.note,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
      installers,
    };
  });
}

export default async function ConstructionPage({ params }: PageProps) {
  const { id } = await params;
  const data = await loadPageData(id);
  if (!data) notFound();

  const t = labels.construction;
  const c = labels.common;
  const bc = labels.breadcrumb.items;

  // Determine if any construction has a plannedDate within 7 days.
  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: bc.contracts, href: "/contracts" },
          { label: bc.contractDetail, href: `/contracts/${id}` },
          { label: bc.contractConstruction },
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

      {/* Construction list */}
      {data.constructions.length === 0 ? (
        <div className="border-border rounded-md border p-6 text-center space-y-2">
          <p className="text-sm text-muted-foreground">{t.empty}</p>
          <p className="text-sm text-muted-foreground">{t.emptyCta}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.constructions.map((con) => {
            const isUpcoming =
              con.plannedDate &&
              con.status !== "DONE" &&
              con.status !== "PAUSED" &&
              new Date(con.plannedDate) <= sevenDaysLater &&
              new Date(con.plannedDate) >= now;

            return (
              <div key={con.id} className="border-border rounded-md border p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-sm">
                    {t.statuses[con.status]}
                  </span>
                  {isUpcoming && (
                    <span className="text-xs rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">
                      {t.upcomingBadge}
                    </span>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {con.installerName && (
                    <>
                      <dt className="text-muted-foreground">{t.fields.installer}</dt>
                      <dd>{con.installerName}</dd>
                    </>
                  )}
                  {con.fee && (
                    <>
                      <dt className="text-muted-foreground">{t.fields.fee}</dt>
                      <dd>
                        {Number(con.fee).toLocaleString("ja-JP")} {c.currencySuffix}
                      </dd>
                    </>
                  )}
                  {con.surveyDate && (
                    <>
                      <dt className="text-muted-foreground">{t.fields.surveyDate}</dt>
                      <dd>{new Date(con.surveyDate).toLocaleDateString("ja-JP")}</dd>
                    </>
                  )}
                  {con.plannedDate && (
                    <>
                      <dt className="text-muted-foreground">{t.fields.plannedDate}</dt>
                      <dd>{new Date(con.plannedDate).toLocaleDateString("ja-JP")}</dd>
                    </>
                  )}
                  {con.completedDate && (
                    <>
                      <dt className="text-muted-foreground">{t.fields.completedDate}</dt>
                      <dd>{new Date(con.completedDate).toLocaleDateString("ja-JP")}</dd>
                    </>
                  )}
                  {con.note && (
                    <>
                      <dt className="text-muted-foreground">{t.fields.note}</dt>
                      <dd className="whitespace-pre-wrap">{con.note}</dd>
                    </>
                  )}
                </dl>
              </div>
            );
          })}
        </div>
      )}

      {/* Form for create / edit / status change */}
      {data.contractStatus !== "CANCELLED" && (
        <ConstructionForm
          contractId={data.contractId}
          constructions={data.constructions}
          installers={data.installers}
        />
      )}
    </div>
  );
}
