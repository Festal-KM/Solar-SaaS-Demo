// Template: ContractCreated — 契約成立通知メール
//
// PII: customerName は姓のみ（マスク済みを前提）。
//      purchasePrice / 仕入値は絶対に含めない（CLAUDE.md Hard Rule #5）。
//      dealerPrice / listPrice のスナップショットは二次店向けには
//      dealerPrice のみ（仕入値 = purchasePrice は除外）。
import { escapeHtml, wrapLayout } from "./layout.js";

export interface ContractCreatedParams {
  /** 姓のみ（PII マスク済み） */
  customerNameMasked: string;
  contractDate: string;
  /** 契約金額（円） */
  contractAmount: number;
  detailUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderContractCreated(params: ContractCreatedParams): RenderedEmail {
  const subject = "[Solar SaaS] 契約が成立しました";
  const amountStr = params.contractAmount.toLocaleString("ja-JP");
  const bodyHtml = `
    <h1>契約成立のお知らせ</h1>
    <p>顧客（${escapeHtml(params.customerNameMasked)}）との契約が成立しました。</p>
    <p>契約日：<strong>${escapeHtml(params.contractDate)}</strong></p>
    <p>契約金額：<strong>${escapeHtml(amountStr)} 円</strong></p>
    <a class="btn" href="${escapeHtml(params.detailUrl)}">明細を確認する</a>
  `;
  const text =
    `顧客（${params.customerNameMasked}）との契約が成立しました。\n\n` +
    `契約日：${params.contractDate}\n` +
    `契約金額：${amountStr} 円\n\n` +
    `明細はこちら：${params.detailUrl}`;
  return { subject, html: wrapLayout(subject, bodyHtml), text };
}
