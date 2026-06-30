"use client";

// F-062 案件情報インライン編集ダイアログ群。CustomerProjectInfo（基本情報タブ統合
// ビュー）の各セクション見出しの右に出る鉛筆トリガー → Dialog でフォーム編集 →
// サーバーアクション保存 → toast + router.refresh()。
//
// 編集対象は既存列のみ。仕入値スナップショット（ContractItem.snapshot*）は扱わない。

import {
  LOAN_REVIEW_RESULT_VALUES,
  LOAN_REVIEW_STATUS_VALUES,
} from "@solar/contracts";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { labels } from "@/lib/i18n/labels";
import { cn } from "@/lib/utils";

import {
  createContractAction,
  createCustomerCallLogAction,
  createLoanReviewAction,
  createLoanReviewLogAction,
  deleteContractAction,
  deleteContractEquipmentAction,
  deleteCustomerCallLogAction,
  deleteLoanReviewAction,
  deleteLoanReviewLogAction,
  saveCustomerHearingAction,
  saveLoanReviewAction,
  saveProjectCallStatusAction,
  saveProjectConstructionAction,
  saveProjectContractAction,
  saveProjectContractEquipmentAction,
  saveProjectOverviewAction,
  setLoanReviewLogDefectResolvedAction,
  updateCustomerAction,
} from "../actions";

import type {
  ProjectCallsEditable,
  ProjectConstructionEditable,
  ProjectContractEditable,
  ProjectEquipmentEditable,
  ProjectHearingEditable,
  ProjectLoanReviewEditable,
  ProjectOverviewEditable,
} from "@/lib/customer/get-project-info-editable";
import type {
  CallStatusValue,
  EquipmentCategoryValue,
  LoanReviewResultValue,
  LoanReviewStatusValue,
} from "@solar/contracts";
import type { ProjectLoanReviewLogDto } from "@solar/contracts/dto/project-info";

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

// 金額入力。内部 state は raw な数字文字列（呼び出し側は従来どおり numOrNull で円整数化）。
// 表示は ¥ + 3 桁カンマ区切り（fmtYen と整合）。fill('350000') のような数字入力も
// 非数字 strip を経て 350000 として扱う。
function formatYenInput(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  return `¥${Number(digits).toLocaleString("ja-JP")}`;
}

