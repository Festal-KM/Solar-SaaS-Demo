// argon2id helpers — single source of truth for password hashing parameters.
//
// Parameters follow OWASP 2023 guidance (memoryCost=19 MiB, timeCost=2,
// parallelism=1) and docs/05 §6.10. The `dummyHash` is generated once at
// module load and reused whenever a user does not exist, so that argon2's
// constant-time-ish verify path is exercised on every login attempt — closing
// the timing-attack side channel that would otherwise leak account existence.

import argon2 from "argon2";

const HASH_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, HASH_OPTIONS);
}

export async function verifyArgon2(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

// One-shot dummy hash generated at module load. Used when the looked-up user
// does not exist so the verify path still runs and total request time matches
// the "user exists" path.
const dummyHashPromise: Promise<string> = argon2.hash(
  `dummy-${Math.random().toString(36).slice(2)}-${Date.now()}`,
  HASH_OPTIONS,
);

export async function getDummyHash(): Promise<string> {
  return dummyHashPromise;
}
