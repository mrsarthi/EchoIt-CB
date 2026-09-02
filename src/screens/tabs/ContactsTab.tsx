import { useState } from "react";
import { Avatar } from "../../components/profile/Avatar";
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
import { fingerprintOf } from "../../services/reach";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { useApp } from "../../context/AppContext";
import { AddContactModal } from "../../components/pairing/AddContactModal";
import { TwoStepsChecklist } from "../../components/pairing/TwoStepsChecklist";
import type { Contact } from "../../services/pairing-store";
import { displayNameFor, isClaimedName, localNameOf } from "../../services/profile-format";
import { isReachable } from "../../services/reachability";

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
    acceptPairingRequest,
    peerProfiles,
    presenceEvidence,
  } = useApp();

  /**
   * What to call a contact.
   *
   * Their own name is used when you never gave them one -- and is labelled as
   * a claim below, because that is all it is. See `profile-format.ts`.
   */
  const nameOf = (c: Contact): string =>
    displayNameFor(localNameOf(c.name), peerProfiles[c.peerDid], c.peerDid, c.claimedName);

  const [searchQuery, setSearchQuery] = useState("");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [connectTargetDid, setConnectTargetDid] = useState<string | null>(null);
  const [copiedDid, setCopiedDid] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string>("");

  /**
   * Accept a knock.
   *
   * The failure worth showing is a request whose material has expired: the SDK
   * keeps them for the session, while our card survives a restart, so a stale
   * card is a real state and "nothing happened" would be the wrong answer.
   */
  const handleAccept = async (peerDid: string) => {
    setAccepting(peerDid);
    setAcceptError("");
    try {
      await acceptPairingRequest(peerDid);
    } catch (error) {
      setAcceptError((error as Error).message || "Could not accept that request.");
    } finally {
      setAccepting(null);
    }
  };

  const filteredContacts = contacts.filter(
    (c) =>
      nameOf(c).toLowerCase().includes(searchQuery.toLowerCase()) ||
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
                /*
                  A knock does not have to carry a name, and when it does not,
                  the card used to fill one in and then attribute it to them:
                  "says their name is Device ending in ...poVTQW". That is the
                  app putting words in a stranger's mouth on the one screen
                  whose whole job is telling you what is claimed and what is
                  proven. Seen on a device, not in review.
                */
                const claimedName = req.claimedName?.trim();
                const displayName = claimedName || `Device ending in ...${req.peerDid.slice(-6)}`;
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
                          {displayName} wants to connect
                        </div>
                        {/*
                          The name is a claim and nothing more -- the SDK is
                          explicit that rendering it as verified undoes the
                          point of pairing. The fingerprint beneath it is the
                          only thing on this card that is proven, and it is
                          short enough to read out loud to confirm you are
                          accepting who you think you are.
                        */}
                        <div
                          style={{
                            fontSize: "var(--font-size-label)",
                            color: "var(--color-text-muted)",
                            marginTop: 2,
                          }}
                        >
                          {claimedName ? `says their name is ${claimedName} · ` : "sent no name · "}code{" "}
                          <span style={{ fontFamily: "var(--font-family-mono)" }}>
                            {fingerprintOf(req.peerDid)}
                          </span>
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

                    {/*
                      No checklist any more. It walked the user through pasting
                      the sender's ticket, which was the only way to get their
                      encryption key before requests carried it. Accepting now
                      does the whole job.
                    */}

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
                      {/*
                        Accept is the whole flow now: the request carried their
                        ticket, so there is nothing left for the user to fetch.
                      */}
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={accepting === req.peerDid}
                        onClick={() => void handleAccept(req.peerDid)}
                      >
                        {accepting === req.peerDid ? "Accepting…" : "Accept"}
                      </Button>
                    </div>

                    {acceptError && accepting === null && (
                      <div
                        style={{
                          fontSize: "var(--font-size-label)",
                          color: "var(--color-danger)",
                        }}
                        role="alert"
                      >
                        {acceptError}
                      </div>
                    )}
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
                /*
                  Paired, and actually there, are different questions.
                  `pairingState` is written once when pairing completes and
                  never revisited, so a contact whose phone was reset keeps
                  showing a green dot and "Connected directly" forever -- which
                  is how a dead contact became indistinguishable from a live
                  one after a peer re-registered. Finding 17.
                */
                const paired = contact.pairingState === "bilateral_connected";
                const heardAt = presenceEvidence.heardAt[contact.peerDid];
                const isConnected = paired && isReachable(heardAt, Date.now());
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
                      {/* Their picture, or initials. Same component as the
                          chat list and the chat header, so a contact does not
                          change appearance depending on which screen shows
                          them. */}
                      <div
                        style={{
                          flexShrink: 0,
                          position: "relative",
                          display: "flex",
                        }}
                      >
                        <Avatar
                          profile={peerProfiles[contact.peerDid]}
                          name={nameOf(contact)}
                          size={40}
                        />
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
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-sm)", minWidth: 0 }}>
                          <span
                            style={{
                              fontSize: "var(--font-size-body)",
                              fontWeight: "var(--font-weight-semibold)",
                              color: "var(--color-text)",
                              display: "flex",
                              alignItems: "baseline",
                              gap: 6,
                              minWidth: 0,
                            }}
                          >
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {nameOf(contact)}
                            </span>
                          </span>
                          <TwoStepsChecklist
                            pairingState={contact.pairingState}
                            peerName={nameOf(contact)}
                            lastHeardAt={heardAt}
                            variant="compact"
                          />
                        </div>

                        {/*
                          A name you did not choose is their claim, and the app
                          has to say so -- the request card already does. This
                          row could not show one before, because an unnamed
                          contact was stored with a placeholder; now that their
                          own name comes through, the label comes with it.

                          On its own line, not beside the name. Inline, it cost
                          the name the horizontal room it needed: with
                          "Connected directly" already on that line, "Sarthi"
                          rendered as "Sa...". A ten-character aside must not
                          crowd out the thing the row exists to show.
                        */}
                        {isClaimedName(
                          localNameOf(contact.name),
                          peerProfiles[contact.peerDid],
                          contact.claimedName,
                        ) && (
                          <div
                            style={{
                              fontSize: "var(--font-size-label)",
                              color: "var(--color-text-muted)",
                              marginTop: 2,
                            }}
                          >
                            the name they chose for themselves
                          </div>
                        )}

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
                        peerName={nameOf(contact)}
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
