/**
 * Q-Day attack, part 2 (live on qorechain-diana): an attacker who has recovered an account's CLASSICAL
 * (secp256k1) private key tries to link their own Qommit key to that account on-chain.
 *
 * The attacker can sign the transaction classically, but not with the account's ML-DSA-87 key. QoreChain requires
 * the hybrid signature (hybrid_signature_mode = required), so the chain itself refuses the forged link.
 *
 * Uses the deployer account from .env as the "victim" (we really do hold its classical key), so it's safe to run.
 *   pnpm qday-attack
 */
import { StargateClient } from "@cosmjs/stargate";
import { EthNativeSigner, MSG_SEND_TYPE_URL, getNetwork, unifiedAccountFromSeed } from "@qorechain/sdk";

const net = getNetwork("testnet");
const rest = net.endpoints.rest;
const rpc = net.endpoints.rpc;

const key = process.env.PRIVATE_KEY?.trim();
const recoveryCode = process.env.QORE_PQC_RECOVERY_CODE?.trim();
if (!key || !recoveryCode) throw new Error("needs PRIVATE_KEY and QORE_PQC_RECOVERY_CODE in .env");

// The victim account. In a real attack only the secp256k1 half would be known.
const victim = await unifiedAccountFromSeed(Uint8Array.from(Buffer.from(key.slice(2), "hex")), { recoveryCode });
// The attacker's own (impostor) Qommit key fingerprint.
const impostorFpr = Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => b.toString(16).padStart(2, "0"))
  .join("")
  .toUpperCase();

const acc = await fetch(`${rest}/cosmos/auth/v1beta1/accounts/${victim.cosmos}`).then((r) => r.json());
const base = acc.account?.base_account ?? acc.account ?? {};

console.log(`victim account:      ${victim.cosmos}`);
console.log(`attacker has:        its classical secp256k1 key (recovered on "Q-Day")`);
console.log(`forged statement:    qommit:bind:v1:${impostorFpr}`);
console.log(`signing:             classical only (attacker doesn't have the ML-DSA-87 key)\n`);

// signMode "classical": exactly what an attacker holding only the secp256k1 key can produce.
const signer = new EthNativeSigner(victim, { signMode: "classical", rest });
const transport = await StargateClient.connect(rpc);
try {
  const res = await signer.signAndBroadcast(transport, {
    chainId: net.chainId,
    accountNumber: BigInt(base.account_number ?? "0"),
    sequence: BigInt(base.sequence ?? "0"),
    fee: { amount: [{ denom: "uqor", amount: "100000" }], gas: "800000" },
    memo: `qommit:bind:v1:${impostorFpr}`,
    messages: [
      {
        typeUrl: MSG_SEND_TYPE_URL,
        value: { fromAddress: victim.cosmos, toAddress: victim.cosmos, amount: [{ denom: "uqor", amount: "1" }] },
      },
    ],
  });
  if (res.code === 0) {
    console.log(`⚠️  UNEXPECTED: the chain accepted a classical-only transaction (${res.transactionHash})`);
    process.exit(2);
  }
  console.log(`🛡️  QoreChain REJECTED the forged link (code ${res.code}): ${res.rawLog ?? ""}`);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.log(`🛡️  QoreChain REJECTED the forged link:\n    ${msg.split("\n")[0].slice(0, 300)}`);
} finally {
  transport.disconnect();
}
