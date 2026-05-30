# S-003 2FA 初回セットアップ — ChatGPT ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-003
- 画面名: 2FA 初回セットアップ（QR + バックアップコード）
- 対応機能 ID: F-002
- 元設計書: `docs/04-ui-design.md` §4.1 S-003
- 想定画像: `desktop.png`, `mobile.png`

## ChatGPT 使い方
1. ChatGPT (GPT-4o) を開く
2. 共通プロンプト + バリアントを貼り付け
3. PNG を本ディレクトリに保存

---

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B web application "Solar SaaS".

Strict style:
- Pure black-and-white. Light gray only for de-emphasis. No other colors.
- Rectangular blocks, Japanese headings.
- Buttons: `[ ボタン名 ]`. Inputs: label + line. Selects: `[ ラベル ▾ ]`.
- All annotations in Japanese. No photos, logos, shadows, rounded corners.
- Realistic information density.

S-003 は pre-auth セットアップ画面。グローバルヘッダーは「Solar SaaS」ワードマークのみ表示し、サイドバーはなし（オンボーディング中）。
```

---

## desktop.png プロンプト

```
Layout: 1440x900 pixels.

Top bar (64px height): 左に "Solar SaaS" ワードマーク、右にリンク "ログアウト"。

中央コンテンツエリア（最大幅 800px、左右に余白）:

### Section 1: 見出し
- タイトル "2 段階認証のセットアップ"
- サブテキスト "アカウントを保護するため、認証アプリを設定してください。"
- ステップインジケータ `① QR 読み取り ── ② コード検証 ── ③ バックアップ保存` (現在地: ①)

### Section 2: 左右 2 カラム
- 左カラム (400px):
  - 見出し "ステップ 1: QR コードを読み取り"
  - QR コード placeholder: 大きな正方形（240x240px）に "QR" と中央表示、四隅にマーカー風の小さな四角
  - グレーテキスト "Google Authenticator / 1Password / Authy などのアプリで読み取ってください。"
  - 折りたたみリンク "QR が読み取れない場合は手動キーを表示"
- 右カラム (400px):
  - 見出し "ステップ 2: コードを検証"
  - 6 桁 OTP 入力ボックス `[_][_][_][_][_][_]`
  - ボタン `[ 検証して次へ ]`

### Section 3: バックアップコード（下段、まだ非活性表示）
- 見出し "ステップ 3: バックアップコード"（薄く表示、まだ非活性）
- グレー背景の四角に "コード検証後にバックアップコード 8 個が表示されます。" のテキスト

### Section 4: フッター
- リンク "後でセットアップする"（必須ロールなら非表示の注記）
- 注記グレー文 "管理者ロールは 2FA 必須です。スキップできません。"
```

---

## mobile.png プロンプト

```
Layout: 375x812 pixels.

Top bar (56px): "Solar SaaS" + 右に "ログアウト"

Vertical stack:
1. タイトル "2 段階認証のセットアップ"
2. ステップインジケータ ①→②→③（横並び、現在地強調）
3. 見出し "ステップ 1: QR コードを読み取り"
4. QR コード placeholder（中央、画面幅の 70%）
5. グレーテキスト案内
6. リンク "手動キーを表示"
7. 見出し "ステップ 2: コードを検証"
8. 6 桁 OTP 入力ボックス（やや小さめで横並び）
9. ボタン `[ 検証して次へ ]`（幅いっぱい）
10. グレーボックス "コード検証後にバックアップコードが表示されます。"
11. 注記グレー文（必須ロール時）
```

---

## 設計意図メモ

- 3 ステップを明示することで「QR 読み取り → 検証 → バックアップ保存」のメンタルモデルを与える
- バックアップコードはステップ 2 が成功するまで非表示。誤って QR と一緒に共有されないようにする
- 必須ロール（saas_admin / wholesaler_admin）は「スキップできません」を明示し、後続画面で混乱を避ける
- スマホでも 1 画面で完結できるように左右 2 カラムを縦に再構成
