// Browser-side commit verification. Mirrors cli/src/core.mjs byte for byte: same armor, same signed bytes.

import { mldsa87, pubkeyHash } from "@qorechain/pqc";

import { isValidBech32 } from "./bech32";

const ARMOR_BEGIN = "-----BEGIN SIGNED MESSAGE-----";
const ARMOR_END = "-----END SIGNED MESSAGE-----";
const enc = new TextEncoder();

const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toHexUpper = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

export const isQommitSignature = (sig: string | null | undefined): boolean => !!sig && sig.startsWith(ARMOR_BEGIN);

export interface SigCheck {
  ok: boolean;
  reason?: string;
  fpr?: string;
  addr?: string;
  ts?: number;
  publicKey?: Uint8Array;
}

/** Verify a Qommit signature over a git commit payload (as returned by GitHub's API). Never throws. */
export function verifyQommit(armored: string, payload: string): SigCheck {
  let body: { v: number; alg: string; fpr: string; addr?: string; ts?: number; pk: string; sig: string };
  try {
    const inner = armored.replace(ARMOR_BEGIN, "").replace(ARMOR_END, "").replace(/\s+/g, "");
    body = JSON.parse(new TextDecoder().decode(fromB64(inner)));
  } catch {
    return { ok: false, reason: "unreadable signature" };
  }
  const { v, alg, fpr } = body;
  if ((v !== 1 && v !== 2) || alg !== "ML-DSA-87") return { ok: false, reason: `unsupported signature (${alg} v${v})` };
  if (typeof fpr !== "string" || !/^[0-9A-F]{40}$/.test(fpr)) return { ok: false, reason: "malformed fingerprint" };
  // Same rules as the CLI: v1 never signed a claim or timestamp; a claim must be a real qor1 address.
  const addr = v === 1 ? "" : body.addr ?? "";
  const ts = v === 1 ? 0 : body.ts ?? 0;
  if (addr !== "" && !isValidBech32(addr)) return { ok: false, reason: "identity claim is not a valid qor1 address", fpr };
  if (!Number.isSafeInteger(ts) || ts < 0) return { ok: false, reason: "malformed timestamp", fpr };
  const publicKey = fromB64(body.pk ?? "");
  if (toHexUpper(pubkeyHash(publicKey, 20)) !== fpr) return { ok: false, reason: "fingerprint does not match key", fpr, addr };
  const prefix = v === 1 ? "qommit-v1:" : `qommit-v2\naddr:${addr}\nts:${ts}\n\n`;
  const ok = mldsa87.verify(publicKey, concat(enc.encode(prefix), enc.encode(payload)), fromB64(body.sig ?? ""));
  return ok ? { ok, fpr, addr, ts, publicKey } : { ok, reason: "signature does not match the commit", fpr, addr, ts };
}
