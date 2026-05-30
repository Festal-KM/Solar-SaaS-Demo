# 技術選定 — 太陽光卸・二次店営業管理 SaaS

本書は `docs/01-business-requirements.md` と `docs/02-functional-requirements.md` を起点に、本 SaaS の **MVP（1〜2 か月）→ Phase 2 以降** を支える技術スタックを決定する。

> **重要な前提（プロジェクト読み替え）**
> 本リポジトリのエージェント定義および `CLAUDE.md` は元々 A2P（Amazon 自動出版ツール、シングルユーザー、AI エージェント駆動）向けに書かれている。本プロジェクトは **「太陽光卸・二次店営業管理 SaaS」（マルチテナント / 複数ロール / AI 不要の通常 Web 業務アプリ）** であり、以下の読み替えを行う。
>
> | CLAUDE.md 由来 | 本プロジェクトでの扱い |
> |---|---|
> | Next.js 15 + TypeScript / PostgreSQL + Prisma / Tailwind + shadcn/ui / Vitest + Playwright / Railway | **そのまま採用**（理由は本書 §2 で詳述） |
> | NextAuth Credentials（env パスワード、単一ユーザー） | **不採用**。マルチテナント + 招待 + セルフサインアップ + 2FA を満たす再設計が必要（§4.1） |
> | graphile-worker（AI パイプライン用） | ジョブキュー需要そのものは MVP では薄いが、月次集計・通知再試行用途として **採用継続**（§4.5） |
> | Claude Agent SDK / Vercel AI SDK / `@anthropic-ai/sdk` / OpenAI / docx / `@react-pdf/renderer` / Cloudflare R2（AI/出版固有用途） | **本プロジェクトでは AI/出版機能は不要**。R2 のみ「契約書 PDF / 施工写真の保存」用途で **S3 互換ストレージとして採用**（§4.7） |

---

## 1. 選定方針

### 1.1 優先する判断軸

| 軸 | 内容 | 適用例 |
|---|---|---|
| **MVP の納期 (1〜2 か月)** | フルマネージド・既存実績・型安全を優先。ボイラープレートを最小化 | Next.js + Prisma + shadcn/ui の単一スタックに集約 |
| **マルチテナント分離の堅牢性** | 「卸業者-二次店 関係 ID」を主分離キーに、データ漏洩を構造的に防ぐ | アプリ層 ORM フック + DB 層 RLS の二重防御 |
| **業務時間帯 SLA (8:00–22:00 / 99.5%)** | 障害時の自動復旧・観測性・運用負荷の低さ | Railway フルマネージド + Sentry + 構造化ログ |
| **コスト（パイロット 1 社 + α）** | 月額 $50–$200 レンジに収める。スケール時に置換可能な設計 | Resend 無料枠 / Railway Hobby〜Pro / Prisma 無料 |
| **型安全 (end-to-end)** | DB → API → UI を TypeScript と Zod で一貫させる | Prisma + Zod + react-hook-form |
| **既存決定との整合** | CLAUDE.md の確定スタックを覆さない | Next.js 15 / Prisma / shadcn/ui を尊重 |
| **将来の置き換え可能性** | 各層を抽象化し、Railway → AWS、Resend → SES などへ移行可能 | S3 互換 / SMTP 抽象 / Prisma で DB ポータビリティ |

### 1.2 「採用しないもの」の整理

| 領域 | 不採用 | 理由 |
|---|---|---|
| AI / LLM（Anthropic SDK / Vercel AI SDK 等） | 全面不採用 | 本プロジェクトは業務管理 SaaS。生成系・自然言語処理の業務要件なし |
| 画像生成（gpt-image-1） | 不採用 | 同上 |
| Word/PDF 生成（docx / @react-pdf/renderer） | MVP 不採用 | 帳票・請求書発行は §6 対象外。Phase 4 で必要になれば導入 |
| Redis / BullMQ | 不採用 | Postgres ベースで完結させる（graphile-worker）。Redis を別途運用するコスト不要 |
| NextAuth Credentials の単一ユーザー env パスワード方式 | 不採用 | マルチテナント / 招待制 / 2FA に不適合 |
| Supabase Auth | 比較対象だが不採用 | NextAuth (Auth.js v5) で要件充足可、Supabase 依存を増やしたくない |
| Drizzle / Kysely | 不採用 | CLAUDE.md 確定の Prisma を継続 |

---

## 2. 確定スタック（CLAUDE.md 由来 + 本プロジェクト独自）

### 2.1 言語・フレームワーク・ホスティング

| 領域 | 採用 | バージョン | 理由詳細 | 競合 | リスク / 回避策 |
|---|---|---|---|---|---|
| Web フレームワーク | Next.js (App Router) | `next ^15.0` | React Server Components + Server Actions で API ルートを最小化。フルスタック単一リポジトリで MVP 期間短縮 | Remix / Nuxt / SvelteKit | RSC + Server Actions の習熟コスト → shadcn/ui のサンプル踏襲で吸収 |
| 言語 | TypeScript | `typescript ^5.6` | DB スキーマ → API → UI を型で繋ぐ。Prisma との親和性 | 純 JS | strict モード前提。`any` 禁止ルール |
| ランタイム | Node.js | `node 22 LTS` | Next.js 15 推奨。`fetch` ネイティブ、`--watch` 対応 | Bun / Deno | Bun は Prisma 一部問題報告あり |
| パッケージマネージャ | pnpm | `pnpm ^9` | モノレポ前提、`node_modules` 軽量 | npm / yarn | Railway は pnpm 標準サポート |
| ホスティング | Railway | - | Web + Worker + Postgres を同一プロジェクト内で構成可。GitHub 連携で自動デプロイ | Vercel + Neon / Render / Fly.io | Vercel は Server Actions 親和性高いが、長時間ジョブ・自前 Postgres コスト高。Railway は単一プロバイダで運用負荷低 |
| Postgres | Railway PostgreSQL | `postgres 16` | Railway 標準。日次自動バックアップ・水平スケール可。Phase 2 で外出し可（Neon / Supabase / RDS） | Neon / Supabase | コネクション数上限は Pro プラン契約で対応 |

### 2.2 データ層

