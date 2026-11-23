# 🛡️ Qommit

[![CI](https://github.com/Anjali7070/qommit/actions/workflows/ci.yml/badge.svg)](https://github.com/Anjali7070/qommit/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/qommit-cli?color=4b3cf5)](https://www.npmjs.com/package/qommit-cli) [![Quantum-signed with Qommit](https://img.shields.io/badge/commits-quantum--signed%20(ML--DSA--87)-4b3cf5)](https://qommit-nine.vercel.app/?repo=Anjali7070/qommit)

**Quantum-proof signatures for your git commits, bound to your QoreChain identity.**

> Your code's signatures will outlive today's cryptography. Qommit makes them quantum-proof.

Built for [Build Before Q-Day — QoreChain Developer Fest](https://build.qorechain.io) (Quantum Pass).

**🌐 Try it: [qommit-nine.vercel.app](https://qommit-nine.vercel.app)**. Paste any GitHub repo and see which commits are
quantum-signed. This repo: 100%. `torvalds/linux`: 0%.

## The problem

A git commit records *who* wrote the code, but anyone can type any name. Signed commits fix that, but
today's signatures (GPG / SSH: RSA, ECDSA, Ed25519) will be **forgeable by quantum computers**. Git history is
permanent, so after "Q-Day" every classical signature stops proving anything, and attackers can forge "verified"
commits and releases from trusted maintainers. That's a software supply-chain attack waiting to happen.

## What Qommit does

- **Signs commits and tags with ML-DSA-87** (NIST FIPS 204), a post-quantum signature scheme, by plugging into git's
  standard signing interface. `git commit` works exactly as before.
- **Binds your signing key to your `qor1…` identity in both directions.** Each signature claims your address (and the
  claim is signed), and your QoreX wallet publishes a hybrid-signed (secp256k1 + ML-DSA-87) QoreChain transaction
  saying the key is yours. Forging an identity needs both your laptop key *and* your wallet.
- **Records keys, revocations and release timestamps in `QommitRegistry`**, a contract where every action is
  authorised by the key's own ML-DSA-87 signature, **verified on-chain by QoreChain's `pqcVerify` precompile**.
  Anyone can relay a transaction; nobody can forge one.
- **Verifies anywhere:** `git log --show-signature`, `git verify-commit`, or CI. A stranger needs nothing but the chain.

```text
$ git verify-commit HEAD
qommit: ✅ Good ML-DSA-87 (post-quantum) signature from qor1jcy2zxezq40rk7jdx540mc3gd89tqlnpgcu767
        (linked on QoreChain, tx 82A72A6B3799…)
```

| Git status | Meaning |
|---|---|
| `G` | Good signature, identity confirmed on QoreChain (or a key you trust locally) |
| `U` | Valid signature, but the key isn't linked to any identity |
| `B` | Bad signature: the commit or its identity claim was altered |
| `R` | Signed by a key that was revoked in QommitRegistry |
| `N` | Not signed |

## Live on QoreChain testnet (`qorechain-diana`)

| What | Where |
|---|---|
| QommitRegistry contract (EVM 9800) | [`0xB50BB93b40Ff7D7900ee3850699646c47A567482`](https://explore.qore.network/address/0xB50BB93b40Ff7D7900ee3850699646c47A567482) |
| Author identity | `qor1jcy2zxezq40rk7jdx540mc3gd89tqlnpgcu767` |
| Key link (hybrid-signed, via QoreX) | [`82A72A6B…`](https://explore.qore.network/tx/82A72A6B37991EFB032B4204FBEA87AA271DC2B30560AFA350E643D25306121D) |
| Key registered in QommitRegistry | [`0xdf177746…`](https://explore.qore.network/tx/0xdf177746aaa490074f902d9cda833d30739777c2867ec3e7da47bb445a40c66b) |
| Commits `b7e3400`, `9306dcb` anchored | [`0x2864292d…`](https://explore.qore.network/tx/0x2864292dae0476e5545752894f8f9b48515349aa5249b3ac9fe43715d3d85540), [`0x4ad98f19…`](https://explore.qore.network/tx/0x4ad98f19a8c4f745c714e70be9ca43f811222140b41e961c6a0c9315a2d54fdc) |
| Forged link with a leaked classical key | refused by QoreChain: `must include the hybrid signature extension` (`pnpm qday-attack`) |

Every commit in this repository is signed with ML-DSA-87.

## Quick start

```sh
npm install -g qommit-cli                 # https://www.npmjs.com/package/qommit-cli
cd your-repo
qommit init --address qor1…   # creates ~/.qommit/key.json and makes this repo sign every commit
qommit link                   # link the key to your address from QoreX (one approval)
qommit status                 # ✅ linked in block …
git commit -m "my first quantum-signed commit"
git log --show-signature -1
```

| Command | What it does |
|---|---|
| `qommit init [--address qor1…] [--global]` | Create your key and make git sign with it |
| `qommit address [qor1…]` | Show or set the identity your signatures claim |
| `qommit whoami` / `qommit status` | Show your key, identity and on-chain link |
| `qommit link` | Open the [linking page](https://qommit-nine.vercel.app) (QoreX approval) |
| `qommit register` | Record your key in QommitRegistry (needs `QOMMIT_RELAYER_KEY`, see below) |
| `qommit anchor [commit]` | Timestamp a commit on-chain: proof it was quantum-signed before a given block |
| `qommit revoke --yes` | Permanently revoke your key |
| `qommit trust <fingerprint>` | Trust a key locally without an on-chain link |
| `qommit verify [range] [--allow-unlinked]` | Check every commit in a range; exit 1 on failure (CI) |

`register`, `anchor` and `revoke` are EVM transactions, so they need a relayer account that pays the gas and has a
registered ML-DSA-87 key and an open EVM window (`cd contracts && pnpm window register && pnpm window open`). The
relayer can't change what gets recorded, because the contract checks the Qommit key's own signature.

## See the attack: `demo/qday-attack.sh`

A 2-minute, fully reproducible walkthrough (used in the demo video):

1. **Today:** Alice signs a commit with a normal SSH (Ed25519) key, and git says *Good*.
2. **Q-Day:** a quantum computer recovers Alice's private key from her public key (simulated). The attacker
   forges a backdoor commit as Alice, and git **still says Good**. GitHub would show *Verified*.
3. **With Qommit:** a stranger checks the repo against QoreChain only. A tampered commit gives **BAD**. An impostor
   post-quantum key claiming Alice's identity is **not linked, so it's rejected**.
4. **On-chain:** the attacker uses a leaked *classical* wallet key to fake the identity link. **QoreChain refuses
   the transaction**: `has a registered PQC key and must include the hybrid signature extension (hybrid mode: required)`.

```sh
./demo/qday-attack.sh   # Act 3 sends a real (rejected) testnet transaction; needs contracts/.env
```

## Use it in CI (GitHub Action)

Fail a pull request unless every commit is quantum-signed with an identity verified on QoreChain:

```yaml
# .github/workflows/qommit.yml
on: pull_request
permissions:
  contents: read
jobs:
  qommit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: Anjali7070/qommit@main
        # with:
        #   allow-unlinked: true   # accept quantum-signed commits without an on-chain identity
```

The job prints a per-commit table in the run summary and flags each failing commit. Locally, the same check is
`qommit verify origin/main..HEAD`. This repository runs it on every push.

## How it works

1. **Signing.** Git calls `qommit` as its `gpg.x509.program`. Qommit signs
   `"qommit-v2" ‖ address ‖ timestamp ‖ commit` with ML-DSA-87 and speaks git's GPG status protocol, so standard git
   commands work unchanged.
2. **Linking.** The web page asks QoreX to `signAndBroadcast` a 1 uqor self-transfer with memo
   `qommit:bind:v1:<fingerprint>`, hybrid-signed by the wallet.
3. **Verifying.** Qommit checks the signature, reads the address claim, then finds a successful, hybrid-signed
   (critical `PQCHybridSignature` extension) bind transaction sent by that address for that key, with no later
   `qommit:unbind:v1` memo. It also checks QommitRegistry for a revocation; if that check can't run, the key isn't
   trusted.
4. **Anchoring.** `QommitRegistry.anchor` stores, per (commit, key), the first block timestamp at which that key
   signed the commit, checked by `pqcVerify`.

## Repository layout

| Path | What |
|---|---|
| `cli/` | The `qommit` signer/verifier (Node.js, `@qorechain/pqc`, viem). Tests: `npm test` (31) |
| `contracts/` | `QommitRegistry` (Solidity, Foundry). Tests: `pnpm forge-std && forge test` (23). `pnpm qday-attack`: the live classical-key attack |
| `demo/` | `qday-attack.sh`: the end-to-end Q-Day attack demo |
| `scripts/` | `scan-secrets.mjs` (pre-commit and CI secret scan), `mutation-test.mjs` (37 planted bugs) |
| `docs/ai/` | Build log, blind security review, red-team report, mutation results |
| `web/` | Verifier and key-linking site (Vite + React, `@qorechain/qorex-types`, viem), live at [qommit-nine.vercel.app](https://qommit-nine.vercel.app). Run locally: `pnpm install && pnpm dev` |

## Built with AI

Built by pairing with an AI coding agent (Claude Code) as builder, blind security reviewer and attacker. What it
did, what I decided, how its work was checked and where it was wrong: [AI_USAGE.md](AI_USAGE.md).

**Security:** a blind AI review found 2 high and 4 medium issues; all are fixed or mitigated, each with a regression
test ([report](docs/ai/reviews/2026-11-23-blind-review.md)). 24 attacks are tracked in [docs/ai/redteam.md](docs/ai/redteam.md).

## Credits

- [`create-qorechain-dapp`](https://www.npmjs.com/package/create-qorechain-dapp): `web/` scaffolded from the
  `fullstack-web` template, `contracts/` from the `foundry` template (Apache-2.0, QoreChain Association)
- [`@qorechain/pqc`](https://www.npmjs.com/package/@qorechain/pqc): ML-DSA-87 implementation (Apache-2.0),
  backed by [`@noble/post-quantum`](https://github.com/paulmillr/noble-post-quantum)
- [`@qorechain/sdk`](https://www.npmjs.com/package/@qorechain/sdk), [`@qorechain/evm`](https://www.npmjs.com/package/@qorechain/evm)
  and [`@qorechain/qorex-types`](https://www.npmjs.com/package/@qorechain/qorex-types): QoreChain client, EVM window
  helper and QoreX wallet types (Apache-2.0)
- [viem](https://viem.sh) (MIT), [Foundry](https://getfoundry.sh) and [forge-std](https://github.com/foundry-rs/forge-std) (MIT/Apache-2.0)

## License

[MIT](LICENSE) © 2026 Anjali Kumari
