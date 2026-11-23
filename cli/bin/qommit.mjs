#!/usr/bin/env node
// qommit — post-quantum (ML-DSA-87) signatures for git commits and tags.
//
// Git calls this program in place of gpgsm when configured with:
//   git config gpg.format x509
//   git config gpg.x509.program qommit
//
// Git's contract with a signing program:
//   sign:   qommit --status-fd=2 -bsau <key>      payload on stdin  -> armored signature on stdout,
//                                                   "[GNUPG:] SIG_CREATED" on stderr
//   verify: qommit --status-fd=1 --verify <file> -  payload on stdin  -> status lines on stdout,
//                                                   human-readable result on stderr

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALG, generateKey, signPayload, verifyPayload, bindMemo } from "../src/core.mjs";
import { isValidBech32 } from "../src/bech32.mjs";
import { lookupBinding, DEFAULT_REST } from "../src/chain.mjs";
import { REGISTRY, registerKey, revokeKey, anchorCommit, readKey, readAnchor } from "../src/registry.mjs";

const KEY_DIR = process.env.QOMMIT_HOME || join(homedir(), ".qommit");
const KEY_FILE = join(KEY_DIR, "key.json");
const CONFIG_FILE = join(KEY_DIR, "config.json");
const TRUST_FILE = join(KEY_DIR, "trusted");
const CACHE_FILE = join(KEY_DIR, "chain-cache.json");
const SELF = fileURLToPath(import.meta.url);

const b64 = (b) => Buffer.from(b).toString("base64");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
const die = (msg, code = 1) => {
  process.stderr.write(`qommit: ${msg}\n`);
  process.exit(code);
};
const flag = (name) => process.argv.includes(name);
const option = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

// ---------- local state: key, config, trust list ----------

function loadKey() {
  if (!existsSync(KEY_FILE)) die(`no key found at ${KEY_FILE}. Run: qommit init`);
  const k = JSON.parse(readFileSync(KEY_FILE, "utf8"));
  return { fingerprint: k.fingerprint, publicKey: unb64(k.publicKey), secretKey: unb64(k.secretKey) };
}

function createKey() {
  const key = generateKey();
  mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  const body = { v: 1, alg: ALG, fingerprint: key.fingerprint, publicKey: b64(key.publicKey), secretKey: b64(key.secretKey) };
  writeFileSync(KEY_FILE, JSON.stringify(body, null, 2), { mode: 0o600 });
  chmodSync(KEY_FILE, 0o600); // only you can read your secret key
  return key;
}

const loadConfig = () => (existsSync(CONFIG_FILE) ? JSON.parse(readFileSync(CONFIG_FILE, "utf8")) : {});
function saveConfig(cfg) {
  mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n");
}

function requireAddress(addr) {
  if (!isValidBech32(addr, "qor")) die(`"${addr}" is not a valid qor1… address (check for typos)`);
  return addr;
}

// Your own key + one fingerprint per line in ~/.qommit/trusted (like SSH's allowed_signers file).
function trustedFingerprints() {
  const set = new Set();
  if (existsSync(KEY_FILE)) set.add(JSON.parse(readFileSync(KEY_FILE, "utf8")).fingerprint);
  if (existsSync(TRUST_FILE)) {
    for (const line of readFileSync(TRUST_FILE, "utf8").split("\n")) {
      const f = line.split("#")[0].trim().toUpperCase();
      if (f) set.add(f);
    }
  }
  return set;
}

// ---------- user commands ----------

function cmdInit() {
  const global = flag("--global");
  const addr = option("--address");
  if (addr) requireAddress(addr);

  let key;
  if (existsSync(KEY_FILE)) {
    key = loadKey();
    console.log(`✓ Using existing ${ALG} key ${key.fingerprint}`);
  } else {
    key = createKey();
    console.log(`✓ Created ${ALG} key ${key.fingerprint}\n  stored at ${KEY_FILE} (owner-only). Back it up and never share it.`);
  }
  if (addr) saveConfig({ ...loadConfig(), address: addr });

  const scope = global ? ["--global"] : ["--local"];
  const settings = {
    "gpg.format": "x509",
    "gpg.x509.program": SELF,
    "user.signingkey": key.fingerprint,
    "commit.gpgsign": "true",
    "tag.gpgSign": "true",
  };
  try {
    for (const [k, v] of Object.entries(settings)) execFileSync("git", ["config", ...scope, k, v], { stdio: "pipe" });
  } catch {
    die(global ? "could not write global git config" : "not inside a git repository (cd into one, or use --global)");
  }
  console.log(`✓ Configured git (${global ? "all repositories" : "this repository"}) to sign every commit and tag`);
  if (SELF.includes("/_npx/")) {
    console.log(`! You ran qommit through npx, whose cache npm may clean up (git signing would then fail).\n  For lasting use: npm install -g qommit-cli && qommit init${global ? " --global" : ""}`);
  }

  const address = loadConfig().address;
  if (address) console.log(`✓ Signatures will claim identity ${address}`);
  else console.log(`! No QoreChain address yet. Run: qommit address <qor1…>`);
  console.log(`\nNext: link your key on-chain so others can verify it's yours:\n  memo: ${bindMemo(key.fingerprint)}`);
}

