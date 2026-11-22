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

// O titulo grande das telas de entrada (/auth, /onboarding) segue a tela que
// esta montada embaixo dele. Antes ele ficava fixo: "Sign in as a learner."
// em cima do link vencido, "Set up your SkillsetMind profile." em cima da
// ativacao do ensino. A tela de estado avisa a pagina enquanto esta montada;
// a pagina troca o texto. Sem provedor (tela solta), nada muda.
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

// O texto do titulo (ou da descricao): o da tela montada, senao o padrao da
// pagina, que e tambem o que sai no HTML do servidor.
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

// A tela assume o titulo da pagina enquanto esta montada, antes da pintura.
// Devolve true so quando a pagina JA mostra esse titulo: ate la (sem provedor,
// ou no HTML do servidor, antes do JavaScript), a tela mostra o seu, e o
// estado nunca fica sem titulo.
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
