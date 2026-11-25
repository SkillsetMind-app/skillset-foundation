/**
 * Loading the builder (motion catalog, item 9): blocks the size
 * of what is coming — header, step rail and the tab panel — in place of a
 * loose line of text. The text is still there, for the screen reader. The pulse is
 * Tailwind's `animate-pulse`; "reduce motion" stops it in the global block.
 * No "use client": serves the Suspense fallback (server) and the builder.
 */
const block = "bg-[var(--color-surface-strong)]";

/**
 * The rows of the product list while loading. It lives here so the list and the
 * route fallback draw the same thing; before, it was a generic <div> with
 * aria-label (ignored by the screen reader) inside teacher-course-studio.
 */
export function ProductRowsSkeleton({ label }: { label?: string }) {
  // F-19: the whole row pulsed in surface-soft, with no corners; now it is the real
  // row (16:9 cover + title and category) in the app's skeleton style.
  const rows = (
    <div aria-hidden="true" className="grid animate-pulse gap-0">
      {[1, 2, 3].map((item) => (
        <div key={item} className="flex h-24 items-center gap-3 border-b border-[var(--color-line)] px-4">
          <div className={`aspect-video w-24 shrink-0 rounded-md ${block}`} />
          <div className="grid min-w-0 flex-1 gap-2">
            <div className={`h-4 w-1/2 max-w-xs rounded-sm ${block}`} />
            <div className={`h-3 w-1/3 max-w-40 rounded-sm ${block}`} />
          </div>
        </div>
      ))}
    </div>
  );
  return label ? (
    <div role="status">
      <span className="sr-only">{label}</span>
      {rows}
    </div>
  ) : rows;
}

/**
 * /teach/builder with no course is the LIST: the route fallback showed the editor
 * skeleton (header, five steps, form) and then swapped it for the list's
 * — two jumps before the table. This one has the shape of the list: header with
 * the button, the search and filters row, and the rows.
 */
export function ProductListSkeleton({ label }: { label: string }) {
  return (
    <section role="status" data-skeleton="list" className="grid gap-6">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-line)] pb-5">
        <div className="grid w-full max-w-xl animate-pulse gap-2">
          <div className={`h-3 w-24 rounded-sm ${block}`} />
          <div className={`h-8 w-64 max-w-full rounded-md ${block}`} />
          <div className={`h-4 w-full rounded-sm ${block}`} />
        </div>
        <div className={`h-11 w-36 animate-pulse rounded-md ${block}`} />
      </div>
      <div aria-hidden="true" className="grid animate-pulse gap-4">
        <div className={`h-5 w-48 rounded-sm ${block}`} />
        <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_minmax(150px,auto)_minmax(170px,auto)]">
          {[0, 1, 2].map((item) => (
            <div key={item} className={`h-11 rounded-md ${block}`} />
          ))}
        </div>
      </div>
      <ProductRowsSkeleton />
    </section>
  );
}

/**
 * A table while loading (Sales, Learners, product learners): the number
 * boxes when the screen has them, the search and filters row, the count line
 * and the rows at the height of a real row. Before it was "Loading your
 * sales..." in a card, and filters, count and rows all came in at once,
 * pushing everything down.
 */
