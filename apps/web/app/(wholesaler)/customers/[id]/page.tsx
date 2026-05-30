// 卸業者側 顧客詳細ページ (F-031 / docs/04 §1.3 / wireframes/CustomerDetail.png).
// 行クリックの遷移先。基本情報（左・縦長）/ 契約状況・施工状況・補助金申請状況の
// 3 カード（右上・横並び）/ メモ（右下・横幅いっぱい）/ 商談履歴（最下部・全幅・
// スレッド形式）。PII は data ローダーでマスク済み。

import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import type { BadgeVariant } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { UnauthorizedError } from "@/lib/errors";
import { labels } from "@/lib/i18n/labels";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@solar/db";

import { listWholesalerUsers } from "../data";
import { listActiveAreas } from "../../event-detail/data";

import type {
  ContractStatusValue,
  ConstructionStatusValue,
  SubsidyStatusValue,
} from "../constants";

import { CustomerFiles } from "./customer-files";
import { CustomerHistory } from "./customer-history";
import { getCustomerDetail } from "./data";
import { EditAssigneeDialog } from "./edit-assignee-dialog";
import { NewActivityDialog } from "./new-activity-dialog";
import { EditBasicInfoDialog } from "./edit-basic-info-dialog";
import type { EditBasicInfoInitial } from "./edit-basic-info-dialog";
import { EditMemoDialog } from "./edit-memo-dialog";
import {
  EditConstructionStatusDialog,
  EditContractStatusDialog,
  EditSubsidyStatusDialog,
} from "./edit-status-dialogs";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

function contractVariant(v: ContractStatusValue): BadgeVariant {
  switch (v) {
    case "contracted":
      return "success";
    case "negotiating":
      return "default";
    case "lost":
      return "secondary";
    case "cancelled":
      return "destructive";
  }
}
function constructionVariant(v: ConstructionStatusValue): BadgeVariant {
  switch (v) {
    case "done":
      return "success";
    case "in_progress":
      return "warning";
    case "not_started":
      return "secondary";
  }
}
function subsidyVariant(v: SubsidyStatusValue): BadgeVariant {
  switch (v) {
    case "granted":
      return "success";
    case "applying":
      return "default";
    case "none":
      return "secondary";
  }
}

function formatDay(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="w-24 shrink-0 text-xs text-mute-light">{label}</dt>
      <dd className="text-sm text-ink">{value && value.length > 0 ? value : "—"}</dd>
    </div>
  );
}

function StatusDetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-xs text-mute-light">{label}</span>
      <span className="text-right text-ink">{value && value.length > 0 ? value : "—"}</span>
    </div>
  );
}

// Inline-edit forms need the RAW (unmasked) editable values — the detail
// loader masks name/phone/address, so pre-filling from `detail` would persist
// the mask. Fetch raw fields via the same auth → assertCan('customer.update')
// → withTenant idiom as the dedicated edit page; only fields the editing user
// already may change are returned.
async function getCustomerEditableValues(
  id: string,
): Promise<
  | (EditBasicInfoInitial & { note: string | null; registeredByUserId: string })
  | null
> {
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
        name: true,
        kana: true,
        phone: true,
        email: true,
        postalCode: true,
        address: true,
        area: true,
        registeredByUserId: true,
        note: true,
      },
    }),
  );
  return row;
}

