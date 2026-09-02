"use client";

import { ChevronsLeft, ChevronsRight } from "lucide-react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import type { SidebarState } from "@/lib/ui/sidebar-state";

type SidebarToggleProps = {
  state: SidebarState;
  isCollapsed: boolean;
  onToggle: () => void;
};

// O último item da barra, dentro dela, com o mesmo desenho dos outros ícones.
//
// POR QUE ISTO EXISTE
//
// Antes era um círculo flutuante pregado na borda direita da barra (right:
// -1.1rem, z-index 65 para vencer a barra do topo), sentado em cima da linha
// que separa barra e conteúdo — lia como um elemento perdido, e no modo
// recolhido precisava de uma regra só para não cobrir a marca. Como item da
// barra ele tem endereço óbvio, alvo de 44px e o mesmo hover dos vizinhos.
export function SidebarToggle({
  isCollapsed,
  onToggle,
  state,
}: SidebarToggleProps) {
  const { t } = useTranslation();
  const Icon = state === "collapsed" ? ChevronsRight : ChevronsLeft;
  const label =
    state === "collapsed"
      ? t("platform.expandSidebar")
      : t("platform.collapseSidebar");

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className={[
        "platform-nav-link platform-sidebar-toggle group relative mt-auto flex h-11 min-h-11 w-full shrink-0 items-center gap-2.5 rounded-[10px] border border-transparent px-2.5 py-1.5 text-sm font-semibold text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface-strong)] hover:text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(44,82,130,0.24)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        isCollapsed ? "justify-center px-0" : "",
      ].join(" ")}
    >
      <span className="platform-nav-icon-chip">
        <Icon aria-hidden="true" size={18} strokeWidth={2} className="shrink-0" />
      </span>
      <span className="platform-sidebar-label min-w-0 truncate">{label}</span>
    </button>
  );
}
