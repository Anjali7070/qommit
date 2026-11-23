// Read-only access to QommitRegistry over the QoreChain EVM RPC (which allows browser requests).

import { createPublicClient, http, keccak256, parseAbi, toHex } from "viem";

export const REGISTRY = "0x6F329640728572D6213193171760E88BBf57e03D" as const;
export const EVM_RPC: string = import.meta.env.VITE_QORE_EVM_RPC_URL ?? "https://evm-testnet.qore.host";

const client = createPublicClient({ transport: http(EVM_RPC, { batch: true }) });
const abi = parseAbi([
  "function keys(bytes32) view returns (address owner, uint64 registeredAt, uint64 revokedAt)",
  "function anchors(bytes20) view returns (bytes32 keyId, uint64 timestamp, uint64 blockNumber)",
]);

export interface KeyRecord {
  owner: string;
  registeredAt: number;
  revokedAt: number;
}

export async function readKey(publicKey: Uint8Array): Promise<KeyRecord> {
  const [owner, registeredAt, revokedAt] = await client.readContract({
    address: REGISTRY,
    abi,
    functionName: "keys",
    args: [keccak256(toHex(publicKey))],
  });
  return { owner, registeredAt: Number(registeredAt), revokedAt: Number(revokedAt) };
}

/** Block timestamp at which `sha` was anchored, or 0. */
export async function readAnchor(sha: string): Promise<{ timestamp: number; blockNumber: number }> {
  const [, timestamp, blockNumber] = await client.readContract({
    address: REGISTRY,
    abi,
    functionName: "anchors",
    args: [`0x${sha}`],
  });
  return { timestamp: Number(timestamp), blockNumber: Number(blockNumber) };
}
