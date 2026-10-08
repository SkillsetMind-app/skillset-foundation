// Fora do "use client" de propósito: o layout raiz (servidor) lê o cookie com
// estas duas peças, e o hook do cliente grava com o mesmo nome.

export const SIDEBAR_COOKIE = "skillset_sidebar";

/** null = a pessoa nunca escolheu: a largura da tela decide. */
export type SidebarPref = "collapsed" | "expanded" | null;

export function parseSidebarPref(value: string | undefined): SidebarPref {
  return value === "collapsed" || value === "expanded" ? value : null;
}
