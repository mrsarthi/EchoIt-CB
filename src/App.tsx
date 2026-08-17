import { useEffect, useRef, useState } from "react";
import { runS0Harness, S0TestResult } from "./s0-harness";
import { runIrohProbe, IrohProbeResult } from "./iroh-probe";
import { installBridgeHarness } from "./bridge-harness";
import { BridgeScreen } from "./bridge-screen";

/**
 * Set `VITE_HARNESS=bridge` to run the two-instance transport test instead of
 * the S0/Iroh diagnostics. Two separate modes rather than one combined run:
 * S0 deliberately uses `transport: 'local'` to isolate storage, and starting
 * a real endpoint alongside it would blur what a failure means.
 */
const BRIDGE_MODE = import.meta.env.VITE_HARNESS === "bridge";

const COLOR: Record<S0TestResult["status"], string> = {
  PASSED: "#4ade80",
  FIRST_RUN: "#fbbf24",
  FAILED: "#f87171",
};

const VERDICT: Record<S0TestResult["status"], string> = {
  PASSED: "S0 PASSED — data survived a restart",
  FIRST_RUN: "FIRST RUN — relaunch to prove persistence",
  FAILED: "S0 FAILED",
};

function App() {
  const [result, setResult] = useState<S0TestResult | null>(null);
  const [irohResult, setIrohResult] = useState<IrohProbeResult | null>(null);

  const started = useRef(false);

  useEffect(() => {
    // StrictMode invokes effects twice in development. Without this guard two
    // DicsussionClient instances open the same IndexedDB concurrently, each
    // reads the history before the other writes, and both report the same
    // priorRuns — which silently corrupts the persistence signal this harness
    // exists to produce.
    if (started.current) return;
    started.current = true;

    if (BRIDGE_MODE) {
      void installBridgeHarness();
      return;
    }

    // The verdict goes into document.title as well as the DOM. Tauri does not
    // forward webview console output to the terminal on Windows, but a title
    // is readable from outside via the WebView2 remote-debugging target list
    // — which makes the result observable without a human reading the window.
    const publish = (text: string) => {
      document.title = `S0 ${text}`;
    };
    publish("RUNNING");

    runS0Harness()
      .then(async (res) => {
        setResult(res);
        // Stringified, not passed as an object: a remote-debugging console
        // renders an object argument as "Object" with no contents.
        console.log("[S0 Harness Result]: " + JSON.stringify(res));

        // S1b runs after S0 so a failure is unambiguous: S0 covers the SDK in
        // the webview, this covers the Rust Iroh endpoint. They share nothing.
        const iroh = await runIrohProbe();
        setIrohResult(iroh);
        console.log("[Iroh Probe Result]: " + JSON.stringify(iroh));

        publish(
          res.status === "FAILED"
            ? `FAILED ${res.error ?? "unknown"}`
            : `${res.status} tauri=${res.inTauriWebview} priorRuns=${res.priorRuns} init=${res.sdkInitMs}ms` +
                ` | IROH ${iroh.status}${iroh.endpointId ? ` id=${iroh.endpointId.slice(0, 12)}… addrs=${iroh.directAddresses?.length ?? 0}` : ""}` +
                `${iroh.error ? ` err=${iroh.error}` : ""}`,
        );
      })
      .catch((err: unknown) => {
        // A throw here means the harness itself broke, not the SDK under test.
        publish(`HARNESS-THREW ${err instanceof Error ? err.message : String(err)}`);
      });
  }, []);

  if (BRIDGE_MODE) {
    return <BridgeScreen />;
  }

  return (
    <div
      style={{
        padding: 24,
        fontFamily: "ui-monospace, monospace",
        background: "#121212",
        color: "#e0e0e0",
        minHeight: "100vh",
      }}
    >
      <h2 style={{ marginTop: 0 }}>Stage S0 — SDK in webview</h2>

      {!result ? (
        <p>Running…</p>
      ) : (
        <>
          <p style={{ color: COLOR[result.status], fontSize: 18, fontWeight: 700 }}>
            {VERDICT[result.status]}
          </p>

          <p style={{ color: result.inTauriWebview ? "#4ade80" : "#fbbf24" }}>
            {result.inTauriWebview
              ? "Running in the Tauri webview."
              : "Running in a browser — this does NOT satisfy S0."}
          </p>

          <pre
            style={{
              background: "#1e1e1e",
              padding: 15,
              borderRadius: 5,
              overflowX: "auto",
            }}
          >
            {JSON.stringify(result, null, 2)}
          </pre>

          <h2>Stage S1b — Rust Iroh endpoint</h2>
          {!irohResult ? (
            <p>Running…</p>
          ) : (
            <>
              <p
                style={{
                  color:
                    irohResult.status === "PASSED"
                      ? "#4ade80"
                      : irohResult.status === "SKIPPED"
                        ? "#fbbf24"
                        : "#f87171",
                  fontSize: 18,
                  fontWeight: 700,
                }}
              >
                {irohResult.status === "PASSED"
                  ? "Endpoint bound and reported its identity"
                  : `IROH ${irohResult.status}`}
              </p>
              <p style={{ color: "#9ca3af" }}>
                Bound with a random key, so this endpoint is not dialable by any
                peer — it proves the endpoint exists, not that it is reachable.
              </p>
              <pre
                style={{
                  background: "#1e1e1e",
                  padding: 15,
                  borderRadius: 5,
                  overflowX: "auto",
                }}
              >
                {JSON.stringify(irohResult, null, 2)}
              </pre>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default App;
