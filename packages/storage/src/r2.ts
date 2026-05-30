// Cloudflare R2 (S3-compatible) client + pre-signed URL helpers (T-01-10).
//
// docs/03 §4.6 / docs/05 §6.11 §8 — pre-signed PUT for client-direct uploads,
// 15-minute TTL by default. Real ownership / RBAC enforcement lives in the
// web app (`POST /api/files/presign`); this module is purely the S3 driver.

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const DEFAULT_PRESIGN_EXPIRES_IN_SEC = 900; // docs/05 §8.3 — 15 minutes

export interface R2Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region?: string;
}

function endpointFromEnv(): string {
  // Prefer explicit endpoint, otherwise build from account id (R2 convention).
  const explicit = process.env.R2_ENDPOINT;
  if (explicit && explicit.length > 0) return explicit;
  const accountId = process.env.R2_ACCOUNT_ID;
  if (accountId && accountId !== "replace-me") {
    return `https://${accountId}.r2.cloudflarestorage.com`;
  }
  // Last resort: deterministic placeholder so signing still works in tests.
  return "https://example-account.r2.cloudflarestorage.com";
}

function isPlaceholderCredential(value: string | undefined): boolean {
  return !value || value.length === 0 || value === "replace-me";
}

export function loadR2ConfigFromEnv(): R2Config {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  // Guard real environments against silently issuing URLs signed with the
  // "replace-me" placeholder — that would 403 at upload time with no obvious
  // root cause. Tests inject an explicit config so this path never fires for
  // them.
  if (
    process.env.NODE_ENV !== "test" &&
    (isPlaceholderCredential(accessKeyId) || isPlaceholderCredential(secretAccessKey))
  ) {
    throw new Error(
      "R2 credentials missing in environment: set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY",
    );
  }

  return {
    endpoint: endpointFromEnv(),
    accessKeyId: accessKeyId ?? "replace-me",
    secretAccessKey: secretAccessKey ?? "replace-me",
    bucket: process.env.R2_BUCKET ?? "solar-saas-dev",
    region: "auto",
  };
}

let cachedClient: { client: S3Client; bucket: string } | null = null;

export function getR2Client(config: R2Config = loadR2ConfigFromEnv()): {
  client: S3Client;
  bucket: string;
} {
  if (cachedClient && cachedClient.bucket === config.bucket) return cachedClient;
  const client = new S3Client({
    region: config.region ?? "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // R2 only accepts path-style today.
    forcePathStyle: true,
  });
  cachedClient = { client, bucket: config.bucket };
  return cachedClient;
}

// Exposed for tests that want to swap the cached client for a stub.
export function __resetR2ClientCacheForTests(): void {
  cachedClient = null;
}

/**
 * Internal: issue a pre-signed PUT URL. Prefer {@link presignUpload} for the
 * documented public contract (docs/05 §6.11).
 */
export async function getPresignedPutUrl(
  key: string,
  contentType: string,
  expiresIn: number = DEFAULT_PRESIGN_EXPIRES_IN_SEC,
  config?: R2Config,
): Promise<string> {
  const { client, bucket } = getR2Client(config);
  const cmd = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
  return getSignedUrl(client, cmd, { expiresIn });
}

/**
 * Internal: issue a pre-signed GET URL. Prefer {@link presignDownload} for
 * the documented public contract (docs/05 §6.11).
 */
export async function getPresignedGetUrl(
  key: string,
  expiresIn: number = DEFAULT_PRESIGN_EXPIRES_IN_SEC,
  config?: R2Config,
): Promise<string> {
  const { client, bucket } = getR2Client(config);
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client, cmd, { expiresIn });
}

// ---------------------------------------------------------------------------
// Public presign API — docs/05 §6.11 signatures.
// ---------------------------------------------------------------------------

export interface PresignUploadInput {
  key: string;
  contentType: string;
  /** Reserved for SP-05 — enforced at the web-layer ownership check. */
  maxBytes?: number;
  /** Override the default 15-minute TTL (docs/05 §8.3). */
  ttlSec?: number;
}

export interface PresignUploadResult {
  putUrl: string;
  headers: Record<string, string>;
  expiresIn: number;
}

export async function presignUpload(
  input: PresignUploadInput,
  config?: R2Config,
): Promise<PresignUploadResult> {
  const expiresIn = input.ttlSec ?? DEFAULT_PRESIGN_EXPIRES_IN_SEC;
  const putUrl = await getPresignedPutUrl(input.key, input.contentType, expiresIn, config);
  return {
    putUrl,
    headers: { "Content-Type": input.contentType },
    expiresIn,
  };
}

export interface PresignDownloadInput {
  key: string;
  ttlSec?: number;
  /**
   * Caller-side guarantee that ownership/RBAC has been checked before this
   * function is invoked. SP-05 will wire `(userId, key) => Promise<boolean>`
   * at the web layer; here it is a documentation marker only.
   */
  ownershipCheck?: boolean;
}

export interface PresignDownloadResult {
  getUrl: string;
  expiresIn: number;
}

export async function presignDownload(
  input: PresignDownloadInput,
  config?: R2Config,
): Promise<PresignDownloadResult> {
  const expiresIn = input.ttlSec ?? DEFAULT_PRESIGN_EXPIRES_IN_SEC;
  const getUrl = await getPresignedGetUrl(input.key, expiresIn, config);
  return { getUrl, expiresIn };
}

// ---------------------------------------------------------------------------
// Object-key builders — docs/05 §6.11 / §8.2.
// SP-05 will extend the surface; for now the wholesalerId + resourceId scheme
// is fixed.
// ---------------------------------------------------------------------------

export const buildKey = {
  contractPdf: (wholesalerId: string, contractId: string): string =>
    `${wholesalerId}/contracts/${contractId}/contract.pdf`,
  contractAttachment: (
    wholesalerId: string,
    contractId: string,
    uuid: string,
    ext: string,
  ): string => `${wholesalerId}/contracts/${contractId}/attachments/${uuid}.${normExt(ext)}`,
  constructionPhoto: (
    wholesalerId: string,
    constructionId: string,
    uuid: string,
    ext: string,
  ): string => `${wholesalerId}/constructions/${constructionId}/photos/${uuid}.${normExt(ext)}`,
  applicationFile: (
    wholesalerId: string,
    applicationId: string,
    uuid: string,
    ext: string,
  ): string => `${wholesalerId}/applications/${applicationId}/${uuid}.${normExt(ext)}`,
  eventReportPhoto: (wholesalerId: string, eventId: string, uuid: string, ext: string): string =>
    `${wholesalerId}/events/${eventId}/reports/${uuid}.${normExt(ext)}`,
  avatar: (userId: string, ext: string): string => `users/${userId}/avatar.${normExt(ext)}`,
};

/** @deprecated Use {@link buildKey}. Kept for compatibility within SP-01. */
export const objectKey = buildKey;

function normExt(ext: string): string {
  return ext.replace(/^\./, "").toLowerCase();
}
