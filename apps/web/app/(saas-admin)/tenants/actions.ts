"use server";

// SaaS-admin tenant Server Actions (T-02-08 / F-004 / docs/05 §4.3).
//
// Three actions:
//   - `createTenantAction(input)`   — 卸業者テナント + 初期 wholesaler_admin
//     ユーザー (INVITED) + WholesalerSettings + UserInvitation を 1 transaction
//     で作成し、招待メールを送信する。SAAS_ADMIN 専用。
//   - `resendInvitationAction({tenantId})` — 期限経過後（7 日）に招待を再発行。
//     旧 UserInvitation 行は acceptedAt を立てて失効させ、新トークンを発行。
//   - `updateTenantStatusAction({tenantId, status})` — ACTIVE / SUSPENDED の
//     切り替え。AuditLog に STATUS_CHANGE を記録（before/after）。
//
// すべての action は `withServerActionContext` の三段ガード (auth → assertCan →
// withTenant) を踏み、saas_admin が `assertCan` を最初の return で抜けるので、
// 非 saas_admin は ForbiddenError で 403 となる。SAAS_ADMIN のとき
// `getTenantContext()` は `{isSaasAdmin: true}` を返し、`withTenant` は
// RLS を完全バイパスする (docs/05 §3.9 §6.6)。

import { randomBytes } from "node:crypto";

import { hashPassword } from "@solar/auth";
import {
  CreateTenantSchema,
  TenantUpdateSchema,
  type CreateTenantInput,
  type TenantStatusValue,
} from "@solar/contracts";
import { defaultEmailClient, sendUserInviteEmail, type EmailClient } from "@solar/email";
import { revalidatePath } from "next/cache";

import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

const LIST_PATH = "/tenants";
const DASHBOARD_PATH = "/";
const INVITATION_TTL_DAYS = 7;
const INVITATION_TTL_MS = INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000;

// `sendUserInviteEmail` は EmailClient を引数で受けるので、SP-02 ではテスト時に
// 差し替え可能な形を保ちつつ、本実装は `defaultEmailClient` を直接使う。
// `emailClient` injection を Server Action の引数に持ち込むと "use server" 経由で
// シリアライズ不能なオブジェクトを渡せず壊れるため、production パスは module
// scoped にする。テストでは vi.mock で `@solar/email` を差し替える。
function getEmailClient(): EmailClient {
  return defaultEmailClient;
}

function buildInviteUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/invite/${token}`;
}

export interface CreateTenantResult {
  tenantId: string;
  inviteUrl: string;
  invitationId: string;
  expiresAt: string;
}

export const createTenantAction = withServerActionContext<CreateTenantInput, CreateTenantResult>(
  {
    action: "tenant.create",
  },
  async ({ tx, ctx, input }) => {
    const parsed = CreateTenantSchema.parse(input);

    // 同一メールアドレスで既存ユーザーが存在する場合は 409。RLS は saas_admin
    // バイパス済みなので、全テナント横断で findUnique が可視。
    const existing = await tx.user.findUnique({
      where: { email: parsed.adminEmail },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError(
        "同一メールアドレスで既に管理者ユーザーが存在します。別のメールを指定してください。",
        { email: parsed.adminEmail },
      );
    }

    // 1) Tenant 行 (type=WHOLESALER, status=ACTIVE) を作成
    const tenant = await tx.tenant.create({
      data: {
        type: parsed.type,
        name: parsed.name,
        plan: parsed.plan,
        status: "ACTIVE",
      },
      select: { id: true },
    });

    // 2) WholesalerSettings 既定値で生成 (cancelDeadlineDays=8, fiscalYearStartMonth=4)
    await tx.wholesalerSettings.create({
      data: { wholesalerId: tenant.id },
    });

    // 3) 初期 wholesaler_admin User を INVITED 状態で作成（password_hash は null）
    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: parsed.adminEmail,
        name: parsed.adminName,
        status: "INVITED",
        // WHOLESALER_ADMIN は 2FA 必須（docs/05 §3.2 / packages/auth ROLES_REQUIRING_2FA）
        twoFactorRequired: true,
      },
      select: { id: true },
    });
    await tx.userRole.create({
      data: { userId: user.id, role: "WHOLESALER_ADMIN", assignedBy: ctx.actorUserId },
    });

    // 4) UserInvitation トークンを発行 (7 日)
    const token = randomBytes(32).toString("hex");
    const tokenHash = await hashPassword(token);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const invitation = await tx.userInvitation.create({
      data: {
        tenantId: tenant.id,
        email: parsed.adminEmail,
        role: "WHOLESALER_ADMIN",
        tokenHash,
        expiresAt,
        invitedBy: ctx.actorUserId,
      },
      select: { id: true },
    });

    // 5) AuditLog — テナント作成
    await tx.auditLog.create({
      data: {
        actorUserId: ctx.actorUserId,
        tenantId: tenant.id,
        targetType: "Tenant",
        targetId: tenant.id,
        action: "CREATE",
        after: {
          name: parsed.name,
          plan: parsed.plan,
          adminEmail: parsed.adminEmail,
          invitationId: invitation.id,
        },
      },
    });

    const inviteUrl = buildInviteUrl(token);

    // 6) 招待メール送信。Resend が未設定なら stub に落ちるので CI / dev は安全。
    await sendUserInviteEmail(getEmailClient(), {
      to: parsed.adminEmail,
      inviteUrl,
      expiresAt,
    });

    revalidatePath(LIST_PATH);
    revalidatePath(DASHBOARD_PATH);
    return {
      tenantId: tenant.id,
      inviteUrl,
      invitationId: invitation.id,
      expiresAt: expiresAt.toISOString(),
    };
  },
);

export interface ResendInvitationInput {
  tenantId: string;
}

export interface ResendInvitationResult {
  invitationId: string;
  expiresAt: string;
}

export const resendInvitationAction = withServerActionContext<
  ResendInvitationInput,
  ResendInvitationResult
>(
  {
    action: "tenant.update",
  },
  async ({ tx, ctx, input }) => {
    if (!input.tenantId) {
      throw new ValidationError("tenantId is required");
    }

    // 最新の未受諾招待を確認。
    const latest = await tx.userInvitation.findFirst({
      where: { tenantId: input.tenantId, acceptedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
      },
    });
    if (!latest) {
      throw new NotFoundError("再発行可能な招待が見つかりません");
    }

    // 7 日経過前の有効な招待は再発行不可（タスク仕様 / docs/02 §F-004）。
    const now = new Date();
    if (latest.expiresAt.getTime() > now.getTime()) {
      throw new ConflictError(
        "現在の招待が有効期間内です。期限経過後（7 日後）に再発行できます。",
        { expiresAt: latest.expiresAt.toISOString() },
      );
    }

    // 旧招待を失効させる: 期限切れ行は `acceptedAt` を立てて findFirst から除外。
    // （`acceptedAt` 名が暫定だが、現行 schema には `revokedAt` が無いので
    //  失効マーカとして acceptedAt = now を流用する。SP-07 で revokedAt 列追加予定。）
    await tx.userInvitation.update({
      where: { id: latest.id },
      data: { acceptedAt: now },
    });

    // 新トークン発行
    const token = randomBytes(32).toString("hex");
    const tokenHash = await hashPassword(token);
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
    const fresh = await tx.userInvitation.create({
      data: {
        tenantId: input.tenantId,
        email: latest.email,
        role: latest.role,
        tokenHash,
        expiresAt,
        invitedBy: ctx.actorUserId,
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: ctx.actorUserId,
        tenantId: input.tenantId,
        targetType: "UserInvitation",
        targetId: fresh.id,
        action: "CREATE",
        after: {
          event: "INVITATION_RESEND",
          previousInvitationId: latest.id,
          email: latest.email,
        },
      },
    });

    await sendUserInviteEmail(getEmailClient(), {
      to: latest.email,
      inviteUrl: buildInviteUrl(token),
      expiresAt,
    });

    revalidatePath(`${LIST_PATH}/${input.tenantId}`);
    return { invitationId: fresh.id, expiresAt: expiresAt.toISOString() };
  },
);

export interface UpdateTenantStatusInput {
  tenantId: string;
  status: TenantStatusValue;
}

export interface UpdateTenantStatusResult {
  tenantId: string;
  status: TenantStatusValue;
}

export const updateTenantStatusAction = withServerActionContext<
  UpdateTenantStatusInput,
  UpdateTenantStatusResult
>(
  {
    action: "tenant.update",
  },
  async ({ tx, ctx, input }) => {
    // status を含めた update スキーマで再パース（type の硬さは関係ない）
    const parsed = TenantUpdateSchema.parse({ status: input.status });
    if (!parsed.status) {
      throw new ValidationError("status is required");
    }

    const existing = await tx.tenant.findUnique({
      where: { id: input.tenantId },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new NotFoundError("テナントが見つかりません");
    }

    if (existing.status === parsed.status) {
      return { tenantId: existing.id, status: existing.status };
    }

    const updated = await tx.tenant.update({
      where: { id: input.tenantId },
      data: { status: parsed.status },
      select: { id: true, status: true },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: ctx.actorUserId,
        tenantId: input.tenantId,
        targetType: "Tenant",
        targetId: input.tenantId,
        action: "STATUS_CHANGE",
        before: { status: existing.status },
        after: { status: updated.status },
      },
    });

    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${input.tenantId}`);
    revalidatePath(DASHBOARD_PATH);
    return { tenantId: updated.id, status: updated.status };
  },
);
