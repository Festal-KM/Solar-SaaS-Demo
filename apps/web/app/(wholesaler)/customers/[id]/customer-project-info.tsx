// 顧客詳細「案件情報」タブ（F-061 統合ビュー）。`getProjectInfo`（docs/05 §16.10）が
// 返す `ProjectInfoDto`（二次店は原価キー物理除外済の `ProjectInfoForDealerDto`）を
// 受け取り、9 カテゴリをカテゴリ別に閲覧表示する。読み取り専用（編集は F-062）。

import { deriveCrossSellBadges } from "@solar/contracts";
import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { labels } from "@/lib/i18n/labels";

import {
  EditApplicationDialog,
  EditCallStatusDialog,
  EditConstructionDialog,
  EditContractDialog,
  EditEquipmentDialog,
  EditHearingDialog,
  EditOverviewDialog,
} from "./project-info-edit";

import type {
  ProjectApplicationEditable,
  ProjectConstructionEditable,
  ProjectContractEditable,
  ProjectEquipmentEditable,
  ProjectInfoEditable,
} from "@/lib/customer/get-project-info-editable";
import type {
  EquipmentCategoryKey,
  EquipmentItemDto,
  ProjectConstructionDto,
  ProjectContractDto,
  ProjectHearingDto,
  ProjectHearingForDealerDto,
  ProjectInfoDto,
  ProjectInfoForDealerDto,
  ProjectProfitDto,
} from "@solar/contracts/dto/project-info";

const p = labels.customer.detail.projectInfo;
const EMPTY = p.empty;

type AnyEquipmentItem = Omit<EquipmentItemDto, "snapshotPurchasePrice"> &
  Partial<Pick<EquipmentItemDto, "snapshotPurchasePrice">>;
type AnyEquipment = Record<EquipmentCategoryKey, AnyEquipmentItem[]>;
type AnyContract = Omit<ProjectContractDto, "equipment"> & { equipment: AnyEquipment };
type AnyConstruction = Omit<ProjectConstructionDto, "fee"> & { fee?: number | null };

export type CustomerProjectInfoData = ProjectInfoDto | ProjectInfoForDealerDto;

function fmtDate(iso: string | null): string {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtYen(n: number | null): string {
  return n == null ? EMPTY : `¥${n.toLocaleString("ja-JP")}`;
}

// 粗利率 0..1 を百分率（小数 1 桁）で表示。
function fmtPercent(rate: number | null): string {
  if (rate == null) return EMPTY;
  return `${(rate * 100).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}%`;
}

function fmtBool(b: boolean | null): string {
  if (b == null) return EMPTY;
  return b ? p.yes : p.no;
}

function fmtAge(age: number | null): string {
  return age == null ? EMPTY : `${age} 歳`;
}

function attrString(attrs: Record<string, unknown> | null, key: string): string {
  const v = attrs?.[key];
  if (v == null) return EMPTY;
  if (typeof v === "boolean") return v ? p.yes : p.no;
  return String(v);
}

function MetaItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-mute-light">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-ink">
        {value && value.length > 0 ? value : EMPTY}
      </dd>
    </div>
  );
}

function Section({
  title,
  children,
  editSlot,
}: {
  title: string;
  children: React.ReactNode;
  editSlot?: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-mute-light">{title}</h3>
        {editSlot}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-hairline-light p-4 sm:grid-cols-3">
        {children}
      </dl>
    </section>
  );
}

function EquipmentCard({
  title,
  item,
  rows,
  editSlot,
}: {
  title: string;
  item: AnyEquipmentItem;
  rows: { label: string; value: string }[];
  editSlot?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-hairline-light p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <div className="flex items-center gap-1">
          <Badge variant={item.contracted ? "success" : "secondary"}>
            {item.contracted ? p.contracted : p.notContracted}
          </Badge>
          {editSlot}
        </div>
      </div>
      {item.contracted ? (
        <dl className="grid grid-cols-2 gap-x-5 gap-y-2.5 sm:grid-cols-3">
          {rows.map((r) => (
            <MetaItem key={r.label} label={r.label} value={r.value} />
          ))}
        </dl>
      ) : null}
    </div>
  );
}

const e = p.equipment;

