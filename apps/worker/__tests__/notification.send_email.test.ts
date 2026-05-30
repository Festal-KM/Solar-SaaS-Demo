// Unit tests for `notification.send_email` graphile-worker task (T-01-10).
//
// Strategy: we exercise the Task function directly with a fake `helpers`
// object so graphile-worker's runner does not need a real DB. The Resend
// client is injected via the `deps.emailClient` constructor parameter.

import { type EmailClient } from "@solar/email";
import { describe, expect, it, vi } from "vitest";

import { makeSendEmailTask } from "../src/tasks/notification.send_email.js";

function fakeHelpers(jobId = "test-job-1") {
  return {
    job: { id: jobId },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  } as unknown as Parameters<ReturnType<typeof makeSendEmailTask>>[1];
}

describe("notification.send_email task", () => {
  it("validates payload and delegates to the injected EmailClient", async () => {
    const client: EmailClient = {
      sendEmail: vi.fn().mockResolvedValue({ messageId: "resend-msg-1" }),
    };
    const task = makeSendEmailTask({ emailClient: client });
    const helpers = fakeHelpers();

    await task(
      {
        to: "user@example.com",
        subject: "[Solar SaaS] hello",
        html: "<p>hello</p>",
        text: "hello",
      },
      helpers,
    );

    expect(client.sendEmail).toHaveBeenCalledOnce();
    const sendArg = (client.sendEmail as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(sendArg?.to).toBe("user@example.com");
    expect(sendArg?.subject).toBe("[Solar SaaS] hello");
    expect(helpers.logger.info).toHaveBeenCalled();
  });

  it("rethrows when the email client fails (so graphile-worker retries)", async () => {
    const boom = new Error("Resend send failed: rate_limited: too many requests");
    const client: EmailClient = {
      sendEmail: vi.fn().mockRejectedValue(boom),
    };
    const task = makeSendEmailTask({ emailClient: client });

    await expect(
      task({ to: "user@example.com", subject: "hi", html: "<p>hi</p>" }, fakeHelpers()),
    ).rejects.toThrow(/Resend send failed/);
  });

  it("rejects malformed payloads", async () => {
    const client: EmailClient = { sendEmail: vi.fn() };
    const task = makeSendEmailTask({ emailClient: client });

    await expect(
      task({ to: "not-an-email", subject: "x", html: "<p>x</p>" }, fakeHelpers()),
    ).rejects.toThrow();
    expect(client.sendEmail).not.toHaveBeenCalled();
  });

  it("rejects when required fields are missing", async () => {
    const client: EmailClient = { sendEmail: vi.fn() };
    const task = makeSendEmailTask({ emailClient: client });

    await expect(task({ to: "user@example.com", subject: "" }, fakeHelpers())).rejects.toThrow();
    expect(client.sendEmail).not.toHaveBeenCalled();
  });
});
