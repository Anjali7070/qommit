import { useState } from "react";

import { LinkKey } from "./LinkKey";
import { Verifier } from "./Verifier";

type Tab = "verify" | "link";

export function App(): JSX.Element {
  // `qommit link` opens ?fpr=…, which goes straight to the linking tab.
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).has("fpr") ? "link" : "verify"));

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 820, margin: "2rem auto", padding: "0 1rem", lineHeight: 1.5 }}>
      <header style={{ marginBottom: "1.25rem" }}>
        <h1 style={{ margin: 0 }}>🛡️ Qommit</h1>
        <p style={{ margin: "4px 0 0", color: "#555" }}>
          Quantum-proof git commit signatures (ML-DSA-87), bound to your QoreChain identity.
        </p>
      </header>
      <nav style={{ display: "flex", gap: 4, borderBottom: "1px solid #e5e5e5", marginBottom: "1.25rem" }}>
        {(["verify", "link"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "0.5rem 1rem",
              border: "none",
              background: "none",
              cursor: "pointer",
              fontSize: 15,
              borderBottom: tab === t ? "2px solid #4b3cf5" : "2px solid transparent",
              color: tab === t ? "#4b3cf5" : "#444",
              fontWeight: tab === t ? 600 : 400,
            }}
          >
            {t === "verify" ? "Verify a repo" : "Link your key"}
          </button>
        ))}
      </nav>
      {tab === "verify" ? <Verifier /> : <LinkKey />}
      <footer style={{ marginTop: "2.5rem", color: "#888", fontSize: 13 }}>
        QoreChain testnet (qorechain-diana) · QommitRegistry{" "}
        <a href="https://explore.qore.network/address/0xB50BB93b40Ff7D7900ee3850699646c47A567482" target="_blank" rel="noreferrer">
          <code>0xB50B…7482</code>
        </a>{" "}
        ·{" "}
        <a href="https://github.com/Anjali7070/qommit" target="_blank" rel="noreferrer">
          source
        </a>
      </footer>
    </main>
  );
}
