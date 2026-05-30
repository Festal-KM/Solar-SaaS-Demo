# Solar SaaS — Demo Release Runbook

このドキュメントはデモ版を Railway へデプロイするための手順書です。

---

## 検証済みの状態（本ドキュメント作成時点）

- ✅ 本番ビルド成功 (`pnpm -w run build`)
- ✅ 全パッケージ TSC pass
- ✅ 全テスト 588 件 pass（auth 28 / db 90 / storage 14 / email 21 / web 435）
- ✅ `next start` で本番サーバー起動確認、`/api/health` 応答確認
- ✅ GitHub: `https://github.com/Festal-KM/Solar-SaaS-Demo` に main ブランチで push 済み

---

## 1. 残作業（要対話: 自分でやってください）

### A. Railway 認証

```bash
railway login
```
→ ブラウザが開いて認証。

### B. Railway プロジェクト作成 & GitHub 連携

1. Railway ダッシュボード ([railway.app](https://railway.app)) で **New Project** → **Deploy from GitHub repo** → `Festal-KM/Solar-SaaS-Demo` を選択。
2. プロジェクト名を `solar-saas-demo` 等に設定。

### C. Postgres プラグイン追加

1. プロジェクトで **+ New** → **Database** → **PostgreSQL** を追加。
2. Railway が自動で `DATABASE_URL` を Postgres サービスに設定する。

### D. Web service の作成・設定

1. Railway がリポジトリから自動的に Web service を作成。
2. **Settings → Variables** に下記を追加：

| 変数 | 値 |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}`（Railway 参照変数） |
| `DATABASE_URL_DIRECT` | 同上 |
| `NEXTAUTH_URL` | デプロイ後の URL（例 `https://solar-saas-demo.up.railway.app`） |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` で生成した強い乱数 |
| `SEED_PILOT_PASSWORD` | 本番用の強いパスワード（**必ず変更**） |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` | Cloudflare R2（未設定でも起動可、商談履歴の関連ファイル添付は使用不可） |
| `RESEND_API_KEY` | Resend API キー（未設定だとパスワードリセット・招待メールは stub） |
| `SENTRY_DSN` | （任意）Sentry プロジェクト DSN |
| `LOG_LEVEL` | `info` |
| `NODE_ENV` | `production`（Railway がデフォルト設定） |

3. **Settings → Service Settings**：
   - **Start Command**: `pnpm --filter @solar/web start`
   - **Healthcheck Path**: `/api/health`
   - **Build**: `railway.toml` を使用（buildCommand = `pnpm install --frozen-lockfile && pnpm -w run build`）

4. **Release Command**（重要）：マイグレーションをデプロイ前に流す。
   ```bash
   pnpm --filter @solar/db exec prisma migrate deploy
   ```
   Railway dashboard の Web service → Settings → Release Command で設定。

### E. Worker service の作成・設定

1. **+ New** → **GitHub Repo** → 同じリポジトリを再度追加（2つめのサービス）。
2. **Service Settings → Start Command**: `pnpm --filter @solar/worker start`
3. 環境変数は Web と同じ `DATABASE_URL` のほか、worker 固有の `WORKER_CONCURRENCY`、`WORKER_POLL_INTERVAL_MS` を任意で追加。
4. Healthcheck は不要（HTTP listener なし）。

### F. デモシード投入（初回のみ）

Railway dashboard か CLI から Web service の shell を開いて：

```bash
pnpm --filter @solar/db db:seed
```

完了するとパイロット卸 1 社、二次店 3 社、各ロールユーザー、サンプル顧客 12 件などが投入される。**`SEED_PILOT_PASSWORD` の値が全アカウントのパスワードになる**ので、本番用に強い値を設定してから実行すること。

---

## 2. デプロイ後の動作確認

### スモークチェック

| 項目 | 確認方法 |
|---|---|
| Health | `https://<your-domain>/api/health` が 200 |
| ログイン | `wholesaler_admin@solar-saas.dev` + 設定した `SEED_PILOT_PASSWORD` でログインできる |
| 顧客一覧表示 | `/customers` でサンプル12件が表示される |
| 顧客詳細 → 新規記録 | ポップアップから商談履歴を追加できる（保存後、スレッドに表示される） |
| 手数料設定 | `/commissions/settings` で率を変更 → 保存 → 履歴が増える |
| 手数料一覧 | `/commissions` でサンプル表示（バルク設定・調整項目はリロードで消える点に注意） |

### 2FA について

スキーマ上 `WHOLESALER_ADMIN` / `SAAS_ADMIN` は `twoFactorRequired=true`。初回ログイン時に MFA セットアップを通すか、デモ用途で一時的に緩和するかは要判断。

---

## 3. デモ参加者向け案内（コピペ用テンプレ）

> **Solar SaaS デモ版へようこそ**
>
> URL: `https://<your-domain>/`
>
> **動作する画面**:
> - ホーム / イベント管理（レーンイベント一覧・単発イベント一覧・二次店希望一覧）
> - 顧客管理（一覧・詳細編集・商談履歴新規記録・関連ファイル・タスク）
> - 手数料管理（一覧 = サンプル表示、設定 = 実データ保存・履歴）
>
> **「準備中」表示の画面**（後続対応）:
> - アポイント一覧 / 契約一覧 / 施工一覧 / 申請一覧 / 場所取り対応状況
> - BIツール（ダッシュボード／市況分析）
> - 設定配下（マスタ管理／メンバー管理／取引先管理／監査ログ）
>
> **既知の制約**:
> - 手数料一覧の「一括設定」「調整項目」はサンプルデータでクライアント側のみ動作（リロードで消えます）
> - 商談履歴の「関連ファイル添付」は R2 認証情報が必要（未設定だとエラー）
> - メール送信（パスワードリセット等）は Resend が必要
>
> **デモアカウント**（パスワードは別途共有）:
> - 卸業者管理者: `wholesaler_admin@solar-saas.dev`
> - 卸業者イベントチーム: `wholesaler_event_team@solar-saas.dev`
> - 二次店アルファ管理者: `dealer_admin_alpha@solar-saas.dev`
> - SaaS 運営者: `saas_admin@solar-saas.dev`
>
> **フィードバック**: （連絡先を記載）

---

## 4. トラブルシューティング

| 症状 | 対処 |
|---|---|
| ログイン後に 404 / 500 | `/api/health` が 200 か確認 → DB マイグレーション未適用の可能性。Release Command を再確認 |
| `/customers` が空 | シード未投入。Web shell から `pnpm --filter @solar/db db:seed` |
| 商談履歴の「関連ファイル」アップロード時にエラー | R2 認証情報未設定。`R2_*` 環境変数を確認 |
| パスワードリセットメールが届かない | `RESEND_API_KEY` 未設定。設定して Web service を再デプロイ |
| 2FA で詰まる | `wholesaler_admin` 等は初回ログイン時に TOTP 設定が必要。スマホ TOTP アプリ（Google Authenticator 等）を用意 |

---

## 5. 次のフェーズに向けて

このデモ版で動作確認後、Phase 1 (MVP) の残機能：

- アポイント一覧 / 契約一覧 / 施工一覧 / 申請一覧 / 場所取り対応状況 — 本実装
- 手数料一覧の実データ化（インセンティブ → 手数料集計）
- BI ダッシュボード／市況分析
- マスタ管理（既存実装はあるが現在は「準備中」化済み、戻して整備）
- 監査ログ
- LINE 連携（Phase 2）
- PWA（Phase 2）
- CSV インポート（Phase 2）

詳細は [`docs/dev-plan.md`](docs/dev-plan.md) と [`docs/sprints/`](docs/sprints/) を参照。

---

## 6. リリースに使ったコミット履歴（参考）

```bash
git log --oneline main
```

直近の主要コミット：
- `Initial commit — Solar SaaS demo release baseline`
- `fix: production build — separate server-only logger from contracts index, drop runtime exports from server action files`
- `test: wire @solar/contracts/logger subpath into vitest resolver`

---

おつかれさまでした 🌞
