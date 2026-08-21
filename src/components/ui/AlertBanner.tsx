import React from "react";
import { AlertCircleIcon, InfoIcon, ShieldIcon } from "./Icons";

export type AlertVariant = "info" | "warning" | "security" | "success";

export interface AlertBannerProps {
  variant?: AlertVariant;
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  style?: React.CSSProperties;
}

export function AlertBanner({
  variant = "info",
  title,
  children,
  action,
  style,
}: AlertBannerProps) {
  const getConfig = () => {
    switch (variant) {
      case "warning":
        return {
          bg: "var(--color-warning-subtle)",
          border: "var(--color-warning)",
          text: "var(--color-text)",
          icon: <AlertCircleIcon size={20} style={{ color: "var(--color-warning)" }} />,
        };
      case "security":
        return {
          bg: "var(--color-primary-subtle)",
          border: "var(--color-primary)",
          text: "var(--color-text)",
          icon: <ShieldIcon size={20} style={{ color: "var(--color-primary)" }} />,
        };
      case "success":
        return {
          bg: "var(--color-success-subtle)",
          border: "var(--color-success)",
          text: "var(--color-text)",
          icon: <InfoIcon size={20} style={{ color: "var(--color-success)" }} />,
        };
      default:
        return {
          bg: "var(--color-surface-dim)",
          border: "var(--color-border)",
          text: "var(--color-text)",
          icon: <InfoIcon size={20} style={{ color: "var(--color-text-muted)" }} />,
        };
    }
  };

  const config = getConfig();

  return (
    <div
      style={{
        display: "flex",
        gap: "var(--space-md)",
        padding: "var(--space-md) var(--space-lg)",
        backgroundColor: config.bg,
        border: `1px solid ${config.border}`,
        borderRadius: "var(--radius-md)",
        alignItems: "flex-start",
        ...style,
      }}
    >
      <div style={{ flexShrink: 0, marginTop: 2 }}>{config.icon}</div>
      <div style={{ flex: 1, fontSize: "var(--font-size-body-sm)", color: config.text }}>
        {title && (
          <div
            style={{
              fontWeight: "var(--font-weight-semibold)",
              marginBottom: 4,
              fontFamily: "var(--font-family-body)",
            }}
          >
            {title}
          </div>
        )}
        <div style={{ lineHeight: "var(--line-height-body-sm)", color: "var(--color-text)" }}>
          {children}
        </div>
        {action && <div style={{ marginTop: "var(--space-sm)" }}>{action}</div>}
      </div>
    </div>
  );
}
