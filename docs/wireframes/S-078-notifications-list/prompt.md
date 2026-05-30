# S-078 通知一覧（インボックス） — プロンプト

## 画面情報
- 画面 ID: S-078
- 画面名: 通知一覧（インボックス）
- 対応機能 ID: F-052
- 元設計書: `docs/04-ui-design.md` §4.7 S-078
- 想定画像: `desktop.png`, `mobile.png`, `empty.png`

## ChatGPT 使い方
1. ChatGPT → 共通プロンプト + バリアント → PNG 保存

---

## 共通プロンプト（共通画面・全画像で先頭）

```
You are a senior UX designer creating a low-fidelity wireframe for "Solar SaaS" — generic/common view (ロール横断).

Strict style:
- Pure black-and-white. Light gray for de-emphasis only.
- Rectangular blocks, Japanese headings.
- Buttons `[ ボタン名 ]`, inputs label + line, selects `[ ラベル ▾ ]`.
- Badges `「ステータス」`. All Japanese annotations.
- No photos, logos, shadows, rounded corners.

Persistent UI:
- Top header (64px): "Solar SaaS / テナント名" + 通知ベル + ヘルプ + アバター（ロールに応じてテナント切替セレクトを表示）
- Left sidebar (240px): ロール別ナビ（このワイヤーは wholesaler_admin 例で描画。"通知" 相当の項目は固定ではないので、サイドバーは展開時にハイライトなし or "ダッシュボード" にハイライト）
- Mobile: header (56px) ハンバーガー + テナント表示 + 通知ベル + アバター
```

---

## desktop.png プロンプト

```
Layout: 1440x900 pixels. Header + Sidebar (wholesaler_admin 例)。

Main content:

### Section 1: パンくず + タイトル + アクション
- パンくず "ホーム > 通知"
- 見出し "通知一覧"
- 右上: `[ すべて既読にする ]`(secondary)

### Section 2: タブ
- `未読 (12)` (active) / `既読 (58)` / `全件 (70)`

### Section 3: フィルタバー
- セレクト `[ 種別 ▾ ]` (全て / イベント / マエカク / 商談・契約 / 月次 / システム)
- 日付範囲 `[ 期間 ── ]`
- 検索 "通知本文 ___"

### Section 4: 通知リスト（10 件）
- 各行クリックで詳細 (S-079) or 対応画面へ:
  - [未読: 太字] マエカク結果到着: 山○ 太○ 承認 — 関東ソーラーに連絡しました — 2 分前 → S-079
  - [未読] 二次店「みらいソーラー」が希望提出（6 月候補） — 10 分前
  - [未読] 開催体制決定: 5/25 ホームセンターA 本店 — 30 分前
  - [未読] シフト追加: 山田 太郎 を 5/28 量販店F に割当 — 1 時間前
  - [未読] マエカク完了: 田○ 一○ — 1 時間前
  - [未読] 契約成立: 鈴○ 花○ 2,800,000 円 — 3 時間前
  - [既読] 二次店「東日本ソーラー」が月次コメント提出 — 5 時間前
  - [既読] イベント中止: 5/19 スーパーD — 昨日
  - [既読] 月次報告 5 月: 提出期限まで残り 7 日 — 昨日
  - [既読] パスワードが変更されました — 2 日前

### Section 5: ページネーション
```

---

## mobile.png プロンプト

```
Layout: 375x812 pixels. 下部タブバー: 通知 (active)。

Main content:
1. 見出し "通知一覧" + `[ 全既読 ]`
2. タブ（横スクロール）: 未読 / 既読 / 全件
3. フィルタチップ
4. 通知カードリスト 8 件（縦に積む）:
   - 各カード:
     - 未読は太字 + 左に丸ポチ `●`
     - 種別アイコン or ラベル（小さく）
     - 通知本文 (2 行まで省略表示)
     - 経過時間
5. ページネーション
```

---

## empty.png プロンプト

```
Layout: same as desktop.png.

差分:
- タブ・フィルタは表示するが通知リスト領域を空ステート枠:
  - 空ボックス + 見出し "通知はありません"
  - 説明 "業務イベントが発生すると通知が届きます。"
```

---

## 設計意図メモ

- 未読 / 既読 / 全件 のタブで分かりやすく分離。未読数を最初のタブにバッジ表示
- 種別フィルタで「イベント関連だけ見たい」等の業務分けに対応
- 行クリックで対応画面 (例: マエカク結果 → S-066/S-077) へ自動遷移して既読化
- 全既読は危険操作ではないが secondary 配置で意図しないクリックを抑制
