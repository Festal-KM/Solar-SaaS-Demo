// Template: MonthlyReportSubmitted — 月次報告提出通知メール
import { escapeHtml, wrapLayout } from "./layout.js";

export interface MonthlyReportSubmittedParams {
  dealerName: string;
  targetMonth: string;
  detailUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderMonthlyReportSubmitted(params: MonthlyReportSubmittedParams): RenderedEmail {
  const subject = `[Solar SaaS] 月次報告が提出されました — ${params.targetMonth}`;
  const bodyHtml = `
    <h1>月次報告提出のお知らせ</h1>
    <p><strong>${escapeHtml(params.dealerName)}</strong> から ${escapeHtml(params.targetMonth)} の月次報告が提出されました。</p>
    <p>内容を確認し、必要に応じてレビューを行ってください。</p>
    <a class="btn" href="${escapeHtml(params.detailUrl)}">月次報告を確認する</a>
  `;
  const text =
    `${params.dealerName} から ${params.targetMonth} の月次報告が提出されました。\n\n` +
    `確認はこちら：${params.detailUrl}`;
  return { subject, html: wrapLayout(subject, bodyHtml), text };
}