function cmdAddress() {
  const addr = process.argv[3];
  if (!addr) {
    const cur = loadConfig().address;
    return console.log(cur ?? "(no address set)");
  }
  saveConfig({ ...loadConfig(), address: requireAddress(addr) });
  console.log(`✓ Signatures will now claim identity ${addr}`);
}

function cmdWhoami() {
  const key = loadKey();
  const { address } = loadConfig();
  console.log(`key:      ${ALG} ${key.fingerprint}`);
  console.log(`identity: ${address ?? "(none — run: qommit address <qor1…>)"}`);
  console.log(`bind memo: ${bindMemo(key.fingerprint)}`);
}

function cmdTrust() {
  const fpr = (process.argv[3] ?? "").toUpperCase();
  if (!/^[0-9A-F]{40}$/.test(fpr)) die("usage: qommit trust <40-hex-char fingerprint> [label]");
  const label = process.argv.slice(4).join(" ");
  mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  appendFileSync(TRUST_FILE, `${fpr}${label ? `  # ${label}` : ""}\n`);
  console.log(`✓ Trusting key ${fpr}${label ? ` (${label})` : ""}`);
}

// ---------- git-facing commands ----------

function gitSign() {
  const key = loadKey();
  const { address = "" } = loadConfig();
  process.stdout.write(signPayload(key, readFileSync(0), { addr: address }));
  // Git requires this status line (preceded by a newline) or it reports "failed to sign the data".
  process.stderr.write(`\n[GNUPG:] SIG_CREATED D 0 0 00 ${Math.floor(Date.now() / 1000)} ${key.fingerprint}\n`);
}

async function gitVerify(sigFile) {
  const payload = readFileSync(0);
  const status = (line) => process.stdout.write(`[GNUPG:] ${line}\n`);
  // Git searches for "\n[GNUPG:] GOODSIG", so GOODSIG must not be the first line. Real GPG prints NEWSIG first too.
  status("NEWSIG");
  const r = verifyPayload(readFileSync(sigFile, "utf8"), payload);
  if (!r.fpr) {
    status(`ERRSIG 0000000000000000 0 0 00 0 9`);
    die(`unreadable signature: ${r.reason}`);
  }
  const keyId = r.fpr.slice(-16);
  const who = r.addr ? ` claiming ${r.addr}` : "";
  if (!r.ok) {
    status(`BADSIG ${keyId} qommit ${r.fpr}`);
    die(`❌ BAD ${ALG} signature: ${r.reason} (key ${r.fpr}${who})`);
  }
  // A valid signature only proves "someone with this key signed". Trust says whose key it is.
  // Strongest: a two-way link. The signature claims qor1X (and the claim is signed), AND qor1X published a
  // hybrid-signed QoreChain transaction saying it owns this key. Neither side can be faked alone.
  let trust = "none";
  let note = "";
  if (r.addr && process.env.QOMMIT_OFFLINE !== "1") {
    const res = await lookupBinding(r.addr, r.fpr, { cacheFile: CACHE_FILE, rest: process.env.QOMMIT_REST || DEFAULT_REST });
    if (res.binding) {
      trust = "chain";
      note = ` (linked on QoreChain, tx ${res.binding.txHash.slice(0, 12)}…)`;
    } else if (res.error) note = ` (couldn't reach QoreChain: ${res.error})`;
  }
  if (trust === "none" && trustedFingerprints().has(r.fpr)) trust = "local";

  // A revoked key (e.g. reported lost) must not verify, even if it was linked or trusted before.
  const revokedAt = process.env.QOMMIT_OFFLINE === "1" ? 0 : await registryRevokedAt(r.publicKey, r.fpr);
  if (revokedAt) {
    status(`REVKEYSIG ${keyId} ${r.addr || "qommit"}`);
    status(`TRUST_UNDEFINED 0 qommit`);
    die(`❌ key ${r.fpr}${who} was REVOKED in QommitRegistry at ${new Date(revokedAt * 1000).toISOString()}`);
  }

  status(`GOODSIG ${keyId} ${r.addr || "qommit"}`);
  status(`VALIDSIG ${r.fpr} 1970-01-01 ${r.ts || 0} 0 4 0 1 10 00 ${r.fpr}`);
  // With gpg.minTrustLevel=fully, git rejects anything below TRUST_FULLY.
  status(trust === "none" ? `TRUST_UNDEFINED 0 qommit` : `TRUST_FULLY 0 qommit`);
  const msg = {
    chain: `✅ Good ${ALG} (post-quantum) signature from ${r.addr}${note}`,
    local: `✅ Good ${ALG} (post-quantum) signature from locally trusted key ${r.fpr}${who}${note}`,
    none: `⚠️  Valid ${ALG} signature${who}, but key ${r.fpr} is not linked on-chain or trusted${note}`,
  }[trust];
  process.stderr.write(`qommit: ${msg}\n`);
}

// Registry revocation check, cached for an hour so `git log` stays fast. Unreachable registry = not revoked (fail-open
// here is deliberate: the signature and on-chain link were already verified; revocation is an extra layer).
async function registryRevokedAt(publicKey, fpr) {
  const cache = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, "utf8")) : {};
  const k = `registry:${fpr}`;
  if (cache[k] && Date.now() - cache[k].fetchedAt < 60 * 60 * 1000) return cache[k].revokedAt;
  try {
    const { revokedAt } = await readKey(publicKey);
    cache[k] = { fetchedAt: Date.now(), revokedAt };
    mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    return revokedAt;
  } catch {
    return 0;
  }
}

