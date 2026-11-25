// Course cards while the list loads. One mold for the server fallback
// and for the client loading: before, there were 6 cards in one and 3 in the
// other, both without the price row, and the page jumped on every swap. Same
// classes as CourseTile (cover, body and footer with price), so the real
// card is born at the same height. No hook: it serves the server and the client.
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
