import React from "react";
import logoUrl from "../../assets/logo.png";

export interface LogoProps {
  size?: number | string;
  className?: string;
  style?: React.CSSProperties;
  alt?: string;
}

export function Logo({
  size = 32,
  className,
  style,
  alt = "EchoIt Logo",
}: LogoProps) {
  return (
    <img
      src={logoUrl}
      alt={alt}
      width={size}
      height={size}
      className={className}
      data-testid="echoit-logo"
      style={{
        display: "inline-block",
        objectFit: "contain",
        userSelect: "none",
        backgroundColor: "transparent",
        ...style,
      }}
    />
  );
}
