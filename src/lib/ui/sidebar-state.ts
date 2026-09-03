"use client";

import { useEffect, useState } from "react";

export type SidebarState = "expanded" | "collapsed";

const STORAGE_KEY = "skillset_sidebar_state";

/** Faixa do tablet: sem barra de baixo, e o rail de 64px é a navegação. */
const RAIL_QUERY = "(min-width: 768px) and (max-width: 1023px)";

// Sidebar is click-controlled only. No hover expansion — the previous
// hover-to-peek behavior made the menu jump unexpectedly when the cursor
// passed nearby. State persists in localStorage, toggled only via
// SidebarToggle at the top of the menu.
export function useSidebarState() {
  const [state, setState] = useState<SidebarState>("expanded");
  // No tablet o recolhido é imposto, não preferido: a barra inteira de 288px
  // come um terço de uma tela de 800px e o botão de recolher some junto (a
  // largura já vem fixa da media query). A preferência salva continua valendo
  // no desktop — este sinalizador não escreve no localStorage.
  const [isRail, setIsRail] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(RAIL_QUERY);
    const sync = () => setIsRail(query.matches);

    sync();
    query.addEventListener("change", sync);

    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    // Defer the setState by a microtask so React doesn't flag this as
    // a sync setState-in-effect cascade. localStorage is read post-hydration
    // anyway — SSR defaults to "expanded".
    const timer = window.setTimeout(() => {
      const savedState = window.localStorage.getItem(STORAGE_KEY);

      if (savedState === "collapsed" || savedState === "expanded") {
        setState(savedState);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  function toggle() {
    setState((currentState) => {
      const nextState = currentState === "expanded" ? "collapsed" : "expanded";
      window.localStorage.setItem(STORAGE_KEY, nextState);
      return nextState;
    });
  }

  return {
    isCollapsed: isRail || state === "collapsed",
    persistentState: state,
    toggle,
  };
}