| 領域 | 採用 | バージョン | 理由詳細 | 競合 | リスク / 回避策 |
|---|---|---|---|---|---|
| ORM | Prisma | `@prisma/client ^6.0` | スキーマファースト、型安全、`prisma migrate` で履歴管理。テナント分離フックを Prisma Middleware で実装容易 | Drizzle / Kysely / TypeORM | N+1 クエリのリスク → `include` の濫用回避、必要に応じ raw SQL |
| マイグレーション | Prisma Migrate | 同上 | スキーマと一体管理。本番は `prisma migrate deploy`、開発は `prisma migrate dev` | Atlas / Sqitch | 大規模スキーマ変更は手動 SQL 補正必要時あり → `--create-only` で確認後適用 |
| バリデーション | Zod | `zod ^3.23` | API 入出力・フォーム・Server Action 入力で共有。Prisma 型との橋渡し | Yup / Valibot / ArkType | バンドル肥大化 → tree-shake で軽減 |

### 2.3 UI

| 領域 | 採用 | バージョン | 理由詳細 | 競合 | リスク / 回避策 |
|---|---|---|---|---|---|
| CSS | Tailwind CSS | `tailwindcss ^3.4` | shadcn/ui 標準。レスポンシブ・ダークモード対応。Tailwind v4 はベータ → 安定の v3.4 を選択 | UnoCSS / vanilla CSS | クラス名肥大化 → `clsx` + `cva` で抽象化 |
| コンポーネント | shadcn/ui | (CLI ベース、コピー) | コードを自リポジトリに取り込み、要件に応じ改変可。Radix UI ベースでアクセシビリティ良好 | MUI / Mantine / Chakra | コンポーネント毎追加が必要 → `npx shadcn add` で都度導入 |
| アイコン | lucide-react | `^0.460` | shadcn/ui 既定。MIT、軽量、tree-shake 可 | Heroicons / phosphor-icons | - |
| テーブル | TanStack Table | `@tanstack/react-table ^8.20` | 仮想化・ソート・フィルタを内製ヘッドレスに実装。shadcn/ui の DataTable サンプルと結合 | AG Grid / Material React Table | 学習コスト → shadcn の `examples/data-table` を踏襲 |
| フォーム | react-hook-form + zod | `react-hook-form ^7.53`, `@hookform/resolvers ^3.9` | 高性能、Zod スキーマで型 + バリデーション統一 | Formik / TanStack Form | 複雑なネスト → `useFieldArray` で対応 |
| 日付 | date-fns | `date-fns ^4.1` | tree-shake 可、JST 固定運用に十分 | dayjs / luxon | TZ 処理は `date-fns-tz` を追加 |

### 2.4 テスト

| 領域 | 採用 | バージョン | 理由詳細 | 競合 | リスク / 回避策 |
|---|---|---|---|---|---|
| Unit テスト | Vitest | `vitest ^2.1` | esbuild ベースで高速、Jest 互換 API、TS ネイティブ | Jest / Bun test | Next.js 15 RSC のテストはやや工夫が必要 → Server Action は単体関数化してテスト |
| E2E テスト | Playwright | `@playwright/test ^1.48` | 多ブラウザ対応、トレース機能、CI 安定 | Cypress | E2E の並列実行で DB 競合 → テナント単位の独立 DB スキーマで分離 |
| API モック | MSW | `msw ^2.6` | コンポーネントテストで外部 API を遮断 | nock | Phase 2 で導入判断 |

### 2.5 ビルド・開発体験

| 領域 | 採用 | バージョン | 理由詳細 |
|---|---|---|---|
| Linter | ESLint | `eslint ^9` (flat config) | Next.js 公式 ESLint + `eslint-plugin-import` |
| Formatter | Prettier | `prettier ^3.3` | `prettier-plugin-tailwindcss` で Tailwind クラスソート |
| 型チェック | tsc | (TypeScript 同梱) | CI で `tsc --noEmit` を必須化 |
| Git hooks | husky + lint-staged | `husky ^9`, `lint-staged ^15` | コミット前に prettier / eslint / typecheck |

---

## 3. 確定スタックの「採用理由」詳細（CLAUDE.md からの肉付け）

### 3.1 なぜ Next.js 15 + App Router か

- **Server Actions と RSC** により、API ルート定義を最小化できる。1〜2 か月の MVP で 58 機能を実装する上で、フォーム送信・テーブル更新を直接 Server Action で書ける利点は大きい。
- App Router の **`layout.tsx` ネスト** で「ロール別レイアウト」「テナントコンテキスト Provider」を素直に表現できる（卸業者 / 二次店 / SaaS 運営）。
- 認証ミドルウェア (`middleware.ts`) で「未ログイン → /login」「2FA 未完了 → /mfa/setup」「テナント未選択 → /select-context」を一元処理できる。
- shadcn/ui・Tailwind・NextAuth (Auth.js v5) のサンプルが App Router 前提に揃ってきており、エコシステム成熟済み。

**既知の懸念**
- RSC + Server Action のキャッシュ挙動が直感的でないケースあり → `revalidatePath` / `revalidateTag` を関連機能ごとに整理して `program-design` で命名規約化する。
- Railway は Vercel ほど Next.js 最適化されていないが、Standalone build で十分高速。

### 3.2 なぜ Prisma か

- **スキーマファースト**: 58 機能・約 30 エンティティ（docs/02 §4）を Prisma schema 1 ファイルで俯瞰できる。多対多テナント分離の主キー (`relationship_id`) を中心とした設計を表現しやすい。
- **Middleware** で「全クエリに `wholesaler_id` / `relationship_id` 条件を自動付与」を実装可能。アプリ層の漏洩対策として強力（§4.2 で詳述）。
- **Prisma Migrate** はチーム規模に対し十分（パイロット 1 社、開発 1〜数名）。スキーマ差分は CI で `prisma migrate diff` で検証。
- 競合の **Drizzle** は型推論が優秀だが、Prisma の方が学習コスト低・サンプル豊富。Prisma を覆すコストは MVP 期間で許容できない。

**既知の懸念**
- Prisma の **edge runtime 非対応**（Driver Adapter で部分対応）→ Railway の Node ランタイム前提なので問題なし。
- 大量行更新時のパフォーマンス → 月次集計 (F-048) は raw SQL or `executeRawUnsafe` で対応可能。

### 3.3 なぜ shadcn/ui + Tailwind か

