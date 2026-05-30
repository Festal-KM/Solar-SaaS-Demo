// Shared HTML layout for all transactional email templates.
// Produces minimal, email-client-safe HTML wrapped in a centered container.

export function wrapLayout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin:0; padding:0; background:#f9fafb; font-family:'Helvetica Neue',Arial,sans-serif; }
    .container { max-width:600px; margin:32px auto; background:#ffffff; border-radius:8px; padding:32px 40px; }
    h1 { font-size:20px; color:#111827; margin-top:0; }
    p  { font-size:14px; color:#374151; line-height:1.6; }
    a.btn {
      display:inline-block; margin:20px 0; padding:12px 24px;
      background:#2563eb; color:#ffffff; text-decoration:none;
      border-radius:6px; font-size:14px;
    }
    .footer { margin-top:32px; font-size:12px; color:#9ca3af; }
    .note   { font-size:12px; color:#6b7280; margin-top:8px; }
  </style>
</head>
<body>
  <div class="container">
    ${bodyHtml}
    <div class="footer">
      <p>このメールは Solar SaaS から自動送信されています。心当たりがない場合は無視してください。</p>
    </div>
  </div>
</body>
</html>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
