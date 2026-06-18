// 顧客詳細「案件情報」タブ（F-061 統合ビュー）。`getProjectInfo`（docs/05 §16.10）が
// 返す `ProjectInfoDto`（二次店は原価キー物理除外済の `ProjectInfoForDealerDto`）を
// 受け取り、9 カテゴリをカテゴリ別に閲覧表示する。読み取り専用（編集は F-062）。

import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { labels } from "@/lib/i18n/labels";
import { deriveCrossSellBadges } from "@solar/contracts";

import type {
  EquipmentCategoryKey,
  EquipmentItemDto,
  ProjectConstructionDto,
  ProjectContractDto,
  ProjectHearingDto,
  ProjectHearingForDealerDto,
  ProjectInfoDto,
  ProjectInfoForDealerDto,
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mute-light">{title}</h3>
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
}: {
  title: string;
  item: AnyEquipmentItem;
  rows: { label: string; value: string }[];
}) {
  return (
    <div className="rounded-md border border-hairline-light p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <Badge variant={item.contracted ? "success" : "secondary"}>
          {item.contracted ? p.contracted : p.notContracted}
        </Badge>
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

function EquipmentGrid({ equipment }: { equipment: AnyEquipment }) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <EquipmentCard title={e.pv} item={firstOrEmpty(equipment.PV)} rows={pvRows(firstOrEmpty(equipment.PV))} />
      <EquipmentCard title={e.bt} item={firstOrEmpty(equipment.BT)} rows={btRows(firstOrEmpty(equipment.BT))} />
      <EquipmentCard title={e.eq} item={firstOrEmpty(equipment.EQ)} rows={eqRows(firstOrEmpty(equipment.EQ))} />
      <EquipmentCard title={e.ih} item={firstOrEmpty(equipment.IH)} rows={ihRows(firstOrEmpty(equipment.IH))} />
      <EquipmentCard title={e.ac} item={firstOrEmpty(equipment.AC)} rows={acRows(firstOrEmpty(equipment.AC))} />
      <EquipmentCard
        title={e.accessory}
        item={firstOrEmpty(equipment.ACCESSORY)}
        rows={accessoryRows(firstOrEmpty(equipment.ACCESSORY))}
      />
      <EquipmentCard
        title={e.gift}
        item={firstOrEmpty(equipment.GIFT)}
        rows={giftRows(firstOrEmpty(equipment.GIFT))}
      />
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

function HearingSection({
  hearing,
}: {
  hearing: ProjectHearingDto | ProjectHearingForDealerDto;
}) {
  const badges = deriveCrossSellBadges(hearing.existingEquipments);
  const guide = hearing.guideAttendee ? h.guideAttendeeLabels[hearing.guideAttendee] ?? null : null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-mute-light">{h.title}</h3>
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

export function CustomerProjectInfo({
  data,
  embedded = false,
}: {
  data: CustomerProjectInfoData;
  // 「基本情報」タブ内に埋め込むとき (embedded) は、上段の編集カード（担当者 /
  // 顧客基本情報 / メモ）と重複する 基本情報・体制・備考 セクションを抑制し、
  // 案件固有（契約・金額 / 契約明細 / 工事・完工 / 認定・設備 / 概況）のみを表示する。
  embedded?: boolean;
}) {
  const f = p.fields;
  const contracts = data.contracts as AnyContract[];
  const constructions = data.constructions as AnyConstruction[];

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

      {/* 契約・金額（金額サマリ） */}
      <Section title={p.sections.contract}>
        <MetaItem label={f.contractAmount} value={fmtYen(data.financials.contractAmount)} />
        <MetaItem label={f.proposalAmount} value={fmtYen(data.financials.proposedAmount)} />
        <MetaItem label={f.incentiveGrossProfit} value={fmtYen(data.financials.incentiveGrossProfit)} />
        <MetaItem label={f.incentiveAmount} value={fmtYen(data.financials.incentiveAmount)} />
      </Section>

      {/* 契約タブ（1:N。各契約に金額・ローン・設備明細を展開） */}
      {contracts.length === 0 ? (
        <p className="rounded-md border border-hairline-light p-4 text-sm text-mute-light">
          {p.noContract}
        </p>
      ) : (
        contracts.map((c, idx) => (
          <div key={c.contractId} className="space-y-4 rounded-md border border-hairline-light p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-mute-light">
              {`${p.sections.contract} #${idx + 1}`}
            </h3>
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

            {/* ローン・団信 */}
            <div>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-mute-light">
                {p.sections.loan}
              </h4>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                <MetaItem label={f.loanReviewCallAt} value={fmtDateTime(c.loanReviewCallAt)} />
                <MetaItem label={f.loanCompany} value={c.loanCompany} />
                <MetaItem label={f.downPayment} value={fmtYen(c.downPayment)} />
                <MetaItem label={f.creditLife} value={fmtBool(c.creditLifeInsurance)} />
                <MetaItem
                  label={f.callStatus}
                  value={p.callStatusLabels[c.callStatus] ?? c.callStatus}
                />
                <MetaItem label={f.loanNote} value={c.loanNote} />
              </dl>
            </div>

            {/* 設備明細 */}
            <div>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-mute-light">
                {p.sections.equipment}
              </h4>
              <EquipmentGrid equipment={c.equipment} />
            </div>
          </div>
        ))
      )}

      {/* 工事・完工（全 Construction 行） */}
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
              <dl
                key={con.constructionId}
                className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-hairline-light p-4 sm:grid-cols-3"
              >
                <MetaItem
                  label={f.completionStatus}
                  value={p.constructionStatusLabels[con.status] ?? con.status}
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
              </dl>
            ))}
          </div>
        )}
      </section>

      {/* 認定・設備 */}
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
            {data.applications.map((a) => (
              <dl
                key={a.applicationId}
                className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-hairline-light p-4 sm:grid-cols-3"
              >
                <MetaItem
                  label={f.certApplicationStatus}
                  value={p.applicationStatusLabels[a.status] ?? a.status}
                />
                <MetaItem label={f.applicationType} value={a.type} />
                <MetaItem label={f.submittedDate} value={fmtDate(a.submittedDate)} />
                <MetaItem label={f.approvedDate} value={fmtDate(a.approvedDate)} />
                <MetaItem label={f.grantedAmount} value={fmtYen(a.grantedAmount)} />
              </dl>
            ))}
          </div>
        )}
      </section>

      {/* ヒアリング（住環境・家族）— F-063。既設設備（現況）/ 家族属性 / 連絡先 / クロスセル候補 */}
      <HearingSection hearing={data.hearing} />

      {/* 概況 */}
      <Section title={p.sections.overview}>
        <MetaItem label={f.electricBill} value={data.overview.electricBill} />
        <MetaItem label={f.household} value={data.overview.household} />
        <MetaItem label={f.housingType} value={data.overview.housingType} />
        <MetaItem label={f.inflowRoute} value={data.overview.inflowRoute} />
        <MetaItem label={f.maekakuStatus} value={data.overview.maekakuStatus} />
      </Section>

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
