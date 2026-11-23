# qommit-cli

**Quantum-proof signatures for your git commits (ML-DSA-87, NIST FIPS 204), bound to your QoreChain identity.**

Today's commit signatures (GPG/SSH) will be forgeable by quantum computers. Git history is permanent, so the
signatures you make now need to be post-quantum already. Qommit plugs into git's standard signing interface:
`git commit` works exactly as before, and every commit is signed with ML-DSA-87.

```sh
npm install -g qommit-cli
cd your-repo
qommit init --address qor1…      # create your key, make this repo sign every commit
qommit link                      # link the key to your qor1 address (one QoreX approval)
git commit -m "quantum-signed"
git log --show-signature -1
# qommit: ✅ Good ML-DSA-87 (post-quantum) signature from qor1… (linked on QoreChain, tx …)
```

| Command | What it does |
|---|---|
| `qommit init [--address qor1…] [--global]` | Create your key (`~/.qommit/key.json`) and configure git |
| `qommit address [qor1…]` | Show or set the QoreChain identity your signatures claim |
| `qommit whoami` / `qommit status` | Show your key, identity and on-chain link |
| `qommit link` | Link your key to your address via the QoreX wallet |
| `qommit register` / `anchor [commit]` / `revoke --yes` | QommitRegistry actions (need `QOMMIT_RELAYER_KEY`) |
| `qommit trust <fingerprint> [label]` | Trust a key locally |

Verify any public GitHub repo in the browser: **https://qommit-nine.vercel.app**

Environment: `QOMMIT_HOME` (default `~/.qommit`), `QOMMIT_OFFLINE=1` (skip chain lookups), `QOMMIT_REST`,
`QOMMIT_EVM_RPC`, `QOMMIT_REGISTRY`, `QOMMIT_LINK_URL`.

Runs on the QoreChain testnet (`qorechain-diana`). Source, design and contract:
https://github.com/Anjali7070/qommit. MIT licensed.
