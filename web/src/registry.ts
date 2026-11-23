// Read-only access to QommitRegistry over the QoreChain EVM RPC (which allows browser requests).

import { createPublicClient, http, keccak256, parseAbi, toHex } from "viem";

export const REGISTRY = "0xB50BB93b40Ff7D7900ee3850699646c47A567482" as const;
export const EVM_RPC: string = import.meta.env.VITE_QORE_EVM_RPC_URL ?? "https://evm-testnet.qore.host";

const client = createPublicClient({ transport: http(EVM_RPC, { batch: true }) });
const abi = parseAbi([
  "function keys(bytes32) view returns (address owner, uint64 registeredAt, uint64 revokedAt)",
  "function anchors(bytes20 commit, bytes32 keyId) view returns (uint64 timestamp, uint64 blockNumber)",
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

/** When the holder of `publicKey` anchored `sha` (other keys' anchors don't count), or 0. */
export async function readAnchor(sha: string, publicKey: Uint8Array): Promise<{ timestamp: number; blockNumber: number }> {
  const [timestamp, blockNumber] = await client.readContract({
    address: REGISTRY,
    abi,
    functionName: "anchors",
    args: [`0x${sha}`, keccak256(toHex(publicKey))],
  });
  return { timestamp: Number(timestamp), blockNumber: Number(blockNumber) };
}
