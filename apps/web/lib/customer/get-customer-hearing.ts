// F-063「住環境・家族属性ヒアリング」単体読み取りローダ（docs/05 §17.9）。
//
// 責務: Customer を起点に F-063 ヒアリング項目（家族属性・分離電話・案内者・提案商材・
// マエカク希望日時・既設設備の現況・代表アポ取得日）を **読むだけ**。書かない。
// マスキング・二次店物理除外は ProjectInfoDto.hearing と同一規則を適用する（§17.5）。
//
// 適用順（必須）:
//   1. withTenant(ctx, ...) で RLS/extension の二重防御を確立（最外）。
//   2. DTO 整形時に MaskingService（家族年齢=年代 / 分離電話=下4桁）を適用。
//   3. 二次店ロールでは既設設備の詳細キーを destructure-and-rest で物理除去
//      （DEALER_OMITTED_EXISTING_EQUIPMENT_KEYS、Object.keys に出さない／#5）。

import "server-only";

import { stripExistingEquipmentForDealer } from "@solar/contracts/dto/project-info";
import {
  maskFamilyAge,
  maskLandlinePhone,
  maskMobilePhone,
} from "@solar/contracts/services/masking";

import { NotFoundError } from "@/lib/errors";
import { withTenant } from "@/lib/tenancy/with-tenant";

import type {
  CustomerHearingDto,
  CustomerHearingForDealerDto,
} from "@solar/contracts/dto/project-info";
import type { ViewerContext } from "@solar/contracts/services/masking";
import type { TenantContext } from "@solar/db";

function isoOrNull(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function decimalToNumber(d: { toString(): string } | null | undefined): number | null {
  if (d == null) return null;
  const n = Number(d.toString());
  return Number.isNaN(n) ? null : n;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Read the F-063 hearing aggregate for a single customer under an active
 * `withTenant` scope. PII (family age / split phones) is masked per `viewer`;
 * dealers additionally get the existing-equipment detail keys physically
 * removed. Throws `NotFoundError` when the customer is out of tenant scope.
 */
export async function getCustomerHearing(
  ctx: TenantContext,
  customerId: string,
  viewer: ViewerContext,
): Promise<CustomerHearingDto | CustomerHearingForDealerDto> {
  return withTenant(ctx, async (tx) => {
    const customer = await tx.customer.findUnique({
      where: { id: customerId },
      select: {
        husbandAge: true,
        wifeAge: true,
        childAge: true,
        household: true,
        guideAttendee: true,
        faceToFace: true,
        proposedProduct: true,
        landlinePhone: true,
        mobilePhone: true,
        maekakuPreferredAt: true,
        existingEquipments: {
          orderBy: { category: "asc" },
          select: {
            id: true,
            category: true,
            installed: true,
            installDate: true,
            maker: true,
            capacityKw: true,
            panelCount: true,
            attributes: true,
          },
        },
        appointments: {
          where: { acquiredAt: { not: null } },
          orderBy: { acquiredAt: "desc" },
          take: 1,
          select: { acquiredAt: true },
        },
      },
    });
    if (!customer) {
      throw new NotFoundError("Customer not found in tenant scope");
    }

    const isDealer = viewer.tenantType === "DEALER";

    const equipments = customer.existingEquipments.map((eq) => ({
      id: eq.id,
      category: eq.category,
      installed: eq.installed,
      installDate: isoOrNull(eq.installDate),
      maker: eq.maker,
      capacityKw: decimalToNumber(eq.capacityKw),
      panelCount: eq.panelCount,
      attributes: asRecord(eq.attributes),
    }));

    const hearing: CustomerHearingDto = {
      husbandAge: maskFamilyAge(customer.husbandAge, viewer),
      wifeAge: maskFamilyAge(customer.wifeAge, viewer),
      childAge: maskFamilyAge(customer.childAge, viewer),
      household: customer.household,
      guideAttendee: customer.guideAttendee,
      faceToFace: customer.faceToFace,
      proposedProduct: customer.proposedProduct,
      landlinePhone: maskLandlinePhone(customer.landlinePhone, viewer),
      mobilePhone: maskMobilePhone(customer.mobilePhone, viewer),
      maekakuPreferredAt: isoOrNull(customer.maekakuPreferredAt),
      acquiredAt: isoOrNull(customer.appointments[0]?.acquiredAt ?? null),
      existingEquipments: equipments,
    };

    if (isDealer) {
      return {
        ...hearing,
        existingEquipments: hearing.existingEquipments.map(stripExistingEquipmentForDealer),
      };
    }
    return hearing;
  });
}
