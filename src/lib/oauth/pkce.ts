import crypto from "crypto";

export function base64url(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function randomVerifier() {
  return base64url(crypto.randomBytes(32));
}

export function challengeS256(verifier: string) {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}

export function randomState() {
  return base64url(crypto.randomBytes(16));
}