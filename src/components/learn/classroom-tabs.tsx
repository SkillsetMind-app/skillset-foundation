"use client";

import { Award } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { classroomTabHref, type ClassroomTab } from "@/domain/classroom-tabs";
import { useTranslation } from "@/components/i18n/i18n-provider";

// A ultima aba aberta nesta visita. Cada aba e uma rota, entao a sala remonta
// a cada troca; o modulo continua carregado na navegacao do app e zera numa
// carga nova. No servidor nada grava aqui (efeito nao roda), entao a primeira
// pintura sai igual dos dois lados.
let lastClassroomTab: ClassroomTab | null = null;

/**
 * true quando a sala abriu por TROCA de aba, nao por carga da pagina: so ai o
 * painel entra com motion-panel-in. A carga entra parada, e o que vira LCP
 * (capa, titulo, video) nunca nasce com opacidade 0.
 */
export function useTabChanged(tab: ClassroomTab): boolean {
  const [changed] = useState(() => lastClassroomTab !== null && lastClassroomTab !== tab);
  useEffect(() => {
    lastClassroomTab = tab;
  }, [tab]);
  return changed;
}

export type ClassroomTabItem = {
  id: ClassroomTab;
  label: string;
  count?: number;
};

// A barra de abas da sala: Lesson · Materials · Lives · Community · Messages ·
// Review · About. Substitui a faixa "Lesson tools", cujos botoes so rolavam a
// pagina. Cada aba e um <Link> de verdade: entra no historico, tem endereco,
// pode ser compartilhada. A aula atual vai junto no endereco (?lesson=).
export function ClassroomTabs({
  basePath,
  active,
  lessonId,
  tabs,
  certificateHref,
}: {
  basePath: string;
  active: ClassroomTab;
  lessonId: string | null;
  tabs: ClassroomTabItem[];
  /** "Get certificate" morava na faixa de ferramentas; segue aqui, no fim da
   *  barra, quando o curso esta 100% (e fora do whitelabel). */
  certificateHref?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("creatorEditor.preview.sections")} className="member-classroom-tabs">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={classroomTabHref(basePath, tab.id, lessonId)}
          aria-current={tab.id === active ? "page" : undefined}
        >
          {tab.label}
          {tab.count ? (
            <span className="member-classroom-tabs__count">{tab.count}</span>
          ) : null}
        </Link>
      ))}
      {certificateHref ? (
        <Link href={certificateHref} className="member-classroom-tabs__action">
          <Award size={15} aria-hidden />
          {t("learn.classroom.workspace.certificate")}
        </Link>
      ) : null}
    </nav>
  );
}
