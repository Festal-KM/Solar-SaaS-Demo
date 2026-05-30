// @solar/email — Resend-backed email client + transactional email templates
// (T-01-10, T-07-05).
//
// `defaultEmailClient` selection:
//   - NODE_ENV === "test"             → stub (no network, deterministic id)
//   - RESEND_API_KEY in {"", "stub"}  → stub (single warning at first send)
//   - otherwise                        → ResendEmailClient (real network)
//
// Callers should keep depending on `EmailClient` / `sendPasswordResetEmail`
// / `sendUserInviteEmail`; the Resend swap is transparent to them.

import { Resend } from "resend";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailSendResult {
  messageId: string;
}

export interface EmailClient {
  sendEmail(input: EmailMessage): Promise<EmailSendResult>;
}

// Stub implementation used in tests and as a fallback when Resend credentials
// are missing. Test runs are intentionally silent (no stdout pollution); dev /
// CI logs a single line so a human inspecting the terminal can see that mail
// would have fired.
export const stubEmailClient: EmailClient = {
  async sendEmail(input) {
    if (process.env.NODE_ENV !== "test") {
      console.info(`[stub email] to=${input.to} subject="${input.subject}"`);
    }
    return { messageId: `stub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  },
};

const RESEND_STUB_KEYS = new Set(["", "stub", "re_dev_placeholder"]);

interface ResendEmailClientOptions {
  apiKey: string;
  from: string;
}

class ResendEmailClient implements EmailClient {
  private readonly client: Resend;
  private readonly from: string;

  constructor(opts: ResendEmailClientOptions) {
    this.client = new Resend(opts.apiKey);
    this.from = opts.from;
  }

  async sendEmail(input: EmailMessage): Promise<EmailSendResult> {
    const result = await this.client.emails.send({
      from: this.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });

    if (result.error) {
      // Surface as a thrown error so graphile-worker retries (max_attempts=3).
      throw new Error(`Resend send failed: ${result.error.name}: ${result.error.message}`);
    }
    if (!result.data?.id) {
      throw new Error("Resend send returned no message id");
    }
    return { messageId: result.data.id };
  }
}

/**
 * Build the production email client from environment, or return the stub when
 * credentials are missing / in test mode. Exposed for the worker bootstrap so
 * the same selection logic is shared.
 */
export function buildDefaultEmailClient(): EmailClient {
  if (process.env.NODE_ENV === "test") return stubEmailClient;

  const apiKey = process.env.RESEND_API_KEY ?? "";
  if (RESEND_STUB_KEYS.has(apiKey)) {
    console.warn(
      "[email] RESEND_API_KEY missing or placeholder — falling back to stubEmailClient. " +
        "Set RESEND_API_KEY in .env.local for real delivery.",
    );
    return stubEmailClient;
  }

  const from = process.env.RESEND_FROM_ADDRESS ?? process.env.RESEND_FROM ?? "";
  if (!from) {
    console.warn("[email] RESEND_FROM_ADDRESS missing — falling back to stubEmailClient.");
    return stubEmailClient;
  }

  return new ResendEmailClient({ apiKey, from });
}

/**
 * Default email client used by the application. Selected eagerly at module
 * load using the active environment so a single Resend instance is shared.
 * Tests inject their own client via the optional `emailClient` parameter on
 * the auth Server Actions.
 */
export const defaultEmailClient: EmailClient = buildDefaultEmailClient();

// ---------------------------------------------------------------------------
// Higher-level helpers — keep the JA copy in ONE place so call sites and the
// Resend templates share the same text.
// ---------------------------------------------------------------------------

const TEXTS = {
  passwordResetSubject: "[Solar SaaS] パスワード再設定リンク",
  passwordResetBody: (resetUrl: string, expiresInMinutes: number) =>
    `以下のリンクから ${expiresInMinutes} 分以内にパスワードを再設定してください。\n\n${resetUrl}\n\n` +
    `心当たりがない場合はこのメールを破棄してください。`,
  userInviteSubject: "[Solar SaaS] アカウント招待",
  userInviteBody: (inviteUrl: string, expiresAt: Date) =>
    `あなたを Solar SaaS に招待しました。以下のリンクから ${expiresAt.toISOString()} までにアカウントを作成してください。\n\n${inviteUrl}`,
} as const;

export async function sendPasswordResetEmail(
  client: EmailClient,
  input: { to: string; resetUrl: string; expiresInMinutes: number },
): Promise<EmailSendResult> {
  const text = TEXTS.passwordResetBody(input.resetUrl, input.expiresInMinutes);
  return client.sendEmail({
    to: input.to,
    subject: TEXTS.passwordResetSubject,
    html: `<p>${text.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`,
    text,
  });
}

export async function sendUserInviteEmail(
  client: EmailClient,
  input: { to: string; inviteUrl: string; expiresAt: Date },
): Promise<EmailSendResult> {
  const text = TEXTS.userInviteBody(input.inviteUrl, input.expiresAt);
  return client.sendEmail({
    to: input.to,
    subject: TEXTS.userInviteSubject,
    html: `<p>${text.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`,
    text,
  });
}

// ---------------------------------------------------------------------------
// Template exports (T-07-05) — structured transactional email templates.
// ---------------------------------------------------------------------------
export * from "./templates/index.js";
