// Sentry `beforeSend` PII filter — T-07-10 / CLAUDE.md Hard Rule #6 /
// docs/02 §5.4 / docs/03 §14-6 / docs/05 §10.3.
//
// Shared between the client, server, and edge Sentry configs so the masking
// logic lives in one place and is tested in isolation.
//
// What gets scrubbed:
//   phone   — Japanese mobile/landline patterns (xxx-xxxx-xxxx, xxxxxxxxxx,
//             0120-xxx-xxx, etc.). Replacement: "***-****-****"
//   address — Any substring starting with a Japanese prefecture name followed
//             by city/ward/town. Replacement: "<都道府県><市区町村>***"
//   name    — Values on `userName`, `user_name`, `name` keys in event.user,
//             event.tags, and breadcrumb data objects. Replacement: "***"
//
// We do NOT modify event.request.url or event.request.headers because the
// network layer should not carry raw PII (handled at the Sentry project DSN
// scrubbing rules level).

// Minimal structural type covering only the fields we mutate.
// Avoids a direct @sentry/core peer-dep while remaining compatible with the
// actual Sentry Event shape (the fields are stable across v8).
interface SentryEvent {
  event_id?: string;
  user?: Record<string, unknown>;
  // Sentry SDK types tags as { [key: string]: Primitive } where Primitive
  // includes undefined/number/boolean. We narrow to unknown to work with both.
  tags?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  breadcrumbs?:
    | Array<Record<string, unknown>>
    | { values?: Array<Record<string, unknown>>; [key: string]: unknown };
  [key: string]: unknown;
}

// Japanese phone number regex: matches hyphenated and compact forms.
const PHONE_HYPHEN_RE = /\d{2,4}[-－]\d{2,4}[-－]\d{4}/g;
const PHONE_COMPACT_RE = /0\d{9,10}/g;

// Prefecture prefix followed by city/ward/town content.
const PREFECTURE_RE =
  /(?:北海道|(?:青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|東京|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|京都|大阪|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄)(?:都|道|府|県))[^\s\n"'<>]{2,}/g;

// Keys whose string values are replaced wholesale with "***".
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

/**
 * Sentry `beforeSend` hook. Scrubs PII from `event.user`, `event.tags`,
 * `event.extra`, and breadcrumb `data` payloads before transmission.
 *
 * Returns the sanitised event; never returns null (never drops the event).
 */
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
