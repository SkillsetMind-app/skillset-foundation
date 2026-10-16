"use client";

import { useTranslation } from "@/components/i18n/i18n-provider";

type SidebarToggleProps = {
  collapsed: boolean;
  /** id da lista de navegação que o botão abre e fecha. */
  controls: string;
  onToggle: () => void;
};

// O ☰ do topo da barra, à esquerda da marca (como na Hotmart). Recolhida, ele
// fica no mesmo lugar: o botão não foge do cursor entre um clique e outro.
//
// O ícone é desenhado aqui, e não o Menu do lucide, porque as três barras
// precisam de classe própria para virar seta (globals.css, ".platform-menu-icon"):
// aberta, a barra mostra a seta "recolher"; recolhida, o ☰.
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
        // 1,5px na tela, como os ícones do lucide a 18px: o traço não escala
        // (vector-effect no CSS), senão as barras afinariam ao virar seta.
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
