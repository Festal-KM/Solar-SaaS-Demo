// Unit tests for Sentry PII filter — T-07-10 / CLAUDE.md Hard Rule #6.
//
// Cases:
//   1. beforeSend masks hyphenated phone numbers in event.extra strings.
//   2. beforeSend masks compact (un-hyphenated) phone numbers in event.extra strings.
//   3. beforeSend masks Japanese address strings (prefecture + city prefix kept, rest masked).
//   4. beforeSend masks name/username/email on event.user.
//   5. beforeSend masks phone in breadcrumb data payload.
//   6. beforeSend masks address fragment in event.tags.
//   7. Non-PII values pass through unmodified.

import { describe, expect, it } from "vitest";

import { sentryBeforeSend } from "../pii-filter.js";

// Minimal event shape that mirrors the Sentry v8 Event.
interface TestEvent {
  event_id?: string;
  user?: Record<string, unknown>;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  breadcrumbs?:
    | Array<Record<string, unknown>>
    | { values?: Array<Record<string, unknown>> };
}

function makeEvent(overrides: TestEvent = {}): TestEvent {
  return { event_id: "test-event-id", ...overrides };
}

describe("sentryBeforeSend — phone masking", () => {
  it("1. masks hyphenated phone number in event.extra string", () => {
    const event = makeEvent({
      extra: { message: "顧客の電話番号は090-1234-5678です" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = sentryBeforeSend(event as any) as TestEvent;
    expect((result.extra as Record<string, unknown>).message).toBe(
      "顧客の電話番号は***-****-****です",
    );
  });

  it("2. masks compact (un-hyphenated) phone number in event.extra string", () => {
    const event = makeEvent({
      extra: { raw: "phone:09012345678" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = sentryBeforeSend(event as any) as TestEvent;
    expect((result.extra as Record<string, unknown>).raw).toBe("phone:***-****-****");
  });
});

describe("sentryBeforeSend — address masking", () => {
  it("3. masks address beyond city boundary in event.extra string", () => {
    // Address without trailing spaces so the full contiguous address string
    // is matched by the regex and replaced in one pass.
    const event = makeEvent({
      extra: { addr: "東京都新宿区西新宿1-2-3ビル501" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = sentryBeforeSend(event as any) as TestEvent;
    const addr = (result.extra as Record<string, unknown>).addr as string;
    // Prefecture + city boundary is kept; street/building detail is replaced.
    expect(addr).toBe("東京都新宿区***");
  });
});

describe("sentryBeforeSend — name masking", () => {
  it("4. masks event.user.name, username, and email", () => {
    const event = makeEvent({
      user: {
        id: "user_abc",
        name: "山田 太郎",
        username: "yamada_t",
        email: "yamada@example.com",
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = sentryBeforeSend(event as any) as TestEvent;
    expect(result.user?.name).toBe("***");
    expect(result.user?.username).toBe("***");
    expect(result.user?.email).toBe("***");
    // Non-PII field should survive.
    expect(result.user?.id).toBe("user_abc");
  });
});

describe("sentryBeforeSend — breadcrumb masking", () => {
  it("5. masks phone in breadcrumb data payload", () => {
    const event = makeEvent({
      breadcrumbs: {
        values: [
          {
            type: "default",
            message: "customer loaded",
            data: { phone: "03-5678-9012", eventId: "ev_1" },
          },
        ],
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = sentryBeforeSend(event as any) as TestEvent;
    const crumbs = (result.breadcrumbs as { values: Array<Record<string, unknown>> }).values;
    const data = crumbs[0]!.data as Record<string, unknown>;
    expect(data.phone).toBe("***-****-****");
    // Non-PII field survives.
    expect(data.eventId).toBe("ev_1");
  });
});

describe("sentryBeforeSend — tags masking", () => {
  it("6. masks address fragment in event.tags", () => {
    const event = makeEvent({
      // Use a simple city-level address (no ward sub-division) so the
      // city boundary is unambiguous at the first 市 character.
      tags: { region: "大阪府大阪市梅田1-1-3" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = sentryBeforeSend(event as any) as TestEvent;
    const tags = result.tags as Record<string, string>;
    // Keeps prefecture + city (大阪府大阪市), masks the street detail.
    expect(tags.region).toBe("大阪府大阪市***");
  });
});

describe("sentryBeforeSend — non-PII passthrough", () => {
  it("7. leaves non-PII event fields completely unchanged", () => {
    const event = makeEvent({
      extra: {
        contractId: "c_abc123",
        amount: 3000000,
        status: "CONTRACTED",
      },
      tags: { environment: "production", version: "1.2.3" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = sentryBeforeSend(event as any) as TestEvent;
    const extra = result.extra as Record<string, unknown>;
    expect(extra.contractId).toBe("c_abc123");
    expect(extra.amount).toBe(3000000);
    expect(extra.status).toBe("CONTRACTED");
    const tags = result.tags as Record<string, string>;
    expect(tags.environment).toBe("production");
    expect(tags.version).toBe("1.2.3");
  });
});