function pvRows(it: AnyEquipmentItem) {
  return [
    { label: e.maker, value: it.manufacturer ?? EMPTY },
    { label: e.modelNo, value: it.model ?? EMPTY },
    { label: e.modelNo2, value: attrString(it.attributes, "model2") },
    { label: e.capacity, value: it.capacity ?? EMPTY },
    { label: e.panelCount, value: it.quantity != null ? `${it.quantity} 枚` : EMPTY },
    { label: e.totalWarranty, value: fmtBool(it.warrantyStandard) },
    { label: e.extWarranty, value: fmtBool(it.warrantyExtended) },
    { label: e.pcLocationNew, value: it.installLocation ?? EMPTY },
    { label: e.optional, value: attrString(it.attributes, "pvOption") },
  ];
}
function btRows(it: AnyEquipmentItem) {
  return [
    { label: e.maker, value: it.manufacturer ?? EMPTY },
    { label: e.modelNo, value: it.model ?? EMPTY },
    { label: e.capacity, value: it.capacity ?? EMPTY },
    { label: e.location, value: it.installLocation ?? EMPTY },
    { label: e.disasterWarranty, value: fmtBool(it.warrantyDisaster) },
    { label: e.extWarranty, value: fmtBool(it.warrantyExtended) },
  ];
}
function eqRows(it: AnyEquipmentItem) {
  return [
    { label: e.modelNo, value: it.model ?? EMPTY },
    { label: e.status, value: introLabel(it.introducedStatus) },
    { label: e.extWarranty, value: fmtBool(it.warrantyExtended) },
  ];
}
function ihRows(it: AnyEquipmentItem) {
  return [
    { label: e.modelNo, value: it.model ?? EMPTY },
    { label: e.status, value: introLabel(it.introducedStatus) },
  ];
}
function acRows(it: AnyEquipmentItem) {
  return [
    { label: e.count, value: it.quantity != null ? `${it.quantity} 台` : EMPTY },
    { label: e.modelNo1, value: it.model ?? EMPTY },
    { label: e.modelNo2, value: attrString(it.attributes, "model2") },
    { label: e.careSupport, value: attrString(it.attributes, "acWarrantySupport") },
  ];
}
function accessoryRows(it: AnyEquipmentItem) {
  return [
    { label: e.count, value: it.quantity != null ? `${it.quantity} 点` : EMPTY },
    { label: e.detail, value: it.detail ?? EMPTY },
    { label: e.modelNo1, value: it.model ?? EMPTY },
    { label: e.modelNo2, value: attrString(it.attributes, "model2") },
    { label: e.pcLocationSwap, value: it.installLocation ?? EMPTY },
  ];
}
function giftRows(it: AnyEquipmentItem) {
  return [
    { label: e.count, value: it.quantity != null ? `${it.quantity} 点` : EMPTY },
    { label: e.detail, value: it.detail ?? EMPTY },
    { label: e.mitsubishiPotModel, value: attrString(it.attributes, "nabeModel") },
  ];
}

function introLabel(code: string | null): string {
  if (!code) return EMPTY;
  return p.introStatusLabels[code] ?? code;
}

// 各カテゴリの代表 1 行（無ければ未契約のプレースホルダ）。
function firstOrEmpty(items: AnyEquipmentItem[]): AnyEquipmentItem {
  return items[0] ?? emptyItem();
}
function emptyItem(): AnyEquipmentItem {
  return {
    id: "",
    contracted: false,
    manufacturer: null,
    model: null,
    capacity: null,
    quantity: null,
    installLocation: null,
    introducedStatus: null,
    warrantyStandard: null,
    warrantyExtended: null,
    warrantyDisaster: null,
    detail: null,
    attributes: null,
  };
}

function EquipmentGrid({
  equipment,
  editSlotFor,
}: {
  equipment: AnyEquipment;
  // 代表設備行（firstOrEmpty）に対する編集トリガー。id が空（未契約プレースホルダ）の
  // ときは編集不可（null）。
  editSlotFor?: (item: AnyEquipmentItem, title: string) => React.ReactNode;
}) {
  const card = (title: string, item: AnyEquipmentItem, rows: { label: string; value: string }[]) => (
    <EquipmentCard title={title} item={item} rows={rows} editSlot={editSlotFor?.(item, title)} />
  );
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {card(e.pv, firstOrEmpty(equipment.PV), pvRows(firstOrEmpty(equipment.PV)))}
      {card(e.bt, firstOrEmpty(equipment.BT), btRows(firstOrEmpty(equipment.BT)))}
      {card(e.eq, firstOrEmpty(equipment.EQ), eqRows(firstOrEmpty(equipment.EQ)))}
      {card(e.ih, firstOrEmpty(equipment.IH), ihRows(firstOrEmpty(equipment.IH)))}
      {card(e.ac, firstOrEmpty(equipment.AC), acRows(firstOrEmpty(equipment.AC)))}
      {card(e.accessory, firstOrEmpty(equipment.ACCESSORY), accessoryRows(firstOrEmpty(equipment.ACCESSORY)))}
      {card(e.gift, firstOrEmpty(equipment.GIFT), giftRows(firstOrEmpty(equipment.GIFT)))}
    </div>
  );
}

// F-063 既設設備（現況）1 行（ContractEquipment とは別概念のカード）。
type AnyExistingEquipment =
  ProjectHearingDto["existingEquipments"][number] &
    Partial<ProjectHearingForDealerDto["existingEquipments"][number]>;

const h = p.hearing;

