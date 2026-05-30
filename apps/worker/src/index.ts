// graphile-worker bootstrap (T-01-10, T-01-11, docs/03 §4.5 §4.11,
// docs/05 §5.1 §10).
//
// Run mode: `run()` keeps the process alive and polls the `graphile_worker`
// schema. `runMigrations()` is idempotent — running on every start is safe
// and means a fresh PG instance auto-provisions the queue tables.
//
// Concurrency / poll interval come from env so Railway can tune per service.
//
// Graceful shutdown: SIGTERM stops the runner and lets in-flight jobs finish
// (Railway gives ~30s before SIGKILL).
//
// Observability (T-01-11): Sentry is initialized first so any error during
// boot is captured. We then switch to the shared `pino` logger (via
// `@solar/contracts`) for structured JSON output.

import { logger } from "@solar/contracts/logger";
import { run, runMigrations, type Runner } from "graphile-worker";

import { initWorkerSentry, Sentry } from "./sentry.js";
import { buildTaskList } from "./task-list.js";

function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url || url.length === 0) {
    throw new Error("DATABASE_URL is required to start @solar/worker");
  }
  return url;
}

function getConcurrency(): number {
  const raw = process.env.WORKER_CONCURRENCY ?? "4";
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 4;
}

function getPollInterval(): number {
  const raw = process.env.WORKER_POLL_INTERVAL_MS ?? "2000";
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 2000;
}

async function main(): Promise<void> {
  initWorkerSentry();
  const connectionString = getConnectionString();

  logger.info(
    { concurrency: getConcurrency(), pollIntervalMs: getPollInterval() },
    "worker: starting",
  );

  await runMigrations({ connectionString });

  const runner: Runner = await run({
    connectionString,
    concurrency: getConcurrency(),
    pollInterval: getPollInterval(),
    noHandleSignals: true, // we attach our own SIGTERM/SIGINT handlers below
    taskList: buildTaskList(),
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "worker: draining");
    try {
      await runner.stop();
      await Sentry.close(2_000);
      logger.info("worker: stopped cleanly");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "worker: shutdown error");
      Sentry.captureException(err);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await runner.promise;
}

main().catch((err) => {
  logger.fatal({ err }, "worker: fatal");
  Sentry.captureException(err);
  // Flush Sentry before exiting so the event doesn't get dropped.
  void Sentry.close(2_000).finally(() => process.exit(1));
});
