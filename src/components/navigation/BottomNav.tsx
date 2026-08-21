import React from "react";
import { ChatBubbleIcon, AddressBookIcon, SettingsIcon, UserIcon } from "../ui/Icons";

export type AppTab = "chats" | "contacts" | "settings" | "profile";

export interface BottomNavProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  unreadChatsCount?: number;
  pendingRequestsCount?: number;
}

export function BottomNav({
  activeTab,
  onSelectTab,
  unreadChatsCount = 0,
  pendingRequestsCount = 0,
}: BottomNavProps) {
  const tabs: Array<{
    id: AppTab;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    {
      id: "chats",
      label: "Chats",
      icon: <ChatBubbleIcon size={20} />,
      badge: unreadChatsCount,
    },
    {
      id: "contacts",
      label: "Contacts",
      icon: <AddressBookIcon size={20} />,
      badge: pendingRequestsCount,
    },
    {
      id: "settings",
      label: "Settings",
      icon: <SettingsIcon size={20} />,
    },
    {
      id: "profile",
      label: "Profile",
      icon: <UserIcon size={20} />,
    },
  ];

  return (
    <nav
      style={{
        height: "calc(56px + var(--safe-bottom))",
        paddingBottom: "var(--safe-bottom)",
        backgroundColor: "var(--color-surface)",
        borderTop: "1px solid var(--color-border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-around",
        flexShrink: 0,
        zIndex: 50,
        userSelect: "none",
      }}
      aria-label="Bottom Navigation"
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            style={{
              flex: 1,
              height: "100%",
              minHeight: 48,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              outline: "none",
              color: isActive ? "var(--color-primary)" : "var(--color-text-muted)",
              transition: "all var(--motion-duration-sm) var(--motion-ease)",
              padding: "4px 0",
              position: "relative",
            }}
            aria-current={isActive ? "page" : undefined}
          >
            <div style={{ position: "relative", display: "inline-flex" }}>
              {tab.icon}
              {tab.badge && tab.badge > 0 ? (
                <span
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -8,
                    backgroundColor: "var(--color-primary)",
                    color: "#FFFFFF",
                    fontSize: "0.6875rem",
                    fontWeight: "var(--font-weight-bold)",
                    borderRadius: "var(--radius-full)",
                    minWidth: 16,
                    height: 16,
                    padding: "0 4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {tab.badge}
                </span>
              ) : null}
            </div>
            <span
              style={{
                fontSize: "0.6875rem",
                fontWeight: isActive
                  ? "var(--font-weight-semibold)"
                  : "var(--font-weight-medium)",
                fontFamily: "var(--font-family-body)",
                letterSpacing: "0.01em",
              }}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
