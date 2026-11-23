#!/usr/bin/env node
// Mutation testing: plant one deliberate bug at a time in a temporary copy of the code and check that the test suite
// fails ("killed"). A mutant that survives means the tests can't tell the bug apart from correct code.
// The repository itself is never modified.
//
//   node scripts/mutation-test.mjs            → prints a table and writes docs/ai/mutation.md

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Each mutant: [package, file, exact text to find, replacement, what the bug would mean]
const MUTANTS = [
  // ── cli: signature verification (src/core.mjs)
  ["cli", "src/core.mjs", "const ok = mldsa87.verify(", "const ok = true || mldsa87.verify(", "accept any signature"],
  ["cli", "src/core.mjs", "if (fingerprintOf(publicKey) !== fpr) return", "if (false) return", "skip the fingerprint/key match"],
  ["cli", "src/core.mjs", "`qommit-v2\\naddr:${addr}\\nts:${ts}\\n\\n`", "`qommit-v2\\naddr:\\nts:${ts}\\n\\n`", "address claim not covered by the signature"],
  ["cli", "src/core.mjs", "`qommit-v2\\naddr:${addr}\\nts:${ts}\\n\\n`", "`qommit-v2\\naddr:${addr}\\nts:0\\n\\n`", "timestamp not covered by the signature"],
  ["cli", "src/core.mjs", "if ((v !== 1 && v !== 2) || alg !== ALG)", "if (false)", "accept unknown versions/algorithms"],
  ["cli", "src/core.mjs", "`qommit:bind:v1:${fpr}`", "`qommit:bind:v2:${fpr}`", "CLI writes a bind memo the verifier won't recognise"],
  // ── cli: on-chain identity rules (src/chain.mjs)
  ["cli", "src/chain.mjs", "if (r.code !== 0 || !kind) continue;", "if (!kind) continue;", "count failed transactions as bindings"],
  ["cli", "src/chain.mjs", "m.from_address === address", "true", "count a binding sent by someone else"],
  ["cli", "src/chain.mjs", "if (fromSelf && hybrid)", "if (fromSelf)", "count a binding without the post-quantum signature"],
  ["cli", "src/chain.mjs", "    if (!/^[0-9A-F]{40}$/.test(fpr)) continue;\n    const fromSelf", "    const fromSelf", "accept malformed fingerprints"],
  ["cli", "src/chain.mjs", "BIND_PREFIX.length : UNBIND_PREFIX.length).toUpperCase();", "BIND_PREFIX.length : UNBIND_PREFIX.length);", "case-sensitive fingerprint matching"],
  ["cli", "src/chain.mjs", "      } catch {}\n", "      } finally {}\n", "a cache write error breaks verification (the CI bug)"],
  ["cli", "src/chain.mjs", "const hybrid = (body.extension_options ?? [])", "const hybrid = [...(body.extension_options ?? []), ...(body.non_critical_extension_options ?? [])]", "a non-critical PQ extension counts (review M-04)"],
  ["cli", "src/chain.mjs", 'return [...latest.values()].filter((e) => e.kind === "bind")', "return [...latest.values()]", "an unbind doesn't withdraw the key (review M-02)"],
  ["cli", "src/chain.mjs", "events.sort((a, b) => a.height - b.height);", "events.sort((a, b) => b.height - a.height);", "older statements override newer ones"],
  ["cli", "src/core.mjs", 'const addr = v === 1 ? "" : body.addr ?? "";', 'const addr = body.addr ?? "";', "unsigned v1 identity claims are trusted (review L-05)"],
  ["cli", "src/core.mjs", 'if (addr !== "" && !isValidBech32(addr, "qor"))', "if (false)", "identity claim needn't be a qor1 address (review M-01/L-02)"],
  ["cli", "src/core.mjs", "if (!Number.isSafeInteger(ts) || ts < 0)", "if (false)", "timestamp needn't be an integer (review L-02)"],
  ["cli", "src/registry.mjs", "if (String(theirs).toLowerCase() !== mine.toLowerCase()) {", "if (false) {", "sign whatever the RPC returns (review H-02)"],
  ["cli", "bin/qommit.mjs", '        "log", "--format=', '        "log", "--no-merges", "--format=', "merge commits skipped (review H-01)"],
  ["cli", "bin/qommit.mjs", '  if (!rows.length) die(', "  if (false) die(", "an empty range passes (review H-01)"],
  ["cli", "bin/qommit.mjs", '"-c", "gpg.program=false", "-c", "gpg.ssh.program=false",', "", "classical GPG/SSH signatures count (review L-03)"],
  // ── cli: address checks (src/bech32.mjs)
  ["cli", "src/bech32.mjs", "return polymod([...hrpExpand(hrp), ...data]) === 1;", "return true;", "skip the address checksum (typos accepted)"],
  ["cli", "src/bech32.mjs", "if (hrp !== prefix) return false;", "", "accept another chain's address prefix"],
  ["cli", "src/bech32.mjs", "if (bits >= 8) out.push((acc >>> (bits -= 8)) & 0xff);", "if (bits >= 8) out.push((acc >>> (bits -= 8)) & 0x7f);", "corrupt decoded address bytes"],
  // ── contracts: QommitRegistry.sol
  ["contracts", "src/QommitRegistry.sol", "if (!PQC_VERIFY.pqcVerify(pubkey, sig, registerMessage(owner))) revert InvalidSignature();", "", "register without a valid signature"],
  ["contracts", "src/QommitRegistry.sol", 'abi.encodePacked("qommit:register:v1", block.chainid, address(this), owner)', 'abi.encodePacked("qommit:register:v1", block.chainid, address(this))', "registration signature doesn't name the owner"],
  ["contracts", "src/QommitRegistry.sol", 'abi.encodePacked("qommit:register:v1", block.chainid, address(this), owner)', 'abi.encodePacked("qommit:register:v1", address(this), owner)', "signature replayable on another chain"],
  ["contracts", "src/QommitRegistry.sol", 'abi.encodePacked("qommit:register:v1", block.chainid, address(this), owner)', 'abi.encodePacked("qommit:register:v1", block.chainid, owner)', "signature replayable on another registry"],
  ["contracts", "src/QommitRegistry.sol", "if (!ownerRegistered || algorithmId != 1) revert OwnerNotQuantumProtected(owner);", "", "owner needn't be quantum-protected"],
  ["contracts", "src/QommitRegistry.sol", "if (!ownerRegistered || algorithmId != 1)", "if (!ownerRegistered)", "owner's key needn't be ML-DSA-87 (review I-02)"],
  ["contracts", "src/QommitRegistry.sol", "if (keys[keyId].registeredAt != 0) revert AlreadyRegistered(keyId);", "", "a key can be re-registered (owner overwritten)"],
  ["contracts", "src/QommitRegistry.sol", "if (k.revokedAt != 0) revert KeyIsRevoked(keyId);", "", "revoked keys keep working"],
  ["contracts", "src/QommitRegistry.sol", "if (anchors[commit][keyId].timestamp != 0) revert AlreadyAnchored(commit);", "", "a commit's anchor can be overwritten"],
  ["contracts", "src/QommitRegistry.sol", 'abi.encodePacked("qommit:anchor:v1", block.chainid, address(this), commit)', 'abi.encodePacked("qommit:anchor:v1", block.chainid, address(this))', "anchor signature not bound to the commit"],
  ["contracts", "src/QommitRegistry.sol", 'abi.encodePacked("qommit:revoke:v1", block.chainid, address(this))', 'abi.encodePacked("qommit:register:v1", block.chainid, address(this))', "revoke and register messages collide"],
  ["contracts", "src/QommitRegistry.sol", "if (pubkey.length != ML_DSA_87_PUBKEY_LENGTH) revert InvalidPublicKey();", "", "accept malformed public keys"],
];

