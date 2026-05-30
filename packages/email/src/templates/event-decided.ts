// Template: EventDecided — 開催体制決定通知メール
//
// PII: eventTitle / eventDate は業務データ（PII なし）。
import { escapeHtml, wrapLayout } from "./layout.js";

export interface EventDecidedParams {
  eventTitle: string;
  eventDate: string;
  venueName: string;
  detailUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderEventDecided(params: EventDecidedParams): RenderedEmail {
  const subject = `[Solar SaaS] イベント開催体制が決定しました — ${params.eventTitle}`;
  const bodyHtml = `
    <h1>イベント開催体制決定のお知らせ</h1>
    <p>イベント「<strong>${escapeHtml(params.eventTitle)}</strong>」（${escapeHtml(params.eventDate)}、${escapeHtml(params.venueName)}）の開催体制が決定しました。</p>
    <p>詳細を確認し、参加準備を進めてください。</p>
    <a class="btn" href="${escapeHtml(params.detailUrl)}">詳細を確認する</a>
  `;
  const text =
    `イベント「${params.eventTitle}」（${params.eventDate}、${params.venueName}）の開催体制が決定しました。\n\n` +
    `詳細を確認してください。\n\n` +
    `${params.detailUrl}`;
  return { subject, html: wrapLayout(subject, bodyHtml), text };
}
