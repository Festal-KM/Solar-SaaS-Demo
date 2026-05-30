# Solar SaaS — 太陽光卸・二次店営業管理 SaaS

太陽光パネルの卸業者と、その営業活動を担う二次店事業者が共同で利用する**マルチテナント SaaS**。
催事営業を主軸に、場所提供元との交渉 → イベント候補管理 → 二次店希望提出 → 開催体制決定 → 自社要員シフト → 顧客・アポ → マエカク → 商談・クロージング → 契約 → 粗利・インセンティブ確定 → 月次クローズまでを一気通貫で扱う。

詳細：[`docs/01-business-requirements.md`](docs/01-business-requirements.md) / [`docs/02-functional-requirements.md`](docs/02-functional-requirements.md) / [`docs/03-tech-selection.md`](docs/03-tech-selection.md) / [`docs/05-program-design.md`](docs/05-program-design.md)。

---

## 技術スタック

- **Framework**: Next.js 15 (App Router) + TypeScript 5 strict
- **DB**: PostgreSQL 16 + Prisma 6（テナント分離は Prisma extension + RLS の二重防御）
- **Auth**: Auth.js v5 + argon2id + TOTP 2FA + パスワードリセット + 招待
- **Job queue**: graphile-worker（PG-backed）
- **Storage**: Cloudflare R2（pre-signed URL）
- **Email**: Resend + React Email（dev は stub fallback）
- **UI**: Tailwind + shadcn/ui + react-hook-form + Zod
- **Observability**: Sentry + pino
- **Testing**: Vitest（ユニット・統合）, Playwright（E2E）
- **Hosting**: Railway（Web + Worker + Postgres）

モノレポ（pnpm workspace）：

```
apps/web/          Next.js
apps/worker/       graphile-worker 常駐プロセス
packages/db/       Prisma schema + RLS + withTenant
packages/auth/     Auth.js + argon2 + TOTP
packages/contracts/Zod schemas / DTO / 純関数サービス
packages/storage/  R2 (S3 互換) クライアント
packages/email/    Resend + メールテンプレート
```

---

## ローカル開発セットアップ

### 前提

- Node.js 20+, pnpm 9+, Docker Desktop（Postgres コンテナ用）

### 手順

```bash
# 1. 依存インストール
pnpm install

# 2. .env.local を作成（.env.example を参考に）
cp .env.example .env.local
cp .env.example apps/web/.env.local

# 3. Postgres を起動（Docker Compose）
docker compose up -d db

# 4. マイグレーション + シード
pnpm --filter @solar/db exec prisma migrate deploy
pnpm --filter @solar/db db:seed

# 5. dev サーバー起動
pnpm --filter @solar/web dev
```

`http://localhost:3000` を開く。

### テスト

```bash
pnpm --filter @solar/web exec tsc --noEmit                 # 型チェック
pnpm --filter @solar/web exec vitest run                   # ユニット/統合
pnpm --filter @solar/web exec playwright test              # E2E（要 dev 起動中）
```

---

## デモアカウント（シード投入）

シードを実行すると以下のアカウントが作成されます（パスワードは共通の `SEED_PILOT_PASSWORD` 環境変数で上書き可能。デフォルト `Pilot!2026` は **dev 専用** — 本番では必ず上書きしてください）。

| ロール | メール |
|---|---|
| 卸業者管理者 | `wholesaler_admin@solar-saas.dev` |
| 卸業者イベントチーム | `wholesaler_event_team@solar-saas.dev` |
| 卸業者コール | `wholesaler_call_team@solar-saas.dev` |
| 二次店アルファ管理者 | `dealer_admin_alpha@solar-saas.dev` |
| 二次店ベータ管理者 | `dealer_admin_beta@solar-saas.dev` |
| 二次店ガンマ管理者 | `dealer_admin_gamma@solar-saas.dev` |
| SaaS 運営者 | `saas_admin@solar-saas.dev` |

サンプルデータ：パイロット卸 1 社、二次店 3 社、顧客 12 件（商談・契約・施工・申請をバラエティ豊かに）、商談履歴・タスク・関連ファイル、手数料率設定（3 二次店 × 履歴 2 件）が seed 済み。

---

## 本番デプロイ（Railway 想定）

### 環境変数（必須）

| 変数 | 用途 |
|---|---|
| `DATABASE_URL`, `DATABASE_URL_DIRECT` | Railway Postgres |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | Auth.js |
| `SEED_PILOT_PASSWORD` | **本番では必ず強固な値で上書き** |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` | Cloudflare R2（未設定だと商談履歴の関連ファイル添付がエラー） |
| `RESEND_API_KEY` | Resend（未設定だとパスワードリセット・招待メールが届かない） |
| `SENTRY_DSN` | Sentry（任意） |
| `LOG_LEVEL` | pino。本番は `info` 推奨 |

### コマンド

```bash
pnpm install --frozen-lockfile
pnpm --filter @solar/db exec prisma migrate deploy
pnpm --filter @solar/db db:seed   # 初回のみ
pnpm --filter @solar/web build
pnpm --filter @solar/web start
```

ワーカーは別サービスとして `pnpm --filter @solar/worker start`。

---

## デモ版のリリース状態（既知の制約）

### 動作する画面

- ホーム（ダッシュボード）
- イベント管理：レーンイベント一覧 / 単発イベント一覧 / 二次店希望一覧
- 顧客管理：顧客一覧 / 詳細（基本情報・各種ステータス編集・メモ編集・商談履歴新規記録・関連ファイル・タスク）
- 手数料管理：手数料一覧（**サンプルデータ**） / 手数料設定（実データ・保存・履歴）

### 「準備中」画面（後続対応）

- アポイント一覧 / 契約一覧 / 施工一覧 / 申請一覧 / 場所取り対応状況
- BIツール（ダッシュボード / 市況分析）
- 設定：マスタ管理 / メンバー管理 / 取引先管理 / 監査ログ

### 未永続化・既知の制約

- **手数料一覧**：サンプルデータ。一括ステータス設定・調整項目はクライアント側のみ（リロードで消える）。実データ化は後続
- **関連ファイル添付**：R2 認証情報の本番値が必要
- **email 系**：Resend 未設定だと stub fallback（パスワードリセット・招待が届かない）

---

## ハーネス（開発時の自動化）

本リポジトリは Claude Code subagent ハーネスで設計→実装→レビューを自動化しています。詳細は [`CLAUDE.md`](CLAUDE.md) 参照。

---

## License

Proprietary — Festal-KM. All rights reserved.
