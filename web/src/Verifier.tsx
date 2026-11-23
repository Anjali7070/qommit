import { useEffect, useState } from "react";

import { EXPLORER, findBindingsCached } from "./qommit";
import { readAnchor, readKey } from "./registry";
import { isQommitSignature, verifyQommit } from "./verify";

type Status = "verified" | "unlinked" | "bad" | "revoked" | "classical" | "unsigned";

interface Row {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
  status: Status;
  detail?: string;
  signer?: string;
  fpr?: string;
  linkTx?: string;
  anchoredAt?: number;
}

interface GhCommit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string; date: string };
    verification?: { verified: boolean; reason: string; signature: string | null; payload: string | null };
  };
}

const LABEL: Record<Status, { icon: string; text: string; color: string }> = {
  verified: { icon: "✅", text: "Quantum-signed · identity verified", color: "#0a7d32" },
  unlinked: { icon: "🟡", text: "Quantum-signed · identity not linked", color: "#9a6a00" },
  bad: { icon: "❌", text: "Invalid signature", color: "#b00020" },
  revoked: { icon: "⛔", text: "Signed by a revoked key", color: "#b00020" },
  classical: { icon: "⚠️", text: "Classical signature: forgeable after Q-Day", color: "#9a6a00" },
  unsigned: { icon: "○", text: "Not signed", color: "#777" },
};

async function checkCommit(c: GhCommit): Promise<Row> {
  const v = c.commit.verification;
  const base = {
    sha: c.sha,
    message: c.commit.message.split("\n")[0],
    author: c.commit.author.name,
    date: c.commit.author.date,
    url: c.html_url,
  };
  if (!v?.signature) return { ...base, status: "unsigned" };
  if (!isQommitSignature(v.signature)) {
    return { ...base, status: "classical", detail: v.verified ? "GPG/SSH (verified by GitHub)" : `GPG/SSH (${v.reason})` };
  }
  const sig = verifyQommit(v.signature, v.payload ?? "");
  if (!sig.ok) return { ...base, status: "bad", detail: sig.reason, fpr: sig.fpr, signer: sig.addr };

  const [bindings, key, anchor] = await Promise.all([
    sig.addr ? findBindingsCached(sig.addr).catch(() => null) : Promise.resolve([]),
    readKey(sig.publicKey!).catch(() => null),
    readAnchor(c.sha, sig.publicKey!).catch(() => null),
  ]);
  const extra = { fpr: sig.fpr, signer: sig.addr, anchoredAt: anchor?.timestamp || undefined };
  if (key?.revokedAt) {
    return { ...base, ...extra, status: "revoked", detail: `revoked ${new Date(key.revokedAt * 1000).toLocaleString()}` };
  }
  const link = bindings?.find((b) => b.fingerprint === sig.fpr);
  if (link) return { ...base, ...extra, status: "verified", linkTx: link.txHash };
  const detail = !sig.addr
    ? "signature has no identity claim (older qommit format)"
    : bindings === null
      ? "couldn't reach QoreChain to check the identity link"
      : `key not linked to ${sig.addr}`;
  return { ...base, ...extra, status: "unlinked", detail };
}

function parseRepo(input: string): string | null {
  const m = input.trim().replace(/\.git$/, "").match(/(?:github\.com\/)?([\w.-]+\/[\w.-]+)\/?$/);
  return m ? m[1] : null;
}

