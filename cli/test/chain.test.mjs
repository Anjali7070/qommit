import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBindings } from "../src/chain.mjs";

const ME = "qor1jcy2zxezq40rk7jdx540mc3gd89tqlnpgcu767";
const EVE = "qor1wtmu5xw4mt6jt22fu0dp6qhscxn38y2h2fr2qx";
const FPR = "5DF2B17D87446BEC77422FEBEA8E108783EFF534";

// Shape of one entry in the chain's /cosmos/tx/v1beta1/txs response.
function tx({ memo = `qommit:bind:v1:${FPR}`, from = ME, code = 0, hybrid = true, hash = "AA" } = {}) {
  return {
    txhash: hash,
    height: "10601351",
    timestamp: "2026-11-23T10:00:00Z",
    code,
    tx: {
      body: {
        memo,
        messages: [{ "@type": "/cosmos.bank.v1beta1.MsgSend", from_address: from, to_address: from }],
        extension_options: hybrid ? [{ "@type": "/qorechain.pqc.v1.PQCHybridSignature" }] : [],
      },
    },
  };
}
const parse = (...txs) => parseBindings({ tx_responses: txs }, ME);

test("a successful, hybrid-signed, self-sent bind memo is a binding", () => {
  assert.deepEqual(parse(tx()).map((b) => b.fpr), [FPR]);
});

test("failed transactions don't count", () => {
  assert.equal(parse(tx({ code: 5 })).length, 0);
});

test("transactions without the post-quantum signature don't count", () => {
  assert.equal(parse(tx({ hybrid: false })).length, 0);
});

test("a bind memo sent by someone else doesn't count for me", () => {
  assert.equal(parse(tx({ from: EVE })).length, 0);
});

test("other memos and malformed fingerprints are ignored", () => {
  assert.equal(parse(tx({ memo: "bbqd-link:xyz" }), tx({ memo: "qommit:bind:v1:NOTHEX" })).length, 0);
});

test("lowercase fingerprints are normalised", () => {
  assert.equal(parse(tx({ memo: `qommit:bind:v1:${FPR.toLowerCase()}` }))[0].fpr, FPR);
});

test("empty or missing responses are safe", () => {
  assert.deepEqual(parseBindings({}, ME), []);
  assert.deepEqual(parseBindings(null, ME), []);
});

test("a cache directory that doesn't exist doesn't break the lookup (fresh CI machine)", async () => {
  const { lookupBinding } = await import("../src/chain.mjs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const cacheFile = join(tmpdir(), `qommit-test-${process.pid}-${Date.now()}`, "missing", "chain-cache.json");
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ tx_responses: [tx()] }));
  try {
    const res = await lookupBinding(ME, FPR, { cacheFile, rest: "http://test" });
    assert.equal(res.error, undefined);
    assert.equal(res.binding?.fpr, FPR);
  } finally {
    globalThis.fetch = realFetch;
  }
});