function MoneyInput({
  id,
  value,
  onChange,
  className,
}: {
  id: string;
  value: string;
  onChange: (raw: string) => void;
  className?: string;
}) {
  return (
    <Input
      id={id}
      type="text"
      inputMode="numeric"
      value={formatYenInput(value)}
      onChange={(ev) => onChange(ev.target.value.replace(/[^\d]/g, ""))}
      placeholder="¥0"
      className={cn("text-right tabular-nums", className)}
    />
  );
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

function EditTrigger({ label, mode = "edit" }: { label: string; mode?: "edit" | "add" }) {
  return (
    <DialogTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-mute-light hover:text-ink"
        aria-label={label}
      >
        {mode === "add" ? <Plus className="size-4" /> : <Pencil className="size-4" />}
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

/* ── コールタブ 4 セクション（Customer 列）。各セクションをカード内インライン編集。 ── */
const CALL_STATUS_UNSET = "__unset__";

// 保存/キャンセルフッタ（インライン版・dirty 連動）。
function InlineFooter({
  onSave,
  onCancel,
  pending,
  dirty,
}: {
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
  dirty: boolean;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={pending || !dirty}>
        {ed.cancel}
      </Button>
      <Button type="button" size="sm" onClick={onSave} disabled={pending || !dirty}>
        {pending ? c.saving : ed.save}
      </Button>
    </div>
  );
}

function callStatusOrNull(v: string): CallStatusValue | null {
  return v === CALL_STATUS_UNSET ? null : (v as CallStatusValue);
}

// CALL_STATUS_VALUES の select（サンキュー/ローン審査完了/施工完了で共用）。
function CallStatusSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const cs = ed.callStatusLabels;
  return (
    <select id={id} className={FIELD} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value={CALL_STATUS_UNSET}>{ed.unset}</option>
      <option value="not_done">{cs.not_done}</option>
      <option value="done">{cs.done}</option>
      <option value="unnecessary">{cs.unnecessary}</option>
    </select>
  );
}

/* マエカクコール（ステータス maekakuStatus + 希望日時 maekakuPreferredAt 共用列 + メモ）。
   マエカク希望電話は廃止（コールタブ上部に固定/携帯電話を表示）。 */
export function MaekakuCallInlineEdit({
  customerId,
  initial,
}: {
  customerId: string;
  initial: ProjectCallsEditable;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(initial.maekakuStatus ?? "");
  const [preferredAt, setPreferredAt] = useState(toDateTimeInput(initial.maekakuPreferredAt));
  const [note, setNote] = useState(initial.maekakuCallNote ?? "");

  const initStatus = initial.maekakuStatus ?? "";
  const initAt = toDateTimeInput(initial.maekakuPreferredAt);
  const dirty =
    status !== initStatus || preferredAt !== initAt || note !== (initial.maekakuCallNote ?? "");

  function reset() {
    setStatus(initStatus);
    setPreferredAt(initAt);
    setNote(initial.maekakuCallNote ?? "");
  }

  function onSave() {
    start(async () => {
      try {
        await saveProjectCallStatusAction({
          customerId,
          maekakuStatus: status === "" ? null : (status as "pending" | "done" | "unnecessary"),
          maekakuPreferredAt: preferredAt ? new Date(preferredAt).toISOString() : null,
          maekakuCallNote: strOrNull(note),
        });
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <FormField label={f.callMaekakuStatus} htmlFor="mk-status">
          <select id="mk-status" className={FIELD} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{ed.unset}</option>
            <option value="pending">{ed.maekakuStatusLabels.pending}</option>
            <option value="done">{ed.maekakuStatusLabels.done}</option>
            <option value="unnecessary">{ed.maekakuStatusLabels.unnecessary}</option>
          </select>
        </FormField>
        <FormField label={f.maekakuPreferredAt} htmlFor="mk-at">
          <input id="mk-at" type="datetime-local" className={FIELD} value={preferredAt} onChange={(e) => setPreferredAt(e.target.value)} />
        </FormField>
      </div>
      <FormField label={f.maekakuCallNote} htmlFor="mk-note">
        <Textarea id="mk-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>
      <InlineFooter onSave={onSave} onCancel={reset} pending={pending} dirty={dirty} />
    </div>
  );
}

/* 過去コール履歴の追加フォーム（CustomerCallLog）。架電日時 + 対応者 select + メモ。
   対応者デフォルトは現在の操作ユーザー（未指定なら未選択）。createCustomerCallLogAction で
   作成 → toast + router.refresh。customer.update 権限保持者のみ呼び出される（呼び出し側でゲート）。 */
export function CallLogAddForm({
  customerId,
  users,
  defaultHandlerUserId = null,
}: {
  customerId: string;
  users: { id: string; name: string }[];
  defaultHandlerUserId?: string | null;
}) {
  const s = p.callSections;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [calledAt, setCalledAt] = useState("");
  const [handlerUserId, setHandlerUserId] = useState(defaultHandlerUserId ?? "");
  const [note, setNote] = useState("");

  function onAdd() {
    if (!calledAt) {
      toast.error(s.callLogCalledAt);
      return;
    }
    start(async () => {
      try {
        await createCustomerCallLogAction({
          customerId,
          calledAt: new Date(calledAt).toISOString(),
          handlerUserId: handlerUserId || null,
          note: strOrNull(note),
        });
        toast.success(c.saved);
        setCalledAt("");
        setNote("");
        setHandlerUserId(defaultHandlerUserId ?? "");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <div className="rounded-md border border-hairline-light bg-surface-soft/40 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField label={s.callLogCalledAt} htmlFor="cl-at">
          <input
            id="cl-at"
            type="datetime-local"
            className={FIELD}
            value={calledAt}
            onChange={(e) => setCalledAt(e.target.value)}
          />
        </FormField>
        <FormField label={s.callLogHandler} htmlFor="cl-handler">
          <select
            id="cl-handler"
            className={FIELD}
            value={handlerUserId}
            onChange={(e) => setHandlerUserId(e.target.value)}
          >
            <option value="">{s.callLogHandlerUnset}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label={s.callLogNote} htmlFor="cl-note">
          <Input id="cl-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
      </div>
      <div className="mt-3 flex justify-end">
        <Button type="button" size="sm" onClick={onAdd} disabled={pending || !calledAt}>
          {pending ? s.callLogAdding : s.callLogAdd}
        </Button>
      </div>
    </div>
  );
}

/* 過去コール履歴 1 行の削除ボタン（CustomerCallLog）。 */
export function CallLogDeleteButton({
  customerId,
  callLogId,
}: {
  customerId: string;
  callLogId: string;
}) {
  const s = p.callSections;
  const router = useRouter();
  const [pending, start] = useTransition();

  function onDelete() {
    if (!window.confirm(s.callLogDeleteConfirm)) return;
    start(async () => {
      try {
        await deleteCustomerCallLogAction({ customerId, callLogId });
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7 text-mute-light hover:text-destructive"
      aria-label={s.callLogDelete}
      onClick={onDelete}
      disabled={pending}
    >
      <Trash2 className="size-4" />
    </Button>
  );
}

/* サンキューコール（新規 3 列） */
export function ThankYouCallInlineEdit({
  customerId,
  initial,
}: {
  customerId: string;
  initial: ProjectCallsEditable;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(initial.thankYouCallStatus ?? CALL_STATUS_UNSET);
  const [at, setAt] = useState(toDateTimeInput(initial.thankYouCallPreferredAt));
  const [note, setNote] = useState(initial.thankYouCallNote ?? "");

  const initStatus = initial.thankYouCallStatus ?? CALL_STATUS_UNSET;
  const initAt = toDateTimeInput(initial.thankYouCallPreferredAt);
  const dirty = status !== initStatus || at !== initAt || note !== (initial.thankYouCallNote ?? "");

  function reset() {
    setStatus(initStatus);
    setAt(initAt);
    setNote(initial.thankYouCallNote ?? "");
  }

  function onSave() {
    start(async () => {
      try {
        await saveProjectCallStatusAction({
          customerId,
          thankYouCallStatus: callStatusOrNull(status),
          thankYouCallPreferredAt: at ? new Date(at).toISOString() : null,
          thankYouCallNote: strOrNull(note),
        });
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <FormField label={f.thankYouCallStatus} htmlFor="ty-status">
          <CallStatusSelect id="ty-status" value={status} onChange={setStatus} />
        </FormField>
        <FormField label={f.thankYouCallPreferredAt} htmlFor="ty-at">
          <input id="ty-at" type="datetime-local" className={FIELD} value={at} onChange={(e) => setAt(e.target.value)} />
        </FormField>
      </div>
      <FormField label={f.thankYouCallNote} htmlFor="ty-note">
        <Textarea id="ty-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>
      <InlineFooter onSave={onSave} onCancel={reset} pending={pending} dirty={dirty} />
    </div>
  );
}

/* ローン審査完了コール */
export function LoanCompletionCallInlineEdit({
  customerId,
  initial,
}: {
  customerId: string;
  initial: ProjectCallsEditable;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(initial.loanCompletionCallStatus ?? CALL_STATUS_UNSET);
  const [at, setAt] = useState(toDateTimeInput(initial.loanCompletionCallPreferredAt));
  const [note, setNote] = useState(initial.loanCompletionCallNote ?? "");

  const initStatus = initial.loanCompletionCallStatus ?? CALL_STATUS_UNSET;
  const initAt = toDateTimeInput(initial.loanCompletionCallPreferredAt);
  const dirty = status !== initStatus || at !== initAt || note !== (initial.loanCompletionCallNote ?? "");

  function reset() {
    setStatus(initStatus);
    setAt(initAt);
    setNote(initial.loanCompletionCallNote ?? "");
  }

  function onSave() {
    start(async () => {
      try {
        await saveProjectCallStatusAction({
          customerId,
          loanCompletionCallStatus: callStatusOrNull(status),
          loanCompletionCallPreferredAt: at ? new Date(at).toISOString() : null,
          loanCompletionCallNote: strOrNull(note),
        });
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <FormField label={f.loanCompletionCallStatus} htmlFor="lc-status">
          <CallStatusSelect id="lc-status" value={status} onChange={setStatus} />
        </FormField>
        <FormField label={f.loanCompletionCallPreferredAt} htmlFor="lc-at">
          <input id="lc-at" type="datetime-local" className={FIELD} value={at} onChange={(e) => setAt(e.target.value)} />
        </FormField>
      </div>
      <FormField label={f.loanCompletionCallNote} htmlFor="lc-note">
        <Textarea id="lc-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>
      <InlineFooter onSave={onSave} onCancel={reset} pending={pending} dirty={dirty} />
    </div>
  );
}

/* 施工完了（完工）コール */
export function PostCompletionCallInlineEdit({
  customerId,
  initial,
}: {
  customerId: string;
  initial: ProjectCallsEditable;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(initial.postCompletionCallStatus ?? CALL_STATUS_UNSET);
  const [at, setAt] = useState(toDateTimeInput(initial.postCompletionCallPreferredAt));
  const [note, setNote] = useState(initial.postCompletionCallNote ?? "");

  const initStatus = initial.postCompletionCallStatus ?? CALL_STATUS_UNSET;
  const initAt = toDateTimeInput(initial.postCompletionCallPreferredAt);
  const dirty = status !== initStatus || at !== initAt || note !== (initial.postCompletionCallNote ?? "");

  function reset() {
    setStatus(initStatus);
    setAt(initAt);
    setNote(initial.postCompletionCallNote ?? "");
  }

  function onSave() {
    start(async () => {
      try {
        await saveProjectCallStatusAction({
          customerId,
          postCompletionCallStatus: callStatusOrNull(status),
          postCompletionCallPreferredAt: at ? new Date(at).toISOString() : null,
          postCompletionCallNote: strOrNull(note),
        });
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <FormField label={f.postCompletionCallStatus} htmlFor="pc-status">
          <CallStatusSelect id="pc-status" value={status} onChange={setStatus} />
        </FormField>
        <FormField label={f.postCompletionCallPreferredAt} htmlFor="pc-at">
          <input id="pc-at" type="datetime-local" className={FIELD} value={at} onChange={(e) => setAt(e.target.value)} />
        </FormField>
      </div>
      <FormField label={f.postCompletionCallNote} htmlFor="pc-note">
        <Textarea id="pc-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>
      <InlineFooter onSave={onSave} onCancel={reset} pending={pending} dirty={dirty} />
    </div>
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

/* ── ヒアリング（住環境・家族）のカード内インライン編集（F-063, Customer 列）。
   既設設備はここでは触らない（empty array で no-op）。生値を初期値に dirty 追跡 +
   Save/キャンセル。customer.update 権限保持者のみ呼び出される（呼び出し側でゲート）。 ── */
export function HearingInlineEdit({
  customerId,
  initial,
}: {
  customerId: string;
  initial: ProjectHearingEditable;
}) {
  const h = p.hearing;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [husbandAge, setHusbandAge] = useState(initial.husbandAge != null ? String(initial.husbandAge) : "");
  const [wifeAge, setWifeAge] = useState(initial.wifeAge != null ? String(initial.wifeAge) : "");
  const [childAge, setChildAge] = useState(initial.childAge != null ? String(initial.childAge) : "");
  const [household, setHousehold] = useState(initial.household ?? "");
  const [guideAttendee, setGuideAttendee] = useState(initial.guideAttendee ?? "");
  const [faceToFace, setFaceToFace] = useState(boolToSelect(initial.faceToFace));
  const [landlinePhone, setLandlinePhone] = useState(initial.landlinePhone ?? "");
  const [mobilePhone, setMobilePhone] = useState(initial.mobilePhone ?? "");
  const [proposedProduct, setProposedProduct] = useState(initial.proposedProduct ?? "");

  const initFace = boolToSelect(initial.faceToFace);
  const dirty =
    husbandAge !== (initial.husbandAge != null ? String(initial.husbandAge) : "") ||
    wifeAge !== (initial.wifeAge != null ? String(initial.wifeAge) : "") ||
    childAge !== (initial.childAge != null ? String(initial.childAge) : "") ||
    household !== (initial.household ?? "") ||
    guideAttendee !== (initial.guideAttendee ?? "") ||
    faceToFace !== initFace ||
    landlinePhone !== (initial.landlinePhone ?? "") ||
    mobilePhone !== (initial.mobilePhone ?? "") ||
    proposedProduct !== (initial.proposedProduct ?? "");

  function reset() {
    setHusbandAge(initial.husbandAge != null ? String(initial.husbandAge) : "");
    setWifeAge(initial.wifeAge != null ? String(initial.wifeAge) : "");
    setChildAge(initial.childAge != null ? String(initial.childAge) : "");
    setHousehold(initial.household ?? "");
    setGuideAttendee(initial.guideAttendee ?? "");
    setFaceToFace(initFace);
    setLandlinePhone(initial.landlinePhone ?? "");
    setMobilePhone(initial.mobilePhone ?? "");
    setProposedProduct(initial.proposedProduct ?? "");
  }

  function onSave() {
    start(async () => {
      try {
        await saveCustomerHearingAction({
          customerId,
          husbandAge: numOrNull(husbandAge),
          wifeAge: numOrNull(wifeAge),
          childAge: numOrNull(childAge),
          household: strOrNull(household),
          guideAttendee:
            guideAttendee === "" ? null : (guideAttendee as "HUSBAND" | "WIFE" | "BOTH" | "OTHER"),
          faceToFace: selectToBool(faceToFace),
          landlinePhone: strOrNull(landlinePhone),
          mobilePhone: strOrNull(mobilePhone),
          proposedProduct: strOrNull(proposedProduct),
          existingEquipments: [],
        });
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-mute-light">
          {h.familyTitle}
        </h4>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <FormField label={h.husbandAge} htmlFor="hr-husband">
            <Input id="hr-husband" type="number" min={0} max={120} value={husbandAge} onChange={(e) => setHusbandAge(e.target.value)} />
          </FormField>
          <FormField label={h.wifeAge} htmlFor="hr-wife">
            <Input id="hr-wife" type="number" min={0} max={120} value={wifeAge} onChange={(e) => setWifeAge(e.target.value)} />
          </FormField>
          <FormField label={h.childAge} htmlFor="hr-child">
            <Input id="hr-child" type="number" min={0} max={120} value={childAge} onChange={(e) => setChildAge(e.target.value)} />
          </FormField>
          <FormField label={h.household} htmlFor="hr-household">
            <Input id="hr-household" value={household} onChange={(e) => setHousehold(e.target.value)} />
          </FormField>
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
      </div>
      <div>
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-mute-light">
          {ed.contactTitle}
        </h4>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <FormField label={h.landlinePhone} htmlFor="hr-landline">
            <Input id="hr-landline" type="tel" value={landlinePhone} onChange={(e) => setLandlinePhone(e.target.value)} />
          </FormField>
          <FormField label={h.mobilePhone} htmlFor="hr-mobile">
            <Input id="hr-mobile" type="tel" value={mobilePhone} onChange={(e) => setMobilePhone(e.target.value)} />
          </FormField>
          <FormField label={h.proposedProduct} htmlFor="hr-product">
            <Input id="hr-product" value={proposedProduct} onChange={(e) => setProposedProduct(e.target.value)} />
          </FormField>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={reset} disabled={pending || !dirty}>
          {ed.cancel}
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={pending || !dirty}>
          {pending ? c.saving : ed.save}
        </Button>
      </div>
    </div>
  );
}


/* ── 設備明細（ContractEquipment の非価格フィールドのみ。契約 find-or-create 方式） ──
   契約状況タブで PV/BT/付帯の設備を追加・編集する。initial が null（空カテゴリ）の
   ときは「追加」モード（＋アイコン）、既存行があれば「編集」モード（鉛筆）。保存は
   saveProjectContractEquipmentAction（契約が無ければデモ用に最小 Deal+Contract を生成）。
   contractId が null（契約 0 件）のときは契約金額も同時入力できる。 */
export function EditEquipmentDialog({
  customerId,
  category,
  contractId,
  initial = null,
  title,
}: {
  customerId: string;
  category: EquipmentCategoryValue;
  // 契約 0 件の顧客では null。設備保存時にサーバー側で最小契約を生成する。
  contractId: string | null;
  initial?: ProjectEquipmentEditable | null;
  title: string;
}) {
  const e = p.equipment;
  const isAdd = initial == null;
  const [open, setOpen] = useState(false);
  const [contracted, setContracted] = useState(initial?.contracted ?? true);
  const [manufacturer, setManufacturer] = useState(initial?.manufacturer ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [capacity, setCapacity] = useState(initial?.capacity ?? "");
  const [quantity, setQuantity] = useState(initial?.quantity != null ? String(initial.quantity) : "");
  const [installLocation, setInstallLocation] = useState(initial?.installLocation ?? "");
  const [introducedStatus, setIntroducedStatus] = useState(initial?.introducedStatus ?? "");
  const [warrantyStandard, setWarrantyStandard] = useState(boolToSelect(initial?.warrantyStandard ?? null));
  const [warrantyExtended, setWarrantyExtended] = useState(boolToSelect(initial?.warrantyExtended ?? null));
  const [warrantyDisaster, setWarrantyDisaster] = useState(boolToSelect(initial?.warrantyDisaster ?? null));
  const [detail, setDetail] = useState(initial?.detail ?? "");
  const { pending, run } = useSaver(() => setOpen(false));

  function reset() {
    setContracted(initial?.contracted ?? true);
    setManufacturer(initial?.manufacturer ?? "");
    setModel(initial?.model ?? "");
    setCapacity(initial?.capacity ?? "");
    setQuantity(initial?.quantity != null ? String(initial.quantity) : "");
    setInstallLocation(initial?.installLocation ?? "");
    setIntroducedStatus(initial?.introducedStatus ?? "");
    setWarrantyStandard(boolToSelect(initial?.warrantyStandard ?? null));
    setWarrantyExtended(boolToSelect(initial?.warrantyExtended ?? null));
    setWarrantyDisaster(boolToSelect(initial?.warrantyDisaster ?? null));
    setDetail(initial?.detail ?? "");
  }

  function onOpenChange(next: boolean) {
    if (next) reset();
    setOpen(next);
  }

  function save() {
    run(() =>
      saveProjectContractEquipmentAction({
        customerId,
        contractId: initial?.contractId ?? contractId,
        // 既存行は equipmentId を渡して更新。未指定は新規作成（複数行追加）。
        equipmentId: initial?.id ?? null,
        category,
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

  const triggerLabel = isAdd ? `${title} ${ed.addEquipment}` : `${title} ${ed.editEquipment}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <EditTrigger label={triggerLabel} mode={isAdd ? "add" : "edit"} />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {title} — {isAdd ? ed.addEquipment : ed.editEquipment}
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

/* ── 商材ライン（ContractEquipment）のカード内インライン編集（契約状況タブ専用）。
   ポップアップ廃止 → カード内で金額・業者・内容を直接編集。dirty 追跡 + Save/キャンセル
   + saveProjectContractEquipmentAction（契約 find-or-create 維持）+ router.refresh。
   category により表示するフィールドを切り替える（施工=CONSTRUCTION は業者・内容のみ）。
   customer.update 権限保持者のみ呼び出される（呼び出し側でゲート）。 ── */
export function EquipmentInlineEdit({
  customerId,
  category,
  contractId,
  initial = null,
  title,
}: {
  customerId: string;
  category: EquipmentCategoryValue;
  // 契約 0 件の顧客では null。設備保存時にサーバー側で最小契約を生成する。
  contractId: string | null;
  initial?: ProjectEquipmentEditable | null;
  title: string;
}) {
  const e = p.equipment;
  const router = useRouter();
  const [pending, start] = useTransition();
  const isConstruction = category === "CONSTRUCTION";

  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : "");
  const [manufacturer, setManufacturer] = useState(initial?.manufacturer ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [capacity, setCapacity] = useState(initial?.capacity ?? "");
  const [quantity, setQuantity] = useState(initial?.quantity != null ? String(initial.quantity) : "");
  const [installLocation, setInstallLocation] = useState(initial?.installLocation ?? "");
  const [detail, setDetail] = useState(initial?.detail ?? "");
  const [warrantyStandard, setWarrantyStandard] = useState(boolToSelect(initial?.warrantyStandard ?? null));
  const [warrantyExtended, setWarrantyExtended] = useState(boolToSelect(initial?.warrantyExtended ?? null));
  const [warrantyDisaster, setWarrantyDisaster] = useState(boolToSelect(initial?.warrantyDisaster ?? null));

  const initAmount = initial?.amount != null ? String(initial.amount) : "";
  const initQty = initial?.quantity != null ? String(initial.quantity) : "";
  const initWStd = boolToSelect(initial?.warrantyStandard ?? null);
  const initWExt = boolToSelect(initial?.warrantyExtended ?? null);
  const initWDis = boolToSelect(initial?.warrantyDisaster ?? null);

  const dirty =
    amount !== initAmount ||
    manufacturer !== (initial?.manufacturer ?? "") ||
    model !== (initial?.model ?? "") ||
    capacity !== (initial?.capacity ?? "") ||
    quantity !== initQty ||
    installLocation !== (initial?.installLocation ?? "") ||
    detail !== (initial?.detail ?? "") ||
    warrantyStandard !== initWStd ||
    warrantyExtended !== initWExt ||
    warrantyDisaster !== initWDis;

  function reset() {
    setAmount(initAmount);
    setManufacturer(initial?.manufacturer ?? "");
    setModel(initial?.model ?? "");
    setCapacity(initial?.capacity ?? "");
    setQuantity(initQty);
    setInstallLocation(initial?.installLocation ?? "");
    setDetail(initial?.detail ?? "");
    setWarrantyStandard(initWStd);
    setWarrantyExtended(initWExt);
    setWarrantyDisaster(initWDis);
  }

  function onSave() {
    start(async () => {
      try {
        await saveProjectContractEquipmentAction({
          customerId,
          contractId: initial?.contractId ?? contractId,
          // 既存行は equipmentId を渡して更新（PV/BT/施工等は代表 1 行を維持）。
          equipmentId: initial?.id ?? null,
          category,
          amount: numOrNull(amount),
          // 商材金額の入力があれば「契約あり」とみなす（追加導線の意図）。
          contracted: true,
          manufacturer: strOrNull(manufacturer),
          model: strOrNull(model),
          capacity: isConstruction ? null : strOrNull(capacity),
          quantity: isConstruction ? null : numOrNull(quantity),
          installLocation: isConstruction ? null : strOrNull(installLocation),
          warrantyStandard: isConstruction ? null : selectToBool(warrantyStandard),
          warrantyExtended: isConstruction ? null : selectToBool(warrantyExtended),
          warrantyDisaster: isConstruction ? null : selectToBool(warrantyDisaster),
          detail: strOrNull(detail),
        });
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <div className="space-y-3 rounded-md border border-hairline-light p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{title}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <FormField label={e.amount} htmlFor={`eq-amount-${category}`}>
          <MoneyInput id={`eq-amount-${category}`} value={amount} onChange={setAmount} />
        </FormField>
        {isConstruction ? (
          <FormField label={e.vendor} htmlFor={`eq-vendor-${category}`}>
            <Input id={`eq-vendor-${category}`} value={manufacturer} onChange={(ev) => setManufacturer(ev.target.value)} />
          </FormField>
        ) : (
          <FormField label={e.maker} htmlFor={`eq-maker-${category}`}>
            <Input id={`eq-maker-${category}`} value={manufacturer} onChange={(ev) => setManufacturer(ev.target.value)} />
          </FormField>
        )}
        <FormField label={e.modelNo} htmlFor={`eq-model-${category}`}>
          <Input id={`eq-model-${category}`} value={model} onChange={(ev) => setModel(ev.target.value)} />
        </FormField>
        {!isConstruction ? (
          <>
            <FormField label={e.capacity} htmlFor={`eq-capacity-${category}`}>
              <Input id={`eq-capacity-${category}`} value={capacity} onChange={(ev) => setCapacity(ev.target.value)} />
            </FormField>
            <FormField label={e.count} htmlFor={`eq-qty-${category}`}>
              <Input id={`eq-qty-${category}`} type="number" min={0} value={quantity} onChange={(ev) => setQuantity(ev.target.value)} />
            </FormField>
            <FormField label={e.location} htmlFor={`eq-loc-${category}`}>
              <Input id={`eq-loc-${category}`} value={installLocation} onChange={(ev) => setInstallLocation(ev.target.value)} />
            </FormField>
          </>
        ) : null}
      </div>
      {!isConstruction ? (
        <div className="grid grid-cols-3 gap-3">
          <FormField label={e.totalWarranty} htmlFor={`eq-wstd-${category}`}>
            <select id={`eq-wstd-${category}`} className={FIELD} value={warrantyStandard} onChange={(ev) => setWarrantyStandard(ev.target.value)}>
              <option value={BOOL_UNSET}>{ed.unset}</option>
              <option value="true">{ed.presence.true}</option>
              <option value="false">{ed.presence.false}</option>
            </select>
          </FormField>
          <FormField label={e.extWarranty} htmlFor={`eq-wext-${category}`}>
            <select id={`eq-wext-${category}`} className={FIELD} value={warrantyExtended} onChange={(ev) => setWarrantyExtended(ev.target.value)}>
              <option value={BOOL_UNSET}>{ed.unset}</option>
              <option value="true">{ed.presence.true}</option>
              <option value="false">{ed.presence.false}</option>
            </select>
          </FormField>
          <FormField label={e.disasterWarranty} htmlFor={`eq-wdis-${category}`}>
            <select id={`eq-wdis-${category}`} className={FIELD} value={warrantyDisaster} onChange={(ev) => setWarrantyDisaster(ev.target.value)}>
              <option value={BOOL_UNSET}>{ed.unset}</option>
              <option value="true">{ed.presence.true}</option>
              <option value="false">{ed.presence.false}</option>
            </select>
          </FormField>
        </div>
      ) : null}
      <FormField label={e.detail} htmlFor={`eq-detail-${category}`}>
        <Textarea id={`eq-detail-${category}`} rows={2} value={detail} onChange={(ev) => setDetail(ev.target.value)} />
      </FormField>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={reset} disabled={pending || !dirty}>
          {ed.cancel}
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={pending || !dirty}>
          {pending ? c.saving : ed.save}
        </Button>
      </div>
    </div>
  );
}

/* ── 付帯商材（ACCESSORY）の 1 行インライン編集（複数行運用・要件C）。金額/数量/型番/
   設置場所/内容を直接編集し、saveProjectContractEquipmentAction で更新（equipmentId 指定）。
   削除ボタン（deleteContractEquipmentAction）付き。追加/編集/削除のたびに契約金額が再計算。 ── */
export function AccessoryInlineEdit({
  customerId,
  contractId,
  initial,
}: {
  customerId: string;
  contractId: string;
  initial: ProjectEquipmentEditable;
}) {
  const e = p.equipment;
  const ct = labels.customer.detail.contractTab;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState(initial.amount != null ? String(initial.amount) : "");
  const [quantity, setQuantity] = useState(initial.quantity != null ? String(initial.quantity) : "");
  const [model, setModel] = useState(initial.model ?? "");
  const [installLocation, setInstallLocation] = useState(initial.installLocation ?? "");
  const [detail, setDetail] = useState(initial.detail ?? "");

  const initAmount = initial.amount != null ? String(initial.amount) : "";
  const initQty = initial.quantity != null ? String(initial.quantity) : "";
  const dirty =
    amount !== initAmount ||
    quantity !== initQty ||
    model !== (initial.model ?? "") ||
    installLocation !== (initial.installLocation ?? "") ||
    detail !== (initial.detail ?? "");

  function reset() {
    setAmount(initAmount);
    setQuantity(initQty);
    setModel(initial.model ?? "");
    setInstallLocation(initial.installLocation ?? "");
    setDetail(initial.detail ?? "");
  }

  function onSave() {
    start(async () => {
      try {
        await saveProjectContractEquipmentAction({
          customerId,
          contractId,
          equipmentId: initial.id,
          category: "ACCESSORY",
          contracted: true,
          amount: numOrNull(amount),
          quantity: numOrNull(quantity),
          model: strOrNull(model),
          installLocation: strOrNull(installLocation),
          detail: strOrNull(detail),
        });
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  function onDelete() {
    if (!window.confirm(ct.deleteAccessoryConfirm)) return;
    start(async () => {
      try {
        await deleteContractEquipmentAction({ customerId, contractId, equipmentId: initial.id });
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <div className="space-y-3 rounded-md border border-hairline-light p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{e.accessory}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-mute-light hover:text-destructive"
          aria-label={ct.deleteAccessory}
          onClick={onDelete}
          disabled={pending}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <FormField label={e.amount} htmlFor={`acc-amount-${initial.id}`}>
          <MoneyInput id={`acc-amount-${initial.id}`} value={amount} onChange={setAmount} />
        </FormField>
        <FormField label={e.count} htmlFor={`acc-qty-${initial.id}`}>
          <Input id={`acc-qty-${initial.id}`} type="number" min={0} value={quantity} onChange={(ev) => setQuantity(ev.target.value)} />
        </FormField>
        <FormField label={e.modelNo1} htmlFor={`acc-model-${initial.id}`}>
          <Input id={`acc-model-${initial.id}`} value={model} onChange={(ev) => setModel(ev.target.value)} />
        </FormField>
        <FormField label={e.pcLocationSwap} htmlFor={`acc-loc-${initial.id}`}>
          <Input id={`acc-loc-${initial.id}`} value={installLocation} onChange={(ev) => setInstallLocation(ev.target.value)} />
        </FormField>
      </div>
      <FormField label={e.detail} htmlFor={`acc-detail-${initial.id}`}>
        <Textarea id={`acc-detail-${initial.id}`} rows={2} value={detail} onChange={(ev) => setDetail(ev.target.value)} />
      </FormField>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={reset} disabled={pending || !dirty}>
          {ed.cancel}
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={pending || !dirty}>
          {pending ? c.saving : ed.save}
        </Button>
      </div>
    </div>
  );
}

/* 付帯商材を新規追加するボタン（空行を新規作成 → router.refresh で行が出現）。 */
export function AddAccessoryButton({
  customerId,
  contractId,
}: {
  customerId: string;
  contractId: string;
}) {
  const ct = labels.customer.detail.contractTab;
  const router = useRouter();
  const [pending, start] = useTransition();

  function onAdd() {
    start(async () => {
      try {
        await saveProjectContractEquipmentAction({
          customerId,
          contractId,
          category: "ACCESSORY",
          contracted: true,
        });
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={onAdd} disabled={pending}>
      <Plus className="mr-1 size-4" />
      {pending ? ct.addingAccessory : ct.addAccessory}
    </Button>
  );
}

/* 契約を追加するボタン（契約 #2 以降。createContractAction で最小 Deal+Contract を生成）。 */
export function AddContractButton({ customerId }: { customerId: string }) {
  const ct = labels.customer.detail.contractTab;
  const router = useRouter();
  const [pending, start] = useTransition();

  function onAdd() {
    start(async () => {
      try {
        await createContractAction({ customerId });
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={onAdd} disabled={pending}>
      <Plus className="mr-1 size-4" />
      {pending ? ct.addingContract : ct.addContract}
    </Button>
  );
}

/* 契約を削除するボタン（依存がある契約はサーバーがガード）。サブタブヘッダで
   「契約を追加」と並ぶテキストボタン。危険操作のため confirm + destructive 配色。 */
export function DeleteContractButton({
  customerId,
  contractId,
}: {
  customerId: string;
  contractId: string;
}) {
  const ct = labels.customer.detail.contractTab;
  const router = useRouter();
  const [pending, start] = useTransition();

  function onDelete() {
    if (!window.confirm(ct.deleteContractConfirm)) return;
    start(async () => {
      try {
        await deleteContractAction({ customerId, contractId });
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/30"
      onClick={onDelete}
      disabled={pending}
    >
      <Trash2 className="mr-1 size-4" />
      {pending ? ct.deletingContract : ct.deleteContractText}
    </Button>
  );
}

/* ── 契約サマリのカード内インライン編集（契約状況タブ・サブタブ上部）。ポップアップ廃止。
   契約日 / 支払回数 / 入金ステータス / 入金日 / 二次店支払日 / 機器シリアルを直接編集。
   契約金額は商材ライン合計（read-only・編集対象外）。ローン情報はローン審査タブの
   EditContractDialog に分離。dirty 追跡 + Save/キャンセル + saveProjectContractAction
   （部分更新＝送ったフィールドのみ更新）+ toast + router.refresh。input id は既存 e2e 互換
   （ct-date / ct-paycount / ct-paystatus / ct-deposit / ct-payout / ct-serial）を踏襲。
   customer.update 権限保持者のみ呼び出される（呼び出し側でゲート）。 ── */
export function ContractDetailInlineEdit({
  customerId,
  initial,
  contractAmount,
}: {
  customerId: string;
  initial: ProjectContractEditable;
  // 商材ライン合計（read-only 表示用）。
  contractAmount: number | null;
}) {
  const ct = labels.customer.detail.contractTab;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [contractDate, setContractDate] = useState(toDateInput(initial.contractDate));
  const [paymentCount, setPaymentCount] = useState(initial.paymentCount != null ? String(initial.paymentCount) : "");
  const [paymentStatus, setPaymentStatus] = useState(initial.paymentStatus ?? "UNPAID");
  const [depositDate, setDepositDate] = useState(toDateInput(initial.depositDate));
  const [equipmentSerialId, setEquipmentSerialId] = useState(initial.equipmentSerialId ?? "");

  const initDate = toDateInput(initial.contractDate);
  const initCount = initial.paymentCount != null ? String(initial.paymentCount) : "";
  const initStatus = initial.paymentStatus ?? "UNPAID";
  const initDeposit = toDateInput(initial.depositDate);
  const dirty =
    contractDate !== initDate ||
    paymentCount !== initCount ||
    paymentStatus !== initStatus ||
    depositDate !== initDeposit ||
    equipmentSerialId !== (initial.equipmentSerialId ?? "");

  function reset() {
    setContractDate(initDate);
    setPaymentCount(initCount);
    setPaymentStatus(initStatus);
    setDepositDate(initDeposit);
    setEquipmentSerialId(initial.equipmentSerialId ?? "");
  }

  function onSave() {
    start(async () => {
      try {
        await saveProjectContractAction({
          customerId,
          contractId: initial.contractId,
          contractDate: contractDate || null,
          equipmentSerialId: strOrNull(equipmentSerialId),
          paymentCount: numOrNull(paymentCount),
          paymentStatus: paymentStatus as "UNPAID" | "PARTIAL" | "PAID",
          depositDate: depositDate || null,
        });
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <FormField label={f.contractDate} htmlFor="ct-date">
          <input id="ct-date" type="date" className={FIELD} value={contractDate} onChange={(e) => setContractDate(e.target.value)} />
        </FormField>
        {/* 契約金額は商材ライン合計（read-only・自動計算）。 */}
        <div className="space-y-1.5">
          <Label>{ct.contractAmountAuto}</Label>
          <p className="flex h-9 items-center text-sm font-medium tabular-nums text-ink">
            {contractAmount != null ? `¥${contractAmount.toLocaleString("ja-JP")}` : p.empty}
          </p>
        </div>
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
        <FormField label={f.equipmentId} htmlFor="ct-serial">
          <Input id="ct-serial" value={equipmentSerialId} onChange={(e) => setEquipmentSerialId(e.target.value)} />
        </FormField>
      </div>
      <InlineFooter onSave={onSave} onCancel={reset} pending={pending} dirty={dirty} />
    </div>
  );
}

/* ── 契約サブタブ（client ラッパー）。アクティブな契約を state で保持し、ヘッダ右に
   「契約を追加」+「契約を削除」（アクティブ契約対象）を並置する。各タブ本文は server で
   生成した React element を content として受け取り描画する（余白を作るタブ直下の削除行は廃止）。 ── */
export function ContractSubTabs({
  customerId,
  tabs,
}: {
  customerId: string;
  tabs: { id: string; label: string; content: React.ReactNode }[];
}) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  if (tabs.length === 0) return null;

  return (
    <Tabs value={active} onValueChange={setActive}>
      <div className="flex items-center justify-between gap-2">
        <TabsList variant="underline" className="flex-1">
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex shrink-0 items-center gap-2 pb-1">
          <AddContractButton customerId={customerId} />
          <DeleteContractButton customerId={customerId} contractId={active} />
        </div>
      </div>
      {tabs.map((t) => (
        <TabsContent key={t.id} value={t.id} className="space-y-4">
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
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
              <MoneyInput id="cn-fee" value={fee} onChange={setFee} />
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

/* ── 特記事項（Customer.specialNote・フリーテキストメモのインライン編集） ── */
export function SpecialNoteInlineEdit({
  customerId,
  initial,
}: {
  customerId: string;
  initial: { specialNote: string | null };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(initial.specialNote ?? "");

  const dirty = value !== (initial.specialNote ?? "");

  function onSave() {
    start(async () => {
      try {
        await updateCustomerAction({ id: customerId, specialNote: strOrNull(value) });
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <div className="space-y-3">
      <Label htmlFor="special-note" className="sr-only">
        {p.sections.specialNote}
      </Label>
      <Textarea
        id="special-note"
        rows={5}
        value={value}
        placeholder={p.specialNotePlaceholder}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setValue(initial.specialNote ?? "")}
          disabled={pending || !dirty}
        >
          {ed.cancel}
        </Button>
        <Button type="button" onClick={onSave} disabled={pending || !dirty}>
          {pending ? c.saving : ed.save}
        </Button>
      </div>
    </div>
  );
}

/* ── ローン審査（独立 LoanReview）のインライン編集（各審査サブタブ内・契約タブと同型）。
   ステータス / ローン会社 / 頭金(MoneyInput) / 団信 / メモ / 審査日 を直接編集。不備は
   審査履歴ログ単位（LoanReviewLog）へ移行したため本サマリでは扱わない。dirty 追跡 +
   Save/キャンセル + saveLoanReviewAction（部分更新）+ toast + router.refresh。
   customer.update 権限保持者のみ呼び出される（呼び出し側でゲート）。 ── */
export function LoanReviewInlineEdit({
  customerId,
  initial,
}: {
  customerId: string;
  initial: ProjectLoanReviewEditable;
}) {
  const lt = labels.customer.detail.loanTab;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(initial.status);
  const [loanCompany, setLoanCompany] = useState(initial.loanCompany ?? "");
  const [downPayment, setDownPayment] = useState(initial.downPayment != null ? String(initial.downPayment) : "");
  const [creditLifeInsurance, setCreditLifeInsurance] = useState(boolToSelect(initial.creditLifeInsurance));
  const [note, setNote] = useState(initial.note ?? "");
  const [reviewedAt, setReviewedAt] = useState(toDateInput(initial.reviewedAt));

  const initDown = initial.downPayment != null ? String(initial.downPayment) : "";
  const initCredit = boolToSelect(initial.creditLifeInsurance);
  const initReviewedAt = toDateInput(initial.reviewedAt);
  const dirty =
    status !== initial.status ||
    loanCompany !== (initial.loanCompany ?? "") ||
    downPayment !== initDown ||
    creditLifeInsurance !== initCredit ||
    note !== (initial.note ?? "") ||
    reviewedAt !== initReviewedAt;

  function reset() {
    setStatus(initial.status);
    setLoanCompany(initial.loanCompany ?? "");
    setDownPayment(initDown);
    setCreditLifeInsurance(initCredit);
    setNote(initial.note ?? "");
    setReviewedAt(initReviewedAt);
  }

  function onSave() {
    start(async () => {
      try {
        await saveLoanReviewAction({
          customerId,
          loanReviewId: initial.loanReviewId,
          status: status as LoanReviewStatusValue,
          loanCompany: strOrNull(loanCompany),
          downPayment: numOrNull(downPayment),
          creditLifeInsurance: selectToBool(creditLifeInsurance),
          note: strOrNull(note),
          reviewedAt: reviewedAt || null,
        });
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <FormField label={lt.status} htmlFor={`lr-status-${initial.loanReviewId}`}>
          <select id={`lr-status-${initial.loanReviewId}`} className={FIELD} value={status} onChange={(e) => setStatus(e.target.value)}>
            {LOAN_REVIEW_STATUS_VALUES.map((v) => (
              <option key={v} value={v}>
                {lt.statusLabels[v]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label={lt.loanCompany} htmlFor={`lr-company-${initial.loanReviewId}`}>
          <Input id={`lr-company-${initial.loanReviewId}`} value={loanCompany} onChange={(e) => setLoanCompany(e.target.value)} />
        </FormField>
        <FormField label={lt.downPayment} htmlFor={`lr-down-${initial.loanReviewId}`}>
          <MoneyInput id={`lr-down-${initial.loanReviewId}`} value={downPayment} onChange={setDownPayment} />
        </FormField>
        <FormField label={lt.creditLife} htmlFor={`lr-credit-${initial.loanReviewId}`}>
          <select id={`lr-credit-${initial.loanReviewId}`} className={FIELD} value={creditLifeInsurance} onChange={(e) => setCreditLifeInsurance(e.target.value)}>
            <option value={BOOL_UNSET}>{ed.unset}</option>
            <option value="true">{ed.presence.true}</option>
            <option value="false">{ed.presence.false}</option>
          </select>
        </FormField>
        <FormField label={lt.reviewedAt} htmlFor={`lr-at-${initial.loanReviewId}`}>
          <input id={`lr-at-${initial.loanReviewId}`} type="date" className={FIELD} value={reviewedAt} onChange={(e) => setReviewedAt(e.target.value)} />
        </FormField>
      </div>
      <FormField label={lt.note} htmlFor={`lr-note-${initial.loanReviewId}`}>
        <Textarea id={`lr-note-${initial.loanReviewId}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>
      <InlineFooter onSave={onSave} onCancel={reset} pending={pending} dirty={dirty} />
    </div>
  );
}

/* 過去の審査履歴ログ（LoanReviewLog）の追加フォーム。日時 + 結果 select + メモ + 不備内容。
   不備内容は任意（空可）で、入力したログが「不備内容・解消状況」一覧に出る。記録者は
   createdByUserId（操作ユーザー）でサーバーが自動付与する（フォームに無し）。 */
export function LoanReviewLogAddForm({
  customerId,
  loanReviewId,
}: {
  customerId: string;
  loanReviewId: string;
}) {
  const lt = labels.customer.detail.loanTab;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reviewedAt, setReviewedAt] = useState("");
  const [result, setResult] = useState<string>(LOAN_REVIEW_RESULT_VALUES[0]);
  const [note, setNote] = useState("");
  const [defectContent, setDefectContent] = useState("");

  function onAdd() {
    if (!reviewedAt) {
      toast.error(lt.logReviewedAt);
      return;
    }
    start(async () => {
      try {
        await createLoanReviewLogAction({
          customerId,
          loanReviewId,
          reviewedAt: new Date(reviewedAt).toISOString(),
          result: result as LoanReviewResultValue,
          note: strOrNull(note),
          defectContent: strOrNull(defectContent),
        });
        toast.success(c.saved);
        setReviewedAt("");
        setNote("");
        setDefectContent("");
        setResult(LOAN_REVIEW_RESULT_VALUES[0]);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <div className="rounded-md border border-hairline-light bg-surface-soft/40 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField label={lt.logReviewedAt} htmlFor={`lrl-at-${loanReviewId}`}>
          <input id={`lrl-at-${loanReviewId}`} type="datetime-local" className={FIELD} value={reviewedAt} onChange={(e) => setReviewedAt(e.target.value)} />
        </FormField>
        <FormField label={lt.logResult} htmlFor={`lrl-result-${loanReviewId}`}>
          <select id={`lrl-result-${loanReviewId}`} className={FIELD} value={result} onChange={(e) => setResult(e.target.value)}>
            {LOAN_REVIEW_RESULT_VALUES.map((v) => (
              <option key={v} value={v}>
                {lt.resultLabels[v]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label={lt.logNote} htmlFor={`lrl-note-${loanReviewId}`}>
          <Input id={`lrl-note-${loanReviewId}`} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
      </div>
      <div className="mt-3">
        <FormField label={lt.logDefectContent} htmlFor={`lrl-defect-${loanReviewId}`}>
          <Textarea id={`lrl-defect-${loanReviewId}`} rows={2} value={defectContent} onChange={(e) => setDefectContent(e.target.value)} />
        </FormField>
      </div>
      <div className="mt-3 flex justify-end">
        <Button type="button" size="sm" onClick={onAdd} disabled={pending || !reviewedAt}>
          {pending ? lt.logAdding : lt.logAdd}
        </Button>
      </div>
    </div>
  );
}

/* 過去の審査履歴ログ 1 行の削除ボタン（LoanReviewLog）。 */
export function LoanReviewLogDeleteButton({
  customerId,
  loanReviewId,
  logId,
}: {
  customerId: string;
  loanReviewId: string;
  logId: string;
}) {
  const lt = labels.customer.detail.loanTab;
  const router = useRouter();
  const [pending, start] = useTransition();

  function onDelete() {
    if (!window.confirm(lt.logDeleteConfirm)) return;
    start(async () => {
      try {
        await deleteLoanReviewLogAction({ customerId, loanReviewId, logId });
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7 text-mute-light hover:text-destructive"
      aria-label={lt.logDelete}
      onClick={onDelete}
      disabled={pending}
    >
      <Trash2 className="size-4" />
    </Button>
  );
}

/* ローン審査を追加するボタン（審査 #2 以降。createLoanReviewAction で最小レコードを生成）。 */
export function AddLoanReviewButton({ customerId }: { customerId: string }) {
  const lt = labels.customer.detail.loanTab;
  const router = useRouter();
  const [pending, start] = useTransition();

  function onAdd() {
    start(async () => {
      try {
        await createLoanReviewAction({ customerId });
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={onAdd} disabled={pending}>
      <Plus className="mr-1 size-4" />
      {pending ? lt.addingReview : lt.addReview}
    </Button>
  );
}

/* ローン審査を削除するボタン（アクティブな審査対象）。confirm + destructive 配色。 */
export function DeleteLoanReviewButton({
  customerId,
  loanReviewId,
}: {
  customerId: string;
  loanReviewId: string;
}) {
  const lt = labels.customer.detail.loanTab;
  const router = useRouter();
  const [pending, start] = useTransition();

  function onDelete() {
    if (!window.confirm(lt.deleteReviewConfirm)) return;
    start(async () => {
      try {
        await deleteLoanReviewAction({ customerId, loanReviewId });
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/30"
      onClick={onDelete}
      disabled={pending}
    >
      <Trash2 className="mr-1 size-4" />
      {pending ? lt.deletingReview : lt.deleteReviewText}
    </Button>
  );
}

/* ── ローン審査サブタブ（client ラッパー・ContractSubTabs と同型）。アクティブな審査を
   state で保持し、ヘッダ右に「審査を追加」+「審査を削除」（アクティブ審査対象）を並置する。
   各タブ本文は server で生成した React element を content として受け取り描画する。 ── */
export function LoanReviewSubTabs({
  customerId,
  tabs,
}: {
  customerId: string;
  tabs: { id: string; label: string; content: React.ReactNode }[];
}) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  if (tabs.length === 0) return null;

  return (
    <Tabs value={active} onValueChange={setActive}>
      <div className="flex items-center justify-between gap-2">
        <TabsList variant="underline" className="flex-1">
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex shrink-0 items-center gap-2 pb-1">
          <AddLoanReviewButton customerId={customerId} />
          <DeleteLoanReviewButton customerId={customerId} loanReviewId={active} />
        </div>
      </div>
      {tabs.map((t) => (
        <TabsContent key={t.id} value={t.id} className="space-y-4">
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}

/* 過去の審査履歴ログ一覧（read-only 表示 + 削除）。reviewedAt 降順は DTO 側で確定済み。 */
export function LoanReviewLogList({
  customerId,
  loanReviewId,
  logs,
}: {
  customerId: string;
  loanReviewId: string;
  logs: ProjectLoanReviewLogDto[];
}) {
  const lt = labels.customer.detail.loanTab;
  if (logs.length === 0) {
    return <p className="text-sm text-mute-light">{lt.historyEmpty}</p>;
  }
  return (
    <ul className="divide-y divide-hairline-light">
      {logs.map((log) => (
        <li key={log.id} className="flex items-start justify-between gap-3 py-2">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2 text-sm text-ink">
              <span className="tabular-nums">
                {new Date(log.reviewedAt).toLocaleString("ja-JP")}
              </span>
              <span className="rounded-sm bg-surface-soft px-1.5 py-0.5 text-xs font-medium text-ink">
                {lt.resultLabels[log.result] ?? log.result}
              </span>
              {log.handlerName ? (
                <span className="text-xs text-mute-light">{log.handlerName}</span>
              ) : null}
            </div>
            {log.note ? <p className="text-xs text-mute-light">{log.note}</p> : null}
          </div>
          <LoanReviewLogDeleteButton
            customerId={customerId}
            loanReviewId={loanReviewId}
            logId={log.id}
          />
        </li>
      ))}
    </ul>
  );
}

/* 不備の解消トグル（LoanReviewLog.defectResolved）。setLoanReviewLogDefectResolvedAction →
   toast + router.refresh。customer.update 権限保持者のみ呼び出される（呼び出し側でゲート）。 */
function DefectResolveToggle({
  customerId,
  loanReviewId,
  logId,
  resolved,
}: {
  customerId: string;
  loanReviewId: string;
  logId: string;
  resolved: boolean;
}) {
  const lt = labels.customer.detail.loanTab;
  const router = useRouter();
  const [pending, start] = useTransition();

  function onToggle() {
    start(async () => {
      try {
        await setLoanReviewLogDefectResolvedAction({
          customerId,
          loanReviewId,
          logId,
          resolved: !resolved,
        });
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-6 shrink-0 px-2 text-[11px]"
      onClick={onToggle}
      disabled={pending}
    >
      {resolved ? lt.defectResolveToOpen : lt.defectResolveToResolved}
    </Button>
  );
}

/* 不備内容・解消状況の一覧（LoanReviewLog 横断）。当該審査の logs から defectContent 非 null
   のものを日時降順（DTO で確定）で表示し、各行に解消バッジ + 解消/未解消トグルを出す。
   customerId が null（二次店・閲覧のみ）のときはトグルを描画せずバッジのみ表示する。 */
export function LoanReviewDefectList({
  customerId,
  loanReviewId,
  logs,
}: {
  customerId: string | null;
  loanReviewId: string;
  logs: ProjectLoanReviewLogDto[];
}) {
  const lt = labels.customer.detail.loanTab;
  const defects = logs.filter((l) => l.defectContent != null && l.defectContent !== "");
  if (defects.length === 0) {
    return <p className="text-sm text-mute-light">{lt.defectListEmpty}</p>;
  }
  return (
    <ul className="divide-y divide-hairline-light">
      {defects.map((log) => (
        <li key={log.id} className="flex items-center gap-2 py-1.5 text-sm text-ink">
          <span className="shrink-0 tabular-nums text-mute-light">
            {new Date(log.reviewedAt).toLocaleDateString("ja-JP")}
          </span>
          <span
            className={cn(
              "shrink-0 rounded-sm px-1.5 py-0.5 text-xs font-medium",
              log.defectResolved ? "badge-success" : "badge-warning",
            )}
          >
            {log.defectResolved ? lt.defectResolvedBadge : lt.defectOpenBadge}
          </span>
          <span className="min-w-0 flex-1 truncate" title={log.defectContent ?? undefined}>
            {log.defectContent}
          </span>
          {customerId ? (
            <DefectResolveToggle
              customerId={customerId}
              loanReviewId={loanReviewId}
              logId={log.id}
              resolved={log.defectResolved}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
