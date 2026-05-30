// Template: PreferenceDeadlineSoon — 希望提出期限近接通知メール
//
// PII: eventTitle はシステム管理データ（PII なし）。
import { escapeHtml, wrapLayout } from "./layout.js";

export interface PreferenceDeadlineParams {
  eventTitle: string;
  deadline: string;
  preferenceUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderPreferenceDeadline(params: PreferenceDeadlineParams): RenderedEmail {
  const subject = `[Solar SaaS] 希望提出期限が近づいています — ${params.eventTitle}`;
  const bodyHtml = `
    <h1>希望提出期限のお知らせ</h1>
    <p>イベント候補「<strong>${escapeHtml(params.eventTitle)}</strong>」への希望提出期限（<strong>${escapeHtml(params.deadline)}</strong>）まで 24 時間を切りました。</p>
    <p>まだ希望を提出されていない場合は、以下のボタンから提出してください。</p>
    <a class="btn" href="${escapeHtml(params.preferenceUrl)}">希望を提出する</a>
  `;
  const text =
    `イベント候補「${params.eventTitle}」への希望提出期限（${params.deadline}）まで 24 時間を切りました。\n\n` +
    `まだ希望が提出されていない場合は、以下の URL から提出してください。\n\n` +
    `${params.preferenceUrl}`;
  return { subject, html: wrapLayout(subject, bodyHtml), text };
}
