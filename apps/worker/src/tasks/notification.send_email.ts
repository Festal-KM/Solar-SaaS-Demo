// graphile-worker task: send a transactional email via Resend (T-01-10, T-07-05).
//
// Payload discriminant:
//   kind="direct"   (SP-01): inline to/subject/html, no DB read.
//   kind="delivery" (SP-07): load NotificationDelivery → Notification, render
//                            template, send, update delivery.status=SENT/FAILED.
//   legacy (no kind): treated as direct (backward compat).
//
// On Resend errors we rethrow so graphile-worker increments attempts and
// applies the configured backoff (max_attempts=3, 1m → 5m → 30m — docs/05 §5.2).
// The task NEVER swallows errors on the direct/legacy path; on the delivery
// path, errors are caught, stored in delivery.lastError, and then rethrown so
// graphile-worker retries.

import {
  sendEmailPayloadSchema,
  buildNotificationContent,
  type NotificationType,
} from "@solar/contracts";
import { type EmailClient, defaultEmailClient } from "@solar/email";
import { rawPrisma } from "@solar/db";

import type { Task } from "graphile-worker";

export interface SendEmailDeps {
  emailClient?: EmailClient;
}

export function makeSendEmailTask(deps: SendEmailDeps = {}): Task {
  const client = deps.emailClient ?? defaultEmailClient;

  return async (rawPayload, helpers) => {
    const payload = sendEmailPayloadSchema.parse(rawPayload);
    const start = Date.now();

    if (payload.kind === "direct") {
      const result = await client.sendEmail(payload);
      helpers.logger.info(
        `notification.send_email direct ok jobId=${helpers.job.id} to=${payload.to} messageId=${result.messageId} durationMs=${Date.now() - start}`,
      );
      return;
    }

    // delivery path — load Notification + Delivery from DB
    const { deliveryId } = payload;

    const delivery = await rawPrisma.notificationDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        notification: {
          select: {
            id: true,
            type: true,
            title: true,
            body: true,
            payload: true,
            recipientUserId: true,
          },
        },
      },
    });

    if (!delivery) {
      helpers.logger.warn(
        `notification.send_email: delivery not found deliveryId=${deliveryId} jobId=${helpers.job.id}`,
      );
      return;
    }

    if (delivery.status === "SENT") {
      helpers.logger.info(
        `notification.send_email: already SENT deliveryId=${deliveryId} jobId=${helpers.job.id}`,
      );
      return;
    }

    // Resolve recipient email from User table.
    const user = await rawPrisma.user.findUnique({
      where: { id: delivery.notification.recipientUserId },
      select: { email: true },
    });

    if (!user?.email) {
      helpers.logger.warn(
        `notification.send_email: recipient user not found deliveryId=${deliveryId} jobId=${helpers.job.id}`,
      );
      await rawPrisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          status: "FAILED",
          lastError: "recipient user not found",
          attemptedCount: { increment: 1 },
        },
      });
      return;
    }

    const notification = delivery.notification;
    const content = buildNotificationContent(
      notification.type as NotificationType,
      (notification.payload as Record<string, string>) ?? {},
    );

    let sendError: Error | null = null;
    let messageId: string | undefined;

    try {
      const result = await client.sendEmail({
        to: user.email,
        subject: notification.title,
        html: buildHtmlFromContent(content.title, content.body),
        text: content.body,
      });
      messageId = result.messageId;
    } catch (err) {
      sendError = err instanceof Error ? err : new Error(String(err));
    }

    if (sendError) {
      await rawPrisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          status: "FAILED",
          lastError: sendError.message.slice(0, 2000),
          attemptedCount: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      helpers.logger.error(
        `notification.send_email delivery FAILED deliveryId=${deliveryId} jobId=${helpers.job.id} error=${sendError.message} durationMs=${Date.now() - start}`,
      );
      // Rethrow so graphile-worker schedules the next retry.
      throw sendError;
    }

    await rawPrisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "SENT",
        sentAt: new Date(),
        attemptedCount: { increment: 1 },
        lastError: null,
        updatedAt: new Date(),
      },
    });

    helpers.logger.info(
      `notification.send_email delivery ok deliveryId=${deliveryId} to=${user.email} messageId=${messageId} jobId=${helpers.job.id} durationMs=${Date.now() - start}`,
    );
  };
}

/** Minimal HTML wrapper for notification content when no dedicated template exists. */
function buildHtmlFromContent(title: string, body: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>${esc(title)}</title></head><body style="font-family:sans-serif;max-width:600px;margin:32px auto;padding:0 16px"><h1 style="font-size:20px;color:#111">${esc(title)}</h1><p style="color:#374151;line-height:1.6">${esc(body)}</p><hr><p style="font-size:12px;color:#9ca3af">このメールは Solar SaaS から自動送信されています。</p></body></html>`;
}

// Default export so graphile-worker can also auto-load by filename.
const defaultTask: Task = makeSendEmailTask();
export default defaultTask;
