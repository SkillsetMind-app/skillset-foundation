import type { KeyboardEvent } from "react";

const JUMPS = ["ArrowDown", "ArrowUp", "Home", "End"];

/**
 * Arrow keys, Home and End between the items of a menu or a list of options
 * (WAI-ARIA menu pattern). Goes on the container's `onKeyDown`; `selector`
 * says which children are items. The product and share menus said
 * `role="menu"` but only moved with Tab. Other keys pass straight through: Enter,
 * Space and Esc stay with whoever already handled them.
 */
export function moveFocusByKey(event: KeyboardEvent<HTMLElement>, selector: string) {
  if (!JUMPS.includes(event.key)) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(selector));
  if (items.length === 0) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement as HTMLElement);
  const last = items.length - 1;
  const next =
    event.key === "Home" ? 0
    : event.key === "End" ? last
    : event.key === "ArrowDown" ? (current + 1) % items.length
    : current <= 0 ? last : current - 1;
  items[next].focus();
}
