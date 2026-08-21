import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { createEchoItClient, type EchoItClient } from "../transport/create-client";
import { markPendingReset, DEFAULT_DATABASE_NAME } from "../services/pending-reset";
import { reconnectKnownContacts } from "../services/reconnect";
import {
  getStoredStorageKey,
  storeStorageKey,
  clearStorageKey,
  deriveStorageKey,
  isKeychainAvailable,
} from "../services/identity";
import {
  type Contact,
  type InboundRequest,
  type BlockedPeer,
  type ActiveInvite,
  loadContacts,
  saveContacts,
  loadRequests,
  saveRequests,
  loadBlockedPeers,
  saveBlockedPeers,
  loadActiveInvites,
  saveActiveInvites,
  parseAndValidateTicket,
} from "../services/pairing-store";
import type { PeerConnectedEvent } from "@dicsussion/sdk";

export type AppState = "checking" | "onboarding" | "unlocking" | "ready" | "error";
export type ThemeMode = "light" | "dark" | "system";

export interface AppContextValue {
  state: AppState;
  client: EchoItClient | null;
  did: string | null;
  error: string | null;
  keychainAvailable: boolean;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  startNewIdentity: (mnemonic: string) => Promise<void>;
  restoreIdentity: (mnemonic: string) => Promise<void>;
  resetApp: () => Promise<void>;

