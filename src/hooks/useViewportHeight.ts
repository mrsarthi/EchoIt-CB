import { useEffect } from "react";

/**
 * Keep the app sized to the *visible* area, not the window.
 *
 * When the soft keyboard opens, Android may shrink the visual viewport and pan
 * it to bring the focused input into view. Panning moves everything up
 * together — including the safe-area padding — so a header sitting at the top
 * slides underneath the status bar and collides with the clock and battery
 * icons. Reported twice from a real phone.
 *
 * `interactive-widget=resizes-content` in the viewport meta was the first
 * attempt. It only helps when the *layout* viewport resizes; it does nothing
 * about panning, which is why the header still ended up under the status bar.
 *
 * Sizing the app to `visualViewport.height` removes the reason to pan: the
 * focused input is already inside the visible area, so the browser has nothing
 * to scroll into view. `--app-height` is consumed by `#root` in `index.css`.
 *
 * Falls back to `100%` where `visualViewport` is unavailable — the variable is
 * simply never set, and the CSS default applies.
 */
export function useViewportHeight(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const apply = () => {
      document.documentElement.style.setProperty(
        "--app-height",
        `${Math.round(viewport.height)}px`,
      );
      // Panning can still happen — a stubborn keyboard, a ROM that ignores the
      // above. Exposing the offset lets the layout compensate rather than
      // pretending it cannot occur.
      document.documentElement.style.setProperty(
        "--vv-offset-top",
        `${Math.round(viewport.offsetTop)}px`,
      );
    };

    apply();
    viewport.addEventListener("resize", apply);
    viewport.addEventListener("scroll", apply);
    return () => {
      viewport.removeEventListener("resize", apply);
      viewport.removeEventListener("scroll", apply);
    };
  }, []);
}