- shadcn/ui は **依存ライブラリではなくコードをコピーする方式** で、要件に合わせて自由に改変できる。MUI / Mantine のようなブラックボックスを抱え込まずに済む。
- Radix UI ベースで **WCAG 2.1 AA** （docs/02 §5.6）を満たしやすい（フォーカス管理、aria 属性）。
- スマホ最優先フロー（F-026 シフト確認、F-028〜F-030 イベント報告 等）に対し、Tailwind のブレークポイントで一貫したレスポンシブ設計が容易。
- 提案書 §14 でも `shadcn/ui` が推奨されている。

### 3.4 なぜ Railway か

- Web + Worker + Postgres を **単一プロバイダ・単一ダッシュボード** で管理。MVP 期間中の運用負荷を最小化。
- GitHub プッシュ → 自動デプロイ、環境変数管理、ロールバックが UI 完結。
- Vercel + 外部 Postgres (Neon 等) の組み合わせと比較し、コスト・遅延・運用工数で有利。
- **将来移行**: AWS App Runner / ECS や GCP Cloud Run へは Dockerfile 化済みなら容易（Phase 4 以降の検討事項）。

**既知の懸念**
- Railway は **東京リージョン未提供**（2026 年 5 月時点、US/EU 中心）。レイテンシ要件 (docs/02 §5.1: 一覧 < 800ms) は最近のシンガポール対応で許容範囲。要モニタリング。Phase 2 で東京 PoP 提供サービスへの移行を再評価。

---

## 4. 領域別の追加選定（機能要件から導出）

### 4.1 認証 (F-001 〜 F-010)

CLAUDE.md の「NextAuth Credentials + env パスワード」は **マルチテナント・招待制・2FA・セルフサインアップ** を満たさないため、本プロジェクトでは **Auth.js v5 (NextAuth v5) + 自前テーブル + 自前 2FA** に置き換える。

| 領域 | 採用 | バージョン | 対応機能 | 理由詳細 | 競合 | リスク / 回避策 |
|---|---|---|---|---|---|---|
| 認証フレームワーク | Auth.js v5 (NextAuth v5) | `next-auth ^5.0` (beta が安定運用中) | F-001, F-003 | App Router ネイティブ、Credentials Provider + 自前テーブル運用が容易。JWT セッションでステートレス | Clerk / Lucia / Supabase Auth | beta 表記だが本番採用事例多数。API は安定。固定版 (`5.0.0-beta.25` 等) を pin して採用 |
| パスワードハッシュ | argon2 | `argon2 ^0.41` | F-001 | bcrypt より新しい OWASP 推奨。Argon2id を採用 | bcrypt | ネイティブビルド必要 → Railway は ok。WebContainers では不可（CI で要確認） |
| TOTP (2FA) | otpauth + qrcode | `otpauth ^9.3`, `qrcode ^1.5` | F-002 | RFC 6238 準拠、軽量、暗号鍵を独自テーブルで保持 | speakeasy / otplib | speakeasy は近年メンテ薄め。otpauth は active maintained |
| バックアップコード | 自前実装（argon2 ハッシュ） | - | F-002 | 8 個発行・1 回使用で無効化。`backup_codes` テーブル | - | 紛失リカバリは `saas_admin` 経由 |
| セッション戦略 | NextAuth JWT + DB セッションテーブル | - | F-001 | JWT で軽量、強制ログアウト用に `users.session_version` で失効制御 | DB only セッション | JWT 失効は `session_version` カウントアップで対応 |
| 招待・サインアップ | 自前実装 | - | F-004, F-006, F-007, F-008 | 招待トークン (UUID + 有効期限 7 日)、招待コード（卸業者発行、有効期限・回数上限） | - | トークンは `argon2` でハッシュ保管 |

**Open Question 対応**
- `docs/01 OQ-4` / `docs/02 OQ-1` 「2FA 実装方式」 → **MVP は TOTP (Authenticator アプリ) のみ**。SMS / メールワンタイムは Phase 2 で再評価。

### 4.2 マルチテナント分離 / 認可 (F-009, docs/02 §4.8, §5.3)

二重防御を採用する。

| 領域 | 採用 | 対応機能 | 理由詳細 | 競合 | リスク / 回避策 |
|---|---|---|---|---|---|
| アプリ層分離 | Prisma Client Extensions (`$extends`) | F-009, 全 API | リクエストごとに `getTenantContext()` で `wholesaler_id` / `relationship_id[]` を取得し、Prisma クエリに条件を強制注入。型安全 | Prisma Middleware（deprecated 寄り） | 全テーブルへの自動付与は extension で実装（`query.findMany` を wrap） |
| DB 層分離 | PostgreSQL Row-Level Security (RLS) | F-009 | `SET LOCAL app.current_wholesaler_id` を `BEGIN` 直後に発行、`USING (wholesaler_id = current_setting(...))` ポリシー | - | Prisma で `$queryRaw('SET LOCAL ...')` を毎リクエスト発行。コネクションプール (pgBouncer) の transaction mode と相性注意 → MVP は session pool で運用 |
| 認可（ロール） | アプリ層（zod スキーマ + ガード関数） | 全機能 | `assertCan({ user, action, resource })` を Server Action 冒頭で呼ぶ。ロール表は DB に保持（提案書 §8） | CASL / Casbin | OSS の権限ライブラリは過剰。自前で 50〜100 行に収める |

**設計判断**: 「アプリ層フックのみ」では SQL Injection や開発ミスで漏洩リスクが残る。「RLS のみ」では Prisma のクエリ生成と相性が悪く、JOIN・サブクエリで意図しない 0 件返却が発生しうる。**両方** 入れることで「アプリ層を通り抜けても DB がブロック」する Defense in Depth を実現する。

### 4.3 個人情報マスキング (F-031, F-055, docs/02 §5.3)

| 領域 | 採用 | 対応機能 | 理由詳細 |
|---|---|---|---|
| マスキング層 | **API レイヤ（Server Action 戻り値 + API ルート出力）** | F-031, F-055 | DB には素データ保存、表示時にロール × 用途で `maskPhone(phone, viewer)` `maskAddress(address, viewer)` を通す。監査ログ・メール本文は強制マスク |
| 仕入値の二次店非開示 | Prisma クエリ select で除外 + Zod schema で型から消す | F-012, F-041, F-051 | API レスポンス型に `purchase_price` フィールド自体を含めない（二次店ロール時）。`omit` 構文（Prisma 6）または DTO 変換 |
| メール本文マスク | 通知テンプレート関数で固定 | F-053 | テンプレートに「電話番号下 4 桁のみ」等を埋め込む |

