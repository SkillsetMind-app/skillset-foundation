"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function visibleFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => element.getClientRects().length > 0);
}

/**
 * Dialog focus management (ARIA APG modal pattern):
 * - on open, remembers the trigger and moves focus onto the dialog container
 *   (container must have tabIndex={-1});
 * - while open, keeps Tab / Shift+Tab cycling inside the container;
 * - on close/unmount, restores focus to the element that opened the dialog.
 *
 * Escape handling stays with each dialog — close semantics differ per modal.
 */
export function useModalFocus(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
) {
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }

    restoreRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    containerRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") {
        return;
      }
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const focusable = visibleFocusable(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      const outside = !current || !container.contains(current);

      if (event.shiftKey) {
        if (outside || current === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (outside || current === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      restoreRef.current?.focus();
    };
  }, [active, containerRef]);
}