function ExistingEquipmentCard({ eq }: { eq: AnyExistingEquipment }) {
  const presence = eq.installed;
  const variant = presence === "YES" ? "success" : presence === "NO" ? "secondary" : "outline";
  // 設置日/メーカー/容量/枚数は wholesaler/saas のみ存在（二次店では物理除外済）。
  const hasDetail =
    "installDate" in eq || "maker" in eq || "capacityKw" in eq || "panelCount" in eq;
  return (
    <div className="rounded-md border border-hairline-light p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{h.categoryLabels[eq.category] ?? eq.category}</p>
        <Badge variant={variant}>{h.presenceLabels[presence] ?? presence}</Badge>
      </div>
      {presence === "YES" && hasDetail ? (
        <dl className="grid grid-cols-2 gap-x-5 gap-y-2.5 sm:grid-cols-3">
          {"installDate" in eq ? (
            <MetaItem label={h.installDate} value={fmtDate(eq.installDate ?? null)} />
          ) : null}
          {"maker" in eq ? <MetaItem label={h.maker} value={eq.maker ?? EMPTY} /> : null}
          {"capacityKw" in eq ? (
            <MetaItem
              label={h.capacity}
              value={eq.capacityKw != null ? `${eq.capacityKw} kW` : EMPTY}
            />
          ) : null}
          {"panelCount" in eq ? (
            <MetaItem
              label={h.panelCount}
              value={eq.panelCount != null ? `${eq.panelCount} 枚` : EMPTY}
            />
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

// 既存設備（現況）を単独で表示する読み取り専用ビュー。基本情報タブの「現状情報」
// セクションから再利用する（ヒアリング全体ではなく既設設備のみを切り出す）。
export function ExistingEquipmentDisplay({
  hearing,
}: {
  hearing: ProjectHearingDto | ProjectHearingForDealerDto;
}) {
  if (hearing.existingEquipments.length === 0) {
    return (
      <p className="rounded-md border border-hairline-light p-4 text-sm text-mute-light">
        {h.noExisting}
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      {hearing.existingEquipments.map((eq) => (
        <ExistingEquipmentCard key={eq.id} eq={eq as AnyExistingEquipment} />
      ))}
    </div>
  );
}

function HearingSection({
  hearing,
  editSlot,
}: {
  hearing: ProjectHearingDto | ProjectHearingForDealerDto;
  editSlot?: React.ReactNode;
}) {
  const badges = deriveCrossSellBadges(hearing.existingEquipments);
  const guide = hearing.guideAttendee ? h.guideAttendeeLabels[hearing.guideAttendee] ?? null : null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-mute-light">{h.title}</h3>
        {editSlot}
        {/* クロスセル候補バッジ（判定材料の可視化のみ・自動提案はしない） */}
        {badges.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-mute-light">{p.crossSellTitle}:</span>
            {badges.map((b) => (
              <Badge key={b} variant="warning">
                {p.crossSellLabels[b] ?? b}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      {/* 既設設備（現況）— 契約設備とは別カテゴリ */}
      <div>
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-mute-light">
          {h.existingTitle}
          <span className="ml-2 font-normal normal-case text-mute-light">{h.existingHint}</span>
        </h4>
        {hearing.existingEquipments.length === 0 ? (
          <p className="rounded-md border border-hairline-light p-4 text-sm text-mute-light">
            {h.noExisting}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {hearing.existingEquipments.map((eq) => (
              <ExistingEquipmentCard key={eq.id} eq={eq as AnyExistingEquipment} />
            ))}
          </div>
        )}
      </div>

      {/* 家族属性（年齢は年代マスキング表示済み） */}
      <div>
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-mute-light">
          {h.familyTitle}
        </h4>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-hairline-light p-4 sm:grid-cols-3">
          <MetaItem label={h.husbandAge} value={hearing.husbandAge} />
          <MetaItem label={h.wifeAge} value={hearing.wifeAge} />
          <MetaItem label={h.childAge} value={hearing.childAge} />
          <MetaItem label={h.household} value={hearing.household} />
          <MetaItem label={h.guideAttendee} value={guide} />
          <MetaItem label={h.faceToFace} value={fmtBool(hearing.faceToFace)} />
        </dl>
      </div>

      {/* 連絡先（下4桁マスキング）。マエカク希望日時は基本情報ページでは非表示。 */}
      <div>
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-mute-light">
          {h.contactTitle}
        </h4>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-hairline-light p-4 sm:grid-cols-3">
          <MetaItem label={h.landlinePhone} value={hearing.landlinePhone} />
          <MetaItem label={h.mobilePhone} value={hearing.mobilePhone} />
          <MetaItem label={h.proposedProduct} value={hearing.proposedProduct} />
          <MetaItem label={h.acquiredAt} value={fmtDate(hearing.acquiredAt)} />
        </dl>
      </div>
    </section>
  );
}

// コール状況 1 セクション（顧客単位・単一）。専用「コール状況」タブと、
// 非 embedded の案件情報ビューの両方から再利用する（embedded では抑制）。
export function ProjectCallStatusSection({
  data,
  editable = null,
}: {
  data: CustomerProjectInfoData;
  editable?: ProjectInfoEditable | null;
}) {
  const f = p.fields;
  const customerId = editable?.customerId ?? null;
  return (
    <Section
      title={p.sections.calls}
      editSlot={
        customerId && editable ? (
          <EditCallStatusDialog customerId={customerId} initial={editable.calls} />
        ) : null
      }
    >
      <MetaItem
        label={f.callMaekakuStatus}
        value={
          data.calls.maekakuStatus
            ? p.maekakuStatusDisplayLabels[data.calls.maekakuStatus] ?? data.calls.maekakuStatus
            : null
        }
      />
      <MetaItem label={f.maekakuPreferredPhone} value={data.calls.maekakuPreferredPhone} />
      <MetaItem
        label={f.postCompletionCallStatus}
        value={
          data.calls.postCompletionCallStatus
            ? p.callPhaseStatusLabels[data.calls.postCompletionCallStatus] ??
              data.calls.postCompletionCallStatus
            : null
        }
      />
      <MetaItem
        label={f.postCompletionCallPreferredAt}
        value={fmtDateTime(data.calls.postCompletionCallPreferredAt)}
      />
      <MetaItem
        label={f.loanCompletionCallStatus}
        value={
          data.calls.loanCompletionCallStatus
            ? p.callPhaseStatusLabels[data.calls.loanCompletionCallStatus] ??
              data.calls.loanCompletionCallStatus
            : null
        }
      />
      <MetaItem
        label={f.loanCompletionCallPreferredAt}
        value={fmtDateTime(data.calls.loanCompletionCallPreferredAt)}
      />
      <MetaItem label={f.generalCallPreferredTime} value={data.calls.generalCallPreferredTime} />
    </Section>
  );
}

// ローン・団信 1 件分（契約単位）の表示。契約ブロック内と専用「ローン情報」タブの
// 両方から再利用する。editContract が渡れば見出し右に編集トリガーを描画する。
function LoanBlock({
  contract,
  customerId,
  editContract,
}: {
  contract: AnyContract;
  customerId: string | null;
  editContract?: ProjectContractEditable;
}) {
  const f = p.fields;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-mute-light">
          {p.sections.loan}
        </h4>
        {customerId && editContract ? (
          <EditContractDialog customerId={customerId} initial={editContract} />
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <MetaItem label={f.loanReviewCallAt} value={fmtDateTime(contract.loanReviewCallAt)} />
        <MetaItem label={f.loanCompany} value={contract.loanCompany} />
        <MetaItem label={f.downPayment} value={fmtYen(contract.downPayment)} />
        <MetaItem label={f.creditLife} value={fmtBool(contract.creditLifeInsurance)} />
        <MetaItem
          label={f.callStatus}
          value={p.callStatusLabels[contract.callStatus] ?? contract.callStatus}
        />
        <MetaItem
          label={f.loanReviewStatus}
          value={
            contract.loanReviewStatus
              ? (p.loanReviewStatusLabels[contract.loanReviewStatus] ?? contract.loanReviewStatus)
              : null
          }
        />
        <MetaItem label={f.loanNote} value={contract.loanNote} />
      </dl>
    </div>
  );
}

// 工事・完工 1 件分（Construction 行）の表示。施工コスト(fee)を含む全項目を表示し、
// 編集トリガー（EditConstructionDialog, fee 含む）を見出し右に描画する。基本情報タブ
// 非 embedded（旧）と専用「施工コスト」タブの両方から再利用する。fee は原価系のため
// ProjectConstructionForDealerDto では存在せず（con.fee === undefined）、editable も
// null のため二次店では値も編集トリガーも一切描画されない。
function ConstructionBlock({
  con,
  customerId,
  editConstruction,
}: {
  con: AnyConstruction;
  customerId: string | null;
  editConstruction?: ProjectConstructionEditable;
}) {
  const f = p.fields;
  // fee キー自体が存在するのは wholesaler/saas のみ（二次店 DTO は物理除外）。
  const showFee = "fee" in con;
  return (
    <div className="rounded-md border border-hairline-light p-4">
      {customerId && editConstruction ? (
        <div className="mb-1 flex justify-end">
          <EditConstructionDialog customerId={customerId} initial={editConstruction} />
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <MetaItem
          label={f.completionStatus}
          value={p.constructionStatusLabels[con.status] ?? con.status}
        />
        <MetaItem
          label={f.surveyStatus}
          value={con.surveyStatus ? p.surveyStatusLabels[con.surveyStatus] ?? con.surveyStatus : null}
        />
        <MetaItem label={f.surveyAt} value={fmtDateTime(con.surveyDate)} />
        <MetaItem label={f.startedDate} value={fmtDate(con.startedDate)} />
        <MetaItem label={f.completedDate} value={fmtDate(con.completedDate)} />
        <MetaItem label={f.powerSaleStartDate} value={fmtDate(con.powerSaleStartDate)} />
        <MetaItem label={f.thankYouCallAt} value={fmtDateTime(con.thankYouCallAt)} />
        <MetaItem
          label={f.postCompletionStatus}
          value={p.postCompletionStatusLabels[con.postCompletionStatus] ?? con.postCompletionStatus}
        />
        <MetaItem
          label={f.defectStatus}
          value={p.defectStatusLabels[con.defectStatus] ?? con.defectStatus}
        />
        <MetaItem label={f.defectDetail} value={con.defectDetail} />
        <MetaItem label={f.vendorName} value={con.vendorName} />
        {showFee ? <MetaItem label={f.constructionFee} value={fmtYen(con.fee ?? null)} /> : null}
      </dl>
    </div>
  );
}

// 専用「施工コスト」タブ — 顧客に紐づく全契約の Construction を契約ごとに一覧表示し、
// 施工コスト(fee)を含む工事・完工項目を表示・編集（EditConstructionDialog）する。
// 契約/施工が無ければ空状態。二次店（editable=null・fee 物理除外）では編集も値も非表示。
export function ProjectConstructionList({
  data,
  editable = null,
}: {
  data: CustomerProjectInfoData;
  editable?: ProjectInfoEditable | null;
}) {
  const ct = labels.customer.detail.constructionTab;
  const contracts = data.contracts as AnyContract[];
  const constructions = data.constructions as AnyConstruction[];
  const customerId = editable?.customerId ?? null;
  const editConstructionById = new Map<string, ProjectConstructionEditable>(
    (editable?.constructions ?? []).map((c) => [c.constructionId, c]),
  );

  const byContract = new Map<string, AnyConstruction[]>();
  for (const con of constructions) {
    const list = byContract.get(con.contractId) ?? [];
    list.push(con);
    byContract.set(con.contractId, list);
  }
  const withConstruction = contracts.filter((c) => (byContract.get(c.contractId) ?? []).length > 0);

  if (withConstruction.length === 0) {
    return (
      <p className="rounded-md border border-hairline-light p-4 text-sm text-mute-light">
        {ct.empty}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {withConstruction.map((c, idx) => (
        <div key={c.contractId} className="space-y-3 rounded-md border border-hairline-light p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-mute-light">
            {`${ct.contractHeading} #${idx + 1}`}
          </h3>
          {(byContract.get(c.contractId) ?? []).map((con) => (
            <ConstructionBlock
              key={con.constructionId}
              con={con}
              customerId={customerId}
              editConstruction={editConstructionById.get(con.constructionId)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// 専用「ローン情報」タブ — 顧客に紐づく全契約のローン・団信を契約ごとに一覧表示。
// 契約が無ければ空状態。loanReviewStatus 含む編集は LoanBlock 内の EditContractDialog。
export function ProjectLoanInfoList({
  data,
  editable = null,
}: {
  data: CustomerProjectInfoData;
  editable?: ProjectInfoEditable | null;
}) {
  const lt = labels.customer.detail.loanTab;
  const contracts = data.contracts as AnyContract[];
  const customerId = editable?.customerId ?? null;
  const editContractById = new Map<string, ProjectContractEditable>(
    (editable?.contracts ?? []).map((ec) => [ec.contractId, ec]),
  );

  if (contracts.length === 0) {
    return (
      <p className="rounded-md border border-hairline-light p-4 text-sm text-mute-light">
        {lt.empty}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {contracts.map((c, idx) => (
        <div key={c.contractId} className="space-y-3 rounded-md border border-hairline-light p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-mute-light">
            {`${lt.contractHeading} #${idx + 1}`}
          </h3>
          <LoanBlock
            contract={c}
            customerId={customerId}
            editContract={editContractById.get(c.contractId)}
          />
        </div>
      ))}
    </div>
  );
}

// 専用「損益計算」タブ — 顧客に紐づく全契約の GrossProfit（売上・原価・粗利）を
// 契約ごとに 1 行で表で表示し、最終行に合計を出す。機密財務（売上・仕入値・原価・
// 粗利）のため卸業者/SaaS 限定。二次店 DTO には profitAndLoss キー自体が存在せず
// （物理除外）、page.tsx 側でも当該タブを描画しない二重ゲート。GrossProfit 未計算の
// 契約は profitAndLoss に含まれず、0 件なら空状態を表示する。
export function ProjectProfitList({ rows }: { rows: ProjectProfitDto[] }) {
  const pt = labels.customer.detail.profitTab;
  const col = pt.columns;

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-hairline-light p-4 text-sm text-mute-light">
        {pt.empty}
      </p>
    );
  }

  const totals = rows.reduce(
    (acc, r) => ({
      salesPrice: acc.salesPrice + r.salesPrice,
      purchaseTotal: acc.purchaseTotal + r.purchaseTotal,
      dealerTotal: acc.dealerTotal + r.dealerTotal,
      constructionFee: acc.constructionFee + r.constructionFee,
      otherCost: acc.otherCost + r.otherCost,
      discount: acc.discount + r.discount,
      projectProfit: acc.projectProfit + r.projectProfit,
      wholesaleProfit: acc.wholesaleProfit + r.wholesaleProfit,
    }),
    {
      salesPrice: 0,
      purchaseTotal: 0,
      dealerTotal: 0,
      constructionFee: 0,
      otherCost: 0,
      discount: 0,
      projectProfit: 0,
      wholesaleProfit: 0,
    },
  );
  // 合計の粗利率は合計売上に対する案件粗利の比（売上 0 のときは表示しない）。
  const totalProfitRate = totals.salesPrice > 0 ? totals.projectProfit / totals.salesPrice : null;

  const Th = ({
    children,
    numeric = true,
  }: {
    children: React.ReactNode;
    numeric?: boolean;
  }) => (
    <th
      scope="col"
      className={[
        "whitespace-nowrap px-3 py-2 text-xs font-semibold text-mute-light",
        numeric ? "text-right" : "text-left",
      ].join(" ")}
    >
      {children}
    </th>
  );

  return (
    <div className="overflow-x-auto rounded-md border border-hairline-light">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-hairline-light bg-surface-soft/40">
            <Th numeric={false}>{col.contract}</Th>
            <Th numeric={false}>{col.contractDate}</Th>
            <Th>{col.salesPrice}</Th>
            <Th>{col.purchaseTotal}</Th>
            <Th>{col.dealerTotal}</Th>
            <Th>{col.constructionFee}</Th>
            <Th>{col.otherCost}</Th>
            <Th>{col.discount}</Th>
            <Th>{col.projectProfit}</Th>
            <Th>{col.wholesaleProfit}</Th>
            <Th>{col.profitRate}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr
              key={r.contractId}
              className="border-b border-hairline-light last:border-b-0"
            >
              <td className="whitespace-nowrap px-3 py-2 text-ink">{`${pt.contractHeading} #${idx + 1}`}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums text-body-light">
                {fmtDate(r.contractDate)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink">
                {fmtYen(r.salesPrice)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-body-light">
                {fmtYen(r.purchaseTotal)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-body-light">
                {fmtYen(r.dealerTotal)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-body-light">
                {fmtYen(r.constructionFee)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-body-light">
                {fmtYen(r.otherCost)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-body-light">
                {fmtYen(r.discount)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-ink">
                {fmtYen(r.projectProfit)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink">
                {fmtYen(r.wholesaleProfit)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink">
                {fmtPercent(r.profitRate)}
              </td>
            </tr>
          ))}
        </tbody>
        {rows.length > 1 ? (
          <tfoot>
            <tr className="border-t-2 border-hairline-light bg-surface-soft/60 font-semibold">
              <td className="whitespace-nowrap px-3 py-2 text-ink" colSpan={2}>
                {pt.totalRow}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink">
                {fmtYen(totals.salesPrice)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink">
                {fmtYen(totals.purchaseTotal)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink">
                {fmtYen(totals.dealerTotal)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink">
                {fmtYen(totals.constructionFee)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink">
                {fmtYen(totals.otherCost)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink">
                {fmtYen(totals.discount)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink">
                {fmtYen(totals.projectProfit)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink">
                {fmtYen(totals.wholesaleProfit)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink">
                {fmtPercent(totalProfitRate)}
              </td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

// 契約・金額（金額サマリ）+ 各契約（1:N）の契約日・金額・支払・設備明細 + 認定・設備を
// 1 つの面に集約した、契約予定情報の単一ソース。契約状況タブ（editable・編集可）と
// 基本情報タブの「契約予定情報」（readOnly・pull 表示）の両方から再利用する。readOnly の
// ときは編集トリガー（鉛筆）を一切描画しない（編集面は契約状況タブに集約）。
export function ProjectContractList({
  data,
  editable = null,
  readOnly = false,
}: {
  data: CustomerProjectInfoData;
  editable?: ProjectInfoEditable | null;
  readOnly?: boolean;
}) {
  const f = p.fields;
  const contracts = data.contracts as AnyContract[];
  // readOnly では編集トリガーを描画しないため customerId/editable 引き当ては無効化する。
  const customerId = readOnly ? null : editable?.customerId ?? null;

  const editContractById = new Map<string, ProjectContractEditable>(
    (readOnly ? [] : editable?.contracts ?? []).map((ec) => [ec.contractId, ec]),
  );
  const editApplicationById = new Map<string, ProjectApplicationEditable>(
    (readOnly ? [] : editable?.applications ?? []).map((a) => [a.applicationId, a]),
  );
  function editEquipmentById(contractId: string, equipmentId: string): ProjectEquipmentEditable | null {
    if (readOnly || !editable) return null;
    return (editable.equipmentByContract[contractId] ?? []).find((e) => e.id === equipmentId) ?? null;
  }

  return (
    <div className="space-y-6">
      {/* 契約・金額（金額サマリ） */}
      <Section title={p.sections.contract}>
        <MetaItem label={f.contractAmount} value={fmtYen(data.financials.contractAmount)} />
        <MetaItem label={f.proposalAmount} value={fmtYen(data.financials.proposedAmount)} />
        <MetaItem label={f.incentiveGrossProfit} value={fmtYen(data.financials.incentiveGrossProfit)} />
        <MetaItem label={f.incentiveAmount} value={fmtYen(data.financials.incentiveAmount)} />
      </Section>

      {/* 契約（1:N。各契約に金額・支払・設備明細を展開） */}
      {contracts.length === 0 ? (
        <p className="rounded-md border border-hairline-light p-4 text-sm text-mute-light">
          {p.noContract}
        </p>
      ) : (
        contracts.map((c, idx) => {
          const ec = editContractById.get(c.contractId);
          return (
            <div key={c.contractId} className="space-y-4 rounded-md border border-hairline-light p-4">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-mute-light">
                  {`${p.sections.contract} #${idx + 1}`}
                </h3>
                {customerId && ec ? <EditContractDialog customerId={customerId} initial={ec} /> : null}
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                <MetaItem label={f.contractDate} value={fmtDate(c.contractDate)} />
                <MetaItem label={f.proposalAmount} value={fmtYen(c.proposedAmount)} />
                <MetaItem label={f.contractAmount} value={fmtYen(c.contractAmount)} />
                <MetaItem label={f.paymentCount} value={c.paymentCount != null ? `${c.paymentCount} 回` : null} />
                <MetaItem
                  label={f.paymentStatus}
                  value={c.paymentStatus ? p.paymentStatusLabels[c.paymentStatus] ?? c.paymentStatus : null}
                />
                <MetaItem label={f.depositDate} value={fmtDate(c.depositDate)} />
                <MetaItem label={f.dealerPayoutDate} value={fmtDate(c.dealerPayoutDate)} />
                <MetaItem label={f.equipmentId} value={c.equipmentSerialId} />
                <div className="min-w-0">
                  <dt className="text-[11px] text-mute-light">{f.contractDocsUrl}</dt>
                  <dd className="mt-0.5 text-sm font-medium">
                    {c.docsUrl ? (
                      <a
                        href={c.docsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                      >
                        {p.openDocs}
                        <ExternalLink className="size-3.5" />
                      </a>
                    ) : (
                      <span className="text-ink">{EMPTY}</span>
                    )}
                  </dd>
                </div>
              </dl>

              {/* 設備明細 */}
              <div>
                <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-mute-light">
                  {p.sections.equipment}
                </h4>
                <EquipmentGrid
                  equipment={c.equipment}
                  editSlotFor={
                    customerId
                      ? (item, title) => {
                          if (!item.id) return null;
                          const ee = editEquipmentById(c.contractId, item.id);
                          return ee ? (
                            <EditEquipmentDialog customerId={customerId} initial={ee} title={title} />
                          ) : null;
                        }
                      : undefined
                  }
                />
              </div>
            </div>
          );
        })
      )}

      {/* 認定・設備（申請） */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mute-light">
          {p.sections.certification}
        </h3>
        {data.applications.length === 0 ? (
          <p className="rounded-md border border-hairline-light p-4 text-sm text-mute-light">
            {p.noApplication}
          </p>
        ) : (
          <div className="space-y-3">
            {data.applications.map((a) => {
              const eap = editApplicationById.get(a.applicationId);
              return (
                <div key={a.applicationId} className="rounded-md border border-hairline-light p-4">
                  {customerId && eap ? (
                    <div className="mb-1 flex justify-end">
                      <EditApplicationDialog customerId={customerId} initial={eap} />
                    </div>
                  ) : null}
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                    <MetaItem
                      label={f.certApplicationStatus}
                      value={p.applicationStatusLabels[a.status] ?? a.status}
                    />
                    <MetaItem label={f.applicationType} value={a.type} />
                    <MetaItem label={f.submittedDate} value={fmtDate(a.submittedDate)} />
                    <MetaItem label={f.approvedDate} value={fmtDate(a.approvedDate)} />
                    <MetaItem label={f.grantedAmount} value={fmtYen(a.grantedAmount)} />
                  </dl>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export function CustomerProjectInfo({
  data,
  embedded = false,
  editable = null,
  contractReadOnly = false,
}: {
  data: CustomerProjectInfoData;
  // 「基本情報」タブ内に埋め込むとき (embedded) は、上段の編集カード（担当者 /
  // 顧客基本情報 / メモ）と重複する 基本情報・体制・備考 セクションを抑制し、
  // 案件固有（ヒアリング / 概況 等）のみを表示する。契約・金額/契約明細/認定は
  // ProjectContractList へ集約（契約状況タブが単一の編集面）。
  embedded?: boolean;
  // F-062 編集用の生値 + ID 一式。customer.update 権限保持者（卸業者/SaaS）のみ非 null。
  // null（二次店・read-only）では編集トリガーを一切描画しない。
  editable?: ProjectInfoEditable | null;
  // 契約・金額/契約明細/認定を読み取り専用で表示する（基本情報タブの「契約予定情報」
  // pull 表示。編集トリガーは契約状況タブに集約し、ここには出さない）。
  contractReadOnly?: boolean;
}) {
  const f = p.fields;
  const constructions = data.constructions as AnyConstruction[];
  const customerId = editable?.customerId ?? null;

  // contractId → 編集用 raw 値の引き当て（表示 DTO と editable は同順だが id で堅牢に対応）。
  const editContractById = new Map<string, ProjectContractEditable>(
    (editable?.contracts ?? []).map((ec) => [ec.contractId, ec]),
  );
  const editConstructionById = new Map<string, ProjectConstructionEditable>(
    (editable?.constructions ?? []).map((c) => [c.constructionId, c]),
  );

  return (
    <div className="space-y-6">
      {/* 基本情報（埋め込み時は上段の編集カードと重複するため非表示） */}
      {!embedded && (
        <Section title={p.sections.basic}>
          <MetaItem label={f.name} value={data.basic.name} />
          <MetaItem label={f.kana} value={data.basic.kana} />
          <MetaItem label={f.birthDate} value={data.basic.birthDate} />
          <MetaItem label={f.age} value={fmtAge(data.basic.age)} />
          <MetaItem label={f.phone} value={data.basic.phone} />
          <MetaItem label={f.email} value={data.basic.email} />
          <MetaItem label={f.postalCode} value={data.basic.postalCode} />
          <MetaItem label={f.addressLine} value={data.basic.address} />
          <MetaItem label={f.buildYear} value={fmtDate(data.basic.buildYear)} />
        </Section>
      )}

      {/* 体制（埋め込み時は上段の担当者カードと重複するため非表示） */}
      {!embedded && (
        <Section title={p.sections.organization}>
          <MetaItem label={f.apptGetter} value={data.organization.tossUpUserName} />
          <MetaItem label={f.salesRep} value={data.organization.closingUserName} />
          <MetaItem label={f.tossDept} value={data.organization.tossDept} />
          <MetaItem label={f.belongDept} value={data.organization.belongDept} />
        </Section>
      )}

      {/* 契約・金額/契約明細/認定（単一ソース。embedded（基本情報）では readOnly で pull 表示）。
          ローン・団信は embedded 時は専用「ローン情報」タブに集約するため非 embedded のみ展開。 */}
      <ProjectContractList data={data} editable={editable} readOnly={contractReadOnly} />

      {/* 非 embedded（フル表示）でのみローン・団信を契約ごとに展開。 */}
      {!embedded
        ? (data.contracts as AnyContract[]).map((c, idx) => (
            <div key={`loan-${c.contractId}`} className="rounded-md border border-hairline-light p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mute-light">
                {`${p.sections.loan} #${idx + 1}`}
              </h3>
              <LoanBlock
                contract={c}
                customerId={customerId}
                editContract={editContractById.get(c.contractId)}
              />
            </div>
          ))
        : null}

      {/* 工事・完工（施工コスト含む。embedded 時は専用「施工コスト」タブに集約するため抑制） */}
      {!embedded ? (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mute-light">
            {p.sections.construction}
          </h3>
          {constructions.length === 0 ? (
            <p className="rounded-md border border-hairline-light p-4 text-sm text-mute-light">
              {p.noConstruction}
            </p>
          ) : (
            <div className="space-y-3">
              {constructions.map((con) => (
                <ConstructionBlock
                  key={con.constructionId}
                  con={con}
                  customerId={customerId}
                  editConstruction={editConstructionById.get(con.constructionId)}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* ヒアリング（住環境・家族）— F-063。既設設備（現況）/ 家族属性 / 連絡先 / クロスセル候補 */}
      <HearingSection
        hearing={data.hearing}
        editSlot={
          customerId && editable ? (
            <EditHearingDialog customerId={customerId} initial={editable.hearing} />
          ) : null
        }
      />

      {/* 概況 */}
      <Section
        title={p.sections.overview}
        editSlot={
          customerId && editable ? (
            <EditOverviewDialog customerId={customerId} initial={editable.overview} />
          ) : null
        }
      >
        <MetaItem label={f.electricBill} value={data.overview.electricBill} />
        <MetaItem label={f.household} value={data.overview.household} />
        <MetaItem label={f.housingType} value={data.overview.housingType} />
        <MetaItem label={f.inflowRoute} value={data.overview.inflowRoute} />
        <MetaItem label={f.maekakuStatus} value={data.overview.maekakuStatus} />
      </Section>

      {/* コール状況（embedded 時は専用「コール状況」タブに集約するため抑制） */}
      {!embedded ? <ProjectCallStatusSection data={data} editable={editable} /> : null}

      {/* 備考（埋め込み時は上段のメモカードと重複するため非表示） */}
      {!embedded && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-mute-light">
            {p.sections.note}
          </h3>
          <p className="whitespace-pre-wrap rounded-md bg-surface-soft/60 p-3 text-sm leading-relaxed text-body-light">
            {data.note && data.note.length > 0 ? data.note : EMPTY}
          </p>
        </div>
      )}
    </div>
  );
}
