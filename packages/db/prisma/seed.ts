// Solar-SaaS — development / pilot seed script (T-01-12).
//
// Idempotent seed that bootstraps the dataset operators / E2E tests rely on:
//   - One internal WHOLESALER tenant ("Solar SaaS 運営") for SAAS_ADMIN users.
//     The schema's TenantType enum only has WHOLESALER | DEALER, and User
//     rows require a tenantId; so we materialise a synthetic wholesaler
//     dedicated to the operator. RLS-wise this tenant has no Relationships
//     and never appears in dealer / wholesaler-internal joins.
//   - The pilot WHOLESALER ("パイロット卸 株式会社") plus its three DEALER
//     tenants (alpha / beta / gamma) and three Relationship rows wiring them
//     together with varied default scopes.
//   - One ACTIVE user per app role (12 in total): saas_admin + the five
//     wholesaler roles + dealer_admin/dealer_staff for each of the three
//     dealers. SAAS_ADMIN / WHOLESALER_ADMIN are flagged `twoFactorRequired=true`
//     per docs/05 §3.2.
//
// Every row is upserted by `email` (User) / synthetic stable key (Tenant /
// Relationship) so `pnpm db:seed` may be re-run any number of times without
// duplicating rows. Real teardown belongs to a separate `db:reset` script.
//
// Bypass + tenant context: seed is invoked at the migration boundary with no
// authenticated session, so every Prisma call runs inside
// `withTenant(SYSTEM_TENANT_CONTEXT, ...)` — `is_saas_admin = true` satisfies
// every RLS policy.

// Env preload — runs BEFORE any other import resolution. `tsx prisma/seed.ts`
// hits this file directly and Node has already executed the imports below
// by the time top-level statements would run, so we route the dotenv side
// through a dedicated tiny module (`./seed-env.ts`) imported FIRST. The
// preload is best-effort: Railway / CI populate the env up-front, so missing
// .env files are not an error.
import "./seed-env.js";

import argon2 from "argon2";

import { rawPrisma, SYSTEM_TENANT_CONTEXT, withTenant } from "../src/index.js";

import type { TxClient } from "../src/with-tenant.js";
import type { AppRole, DealerScope } from "@prisma/client";

// argon2id parameters mirror `packages/auth/src/password.ts` so a seeded user
// can authenticate via the live login pipeline without any additional rehash.
// Keep this constant block in sync if the production parameters move.
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

async function hashPilotPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

const PILOT_PASSWORD = process.env.SEED_PILOT_PASSWORD ?? "Pilot!2026";
// Demo release shared account (WHOLESALER_ADMIN, 2FA disabled). Independent
// from PILOT_PASSWORD so the demo URL/password can be shared widely without
// also handing out access to every seeded role account.
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Demo1234!";

// Stable tenant identities — we cannot rely on cuid() across runs, so we look
// up by `name` (which is unique in practice for the pilot dataset; the schema
// itself doesn't enforce it but we add a runtime guard via upsert-by-find).
const TENANT_KEY = {
  saasOps: "Solar SaaS 運営",
  pilotWholesaler: "パイロット卸 株式会社",
  dealerAlpha: "二次店アルファ",
  dealerBeta: "二次店ベータ",
  dealerGamma: "二次店ガンマ",
} as const;

type UserSeed = {
  email: string;
  name: string;
  tenantKey: keyof typeof TENANT_KEY;
  role: AppRole;
  twoFactorRequired: boolean;
};

const DEALER_SCOPE_BY_KEY: Record<"dealerAlpha" | "dealerBeta" | "dealerGamma", DealerScope> = {
  dealerAlpha: "APPOINTMENT_ONLY",
  dealerBeta: "FIRST_VISIT",
  dealerGamma: "FULL_CLOSING",
};

const USER_SEEDS: UserSeed[] = [
  {
    email: "saas_admin@solar-saas.dev",
    name: "SaaS 運営者",
    tenantKey: "saasOps",
    role: "SAAS_ADMIN",
    twoFactorRequired: true,
  },
  {
    email: "wholesaler_admin@solar-saas.dev",
    name: "卸業者 管理者",
    tenantKey: "pilotWholesaler",
    role: "WHOLESALER_ADMIN",
    twoFactorRequired: true,
  },
  {
    email: "wholesaler_event_team@solar-saas.dev",
    name: "イベント班 担当",
    tenantKey: "pilotWholesaler",
    role: "WHOLESALER_EVENT_TEAM",
    twoFactorRequired: false,
  },
  {
    email: "wholesaler_call_team@solar-saas.dev",
    name: "コール班 担当",
    tenantKey: "pilotWholesaler",
    role: "WHOLESALER_CALL_TEAM",
    twoFactorRequired: false,
  },
  {
    email: "wholesaler_direct_sales@solar-saas.dev",
    name: "直販 担当",
    tenantKey: "pilotWholesaler",
    role: "WHOLESALER_DIRECT_SALES",
    twoFactorRequired: false,
  },
  {
    email: "wholesaler_field_staff@solar-saas.dev",
    name: "現場 担当",
    tenantKey: "pilotWholesaler",
    role: "WHOLESALER_FIELD_STAFF",
    twoFactorRequired: false,
  },
  {
    email: "alpha-admin@solar-saas.dev",
    name: "アルファ 管理者",
    tenantKey: "dealerAlpha",
    role: "DEALER_ADMIN",
    twoFactorRequired: false,
  },
  {
    email: "alpha-staff@solar-saas.dev",
    name: "アルファ 担当",
    tenantKey: "dealerAlpha",
    role: "DEALER_STAFF",
    twoFactorRequired: false,
  },
  {
    email: "beta-admin@solar-saas.dev",
    name: "ベータ 管理者",
    tenantKey: "dealerBeta",
    role: "DEALER_ADMIN",
    twoFactorRequired: false,
  },
  {
    email: "beta-staff@solar-saas.dev",
    name: "ベータ 担当",
    tenantKey: "dealerBeta",
    role: "DEALER_STAFF",
    twoFactorRequired: false,
  },
  {
    email: "gamma-admin@solar-saas.dev",
    name: "ガンマ 管理者",
    tenantKey: "dealerGamma",
    role: "DEALER_ADMIN",
    twoFactorRequired: false,
  },
  {
    email: "gamma-staff@solar-saas.dev",
    name: "ガンマ 担当",
    tenantKey: "dealerGamma",
    role: "DEALER_STAFF",
    twoFactorRequired: false,
  },
];

