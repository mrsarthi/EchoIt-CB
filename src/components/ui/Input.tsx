import React, { forwardRef } from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  mono?: boolean;
  leftAddon?: React.ReactNode;
  rightAddon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      hint,
      mono = false,
      leftAddon,
      rightAddon,
      fullWidth = true,
      disabled = false,
      style,
      className = "",
      ...props
    },
    ref,
  ) => {
    return (
      <div style={{ width: fullWidth ? "100%" : "auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {label && (
          <label
            style={{
              fontSize: "var(--font-size-body-sm)",
              fontWeight: "var(--font-weight-medium)",
              color: error ? "var(--color-warning)" : "var(--color-text)",
            }}
          >
            {label}
          </label>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            width: "100%",
            backgroundColor: "var(--color-surface)",
            border: `1px solid ${error ? "var(--color-warning)" : "var(--color-border)"}`,
            borderRadius: "var(--radius-md)",
            transition: "border-color var(--motion-duration-sm) var(--motion-ease)",
            overflow: "hidden",
          }}
        >
          {leftAddon && (
            <div
              style={{
                paddingLeft: 12,
                display: "flex",
                alignItems: "center",
                color: "var(--color-text-muted)",
              }}
            >
              {leftAddon}
            </div>
          )}
          <input
            ref={ref}
            disabled={disabled}
            style={{
              flex: 1,
              height: 44,
              padding: leftAddon ? "0 12px 0 8px" : rightAddon ? "0 8px 0 14px" : "0 14px",
              backgroundColor: "transparent",
              border: "none",
              outline: "none",
              color: "var(--color-text)",
              fontFamily: mono ? "var(--font-family-mono)" : "var(--font-family-body)",
              fontSize: mono ? "var(--font-size-mono)" : "var(--font-size-body)",
              opacity: disabled ? 0.6 : 1,
              cursor: disabled ? "not-allowed" : "text",
              width: "100%",
              ...style,
            }}
            className={className}
            {...props}
          />
          {rightAddon && (
            <div
              style={{
                paddingRight: 12,
                display: "flex",
                alignItems: "center",
                color: "var(--color-text-muted)",
              }}
            >
              {rightAddon}
            </div>
          )}
        </div>
        {error ? (
          <span
            style={{
              fontSize: "var(--font-size-label)",
              color: "var(--color-warning)",
              marginTop: 2,
            }}
          >
            {error}
          </span>
        ) : hint ? (
          <span
            style={{
              fontSize: "var(--font-size-label)",
              color: "var(--color-text-muted)",
              marginTop: 2,
            }}
          >
            {hint}
          </span>
        ) : null}
      </div>
    );
  },
);

Input.displayName = "Input";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  mono?: boolean;
  fullWidth?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, hint, mono = false, fullWidth = true, disabled = false, style, ...props }, ref) => {
    return (
      <div style={{ width: fullWidth ? "100%" : "auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {label && (
          <label
            style={{
              fontSize: "var(--font-size-body-sm)",
              fontWeight: "var(--font-weight-medium)",
              color: error ? "var(--color-warning)" : "var(--color-text)",
            }}
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          disabled={disabled}
          style={{
            width: "100%",
            minHeight: 80,
            padding: "10px 14px",
            backgroundColor: "var(--color-surface)",
            border: `1px solid ${error ? "var(--color-warning)" : "var(--color-border)"}`,
            borderRadius: "var(--radius-md)",
            outline: "none",
            color: "var(--color-text)",
            fontFamily: mono ? "var(--font-family-mono)" : "var(--font-family-body)",
            fontSize: mono ? "var(--font-size-mono)" : "var(--font-size-body)",
            lineHeight: 1.5,
            resize: "vertical",
            opacity: disabled ? 0.6 : 1,
            cursor: disabled ? "not-allowed" : "text",
            ...style,
          }}
          {...props}
        />
        {error ? (
          <span style={{ fontSize: "var(--font-size-label)", color: "var(--color-warning)" }}>{error}</span>
        ) : hint ? (
          <span style={{ fontSize: "var(--font-size-label)", color: "var(--color-text-muted)" }}>{hint}</span>
        ) : null}
      </div>
    );
  },
);

Textarea.displayName = "Textarea";