export default async function CustomerDetailPage({ params }: PageProps) {
  const { id } = await params;
  const detail = await getCustomerDetail(id);
  if (!detail) notFound();

  const editable = await getCustomerEditableValues(id);
  if (!editable) notFound();

  const [users, areas] = await Promise.all([listWholesalerUsers(), listActiveAreas()]);

  const t = labels.customer;
  const d = t.detail;
  const bc = labels.breadcrumb.items;

  const postalDisplay = detail.postalCode ? `〒${detail.postalCode}` : null;

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[{ label: bc.customers, href: "/customers" }, { label: bc.customerDetail }]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-ink">
            {detail.name}
            <span className="ml-1 text-xl font-medium text-body-light">{t.honorific}</span>
          </h1>
          <div className="flex items-center gap-2">
            <span className="text-sm text-mute-light">
              {d.fields.assignee}：
              <span className="text-ink">{detail.assigneeName}</span>
            </span>
            <EditAssigneeDialog
              customerId={detail.id}
              currentUserId={editable.registeredByUserId}
              users={users}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/customers">{d.backToList}</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        {/* 基本情報 — 左・縦長 */}
        <Card className="p-5 lg:col-start-1 lg:row-start-1 lg:row-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">{d.basicInfo}</h2>
            <EditBasicInfoDialog
              customerId={detail.id}
              initial={{
                name: editable.name,
                kana: editable.kana,
                phone: editable.phone,
                email: editable.email,
                postalCode: editable.postalCode,
                address: editable.address,
                area: editable.area,
              }}
              areas={areas}
            />
          </div>
          <dl className="space-y-2.5">
            <InfoRow label={d.fields.kana} value={detail.kana} />
            <InfoRow label={d.fields.postalCode} value={postalDisplay} />
            <InfoRow label={d.fields.area} value={detail.area} />
            <InfoRow label={d.fields.address} value={detail.address} />
            <InfoRow label={d.fields.phone} value={detail.phone} />
            <InfoRow label={d.fields.email} value={detail.email} />
          </dl>
        </Card>

        {/* 契約状況 */}
        <Card className="p-5 lg:col-start-2 lg:row-start-1">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">{d.cards.contract}</h2>
            <EditContractStatusDialog customerId={detail.id} initial={detail.contract} />
          </div>
          <Badge variant={contractVariant(detail.contract.status)} className="mb-3">
            {t.contractStatusLabels[detail.contract.status]}
          </Badge>
          <div className="space-y-2">
            <StatusDetailRow label={d.contractFields.plan} value={detail.contract.plan} />
            <StatusDetailRow
              label={d.contractFields.expectedDate}
              value={formatDay(detail.contract.expectedDate)}
            />
          </div>
        </Card>

        {/* 施工状況 */}
        <Card className="p-5 lg:col-start-3 lg:row-start-1">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">{d.cards.construction}</h2>
            <EditConstructionStatusDialog customerId={detail.id} initial={detail.construction} />
          </div>
          <Badge variant={constructionVariant(detail.construction.status)} className="mb-3">
            {t.constructionStatusLabels[detail.construction.status]}
          </Badge>
          <div className="space-y-2">
            <StatusDetailRow
              label={d.constructionFields.plannedDate}
              value={formatDay(detail.construction.plannedDate)}
            />
            <StatusDetailRow
              label={d.constructionFields.completedDate}
              value={formatDay(detail.construction.completedDate)}
            />
          </div>
        </Card>

        {/* 補助金申請状況 */}
        <Card className="p-5 lg:col-start-4 lg:row-start-1">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">{d.cards.subsidy}</h2>
            <EditSubsidyStatusDialog customerId={detail.id} initial={detail.subsidy} />
          </div>
          <Badge variant={subsidyVariant(detail.subsidy.status)} className="mb-3">
            {t.subsidyStatusLabels[detail.subsidy.status]}
          </Badge>
          <div className="space-y-2">
            <StatusDetailRow label={d.subsidyFields.type} value={detail.subsidy.type} />
            <StatusDetailRow
              label={d.subsidyFields.submittedDate}
              value={formatDay(detail.subsidy.submittedDate)}
            />
            <StatusDetailRow
              label={d.subsidyFields.grantedDate}
              value={formatDay(detail.subsidy.grantedDate)}
            />
          </div>
        </Card>

        {/* メモ — 右下・横幅いっぱい（3カラム分） */}
        <Card className="p-5 lg:col-start-2 lg:row-start-2 lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">{d.memo}</h2>
            <EditMemoDialog customerId={detail.id} initial={{ note: editable.note }} />
          </div>
          <p className="whitespace-pre-wrap text-sm text-body-light">
            {detail.note && detail.note.length > 0 ? detail.note : d.noMemo}
          </p>
        </Card>
      </div>

      {/* 商談履歴 — 全幅・スレッド形式 */}
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">{d.history.title}</h2>
          <NewActivityDialog customerId={detail.id} users={users} />
        </div>
        <CustomerHistory entries={detail.history} />
      </Card>

      {/* 関連ファイル / タスク — 2 カラム */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">{d.files.title}</h2>
          <CustomerFiles files={detail.files} />
          <div className="mt-3 text-center">
            <Button type="button" variant="outline" size="sm" disabled>
              {d.files.showAll}
            </Button>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">{d.tasks.title}</h2>
          {detail.tasks.length === 0 ? (
            <p className="text-sm text-mute-light">{d.tasks.empty}</p>
          ) : (
            <ul className="divide-y divide-hairline-light">
              {detail.tasks.map((task) => (
                <li key={task.id} className="flex items-center gap-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={task.done}
                    readOnly
                    disabled
                    className="size-4 shrink-0 rounded border-hairline-light"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{task.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-mute-light">{task.due}</span>
                  <span className="shrink-0 text-xs text-mute-light">{task.assignee}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 text-center">
            <Button type="button" variant="outline" size="sm" disabled>
              {d.tasks.showAll}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
