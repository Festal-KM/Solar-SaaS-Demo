// Tenant-scoped DB entry gate for the web app.
//
// The canonical implementation now lives in `packages/db/src/with-tenant.ts`
// so the package can self-test the exact production helper without copying it.
// This module exists only to preserve the historical import path
// (`@/lib/tenancy/with-tenant`) for code inside `apps/web`.

export { withTenant, type TxClient } from "@solar/db";
