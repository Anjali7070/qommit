// Shared Qommit logic for the web app: the on-chain binding format and chain lookups.

export const CHAIN_ID = "qorechain-diana";
export const REST_URL: string = import.meta.env.VITE_QORE_REST_URL ?? "/lcd";
export const EXPLORER = "https://explore.qore.network";

const BIND_PREFIX = "qommit:bind:v1:";
const UNBIND_PREFIX = "qommit:unbind:v1:";
const HYBRID_EXT = "/qorechain.pqc.v1.PQCHybridSignature";
const MSG_SEND = "/cosmos.bank.v1beta1.MsgSend";
export const FPR_RE = /^[0-9A-F]{40}$/;

/** Memo of the binding transaction: "<sender qor1…> owns qommit key <fingerprint>". Same format as the CLI. */
export const bindMemo = (fpr: string): string => `${BIND_PREFIX}${fpr}`;
/** Withdraws a binding (e.g. a key linked by mistake or through a phishing link). */
export const unbindMemo = (fpr: string): string => `${UNBIND_PREFIX}${fpr}`;

export interface Binding {
  fingerprint: string;
  txHash: string;
  height: number;
  time: string;
}

interface TxSearchResponse {
  tx_responses?: {
    txhash: string;
    height: string;
    timestamp: string;
    code: number;
    tx: {
      body: {
        memo?: string;
        messages?: { "@type": string; from_address?: string }[];
        extension_options?: { "@type": string }[];
      };
    };
  }[];
}

/**
 * Qommit bindings published by `address`, newest first. Same rules as the CLI (cli/src/chain.mjs): the transaction
 * succeeded, was a MsgSend from `address` itself, and carries the hybrid ML-DSA-87 signature extension.
 */
export async function findBindings(address: string): Promise<Binding[]> {
  const query = encodeURIComponent(`message.sender='${address}'`);
  const res = await fetch(`${REST_URL}/cosmos/tx/v1beta1/txs?query=${query}&order_by=ORDER_BY_DESC&pagination.limit=100`);
  if (!res.ok) throw new Error(`QoreChain lookup failed (HTTP ${res.status})`);
  const data = (await res.json()) as TxSearchResponse;
  // Replay bind/unbind oldest-first; a key counts if its latest statement is "bind". Same rules as the CLI.
  const events: (Binding & { kind: "bind" | "unbind" })[] = [];
  for (const r of data.tx_responses ?? []) {
    const body = r.tx.body;
    const memo = body.memo ?? "";
    const kind = memo.startsWith(BIND_PREFIX) ? "bind" : memo.startsWith(UNBIND_PREFIX) ? "unbind" : null;
    if (r.code !== 0 || !kind) continue;
    const fingerprint = memo.slice((kind === "bind" ? BIND_PREFIX : UNBIND_PREFIX).length).toUpperCase();
    const fromSelf = (body.messages ?? []).some((m) => m["@type"] === MSG_SEND && m.from_address === address);
    // Only a critical extension counts: a non-critical one may be ignored by nodes.
    const hybrid = (body.extension_options ?? []).some((e) => e["@type"] === HYBRID_EXT);
    if (FPR_RE.test(fingerprint) && fromSelf && hybrid) {
      events.push({ kind, fingerprint, txHash: r.txhash, height: Number(r.height), time: r.timestamp });
    }
  }
  events.sort((a, b) => a.height - b.height);
  const latest = new Map<string, (typeof events)[number]>();
  for (const e of events) latest.set(e.fingerprint, e);
  return [...latest.values()]
    .filter((e) => e.kind === "bind")
    .map(({ kind: _kind, ...b }) => b)
    .sort((a, b) => b.height - a.height);
}

const bindingCache = new Map<string, Promise<Binding[]>>();
/** findBindings, memoised per address for the lifetime of the page. */
export function findBindingsCached(address: string): Promise<Binding[]> {
  let p = bindingCache.get(address);
  if (!p) {
    p = findBindings(address);
    p.catch(() => bindingCache.delete(address));
    bindingCache.set(address, p);
  }
  return p;
}
