import React, { useEffect, useState } from "react";

export interface EchoItHarness {
  ready: boolean;
  did: string;
  ticket: string;
  endpointId: string;
  directAddresses: string[];
  relayUrl: string | null;
  dialableFromAnywhere: boolean;
  received: string[];
  error?: string;
  pair(peerTicket: string): Promise<string>;
  connect(peerTicket: string): Promise<string>;
  send(content: string): Promise<string>;
  status(): string;
}

declare global {
  interface Window {
    __echoit?: EchoItHarness;
  }
}

export function BridgeScreen() {
  const [harnessState, setHarnessState] = useState<{
    ready: boolean;
    did: string;
    ticket: string;
    endpointId: string;
    directAddresses: string[];
    relayUrl: string | null;
    dialableFromAnywhere: boolean;
    error?: string;
  }>({
    ready: false,
    did: "",
    ticket: "",
    endpointId: "",
    directAddresses: [],
    relayUrl: null,
    dialableFromAnywhere: false,
  });

  const [receivedMessages, setReceivedMessages] = useState<string[]>([]);
  const [rawStatus, setRawStatus] = useState<string>("polling...");
  const [peerTicketInput, setPeerTicketInput] = useState<string>("");
  // Transport events with reasons — see `events` on the harness.
  const [transportEvents, setTransportEvents] = useState<string[]>([]);
  const [pairingActionLog, setPairingActionLog] = useState<{
    stage: "idle" | "pairing" | "connecting" | "done" | "error";
    pairResult?: string;
    connectResult?: string;
    error?: string;
    hasPaired: boolean;
  }>({
    stage: "idle",
    hasPaired: false,
  });

  const [messageToSend, setMessageToSend] = useState<string>("");
  const [sendStatus, setSendStatus] = useState<{
    loading: boolean;
    result?: string;
    error?: string;
  }>({
    loading: false,
  });

  const [ticketCopied, setTicketCopied] = useState<boolean>(false);
  const [showFullDid, setShowFullDid] = useState<boolean>(false);

  // Poll window.__echoit state, status, and received messages
  useEffect(() => {
    const pollHarness = () => {
      const h = window.__echoit;
      if (!h) return;

      setHarnessState({
        ready: h.ready,
        did: h.did,
        ticket: h.ticket,
        endpointId: h.endpointId,
        directAddresses: h.directAddresses || [],
        relayUrl: h.relayUrl,
        dialableFromAnywhere: h.dialableFromAnywhere,
        error: h.error,
      });

      // Update received messages
      if (h.received && Array.isArray(h.received)) {
        setReceivedMessages([...h.received]);
      }

      if (Array.isArray((h as { events?: string[] }).events)) {
        setTransportEvents([...((h as { events?: string[] }).events ?? [])]);
      }

      // Update status string
      if (typeof h.status === "function") {
        try {
          const s = h.status();
          setRawStatus(s);
        } catch (e) {
          setRawStatus(`status error: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    };

    pollHarness();
    const interval = setInterval(pollHarness, 500);
    return () => clearInterval(interval);
  }, []);

  const handleCopyTicket = async () => {
    if (!harnessState.ticket) return;
    try {
      await navigator.clipboard.writeText(harnessState.ticket);
      setTicketCopied(true);
      setTimeout(() => setTicketCopied(false), 2000);
    } catch {
      // Fallback if clipboard API fails
      const el = document.createElement("textarea");
      el.value = harnessState.ticket;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setTicketCopied(true);
      setTimeout(() => setTicketCopied(false), 2000);
    }
  };

  const handlePairOnly = async () => {
    const t = peerTicketInput.trim();
    if (!t) return;
    const h = window.__echoit;
    if (!h || !h.ready) return;

    setPairingActionLog({
      stage: "pairing",
      hasPaired: false,
    });

    try {
      const res = await h.pair(t);
      setPairingActionLog({
        stage: "done",
        pairResult: res,
        hasPaired: true,
      });
    } catch (err: unknown) {
      setPairingActionLog({
        stage: "error",
        error: err instanceof Error ? err.message : String(err),
        hasPaired: false,
      });
    }
  };

  const handlePairAndConnect = async () => {
    const t = peerTicketInput.trim();
    if (!t) return;
    const h = window.__echoit;
    if (!h || !h.ready) return;

    setPairingActionLog({
      stage: "pairing",
      hasPaired: false,
    });

    try {
      const pairRes = await h.pair(t);
      setPairingActionLog({
        stage: "connecting",
        pairResult: pairRes,
        hasPaired: true,
      });

      const connRes = await h.connect(t);
      setPairingActionLog({
        stage: "done",
        pairResult: pairRes,
        connectResult: connRes,
        hasPaired: true,
      });
    } catch (err: unknown) {
      setPairingActionLog((prev) => ({
        stage: "error",
        pairResult: prev.pairResult,
        error: err instanceof Error ? err.message : String(err),
        hasPaired: prev.hasPaired,
      }));
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const msg = messageToSend.trim();
    if (!msg) return;
    const h = window.__echoit;
    if (!h || !h.ready) return;

    setSendStatus({ loading: true });
    try {
      const res = await h.send(msg);
      setSendStatus({ loading: false, result: res });
      setMessageToSend("");
    } catch (err: unknown) {
      setSendStatus({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Parse status details: e.g. "peers=1 connected=true relayed=false"
  const isConnected = rawStatus.includes("connected=true");
  const isRelayed = rawStatus.includes("relayed=true");
  const isDirect = rawStatus.includes("relayed=false") && isConnected;
  const peerCountMatch = rawStatus.match(/peers=(\d+)/);
  const peerCount = peerCountMatch ? peerCountMatch[1] : "?";

  // Shorten DID helper
  const shortenDid = (did: string) => {
    if (!did || did.length < 24) return did || "(not available)";
    return `${did.slice(0, 16)}…${did.slice(-8)}`;
  };

  // 1. Error state
  if (harnessState.error) {
    return (
      <div style={containerStyle}>
        <header style={headerStyle}>
          <h1 style={titleStyle}>EchoIt Bridge Diagnostic Harness</h1>
          <div style={badgeStyle("#ef4444", "#ffffff")}>FAILED</div>
        </header>
        <div style={cardStyle("#3b1111", "#ef4444")}>
          <h2 style={{ margin: "0 0 8px 0", color: "#f87171", fontSize: 18 }}>Initialization Error</h2>
          <p style={{ margin: 0, fontFamily: "monospace", color: "#fca5a5", wordBreak: "break-all" }}>
            {harnessState.error}
          </p>
        </div>
      </div>
    );
  }

  // 2. Starting / Initializing state
  if (!harnessState.ready) {
    return (
      <div style={containerStyle}>
        <header style={headerStyle}>
          <h1 style={titleStyle}>EchoIt Bridge Diagnostic Harness</h1>
          <div style={badgeStyle("#eab308", "#18181b")}>STARTING</div>
        </header>
        <div style={cardStyle("#1e1e24", "#3f3f46")}>
          <p style={{ fontSize: 16, margin: "0 0 12px 0", color: "#fbbf24" }}>
            Starting client and binding Iroh endpoint…
          </p>
          <p style={{ color: "#9ca3af", fontSize: 14, margin: 0 }}>
            Waiting for local key generation, transport pipe binding, and STUN/relay address resolution.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* Header & Primary Status */}
      <header style={headerStyle}>
        <div>
          <h1 style={titleStyle}>EchoIt Bridge Diagnostic Harness</h1>
          <p style={{ margin: "4px 0 0 0", color: "#9ca3af", fontSize: 13 }}>
            Two-device encrypted transport verification instrument
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={badgeStyle("#22c55e", "#052e16")}>READY</div>
        </div>
      </header>

      {/* Transport event log — names WHY a connection closed. A bare
          "Connection closed" cannot distinguish a refused dial from a dropped
          stream from a read error, and those have different causes. */}
      <div
        style={{
          border: "1px solid #333",
          borderRadius: 6,
          padding: 14,
          marginBottom: 18,
          background: "#0d0d0d",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8, letterSpacing: 0.5 }}>
          TRANSPORT EVENT LOG
        </div>
        {transportEvents.length === 0 ? (
          <div style={{ color: "#6b7280" }}>No transport events yet.</div>
        ) : (
          <pre
            style={{
              margin: 0,
              maxHeight: 160,
              overflowY: "auto",
              fontSize: 12,
              color: "#d1d5db",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {transportEvents.slice(-12).join("\n")}
          </pre>
        )}
      </div>

      {/* SECTION 5 (Prominent Live Status & Relayed Measurement) */}
      <div style={sectionStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h2 style={sectionHeaderStyle}>Transport Status & Measurement</h2>
          <span style={{ fontSize: 12, color: "#9ca3af", fontFamily: "monospace" }}>
            Raw: {rawStatus}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          {/* Relayed Measurement Highlight */}
          <div
            style={{
              padding: "12px 16px",
              borderRadius: 6,
              background: isConnected
                ? isDirect
                  ? "#064e3b"
                  : isRelayed
                    ? "#3b1c54"
                    : "#1e293b"
                : "#27272a",
              border: `1px solid ${
                isConnected
                  ? isDirect
                    ? "#10b981"
                    : isRelayed
                      ? "#a855f7"
                      : "#64748b"
                  : "#52525b"
              }`,
            }}
          >
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "#cbd5e1" }}>
              Transport Measurement
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                marginTop: 4,
                color: isConnected
                  ? isDirect
                    ? "#34d399"
                    : isRelayed
                      ? "#d8b4fe"
                      : "#ffffff"
                  : "#9ca3af",
              }}
            >
              {!isConnected
                ? "Not Connected"
                : isDirect
                  ? "DIRECT (relayed=false)"
                  : isRelayed
                    ? "RELAYED (relayed=true)"
                    : "UNKNOWN"}
            </div>
            <div style={{ fontSize: 12, marginTop: 4, color: "#d1d5db" }}>
              {!isConnected
                ? "No peer connected yet."
                : isDirect
                  ? "Direct peer-to-peer connection achieved."
                  : isRelayed
                    ? "Direct path unavailable; traffic relayed through server."
                    : ""}
            </div>
          </div>

          {/* Connection State */}
          <div style={statCardStyle}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "#9ca3af" }}>
              Connection State
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                marginTop: 4,
                color: isConnected ? "#4ade80" : "#fbbf24",
              }}
            >
              {isConnected ? "Connected" : "Disconnected"}
            </div>
            <div style={{ fontSize: 12, marginTop: 4, color: "#9ca3af" }}>
              Active peers: <strong style={{ color: "#ffffff" }}>{peerCount}</strong>
            </div>
          </div>

          {/* Reachability */}
          <div style={statCardStyle}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "#9ca3af" }}>
              Global Reachability
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                marginTop: 4,
                color: harnessState.dialableFromAnywhere ? "#4ade80" : "#fbbf24",
              }}
            >
              {harnessState.dialableFromAnywhere ? "Dialable Anywhere" : "LAN Only"}
            </div>
            <div style={{ fontSize: 12, marginTop: 4, color: "#9ca3af" }}>
              Relay URL: {harnessState.relayUrl ? harnessState.relayUrl : "None"}
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 1: This Device */}
      <div style={sectionStyle}>
        <h2 style={sectionHeaderStyle}>1. This Device</h2>

        {/* Dialable from anywhere warning */}
        {!harnessState.dialableFromAnywhere ? (
          <div
            style={{
              background: "#422006",
              border: "1px solid #f59e0b",
              borderRadius: 6,
              padding: "12px 16px",
              marginBottom: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#fbbf24", fontWeight: 700, fontSize: 14 }}>
              <span>⚠️ Warning: Waiting for a public address</span>
            </div>
            <p style={{ margin: "4px 0 0 0", color: "#fef3c7", fontSize: 13 }}>
              Waiting for a public address — a ticket shared now only works on this network.
            </p>
          </div>
        ) : (
          <div
            style={{
              background: "#064e3b",
              border: "1px solid #10b981",
              borderRadius: 6,
              padding: "8px 12px",
              marginBottom: 16,
              color: "#a7f3d0",
              fontSize: 13,
            }}
          >
            ✓ Dialable from anywhere (public address & relay assigned)
          </div>
        )}

        <div style={{ display: "grid", gap: 12 }}>
          {/* DID */}
          <div>
            <div style={labelStyle}>Device DID</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <code style={codeBlockStyle}>
                {showFullDid ? harnessState.did : shortenDid(harnessState.did)}
              </code>
              <button
                type="button"
                onClick={() => setShowFullDid(!showFullDid)}
                style={secondaryButtonStyle}
              >
                {showFullDid ? "Shorten" : "Show Full"}
              </button>
            </div>
          </div>

          {/* Ticket */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={labelStyle}>Device Ticket (Share this with peer)</span>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>
                {harnessState.ticket.length} chars
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <textarea
                readOnly
                value={harnessState.ticket}
                style={{
                  ...textareaStyle,
                  height: 64,
                  flex: 1,
                  background: "#18181b",
                  cursor: "text",
                }}
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              />
              <button
                type="button"
                onClick={handleCopyTicket}
                style={{
                  ...primaryButtonStyle,
                  minWidth: 100,
                  background: ticketCopied ? "#16a34a" : "#2563eb",
                }}
              >
                {ticketCopied ? "✓ Copied!" : "Copy Ticket"}
              </button>
            </div>
          </div>

          {/* Direct Addresses & Relay */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={labelStyle}>Direct Addresses</div>
              <div style={infoBoxStyle}>
                {harnessState.directAddresses && harnessState.directAddresses.length > 0 ? (
                  harnessState.directAddresses.map((addr, i) => (
                    <div key={i} style={{ fontFamily: "monospace", fontSize: 12, color: "#e4e4e7" }}>
                      {addr}
                    </div>
                  ))
                ) : (
                  <span style={{ color: "#71717a", fontSize: 12 }}>None detected</span>
                )}
              </div>
            </div>

            <div>
              <div style={labelStyle}>Relay URL</div>
              <div style={infoBoxStyle}>
                <span style={{ fontFamily: "monospace", fontSize: 12, color: harnessState.relayUrl ? "#e4e4e7" : "#71717a" }}>
                  {harnessState.relayUrl || "No relay URL"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2 & 3: Connect to a peer & Mutual Pairing */}
      <div style={sectionStyle}>
        <h2 style={sectionHeaderStyle}>2. Connect to a Peer</h2>

        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <div style={labelStyle}>Peer's Ticket (Paste here)</div>
            <textarea
              placeholder="Paste peer's dicsussion1... ticket here"
              value={peerTicketInput}
              onChange={(e) => setPeerTicketInput(e.target.value)}
              style={{
                ...textareaStyle,
                height: 64,
                width: "100%",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handlePairAndConnect}
              disabled={!peerTicketInput.trim() || pairingActionLog.stage === "pairing" || pairingActionLog.stage === "connecting"}
              style={{
                ...primaryButtonStyle,
                background: "#2563eb",
                opacity: !peerTicketInput.trim() ? 0.6 : 1,
              }}
            >
              {pairingActionLog.stage === "pairing"
                ? "Pairing…"
                : pairingActionLog.stage === "connecting"
                  ? "Connecting…"
                  : "Pair & Connect"}
            </button>

            <button
              type="button"
              onClick={handlePairOnly}
              disabled={!peerTicketInput.trim() || pairingActionLog.stage === "pairing" || pairingActionLog.stage === "connecting"}
              style={{
                ...secondaryButtonStyle,
                opacity: !peerTicketInput.trim() ? 0.6 : 1,
              }}
            >
              {pairingActionLog.stage === "pairing" ? "Pairing…" : "Pair Only (Receiver Side)"}
            </button>

            {peerTicketInput && (
              <button
                type="button"
                onClick={() => setPeerTicketInput("")}
                style={{ ...secondaryButtonStyle, color: "#9ca3af" }}
              >
                Clear
              </button>
            )}
          </div>

          {/* Action Log / Progress */}
          {(pairingActionLog.stage !== "idle" || pairingActionLog.pairResult || pairingActionLog.error) && (
            <div
              style={{
                background: "#18181b",
                borderRadius: 6,
                padding: "10px 14px",
                border: "1px solid #3f3f46",
                fontSize: 13,
                fontFamily: "monospace",
              }}
            >
              <div style={{ color: "#9ca3af", marginBottom: 4 }}>Action Results:</div>
              {pairingActionLog.pairResult && (
                <div style={{ color: "#4ade80" }}>▶ Pair: {pairingActionLog.pairResult}</div>
              )}
              {pairingActionLog.connectResult && (
                <div style={{ color: "#4ade80" }}>▶ Connect: {pairingActionLog.connectResult}</div>
              )}
              {pairingActionLog.error && (
                <div style={{ color: "#f87171" }}>✖ Error: {pairingActionLog.error}</div>
              )}
            </div>
          )}
        </div>

        {/* SECTION 3: Mutual Pairing Warning — The single most important notice */}
        <div
          style={{
            marginTop: 16,
            background: "#2e1065",
            border: "2px solid #a855f7",
            borderRadius: 6,
            padding: "14px 16px",
          }}
        >
          <div style={{ color: "#e9d5ff", fontWeight: 700, fontSize: 14, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <span>⚠️ CRITICAL: Pairing is Mutual</span>
          </div>
          <p style={{ margin: 0, color: "#f5d0fe", fontSize: 14, lineHeight: 1.5, fontWeight: 500 }}>
            You have added them. <strong>They must add you too, or nothing you send will arrive.</strong>
          </p>
          <p style={{ margin: "6px 0 0 0", color: "#d8b4fe", fontSize: 12, lineHeight: 1.4 }}>
            A one-sided pairing will report &ldquo;connected&rdquo; at the transport layer but silently drop messages because
            encryption keys have not been mutually authorized.
          </p>
        </div>
      </div>

      {/* SECTION 4: Send and Receive */}
      <div style={sectionStyle}>
        <h2 style={sectionHeaderStyle}>3. Send & Receive Messages</h2>

        {/* Send form */}
        <form onSubmit={handleSendMessage} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input
            type="text"
            placeholder="Type a test message (e.g. 'Hello from Laptop A')"
            value={messageToSend}
            onChange={(e) => setMessageToSend(e.target.value)}
            style={{
              ...inputStyle,
              flex: 1,
            }}
          />
          <button
            type="submit"
            disabled={!messageToSend.trim() || sendStatus.loading}
            style={{
              ...primaryButtonStyle,
              background: "#16a34a",
              minWidth: 90,
              opacity: !messageToSend.trim() || sendStatus.loading ? 0.6 : 1,
            }}
          >
            {sendStatus.loading ? "Sending…" : "Send"}
          </button>
        </form>

        {sendStatus.result && (
          <div style={{ fontSize: 12, color: "#4ade80", marginBottom: 12, fontFamily: "monospace" }}>
            ✓ Message status: {sendStatus.result}
          </div>
        )}
        {sendStatus.error && (
          <div style={{ fontSize: 12, color: "#f87171", marginBottom: 12, fontFamily: "monospace" }}>
            ✖ Send error: {sendStatus.error}
          </div>
        )}

        {/* Received messages list */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={labelStyle}>
              Received Messages ({receivedMessages.length}) — polled live (~2x/sec)
            </span>
            {receivedMessages.length > 0 && (
              <button
                type="button"
                onClick={() => setReceivedMessages([])}
                style={{ ...secondaryButtonStyle, padding: "2px 8px", fontSize: 11 }}
              >
                Clear View
              </button>
            )}
          </div>

          <div
            style={{
              background: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: 6,
              minHeight: 120,
              maxHeight: 240,
              overflowY: "auto",
              padding: 10,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {receivedMessages.length === 0 ? (
              <div style={{ color: "#71717a", fontSize: 13, fontStyle: "italic", padding: "16px 0", textAlign: "center" }}>
                No messages received yet.
              </div>
            ) : (
              [...receivedMessages].reverse().map((msg, index) => (
                <div
                  key={index}
                  style={{
                    background: "#27272a",
                    borderLeft: "3px solid #22c55e",
                    padding: "8px 12px",
                    borderRadius: "0 4px 4px 0",
                    fontFamily: "monospace",
                    fontSize: 13,
                    color: "#f4f4f5",
                    wordBreak: "break-word",
                  }}
                >
                  <div style={{ fontSize: 10, color: "#a1a1aa", marginBottom: 2 }}>
                    Message #{receivedMessages.length - index}
                  </div>
                  {msg}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Plain, functional, diagnostic-styled CSS-in-JS (no design/ tokens used)
const containerStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#09090b",
  color: "#f4f4f5",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  padding: 24,
  boxSizing: "border-box",
  maxWidth: 960,
  margin: "0 auto",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  borderBottom: "1px solid #27272a",
  paddingBottom: 16,
  marginBottom: 20,
};

const titleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  margin: 0,
  color: "#ffffff",
  letterSpacing: "-0.02em",
};

const sectionStyle: React.CSSProperties = {
  background: "#121215",
  border: "1px solid #27272a",
  borderRadius: 8,
  padding: 18,
  marginBottom: 20,
};

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  margin: "0 0 14px 0",
  color: "#ffffff",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#a1a1aa",
  marginBottom: 4,
};

const statCardStyle: React.CSSProperties = {
  background: "#18181b",
  border: "1px solid #27272a",
  borderRadius: 6,
  padding: "12px 16px",
};

const cardStyle = (bg: string, border: string): React.CSSProperties => ({
  background: bg,
  border: `1px solid ${border}`,
  borderRadius: 8,
  padding: 20,
  marginTop: 20,
});

const badgeStyle = (bg: string, color: string): React.CSSProperties => ({
  background: bg,
  color: color,
  padding: "3px 10px",
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.05em",
});

const codeBlockStyle: React.CSSProperties = {
  background: "#18181b",
  border: "1px solid #3f3f46",
  borderRadius: 4,
  padding: "6px 10px",
  fontSize: 13,
  color: "#e4e4e7",
  wordBreak: "break-all",
  flex: 1,
};

const textareaStyle: React.CSSProperties = {
  background: "#18181b",
  border: "1px solid #3f3f46",
  borderRadius: 6,
  padding: "8px 10px",
  color: "#f4f4f5",
  fontSize: 12,
  fontFamily: "inherit",
  resize: "vertical",
};

const inputStyle: React.CSSProperties = {
  background: "#18181b",
  border: "1px solid #3f3f46",
  borderRadius: 6,
  padding: "8px 12px",
  color: "#f4f4f5",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
};

const primaryButtonStyle: React.CSSProperties = {
  border: "none",
  borderRadius: 6,
  padding: "8px 16px",
  color: "#ffffff",
  fontSize: 13,
  fontWeight: 600,
  fontFamily: "inherit",
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  background: "#27272a",
  border: "1px solid #3f3f46",
  borderRadius: 6,
  padding: "6px 12px",
  color: "#e4e4e7",
  fontSize: 12,
  fontWeight: 500,
  fontFamily: "inherit",
  cursor: "pointer",
};

const infoBoxStyle: React.CSSProperties = {
  background: "#18181b",
  border: "1px solid #27272a",
  borderRadius: 4,
  padding: "8px 10px",
  minHeight: 32,
  boxSizing: "border-box",
};
