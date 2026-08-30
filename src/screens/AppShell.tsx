import { useState, useEffect, useCallback, useRef } from "react";
import { useBreakpoint } from "../hooks/useBreakpoint";
import { useViewportHeight } from "../hooks/useViewportHeight";
import { BottomNav, type AppTab } from "../components/navigation/BottomNav";
import { SidebarNavRail } from "../components/navigation/SidebarNavRail";
import { ChatsTab, type ConversationItem } from "./tabs/ChatsTab";
import { ContactsTab } from "./tabs/ContactsTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { ProfileTab } from "./tabs/ProfileTab";
import { ChatView } from "./chat/ChatView";
import { Logo } from "../components/ui/Logo";
import { Modal } from "../components/ui/Modal";
import { Button } from "../components/ui/Button";
import { useApp } from "../context/AppContext";
import { presenceFrom, describePresence } from "../services/presence";
import { isTyping, describeActivity } from "../services/typing";
import { newestOf, byRecency } from "../services/conversation-order";
import { pushBackHandler } from "../services/back-stack";
import { saveToDevice, type Attachment } from "../services/attachments";
import { describeBlobError, previewOf } from "../services/attachment-format";
import { countUnread, countWaitingConversations, lastInboundAt, loadReadMarks, saveReadMarks, type ReadMarks } from "../services/unread";
import type { MessageItem } from "./chat/ChatView";

