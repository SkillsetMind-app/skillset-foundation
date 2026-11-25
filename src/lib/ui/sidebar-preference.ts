"use client";

import { createContext, createElement, type ReactNode } from "react";

import type { SidebarPref } from "@/lib/ui/sidebar-cookie";

/** The choice read on the server; the hook (sidebar-state.ts) uses it on the 1st frame. */
export const SidebarPrefContext = createContext<SidebarPref>(null);

/**
 * Only the logged-in areas mount this (src/components/platform/sidebar-preference-layout.tsx),
 * never the root layout: the home page and the public pages carry nothing from the sidebar.
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
