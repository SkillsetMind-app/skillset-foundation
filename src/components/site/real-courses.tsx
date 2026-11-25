"use client";

import { createContext, useContext, type ReactNode } from "react";

// Is the storefront open (12 real courses published by 5 teachers)? The server
// decides (isMarketplaceOpen, read once in the root layout); the client
// islands that lead to the store — bar, hero, instructor storefronts, certificate
// verification — only read from here, fetching nothing in the browser. Without a provider the value is
// "no", the same answer as a failed read: the store stays hidden.
const RealCoursesContext = createContext(false);

export function RealCoursesProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <RealCoursesContext value={value}>{children}</RealCoursesContext>;
}

export function useHasRealCourses() {
  return useContext(RealCoursesContext);
}
