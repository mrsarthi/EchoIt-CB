import { useState, useEffect, useCallback } from "react";
import { useBreakpoint } from "../hooks/useBreakpoint";
import { BottomNav, type AppTab } from "../components/navigation/BottomNav";
import { SidebarNavRail } from "../components/navigation/SidebarNavRail";
import { ChatsTab, type ConversationItem } from "./tabs/ChatsTab";
import { ContactsTab } from "./tabs/ContactsTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { ProfileTab } from "./tabs/ProfileTab";
import { ChatView } from "./chat/ChatView";
import { ShieldIcon } from "../components/ui/Icons";
import { Logo } from "../components/ui/Logo";
import { useApp } from "../context/AppContext";

export function AppShell() {
  const isWide = useBreakpoint(840);
  const { contacts, pendingRequests } = useApp();
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
            lastMessage: contact.pairingState === "bilateral_connected" ? "Connected directly" : "Waiting for them to connect back",
            timestamp: "Recently",
            unreadCount: 0,
            isOnline: contact.pairingState === "bilateral_connected",
          });
        }
      });

      return updated;
    });
  }, [contacts]);

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

  const handleSendMessage = (text: string) => {
    if (!selectedChatId) return;
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedChatId
          ? {
              ...c,
              lastMessage: text,
              timestamp: "Just now",
            }
          : c
      )
    );
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
            conversations={conversations}
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