function cmdLink() {
  const key = loadKey();
  const base = process.env.QOMMIT_LINK_URL || "https://qommit-nine.vercel.app";
  console.log(`Open this page and approve the transaction in QoreX (Testnet):\n  ${base}/?fpr=${key.fingerprint}`);
  console.log(`It publishes, from your wallet, a hybrid-signed memo: ${bindMemo(key.fingerprint)}`);
}

async function cmdStatus() {
  const key = loadKey();
  const { address } = loadConfig();
  console.log(`key:      ${ALG} ${key.fingerprint}`);
  if (!address) return console.log(`identity: none (run: qommit address <qor1…>)`);
  console.log(`identity: ${address}`);
  const res = await lookupBinding(address, key.fingerprint, { rest: process.env.QOMMIT_REST || DEFAULT_REST });
  if (res.error) console.log(`on-chain: couldn't reach QoreChain (${res.error})`);
  else if (res.binding) console.log(`on-chain: ✅ linked in block ${res.binding.height}, tx ${res.binding.txHash}`);
  else console.log(`on-chain: ✗ not linked yet. Run: qommit link`);
}

// ---------- registry commands (EVM; a relayer pays gas, the Qommit key's ML-DSA-87 signature authorises) ----------

const relayer = () => process.env.QOMMIT_RELAYER_KEY;
const EXPLORER = "https://explore.qore.network/tx/";

async function cmdRegister() {
  const key = loadKey();
  const { address } = loadConfig();
  if (!address) die("no identity set. Run: qommit address <qor1…>");
  const rec = await readKey(key.publicKey);
  if (rec.registeredAt) return console.log(`✓ Already registered in QommitRegistry ${REGISTRY} (owner ${rec.owner})`);
  const hash = await registerKey(key, address, relayer());
  console.log(`✓ Registered key ${key.fingerprint} for ${address}
  registry ${REGISTRY}
  tx ${EXPLORER}${hash}`);
}

async function cmdRevoke() {
  if (!flag("--yes")) die("revoking is permanent: this key can never be used or re-registered. Re-run with --yes");
  const hash = await revokeKey(loadKey(), relayer());
  console.log(`✓ Key revoked
  tx ${EXPLORER}${hash}`);
}

async function cmdAnchor() {
  const ref = process.argv[3] ?? "HEAD";
  const commit = execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], { encoding: "utf8" }).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) die(`not a SHA-1 commit: ${commit}`);
  const existing = await readAnchor(commit);
  if (existing.timestamp) {
    return console.log(`✓ ${commit.slice(0, 7)} already anchored at ${new Date(existing.timestamp * 1000).toISOString()} (block ${existing.blockNumber})`);
  }
  const hash = await anchorCommit(loadKey(), commit, relayer());
  const a = await readAnchor(commit);
  console.log(`✓ Anchored ${commit.slice(0, 7)}: proof it was signed with your post-quantum key by ${new Date(a.timestamp * 1000).toISOString()}
  tx ${EXPLORER}${hash}`);
}

