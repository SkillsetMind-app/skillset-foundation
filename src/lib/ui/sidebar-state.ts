"use client";

import { useContext, useSyncExternalStore } from "react";

import { parseSidebarPref, SIDEBAR_COOKIE, type SidebarPref } from "@/lib/ui/sidebar-cookie";
import { SidebarPrefContext } from "@/lib/ui/sidebar-preference";

/** 768–1023px: sempre o rail. Aberta, a barra deixaria ~465px de conteúdo e a
 *  barra do topo não cabe (conta em src/app/barra-do-topo-cabe.test.ts). */
const TABLET_QUERY = "(min-width: 768px) and (width < 1024px)";
/** 1024–1179px: o rail é o padrão de quem nunca escolheu; quem abriu fica aberto. */
const LAPTOP_QUERY = "(min-width: 1024px) and (width < 1180px)";

/** Onde a escolha morava antes do cookie. */
export const LEGACY_SIDEBAR_KEY = "skillset_sidebar_state";

// A chave velha não é lida (o cookie a substituiu); só é apagada, uma vez por
// carga, quando este módulo chega ao navegador.
if (typeof window !== "undefined") {
  try {
    window.localStorage.removeItem(LEGACY_SIDEBAR_KEY);
  } catch {
    // ponytail: armazenamento bloqueado (iframe isolado, modo privado): nada a apagar.
  }
}

// O cookie é a fonte da escolha. No servidor (e na hidratação) vale o valor que
// o layout da área logada leu; no navegador, o próprio cookie — o layout não
// roda de novo numa navegação, e cada página monta o seu PlatformShell.
const listeners = new Set<() => void>();
const cookiePattern = new RegExp(`(?:^|;\\s*)${SIDEBAR_COOKIE}=([^;]*)`);

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function readCookie(): SidebarPref {
  try {
    return parseSidebarPref(document.cookie.match(cookiePattern)?.[1]);
  } catch {
    return null;
  }
}

// Só o clique no botão (ou num grupo, na barra recolhida do desktop) muda a
// barra. Sem expandir no hover: o menu pulava quando o cursor passava perto.
export function useSidebarState() {
  const fromServer = useContext(SidebarPrefContext);
  const pref = useSyncExternalStore(subscribe, readCookie, () => fromServer);
  const isTablet = useMediaQuery(TABLET_QUERY);
  const isLaptop = useMediaQuery(LAPTOP_QUERY);
  const isCollapsed = isTablet || (pref ? pref === "collapsed" : isLaptop);

  function toggle() {
    try {
      document.cookie = `${SIDEBAR_COOKIE}=${isCollapsed ? "expanded" : "collapsed"}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // ponytail: página sem cookie (iframe isolado) fica no padrão da tela.
    }
    listeners.forEach((onChange) => onChange());
  }

  return {
    /** Na faixa do rail, um grupo recolhido abre a gaveta em vez da barra. */
    isRail: isTablet || isLaptop,
    isCollapsed,
    /** Sem escolha salva: o CSS decide a largura pela tela já no 1º quadro. */
    isAuto: pref === null,
    toggle,
  };
}

/**
 * `useSyncExternalStore` em vez de efeito + estado: o instantâneo do servidor é
 * `false` (o servidor não sabe o tamanho da janela), então não há divergência de
 * hidratação nem um render extra a cada montagem. A largura do primeiro quadro
 * vem do CSS (.platform-grid--auto), não daqui.
 *
 * ponytail: `matchMedia?.()` porque nem todo ambiente o tem — jsdom sem stub e
 * navegador antigo caem no `false`, que é o desenho de sempre, em vez de
 * derrubar a página inteira.
 */
function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia?.(query);

      list?.addEventListener("change", onChange);

      return () => list?.removeEventListener("change", onChange);
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}
