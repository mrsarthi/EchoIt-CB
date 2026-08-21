import React, { useEffect } from "react";
import { XIcon } from "./Icons";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: number | string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxWidth = 480,
}: ModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-lg)",
        backgroundColor: "rgba(18, 20, 18, 0.55)",
        backdropFilter: "blur(4px)",
        animation: "fadeIn 150ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          width: "100%",
          maxWidth,
          backgroundColor: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-high)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "90vh",
          overflow: "hidden",
          animation: "slideUp 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* Modal Header */}
        {(title || subtitle) && (
          <div
            style={{
              padding: "var(--space-xl) var(--space-xl) var(--space-md)",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "var(--space-md)",
            }}
          >
            <div>
              {title && (
                <h3
                  style={{
                    fontSize: "var(--font-size-h3)",
                    fontFamily: "var(--font-family-headline)",
                    margin: 0,
                  }}
                >
                  {title}
                </h3>
              )}
              {subtitle && (
                <p
                  style={{
                    fontSize: "var(--font-size-body-sm)",
                    color: "var(--color-text-muted)",
                    marginTop: 4,
                  }}
                >
                  {subtitle}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--color-text-muted)",
                cursor: "pointer",
                padding: 4,
                display: "inline-flex",
                borderRadius: "var(--radius-sm)",
                outline: "none",
              }}
              aria-label="Close dialog"
            >
              <XIcon size={20} />
            </button>
          </div>
        )}

        {/* Modal Content */}
        <div
          style={{
            padding: "var(--space-md) var(--space-xl) var(--space-xl)",
            overflowY: "auto",
            flex: 1,
          }}
        >
          {children}
        </div>

        {/* Modal Footer */}
        {footer && (
          <div
            style={{
              padding: "var(--space-md) var(--space-xl) var(--space-xl)",
              borderTop: "1px solid var(--color-border)",
              backgroundColor: "var(--color-surface-dim)",
              display: "flex",
              justifyContent: "flex-end",
              gap: "var(--space-sm)",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
