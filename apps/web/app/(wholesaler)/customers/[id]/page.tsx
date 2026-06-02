// 卸業者側 顧客詳細ページ (F-031 / docs/04 §1.3 / wireframes/CustomerDetail.png).
// 行クリックの遷移先。基本情報（左・縦長）/ 契約状況・施工状況・補助金申請状況の
// 3 カード（右上・横並び）/ メモ（右下・横幅いっぱい）/ 商談履歴（最下部・全幅・
// スレッド形式）。PII は data ローダーでマスク済み。

import { Building2, User2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnauthorizedError } from "@/lib/errors";
import { labels } from "@/lib/i18n/labels";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@solar/db";

import { listWholesalerUsers } from "../data";
import { listActiveAreas, listActiveDealers } from "../../event-detail/data";

import type { InflowRoute } from "@solar/contracts";

import { CustomerChat } from "./customer-chat";
import { CustomerFiles } from "./customer-files";
import { CustomerHistory } from "./customer-history";
import { CustomerTasks } from "./customer-tasks";
import { getCustomerDetail } from "./data";
import type { AssigneeDisplay } from "./data";
import { EditAssigneeDialog } from "./edit-assignee-dialog";
import { NegotiationStatusPanel } from "./negotiation-status-panel";
import { NewActivityDialog } from "./new-activity-dialog";
import { EditBasicInfoDialog } from "./edit-basic-info-dialog";
import type { EditBasicInfoInitial } from "./edit-basic-info-dialog";
import { EditMemoDialog } from "./edit-memo-dialog";
import {
  ContractStatusPanel,
  ConstructionStatusPanel,
  SubsidyStatusPanel,
} from "./status-panels";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
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

// 担当者 1 枠（トスアップ / クロージング）。自社社員 or 二次店をアバター + 名前 +
// 種別バッジで表示。未設定は淡色のプレースホルダー。
function AssigneeBlock({ role, assignee }: { role: string; assignee: AssigneeDisplay | null }) {
  const d = labels.customer.detail;
  const isDealer = assignee?.kind === "dealer";
  const Icon = isDealer ? Building2 : User2;

  return (
    <div className="flex items-center gap-3 rounded-md border border-hairline-light bg-surface-soft/40 p-3">
      <div
        className={[
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          assignee
            ? isDealer
              ? "bg-amber-100 text-amber-700"
              : "bg-primary/10 text-primary"
            : "bg-hairline-light text-mute-light",
        ].join(" ")}
      >
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-mute-light">{role}</p>
        {assignee ? (
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-ink">{assignee.name}</span>
            <Badge variant={isDealer ? "warning" : "secondary"} className="shrink-0">
              {isDealer ? d.dealerBadge : d.ownStaffBadge}
            </Badge>
          </div>
        ) : (
          <p className="text-sm text-mute-light">{d.unassigned}</p>
        )}
      </div>
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
  | (EditBasicInfoInitial & {
      note: string | null;
      registeredByUserId: string;
      tossUpUserId: string | null;
      tossUpRelationshipId: string | null;
      closingUserId: string | null;
      closingRelationshipId: string | null;
    })
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
        inflowRoute: true,
        registeredByUserId: true,
        tossUpUserId: true,
        tossUpRelationshipId: true,
        closingUserId: true,
        closingRelationshipId: true,
        note: true,
      },
    }),
  );
  if (!row) return null;
  // Prisma は inflowRoute を string|null で返すので、UI 用の InflowRoute 型へ寄せる。
  return { ...row, inflowRoute: (row.inflowRoute as InflowRoute | null) ?? null };
}

