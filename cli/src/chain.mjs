// On-chain identity lookups: which qommit keys has a qor1 address linked with a hybrid-signed transaction?

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_REST = "https://api-testnet.qore.host"; // qorechain-diana
const BIND_PREFIX = "qommit:bind:v1:";
const HYBRID_EXT = "/qorechain.pqc.v1.PQCHybridSignature";
const MSG_SEND = "/cosmos.bank.v1beta1.MsgSend";
const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000; // a found link is stable; re-check daily
const NEGATIVE_TTL_MS = 5 * 60 * 1000; // "not linked yet" may change soon

/**
 * Pure: extract valid qommit bindings from a Cosmos tx-search response for `address`.
 * A binding counts only if the tx succeeded, was sent by `address` itself (MsgSend from it), and carries the
 * hybrid ML-DSA-87 signature extension.
 */
export function parseBindings(txSearch, address) {
  const out = [];
  for (const r of txSearch?.tx_responses ?? []) {
    const body = r?.tx?.body ?? {};
    const memo = body.memo ?? "";
    if (r.code !== 0 || !memo.startsWith(BIND_PREFIX)) continue;
    const fpr = memo.slice(BIND_PREFIX.length).toUpperCase();
    if (!/^[0-9A-F]{40}$/.test(fpr)) continue;
    const fromSelf = (body.messages ?? []).some((m) => m["@type"] === MSG_SEND && m.from_address === address);
    const exts = [...(body.extension_options ?? []), ...(body.non_critical_extension_options ?? [])];
    const hybrid = exts.some((e) => e["@type"] === HYBRID_EXT);
    if (fromSelf && hybrid) out.push({ fpr, txHash: r.txhash, height: Number(r.height), time: r.timestamp });
  }
  return out;
}

async function fetchBindings(address, rest) {
  const query = encodeURIComponent(`message.sender='${address}'`);
  const url = `${rest}/cosmos/tx/v1beta1/txs?query=${query}&order_by=ORDER_BY_DESC&pagination.limit=100`;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { "User-Agent": "qommit-cli" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseBindings(await res.json(), address);
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(lastError?.cause?.code || lastError?.message || String(lastError));
}

/**
 * Find the on-chain binding of `fpr` to `address`, using a small cache so `git log` stays fast.
 * Returns { binding } (found), { binding: null } (checked: not linked), or { error } (couldn't check).
 */
export async function lookupBinding(address, fpr, { cacheFile, rest = DEFAULT_REST, now = Date.now() } = {}) {
  const cache = cacheFile && existsSync(cacheFile) ? safeJson(readFileSync(cacheFile, "utf8")) : {};
  const entry = cache[address];
  if (entry) {
    const hit = entry.bindings.find((b) => b.fpr === fpr);
    const ttl = hit ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
    if (now - entry.fetchedAt < ttl) return { binding: hit ?? null, cached: true };
  }
  try {
    const bindings = await fetchBindings(address, rest);
    if (cacheFile) {
      // The cache is only a speed-up: failing to write it (e.g. no ~/.qommit on a CI machine) must not fail the lookup.
      try {
        mkdirSync(dirname(cacheFile), { recursive: true, mode: 0o700 });
        cache[address] = { fetchedAt: now, bindings };
        writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
      } catch {}
    }
    return { binding: bindings.find((b) => b.fpr === fpr) ?? null };
  } catch (e) {
    return { error: e.message };
  }
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
