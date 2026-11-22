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

import { mldsa87, pubkeyHash } from "@qorechain/pqc";
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const VERSION = 1;
const ALG = "ML-DSA-87";
const DOMAIN = "qommit-v1:"; // domain separation: a qommit signature can't be replayed as anything else
const ARMOR_BEGIN = "-----BEGIN SIGNED MESSAGE-----"; // the prefix git uses to recognise x509 signatures
const ARMOR_END = "-----END SIGNED MESSAGE-----";
const KEY_DIR = process.env.QOMMIT_HOME || join(homedir(), ".qommit");
const KEY_FILE = join(KEY_DIR, "key.json");

const enc = new TextEncoder();
const hex = (b) => Buffer.from(b).toString("hex");
const b64 = (b) => Buffer.from(b).toString("base64");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
const fingerprintOf = (pk) => hex(pubkeyHash(pk, 20)).toUpperCase();
const signedBytes = (payload) => Buffer.concat([Buffer.from(DOMAIN), payload]);

function readStdin() {
  return readFileSync(0); // fd 0 = stdin, read as raw bytes
}

function loadKey() {
  if (!existsSync(KEY_FILE)) {
    process.stderr.write(`qommit: no key found at ${KEY_FILE}. Run: qommit keygen\n`);
    process.exit(1);
  }
  const k = JSON.parse(readFileSync(KEY_FILE, "utf8"));
  return { ...k, publicKey: unb64(k.publicKey), secretKey: unb64(k.secretKey) };
}

// ---------- commands ----------

function keygen() {
  if (existsSync(KEY_FILE) && !process.argv.includes("--force")) {
    process.stderr.write(`qommit: key already exists at ${KEY_FILE} (use --force to replace)\n`);
    process.exit(1);
  }
  const { publicKey, secretKey } = mldsa87.keygen();
  const fingerprint = fingerprintOf(publicKey);
  mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(
    KEY_FILE,
    JSON.stringify({ v: VERSION, alg: ALG, fingerprint, publicKey: b64(publicKey), secretKey: b64(secretKey) }, null, 2),
    { mode: 0o600 },
  );
  chmodSync(KEY_FILE, 0o600); // only you can read your secret key
  console.log(`Created ${ALG} key\n  fingerprint: ${fingerprint}\n  stored at:   ${KEY_FILE}`);
}

function sign() {
  const key = loadKey();
  const payload = readStdin();
  const sig = mldsa87.sign(key.secretKey, signedBytes(payload));
  const body = JSON.stringify({ v: VERSION, alg: ALG, fpr: key.fingerprint, pk: b64(key.publicKey), sig: b64(sig) });
  const wrapped = b64(enc.encode(body)).match(/.{1,64}/g).join("\n");
  process.stdout.write(`${ARMOR_BEGIN}\n${wrapped}\n${ARMOR_END}\n`);
  // Git requires this status line (preceded by a newline) or it reports "failed to sign the data".
  const now = Math.floor(Date.now() / 1000);
  process.stderr.write(`\n[GNUPG:] SIG_CREATED D 0 0 00 ${now} ${key.fingerprint}\n`);
}

function parseSignature(armored) {
  const inner = armored.replace(ARMOR_BEGIN, "").replace(ARMOR_END, "").replace(/\s+/g, "");
  const body = JSON.parse(Buffer.from(inner, "base64").toString("utf8"));
  if (body.v !== VERSION || body.alg !== ALG) throw new Error(`unsupported signature (${body.alg} v${body.v})`);
  return { fpr: body.fpr, publicKey: unb64(body.pk), sig: unb64(body.sig) };
}

function verify(sigFile) {
  const payload = readStdin();
  const status = (line) => process.stdout.write(`[GNUPG:] ${line}\n`);
  // Git searches for "\n[GNUPG:] GOODSIG", so GOODSIG must not be the first line. Real GPG prints NEWSIG first too.
  status("NEWSIG");
  let parsed;
  try {
    parsed = parseSignature(readFileSync(sigFile, "utf8"));
  } catch (e) {
    status(`ERRSIG 0000000000000000 0 0 00 0 9`);
    process.stderr.write(`qommit: unreadable signature: ${e.message}\n`);
    process.exit(1);
  }
  const { fpr, publicKey, sig } = parsed;
  // The fingerprint inside the signature must really be the hash of the embedded key.
  const keyMatches = fingerprintOf(publicKey) === fpr;
  const valid = keyMatches && mldsa87.verify(publicKey, signedBytes(payload), sig);
  const keyId = fpr.slice(-16);
  if (!valid) {
    status(`BADSIG ${keyId} qommit ${fpr}`);
    process.stderr.write(`qommit: ❌ BAD ${ALG} signature (key ${fpr})\n`);
    process.exit(1);
  }
  const now = Math.floor(Date.now() / 1000);
  const trusted = trustedFingerprints().has(fpr);
  status(`GOODSIG ${keyId} qommit ${fpr}`);
  status(`VALIDSIG ${fpr} 1970-01-01 ${now} 0 4 0 1 10 00 ${fpr}`);
  // A valid signature only proves "someone with this key signed". Trust says whether that key is someone you
  // accept. Git's verify-commit fails unless the key is trusted. (Next step: trust keys bound on-chain to a qor1 address.)
  status(trusted ? `TRUST_FULLY 0 qommit` : `TRUST_UNDEFINED 0 qommit`);
  process.stderr.write(
    trusted
      ? `qommit: ✅ Good ${ALG} (post-quantum) signature from trusted key ${fpr}\n`
      : `qommit: ⚠️  Valid ${ALG} signature, but key ${fpr} is not trusted (add it to ${TRUST_FILE})\n`,
  );
}

const TRUST_FILE = join(KEY_DIR, "trusted");

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

// ---------- dispatch ----------
const args = process.argv.slice(2);
if (args[0] === "keygen") keygen();
else if (args.some((a) => /^-[a-z]*s[a-z]*$/.test(a) && a.includes("b"))) sign(); // git passes -bsau <key>
else if (args.includes("--verify")) verify(args[args.indexOf("--verify") + 1]);
else {
  process.stderr.write("usage: qommit keygen | (called by git as gpg.x509.program)\n");
  process.exit(2);
}
