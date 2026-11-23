// Shared Qommit logic for the web app: the on-chain binding format and chain lookups.

export const CHAIN_ID = "qorechain-diana";
export const REST_URL: string = import.meta.env.VITE_QORE_REST_URL ?? "/lcd";
export const EXPLORER_TX = "https://explore.qore.network/tx/";

const BIND_PREFIX = "qommit:bind:v1:";
export const FPR_RE = /^[0-9A-F]{40}$/;

/** Memo of the binding transaction: "<sender qor1…> owns qommit key <fingerprint>". Same format as the CLI. */
export const bindMemo = (fpr: string): string => `${BIND_PREFIX}${fpr}`;

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
    tx: { body: { memo?: string } };
  }[];
}

/** All successful qommit bindings sent by `address`, newest first. */
export async function findBindings(address: string): Promise<Binding[]> {
  const query = encodeURIComponent(`message.sender='${address}'`);
  const res = await fetch(`${REST_URL}/cosmos/tx/v1beta1/txs?query=${query}&order_by=ORDER_BY_DESC&pagination.limit=100`);
  if (!res.ok) throw new Error(`chain lookup failed (HTTP ${res.status})`);
  const data = (await res.json()) as TxSearchResponse;
  return (data.tx_responses ?? [])
    .filter((r) => r.code === 0 && (r.tx.body.memo ?? "").startsWith(BIND_PREFIX))
    .map((r) => ({
      fingerprint: (r.tx.body.memo ?? "").slice(BIND_PREFIX.length).toUpperCase(),
      txHash: r.txhash,
      height: Number(r.height),
      time: r.timestamp,
    }))
    .filter((b) => FPR_RE.test(b.fingerprint));
}
