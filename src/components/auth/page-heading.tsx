"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";

// The big title of the entry screens (/auth, /onboarding) follows the screen
// mounted below it. Before, it was fixed: "Sign in as a learner."
// on top of the expired link, "Set up your SkillsetMind profile." on top of the
// teaching activation. The status screen notifies the page while mounted;
// the page swaps the text. Without a provider (standalone screen), nothing changes.
type PageHeading = { titleKey: string; descriptionKey?: string };

type PageHeadingState = {
  heading: PageHeading | null;
  setHeading: (heading: PageHeading | null) => void;
};

const PageHeadingContext = createContext<PageHeadingState | null>(null);

export function PageHeadingProvider({ children }: { children: ReactNode }) {
  const [heading, setHeading] = useState<PageHeading | null>(null);
  const value = useMemo(() => ({ heading, setHeading }), [heading]);
  return <PageHeadingContext.Provider value={value}>{children}</PageHeadingContext.Provider>;
}

// The title (or description) text: the mounted screen's, otherwise the page's
// default, which is also what goes out in the server HTML.
export function PageHeadingText({
  part,
  fallback,
}: {
  part: "title" | "description";
  fallback: ReactNode;
}) {
  const { t } = useTranslation();
  const heading = useContext(PageHeadingContext)?.heading;
  const key = part === "title" ? heading?.titleKey : heading?.descriptionKey;
  return <>{key ? t(key) : fallback}</>;
}

// The screen takes over the page title while mounted, before paint.
// Returns true only when the page ALREADY shows that title: until then (no provider,
// or in the server HTML, before JavaScript), the screen shows its own, and the
// state is never left without a title.
export function usePageHeading(heading: PageHeading | null): boolean {
  const context = useContext(PageHeadingContext);
  const setHeading = context?.setHeading;
  const titleKey = heading?.titleKey;
  const descriptionKey = heading?.descriptionKey;

  useLayoutEffect(() => {
    if (!setHeading || !titleKey) return;
    setHeading({ titleKey, descriptionKey });
    return () => setHeading(null);
  }, [setHeading, titleKey, descriptionKey]);

  const shown = context?.heading;
  return Boolean(titleKey)
    && shown?.titleKey === titleKey
    && shown?.descriptionKey === descriptionKey;
}
