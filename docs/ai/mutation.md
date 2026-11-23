# Mutation testing

Run on 2026-11-23 with `node scripts/mutation-test.mjs`. Each row plants one deliberate bug in a temporary copy of the
code and runs the test suite (`node --test` for the CLI, `forge test` for the contract). **Killed** = the tests
caught it. **Survived** = they didn't (a gap). The repository itself is never modified.

**Result: 37/37 mutants killed.**

History: the first run (2026-11-23) killed **21/26**. The 5 survivors were test gaps, not code bugs. The tests
added for them are: an attacker signing with their own key while claiming someone else's fingerprint; a valid
signature relabelled as another version or algorithm; a CLI bind memo round-tripped through the on-chain parser;
a cache path that can't be created at all (the first regression test let the directory be created, so the error
path never ran); and a check that register/revoke/anchor messages carry distinct domain labels. Re-run: 26/26.

After the blind security review (docs/ai/reviews/2026-11-23-blind-review.md), a mutant was added for each fix
(marked "review …"), so the fixes are proven by tests, not just written. That run killed 36/37: the L-02
timestamp test passed for the wrong reason (the attacker's signature didn't match, so the timestamp check never
ran). It was replaced by a test where the attacker validly signs a malicious timestamp. Re-run: 37/37.

| # | Where | Planted bug (what it would mean) | Result |
|---|---|---|---|
| 1 | `cli/src/core.mjs` | accept any signature | ✅ killed |
| 2 | `cli/src/core.mjs` | skip the fingerprint/key match | ✅ killed |
| 3 | `cli/src/core.mjs` | address claim not covered by the signature | ✅ killed |
| 4 | `cli/src/core.mjs` | timestamp not covered by the signature | ✅ killed |
| 5 | `cli/src/core.mjs` | accept unknown versions/algorithms | ✅ killed |
| 6 | `cli/src/core.mjs` | CLI writes a bind memo the verifier won't recognise | ✅ killed |
| 7 | `cli/src/chain.mjs` | count failed transactions as bindings | ✅ killed |
| 8 | `cli/src/chain.mjs` | count a binding sent by someone else | ✅ killed |
| 9 | `cli/src/chain.mjs` | count a binding without the post-quantum signature | ✅ killed |
| 10 | `cli/src/chain.mjs` | accept malformed fingerprints | ✅ killed |
| 11 | `cli/src/chain.mjs` | case-sensitive fingerprint matching | ✅ killed |
| 12 | `cli/src/chain.mjs` | a cache write error breaks verification (the CI bug) | ✅ killed |
| 13 | `cli/src/chain.mjs` | a non-critical PQ extension counts (review M-04) | ✅ killed |
| 14 | `cli/src/chain.mjs` | an unbind doesn't withdraw the key (review M-02) | ✅ killed |
| 15 | `cli/src/chain.mjs` | older statements override newer ones | ✅ killed |
| 16 | `cli/src/core.mjs` | unsigned v1 identity claims are trusted (review L-05) | ✅ killed |
| 17 | `cli/src/core.mjs` | identity claim needn't be a qor1 address (review M-01/L-02) | ✅ killed |
| 18 | `cli/src/core.mjs` | timestamp needn't be an integer (review L-02) | ✅ killed |
| 19 | `cli/src/registry.mjs` | sign whatever the RPC returns (review H-02) | ✅ killed |
| 20 | `cli/bin/qommit.mjs` | merge commits skipped (review H-01) | ✅ killed |
| 21 | `cli/bin/qommit.mjs` | an empty range passes (review H-01) | ✅ killed |
| 22 | `cli/bin/qommit.mjs` | classical GPG/SSH signatures count (review L-03) | ✅ killed |
| 23 | `cli/src/bech32.mjs` | skip the address checksum (typos accepted) | ✅ killed |
| 24 | `cli/src/bech32.mjs` | accept another chain's address prefix | ✅ killed |
| 25 | `cli/src/bech32.mjs` | corrupt decoded address bytes | ✅ killed |
| 26 | `contracts/src/QommitRegistry.sol` | register without a valid signature | ✅ killed |
| 27 | `contracts/src/QommitRegistry.sol` | registration signature doesn't name the owner | ✅ killed |
| 28 | `contracts/src/QommitRegistry.sol` | signature replayable on another chain | ✅ killed |
| 29 | `contracts/src/QommitRegistry.sol` | signature replayable on another registry | ✅ killed |
| 30 | `contracts/src/QommitRegistry.sol` | owner needn't be quantum-protected | ✅ killed |
| 31 | `contracts/src/QommitRegistry.sol` | owner's key needn't be ML-DSA-87 (review I-02) | ✅ killed |
| 32 | `contracts/src/QommitRegistry.sol` | a key can be re-registered (owner overwritten) | ✅ killed |
| 33 | `contracts/src/QommitRegistry.sol` | revoked keys keep working | ✅ killed |
| 34 | `contracts/src/QommitRegistry.sol` | a commit's anchor can be overwritten | ✅ killed |
| 35 | `contracts/src/QommitRegistry.sol` | anchor signature not bound to the commit | ✅ killed |
| 36 | `contracts/src/QommitRegistry.sol` | revoke and register messages collide | ✅ killed |
| 37 | `contracts/src/QommitRegistry.sol` | accept malformed public keys | ✅ killed |
