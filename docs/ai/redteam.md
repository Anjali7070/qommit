# Breaking Qommit on purpose

What would a forger try? Each row is an attempt to get a ✅ for a commit that doesn't deserve one, and what happened.
Nothing here is hypothetical: every row was run as a unit test, a planted bug, a live testnet transaction or a local
reproduction. **Held** means the attempt failed. **Gap** means it worked at first and has since been closed.

| # | Attack | Outcome | Evidence |
|---|---|---|---|
| 1 | Change a signed commit's message or content, keep the signature | ✅ Held | `core.test.mjs` "changed commit content"; demo Act 2 (`❌ BAD`) |
| 2 | Edit the signed address claim to someone else's `qor1` | ✅ Held | `core.test.mjs` "edited address claim is rejected" |
| 3 | Edit the signed timestamp | ✅ Held | `core.test.mjs` "edited timestamp" |
| 4 | Swap in another public key | ✅ Held | `core.test.mjs` "swapping in another public key" |
| 5 | Sign with your own key but claim the victim's fingerprint | ✅ Held (test added after mutation testing) | `core.test.mjs` "can't claim someone else's fingerprint" |
| 6 | Relabel a valid signature as another version or algorithm | ✅ Held (test added after mutation testing) | `core.test.mjs` "relabelled with another version or algorithm" |
| 7 | Make a new post-quantum key that claims the victim's identity | ✅ Held: valid but not linked, so untrusted | demo Act 2; `chain.test.mjs` |
| 8 | Post a bind memo for your key from someone else's account | ✅ Held | `chain.test.mjs` "sent by someone else doesn't count" |
| 9 | A bind memo in a failed transaction, or without the post-quantum signature | ✅ Held | `chain.test.mjs` |
| 10 | **Fake the on-chain link with a leaked classical (secp256k1) wallet key** | ✅ Held, **refused by QoreChain itself** | Live: `pnpm qday-attack` → `code 20 (pqc): must include the hybrid signature extension (hybrid mode: required)` |
| 11 | A classical SSH/GPG forgery after "Q-Day" | ❌ Succeeds against classical signing (that's the problem Qommit solves); Qommit doesn't count classical signatures (#21) | demo Act 1: git says *Good* for the forged backdoor commit |
| 12 | Register someone else's key, or redirect a registration to another owner | ✅ Held | `QommitRegistry.t.sol` `cannotRedirectOwner`, fuzz `onlySignedOwner` (256 runs) |
| 13 | Replay a registration on another chain or another registry | ✅ Held | `replayOnOtherChainFails`, `replayOnOtherRegistryFails` |
| 14 | Reuse a register signature to revoke, or a revoke signature to register | ✅ Held | `registerSignatureCannotBeReusedToRevoke`, `revokeSignatureCannotRegister` |
| 15 | Keep using or re-register a revoked key | ✅ Held | `revoked_keyCannotBeReRegistered`, `anchor_revokedKeyFails`; CLI git status `R` |
| 16 | **Unsigned merge commit carrying a backdoor through CI** | ⚠️ Gap, fixed | review H-01 → `review.test.mjs` merge and empty-range tests |
| 17 | **Malicious RPC gets the CLI to sign a forged git payload** | ⚠️ Gap, fixed | review H-02 → messages built locally, mismatch refused; `review.test.mjs` |
| 18 | **Poison the cache so a revoked key verifies** | ⚠️ Gap, fixed | review M-01 → bech32 claims, separate caches, fail-safe revocation |
| 19 | **Phishing link that links the attacker's key to the victim** | ⚠️ Gap, mitigated | review M-02 → warning, required confirmation, `unbind` + **Unlink** |
| 20 | **Anchor a victim's commit first to block their timestamp** | ⚠️ Gap, fixed (contract redeployed) | review M-03 → per-key anchors; `anchor_otherKeyCannotBlockMine` |
| 21 | Get a locally trusted GPG/SSH commit counted as "quantum-signed" | ⚠️ Gap, fixed | review L-03 → `review.test.mjs` SSH test |
| 22 | Terminal-escape or workflow-command injection via the claim or commit subject | ⚠️ Gap, fixed | review L-02 → sanitised output; validly-signed malicious timestamp test |
| 23 | A PR edits the verifier to pass its own check | ⚠️ Gap, fixed | review L-04 → CI runs the base branch's copy of the action |
| 24 | Verification on a fresh machine (no `~/.qommit`) wrongly reports "not linked" | ⚠️ Gap (found by CI), fixed | `chain.test.mjs` unwritable-cache test; released in 0.1.1 |

**Planted-bug check:** `node scripts/mutation-test.mjs` plants 37 bugs, including one per review fix. Result: 37/37
caught (`mutation.md`).
