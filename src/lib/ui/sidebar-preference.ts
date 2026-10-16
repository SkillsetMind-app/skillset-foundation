"use client";

import { createContext, createElement, type ReactNode } from "react";

import type { SidebarPref } from "@/lib/ui/sidebar-cookie";

/** A escolha lida no servidor; o hook (sidebar-state.ts) usa no 1º quadro. */
export const SidebarPrefContext = createContext<SidebarPref>(null);

/**
 * Só as áreas logadas montam isto (src/components/platform/sidebar-preference-layout.tsx),
 * nunca o layout raiz: a home e as páginas públicas não levam nada da barra.
 */
export function SidebarPreferenceProvider({
  value,
  children,
}: {
  value: SidebarPref;
  children: ReactNode;
}) {
  return createElement(SidebarPrefContext.Provider, { value }, children);
}
