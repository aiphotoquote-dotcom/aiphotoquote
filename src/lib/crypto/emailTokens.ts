import crypto from "crypto";

const ALG = "aes-256-gcm";

function key() {
  const k = process.env.EMAIL_TOKEN_ENC_KEY || "";
  if (k.length < 32) {
    throw new Error("Missing/weak EMAIL_TOKEN_ENC_KEY (need 32+ chars).");
  }
  // Use first 32 bytes deterministically (simple + works).
  return Buffer.from(k.slice(0, 32), "utf8");
}

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptToken(encB64: string): string {
  const raw = Buffer.from(encB64, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);

  const decipher = crypto.createDecipheriv(ALG, key(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}