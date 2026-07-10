// 顧客詳細「案件情報」タブ（F-061 統合ビュー）。`getProjectInfo`（docs/05 §16.10）が
// 返す `ProjectInfoDto`（二次店は原価キー物理除外済の `ProjectInfoForDealerDto`）を
// 受け取り、9 カテゴリをカテゴリ別に閲覧表示する。読み取り専用（編集は F-062）。

import { deriveCrossSellBadges } from "@solar/contracts";

import { Badge } from "@/components/ui/badge";
import { labels } from "@/lib/i18n/labels";

import {
  AccessoryInlineEdit,
  AddAccessoryButton,
  AddApplicationButton,
  AddConstructionButton,
  AddContractButton,
  AddLoanReviewButton,
  ApplicationInlineEdit,
  ApplicationSubTabs,
  CallLogAddForm,
  CallLogDeleteButton,
  ConstructionInlineEdit,
  ConstructionSubTabs,
  ContractDetailInlineEdit,
  ContractSubTabs,
  EditConstructionDialog,
  EditEquipmentDialog,
  EquipmentInlineEdit,
  HearingInlineEdit,
  LoanCompletionCallInlineEdit,
  LoanReviewDefectAddForm,
  LoanReviewDefectList,
  LoanReviewInlineEdit,
  LoanReviewLogAddForm,
  LoanReviewLogList,
  LoanReviewSubTabs,
  MaekakuCallInlineEdit,
  PostCompletionCallInlineEdit,
  SpecialNoteInlineEdit,
  ThankYouCallInlineEdit,
} from "./project-info-edit";

import type {
  ProjectApplicationEditable,
  ProjectConstructionEditable,
  ProjectContractEditable,
  ProjectEquipmentEditable,
  ProjectInfoEditable,
  ProjectLoanReviewEditable,
} from "@/lib/customer/get-project-info-editable";
import type {
  EquipmentCategoryKey,
  EquipmentItemDto,
  ProjectApplicationDto,
  ProjectConstructionDto,
  ProjectContractDto,
  ProjectHearingDto,
  ProjectHearingForDealerDto,
  ProjectInfoDto,
  ProjectInfoForDealerDto,
  ProjectLoanReviewDto,
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
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
          <span aria-hidden className="h-3.5 w-0.5 rounded-full bg-primary" />
          {title}
        </h3>
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
          {/* 商材ごとの金額（顧客向け・原価ではない）を右揃えで先頭表示。 */}
          <div className="min-w-0">
            <dt className="text-[11px] text-mute-light">{e.amount}</dt>
            <dd className="mt-0.5 text-right text-sm font-semibold tabular-nums text-ink">
              {item.amount != null ? `¥${item.amount.toLocaleString("ja-JP")}` : EMPTY}
            </dd>
          </div>
          {rows.map((r) => (
            <MetaItem key={r.label} label={r.label} value={r.value} />
          ))}
        </dl>
      ) : null}
    </div>
  );
}

const e = p.equipment;

// 施工商材ライン（CONSTRUCTION）の表示行。契約上の施工金額・業者・内容。
// 施工状況タブの Construction（工事進捗・fee 原価）とは別概念。
function constructionRows(it: AnyEquipmentItem) {
  return [
    { label: e.vendor, value: it.manufacturer ?? EMPTY },
    { label: e.modelNo, value: it.model ?? EMPTY },
    { label: e.detail, value: it.detail ?? EMPTY },
  ];
}

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
    amount: null,
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

// 商材ライン（カテゴリ）の表示順・タイトル・行ビルダーの単一ソース。CONSTRUCTION
// （契約商材ラインとしての施工）を含む。EquipmentGrid（読み取り）と契約状況タブの
// インライン編集の両方がこの順序・タイトルを参照する。
const CATEGORY_META: {
  key: EquipmentCategoryKey;
  title: string;
  rows: (it: AnyEquipmentItem) => { label: string; value: string }[];
}[] = [
  { key: "PV", title: e.pv, rows: pvRows },
  { key: "BT", title: e.bt, rows: btRows },
  { key: "EQ", title: e.eq, rows: eqRows },
  { key: "IH", title: e.ih, rows: ihRows },
  { key: "AC", title: e.ac, rows: acRows },
  { key: "ACCESSORY", title: e.accessory, rows: accessoryRows },
  { key: "GIFT", title: e.gift, rows: giftRows },
  { key: "CONSTRUCTION", title: e.construction, rows: constructionRows },
];

