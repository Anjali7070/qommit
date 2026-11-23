# Blind security review: 23 Nov 2026

**Reviewer:** a separate Claude Code agent (Claude Opus 5.5) with **no context**: it was given the repository, a
threat model and rules (read-only; never read `.env` or `~/.qommit`; no transactions), and none of our design
reasoning. **Fixes:** by the builder agent, approved by Anjali. Each fix has a regression test and a mutation-testing
mutant (`docs/ai/mutation.md`), so a regression fails the suite.

**Result:** 2 high, 4 medium, 6 low and 4 info findings. H-01, M-01 and L-02 were reproduced by the reviewer with a fake
REST/RPC server on 127.0.0.1. H-01 was reproduced again by the builder before fixing.

> **Reviewer side effect, reported by the reviewer itself.** Early on it ran `git log --format=%G?` inside the
> repository, whose `.git/config` uses Qommit as the signing program. That made read-only lookups to the public
> testnet REST/EVM endpoints and probably wrote `~/.qommit/chain-cache.json`. No transactions were sent and no
> secrets were read. After that it worked only in temp directories.

| ID | Finding | Status | Fix and evidence |
|---|---|---|---|
| **H-01** | Merge commits were skipped (`--no-merges`), and an empty range reported "0/0 pass", so a PR whose only new commit is an unsigned merge passed CI | ✅ Fixed | Merges are checked; an empty range is a failure. `cli/bin/qommit.mjs` `cmdVerify`. Tests: `review.test.mjs` "merge commits are checked", "an empty range is a failure" |
| **H-02** | For register/anchor/revoke the CLI signed whatever bytes the RPC's `eth_call` returned. A malicious RPC could return a git payload (`qommit-v2\naddr:<victim>…`) and harvest a commit signature from the relayed transaction | ✅ Fixed | Messages are built locally with `abi.encodePacked` (chain id 9800 + registry address). The RPC's copy is only a cross-check; on any mismatch the CLI refuses to sign. Checked byte-for-byte against the live contract. Test: "refuses to sign a registry message chosen by a malicious RPC" |
| **M-01** | Cache poisoning: an unvalidated claim like `addr="registry:<FPR>"` overwrote the shared cache's revocation entry, so a revoked key verified as ✅ for an hour. Revocation also failed open on RPC errors | ✅ Fixed | The identity claim must be a valid `qor1` address. Bindings and revocations use separate cache files with shape checks. If revocation can't be checked, the key isn't trusted (fails safe). Tests: "identity claim that isn't a qor1 address is rejected" |
| **M-02** | Phishing: a link with `?fpr=<attacker>` pre-filled the linking page; once approved, the attacker could sign as the victim, with no way to undo | 🟡 Mitigated | A warning appears whenever the fingerprint came from a link, and the user must tick "I ran `qommit whoami` on my own computer". New `qommit:unbind:v1:<fpr>` memo plus an **Unlink** button; the latest statement wins. Test: "an unbind withdraws an earlier bind". A user can still ignore the warning; see Limits |
| **M-03** | Anyone could anchor someone else's public commit first and permanently block the real signer's timestamp | ✅ Fixed | Anchors are stored per (commit, key). Registry redeployed at `0xB50B…7482`. CLI and web read only the signing key's own anchor. Test: `test_anchor_otherKeyCannotBlockMine` |
| **M-04** | Identity rests on one REST response; the PQ check accepted the extension even as *non-critical* | 🟡 Partly fixed | Only a **critical** `PQCHybridSignature` extension counts. A malicious or compromised REST endpoint could still invent a binding; light-client proofs are out of scope. See Limits. Test: "the post-quantum signature must be a critical extension" |
| **L-01** | `register` doesn't need the owner's consent, so `ownerOf` could mislead integrators | 📝 Accepted, documented | Users can't send EVM transactions from QoreX yet, so `msg.sender == owner` isn't possible today. The owner's consent is the native-lane bind memo, which every verifier in this repo requires. The contract's NatSpec now says integrators must check that bind |
| **L-02** | Unvalidated `addr`/`ts` printed raw: terminal-escape spoofing of `git log` output, fake GitHub workflow commands | ✅ Fixed | `addr` must be bech32 and `ts` a non-negative integer. Every printed field is stripped of control characters, and annotations use GitHub's escaping. Tests: "validly signed non-integer timestamp", "identity claim…" |
| **L-03** | GPG/SSH commits trusted by the verifier's local keyring counted as "quantum-signed" | ✅ Fixed | `verify` disables `gpg.program` and `gpg.ssh.program`, so only Qommit signatures can pass. Test: "a classical (SSH) signature never counts" |
| **L-04** | CI ran the PR's own copy of the action; actions pinned by tag; credentials persisted; forge-std unpinned | ✅ Fixed | The check runs from the base branch's copy. Actions are pinned to commit SHAs, `persist-credentials: false`, and forge-std is pinned to `v1.17.0`. A secret-scan job runs on every push |
| **L-05** | v1 signatures: an unsigned `addr` field in a v1 body could be used to steal attribution | ✅ Fixed | v1 bodies' `addr`/`ts` are ignored. Test: "identity claim added to a v1 signature is ignored" |
| **L-06** | A 1-hour "not revoked" cache delays revocation; keys never registered can't be revoked | 🟡 Mitigated | "Not revoked" is cached for 10 minutes, "revoked" permanently. Unregistered keys can be withdrawn with **unbind** (M-02) |
| **I-01** | Open proxy (any path or method to the REST API); no CSP | ✅ Fixed | The rewrite is limited to `/cosmos/tx/v1beta1/txs`. Content-Security-Policy added (`default-src 'self'`, explicit `connect-src`, `frame-ancestors 'none'`) |
| **I-02** | `pqcKeyStatus` `algorithmId` and `possessionProven` ignored | 🟡 Partly fixed | `algorithmId` must be 1 (ML-DSA-87). Test: `test_register_ownerMustUseMlDsa87`. `possessionProven` is *not* required: accounts registered through the QoreChain Dashboard (including ours) have `possessionProven = false` |
| **I-03** | Cache entries not shape-checked (`addr="__proto__"` crashed the verifier, failing closed) | ✅ Fixed | `Object.hasOwn` plus shape validation, and the claim must be bech32 anyway |
| **I-04** | Identity lives on testnet; with `pagination.limit=100` busy accounts can push bindings out of view (fails closed) | 📝 Accepted, documented | See Limits in `AI_USAGE.md` |

