"use client";

import { cloneElement, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Hover/focus help for a native trigger. The portal escapes scrolling panels;
 * measured viewport bounds keep it visible on either side of the trigger.
 * The trigger retains its handlers, focus and existing accessible description.
 */
type TooltipProps = {
  content: ReactNode;
  /** Direction the bubble points. Defaults to top. */
  side?: "top" | "bottom";
  children: ReactElement<{ "aria-describedby"?: string }>;
  className?: string;
};

export function Tooltip({
  content,
  side = "top",
  children,
  className = "",
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const arrowRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    const body = contentRef.current;
    const arrow = arrowRef.current;
    if (!trigger || !bubble || !body || !arrow) return;

    function position() {
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
      const topEdge = (viewport?.offsetTop ?? 0) + 8;
      const width = viewport?.width ?? (document.documentElement.clientWidth || window.innerWidth);
      const height = viewport?.height ?? window.innerHeight;
      const rightEdge = leftEdge + width - 16;
      const bottomEdge = topEdge + height - 16;
      bubble!.style.maxWidth = `${Math.max(1, Math.min(240, width - 16))}px`;
      body!.style.maxHeight = `${Math.max(1, height - 16)}px`;
      const anchor = trigger!.getBoundingClientRect();
      const bounds = bubble!.getBoundingClientRect();
      const above = anchor.top - topEdge - 8;
      const below = bottomEdge - anchor.bottom - 8;
      const placement = side === "top"
        ? (bounds.height > above && below > above ? "bottom" : "top")
        : (bounds.height > below && above > below ? "top" : "bottom");
      const left = Math.max(leftEdge, Math.min(anchor.left + anchor.width / 2 - bounds.width / 2, rightEdge - bounds.width));
      const top = Math.max(topEdge, Math.min(placement === "top" ? anchor.top - bounds.height - 8 : anchor.bottom + 8, bottomEdge - bounds.height));
      bubble!.style.left = `${left}px`;
      bubble!.style.top = `${top}px`;
      bubble!.style.visibility = "visible";
      arrow!.style.left = `${Math.max(8, Math.min(anchor.left + anchor.width / 2 - left - 4, bounds.width - 16))}px`;
      arrow!.style.top = placement === "bottom" ? "-4px" : "";
      arrow!.style.bottom = placement === "top" ? "-4px" : "";
    }
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !trigger!.contains(event.target) && !bubble!.contains(event.target)) setOpen(false);
    }
    function dismissHelp(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
    position();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    observer?.observe(trigger);
    observer?.observe(bubble);
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    document.addEventListener("pointerdown", closeOutside);
    // Hover can open help while focus stays in another field of a dialog.
    document.addEventListener("keydown", dismissHelp, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", dismissHelp, true);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [content, open, side]);

  function show() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }
  function leave() {
    if (!open) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    // Allow crossing the small gap into the help without dismissing it.
    closeTimer.current = setTimeout(() => {
      if (!triggerRef.current?.contains(document.activeElement)) setOpen(false);
    }, 120);
  }

  return (
    <span
      ref={triggerRef}
      className={`inline-flex shrink-0 ${className}`}
      onMouseEnter={show}
      onMouseLeave={leave}
      onFocus={show}
      onClick={show}
      onBlur={() => setOpen(false)}
    >
      {cloneElement(children, {
        "aria-describedby": [children.props["aria-describedby"], open ? id : null].filter(Boolean).join(" ") || undefined,
      })}
      {open ? createPortal(
        <span
          ref={bubbleRef}
          role="tooltip"
          id={id}
          onMouseEnter={show}
          onMouseLeave={leave}
          style={{ position: "fixed", visibility: "hidden" }}
          className="z-[100] w-max max-w-[240px] rounded-[8px] bg-[var(--color-primary)] text-left text-xs font-normal leading-5 text-[var(--color-base)] shadow-[0_10px_22px_rgba(15,39,68,0.18)]"
        >
          <span ref={contentRef} className="block overflow-y-auto whitespace-normal break-words rounded-[8px] px-3 py-2">{content}</span>
          <span ref={arrowRef} aria-hidden="true" className="absolute size-2 rotate-45 bg-[var(--color-primary)]" />
        </span>,
        document.body,
      ) : null}
    </span>
  );
}
