import React from "react";
import { type AppTab } from "./BottomNav";
import { ChatBubbleIcon, AddressBookIcon, SettingsIcon, UserIcon } from "../ui/Icons";
import { Logo } from "../ui/Logo";

export interface SidebarNavRailProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  unreadChatsCount?: number;
  pendingRequestsCount?: number;
}

export function SidebarNavRail({
  activeTab,
  onSelectTab,
  unreadChatsCount = 0,
  pendingRequestsCount = 0,
}: SidebarNavRailProps) {
  const topTabs: Array<{
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
  ];

  const bottomTabs: Array<{
    id: AppTab;
    label: string;
    icon: React.ReactNode;
  }> = [
    {
      id: "settings",
      label: "Settings",
      icon: <SettingsIcon size={20} />,
    },
    {
      id: "profile",
      label: "Profile & Identity",
      icon: <UserIcon size={20} />,
    },
  ];

  const renderNavButton = (tab: {
    id: AppTab;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }) => {
    const isActive = activeTab === tab.id;
    return (
      <button
        key={tab.id}
        onClick={() => onSelectTab(tab.id)}
        style={{
          width: 44,
          height: 44,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: isActive ? "var(--color-primary-subtle)" : "transparent",
          color: isActive ? "var(--color-primary)" : "var(--color-text-muted)",
          border: isActive ? "1px solid var(--color-primary)" : "1px solid transparent",
          borderRadius: "var(--radius-md)",
          cursor: "pointer",
          outline: "none",
          transition: "all var(--motion-duration-sm) var(--motion-ease)",
          position: "relative",
          padding: 0,
        }}
        role="tab"
        aria-selected={isActive}
        title={tab.label}
        aria-label={tab.label}
      >
        {tab.icon}
        {tab.badge && tab.badge > 0 ? (
          <span
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              backgroundColor: "var(--color-primary)",
              color: "#FFFFFF",
              fontSize: "0.625rem",
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
      </button>
    );
  };

  return (
    <nav
      style={{
        width: 60,
        height: "100%",
        backgroundColor: "var(--color-surface-dim)",
        borderRight: "1px solid var(--color-border)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "var(--space-md) 0",
        flexShrink: 0,
        zIndex: 20,
      }}
      role="tablist"
      aria-label="Desktop Navigation Rail"
    >
      {/* Top Group: Brand Mark + Destination Tabs */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-sm)" }}>
        {/* Brand Icon */}
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "var(--radius-md)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "var(--space-xs)",
          }}
          title="EchoIt"
        >
          <Logo size={36} />
        </div>

        <div style={{ width: 32, height: 1, backgroundColor: "var(--color-border)", margin: "4px 0 var(--space-xs)" }} />

        {topTabs.map(renderNavButton)}
      </div>

      {/* Bottom Group: Settings & Profile */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-sm)" }}>
        {bottomTabs.map(renderNavButton)}
      </div>
    </nav>
  );
}
