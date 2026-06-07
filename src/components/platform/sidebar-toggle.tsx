"use client";

import { ChevronsLeft, ChevronsRight } from "lucide-react";

import type { SidebarState } from "@/lib/ui/sidebar-state";

type SidebarToggleProps = {
  state: SidebarState;
  isCollapsed: boolean;
  onToggle: () => void;
};

export function SidebarToggle({
  isCollapsed,
  onToggle,
  state,
}: SidebarToggleProps) {
  const Icon = state === "collapsed" ? ChevronsRight : ChevronsLeft;
  const label = state === "collapsed" ? "Expand sidebar" : "Collapse sidebar";

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className={[
        "mb-3 grid size-7 place-items-center rounded-[8px] text-[var(--color-ink-soft)] transition hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(44,82,130,0.28)]",
        isCollapsed ? "mx-auto" : "ml-auto",
      ].join(" ")}
    >
      <Icon aria-hidden="true" size={18} strokeWidth={2.25} />
    </button>
  );
}
