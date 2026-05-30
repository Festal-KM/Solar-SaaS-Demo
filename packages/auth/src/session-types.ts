// Auth.js v5 JWT / Session type augmentation.
//
// The shape mirrors the `TenantContext` we eventually push into AsyncLocalStorage
// (see `@solar/db/tenant-context`) so the web layer can construct it directly
// from the session without a second DB round-trip. `sessionVersion` is the
// forced-logout marker — incremented by `bumpSessionVersion()` whenever a
// user's roles change, password rotates, etc.

import type { AppRole, TenantType } from "@solar/db";

import "next-auth";
import "next-auth/jwt";

export interface SolarSessionUser {
  id: string;
  email: string;
  name: string;
  // Required by Auth.js v5's AdapterUser shape; we never populate it because
  // the Credentials provider doesn't verify emails out of the box.
  emailVerified: Date | null;
  tenantId: string;
  tenantType: TenantType;
  wholesalerId: string | null;
  dealerId: string | null;
  roles: AppRole[];
  isSaasAdmin: boolean;
  sessionVersion: number;
  // MFA gating (T-01-06).
  //   `mfaSetupRequired` — User.twoFactorRequired && TotpSecret.activatedAt is
  //                        null. Middleware redirects such users to
  //                        /mfa/setup (S-003) until they finish provisioning.
  //   `mfaVerified`      — set to true once verifyTotpAction passes after a
  //                        login. Resets to false on every new sign-in so the
  //                        MFA challenge (S-002) runs once per session start.
  mfaSetupRequired: boolean;
  mfaVerified: boolean;
}

declare module "next-auth" {
  interface Session {
    user: SolarSessionUser;
    expires: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sub?: string;
    email?: string;
    name?: string;
    tenantId?: string;
    tenantType?: TenantType;
    wholesalerId?: string | null;
    dealerId?: string | null;
    roles?: AppRole[];
    isSaasAdmin?: boolean;
    sessionVersion?: number;
    mfaSetupRequired?: boolean;
    mfaVerified?: boolean;
  }
}
