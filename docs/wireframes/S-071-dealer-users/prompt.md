# S-071 二次店内ユーザー管理 — プロンプト

## 画面情報
- 画面 ID: S-071
- 画面名: 二次店内ユーザー管理
- 対応機能 ID: F-008
- 元設計書: `docs/04-ui-design.md` §4.5 S-071
- 想定画像: `desktop.png`, `mobile.png`

## ChatGPT 使い方
1. ChatGPT → 共通プロンプト + バリアント → PNG 保存

---

## 共通プロンプト

```
"Solar SaaS" 二次店本部 (dealer_admin only) B/W ワイヤーフレーム。淡グレーのみ非活性。
Buttons `[ ボタン名 ]`. Inputs label + line. Selects `[ ラベル ▾ ]`. Badges `「ステータス」`. All Japanese.
Header + Sidebar 共通: "メンバー" (active)。
```

---

## desktop.png プロンプト

```
Layout: 1440x900 pixels.

Main content:

### Section 1: パンくず + タイトル + アクション
- パンくず "ホーム > メンバー"
- 見出し "二次店内ユーザー管理"
- 右上: `[ + ユーザーを招待 ]`(primary)

### Section 2: フィルタバー
- セレクト `[ ロール ▾ ]` (全て / dealer_admin / dealer_staff)
- セレクト `[ 状態 ▾ ]` (有効 / 停止 / 招待中)
- 検索 "氏名 / メール ___"

### Section 3: ユーザーテーブル（8 行）
- 列: 氏名 / メール / ロール / 状態 / 最終ログイン / 作成日 / 操作
- 行データ:
  | [鈴] 鈴木 一郎 (自分) | suzuki@kanto-solar.example | dealer_admin | 「有効」 | 2026-05-23 10:05 | 2025-12-01 | `[ 編集 ]` |
  | [田] 田中 美咲 | tanaka@kanto-solar.example | dealer_admin | 「有効」 | 2026-05-22 16:30 | 2026-01-15 | `[ 編集 ] [ 停止 ]` |
  | [山] 山田 営業 | y.yamada@kanto-solar.example | dealer_staff | 「有効」 | 2026-05-23 09:42 | 2026-02-10 | `[ 編集 ] [ 停止 ]` |
  | [佐] 佐藤 隆司 | sato@kanto-solar.example | dealer_staff | 「有効」 | 2026-05-22 19:18 | 2026-02-22 | `[ 編集 ] [ 停止 ]` |
  | [中] 中村 健太 | nakamura@kanto-solar.example | dealer_staff | 「有効」 | 2026-05-23 08:12 | 2026-03-05 | `[ 編集 ] [ 停止 ]` |
  | [高] 高橋 真理 | takahashi@kanto-solar.example | dealer_staff | 「招待中」(淡) | — | 2026-05-15 | `[ 招待再送 ] [ 取消 ]` |
  | [伊] 伊藤 達也 | ito@kanto-solar.example | dealer_staff | 「停止」(淡) | 2026-04-30 | 2026-02-18 | `[ 編集 ] [ 再開 ]` |
  | [小] 小林 健 | kobayashi@kanto-solar.example | dealer_staff | 「停止」(淡) | 2026-03-15 | 2025-12-22 | `[ 編集 ] [ 再開 ]` |

### Section 4: 招待ドロワー（参考、右側に開く）
- 右に幅 420px のドロワー（ヘッダー "ユーザーを招待"）:
  - ラベル "メールアドレス" / 入力
  - ラベル "氏名" / 入力
  - ラベル "ロール" / セレクト `[ dealer_staff ▾ ]`
  - グレー注記 "招待メールが送信されます。受諾期限は 7 日です。"
  - ボタン: `[ キャンセル ]` + `[ 招待を送信 ]`(primary)
```

---

## mobile.png プロンプト

```
Layout: 375x812 pixels.

Main content:
1. 見出し "二次店内ユーザー管理" + `[ + 招待 ]`
2. フィルタチップ
3. ユーザーカードリスト 6 件:
   - 各カード太枠:
     - アバター + 氏名 (自分は太字)
     - メール
     - バッジ「ロール」「状態」
     - 最終ログイン
     - 右下: `[ 編集 ]` + 状態に応じて `[ 停止 ]` or `[ 再開 ]` or `[ 招待再送 ]`
4. 招待は別画面（全画面モーダル）として展開:
   - 同じフォーム + `[ 招待を送信 ]`
```

---

## 設計意図メモ

- 二次店管理者のみアクセス可能。一般スタッフには表示しない
- ロールは dealer_admin / dealer_staff の 2 種のみ
- 招待中は淡グレー、停止中も淡グレー。再開ボタンで復活可能
- 自分自身の行は「(自分)」表記で区別。誤って自分を停止しないように
