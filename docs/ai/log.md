# Build log

A dated record of how Qommit was built with an AI coding agent (Claude Code, Claude Opus 5.5): what was asked,
what the agent did, what the human decided, and what went wrong. Times are IST (UTC+5:30).

> **Provenance.** This log was written on 23 Nov 2026 from the git history, the agent session and the agent's
> working notes, not kept live from the first minute. From 23 Nov on, entries are added as work happens.
> Commit hashes link each entry to the code.

## 22 Nov: idea, then the riskiest part first

- **Start.** Anjali, new to hackathons and blockchain, asked the agent to be a partner who teaches while building.
  The agent read the fest pages (start, prizes, kits, rules) and the QoreChain SDK docs, and saved the deadlines.
- **First idea, then a course-correction.** The agent first proposed an "Am I Q-Day Ready?" account checker.
  **Anjali:** *"We need some brilliant idea which can win the hackathon."* The agent then surveyed all 129
  existing projects and found the checker had already been built at least 4 times (Q-Day checkup, Qore PQ Health,
  Q-Day Readiness Audit, Quantum-Safe Certificate). Tip jars, time capsules, dice and wills were taken too.
- **Ideas compared.** The agent pitched TrueQR (QR-sticker fraud), KinCheck (deepfake calls), Quantum Debt (repo
  crypto scanner) and Qommit. **Anjali:** *"are these all in accordance with what we need to build?"* The agent
  checked the QoreX wallet's type definitions and found it can only sign token transfers today: no EVM
  transactions and no arbitrary messages. So KinCheck became clunky, and every design had to use a transfer + memo.
- **D1: Qommit over TrueQR.** **Anjali:** *"don't just think which is easy to build, rather think which will
  create more impact and can contribute more and win."* The agent reconsidered: TrueQR "isn't a quantum
  problem", while Qommit protects permanent git history from forgery after Q-Day. Anjali chose Qommit.
- **Tooling.** Node 22, the GitHub CLI and pnpm were installed. Anjali set the repo path (D2: `~/qorechain/qommit`)
  and gave her personal git identity; the agent set it per repo so her work email stays out.
- **Spike.** The agent wrote a minimal `gpg.x509.program` signer and tested it in throwaway repos. **Mistake
  #1:** valid signatures still failed `git verify-commit`. Git needs a status line *before* `GOODSIG` (`NEWSIG`)
  and a trust level. Found by testing good/untrusted/forged/unsigned and reading the exit codes.
- `fa4035b` first quantum-signed commit. D3: Anjali asked for short Conventional Commit messages, not long bodies.
- `79fa0dc` `qommit init`, signed `qor1` claims, bech32 validation, 9 attacker-style tests.

## 23 Nov: identity on-chain, registry, verifier, npm, CI, demo

- **Linking page.** The agent built a QoreX page that sends a 1 uqor self-transfer with memo
  `qommit:bind:v1:<fingerprint>`. **Mistake #2:** the agent assumed the wallet was in the QoreX extension. It
  was a Dashboard-created coin-type-60 account, so the extension showed a different, empty address. Fixed with
  QoreX's docs ("Add an Ethereum account (coin 60)"), and the hidden testnet switch was found in the fest docs.
  **Anjali approved the link transaction in QoreX** (`82A72A6B…`, hybrid-signed).
- `20de0b0`, `b7e3400`: a stranger can now verify identity through the chain alone.
- **Probe before contract.** The agent found the `pqcVerify` precompile in the docs, then proved with a free
  `eth_call` that it accepts our library's signatures (valid → true, tampered → false) before writing Solidity.
- **Registry.** Foundry contract + 19 tests. **Anjali funded the deployer** from QoreX (`2B0DD7BC…`). The agent
  registered its PQC key, opened the EVM window and deployed `0x6F32…e03D`. It then registered Anjali's key
  (`0x49856a4f…`, verified on-chain by `pqcVerify`) and anchored `b7e3400` (`0x04fae0e5…`).
