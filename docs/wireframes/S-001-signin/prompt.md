# S-001 サインイン — ChatGPT ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-001
- 画面名: サインイン
- 対応機能 ID: F-001
- 元設計書: `docs/04-ui-design.md` §4.1 S-001
- 想定画像:
  - `desktop.png` — デスクトップ標準ビュー
  - `mobile.png` — モバイル 1 カラム
  - `error.png` — 認証失敗エラー時

## ChatGPT 使い方
1. ChatGPT (GPT-4o / 画像生成有効) を開く
2. 下記「共通プロンプト」を貼り付け、続けて生成したいバリアントのプロンプトを貼り付ける
3. 出力 PNG を本ディレクトリに `desktop.png` / `mobile.png` / `error.png` で保存

---

## 共通プロンプト（全画像で先頭に置く）

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B web application called "Solar SaaS" (太陽光卸・二次店営業管理 SaaS — multi-tenant sales management for solar panel wholesalers and their dealer partners).

Output style rules (strict):
- Pure black-and-white wireframe. Light gray only for de-emphasis (placeholders, disabled states, masked PII). No other colors.
- Rectangular blocks for sections. Each section has a Japanese heading.
- Buttons: rendered as `[ ボタン名 ]` (square brackets, text only, sharp corners).
- Input fields: label above + horizontal line `_______`.
- Dropdowns: `[ ラベル ▾ ]`.
- Status badges: `「ステータス名」` or `[ステータス]`.
- Avatars/icons: placeholder squares with one-letter Japanese labels (e.g. `[佐]`).
- Tables: show realistic row count (8–12 rows), not 2–3.
- Lists: show 5–10 items where applicable.
- Annotations and labels: ALL in Japanese.
- No real photos, no logos, no decorative graphics.
- No specific colors, no shadows, no rounded corners.
- Show realistic information density.

This screen (S-001) is the sign-in page. It has NO global header or sidebar — it is a pre-auth screen.
Show only a centered card on a plain background with the application wordmark "Solar SaaS" at the top.
```

---

## desktop.png プロンプト

```
Layout: 1440x900 pixels, desktop browser view.

Background: pure white plain canvas. No header, no sidebar (pre-auth screen).

Centered card (approx 480x560 px) containing:

### Section 1: ロゴエリア (top of card)
- 中央配置: テキスト "Solar SaaS"（大きめ、ワードマーク表現）
- サブテキスト: "太陽光卸・二次店営業管理"（小さめ、グレー）

### Section 2: サインインフォーム (card 中央)
- 見出し: "サインイン"
- 入力 1: ラベル "メールアドレス" / 下線 / プレースホルダ "user@example.com"
- 入力 2: ラベル "パスワード" / 下線 / プレースホルダ "********" / 右端に目アイコン `[👁]`
- ボタン: `[ サインイン ]`（カード幅いっぱい、primary 強調表現として太枠）

### Section 3: 補助リンク列 (card 下部)
- リンク行 1: "パスワードを忘れた方はこちら"
- リンク行 2: "招待コード入力（新規二次店）"
- リンク行 3: "招待メールからのアカウント開設"

### Section 4: フッター (card 外、画面下端)
- "© 2026 Solar SaaS  ・  利用規約  ・  プライバシーポリシー"（小さめ、グレー）

カード外の余白は十分に取り、装飾はなし。
```

---

## mobile.png プロンプト

```
Layout: 375x812 pixels (iPhone portrait).

Background: 純白。ヘッダーなし、サイドバーなし。

Vertical stack from top:
1. 上部余白 80px
2. "Solar SaaS"（中央、ワードマーク）
3. サブテキスト "太陽光卸・二次店営業管理"
4. 見出し "サインイン"（左寄せ）
5. ラベル "メールアドレス" / 入力欄（横幅いっぱい）
6. ラベル "パスワード" / 入力欄 + 目アイコン
7. ボタン `[ サインイン ]`（横幅いっぱい）
8. リンク "パスワードを忘れた方はこちら"（中央）
9. 区切り線
10. リンク "招待コード入力（新規二次店）"
11. リンク "招待メールからのアカウント開設"
12. 下端: フッター小テキスト
```

---

## error.png プロンプト

```
Layout: same as desktop.png.

Difference from desktop:
- パスワード入力欄の下に destructive 表現のインラインエラー（黒太枠 + 警告アイコン `[⚠]`）:
  "メールまたはパスワードが正しくありません。あと 2 回失敗するとアカウントがロックされます。"
- 入力欄自体も destructive 表現（太枠）
- 「パスワードを忘れた方はこちら」リンクが強調表示
```

---

## 設計意図メモ（ChatGPT には渡さない）

- pre-auth 画面のためヘッダー / サイドバーは出さない。アプリ外観の混乱を避けるため
- 招待コード入力（新規二次店）と招待メール開設（卸業者ユーザー）は別動線。リンクとして並列に提示し、ユーザーが自分の経路を選べるようにする
- 5 回失敗で S-006 ロック画面へ強制遷移するため、error 画面で「あと N 回」のカウントダウンを明示してユーザーに猶予を伝える
- スマホはフォーム要素を縦に積み、ファーストビューで `[サインイン]` ボタンまで到達できる高さに調整
