// Solar-SaaS — development / pilot seed script (T-01-12).
//
// Idempotent seed that bootstraps the dataset operators / E2E tests rely on:
//   - One internal WHOLESALER tenant ("Solar SaaS 運営") for SAAS_ADMIN users.
//     The schema's TenantType enum only has WHOLESALER | DEALER, and User
//     rows require a tenantId; so we materialise a synthetic wholesaler
//     dedicated to the operator. RLS-wise this tenant has no Relationships
//     and never appears in dealer / wholesaler-internal joins.
//   - The pilot WHOLESALER ("株式会社サンライズソーラー") plus its three DEALER
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
  pilotWholesaler: "株式会社サンライズソーラー",
  dealerAlpha: "株式会社グリーンフィールド",
  dealerBeta: "あおぞらエナジー株式会社",
  dealerGamma: "株式会社スマイル電設",
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
    name: "高田 健司",
    tenantKey: "saasOps",
    role: "SAAS_ADMIN",
    twoFactorRequired: true,
  },
  {
    email: "wholesaler_admin@solar-saas.dev",
    name: "山下 浩一",
    tenantKey: "pilotWholesaler",
    role: "WHOLESALER_ADMIN",
    twoFactorRequired: true,
  },
  {
    email: "wholesaler_event_team@solar-saas.dev",
    name: "佐藤 美咲",
    tenantKey: "pilotWholesaler",
    role: "WHOLESALER_EVENT_TEAM",
    twoFactorRequired: false,
  },
  {
    email: "wholesaler_call_team@solar-saas.dev",
    name: "田中 由美",
    tenantKey: "pilotWholesaler",
    role: "WHOLESALER_CALL_TEAM",
    twoFactorRequired: false,
  },
  {
    email: "wholesaler_direct_sales@solar-saas.dev",
    name: "鈴木 大輔",
    tenantKey: "pilotWholesaler",
    role: "WHOLESALER_DIRECT_SALES",
    twoFactorRequired: false,
  },
  {
    email: "wholesaler_field_staff@solar-saas.dev",
    name: "中村 翔太",
    tenantKey: "pilotWholesaler",
    role: "WHOLESALER_FIELD_STAFF",
    twoFactorRequired: false,
  },
  {
    email: "alpha-admin@solar-saas.dev",
    name: "小林 誠",
    tenantKey: "dealerAlpha",
    role: "DEALER_ADMIN",
    twoFactorRequired: false,
  },
  {
    email: "alpha-staff@solar-saas.dev",
    name: "加藤 健太",
    tenantKey: "dealerAlpha",
    role: "DEALER_STAFF",
    twoFactorRequired: false,
  },
  {
    email: "beta-admin@solar-saas.dev",
    name: "渡辺 隆",
    tenantKey: "dealerBeta",
    role: "DEALER_ADMIN",
    twoFactorRequired: false,
  },
  {
    email: "beta-staff@solar-saas.dev",
    name: "伊藤 直樹",
    tenantKey: "dealerBeta",
    role: "DEALER_STAFF",
    twoFactorRequired: false,
  },
  {
    email: "gamma-admin@solar-saas.dev",
    name: "山本 和也",
    tenantKey: "dealerGamma",
    role: "DEALER_ADMIN",
    twoFactorRequired: false,
  },
  {
    email: "gamma-staff@solar-saas.dev",
    name: "松本 亮",
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
  args: { wholesalerId: string; dealerId: string; defaultScope: DealerScope; franchiseNo?: string },
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
      ...(args.franchiseNo ? { franchiseNo: args.franchiseNo } : {}),
    },
    create: {
      wholesalerId: args.wholesalerId,
      dealerId: args.dealerId,
      status: "ACTIVE",
      defaultScope: args.defaultScope,
      ...(args.franchiseNo ? { franchiseNo: args.franchiseNo } : {}),
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
        franchiseNo: "ERP01",
      }),
      upsertRelationship(tx, {
        wholesalerId: pilot.id,
        dealerId: beta.id,
        defaultScope: DEALER_SCOPE_BY_KEY.dealerBeta,
        franchiseNo: "ERP02",
      }),
      upsertRelationship(tx, {
        wholesalerId: pilot.id,
        dealerId: gamma.id,
        defaultScope: DEALER_SCOPE_BY_KEY.dealerGamma,
        franchiseNo: "ERP03",
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
      name: "藤原 健太郎",
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
      where: { wholesalerId: pilot.id, name: "スーパービバホーム" },
      select: { id: true },
    });
    const venueProvider = existingVp
      ? existingVp
      : await tx.venueProvider.create({
          data: {
            wholesalerId: pilot.id,
            name: "スーパービバホーム",
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

    // Seed 二次店レーン希望 (F-060 / ボトムアップ構造) so the 二次店希望一覧 screen
    // renders data. 二次店は希望場所(venueLabel)・希望開催日(desiredDates)を自由記述で
    // 提出する（確定レーン LineEvent に依存しない）。任意リンク venueProviderId は
    // 突合用に付与（loader が name 解決）。idempotent: (relationshipId, targetMonth) 一意。
    // rels[] is [alpha, beta, gamma]. 日付は決定論的に lineMonth から週単位で組む。
    const wd = (day: number) => `${lineMonth}-${String(day).padStart(2, "0")}`;
    const LANE_PREFERENCE_SEEDS = [
      {
        relationshipId: rels[0]!.id, // alpha
        note: "土日を中心に2会場で展開希望。要員2名で対応可能です。",
        items: [
          {
            priority: 1,
            venueLabel: "カインズ 大宮店",
            venueProviderId: venueProvider.id,
            desiredDates: [wd(7), wd(8), wd(14), wd(15)],
            memo: "駐車場側スペースを希望",
          },
          {
            priority: 2,
            venueLabel: "コメリ 大宮店",
            desiredDates: [wd(21), wd(22)],
            memo: null,
          },
        ],
      },
      {
        relationshipId: rels[1]!.id, // beta
        note: "平日も対応可能です。",
        items: [
          {
            priority: 1,
            venueLabel: "ビバホーム さいたま新都心店",
            desiredDates: [wd(7), wd(8), wd(9)],
            memo: "初週に集中したい",
          },
          {
            priority: 2,
            venueLabel: "カインズ 大宮店",
            venueProviderId: venueProvider.id,
            desiredDates: [wd(28), wd(29)],
            memo: null,
          },
        ],
      },
    ];
    // upsert（items 入れ替え含む）: 構造変更（ボトムアップ化）前の旧構造 LanePreference
    // 行が残る環境でも新構造デモへ収束させる。既存があれば note を更新し子 items を
    // 全削除→新構造で再作成。無ければ create。tx 内なので delete→create は原子的。
    // 複数回流しても同一結果（決定論的・冪等）。
    for (const pref of LANE_PREFERENCE_SEEDS) {
      const itemsCreate = pref.items.map((it) => ({
        priority: it.priority,
        venueLabel: it.venueLabel,
        venueProviderId: it.venueProviderId ?? null,
        desiredDates: it.desiredDates,
        memo: it.memo ?? null,
      }));
      const existingPref = await tx.lanePreference.findUnique({
        where: {
          relationshipId_targetMonth: {
            relationshipId: pref.relationshipId,
            targetMonth: lineMonth,
          },
        },
        select: { id: true },
      });
      if (existingPref) {
        await tx.lanePreferenceItem.deleteMany({
          where: { lanePreferenceId: existingPref.id },
        });
        await tx.lanePreference.update({
          where: { id: existingPref.id },
          data: {
            note: pref.note,
            submittedBy: pilotAdminId,
            items: { create: itemsCreate },
          },
        });
      } else {
        await tx.lanePreference.create({
          data: {
            wholesalerId: pilot.id,
            relationshipId: pref.relationshipId,
            targetMonth: lineMonth,
            note: pref.note,
            submittedBy: pilotAdminId,
            items: { create: itemsCreate },
          },
        });
      }
    }

    // Seed ~12 sample customers for pilotWholesaler with VARIED related records
    // so every status badge value on the 顧客一覧 screen (F-032) is visible.
    // Idempotent: skipped entirely if any sample customer (by name prefix) is
    // already present, mirroring the find-or-create style used above.
    await seedCustomers(tx, { wholesalerId: pilot.id, userId: pilotAdminId, now });

    // 顧客ファイルのカテゴリ分離（GENERAL / APPLICATION）のデモシード。先頭サンプル顧客に
    // 各カテゴリ 1 件ずつメタデータのみ投入（冪等）。activity 投入有無に依存しない独立ステップ。
    await seedCustomerFiles(tx, { wholesalerId: pilot.id, userId: pilotAdminId });

    // F-061 案件情報の実データ化（docs/05 §16-C）。サンプル / イベントデモ顧客の
    // 契約に ContractPayment / ContractEquipment + Contract/Construction 拡張列の
    // デモ値を冪等に投入する。
    await seedContractProjectData(tx, { wholesalerId: pilot.id, now });

    // F-063 住環境・家族属性ヒアリングのデモ化（docs/05 §17）。既設設備（現況）・家族
    // 年齢・分離電話・マエカク希望日時・アポ取得日を冪等に投入（既存顧客に紐づけ）。
    await seedCustomerHearing(tx, { wholesalerId: pilot.id, now });

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

// Demo customers carry realistic names (no synthetic prefix). The idempotency
// guard matches the exact full names of this fixed sample set instead.
function sampleCustomerName(spec: { family: string; given: string }): string {
  return `${spec.family} ${spec.given}`;
}
const SAMPLE_CUSTOMER_NAMES = (): string[] => SAMPLE_CUSTOMERS.map(sampleCustomerName);

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
  { family: "佐藤", given: "一馬", address: "東京都新宿区西新宿1-1-1", withPreCall: false },
  // 提案中 (early deal) / マエカク 有 / upcoming appt
  {
    family: "鈴木",
    given: "雄太",
    address: "東京都渋谷区道玄坂2-2-2",
    apptInDays: 3,
    withPreCall: true,
    dealStatus: "PROPOSING",
  },
  // 商談中 (QUOTED) / マエカク 有 / upcoming appt
  {
    family: "高橋",
    given: "涼介",
    address: "神奈川県横浜市西区みなとみらい3-3",
    apptInDays: 5,
    withPreCall: true,
    dealStatus: "QUOTED",
  },
  // 商談中 (CONSIDERING) / マエカク 無 / past appt
  {
    family: "田中",
    given: "大樹",
    address: "埼玉県さいたま市大宮区桜木町4-4",
    apptInDays: -10,
    withPreCall: false,
    dealStatus: "CONSIDERING",
  },
  // 商談中 (LIKELY_CONTRACT) / マエカク 有
  {
    family: "伊藤",
    given: "駿",
    address: "千葉県千葉市中央区中央5-5",
    apptInDays: 7,
    withPreCall: true,
    dealStatus: "LIKELY_CONTRACT",
  },
  // 失注 / マエカク 無 / past appt
  {
    family: "渡辺",
    given: "颯太",
    address: "東京都品川区大崎6-6",
    apptInDays: -20,
    withPreCall: false,
    dealStatus: "LOST",
  },
  // 契約済み / 未着工 / 未申請 / マエカク 有
  {
    family: "山本",
    given: "隆志",
    address: "東京都目黒区中目黒7-7",
    apptInDays: 2,
    withPreCall: true,
    dealStatus: "CONTRACTED",
    contract: { constructionStatus: "REQUEST_PENDING", applicationStatus: "DRAFT" },
  },
  // 契約済み / 着工中 / 申請中 / マエカク 有
  {
    family: "中村",
    given: "健吾",
    address: "神奈川県川崎市中原区小杉町8-8",
    apptInDays: 4,
    withPreCall: true,
    dealStatus: "CONTRACTED",
    contract: { constructionStatus: "CONSTRUCTING", applicationStatus: "SUBMITTED" },
  },
  // 契約済み / 施工完了 / 交付決定 / マエカク 無
  {
    family: "小林",
    given: "拓海",
    address: "埼玉県川口市本町9-9",
    apptInDays: -30,
    withPreCall: false,
    dealStatus: "CONTRACTED",
    contract: { constructionStatus: "DONE", applicationStatus: "APPROVED" },
  },
  // 契約済み / 施工完了 / 申請中 / マエカク 有
  {
    family: "加藤",
    given: "悠斗",
    address: "千葉県船橋市本町10-10",
    apptInDays: 10,
    withPreCall: true,
    dealStatus: "CONTRACTED",
    contract: { constructionStatus: "DONE", applicationStatus: "SUBMITTED" },
  },
  // 契約済み / 着工中 / 未申請 / マエカク 無
  {
    family: "吉田",
    given: "美穂",
    address: "東京都世田谷区三軒茶屋11-11",
    withPreCall: false,
    dealStatus: "CONTRACTED",
    contract: { constructionStatus: "CONSTRUCTING" },
  },
  // 提案中 (VISIT_PLANNED) / マエカク 有 / upcoming appt
  {
    family: "山田",
    given: "香織",
    address: "神奈川県相模原市中央区中央12-12",
    apptInDays: 1,
    withPreCall: true,
    dealStatus: "VISIT_PLANNED",
  },
];

// Map a sample spec's intent to the manual status columns the list/detail now
// read. (No "cancelled" appears in the seed.)
function specManualStatus(spec: SampleCustomerSpec): {
  contractStatus:
    | "pre_visit"
    | "negotiating"
    | "quote_presented"
    | "contract_pending"
    | "contracted"
    | "lost"
    | "cancelled";
  contractPlan: string | null;
  constructionStatus: "not_started" | "in_progress" | "done";
  subsidyStatus: "not_applied" | "preparing" | "applied" | "revising" | "completed";
  subsidyType: string | null;
} {
  // dealStatus を新 6 値域に写像してデモを散らす。
  const contractStatus =
    spec.dealStatus === "LOST"
      ? "lost"
      : spec.contract || spec.dealStatus === "CONTRACTED"
        ? "contracted"
        : spec.dealStatus === "LIKELY_CONTRACT"
          ? "contract_pending"
          : spec.dealStatus === "QUOTED" || spec.dealStatus === "CONSIDERING"
            ? "quote_presented"
            : spec.dealStatus === "PROPOSING" || spec.dealStatus === "VISIT_PLANNED"
              ? "negotiating"
              : "pre_visit";

  const constructionStatus = !spec.contract?.constructionStatus
    ? "not_started"
    : spec.contract.constructionStatus === "DONE"
      ? "done"
      : spec.contract.constructionStatus === "CONSTRUCTING"
        ? "in_progress"
        : "not_started"; // REQUEST_PENDING

  const subsidyStatus = !spec.contract?.applicationStatus
    ? "not_applied"
    : spec.contract.applicationStatus === "APPROVED"
      ? "completed"
      : spec.contract.applicationStatus === "SUBMITTED"
        ? "applied"
        : "preparing"; // DRAFT

  return {
    contractStatus,
    contractPlan: contractStatus === "contracted" ? "3.5kW 太陽光 + 蓄電池" : null,
    constructionStatus,
    subsidyStatus,
    subsidyType: subsidyStatus === "not_applied" ? null : "国補助金",
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
    where: { wholesalerId, name: { in: SAMPLE_CUSTOMER_NAMES() } },
    select: { id: true },
  });
  if (existing) {
    for (const spec of SAMPLE_CUSTOMERS) {
      const manual = specManualStatus(spec);
      await tx.customer.updateMany({
        where: { wholesalerId, name: sampleCustomerName(spec) },
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
        name: sampleCustomerName(spec),
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

// F-061 案件情報タブの実データ化（docs/05 §16-C）。当該卸業者の各契約に対し、
// ContractPayment（1:1）/ ContractEquipment（PV+BT の最低 2 行）と Contract /
// Construction の拡張列のデモ値を投入する。冪等: ContractPayment が既に存在する
// 契約はスキップし、ContractEquipment も 0 件のときのみ作成する。
async function seedContractProjectData(
  tx: TxClient,
  args: { wholesalerId: string; now: Date },
): Promise<void> {
  const { wholesalerId, now } = args;
  const day = (offset: number): Date => new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);

  const contracts = await tx.contract.findMany({
    where: { wholesalerId },
    select: {
      id: true,
      contractDate: true,
      payment: { select: { id: true } },
      equipment: { select: { id: true } },
      constructions: { select: { id: true, status: true } },
    },
  });

  let i = 0;
  for (const c of contracts) {
    const seq = i++;
    const completed = c.constructions.some((con) => con.status === "DONE");
    const constructing = c.constructions.some(
      (con) => con.status === "CONSTRUCTING" || con.status === "SURVEYED",
    );

    // Contract 拡張列（運用ステータス・コール・設備ID）— updateMany で常に冪等更新。
    await tx.contract.update({
      where: { id: c.id },
      data: {
        docsUrl: `https://docs.example.com/contracts/${c.id.slice(-8)}.pdf`,
        equipmentSerialId: `EQ-${100000 + seq * 137}`,
        loanReviewCallAt: day(-3),
        thankYouCallAt: completed ? day(-1) : null,
        callStatus: completed ? "DONE" : constructing ? "SCHEDULED" : "NONE",
        defectStatus: seq % 3 === 0 ? "OPEN" : "NONE",
        defectDetail: seq % 3 === 0 ? "申請書類の押印漏れ。再取得を依頼。" : null,
        postCompletionStatus: completed ? "DONE" : constructing ? "IN_PROGRESS" : "NONE",
      },
    });

    // Construction 拡張列。代表行 1 件の着工・売電・候補日・対応事業者名を補完。
    const rep = c.constructions[0];
    if (rep) {
      await tx.construction.update({
        where: { id: rep.id },
        data: {
          surveyDate: day(-7),
          // 現地調査ステータス（施工ステータスとは独立）。デモは進捗に合わせて散らす。
          surveyStatus: completed || constructing ? "surveyed" : seq % 2 === 0 ? "scheduled" : "not_surveyed",
          startedDate: constructing || completed ? day(-5) : null,
          completedDate: completed ? day(-1) : null,
          powerSaleStartDate: completed ? day(10) : null,
          surveyCandidates: [day(-9).toISOString(), day(-8).toISOString()],
          constructionCandidates: [day(-6).toISOString(), day(-5).toISOString()],
          vendorName: "サンプル施工 株式会社",
          fee: 850000 + (seq % 4) * 50000,
        },
      });
    }

    // ContractPayment（1:1）— 未作成のときのみ。
    if (!c.payment) {
      await tx.contractPayment.create({
        data: {
          contractId: c.id,
          paymentStatus: completed ? "PAID" : seq % 2 === 0 ? "PARTIAL" : "UNPAID",
          paymentCount: [1, 60, 120, 180][seq % 4],
          loanCompany: ["ジャックス", "アプラス", "オリコ", "現金一括"][seq % 4],
          downPayment: (seq % 5) * 100000,
          creditLifeInsurance: seq % 2 === 0,
          loanNote: seq % 2 === 0 ? "事前審査承認済み。本審査は契約後に申請。" : null,
          loanReviewStatus: ["not_reviewed", "reviewing", "completed", "defect"][seq % 4],
          depositDate: completed ? day(-2) : null,
          dealerPayoutDate: completed ? day(5) : null,
        },
      });
    }

    // ContractEquipment（PV + BT の最低 2 行）— 0 件のときのみ。
    if (c.equipment.length === 0) {
      await tx.contractEquipment.create({
        data: {
          contractId: c.id,
          category: "PV",
          contracted: true,
          manufacturer: ["長州産業", "カナディアンソーラー", "Qセルズ"][seq % 3],
          model: `CS-${400 + (seq % 60)}MB`,
          capacity: `${(3.5 + (seq % 4)).toFixed(1)} kW`,
          quantity: 8 + (seq % 16),
          installLocation: ["屋外（北側）", "屋内（玄関収納）", "屋外（車庫横）"][seq % 3],
          warrantyStandard: true,
          warrantyExtended: seq % 2 === 0,
          attributes: { pvOutputWarranty: true, pvOption: seq % 2 === 0 ? "HEMS" : "なし" },
        },
      });
      if (seq % 2 === 0) {
        await tx.contractEquipment.create({
          data: {
            contractId: c.id,
            category: "BT",
            contracted: true,
            manufacturer: ["長州産業", "ニチコン", "オムロン"][seq % 3],
            model: `ET-${40 + (seq % 60)}B3`,
            capacity: `${(6.5 + (seq % 10)).toFixed(1)} kWh`,
            installLocation: ["屋外", "屋内（階段下）", "車庫"][seq % 3],
            warrantyDisaster: true,
            warrantyExtended: true,
          },
        });
      }
    }
  }
}

// F-063 住環境・家族属性ヒアリングのデモシード（docs/05 §17）。当該卸業者の顧客に対し、
// 家族年齢・分離電話・案内者・マエカク希望日時・既設設備（現況）・アポ取得日を投入する。
// 冪等・決定論的: Customer 拡張列は常に同値で update、CustomerExistingEquipment は
// category 単位 upsert（@@unique([customerId, category])）、acquiredAt は代表アポへ反映。
async function seedCustomerHearing(
  tx: TxClient,
  args: { wholesalerId: string; now: Date },
): Promise<void> {
  const { wholesalerId, now } = args;
  const day = (offset: number): Date => new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);

  const customers = await tx.customer.findMany({
    where: { wholesalerId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  const GUIDE = ["HUSBAND", "WIFE", "BOTH", "OTHER"] as const;
  const PRESENCE = ["YES", "NO", "UNKNOWN"] as const;
  const MAKERS = ["パナソニック", "三菱電機", "ダイキン", "コロナ"];
  const PV_MAKERS = ["長州産業", "カナディアンソーラー", "Qセルズ"];

  let seq = 0;
  for (const c of customers) {
    const s = seq++;

    await tx.customer.update({
      where: { id: c.id },
      data: {
        landlinePhone: `03-5${String(1000 + s).padStart(4, "0")}-${String(2000 + s).padStart(4, "0")}`,
        mobilePhone: `090-1${String(1000 + s).padStart(4, "0")}-${String(3000 + s).padStart(4, "0")}`,
        husbandAge: 38 + (s % 25),
        wifeAge: 35 + (s % 23),
        childAge: s % 3 === 0 ? null : 4 + (s % 14),
        guideAttendee: GUIDE[s % GUIDE.length],
        faceToFace: s % 2 === 0,
        proposedProduct: s % 3 === 0 ? "蓄電池 + V2H" : "太陽光 + 蓄電池",
        maekakuPreferredAt: day(2 + (s % 5)),
        // コール状況（バッチ B）。not_done/done/unnecessary を巡回投入。
        postCompletionCallStatus: ["not_done", "done", "unnecessary"][s % 3],
        postCompletionCallPreferredAt: s % 3 === 0 ? day(3 + (s % 4)) : null,
        loanCompletionCallStatus: ["done", "unnecessary", "not_done"][s % 3],
        loanCompletionCallPreferredAt: s % 2 === 0 ? day(1 + (s % 3)) : null,
        generalCallPreferredTime: s % 2 === 0 ? "平日19:00以降" : "土日終日",
        maekakuPreferredPhone: `080-2${String(1000 + s).padStart(4, "0")}-${String(4000 + s).padStart(4, "0")}`,
      },
    });

    // ガス給湯器（有無のみ）。
    await tx.customerExistingEquipment.upsert({
      where: { customerId_category: { customerId: c.id, category: "GAS_WATER_HEATER" } },
      create: {
        customerId: c.id,
        category: "GAS_WATER_HEATER",
        installed: PRESENCE[s % PRESENCE.length],
      },
      update: { installed: PRESENCE[s % PRESENCE.length] },
    });

    // エコキュート（有無 + 設置日 + メーカー）。
    const eqPresence = PRESENCE[(s + 1) % PRESENCE.length];
    await tx.customerExistingEquipment.upsert({
      where: { customerId_category: { customerId: c.id, category: "ECO_CUTE" } },
      create: {
        customerId: c.id,
        category: "ECO_CUTE",
        installed: eqPresence,
        installDate: eqPresence === "YES" ? day(-365 * (1 + (s % 6))) : null,
        maker: eqPresence === "YES" ? MAKERS[s % MAKERS.length] : null,
      },
      update: {
        installed: eqPresence,
        installDate: eqPresence === "YES" ? day(-365 * (1 + (s % 6))) : null,
        maker: eqPresence === "YES" ? MAKERS[s % MAKERS.length] : null,
      },
    });

    // 太陽光（既設）— 有無 + 設置日 + メーカー + 容量 + 枚数。
    const pvPresence = PRESENCE[(s + 2) % PRESENCE.length];
    await tx.customerExistingEquipment.upsert({
      where: { customerId_category: { customerId: c.id, category: "PV" } },
      create: {
        customerId: c.id,
        category: "PV",
        installed: pvPresence,
        installDate: pvPresence === "YES" ? day(-365 * (2 + (s % 8))) : null,
        maker: pvPresence === "YES" ? PV_MAKERS[s % PV_MAKERS.length] : null,
        capacityKw: pvPresence === "YES" ? (3.5 + (s % 4)).toFixed(2) : null,
        panelCount: pvPresence === "YES" ? 8 + (s % 16) : null,
      },
      update: {
        installed: pvPresence,
        installDate: pvPresence === "YES" ? day(-365 * (2 + (s % 8))) : null,
        maker: pvPresence === "YES" ? PV_MAKERS[s % PV_MAKERS.length] : null,
        capacityKw: pvPresence === "YES" ? (3.5 + (s % 4)).toFixed(2) : null,
        panelCount: pvPresence === "YES" ? 8 + (s % 16) : null,
      },
    });

    // アポ取得日 — 代表アポ（最新 scheduledAt）へ反映。
    const rep = await tx.appointment.findFirst({
      where: { customerId: c.id },
      orderBy: { scheduledAt: "desc" },
      select: { id: true },
    });
    if (rep) {
      await tx.appointment.update({
        where: { id: rep.id },
        data: { acquiredAt: day(-(3 + (s % 10))) },
      });
    }
  }
}

// 商談履歴 / 発生タスクのデモシード。各サンプル顧客につき、まだ activity が 1 件も
// 無い場合のみ作成する（冪等）。CustomerFile はカテゴリ分離デモのため別ステップ
// seedCustomerFiles で先頭サンプル顧客に各カテゴリ 1 件ずつ投入する（メタデータのみ）。
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
      where: { wholesalerId, name: sampleCustomerName(spec) },
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

// 顧客ファイルのカテゴリ分離（GENERAL=関連ファイルタブ / APPLICATION=設置申請タブの
// 申請関連ドキュメント）のデモシード。先頭サンプル顧客に各カテゴリ 1 件ずつメタデータのみ
// 投入する。fileKey は実 R2 オブジェクトの裏付けが無いダミー（一覧描画は R2 を叩かず DB 行
// だけで成立し、ダウンロードクリック時のみ R2 を叩く）。
//
// activity 投入有無に依存しない独立ステップ（seedCustomerActivities は activity が既存だと
// 早期 continue するため、そこに混ぜると既存 seed 環境でファイルが投入されない）。
// 冪等: customerId + fileName が無い場合のみ作成する。
async function seedCustomerFiles(
  tx: TxClient,
  args: { wholesalerId: string; userId: string },
): Promise<void> {
  const { wholesalerId, userId } = args;
  const spec = SAMPLE_CUSTOMERS[0];
  if (!spec) return;
  const customer = await tx.customer.findFirst({
    where: { wholesalerId, name: sampleCustomerName(spec) },
    select: { id: true },
  });
  if (!customer) return;

  const seedFiles: { fileName: string; category: "GENERAL" | "APPLICATION" | "PV_DRAWING" }[] = [
    { fileName: "見積書サンプル.pdf", category: "GENERAL" },
    { fileName: "設置申請書サンプル.pdf", category: "APPLICATION" },
    { fileName: "PV設置図面サンプル.pdf", category: "PV_DRAWING" },
  ];
  for (const sf of seedFiles) {
    const exists = await tx.customerFile.findFirst({
      where: { customerId: customer.id, fileName: sf.fileName },
      select: { id: true },
    });
    if (exists) continue;
    const prefix =
      sf.category === "APPLICATION"
        ? "applications"
        : sf.category === "PV_DRAWING"
          ? "pv-drawings"
          : "files";
    await tx.customerFile.create({
      data: {
        customerId: customer.id,
        fileKey: `customers/${customer.id}/${prefix}/seed-${sf.fileName}`,
        fileName: sf.fileName,
        contentType: "application/pdf",
        category: sf.category,
        uploadedByUserId: userId,
      },
    });
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