**Open Question 対応**
- `docs/02 OQ-2` 「マスキング桁数」 → **MVP デフォルト: 電話は下 4 桁のみ表示 (`****-****-1234`)、住所は市区町村まで**。卸業者管理者は非マスク、SaaS 運営者は常時マスク（Assumption 10）。設定で上書きできるようにはしない（Phase 2 で再検討）。

### 4.4 通知 (F-052 / F-053 / F-054)

| 領域 | 採用 | バージョン | 対応機能 | 理由詳細 | 競合 | リスク / 回避策 |
|---|---|---|---|---|---|---|
| アプリ内通知 | 自前テーブル (`notifications`) + Server Action ベースのフェッチ | - | F-052 | ベル UI + 未読バッジ。リアルタイム性は MVP では不要（30 秒ポーリングで十分） | Pusher / Ably / Supabase Realtime | リアルタイム化は Phase 2 で SSE or WS を追加 |
| メール送信 | Resend | `resend ^4.0` | F-053, F-003, F-006 | DX 最良、無料 3,000 通/月、React Email テンプレートと統合容易。ドメイン認証 (SPF/DKIM/DMARC) UI 提供 | SendGrid / Postmark / AWS SES | スケール時（>50K 通/月）は SES へ移行可（SMTP プロトコル抽象化を内部で持つ）|
| メールテンプレート | React Email | `@react-email/components ^0.0.31` | F-053 | TSX で書ける、Resend と公式統合 | mjml / Maizzle | プレビュー UI は dev サーバで起動 |
| メール再試行 | graphile-worker のジョブ | - | F-053 | 30 分以内に最大 3 回再試行（docs/02 受け入れ基準）。失敗時管理者通知 | - | キューが詰まった場合のアラート要 |
| LINE 通知 (Phase 2) | LINE Messaging API + `@line/bot-sdk` | `@line/bot-sdk ^9` | F-054 | Phase 2。卸業者ごとに公式アカウント連携 or 共通アカウント運用かは要設計判断 | - | コスト: メッセージ通数課金あり。配信ボリュームを §9 で試算 |

### 4.5 ジョブ実行（月次集計、通知再試行、LINE Phase 2）

| 領域 | 採用 | バージョン | 対応機能 | 理由詳細 |
|---|---|---|---|---|
| ジョブキュー | **graphile-worker** | `graphile-worker ^0.16` | F-046, F-048, F-053, F-054 | Postgres ベースで Redis 不要、CLAUDE.md 確定スタックを継続。pgcron 不要で `cron-like` ジョブ実装可。月次バッチ・メール再試行・LINE 配信に十分 |
| Cron スケジューラ | graphile-worker の crontab 機能 | 同上 | F-048（月末翌日に自動集計） | 別途スケジューラ（Vercel Cron / Railway Cron）を導入する必要なし |
| Worker プロセス | Railway の別サービス（`apps/worker`） | - | 同上 | Web サービスと分離してリソース競合を回避 |

**代替案検討**
- **Inngest**: 開発体験が良くサーバレス前提だが、Railway 上では Web プロセスが常時稼働しているので Inngest のメリットが薄い。さらに月額コスト ($75〜) と外部依存が増える → 不採用。
- **Trigger.dev**: 同上の理由 + 自己ホスト版も可能だが運用負荷増 → 不採用。
- **Vercel Cron**: Vercel ホスティングではないため不採用。
- **BullMQ**: Redis 必須 → 不採用。

**置き換えの選択肢**: パイロット運用後、月次バッチが重くなった場合 (>5 秒 / 100 二次店規模) は BullMQ + Redis または Inngest への移行を Phase 2 で検討。

### 4.6 ファイル保存（契約書 PDF・施工写真・添付）

| 領域 | 採用 | バージョン | 対応機能 | 理由詳細 | 競合 | リスク / 回避策 |
|---|---|---|---|---|---|---|
| オブジェクトストレージ | Cloudflare R2 | `@aws-sdk/client-s3 ^3.700` | F-028, F-029, F-040, F-044, F-045 | S3 互換、**エグレス無料**、月額 $0.015/GB ストレージのみ。契約書 (~MB) + 写真 (~MB) で月額 < $5 想定 | AWS S3 / Supabase Storage / Vercel Blob | R2 障害時 → S3 互換なので AWS S3 へ即時切り替え可能（DSN だけ差し替え）|
| アップロード方式 | Pre-signed URL (PUT) | - | 同上 | クライアントから直接 R2 へアップロード、Web サーバ負荷を抑制 | - | URL 期限 15 分、サイズ上限はサーバで返却前にバリデート |
| サムネイル生成 (Phase 2) | sharp + ジョブキュー | `sharp ^0.33` | F-028（写真添付） | アップロード後に worker でリサイズ。MVP は原寸のみ | - | - |

### 4.7 UI 拡張

| 領域 | 採用 | バージョン | 対応機能 | 理由詳細 |
|---|---|---|---|---|
| グラフ | Recharts | `recharts ^2.13` | F-048, F-051, F-056 | 提案書 §14 推奨。shadcn/ui の Chart コンポーネントも Recharts ベース。MVP 範囲（時系列・棒・ランキング）に十分 |
| ダッシュボード UI 部品 | shadcn/ui の Chart + 自前 | - | F-056 | Tremor は高機能だが Tailwind 設定衝突あり → MVP は採用見送り |
| 通知トースト | sonner | `sonner ^1.7` | F-052（インスタント表示） | shadcn/ui 推奨、軽量 |
| モーダル・ドロワー | shadcn/ui (`Dialog`, `Sheet`) | - | 全画面 | スマホで Sheet、PC で Dialog の出し分け |
| カレンダー | react-day-picker | `react-day-picker ^9` | F-021, F-025, F-018 | shadcn/ui `Calendar` の中身。日付選択・期間選択 |
| 表データ仮想化 | TanStack Virtual | `@tanstack/react-virtual ^3` | F-032（顧客一覧、Phase 2 大量データ） | MVP では未導入で OK、Phase 2 で追加検討 |

### 4.8 CSV インポート / エクスポート（Phase 2 / 部分 MVP）

