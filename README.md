# 🛡️ Qommit

**Quantum-proof signatures for your git commits, bound to your QoreChain identity.**

> Your code's signatures will outlive today's cryptography. Qommit makes them quantum-proof.

Built for [Build Before Q-Day — QoreChain Developer Fest](https://build.qorechain.io) (Quantum Pass).

## The problem

A git commit records *who* wrote the code, but anyone can type any name. Signed commits fix that, but
today's signatures (GPG / SSH: RSA, ECDSA, Ed25519) will be **forgeable by quantum computers**. Git history is
permanent, so after "Q-Day" every classical signature stops proving anything, and attackers can forge "verified"
commits and releases from trusted maintainers. That's a software supply-chain attack waiting to happen.

## What Qommit does

- **Signs commits and tags with ML-DSA-87** (NIST FIPS 204), a post-quantum signature scheme, by plugging into git's
  standard signing interface. `git commit` works exactly as before.
- **Binds your signing key to your `qor1…` address on QoreChain** with a hybrid-signed (secp256k1 + ML-DSA-87)
  transaction from the QoreX wallet, so anyone can check *whose* key signed a commit.
- **Verifies anywhere:** in your terminal (`git log --show-signature`), on the web verifier, or in CI.

```text
$ git log --show-signature -1
commit 6c4ac89b…
qommit: ✅ Good ML-DSA-87 (post-quantum) signature from trusted key 85D024DB…
```

## Status

🚧 Work in progress during the fest. Day 1: git signing and verification of commits and tags works (good, untrusted,
forged and unsigned commits are all detected). The on-chain identity registry, the web verifier and the npm package are next.

## Repository layout

| Path | What |
|---|---|
| `cli/` | The `qommit` signer/verifier (Node.js, `@qorechain/pqc`) |
| `contracts/` | QommitRegistry contract (Foundry) |
| `web/` | Key-linking and verifier web app (Vite + React, `@qorechain/sdk`) |

## Try it (early preview)

```sh
cd cli && npm install
node bin/qommit.mjs keygen                           # creates ~/.qommit/key.json (keep it secret)
git config gpg.format x509
git config gpg.x509.program "$(pwd)/bin/qommit.mjs"
git commit -S -m "my first quantum-signed commit"
git log --show-signature -1
```

## Credits

- [`create-qorechain-dapp`](https://www.npmjs.com/package/create-qorechain-dapp): `web/` scaffolded from the
  `fullstack-web` template, `contracts/` from the `foundry` template (Apache-2.0, QoreChain Association)
- [`@qorechain/pqc`](https://www.npmjs.com/package/@qorechain/pqc): ML-DSA-87 implementation (Apache-2.0),
  backed by [`@noble/post-quantum`](https://github.com/paulmillr/noble-post-quantum)
- [`@qorechain/sdk`](https://www.npmjs.com/package/@qorechain/sdk): QoreChain client (Apache-2.0)

## License

[MIT](LICENSE) © 2026 Anjali Kumari
