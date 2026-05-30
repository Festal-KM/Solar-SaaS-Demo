// Unit tests for @solar/storage R2 pre-signed URL issuance (T-01-10).
//
// We do not hit Cloudflare. The presigner is exercised with dummy credentials
// against a deterministic endpoint and the resulting URL is inspected:
//   - X-Amz-Expires query param == 900 (15 minutes, docs/05 §8.3)
//   - Custom expiresIn flows through unchanged
//   - PUT vs GET signatures include the bucket + key path
//   - presignUpload / presignDownload wrappers honour the docs/05 §6.11 shape
//   - Object-key builders match docs/05 §8.2 patterns
//   - loadR2ConfigFromEnv throws when credentials are missing (non-test env)

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildKey,
  DEFAULT_PRESIGN_EXPIRES_IN_SEC,
  __resetR2ClientCacheForTests,
  getPresignedGetUrl,
  getPresignedPutUrl,
  loadR2ConfigFromEnv,
  objectKey,
  presignDownload,
  presignUpload,
  type R2Config,
} from "../src/index.js";

const TEST_CONFIG: R2Config = {
  endpoint: "https://test-account.r2.cloudflarestorage.com",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  bucket: "solar-saas-test",
  region: "auto",
};

beforeEach(() => {
  __resetR2ClientCacheForTests();
});
afterEach(() => {
  __resetR2ClientCacheForTests();
});

