"use client";

// F-062 案件情報インライン編集ダイアログ群。CustomerProjectInfo（基本情報タブ統合
// ビュー）の各セクション見出しの右に出る鉛筆トリガー → Dialog でフォーム編集 →
// サーバーアクション保存 → toast + router.refresh()。
//
// 編集対象は既存列のみ。仕入値スナップショット（ContractItem.snapshot*）は扱わない。

import { LOAN_REVIEW_STATUS_VALUES } from "@solar/contracts";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { labels } from "@/lib/i18n/labels";

import {
  saveCustomerHearingAction,
  saveProjectApplicationAction,
  saveProjectCallStatusAction,
  saveProjectConstructionAction,
  saveProjectContractAction,
  saveProjectEquipmentAction,
  saveProjectOverviewAction,
} from "../actions";

import type {
  ProjectApplicationEditable,
  ProjectCallsEditable,
  ProjectConstructionEditable,
  ProjectContractEditable,
  ProjectEquipmentEditable,
  ProjectHearingEditable,
  ProjectOverviewEditable,
} from "@/lib/customer/get-project-info-editable";
import type { CallStatusValue, LoanReviewStatusValue } from "@solar/contracts";

const p = labels.customer.detail.projectInfo;
const ed = p.edit;
const f = p.fields;
const c = labels.common;

const FIELD =
  "h-9 w-full rounded-sm border border-hairline-light bg-white px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

