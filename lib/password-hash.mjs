import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const CURRENT_VERSION = "v1";
const CURRENT_N = 16_384;
const CURRENT_R = 8;
const CURRENT_P = 1;
const KEY_LENGTH = 64;
const PREFIX = "scrypt";

function legacySha256(password) {
  return createHash("sha256").update(password).digest("hex");
}

function safeEqualBuffers(first, second) {
  return first.length === second.length && timingSafeEqual(first, second);
}

function normalizeLegacyHash(value) {
  return value.trim().replace(/^sha256:/i, "").toLowerCase();
}

function parseScryptHash(value) {
  const [prefix, version, nValue, rValue, pValue, saltValue, digestValue] =
    value.split("$");
  const n = Number(nValue);
  const r = Number(rValue);
  const p = Number(pValue);

  if (
    prefix !== PREFIX ||
    version !== CURRENT_VERSION ||
    !Number.isInteger(n) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    n < 2 ||
    r < 1 ||
    p < 1 ||
    !saltValue ||
    !digestValue
  ) {
    return null;
  }

  try {
    const salt = Buffer.from(saltValue, "base64url");
    const digest = Buffer.from(digestValue, "base64url");
    if (salt.length < 16 || digest.length !== KEY_LENGTH) {
      return null;
    }

    return { n, r, p, salt, digest };
  } catch {
    return null;
  }
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const digest = await scrypt(password, salt, KEY_LENGTH, {
    N: CURRENT_N,
    r: CURRENT_R,
    p: CURRENT_P,
    maxmem: 64 * 1024 * 1024,
  });

  return [
    PREFIX,
    CURRENT_VERSION,
    CURRENT_N,
    CURRENT_R,
    CURRENT_P,
    salt.toString("base64url"),
    Buffer.from(digest).toString("base64url"),
  ].join("$");
}

export function passwordHashNeedsUpgrade(value) {
  const parsed = parseScryptHash(value);
  return (
    !parsed ||
    parsed.n !== CURRENT_N ||
    parsed.r !== CURRENT_R ||
    parsed.p !== CURRENT_P
  );
}

export async function verifyPasswordHash(password, expectedHash) {
  const value = expectedHash?.trim() ?? "";
  if (!value) {
    return false;
  }

  const parsed = parseScryptHash(value);
  if (parsed) {
    try {
      const actual = await scrypt(password, parsed.salt, parsed.digest.length, {
        N: parsed.n,
        r: parsed.r,
        p: parsed.p,
        maxmem: 64 * 1024 * 1024,
      });
      return safeEqualBuffers(Buffer.from(actual), parsed.digest);
    } catch {
      return false;
    }
  }

  const legacyHash = normalizeLegacyHash(value);
  if (!/^[a-f0-9]{64}$/.test(legacyHash)) {
    return false;
  }

  return safeEqualBuffers(
    Buffer.from(legacySha256(password), "hex"),
    Buffer.from(legacyHash, "hex"),
  );
}
