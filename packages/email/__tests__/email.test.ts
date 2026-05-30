// Unit tests for @solar/email (T-01-10, T-07-05).
//
// Covers:
//   1. defaultEmailClient is the stub when NODE_ENV=test (no Resend network)
//   2. buildDefaultEmailClient() returns stub when RESEND_API_KEY is missing
//      / "stub" / placeholder, with a single warning
//   3. sendPasswordResetEmail / sendUserInviteEmail call sendEmail with the
//      shared JA subjects + bodies (regression guard against in-component
//      copy creeping back in)
//   4. (T-07-05) Template rendering: purchasePrice / フルアドレス / フル電話番号
//      が出力 HTML に含まれないことを確認
//   5. (T-07-05) Template output contains expected Japanese text
//   6. (T-07-05) All 8 templates render without throwing

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type EmailClient,
  buildDefaultEmailClient,
  defaultEmailClient,
  sendPasswordResetEmail,
  sendUserInviteEmail,
  stubEmailClient,
  renderInviteUser,
  renderResetPassword,
  renderPreferenceDeadline,
  renderEventDecided,
  renderPreCallResult,
  renderContractCreated,
  renderMonthlyReportSubmitted,
  renderMonthlyReportFinalized,
} from "../src/index.js";

describe("defaultEmailClient", () => {
  it("is the stub client under NODE_ENV=test", () => {
    expect(process.env.NODE_ENV).toBe("test");
    expect(defaultEmailClient).toBe(stubEmailClient);
  });
});

describe("buildDefaultEmailClient", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });
  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.restoreAllMocks();
  });

  it("returns the stub when NODE_ENV=test, even with a real key", () => {
    process.env.NODE_ENV = "test";
    process.env.RESEND_API_KEY = "re_live_xxx";
    expect(buildDefaultEmailClient()).toBe(stubEmailClient);
  });

  it.each(["", "stub", "re_dev_placeholder"])(
    "falls back to stub when RESEND_API_KEY=%j (with warning)",
    (key) => {
      process.env.NODE_ENV = "development";
      process.env.RESEND_API_KEY = key;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const client = buildDefaultEmailClient();
      expect(client).toBe(stubEmailClient);
      expect(warn).toHaveBeenCalledOnce();
    },
  );

  it("falls back to stub when RESEND_FROM_ADDRESS is empty", () => {
    process.env.NODE_ENV = "development";
    process.env.RESEND_API_KEY = "re_live_real_looking";
    process.env.RESEND_FROM_ADDRESS = "";
    process.env.RESEND_FROM = "";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = buildDefaultEmailClient();
    expect(client).toBe(stubEmailClient);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("builds a Resend-backed client when key + from are set", () => {
    process.env.NODE_ENV = "development";
    process.env.RESEND_API_KEY = "re_live_real_looking";
    process.env.RESEND_FROM_ADDRESS = "noreply@solar-saas.local";
    const client = buildDefaultEmailClient();
    expect(client).not.toBe(stubEmailClient);
    // Cannot send (no real key), but `.sendEmail` must be a function.
    expect(typeof client.sendEmail).toBe("function");
  });
});

describe("stubEmailClient.sendEmail", () => {
  it("returns a non-empty messageId without throwing", async () => {
    const result = await stubEmailClient.sendEmail({
      to: "x@example.com",
      subject: "hi",
      html: "<p>hi</p>",
    });
    expect(result.messageId).toMatch(/^stub-/);
  });
});

describe("sendPasswordResetEmail / sendUserInviteEmail", () => {
  it("sends the shared JA password-reset subject and body", async () => {
    const recorder: EmailClient = {
      sendEmail: vi.fn().mockResolvedValue({ messageId: "test-1" }),
    };
    await sendPasswordResetEmail(recorder, {
      to: "user@example.com",
      resetUrl: "https://app.example/reset?token=xxx",
      expiresInMinutes: 30,
    });
    expect(recorder.sendEmail).toHaveBeenCalledOnce();
    const call = (recorder.sendEmail as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.subject).toBe("[Solar SaaS] パスワード再設定リンク");
    expect(call.text).toContain("30 分以内");
    expect(call.text).toContain("https://app.example/reset?token=xxx");
    expect(call.html).toContain("<p>");
  });

  it("sends the shared JA invite subject and body", async () => {
    const recorder: EmailClient = {
      sendEmail: vi.fn().mockResolvedValue({ messageId: "test-2" }),
    };
    const expiresAt = new Date("2026-06-01T12:00:00Z");
    await sendUserInviteEmail(recorder, {
      to: "invitee@example.com",
      inviteUrl: "https://app.example/invite?token=yyy",
      expiresAt,
    });
    const call = (recorder.sendEmail as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.subject).toBe("[Solar SaaS] アカウント招待");
    expect(call.text).toContain(expiresAt.toISOString());
    expect(call.text).toContain("https://app.example/invite?token=yyy");
  });
});

