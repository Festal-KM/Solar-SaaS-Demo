"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { CONTRACT_STATUS_VALUES } from "./constants";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-hairline-light bg-white px-3 py-1 text-sm text-body-light focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary";

const CONTRACT_OPTIONS = CONTRACT_STATUS_VALUES;

interface AssigneeOption {
  id: string;
  name: string;
}

interface CustomerFilterProps {
  query: string;
  assigneeUserId: string;
  contractStatus: string;
  assignees: AssigneeOption[];
}

export function CustomerFilter({
  query,
  assigneeUserId,
  contractStatus,
  assignees,
}: CustomerFilterProps) {
  const router = useRouter();
  const t = labels.customer;

  // Local-only state; nothing is applied to the URL until 検索 is clicked.
  const [searchValue, setSearchValue] = useState(query);
  const [assigneeValue, setAssigneeValue] = useState(assigneeUserId);
  const [contractValue, setContractValue] = useState(contractStatus);

  function applyFilters() {
    const params = new URLSearchParams();
    const q = searchValue.trim();
    if (q) params.set("query", q);
    if (assigneeValue) params.set("assigneeUserId", assigneeValue);
    if (contractValue) params.set("contractStatus", contractValue);
    const qs = params.toString();
    router.push(qs ? `/customers?${qs}` : "/customers");
  }

  function clearFilters() {
    setSearchValue("");
    setAssigneeValue("");
    setContractValue("");
    router.push("/customers");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        applyFilters();
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        {/* 顧客名 — 単一ボーダー入力（アイコンなし・二重枠/ネイティブ枠を排除） */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-mute-light">{t.filters.customerName}</label>
          <input
            type="search"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder={t.searchPlaceholderFull}
            aria-label={t.searchPlaceholderFull}
            className="h-9 w-56 appearance-none rounded-md border border-hairline-light bg-white px-3 text-sm text-ink placeholder:text-mute-light focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 [&::-webkit-search-cancel-button]:appearance-none"
          />
        </div>

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

        <Button type="submit">{t.filters.search}</Button>
        <Button type="button" variant="outline" onClick={clearFilters}>
          {t.filters.clear}
        </Button>
      </div>
    </form>
  );
}
