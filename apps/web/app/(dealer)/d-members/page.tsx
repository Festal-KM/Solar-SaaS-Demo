// S-058 sub — F-008 二次店メンバー管理 (DEALER_ADMIN 専用).
// ユーザー一覧 + 招待ダイアログ。assertCan は data.ts の listDealerMembers 内で実施。

import { Badge } from "@/components/ui/badge";
import { labels } from "@/lib/i18n/labels";

import { listDealerMembers } from "./data";
import { InviteDealerMemberDialog } from "./invite-dealer-member-dialog";

export const dynamic = "force-dynamic";

export default async function DealerMembersPage() {
  const members = await listDealerMembers();
  const t = labels.memberManagement;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.dealerTitle}</h1>
          <p className="text-muted-foreground text-sm">{t.subtitle}</p>
        </div>
        <InviteDealerMemberDialog />
      </div>

      {members.length === 0 ? (
        <div className="border-border bg-muted/30 rounded-md border p-8 text-center">
          <p className="text-foreground font-medium">{t.empty}</p>
          <p className="text-muted-foreground mt-2 text-sm">{t.emptyCta}</p>
        </div>
      ) : (
        <div className="border-border overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{t.fields.name}</th>
                <th className="px-3 py-2 font-medium">{t.fields.email}</th>
                <th className="px-3 py-2 font-medium">{t.fields.roles}</th>
                <th className="px-3 py-2 font-medium">{t.fields.twoFactor}</th>
                <th className="px-3 py-2 font-medium">{t.fields.status}</th>
                <th className="px-3 py-2 font-medium">{t.fields.lastLoginAt}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-border border-t">
                  <td className="px-3 py-2 font-medium">{m.name}</td>
                  <td className="text-muted-foreground px-3 py-2">{m.email}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {m.roles.map((r) => (
                        <Badge key={r} variant="secondary" className="text-xs">
                          {t.dealerRoles[r] ?? r}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {m.twoFactorRequired ? (
                      <Badge variant="outline" className="text-xs">
                        {t.twoFactorEnabled}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">{t.twoFactorDisabled}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={m.status === "ACTIVE" ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {t.statuses[m.status] ?? m.status}
                    </Badge>
                  </td>
                  <td className="text-muted-foreground px-3 py-2 text-xs tabular-nums">
                    {m.lastLoginAt
                      ? new Date(m.lastLoginAt).toLocaleString("ja-JP")
                      : t.neverLoggedIn}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
