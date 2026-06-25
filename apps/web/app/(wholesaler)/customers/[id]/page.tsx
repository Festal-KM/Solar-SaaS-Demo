// 卸業者側 顧客詳細ページ (F-031 / docs/04 §1.3 / wireframes/CustomerDetail.png).
// 行クリックの遷移先。基本情報タブは 担当者 → 現状情報（顧客情報カード内インライン編集
// ＋既存設備＋メモ）→ 契約予定情報（案件情報 embedded）の順に見出しで区分する。
// 顧客情報・メモはポップアップではなくカード内インライン編集（status-panels と同 idiom）。
// PII は data ローダーで表示マスク済み、編集入力は editable.* の生値を用いる。

import { withTenant } from "@solar/db";
import { Building2, CalendarClock, User2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCustomerProjectInfo } from "@/lib/customer/get-project-info";
import { getCustomerProjectInfoEditable } from "@/lib/customer/get-project-info-editable";
import { UnauthorizedError } from "@/lib/errors";
import { labels } from "@/lib/i18n/labels";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";

import { listActiveAreas, listActiveDealers } from "../../event-detail/data";
import { listWholesalerUsers } from "../data";
import { BasicInfoInlineEdit, MemoInlineEdit } from "./basic-info-edit";
import { CustomerChat } from "./customer-chat";
import { CustomerFiles } from "./customer-files";
import { CustomerHistory } from "./customer-history";
import {
  CustomerProjectInfo,
  ProjectCurrentStateInfo,
  ProjectCallStatusSection,
  ProjectConstructionList,
  ProjectContractList,
  ProjectLoanInfoList,
  ProjectProfitList,
} from "./customer-project-info";
import { CustomerTasks } from "./customer-tasks";
import { getCustomerDetail } from "./data";
import { EditAssigneeDialog } from "./edit-assignee-dialog";
import { NegotiationStatusPanel } from "./negotiation-status-panel";
import { NewActivityDialog } from "./new-activity-dialog";
import { QuoteFiles } from "./quote-files";
import {
  ConstructionStatusPanel,
  SubsidyStatusPanel,
} from "./status-panels";

import type {
  ContractStatusValue,
  ConstructionStatusValue,
  SubsidyStatusValue,
} from "../constants";
import type { EditBasicInfoInitial } from "./basic-info-edit";
import type { AssigneeDisplay } from "./data";
import type { InflowRoute } from "@solar/contracts";

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

// 生年月日(ISO)から満年齢を算出して "NN 歳" を返す（未設定は null）。
function ageText(iso: string | null): string | null {
  if (!iso) return null;
  const b = new Date(iso);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age >= 0 && age < 130 ? `${age} 歳` : null;
}

