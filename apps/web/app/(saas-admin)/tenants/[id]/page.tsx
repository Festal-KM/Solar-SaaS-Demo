import Link from "next/link";
import { notFound } from "next/navigation";

import { labels } from "@/lib/i18n/labels";

import { getTenant } from "../data";
import { TenantDetailActions } from "../tenant-detail-actions";

// S-015 (詳細モード) — テナント情報 + 全体管理者 + 招待状態 + ステータス操作。
// 監査ログ / プラン履歴は SP-07 / T-02-09 で対応するため、本タスクでは表示しない。

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TenantDetailPage({ params }: PageProps) {
  const { id } = await params;
  const tenant = await getTenant(id);
  if (!tenant) {
    notFound();
  }

  const t = labels.saasAdminTenant;
  const c = labels.common;

  const inv = tenant.latestInvitation;
  let invStatusLabel: string;
  if (!inv) {
    invStatusLabel = t.invitation.none;
  } else if (inv.acceptedAt) {
    invStatusLabel = t.invitation.accepted;
  } else if (new Date(inv.expiresAt).getTime() <= Date.now()) {
    invStatusLabel = t.invitation.expired;
  } else {
    invStatusLabel = t.invitation.pending;
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/tenants"
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
        >
          ← {t.backToList}
        </Link>
      </div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{tenant.name}</h1>
        <span className="text-muted-foreground text-sm">{t.statuses[tenant.status]}</span>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t.sections.basic}</h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-xs">{t.fields.type}</dt>
            <dd>{t.types[tenant.type]}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t.fields.plan}</dt>
            <dd>{tenant.plan ? t.plans[tenant.plan] : c.notSet}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t.fields.userCount}</dt>
            <dd className="tabular-nums">{tenant.userCount}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t.fields.createdAt}</dt>
            <dd className="text-xs">{new Date(tenant.createdAt).toLocaleString("ja-JP")}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t.sections.admin}</h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-xs">{t.fields.adminName}</dt>
            <dd>{tenant.adminName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t.fields.adminEmail}</dt>
            <dd>{tenant.adminEmail ?? "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t.sections.invitation}</h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-xs">{t.fields.status}</dt>
            <dd>{invStatusLabel}</dd>
          </div>
          {inv ? (
            <>
              <div>
                <dt className="text-muted-foreground text-xs">{t.invitation.sentAt}</dt>
                <dd className="text-xs">{new Date(inv.createdAt).toLocaleString("ja-JP")}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">{t.invitation.expiresAt}</dt>
                <dd className="text-xs">{new Date(inv.expiresAt).toLocaleString("ja-JP")}</dd>
              </div>
              {inv.acceptedAt ? (
                <div>
                  <dt className="text-muted-foreground text-xs">{t.invitation.acceptedAt}</dt>
                  <dd className="text-xs">{new Date(inv.acceptedAt).toLocaleString("ja-JP")}</dd>
                </div>
              ) : null}
            </>
          ) : null}
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t.sections.lifecycle}</h2>
        <TenantDetailActions
          tenantId={tenant.id}
          status={tenant.status}
          canResendInvitation={tenant.canResendInvitation}
        />
      </section>
    </div>
  );
}
