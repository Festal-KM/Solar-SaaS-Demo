import { execSync } from "node:child_process";
import { resolve } from "node:path";

// Playwright globalSetup — runs once before any spec / worker is spawned.
//
// SP-02 完了確認で 7 spec が並列実行下で間欠失敗する事象を解消するための
// 単一 seed エントリポイント。各 spec が `test.beforeAll(execSync("pnpm db:seed"))`
// を走らせていた旧構成では、Windows + pnpm の spawn race（同一 lockfile を
// 同時取得しようとする）と Next.js dev server の cold-compile タイムアウトが
// 重なって失敗を誘発していた。本ファイルは Playwright 起動時に 1 回だけ
// seed を実行する。 seed 自体は idempotent (`upsert`) なので副作用はない。

const REPO_ROOT = resolve(__dirname, "..", "..");

export default async function globalSetup(): Promise<void> {
  execSync("pnpm db:seed", {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: process.env,
  });
}
