import React from "react";

export type BadgeVariant = "default" | "success" | "warning" | "muted";

export interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  dot?: boolean;
  mono?: boolean;
  style?: React.CSSProperties;
}

export function Badge({
  children,
  variant = "default",
  dot = false,
  mono = false,
  style,
}: BadgeProps) {
  const getColors = (): { bg: string; text: string; dotColor: string } => {
    switch (variant) {
      case "success":
        return {
          bg: "var(--color-success-subtle)",
          text: "var(--color-success)",
          dotColor: "var(--color-success)",
        };
      case "warning":
        return {
          bg: "var(--color-warning-subtle)",
          text: "var(--color-warning)",
          dotColor: "var(--color-warning)",
        };
      case "muted":
        return {
          bg: "var(--color-surface-dim)",
          text: "var(--color-text-muted)",
          dotColor: "var(--color-text-muted)",
        };
      default:
        return {
          bg: "var(--color-primary-subtle)",
          text: "var(--color-primary)",
          dotColor: "var(--color-primary)",
        };
    }
  };

  const colors = getColors();

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 8px",
        borderRadius: "var(--radius-full)",
        backgroundColor: colors.bg,
        color: colors.text,
        fontSize: "var(--font-size-label)",
        fontWeight: "var(--font-weight-medium)",
        fontFamily: mono ? "var(--font-family-mono)" : "var(--font-family-body)",
        letterSpacing: "0.02em",
        userSelect: "none",
        ...style,
      }}
    >
      {dot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            backgroundColor: colors.dotColor,
            flexShrink: 0,
          }}
        />
      )}
      {children}
    </span>
  );
}
