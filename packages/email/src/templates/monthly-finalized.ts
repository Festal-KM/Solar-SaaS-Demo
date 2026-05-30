// Template: MonthlyReportFinalized — 月次確定通知メール
import { escapeHtml, wrapLayout } from "./layout.js";

export interface MonthlyReportFinalizedParams {
  targetMonth: string;
  detailUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderMonthlyReportFinalized(params: MonthlyReportFinalizedParams): RenderedEmail {
  const subject = `[Solar SaaS] ${params.targetMonth} の月次レポートが確定しました`;
  const bodyHtml = `
    <h1>月次レポート確定のお知らせ</h1>
    <p><strong>${escapeHtml(params.targetMonth)}</strong> の月次レポートが確定しました。</p>
    <p>インセンティブ明細を確認してください。</p>
    <a class="btn" href="${escapeHtml(params.detailUrl)}">月次レポートを確認する</a>
  `;
  const text =
    `${params.targetMonth} の月次レポートが確定しました。\n\n` +
    `インセンティブ明細はこちら：${params.detailUrl}`;
  return { subject, html: wrapLayout(subject, bodyHtml), text };
}
