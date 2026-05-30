// Template: PreCallResult — マエカク結果連絡メール
//
// PII: customerName は姓のみ（呼び出し元で masking 済みを前提）、
//      phone は下 4 桁のみ（同様）。このテンプレートは受け取った値を
//      そのままレンダリングする。PII 適用は呼び出し元の責任。
import { escapeHtml, wrapLayout } from "./layout.js";

export interface PreCallResultParams {
  /** 姓のみ（PII マスク済み） */
  customerNameMasked: string;
  /** 下 4 桁のみ、例: "***-****-1234"（PII マスク済み） */
  phoneMasked: string;
  result: string;
  appointmentDate?: string;
  detailUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderPreCallResult(params: PreCallResultParams): RenderedEmail {
  const subject = "[Solar SaaS] マエカク結果が共有されました";
  const appointmentLine = params.appointmentDate
    ? `<p>アポ日時：<strong>${escapeHtml(params.appointmentDate)}</strong></p>`
    : "";
  const bodyHtml = `
    <h1>マエカク結果のお知らせ</h1>
    <p>顧客（${escapeHtml(params.customerNameMasked)} / ${escapeHtml(params.phoneMasked)}）のマエカク結果が共有されました。</p>
    <p>結果：<strong>${escapeHtml(params.result)}</strong></p>
    ${appointmentLine}
    <a class="btn" href="${escapeHtml(params.detailUrl)}">詳細を確認する</a>
  `;
  const appointmentText = params.appointmentDate ? `アポ日時：${params.appointmentDate}\n` : "";
  const text =
    `顧客（${params.customerNameMasked} / ${params.phoneMasked}）のマエカク結果が共有されました。\n\n` +
    `結果：${params.result}\n` +
    `${appointmentText}\n` +
    `詳細はこちら：${params.detailUrl}`;
  return { subject, html: wrapLayout(subject, bodyHtml), text };
}