const TEST = {
  cli: ["node", ["--test"]],
  contracts: ["forge", ["test"]],
};

function sandbox(pkg) {
  const dir = mkdtempSync(join(tmpdir(), `qommit-mut-${pkg}-`));
  const src = join(ROOT, pkg);
  for (const entry of ["src", "test", "bin", "script", "package.json", "foundry.toml"]) {
    try {
      cpSync(join(src, entry), join(dir, entry), { recursive: true });
    } catch {}
  }
  for (const dep of ["node_modules", "lib"]) {
    try {
      symlinkSync(join(src, dep), join(dir, dep));
    } catch {}
  }
  return dir;
}

function passes(pkg, dir) {
  const [cmd, args] = TEST[pkg];
  try {
    execFileSync(cmd, args, { cwd: dir, stdio: "pipe", timeout: 300_000, env: { ...process.env, QOMMIT_OFFLINE: "1" } });
    return true;
  } catch {
    return false;
  }
}

const results = [];
for (const pkg of ["cli", "contracts"]) {
  const base = sandbox(pkg);
  if (!passes(pkg, base)) throw new Error(`${pkg}: the unmutated test suite fails; fix that first`);
  rmSync(base, { recursive: true, force: true });
}
for (const [pkg, file, find, replace, meaning] of MUTANTS) {
  const dir = sandbox(pkg);
  const path = join(dir, file);
  const code = readFileSync(path, "utf8");
  if (!code.includes(find)) throw new Error(`mutant not applicable (text not found): ${file}: ${find}`);
  writeFileSync(path, code.replace(find, replace));
  const killed = !passes(pkg, dir);
  rmSync(dir, { recursive: true, force: true });
  results.push({ pkg, file, meaning, killed });
  console.log(`${killed ? "killed  " : "SURVIVED"}  ${pkg}/${file}: ${meaning}`);
}

