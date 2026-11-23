import { useEffect, useState } from "react";
import { getQorexNative, hasCapability, type QorexShieldState } from "@qorechain/qorex-types";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";

import { CHAIN_ID, EXPLORER, FPR_RE, bindMemo, findBindings, unbindMemo, type Binding } from "./qommit";

type LinkResult = { txHash: string; shield: QorexShieldState | string };

// Turn wallet errors into something a person can act on.
function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/locked/i.test(msg)) return "QoreX is locked. Click the QoreX icon in your browser toolbar, unlock it, then try again.";
  if (/reject|denied|cancel/i.test(msg)) return "Request cancelled in QoreX. Nothing was signed.";
  if (/unsupported chain|network/i.test(msg)) return `Switch QoreX to Testnet (${CHAIN_ID}) and try again.`;
  return msg;
}

export function LinkKey(): JSX.Element {
  // The CLI opens this page with ?fpr=<fingerprint>; it can also be pasted. A link can come from anyone (phishing:
  // "link this key" with the ATTACKER's fingerprint), so the user must confirm it's the key on their own computer.
  const fromUrl = new URLSearchParams(location.search).get("fpr");
  const [fpr, setFpr] = useState(() => (fromUrl ?? "").toUpperCase());
  const [confirmed, setConfirmed] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [bindings, setBindings] = useState<Binding[] | null>(null);
  const [result, setResult] = useState<LinkResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fprValid = FPR_RE.test(fpr);
  const alreadyLinked = bindings?.some((b) => b.fingerprint === fpr) ?? false;

  async function refreshBindings(addr: string): Promise<void> {
    try {
      setBindings(await findBindings(addr));
    } catch (e) {
      setError(friendly(e));
    }
  }

  useEffect(() => {
    if (address) void refreshBindings(address);
  }, [address]);

  async function connect(): Promise<void> {
    setError(null);
    const native = getQorexNative();
    if (!native) {
      setError("QoreX wallet not found. Install the QoreX browser extension and set it to Testnet.");
      return;
    }
    try {
      await native.enable(CHAIN_ID);
      const key = await native.getKey(CHAIN_ID);
      setAddress(key.bech32Address);
    } catch (e) {
      setError(friendly(e));
    }
  }

  async function send(memo: string): Promise<void> {
    const native = getQorexNative();
    if (!native || !address) return;
    if (!hasCapability(native, "signAndBroadcast")) {
      setError("This QoreX build can't sign and broadcast transactions. Please update QoreX.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      // A 1 uqor (0.000001 QOR) transfer to yourself. The transfer is only a carrier: the memo is the statement,
      // and QoreX signs the whole transaction with secp256k1 + ML-DSA-87, so only this wallet could have made it.
      const msg = MsgSend.fromPartial({
        fromAddress: address,
        toAddress: address,
        amount: [{ denom: "uqor", amount: "1" }],
      });
      const res = await native.signAndBroadcast({
        chainId: CHAIN_ID,
        messages: [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: MsgSend.encode(msg).finish() }],
        memo,
      });
      if (res.code !== 0) throw new Error(`transaction failed on-chain (code ${res.code})`);
      setResult({ txHash: res.txHash, shield: res.shield });
      // The search index can lag a block or two behind.
      setTimeout(() => void refreshBindings(address), 6000);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p style={styles.muted}>
        Link your post-quantum git signing key to your QoreChain identity. Run <code>qommit link</code> to open this
        page with your key filled in.
      </p>

      <section style={styles.card}>
        <h2 style={styles.h2}>1. Your Qommit key</h2>
        {fromUrl && (
          <p style={styles.warn}>
            ⚠️ This fingerprint came from the link you opened. Only continue if <code>qommit whoami</code> on{" "}
            <b>your own computer</b> prints exactly this fingerprint. Linking someone else's key lets them sign as you.
          </p>
        )}
        <p style={styles.muted}>
          Run <code>qommit whoami</code> and paste the fingerprint.
        </p>
        <input
          value={fpr}
          onChange={(e) => setFpr(e.target.value.trim().toUpperCase())}
          placeholder="40-character key fingerprint"
          aria-label="Qommit key fingerprint"
          style={{ ...styles.input, borderColor: fpr && !fprValid ? "#b00020" : "#ccc" }}
        />
        {fpr && !fprValid && <p style={styles.err}>A fingerprint is 40 hex characters (0-9, A-F).</p>}
        <label style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "flex-start" }}>
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>
            I ran <code>qommit whoami</code> on my own computer and this is my key's fingerprint.
          </span>
        </label>
      </section>

      <section style={styles.card}>
        <h2 style={styles.h2}>2. Connect QoreX</h2>
        {address ? (
          <p>
            Connected: <code>{address}</code>
          </p>
        ) : (
          <button onClick={connect} style={styles.button}>
            Connect QoreX (Testnet)
          </button>
        )}
      </section>

      <section style={styles.card}>
        <h2 style={styles.h2}>3. Link on-chain</h2>
        <p style={styles.muted}>
          QoreX will ask you to approve a 0.000001 QOR transfer to yourself with this memo. It's signed with both your
          classical and your post-quantum key.
        </p>
        <pre style={styles.pre}>{fprValid ? bindMemo(fpr) : "qommit:bind:v1:<fingerprint>"}</pre>
        {alreadyLinked ? (
          <p>✅ This key is already linked to your address.</p>
        ) : (
          <button onClick={() => void send(bindMemo(fpr))} disabled={!address || !fprValid || !confirmed || busy} style={styles.button}>
            {busy ? "Waiting for QoreX…" : "Link key"}
          </button>
        )}
        {result && (
          <p>
            {result.shield === "shielded" ? "✅ Done, signed with a hybrid post-quantum signature." : `Sent (shield: ${result.shield}).`}{" "}
            <a href={`${EXPLORER}/tx/${result.txHash}`} target="_blank" rel="noreferrer">
              View transaction
            </a>
          </p>
        )}
      </section>

      {bindings && bindings.length > 0 && (
        <section style={styles.card}>
          <h2 style={styles.h2}>Keys linked to this address</h2>
          <p style={styles.muted}>
            Don't recognise one? Unlink it: QoreX signs <code>qommit:unbind:v1:&lt;fingerprint&gt;</code> and verifiers
            stop trusting that key for your identity.
          </p>
          <ul>
            {bindings.map((b) => (
              <li key={b.txHash} style={{ marginBottom: 6 }}>
                <code>{b.fingerprint}</code> · block {b.height} · {new Date(b.time).toLocaleString()}{" "}
                <button onClick={() => void send(unbindMemo(b.fingerprint))} disabled={busy} style={styles.small}>
                  Unlink
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <p style={styles.err} role="alert">
          {error}
        </p>
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: { fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "2rem auto", padding: "0 1rem", lineHeight: 1.5 },
  muted: { color: "#555", marginTop: 4 },
  card: { border: "1px solid #e5e5e5", borderRadius: 10, padding: "1rem 1.25rem", marginTop: "1rem" },
  h2: { fontSize: "1.1rem", margin: 0 },
  input: { width: "100%", padding: "0.6rem", fontFamily: "monospace", border: "1px solid #ccc", borderRadius: 6, boxSizing: "border-box" },
  button: { padding: "0.6rem 1.1rem", borderRadius: 6, border: "none", background: "#4b3cf5", color: "white", cursor: "pointer" },
  pre: { background: "#f5f5f5", padding: "0.75rem", borderRadius: 6, overflowX: "auto" },
  err: { color: "#b00020" },
  warn: { background: "#fff6e0", border: "1px solid #f0d58a", borderRadius: 6, padding: "0.6rem 0.8rem" },
  small: { padding: "0.15rem 0.6rem", borderRadius: 5, border: "1px solid #b00020", background: "white", color: "#b00020", cursor: "pointer", fontSize: 13 },
};
