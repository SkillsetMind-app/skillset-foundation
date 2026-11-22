"use client";

import type { ReactNode } from "react";

/**
 * O unico seletor segmentado do Studio (uma entre poucas opcoes, um filtro, nao
 * abas de secao). A home usa 3M/6M/12M/All; a pagina de relatorios usa
 * 7d/30d/90d/12M/All; Membros troca espacos/comunidades. Na area do aluno:
 * cursos em andamento/concluidos, filtros de credenciais e o ciclo de cobranca
 * dos planos. Mesma marcacao, mesmo estado pressionado. Abas que trocam de
 * secao sao o HorizontalTabs.
 */
export function PeriodTabs<Option extends string>({
  options,
  value,
  onChange,
  label,
  renderLabel,
  wrap = false,
}: {
  options: readonly Option[];
  value: Option;
  onChange: (next: Option) => void;
  label: string;
  // ReactNode, nao so string: o ciclo de cobranca mostra o desconto do anual
  // num trecho menor dentro do proprio botao.
  renderLabel: (option: Option) => ReactNode;
  // Quebra a linha em vez de rolar por dentro (opcoes com numero, que na
  // tela estreita ficavam escondidas atras da rolagem). Padrao: uma linha.
  wrap?: boolean;
}) {
  return (
    <div className={wrap ? "studio-range-tabs studio-range-tabs--wrap" : "studio-range-tabs"} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={value === option ? "is-active" : undefined}
        >
          {renderLabel(option)}
        </button>
      ))}
    </div>
  );
}
