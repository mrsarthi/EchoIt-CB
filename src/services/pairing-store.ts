import { decodeTicket, type PeerTicket } from "@dicsussion/core/transport";

export interface Contact {
  peerDid: string;
  /**
   * The nickname *you* typed, and **empty when you did not type one**.
   *
   * It used to be filled in with `Device ending in ...abc123` at every place a
   * contact was created, which made "unnamed" indistinguishable from a chosen
   * nickname and meant the peer's own name could never be shown. Nothing may
   * write a placeholder here again; screens resolve a name at render time
   * through `displayNameFor`. Old rows still hold one, and `localNameOf`
   * recognises it.
   */
  name: string;
  /**
   * The name they sent with their pairing request, kept only until a profile
   * arrives. A claim, never treated as a nickname.
   */
  claimedName?: string;
  pairingState: "unilateral_waiting" | "bilateral_connected";
  addedAt: number;
  ticketString?: string;
}

export interface InboundRequest {
  peerDid: string;
  receivedAt: number;
  claimedName?: string;
}

export interface BlockedPeer {
  peerDid: string;
  blockedAt: number;
}

export interface ActiveInvite {
  id: string;
  createdAt: number;
  ticketString: string;
}

/**
 * Validate and decode a pasted connection ticket string.
 * Provides plain-spoken, human-friendly error explanations rather than stack traces.
 */
export function parseAndValidateTicket(raw: string, myDid?: string | null): { ticket?: PeerTicket; error?: string } {
  const cleaned = raw.trim();

  if (!cleaned) {
    return { error: "Please paste a connection ticket." };
  }

  if (!cleaned.startsWith("dicsussion1")) {
    return {
      error: `Not a ticket — expected it to start with "dicsussion1", got "${cleaned.slice(0, 14)}...". Copy the whole value from the other device.`,
    };
  }

  let decoded: PeerTicket;
  try {
    decoded = decodeTicket(cleaned);
  } catch {
    return {
      error: `Ticket looks truncated (${cleaned.length} characters received). Use the Copy button on the other device rather than selecting text by hand.`,
    };
  }

  if (!decoded.encryptionKey || decoded.encryptionKey.length !== 32) {
    return {
      error: "Ticket carries no valid encryption key and cannot be used to establish a secure connection.",
    };
  }

  if (myDid && decoded.didKey === myDid) {
    return {
      error: "This is this device's own ticket. Paste the ticket from the other device.",
    };
  }

  return { ticket: decoded };
}

// Storage keys scoped by identity DID
function getStorageKey(prefix: string, myDid: string | null): string {
  const scope = myDid ? myDid.slice(0, 24) : "global";
  return `echoit:${prefix}:${scope}`;
}

export function loadContacts(myDid: string | null): Contact[] {
  try {
    const raw = localStorage.getItem(getStorageKey("contacts", myDid));
    return raw ? JSON.parse(raw) : [];
  } catch {
    console.error("EchoIt: could not read contacts from local storage");
    return [];
  }
}

export function saveContacts(myDid: string | null, contacts: Contact[]): void {
  try {
    localStorage.setItem(getStorageKey("contacts", myDid), JSON.stringify(contacts));
  } catch {
    // Not silent. A failed write means the contacts list looks saved and is
    // gone after a restart, which reads to the user as data loss with
    // no cause. The name only -- never the contents (constraint §3.3).
    console.error("EchoIt: could not persist contacts to local storage");
  }
}

export function loadRequests(myDid: string | null): InboundRequest[] {
  try {
    const raw = localStorage.getItem(getStorageKey("requests", myDid));
    return raw ? JSON.parse(raw) : [];
  } catch {
    console.error("EchoIt: could not read requests from local storage");
    return [];
  }
}

export function saveRequests(myDid: string | null, requests: InboundRequest[]): void {
  try {
    localStorage.setItem(getStorageKey("requests", myDid), JSON.stringify(requests));
  } catch {
    // Not silent. A failed write means the requests list looks saved and is
    // gone after a restart, which reads to the user as data loss with
    // no cause. The name only -- never the contents (constraint §3.3).
    console.error("EchoIt: could not persist requests to local storage");
  }
}

export function loadBlockedPeers(myDid: string | null): BlockedPeer[] {
  try {
    const raw = localStorage.getItem(getStorageKey("blocked", myDid));
    return raw ? JSON.parse(raw) : [];
  } catch {
    console.error("EchoIt: could not read blocked peers from local storage");
    return [];
  }
}

export function saveBlockedPeers(myDid: string | null, blocked: BlockedPeer[]): void {
  try {
    localStorage.setItem(getStorageKey("blocked", myDid), JSON.stringify(blocked));
  } catch {
    // Not silent. A failed write means the blocked peers list looks saved and is
    // gone after a restart, which reads to the user as data loss with
    // no cause. The name only -- never the contents (constraint §3.3).
    console.error("EchoIt: could not persist blocked peers to local storage");
  }
}

export function loadActiveInvites(myDid: string | null): ActiveInvite[] {
  try {
    const raw = localStorage.getItem(getStorageKey("invites", myDid));
    return raw ? JSON.parse(raw) : [];
  } catch {
    console.error("EchoIt: could not read active invites from local storage");
    return [];
  }
}

export function saveActiveInvites(myDid: string | null, invites: ActiveInvite[]): void {
  try {
    localStorage.setItem(getStorageKey("invites", myDid), JSON.stringify(invites));
  } catch {
    // Not silent. A failed write means the active invites list looks saved and is
    // gone after a restart, which reads to the user as data loss with
    // no cause. The name only -- never the contents (constraint §3.3).
    console.error("EchoIt: could not persist active invites to local storage");
  }
}
