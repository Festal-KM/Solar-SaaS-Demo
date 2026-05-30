# S-002 2FA コード入力 — ChatGPT ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-002
- 画面名: 2FA コード入力
- 対応機能 ID: F-001, F-002
- 元設計書: `docs/04-ui-design.md` §4.1 S-002
- 想定画像:
  - `desktop.png`
  - `mobile.png`
  - `error.png` — 誤コード / 期限切れ

## ChatGPT 使い方
1. ChatGPT (GPT-4o / 画像生成有効) を開く
2. 下記「共通プロンプト」 + バリアントを順に貼り付け
3. PNG を本ディレクトリへ指定ファイル名で保存

---

## 共通プロンプト（全画像で先頭に置く）

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B web application called "Solar SaaS".

Strict style rules:
- Pure black-and-white wireframe. Light gray only for de-emphasis. No other colors.
- Rectangular blocks, Japanese headings on each section.
- Buttons: `[ ボタン名 ]`. Inputs: label above + line `_______`. Selects: `[ ラベル ▾ ]`.
- Annotations all in Japanese. No photos, no logos, no shadows, no rounded corners.
- Realistic information density.

This screen is pre-auth (between password and dashboard). No global header, no sidebar. A centered card on a plain canvas.
```

---

## desktop.png プロンプト

```
Layout: 1440x900 pixels, desktop browser view. Plain background, no header/sidebar.

Centered card (approx 480x520 px):

### Section 1: ヘッダー
- "Solar SaaS"（ワードマーク、中央）
- 見出し "2 段階認証コード入力"

### Section 2: 案内
- グレーテキスト 2 行: 
  "ご登録の認証アプリ（Google Authenticator 等）に表示されている"
  "6 桁の確認コードを入力してください。"

### Section 3: 6 桁 OTP 入力
- 6 つの正方形入力ボックスを横並び `[_][_][_][_][_][_]`
- ボックス間に小さな間隔、最初のボックスにフォーカスを表す太枠

### Section 4: ボタン列
- ボタン `[ 検証 ]`（カード幅いっぱい、強調）
- 下にリンク "バックアップコードを使用する"

### Section 5: フッター内テキスト
- "コードは 30 秒ごとに更新されます。" (グレー)
- リンク "サインインに戻る"
```

---

## mobile.png プロンプト

```
Layout: 375x812 pixels (iPhone portrait). Plain background, no header/sidebar.

Vertical stack:
1. 上部余白 100px
2. "Solar SaaS" 中央
3. 見出し "2 段階認証コード入力"（左寄せ、大きめ）
4. 案内文 2 行（グレー）
5. 6 桁 OTP 入力ボックス（横並び、スマホ幅に合わせて少し小さめ）
6. ボタン `[ 検証 ]`（幅いっぱい）
7. リンク "バックアップコードを使用する"（中央）
8. リンク "サインインに戻る"（中央）
9. 補助テキスト "コードは 30 秒ごとに更新されます。"
```

---

## error.png プロンプト

```
Layout: same as desktop.png.

Difference:
- OTP 入力ボックスが destructive 表現（太枠）
- インラインエラー（警告アイコン + メッセージ）:
  "コードが正しくないか、有効期限が切れています。あと 2 回失敗するとサインインからやり直しになります。"
- `[ 検証 ]` ボタンは活性のまま
```

---

## 設計意図メモ

- pre-auth のため装飾を排し、ユーザーの目線が OTP 入力に集中するレイアウト
- 「バックアップコードを使用する」は紛失時の救済導線。OTP の下に小さくリンク化
- 3 回連続失敗で再ログインを要求するため、error 画面で残回数を明示
- スマホでも 6 桁ボックスは横並びを維持（縦並びにすると数字キーボードからの入力ズレが起きやすい）