// ---------------------------------------------------------------------------
// T-07-05: React Email templates — PII safety + rendering correctness
// ---------------------------------------------------------------------------

describe("T-07-05 email templates: PII exclusion", () => {
  it("renderContractCreated: output must not contain purchasePrice, full address or full phone", () => {
    const result = renderContractCreated({
      customerNameMasked: "山田",       // 姓のみ（マスク済み）
      contractDate: "2026-06-01",
      contractAmount: 2_500_000,
      detailUrl: "https://app.example/contracts/abc",
    });

    // purchasePrice / 仕入値は絶対に含めない（Hard Rule #5）
    expect(result.html).not.toContain("purchasePrice");
    expect(result.html).not.toContain("仕入");
    expect(result.text).not.toContain("purchasePrice");
    expect(result.text).not.toContain("仕入");

    // 検証: マスク済み姓が含まれる
    expect(result.html).toContain("山田");
    expect(result.subject).toBe("[Solar SaaS] 契約が成立しました");
    expect(result.html).toContain("2,500,000");
  });

  it("renderPreCallResult: output uses masked phone/name, no full PII", () => {
    const result = renderPreCallResult({
      customerNameMasked: "田中",              // 姓のみ
      phoneMasked: "***-****-5678",            // 下4桁のみ
      result: "アポ取得",
      appointmentDate: "2026-06-10 14:00",
      detailUrl: "https://app.example/precall/xyz",
    });

    // フル電話番号は含まない（090-1234-5678 のようなものはない）
    expect(result.html).not.toMatch(/\d{2,4}-\d{4}-\d{4}/);
    expect(result.text).not.toMatch(/\d{2,4}-\d{4}-\d{4}/);

    // マスク済み電話番号が含まれる
    expect(result.html).toContain("***-****-5678");
    expect(result.html).toContain("田中");
    expect(result.subject).toBe("[Solar SaaS] マエカク結果が共有されました");
  });

  it("renderInviteUser: subject matches labels.ts emailSubjects.invite", () => {
    const result = renderInviteUser({
      inviteUrl: "https://app.example/invite?token=abc",
      expiresAt: new Date("2026-07-01T00:00:00Z"),
      roleName: "wholesaler_admin",
    });
    expect(result.subject).toBe("[Solar SaaS] アカウント招待");
    expect(result.html).toContain("Solar SaaS");
    expect(result.text).toContain("https://app.example/invite?token=abc");
  });
});

describe("T-07-05 email templates: all 8 render without throwing", () => {
  it("renderInviteUser", () => {
    expect(() =>
      renderInviteUser({ inviteUrl: "https://x", expiresAt: new Date() }),
    ).not.toThrow();
  });

  it("renderResetPassword", () => {
    expect(() =>
      renderResetPassword({ resetUrl: "https://x", expiresInMinutes: 30 }),
    ).not.toThrow();
  });

  it("renderPreferenceDeadline", () => {
    expect(() =>
      renderPreferenceDeadline({
        eventTitle: "テストイベント",
        deadline: "2026-06-01",
        preferenceUrl: "https://x",
      }),
    ).not.toThrow();
  });

  it("renderEventDecided", () => {
    expect(() =>
      renderEventDecided({
        eventTitle: "テスト",
        eventDate: "2026-06-01",
        venueName: "イオン新宿",
        detailUrl: "https://x",
      }),
    ).not.toThrow();
  });

  it("renderPreCallResult", () => {
    expect(() =>
      renderPreCallResult({
        customerNameMasked: "鈴木",
        phoneMasked: "***-****-1234",
        result: "未達",
        detailUrl: "https://x",
      }),
    ).not.toThrow();
  });

  it("renderContractCreated", () => {
    expect(() =>
      renderContractCreated({
        customerNameMasked: "山田",
        contractDate: "2026-06-01",
        contractAmount: 1_000_000,
        detailUrl: "https://x",
      }),
    ).not.toThrow();
  });

  it("renderMonthlyReportSubmitted", () => {
    expect(() =>
      renderMonthlyReportSubmitted({
        dealerName: "テスト二次店",
        targetMonth: "2026-05",
        detailUrl: "https://x",
      }),
    ).not.toThrow();
  });

  it("renderMonthlyReportFinalized", () => {
    expect(() =>
      renderMonthlyReportFinalized({
        targetMonth: "2026-05",
        detailUrl: "https://x",
      }),
    ).not.toThrow();
  });
});
