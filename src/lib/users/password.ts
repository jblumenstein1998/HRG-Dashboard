/**
 * Password hashing, for the small number of accounts that sign in without
 * Google.
 *
 * Passwords were removed wholesale in "Remove password sign-in" and are back
 * only for shared, device-bound accounts — a store's back-office machine, where
 * there is no one person and therefore no Google identity to delegate to. Every
 * human still signs in with Google; see lib/users/google.ts. The narrow revival
 * is why this module is a fraction of the one that was deleted: no temporary
 * passwords to generate, no forced reset, no self-service change screen, because
 * a shared credential is issued by an administrator and rotated by one.
 *
 * scrypt from Node's standard library, deliberately: it's a memory-hard KDF
 * designed for exactly this, and it ships with the runtime. bcrypt/argon2 would
 * mean either a native binary to keep working on Vercel or a slow pure-JS
 * reimplementation, for no security gain at this scale.
 *
 * Stored as `scrypt$N$r$p$salt$hash`, all base64url. The parameters travel with
 * the hash so they can be raised later without invalidating existing passwords:
 * verify reads whatever the stored string says, and only new hashes use the
 * current constants.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

// promisify collapses scrypt's overloads to the 3-argument one, which loses the
// options parameter the cost factors are passed in. Re-declared rather than
// cast at each call site.
const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * ~64 MB and roughly 100ms per hash on Vercel's Node runtime. Costly enough to
 * make offline cracking painful, cheap enough that a login isn't noticeable.
 * `maxmem` has to be raised explicitly or Node refuses N this large.
 */
const N = 65536;
const R = 8;
const P = 1;
const KEY_LEN = 32;
const MAX_MEM = 128 * N * R * 2;

const b64 = (b: Buffer) => b.toString("base64url");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_LEN, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEM,
  });
  return `scrypt$${N}$${R}$${P}$${b64(salt)}$${b64(key)}`;
}

/**
 * Constant-time comparison against a stored hash. Returns false rather than
 * throwing on a malformed record — a corrupt row shouldn't 500 the login page,
 * and "wrong password" is the right outcome either way.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
    if (scheme !== "scrypt") return false;

    const salt = Buffer.from(saltB64, "base64url");
    const expected = Buffer.from(hashB64, "base64url");
    const params = { N: Number(n), r: Number(r), p: Number(p) };
    if (!params.N || !params.r || !params.p) return false;

    const key = await scrypt(password.normalize("NFKC"), salt, expected.length, {
      ...params,
      maxmem: 128 * params.N * params.r * 2,
    });

    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/**
 * A hash of nothing, for the "no such username" branch of the login route.
 *
 * Verifying against this costs the same as verifying a real password, so a
 * missing account and a wrong password take the same time and response timing
 * can't be used to enumerate usernames.
 */
export const DUMMY_HASH =
  "scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/**
 * Length only. Composition rules ("must contain a symbol") push people towards
 * predictable substitutions and are no longer recommended by NIST; a longer
 * minimum does more.
 */
export const MIN_PASSWORD_LENGTH = 10;

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) return "Password is too long.";
  return null;
}
