"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import {
  CONSTRUCTION_STATUS_VALUES,
  CONTRACT_STATUS_VALUES,
  SUBSIDY_STATUS_VALUES,
} from "./constants";
import type { MaekakuValue } from "./constants";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-hairline-light bg-white px-3 py-1 text-sm text-body-light focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary";

const CONTRACT_OPTIONS = CONTRACT_STATUS_VALUES;
const CONSTRUCTION_OPTIONS = CONSTRUCTION_STATUS_VALUES;
const SUBSIDY_OPTIONS = SUBSIDY_STATUS_VALUES;
const MAEKAKU_OPTIONS: MaekakuValue[] = ["present", "absent"];

interface AssigneeOption {
  id: string;
  name: string;
}

interface CustomerFilterProps {
  query: string;
  assigneeUserId: string;
  contractStatus: string;
  constructionStatus: string;
  subsidyStatus: string;
  maekaku: string;
  assignees: AssigneeOption[];
}

export function CustomerFilter({
  query,
  assigneeUserId,
  contractStatus,
  constructionStatus,
  subsidyStatus,
  maekaku,
  assignees,
}: CustomerFilterProps) {
  const router = useRouter();
  const t = labels.customer;

  // Local-only state; nothing is applied to the URL until 検索 is clicked.
  const [searchValue, setSearchValue] = useState(query);
  const [assigneeValue, setAssigneeValue] = useState(assigneeUserId);
  const [contractValue, setContractValue] = useState(contractStatus);
  const [constructionValue, setConstructionValue] = useState(constructionStatus);
  const [subsidyValue, setSubsidyValue] = useState(subsidyStatus);
  const [maekakuValue, setMaekakuValue] = useState(maekaku);

  function applyFilters() {
    const params = new URLSearchParams();
    const q = searchValue.trim();
    if (q) params.set("query", q);
    if (assigneeValue) params.set("assigneeUserId", assigneeValue);
    if (contractValue) params.set("contractStatus", contractValue);
    if (constructionValue) params.set("constructionStatus", constructionValue);
    if (subsidyValue) params.set("subsidyStatus", subsidyValue);
    if (maekakuValue) params.set("maekaku", maekakuValue);
    const qs = params.toString();
    router.push(qs ? `/customers?${qs}` : "/customers");
  }

  function clearFilters() {
    setSearchValue("");
    setAssigneeValue("");
    setContractValue("");
    setConstructionValue("");
    setSubsidyValue("");
    setMaekakuValue("");
    router.push("/customers");
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        applyFilters();
      }}
    >
      {/* 検索 — 単一ボーダー入力（アイコンなし・二重枠/ネイティブ枠を排除） */}
      <input
        type="search"
        value={searchValue}
        onChange={(e) => setSearchValue(e.target.value)}
        placeholder={t.searchPlaceholderFull}
        aria-label={t.searchPlaceholderFull}
        className="h-10 w-full max-w-sm appearance-none rounded-md border border-cloud-gray bg-white px-3 text-sm text-ink placeholder:text-mute-light focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 [&::-webkit-search-cancel-button]:appearance-none"
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-mute-light">{t.filters.assignee}</label>
          <select
            value={assigneeValue}
            onChange={(e) => setAssigneeValue(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">{t.filters.all}</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-mute-light">{t.filters.contractStatus}</label>
          <select
            value={contractValue}
            onChange={(e) => setContractValue(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">{t.filters.all}</option>
            {CONTRACT_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t.contractStatusLabels[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-mute-light">
            {t.filters.constructionStatus}
          </label>
          <select
            value={constructionValue}
            onChange={(e) => setConstructionValue(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">{t.filters.all}</option>
            {CONSTRUCTION_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t.constructionStatusLabels[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-mute-light">{t.filters.subsidyStatus}</label>
          <select
            value={subsidyValue}
            onChange={(e) => setSubsidyValue(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">{t.filters.all}</option>
            {SUBSIDY_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t.subsidyStatusLabels[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-mute-light">{t.filters.maekaku}</label>
          <select
            value={maekakuValue}
            onChange={(e) => setMaekakuValue(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">{t.filters.all}</option>
            {MAEKAKU_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {t.maekakuLabels[m]}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit">{t.filters.search}</Button>
        <Button type="button" variant="outline" onClick={clearFilters}>
          {t.filters.clear}
        </Button>
      </div>
    </form>
  );
}