const killed = results.filter((r) => r.killed).length;
const summary = `${killed}/${results.length} mutants killed`;
console.log(`\n${summary}`);

const date = new Date().toISOString().slice(0, 10);
const md = [
  "# Mutation testing",
  "",
  `Run on ${date} with \`node scripts/mutation-test.mjs\`. Each row plants one deliberate bug in a temporary copy of the`,
  "code and runs the test suite (`node --test` for the CLI, `forge test` for the contract). **Killed** = the tests",
  "caught it. **Survived** = they didn't (a gap). The repository itself is never modified.",
  "",
  `**Result: ${summary}.**`,
  "",
  "History: the first run (2026-11-23) killed **21/26**. The 5 survivors were test gaps, not code bugs. The tests",
  "added for them are: an attacker signing with their own key while claiming someone else's fingerprint; a valid",
  "signature relabelled as another version or algorithm; a CLI bind memo round-tripped through the on-chain parser;",
  "a cache path that can't be created at all (the first regression test let the directory be created, so the error",
  "path never ran); and a check that register/revoke/anchor messages carry distinct domain labels. Re-run: 26/26.",
  "",
  "After the blind security review (docs/ai/reviews/2026-11-23-blind-review.md), a mutant was added for each fix",
  "(marked \"review …\"), so the fixes are proven by tests, not just written. That run killed 36/37: the L-02",
  "timestamp test passed for the wrong reason (the attacker's signature didn't match, so the timestamp check never",
  "ran). It was replaced by a test where the attacker validly signs a malicious timestamp. Re-run: 37/37.",
  "",
  "| # | Where | Planted bug (what it would mean) | Result |",
  "|---|---|---|---|",
  ...results.map((r, i) => `| ${i + 1} | \`${r.pkg}/${r.file}\` | ${r.meaning} | ${r.killed ? "✅ killed" : "❌ survived"} |`),
  "",
].join("\n");
mkdirSync(join(ROOT, "docs/ai"), { recursive: true });
writeFileSync(join(ROOT, "docs/ai/mutation.md"), md);
console.log("wrote docs/ai/mutation.md");
