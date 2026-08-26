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
import type { MessageItem } from "./chat/ChatView";

export function AppShell() {
  const isWide = useBreakpoint(840);
  useViewportHeight();
  const { contacts, pendingRequests, messages, sendMessage, did } = useApp();
  const [activeTab, setActiveTab] = useState<AppTab>("chats");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);

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
    window.addEventListener("echoit:back", onNativeBack);

    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("echoit:back", onNativeBack);
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
          existing.isOnline = contact.pairingState === "bilateral_connected";
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
            isOnline: contact.pairingState === "bilateral_connected",
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
  const conversationsWithPreview: ConversationItem[] = conversations.map((c) => {
    const thread = messages[c.peerDid] ?? [];
    const latest = thread[thread.length - 1];
    if (!latest) return c;
    return {
      ...c,
      lastMessage: latest.content,
      timestamp: new Date(latest.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  });

  const selectedConversation = conversations.find((c) => c.id === selectedChatId) || null;
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
  const handleSendMessage = (text: string) => {
    const peerDid = selectedConversation?.peerDid;
    if (!peerDid) return;
    void sendMessage(peerDid, text).catch(() => {
      // Surfacing this properly needs the §5b Staged/Sent ladder. Until that
      // exists, failing quietly is still better than the previous behaviour,
      // which was to show every message as sent whether or not it was.
    });
  };

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
        isOnline: contact?.pairingState === "bilateral_connected",
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
            pairingState={selectedContact?.pairingState || "unilateral_waiting"}
            isOnline={selectedConversation.isOnline}
            onBack={closeChat}
            messages={messagesFor(selectedConversation?.peerDid)}
            onSendMessage={handleSendMessage}
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
        <BottomNav activeTab={activeTab} onSelectTab={(tab) => navigate({ tab, chatId: null })} />
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
            pairingState={selectedContact?.pairingState || "unilateral_waiting"}
            isOnline={selectedConversation.isOnline}
            messages={messagesFor(selectedConversation?.peerDid)}
            onSendMessage={handleSendMessage}
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
