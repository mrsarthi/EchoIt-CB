import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { createEchoItClient, type EchoItClient } from "../transport/create-client";
import {
  startPresence,
  sendTyping,
  sendReceipt,
  emptyEvidence,
  type PresenceEvidence,
} from "../services/heartbeat";
import { applyReceipt, type Watermarks } from "../services/receipts";
import { shouldSendTyping } from "../services/typing";
import { knock, describeKnock } from "../services/pairing-requests";
import {
  loadDisplayName,
  saveDisplayName,
  loadAcceptRequests,
  saveAcceptRequests,
} from "../services/reach";
import { publishProfile, type MyProfileDraft, type PeerProfile } from "../services/profiles";
import { putAttachment, type Attachment } from "../services/attachments";
import { describeBlobError } from "../services/attachment-format";
import { releaseAttachmentUrls } from "../services/attachments";
import {
  initialWindow,
  grow,
  type HistoryWindow,
} from "../services/history-window";
import {
  checkpoint,
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
  /** Heartbeat and departure times per peer; feed to `presenceFrom`. */
  presenceEvidence: PresenceEvidence;
  activeInvites: ActiveInvite[];
  pairAndConnect: (ticketString: string, name: string) => Promise<void>;
  /** Messages per peer did, oldest first. */
  messages: Record<string, ConversationMessage[]>;
  sendMessage: (peerDid: string, text: string, replyTo?: readonly string[]) => Promise<void>;
  /** Store a file and send a message carrying its handle. */
  sendAttachment: (peerDid: string, file: File, caption?: string) => Promise<void>;
  /** Reveal an older slice of a conversation. Resolves when it is in. */
  loadOlderMessages: (peerDid: string) => Promise<void>;
  /** Whether a conversation has anything older than what is loaded. */
  hasOlderMessages: (peerDid: string) => boolean;
  /** Say we are composing. Throttled internally; safe to call per keystroke. */
  notifyTyping: (peerDid: string) => void;
  acceptRequest: (peerDid: string, ticketString?: string) => Promise<void>;
  ignoreRequest: (peerDid: string) => void;
  blockPeer: (peerDid: string) => void;
  recordActiveInvite: (ticketString: string) => void;
  /** What the last knock reported. Empty until one is sent. */
  lastKnockNote: () => string;
  /** What we call ourselves when knocking. A claim, never an identity. */
  displayName: string;
  setDisplayName: (name: string) => void;
  /** Whether strangers may ask to connect. Off is the recovery for a leaked ticket. */
  acceptRequests: boolean;
  setAcceptRequests: (accept: boolean) => void;
  /** Accept a knock: pairs, opens the conversation, and clears the request. */
  acceptPairingRequest: (peerDid: string) => Promise<void>;
  /** Dismiss a knock. Silent — they learn nothing. */
  ignorePairingRequest: (peerDid: string) => void;

  // Profiles
  /** What we publish about ourselves, or undefined until something is set. */
  myProfile: PeerProfile | undefined;
  /** Publish a name, bio and picture. Resolves with how many peers got it. */
  saveMyProfile: (draft: MyProfileDraft) => Promise<number>;
  /** Every peer profile we hold, by did. A peer absent from it has published none. */
  peerProfiles: Record<string, PeerProfile>;

  // Receipts
  /** How far each peer has confirmed receiving and reading, by their did. */
  receipts: Record<string, Watermarks>;
  /**
   * Tell a peer we have read their conversation up to now.
   *
   * Safe to call whenever a conversation is on screen; watermarks only move
   * forward, so a repeat is a no-op to them.
   */
  markConversationRead: (peerDid: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>("checking");
  const [client, setClient] = useState<EchoItClient | null>(null);
  const [presenceEvidence, setPresenceEvidence] = useState<PresenceEvidence>(emptyEvidence);
  /**
   * How far back each conversation is loaded.
   *
   * A ref rather than state: it changes during a load and nothing renders
   * from it directly, so putting it in state would re-render every
   * conversation to record a number only the loader reads.
   */
  const historyWindows = useRef<Record<string, HistoryWindow>>({});
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
  const [displayName, setDisplayNameState] = useState<string>(() => loadDisplayName());
  const [acceptRequests, setAcceptRequestsState] = useState<boolean>(() => loadAcceptRequests());
  const [myProfile, setMyProfile] = useState<PeerProfile | undefined>(undefined);
  const [peerProfiles, setPeerProfiles] = useState<Record<string, PeerProfile>>({});
  /** What *they* have confirmed about *our* messages, by their did. */
  const [receipts, setReceipts] = useState<Record<string, Watermarks>>({});
  /**
   * The watermarks we have sent them, so reconnecting can re-send without
   * needing the message list. A ref: nothing renders from it.
   */
  const sentWatermarks = useRef<Record<string, Watermarks>>({});
  /**
   * Tickets from knocks, kept so Accept needs nothing pasted.
   *
   * A ref rather than state: only the accept path reads it, and putting a
   * ticket in React state would re-render every screen that watches the
   * context to carry material nothing renders.
   */
  const requestTickets = useRef<Record<string, unknown>>({});
  /** What the last knock reported, for the Add Contact screen to show. */
  const lastKnockNote = useRef<string>("");

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

  /*
   * Profiles: ours, and everyone else's.
   *
   * Subscribing alone is not enough. A profile can arrive before this mounts —
   * the SDK offers ours to a peer as soon as they pair, and theirs comes back
   * the same way — and the service holds what it has already been told. So the
   * held set is read once and the subscription takes it from there, the same
   * shape as pending pairing requests for the same reason.
   */
  useEffect(() => {
    if (!client || !did) return;

    setMyProfile(client.client.identity.getMyProfile());

    const held: Record<string, PeerProfile> = {};
    for (const contact of loadContacts(did)) {
      const profile = client.client.identity.getPeerProfile(contact.peerDid);
      if (profile) held[contact.peerDid] = profile;
    }
    if (Object.keys(held).length > 0) {
      setPeerProfiles((prev) => ({ ...prev, ...held }));
    }

    const unsubscribe = client.client.identity.onPeerProfile((peerDid, profile) => {
      setPeerProfiles((prev) => ({ ...prev, [peerDid]: profile }));
    });
    return unsubscribe;
  }, [client, did]);

  // Listen to peer connection events from DicsussionClient
  useEffect(() => {
    if (!client || !did) return;

    const handlePeerConnected = (event: PeerConnectedEvent) => {
      const peerDid = event.peerDid;

      // Drop if blocked
      const isBlocked = blockedPeers.some((b) => b.peerDid === peerDid);
      if (isBlocked) return;

      /*
       * Re-send what we have already confirmed.
       *
       * Receipts ride the ephemeral stream, so every one sent while they were
       * offline was simply dropped — and their ticks would stay wrong forever
       * on messages we read days ago. Re-sending on connect is what makes the
       * status eventually right instead of right only when both people
       * happened to be online at the same instant. Free to repeat, because a
       * watermark repeated means exactly what it meant the first time.
       */
      const confirmed = sentWatermarks.current[peerDid];
      if (confirmed && client && did) {
        if (confirmed.deliveredUpTo) {
          void sendReceipt(client, did, peerDid, { kind: "delivered", upTo: confirmed.deliveredUpTo });
        }
        if (confirmed.readUpTo) {
          void sendReceipt(client, did, peerDid, { kind: "read", upTo: confirmed.readUpTo });
        }
      }

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

    /*
     * A stranger knocking, carrying their ticket and a name they chose.
     *
     * SDK 0.7.4, stream 0x0a. Before it, an inbound connection from someone
     * unknown told us only their did:key — proven, but useless: without their
     * encryption key and addresses we could not encrypt for them or dial them
     * back, which is why pairing needed a ticket pasted by hand.
     *
     * `pendingPairingRequests()` is read as well as subscribed to, because a
     * knock can arrive before this listener exists and a stranger only gets to
     * send one. Subscribing alone would drop it.
     */
    const handleRequest = (request: {
      peerDid: string;
      ticket: unknown;
      displayName?: string;
      at: number;
    }) => {
      // Blocked, or not accepting: decline without ever showing it. Declining
      // is indistinguishable from being offline, which is the point.
      if (
        blockedPeers.some((b) => b.peerDid === request.peerDid)
        || !loadAcceptRequests()
      ) {
        try {
          client.client.declinePairingRequest(request as never);
        } catch {
          // Nothing to recover: the request is already unreachable to the user.
        }
        return;
      }

      requestTickets.current[request.peerDid] = request.ticket;

      setPendingRequests((prev) => {
        const existing = prev.find((r) => r.peerDid === request.peerDid);
        // A repeat knock refreshes the name rather than stacking a second card.
        const updated = existing
          ? prev.map((r) => (r.peerDid === request.peerDid
            ? { ...r, claimedName: request.displayName, receivedAt: Date.now() }
            : r))
          : [...prev, {
            peerDid: request.peerDid,
            receivedAt: Date.now(),
            claimedName: request.displayName,
          }];
        saveRequests(did, updated);
        return updated;
      });
    };

    for (const waiting of client.client.pendingPairingRequests()) {
      handleRequest(waiting as never);
    }
    client.client.onPairingRequest.on("request", handleRequest);

    client.client.onPeerConnected.on("peer", handlePeerConnected);

    return () => {
      client.client.onPeerConnected.off("peer", handlePeerConnected);
      client.client.onPairingRequest.off("request", handleRequest);
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
            /*
             * Confirm receipt the moment it lands, not when the conversation
             * is opened. "Delivered" is a claim about this device holding it,
             * and this is the instant that becomes true.
             */
            confirmDelivered(contact.peerDid, message.timestamp);
          }
          // An inbound message is only in memory until this runs. Without it a
          // received conversation is gone on the next launch, exactly as a
          // sent one was.
          checkpoint(client);
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

      const window = historyWindows.current[contact.peerDid] ?? initialWindow();
      historyWindows.current[contact.peerDid] = window;

      void historyWithPeer(client, did, contact.peerDid, window.size)
        .then((history) => {
          // Fewer than asked for means this is the whole conversation, so the
          // view must not offer to load more that does not exist.
          historyWindows.current[contact.peerDid] = {
            ...window,
            hasMore: history.length >= window.size,
          };
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

  /**
   * Heartbeat to paired peers, and listen for theirs.
   *
   * Presence used to be inferred from inbound messages alone, because the SDK
   * had no way to say someone had left — a dot driven by connection alone
   * switches on and never off. SDK 0.7.1 provides both halves: an ephemeral
   * heartbeat that is never written to disk, and `onPeerDisconnected`.
   *
   * Keyed on the peer list by identity, like the subscribe effect above: a
   * rename must not restart every heartbeat, but a new contact must gain one.
   */
  useEffect(() => {
    if (!client || !did || state !== "ready") return;
    const peerDids = contacts.map((c) => c.peerDid);
    if (peerDids.length === 0) return;
    return startPresence(client, did, peerDids, setPresenceEvidence, (peerDid, receipt) => {
      setReceipts((previous) => ({
        ...previous,
        [peerDid]: applyReceipt(previous[peerDid] ?? {}, receipt),
      }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, did, state, contacts.map((c) => c.peerDid).join(",")]);

  /**
   * Checkpoint when the app goes away.
   *
   * Belt and braces over the per-message checkpoints: `pagehide` is the last
   * event a webview reliably gets before it is torn down, and
   * `visibilitychange` covers Android backgrounding the app without closing it.
   * Neither is guaranteed — which is why the per-message calls exist and this
   * is not relied on alone.
   */
  useEffect(() => {
    if (!client) return;
    const flush = () => checkpoint(client);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
      // The attachment URLs outlive any one component on purpose; this is the
      // one place that knows nothing is looking at them any more.
      releaseAttachmentUrls();
      // Unmounting means the client is being replaced or torn down; take the
      // last opportunity to write.
      flush();
    };
  }, [client]);

  /** Send to a peer and show it immediately. */
  /**
   * Accept a knock.
   *
   * The ticket came with the request, so nothing is pasted: `acceptPairingRequest`
   * registers the peer, and the rest is the same work `pairAndConnect` does —
   * admit them to the conversation, connect, and record the contact.
   *
   * Their name is stored as what they called themselves. It is a claim, and a
   * local rename should win over it whenever the user sets one.
   */
  const acceptPairingRequestByDid = useCallback(
    async (peerDid: string) => {
      if (!client || !did) throw new Error("Client not ready");

      const request = client.client
        .pendingPairingRequests()
        .find((r) => r.peerDid === peerDid);

      // The SDK keeps requests for the session only; ours outlive a restart in
      // localStorage, so a card can survive the material behind it.
      if (!request) {
        throw new Error(
          "That request is no longer available — ask them to send it again.",
        );
      }

      client.client.acceptPairingRequest(request);
      openConversation(client, did, peerDid);

      const claimed = pendingRequests.find((r) => r.peerDid === peerDid)?.claimedName;
      const now = Date.now();

      setContacts((prev) => {
        if (prev.some((c) => c.peerDid === peerDid)) return prev;
        const updated: Contact[] = [
          ...prev,
          {
            peerDid,
            name: claimed?.trim() || `Device ending in ...${peerDid.slice(-6)}`,
            addedAt: now,
            // They knocked and we accepted, so both sides hold each other's
            // material -- there is no "waiting for them to add us back" here,
            // which is the whole point of the request flow.
            pairingState: "bilateral_connected" as const,
          },
        ];
        saveContacts(did, updated);
        return updated;
      });

      setPendingRequests((prev) => {
        const updated = prev.filter((r) => r.peerDid !== peerDid);
        saveRequests(did, updated);
        return updated;
      });
      delete requestTickets.current[peerDid];

      // They dialled us, so they may already be gone; reconnecting is what
      // makes the conversation usable rather than merely listed.
      try {
        await client.client.connect(request.ticket);
      } catch {
        // Not fatal: the ticket is registered, so a later reconnect reaches
        // them. Failing the accept would lose the pairing over a transient dial.
      }
    },
    [client, did, pendingRequests],
  );

  /**
   * Dismiss a knock without pairing.
   *
   * Deliberately silent. `requestPairing` tells the sender whether it was
   * delivered, never what was decided, so being ignored is indistinguishable
   * from being offline — which is what stops "ignore" from working as a signal.
   */
  const ignorePairingRequest = useCallback(
    (peerDid: string) => {
      const request = client?.client
        .pendingPairingRequests()
        .find((r) => r.peerDid === peerDid);
      if (request && client) {
        try {
          client.client.declinePairingRequest(request);
        } catch {
          // Already gone; removing our own card is what matters.
        }
      }
      setPendingRequests((prev) => {
        const updated = prev.filter((r) => r.peerDid !== peerDid);
        saveRequests(did, updated);
        return updated;
      });
      delete requestTickets.current[peerDid];
    },
    [client, did],
  );

  const setDisplayName = useCallback((name: string) => {
    saveDisplayName(name);
    setDisplayNameState(name.trim().slice(0, 128));
  }, []);

  const setAcceptRequests = useCallback((accept: boolean) => {
    saveAcceptRequests(accept);
    setAcceptRequestsState(accept);
  }, []);

  const sendMessage = async (
    peerDid: string,
    text: string,
    replyTo?: readonly string[],
  ) => {
    if (!client || !did) throw new Error("Client not ready");
    const trimmed = text.trim();
    if (!trimmed) return;

    const sent = await sendToPeer(client, did, peerDid, trimmed, undefined, replyTo);
    setMessages((prev) => {
      const existing = prev[peerDid] ?? [];
      if (existing.some((m) => m.id === sent.id)) return prev;
      return { ...prev, [peerDid]: [...existing, sent] };
    });
  };

  /**
   * Reveal an older slice of a conversation.
   *
   * The read is local -- history is a CRDT document on this device -- so this
   * returns in milliseconds. The window exists to limit how many bubbles are
   * built at once, not to hide a network wait.
   *
   * `getHistory` has no cursor: `limit` caps to the most recent N. Paging
   * backwards is therefore asking for a larger window and keeping the extra,
   * which is why the merge below is by id rather than by position.
   */
  const loadOlderMessages = useCallback(
    async (peerDid: string) => {
      if (!client || !did) return;
      const current = historyWindows.current[peerDid] ?? initialWindow();
      if (!current.hasMore) return;

      const next = { ...current, size: current.size + 60 };
      const history = await historyWithPeer(client, did, peerDid, next.size);
      historyWindows.current[peerDid] = grow(current, history.length);

      setMessages((prev) => {
        const existing = prev[peerDid] ?? [];
        const seen = new Set(existing.map((m) => m.id));
        const older = history.filter((m) => !seen.has(m.id));
        if (older.length === 0) return prev;
        const merged = [...older, ...existing];
        merged.sort((a, b) => a.timestamp - b.timestamp);
        return { ...prev, [peerDid]: merged };
      });
    },
    [client, did],
  );

  /**
   * Tell a peer we are typing.
   *
   * Called from a keystroke handler, so the throttle lives here rather than at
   * the call site — a per-character packet would be wasteful, and a far more
   * precise disclosure than "someone is composing something".
   */
  const lastTypingSentAt = useRef<Record<string, number>>({});

  const notifyTyping = useCallback(
    (peerDid: string) => {
      if (!client || !did) return;
      const now = Date.now();
      if (!shouldSendTyping(lastTypingSentAt.current[peerDid], now)) return;
      lastTypingSentAt.current[peerDid] = now;
      void sendTyping(client, did, peerDid);
    },
    [client, did],
  );

  const hasOlderMessages = useCallback(
    (peerDid: string) => historyWindows.current[peerDid]?.hasMore ?? false,
    [],
  );

  /**
   * Send a file.
   *
   * Two steps, in this order: the bytes are stored locally first and the
   * message carries only the resulting handle. If `put` fails there is no
   * message referring to something that was never stored -- a bubble pointing
   * at a missing file is worse than a refusal.
   *
   * The error is rephrased through `describeBlobError` here rather than in the
   * view, so every caller gets the specific reason -- too big, unavailable,
   * corrupt -- instead of one generic sentence.
   */
  const sendAttachment = async (peerDid: string, file: File, caption = "") => {
    if (!client || !did) throw new Error("Client not ready");

    let attachment: Attachment;
    try {
      attachment = await putAttachment(client, file);
    } catch (error) {
      throw new Error(describeBlobError(error));
    }

    const sent = await sendToPeer(client, did, peerDid, caption.trim(), [attachment]);
    setMessages((prev) => {
      const existing = prev[peerDid] ?? [];
      if (existing.some((m) => m.id === sent.id)) return prev;
      return { ...prev, [peerDid]: [...existing, sent] };
    });
  };

  /**
   * Record and send a watermark, keeping what we sent so it can be re-sent.
   *
   * Watermarks only move forward here as well as on the receiving side: a
   * message arriving out of order must not lower what we have already told
   * them, or they would see a message go from read back to delivered.
   */
  const pushWatermark = useCallback(
    (peerDid: string, kind: "delivered" | "read", upTo: number) => {
      if (!client || !did) return;

      const held = sentWatermarks.current[peerDid] ?? {};
      const field = kind === "read" ? "readUpTo" : "deliveredUpTo";
      if ((held[field] ?? 0) >= upTo) return;

      sentWatermarks.current = {
        ...sentWatermarks.current,
        [peerDid]: { ...held, [field]: upTo },
      };
      void sendReceipt(client, did, peerDid, { kind, upTo });
    },
    [client, did],
  );

  /** Their message is on this device now. */
  const confirmDelivered = useCallback(
    (peerDid: string, at: number) => {
      pushWatermark(peerDid, "delivered", at);
    },
    [pushWatermark],
  );

  /**
   * Tell them we have read up to now.
   *
   * `Date.now()` rather than the newest message's timestamp: the two agree for
   * anything already here, and using now also covers a message that arrives
   * while the conversation is on screen without needing to re-derive the list.
   *
   * A `useCallback` because callers use it as an effect dependency, and an
   * unstable identity combined with `Date.now()` means a receipt on every
   * render — the watermark guard cannot stop that, since each call carries a
   * later time than the last.
   */
  const markConversationRead = useCallback(
    (peerDid: string) => {
      const now = Date.now();
      // Read implies delivered, and saying so keeps the two consistent even if
      // a delivery watermark was lost.
      pushWatermark(peerDid, "delivered", now);
      pushWatermark(peerDid, "read", now);
    },
    [pushWatermark],
  );

  /**
   * Publish our profile.
   *
   * The returned count is how many peers were connected to receive it, not
   * whether it saved. Zero is the ordinary case for someone editing their
   * profile with nobody online, and a screen that reported it as a failure
   * would be wrong most of the time.
   */
  const saveMyProfile = async (draft: MyProfileDraft): Promise<number> => {
    if (!client) throw new Error("Client not ready");
    const reached = await publishProfile(client, draft);
    setMyProfile(client.client.identity.getMyProfile());
    return reached;
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

    /*
     * 2a. Knock, so they do not have to paste anything.
     *
     * Before SDK 0.7.4 both people had to exchange tickets by hand, because a
     * handshake proves a did:key and discloses nothing else -- not the
     * encryption key, not the addresses. The request carries our ticket, so
     * accepting is all they have to do.
     *
     * `knock` waits for a relay first. A ticket sent the instant we connect
     * carries LAN addresses only, works on this network, and is undialable
     * from anywhere else -- and that failure appears days later as a peer who
     * cannot be reached, not as anything wrong with pairing.
     */
    let knockNote = "";
    try {
      knockNote = describeKnock(await knock(client, peer.didKey, loadDisplayName()));
    } catch {
      // They are added either way: our side holds their ticket, so the
      // conversation works as soon as they add us. The knock is what saves
      // them that step, not what makes pairing possible.
      knockNote = "Added. They will need to add you back until a request reaches them.";
    }
    lastKnockNote.current = knockNote;

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
        presenceEvidence,
        activeInvites,
        pairAndConnect,
        messages,
        sendMessage,
        sendAttachment,
        loadOlderMessages,
        hasOlderMessages,
        notifyTyping,
        acceptRequest,
        ignoreRequest,
        blockPeer,
        recordActiveInvite,
        lastKnockNote: () => lastKnockNote.current,
        displayName,
        setDisplayName,
        acceptRequests,
        setAcceptRequests,
        acceptPairingRequest: acceptPairingRequestByDid,
        ignorePairingRequest,
        myProfile,
        saveMyProfile,
        peerProfiles,
        receipts,
        markConversationRead,
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
