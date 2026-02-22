// src/lib/crypto.ts
import crypto from "crypto";

/**
 * AES-256-GCM secret encryption (base64 payload)
 *
 * Payload format (base64):
 *   [ 12 bytes IV ][ 16 bytes TAG ][ N bytes CIPHERTEXT ]
 *
 * IMPORTANT:
 * - decryptSecret is hardened to tolerate legacy/plaintext values safely.
 * - If decrypt fails with AUTH, it's almost always an ENCRYPTION_KEY mismatch across environments.
 */

const KEY_RAW = (process.env.ENCRYPTION_KEY ?? "").trim();
if (!KEY_RAW) throw new Error("ENCRYPTION_KEY is required");

const key = crypto.createHash("sha256").update(KEY_RAW).digest();

export function encryptionKeyFingerprintSha10(): string {
  // Safe to log; proves whether environments match without leaking the key.
  return crypto.createHash("sha256").update(KEY_RAW).digest("hex").slice(0, 10);
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function looksLikeOpenAiKeyPlaintext(v: string) {
  const s = safeTrim(v);
  // covers sk- and sk-proj-
  return s.startsWith("sk-") && s.length >= 20;
}

function looksLikeBase64(s: string) {
  // conservative check: base64 chars + optional padding
  // (not perfect, but avoids decoding obvious plaintext)
  return /^[A-Za-z0-9+/]+={0,2}$/.test(s);
}

export function encryptSecret(plain: string) {
  const p = safeTrim(plain);
  if (!p) throw new Error("encryptSecret: empty input");

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const enc = Buffer.concat([cipher.update(p, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(encB64OrPlain: string) {
  const raw = safeTrim(encB64OrPlain);
  if (!raw) throw new Error("decryptSecret: empty input");

  // ✅ Legacy/plaintext tolerance (your historical issue)
  if (looksLikeOpenAiKeyPlaintext(raw)) {
    return raw;
  }

  // Guard: if it doesn't even resemble base64, fail with a clear error
  if (!looksLikeBase64(raw)) {
    const e: any = new Error("decryptSecret: value is not base64 (likely plaintext/legacy)");
    e.code = "DECRYPT_NOT_BASE64";
    throw e;
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    const e: any = new Error("decryptSecret: invalid base64");
    e.code = "DECRYPT_INVALID_BASE64";
    throw e;
  }

  // Must be at least IV(12) + TAG(16) + 1 byte ciphertext
  if (buf.length < 12 + 16 + 1) {
    const e: any = new Error(`decryptSecret: ciphertext too short (${buf.length} bytes)`);
    e.code = "DECRYPT_TOO_SHORT";
    throw e;
  }

  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch (err: any) {
    // ✅ This is the smoking gun for env mismatch most of the time.
    const e: any = new Error("decryptSecret: AUTH_FAILED (wrong ENCRYPTION_KEY or corrupted ciphertext)");
    e.code = "DECRYPT_AUTH_FAILED";
    e.cause = err?.message ?? String(err);
    throw e;
  }
}