- `1ad536c`, `a900800`. D4: Anjali chose to fold the README edit into the latest commit (`--amend --no-edit`).
  The agent amended only the unpushed commit, so no public history was rewritten.
- **Verifier website.** The agent checked CORS (QoreChain REST and RPC send none; the EVM RPC and GitHub do) and
  confirmed that GitHub's API payload verifies byte-exactly. It built the browser verifier and a Vercel rewrite
  proxy. **Anjali deployed it on Vercel.** The agent verified the live site anonymously: page, headers, a proxy
  limited to QoreChain, no secrets in the bundle. `569278c`, `4604ebe`.
- **npm.** "qommit" was taken. D5: Anjali chose `qommit-cli`. npm needed 2FA (a passkey). The publish failed 4
  times (`EOTP`): npm 10 couldn't do web auth, and the agent's shell isn't a TTY. Fixed by upgrading npm and
  having Anjali publish from her own Terminal. A new "0.0.0-stage" placeholder appeared first, and the real
  version a minute later. `ada113e`.
- **CI.** An action plus a 4-job workflow; this needed the `workflow` scope (Anjali refreshed it). **Mistake #3:**
  the commit check failed in CI. The agent first suspected the network (`3408e4b`, added retries and reasons). The
  new output showed the lookup *succeeded*, which pointed to the real bug: writing a cache into a `~/.qommit` that
  doesn't exist on a fresh machine. That made every new user's first verification fail. Fixed with a regression
  test (`b012cd0`) and released as 0.1.1 (`bb8bac2`).
- **Q-Day demo.** SSH-signed forgery passes as "Good"; Qommit rejects tampering and impostors. A live
  classical-only bind transaction was **refused by QoreChain** ("must include the hybrid signature extension").
  `9306dcb`.
- **D6: disclose AI use.** **Anjali:** *"what will happen if we don't disclose?"* The agent explained the award
  rules and recommended disclosure. **D7:** *"first check others' md files too… choose good points… make ours
  the best."* A research agent read 22 competitors' AI_USAGE.md files. **D8:** no `Co-Authored-By` trailers.
- **Evidence pass.** Pre-commit secret scanner (negative control blocked). Mutation testing: first **21/26**
  killed, 5 test gaps found and filled, then 26/26.
- **Blind security review.** A separate agent with no context found **2 high, 4 medium, 6 low and 4 info**
  issues. The worst: CI skipped merge commits (H-01), and the CLI signed registry messages exactly as the RPC
  returned them (H-02). The builder reproduced H-01, then fixed or mitigated every finding with a regression test.
  The registry was redeployed for per-key anchors (M-03): `0xB50B…7482`. The key was re-registered (`0xdf177746…`),
  this time signing a locally built, cross-checked message, and `b7e3400` and `9306dcb` were re-anchored. A mutant
  was added per fix: 36/37 caught, the survivor was a test passing for the wrong reason, rewritten, then 37/37.
  Reports: `reviews/2026-11-23-blind-review.md`, `redteam.md`, `mutation.md`.
- **Owning the story.** Anjali asked to see Hallmark's file next to ours, then: *"our AI_USAGE.md looks very
  similar to the hallmark one… Ours should be unique"* (D10). The agent re-checked its draft first and found it had
  overstated approvals, said she'd run the demo, and paraphrased her words. It also disclosed that it had
  redeployed the registry without asking. The file was then rewritten around our own **Learn → Build → Break → Fix**
  loop, with a *Teacher* hat listing the lessons. A 6-word-phrase comparison with Hallmark's file found 0 shared
  phrases apart from file paths.
- **Guardrails written down.** `CLAUDE.md` records the rules followed since 22 Nov. The secret scanner now also
  blocks exact secret values present on the machine. Its negative test caught a miss (a key without its `0x`
  prefix), which was fixed and then re-tested against all three leak forms without printing any secret.