  // Pairing, Contacts, and Invites
  contacts: Contact[];
  pendingRequests: InboundRequest[];
  blockedPeers: BlockedPeer[];
  activeInvites: ActiveInvite[];
  pairAndConnect: (ticketString: string, name: string) => Promise<void>;
  acceptRequest: (peerDid: string, ticketString?: string) => Promise<void>;
  ignoreRequest: (peerDid: string) => void;
  blockPeer: (peerDid: string) => void;
  recordActiveInvite: (ticketString: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>("checking");
  const [client, setClient] = useState<EchoItClient | null>(null);
  const [did, setDid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keychainAvailable, setKeychainAvailable] = useState<boolean>(true);
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    return (localStorage.getItem("echoit_theme") as ThemeMode) || "system";
  });

  // Pairing & Contacts State
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pendingRequests, setPendingRequests] = useState<InboundRequest[]>([]);
  const [blockedPeers, setBlockedPeers] = useState<BlockedPeer[]>([]);
  const [activeInvites, setActiveInvites] = useState<ActiveInvite[]>([]);

  // StrictMode guard: prevent duplicate concurrent client initialization on boot
  const bootStarted = useRef(false);

  // Apply theme attribute to root
  const applyTheme = (mode: ThemeMode) => {
    if (mode === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", mode);
    }
  };

  const setTheme = (mode: ThemeMode) => {
    setThemeState(mode);
    localStorage.setItem("echoit_theme", mode);
    applyTheme(mode);
  };

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Load persistent pairing and contact data when DID is established
  useEffect(() => {
    if (!did) return;
    setContacts(loadContacts(did));
    setPendingRequests(loadRequests(did));
    setBlockedPeers(loadBlockedPeers(did));
    setActiveInvites(loadActiveInvites(did));
  }, [did]);

  // Initial boot: Check keychain for existing storageKey
  const checkKeychainAndBoot = useCallback(async () => {
    setState("checking");
    setError(null);

    try {
      const available = await isKeychainAvailable();
      setKeychainAvailable(available);

      if (!available) {
        // Keychain unavailable is a hard error in production builds
        setError("This device has no secure place to keep your key, so EchoIt cannot protect your identity here.");
        setState("error");
        return;
      }

      const storedKey = await getStoredStorageKey();

      if (storedKey) {
        // Key exists: Unlock and boot client
        setState("unlocking");
        try {
          const echoClient = await createEchoItClient({ storageKey: storedKey });
          setClient(echoClient);
          setDid(echoClient.client.did);
          setState("ready");
        } catch (initErr: unknown) {
          const msg = initErr instanceof Error ? initErr.message : String(initErr);
          setError(`Failed to initialize client: ${msg}`);
          setState("error");
        }
      } else {
        // First run: No key stored yet
        setState("onboarding");
      }
    } catch (keychainErr: unknown) {
      const msg = keychainErr instanceof Error ? keychainErr.message : String(keychainErr);
      setError(`Keychain error: ${msg}`);
      setState("error");
    }
  }, []);

  useEffect(() => {
    if (bootStarted.current) return;
    bootStarted.current = true;
    void checkKeychainAndBoot();
  }, [checkKeychainAndBoot]);

  // Listen to peer connection events from DicsussionClient
  useEffect(() => {
    if (!client || !did) return;

    const handlePeerConnected = (event: PeerConnectedEvent) => {
      const peerDid = event.peerDid;

      // Drop if blocked
      const isBlocked = blockedPeers.some((b) => b.peerDid === peerDid);
      if (isBlocked) return;

      if (event.paired) {
        // Both sides are paired — update or create contact as bilateral_connected
        setContacts((prev) => {
          const existingIndex = prev.findIndex((c) => c.peerDid === peerDid);
          let updated: Contact[];
          if (existingIndex >= 0) {
            updated = prev.map((c, i) =>
              i === existingIndex ? { ...c, pairingState: "bilateral_connected" } : c
            );
          } else {
            updated = [
              ...prev,
              {
                peerDid,
                name: `Device ending in ...${peerDid.slice(-6)}`,
                pairingState: "bilateral_connected",
                addedAt: Date.now(),
              },
            ];
          }
          saveContacts(did, updated);
          return updated;
        });

        // Remove from pending requests
        setPendingRequests((prev) => {
          const updated = prev.filter((r) => r.peerDid !== peerDid);
          saveRequests(did, updated);
          return updated;
        });
      } else if (event.direction === "inbound") {
        // Stranger knock: record in pendingRequests (NO notification, NO toast, NO badge)
        setPendingRequests((prev) => {
          if (prev.some((r) => r.peerDid === peerDid)) return prev;
          const updated = [
            ...prev,
            {
              peerDid,
              receivedAt: Date.now(),
            },
          ];
          saveRequests(did, updated);
          return updated;
        });
      }
    };

    client.client.onPeerConnected.on("peer", handlePeerConnected);

    return () => {
      client.client.onPeerConnected.off("peer", handlePeerConnected);
    };
  }, [client, did, blockedPeers]);

  /**
   * Re-dial known contacts on launch and whenever the app returns to the
   * foreground.
   *
   * This is what makes the SDK's queued messages actually move. Its outbox
   * flushes from `drainAfterReconnect()`, which fires when a connection is
   * established — and until this existed the app dialled only once, during
   * pairing. Messages queued while a peer was away therefore sat in the outbox
   * even after both devices were awake and reachable, because nothing ever
   * created the reconnection the flush was waiting for.
   *
   * Contacts and blocked peers are read through refs rather than listed as
   * dependencies: this effect installs a long-lived listener, and re-running it
   * on every contact-list change would tear the listener down and rebuild it
   * repeatedly for no benefit.
   */
  const reconnectDeps = useRef({ client, contacts, blockedPeers, did });
  reconnectDeps.current = { client, contacts, blockedPeers, did };

  useEffect(() => {
    if (!client || state !== "ready") return;

    const sweep = () => {
      const d = reconnectDeps.current;
      if (!d.client) return;
      void reconnectKnownContacts(
        d.client,
        d.contacts,
        new Set(d.blockedPeers.map((b) => b.peerDid)),
        d.did,
      );
    };

    sweep();

    const onVisible = () => {
      if (document.visibilityState === "visible") sweep();
    };
    document.addEventListener("visibilitychange", onVisible);
    // Android does not always fire visibilitychange on resume; `focus` covers
    // the cases it misses. The cooldown inside the sweep makes the overlap
    // harmless.
    window.addEventListener("focus", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // `contacts.length` is a dependency because contacts load from storage in a
    // separate effect keyed on `did`, which resolves *after* the client is
    // ready. Without it the first sweep runs against an empty list and dials
    // nobody — the failure looks identical to having no contacts at all.
    // Re-running is cheap: the sweep's own cooldown suppresses repeat dials.
  }, [client, state, contacts.length]);

  // Pair with a pasted ticket and dial the peer
  const pairAndConnect = async (ticketString: string, name: string) => {
    if (!client || !did) throw new Error("Client not ready");

    const validation = parseAndValidateTicket(ticketString, did);
    if (validation.error || !validation.ticket) {
      throw new Error(validation.error || "Invalid ticket");
    }
    const peer = validation.ticket;

    // Check if peer is blocked
    if (blockedPeers.some((b) => b.peerDid === peer.didKey)) {
      throw new Error("This contact is currently blocked.");
    }

    // 1. Register peer with SDK
    client.client.addPeer(peer.didKey, peer.encryptionKey!);

    // 2. Connect to peer
    await client.client.connect(peer);

    // 3. Update local contact list
    const now = Date.now();
    const displayName = name.trim() || `Device ending in ...${peer.didKey.slice(-6)}`;

    setContacts((prev) => {
      const existingIndex = prev.findIndex((c) => c.peerDid === peer.didKey);
      let updated: Contact[];
      if (existingIndex >= 0) {
        updated = prev.map((c, i) =>
          i === existingIndex
            ? { ...c, name: displayName, ticketString: ticketString.trim() }
            : c
        );
      } else {
        updated = [
          ...prev,
          {
            peerDid: peer.didKey,
            name: displayName,
            pairingState: "unilateral_waiting",
            addedAt: now,
            ticketString: ticketString.trim(),
          },
        ];
      }
      saveContacts(did, updated);
      return updated;
    });

    // Remove from pending requests if it was there
    setPendingRequests((prev) => {
      const updated = prev.filter((r) => r.peerDid !== peer.didKey);
      saveRequests(did, updated);
      return updated;
    });
  };

  // Accept a pending request
  const acceptRequest = async (peerDid: string, ticketString?: string) => {
    if (!client || !did) throw new Error("Client not ready");

    if (ticketString) {
      await pairAndConnect(ticketString, "");
      return;
    }

    const existing = contacts.find((c) => c.peerDid === peerDid);
    if (existing?.ticketString) {
      await pairAndConnect(existing.ticketString, existing.name);
    } else {
      throw new Error("Paste the peer's connection ticket to complete pairing.");
    }
  };

  // Ignore an inbound request (silent: removes locally, reappears if they knock again)
  const ignoreRequest = (peerDid: string) => {
    setPendingRequests((prev) => {
      const updated = prev.filter((r) => r.peerDid !== peerDid);
      saveRequests(did, updated);
      return updated;
    });
  };

  // Block a peer permanently (silent: never appears again)
  const blockPeer = (peerDid: string) => {
    setPendingRequests((prev) => {
      const updated = prev.filter((r) => r.peerDid !== peerDid);
      saveRequests(did, updated);
      return updated;
    });

    setContacts((prev) => {
      const updated = prev.filter((c) => c.peerDid !== peerDid);
      saveContacts(did, updated);
      return updated;
    });

    setBlockedPeers((prev) => {
      if (prev.some((b) => b.peerDid === peerDid)) return prev;
      const updated = [...prev, { peerDid, blockedAt: Date.now() }];
      saveBlockedPeers(did, updated);
      return updated;
    });
  };

  // Record an exported connection ticket as an active invite
  const recordActiveInvite = (ticketString: string) => {
    const newInvite: ActiveInvite = {
      id: `inv-${Date.now()}`,
      createdAt: Date.now(),
      ticketString,
    };
    setActiveInvites((prev) => {
      const updated = [newInvite, ...prev.slice(0, 19)];
      saveActiveInvites(did, updated);
      return updated;
    });
  };

  // Onboard new identity
  const startNewIdentity = async (mnemonic: string) => {
    setState("unlocking");
    setError(null);
    try {
      const storageKey = deriveStorageKey(mnemonic);
      await storeStorageKey(storageKey);

      const echoClient = await createEchoItClient({ storageKey });
      setClient(echoClient);
      setDid(echoClient.client.did);
      setState("ready");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Setup failed: ${msg}`);
      setState("onboarding");
      throw err;
    }
  };

  // Restore identity from mnemonic
  const restoreIdentity = async (mnemonic: string) => {
    setState("unlocking");
    setError(null);
    try {
      const storageKey = deriveStorageKey(mnemonic);
      await storeStorageKey(storageKey);

      const echoClient = await createEchoItClient({ storageKey });
      setClient(echoClient);
      setDid(echoClient.client.did);
      setState("ready");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Restore failed: ${msg}`);
      setState("onboarding");
      throw err;
    }
  };

  // Reset app (close pipe, delete database, delete keychain key)
  const resetApp = async () => {
    setState("checking");
    setError(null);

    try {
      // 1. Close active transport connection
      if (client?.pipe) {
        await client.pipe.close();
      }

      // 2. Delete storage key from OS keychain (throws if keychain delete fails)
      await clearStorageKey();

      // 3. Schedule the database erase and reload into it.
      //
      // It cannot be deleted here: the SDK holds an open connection for the
      // life of the page and exposes no way to close it, so `deleteDatabase`
      // would fire `onblocked` and leave the data in place. `runPendingReset`
      // erases it on the way back up, before anything opens it again.
      markPendingReset(DEFAULT_DATABASE_NAME);

      // Nothing after this runs — the reload discards this page, which is the
      // point: it is what releases the connection blocking the delete.
      window.location.reload();
      return;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to reset local session: ${msg}`);
      setState("error");
      throw err;
    }
  };

  return (
    <AppContext.Provider
      value={{
        state,
        client,
        did,
        error,
        keychainAvailable,
        theme,
        setTheme,
        startNewIdentity,
        restoreIdentity,
        resetApp,
        contacts,
        pendingRequests,
        blockedPeers,
        activeInvites,
        pairAndConnect,
        acceptRequest,
        ignoreRequest,
        blockPeer,
        recordActiveInvite,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