export default async function CustomerDetailPage({ params }: PageProps) {
  const { id } = await params;
  const detail = await getCustomerDetail(id);
  if (!detail) notFound();

  const editable = await getCustomerEditableValues(id);
  if (!editable) notFound();

  const [users, areas, dealers] = await Promise.all([
    listWholesalerUsers(),
    listActiveAreas(),
    listActiveDealers(),
  ]);

  const t = labels.customer;
  const d = t.detail;
  const bc = labels.breadcrumb.items;

  const postalDisplay = detail.postalCode ? `〒${detail.postalCode}` : null;

  // 商談履歴タブ: 見積提示は右の見積セクションへ分離し、左の商談履歴からは除外する。
  const quoteEntries = detail.history.filter((e) => e.category === "quote");
  const historyEntries = detail.history.filter((e) => e.category !== "quote");

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[{ label: bc.customers, href: "/customers" }, { label: bc.customerDetail }]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">
          {detail.name}
          <span className="ml-1 text-xl font-medium text-body-light">{t.honorific}</span>
        </h1>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/customers">{d.backToList}</Link>
          </Button>
        </div>
      </div>

      {/* 詳細はタブで分割 — 基本情報 / 商談履歴 / 契約 / 施工 / 補助金 / ファイル / ToDo / チャット */}
      <Tabs defaultValue="basic" className="space-y-4">
        <TabsList variant="underline">
          <TabsTrigger value="basic">{d.tabs.basic}</TabsTrigger>
          <TabsTrigger value="history">{d.tabs.history}</TabsTrigger>
          <TabsTrigger value="contract">{d.tabs.contract}</TabsTrigger>
          <TabsTrigger value="construction">{d.tabs.construction}</TabsTrigger>
          <TabsTrigger value="subsidy">{d.tabs.subsidy}</TabsTrigger>
          <TabsTrigger value="files">{d.tabs.files}</TabsTrigger>
          <TabsTrigger value="todo">{d.tabs.todo}</TabsTrigger>
          <TabsTrigger value="chat">{d.tabs.chat}</TabsTrigger>
        </TabsList>

        {/* 基本情報タブ — 担当者 + 基本情報 + メモ */}
        <TabsContent value="basic" className="space-y-4">
          {/* 担当者 — トスアップ / クロージングを自社社員 or 二次店から登録。 */}
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">{d.assigneeLabel}</h2>
              <EditAssigneeDialog
                customerId={detail.id}
                currentTossUpUserId={editable.tossUpUserId}
                currentTossUpRelationshipId={editable.tossUpRelationshipId}
                currentClosingUserId={editable.closingUserId}
                currentClosingRelationshipId={editable.closingRelationshipId}
                users={users}
                dealers={dealers}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <AssigneeBlock role={d.fields.tossUpAssignee} assignee={detail.tossUp} />
              <AssigneeBlock role={d.fields.closingAssignee} assignee={detail.closing} />
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink">{d.customerInfo}</h2>
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
                    inflowRoute: editable.inflowRoute,
                  }}
                  areas={areas}
                />
              </div>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                <InfoRow label={d.fields.kana} value={detail.kana} />
                <InfoRow
                  label={d.fields.inflowRoute}
                  value={detail.inflowRoute ? d.inflowRouteLabels[detail.inflowRoute] : null}
                />
                <InfoRow label={d.fields.postalCode} value={postalDisplay} />
                <InfoRow label={d.fields.area} value={detail.area} />
                <InfoRow label={d.fields.address} value={detail.address} />
                <InfoRow label={d.fields.phone} value={detail.phone} />
                <InfoRow label={d.fields.email} value={detail.email} />
              </dl>
            </Card>

            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink">{d.memo}</h2>
                <EditMemoDialog customerId={detail.id} initial={{ note: editable.note }} />
              </div>
              <p className="whitespace-pre-wrap text-sm text-body-light">
                {detail.note && detail.note.length > 0 ? detail.note : d.noMemo}
              </p>
            </Card>
          </div>
        </TabsContent>

        {/* 商談履歴 — 現在の商談状況の入力 + 履歴スレッド */}
        <TabsContent value="history" className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">{d.negotiation.title}</h2>
            <NegotiationStatusPanel
              customerId={detail.id}
              initialMaekaku={detail.maekakuStatus}
              initialContractStatus={detail.contract.status}
              initialNextAction={detail.nextAction}
              initialNextAppointmentAt={detail.nextAppointmentAt}
            />
          </Card>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* 左: 商談履歴（見積提示は右の見積セクションに分離） */}
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink">{d.history.title}</h2>
                <NewActivityDialog customerId={detail.id} users={users} />
              </div>
              <CustomerHistory entries={historyEntries} />
            </Card>

            {/* 右: 見積（見積提示の記録一覧） */}
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink">{d.quoteSection.title}</h2>
                <NewActivityDialog
                  customerId={detail.id}
                  users={users}
                  defaultCategory="quote"
                  triggerLabel={d.quoteSection.record}
                />
              </div>
              {quoteEntries.length === 0 ? (
                <p className="text-sm text-mute-light">{d.quoteSection.empty}</p>
              ) : (
                <ul className="space-y-3">
                  {quoteEntries.map((q) => (
                    <li
                      key={q.id}
                      className="border-hairline-light relative overflow-hidden rounded-lg border pl-4"
                    >
                      <span className="absolute inset-y-0 left-0 w-1 bg-amber-500" aria-hidden />
                      <div className="p-3">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-xs tabular-nums text-mute-light">
                            {formatDay(q.date)}
                          </span>
                          <span className="text-lg font-semibold tabular-nums text-amber-700">
                            {q.amount != null ? `¥${q.amount.toLocaleString("ja-JP")}` : "—"}
                          </span>
                        </div>
                        {q.body ? (
                          <p className="mt-1 whitespace-pre-wrap text-sm text-body-light">{q.body}</p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </TabsContent>

        {/* 契約状況 — 契約プラン / 金額 / 契約予定日（インライン編集） */}
        <TabsContent value="contract">
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">{d.cards.contract}</h2>
            <ContractStatusPanel
              customerId={detail.id}
              initial={{
                plan: detail.contract.plan,
                amount: detail.contract.amount,
                expectedDate: detail.contract.expectedDate,
              }}
            />
          </Card>
        </TabsContent>

        {/* 施工状況 — ステータス（プルダウン）/ 工事予定日 / 対応事業者 */}
        <TabsContent value="construction">
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">{d.cards.construction}</h2>
            <ConstructionStatusPanel
              customerId={detail.id}
              initial={{
                status: detail.construction.status,
                plannedDate: detail.construction.plannedDate,
                vendor: detail.construction.vendor,
              }}
            />
          </Card>
        </TabsContent>

        {/* 補助金申請状況 — ステータス（プルダウン）/ 申請種別 / 申請日 / 交付決定日 */}
        <TabsContent value="subsidy">
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">{d.cards.subsidy}</h2>
            <SubsidyStatusPanel
              customerId={detail.id}
              initial={{
                status: detail.subsidy.status,
                type: detail.subsidy.type,
                submittedDate: detail.subsidy.submittedDate,
                grantedDate: detail.subsidy.grantedDate,
              }}
            />
          </Card>
        </TabsContent>

        {/* 関連ファイル — ファイルピッカー + 一覧 */}
        <TabsContent value="files">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">{d.files.title}</h2>
            <CustomerFiles customerId={detail.id} files={detail.files} />
          </Card>
        </TabsContent>

        {/* ToDo — タスク一覧 + 新規起票 */}
        <TabsContent value="todo">
          <Card className="p-5">
            <CustomerTasks customerId={detail.id} tasks={detail.tasks} users={users} />
          </Card>
        </TabsContent>

        {/* チャット */}
        <TabsContent value="chat">
          <Card className="p-5">
            <CustomerChat
              customerId={detail.id}
              messages={detail.messages}
              currentUserId={detail.currentUserId}
            />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