export interface SeedSummary {
  saasOpsTenantId: string;
  wholesalerTenantId: string;
  dealerTenantIds: { alpha: string; beta: string; gamma: string };
  relationshipIds: string[];
  userCount: number;
  venueProviderId: string;
}

/**
 * Locate (or create) a tenant by display name. Used as the stable-identity
 * key for the seed because the schema does not put a UNIQUE constraint on
 * `Tenant.name` — adding one here would change production semantics, so we
 * keep the matching at the seed-script level.
 */
async function upsertTenantByName(
  tx: TxClient,
  args: { name: string; type: "WHOLESALER" | "DEALER"; plan: "PILOT" | null },
): Promise<{ id: string }> {
  const existing = await tx.tenant.findFirst({
    where: { name: args.name, type: args.type },
    select: { id: true },
  });
  if (existing) return existing;
  const created = await tx.tenant.create({
    data: {
      name: args.name,
      type: args.type,
      plan: args.plan,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  return created;
}

async function upsertRelationship(
  tx: TxClient,
  args: { wholesalerId: string; dealerId: string; defaultScope: DealerScope },
): Promise<{ id: string }> {
  return tx.relationship.upsert({
    where: {
      wholesalerId_dealerId: {
        wholesalerId: args.wholesalerId,
        dealerId: args.dealerId,
      },
    },
    update: {
      status: "ACTIVE",
      defaultScope: args.defaultScope,
    },
    create: {
      wholesalerId: args.wholesalerId,
      dealerId: args.dealerId,
      status: "ACTIVE",
      defaultScope: args.defaultScope,
    },
    select: { id: true },
  });
}

async function upsertUser(
  tx: TxClient,
  args: {
    email: string;
    name: string;
    tenantId: string;
    role: AppRole;
    twoFactorRequired: boolean;
    passwordHash: string;
  },
): Promise<void> {
  const user = await tx.user.upsert({
    where: { email: args.email },
    update: {
      name: args.name,
      tenantId: args.tenantId,
      status: "ACTIVE",
      twoFactorRequired: args.twoFactorRequired,
      passwordHash: args.passwordHash,
    },
    create: {
      email: args.email,
      name: args.name,
      tenantId: args.tenantId,
      status: "ACTIVE",
      twoFactorRequired: args.twoFactorRequired,
      passwordHash: args.passwordHash,
    },
    select: { id: true },
  });
  // `@@id([userId, role])` makes the role grant trivially idempotent.
  await tx.userRole.upsert({
    where: { userId_role: { userId: user.id, role: args.role } },
    update: {},
    create: { userId: user.id, role: args.role, assignedBy: "seed" },
  });
}

export async function seedAll(): Promise<SeedSummary> {
  // Single pre-hash: every seeded user shares the pilot password, and argon2id
  // hashes are salted internally, so generating distinct hashes per user would
  // just slow down the seed (each hash is ~80ms). Re-running the seed will
  // re-hash + overwrite, which is acceptable for a pilot dataset.
  const passwordHash = await hashPilotPassword(PILOT_PASSWORD);

  // Long timeout: this single transaction inserts ~50+ rows across 20+ models
  // and can exceed Prisma's 5s default — especially over a public proxy
  // (Railway demo seed run). 5 minutes is generous but safe; the work itself
  // takes ~10s over an internal connection.
  return withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    const saasOps = await upsertTenantByName(tx, {
      name: TENANT_KEY.saasOps,
      type: "WHOLESALER",
      plan: null,
    });
    const pilot = await upsertTenantByName(tx, {
      name: TENANT_KEY.pilotWholesaler,
      type: "WHOLESALER",
      plan: "PILOT",
    });
    const alpha = await upsertTenantByName(tx, {
      name: TENANT_KEY.dealerAlpha,
      type: "DEALER",
      plan: null,
    });
    const beta = await upsertTenantByName(tx, {
      name: TENANT_KEY.dealerBeta,
      type: "DEALER",
      plan: null,
    });
    const gamma = await upsertTenantByName(tx, {
      name: TENANT_KEY.dealerGamma,
      type: "DEALER",
      plan: null,
    });

    // WholesalerSettings: PII masking defaults to MASKED per schema, but ensure
    // the row exists for both wholesaler tenants so downstream features that
    // read it via include() don't trip on a null relation.
    for (const wsId of [saasOps.id, pilot.id]) {
      await tx.wholesalerSettings.upsert({
        where: { wholesalerId: wsId },
        update: {},
        create: { wholesalerId: wsId },
      });
    }

    const rels = await Promise.all([
      upsertRelationship(tx, {
        wholesalerId: pilot.id,
        dealerId: alpha.id,
        defaultScope: DEALER_SCOPE_BY_KEY.dealerAlpha,
      }),
      upsertRelationship(tx, {
        wholesalerId: pilot.id,
        dealerId: beta.id,
        defaultScope: DEALER_SCOPE_BY_KEY.dealerBeta,
      }),
      upsertRelationship(tx, {
        wholesalerId: pilot.id,
        dealerId: gamma.id,
        defaultScope: DEALER_SCOPE_BY_KEY.dealerGamma,
      }),
    ]);

    const tenantIdByKey: Record<keyof typeof TENANT_KEY, string> = {
      saasOps: saasOps.id,
      pilotWholesaler: pilot.id,
      dealerAlpha: alpha.id,
      dealerBeta: beta.id,
      dealerGamma: gamma.id,
    };

    for (const u of USER_SEEDS) {
      await upsertUser(tx, {
        email: u.email,
        name: u.name,
        tenantId: tenantIdByKey[u.tenantKey],
        role: u.role,
        twoFactorRequired: u.twoFactorRequired,
        passwordHash,
      });
    }

    // Demo release shared account — distinct from the role-based seeds above.
    // Lives in the pilot wholesaler tenant as WHOLESALER_ADMIN with 2FA off so
    // demo participants can hop in without setting up TOTP. Password comes
    // from SEED_DEMO_PASSWORD (different from SEED_PILOT_PASSWORD).
    const demoPasswordHash = await hashPilotPassword(DEMO_PASSWORD);
    await upsertUser(tx, {
      email: "demo@solar-saas.demo",
      name: "管理者デモアカウント",
      tenantId: tenantIdByKey.pilotWholesaler,
      role: "WHOLESALER_ADMIN",
      twoFactorRequired: false,
      passwordHash: demoPasswordHash,
    });

    // Seed one VenueProvider for pilotWholesaler so the UC-01 E2E test can
    // select a venue provider without depending on the masters test suite
    // having created one first. VenueProvider has no schema-level UNIQUE
    // constraint beyond `id`, so we find-or-create manually.
    const existingVp = await tx.venueProvider.findFirst({
      where: { wholesalerId: pilot.id, name: "シードテスト会場" },
      select: { id: true },
    });
    const venueProvider = existingVp
      ? existingVp
      : await tx.venueProvider.create({
          data: {
            wholesalerId: pilot.id,
            name: "シードテスト会場",
            area: "東京都",
            isActive: true,
          },
          select: { id: true },
        });

    // Demo VenueProviders（チェーン）+ Stores（支店）— 1 : N の親子構造。
    // 場所提供元はチェーン本部相当、Store は各支店として venueProviderId で
    // 紐づける。VenueNegotiation はチェーン (VenueProvider) 単位で起票し、
    // 単位を細かく分けたい運用では Store を別途参照する想定。
    const DEMO_CHAIN_PROVIDERS: Array<{
      name: string;
      hqArea: string;
      contactName: string;
      phone: string;
      address: string;
      contractType: "FIXED" | "PERFORMANCE" | "OTHER";
      fixedFee?: number;
      performanceRate?: number;
      stores: string[];
    }> = [
      {
        name: "カインズ",
        hqArea: "埼玉県",
        contactName: "本部 催事推進室 田中",
        phone: "048-555-0100",
        address: "埼玉県本庄市早稲田の杜1-2-1",
        contractType: "FIXED",
        fixedFee: 80_000,
        stores: ["浦和美園店", "新所沢店", "幕張店"],
      },
      {
        name: "コメリパワー",
        hqArea: "新潟県",
        contactName: "本部 催事担当 佐々木",
        phone: "025-555-0200",
        address: "新潟県新潟市南区清水4501-1",
        contractType: "PERFORMANCE",
        performanceRate: 5,
        stores: ["千葉ニュータウン店", "船橋店"],
      },
      {
        name: "ホームセンタームサシ",
        hqArea: "石川県",
        contactName: "本部 営業企画 中島",
        phone: "076-555-0300",
        address: "石川県金沢市鞍月東2-21",
        contractType: "FIXED",
        fixedFee: 65_000,
        stores: ["横浜瀬谷店", "町田忠生店"],
      },
      {
        name: "ヤマダデンキ",
        hqArea: "群馬県",
        contactName: "本部 催事窓口 鈴木",
        phone: "027-555-0400",
        address: "群馬県高崎市栄町1-1",
        contractType: "PERFORMANCE",
        performanceRate: 7,
        stores: ["テックランド町田店", "テックランド川越店", "テックランド千葉店"],
      },
      {
        name: "ベイシア",
        hqArea: "群馬県",
        contactName: "本部 店舗運営部 山田",
        phone: "0270-555-0500",
        address: "群馬県前橋市亀里町900",
        contractType: "OTHER",
        stores: ["前橋みなみモール店", "渋川店"],
      },
      {
        name: "ロイヤルホームセンター",
        hqArea: "大阪府",
        contactName: "本部 催事担当 佐藤",
        phone: "06-555-0600",
        address: "大阪府大阪市住之江区南港北1-21-72",
        contractType: "FIXED",
        fixedFee: 70_000,
        stores: ["大宮店", "千葉北店"],
      },
    ];

    const venueProviderIdsByName: Record<string, string> = {};
    for (const vp of DEMO_CHAIN_PROVIDERS) {
      const existing = await tx.venueProvider.findFirst({
        where: { wholesalerId: pilot.id, name: vp.name },
        select: { id: true },
      });
      let providerId: string;
      if (existing) {
        providerId = existing.id;
      } else {
        const created = await tx.venueProvider.create({
          data: {
            wholesalerId: pilot.id,
            name: vp.name,
            area: vp.hqArea,
            contactName: vp.contactName,
            phone: vp.phone,
            address: vp.address,
            contractType: vp.contractType,
            ...(vp.fixedFee !== undefined ? { fixedFee: vp.fixedFee } : {}),
            ...(vp.performanceRate !== undefined
              ? { performanceRate: vp.performanceRate }
              : {}),
            isActive: true,
          },
          select: { id: true },
        });
        providerId = created.id;
      }
      venueProviderIdsByName[vp.name] = providerId;

      // Stores（支店）— venueProviderId で紐づける。同 (wholesalerId, name) で
      // upsert。既に親未紐づけで存在していたら親をセット。
      for (const storeName of vp.stores) {
        const existingStore = await tx.store.findFirst({
          where: { wholesalerId: pilot.id, name: storeName },
          select: { id: true, venueProviderId: true },
        });
        if (!existingStore) {
          await tx.store.create({
            data: {
              wholesalerId: pilot.id,
              venueProviderId: providerId,
              name: storeName,
              isActive: true,
            },
          });
        } else if (existingStore.venueProviderId !== providerId) {
          await tx.store.update({
            where: { id: existingStore.id },
            data: { venueProviderId: providerId },
          });
        }
      }
    }

    // Legacy demo providers (旧 "カインズ 浦和美園店" 等) を整理。リンクを
    // 失う前に紐づく VenueNegotiation を削除し、参照不要となった旧 provider
    // を物理削除する。EventCandidate からの参照が無いケースが前提（旧デモ
    // データは VenueNegotiation 単位までしか作っていない）。
    const LEGACY_PROVIDER_NAMES = [
      "カインズ 浦和美園店",
      "コメリパワー 千葉ニュータウン店",
      "ホームセンタームサシ 横浜瀬谷店",
      "ヤマダデンキ テックランド町田店",
      "ベイシア 前橋みなみモール店",
      "ロイヤルホームセンター 大宮店",
    ];
    const legacyProviders = await tx.venueProvider.findMany({
      where: { wholesalerId: pilot.id, name: { in: LEGACY_PROVIDER_NAMES } },
      select: { id: true },
    });
    if (legacyProviders.length > 0) {
      const legacyIds = legacyProviders.map((p) => p.id);
      await tx.venueNegotiation.deleteMany({
        where: { wholesalerId: pilot.id, venueProviderId: { in: legacyIds } },
      });
      // 物理削除は EventCandidate 等の外部参照があると ON DELETE 制約で失敗
      // するので try/catch。失敗時は isActive=false に fallback。
      try {
        await tx.venueProvider.deleteMany({ where: { id: { in: legacyIds } } });
      } catch {
        await tx.venueProvider.updateMany({
          where: { id: { in: legacyIds } },
          data: { isActive: false },
        });
      }
    }

    const hasDemoNegotiation = await tx.venueNegotiation.findFirst({
      where: { wholesalerId: pilot.id },
      select: { id: true },
    });
    if (!hasDemoNegotiation) {
      const today = new Date();
      const isoDate = (offsetDays: number) => {
        const d = new Date(today);
        d.setDate(d.getDate() + offsetDays);
        return d.toISOString().slice(0, 10);
      };
      const DEMO_NEGOTIATIONS: Array<{
        providerName: string;
        status:
          | "NOT_CONTACTED"
          | "CONTACTING"
          | "CONDITION_REVIEW"
          | "FEASIBLE"
          | "INFEASIBLE"
          | "FIXED"
          | "CANCELLED";
        candidateDates: string[];
        nextAction?: string;
        conditionNote?: string;
        decidedDate?: string;
        contractType?: "FIXED" | "PERFORMANCE" | "OTHER";
        fixedFee?: number;
        performanceRate?: number;
      }> = [
        {
          providerName: "カインズ",
          status: "FIXED",
          candidateDates: [isoDate(14), isoDate(15)],
          decidedDate: isoDate(14),
          contractType: "FIXED",
          fixedFee: 80_000,
          conditionNote: "浦和美園店の入口正面ブース、2 日間借用で確定",
        },
        {
          providerName: "コメリパワー",
          status: "CONDITION_REVIEW",
          candidateDates: [isoDate(21), isoDate(28)],
          nextAction: "千葉ニュータウン店、成果報酬率の最終回答待ち（6/8 まで）",
          contractType: "PERFORMANCE",
          performanceRate: 5,
        },
        {
          providerName: "ホームセンタームサシ",
          status: "FEASIBLE",
          candidateDates: [isoDate(30)],
          nextAction: "横浜瀬谷店、二次店募集 → 開催体制決定へ",
          contractType: "FIXED",
          fixedFee: 65_000,
        },
        {
          providerName: "ヤマダデンキ",
          status: "CONTACTING",
          candidateDates: [isoDate(35), isoDate(42)],
          nextAction: "テックランド町田店、店長と日程調整中（6/5 折り返し電話）",
        },
        {
          providerName: "ベイシア",
          status: "NOT_CONTACTED",
          candidateDates: [],
          nextAction: "前橋みなみモール店、問い合わせフォーム送付予定",
        },
        {
          providerName: "ロイヤルホームセンター",
          status: "INFEASIBLE",
          candidateDates: [],
          conditionNote: "大宮店、別催事と重複のため当月開催不可、来月再打診",
        },
      ];

      for (const n of DEMO_NEGOTIATIONS) {
        const providerId = venueProviderIdsByName[n.providerName];
        if (!providerId) continue;
        await tx.venueNegotiation.create({
          data: {
            wholesalerId: pilot.id,
            venueProviderId: providerId,
            candidateDates: n.candidateDates,
            status: n.status,
            ...(n.nextAction ? { nextAction: n.nextAction } : {}),
            ...(n.conditionNote ? { conditionNote: n.conditionNote } : {}),
            ...(n.decidedDate ? { decidedDate: new Date(n.decidedDate) } : {}),
            ...(n.contractType ? { contractType: n.contractType } : {}),
            ...(n.fixedFee !== undefined ? { fixedFee: n.fixedFee } : {}),
            ...(n.performanceRate !== undefined
              ? { performanceRate: n.performanceRate }
              : {}),
          },
        });
      }
    }

    // Seed a few Areas for pilotWholesaler so the イベント候補登録フォームの
    // エリア選択肢が空にならない。Area has no schema-level UNIQUE constraint
    // beyond `id`, so we find-or-create manually per (wholesalerId, name).
    // イベント開催エリア (EVENT) — イベント候補登録時に選択する開催地区分。
    const EVENT_AREA_NAMES = ["東京都", "神奈川県", "埼玉県", "千葉県"];
    for (const areaName of EVENT_AREA_NAMES) {
      const existingArea = await tx.area.findFirst({
        where: { wholesalerId: pilot.id, name: areaName, type: "EVENT" },
        select: { id: true },
      });
      if (!existingArea) {
        await tx.area.create({
          data: {
            wholesalerId: pilot.id,
            name: areaName,
            type: "EVENT",
            isActive: true,
          },
        });
      }
    }

    // 顧客エリア (CUSTOMER) — 顧客マスタで参照する営業対象エリア区分。
    // 同名でも EVENT と CUSTOMER は別レコードで管理する。
    const CUSTOMER_AREA_NAMES = [
      "東京都北部",
      "東京都南部",
      "神奈川北部",
      "神奈川南部",
      "埼玉エリア",
      "千葉エリア",
    ];
    for (const areaName of CUSTOMER_AREA_NAMES) {
      const existingArea = await tx.area.findFirst({
        where: { wholesalerId: pilot.id, name: areaName, type: "CUSTOMER" },
        select: { id: true },
      });
      if (!existingArea) {
        await tx.area.create({
          data: {
            wholesalerId: pilot.id,
            name: areaName,
            type: "CUSTOMER",
            isActive: true,
          },
        });
      }
    }

    // Seed a few Stores for pilotWholesaler so the イベント候補登録フォームの
    // 店舗選択肢が空にならない。Store has no schema-level UNIQUE constraint
    // beyond `id`, so we find-or-create manually per (wholesalerId, name).
    const STORE_NAMES = ["テスト店舗A", "テスト店舗B", "テスト店舗C"];
    for (const storeName of STORE_NAMES) {
      const existingStore = await tx.store.findFirst({
        where: { wholesalerId: pilot.id, name: storeName },
        select: { id: true },
      });
      if (!existingStore) {
        await tx.store.create({
          data: { wholesalerId: pilot.id, name: storeName, isActive: true },
        });
      }
    }

    // Seed a couple of LineEvents for pilotWholesaler so the ライン一覧
    // (F-059) が空にならない。LineEvent has no schema-level UNIQUE constraint
    // beyond `id`, so we find-or-create manually per (wholesalerId, name).
    // createdBy はパイロット卸の管理者ユーザを解決して使う。
    const pilotAdmin = await tx.user.findUnique({
      where: { email: "wholesaler_admin@solar-saas.dev" },
      select: { id: true },
    });
    const pilotAdminId = pilotAdmin?.id ?? "seed";
    const now = new Date();
    const lineMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const LINE_EVENT_SEEDS = [
      {
        name: "イオンモール幕張新都心",
        area: "千葉県",
        scheduledDates: [
          `${lineMonth}-01`,
          `${lineMonth}-08`,
          `${lineMonth}-15`,
          `${lineMonth}-22`,
        ],
        contractType: "FIXED" as const,
        fixedFee: "30000",
        status: "CONFIRMED" as const,
      },
      {
        name: "ららぽーとTOKYO-BAY",
        area: "千葉県",
        scheduledDates: [
          `${lineMonth}-02`,
          `${lineMonth}-09`,
          `${lineMonth}-16`,
          `${lineMonth}-23`,
          `${lineMonth}-30`,
        ],
        contractType: "PERFORMANCE" as const,
        performanceRate: "5",
        status: "DRAFT" as const,
      },
    ];
    for (const le of LINE_EVENT_SEEDS) {
      const existingLine = await tx.lineEvent.findFirst({
        where: { wholesalerId: pilot.id, name: le.name },
        select: { id: true },
      });
      if (!existingLine) {
        await tx.lineEvent.create({
          data: {
            wholesalerId: pilot.id,
            venueProviderId: venueProvider.id,
            name: le.name,
            targetMonth: lineMonth,
            area: le.area,
            scheduledDates: le.scheduledDates,
            contractType: le.contractType,
            fixedFee: "fixedFee" in le ? le.fixedFee : null,
            performanceRate: "performanceRate" in le ? le.performanceRate : null,
            status: le.status,
            createdBy: pilotAdminId,
          },
        });
      }
    }

    // Seed 二次店レーン希望 (F-060) so the 二次店希望一覧 screen renders data.
    // Resolve the two seeded LineEvents by name → their ids, then create one
    // LanePreference per dealer relationship (find-or-create on the
    // (relationshipId, targetMonth) unique). rels[] is [alpha, beta, gamma].
    const seededLineEvents = await tx.lineEvent.findMany({
      where: { wholesalerId: pilot.id, name: { in: LINE_EVENT_SEEDS.map((le) => le.name) } },
      select: { id: true, name: true },
    });
    const lineEventIdByName = new Map(seededLineEvents.map((le) => [le.name, le.id]));
    const laneA = lineEventIdByName.get("イオンモール幕張新都心");
    const laneB = lineEventIdByName.get("ららぽーとTOKYO-BAY");
    if (laneA && laneB) {
      const LANE_PREFERENCE_SEEDS = [
        {
          relationshipId: rels[0]!.id, // alpha
          comment: "毎週水曜希望。要員2名で対応可能です。",
          items: [
            { lineEventId: laneA, priority: 1 },
            { lineEventId: laneB, priority: 2 },
          ],
        },
        {
          relationshipId: rels[1]!.id, // beta
          comment: "土日中心で参加したいです。",
          items: [
            { lineEventId: laneB, priority: 1 },
            { lineEventId: laneA, priority: 2 },
          ],
        },
      ];
      for (const pref of LANE_PREFERENCE_SEEDS) {
        const existingPref = await tx.lanePreference.findUnique({
          where: {
            relationshipId_targetMonth: {
              relationshipId: pref.relationshipId,
              targetMonth: lineMonth,
            },
          },
          select: { id: true },
        });
        if (!existingPref) {
          await tx.lanePreference.create({
            data: {
              wholesalerId: pilot.id,
              relationshipId: pref.relationshipId,
              targetMonth: lineMonth,
              comment: pref.comment,
              submittedBy: pilotAdminId,
              items: { create: pref.items },
            },
          });
        }
      }
    }

    // Seed ~12 sample customers for pilotWholesaler with VARIED related records
    // so every status badge value on the 顧客一覧 screen (F-032) is visible.
    // Idempotent: skipped entirely if any sample customer (by name prefix) is
    // already present, mirroring the find-or-create style used above.
    await seedCustomers(tx, { wholesalerId: pilot.id, userId: pilotAdminId, now });

    // Seed DealerCommissionRate (F-049 / S-049) — 手数料設定. 3 つのパイロット
    // 関係に対し率と履歴 1〜2 行を作る。idempotent：relationshipId に対する
    // findUnique でスキップ。
    await seedDealerCommissionRates(tx, {
      wholesalerId: pilot.id,
      userId: pilotAdminId,
      relationshipIds: rels.map((r) => r.id),
    });

    return {
      saasOpsTenantId: saasOps.id,
      wholesalerTenantId: pilot.id,
      dealerTenantIds: { alpha: alpha.id, beta: beta.id, gamma: gamma.id },
      relationshipIds: rels.map((r) => r.id),
      userCount: USER_SEEDS.length + 1, // +1 for the demo release shared account
      venueProviderId: venueProvider.id,
    };
  }, { timeout: 300_000, maxWait: 60_000 });
}

// Sample-customer name prefix — used both to generate the dataset and to detect
// an existing run (idempotency guard).
const SAMPLE_CUSTOMER_PREFIX = "サンプル";

interface SampleCustomerSpec {
  family: string;
  given: string;
  address: string;
  // Days from now for the appointment (positive = upcoming, negative = past,
  // undefined = no appointment).
  apptInDays?: number;
  withPreCall: boolean; // マエカク 有/無
  dealStatus?:
    | "VISIT_PLANNED"
    | "PROPOSING"
    | "QUOTED"
    | "CONSIDERING"
    | "LIKELY_CONTRACT"
    | "CONTRACTED"
    | "LOST";
  // When set, a Contract is created (→ 契約済み) plus optional construction /
  // application stages so 施工状況 / 補助金申請状況 vary.
  contract?: {
    constructionStatus?: "REQUEST_PENDING" | "CONSTRUCTING" | "DONE";
    applicationStatus?: "DRAFT" | "SUBMITTED" | "APPROVED";
  };
}

const SAMPLE_CUSTOMERS: SampleCustomerSpec[] = [
  // 提案中 (no deal) / マエカク 無 / 未着工 / 未申請
  { family: "佐藤", given: "一郎", address: "東京都新宿区西新宿1-1-1", withPreCall: false },
  // 提案中 (early deal) / マエカク 有 / upcoming appt
  {
    family: "鈴木",
    given: "次郎",
    address: "東京都渋谷区道玄坂2-2-2",
    apptInDays: 3,
    withPreCall: true,
    dealStatus: "PROPOSING",
  },
  // 商談中 (QUOTED) / マエカク 有 / upcoming appt
  {
    family: "高橋",
    given: "三郎",
    address: "神奈川県横浜市西区みなとみらい3-3",
    apptInDays: 5,
    withPreCall: true,
    dealStatus: "QUOTED",
  },
  // 商談中 (CONSIDERING) / マエカク 無 / past appt
  {
    family: "田中",
    given: "四郎",
    address: "埼玉県さいたま市大宮区桜木町4-4",
    apptInDays: -10,
    withPreCall: false,
    dealStatus: "CONSIDERING",
  },
  // 商談中 (LIKELY_CONTRACT) / マエカク 有
  {
    family: "伊藤",
    given: "五郎",
    address: "千葉県千葉市中央区中央5-5",
    apptInDays: 7,
    withPreCall: true,
    dealStatus: "LIKELY_CONTRACT",
  },
  // 失注 / マエカク 無 / past appt
  {
    family: "渡辺",
    given: "六郎",
    address: "東京都品川区大崎6-6",
    apptInDays: -20,
    withPreCall: false,
    dealStatus: "LOST",
  },
  // 契約済み / 未着工 / 未申請 / マエカク 有
  {
    family: "山本",
    given: "七郎",
    address: "東京都目黒区中目黒7-7",
    apptInDays: 2,
    withPreCall: true,
    dealStatus: "CONTRACTED",
    contract: { constructionStatus: "REQUEST_PENDING", applicationStatus: "DRAFT" },
  },
  // 契約済み / 着工中 / 申請中 / マエカク 有
  {
    family: "中村",
    given: "八郎",
    address: "神奈川県川崎市中原区小杉町8-8",
    apptInDays: 4,
    withPreCall: true,
    dealStatus: "CONTRACTED",
    contract: { constructionStatus: "CONSTRUCTING", applicationStatus: "SUBMITTED" },
  },
  // 契約済み / 施工完了 / 交付決定 / マエカク 無
  {
    family: "小林",
    given: "九郎",
    address: "埼玉県川口市本町9-9",
    apptInDays: -30,
    withPreCall: false,
    dealStatus: "CONTRACTED",
    contract: { constructionStatus: "DONE", applicationStatus: "APPROVED" },
  },
  // 契約済み / 施工完了 / 申請中 / マエカク 有
  {
    family: "加藤",
    given: "十郎",
    address: "千葉県船橋市本町10-10",
    apptInDays: 10,
    withPreCall: true,
    dealStatus: "CONTRACTED",
    contract: { constructionStatus: "DONE", applicationStatus: "SUBMITTED" },
  },
  // 契約済み / 着工中 / 未申請 / マエカク 無
  {
    family: "吉田",
    given: "十一",
    address: "東京都世田谷区三軒茶屋11-11",
    withPreCall: false,
    dealStatus: "CONTRACTED",
    contract: { constructionStatus: "CONSTRUCTING" },
  },
  // 提案中 (VISIT_PLANNED) / マエカク 有 / upcoming appt
  {
    family: "山田",
    given: "十二",
    address: "神奈川県相模原市中央区中央12-12",
    apptInDays: 1,
    withPreCall: true,
    dealStatus: "VISIT_PLANNED",
  },
];

// Map a sample spec's intent to the manual status columns the list/detail now
// read. (No "cancelled" appears in the seed.)
function specManualStatus(spec: SampleCustomerSpec): {
  contractStatus: "negotiating" | "contracted" | "lost" | "cancelled";
  contractPlan: string | null;
  constructionStatus: "not_started" | "in_progress" | "done";
  subsidyStatus: "none" | "applying" | "granted";
  subsidyType: string | null;
} {
  const contractStatus =
    spec.dealStatus === "LOST"
      ? "lost"
      : spec.contract || spec.dealStatus === "CONTRACTED"
        ? "contracted"
        : "negotiating";

  const constructionStatus = !spec.contract?.constructionStatus
    ? "not_started"
    : spec.contract.constructionStatus === "DONE"
      ? "done"
      : spec.contract.constructionStatus === "CONSTRUCTING"
        ? "in_progress"
        : "not_started"; // REQUEST_PENDING

  const subsidyStatus = !spec.contract?.applicationStatus
    ? "none"
    : spec.contract.applicationStatus === "APPROVED"
      ? "granted"
      : spec.contract.applicationStatus === "SUBMITTED"
        ? "applying"
        : "none"; // DRAFT

  return {
    contractStatus,
    contractPlan: contractStatus === "contracted" ? "3.5kW 太陽光 + 蓄電池" : null,
    constructionStatus,
    subsidyStatus,
    subsidyType: subsidyStatus === "none" ? null : "国補助金",
  };
}

// エリアマスタ名（都道府県）を住所先頭から取り出す。シードの住所は
// 東京都/神奈川県/埼玉県/千葉県 で始まり、いずれもエリアマスタに存在する。
function leadingPrefecture(address: string): string | null {
  const m = address.match(/^(東京都|北海道|京都府|大阪府|.{2,3}県)/);
  return m ? m[1]! : null;
}

async function seedCustomers(
  tx: TxClient,
  args: { wholesalerId: string; userId: string; now: Date },
): Promise<void> {
  const { wholesalerId, userId, now } = args;

  // Idempotency: if the sample customers already exist (created before the
  // manual status columns existed → still holding column DEFAULTS), UPDATE their
  // status columns to keep the demo's variety instead of skipping.
  const existing = await tx.customer.findFirst({
    where: { wholesalerId, name: { startsWith: SAMPLE_CUSTOMER_PREFIX } },
    select: { id: true },
  });
  if (existing) {
    for (const spec of SAMPLE_CUSTOMERS) {
      const manual = specManualStatus(spec);
      await tx.customer.updateMany({
        where: { wholesalerId, name: `${SAMPLE_CUSTOMER_PREFIX}${spec.family} ${spec.given}` },
        data: {
          area: leadingPrefecture(spec.address),
          contractStatus: manual.contractStatus,
          contractPlan: manual.contractPlan,
          constructionStatus: manual.constructionStatus,
          subsidyStatus: manual.subsidyStatus,
          subsidyType: manual.subsidyType,
        },
      });
    }
    await seedCustomerActivities(tx, { wholesalerId, userId, now });
    return;
  }

  let phoneSeq = 1000;
  for (const spec of SAMPLE_CUSTOMERS) {
    const manual = specManualStatus(spec);
    const customer = await tx.customer.create({
      data: {
        wholesalerId,
        name: `${SAMPLE_CUSTOMER_PREFIX}${spec.family} ${spec.given}`,
        phone: `090-0000-${String(phoneSeq++).padStart(4, "0")}`,
        address: spec.address,
        area: leadingPrefecture(spec.address),
        channel: "EVENT",
        registeredByUserId: userId,
        registeredByOrgType: "WHOLESALER",
        status: "NEW",
        contractStatus: manual.contractStatus,
        contractPlan: manual.contractPlan,
        constructionStatus: manual.constructionStatus,
        subsidyStatus: manual.subsidyStatus,
        subsidyType: manual.subsidyType,
      },
      select: { id: true },
    });

    if (spec.apptInDays !== undefined) {
      const scheduledAt = new Date(now.getTime() + spec.apptInDays * 24 * 60 * 60 * 1000);
      const appointment = await tx.appointment.create({
        data: {
          customerId: customer.id,
          scheduledAt,
          acquiredByUserId: userId,
          acquiredOrgType: "WHOLESALER",
        },
        select: { id: true },
      });
      if (spec.withPreCall) {
        await tx.preCall.create({
          data: {
            appointmentId: appointment.id,
            calledAt: now,
            result: "APPROVED",
            calledByUserId: userId,
          },
        });
      }
    }

    if (spec.dealStatus) {
      const deal = await tx.deal.create({
        data: {
          customerId: customer.id,
          ownerType: "WHOLESALER",
          ownerUserId: userId,
          status: spec.dealStatus,
        },
        select: { id: true },
      });

      if (spec.contract) {
        const contractDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
        const cancelDeadline = new Date(contractDate.getTime() + 8 * 24 * 60 * 60 * 1000);
        const contract = await tx.contract.create({
          data: {
            wholesalerId,
            dealId: deal.id,
            customerId: customer.id,
            contractDate,
            contractAmount: "3500000",
            cancelDeadline,
            createdBy: userId,
          },
          select: { id: true },
        });
        if (spec.contract.constructionStatus) {
          await tx.construction.create({
            data: {
              contractId: contract.id,
              status: spec.contract.constructionStatus,
              fileKeys: [],
            },
          });
        }
        if (spec.contract.applicationStatus) {
          await tx.application.create({
            data: {
              contractId: contract.id,
              type: "国補助金",
              status: spec.contract.applicationStatus,
              fileKeys: [],
            },
          });
        }
      }
    }
  }

  await seedCustomerActivities(tx, { wholesalerId, userId, now });
}

// 商談履歴 / 発生タスクのデモシード。各サンプル顧客につき、まだ activity が 1 件も
// 無い場合のみ作成する（冪等）。CustomerFile は実 R2 オブジェクトの裏付けが無いため
// シードしない（ユーザーが UI からアップロードするまで「関連ファイル」は空のまま）。
async function seedCustomerActivities(
  tx: TxClient,
  args: { wholesalerId: string; userId: string; now: Date },
): Promise<void> {
  const { wholesalerId, userId, now } = args;
  const day = 24 * 60 * 60 * 1000;
  const at = (daysAgo: number, h: number, mi: number): Date => {
    const base = new Date(now.getTime() - daysAgo * day);
    base.setHours(h, mi, 0, 0);
    return base;
  };

  // 1 件目（5 件スレッド + 3 タスク）。残りは軽め（1〜2 件）。
  const richThread: { category: string; detail: string; date: Date }[] = [
    {
      category: "event",
      detail:
        "イベントにお越しいただき、太陽光と蓄電池のご案内を実施。ご興味を持っていただき、後日お見積もりをお渡しする約束をしました。",
      date: at(1, 14, 35),
    },
    {
      category: "phone",
      detail: "見積書をメールにて送付。設置場所やご希望条件の確認を実施。",
      date: at(9, 16, 20),
    },
    {
      category: "appointment",
      detail:
        "初回アポイントを実施。電気使用状況のヒアリングとシミュレーションを提示。太陽光＋蓄電池のプランで検討したいとのこと。",
      date: at(14, 10, 0),
    },
    {
      category: "email",
      detail: "シミュレーション資料と会社案内を送付。",
      date: at(21, 9, 30),
    },
    {
      category: "visit",
      detail:
        "新規開拓にてご自宅を訪問。簡単にサービスのご説明をし、イベント案内チラシをお渡し。イベントへの来場を約束。",
      date: at(28, 11, 5),
    },
  ];
  const richTasks: { content: string; dueInDays: number; done: boolean }[] = [
    { content: "見積書のフォロー連絡", dueInDays: 3, done: false },
    { content: "現地調査のアポイント調整", dueInDays: 6, done: false },
    { content: "補助金制度の案内資料送付", dueInDays: 8, done: true },
  ];
  const lightThreads: Record<number, { category: string; detail: string; date: Date }[]> = {
    1: [
      { category: "phone", detail: "在宅状況の確認とご訪問日時の打診。", date: at(2, 13, 0) },
    ],
    2: [
      {
        category: "appointment",
        detail: "ご自宅にて初回ご訪問。設置条件と屋根形状を確認。",
        date: at(4, 15, 30),
      },
      { category: "email", detail: "概算お見積りと補助金の概要を送付。", date: at(1, 10, 15) },
    ],
  };

  for (let i = 0; i < SAMPLE_CUSTOMERS.length; i += 1) {
    const spec = SAMPLE_CUSTOMERS[i]!;
    const customer = await tx.customer.findFirst({
      where: { wholesalerId, name: `${SAMPLE_CUSTOMER_PREFIX}${spec.family} ${spec.given}` },
      select: { id: true },
    });
    if (!customer) continue;

    const already = await tx.customerActivity.count({ where: { customerId: customer.id } });
    if (already > 0) continue;

    const thread = i === 0 ? richThread : lightThreads[i] ?? lightThreads[1]!;
    let createdFirst = "";
    for (const entry of thread) {
      const activity = await tx.customerActivity.create({
        data: {
          customerId: customer.id,
          occurredAt: entry.date,
          category: entry.category,
          detail: entry.detail,
          createdByUserId: userId,
        },
        select: { id: true },
      });
      if (!createdFirst) createdFirst = activity.id;
    }

    if (i === 0) {
      for (const task of richTasks) {
        await tx.customerTask.create({
          data: {
            customerId: customer.id,
            activityId: createdFirst,
            content: task.content,
            dueDate: new Date(now.getTime() + task.dueInDays * day),
            assigneeUserId: userId,
            done: task.done,
            createdByUserId: userId,
          },
        });
      }
    }
  }
}

// Seed dealer commission rates + history (F-049 / S-049 / 手数料設定).
//
// 各パイロット関係（alpha / beta / gamma）に対し率と applyFrom=2026-04-01 を
// 固定で設定し、新規作成 1 行と微調整 1 行で履歴を 2 行ずつ作る。
// idempotent — DealerCommissionRate.relationshipId は @unique なので
// findUnique でスキップ判定可能。
async function seedDealerCommissionRates(
  tx: TxClient,
  args: { wholesalerId: string; userId: string; relationshipIds: string[] },
): Promise<void> {
  const { wholesalerId, userId, relationshipIds } = args;
  const applyFrom = new Date("2026-04-01T00:00:00Z");

  // [alpha, beta, gamma] — rels 配列の順番に対応した率セット.
  const PROFILES: { tossUp: string; closing: string; initialSummary: string; adjustSummary: string }[] = [
    {
      tossUp: "1.50",
      closing: "3.00",
      initialSummary:
        "新規作成（トスアップ率 1.0% → 1.5% / クロージング率 2.5% → 3.0%）",
      adjustSummary: "クロージング率 2.5% → 3.0%（運用条件見直し）",
    },
    {
      tossUp: "2.00",
      closing: "3.50",
      initialSummary:
        "新規作成（トスアップ率 1.5% → 2.0% / クロージング率 3.0% → 3.5%）",
      adjustSummary: "トスアップ率 1.5% → 2.0%（成約率向上施策に伴う引き上げ）",
    },
    {
      tossUp: "1.00",
      closing: "2.50",
      initialSummary:
        "新規作成（トスアップ率 1.0% / クロージング率 2.5%）",
      adjustSummary: "値の変更なし",
    },
  ];

  for (let i = 0; i < relationshipIds.length && i < PROFILES.length; i++) {
    const relId = relationshipIds[i]!;
    const profile = PROFILES[i]!;

    const existing = await tx.dealerCommissionRate.findUnique({
      where: { relationshipId: relId },
      select: { id: true },
    });
    if (existing) continue;

    const created = await tx.dealerCommissionRate.create({
      data: {
        wholesalerId,
        relationshipId: relId,
        tossUpRate: profile.tossUp,
        closingRate: profile.closing,
        applyFrom,
        applyTo: null,
        updatedByUserId: userId,
      },
      select: { id: true },
    });

    await tx.dealerCommissionRateChange.createMany({
      data: [
        {
          rateId: created.id,
          changedByUserId: userId,
          summary: profile.initialSummary,
        },
        {
          rateId: created.id,
          changedByUserId: userId,
          summary: profile.adjustSummary,
        },
      ],
    });
  }
}

async function main(): Promise<void> {
  // We intentionally use `console.*` here instead of the @solar/contracts pino
  // logger — the seed runs at the migration boundary, often before the rest of
  // the workspace is built, and pulling in the cross-package logger would
  // make `@solar/db` cyclically depend on `@solar/contracts`. Plain stdout is
  // enough for an admin-facing one-shot script. The pilot password is NEVER
  // emitted (docs/05 §10.1 redact list).
  console.info("[seed] start");

  const summary = await seedAll();

  console.info(
    `[seed] complete: wholesaler="${TENANT_KEY.pilotWholesaler}", dealers=3, ` +
      `users=${summary.userCount}, relationships=${summary.relationshipIds.length}`,
  );
}

// `tsx prisma/seed.ts` invokes this file as the entrypoint. The check guards
// against accidental re-execution when `seedAll` is imported (e.g. by tests).
const invokedAsScript = process.argv[1]?.replace(/\\/g, "/").endsWith("/prisma/seed.ts") ?? false;

if (invokedAsScript) {
  main()
    .catch((err) => {
      console.error("seed: failed", err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await rawPrisma.$disconnect();
    });
}
