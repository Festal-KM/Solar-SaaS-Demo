// Template: InviteUser — ユーザー招待メール
import { escapeHtml, wrapLayout } from "./layout.js";

export interface InviteUserParams {
  inviteUrl: string;
  expiresAt: Date;
  roleName?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderInviteUser(params: InviteUserParams): RenderedEmail {
  const subject = "[Solar SaaS] アカウント招待";
  const expiresStr = params.expiresAt.toLocaleDateString("ja-JP");
  const rolePart = params.roleName ? `${escapeHtml(params.roleName)} として` : "";
  const bodyHtml = `
    <h1>Solar SaaS へようこそ</h1>
    <p>あなたを Solar SaaS に${rolePart}招待しました。</p>
    <p>以下のボタンから <strong>${expiresStr}</strong> までにアカウントを作成してください。</p>
    <a class="btn" href="${escapeHtml(params.inviteUrl)}">アカウントを作成する</a>
    <p class="note">ボタンが動作しない場合は次の URL をブラウザで開いてください：<br>${escapeHtml(params.inviteUrl)}</p>
  `;
  const text =
    `Solar SaaS へ招待されました。\n\n` +
    `以下の URL から ${expiresStr} までにアカウントを作成してください。\n\n` +
    `${params.inviteUrl}\n\n` +
    `心当たりがない場合はこのメールを破棄してください。`;
  return { subject, html: wrapLayout(subject, bodyHtml), text };
}
