// Core signing logic, kept free of file and git I/O so it can be unit-tested.

import { mldsa87, pubkeyHash } from "@qorechain/pqc";
import { isValidBech32 } from "./bech32.mjs";

export const ALG = "ML-DSA-87";
export const ARMOR_BEGIN = "-----BEGIN SIGNED MESSAGE-----"; // the prefix git uses to recognise x509 signatures
export const ARMOR_END = "-----END SIGNED MESSAGE-----";

const b64 = (b) => Buffer.from(b).toString("base64");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));

/** 40-hex-char key fingerprint: SHAKE-256 hash of the public key (same helper QoreChain uses for addresses). */
export const fingerprintOf = (pk) => Buffer.from(pubkeyHash(pk, 20)).toString("hex").toUpperCase();

export function generateKey() {
  const { publicKey, secretKey } = mldsa87.keygen();
  return { publicKey, secretKey, fingerprint: fingerprintOf(publicKey) };
}

// What actually gets signed. Domain separation ("qommit-vN") means a qommit signature can never be replayed as a
// signature for anything else. In v2 the address claim and timestamp are signed too, so nobody can edit them.
function signedBytes(v, payload, { addr = "", ts = 0 } = {}) {
  if (v === 1) return Buffer.concat([Buffer.from("qommit-v1:"), payload]);
  return Buffer.concat([Buffer.from(`qommit-v2\naddr:${addr}\nts:${ts}\n\n`), payload]);
}

/** Sign a git payload. `addr` (optional) is the qor1 address this key claims to belong to. Returns armored text. */
export function signPayload(key, payload, { addr = "", now = Date.now() } = {}) {
  const ts = Math.floor(now / 1000);
  const sig = mldsa87.sign(key.secretKey, signedBytes(2, payload, { addr, ts }));
  const body = { v: 2, alg: ALG, fpr: key.fingerprint, addr, ts, pk: b64(key.publicKey), sig: b64(sig) };
  const wrapped = b64(Buffer.from(JSON.stringify(body))).match(/.{1,64}/g).join("\n");
  return `${ARMOR_BEGIN}\n${wrapped}\n${ARMOR_END}\n`;
}

/**
 * Verify an armored signature over a git payload.
 * Returns { ok, reason?, fpr, addr, ts, v }. Never throws on bad input.
 */
export function verifyPayload(armored, payload) {
  let body;
  try {
    const inner = armored.replace(ARMOR_BEGIN, "").replace(ARMOR_END, "").replace(/\s+/g, "");
    body = JSON.parse(Buffer.from(inner, "base64").toString("utf8"));
  } catch {
    return { ok: false, reason: "unreadable signature" };
  }
  const { v, alg, fpr } = body;
  if ((v !== 1 && v !== 2) || alg !== ALG) return { ok: false, reason: `unsupported signature (${alg} v${v})` };
  if (typeof fpr !== "string" || !/^[0-9A-F]{40}$/.test(fpr)) return { ok: false, reason: "malformed fingerprint" };
  // v1 never signed an identity claim or timestamp, so any such fields in a v1 body are unsigned: ignore them.
  const addr = v === 1 ? "" : body.addr ?? "";
  const ts = v === 1 ? 0 : body.ts ?? 0;
  // The claim and timestamp end up in git's status lines and on screen: accept only a real qor1 address and an integer.
  if (addr !== "" && !isValidBech32(addr, "qor")) return { ok: false, reason: "identity claim is not a valid qor1 address", fpr };
  if (!Number.isSafeInteger(ts) || ts < 0) return { ok: false, reason: "malformed timestamp", fpr };
  const publicKey = unb64(body.pk ?? "");
  // The fingerprint inside the signature must really be the hash of the embedded key.
  if (fingerprintOf(publicKey) !== fpr) return { ok: false, reason: "fingerprint does not match key", fpr, addr, ts, v };
  const ok = mldsa87.verify(publicKey, signedBytes(v, payload, { addr, ts }), unb64(body.sig ?? ""));
  return ok ? { ok, fpr, addr, ts, v, publicKey } : { ok, reason: "signature does not match content", fpr, addr, ts, v };
}

/** The memo for the on-chain binding transaction: "qor1… owns key <fingerprint>". Fits QoreX's 256-byte memo limit. */
export const bindMemo = (fpr) => `qommit:bind:v1:${fpr}`;
/** The memo that withdraws a binding (e.g. a key was linked by mistake or by a phishing link). */
export const unbindMemo = (fpr) => `qommit:unbind:v1:${fpr}`;
