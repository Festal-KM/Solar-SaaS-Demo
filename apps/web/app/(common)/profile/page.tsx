// Profile page — common for all roles.
// Shows display name, email, role list, 2FA status.

import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { labels } from "@/lib/i18n/labels";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const t = labels.profile;
  const user = session.user;

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-medium text-carbon-dark">{t.title}</h1>
        <p className="text-pewter text-sm mt-1">{t.subtitle}</p>
      </div>

      <Card className="p-6 space-y-4">
        <dl className="grid grid-cols-[8rem_1fr] gap-y-3 text-sm">
          <dt className="text-pewter">{t.fields.displayName}</dt>
          <dd className="text-carbon-dark">{user.name ?? "—"}</dd>

          <dt className="text-pewter">{t.fields.email}</dt>
          <dd className="text-carbon-dark">{user.email ?? "—"}</dd>

          <dt className="text-pewter">{t.fields.role}</dt>
          <dd className="text-carbon-dark">
            {(user.roles ?? []).join(", ") || "—"}
          </dd>

          <dt className="text-pewter">{t.fields.twoFaStatus}</dt>
          <dd className="text-carbon-dark">
            {user.mfaSetupRequired ? t.twoFa.disabled : t.twoFa.enabled}
          </dd>
        </dl>
      </Card>

      <Button asChild variant="outline">
        <Link href="/profile/password">{t.changePassword}</Link>
      </Button>
    </div>
  );
}
