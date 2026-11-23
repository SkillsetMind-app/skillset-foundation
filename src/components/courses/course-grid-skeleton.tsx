// Cartões de curso enquanto a lista carrega. Um molde só para o fallback do
// servidor e para o carregamento do cliente: antes eram 6 cartões num e 3 no
// outro, os dois sem a linha de preço, e a página pulava a cada troca. Mesmas
// classes do CourseTile (capa, corpo e rodapé com preço), então o cartão de
// verdade nasce na mesma altura. Sem hook: serve ao servidor e ao cliente.
export function CourseGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="marketplace-course-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="marketplace-card animate-pulse">
          <div className="marketplace-card__media bg-[var(--color-surface-strong)]" />
          <div className="marketplace-card__body gap-3">
            <div className="h-3 w-24 rounded bg-[var(--color-surface-strong)]" />
            <div className="h-6 w-3/4 rounded bg-[var(--color-surface-strong)]" />
            <div className="h-10 rounded bg-[var(--color-surface-soft)]" />
            <div className="marketplace-card__footer">
              <div className="h-4 w-16 rounded bg-[var(--color-surface-strong)]" />
              <div className="h-4 w-20 rounded bg-[var(--color-surface-soft)]" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
