"use client";

import { useTranslation } from "@/components/i18n/i18n-provider";

type SidebarToggleProps = {
  collapsed: boolean;
  /** id of the navigation list that the button opens and closes. */
  controls: string;
  onToggle: () => void;
};

// The ☰ at the top of the bar, to the left of the brand (as in Hotmart). Collapsed, it
// stays in the same place: the button does not run away from the cursor between one click and the next.
//
// The icon is drawn here, and not lucide's Menu, because the three bars
// need their own class to turn into an arrow (globals.css, ".platform-menu-icon"):
// when open, the bar shows the "collapse" arrow; collapsed, the ☰.
export function SidebarToggle({ collapsed, controls, onToggle }: SidebarToggleProps) {
  const { t } = useTranslation();
  const label = collapsed ? t("platform.expandSidebar") : t("platform.collapseSidebar");

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-controls={controls}
      aria-label={label}
      className="platform-nav-link platform-sidebar-toggle relative flex size-11 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--color-ink-soft)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
    >
      <svg
        aria-hidden="true"
        className="platform-menu-icon shrink-0"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        // 1.5px on screen, like lucide's icons at 18px: the stroke does not scale
        // (vector-effect in the CSS), otherwise the bars would thin out when turning into an arrow.
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h16" />
      </svg>
      <span className="platform-sidebar-label">{label}</span>
    </button>
  );
}
