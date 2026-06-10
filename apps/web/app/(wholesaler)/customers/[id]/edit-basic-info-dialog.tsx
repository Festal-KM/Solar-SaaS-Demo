"use client";

// 顧客詳細ページ 基本情報カードのインライン編集ダイアログ (F-031 / docs/04 §1.3).
// マスク前の生値を props で受け取りフォーム初期値とする（マスク値を保存し戻さない）。

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
import { labels } from "@/lib/i18n/labels";

import { updateCustomerAction } from "../actions";

import type { InflowRoute } from "@solar/contracts";

export interface EditBasicInfoInitial {
  name: string;
  kana: string | null;
  phone: string;
  email: string | null;
  postalCode: string | null;
  address: string | null;
  area: string | null;
  inflowRoute: InflowRoute | null;
  prefecture: string | null;
  city: string | null;
  addressLine: string | null;
  birthDate: string | null; // ISO
  buildYear: string | null; // ISO
  tossDept: string | null;
  belongDept: string | null;
}

const INFLOW_UNSET = "__unset__";

// ISO → <input type="date"> 用 YYYY-MM-DD。
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const dt = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

interface AreaChoice {
  id: string;
  name: string;
}

interface EditBasicInfoDialogProps {
  customerId: string;
  initial: EditBasicInfoInitial;
  areas: AreaChoice[];
}

export function EditBasicInfoDialog({ customerId, initial, areas }: EditBasicInfoDialogProps) {
  const t = labels.customer;
  const d = t.detail;
  const c = labels.common;
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(initial.name);
  const [kana, setKana] = useState(initial.kana ?? "");
  const [phone, setPhone] = useState(initial.phone);
  const [email, setEmail] = useState(initial.email ?? "");
  const [postalCode, setPostalCode] = useState(initial.postalCode ?? "");
  const [address, setAddress] = useState(initial.address ?? "");
  const [area, setArea] = useState(initial.area ?? "");
  const [inflowRoute, setInflowRoute] = useState<string>(initial.inflowRoute ?? INFLOW_UNSET);
  const [prefecture, setPrefecture] = useState(initial.prefecture ?? "");
  const [city, setCity] = useState(initial.city ?? "");
  const [addressLine, setAddressLine] = useState(initial.addressLine ?? "");
  const [birthDate, setBirthDate] = useState(toDateInput(initial.birthDate));
  const [buildYear, setBuildYear] = useState(toDateInput(initial.buildYear));
  const [tossDept, setTossDept] = useState(initial.tossDept ?? "");
  const [belongDept, setBelongDept] = useState(initial.belongDept ?? "");

  // Reset fields to raw values whenever the dialog is (re)opened.
  function onOpenChange(next: boolean) {
    if (next) {
      setName(initial.name);
      setKana(initial.kana ?? "");
      setPhone(initial.phone);
      setEmail(initial.email ?? "");
      setPostalCode(initial.postalCode ?? "");
      setAddress(initial.address ?? "");
      setArea(initial.area ?? "");
      setInflowRoute(initial.inflowRoute ?? INFLOW_UNSET);
      setPrefecture(initial.prefecture ?? "");
      setCity(initial.city ?? "");
      setAddressLine(initial.addressLine ?? "");
      setBirthDate(toDateInput(initial.birthDate));
      setBuildYear(toDateInput(initial.buildYear));
      setTossDept(initial.tossDept ?? "");
      setBelongDept(initial.belongDept ?? "");
    }
    setOpen(next);
  }

  function handleSave() {
    const blank = (s: string) => (s.trim() ? s.trim() : undefined);
    startTransition(async () => {
      try {
        const result = await updateCustomerAction({
          id: customerId,
          name: name.trim(),
          kana: blank(kana),
          phone: phone.trim(),
          email: blank(email),
          postalCode: blank(postalCode),
          address: blank(address),
          area: area.trim().length > 0 ? area.trim() : null,
          inflowRoute: inflowRoute === INFLOW_UNSET ? null : (inflowRoute as InflowRoute),
          prefecture: prefecture.trim() || null,
          city: city.trim() || null,
          addressLine: addressLine.trim() || null,
          birthDate: birthDate || null,
          buildYear: buildYear || null,
          tossDept: tossDept.trim() || null,
          belongDept: belongDept.trim() || null,
        });
        if (result.duplicatePhoneWarning) {
          toast.warning(t.feedback.duplicatePhone);
        }
        toast.success(c.saved);
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-mute-light hover:text-ink"
          aria-label={d.editBasicInfo}
        >
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{d.editBasicInfo}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-basic-name">{t.fields.name}</Label>
            <Input
              id="edit-basic-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-basic-kana">{d.fields.kana}</Label>
            <Input
              id="edit-basic-kana"
              value={kana}
              onChange={(e) => setKana(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-basic-postal">{d.fields.postalCode}</Label>
            <Input
              id="edit-basic-postal"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              autoComplete="postal-code"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-basic-area">{d.fields.area}</Label>
            <select
              id="edit-basic-area"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              className="h-9 w-full rounded-sm border border-hairline-light bg-white px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">{d.areaUnset}</option>
              {areas.map((a) => (
                <option key={a.id} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-basic-address">{d.fields.address}</Label>
            <Input
              id="edit-basic-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              autoComplete="street-address"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-basic-phone">{d.fields.phone}</Label>
            <Input
              id="edit-basic-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-basic-email">{d.fields.email}</Label>
            <Input
              id="edit-basic-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-basic-inflow">{d.fields.inflowRoute}</Label>
            <select
              id="edit-basic-inflow"
              value={inflowRoute}
              onChange={(e) => setInflowRoute(e.target.value)}
              className="h-9 w-full rounded-sm border border-hairline-light bg-white px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value={INFLOW_UNSET}>{d.unassigned}</option>
              <option value="EVENT">{d.inflowRouteLabels.EVENT}</option>
              <option value="OUTBOUND_CALL">{d.inflowRouteLabels.OUTBOUND_CALL}</option>
              <option value="DIRECT_VISIT">{d.inflowRouteLabels.DIRECT_VISIT}</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-basic-prefecture">{d.fields.prefecture}</Label>
              <Input
                id="edit-basic-prefecture"
                value={prefecture}
                onChange={(e) => setPrefecture(e.target.value)}
                autoComplete="address-level1"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-basic-city">{d.fields.city}</Label>
              <Input
                id="edit-basic-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                autoComplete="address-level2"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-basic-address-line">{d.fields.addressLine}</Label>
            <Input
              id="edit-basic-address-line"
              value={addressLine}
              onChange={(e) => setAddressLine(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-basic-birth">{d.fields.birthDate}</Label>
              <Input
                id="edit-basic-birth"
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-basic-build">{d.fields.buildYear}</Label>
              <Input
                id="edit-basic-build"
                type="date"
                value={buildYear}
                onChange={(e) => setBuildYear(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-basic-toss-dept">{d.fields.tossDept}</Label>
              <Input
                id="edit-basic-toss-dept"
                value={tossDept}
                onChange={(e) => setTossDept(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-basic-belong-dept">{d.fields.belongDept}</Label>
              <Input
                id="edit-basic-belong-dept"
                value={belongDept}
                onChange={(e) => setBelongDept(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            {d.cancel}
          </Button>
          <Button type="button" onClick={handleSave} disabled={isPending}>
            {isPending ? c.saving : d.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
