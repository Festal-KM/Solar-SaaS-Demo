// Template: ResetPassword — パスワード再設定メール
import { escapeHtml, wrapLayout } from "./layout.js";

export interface ResetPasswordParams {
  resetUrl: string;
  expiresInMinutes: number;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderResetPassword(params: ResetPasswordParams): RenderedEmail {
  const subject = "[Solar SaaS] パスワード再設定リンク";
  const bodyHtml = `
    <h1>パスワード再設定</h1>
    <p>以下のボタンから <strong>${params.expiresInMinutes} 分以内</strong> にパスワードを再設定してください。</p>
    <a class="btn" href="${escapeHtml(params.resetUrl)}">パスワードを再設定する</a>
    <p class="note">ボタンが動作しない場合は次の URL をブラウザで開いてください：<br>${escapeHtml(params.resetUrl)}</p>
    <p class="note">このメールに心当たりがない場合は無視してください。パスワードは変更されません。</p>
  `;
  const text =
    `パスワードを再設定するには以下の URL を ${params.expiresInMinutes} 分以内に開いてください。\n\n` +
    `${params.resetUrl}\n\n` +
    `心当たりがない場合はこのメールを破棄してください。`;
  return { subject, html: wrapLayout(subject, bodyHtml), text };
}
