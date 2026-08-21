import { useState } from "react";
import {
  SearchIcon,
  AddressBookIcon,
  UserPlusIcon,
  BanIcon,
  EyeOffIcon,
  CopyIcon,
  CheckIcon,
} from "../../components/ui/Icons";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { useApp } from "../../context/AppContext";
import { AddContactModal } from "../../components/pairing/AddContactModal";
import { TwoStepsChecklist } from "../../components/pairing/TwoStepsChecklist";
import type { Contact } from "../../services/pairing-store";

export interface ContactsTabProps {
  onSelectContact?: (peerDid: string) => void;
}

export function ContactsTab({ onSelectContact }: ContactsTabProps) {
  const {
    contacts,
    pendingRequests,
    pairAndConnect,
    ignoreRequest,
    blockPeer,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState("");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [connectTargetDid, setConnectTargetDid] = useState<string | null>(null);
  const [copiedDid, setCopiedDid] = useState<string | null>(null);

  const filteredContacts = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.peerDid.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCopyDid = async (didToCopy: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(didToCopy);
      setCopiedDid(didToCopy);
      setTimeout(() => setCopiedDid(null), 2000);
    } catch {
      // ignore
    }
  };

  const handleOpenConnectForKnock = (peerDid: string) => {
    setConnectTargetDid(peerDid);
    setAddModalOpen(true);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "var(--color-bg)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: "var(--space-lg) var(--space-lg) var(--space-md)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-md)",
          backgroundColor: "var(--color-surface)",
          borderBottom: "1px solid var(--color-border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
              <AddressBookIcon size={18} />
            </div>
            <h1
              style={{
                fontSize: "var(--font-size-h3)",
                fontFamily: "var(--font-family-headline)",
                margin: 0,
              }}
            >
              Contacts
            </h1>
          </div>

          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setConnectTargetDid(null);
              setAddModalOpen(true);
            }}
            icon={<UserPlusIcon size={16} />}
          >
            Add Contact
          </Button>
        </div>

        {/* Search */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 12px",
            height: 40,
            backgroundColor: "var(--color-surface-dim)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <SearchIcon size={16} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search contacts by name or ID..."
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              outline: "none",
              color: "var(--color-text)",
              fontFamily: "var(--font-family-body)",
              fontSize: "var(--font-size-body-sm)",
            }}
          />
        </div>
      </header>

      {/* Content Stream */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "var(--space-lg)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-xl)",
        }}
      >
        {/* Section 1: Inbound Connection Requests (Knocks) */}
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontSize: "var(--font-size-label)",
                fontWeight: "var(--font-weight-semibold)",
                color: "var(--color-text-muted)",
                letterSpacing: "0.04em",
              }}
            >
              CONNECTION REQUESTS
            </span>
            {pendingRequests.length > 0 && (
              <Badge variant="default">
                {pendingRequests.length} pending
              </Badge>
            )}
          </div>

          {pendingRequests.length === 0 ? (
            <Card dim style={{ padding: "var(--space-md) var(--space-lg)" }}>
              <p style={{ fontSize: "var(--font-size-body-sm)", color: "var(--color-text-muted)", margin: 0 }}>
                No pending requests. Incoming connection requests from shared tickets will appear here quietly.
              </p>
            </Card>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
              {pendingRequests.map((req) => {
                const displayName = req.claimedName || `Device ending in ...${req.peerDid.slice(-6)}`;
                return (
                  <Card
                    key={req.peerDid}
                    style={{
                      padding: "var(--space-md) var(--space-lg)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-md)",
                    }}
                  >
                    {/* Knock Header */}
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: "var(--font-weight-semibold)", fontSize: "var(--font-size-body)" }}>
                          {displayName}
                        </div>
                        <div
                          style={{
                            fontFamily: "var(--font-family-mono)",
                            fontSize: "var(--font-size-label)",
                            color: "var(--color-text-muted)",
                            wordBreak: "break-all",
                            marginTop: 2,
                          }}
                        >
                          {req.peerDid}
                        </div>
                      </div>

                      <button
                        onClick={(e) => handleCopyDid(req.peerDid, e)}
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--color-text-muted)",
                          padding: 4,
                        }}
                        title="Copy full Safe Address"
                      >
                        {copiedDid === req.peerDid ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
                      </button>
                    </div>

                    {/* Option B: Two Steps Checklist */}
                    <TwoStepsChecklist
                      pairingState="unilateral_pending"
                      peerName={displayName}
                      peerDid={req.peerDid}
                      onConnectBack={() => handleOpenConnectForKnock(req.peerDid)}
                    />

                    {/* Silent Action Controls */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        gap: "var(--space-sm)",
                        borderTop: "1px solid var(--color-border)",
                        paddingTop: "var(--space-sm)",
                      }}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => ignoreRequest(req.peerDid)}
                        icon={<EyeOffIcon size={14} />}
                        title="Remove request (silent — the sender is not notified)"
                      >
                        Ignore
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => blockPeer(req.peerDid)}
                        icon={<BanIcon size={14} />}
                        title="Block permanently (silent — the sender is not notified)"
                      >
                        Block
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleOpenConnectForKnock(req.peerDid)}
                      >
                        Connect
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* Section 2: Paired Contacts */}
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <div
            style={{
              fontSize: "var(--font-size-label)",
              fontWeight: "var(--font-weight-semibold)",
              color: "var(--color-text-muted)",
              letterSpacing: "0.04em",
            }}
          >
            PAIRED CONTACTS
          </div>

          {filteredContacts.length === 0 ? (
            <div
              style={{
                padding: "var(--space-xl)",
                textAlign: "center",
                color: "var(--color-text-muted)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
              }}
            >
              <p style={{ fontSize: "var(--font-size-body-sm)", margin: 0 }}>
                {contacts.length === 0
                  ? "No contacts added yet. Click 'Add Contact' above to connect with a friend."
                  : "No contacts match your search."}
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
              {filteredContacts.map((contact: Contact) => {
                const isConnected = contact.pairingState === "bilateral_connected";
                return (
                  <Card
                    key={contact.peerDid}
                    onClick={() => onSelectContact?.(contact.peerDid)}
                    style={{
                      padding: "var(--space-md) var(--space-lg)",
                      cursor: onSelectContact ? "pointer" : "default",
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-sm)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
                      {/* Avatar */}
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: "var(--radius-full)",
                          backgroundColor: "var(--color-surface-dim)",
                          border: "1px solid var(--color-border)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: "var(--font-weight-semibold)",
                          fontSize: "var(--font-size-body)",
                          color: "var(--color-text)",
                          flexShrink: 0,
                          position: "relative",
                        }}
                      >
                        {contact.name.slice(0, 1).toUpperCase()}
                        {isConnected && (
                          <span
                            style={{
                              position: "absolute",
                              bottom: 0,
                              right: 0,
                              width: 10,
                              height: 10,
                              borderRadius: "50%",
                              backgroundColor: "var(--color-success)",
                              border: "2px solid var(--color-surface)",
                            }}
                          />
                        )}
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span
                            style={{
                              fontSize: "var(--font-size-body)",
                              fontWeight: "var(--font-weight-semibold)",
                              color: "var(--color-text)",
                            }}
                          >
                            {contact.name}
                          </span>
                          <TwoStepsChecklist
                            pairingState={contact.pairingState}
                            peerName={contact.name}
                            variant="compact"
                          />
                        </div>

                        <div
                          style={{
                            fontFamily: "var(--font-family-mono)",
                            fontSize: "var(--font-size-label)",
                            color: "var(--color-text-muted)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            marginTop: 2,
                          }}
                        >
                          {contact.peerDid}
                        </div>
                      </div>
                    </div>

                    {/* If waiting for peer, show explicit Two Steps checklist inline */}
                    {!isConnected && (
                      <TwoStepsChecklist
                        pairingState="unilateral_waiting"
                        peerName={contact.name}
                        peerDid={contact.peerDid}
                      />
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Add Contact / Accept Ticket Modal */}
      <AddContactModal
        isOpen={addModalOpen}
        onClose={() => {
          setAddModalOpen(false);
          setConnectTargetDid(null);
        }}
        initialName={
          connectTargetDid ? `Device ending in ...${connectTargetDid.slice(-6)}` : ""
        }
        onConnect={async (ticketString, name) => {
          await pairAndConnect(ticketString, name);
        }}
      />
    </div>
  );
}
