import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKey, signPayload, verifyPayload, bindMemo, ARMOR_BEGIN } from "../src/core.mjs";
import { isValidBech32, encodeBech32 } from "../src/bech32.mjs";

const key = generateKey();
const other = generateKey();
const ADDR = encodeBech32("qor", new Uint8Array(20).fill(7));
const payload = Buffer.from("tree 4b825dc6\nauthor Anjali <a@b.c> 1795361716 +0530\n\nhello\n");

// Decode / re-encode the armored body so tests can tamper with individual fields.
const decode = (armored) =>
  JSON.parse(Buffer.from(armored.split("\n").slice(1, -2).join(""), "base64").toString());
const encode = (body) =>
  `${ARMOR_BEGIN}\n${Buffer.from(JSON.stringify(body)).toString("base64")}\n-----END SIGNED MESSAGE-----\n`;

test("good signature verifies and carries the address claim", () => {
  const r = verifyPayload(signPayload(key, payload, { addr: ADDR }), payload);
  assert.equal(r.ok, true);
  assert.equal(r.fpr, key.fingerprint);
  assert.equal(r.addr, ADDR);
});

test("armor starts with the prefix git uses to route x509 signatures", () => {
  assert.ok(signPayload(key, payload).startsWith(ARMOR_BEGIN));
});

test("changed commit content is rejected", () => {
  const sig = signPayload(key, payload, { addr: ADDR });
  const r = verifyPayload(sig, Buffer.from(payload.toString().replace("hello", "evil")));
  assert.equal(r.ok, false);
});

test("an edited address claim is rejected (the claim is signed)", () => {
  const body = decode(signPayload(key, payload, { addr: ADDR }));
  body.addr = encodeBech32("qor", new Uint8Array(20).fill(9));
  assert.equal(verifyPayload(encode(body), payload).ok, false);
});

test("an edited timestamp is rejected", () => {
  const body = decode(signPayload(key, payload, { addr: ADDR }));
  body.ts += 1;
  assert.equal(verifyPayload(encode(body), payload).ok, false);
});

test("swapping in another public key is rejected", () => {
  const body = decode(signPayload(key, payload));
  body.pk = Buffer.from(other.publicKey).toString("base64");
  assert.equal(verifyPayload(encode(body), payload).ok, false);
});

test("garbage never throws", () => {
  for (const junk of ["", "not a sig", `${ARMOR_BEGIN}\n!!!\n`, encode({ v: 2, alg: "RSA" })]) {
    assert.equal(verifyPayload(junk, payload).ok, false);
  }
});

test("bech32: valid qor address accepted, typos and wrong prefix rejected", () => {
  assert.equal(isValidBech32(ADDR), true);
  const typo = ADDR.slice(0, -1) + (ADDR.endsWith("q") ? "p" : "q");
  assert.equal(isValidBech32(typo), false);
  assert.equal(isValidBech32(encodeBech32("cosmos", new Uint8Array(20))), false);
  assert.equal(isValidBech32(ADDR.toUpperCase()), false);
});

test("bind memo fits QoreX's 256-byte memo limit", () => {
  assert.ok(Buffer.byteLength(bindMemo(key.fingerprint)) <= 256);
});

test("bech32 decode round-trips and gives the 0x account bytes", async () => {
  const { decodeBech32 } = await import("../src/bech32.mjs");
  const bytes = new Uint8Array(20).map((_, i) => i * 13);
  assert.deepEqual(decodeBech32(encodeBech32("qor", bytes)), bytes);
  assert.equal(
    Buffer.from(decodeBech32("qor1jcy2zxezq40rk7jdx540mc3gd89tqlnpgcu767")).toString("hex"),
    "9608a11b22055e3b7a4d352afde22869cab07e61",
  );
  assert.throws(() => decodeBech32("qor1notvalid"));
});
