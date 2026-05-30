"use server";

// Application Server Actions — T-05-11 / F-045 / docs/05 §3.6 §4.8.
//
// createApplicationAction:      Creates an Application record for a given contract.
// updateApplicationAction:      Updates metadata (type, agency, dates, amounts, note).
// changeApplicationStatusAction: Validates state-machine transition and updates status.
//                                APPROVED requires confirmedAmount.
//
// wholesalerId never comes from input — always from ctx (RLS enforced).

import { revalidatePath } from "next/cache";

import {
  ApplicationChangeStatusSchema,
  ApplicationCreateSchema,
  ApplicationUpdateSchema,
  VALID_APPLICATION_TRANSITIONS,
  type ApplicationChangeStatusInput,
  type ApplicationCreateInput,
  type ApplicationUpdateInput,
} from "@solar/contracts";
import type { ApplicationStatus } from "@solar/db";

import { InvalidStateTransitionError, NotFoundError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface ApplicationResult {
  id: string;
  contractId: string;
  type: string;
  agency: string | null;
  plannedDate: string | null;
  submittedDate: string | null;
  approvedDate: string | null;
  status: ApplicationStatus;
  estimatedAmount: string | null;
  confirmedAmount: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// createApplicationAction
// ---------------------------------------------------------------------------

export const createApplicationAction = withServerActionContext<
  ApplicationCreateInput,
  ApplicationResult
>(
  { action: "application.manage" },
  async ({ tx, input }) => {
    const parsed = ApplicationCreateSchema.parse(input);

    const contract = await tx.contract.findUnique({
      where: { id: parsed.contractId },
      select: { id: true, status: true },
    });
    if (!contract) throw new NotFoundError("契約が見つかりません");
    if (contract.status === "CANCELLED") {
      throw new InvalidStateTransitionError("キャンセルされた契約には申請を登録できません");
    }

    const row = await tx.application.create({
      data: {
        contractId: parsed.contractId,
        type: parsed.type,
        agency: parsed.agency ?? null,
        plannedDate: parsed.plannedDate ? new Date(parsed.plannedDate) : null,
        expectedAmount: parsed.estimatedAmount ?? null,
        note: parsed.note ?? null,
      },
      select: SELECT_FIELDS,
    });

    revalidatePath(`/contracts/${parsed.contractId}`);
    revalidatePath(`/contracts/${parsed.contractId}/application`);

    return toApplicationResult(row);
  },
);

// ---------------------------------------------------------------------------
// updateApplicationAction
// ---------------------------------------------------------------------------

export const updateApplicationAction = withServerActionContext<
  ApplicationUpdateInput,
  ApplicationResult
>(
  { action: "application.manage" },
  async ({ tx, input }) => {
    const parsed = ApplicationUpdateSchema.parse(input);

    const existing = await tx.application.findUnique({
      where: { id: parsed.id },
      select: { id: true, contractId: true },
    });
    if (!existing) throw new NotFoundError("申請情報が見つかりません");

    const updated = await tx.application.update({
      where: { id: parsed.id },
      data: {
        ...(parsed.type !== undefined ? { type: parsed.type } : {}),
        ...(parsed.agency !== undefined ? { agency: parsed.agency } : {}),
        ...(parsed.plannedDate !== undefined
          ? { plannedDate: parsed.plannedDate ? new Date(parsed.plannedDate) : null }
          : {}),
        ...(parsed.submittedDate !== undefined
          ? { submittedDate: parsed.submittedDate ? new Date(parsed.submittedDate) : null }
          : {}),
        ...(parsed.approvedDate !== undefined
          ? { approvedDate: parsed.approvedDate ? new Date(parsed.approvedDate) : null }
          : {}),
        ...(parsed.estimatedAmount !== undefined ? { expectedAmount: parsed.estimatedAmount } : {}),
        ...(parsed.confirmedAmount !== undefined ? { grantedAmount: parsed.confirmedAmount } : {}),
        ...(parsed.note !== undefined ? { note: parsed.note } : {}),
      },
      select: SELECT_FIELDS,
    });

    revalidatePath(`/contracts/${existing.contractId}`);
    revalidatePath(`/contracts/${existing.contractId}/application`);

    return toApplicationResult(updated);
  },
);

// ---------------------------------------------------------------------------
// changeApplicationStatusAction
// ---------------------------------------------------------------------------

export const changeApplicationStatusAction = withServerActionContext<
  ApplicationChangeStatusInput,
  ApplicationResult
>(
  { action: "application.manage" },
  async ({ tx, input }) => {
    const parsed = ApplicationChangeStatusSchema.parse(input);

    const existing = await tx.application.findUnique({
      where: { id: parsed.id },
      select: { id: true, contractId: true, status: true },
    });
    if (!existing) throw new NotFoundError("申請情報が見つかりません");

    const allowed = VALID_APPLICATION_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(parsed.status)) {
      throw new InvalidStateTransitionError(
        `${existing.status} から ${parsed.status} への遷移はできません`,
        { from: existing.status, to: parsed.status },
      );
    }

    const approvedDate =
      parsed.status === "APPROVED" ? new Date() : undefined;
    const submittedDate =
      parsed.status === "SUBMITTED" ? new Date() : undefined;

    const updated = await tx.application.update({
      where: { id: parsed.id },
      data: {
        status: parsed.status,
        ...(approvedDate !== undefined ? { approvedDate } : {}),
        ...(submittedDate !== undefined ? { submittedDate } : {}),
        ...(parsed.confirmedAmount !== undefined
          ? { grantedAmount: parsed.confirmedAmount }
          : {}),
      },
      select: SELECT_FIELDS,
    });

    revalidatePath(`/contracts/${existing.contractId}`);
    revalidatePath(`/contracts/${existing.contractId}/application`);

    return toApplicationResult(updated);
  },
);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const SELECT_FIELDS = {
  id: true,
  contractId: true,
  type: true,
  agency: true,
  plannedDate: true,
  submittedDate: true,
  approvedDate: true,
  status: true,
  expectedAmount: true,
  grantedAmount: true,
  note: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toApplicationResult(row: {
  id: string;
  contractId: string;
  type: string;
  agency: string | null;
  plannedDate: Date | null;
  submittedDate: Date | null;
  approvedDate: Date | null;
  status: ApplicationStatus;
  expectedAmount: { toString(): string } | null;
  grantedAmount: { toString(): string } | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ApplicationResult {
  return {
    id: row.id,
    contractId: row.contractId,
    type: row.type,
    agency: row.agency,
    plannedDate: row.plannedDate?.toISOString() ?? null,
    submittedDate: row.submittedDate?.toISOString() ?? null,
    approvedDate: row.approvedDate?.toISOString() ?? null,
    status: row.status,
    estimatedAmount: row.expectedAmount?.toString() ?? null,
    confirmedAmount: row.grantedAmount?.toString() ?? null,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
