import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { createEchoItClient, type EchoItClient } from "../transport/create-client";
import {
  historyWithPeer,
  openConversation,
  sendToPeer,
  subscribeToPeer,
  type ConversationMessage,
} from "../services/conversation";
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
  /** Messages per peer did, oldest first. */
  messages: Record<string, ConversationMessage[]>;
  sendMessage: (peerDid: string, text: string) => Promise<void>;
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
  const [messages, setMessages] = useState<Record<string, ConversationMessage[]>>({});
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

      // `event.paired` is a purely LOCAL flag — the SDK emits
      // `paired: this.peers.getPeer(peerDid)?.paired === true`, which only
      // says *we* added *them*. It says nothing about whether they added us,
      // and reading it as mutual is what made a one-sided contact display
      // "Connected directly" (Finding 17).
      //
      // The direction is the evidence. Dialling us requires our ticket, and
      // `client.connect()` self-pairs from a ticket that carries an
      // encryption key — so an INBOUND connection proves the other side has
      // added us. An outbound one proves only that we can reach them, which
      // is exactly the state §5 calls "Waiting for them to connect back".
      const theyReachedForUs = event.direction === "inbound";

      if (event.paired && theyReachedForUs) {
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
      } else if (!event.paired && theyReachedForUs) {
        // Stranger knock: record in pendingRequests (NO notification, NO toast, NO badge)
        //
        // `!event.paired` matters now that the branch above also tests
        // direction: without it a paired peer we dialled would fall through
        // to here and be filed as a stranger knocking on our own door.
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

  /**
   * Record that pairing is mutual.
   *
   * Kept separate from `pairAndConnect` because the two answer different
   * questions: that function knows *we* added *them*, this one knows they
   * added us. Only the second makes a conversation deliverable, and §5b gates
   * the composer on it.
   *
   * Three things count as evidence, because no single one covers every flow:
   *
   *   1. An inbound connection — they dialled us, which needs our ticket.
   *   2. A knock waiting when we add them — same thing, seen earlier.
   *   3. A message from them — they cannot send unless they added us.
   *
   * (3) exists because (1) misses the common case. Whoever adds second dials
   * into a connection the first side already opened, so no fresh inbound
   * arrives at the first side and it would otherwise wait forever.
   */
  const markBilateral = useCallback(
    (peerDid: string) => {
      if (!did) return;
      setContacts((prev) => {
        if (!prev.some((c) => c.peerDid === peerDid && c.pairingState !== "bilateral_connected")) {
          return prev;
        }
        const updated = prev.map((c) =>
          c.peerDid === peerDid ? { ...c, pairingState: "bilateral_connected" as const } : c
        );
        saveContacts(did, updated);
        return updated;
      });
    },
    [did]
  );

  /**
   * Load history and listen, for every contact.
   *
   * Keyed on the contact list rather than run once: a contact added later must
   * get the same treatment, and `openConversation` is idempotent so re-running
   * costs nothing. Re-opening every channel on each pass is also the cheapest
   * guard against a channel that lost its guest list — a state that would
   * otherwise present as messages silently reaching nobody.
   */
  useEffect(() => {
    if (!client || !did || state !== "ready") return;

    let live = true;
    const unsubscribes: Array<() => void> = [];

    for (const contact of contacts) {
      openConversation(client, did, contact.peerDid);

      unsubscribes.push(
        subscribeToPeer(client, did, contact.peerDid, (message) => {
          if (!live) return;
          // Receiving from them settles it. A peer can only send to us if they
          // added us, so this is the strongest evidence available and it
          // arrives in the one flow the other signals miss: whoever added
          // second never sees a fresh inbound connection, because the
          // connection the first side opened is still live.
          if (message.authorDid && message.authorDid !== did) {
            markBilateral(contact.peerDid);
          }
          setMessages((prev) => {
            const existing = prev[contact.peerDid] ?? [];
            // The same message can arrive twice — once as a live envelope and
            // again when a document sync replays the channel. The SDK
            // de-duplicates by id for its own emit, but a reconnect can still
            // deliver something we already hold, so the UI checks too.
            if (existing.some((m) => m.id === message.id)) return prev;
            return { ...prev, [contact.peerDid]: [...existing, message] };
          });
        }),
      );

      void historyWithPeer(client, did, contact.peerDid)
        .then((history) => {
          if (!live || history.length === 0) return;
          setMessages((prev) => {
            const existing = prev[contact.peerDid] ?? [];
            const seen = new Set(existing.map((m) => m.id));
            const merged = [...existing, ...history.filter((m) => !seen.has(m.id))];
            merged.sort((a, b) => a.timestamp - b.timestamp);
            return { ...prev, [contact.peerDid]: merged };
          });
        })
        .catch(() => {
          // A channel with no history yet is the normal case on a fresh
          // pairing, not an error worth surfacing.
        });
    }

    return () => {
      live = false;
      for (const off of unsubscribes) off();
    };
    // `contacts` by identity: a rename should not tear down every listener,
    // but a new contact must gain one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, did, state, contacts.map((c) => c.peerDid).join(",")]);

  /** Send to a peer and show it immediately. */
  const sendMessage = async (peerDid: string, text: string) => {
    if (!client || !did) throw new Error("Client not ready");
    const trimmed = text.trim();
    if (!trimmed) return;

    const sent = await sendToPeer(client, did, peerDid, trimmed);
    setMessages((prev) => {
      const existing = prev[peerDid] ?? [];
      if (existing.some((m) => m.id === sent.id)) return prev;
      return { ...prev, [peerDid]: [...existing, sent] };
    });
  };

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

    // 1a. A knock already waiting from this peer is proof they added us.
    //
    // `acceptRequest` handles the case where the user presses Accept. This is
    // the same evidence arriving by a different route: they dialled us, so
    // they hold our ticket, and the user is now adding them back through Add
    // Contact. Discarding the knock here would leave a fully mutual pair
    // stuck on "waiting for them", which is what it did.
    const theyKnocked = pendingRequests.some((r) => r.peerDid === peer.didKey);

    // 1b. Admit them to our conversation with them.
    //
    // `addPeer` says "may connect"; since SDK 0.4.0 it does not say "may
    // receive what I send on this channel". Without this, `publish` correctly
    // skips them and every message resolves having reached nobody — and
    // reports success, because reaching nobody is not an error. That is
    // indistinguishable from the silent loss the guest list was added to
    // prevent, so it must not be left to the first send.
    openConversation(client, did, peer.didKey);

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

    if (theyKnocked) markBilateral(peer.didKey);
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

    // A request only exists because they dialled us, so by the time we accept
    // one, both sides have added each other. `pairAndConnect` cannot know
    // that — it is also the path for adding someone cold — so it opens every
    // contact as `unilateral_waiting` and the knock is what settles it here.
    markBilateral(peerDid);
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
  /**
   * Create an identity from a freshly generated phrase.
   *
   * **Deliberately does not flip `state` to "unlocking" while it works.** That
   * unmounts `OnboardingScreen`, and on failure the return to "onboarding"
   * mounts a *fresh* one — back at the intro step, with the recovery phrase
   * gone and the error written to a component that no longer exists. The user
   * sees the setup screen restart itself and is told nothing.
   *
   * Reported from real use: entering the three confirmation words appeared to
   * "throw me back at the setup page". The underlying failure was
   * `aes-gcm: invalid tag` — an existing database encrypted under a different
   * key — and none of it reached the screen.
   *
   * `OnboardingScreen` already has its own `loading` state driving the button
   * spinner, so nothing is lost by staying put: it stays mounted, keeps the
   * phrase, and can show what went wrong.
   */
  const startNewIdentity = async (mnemonic: string) => {
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

      // Roll the key back. `storeStorageKey` runs before the client is built,
      // so a failure here leaves a key in the OS keychain with no identity
      // behind it — and the next launch takes the "key exists, unlock" branch,
      // skips onboarding entirely, and creates an identity whose recovery
      // phrase the user was NEVER SHOWN. They would hold an account they
      // cannot restore and have no way to know.
      //
      // Found because a failed onboarding left a credential behind on a real
      // machine, immediately after the failure itself was fixed.
      try {
        await clearStorageKey();
      } catch {
        // Best effort. If the keychain will not give the key up, the error
        // below is still the more useful thing to report.
      }

      setError(`Setup failed: ${msg}`);
      // Only meaningful when this was reached from the error screen's Retry;
      // during onboarding the state never left "onboarding" in the first place.
      setState("onboarding");
      throw err;
    }
  };

  // Restore identity from mnemonic
  /**
   * Restore from a phrase the user already had.
   *
   * Same reasoning as `startNewIdentity`: no "unlocking" flip, so a bad phrase
   * or an undecryptable database leaves the user on the restore screen with the
   * error, rather than silently resetting the flow.
   */
  const restoreIdentity = async (mnemonic: string) => {
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

      // Roll the key back. `storeStorageKey` runs before the client is built,
      // so a failure here leaves a key in the OS keychain with no identity
      // behind it — and the next launch takes the "key exists, unlock" branch,
      // skips onboarding entirely, and creates an identity whose recovery
      // phrase the user was NEVER SHOWN. They would hold an account they
      // cannot restore and have no way to know.
      //
      // Found because a failed onboarding left a credential behind on a real
      // machine, immediately after the failure itself was fixed.
      try {
        await clearStorageKey();
      } catch {
        // Best effort. If the keychain will not give the key up, the error
        // below is still the more useful thing to report.
      }

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
        messages,
        sendMessage,
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