## Checked and held (from the reviewer)

- v2 signs the address claim and timestamp. The fingerprint must equal the hash of the embedded key. Git signatures
  (`qommit-v1:` / `qommit-v2\n`) and registry messages (`qommit:*:v1` + chain id + contract) are domain-separated,
  so a signature for one can't be replayed as the other.
- Injected `TRUST_FULLY` / `TRUST_ULTIMATE` status text can't upgrade `U` to `G`.
- `parseBindings` requires code 0, a `MsgSend` from the address itself, and a 40-hex fingerprint.
- Contract: the register signature binds the owner, so front-running can't redirect it. Cross-chain and
  cross-registry replay fail. Revoked keys can't be re-registered. An inactive precompile makes the call revert
  (fails closed), which was tested in a temp Foundry project.
- `mldsa87.verify` never throws on malformed input.
- Action inputs and event data reach the shell through `env` (no injection). The trigger is `pull_request`, not
  `pull_request_target`, with `contents: read`.
- Web: no `dangerouslySetInnerHTML`; external links use fixed `https` prefixes with `rel=noreferrer`.
- The key file is 0600 in a 0700 directory; `.env` files were never in git history; no secrets are in `web/dist`;
  CLI dependencies are lockfile-pinned and have no install scripts.

## Assumptions the reviewer could not verify

- QoreChain verifies hybrid signatures on every transaction that carries the extension, and rejects classical-only
  transactions from PQC-registered accounts. **The last part was later confirmed live:** `pnpm qday-attack` was refused with
  `must include the hybrid signature extension (hybrid mode: required)`.
- `pqcVerify` is plain ML-DSA-87 with no context string. **Confirmed live** before the contract was written (valid →
  true, tampered → false), and again by every real `register`/`anchor` transaction.
