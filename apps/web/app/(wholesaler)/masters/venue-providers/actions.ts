"use server";

// Venue-provider master Server Actions (T-02-02 / F-011 / docs/05 §4.4).
//
// Three actions wired through the canonical `withServerActionContext`
// three-step idiom (auth → assertCan → withTenant). The wholesalerId is
// injected from the tenant context — callers MUST NOT pass it as input.
//
// Soft delete: `disable` flips `isActive=false`; rows are never physically
// removed so historical references from event candidates / venue negotiations
// keep resolving.

import {
  VenueProviderInputSchema,
  VenueProviderUpdateSchema,
  type VenueProviderInput,
  type VenueProviderUpdate,
} from "@solar/contracts";
import { revalidatePath } from "next/cache";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

const LIST_PATH = "/masters/venue-providers";

export interface CreateVenueProviderResult {
  id: string;
}

export const createVenueProviderAction = withServerActionContext<
  VenueProviderInput,
  CreateVenueProviderResult
>(
  {
    action: "venue_provider.create",
    // Inject wholesalerId from the caller's tenant; `assertCan` will reject
    // any cross-tenant attempt before the DB call.
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("wholesalerId is required for venue provider master");
    }
    const parsed = VenueProviderInputSchema.parse(input);

    const created = await tx.venueProvider.create({
      data: {
        wholesalerId: ctx.wholesalerId,
        name: parsed.name,
        contactName: parsed.contactName,
        phone: parsed.phone,
        email: parsed.email,
        postalCode: parsed.postalCode,
        address: parsed.address,
        area: parsed.area,
        contractType: parsed.contractType,
        fixedFee: parsed.fixedFee,
        performanceRate: parsed.performanceRate,
        note: parsed.note,
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    return { id: created.id };
  },
);

export interface UpdateVenueProviderInput {
  id: string;
  patch: VenueProviderUpdate;
}

export interface UpdateVenueProviderResult {
  id: string;
}

export const updateVenueProviderAction = withServerActionContext<
  UpdateVenueProviderInput,
  UpdateVenueProviderResult
>(
  {
    action: "venue_provider.update",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, input }) => {
    const parsed = VenueProviderUpdateSchema.parse(input.patch);

    // RLS via withTenant() restricts the row visibility, so a missing row
    // is indistinguishable from a cross-tenant access attempt — both surface
    // as NotFound which is the documented behaviour (docs/05 §9.1).
    const existing = await tx.venueProvider.findUnique({
      where: { id: input.id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundError("場所提供元が見つかりません");
    }

    const updated = await tx.venueProvider.update({
      where: { id: input.id },
      data: {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...("contactName" in parsed ? { contactName: parsed.contactName } : {}),
        ...("phone" in parsed ? { phone: parsed.phone } : {}),
        ...("email" in parsed ? { email: parsed.email } : {}),
        ...("postalCode" in parsed ? { postalCode: parsed.postalCode } : {}),
        ...("address" in parsed ? { address: parsed.address } : {}),
        ...("area" in parsed ? { area: parsed.area } : {}),
        ...("contractType" in parsed ? { contractType: parsed.contractType } : {}),
        ...("fixedFee" in parsed ? { fixedFee: parsed.fixedFee } : {}),
        ...("performanceRate" in parsed ? { performanceRate: parsed.performanceRate } : {}),
        ...("note" in parsed ? { note: parsed.note } : {}),
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${input.id}`);
    return { id: updated.id };
  },
);

export interface DisableVenueProviderInput {
  id: string;
}

export interface DisableVenueProviderResult {
  id: string;
}

export const disableVenueProviderAction = withServerActionContext<
  DisableVenueProviderInput,
  DisableVenueProviderResult
>(
  {
    action: "venue_provider.update",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, input }) => {
    const existing = await tx.venueProvider.findUnique({
      where: { id: input.id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundError("場所提供元が見つかりません");
    }

    const updated = await tx.venueProvider.update({
      where: { id: input.id },
      data: { isActive: false },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${input.id}`);
    return { id: updated.id };
  },
);
