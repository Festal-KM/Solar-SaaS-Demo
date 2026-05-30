# S-053 現場要員ダッシュボード — プロンプト

## 画面情報
- 画面 ID: S-053
- 画面名: 現場要員ダッシュボード（スマホ最優先）
- 対応機能 ID: F-026, F-027
- 元設計書: `docs/04-ui-design.md` §4.4 S-053
- 想定画像: `mobile.png` (主), `desktop.png` (参考)

## ChatGPT 使い方
1. ChatGPT → 共通プロンプト + バリアント → PNG 保存

---

## 共通プロンプト（現場要員・全画像で先頭）

```
You are a senior UX designer creating a low-fidelity wireframe for "Solar SaaS" — wholesaler field staff view (自社現場要員、スマホ最優先).

Strict style:
- Pure black-and-white. Light gray for de-emphasis only. No other colors.
- Rectangular blocks, Japanese headings.
- Buttons `[ ボタン名 ]`. Inputs label + line. Selects `[ ラベル ▾ ]`. All Japanese.
- No photos, logos, shadows, rounded corners.

Persistent UI (mobile-first):
- Top header (56px): "Solar SaaS / サンライズソーラー" + 通知ベル `[🔔]`(2) + アバター `[山]`
- Bottom tab bar: シフト / 今日のイベント / アポ登録 / 通知 / その他 (5 タブ、現在地強調)
- サイドバーはハンバーガーで展開（クローズ状態で描画）
```

---

## mobile.png プロンプト（主バリアント）

```
Layout: 375x812 pixels.

Top header: "Solar SaaS / サンライズ" + 通知ベル + アバター。
Bottom tab bar: シフト / 今日のイベント (active) / アポ登録 / 通知 / その他。

Main content (縦に積む):

### Section 1: 当日シフトカード（最上段、太枠強調）
- 見出し "今日のシフト (2026-05-23 土)"
- 内容:
  - 9:30 〜 18:30 / ホームセンターA 本店 / 関東
  - 役割: 一般 / 共同開催（関東ソーラー + みらいソーラー と共同）
  - リンク "地図で開く [📍]"
  - ボタン列: `[ イベント詳細 ]` `[ 開始報告 ]`(primary)

### Section 2: 直近シフトリスト（今週）
- 見出し "今週のシフト"
- リスト 4 件:
  - 5/24 (日) 9:30-18:30 / ホームセンターA 本店 (継続)
  - 5/25 (土) 10:00-17:00 / スーパーB 浦和店
  - 5/26 (日) 10:00-17:00 / スーパーB 浦和店
  - 5/29 (土) 9:30-18:30 / 量販店D 大阪本店
- リンク "すべて見る" → S-054

### Section 3: 当日未提出報告タスク
- 見出し "報告タスク (1 件未提出)"
- カード:
  - 5/23 ホームセンターA 本店
  - チェックリスト:
    - ✓ 開始報告（09:55 提出済）
    - ⚠ 終了報告（未提出）
    - ⚠ 成果報告（未提出）
  - `[ 報告を続ける ]`(primary) → S-056

### Section 4: 通知サマリ
- 見出し "通知 (2 件未読)"
- リスト 3 件:
  - シフト変更: 5/26 9:30 → 10:00 開始に変更 — 30 分前
  - 注意事項: 5/23 ホームセンターA は駐車場 B 棟使用 — 2 時間前
  - お知らせ: 6 月度シフト確定 — 昨日
- リンク "通知一覧へ" → S-078

### Section 5: クイックアクション
- ボタン `[ + アポ顧客登録 ]`(幅いっぱい) → S-057
```

---

## desktop.png プロンプト（参考）

```
Layout: 1440x900 pixels (現場要員は基本スマホだが、PC からも参照可能)。

Top header (64px): "Solar SaaS / サンライズ" + 通知ベル + アバター。
Sidebar (240px): ダッシュボード (active) / シフト / イベント / アポ登録。

Main content:
- mobile.png の各カードを左右 2 カラムで配置:
  - 左: 当日シフト + 報告タスク + クイックアクション
  - 右: 今週のシフト + 通知サマリ
```

---

## 設計意図メモ

- スマホ最優先動線。現場要員は移動中・現場でスマホから操作するため、サイドバーは隠して下部タブバー UI
- 当日シフトを最上段太枠で強調。1 タップで「開始報告」へ
- 報告未提出は警告アイコン + 「報告を続ける」ボタンで強制的に注意喚起
- 通知サマリでシフト変更を即受信できる導線
- 「アポ顧客登録」は現場で頻出。クイックアクションとして常時アクセス可能に