// 次回アポ日程の簡易表示（MM/DD（曜）HH:mm）。
function formatAppointmentShort(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit" });
  const time = d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date}（${labels.customer.weekdays[d.getDay()]}）${time}`;
}

// at-a-glance 帯のステータス → バッジバリアント（一覧テーブル customer-table.tsx の
// contractVariant / constructionVariant / subsidyVariant と同じ意味づけ）。値域を
// 型で縛り、ステータス追加時にコンパイルエラーで漏れを検知する。
const CONTRACT_VARIANT: Record<ContractStatusValue, BadgeVariant> = {
  contracted: "success",
  contract_pending: "default",
  quote_presented: "default",
  negotiating: "default",
  pre_visit: "secondary",
  lost: "secondary",
  cancelled: "destructive",
};
const CONSTRUCTION_VARIANT: Record<ConstructionStatusValue, BadgeVariant> = {
  done: "success",
  in_progress: "warning",
  not_started: "secondary",
};
const SUBSIDY_VARIANT: Record<SubsidyStatusValue, BadgeVariant> = {
  completed: "success",
  applied: "default",
  revising: "warning",
  preparing: "default",
  not_applied: "secondary",
};

// 「ラベル＋バッジ」の小さなステータスチップ（ヘッダー直下の at-a-glance 帯で使用）。
function StatusChip({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant: BadgeVariant;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xs text-mute-light">{label}</span>
      <Badge variant={variant}>{value}</Badge>
    </span>
  );
}

// 基本情報タブの区分見出し（現状情報 / 契約予定情報）。タイトル + 補足 + 区切り線で
// 情報階層を明示する。
function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-2">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <span className="text-xs text-mute-light">{hint}</span>
      <div className="h-px flex-1 bg-hairline-light" aria-hidden />
    </div>
  );
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
        prefecture: true,
        city: true,
        addressLine: true,
        birthDate: true,
        buildYear: true,
        tossDept: true,
        belongDept: true,
        electricContractStatus: true,
        electricAccountNo: true,
        supplyPointNo: true,
        equipmentId: true,
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
  // Prisma は inflowRoute を string|null、birthDate/buildYear を Date|null で返すので UI 型へ寄せる。
  return {
    ...row,
    inflowRoute: (row.inflowRoute as InflowRoute | null) ?? null,
    birthDate: row.birthDate ? row.birthDate.toISOString() : null,
    buildYear: row.buildYear ? row.buildYear.toISOString() : null,
  };
}

export default async function CustomerDetailPage({ params }: PageProps) {
  const { id } = await params;
  const detail = await getCustomerDetail(id);
  if (!detail) notFound();

  const editable = await getCustomerEditableValues(id);
  if (!editable) notFound();

  const [users, areas, dealers, projectInfo, projectInfoEditable] = await Promise.all([
    listWholesalerUsers(),
    listActiveAreas(),
    listActiveDealers(),
    getCustomerProjectInfo(id),
    getCustomerProjectInfoEditable(id),
  ]);

  const t = labels.customer;
  const d = t.detail;
  const bc = labels.breadcrumb.items;

  const postalDisplay = detail.postalCode ? `〒${detail.postalCode}` : null;

  // customer.update 権限保持者のみ raw 値（マスク前）で初期化したインライン編集を描画。
  // editable が null（二次店・閲覧のみ）のときは読み取り専用 InfoRow（マスク済み）を表示。
  const basicInitial: EditBasicInfoInitial | null = editable
    ? {
        name: editable.name,
        kana: editable.kana,
        phone: editable.phone,
        email: editable.email,
        postalCode: editable.postalCode,
        area: editable.area,
        inflowRoute: editable.inflowRoute,
        prefecture: editable.prefecture,
        city: editable.city,
        addressLine: editable.addressLine,
        birthDate: editable.birthDate,
        buildYear: editable.buildYear,
        electricContractStatus: editable.electricContractStatus,
        electricAccountNo: editable.electricAccountNo,
        supplyPointNo: editable.supplyPointNo,
        equipmentId: editable.equipmentId,
      }
    : null;

  // 商談履歴タブ: 見積提示は右の見積セクションへ分離し、左の商談履歴からは除外する。
  const quoteEntries = detail.history.filter((e) => e.category === "quote");
  const historyEntries = detail.history.filter((e) => e.category !== "quote");

  // 損益計算（売上・原価・粗利）は機密財務。profitAndLoss キーは卸業者/SaaS の
  // ProjectInfoDto にのみ存在し、二次店 DTO（ProjectInfoForDealerDto）では物理除外済。
  // キーの有無を直接ゲートにすることで、タブ自体を二次店では描画しない（#4・#5）。
  const showProfitTab = "profitAndLoss" in projectInfo;
  const profitRows = "profitAndLoss" in projectInfo ? projectInfo.profitAndLoss : [];

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[{ label: bc.customers, href: "/customers" }, { label: bc.customerDetail }]}
      />

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="space-y-2.5">
          <h1 className="text-2xl font-bold text-ink">
            {detail.name}
            <span className="ml-1 text-xl font-medium text-body-light">{t.honorific}</span>
          </h1>
          {/* at-a-glance — タブを開かずに主要な状態を一望できるステータス帯。 */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {detail.nextAppointmentAt ? (
              <span className="inline-flex items-center gap-1.5 text-sm">
                <CalendarClock className="size-4 text-mute-light" />
                <span className="text-xs text-mute-light">{d.glance.nextAppointment}</span>
                <span className="font-medium tabular-nums text-ink">
                  {formatAppointmentShort(detail.nextAppointmentAt)}
                </span>
              </span>
            ) : null}
            <StatusChip
              label={d.glance.contract}
              value={t.contractStatusLabels[detail.contract.status]}
              variant={CONTRACT_VARIANT[detail.contract.status] ?? "secondary"}
            />
            <StatusChip
              label={d.glance.construction}
              value={t.constructionStatusLabels[detail.construction.status]}
              variant={CONSTRUCTION_VARIANT[detail.construction.status] ?? "secondary"}
            />
            <StatusChip
              label={d.glance.subsidy}
              value={t.subsidyStatusLabels[detail.subsidy.status]}
              variant={SUBSIDY_VARIANT[detail.subsidy.status] ?? "secondary"}
            />
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/customers">{d.backToList}</Link>
        </Button>
      </div>

      {/* 詳細はタブで分割 — 基本情報 / 商談履歴 / 契約 / 施工 / 設置申請 / ファイル / ToDo / チャット */}
      <Tabs defaultValue="basic" className="space-y-4">
        <TabsList variant="underline">
          <TabsTrigger value="basic">{d.tabs.basic}</TabsTrigger>
          <TabsTrigger value="history">{d.tabs.history}</TabsTrigger>
          <TabsTrigger value="contract">{d.tabs.contract}</TabsTrigger>
          <TabsTrigger value="loan">{d.tabs.loan}</TabsTrigger>
          <TabsTrigger value="construction">{d.tabs.construction}</TabsTrigger>
          <TabsTrigger value="subsidy">{d.tabs.subsidy}</TabsTrigger>
          <TabsTrigger value="calls">{d.tabs.calls}</TabsTrigger>
          {showProfitTab ? <TabsTrigger value="profit">{d.tabs.profit}</TabsTrigger> : null}
          <TabsTrigger value="files">{d.tabs.files}</TabsTrigger>
          <TabsTrigger value="todo">{d.tabs.todo}</TabsTrigger>
          <TabsTrigger value="chat">{d.tabs.chat}</TabsTrigger>
        </TabsList>

        {/* 基本情報タブ — 担当者 + 現状情報（顧客情報・既存設備）/ 契約予定情報（案件） */}
        <TabsContent value="basic" className="space-y-4">
          {/* 担当者 — トスアップ / クロージングを自社社員 or 二次店から登録。 */}
          <Card className="p-5">
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

          {/* ── 現状情報 — 顧客の連絡先・既存設備・電気契約など現在の状況 ── */}
          <SectionHeading title={d.currentInfoSection} hint={d.currentInfoHint} />

          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">{d.customerInfo}</h2>
            {basicInitial ? (
              <BasicInfoInlineEdit
                customerId={detail.id}
                initial={basicInitial}
                areas={areas}
              />
            ) : (
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                <InfoRow label={d.fields.kana} value={detail.kana} />
                <InfoRow
                  label={d.fields.inflowRoute}
                  value={detail.inflowRoute ? d.inflowRouteLabels[detail.inflowRoute] : null}
                />
                <InfoRow label={d.fields.birthDate} value={formatDay(detail.birthDate)} />
                <InfoRow label={d.fields.age} value={ageText(detail.birthDate)} />
                <InfoRow label={d.fields.postalCode} value={postalDisplay} />
                <InfoRow label={d.fields.prefecture} value={detail.prefecture} />
                <InfoRow label={d.fields.city} value={detail.city} />
                <InfoRow label={d.fields.addressLine} value={detail.addressLine} />
                <InfoRow label={d.fields.area} value={detail.area} />
                <InfoRow label={d.fields.phone} value={detail.phone} />
                <InfoRow label={d.fields.email} value={detail.email} />
                <InfoRow label={d.fields.buildYear} value={formatDay(detail.buildYear)} />
                <InfoRow
                  label={d.fields.electricContractStatus}
                  value={detail.electricContractStatus}
                />
                <InfoRow label={d.fields.electricAccountNo} value={detail.electricAccountNo} />
                <InfoRow label={d.fields.supplyPointNo} value={detail.supplyPointNo} />
                <InfoRow label={d.fields.equipmentId} value={detail.equipmentId} />
              </dl>
            )}
          </Card>

          {/* 現状情報の詳細 — 住環境ヒアリング(既設設備/家族属性/連絡先) + 概況。
              いずれも「現状」の情報。編集は権限保持者のみ各セクションのダイアログで。 */}
          <Card className="p-5">
            <ProjectCurrentStateInfo data={projectInfo} editable={projectInfoEditable} />
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">{d.memo}</h2>
            {basicInitial ? (
              <MemoInlineEdit customerId={detail.id} initial={{ note: editable.note }} />
            ) : (
              <p className="whitespace-pre-wrap text-sm text-body-light">
                {detail.note && detail.note.length > 0 ? detail.note : d.noMemo}
              </p>
            )}
          </Card>

          {/* ── 契約予定情報 — 契約状況タブの内容を読み取り専用で pull 表示 ──
              契約・金額/契約明細/認定の編集面は契約状況タブに集約し、ここには
              編集トリガーを出さない（contractReadOnly）。重複する基本情報・体制・
              備考は embedded で抑制する。 */}
          <SectionHeading title={d.plannedInfoSection} hint={d.plannedInfoHint} />
          <Card className="p-5">
            <CustomerProjectInfo
              data={projectInfo}
              embedded
              editable={projectInfoEditable}
              contractReadOnly
            />
          </Card>
        </TabsContent>

        {/* 商談履歴 — 現在の商談状況の入力 + 履歴スレッド */}
        <TabsContent value="history" className="space-y-4">
          <Card className="p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <h2 className="text-sm font-semibold text-ink">{d.negotiation.title}</h2>
              {/* コール業務向けに顧客電話番号を近傍表示（detail.phone はローダでマスク済み）。 */}
              <span className="inline-flex items-center gap-1.5 text-sm">
                <span className="text-xs text-mute-light">{d.fields.phone}</span>
                <span className="font-medium tabular-nums text-ink">
                  {detail.phone && detail.phone.length > 0 ? detail.phone : "—"}
                </span>
              </span>
            </div>
            <NegotiationStatusPanel
              customerId={detail.id}
              initialMaekaku={detail.maekakuStatus}
              initialContractStatus={detail.contract.status}
              initialNextAction={detail.nextAction}
              initialNextAppointmentAt={detail.nextAppointmentAt}
              initialMaekakuPreferredAt={detail.maekakuPreferredAt}
            />
          </Card>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* 左: 商談履歴（見積提示は右の見積セクションに分離） */}
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink">{d.history.title}</h2>
                <NewActivityDialog
                  customerId={detail.id}
                  users={users}
                  defaultAssigneeUserId={editable.closingUserId}
                />
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
                  defaultAssigneeUserId={editable.closingUserId}
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
                        <QuoteFiles customerId={detail.id} activityId={q.id} files={q.files} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </TabsContent>

        {/* 契約状況 — 契約予定情報の単一の表示・編集面（Contract モデル由来 per-contract）。
            商材ライン（PV/BT/付帯/施工）はカード内インライン編集。概況（Customer 手動列）は
            廃止。契約関連ファイル（CONTRACT）のアップロードを併設する。 */}
        <TabsContent value="contract" className="space-y-4">
          <Card className="p-5">
            <div className="mb-1 flex items-baseline gap-2">
              <h2 className="text-sm font-semibold text-ink">{d.contractTab.detailTitle}</h2>
              <span className="text-xs text-mute-light">{d.contractTab.detailHint}</span>
            </div>
            <div className="mt-3">
              <ProjectContractList
                data={projectInfo}
                editable={projectInfoEditable}
                inlineEquipment
              />
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">{d.contractFiles.title}</h2>
            <CustomerFiles
              customerId={detail.id}
              category="CONTRACT"
              files={detail.contractFiles}
            />
          </Card>
        </TabsContent>

        {/* ローン情報 — 顧客に紐づく全契約のローン・団信（loanReviewStatus 編集含む） */}
        <TabsContent value="loan">
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">{d.tabs.loan}</h2>
            <ProjectLoanInfoList data={projectInfo} editable={projectInfoEditable} />
          </Card>
        </TabsContent>

        {/* 施工状況 — ステータス（プルダウン）/ 工事予定日 / 対応事業者 + PV設置図面 */}
        <TabsContent value="construction" className="space-y-4">
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
          {/* 施工コスト — 顧客に紐づく全契約の Construction.fee を契約ごとに表示・編集。
              fee は原価系のため二次店（editable=null・fee 物理除外）では非表示。 */}
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">
              {d.constructionTab.title}
            </h2>
            <ProjectConstructionList data={projectInfo} editable={projectInfoEditable} />
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">{d.pvDrawing.title}</h2>
            <CustomerFiles
              customerId={detail.id}
              category="PV_DRAWING"
              files={detail.pvDrawingFiles}
            />
          </Card>
        </TabsContent>

        {/* 設置申請状況 — ステータス（プルダウン）/ 申請種別 / 申請日 / 承認日 + 申請関連ドキュメント */}
        <TabsContent value="subsidy" className="space-y-4">
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
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">{d.applicationFiles.title}</h2>
            <CustomerFiles
              customerId={detail.id}
              category="APPLICATION"
              files={detail.applicationFiles}
            />
          </Card>
        </TabsContent>

        {/* コール状況 — 完工/ローン完了コール状況・希望日時・汎用希望時間帯・マエカク希望電話 */}
        <TabsContent value="calls">
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">{d.tabs.calls}</h2>
            <ProjectCallStatusSection data={projectInfo} editable={projectInfoEditable} />
          </Card>
        </TabsContent>

        {/* 損益計算 — 契約単位の売上・各原価・粗利を表で一覧（合計行付き）。機密財務の
            ため卸業者/SaaS 限定（二次店では profitAndLoss 物理除外・タブ非描画）。 */}
        {showProfitTab ? (
          <TabsContent value="profit">
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold text-ink">{d.profitTab.title}</h2>
              <ProjectProfitList rows={profitRows} />
            </Card>
          </TabsContent>
        ) : null}

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
