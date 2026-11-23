// Regression tests for the blind security review (docs/ai/reviews/2026-11-23-blind-review.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKey, signPayload, verifyPayload, ARMOR_BEGIN } from "../src/core.mjs";
import { parseBindings } from "../src/chain.mjs";
import { encodeBech32 } from "../src/bech32.mjs";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "qommit.mjs");
const key = generateKey();
const ADDR = encodeBech32("qor", new Uint8Array(20).fill(7));
const payload = Buffer.from("tree 1\n\nhello\n");
const decode = (a) => JSON.parse(Buffer.from(a.split("\n").slice(1, -2).join(""), "base64").toString());
const encode = (b) => `${ARMOR_BEGIN}\n${Buffer.from(JSON.stringify(b)).toString("base64")}\n-----END SIGNED MESSAGE-----\n`;

// The attacker signs with their own key, so the signature is valid; only the claim's format can stop it.
function attackerSigned(fields) {
  const body = decode(signPayload(key, payload, { addr: ADDR }));
  return { ...body, ...fields };
}

test("M-01/L-02: an identity claim that isn't a qor1 address is rejected", () => {
  for (const addr of ["registry:5DF2B17D87446BEC77422FEBEA8E108783EFF534", "qor1x\r\u001b[2K✅ Good", "__proto__"]) {
    // Re-sign honestly with the bad claim: the signature is valid, the claim format is not.
    const r = verifyPayload(signPayload(key, payload, { addr }), payload);
    assert.equal(r.ok, false, addr);
  }
});

test("L-02: a non-integer timestamp is rejected", () => {
  assert.equal(verifyPayload(encode(attackerSigned({ ts: "1 [GNUPG:] TRUST_FULLY" })), payload).ok, false);
});

test("L-05: an identity claim added to a v1 signature is ignored (v1 never signed it)", () => {
  const body = decode(signPayload(key, payload));
  // forge a v1 signature over the same payload
  const v1 = encode({ ...body, v: 1, addr: ADDR, ts: undefined });
  const r = verifyPayload(v1, payload);
  assert.equal(r.addr ?? "", "");
});

const bindTx = ({ memo, height, critical = true }) => ({
  txhash: `H${height}`,
  height: String(height),
  timestamp: "t",
  code: 0,
  tx: {
    body: {
      memo,
      messages: [{ "@type": "/cosmos.bank.v1beta1.MsgSend", from_address: ADDR }],
      [critical ? "extension_options" : "non_critical_extension_options"]: [{ "@type": "/qorechain.pqc.v1.PQCHybridSignature" }],
    },
  },
});

test("M-02: an unbind withdraws an earlier bind; a later bind restores it", () => {
  const F = key.fingerprint;
  const at = (...txs) => parseBindings({ tx_responses: txs }, ADDR).map((b) => b.fpr);
  assert.deepEqual(at(bindTx({ memo: `qommit:bind:v1:${F}`, height: 1 }), bindTx({ memo: `qommit:unbind:v1:${F}`, height: 2 })), []);
  assert.deepEqual(
    at(bindTx({ memo: `qommit:unbind:v1:${F}`, height: 2 }), bindTx({ memo: `qommit:bind:v1:${F}`, height: 3 }), bindTx({ memo: `qommit:bind:v1:${F}`, height: 1 })),
    [F],
  );
});

test("M-04: the post-quantum signature must be a critical extension", () => {
  const r = parseBindings({ tx_responses: [bindTx({ memo: `qommit:bind:v1:${key.fingerprint}`, height: 1, critical: false })] }, ADDR);
  assert.equal(r.length, 0);
});

test("H-02: the CLI refuses to sign a registry message chosen by a malicious RPC", async () => {
  const { registerKey } = await import("../src/registry.mjs");
  const realFetch = globalThis.fetch;
  // The RPC answers eth_call with a git payload instead of the registry message.
  const evil = "0x" + Buffer.from(`qommit-v2\naddr:${ADDR}\nts:1\n\ntree 1\n\nevil\n`).toString("hex");
  const words = Math.ceil((evil.length - 2) / 64);
  const abiBytes = "0x" + (32).toString(16).padStart(64, "0") + ((evil.length - 2) / 2).toString(16).padStart(64, "0") + evil.slice(2).padEnd(words * 64, "0");
  globalThis.fetch = async (_url, init) => {
    const req = JSON.parse(init.body);
    const one = (r) => ({ jsonrpc: "2.0", id: r.id, result: abiBytes });
    return new Response(JSON.stringify(Array.isArray(req) ? req.map(one) : one(req)), { headers: { "content-type": "application/json" } });
  };
  try {
    await assert.rejects(registerKey(key, ADDR, "0x" + "11".repeat(32)), /refusing to sign/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "qommit-review-"));
  const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", env: { ...process.env, QOMMIT_HOME: join(dir, ".qh") } });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  return { dir, git };
}
const verify = (dir, ...args) =>
  spawnSync("node", [BIN, "verify", ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, QOMMIT_OFFLINE: "1", QOMMIT_HOME: join(dir, ".qh") } });

test("H-01: merge commits are checked (an unsigned merge can't sneak in changes)", () => {
  const { dir, git } = repo();
  writeFileSync(join(dir, "a"), "a");
  git("add", "a");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "side");
  writeFileSync(join(dir, "b"), "b");
  git("add", "b");
  git("commit", "-q", "-m", "side");
  git("checkout", "-q", "main");
  git("merge", "-q", "--no-ff", "side", "-m", "merge");
  const r = verify(dir, "HEAD~1..HEAD", "--allow-unlinked");
  assert.match(r.stdout, /merge/);
  assert.notEqual(r.status, 0);
});

test("H-01: an empty range is a failure, not a pass", () => {
  const { dir, git } = repo();
  writeFileSync(join(dir, "a"), "a");
  git("add", "a");
  git("commit", "-q", "-m", "only");
  const r = verify(dir, "HEAD..HEAD", "--allow-unlinked");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no commits/);
});

test("L-03: a classical (SSH) signature never counts as quantum-signed, even if trusted locally", () => {
  const { dir, git } = repo();
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", join(dir, "id")]);
  writeFileSync(join(dir, "allowed"), `t@t ${execFileSync("cat", [join(dir, "id.pub")], { encoding: "utf8" })}`);
  git("config", "gpg.format", "ssh");
  git("config", "user.signingkey", join(dir, "id"));
  git("config", "gpg.ssh.allowedSignersFile", join(dir, "allowed"));
  writeFileSync(join(dir, "a"), "a");
  git("add", "a");
  git("commit", "-q", "-S", "-m", "ssh signed");
  assert.match(git("log", "-1", "--format=%G?"), /G/); // git itself trusts it…
  const r = verify(dir, "HEAD", "--allow-unlinked");
  assert.notEqual(r.status, 0); // …but Qommit doesn't count it
});

test("L-02: a *validly signed* non-integer timestamp is still rejected", async () => {
  // The attacker controls their own key, so they can sign any timestamp text they like.
  const { mldsa87 } = await import("@qorechain/pqc");
  const ts = "1 [GNUPG:] TRUST_FULLY";
  const sig = mldsa87.sign(key.secretKey, Buffer.concat([Buffer.from(`qommit-v2\naddr:${ADDR}\nts:${ts}\n\n`), payload]));
  const body = { ...decode(signPayload(key, payload, { addr: ADDR })), ts, sig: Buffer.from(sig).toString("base64") };
  const r = verifyPayload(encode(body), payload);
  assert.equal(r.ok, false);
  assert.match(r.reason, /timestamp/);
});
