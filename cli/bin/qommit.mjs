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

const KEY_DIR = process.env.QOMMIT_HOME || join(homedir(), ".qommit");
const KEY_FILE = join(KEY_DIR, "key.json");
const CONFIG_FILE = join(KEY_DIR, "config.json");
const TRUST_FILE = join(KEY_DIR, "trusted");
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

function gitVerify(sigFile) {
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
  const trusted = trustedFingerprints().has(r.fpr);
  status(`GOODSIG ${keyId} ${r.addr || "qommit"}`);
  status(`VALIDSIG ${r.fpr} 1970-01-01 ${r.ts || 0} 0 4 0 1 10 00 ${r.fpr}`);
  // A valid signature only proves "someone with this key signed". Trust says whether that key is someone you
  // accept. With gpg.minTrustLevel=fully, git rejects untrusted keys. (Next: trust keys bound on-chain.)
  status(trusted ? `TRUST_FULLY 0 qommit` : `TRUST_UNDEFINED 0 qommit`);
  process.stderr.write(
    trusted
      ? `qommit: ✅ Good ${ALG} (post-quantum) signature from trusted key ${r.fpr}${who}\n`
      : `qommit: ⚠️  Valid ${ALG} signature${who}, but key ${r.fpr} is not trusted (qommit trust <fingerprint>)\n`,
  );
}

// ---------- dispatch ----------

const HELP = `qommit — post-quantum (${ALG}) signatures for git

  qommit init [--address qor1…] [--global]   create your key and make git sign with it
  qommit address [qor1…]                     show or set the QoreChain identity your signatures claim
  qommit whoami                              show your key fingerprint, identity and on-chain bind memo
  qommit trust <fingerprint> [label]         trust another developer's key

Then use git as usual: git commit, git log --show-signature, git verify-commit.`;

const args = process.argv.slice(2);
const commands = { init: cmdInit, address: cmdAddress, whoami: cmdWhoami, trust: cmdTrust };
if (commands[args[0]]) commands[args[0]]();
else if (args.some((a) => /^-[a-z]*s[a-z]*$/.test(a) && a.includes("b"))) gitSign(); // git passes -bsau <key>
else if (args.includes("--verify")) gitVerify(args[args.indexOf("--verify") + 1]);
else if (args[0] === "help" || args[0] === "--help" || args[0] === "-h" || !args.length) console.log(HELP);
else die(`unknown command "${args[0]}". Run: qommit help`, 2);
