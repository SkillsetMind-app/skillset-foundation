import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { parseSidebarPref, SIDEBAR_COOKIE } from "@/lib/ui/sidebar-cookie";
import { SidebarPreferenceProvider } from "@/lib/ui/sidebar-preference";

/**
 * Layout das áreas com a barra lateral (/learn, /teach, /account, /ops,
 * /support): lê o cookie da barra no servidor, e o primeiro HTML já sai aberto
 * ou recolhido como a pessoa deixou (sem piscar). Fica aqui, e não no layout
 * raiz, para a home, as páginas de venda e o marketplace não levarem nenhum
 * código da barra. Sem cookie, o CSS decide pela largura da tela.
 */
export default async function SidebarPreferenceLayout({ children }: { children: ReactNode }) {
  const pref = parseSidebarPref((await cookies()).get(SIDEBAR_COOKIE)?.value);
  return <SidebarPreferenceProvider value={pref}>{children}</SidebarPreferenceProvider>;
}
