// graphile-worker cron definitions (docs/05 §5.3).
//
// The crontab string is passed to `parseCrontab()` and the resulting schedule
// is provided to `run()` via the `crontab` option. Task names MUST match the
// keys in buildTaskList().
//
// Cron expressions use graphile-worker syntax (seconds are NOT supported —
// the smallest unit is minutes).
//
// Schedules (all times are UTC; JST = UTC+9):
//   monthly.aggregate_all_tenants  — 1st of every month at 02:00 JST (17:00 UTC previous day)
//   reminder.dispatch              — every 5 minutes
//   security.purge_login_attempts  — daily at 00:30 JST (15:30 UTC)
//   notification.purge             — daily at 01:00 JST (16:00 UTC)

export const CRONTAB = `
# 月末翌日 2:00 JST に全テナント月次集計 (2:00 JST = 17:00 UTC on the 1st of each month)
0 17 1 * * monthly.aggregate_all_tenants ?run_at_for_last_month=true
# 5 分おきにリマインダ
*/5 * * * * reminder.dispatch
# 毎日 0:30 JST に LoginAttempt の古いレコードを掃除 (0:30 JST = 15:30 UTC)
30 15 * * * security.purge_login_attempts ?retention_days=30
# 毎日 1:00 JST に Notification の既読 30 日超を物理削除 (1:00 JST = 16:00 UTC)
0 16 * * * notification.purge ?retention_days=30
`.trim();