describe("getPresignedPutUrl", () => {
  it("defaults to 900s (15 minutes) per docs/05 §8.3", async () => {
    const url = await getPresignedPutUrl(
      "tenant-1/contracts/c-1/contract.pdf",
      "application/pdf",
      undefined,
      TEST_CONFIG,
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe(String(DEFAULT_PRESIGN_EXPIRES_IN_SEC));
    expect(DEFAULT_PRESIGN_EXPIRES_IN_SEC).toBe(900);
  });

  it("honours a custom expiresIn", async () => {
    const url = await getPresignedPutUrl(
      "tenant-1/contracts/c-1/contract.pdf",
      "application/pdf",
      300,
      TEST_CONFIG,
    );
    expect(new URL(url).searchParams.get("X-Amz-Expires")).toBe("300");
  });

  it("includes bucket and key in the signed path", async () => {
    const url = await getPresignedPutUrl(
      "tenant-1/contracts/c-42/contract.pdf",
      "application/pdf",
      undefined,
      TEST_CONFIG,
    );
    const parsed = new URL(url);
    expect(parsed.host).toBe("test-account.r2.cloudflarestorage.com");
    expect(parsed.pathname).toContain("solar-saas-test");
    expect(parsed.pathname).toContain("tenant-1/contracts/c-42/contract.pdf");
    expect(parsed.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
  });

  it("emits a non-empty X-Amz-Signature", async () => {
    // Regression guard: signature must be present so the URL is usable.
    // (S3 presigner places Content-Type on the request as an unsigned
    // header — it is enforced at upload time by R2, not by the signature.)
    const url = await getPresignedPutUrl(
      "tenant-1/avatars/u-1.png",
      "image/png",
      undefined,
      TEST_CONFIG,
    );
    const sig = new URL(url).searchParams.get("X-Amz-Signature");
    expect(sig).toBeTruthy();
    expect(sig?.length ?? 0).toBeGreaterThan(32);
  });
});

describe("getPresignedGetUrl", () => {
  it("issues a 900s URL by default", async () => {
    const url = await getPresignedGetUrl(
      "tenant-1/contracts/c-1/contract.pdf",
      undefined,
      TEST_CONFIG,
    );
    expect(new URL(url).searchParams.get("X-Amz-Expires")).toBe("900");
  });
});

describe("presignUpload (docs/05 §6.11)", () => {
  it("returns putUrl + Content-Type header + expiresIn", async () => {
    const result = await presignUpload(
      {
        key: "tenant-1/contracts/c-1/contract.pdf",
        contentType: "application/pdf",
      },
      TEST_CONFIG,
    );
    expect(result.expiresIn).toBe(DEFAULT_PRESIGN_EXPIRES_IN_SEC);
    expect(result.headers["Content-Type"]).toBe("application/pdf");
    const parsed = new URL(result.putUrl);
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(parsed.pathname).toContain("tenant-1/contracts/c-1/contract.pdf");
  });

  it("honours ttlSec override", async () => {
    const result = await presignUpload(
      {
        key: "tenant-1/avatars/u-1.png",
        contentType: "image/png",
        ttlSec: 60,
      },
      TEST_CONFIG,
    );
    expect(result.expiresIn).toBe(60);
    expect(new URL(result.putUrl).searchParams.get("X-Amz-Expires")).toBe("60");
  });
});

describe("presignDownload (docs/05 §6.11)", () => {
  it("returns getUrl + expiresIn with the documented default", async () => {
    const result = await presignDownload(
      { key: "tenant-1/contracts/c-1/contract.pdf" },
      TEST_CONFIG,
    );
    expect(result.expiresIn).toBe(DEFAULT_PRESIGN_EXPIRES_IN_SEC);
    expect(new URL(result.getUrl).searchParams.get("X-Amz-Expires")).toBe("900");
  });

  it("honours ttlSec override (e.g. 5-minute download window)", async () => {
    const result = await presignDownload(
      { key: "tenant-1/contracts/c-1/contract.pdf", ttlSec: 300 },
      TEST_CONFIG,
    );
    expect(result.expiresIn).toBe(300);
    expect(new URL(result.getUrl).searchParams.get("X-Amz-Expires")).toBe("300");
  });
});

describe("loadR2ConfigFromEnv", () => {
  const savedEnv = {
    NODE_ENV: process.env.NODE_ENV,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  };

  afterEach(() => {
    process.env.NODE_ENV = savedEnv.NODE_ENV;
    if (savedEnv.R2_ACCESS_KEY_ID === undefined) delete process.env.R2_ACCESS_KEY_ID;
    else process.env.R2_ACCESS_KEY_ID = savedEnv.R2_ACCESS_KEY_ID;
    if (savedEnv.R2_SECRET_ACCESS_KEY === undefined) delete process.env.R2_SECRET_ACCESS_KEY;
    else process.env.R2_SECRET_ACCESS_KEY = savedEnv.R2_SECRET_ACCESS_KEY;
  });

  it("throws when credentials are missing in non-test env", () => {
    process.env.NODE_ENV = "production";
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    expect(() => loadR2ConfigFromEnv()).toThrow(/R2 credentials missing/);
  });

  it("throws when credentials are the 'replace-me' placeholder in non-test env", () => {
    process.env.NODE_ENV = "production";
    process.env.R2_ACCESS_KEY_ID = "replace-me";
    process.env.R2_SECRET_ACCESS_KEY = "replace-me";
    expect(() => loadR2ConfigFromEnv()).toThrow(/R2 credentials missing/);
  });

  it("tolerates missing credentials when NODE_ENV=test", () => {
    process.env.NODE_ENV = "test";
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    const cfg = loadR2ConfigFromEnv();
    expect(cfg.accessKeyId).toBe("replace-me");
    expect(cfg.secretAccessKey).toBe("replace-me");
  });
});

describe("object-key builders", () => {
  it("match docs/05 §8.2 patterns via buildKey", () => {
    expect(buildKey.contractPdf("WS-1", "C-1")).toBe("WS-1/contracts/C-1/contract.pdf");
    expect(buildKey.contractAttachment("WS-1", "C-1", "uuid", "PDF")).toBe(
      "WS-1/contracts/C-1/attachments/uuid.pdf",
    );
    expect(buildKey.constructionPhoto("WS-1", "K-1", "uuid", ".jpg")).toBe(
      "WS-1/constructions/K-1/photos/uuid.jpg",
    );
    expect(buildKey.applicationFile("WS-1", "A-1", "uuid", "pdf")).toBe(
      "WS-1/applications/A-1/uuid.pdf",
    );
    expect(buildKey.eventReportPhoto("WS-1", "E-1", "uuid", "jpg")).toBe(
      "WS-1/events/E-1/reports/uuid.jpg",
    );
    expect(buildKey.avatar("U-1", "png")).toBe("users/U-1/avatar.png");
  });

  it("exposes objectKey as a deprecated alias of buildKey", () => {
    expect(objectKey).toBe(buildKey);
    expect(objectKey.contractPdf("WS-1", "C-1")).toBe("WS-1/contracts/C-1/contract.pdf");
  });
});
