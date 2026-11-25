"use client";

import { createContext, useContext } from "react";

/**
 * true while the terms dialog is on screen, or while it is still not
 * known whether it will appear (session loading, account profile not read). The
 * welcome tours wait for this: opened together with the dialog, both
 * trapped Tab and focus could stay on the tour, behind the dialog.
 *
 * Own file, outside auth-provider, on purpose: dozens of tests
 * replace the whole auth-provider with a mock, and a new export there would be missing
 * in all of them. Without a provider (tests, pages without AuthProvider) it is false.
 */
export const LegalGateContext = createContext(false);

export function useLegalGateWaiting() {
  return useContext(LegalGateContext);
}