function EquipmentGrid({
  equipment,
  editSlotFor,
}: {
  equipment: AnyEquipment;
  // 代表設備行（firstOrEmpty）に対する追加/編集トリガー。category と代表行 item
  // （空カテゴリは id=""）を受け取り、追加（item.id 無し）/ 編集（item.id 有り）を分岐する。
  editSlotFor?: (category: EquipmentCategoryKey, item: AnyEquipmentItem, title: string) => React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {CATEGORY_META.map(({ key, title, rows }) => {
        const item = firstOrEmpty(equipment[key]);
        return (
          <EquipmentCard
            key={key}
            title={title}
            item={item}
            rows={rows(item)}
            editSlot={editSlotFor?.(key, item, title)}
          />
        );
      })}
    </div>
  );
}

// 契約状況タブ専用: 商材ライン（PV/BT/付帯/施工）をカード内インラインで編集するグリッド。
// ポップアップ廃止。PV/BT/EQ/IH/AC/GIFT/施工は各カテゴリ代表 1 行を EquipmentInlineEdit で
// 直接編集する（contractId が null でも保存時にサーバーが最小契約を生成）。付帯商材
// （ACCESSORY）のみ複数行運用: 全行を AccessoryInlineEdit で個別編集 + 削除 + 追加（要件C）。
// accessoryRows は当該契約の ACCESSORY 全行（契約が無い場合は空・追加導線も非表示）。
// customer.update 権限保持者のみ描画。
function EquipmentInlineGrid({
  contractId,
  customerId,
  editFor,
  accessoryRows = [],
}: {
  contractId: string | null;
  customerId: string;
  // contractId × category 代表行の編集用 raw 値（無ければ null=新規）。
  editFor: (category: EquipmentCategoryKey) => ProjectEquipmentEditable | null;
  // 当該契約の ACCESSORY 全行（複数行）。
  accessoryRows?: ProjectEquipmentEditable[];
}) {
  const ct = labels.customer.detail.contractTab;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {CATEGORY_META.filter(({ key }) => key !== "ACCESSORY").map(({ key, title }) => (
          <EquipmentInlineEdit
            key={key}
            customerId={customerId}
            category={key}
            contractId={contractId}
            initial={editFor(key)}
            title={title}
          />
        ))}
      </div>

      {/* 付帯商材（ACCESSORY）— 複数行 + 追加（contractId 確定時のみ追加導線を出す）。 */}
      <div className="space-y-3 rounded-md border border-hairline-light p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink">{ct.accessoryTitle}</p>
          {contractId ? <AddAccessoryButton customerId={customerId} contractId={contractId} /> : null}
        </div>
        {contractId == null || accessoryRows.length === 0 ? (
          <p className="text-sm text-mute-light">{ct.accessoryEmpty}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {accessoryRows.map((row) => (
              <AccessoryInlineEdit
                key={row.id}
                customerId={customerId}
                contractId={contractId}
                initial={row}
              />
            ))}
          </div>
        )}
      </div>
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
  editForm,
}: {
  hearing: ProjectHearingDto | ProjectHearingForDealerDto;
  // 権限保持者には家族属性・連絡先のインライン編集フォームを渡す。null（読み取り専用/
  // 二次店）のときはマスク済みの表示 dl を出す。
  editForm?: React.ReactNode;
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

      {/* 家族属性・連絡先: 権限保持者はインライン編集フォーム、それ以外はマスク済み表示。 */}
      {editForm ? (
        editForm
      ) : (
        <>
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
        </>
      )}
    </section>
  );
}

// 現状情報（住環境ヒアリング）。基本情報タブの「現状情報」セクションから再利用する。
// ヒアリング(F-063: 既設設備/家族属性/連絡先)。概況は不要のため表示しない。
// editable 非 null（customer.update 権限）のとき家族属性・連絡先をカード内インライン編集
// （HearingInlineEdit）。null（二次店・read-only）はマスク済み表示。
export function ProjectCurrentStateInfo({
  data,
  editable = null,
}: {
  data: CustomerProjectInfoData;
  editable?: ProjectInfoEditable | null;
}) {
  const customerId = editable?.customerId ?? null;
  return (
    <HearingSection
      hearing={data.hearing}
      editForm={
        customerId && editable ? (
          <HearingInlineEdit customerId={customerId} initial={editable.hearing} />
        ) : null
      }
    />
  );
}

function callPhaseLabel(code: string | null): string | null {
  if (!code) return null;
  return p.callPhaseStatusLabels[code] ?? code;
}

