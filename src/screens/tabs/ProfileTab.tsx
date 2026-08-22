import { useState, useEffect, useCallback } from "react";
import { useApp } from "../../context/AppContext";
import { encodeTicket } from "@dicsussion/core/transport";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { AlertBanner } from "../../components/ui/AlertBanner";
import { UserIcon, CopyIcon, CheckIcon, RefreshIcon } from "../../components/ui/Icons";

export function ProfileTab() {
  const { did, client, recordActiveInvite } = useApp();
  const [copiedDid, setCopiedDid] = useState(false);
  const [copiedTicket, setCopiedTicket] = useState(false);
  const [ticketString, setTicketString] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const loadTicket = useCallback(async () => {
    if (!client) return;
    try {
      setRefreshing(true);
      await client.refreshTicketAddresses();
      const ticketObj = client.client.getTicket();
      const encoded = encodeTicket(ticketObj);
      setTicketString(encoded);
    } catch {
      // fallback
    } finally {
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    void loadTicket();
  }, [loadTicket]);

  const handleCopyDid = async () => {
    if (!did) return;
    try {
      await navigator.clipboard.writeText(did);
      setCopiedDid(true);
      setTimeout(() => setCopiedDid(false), 2500);
    } catch {
      // ignore
    }
  };

  const handleCopyTicket = async () => {
    if (!client) return;
    try {
      // refreshTicketAddresses() before every publish — not optional.
      // The transport caches addresses at construction before STUN/relay
      // have answered. Without a fresh refresh the ticket may carry only
      // LAN-local addresses, undialable from any other network.
      setRefreshing(true);
      await client.refreshTicketAddresses();
      const ticketObj = client.client.getTicket();
      const freshTicket = encodeTicket(ticketObj);
      setTicketString(freshTicket);
      setRefreshing(false);

      await navigator.clipboard.writeText(freshTicket);
      recordActiveInvite(freshTicket);
      setCopiedTicket(true);
      setTimeout(() => setCopiedTicket(false), 2500);
    } catch {
      setRefreshing(false);
      // ignore clipboard errors
    }
  };

  // Whether this device found a direct address for itself. It describes
  // *reachability*, not a live connection to anyone -- the previous badge read
  // "Connected (Relay)" with nobody connected, and showed a green success dot
  // on a brand-new install with zero contacts. Same family as Finding 17:
  // asserting a state from a signal that does not carry it.
  const hasDirectAddress = Boolean(client?.endpoint?.directAddresses?.length);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "var(--color-bg)",
        overflowY: "auto",
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: "var(--space-lg) var(--space-lg) var(--space-md)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          backgroundColor: "var(--color-surface)",
          borderBottom: "1px solid var(--color-border)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--color-primary-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-primary)",
          }}
        >
          <UserIcon size={18} />
        </div>
        <h1
          style={{
            fontSize: "var(--font-size-h3)",
            fontFamily: "var(--font-family-headline)",
            margin: 0,
          }}
        >
          Profile & Identity
        </h1>
      </header>

      {/* Profile Details */}
      <div
        style={{
          padding: "var(--space-lg)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-xl)",
          maxWidth: 600,
        }}
      >
        {/* Safe Address Card */}
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span
              style={{
                fontSize: "var(--font-size-label)",
                fontWeight: "var(--font-weight-semibold)",
                color: "var(--color-text-muted)",
                letterSpacing: "0.04em",
              }}
            >
              YOUR SAFE ADDRESS
            </span>
            <Badge variant={hasDirectAddress ? "success" : "muted"} dot>
              {hasDirectAddress ? "Ready to connect directly" : "Ready to connect"}
            </Badge>
          </div>

          <Card style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
            <div
              style={{
                fontFamily: "var(--font-family-mono)",
                fontSize: "var(--font-size-mono)",
                padding: "10px 12px",
                backgroundColor: "var(--color-surface-dim)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border)",
                wordBreak: "break-all",
                color: "var(--color-text)",
              }}
            >
              {did || "Loading identity..."}
            </div>

            <Button
              variant="secondary"
              size="md"
              onClick={handleCopyDid}
              icon={copiedDid ? <CheckIcon size={16} style={{ color: "var(--color-success)" }} /> : <CopyIcon size={16} />}
            >
              {copiedDid ? "Copied Safe Address" : "Copy Safe Address"}
            </Button>
          </Card>
        </section>

        {/* Connection Ticket Card */}
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span
              style={{
                fontSize: "var(--font-size-label)",
                fontWeight: "var(--font-weight-semibold)",
                color: "var(--color-text-muted)",
                letterSpacing: "0.04em",
              }}
            >
              CONNECTION TICKET
            </span>
            {refreshing && (
              <span style={{ fontSize: "var(--font-size-label)", color: "var(--color-text-muted)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <RefreshIcon size={12} className="spin" /> Updating routes...
              </span>
            )}
          </div>

          <Card style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
            <p style={{ fontSize: "var(--font-size-body-sm)", color: "var(--color-text-muted)", margin: 0 }}>
              Share this ticket with a friend so your devices can connect directly.
            </p>
            <textarea
              readOnly
              value={ticketString}
              rows={3}
              style={{
                width: "100%",
                fontFamily: "var(--font-family-mono)",
                fontSize: "0.75rem",
                padding: "8px 12px",
                backgroundColor: "var(--color-surface-dim)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text)",
                resize: "none",
                outline: "none",
              }}
            />
            <Button
              variant="primary"
              size="md"
              onClick={handleCopyTicket}
              icon={copiedTicket ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
            >
              {copiedTicket ? "Ticket Copied to Clipboard" : "Copy Connection Ticket"}
            </Button>
          </Card>
        </section>

        {/* Mandatory At-Rest Disclosure Notice */}
        <AlertBanner variant="info" title="Local Storage Security Notice">
          Your chat history is stored locally on this device. Because message files are not
          encrypted on your device&apos;s disk, someone who gains physical access to it might
          be able to read them. We recommend keeping a strong lock screen password or PIN enabled.
        </AlertBanner>
      </div>
    </div>
  );
}