export function Verifier(): JSX.Element {
  const initial = new URLSearchParams(location.search).get("repo") ?? "Anjali7070/qommit";
  const [input, setInput] = useState(initial);
  const [repo, setRepo] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(target = input): Promise<void> {
    const r = parseRepo(target);
    if (!r) return setError("Enter a GitHub repository like owner/name.");
    setError(null);
    setRows(null);
    setBusy(true);
    setRepo(r);
    history.replaceState(null, "", `?repo=${r}`);
    try {
      const res = await fetch(`https://api.github.com/repos/${r}/commits?per_page=30`);
      if (res.status === 403) throw new Error("GitHub rate limit reached (60 requests/hour). Try again later.");
      if (!res.ok) throw new Error(res.status === 404 ? "Repository not found (it must be public)." : `GitHub error ${res.status}`);
      const commits = (await res.json()) as GhCommit[];
      setRows(await Promise.all(commits.map(checkCommit)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void run(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const quantum = rows?.filter((r) => r.status === "verified" || r.status === "unlinked").length ?? 0;
  const verified = rows?.filter((r) => r.status === "verified").length ?? 0;
  const pct = rows?.length ? Math.round((quantum / rows.length) * 100) : 0;

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="owner/repo or https://github.com/owner/repo"
          aria-label="GitHub repository"
          style={styles.input}
        />
        <button type="submit" disabled={busy} style={styles.button}>
          {busy ? "Checking…" : "Verify"}
        </button>
      </form>
      {error && (
        <p style={{ color: "#b00020" }} role="alert">
          {error}
        </p>
      )}

      {rows && repo && (
        <>
          <div style={styles.summary}>
            <div style={{ fontSize: 34, fontWeight: 700 }}>{pct}%</div>
            <div>
              <b>
                {quantum} of {rows.length}
              </b>{" "}
              recent commits in <code>{repo}</code> are quantum-signed (ML-DSA-87)
              <br />
              <span style={{ color: "#555" }}>{verified} with an identity verified on QoreChain</span>
            </div>
          </div>

          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {rows.map((r) => (
              <li key={r.sha} style={styles.row}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <span>
                    <a href={r.url} target="_blank" rel="noreferrer">
                      <code>{r.sha.slice(0, 7)}</code>
                    </a>{" "}
                    {r.message}
                  </span>
                  <span style={{ color: LABEL[r.status].color, whiteSpace: "nowrap" }}>
                    {LABEL[r.status].icon} {LABEL[r.status].text}
                  </span>
                </div>
                <div style={styles.meta}>
                  {r.author} · {new Date(r.date).toLocaleString()}
                  {r.signer && (
                    <>
                      {" "}
                      · signer{" "}
                      <a href={`${EXPLORER}/address/${r.signer}`} target="_blank" rel="noreferrer">
                        <code>
                          {r.signer.slice(0, 10)}…{r.signer.slice(-4)}
                        </code>
                      </a>
                    </>
                  )}
                  {r.linkTx && (
                    <>
                      {" "}
                      ·{" "}
                      <a href={`${EXPLORER}/tx/${r.linkTx}`} target="_blank" rel="noreferrer">
                        key link
                      </a>
                    </>
                  )}
                  {r.anchoredAt && <> · ⏱ anchored on-chain {new Date(r.anchoredAt * 1000).toLocaleString()}</>}
                  {r.detail && <> · {r.detail}</>}
                </div>
              </li>
            ))}
          </ul>

          <details style={{ marginTop: 16 }}>
            <summary>Add a badge to your README</summary>
            <pre style={styles.pre}>
              {`[![Quantum-signed with Qommit](https://img.shields.io/badge/commits-quantum--signed%20(ML--DSA--87)-4b3cf5)](${location.origin}/?repo=${repo})`}
            </pre>
          </details>
        </>
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  input: { flex: 1, padding: "0.6rem", border: "1px solid #ccc", borderRadius: 6, fontSize: 15 },
  button: { padding: "0.6rem 1.1rem", borderRadius: 6, border: "none", background: "#4b3cf5", color: "white", cursor: "pointer" },
  summary: { display: "flex", alignItems: "center", gap: 16, margin: "1.25rem 0", padding: "1rem 1.25rem", borderRadius: 10, background: "#f3f1ff" },
  row: { borderBottom: "1px solid #eee", padding: "0.7rem 0" },
  meta: { color: "#666", fontSize: 13, marginTop: 2 },
  pre: { background: "#f5f5f5", padding: "0.75rem", borderRadius: 6, whiteSpace: "pre-wrap", wordBreak: "break-all" },
};
