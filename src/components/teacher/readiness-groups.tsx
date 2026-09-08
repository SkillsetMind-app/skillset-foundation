"use client";

import type { ReactNode } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import {
  groupCourseReadiness,
  type CourseReadiness,
  type CourseReadinessItem,
} from "@/domain/course-readiness";
import { cn } from "@/lib/cn";

// A barra "N de M" somava titulo, capa e repasse do Stripe como se fossem a
// mesma coisa. A Hotmart separa em tres estados (conteudo salvo, pagina
// preparada, venda disponivel) e a pessoa enxerga onde esta travada. Aqui e so
// o agrupamento com titulo e contagem; cada tela continua desenhando o item
// do seu jeito (o construtor em caixa, o Manage em linha com o link de
// verificacao), por isso o item vem por render prop e nao por markup fixo.
export function ReadinessGroups({
  readiness,
  renderItem,
  className,
}: {
  readiness: Pick<CourseReadiness, "items">;
  renderItem: (item: CourseReadinessItem) => ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <div className={cn("grid-cols-1", className)}>
      {groupCourseReadiness(readiness).map((group) => (
        <section key={group.id} data-readiness-group={group.id}>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
            <span className={group.ready ? "text-[var(--color-primary)]" : "text-[var(--color-ink)]"}>
              {t(`creatorEditor.readiness.groups.${group.id}`)}
            </span>
            {" · "}
            {t("creatorEditor.readiness.groupCount")
              .replace("{done}", () => String(group.doneCount))
              .replace("{total}", () => String(group.total))}
          </p>
          <ul className="mt-3 grid grid-cols-1 gap-3">{group.items.map(renderItem)}</ul>
        </section>
      ))}
    </div>
  );
}