| 領域 | 採用 | バージョン | 対応機能 | 理由詳細 |
|---|---|---|---|---|
| CSV パース | Papa Parse | `papaparse ^5.4` | F-057 (Phase 2), F-032 export | ブラウザ + Node 両対応、ストリーミングパース対応。大規模ファイルでも安定 |
| CSV 生成 | 自前（テンプレート文字列で十分）または `csv-stringify` | - | F-032 のエクスポート（Phase 2） | MVP では未実装。`wholesaler_admin` のみ許可（Assumption 15） |

### 4.9 監査ログ (F-055)

| 領域 | 採用 | 対応機能 | 理由詳細 |
|---|---|---|---|
| 記録方式 | 専用テーブル `audit_logs` + Prisma extension で自動記録 | F-055 | 主要 mutation Server Action の冒頭/末尾で `recordAudit(actor, action, target, before, after)` を呼ぶ。`before`/`after` は JSON カラム |
| DB trigger は採用しない | - | - | アプリ層で actor (user_id) を取りやすい、テスト容易。trigger は user 情報を取りにくい |
| ログ保持 | DB 3 年（docs/02 §5.7 仮置き）、それ以後 R2 へアーカイブ | F-055 | 3 年経過は worker の月次ジョブでパーティション切替 or R2 へ COPY |

### 4.10 マイグレーション

| 領域 | 採用 | 理由詳細 |
|---|---|---|
| ツール | Prisma Migrate | スキーマと一体、CI から `prisma migrate deploy` で本番適用、開発は `prisma migrate dev` |
| 競合（不採用） | Atlas / Sqitch / 手書き SQL | Prisma スキーマと二重管理になる |
| 大規模変更 | `--create-only` で SQL を手動補正後 commit | RLS ポリシー追加 / 既存データ移行は手動 SQL を migration 内に書く |
| シード | `prisma db seed` + 自前スクリプト | パイロット投入の手作業データを TS 関数化、開発環境では `pnpm db:seed` で再現可能 |

### 4.11 ロガー / エラートラッキング / 観測性

| 領域 | 採用 | バージョン | 対応機能 | 理由詳細 |
|---|---|---|---|---|
| ログ | pino | `pino ^9` | docs/02 §5.4 | 構造化 JSON、Next.js Edge も部分対応。Request ID を AsyncLocalStorage で横断 |
| エラートラッキング | Sentry | `@sentry/nextjs ^8` | docs/02 §5.4 | 5xx + ジョブ失敗を補足、リリーストラッキング |
| 外形監視 | Better Uptime（旧 betterstack） または UptimeRobot | - | docs/02 §5.4 (アップタイム) | 業務時間帯 8:00–22:00 を重点監視。MVP は無料 UptimeRobot で開始 |
| メトリクス | Railway built-in + Sentry Performance | - | - | MVP では Datadog / Prometheus は導入しない（コスト）|
| ログ集約 | Railway logs（短期）+ Sentry Logs（90 日）| - | - | Phase 2 で Logflare / BetterStack Logs 検討 |

---

## 5. 代替案と選定理由（主要トピック）

### 5.1 認証: Auth.js v5 vs Clerk vs Supabase Auth vs Lucia

| 選択肢 | 採用判定 | 理由 |
|---|---|---|
| **Auth.js v5（採用）** | ◎ | Credentials Provider + 自前テーブルでマルチテナント・招待・スコープ切替を細かく制御可。OSS、月額 0 円。MVP の柔軟性が最重要 |
| Clerk | ✕ | 美しいが月額 $25〜 + ユーザー数課金、招待 / 多対多テナント / 自前ロールへの適合が薄い。ベンダーロックイン |
| Supabase Auth | ✕ | Supabase の他機能 (DB / Storage) と組み合わせるなら強力だが、本プロジェクトは Railway + Prisma で完結させたい。Supabase Auth 単体使用はメリット小 |
| Lucia | ✕ | 2024 年に開発終了アナウンス（保守モード）。新規採用は非推奨 |

### 5.2 ジョブ: graphile-worker vs Inngest vs BullMQ vs Vercel Cron

§4.5 で詳述。**graphile-worker** を継続採用（Redis 不要 / Postgres 一本化 / CLAUDE.md 確定）。

### 5.3 メール: Resend vs SendGrid vs SES vs Postmark

| 選択肢 | 採用判定 | 理由 |
|---|---|---|
| **Resend（採用）** | ◎ | DX 最良、React Email 公式統合、無料枠 3,000/月、Pro $20/月で 50,000 通。MVP のメール量（数百〜数千通/月）で無料運用可能 |
| AWS SES | △ | $0.10/1,000 通で最安だが、サンドボックス申請・バウンス処理を SNS で自作する必要があり、MVP 期間で割に合わない。Phase 3+ で >100K 通になれば移行検討 |
| SendGrid | ✕ | 無料枠廃止 (2025/5)、$19.95/月で 50K 通、DX が古い |
| Postmark | △ | 信頼性高いが $15/月から、Resend と比べ React Email 統合なし |

### 5.4 ストレージ: R2 vs S3 vs Supabase Storage

| 選択肢 | 採用判定 | 理由 |
|---|---|---|
| **Cloudflare R2（採用）** | ◎ | エグレス無料が最大の利点。契約書ダウンロード時のコストを抑制。S3 SDK 互換で移行容易 |
| AWS S3 | △ | エグレス課金あり。Phase 4 で AWS 統一する場合は再評価 |
| Supabase Storage | ✕ | Supabase 全体を導入するなら良いが、本プロジェクトは Prisma + Railway 構成 |
| Vercel Blob | ✕ | Vercel ホスティングでないため不採用 |

### 5.5 マルチテナント分離方式

| 選択肢 | 採用判定 | 理由 |
|---|---|---|
| **アプリ層 (Prisma extension) + DB RLS（採用）** | ◎ | 二重防御。アプリミスでもデータ漏洩を防げる |
| アプリ層のみ | ✕ | Defense in Depth が崩れる |
| RLS のみ | △ | Prisma との相性で意図しない 0 件返却が発生しうる |
| テナント別 schema / DB | ✕ | パイロット 1 社規模では過剰、運用負荷大。Phase 4+ で大規模 enterprise tenant が出てきた際に検討 |

---

## 6. 非機能要件への対応

docs/02 §5 の非機能要件を各技術にマッピングする。

