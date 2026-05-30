// Sentry `beforeSend` PII filter for the worker process — T-07-10.
//
// Mirrors apps/web/lib/sentry/pii-filter.ts. Both files share the same
// logic; they are kept separate because apps cannot cross-import each other
// in a monorepo (no `@solar/web` workspace package exposed).

// Minimal structural type — compatible with @sentry/node v8 Event shape.
interface SentryEvent {
  user?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  breadcrumbs?:
    | Array<Record<string, unknown>>
    | { values?: Array<Record<string, unknown>>; [key: string]: unknown };
  [key: string]: unknown;
}

const PHONE_HYPHEN_RE = /\d{2,4}[-－]\d{2,4}[-－]\d{4}/g;
const PHONE_COMPACT_RE = /0\d{9,10}/g;
const PREFECTURE_RE =
  /(?:北海道|(?:青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|東京|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|京都|大阪|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄)(?:都|道|府|県))[^\s\n"'<>]{2,}/g;
const NAME_KEYS = new Set(["userName", "user_name", "name", "fullName", "full_name"]);

function scrubString(s: string): string {
  return s
    .replace(PHONE_HYPHEN_RE, "***-****-****")
    .replace(PHONE_COMPACT_RE, (m) => (/^0\d{9,10}$/.test(m) ? "***-****-****" : m))
    .replace(PREFECTURE_RE, (m) => {
      const cityMatch = m.match(/^(.+?[市区町村])/);
      return cityMatch ? `${cityMatch[1]}***` : "***";
    });
}

function scrubValue(value: unknown): unknown {
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value !== null && typeof value === "object")
    return scrubObject(value as Record<string, unknown>);
  return value;
}

function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    out[key] = NAME_KEYS.has(key) && typeof val === "string" ? "***" : scrubValue(val);
  }
  return out;
}

export function sentryBeforeSend(event: SentryEvent): SentryEvent {
  if (event.user) {
    const { name, username, email, ...rest } = event.user;
    event.user = {
      ...scrubObject(rest),
      ...(username !== undefined ? { username: "***" } : {}),
      ...(email !== undefined ? { email: "***" } : {}),
      ...(name !== undefined ? { name: "***" } : {}),
    };
  }

  if (event.tags) {
    event.tags = scrubObject(event.tags as Record<string, unknown>);
  }

  if (event.extra) {
    event.extra = scrubObject(event.extra);
  }

  if (event.breadcrumbs) {
    const crumbs = Array.isArray(event.breadcrumbs)
      ? event.breadcrumbs
      : ((event.breadcrumbs as { values?: Array<Record<string, unknown>> }).values ?? []);

    const scrubbed = crumbs.map((crumb) => {
      if (crumb.data && typeof crumb.data === "object") {
        return { ...crumb, data: scrubObject(crumb.data as Record<string, unknown>) };
      }
      return crumb;
    });

    if (Array.isArray(event.breadcrumbs)) {
      event.breadcrumbs = scrubbed;
    } else {
      (event.breadcrumbs as { values?: Array<Record<string, unknown>> }).values = scrubbed;
    }
  }

  return event;
}