// 過去コール履歴（CustomerCallLog・架電日時/対応者/メモ）。canEdit のとき追加フォーム +
// 各行に削除ボタンを描画する。read-only（二次店等）では一覧のみ。calledAt 降順（ローダ整形済）。
function CallLogList({
  data,
  customerId,
  users,
}: {
  data: CustomerProjectInfoData;
  customerId: string | null;
  users: { id: string; name: string }[];
}) {
  const s = p.callSections;
  const logs = data.calls.callLogs;
  const canEdit = customerId != null;
  return (
    <div className="mt-4 space-y-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-mute-light">
        {s.callLogTitle}
      </h4>
      {canEdit ? <CallLogAddForm customerId={customerId!} users={users} /> : null}
      {logs.length === 0 ? (
        <p className="text-sm text-mute-light">{s.callLogEmpty}</p>
      ) : (
        <ul className="space-y-2">
          {logs.map((l) => (
            <li
              key={l.id}
              className="rounded-md border border-hairline-light bg-surface-soft p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                  <MetaItem label={s.callLogCalledAt} value={fmtDateTime(l.calledAt)} />
                  <MetaItem label={s.callLogHandler} value={l.handlerName} />
                  <MetaItem label={s.callLogNote} value={l.note} />
                </dl>
                {canEdit ? (
                  <CallLogDeleteButton customerId={customerId!} callLogId={l.id} />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// コールタブ 4 セクション（マエカク / サンキュー / ローン審査完了 / 施工完了）。
// 最上部に固定/携帯電話番号（マスク済み）を表示。マエカクコール section には次回アポ
// （日程/担当者/アクション）を read-only 表示（編集は商談タブ）+ 過去コール履歴を併設。
// editable 非 null（customer.update 権限）のとき各セクションをインライン編集、null は read-only。
export function ProjectCallStatusSection({
  data,
  editable = null,
  users = [],
}: {
  data: CustomerProjectInfoData;
  editable?: ProjectInfoEditable | null;
  // 過去コール履歴の対応者 select 用（自社社員）。read-only 時は不要。
  users?: { id: string; name: string }[];
}) {
  const f = p.fields;
  const s = p.callSections;
  const customerId = editable?.customerId ?? null;
  const canEdit = customerId != null && editable != null;
  const calls = data.calls;

  return (
    <div className="space-y-6">
      {/* 電話番号ヘッダ（コール業務向けにタブ上部へ固定/携帯電話を表示。マスク済み・全幅） */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mute-light">
          {s.phoneHeaderTitle}
        </h3>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-md border border-hairline-light bg-surface-soft/40 p-4 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-[11px] text-mute-light">{s.landlinePhone}</dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums text-ink">
              {calls.landlinePhone && calls.landlinePhone.length > 0 ? calls.landlinePhone : EMPTY}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] text-mute-light">{s.mobilePhone}</dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums text-ink">
              {calls.mobilePhone && calls.mobilePhone.length > 0 ? calls.mobilePhone : EMPTY}
            </dd>
          </div>
        </dl>
      </section>

      {/* 本体 2 カラム（lg〜）: 左=コール履歴（主領域） / 右=各ステータス（コンパクト）。モバイルは縦積み。 */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        {/* 左カラム: コール履歴（CustomerCallLog） */}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mute-light">
            {s.historyColumnTitle}
          </h3>
          <div className="rounded-md border border-hairline-light p-4">
            <CallLogList data={data} customerId={canEdit ? customerId : null} users={users} />
          </div>
        </section>

        {/* 右カラム: 各ステータス（コンパクト・縦積み） */}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mute-light">
            {s.statusColumnTitle}
          </h3>
          <div className="space-y-3">
            {/* マエカクコール（編集 + 次回アポ担当者/次回アクション read-only） */}
            <CompactCallBlock title={s.maekakuCall}>
              {canEdit ? (
                <MaekakuCallInlineEdit customerId={customerId!} initial={editable!.calls} />
              ) : (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  <MetaItem
                    label={f.callMaekakuStatus}
                    value={
                      calls.maekakuStatus
                        ? p.maekakuStatusDisplayLabels[calls.maekakuStatus] ?? calls.maekakuStatus
                        : null
                    }
                  />
                  <MetaItem
                    label={f.maekakuPreferredAt}
                    value={fmtDateTime(calls.maekakuPreferredAt)}
                  />
                  <MetaItem label={f.maekakuCallNote} value={calls.maekakuCallNote} />
                </dl>
              )}

              {/* 次回アポ担当者 / 次回アクション（+ 日程）。編集は商談タブのみ・ここは read-only。 */}
              <div className="mt-3 border-t border-hairline-light pt-3">
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  <MetaItem
                    label={s.nextAppointmentAt}
                    value={fmtDateTime(calls.nextAppointmentAt)}
                  />
                  <MetaItem
                    label={s.nextAppointmentAssignee}
                    value={calls.nextAppointmentAssigneeName}
                  />
                  <MetaItem label={s.nextAction} value={calls.nextAction} />
                </dl>
              </div>
            </CompactCallBlock>

            {/* サンキューコール */}
            <CompactCallBlock title={s.thankYouCall}>
              {canEdit ? (
                <ThankYouCallInlineEdit customerId={customerId!} initial={editable!.calls} />
              ) : (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  <MetaItem
                    label={f.thankYouCallStatus}
                    value={callPhaseLabel(calls.thankYouCallStatus)}
                  />
                  <MetaItem
                    label={f.thankYouCallPreferredAt}
                    value={fmtDateTime(calls.thankYouCallPreferredAt)}
                  />
                  <MetaItem label={f.thankYouCallNote} value={calls.thankYouCallNote} />
                </dl>
              )}
            </CompactCallBlock>

            {/* ローン審査完了コール */}
            <CompactCallBlock title={s.loanCompletionCall}>
              {canEdit ? (
                <LoanCompletionCallInlineEdit customerId={customerId!} initial={editable!.calls} />
              ) : (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  <MetaItem
                    label={f.loanCompletionCallStatus}
                    value={callPhaseLabel(calls.loanCompletionCallStatus)}
                  />
                  <MetaItem
                    label={f.loanCompletionCallPreferredAt}
                    value={fmtDateTime(calls.loanCompletionCallPreferredAt)}
                  />
                  <MetaItem label={f.loanCompletionCallNote} value={calls.loanCompletionCallNote} />
                </dl>
              )}
            </CompactCallBlock>

            {/* 施工完了コール */}
            <CompactCallBlock title={s.postCompletionCall}>
              {canEdit ? (
                <PostCompletionCallInlineEdit customerId={customerId!} initial={editable!.calls} />
              ) : (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  <MetaItem
                    label={f.postCompletionCallStatus}
                    value={callPhaseLabel(calls.postCompletionCallStatus)}
                  />
                  <MetaItem
                    label={f.postCompletionCallPreferredAt}
                    value={fmtDateTime(calls.postCompletionCallPreferredAt)}
                  />
                  <MetaItem label={f.postCompletionCallNote} value={calls.postCompletionCallNote} />
                </dl>
              )}
            </CompactCallBlock>
          </div>
        </section>
      </div>
    </div>
  );
}

// 右カラム用コンパクトステータスブロック。小さめ見出し + 詰めた余白の枠。
// 子は read-only MetaItem 群 or インライン編集フォーム（編集 UI はそのまま流用）。
function CompactCallBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-hairline-light p-3">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-mute-light">
        {title}
      </h4>
      {children}
    </div>
  );
}

// ローン審査 1 件分（独立 LoanReview）の read-only 表示。editable が渡らない（二次店/
// 閲覧のみ）場合に使う。サマリ項目のみ（不備は審査履歴ログ単位の一覧で別途表示）。
function LoanReviewReadonly({ review }: { review: ProjectLoanReviewDto }) {
  const lt = labels.customer.detail.loanTab;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      <MetaItem label={lt.status} value={lt.statusLabels[review.status] ?? review.status} />
      <MetaItem label={lt.loanCompany} value={review.loanCompany} />
      <MetaItem label={lt.downPayment} value={fmtYen(review.downPayment)} />
      <MetaItem label={lt.creditLife} value={fmtBool(review.creditLifeInsurance)} />
      <MetaItem label={lt.reviewedAt} value={fmtDate(review.reviewedAt)} />
      <MetaItem label={lt.note} value={review.note} />
    </dl>
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
  const cs = p.constructionSections;
  // fee キー自体が存在するのは wholesaler/saas のみ（二次店 DTO は物理除外）。
  const showFee = "fee" in con;
  const sectionHeading = "mb-2 text-[11px] font-semibold uppercase tracking-wide text-mute-light";
  const grid = "grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3";
  return (
    <div className="space-y-5 rounded-md border border-hairline-light p-4">
      {customerId && editConstruction ? (
        <div className="flex justify-end">
          <EditConstructionDialog customerId={customerId} initial={editConstruction} />
        </div>
      ) : null}

      {/* サマリ — 完工ステータス / 事業者名 / 完工予定日(=工事予定日終了)。 */}
      <section>
        <h4 className={sectionHeading}>{cs.summary}</h4>
        <dl className={grid}>
          <MetaItem
            label={f.completionStatus}
            value={p.constructionStatusLabels[con.status] ?? con.status}
          />
          <MetaItem label={f.businessName} value={con.vendorName} />
          <MetaItem label={f.plannedCompletionDate} value={fmtDate(con.plannedEndDate)} />
        </dl>
      </section>

      {/* スケジュール — 現地調査日 / 工事予定日(開始・終了) / 工事日(開始・終了)。 */}
      <section>
        <h4 className={sectionHeading}>{cs.schedule}</h4>
        <dl className={grid}>
          <MetaItem label={f.surveyDateField} value={fmtDate(con.surveyDate)} />
          <MetaItem label={f.plannedStartDate} value={fmtDate(con.plannedStartDate)} />
          <MetaItem label={f.plannedEndDate} value={fmtDate(con.plannedEndDate)} />
          <MetaItem label={f.constructionStartDate} value={fmtDate(con.startedDate)} />
          <MetaItem label={f.constructionEndDate} value={fmtDate(con.completedDate)} />
        </dl>
      </section>

      {/* コスト — 施工業者(=事業者名) / 金額(fee)。原価系のため二次店では fee 非表示。 */}
      <section>
        <h4 className={sectionHeading}>{cs.cost}</h4>
        <dl className={grid}>
          <MetaItem label={f.installerName} value={con.vendorName} />
          {showFee ? <MetaItem label={f.amount} value={fmtYen(con.fee ?? null)} /> : null}
        </dl>
      </section>
    </div>
  );
}

// 専用「施工コスト」タブ — 顧客に紐づく全契約の Construction を表示し、施工コスト(fee)を
// 含む工事・完工項目を表示・編集（EditConstructionDialog）する。編集可能（customer.update）
// のときは施工レコードごとのサブタブ（施工 #1/#2…・右クリックで改名）。二次店/read-only
// （editable=null・fee 物理除外）では従来の契約ごとカード縦積み。施工が無ければ空状態。
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

  // 編集可能で施工 0 件のときは空メッセージ + 「施工を追加」。追加でサーバーが Construction を
  // （必要なら最小契約も）生成し、サブタブが現れる（ローン審査タブと同じ挙動）。
  if (constructions.length === 0) {
    if (customerId) {
      return (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-mute-light">{ct.emptyEditable}</p>
          <AddConstructionButton customerId={customerId} />
        </div>
      );
    }
    return (
      <p className="rounded-md border border-hairline-light p-4 text-sm text-mute-light">
        {ct.empty}
      </p>
    );
  }

  // 編集可能: 施工レコード 1 件 = 1 サブタブ（フラット）。デフォルトは「施工 #N」、
  // tabLabel があればそれで上書き。右クリック改名（EditableTabTrigger）。
  if (customerId) {
    const tabs = constructions.map((con, idx) => {
      const edit = editConstructionById.get(con.constructionId);
      return {
        id: con.constructionId,
        label: con.tabLabel ?? `${ct.subtabHeading} #${idx + 1}`,
        rawLabel: con.tabLabel ?? null,
        content: edit ? (
          <ConstructionInlineEdit customerId={customerId} initial={edit} />
        ) : (
          <ConstructionBlock con={con} customerId={customerId} />
        ),
      };
    });
    return <ConstructionSubTabs customerId={customerId} tabs={tabs} />;
  }

  // 読み取り専用（二次店/閲覧）: 従来どおり契約ごとにカードを縦積み。
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

// 設置申請 1 件分（Application 行）の read-only 表示。二次店/閲覧のみで使う。
function ApplicationReadonly({ app }: { app: ProjectApplicationDto }) {
  const at = labels.customer.detail.applicationTab;
  const f = p.fields;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      <MetaItem label={at.status} value={at.statusLabels[app.status] ?? app.status} />
      <MetaItem label={f.applicationType} value={app.type} />
      <MetaItem label={f.submittedDate} value={fmtDate(app.submittedDate)} />
      <MetaItem label={f.approvedDate} value={fmtDate(app.approvedDate)} />
    </dl>
  );
}

// 専用「設置申請」タブ — 設置申請（Application）を申請ごとのサブタブ（申請 #1/#2…）で
// 表示・編集する（施工/ローン審査タブと同型）。編集可能（customer.update）のときは申請
// レコードごとのサブタブ（右クリックで改名・申請追加/削除導線つき）で各サブタブ内を
// ApplicationInlineEdit でインライン編集。申請 0 件は空状態 + 「申請を追加」。read-only
// （二次店/閲覧）では従来どおり申請ごとにカードを縦積み表示（read-only）。
export function ProjectApplicationList({
  data,
  editable = null,
}: {
  data: CustomerProjectInfoData;
  editable?: ProjectInfoEditable | null;
}) {
  const at = labels.customer.detail.applicationTab;
  const applications = data.applications;
  const customerId = editable?.customerId ?? null;
  const editApplicationById = new Map<string, ProjectApplicationEditable>(
    (editable?.applications ?? []).map((a) => [a.applicationId, a]),
  );

  // 編集可能で申請 0 件のときは空メッセージ + 「申請を追加」。追加でサーバーが Application を
  // （必要なら最小契約も）生成し、サブタブが現れる（施工/ローン審査タブと同じ挙動）。
  if (applications.length === 0) {
    if (customerId) {
      return (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-mute-light">{at.emptyEditable}</p>
          <AddApplicationButton customerId={customerId} />
        </div>
      );
    }
    return (
      <p className="rounded-md border border-hairline-light p-4 text-sm text-mute-light">
        {at.empty}
      </p>
    );
  }

  // 編集可能: 申請レコード 1 件 = 1 サブタブ（フラット）。デフォルトは「申請 #N」、
  // tabLabel があればそれで上書き。右クリック改名（EditableTabTrigger）。
  if (customerId) {
    const tabs = applications.map((app, idx) => {
      const edit = editApplicationById.get(app.applicationId);
      return {
        id: app.applicationId,
        label: app.tabLabel ?? `${at.subtabHeading} #${idx + 1}`,
        rawLabel: app.tabLabel ?? null,
        content: edit ? (
          <ApplicationInlineEdit customerId={customerId} initial={edit} />
        ) : (
          <ApplicationReadonly app={app} />
        ),
      };
    });
    return <ApplicationSubTabs customerId={customerId} tabs={tabs} />;
  }

  // 読み取り専用（二次店/閲覧）: 申請ごとにカードを縦積み。
  return (
    <div className="space-y-4">
      {applications.map((app, idx) => (
        <div key={app.applicationId} className="space-y-3 rounded-md border border-hairline-light p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-mute-light">
            {app.tabLabel ?? `${at.subtabHeading} #${idx + 1}`}
          </h3>
          <ApplicationReadonly app={app} />
        </div>
      ))}
    </div>
  );
}

// 専用「ローン審査」タブ — 独立 LoanReview を審査ごとのサブタブ（ローン審査 #1/#2…）で
// 表示・編集する（契約タブと同型）。各審査サブタブ内: インライン編集（editable 時）/
// read-only（二次店・閲覧のみ）+ 過去の審査履歴ログ一覧 + 追加フォーム。審査 0 件は
// 空状態 + 「審査を追加」。customerId は editable 由来（編集導線は customer.update のみ）。
export function ProjectLoanInfoList({
  data,
  editable = null,
  users = [],
}: {
  data: CustomerProjectInfoData;
  editable?: ProjectInfoEditable | null;
  users?: { id: string; name: string }[];
}) {
  const lt = labels.customer.detail.loanTab;
  const reviews = data.loanReviews;
  const customerId = editable?.customerId ?? null;
  const editReviewById = new Map<string, ProjectLoanReviewEditable>(
    (editable?.loanReviews ?? []).map((r) => [r.loanReviewId, r]),
  );

  if (reviews.length === 0) {
    if (customerId) {
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-mute-light">{lt.empty}</p>
            <AddLoanReviewButton customerId={customerId} />
          </div>
        </div>
      );
    }
    return (
      <p className="rounded-md border border-hairline-light p-4 text-sm text-mute-light">
        {lt.empty}
      </p>
    );
  }

  const tabs = reviews.map((review, idx) => {
    const edit = editReviewById.get(review.loanReviewId);
    return {
      id: review.loanReviewId,
      label: review.tabLabel ?? `${lt.subtabHeading} #${idx + 1}`,
      rawLabel: review.tabLabel ?? null,
      content: (
        <div className="space-y-5">
          <div>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-mute-light">
              {lt.summaryTitle}
            </h4>
            {customerId && edit ? (
              <LoanReviewInlineEdit customerId={customerId} initial={edit} />
            ) : (
              <LoanReviewReadonly review={review} />
            )}
          </div>
          <div>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-mute-light">
              {lt.defectTitle}
            </h4>
            <div className="space-y-3">
              <LoanReviewDefectList
                customerId={customerId}
                loanReviewId={review.loanReviewId}
                logs={review.logs}
              />
              {customerId ? (
                <LoanReviewDefectAddForm
                  customerId={customerId}
                  loanReviewId={review.loanReviewId}
                  users={users}
                />
              ) : null}
            </div>
          </div>
          <div>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-mute-light">
              {lt.historyTitle}
            </h4>
            <div className="space-y-3">
              {customerId ? (
                <>
                  <LoanReviewLogList
                    customerId={customerId}
                    loanReviewId={review.loanReviewId}
                    logs={review.logs}
                  />
                  <LoanReviewLogAddForm customerId={customerId} loanReviewId={review.loanReviewId} />
                </>
              ) : review.logs.length === 0 ? (
                <p className="text-sm text-mute-light">{lt.historyEmpty}</p>
              ) : (
                <ul className="divide-y divide-hairline-light">
                  {review.logs.map((log) => (
                    <li key={log.id} className="flex items-center gap-2 py-2 text-sm text-ink">
                      <span className="tabular-nums">
                        {fmtDate(log.reviewedAt)}
                      </span>
                      <span className="rounded-sm bg-surface-soft px-1.5 py-0.5 text-xs font-medium">
                        {lt.resultLabels[log.result] ?? log.result}
                      </span>
                      {log.note ? <span className="text-xs text-mute-light">{log.note}</span> : null}
                      {log.defectContent ? (
                        <span className="text-xs text-amber-700">
                          {lt.logDefectContent}：{log.defectContent}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ),
    };
  });

  // 編集可能（customer.update）のときはサブタブ client ラッパー（審査追加/削除導線つき）。
  if (customerId) {
    return <LoanReviewSubTabs customerId={customerId} tabs={tabs} />;
  }
  // 二次店・閲覧のみのときは追加/削除導線を出さず、審査ごとにカードで縦積み表示。
  return (
    <div className="space-y-4">
      {tabs.map((t) => (
        <div key={t.id} className="space-y-3 rounded-md border border-hairline-light p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-mute-light">
            {t.label}
          </h3>
          {t.content}
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
  inlineEquipment = false,
}: {
  data: CustomerProjectInfoData;
  editable?: ProjectInfoEditable | null;
  readOnly?: boolean;
  // 契約状況タブ: 商材ライン（PV/BT/付帯/施工）をポップアップではなくカード内インライン
  // 編集で描画する。基本情報タブ（readOnly）では false（読み取りカードのまま）。
  inlineEquipment?: boolean;
}) {
  const f = p.fields;
  const ct = labels.customer.detail.contractTab;
  const contracts = data.contracts as AnyContract[];
  // readOnly では編集トリガーを描画しないため customerId/editable 引き当ては無効化する。
  const customerId = readOnly ? null : editable?.customerId ?? null;
  // インライン編集は権限保持者（customerId 非 null）かつ inlineEquipment 指定時のみ。
  const useInline = inlineEquipment && !!customerId;

  // contractId × category の代表編集行を引き当てる（インライン編集の初期値）。
  function inlineEditFor(contractId: string | null) {
    return (category: EquipmentCategoryKey): ProjectEquipmentEditable | null => {
      if (!editable || !contractId) return null;
      return (
        (editable.equipmentByContract[contractId] ?? []).find((e) => e.category === category) ?? null
      );
    };
  }

  const editContractById = new Map<string, ProjectContractEditable>(
    (readOnly ? [] : editable?.contracts ?? []).map((ec) => [ec.contractId, ec]),
  );
  function editEquipmentById(contractId: string, equipmentId: string): ProjectEquipmentEditable | null {
    if (readOnly || !editable) return null;
    return (editable.equipmentByContract[contractId] ?? []).find((e) => e.id === equipmentId) ?? null;
  }
  // 設備カードの追加/編集トリガー（権限保持者のみ）。空カテゴリ（item.id 無し）は追加、
  // 既存行は編集。contractId が null（契約 0 件）でも追加でき、保存時にサーバーが契約を生成する。
  function equipmentEditSlot(
    contractId: string | null,
    category: EquipmentCategoryKey,
    item: AnyEquipmentItem,
    title: string,
  ): React.ReactNode {
    if (!customerId) return null;
    const ee = item.id && contractId ? editEquipmentById(contractId, item.id) : null;
    return (
      <EditEquipmentDialog
        customerId={customerId}
        category={category}
        contractId={contractId}
        initial={ee}
        title={title}
      />
    );
  }

  // 当該契約の ACCESSORY 全行（複数行運用）。
  function accessoryRowsFor(contractId: string): ProjectEquipmentEditable[] {
    if (!editable) return [];
    return (editable.equipmentByContract[contractId] ?? []).filter((e) => e.category === "ACCESSORY");
  }

  // 1 契約分の詳細（契約日/金額=合計/支払/シリアル/契約書類）+ 商材ライン。サブタブ
  // （useInline）と非インライン（readOnly カード）の両方から再利用する。
  function ContractDetailBody({ c }: { c: AnyContract }) {
    const ec = editContractById.get(c.contractId);
    return (
      <div className="space-y-4">
        {/* 契約サマリ。権限保持者（customerId かつ editable 有）はカード内インライン編集、
            readOnly/二次店は read-only dl。ローン情報・契約一式URL はここには出さない。 */}
        {customerId && ec ? (
          <ContractDetailInlineEdit
            customerId={customerId}
            initial={ec}
            contractAmount={c.contractAmount}
          />
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            <MetaItem label={f.contractDate} value={fmtDate(c.contractDate)} />
            {/* 契約金額は商材ライン合計（read-only・自動計算／要件B）。 */}
            <MetaItem label={ct.contractAmountAuto} value={fmtYen(c.contractAmount)} />
            <MetaItem label={f.paymentCount} value={c.paymentCount != null ? `${c.paymentCount} 回` : null} />
            <MetaItem
              label={f.paymentStatus}
              value={c.paymentStatus ? p.paymentStatusLabels[c.paymentStatus] ?? c.paymentStatus : null}
            />
            <MetaItem label={f.depositDate} value={fmtDate(c.depositDate)} />
            <MetaItem label={f.equipmentId} value={c.equipmentSerialId} />
          </dl>
        )}

        {/* 商材ライン（PV/BT/付帯[複数]/施工）。契約状況タブはカード内インライン編集、
            基本情報タブ（readOnly）は読み取りカード。 */}
        <div>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-mute-light">
            {useInline ? ct.equipmentTitle : p.sections.equipment}
          </h4>
          {useInline ? (
            <EquipmentInlineGrid
              contractId={c.contractId}
              customerId={customerId!}
              editFor={inlineEditFor(c.contractId)}
              accessoryRows={accessoryRowsFor(c.contractId)}
            />
          ) : (
            <EquipmentGrid
              equipment={c.equipment}
              editSlotFor={
                customerId
                  ? (category, item, title) => equipmentEditSlot(c.contractId, category, item, title)
                  : undefined
              }
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 契約・金額（金額サマリ・全契約合計）。ご提案金額・インセンティブ額・粗利は
          契約内容には表示しない（粗利は損益計算タブに集約）。 */}
      <Section title={p.sections.contract}>
        <MetaItem label={f.contractAmount} value={fmtYen(data.financials.contractAmount)} />
      </Section>

      {/* 契約（1:N）。契約状況タブ（useInline）では契約ごとのサブタブ + 「契約を追加」。
          契約 0 件でも、権限保持者には設備の追加導線を出し、保存時にサーバーが最小契約を
          生成する。基本情報タブ（readOnly）は従来どおり契約カードを縦に並べる。 */}
      {contracts.length === 0 ? (
        customerId && useInline ? (
          // 契約 0 件のとき（ローン審査タブと同じ挙動）。タブは出さず、空メッセージ＋
          // 「契約を追加」のみ。追加を押すとサーバーが契約 #1 を生成しサブタブが現れる。
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-mute-light">{ct.empty}</p>
            <AddContractButton customerId={customerId} />
          </div>
        ) : (
          <p className="rounded-md border border-hairline-light p-4 text-sm text-mute-light">
            {p.noContract}
          </p>
        )
      ) : useInline ? (
        // 契約サブタブ（契約 #1 / #2 …）。各サブタブにその契約の詳細 + 商材ライン。
        // ヘッダ右に「契約を追加」+「契約を削除」（アクティブ契約対象）を並置（client）。
        <ContractSubTabs
          customerId={customerId!}
          tabs={contracts.map((c, idx) => ({
            id: c.contractId,
            label: c.tabLabel ?? `${ct.subtabHeading} #${idx + 1}`,
            rawLabel: c.tabLabel ?? null,
            content: <ContractDetailBody c={c} />,
          }))}
        />
      ) : (
        contracts.map((c, idx) => (
          <div key={c.contractId} className="space-y-4 rounded-md border border-hairline-light p-4">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-mute-light">
                {`${p.sections.contract} #${idx + 1}`}
              </h3>
            </div>
            <ContractDetailBody c={c} />
          </div>
        ))
      )}

      {/* 特記事項（フリーテキストメモ）。権限保持者はインライン textarea 編集、
          readOnly/二次店はテキスト表示（空なら空状態文）。 */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mute-light">
          {p.sections.specialNote}
        </h3>
        {customerId && editable ? (
          <SpecialNoteInlineEdit
            customerId={customerId}
            initial={{ specialNote: editable.specialNote }}
          />
        ) : data.specialNote && data.specialNote.length > 0 ? (
          <p className="whitespace-pre-wrap rounded-md border border-hairline-light p-4 text-sm text-ink">
            {data.specialNote}
          </p>
        ) : (
          <p className="rounded-md border border-hairline-light p-4 text-sm text-mute-light">
            {p.specialNoteEmpty}
          </p>
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
          ローン審査は独立 LoanReview エンティティの専用「ローン審査」タブに集約（ProjectLoanInfoList）。 */}
      <ProjectContractList data={data} editable={editable} readOnly={contractReadOnly} />

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

      {/* ヒアリング（住環境・家族）+ 概況 — F-063。いずれも「現状情報」であり、
          embedded（基本情報タブ）では現状情報セクションの ProjectCurrentStateInfo に
          集約するため抑制する。非 embedded（フル表示）でのみ展開。 */}
      {!embedded ? <ProjectCurrentStateInfo data={data} editable={editable} /> : null}

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