export function TableSkeleton({
  label,
  tiles = 0,
  controls = 1,
  rows = 5,
}: {
  label: string;
  tiles?: number;
  controls?: number;
  rows?: number;
}) {
  return (
    <div role="status" data-skeleton="table" className="grid gap-4">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="grid animate-pulse gap-4">
        {tiles ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: tiles }, (_, item) => (
              <div key={item} className={`h-24 rounded-lg ${block}`} />
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <div className={`h-11 min-w-[12rem] flex-1 rounded-md ${block}`} />
          {Array.from({ length: controls - 1 }, (_, item) => (
            <div key={item} className={`h-11 w-36 rounded-md ${block}`} />
          ))}
        </div>
        <div className={`h-4 w-48 rounded-sm ${block}`} />
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
          {Array.from({ length: rows }, (_, item) => (
            <div key={item} className="flex h-14 items-center border-b border-[var(--color-line)] px-4 last:border-b-0">
              <div className={`h-4 w-full rounded-sm ${block}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A stack of cards while loading (Media, Events): cards
 * in the place and outline of the real ones, with the thumbnail when the screen has it.
 * Before it was a gray sentence in a card, and the list came in pushing the page.
 */
export function CardStackSkeleton({
  label,
  cards = 3,
  thumb = false,
}: {
  label: string;
  cards?: number;
  thumb?: boolean;
}) {
  return (
    <div role="status" data-skeleton="cards" className="grid gap-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: cards }, (_, item) => (
        <div
          key={item}
          aria-hidden="true"
          className="flex animate-pulse gap-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
        >
          {thumb ? <div className={`h-20 w-20 shrink-0 rounded-md ${block}`} /> : null}
          <div className="grid min-w-0 flex-1 content-start gap-2">
            <div className={`h-3 w-24 rounded-sm ${block}`} />
            <div className={`h-5 w-2/3 max-w-sm rounded-md ${block}`} />
            <div className={`h-4 w-1/2 max-w-xs rounded-sm ${block}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The detail of a sale while loading: the back link, the column of cards (amount,
 * customer, payment) and the course card beside it, in the same grid as the screen.
 */
export function SaleDetailSkeleton({ label }: { label: string }) {
  const card = "rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6";
  return (
    <div role="status" data-skeleton="detail" className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className={`h-11 w-24 animate-pulse rounded-md ${block} lg:col-span-2`} />
      <div aria-hidden="true" className="grid animate-pulse content-start gap-5">
        <div className={card}>
          <div className={`h-4 w-40 rounded-sm ${block}`} />
          <div className={`mt-4 h-9 w-36 rounded-md ${block}`} />
          <div className={`mt-4 h-3 w-full max-w-md rounded-sm ${block}`} />
        </div>
        {[0, 1].map((item) => (
          <div key={item} className={card}>
            <div className={`h-3 w-24 rounded-sm ${block}`} />
            <div className={`mt-4 h-20 rounded-md ${block}`} />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className={`${card} h-fit animate-pulse`}>
        <div className={`h-3 w-20 rounded-sm ${block}`} />
        <div className={`mt-3 h-6 w-3/4 rounded-md ${block}`} />
        <div className={`mt-5 h-9 w-40 rounded-md ${block}`} />
      </div>
    </div>
  );
}

/**
 * A card screen (Verification) while loading: the title and the card with text and
 * button. `header={false}` when the title is already on screen and only the card comes.
 */
export function CardPageSkeleton({ label, header = true }: { label: string; header?: boolean }) {
  return (
    <div role="status" data-skeleton="card" className="grid gap-6">
      <span className="sr-only">{label}</span>
      {header ? (
        <div aria-hidden="true" className="animate-pulse border-b border-[var(--color-line)] pb-5 pt-2">
          <div className={`h-9 w-72 max-w-full rounded-md ${block}`} />
        </div>
      ) : null}
      <div aria-hidden="true" className="animate-pulse rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
        <div className={`h-4 w-full max-w-xl rounded-sm ${block}`} />
        <div className={`mt-3 h-4 w-2/3 rounded-sm ${block}`} />
        <div className={`mt-6 h-11 w-48 rounded-md ${block}`} />
      </div>
    </div>
  );
}

/**
 * The place of the Stripe form (subscription, activation, payouts) while
 * it has not arrived: the box is born with the form's height and a skeleton
 * inside. Before it was "Preparing..." in a ~90px box that jumped to ~600px
 * when the iframe arrived, pushing the page. No aria-busy next to
 * role="status": some screen readers hold the announcement while it applies.
 */
export function StripeFrameSkeleton({ label }: { label: string }) {
  return (
    <div role="status" data-skeleton="stripe" className="min-h-[560px] p-6">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="grid animate-pulse gap-4">
        <div className={`h-4 w-32 rounded-sm ${block}`} />
        <div className={`h-11 rounded-md ${block}`} />
        <div className={`h-4 w-40 rounded-sm ${block}`} />
        <div className={`h-11 rounded-md ${block}`} />
        <div className="grid grid-cols-2 gap-3">
          <div className={`h-11 rounded-md ${block}`} />
          <div className={`h-11 rounded-md ${block}`} />
        </div>
        <div className={`mt-4 h-12 rounded-md ${block}`} />
      </div>
    </div>
  );
}

export function BuilderSkeleton({ label }: { label: string }) {
  return (
    <section role="status" data-skeleton="editor" className="grid gap-4">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="grid animate-pulse gap-4">
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
          <div className="flex flex-wrap gap-2">
            <div className={`h-7 w-20 rounded-chip ${block}`} />
            <div className={`h-7 w-28 rounded-chip ${block}`} />
          </div>
          <div className={`mt-6 h-8 w-2/3 max-w-md rounded-md ${block}`} />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[0, 1, 2, 3, 4].map((item) => (
            <div key={item} className={`h-14 rounded-md ${block}`} />
          ))}
        </div>
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
          <div className={`h-5 w-40 rounded-sm ${block}`} />
          <div className={`mt-3 h-4 w-full max-w-xl rounded-sm ${block}`} />
          <div className={`mt-6 h-11 w-full rounded-md ${block}`} />
          <div className={`mt-4 h-11 w-full rounded-md ${block}`} />
          <div className={`mt-4 h-28 w-full rounded-md ${block}`} />
        </div>
      </div>
    </section>
  );
}
