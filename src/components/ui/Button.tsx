import { forwardRef, type ButtonHTMLAttributes, type ReactNode, type CSSProperties } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "pill";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = "primary",
      size = "md",
      icon,
      iconRight,
      loading = false,
      fullWidth = false,
      disabled = false,
      style,
      className = "",
      ...props
    },
    ref,
  ) => {
    const isPrimary = variant === "primary";
    const isSecondary = variant === "secondary";
    const isGhost = variant === "ghost";
    const isDanger = variant === "danger";
    const isPill = variant === "pill";
    const isIconOnly = !children && Boolean(icon);

    // Touch targets must be at least 44px for thumb/mobile ergonomics
    const sizeStyles: Record<ButtonSize, CSSProperties> = {
      sm: {
        minHeight: 44,
        minWidth: isIconOnly ? 44 : "auto",
        padding: isIconOnly ? "0" : "0 14px",
        fontSize: "var(--font-size-body-sm)",
        gap: 6,
      },
      md: {
        minHeight: 44,
        minWidth: isIconOnly ? 44 : "auto",
        padding: isIconOnly ? "0" : "0 18px",
        fontSize: "var(--font-size-body)",
        gap: 8,
      },
      lg: {
        minHeight: 52,
        minWidth: isIconOnly ? 52 : "auto",
        padding: isIconOnly ? "0" : "0 24px",
        fontSize: "var(--font-size-body)",
        fontWeight: "var(--font-weight-semibold)",
        gap: 10,
      },
    };

    const getVariantStyles = (): CSSProperties => {
      if (isPrimary) {
        return {
          backgroundColor: "var(--color-primary)",
          color: "#FFFFFF",
          border: "1px solid transparent",
          boxShadow: "var(--shadow-low)",
        };
      }
      if (isSecondary) {
        return {
          backgroundColor: "var(--color-surface)",
          color: "var(--color-text)",
          border: "1px solid var(--color-border)",
          boxShadow: "var(--shadow-none)",
        };
      }
      if (isGhost) {
        return {
          backgroundColor: "transparent",
          color: "var(--color-text)",
          border: "1px solid transparent",
        };
      }
      if (isDanger) {
        return {
          backgroundColor: "var(--color-warning)",
          color: "#FFFFFF",
          border: "1px solid transparent",
        };
      }
      if (isPill) {
        return {
          backgroundColor: "var(--color-surface-dim)",
          color: "var(--color-text)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-full)",
        };
      }
      return {};
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-family-body)",
          fontWeight: "var(--font-weight-medium)",
          borderRadius: isPill ? "var(--radius-full)" : "var(--radius-md)",
          cursor: disabled || loading ? "not-allowed" : "pointer",
          opacity: disabled ? 0.45 : 1,
          width: fullWidth ? "100%" : "auto",
          transition: "all var(--motion-duration-sm) var(--motion-ease)",
          outline: "none",
          userSelect: "none",
          ...sizeStyles[size],
          ...getVariantStyles(),
          ...style,
        }}
        className={`echoit-btn ${className}`}
        onMouseDown={(e) => {
          if (!disabled && !loading) {
            e.currentTarget.style.transform = "scale(0.97)";
          }
        }}
        onMouseUp={(e) => {
          e.currentTarget.style.transform = "scale(1)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
        }}
        {...props}
      >
        {loading ? (
          <span
            style={{
              width: 16,
              height: 16,
              border: "2px solid currentColor",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "spin 0.6s linear infinite",
            }}
          />
        ) : (
          <>
            {icon && <span style={{ display: "inline-flex", flexShrink: 0 }}>{icon}</span>}
            {children && <span>{children}</span>}
            {iconRight && (
              <span style={{ display: "inline-flex", flexShrink: 0 }}>{iconRight}</span>
            )}
          </>
        )}
      </button>
    );
  },
);

Button.displayName = "Button";
