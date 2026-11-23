#!/usr/bin/env node
// Blocks commits that would publish secrets. Run by .githooks/pre-commit on the staged files;
// `node scripts/scan-secrets.mjs --all` scans every tracked file (used in CI).
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const all = process.argv.includes("--all");
const files = (all ? git("ls-files") : git("diff", "--cached", "--name-only", "--diff-filter=ACMR"))
  .split("\n")
  .filter(Boolean);

const BAD_NAMES = [
  [/(^|\/)\.env(\..+)?$/, "environment file (holds keys)", (f) => !/\.env\.example$/.test(f)],
  [/(^|\/)key\.json$/, "qommit key file"],
  [/(^|\/)chain-cache\.json$/, "qommit cache"],
  [/\.qommit-key$/, "qommit key file"],
  [/(^|\/)id_(rsa|ed25519|ecdsa)$/, "SSH private key"],
];
const BAD_CONTENT = [
  [/PRIVATE_KEY[ \t]*=[ \t]*0x(?!0{64})[0-9a-fA-F]{64}(?![0-9a-fA-F])/, "a filled-in PRIVATE_KEY"], // all-zero placeholder allowed
  [/QRC1-[A-Za-z0-9-]{20,}/, "a PQC recovery code"],
  [/QORE_MNEMONIC[ \t]*=[ \t]*[a-z]+([ \t]+[a-z]+){11,}/, "a filled-in mnemonic"],
  [/"secretKey"\s*:\s*"[A-Za-z0-9+/=]{200,}"/, "an ML-DSA secret key"],
  [/-----BEGIN (OPENSSH|RSA|EC|DSA)? ?PRIVATE KEY-----/, "a private key block"],
];

// Exact secret values that exist on this machine: anything long in a local .env file, and the Qommit secret key.
// Pattern rules can miss a key in an unusual format; an exact match can't.
const root = git("rev-parse", "--show-toplevel").trim();
const localSecrets = [];
for (const envFile of git("ls-files", "--others", "--ignored", "--exclude-standard").split("\n").filter((f) => /(^|\/)\.env$/.test(f))) {
  for (const line of readFileSync(join(root, envFile), "utf8").split("\n")) {
    const m = line.match(/^\s*[A-Z0-9_]+\s*=\s*(\S{16,})\s*$/);
    if (!m || /^0x0+$/.test(m[1]) || /^https?:/.test(m[1])) continue;
    localSecrets.push([m[1], `a value from ${envFile}`]);
    if (/^0x[0-9a-fA-F]+$/.test(m[1])) localSecrets.push([m[1].slice(2), `a value from ${envFile} (without 0x)`]);
  }
}
const keyFile = join(process.env.QOMMIT_HOME || join(homedir(), ".qommit"), "key.json");
if (existsSync(keyFile)) {
  try {
    const sk = JSON.parse(readFileSync(keyFile, "utf8")).secretKey;
    if (sk) localSecrets.push([sk.slice(0, 64), "your Qommit secret key"]);
  } catch {}
}

const problems = [];
for (const f of files) {
  for (const [re, what, extra] of BAD_NAMES) if (re.test(f) && (!extra || extra(f))) problems.push(`${f}: ${what}`);
  let text;
  try {
    text = all ? git("show", `HEAD:${f}`) : git("show", `:${f}`); // the content that would be committed
  } catch {
    continue;
  }
  if (text.includes("\0")) continue; // binary
  for (const [re, what] of BAD_CONTENT) if (re.test(text)) problems.push(`${f}: contains ${what}`);
  for (const [value, what] of localSecrets) if (text.includes(value)) problems.push(`${f}: contains ${what}`);
}

if (problems.length) {
  console.error("✗ scan-secrets: refusing to commit secrets:\n  " + problems.join("\n  "));
  console.error("Remove them from the commit (git restore --staged <file>). Nothing was committed.");
  process.exit(1);
}
console.log(`✓ scan-secrets: ${files.length} file(s) clean`);