// ISO → <input type="date"> 用 YYYY-MM-DD（ローカル日付）。
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// ISO → <input type="datetime-local"> 用 YYYY-MM-DDTHH:mm。
function toDateTimeInput(iso: string | null): string {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function numOrNull(s: string): number | null {
  if (!s.trim()) return null;
  const n = Math.floor(Number(s));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function strOrNull(s: string): string | null {
  return s.trim() ? s.trim() : null;
}

// 三値（有 / 無 / 未設定）プルダウンの共通値。
const BOOL_UNSET = "__unset__";
function boolToSelect(v: boolean | null): string {
  if (v == null) return BOOL_UNSET;
  return v ? "true" : "false";
}
function selectToBool(v: string): boolean | null {
  if (v === BOOL_UNSET) return null;
  return v === "true";
}

function EditTrigger({ label }: { label: string }) {
  return (
    <DialogTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-mute-light hover:text-ink"
        aria-label={label}
      >
        <Pencil className="size-4" />
      </Button>
    </DialogTrigger>
  );
}

function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function Footer({
  onSave,
  onCancel,
  pending,
}: {
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
        {ed.cancel}
      </Button>
      <Button type="button" onClick={onSave} disabled={pending}>
        {pending ? c.saving : ed.save}
      </Button>
    </DialogFooter>
  );
}

function useSaver(onDone: () => void) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function run(fn: () => Promise<unknown>) {
    start(async () => {
      try {
        await fn();
        toast.success(c.saved);
        onDone();
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }
  return { pending, run };
}

/* ── 概況（Customer 列） ── */
export function EditOverviewDialog({
  customerId,
  initial,
}: {
  customerId: string;
  initial: ProjectOverviewEditable;
}) {
  const [open, setOpen] = useState(false);
  const [electricBill, setElectricBill] = useState(initial.electricBill ?? "");
  const [household, setHousehold] = useState(initial.household ?? "");
  const [housingType, setHousingType] = useState(initial.housingType ?? "");
  const [inflowRoute, setInflowRoute] = useState(initial.inflowRoute ?? "");
  const [maekakuStatus, setMaekakuStatus] = useState(initial.maekakuStatus ?? "");
  const { pending, run } = useSaver(() => setOpen(false));

  function onOpenChange(next: boolean) {
    if (next) {
      setElectricBill(initial.electricBill ?? "");
      setHousehold(initial.household ?? "");
      setHousingType(initial.housingType ?? "");
      setInflowRoute(initial.inflowRoute ?? "");
      setMaekakuStatus(initial.maekakuStatus ?? "");
    }
    setOpen(next);
  }

  function save() {
    run(() =>
      saveProjectOverviewAction({
        customerId,
        electricBill: strOrNull(electricBill),
        household: strOrNull(household),
        housingType: strOrNull(housingType),
        inflowRoute:
          inflowRoute === ""
            ? null
            : (inflowRoute as "EVENT" | "OUTBOUND_CALL" | "DIRECT_VISIT"),
        maekakuStatus: strOrNull(maekakuStatus),
      }),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <EditTrigger label={ed.editOverview} />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{ed.editOverview}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <FormField label={f.electricBill} htmlFor="ov-electric">
            <Input id="ov-electric" value={electricBill} onChange={(e) => setElectricBill(e.target.value)} />
          </FormField>
          <FormField label={f.household} htmlFor="ov-household">
            <Input id="ov-household" value={household} onChange={(e) => setHousehold(e.target.value)} />
          </FormField>
          <FormField label={f.housingType} htmlFor="ov-housing">
            <Input id="ov-housing" value={housingType} onChange={(e) => setHousingType(e.target.value)} />
          </FormField>
          <FormField label={f.inflowRoute} htmlFor="ov-inflow">
            <select id="ov-inflow" className={FIELD} value={inflowRoute} onChange={(e) => setInflowRoute(e.target.value)}>
              <option value="">{ed.unset}</option>
              <option value="EVENT">{ed.inflowRouteLabels.EVENT}</option>
              <option value="OUTBOUND_CALL">{ed.inflowRouteLabels.OUTBOUND_CALL}</option>
              <option value="DIRECT_VISIT">{ed.inflowRouteLabels.DIRECT_VISIT}</option>
            </select>
          </FormField>
          <FormField label={f.maekakuStatus} htmlFor="ov-maekaku">
            <select id="ov-maekaku" className={FIELD} value={maekakuStatus} onChange={(e) => setMaekakuStatus(e.target.value)}>
              <option value="">{ed.unset}</option>
              <option value="pending">{ed.maekakuStatusLabels.pending}</option>
              <option value="done">{ed.maekakuStatusLabels.done}</option>
              <option value="unnecessary">{ed.maekakuStatusLabels.unnecessary}</option>
            </select>
          </FormField>
        </div>
        <Footer onSave={save} onCancel={() => setOpen(false)} pending={pending} />
      </DialogContent>
    </Dialog>
  );
}

/* ── コール状況（バッチ B・Customer 列）。マエカクステータスは概況側の所有のためここでは編集しない ── */
const CALL_STATUS_UNSET = "__unset__";

export function EditCallStatusDialog({
  customerId,
  initial,
}: {
  customerId: string;
  initial: ProjectCallsEditable;
}) {
  const cs = ed.callStatusLabels;
  const [open, setOpen] = useState(false);
  const [maekakuPreferredPhone, setMaekakuPreferredPhone] = useState(initial.maekakuPreferredPhone ?? "");
  const [postStatus, setPostStatus] = useState(initial.postCompletionCallStatus ?? CALL_STATUS_UNSET);
  const [postAt, setPostAt] = useState(toDateTimeInput(initial.postCompletionCallPreferredAt));
  const [loanStatus, setLoanStatus] = useState(initial.loanCompletionCallStatus ?? CALL_STATUS_UNSET);
  const [loanAt, setLoanAt] = useState(toDateTimeInput(initial.loanCompletionCallPreferredAt));
  const [generalTime, setGeneralTime] = useState(initial.generalCallPreferredTime ?? "");
  const { pending, run } = useSaver(() => setOpen(false));

  function reset() {
    setMaekakuPreferredPhone(initial.maekakuPreferredPhone ?? "");
    setPostStatus(initial.postCompletionCallStatus ?? CALL_STATUS_UNSET);
    setPostAt(toDateTimeInput(initial.postCompletionCallPreferredAt));
    setLoanStatus(initial.loanCompletionCallStatus ?? CALL_STATUS_UNSET);
    setLoanAt(toDateTimeInput(initial.loanCompletionCallPreferredAt));
    setGeneralTime(initial.generalCallPreferredTime ?? "");
  }

  function onOpenChange(next: boolean) {
    if (next) reset();
    setOpen(next);
  }

  function statusOrNull(v: string): CallStatusValue | null {
    return v === CALL_STATUS_UNSET ? null : (v as CallStatusValue);
  }

  function save() {
    run(() =>
      saveProjectCallStatusAction({
        customerId,
        maekakuPreferredPhone: strOrNull(maekakuPreferredPhone),
        postCompletionCallStatus: statusOrNull(postStatus),
        postCompletionCallPreferredAt: postAt ? new Date(postAt).toISOString() : null,
        loanCompletionCallStatus: statusOrNull(loanStatus),
        loanCompletionCallPreferredAt: loanAt ? new Date(loanAt).toISOString() : null,
        generalCallPreferredTime: strOrNull(generalTime),
      }),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <EditTrigger label={ed.editCallStatus} />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{ed.editCallStatus}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <FormField label={f.maekakuPreferredPhone} htmlFor="cl-maekaku-phone">
            <Input
              id="cl-maekaku-phone"
              type="tel"
              value={maekakuPreferredPhone}
              onChange={(e) => setMaekakuPreferredPhone(e.target.value)}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={f.postCompletionCallStatus} htmlFor="cl-post-status">
              <select id="cl-post-status" className={FIELD} value={postStatus} onChange={(e) => setPostStatus(e.target.value)}>
                <option value={CALL_STATUS_UNSET}>{ed.unset}</option>
                <option value="not_done">{cs.not_done}</option>
                <option value="done">{cs.done}</option>
                <option value="unnecessary">{cs.unnecessary}</option>
              </select>
            </FormField>
            <FormField label={f.postCompletionCallPreferredAt} htmlFor="cl-post-at">
              <input id="cl-post-at" type="datetime-local" className={FIELD} value={postAt} onChange={(e) => setPostAt(e.target.value)} />
            </FormField>
            <FormField label={f.loanCompletionCallStatus} htmlFor="cl-loan-status">
              <select id="cl-loan-status" className={FIELD} value={loanStatus} onChange={(e) => setLoanStatus(e.target.value)}>
                <option value={CALL_STATUS_UNSET}>{ed.unset}</option>
                <option value="not_done">{cs.not_done}</option>
                <option value="done">{cs.done}</option>
                <option value="unnecessary">{cs.unnecessary}</option>
              </select>
            </FormField>
            <FormField label={f.loanCompletionCallPreferredAt} htmlFor="cl-loan-at">
              <input id="cl-loan-at" type="datetime-local" className={FIELD} value={loanAt} onChange={(e) => setLoanAt(e.target.value)} />
            </FormField>
          </div>
          <FormField label={f.generalCallPreferredTime} htmlFor="cl-general">
            <Input id="cl-general" value={generalTime} onChange={(e) => setGeneralTime(e.target.value)} placeholder="例: 平日19:00以降" />
          </FormField>
        </div>
        <Footer onSave={save} onCancel={() => setOpen(false)} pending={pending} />
      </DialogContent>
    </Dialog>
  );
}

/* ── ヒアリング（Customer 列・既設設備は F-063 の保存に委譲。ここは家族属性 + 連絡先 + 提案商材） ── */
export function EditHearingDialog({
  customerId,
  initial,
}: {
  customerId: string;
  initial: ProjectHearingEditable;
}) {
  const h = p.hearing;
  const [open, setOpen] = useState(false);
  const [husbandAge, setHusbandAge] = useState(initial.husbandAge != null ? String(initial.husbandAge) : "");
  const [wifeAge, setWifeAge] = useState(initial.wifeAge != null ? String(initial.wifeAge) : "");
  const [childAge, setChildAge] = useState(initial.childAge != null ? String(initial.childAge) : "");
  const [household, setHousehold] = useState(initial.household ?? "");
  const [guideAttendee, setGuideAttendee] = useState(initial.guideAttendee ?? "");
  const [faceToFace, setFaceToFace] = useState(boolToSelect(initial.faceToFace));
  const [landlinePhone, setLandlinePhone] = useState(initial.landlinePhone ?? "");
  const [mobilePhone, setMobilePhone] = useState(initial.mobilePhone ?? "");
  const [proposedProduct, setProposedProduct] = useState(initial.proposedProduct ?? "");
  const { pending, run } = useSaver(() => setOpen(false));

  function onOpenChange(next: boolean) {
    if (next) {
      setHusbandAge(initial.husbandAge != null ? String(initial.husbandAge) : "");
      setWifeAge(initial.wifeAge != null ? String(initial.wifeAge) : "");
      setChildAge(initial.childAge != null ? String(initial.childAge) : "");
      setHousehold(initial.household ?? "");
      setGuideAttendee(initial.guideAttendee ?? "");
      setFaceToFace(boolToSelect(initial.faceToFace));
      setLandlinePhone(initial.landlinePhone ?? "");
      setMobilePhone(initial.mobilePhone ?? "");
      setProposedProduct(initial.proposedProduct ?? "");
    }
    setOpen(next);
  }

  function save() {
    run(() =>
      // F-063 と同じ保存面（Customer 列）。既設設備はここでは触らない（empty array で no-op）。
      saveCustomerHearingAction({
        customerId,
        husbandAge: numOrNull(husbandAge),
        wifeAge: numOrNull(wifeAge),
        childAge: numOrNull(childAge),
        household: strOrNull(household),
        guideAttendee:
          guideAttendee === ""
            ? null
            : (guideAttendee as "HUSBAND" | "WIFE" | "BOTH" | "OTHER"),
        faceToFace: selectToBool(faceToFace),
        landlinePhone: strOrNull(landlinePhone),
        mobilePhone: strOrNull(mobilePhone),
        proposedProduct: strOrNull(proposedProduct),
        existingEquipments: [],
      }),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <EditTrigger label={ed.editHearing} />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{ed.editHearing}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-mute-light">{h.familyTitle}</p>
          <div className="grid grid-cols-3 gap-3">
            <FormField label={h.husbandAge} htmlFor="hr-husband">
              <Input id="hr-husband" type="number" min={0} max={120} value={husbandAge} onChange={(e) => setHusbandAge(e.target.value)} />
            </FormField>
            <FormField label={h.wifeAge} htmlFor="hr-wife">
              <Input id="hr-wife" type="number" min={0} max={120} value={wifeAge} onChange={(e) => setWifeAge(e.target.value)} />
            </FormField>
            <FormField label={h.childAge} htmlFor="hr-child">
              <Input id="hr-child" type="number" min={0} max={120} value={childAge} onChange={(e) => setChildAge(e.target.value)} />
            </FormField>
          </div>
          <FormField label={h.household} htmlFor="hr-household">
            <Input id="hr-household" value={household} onChange={(e) => setHousehold(e.target.value)} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={h.guideAttendee} htmlFor="hr-guide">
              <select id="hr-guide" className={FIELD} value={guideAttendee} onChange={(e) => setGuideAttendee(e.target.value)}>
                <option value="">{ed.unset}</option>
                <option value="HUSBAND">{h.guideAttendeeLabels.HUSBAND}</option>
                <option value="WIFE">{h.guideAttendeeLabels.WIFE}</option>
                <option value="BOTH">{h.guideAttendeeLabels.BOTH}</option>
                <option value="OTHER">{h.guideAttendeeLabels.OTHER}</option>
              </select>
            </FormField>
            <FormField label={h.faceToFace} htmlFor="hr-face">
              <select id="hr-face" className={FIELD} value={faceToFace} onChange={(e) => setFaceToFace(e.target.value)}>
                <option value={BOOL_UNSET}>{ed.unset}</option>
                <option value="true">{ed.presence.true}</option>
                <option value="false">{ed.presence.false}</option>
              </select>
            </FormField>
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-mute-light">{ed.contactTitle}</p>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={h.landlinePhone} htmlFor="hr-landline">
              <Input id="hr-landline" type="tel" value={landlinePhone} onChange={(e) => setLandlinePhone(e.target.value)} />
            </FormField>
            <FormField label={h.mobilePhone} htmlFor="hr-mobile">
              <Input id="hr-mobile" type="tel" value={mobilePhone} onChange={(e) => setMobilePhone(e.target.value)} />
            </FormField>
          </div>
          <FormField label={h.proposedProduct} htmlFor="hr-product">
            <Input id="hr-product" value={proposedProduct} onChange={(e) => setProposedProduct(e.target.value)} />
          </FormField>
        </div>
        <Footer onSave={save} onCancel={() => setOpen(false)} pending={pending} />
      </DialogContent>
    </Dialog>
  );
}

/* ── 契約・金額・ローン（Contract + ContractPayment） ── */
export function EditContractDialog({
  customerId,
  initial,
}: {
  customerId: string;
  initial: ProjectContractEditable;
}) {
  const [open, setOpen] = useState(false);
  const [contractDate, setContractDate] = useState(toDateInput(initial.contractDate));
  const [contractAmount, setContractAmount] = useState(initial.contractAmount != null ? String(initial.contractAmount) : "");
  const [equipmentSerialId, setEquipmentSerialId] = useState(initial.equipmentSerialId ?? "");
  const [loanReviewCallAt, setLoanReviewCallAt] = useState(toDateTimeInput(initial.loanReviewCallAt));
  const [callStatus, setCallStatus] = useState(initial.callStatus);
  const [paymentCount, setPaymentCount] = useState(initial.paymentCount != null ? String(initial.paymentCount) : "");
  const [paymentStatus, setPaymentStatus] = useState(initial.paymentStatus ?? "UNPAID");
  const [depositDate, setDepositDate] = useState(toDateInput(initial.depositDate));
  const [dealerPayoutDate, setDealerPayoutDate] = useState(toDateInput(initial.dealerPayoutDate));
  const [loanCompany, setLoanCompany] = useState(initial.loanCompany ?? "");
  const [downPayment, setDownPayment] = useState(initial.downPayment != null ? String(initial.downPayment) : "");
  const [creditLifeInsurance, setCreditLifeInsurance] = useState(boolToSelect(initial.creditLifeInsurance));
  const [loanNote, setLoanNote] = useState(initial.loanNote ?? "");
  const [loanReviewStatus, setLoanReviewStatus] = useState(initial.loanReviewStatus ?? "");
  const { pending, run } = useSaver(() => setOpen(false));

  function reset() {
    setContractDate(toDateInput(initial.contractDate));
    setContractAmount(initial.contractAmount != null ? String(initial.contractAmount) : "");
    setEquipmentSerialId(initial.equipmentSerialId ?? "");
    setLoanReviewCallAt(toDateTimeInput(initial.loanReviewCallAt));
    setCallStatus(initial.callStatus);
    setPaymentCount(initial.paymentCount != null ? String(initial.paymentCount) : "");
    setPaymentStatus(initial.paymentStatus ?? "UNPAID");
    setDepositDate(toDateInput(initial.depositDate));
    setDealerPayoutDate(toDateInput(initial.dealerPayoutDate));
    setLoanCompany(initial.loanCompany ?? "");
    setDownPayment(initial.downPayment != null ? String(initial.downPayment) : "");
    setCreditLifeInsurance(boolToSelect(initial.creditLifeInsurance));
    setLoanNote(initial.loanNote ?? "");
    setLoanReviewStatus(initial.loanReviewStatus ?? "");
  }

  function onOpenChange(next: boolean) {
    if (next) reset();
    setOpen(next);
  }

  function save() {
    run(() =>
      saveProjectContractAction({
        customerId,
        contractId: initial.contractId,
        contractDate: contractDate || null,
        contractAmount: numOrNull(contractAmount),
        equipmentSerialId: strOrNull(equipmentSerialId),
        loanReviewCallAt: loanReviewCallAt ? new Date(loanReviewCallAt).toISOString() : null,
        callStatus: callStatus as "NONE" | "SCHEDULED" | "DONE" | "CALLBACK_WAIT" | "NG",
        paymentCount: numOrNull(paymentCount),
        paymentStatus: paymentStatus as "UNPAID" | "PARTIAL" | "PAID",
        depositDate: depositDate || null,
        dealerPayoutDate: dealerPayoutDate || null,
        loanCompany: strOrNull(loanCompany),
        downPayment: numOrNull(downPayment),
        creditLifeInsurance: selectToBool(creditLifeInsurance),
        loanNote: strOrNull(loanNote),
        loanReviewStatus: (loanReviewStatus || null) as LoanReviewStatusValue | null,
      }),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <EditTrigger label={ed.editContract} />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{ed.editContract}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <FormField label={f.contractDate} htmlFor="ct-date">
              <input id="ct-date" type="date" className={FIELD} value={contractDate} onChange={(e) => setContractDate(e.target.value)} />
            </FormField>
            <FormField label={f.contractAmount} htmlFor="ct-amount">
              <Input id="ct-amount" type="number" min={0} value={contractAmount} onChange={(e) => setContractAmount(e.target.value)} />
            </FormField>
            <FormField label={f.equipmentId} htmlFor="ct-serial">
              <Input id="ct-serial" value={equipmentSerialId} onChange={(e) => setEquipmentSerialId(e.target.value)} />
            </FormField>
            <FormField label={f.callStatus} htmlFor="ct-call">
              <select id="ct-call" className={FIELD} value={callStatus} onChange={(e) => setCallStatus(e.target.value)}>
                <option value="NONE">{p.callStatusLabels.NONE}</option>
                <option value="SCHEDULED">{p.callStatusLabels.SCHEDULED}</option>
                <option value="DONE">{p.callStatusLabels.DONE}</option>
                <option value="CALLBACK_WAIT">{p.callStatusLabels.CALLBACK_WAIT}</option>
                <option value="NG">{p.callStatusLabels.NG}</option>
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={f.paymentCount} htmlFor="ct-paycount">
              <Input id="ct-paycount" type="number" min={0} value={paymentCount} onChange={(e) => setPaymentCount(e.target.value)} />
            </FormField>
            <FormField label={f.paymentStatus} htmlFor="ct-paystatus">
              <select id="ct-paystatus" className={FIELD} value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}>
                <option value="UNPAID">{p.paymentStatusLabels.UNPAID}</option>
                <option value="PARTIAL">{p.paymentStatusLabels.PARTIAL}</option>
                <option value="PAID">{p.paymentStatusLabels.PAID}</option>
              </select>
            </FormField>
            <FormField label={f.depositDate} htmlFor="ct-deposit">
              <input id="ct-deposit" type="date" className={FIELD} value={depositDate} onChange={(e) => setDepositDate(e.target.value)} />
            </FormField>
            <FormField label={f.dealerPayoutDate} htmlFor="ct-payout">
              <input id="ct-payout" type="date" className={FIELD} value={dealerPayoutDate} onChange={(e) => setDealerPayoutDate(e.target.value)} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={f.loanReviewCallAt} htmlFor="ct-loancall">
              <input id="ct-loancall" type="datetime-local" className={FIELD} value={loanReviewCallAt} onChange={(e) => setLoanReviewCallAt(e.target.value)} />
            </FormField>
            <FormField label={f.loanCompany} htmlFor="ct-loanco">
              <Input id="ct-loanco" value={loanCompany} onChange={(e) => setLoanCompany(e.target.value)} />
            </FormField>
            <FormField label={f.downPayment} htmlFor="ct-down">
              <Input id="ct-down" type="number" min={0} value={downPayment} onChange={(e) => setDownPayment(e.target.value)} />
            </FormField>
            <FormField label={f.creditLife} htmlFor="ct-credit">
              <select id="ct-credit" className={FIELD} value={creditLifeInsurance} onChange={(e) => setCreditLifeInsurance(e.target.value)}>
                <option value={BOOL_UNSET}>{ed.unset}</option>
                <option value="true">{ed.presence.true}</option>
                <option value="false">{ed.presence.false}</option>
              </select>
            </FormField>
            <FormField label={f.loanReviewStatus} htmlFor="ct-loanreview">
              <select id="ct-loanreview" className={FIELD} value={loanReviewStatus} onChange={(e) => setLoanReviewStatus(e.target.value)}>
                <option value="">{ed.unset}</option>
                {LOAN_REVIEW_STATUS_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {p.loanReviewStatusLabels[v]}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <FormField label={f.loanNote} htmlFor="ct-loannote">
            <Textarea id="ct-loannote" rows={2} value={loanNote} onChange={(e) => setLoanNote(e.target.value)} />
          </FormField>
        </div>
        <Footer onSave={save} onCancel={() => setOpen(false)} pending={pending} />
      </DialogContent>
    </Dialog>
  );
}

/* ── 設備明細（ContractEquipment の非価格フィールドのみ） ── */
export function EditEquipmentDialog({
  customerId,
  initial,
  title,
}: {
  customerId: string;
  initial: ProjectEquipmentEditable;
  title: string;
}) {
  const e = p.equipment;
  const [open, setOpen] = useState(false);
  const [contracted, setContracted] = useState(initial.contracted);
  const [manufacturer, setManufacturer] = useState(initial.manufacturer ?? "");
  const [model, setModel] = useState(initial.model ?? "");
  const [capacity, setCapacity] = useState(initial.capacity ?? "");
  const [quantity, setQuantity] = useState(initial.quantity != null ? String(initial.quantity) : "");
  const [installLocation, setInstallLocation] = useState(initial.installLocation ?? "");
  const [introducedStatus, setIntroducedStatus] = useState(initial.introducedStatus ?? "");
  const [warrantyStandard, setWarrantyStandard] = useState(boolToSelect(initial.warrantyStandard));
  const [warrantyExtended, setWarrantyExtended] = useState(boolToSelect(initial.warrantyExtended));
  const [warrantyDisaster, setWarrantyDisaster] = useState(boolToSelect(initial.warrantyDisaster));
  const [detail, setDetail] = useState(initial.detail ?? "");
  const { pending, run } = useSaver(() => setOpen(false));

  function reset() {
    setContracted(initial.contracted);
    setManufacturer(initial.manufacturer ?? "");
    setModel(initial.model ?? "");
    setCapacity(initial.capacity ?? "");
    setQuantity(initial.quantity != null ? String(initial.quantity) : "");
    setInstallLocation(initial.installLocation ?? "");
    setIntroducedStatus(initial.introducedStatus ?? "");
    setWarrantyStandard(boolToSelect(initial.warrantyStandard));
    setWarrantyExtended(boolToSelect(initial.warrantyExtended));
    setWarrantyDisaster(boolToSelect(initial.warrantyDisaster));
    setDetail(initial.detail ?? "");
  }

  function onOpenChange(next: boolean) {
    if (next) reset();
    setOpen(next);
  }

  function save() {
    run(() =>
      saveProjectEquipmentAction({
        customerId,
        contractId: initial.contractId,
        equipmentId: initial.id,
        contracted,
        manufacturer: strOrNull(manufacturer),
        model: strOrNull(model),
        capacity: strOrNull(capacity),
        quantity: numOrNull(quantity),
        installLocation: strOrNull(installLocation),
        introducedStatus:
          introducedStatus === "" ? null : (introducedStatus as "NONE" | "EXISTING" | "NEW"),
        warrantyStandard: selectToBool(warrantyStandard),
        warrantyExtended: selectToBool(warrantyExtended),
        warrantyDisaster: selectToBool(warrantyDisaster),
        detail: strOrNull(detail),
      }),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <EditTrigger label={`${title} ${ed.editEquipment}`} />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {title} — {ed.editEquipment}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <FormField label={p.contracted} htmlFor="eq-contracted">
            <select id="eq-contracted" className={FIELD} value={contracted ? "true" : "false"} onChange={(ev) => setContracted(ev.target.value === "true")}>
              <option value="true">{p.contracted}</option>
              <option value="false">{p.notContracted}</option>
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={e.maker} htmlFor="eq-maker">
              <Input id="eq-maker" value={manufacturer} onChange={(ev) => setManufacturer(ev.target.value)} />
            </FormField>
            <FormField label={e.modelNo} htmlFor="eq-model">
              <Input id="eq-model" value={model} onChange={(ev) => setModel(ev.target.value)} />
            </FormField>
            <FormField label={e.capacity} htmlFor="eq-capacity">
              <Input id="eq-capacity" value={capacity} onChange={(ev) => setCapacity(ev.target.value)} />
            </FormField>
            <FormField label={e.count} htmlFor="eq-qty">
              <Input id="eq-qty" type="number" min={0} value={quantity} onChange={(ev) => setQuantity(ev.target.value)} />
            </FormField>
            <FormField label={e.location} htmlFor="eq-loc">
              <Input id="eq-loc" value={installLocation} onChange={(ev) => setInstallLocation(ev.target.value)} />
            </FormField>
            <FormField label={e.status} htmlFor="eq-intro">
              <select id="eq-intro" className={FIELD} value={introducedStatus} onChange={(ev) => setIntroducedStatus(ev.target.value)}>
                <option value="">{ed.unset}</option>
                <option value="NONE">{p.introStatusLabels.NONE}</option>
                <option value="EXISTING">{p.introStatusLabels.EXISTING}</option>
                <option value="NEW">{p.introStatusLabels.NEW}</option>
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <FormField label={e.totalWarranty} htmlFor="eq-wstd">
              <select id="eq-wstd" className={FIELD} value={warrantyStandard} onChange={(ev) => setWarrantyStandard(ev.target.value)}>
                <option value={BOOL_UNSET}>{ed.unset}</option>
                <option value="true">{ed.presence.true}</option>
                <option value="false">{ed.presence.false}</option>
              </select>
            </FormField>
            <FormField label={e.extWarranty} htmlFor="eq-wext">
              <select id="eq-wext" className={FIELD} value={warrantyExtended} onChange={(ev) => setWarrantyExtended(ev.target.value)}>
                <option value={BOOL_UNSET}>{ed.unset}</option>
                <option value="true">{ed.presence.true}</option>
                <option value="false">{ed.presence.false}</option>
              </select>
            </FormField>
            <FormField label={e.disasterWarranty} htmlFor="eq-wdis">
              <select id="eq-wdis" className={FIELD} value={warrantyDisaster} onChange={(ev) => setWarrantyDisaster(ev.target.value)}>
                <option value={BOOL_UNSET}>{ed.unset}</option>
                <option value="true">{ed.presence.true}</option>
                <option value="false">{ed.presence.false}</option>
              </select>
            </FormField>
          </div>
          <FormField label={e.detail} htmlFor="eq-detail">
            <Textarea id="eq-detail" rows={2} value={detail} onChange={(ev) => setDetail(ev.target.value)} />
          </FormField>
        </div>
        <Footer onSave={save} onCancel={() => setOpen(false)} pending={pending} />
      </DialogContent>
    </Dialog>
  );
}

/* ── 工事・完工（Construction + 親 Contract 列） ── */
export function EditConstructionDialog({
  customerId,
  initial,
}: {
  customerId: string;
  initial: ProjectConstructionEditable;
}) {
  const [open, setOpen] = useState(false);
  const [surveyDate, setSurveyDate] = useState(toDateTimeInput(initial.surveyDate));
  const [startedDate, setStartedDate] = useState(toDateInput(initial.startedDate));
  const [completedDate, setCompletedDate] = useState(toDateInput(initial.completedDate));
  const [powerSaleStartDate, setPowerSaleStartDate] = useState(toDateInput(initial.powerSaleStartDate));
  const [status, setStatus] = useState(initial.status);
  const [surveyStatus, setSurveyStatus] = useState(initial.surveyStatus ?? "");
  const [vendorName, setVendorName] = useState(initial.vendorName ?? "");
  const [fee, setFee] = useState(initial.fee != null ? String(initial.fee) : "");
  const [postCompletionStatus, setPostCompletionStatus] = useState(initial.postCompletionStatus);
  const [defectStatus, setDefectStatus] = useState(initial.defectStatus);
  const [defectDetail, setDefectDetail] = useState(initial.defectDetail ?? "");
  const [thankYouCallAt, setThankYouCallAt] = useState(toDateTimeInput(initial.thankYouCallAt));
  const { pending, run } = useSaver(() => setOpen(false));

  function reset() {
    setSurveyDate(toDateTimeInput(initial.surveyDate));
    setStartedDate(toDateInput(initial.startedDate));
    setCompletedDate(toDateInput(initial.completedDate));
    setPowerSaleStartDate(toDateInput(initial.powerSaleStartDate));
    setStatus(initial.status);
    setSurveyStatus(initial.surveyStatus ?? "");
    setVendorName(initial.vendorName ?? "");
    setFee(initial.fee != null ? String(initial.fee) : "");
    setPostCompletionStatus(initial.postCompletionStatus);
    setDefectStatus(initial.defectStatus);
    setDefectDetail(initial.defectDetail ?? "");
    setThankYouCallAt(toDateTimeInput(initial.thankYouCallAt));
  }

  function onOpenChange(next: boolean) {
    if (next) reset();
    setOpen(next);
  }

  function save() {
    run(() =>
      saveProjectConstructionAction({
        customerId,
        contractId: initial.contractId,
        constructionId: initial.constructionId,
        surveyDate: surveyDate ? new Date(surveyDate).toISOString() : null,
        startedDate: startedDate || null,
        completedDate: completedDate || null,
        powerSaleStartDate: powerSaleStartDate || null,
        status: status as
          | "REQUEST_PENDING"
          | "REQUESTED"
          | "SURVEYED"
          | "CONSTRUCTING"
          | "DONE"
          | "PAUSED",
        surveyStatus:
          surveyStatus === ""
            ? null
            : (surveyStatus as "not_surveyed" | "scheduled" | "surveyed"),
        vendorName: strOrNull(vendorName),
        fee: numOrNull(fee),
        postCompletionStatus: postCompletionStatus as "NONE" | "IN_PROGRESS" | "DONE",
        defectStatus: defectStatus as "NONE" | "OPEN" | "RESOLVED",
        defectDetail: strOrNull(defectDetail),
        thankYouCallAt: thankYouCallAt ? new Date(thankYouCallAt).toISOString() : null,
      }),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <EditTrigger label={ed.editConstruction} />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{ed.editConstruction}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <FormField label={f.completionStatus} htmlFor="cn-status">
              <select id="cn-status" className={FIELD} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="REQUEST_PENDING">{p.constructionStatusLabels.REQUEST_PENDING}</option>
                <option value="REQUESTED">{p.constructionStatusLabels.REQUESTED}</option>
                <option value="SURVEYED">{p.constructionStatusLabels.SURVEYED}</option>
                <option value="CONSTRUCTING">{p.constructionStatusLabels.CONSTRUCTING}</option>
                <option value="DONE">{p.constructionStatusLabels.DONE}</option>
                <option value="PAUSED">{p.constructionStatusLabels.PAUSED}</option>
              </select>
            </FormField>
            <FormField label={f.surveyStatus} htmlFor="cn-survey-status">
              <select id="cn-survey-status" className={FIELD} value={surveyStatus} onChange={(e) => setSurveyStatus(e.target.value)}>
                <option value="">{ed.unset}</option>
                <option value="not_surveyed">{p.surveyStatusLabels.not_surveyed}</option>
                <option value="scheduled">{p.surveyStatusLabels.scheduled}</option>
                <option value="surveyed">{p.surveyStatusLabels.surveyed}</option>
              </select>
            </FormField>
            <FormField label={f.vendorName} htmlFor="cn-vendor">
              <Input id="cn-vendor" value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
            </FormField>
            <FormField label={f.constructionFee} htmlFor="cn-fee">
              <Input id="cn-fee" type="number" inputMode="numeric" min={0} value={fee} onChange={(e) => setFee(e.target.value)} />
            </FormField>
            <FormField label={f.surveyAt} htmlFor="cn-survey">
              <input id="cn-survey" type="datetime-local" className={FIELD} value={surveyDate} onChange={(e) => setSurveyDate(e.target.value)} />
            </FormField>
            <FormField label={f.startedDate} htmlFor="cn-started">
              <input id="cn-started" type="date" className={FIELD} value={startedDate} onChange={(e) => setStartedDate(e.target.value)} />
            </FormField>
            <FormField label={f.completedDate} htmlFor="cn-completed">
              <input id="cn-completed" type="date" className={FIELD} value={completedDate} onChange={(e) => setCompletedDate(e.target.value)} />
            </FormField>
            <FormField label={f.powerSaleStartDate} htmlFor="cn-power">
              <input id="cn-power" type="date" className={FIELD} value={powerSaleStartDate} onChange={(e) => setPowerSaleStartDate(e.target.value)} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={f.postCompletionStatus} htmlFor="cn-post">
              <select id="cn-post" className={FIELD} value={postCompletionStatus} onChange={(e) => setPostCompletionStatus(e.target.value)}>
                <option value="NONE">{p.postCompletionStatusLabels.NONE}</option>
                <option value="IN_PROGRESS">{p.postCompletionStatusLabels.IN_PROGRESS}</option>
                <option value="DONE">{p.postCompletionStatusLabels.DONE}</option>
              </select>
            </FormField>
            <FormField label={f.defectStatus} htmlFor="cn-defect">
              <select id="cn-defect" className={FIELD} value={defectStatus} onChange={(e) => setDefectStatus(e.target.value)}>
                <option value="NONE">{p.defectStatusLabels.NONE}</option>
                <option value="OPEN">{p.defectStatusLabels.OPEN}</option>
                <option value="RESOLVED">{p.defectStatusLabels.RESOLVED}</option>
              </select>
            </FormField>
            <FormField label={f.thankYouCallAt} htmlFor="cn-thanks">
              <input id="cn-thanks" type="datetime-local" className={FIELD} value={thankYouCallAt} onChange={(e) => setThankYouCallAt(e.target.value)} />
            </FormField>
          </div>
          <FormField label={f.defectDetail} htmlFor="cn-defdetail">
            <Textarea id="cn-defdetail" rows={2} value={defectDetail} onChange={(e) => setDefectDetail(e.target.value)} />
          </FormField>
        </div>
        <Footer onSave={save} onCancel={() => setOpen(false)} pending={pending} />
      </DialogContent>
    </Dialog>
  );
}

/* ── 認定・設備（申請）（Application） ── */
export function EditApplicationDialog({
  customerId,
  initial,
}: {
  customerId: string;
  initial: ProjectApplicationEditable;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(initial.status);
  const [type, setType] = useState(initial.type ?? "");
  const [submittedDate, setSubmittedDate] = useState(toDateInput(initial.submittedDate));
  const [approvedDate, setApprovedDate] = useState(toDateInput(initial.approvedDate));
  const [grantedAmount, setGrantedAmount] = useState(initial.grantedAmount != null ? String(initial.grantedAmount) : "");
  const { pending, run } = useSaver(() => setOpen(false));

  function reset() {
    setStatus(initial.status);
    setType(initial.type ?? "");
    setSubmittedDate(toDateInput(initial.submittedDate));
    setApprovedDate(toDateInput(initial.approvedDate));
    setGrantedAmount(initial.grantedAmount != null ? String(initial.grantedAmount) : "");
  }

  function onOpenChange(next: boolean) {
    if (next) reset();
    setOpen(next);
  }

  function save() {
    run(() =>
      saveProjectApplicationAction({
        customerId,
        contractId: initial.contractId,
        applicationId: initial.applicationId,
        status: status as "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "CANCELLED",
        type: strOrNull(type),
        submittedDate: submittedDate || null,
        approvedDate: approvedDate || null,
        grantedAmount: numOrNull(grantedAmount),
      }),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <EditTrigger label={ed.editApplication} />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{ed.editApplication}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label={f.certApplicationStatus} htmlFor="ap-status">
              <select id="ap-status" className={FIELD} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="DRAFT">{p.applicationStatusLabels.DRAFT}</option>
                <option value="SUBMITTED">{p.applicationStatusLabels.SUBMITTED}</option>
                <option value="APPROVED">{p.applicationStatusLabels.APPROVED}</option>
                <option value="REJECTED">{p.applicationStatusLabels.REJECTED}</option>
                <option value="CANCELLED">{p.applicationStatusLabels.CANCELLED}</option>
              </select>
            </FormField>
            <FormField label={f.applicationType} htmlFor="ap-type">
              <Input id="ap-type" value={type} onChange={(e) => setType(e.target.value)} />
            </FormField>
            <FormField label={f.submittedDate} htmlFor="ap-submitted">
              <input id="ap-submitted" type="date" className={FIELD} value={submittedDate} onChange={(e) => setSubmittedDate(e.target.value)} />
            </FormField>
            <FormField label={f.approvedDate} htmlFor="ap-approved">
              <input id="ap-approved" type="date" className={FIELD} value={approvedDate} onChange={(e) => setApprovedDate(e.target.value)} />
            </FormField>
            <FormField label={f.grantedAmount} htmlFor="ap-granted">
              <Input id="ap-granted" type="number" min={0} value={grantedAmount} onChange={(e) => setGrantedAmount(e.target.value)} />
            </FormField>
          </div>
        </div>
        <Footer onSave={save} onCancel={() => setOpen(false)} pending={pending} />
      </DialogContent>
    </Dialog>
  );
}
