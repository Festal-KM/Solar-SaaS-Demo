"use server";

// Wholesaler-settings Server Action (T-02-07 / F-015 §F-016 / docs/05 §3.2 §3.7).
//
// 1 アクション (`updateWholesalerSettingsAction`) のみ。`wholesalerId` は
// テナント文脈 (ctx) から取得し、入力には載せない（クロステナント書き込み防止）。
//
// upsert で堅牢化: WholesalerSettings レコードは Tenant 作成時に既定値で
// 自動作成される設計だが、欠損ケースに備えて create 経路を用意する。
//
// 過去契約への遡及禁止: `cancelDeadlineDays` の変更は将来契約のみに適用される。
// 過去契約は `Contract.cancelDeadline` に契約成立時点の snapshot を持つ（T-05
// で実装）。本 Server Action は既存 Contract レコードを書き換えない。
//
// AuditLog: 変更前後の値を JSONB で記録する（action=UPDATE、targetType=
// "WholesalerSettings"、targetId=wholesalerId）。SP-07 で SETTINGS_CHANGE 等の
// 専用 enum 追加を検討するが、本 MVP では UPDATE で十分。

import {
  WHOLESALER_SETTINGS_DEFAULTS,
  WholesalerSettingsUpdateSchema,
  type WholesalerSettingsUpdate,
} from "@solar/contracts";
import { revalidatePath } from "next/cache";

import { ValidationError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

const SETTINGS_PATH = "/masters/wholesaler-settings";

export interface UpdateWholesalerSettingsResult {
  wholesalerId: string;
}

export const updateWholesalerSettingsAction = withServerActionContext<
  WholesalerSettingsUpdate,
  UpdateWholesalerSettingsResult
>(
  {
    action: "wholesaler_settings.update",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("wholesalerId is required for wholesaler settings");
    }
    const parsed = WholesalerSettingsUpdateSchema.parse(input);

    const wholesalerId = ctx.wholesalerId;

    // 変更前の値を取得（AuditLog の before に格納）。レコードが無ければデフォルト
    // 値（@default と一致）を before とみなす。
    const existing = await tx.wholesalerSettings.findUnique({
      where: { wholesalerId },
      select: {
        cancelDeadlineDays: true,
        fiscalYearStartMonth: true,
        piiMaskingMode: true,
      },
    });
    const before = existing ?? { ...WHOLESALER_SETTINGS_DEFAULTS };

    // 差分のみを update に渡す。空 patch（何も指定しない）でも upsert で
    // create 経路を走らせて堅牢化する。
    const updatePayload = {
      ...(parsed.cancelDeadlineDays !== undefined
        ? { cancelDeadlineDays: parsed.cancelDeadlineDays }
        : {}),
      ...(parsed.fiscalYearStartMonth !== undefined
        ? { fiscalYearStartMonth: parsed.fiscalYearStartMonth }
        : {}),
      ...(parsed.piiMaskingMode !== undefined ? { piiMaskingMode: parsed.piiMaskingMode } : {}),
    };

    const upserted = await tx.wholesalerSettings.upsert({
      where: { wholesalerId },
      update: updatePayload,
      create: {
        wholesalerId,
        ...updatePayload,
      },
      select: {
        wholesalerId: true,
        cancelDeadlineDays: true,
        fiscalYearStartMonth: true,
        piiMaskingMode: true,
      },
    });

    const after = {
      cancelDeadlineDays: upserted.cancelDeadlineDays,
      fiscalYearStartMonth: upserted.fiscalYearStartMonth,
      piiMaskingMode: upserted.piiMaskingMode,
    };

    // 値変更が一切無い場合は AuditLog を残さない（誤クリック保護）。
    const changed =
      before.cancelDeadlineDays !== after.cancelDeadlineDays ||
      before.fiscalYearStartMonth !== after.fiscalYearStartMonth ||
      before.piiMaskingMode !== after.piiMaskingMode;

    if (changed && ctx.tenantId) {
      await tx.auditLog.create({
        data: {
          actorUserId: ctx.actorUserId,
          tenantId: ctx.tenantId,
          targetType: "WholesalerSettings",
          targetId: wholesalerId,
          action: "UPDATE",
          before,
          after,
        },
      });
    }

    revalidatePath(SETTINGS_PATH);
    return { wholesalerId: upserted.wholesalerId };
  },
);