// ---------- verify a range of commits (for CI) ----------

const LABELS = {
  G: "✅ quantum-signed, identity verified",
  U: "🟡 quantum-signed, identity not linked",
  B: "❌ bad signature",
  R: "⛔ signed by a revoked key",
  N: "○ not signed",
  E: "⚠️ classical or unreadable signature",
};

async function cmdVerify() {
  const range = process.argv.slice(3).find((a) => !a.startsWith("--")) ?? "HEAD";
  const allowUnlinked = flag("--allow-unlinked");
  const gh = process.env.GITHUB_ACTIONS === "true";
  let out;
  try {
    // Git routes each x509 signature to this program, which does the ML-DSA-87 check and the on-chain identity lookup.
    out = execFileSync(
      "git",
      ["-c", `gpg.x509.program=${SELF}`, "-c", "gpg.minTrustLevel=undefined", "log", "--no-merges", "--format=%H%x09%G?%x09%GS%x09%s", range],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 },
    );
  } catch {
    die(`could not read commits for "${range}" (in CI, check out with fetch-depth: 0)`);
  }
  const rows = out.trim() ? out.trim().split("\n").map((l) => l.split("\t")) : [];
  const ok = new Set(allowUnlinked ? ["G", "U"] : ["G"]);
  let failed = 0;
  for (const [sha, st, signer, subject] of rows) {
    const status = LABELS[st] ? st : "E";
    const pass = ok.has(status);
    if (!pass) failed++;
    console.log(`${sha.slice(0, 7)}  ${LABELS[status]}${signer ? `  ${signer}` : ""}  ${subject}`);
    if (!pass && gh) console.log(`::error title=Qommit::${sha.slice(0, 7)} ${LABELS[status]}: ${subject}`);
  }
  const summary = `${rows.length - failed}/${rows.length} commits pass (${allowUnlinked ? "quantum-signed" : "quantum-signed with an on-chain identity"})`;
  console.log(`\n${failed ? "✗" : "✓"} ${summary}`);
  if (gh && process.env.GITHUB_STEP_SUMMARY) {
    const md = [`### 🛡️ Qommit: ${summary}`, "", "| Commit | Status | Signer | Subject |", "|---|---|---|---|",
      ...rows.map(([sha, st, signer, subject]) => `| \`${sha.slice(0, 7)}\` | ${LABELS[LABELS[st] ? st : "E"]} | ${signer || ""} | ${subject.replace(/\|/g, "\\|")} |`)];
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join("\n") + "\n");
  }
  if (failed) process.exit(1);
}

// ---------- dispatch ----------

const HELP = `qommit — post-quantum (${ALG}) signatures for git

  qommit init [--address qor1…] [--global]   create your key and make git sign with it
  qommit address [qor1…]                     show or set the QoreChain identity your signatures claim
  qommit whoami                              show your key fingerprint, identity and on-chain bind memo
  qommit link                                link your key to your qor1 address on QoreChain (via QoreX)
  qommit status                              check whether your key is linked on-chain
  qommit register                            record your key in the on-chain QommitRegistry
  qommit anchor [commit]                     timestamp a commit on-chain (default HEAD)
  qommit revoke --yes                        permanently revoke your key (e.g. lost laptop)
  qommit trust <fingerprint> [label]         trust another developer's key
  qommit verify [range] [--allow-unlinked]   check every commit in a range (exit 1 on failure; for CI)

Then use git as usual: git commit, git log --show-signature, git verify-commit.`;

const args = process.argv.slice(2);
const commands = { init: cmdInit, address: cmdAddress, whoami: cmdWhoami, trust: cmdTrust, link: cmdLink, status: cmdStatus, register: cmdRegister, revoke: cmdRevoke, anchor: cmdAnchor, verify: cmdVerify };
if (commands[args[0]]) await commands[args[0]]();
else if (args.some((a) => /^-[a-z]*s[a-z]*$/.test(a) && a.includes("b"))) gitSign(); // git passes -bsau <key>
else if (args.includes("--verify")) await gitVerify(args[args.indexOf("--verify") + 1]);
else if (args[0] === "help" || args[0] === "--help" || args[0] === "-h" || !args.length) console.log(HELP);
else die(`unknown command "${args[0]}". Run: qommit help`, 2);