| 非機能要件 | 担保する技術 / 仕組み |
|---|---|
| 性能（一覧 < 800ms, 詳細 < 500ms）docs/02 §5.1 | Prisma クエリの index 設計（`wholesaler_id, created_at` 複合）、ページネーション、Next.js キャッシュ |
| 月次集計 < 5 秒（100 二次店 / 1,000 契約）docs/02 §5.1 | graphile-worker による事前集計 + `monthly_reports` スナップショット、必要に応じ raw SQL |
| 可用性 99.5% 業務時間帯 docs/02 §5.2 | Railway の冗長性 + 外形監視 + Sentry アラート |
| RTO 4 時間 / RPO 24 時間 docs/02 §5.2 | Railway 日次自動バックアップ + 手動スナップショット運用手順 |
| パスワード hash docs/02 §5.3 | argon2id |
| HTTPS 必須 / CSP / CSRF | Next.js デフォルト + `next.config.js` の `headers()` で CSP、Auth.js v5 の CSRF 対策 |
| 失敗ロック 5 回 / 15 分 docs/02 §5.3 | `login_attempts` テーブル + Server Action でカウント |
| テナント分離 docs/02 §4.8, §5.3 | Prisma extension + PostgreSQL RLS |
| 仕入値非表示 docs/02 §5.3 | Prisma select omit + DTO 変換 |
| 個人情報マスキング | API レイヤの `maskPhone` / `maskAddress` |
| 監査ログ追記専用 docs/02 §5.4 | `audit_logs` テーブル INSERT 専用、RLS で UPDATE/DELETE 不可（`saas_admin` 除く） |
| ログ 5xx > 1% アラート | Sentry alerts |
| アクセシビリティ WCAG 2.1 AA docs/02 §5.6 | shadcn/ui (Radix UI) ベース、Playwright で `@axe-core/playwright` を Phase 2 で導入 |
| データ保持（監査ログ 3 年 / 契約 7 年）docs/02 §5.7 | 月次パーティション + R2 アーカイブ |
| バックアップ docs/02 §5.7 | Railway 自動 + 別リージョンへの定期コピー（Phase 2） |

---

## 7. 環境変数一覧（暫定）

```dotenv
# ===== Core =====
NODE_ENV=production
DATABASE_URL=postgresql://...                # Railway 注入
DIRECT_URL=postgresql://...                  # Prisma migrate 用（コネクションプール回避）
NEXT_PUBLIC_APP_URL=https://app.example.com

# ===== Auth.js v5 =====
AUTH_SECRET=<openssl rand -base64 32>
AUTH_TRUST_HOST=true                          # Railway proxy 対応
AUTH_URL=https://app.example.com
AUTH_SESSION_MAX_AGE_SEC=86400               # 24h（docs/02 §5.3）

# ===== Password / 2FA =====
TOTP_ISSUER="Solar SaaS"

# ===== Email =====
RESEND_API_KEY=re_xxx
EMAIL_FROM="Solar SaaS <noreply@example.com>"
EMAIL_REPLY_TO="support@example.com"

# ===== Storage =====
R2_ACCOUNT_ID=xxx
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
R2_BUCKET=solar-saas-prod
R2_PUBLIC_BASE_URL=https://files.example.com  # CDN 経由なら設定

# ===== Worker =====
WORKER_CONCURRENCY=5
WORKER_POLL_INTERVAL_MS=2000

# ===== Observability =====
SENTRY_DSN=https://...
SENTRY_ENVIRONMENT=production
LOG_LEVEL=info

# ===== Feature flags =====
FEATURE_LINE_NOTIFICATIONS=false              # Phase 2 で有効化
FEATURE_CSV_IMPORT=false                      # Phase 2 で有効化

# ===== Phase 2: LINE =====
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
```

**注意**: A2P 由来の `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `AUTH_PASSWORD`（単一ユーザー env パスワード）は **本プロジェクトでは未使用**。`.env.example` から除外する。

---

## 8. 環境構成

### 8.1 ローカル開発

| 項目 | 値 |
|---|---|
| Postgres | Docker Compose（`postgres:16-alpine`）または Railway dev DB |
| Worker | `pnpm dev:worker`（`apps/worker`） |
| Web | `pnpm dev`（`apps/web`） |
| Resend | テストモード（実送信なし、ダッシュボードで確認） |
| R2 | 開発用バケット（別途）または LocalStack S3 |
| Seed | `pnpm db:seed`（パイロット卸業者 1 社 + ダミー二次店 3 社） |

### 8.2 ステージング (`stg`)

- Railway 別プロジェクト or 別環境。Production と同構成、データは別。
- パイロット卸業者の検証用テナントを 1 つ常駐。
- Sentry プロジェクト分離 (`solar-saas-stg`)。

### 8.3 本番 (`prod`)

- Railway Production プロジェクト。
- Web 1 サービス（autoscale: 1〜3 インスタンス）。
- Worker 1 サービス（固定 1 インスタンス、MVP 規模）。
- Postgres: Railway Pro プラン推奨（バックアップ daily + コネクション上限）。
- Custom domain + Cloudflare 経由（CDN・WAF）。

### 8.4 リポジトリ構成（提案）

提案書 §15 と CLAUDE.md ターゲット構成を融合：

```text
solar-saas/
  apps/
    web/                       # Next.js 15 (App Router)
      app/
      components/
      lib/
        auth/                  # Auth.js v5 設定、TOTP、招待
        permissions/           # ロール × アクション ガード
        tenancy/               # Prisma extension + RLS context
        masking/               # maskPhone / maskAddress
        validators/            # Zod schemas (shared)
        commission/            # F-046 計算ロジック
        gross-profit/          # F-042 計算ロジック
        monthly-report/        # F-048 集計
      tests/                   # Vitest unit / integration
    worker/                    # graphile-worker
      jobs/
        send-email.ts
        monthly-aggregate.ts
        line-dispatch.ts        # Phase 2
  packages/
    db/                        # Prisma schema + client
      prisma/
        schema.prisma
        migrations/
        seed.ts
    contracts/                 # 共有 TypeScript 型 (Zod schemas)
    storage/                   # R2 クライアント抽象
    email/                     # React Email テンプレート + Resend client
  tests/
    e2e/                       # Playwright
  docs/                        # 本書を含む設計成果物
