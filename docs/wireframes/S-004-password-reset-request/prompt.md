# S-004 パスワードリセット申請 — ChatGPT ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-004
- 画面名: パスワードリセット申請
- 対応機能 ID: F-003
- 元設計書: `docs/04-ui-design.md` §4.1 S-004
- 想定画像: `desktop.png`, `mobile.png`

## ChatGPT 使い方
1. ChatGPT を開く → 共通プロンプト + バリアント貼り付け → PNG 保存

---

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for "Solar SaaS".
Strict B/W wireframe, light gray for de-emphasis only. No other colors.
Buttons `[ ボタン名 ]`, inputs label + line, all Japanese annotations.
No photos, logos, shadows, rounded corners. Realistic density.

S-004 is pre-auth. No header, no sidebar. Centered card on plain canvas.
```

---

## desktop.png プロンプト

```
Layout: 1440x900 pixels. Plain canvas.

Centered card (480x420 px):

### Section 1: ヘッダー
- "Solar SaaS" ワードマーク
- 見出し "パスワードリセット"

### Section 2: 案内
- グレー 2 行: 
  "ご登録のメールアドレスを入力してください。"
  "リセット用のリンクをメールでお送りします。"

### Section 3: フォーム
- ラベル "メールアドレス" / 下線
- ボタン `[ リセットリンクを送信 ]`（幅いっぱい）

### Section 4: 補足
- グレー注記 "メールが届かない場合は迷惑メールフォルダもご確認ください。"
- リンク "サインインに戻る"
```

---

## mobile.png プロンプト

```
Layout: 375x812 pixels. Plain canvas.

Vertical stack:
1. 上部余白 120px
2. "Solar SaaS" 中央
3. 見出し "パスワードリセット"（左寄せ大きめ）
4. 案内文 2 行（グレー）
5. ラベル "メールアドレス" / 入力欄
6. ボタン `[ リセットリンクを送信 ]`（幅いっぱい）
7. グレー注記
8. リンク "サインインに戻る"（中央）
```

---

## 設計意図メモ

- メール到達の有無は明示しない（メール列挙攻撃を避ける）。送信後は一律「メールを送信しました」表示
- スロットル（10 分 3 回）はサーバ側で制御。UI 上は触れない
- 装飾を排し、メールアドレス入力に集中させる
