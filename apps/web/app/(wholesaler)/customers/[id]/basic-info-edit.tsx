"use client";

// 顧客詳細「基本情報」タブの顧客情報 / メモのカード内インライン編集 (F-031).
// status-panels.tsx と同じ idiom（生値の編集状態 + dirty 追跡 + Save/キャンセル +
// updateCustomerAction + router.refresh + toast）。マスク前の生値を props で受け取り
// フォーム初期値とする（マスク値を保存し戻さない）。customer.update 権限が無い
// 二次店・閲覧のみ（editable=null）では呼び出し側が読み取り専用 InfoRow を描画する。

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labels } from "@/lib/i18n/labels";

import { updateCustomerAction } from "../actions";

import type { InflowRoute } from "@solar/contracts";

export interface EditBasicInfoInitial {
  name: string;
  kana: string | null;
  phone: string;
  email: string | null;
  postalCode: string | null;
  area: string | null;
  inflowRoute: InflowRoute | null;
  prefecture: string | null;
  city: string | null;
  addressLine: string | null;
  birthDate: string | null; // ISO
  buildYear: string | null; // ISO
  electricContractStatus: string | null;
  electricAccountNo: string | null;
  supplyPointNo: string | null;
  equipmentId: string | null;
}

const INFLOW_UNSET = "__unset__";

const FIELD =
  "h-9 w-full rounded-sm border border-hairline-light bg-white px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

// ISO → <input type="date"> 用 YYYY-MM-DD（ローカル日付）。
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const dt = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

