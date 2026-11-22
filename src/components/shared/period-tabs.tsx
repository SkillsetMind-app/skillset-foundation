"use client";

/**
 * O unico seletor segmentado do Studio (uma entre poucas opcoes, um filtro, nao
 * abas de secao). A home usa 3M/6M/12M/All; a pagina de relatorios usa
 * 7d/30d/90d/12M/All; Membros troca espacos/comunidades. Mesma marcacao, mesmo
 * estado pressionado. Abas que trocam de secao sao o HorizontalTabs.
 */
export function PeriodTabs<Option extends string>({
  options,
  value,
  onChange,
  label,
  renderLabel,
}: {
  options: readonly Option[];
  value: Option;
  onChange: (next: Option) => void;
  label: string;
  renderLabel: (option: Option) => string;
}) {
  return (
    <div className="studio-range-tabs" role="group" aria-label={label}>
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