export function AppShell() {
  const isWide = useBreakpoint(840);
  useViewportHeight();
  const {
    contacts,
    pendingRequests,
    messages,
    sendMessage,
    sendAttachment,
    loadOlderMessages,
    hasOlderMessages,
    notifyTyping,
    did,
    presenceEvidence,
    client,
    peerProfiles,
    receipts,
    markConversationRead,
  } = useApp();
  const [activeTab, setActiveTab] = useState<AppTab>("chats");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [readMarks, setReadMarks] = useState<ReadMarks>(() => loadReadMarks());

  /**
   * A ticking "now" so elapsed time re-renders on its own.
   *
   * Without it "last seen 2 minutes ago" stays frozen at whatever it said when
   * the last message arrived, and a peer who has gone quiet reads as online
   * indefinitely -- the exact failure the presence window exists to avoid.
   * Thirty seconds is well under the one-minute granularity of the phrasing.
   */
  const [now, setNow] = useState(() => Date.now());

  /*
   * How often elapsed-time labels re-evaluate.
   *
   * Thirty seconds suits "last seen 5 minutes ago", which only changes at that
   * granularity. It is far too slow for "typing…", which expires after five —
   * measured across two phones: the indicator appeared in 700ms and was still
   * on screen seven seconds after the sender stopped, because nothing had
   * re-rendered to notice.
   *
   * So the clock speeds up only while someone is actually typing, and drops
   * back the moment they stop. A permanent one-second tick would re-render
   * every conversation row all day to serve a state that is rare.
   */
  const someoneIsTyping = Object.values(presenceEvidence.typingAt).some((at) =>
    isTyping(at, now),
  );

  useEffect(() => {
    const period = someoneIsTyping ? 1_000 : 30_000;
    const id = setInterval(() => setNow(Date.now()), period);
    return () => clearInterval(id);
  }, [someoneIsTyping]);

  /**
   * Back button navigation.
   *
   * The first attempt only handled an open conversation: back closed the chat,
   * but anywhere else it left the app. Reported as "the back button now works
   * when I am in the chat window, but for everywhere else it exits".
   *
   * Now every navigation — switching tab, opening a chat — pushes a history
   * entry describing the view, so back walks the user's actual path in reverse.
   * When there is nowhere left to go we ask before leaving rather than
   * vanishing: a messenger that closes on a stray back press loses whatever was
   * half-typed.
   *
   * The root entry is `replaceState`d rather than pushed, so the stack starts
   * at a known floor. On reaching it we re-push the current view, which keeps
   * the app one entry above the exit boundary and means the *next* back press
   * asks again rather than closing silently.
   */
  const viewRef = useRef<{ tab: AppTab; chatId: string | null }>({
    tab: "chats",
    chatId: null,
  });
  const [exitPromptOpen, setExitPromptOpen] = useState(false);

  useEffect(() => {
    // Two entries, deliberately.
    //
    // wry only forwards the back press to the webview when canGoBack() is
    // true; otherwise it finishes the activity and JavaScript never hears
    // about it. A single entry therefore means the very first back press
    // closes the app, with no opportunity to ask. Keeping a floor beneath the
    // root view guarantees canGoBack(), so every press reaches the handler
    // below and the app decides what Back means.
    //
    // This only works alongside the handleBackNavigation override applied by
    // scripts/apply-android-back-nav.mjs — without it wry never registers a
    // callback at all.
    window.history.replaceState({ echoit: "floor" }, "");
    window.history.pushState({ echoit: "view", ...viewRef.current }, "");
  }, []);

  const navigate = useCallback((next: { tab?: AppTab; chatId?: string | null }) => {
    const view = { ...viewRef.current, ...next };
    // Navigating to where we already are should not add a step to go back
    // through — otherwise re-tapping a tab silently deepens the stack.
    if (view.tab === viewRef.current.tab && view.chatId === viewRef.current.chatId) return;
    viewRef.current = view;
    setActiveTab(view.tab);
    setSelectedChatId(view.chatId);
    window.history.pushState({ echoit: "view", ...view }, "");
  }, []);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const state = event.state as
        | { echoit?: string; tab?: AppTab; chatId?: string | null }
        | null;

      if (state?.echoit === "view" && state.tab) {
        viewRef.current = { tab: state.tab, chatId: state.chatId ?? null };
        setActiveTab(state.tab);
        setSelectedChatId(state.chatId ?? null);
        return;
      }

      // At the floor. Ask, and step back above it so the next press asks too.
      setExitPromptOpen(true);
      window.history.pushState({ echoit: "view", ...viewRef.current }, "");
    };
    window.addEventListener("popstate", onPopState);

    // Android sends the hardware back press here as a custom event, because
    // neither popstate nor WebView.canGoBack() sees pushState entries -- see
    // scripts/apply-android-back-nav.mjs. Same decision either way: step back
    // if there is somewhere to go, otherwise ask before closing.
    const onNativeBack = () => {
      if (window.history.state?.echoit === "view" && window.history.length > 2) {
        window.history.back();
        return;
      }
      if (viewRef.current.chatId || viewRef.current.tab !== "chats") {
        // Still somewhere other than the start; go there rather than exit.
        viewRef.current = { tab: "chats", chatId: null };
        setActiveTab("chats");
        setSelectedChatId(null);
        return;
      }
      setExitPromptOpen(true);
    };
    // The bottom of the stack: anything on top of the app -- the media viewer,
    // for one -- gets the press first and this only runs if nothing claimed it.
    const release = pushBackHandler(() => {
      onNativeBack();
      return true;
    });

    return () => {
      window.removeEventListener("popstate", onPopState);
      release();
    };
  }, []);

  /**
   * Actually close the app.
   *
   * Two different exits, because `getCurrentWindow().close()` does nothing on
   * Android -- measured on a device: tapping Close left the process running,
   * which turned the prompt into a trap. `EchoItExit` is the native bridge
   * installed alongside the back handler (scripts/apply-android-back-nav.mjs);
   * it calls finish() on the activity.
   *
   * `pagehide` first: it is what AppContext listens on to checkpoint unsaved
   * messages, and a deliberate exit should not lose what a crash would not.
   */
  const confirmExit = useCallback(async () => {
    setExitPromptOpen(false);
    window.dispatchEvent(new Event("pagehide"));

    const native = (window as unknown as { EchoItExit?: { exit?: () => void } }).EchoItExit;
    if (native?.exit) {
      native.exit();
      return;
    }

    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch {
      // Nothing left to try. A shut prompt beats a dialog that does nothing.
    }
  }, []);

  /** Close the conversation. Goes through history so back stays consistent. */
  const closeChat = useCallback(() => {
    window.history.back();
  }, []);

  // Sync conversations with contacts
  useEffect(() => {
    setConversations((prev) => {
      // Keep existing conversations with their messages/timestamps
      const updated = [...prev];

      contacts.forEach((contact) => {
        const existing = updated.find((c) => c.peerDid === contact.peerDid);
        if (existing) {
          existing.name = contact.name;
          // isOnline is derived below from real inbound activity. It used to be
          // set from pairingState here, which meant "we have both added each
          // other" -- true whether or not the peer was anywhere near the app.
        } else {
          updated.push({
            id: `chat-${contact.peerDid.slice(0, 16)}`,
            peerDid: contact.peerDid,
            name: contact.name,
            // Placeholder only until a message exists; the real preview is
          // derived below so it cannot drift from what was actually sent.
          lastMessage:
            contact.pairingState === "bilateral_connected"
              ? "No messages yet"
              : "Waiting for them to connect back",
            timestamp: "Recently",
            unreadCount: 0,
          });
        }
      });

      return updated;
    });
  }, [contacts]);

  /**
   * Conversation rows with their preview taken from the message store.
   *
   * Derived rather than written on send, so the list cannot show a preview for
   * a message the SDK never accepted — the failure the old `handleSendMessage`
   * produced by construction.
   */
  /**
   * The most recent sign a peer was there.
   *
   * Heartbeats are the designed signal, but a message that just arrived is
   * equally good evidence and may be newer — someone typing is unambiguously
   * present. Taking the later of the two means presence never lags behind a
   * conversation actually happening.
   */
  const evidenceFor = (peerDid: string, thread: typeof messages[string]): number | undefined => {
    const beat = presenceEvidence.heardAt[peerDid];
    const message = lastInboundAt(thread ?? [], did);
    if (beat === undefined) return message;
    if (message === undefined) return beat;
    return Math.max(beat, message);
  };

  const conversationsWithPreview: ConversationItem[] = conversations
    .map((c) => {
      const thread = messages[c.peerDid] ?? [];
      // The newest by timestamp, not the last appended: a late sync lands at
      // the end of the array while being older than its neighbour.
      const latest = newestOf(thread);
      const presence = presenceFrom(
        evidenceFor(c.peerDid, thread),
        now,
        presenceEvidence.departedAt[c.peerDid],
      );

      const enriched: ConversationItem = {
        ...c,
        // Shown in place of the message preview, which is what makes a typing
        // contact findable from the list without opening anything.
        isTyping: isTyping(presenceEvidence.typingAt[c.peerDid], now),
        isOnline: presence.state === "online",
        unreadCount: countUnread(thread, did, readMarks[c.peerDid]),
        // Sort key and display both come from `latest` below, so a row can
        // never show one time while sitting in the position of another.
        lastActivityAt: latest?.timestamp,
      };

      if (!latest) return enriched;
      return {
        ...enriched,
        // Not `latest.content`: an attachment sent without a caption has none,
        // and the row then fell back to "No messages yet" for a conversation
        // whose most recent event was a photo.
        lastMessage: previewOf(latest.content, latest.attachments),
        timestamp: new Date(latest.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };
    })
    /*
     * Most recent first.
     *
     * There was no ordering at all before this, so the list sat in whatever
     * order contacts happened to be added and the conversation you were
     * actually having could be anywhere in it.
     *
     * Conversations with no messages sort last rather than first: a contact
     * added months ago and never written to has no claim on the top of the
     * list, and `undefined` compared numerically would otherwise put them
     * there.
     */
    .sort(byRecency);

  /*
   * How many conversations are waiting, for the nav badge.
   *
   * Conversations, not messages. Twelve unread messages from one person is
   * one thing to go and look at, and a nav badge reading "12" that resolves to
   * a single row is the kind of number that trains people to ignore badges.
   * The per-row count in the list is where the message total belongs.
   *
   * Excludes whatever is open: a conversation you are reading is not
   * something you have yet to look at, and its own read mark has not
   * necessarily caught up while you sit in it.
   */
  const unreadConversations = countWaitingConversations(
    conversationsWithPreview,
    selectedChatId,
  );

  /*
   * Deliberately the enriched list, not raw `conversations`.
   *
   * The raw objects carry an `isOnline` fixed when the conversation was first
   * opened, derived from `pairingState === "bilateral_connected"` -- which says
   * both people added each other, NOT that anyone is present. Reading it here
   * left a green dot burning in the chat header for a peer whose app had been
   * force-stopped: measured, the status line correctly moved Online -> "last
   * seen just now" -> "last seen 1 minute ago" while the dot never went out.
   *
   * That is the Finding 17 mistake -- asserting a state from a signal that does
   * not carry it -- in the one place the dot is largest.
   */
  const selectedConversation =
    conversationsWithPreview.find((c) => c.id === selectedChatId) || null;

  /**
   * Reading a conversation marks it read, up to its newest message.
   *
   * Keyed on the newest timestamp rather than a "seen" boolean so a message
   * arriving while the conversation is already open is marked read too, instead
   * of leaving a badge on the screen the user is looking at.
   */
  /**
   * The presence phrase for whoever is open, worked out once.
   *
   * Derived from the same `lastInboundAt` the chat list uses, so the header and
   * the row can never disagree about whether someone is around.
   */
  const selectedPresenceLabel = selectedConversation
    ? describeActivity(
        isTyping(presenceEvidence.typingAt[selectedConversation.peerDid], now),
        describePresence(
        presenceFrom(
          evidenceFor(
            selectedConversation.peerDid,
            messages[selectedConversation.peerDid] ?? [],
          ),
          now,
          presenceEvidence.departedAt[selectedConversation.peerDid],
        ),
        now,
      ),
      )
    : "";

  const openPeerDid = selectedConversation?.peerDid;
  const openThreadNewest = openPeerDid
    ? messages[openPeerDid]?.[messages[openPeerDid].length - 1]?.timestamp
    : undefined;

  useEffect(() => {
    if (!openPeerDid || openThreadNewest === undefined) return;
    setReadMarks((prev) => {
      if ((prev[openPeerDid] ?? 0) >= openThreadNewest) return prev;
      const next = { ...prev, [openPeerDid]: openThreadNewest };
      saveReadMarks(next);
      return next;
    });
    /*
     * Tell them, as well as remembering it here.
     *
     * The same moment serves both: the local mark is what silences our badge,
     * and the receipt is what colours their tick. Sending it from here rather
     * than from opening the chat means a message that arrives while the
     * conversation is already on screen is reported read too, which is the
     * case a "mark read on open" hook quietly misses.
     */
    markConversationRead(openPeerDid);
  }, [openPeerDid, openThreadNewest, markConversationRead]);
  const selectedContact = selectedConversation
    ? contacts.find((c) => c.peerDid === selectedConversation.peerDid)
    : null;

  // Global keyboard shortcuts (Escape to deselect chat on wide or back on narrow)
  const handleGlobalKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedChatId) {
        closeChat();
      }
    },
    [selectedChatId]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [handleGlobalKeyDown]);

  /**
   * Send for real.
   *
   * This used to mutate `conversations` and nothing else, so the UI showed a
   * message that had never left the device. The SDK call is the whole point of
   * M2.4; the local echo now comes from `AppContext`, which appends what the
   * SDK actually accepted rather than what was typed.
   */
  const handleSendMessage = (text: string, replyTo?: readonly string[]) => {
    const peerDid = selectedConversation?.peerDid;
    if (!peerDid) return;
    void sendMessage(peerDid, text, replyTo).catch(() => {
      // Surfacing this properly needs the §5b Staged/Sent ladder. Until that
      // exists, failing quietly is still better than the previous behaviour,
      // which was to show every message as sent whether or not it was.
    });
  };

  /**
   * Send a file to whoever is open.
   *
   * Unlike `handleSendMessage`, this rethrows: ChatView shows the reason next
   * to the paperclip. A file that silently fails to send is worse than a
   * message that does -- there is no text left in the box to hint that
   * anything happened.
   */
  const handleSendAttachment = async (file: File) => {
    const peerDid = selectedConversation?.peerDid;
    if (!peerDid) throw new Error("No conversation is open.");
    await sendAttachment(peerDid, file);
  };

  /**
   * Saving and opening, both routed through one place.
   *
   * This is the only path that writes plaintext outside the SDK's encrypted
   * store, and it runs only on a tap. Keeping both callers here means there is
   * one place to look when asking what the app can put on disk.
   */
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [saveError, setSaveError] = useState("");

  const saveOrOpen = useCallback(
    async (attachment: Attachment, open: boolean) => {
      const peerDid = selectedConversation?.peerDid;
      if (!client || !peerDid) return;

      setSaveState("saving");
      setSaveError("");
      try {
        const result = await saveToDevice(client, attachment, { open });
        setSaveState("saved");
        if (result.openError) {
          // Saved, but nothing on the device handles this type. Saying where it
          // went is more use than reporting a failure that did not happen.
          setSaveError(`Saved to ${result.path}, but nothing on this device opens that type.`);
        }
      } catch (error) {
        setSaveState("failed");
        setSaveError(describeBlobError(error));
      }
    },
    [client, selectedConversation?.peerDid],
  );

  // A fresh conversation should not inherit the last one's banner.
  useEffect(() => {
    setSaveState("idle");
    setSaveError("");
  }, [selectedChatId]);

  /** SDK messages in the shape ChatView renders. */
  const messagesFor = (peerDid: string | undefined): MessageItem[] => {
    if (!peerDid || !did) return [];
    return (messages[peerDid] ?? []).map((m) => ({
      id: m.id,
      senderDid: m.authorDid ?? peerDid,
      isOutgoing: m.authorDid === did,
      text: m.content,
      timestamp: new Date(m.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      // The viewer captions with the instant, not the formatted string.
      at: m.timestamp,
      attachments: m.attachments,
      replyTo: m.replyTo,
    }));
  };

  const handleSelectContact = (peerDid: string) => {
    let existing = conversations.find((c) => c.peerDid === peerDid);
    if (!existing) {
      const contact = contacts.find((c) => c.peerDid === peerDid);
      const newChat: ConversationItem = {
        id: `chat-${peerDid.slice(0, 16)}`,
        peerDid,
        name: contact?.name || `Device ending in ...${peerDid.slice(-6)}`,
        lastMessage: contact?.pairingState === "bilateral_connected" ? "Connected directly" : "Waiting for them to connect back",
        timestamp: "Recently",
        unreadCount: 0,
        // Not from pairingState: that is "we are paired", not "they are here".
        // The enriched list recomputes this from presence every render.
        isOnline: false,
      };
      setConversations((prev) => [...prev, newChat]);
      existing = newChat;
    }

    navigate({ chatId: existing.id });
    setActiveTab("chats");
  };

  // Render tab content for the current tab
  const renderTabContent = () => {
    switch (activeTab) {
      case "chats":
        return (
          <ChatsTab
            conversations={conversationsWithPreview}
            selectedChatId={selectedChatId}
            onSelectChat={(id) => navigate({ chatId: id })}
            onNewChat={() => setActiveTab("contacts")}
          />
        );
      case "contacts":
        return (
          <ContactsTab
            onSelectContact={handleSelectContact}
          />
        );
      case "settings":
        return <SettingsTab />;
      case "profile":
        return <ProfileTab />;
      default:
        return null;
    }
  };

  /**
   * The layouts, as a function rather than a set of early returns.
   *
   * There are three exits from here — narrow with a conversation open,
   * narrow without, and wide — and the exit prompt has to exist in all of
   * them. Wrapping once is one place to be wrong instead of three.
   */
  const renderContent = () => {
  // --- NARROW LAYOUT (< 840px) ---

  if (!isWide) {
    // If a conversation is selected, show full-height ChatView WITHOUT BottomNav
    if (selectedConversation) {
      return (
        <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
          <ChatView
            peerDid={selectedConversation.peerDid}
            peerName={selectedConversation.name}
            peerProfile={peerProfiles[selectedConversation.peerDid]}
            otherUnreadCount={unreadConversations}
            peerWatermarks={receipts[selectedConversation.peerDid]}
            pairingState={selectedContact?.pairingState || "unilateral_waiting"}
            isOnline={selectedConversation.isOnline}
            presenceLabel={selectedPresenceLabel}
            onBack={closeChat}
            messages={messagesFor(selectedConversation?.peerDid)}
            onSendMessage={handleSendMessage}
            onSendAttachment={handleSendAttachment}
            onLoadOlder={() => loadOlderMessages(selectedConversation.peerDid)}
            onTyping={() => notifyTyping(selectedConversation.peerDid)}
            peerIsTyping={isTyping(presenceEvidence.typingAt[selectedConversation.peerDid], now)}
            hasOlder={hasOlderMessages(selectedConversation.peerDid)}
            onOpenDocument={(attachment) => void saveOrOpen(attachment, true)}
            onSaveMedia={(item) => {
              // By hash, which is the file's identity. Size and mime were
              // ambiguous between two same-sized files of the same type.
              const found = messagesFor(selectedConversation.peerDid)
                .flatMap((m) => m.attachments ?? [])
                .find((a) => a.hash === item.hash);
              if (found) void saveOrOpen(found, false);
            }}
            saveState={saveState}
            saveError={saveError}
            onShareTicket={() => navigate({ tab: "profile", chatId: null })}
          />
        </div>
      );
    }

    // Otherwise show active tab with BottomNav at the bottom
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--color-bg)",
          overflow: "hidden",
        }}
      >
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {renderTabContent()}
        </div>
        {/*
          Both counts, which this call site never passed. The nav has drawn a
          badge and a dot since it was written and neither had ever appeared on
          a phone, because the props defaulted to zero here. Same omission as
          `unreadCount: 0` in the two places `services/unread.ts` names.
        */}
        <BottomNav
          activeTab={activeTab}
          onSelectTab={(tab) => navigate({ tab, chatId: null })}
          unreadChatsCount={unreadConversations}
          pendingRequestsCount={pendingRequests.length}
        />
      </div>
    );
  }

  // --- WIDE LAYOUT (>= 840px — WhatsApp Style 3-Zone Architecture) ---
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        backgroundColor: "var(--color-bg)",
        overflow: "hidden",
      }}
    >
      {/* 1. Far-Left Nav Rail (56-60px) */}
      <SidebarNavRail
        activeTab={activeTab}
        onSelectTab={(tab) => navigate({ tab, chatId: null })}
        unreadChatsCount={unreadConversations}
        pendingRequestsCount={pendingRequests.length}
      />

      {/* 2. Active Tab Sidebar Stream (340px) */}
      <aside
        style={{
          width: 340,
          minWidth: 300,
          maxWidth: 400,
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid var(--color-border)",
          backgroundColor: "var(--color-surface)",
          height: "100%",
          flexShrink: 0,
        }}
      >
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {renderTabContent()}
        </div>
      </aside>

      {/* Right Pane (Chat View or Resting Empty State) */}
      <main
        style={{
          flex: 1,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--color-bg)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {selectedConversation ? (
          <ChatView
            peerDid={selectedConversation.peerDid}
            peerName={selectedConversation.name}
            peerProfile={peerProfiles[selectedConversation.peerDid]}
            otherUnreadCount={unreadConversations}
            peerWatermarks={receipts[selectedConversation.peerDid]}
            pairingState={selectedContact?.pairingState || "unilateral_waiting"}
            isOnline={selectedConversation.isOnline}
            presenceLabel={selectedPresenceLabel}
            messages={messagesFor(selectedConversation?.peerDid)}
            onSendMessage={handleSendMessage}
            onSendAttachment={handleSendAttachment}
            onLoadOlder={() => loadOlderMessages(selectedConversation.peerDid)}
            onTyping={() => notifyTyping(selectedConversation.peerDid)}
            peerIsTyping={isTyping(presenceEvidence.typingAt[selectedConversation.peerDid], now)}
            hasOlder={hasOlderMessages(selectedConversation.peerDid)}
            onOpenDocument={(attachment) => void saveOrOpen(attachment, true)}
            onSaveMedia={(item) => {
              // By hash, which is the file's identity. Size and mime were
              // ambiguous between two same-sized files of the same type.
              const found = messagesFor(selectedConversation.peerDid)
                .flatMap((m) => m.attachments ?? [])
                .find((a) => a.hash === item.hash);
              if (found) void saveOrOpen(found, false);
            }}
            saveState={saveState}
            saveError={saveError}
            onShareTicket={() => navigate({ tab: "profile", chatId: null })}
          />
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              padding: "var(--space-2xl)",
              color: "var(--color-text-muted)",
              userSelect: "none",
            }}
          >
            <Logo size={80} style={{ marginBottom: "var(--space-md)" }} />
            <h2
              style={{
                fontSize: "var(--font-size-h3)",
                fontFamily: "var(--font-family-headline)",
                color: "var(--color-text)",
                margin: "0 0 8px",
              }}
            >
              EchoIt Direct Messenger
            </h2>
            <p
              style={{
                fontSize: "var(--font-size-body)",
                color: "var(--color-text-muted)",
                maxWidth: "36ch",
                lineHeight: "var(--line-height-body)",
                margin: 0,
              }}
            >
              Select a conversation from the sidebar or share your connection ticket to start a private session.
            </p>
          </div>
        )}
      </main>
    </div>
  );
  };

  return (
    <>
      {renderContent()}

      {/*
        Asked only when back has nowhere left to go. A messenger that
        closes on a stray back press loses whatever was half-typed.
      */}
      <Modal
        isOpen={exitPromptOpen}
        onClose={() => setExitPromptOpen(false)}
        title="Close EchoIt?"
        subtitle="You are at the start of the app. Going back again will close it."
        maxWidth={380}
        footer={
          <div style={{ display: "flex", gap: "var(--space-sm)", justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => setExitPromptOpen(false)}>
              Stay
            </Button>
            <Button onClick={confirmExit}>Close</Button>
          </div>
        }
      >
        <span />
      </Modal>
    </>
  );
}
