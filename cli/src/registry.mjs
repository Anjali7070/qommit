// QommitRegistry (EVM, qorechain-diana): register / revoke keys and anchor commits.
// Every call carries an ML-DSA-87 signature from the Qommit key, checked on-chain by QoreChain's pqcVerify precompile,
// so the relayer that pays gas can't change what is registered.

import { createPublicClient, createWalletClient, http, parseAbi, toHex, keccak256, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mldsa87 } from "@qorechain/pqc";
import { decodeBech32 } from "./bech32.mjs";

export const REGISTRY = process.env.QOMMIT_REGISTRY || "0x6F329640728572D6213193171760E88BBf57e03D";
const RPC = process.env.QOMMIT_EVM_RPC || "https://evm-testnet.qore.host";
const chain = defineChain({
  id: 9800,
  name: "QoreChain testnet (diana)",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const abi = parseAbi([
  "function registerMessage(address owner) view returns (bytes)",
  "function revokeMessage() view returns (bytes)",
  "function anchorMessage(bytes20 commit) view returns (bytes)",
  "function keys(bytes32) view returns (address owner, uint64 registeredAt, uint64 revokedAt)",
  "function anchors(bytes20) view returns (bytes32 keyId, uint64 timestamp, uint64 blockNumber)",
  "function register(address owner, bytes pubkey, bytes sig) returns (bytes32)",
  "function revoke(bytes pubkey, bytes sig)",
  "function anchor(bytes pubkey, bytes20 commit, bytes sig)",
]);

const reader = () => createPublicClient({ chain, transport: http(RPC) });
export const qorToEvm = (qor) => toHex(decodeBech32(qor));
export const keyIdOf = (publicKey) => keccak256(toHex(publicKey));

/** Registry record for a public key: { owner, registeredAt, revokedAt } (registeredAt 0 = unknown). */
export async function readKey(publicKey) {
  const [owner, registeredAt, revokedAt] = await reader().readContract({
    address: REGISTRY, abi, functionName: "keys", args: [keyIdOf(publicKey)],
  });
  return { owner, registeredAt: Number(registeredAt), revokedAt: Number(revokedAt) };
}

export async function readAnchor(commit) {
  const [keyId, timestamp, blockNumber] = await reader().readContract({
    address: REGISTRY, abi, functionName: "anchors", args: [`0x${commit}`],
  });
  return { keyId, timestamp: Number(timestamp), blockNumber: Number(blockNumber) };
}

// The contract builds each message itself (bound to chain id + registry address); we sign exactly those bytes.
async function signContractMessage(key, functionName, args) {
  const message = await reader().readContract({ address: REGISTRY, abi, functionName, args });
  return toHex(mldsa87.sign(key.secretKey, Buffer.from(message.slice(2), "hex")));
}

async function send(relayerKey, functionName, args) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(relayerKey ?? "")) {
    throw new Error("set QOMMIT_RELAYER_KEY to an EVM private key with a registered PQC key and an open EVM window");
  }
  const account = privateKeyToAccount(relayerKey);
  const wallet = createWalletClient({ account, chain, transport: http(RPC) });
  const hash = await wallet.writeContract({ address: REGISTRY, abi, functionName, args });
  const receipt = await reader().waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`transaction reverted: ${hash}`);
  return hash;
}

export async function registerKey(key, ownerQor, relayerKey) {
  const owner = qorToEvm(ownerQor);
  const sig = await signContractMessage(key, "registerMessage", [owner]);
  return send(relayerKey, "register", [owner, toHex(key.publicKey), sig]);
}

export async function revokeKey(key, relayerKey) {
  const sig = await signContractMessage(key, "revokeMessage", []);
  return send(relayerKey, "revoke", [toHex(key.publicKey), sig]);
}

export async function anchorCommit(key, commit, relayerKey) {
  const c = `0x${commit}`;
  const sig = await signContractMessage(key, "anchorMessage", [c]);
  return send(relayerKey, "anchor", [toHex(key.publicKey), c, sig]);
}