function SaveCancelRow({
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
  const c = labels.common;
  const d = labels.customer.detail;
  return (
    <div className="flex justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onCancel}
        disabled={pending || !dirty}
      >
        {d.cancel}
      </Button>
      <Button type="button" size="sm" onClick={onSave} disabled={pending || !dirty}>
        {pending ? c.saving : c.save}
      </Button>
    </div>
  );
}

function EditField({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

interface AreaChoice {
  id: string;
  name: string;
}

/* ── 顧客情報（連絡先 + 現状情報）のカード内インライン編集 ── */

export function BasicInfoInlineEdit({
  customerId,
  initial,
  areas,
}: {
  customerId: string;
  initial: EditBasicInfoInitial;
  areas: AreaChoice[];
}) {
  const t = labels.customer;
  const d = t.detail;
  const router = useRouter();
  const [pending, start] = useTransition();

  const [name, setName] = useState(initial.name);
  const [kana, setKana] = useState(initial.kana ?? "");
  const [phone, setPhone] = useState(initial.phone);
  const [email, setEmail] = useState(initial.email ?? "");
  const [postalCode, setPostalCode] = useState(initial.postalCode ?? "");
  const [area, setArea] = useState(initial.area ?? "");
  const [inflowRoute, setInflowRoute] = useState<string>(initial.inflowRoute ?? INFLOW_UNSET);
  const [prefecture, setPrefecture] = useState(initial.prefecture ?? "");
  const [city, setCity] = useState(initial.city ?? "");
  const [addressLine, setAddressLine] = useState(initial.addressLine ?? "");
  const [birthDate, setBirthDate] = useState(toDateInput(initial.birthDate));
  const [buildYear, setBuildYear] = useState(toDateInput(initial.buildYear));
  const [electricContractStatus, setElectricContractStatus] = useState(
    initial.electricContractStatus ?? "",
  );
  const [electricAccountNo, setElectricAccountNo] = useState(initial.electricAccountNo ?? "");
  const [supplyPointNo, setSupplyPointNo] = useState(initial.supplyPointNo ?? "");
  const [equipmentId, setEquipmentId] = useState(initial.equipmentId ?? "");

  function reset() {
    setName(initial.name);
    setKana(initial.kana ?? "");
    setPhone(initial.phone);
    setEmail(initial.email ?? "");
    setPostalCode(initial.postalCode ?? "");
    setArea(initial.area ?? "");
    setInflowRoute(initial.inflowRoute ?? INFLOW_UNSET);
    setPrefecture(initial.prefecture ?? "");
    setCity(initial.city ?? "");
    setAddressLine(initial.addressLine ?? "");
    setBirthDate(toDateInput(initial.birthDate));
    setBuildYear(toDateInput(initial.buildYear));
    setElectricContractStatus(initial.electricContractStatus ?? "");
    setElectricAccountNo(initial.electricAccountNo ?? "");
    setSupplyPointNo(initial.supplyPointNo ?? "");
    setEquipmentId(initial.equipmentId ?? "");
  }

  const dirty =
    name !== initial.name ||
    kana !== (initial.kana ?? "") ||
    phone !== initial.phone ||
    email !== (initial.email ?? "") ||
    postalCode !== (initial.postalCode ?? "") ||
    area !== (initial.area ?? "") ||
    inflowRoute !== (initial.inflowRoute ?? INFLOW_UNSET) ||
    prefecture !== (initial.prefecture ?? "") ||
    city !== (initial.city ?? "") ||
    addressLine !== (initial.addressLine ?? "") ||
    birthDate !== toDateInput(initial.birthDate) ||
    buildYear !== toDateInput(initial.buildYear) ||
    electricContractStatus !== (initial.electricContractStatus ?? "") ||
    electricAccountNo !== (initial.electricAccountNo ?? "") ||
    supplyPointNo !== (initial.supplyPointNo ?? "") ||
    equipmentId !== (initial.equipmentId ?? "");

  function onSave() {
    const blank = (s: string) => (s.trim() ? s.trim() : undefined);
    start(async () => {
      try {
        const result = await updateCustomerAction({
          id: customerId,
          name: name.trim(),
          kana: blank(kana),
          phone: phone.trim(),
          email: blank(email),
          postalCode: blank(postalCode),
          area: area.trim().length > 0 ? area.trim() : null,
          inflowRoute: inflowRoute === INFLOW_UNSET ? null : (inflowRoute as InflowRoute),
          prefecture: prefecture.trim() || null,
          city: city.trim() || null,
          addressLine: addressLine.trim() || null,
          birthDate: birthDate || null,
          buildYear: buildYear || null,
          electricContractStatus: electricContractStatus.trim() || null,
          electricAccountNo: electricAccountNo.trim() || null,
          supplyPointNo: supplyPointNo.trim() || null,
          equipmentId: equipmentId.trim() || null,
        });
        if (result.duplicatePhoneWarning) {
          toast.warning(t.feedback.duplicatePhone);
        }
        toast.success(labels.common.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : labels.common.unknownError);
      }
    });
  }

  const f = d.fields;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        <EditField id="basic-name" label={t.fields.name}>
          <Input
            id="basic-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </EditField>
        <EditField id="basic-kana" label={f.kana}>
          <Input
            id="basic-kana"
            value={kana}
            onChange={(e) => setKana(e.target.value)}
            autoComplete="off"
          />
        </EditField>
        <EditField id="basic-inflow" label={f.inflowRoute}>
          <select
            id="basic-inflow"
            value={inflowRoute}
            onChange={(e) => setInflowRoute(e.target.value)}
            className={FIELD}
          >
            <option value={INFLOW_UNSET}>{d.unassigned}</option>
            <option value="EVENT">{d.inflowRouteLabels.EVENT}</option>
            <option value="OUTBOUND_CALL">{d.inflowRouteLabels.OUTBOUND_CALL}</option>
            <option value="DIRECT_VISIT">{d.inflowRouteLabels.DIRECT_VISIT}</option>
          </select>
        </EditField>
        <EditField id="basic-area" label={f.area}>
          <select
            id="basic-area"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            className={FIELD}
          >
            <option value="">{d.areaUnset}</option>
            {areas.map((a) => (
              <option key={a.id} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
        </EditField>
        <EditField id="basic-birth" label={f.birthDate}>
          <input
            id="basic-birth"
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            className={FIELD}
          />
        </EditField>
        <EditField id="basic-build" label={f.buildYear}>
          <input
            id="basic-build"
            type="date"
            value={buildYear}
            onChange={(e) => setBuildYear(e.target.value)}
            className={FIELD}
          />
        </EditField>
        <EditField id="basic-postal" label={f.postalCode}>
          <Input
            id="basic-postal"
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
            autoComplete="postal-code"
          />
        </EditField>
        <EditField id="basic-prefecture" label={f.prefecture}>
          <Input
            id="basic-prefecture"
            value={prefecture}
            onChange={(e) => setPrefecture(e.target.value)}
            autoComplete="address-level1"
          />
        </EditField>
        <EditField id="basic-city" label={f.city}>
          <Input
            id="basic-city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            autoComplete="address-level2"
          />
        </EditField>
        <EditField id="basic-address-line" label={f.addressLine}>
          <Input
            id="basic-address-line"
            value={addressLine}
            onChange={(e) => setAddressLine(e.target.value)}
          />
        </EditField>
        <EditField id="basic-phone" label={f.phone}>
          <Input
            id="basic-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
          />
        </EditField>
        <EditField id="basic-email" label={f.email}>
          <Input
            id="basic-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </EditField>
      </div>

      {/* 現状情報 — 電気契約・設備（識別子・ステータス。生値・編集可）。 */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-mute-light">
          {d.electricSection}
        </h3>
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <EditField id="basic-electric-status" label={f.electricContractStatus}>
            <Input
              id="basic-electric-status"
              value={electricContractStatus}
              onChange={(e) => setElectricContractStatus(e.target.value)}
              autoComplete="off"
            />
          </EditField>
          <EditField id="basic-account-no" label={f.electricAccountNo}>
            <Input
              id="basic-account-no"
              value={electricAccountNo}
              onChange={(e) => setElectricAccountNo(e.target.value)}
              autoComplete="off"
            />
          </EditField>
          <EditField id="basic-supply-point" label={f.supplyPointNo}>
            <Input
              id="basic-supply-point"
              value={supplyPointNo}
              onChange={(e) => setSupplyPointNo(e.target.value)}
              autoComplete="off"
            />
          </EditField>
          <EditField id="basic-equipment-id" label={f.equipmentId}>
            <Input
              id="basic-equipment-id"
              value={equipmentId}
              onChange={(e) => setEquipmentId(e.target.value)}
              autoComplete="off"
            />
          </EditField>
        </div>
      </div>

      <SaveCancelRow onSave={onSave} onCancel={reset} pending={pending} dirty={dirty} />
    </div>
  );
}

/* ── メモのカード内インライン編集（textarea を直接描画） ── */

export function MemoInlineEdit({
  customerId,
  initial,
}: {
  customerId: string;
  initial: { note: string | null };
}) {
  const d = labels.customer.detail;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState(initial.note ?? "");

  const dirty = note !== (initial.note ?? "");

  function onSave() {
    const trimmed = note.trim();
    start(async () => {
      try {
        await updateCustomerAction({ id: customerId, note: trimmed ? trimmed : undefined });
        toast.success(labels.common.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : labels.common.unknownError);
      }
    });
  }

  return (
    <div className="space-y-3">
      <Label htmlFor="basic-memo" className="sr-only">
        {d.memo}
      </Label>
      <textarea
        id="basic-memo"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={6}
        placeholder={d.memoPlaceholder}
        className="w-full resize-y rounded-sm border border-hairline-light bg-white px-3 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
      <SaveCancelRow
        onSave={onSave}
        onCancel={() => setNote(initial.note ?? "")}
        pending={pending}
        dirty={dirty}
      />
    </div>
  );
}
