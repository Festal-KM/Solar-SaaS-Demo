// @solar/storage public surface (T-01-10).
export {
  DEFAULT_PRESIGN_EXPIRES_IN_SEC,
  __resetR2ClientCacheForTests,
  buildKey,
  getPresignedGetUrl,
  getPresignedPutUrl,
  getR2Client,
  loadR2ConfigFromEnv,
  objectKey,
  presignDownload,
  presignUpload,
  type PresignDownloadInput,
  type PresignDownloadResult,
  type PresignUploadInput,
  type PresignUploadResult,
  type R2Config,
} from "./r2.js";

export const STORAGE_PACKAGE_VERSION = "0.1.0";
