import { useEffect } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Modal focus management for a slide-over / dialog panel.
 *  - On open: remember the previously-focused element and move focus into the panel.
 *  - While open: keep Tab / Shift+Tab cycling within the panel.
 *  - On close (unmount): restore focus to where it was.
 * `ref` is the panel element; the hook is a no-op until it's mounted.
 */
export function useFocusTrap(ref) {
  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;

    const previouslyFocused = document.activeElement;

    // Focus the panel itself (it carries tabIndex=-1) so screen readers announce it.
    const focusFirst = () => {
      const focusables = panel.querySelectorAll(FOCUSABLE);
      if (focusables.length) focusables[0].focus();
      else panel.focus();
    };
    focusFirst();

    const onKeyDown = (e) => {
      if (e.key !== "Tab") return;
      const focusables = Array.from(panel.querySelectorAll(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (focusables.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first || !panel.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    panel.addEventListener("keydown", onKeyDown);
    return () => {
      panel.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [ref]);
}