```

CLAUDE.md の `packages/agents/` は **本プロジェクトでは作成しない**（AI 不要）。

---

## 9. CI/CD・観測性

### 9.1 CI (GitHub Actions)

```yaml
# 概要
on: [push, pull_request]
jobs:
  - typecheck         # tsc --noEmit
  - lint              # eslint + prettier --check
  - unit              # pnpm test (vitest)
  - e2e               # pnpm test:e2e (playwright) — main へのマージ前のみ
  - prisma-validate   # prisma validate / migrate diff
  - build             # next build
```

### 9.2 CD

- main ブランチへのマージ → Railway 自動デプロイ（Web / Worker 両方）。
- DB migration: デプロイ起動時に `prisma migrate deploy`（Railway の `releaseCommand`）。
- ロールバック: Railway UI から前バージョン即時切替。

### 9.3 観測性

- **Sentry**: フロント + サーバ + worker、リリースタグ付き。
- **構造化ログ (pino)**: Railway logs → 短期保管。長期は Phase 2 で BetterStack へ。
- **外形監視**: UptimeRobot（無料、5 分間隔）→ Phase 2 で Better Uptime に。
- **業務 KPI**: `metrics` テーブルに日次バッチで書き込み、Recharts でダッシュボード化（F-056）。

---

## 10. Phase 別の導入計画

### 10.1 Phase 1 (MVP, 〜2 か月) で導入

- Next.js 15 / TypeScript / Prisma 6 / PostgreSQL 16
- Auth.js v5 + argon2 + otpauth (TOTP)
- shadcn/ui + Tailwind + Recharts
- Resend + React Email
- Cloudflare R2 (S3 SDK)
- graphile-worker（月次集計、メール再試行）
- Sentry + pino + UptimeRobot
- Vitest + Playwright
- Railway (Web + Worker + Postgres)

### 10.2 Phase 2（〜6 か月）で導入

- LINE Messaging API 連携（F-054）
- CSV インポート（F-057、Papa Parse）
- BI 強化（F-056 / F-058 一部）
- 高度な通知配信メトリクス
- PWA 化（manifest + service worker）
- Better Uptime / BetterStack Logs
- Sharp + 画像サムネイル

### 10.3 Phase 3 以降

- 施工業者向け簡易画面
- 補助金申請の API 連携（あれば）
- 外部 BI 連携（Metabase / Looker Studio）

### 10.4 Phase 4 以降

- 課金: Stripe / Paddle 統合
- 請求書 PDF 出力（`@react-pdf/renderer` か `pdfme`）
- マルチクラウド対応（AWS / GCP）

---

## 11. コスト見積もり（概算、月額）

パイロット 1 社運用時 (MAU ~50, contracts ~50/月)：

| 項目 | プラン | 月額 USD | 備考 |
|---|---|---|---|
| Railway Web + Worker + Postgres | Hobby → Pro | $5 → $20 | Pro 推奨（バックアップ・接続数） |
| Cloudflare R2 | 従量 | < $1 | ストレージ < 10GB、エグレス無料 |
| Resend | Free → Pro | $0 → $20 | 3,000 通/月までは無料 |
| Sentry | Developer | $0 | 5K errors / 10K transactions/月 |
| UptimeRobot | Free | $0 | 50 monitors / 5min interval |
| ドメイン (Cloudflare) | - | $1 | ($12/年) |
| **小計（MVP 開始）** | - | **~$10–$25** | パイロット 1 社 |

5〜10 社展開時 (Phase 2)：

| 項目 | プラン | 月額 USD |
|---|---|---|
| Railway Pro（複数インスタンス）| Pro | $40–$80 |
| Postgres Pro (Higher tier) | Pro | $20 |
| R2 | 従量 | $5 |
| Resend | Pro | $20 |
| Sentry | Team | $26 |
| LINE Messaging API | 従量 | $0–$30 |
| Better Uptime | Basic | $18 |
| **小計** | - | **~$130–$200** |

注: 太陽光卸業者の月額 SaaS 価格設定（Open Q5）次第で十分黒字運用可能なレンジ。

---

## 12. 将来の置き換え可能性

| 置き換え対象 | 置き換え先候補 | 容易さ | トリガー |
|---|---|---|---|
| graphile-worker | BullMQ + Redis / Inngest / Trigger.dev | 中（ジョブ関数を抽象化済みなら容易）| 月次集計 > 5 秒、Phase 2 大規模化 |
| Resend | AWS SES / Postmark | 易（SMTP 抽象化 or `email/send.ts` を差し替え）| メール > 50,000 通/月 |
| Cloudflare R2 | AWS S3 | 極易（S3 SDK 互換、DSN 差し替えのみ）| AWS 統一 / 東京リージョン要件 |
| Railway | AWS App Runner / GCP Cloud Run / Fly.io | 中（Dockerfile 化必須、Postgres も別途）| エンタープライズ要件 / 東京リージョン |
| Auth.js v5 | WorkOS / Clerk | 難（自前テナント設計を移植）| SSO / SAML / SOC2 要件 |
| Prisma | Drizzle / Kysely | 難（スキーマ・マイグレーション再構築）| パフォーマンス問題 / Prisma 廃止リスク（低）|
| Recharts | Tremor / Visx / D3 | 中（チャート画面のみの局所変更）| 高度な BI / インタラクション要件 |
| shadcn/ui | MUI / Mantine | 高負荷（全 UI 書き換え）| デザインシステム刷新時 |

---

## 13. Assumptions

1. **Node 22 LTS が Railway で利用可能**（2026 年 5 月時点で利用可能）。利用不可なら Node 20 LTS にフォールバック。
2. **Auth.js v5 (beta) は本番投入可能**。コミュニティ採用事例多数、API は事実上凍結済み。安定版リリース待ちのリスクを許容。
3. **Prisma 6 で Multi-Schema は使わない**。テナント分離は単一 schema 内の `wholesaler_id` 列 + RLS で行う。
4. **Cloudflare R2 は契約書ファイルの法定保管（7 年）要件を満たす**。ライフサイクルルールでアーカイブクラスへ移行可能か Phase 2 で確認。
5. **Resend 無料枠（3,000 通/月）は MVP のメール量に十分**。F-052/F-053 の主要通知が 1 卸業者で月 500〜1,500 通想定。
6. **Sentry 無料枠は MVP 期間中の運用に十分**。
7. **Railway の SLA はパイロット要件（99.5% / 業務時間帯）を満たす**。実績モニタリングは Phase 2 で。
8. **Server Action は内部 API 代替として十分**。外部公開 API は MVP 不要（モバイルネイティブアプリなし）。
9. **二次店ユーザーの「現在の卸業者コンテキスト」はセッションに保持**（複数卸業者と関係を持つ場合、ログイン直後に選択 UI）。Cookie + JWT claim に格納。
10. **TOTP のクロックドリフト許容 ±1 ステップ (30 秒)**。`otpauth` のデフォルト挙動。

---

## 14. Open Questions（後段エージェントで詰める）

1. **RLS と pgBouncer の運用方式**: `SET LOCAL` を毎リクエスト発行する戦略は `transaction mode` の pgBouncer と相性が悪い。Railway のコネクションプール設定を `session mode` にするか、Prisma の `directUrl` で直結するか → `program-design` で確定。
2. **Auth.js v5 の安定版リリース時期**: beta のまま MVP 投入する場合、メジャー API 変更時の追従コスト想定。
3. **Resend のドメイン**: パイロット卸業者ごとに `From` を変えるか、共通の `noreply@solar-saas.app` か。マルチテナント SaaS としてはサブアドレス（`noreply+wholesaler123@...`）方式も検討。
4. **R2 リージョン選択**: 自動 (Auto) vs APAC 固定。バックアップ整合性とアクセス性能のバランス。
5. **graphile-worker の crontab vs Railway Cron Service**: 月次バッチを `crontab` で定義するか、Railway の Cron トリガで Server Action を呼ぶか → 後者は冪等性確保が必要。
6. **Sentry の PII フィルタ**: 個人情報マスキング（§4.3）と整合させるため、Sentry の `beforeSend` で電話・住所を匿名化する設定を要決定。
7. **LINE Messaging API のテナント設計（Phase 2）**: 共通 LINE 公式アカウントから配信 vs 卸業者ごと自前アカウント連携。
8. **CSP の strict 化**: shadcn/ui のインライン style を許容するか、`nonce` ベースで運用するか。
9. **負荷試験の SLA**: docs/02 §5.1 の数値を MVP 末期に k6 / Artillery で検証する想定。実施時期未定。
10. **Stripe / Paddle 等の課金連携**: Phase 4 で必要。プラン定義 (Open Q5) 確定後にロードマップ化。

---

## 15. 機能 ID → 採用技術の対応マトリクス（抜粋）

主要機能と「どの技術で実現するか」のサマリ。詳細は §4 の各表。

| 機能 ID | 主要技術 |
|---|---|
| F-001 サインイン | Auth.js v5 + argon2 + Server Action |
| F-002 2FA | otpauth + qrcode + DB `users.totp_secret` |
| F-003 パスワードリセット | Resend + React Email + 30 分有効トークン |
| F-004 / F-006 / F-007 招待 | 自前テーブル + Resend + Auth.js v5 |
| F-009 関係管理 | Prisma + RLS + Prisma extension |
| F-011〜F-014 マスタ | Prisma CRUD + Zod + react-hook-form |
| F-012 価格履歴 | Prisma（effective_from/to）+ index |
| F-017〜F-024 イベント候補 / 希望収集 | Next.js Server Action + Prisma + sonner（通知トースト）|
| F-025 シフト | Prisma + DB 制約（同一 user × 重複時間帯）|
| F-028〜F-030 報告 | Server Action + R2 pre-signed URL + sharp (Phase 2) |
| F-031 顧客登録 | Server Action + Zod + マスキングユーティリティ |
| F-040〜F-042 契約・粗利 | Prisma transaction + 計算ロジックを `lib/commission.ts` `lib/gross-profit.ts` に集約 |
| F-043 キャンセル | Prisma transaction + 監査ログ + graphile-worker（負調整反映）|
| F-046 インセンティブ | Prisma + 計算ロジック + worker（バッチ再計算）|
| F-048 月次集計 | graphile-worker crontab + raw SQL + `monthly_reports` スナップショット |
| F-052 アプリ内通知 | Prisma + sonner（トースト）+ ベル UI（自前 Server Component）|
| F-053 メール | Resend + React Email + graphile-worker 再試行 |
| F-054 LINE (Phase 2) | `@line/bot-sdk` + graphile-worker |
| F-055 監査ログ | `audit_logs` テーブル + Prisma extension + マスキング |
| F-056 BI | Recharts + `monthly_reports` 集計 |
| F-057 CSV (Phase 2) | Papa Parse + graphile-worker（大量取込時） |

---

## 16. 後続エージェントへの申し送り

- **`ui-design`** へ: 本書 §2.3 / §4.7 で確定した UI コンポーネント群（shadcn/ui + Tailwind + Recharts + react-hook-form + react-day-picker + sonner）を前提に画面を組むこと。スマホ最優先フロー（F-026 / F-028〜F-030 / F-031 / F-033 / F-037 / F-049）は `Sheet` コンポーネントを基本に。
- **`program-design`** へ:
  - テナント分離は **Prisma Client extension（アプリ層） + PostgreSQL RLS（DB 層）の二重防御**。`SET LOCAL app.current_wholesaler_id` の発行タイミングと pgBouncer 設定を詰めること（§14 Open Q1）。
  - Auth.js v5 + 自前テーブル設計（users / sessions / totp_secrets / backup_codes / invitations / login_attempts）を §4.1 に基づき詳細化。
  - graphile-worker のジョブ一覧と冪等性キー設計を §4.5 に基づき詰める。
  - 計算ロジック (`commission` / `gross-profit` / `monthly-aggregate`) は純関数として `packages/contracts` 配下に置き、Server Action と worker の双方から呼び出せる構造に。
- **`pm`** へ:
  - スプリント分割では「Auth + テナント基盤」を Sprint 1 に固める。RLS + 招待 + 2FA は最初の 2 週間で完成させないと後段が並列化できない。
  - graphile-worker・Sentry・Resend のセットアップは Sprint 1 の Foundation タスクに含める。

---

## 17. 変更履歴

| 日付 | 変更内容 | 変更者 |
|---|---|---|
| 2026-05-23 (初版) | 業務要件 v2 / 機能要件 v1 を反映した初版作成。CLAUDE.md の A2P 固有スタックを本プロジェクト向けに読み替え、Auth.js v5 + Prisma RLS 二重防御 + graphile-worker + Resend + R2 で MVP 構成を確定 | tech-selection |
