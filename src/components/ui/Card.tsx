import React from "react";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  dim?: boolean;
  elevation?: "none" | "low" | "high";
  interactive?: boolean;
}

export function Card({
  children,
  dim = false,
  elevation = "none",
  interactive = false,
  style,
  className = "",
  ...props
}: CardProps) {
  const getShadow = () => {
    if (elevation === "high") return "var(--shadow-high)";
    if (elevation === "low") return "var(--shadow-low)";
    return "var(--shadow-none)";
  };

  return (
    <div
      style={{
        backgroundColor: dim ? "var(--color-surface-dim)" : "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-xl)",
        boxShadow: getShadow(),
        transition: "all var(--motion-duration-sm) var(--motion-ease)",
        cursor: interactive ? "pointer" : "default",
        ...style,
      }}
      className={`echoit-card ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
