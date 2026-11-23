// On-chain identity lookups: which qommit keys has a qor1 address linked with a hybrid-signed transaction?

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_REST = "https://api-testnet.qore.host"; // qorechain-diana
const BIND_PREFIX = "qommit:bind:v1:";
const UNBIND_PREFIX = "qommit:unbind:v1:";
const HYBRID_EXT = "/qorechain.pqc.v1.PQCHybridSignature";
const MSG_SEND = "/cosmos.bank.v1beta1.MsgSend";
const POSITIVE_TTL_MS = 10 * 60 * 1000; // a link can be withdrawn (unbind), so re-check every 10 minutes
const NEGATIVE_TTL_MS = 5 * 60 * 1000; // "not linked yet" may change soon

/**
 * Pure: extract valid qommit bindings from a Cosmos tx-search response for `address`.
 * A binding counts only if the tx succeeded, was sent by `address` itself (MsgSend from it), and carries the
 * hybrid ML-DSA-87 signature extension.
 */
export function parseBindings(txSearch, address) {
  // Replay bind/unbind statements oldest-first; a key counts if its latest statement is "bind".
  const events = [];
  for (const r of txSearch?.tx_responses ?? []) {
    const body = r?.tx?.body ?? {};
    const memo = body.memo ?? "";
    const kind = memo.startsWith(BIND_PREFIX) ? "bind" : memo.startsWith(UNBIND_PREFIX) ? "unbind" : null;
    if (r.code !== 0 || !kind) continue;
    const fpr = memo.slice(kind === "bind" ? BIND_PREFIX.length : UNBIND_PREFIX.length).toUpperCase();
    if (!/^[0-9A-F]{40}$/.test(fpr)) continue;
    const fromSelf = (body.messages ?? []).some((m) => m["@type"] === MSG_SEND && m.from_address === address);
    // Only a critical extension counts: a non-critical one may be ignored by nodes, so it proves nothing.
    const hybrid = (body.extension_options ?? []).some((e) => e["@type"] === HYBRID_EXT);
    if (fromSelf && hybrid) events.push({ kind, fpr, txHash: r.txhash, height: Number(r.height), time: r.timestamp });
  }
  events.sort((a, b) => a.height - b.height);
  const latest = new Map();
  for (const e of events) latest.set(e.fpr, e);
  return [...latest.values()].filter((e) => e.kind === "bind").map(({ kind, ...b }) => b).sort((a, b) => b.height - a.height);
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
  const entry = Object.hasOwn(cache, address) ? cache[address] : undefined;
  const valid = entry && typeof entry.fetchedAt === "number" && Array.isArray(entry.bindings);
  if (valid) {
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
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
