import type { ReactNode } from "react";

type CourseDetailSkeletonProps = {
  label: string;
  /** On the purchase page the card is the whole column: only it. */
  checkoutOnly?: boolean;
  /**
   * Cover, title and summary from the server: they are already the real content (the only
   * h1), so they stay out of the pulse and visible to the screen reader.
   */
  lead?: ReactNode;
};

// Skeleton of the sales page while the course loads, on the server (Suspense
// fallback) and on the client (before the course subscription answers). In its place
// there used to be a card with a second title "Loading course..." and a button that
// took the buyer off the page right at purchase time; when the data
// arrived, the card vanished and everything jumped. Here it is the same grid as the
// loaded page, with no title and no button: the screen reader hears only the notice.
// No hook and no "use client": it serves the server and the client alike.
export function CourseDetailSkeleton(props: CourseDetailSkeletonProps) {
  return renderCourseDetailSkeleton(props);
}

// The same tree as a plain function (not a component), so the client returns it
// straight from its own render. That way it has the same shape as the loaded page
// (grid > section > [back, lead, ...]) and React swaps the skeleton for the
// content without unmounting the `lead`: the cover does not flicker and the screen
// reader cursor does not go back to the start. Changed the order? Keep `lead` in the 2nd position
// of the section, as in creator-course-detail.tsx.
export function renderCourseDetailSkeleton({
  label,
  checkoutOnly = false,
  lead = null,
}: CourseDetailSkeletonProps) {
  const bar = "rounded-md bg-[var(--color-surface-strong)]";
  const buyCard = (
    // Same box, same heights as the purchase card: the price and the button
    // are born in the place they will occupy.
    <div
      aria-hidden="true"
      className="h-fit min-w-0 animate-pulse self-start rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)] sm:p-6"
    >
      <div className={`h-2.5 w-12 ${bar}`} />
      <div className={`mt-2 h-9 w-[150px] max-w-full ${bar}`} />
      <div className="mt-5 h-px bg-[var(--color-line)]" />
      <div className="mt-5 grid gap-4">
        <div className={`h-3.5 ${bar}`} />
        <div className={`h-3.5 ${bar}`} />
        <div className={`h-3.5 ${bar}`} />
      </div>
      <div className={`mt-6 h-12 ${bar}`} />
    </div>
  );

  return (
    <>
      <p role="status" className="sr-only">{label}</p>
      {checkoutOnly ? buyCard : (
        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="min-w-0">
            {/* The way back to the catalog, at the top of the column, as on the finished page. */}
            <div aria-hidden="true" className="mb-2 flex min-h-11 animate-pulse items-center">
              <div className={`h-3.5 w-36 ${bar}`} />
            </div>
            {lead}
            <div aria-hidden="true" className="animate-pulse">
              {/* Instructor signature, section menu and the first blocks. */}
              <div className="mt-5 flex min-h-11 items-center gap-2.5">
                <div className="size-8 shrink-0 rounded-full bg-[var(--color-surface-strong)]" />
                <div className={`h-3.5 w-36 ${bar}`} />
              </div>
              <div className="mt-6 flex gap-4 border-b border-[var(--color-line)] pb-4 pt-3">
                {[0, 1, 2, 3].map((index) => (
                  <div key={index} className={`h-3.5 w-16 ${bar}`} />
                ))}
              </div>
              <div className="mt-8 h-40 rounded-lg border border-[var(--color-line)] bg-white" />
              <div className="mt-8 h-40 rounded-lg border border-[var(--color-line)] bg-white" />
            </div>
          </section>
          {buyCard}
        </div>
      )}
    </>
  );
}
