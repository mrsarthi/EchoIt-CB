import { useState, useEffect, useCallback } from "react";
import { useBreakpoint } from "../hooks/useBreakpoint";
import { BottomNav, type AppTab } from "../components/navigation/BottomNav";
import { SidebarNavRail } from "../components/navigation/SidebarNavRail";
import { ChatsTab, type ConversationItem } from "./tabs/ChatsTab";
import { ContactsTab } from "./tabs/ContactsTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { ProfileTab } from "./tabs/ProfileTab";
import { ChatView } from "./chat/ChatView";
import { Logo } from "../components/ui/Logo";
import { useApp } from "../context/AppContext";
import type { MessageItem } from "./chat/ChatView";

export function AppShell() {
  const isWide = useBreakpoint(840);
  const { contacts, pendingRequests, messages, sendMessage, did } = useApp();
  const [activeTab, setActiveTab] = useState<AppTab>("chats");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);

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
        setSelectedChatId(null);
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

    setSelectedChatId(existing.id);
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
            onSelectChat={(id) => setSelectedChatId(id)}
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

  // --- NARROW LAYOUT (< 840px) ---
  if (!isWide) {
    // If a conversation is selected, show full-height ChatView WITHOUT BottomNav
    if (selectedConversation) {
      return (
        <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
          <ChatView
            peerDid={selectedConversation.peerDid}
            peerName={selectedConversation.name}
            pairingState={selectedContact?.pairingState || "unilateral_waiting"}
            isOnline={selectedConversation.isOnline}
            onBack={() => setSelectedChatId(null)}
            messages={messagesFor(selectedConversation?.peerDid)}
            onSendMessage={handleSendMessage}
            onShareTicket={() => setActiveTab("profile")}
          />
        </div>
      );
    }

    // Otherwise show active tab with BottomNav at the bottom
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--color-bg)",
          overflow: "hidden",
        }}
      >
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {renderTabContent()}
        </div>
        <BottomNav activeTab={activeTab} onSelectTab={setActiveTab} />
      </div>
    );
  }

  // --- WIDE LAYOUT (>= 840px — WhatsApp Style 3-Zone Architecture) ---
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        backgroundColor: "var(--color-bg)",
        overflow: "hidden",
      }}
    >
      {/* 1. Far-Left Nav Rail (56-60px) */}
      <SidebarNavRail
        activeTab={activeTab}
        onSelectTab={setActiveTab}
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
            onShareTicket={() => setActiveTab("profile")}
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
}
