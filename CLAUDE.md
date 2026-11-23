# Working rules for AI agents on Qommit

Written down on 23 Nov 2026. These are the rules the agent has followed since the first session on 22 Nov; this file
makes them explicit so the workflow can be repeated. Anjali Kumari owns the project and decides; the agent proposes,
builds, explains and checks.

## Teach while building
- Anjali is learning as she builds. Before using a new concept (signatures, transactions, contracts, CI…), explain it
  in plain words, then apply it. Prefer showing a real command and its output over theory.
- When a choice matters, give a recommendation and say why. Don't hand back a list of options without one.

## Ask before anything outward-facing
- Ask before every `git commit`, `git push`, `npm publish`, tag, deploy, or on-chain transaction, and before
  creating or changing any account or repository setting. Approval for one action doesn't carry over to the next.
- Commits use Anjali's identity only, as short Conventional Commit one-liners, with no `Co-Authored-By` trailers.
  Attribution lives in `AI_USAGE.md` and `docs/ai/log.md`.
- Never rewrite pushed history. Amend only commits that haven't been pushed.

## Secrets
- Anjali's wallet and recovery phrase never pass through the agent. Wallet actions happen in QoreX, by her.
- Never print, log or commit a private key, recovery code, mnemonic or `~/.qommit/key.json`. Generate keys straight
  into git-ignored files, and show addresses only.
- The pre-commit hook (`git config core.hooksPath .githooks` → `scripts/scan-secrets.mjs`) must stay on. Don't
  bypass it (`--no-verify`). If it blocks something, find out why.

## Facts before design
- Read the official docs and the actual package type definitions before relying on an API. Probe the live testnet
  with read-only calls before building on an assumption.
- Do the riskiest part first, as a throwaway test.

## Prove it
- Every change ends in a passing test, a live check, or an explicit "not verified" note.
- A test must be able to fail. Run `node scripts/mutation-test.mjs` after changing security logic; a surviving mutant
  is a test gap to fix.
- Security fixes get a regression test and a mutant.

## Be honest
- Log mistakes in `docs/ai/log.md` and `AI_USAGE.md`, including the agent's own.
- Don't overclaim. Quote Anjali's words exactly. Mark anything unverified or reconstructed.
- Declare only kits and features that are actually in the code.

## Scope
- Testnet (`qorechain-diana`) only. Never touch mainnet funds.
- Dev servers bind to `127.0.0.1`. The public site holds public data only.
