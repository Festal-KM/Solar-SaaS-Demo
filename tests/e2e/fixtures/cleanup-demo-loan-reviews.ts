import { config } from "dotenv";
import { resolve } from "node:path";

// E2E データクリーンアップ — ローン審査 spec（customer-loan-call-tabs /
// customer-loan-review-tab / customer-loan-review-pv-batchC / customer-project-info-edit）が
// 先頭サンプル顧客「佐藤 一馬」(seed s=0) に「審査を追加」で生成した独立 LoanReview と
// その審査履歴ログ（LoanReviewLog）を削除し、他 spec が前提とする
// 「佐藤 一馬 = ローン審査 0 件」（空状態検証の不変条件）へ戻す。
//
// 方針（破壊範囲を最小化）:
//   - seed は「佐藤 一馬」に LoanReview を一切作らない（seed.ts / seedCustomerActivities）。
//     よって佐藤 一馬の LoanReview は全てテストが追加したもの → 全削除して原状回復。
//   - 他顧客（seed が LoanReview を投入する顧客群）は一切触らない。
//
// CLAUDE.md ハードルール「テスト前後に対象テナントの業務テーブルを truncate」に準拠。
// RLS を経由しない rawPrisma を使うのは seed/migration と同じ運用例外。

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
config({ path: resolve(REPO_ROOT, ".env.local") });

async function main(): Promise<void> {
  const { rawPrisma } = (await import("@solar/db")) as typeof import("@solar/db");

  const customers = await rawPrisma.customer.findMany({
    where: { name: { contains: "佐藤 一馬" } },
    select: { id: true, name: true },
  });

  let removedLogs = 0;
  let removedReviews = 0;

  for (const customer of customers) {
    const reviews = await rawPrisma.loanReview.findMany({
      where: { customerId: customer.id },
      select: { id: true },
    });
    if (reviews.length === 0) continue;
    const reviewIds = reviews.map((r) => r.id);

    const delLogs = await rawPrisma.loanReviewLog.deleteMany({
      where: { loanReviewId: { in: reviewIds } },
    });
    removedLogs += delLogs.count;

    const delReviews = await rawPrisma.loanReview.deleteMany({
      where: { id: { in: reviewIds } },
    });
    removedReviews += delReviews.count;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[cleanup-demo-loan-reviews] removed reviews=${removedReviews} logs=${removedLogs}`,
  );

  await rawPrisma.$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[cleanup-demo-loan-reviews] failed", err);
  process.exit(1);
});
