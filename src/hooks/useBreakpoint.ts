import { useState, useEffect } from "react";

/**
 * Hook to track responsive viewport width breakpoint.
 * Uses window.matchMedia strictly on width — never on user-agent or platform.
 *
 * @param minWidthPx Minimum pixel width (default: 840px per design system spec)
 * @returns boolean `true` if viewport width >= minWidthPx, `false` otherwise
 */
export function useBreakpoint(minWidthPx = 840): boolean {
  const [isWide, setIsWide] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth >= minWidthPx;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia(`(min-width: ${minWidthPx}px)`);

    const updateMatch = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsWide(e.matches);
    };

    // Initial sync
    setIsWide(mediaQuery.matches);

    // Modern and legacy event listener support
    try {
      mediaQuery.addEventListener("change", updateMatch);
      return () => mediaQuery.removeEventListener("change", updateMatch);
    } catch {
      // Fallback for older WebViews
      mediaQuery.addListener(updateMatch);
      return () => mediaQuery.removeListener(updateMatch);
    }
  }, [minWidthPx]);

  return isWide;
}
