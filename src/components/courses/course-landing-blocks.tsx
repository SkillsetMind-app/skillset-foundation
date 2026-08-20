/**
 * Renders a teacher's sales page.
 *
 * A pure renderer: it fetches nothing, decides nothing about pricing, and holds
 * no state. Blocks arrive already normalised by `normalizeCourseLandingBlocks`,
 * which is where every cap and every URL check lives.
 *
 * `dangerouslySetInnerHTML` MUST NOT appear in this file. There is no HTML
 * sanitiser in the repository, so text is rendered as text — `whitespace-pre-line`
 * preserves the paragraph breaks a teacher typed without letting markup through.
 *
 * The CTA takes an `onEnrol` callback instead of a URL. The button always drives
 * the course's real checkout, computed by the page from `resolveCoursePrice` and
 * live offers. A block that carried its own link would let a teacher route the
 * sale off-platform, and a block that re-derived the price from the course row
 * would ignore offers and coupons and quote the buyer a number that is not what
 * they will be charged.
 */

import type { CourseLandingBlock, CourseLandingTemplate } from "@/domain/course-landing";

type TemplateStyle = {
  section: string;
  heading: string;
  body: string;
  heroWrap: string;
  heroHeading: string;
  card: string;
};

/**
 * Two templates, and they differ in weight rather than in structure. The same
 * blocks in the same order read as two different pages — which is what a teacher
 * choosing a "model" actually wants — without doubling the surface that can
 * break.
 */
const templates: Record<CourseLandingTemplate, TemplateStyle> = {
  classic: {
    section: "mt-12 first:mt-0",
    heading: "display-title text-2xl text-[var(--color-primary)]",
    body: "mt-3 whitespace-pre-line text-base leading-8 text-[var(--color-ink-soft)]",
    heroWrap:
      "overflow-hidden rounded-[18px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-6 py-10 sm:px-10 sm:py-14",
    heroHeading:
      "display-title text-3xl leading-tight text-[var(--color-primary)] sm:text-4xl",
    card: "rounded-[14px] border border-[var(--color-line)] bg-white p-5",
  },
  bold: {
    section: "mt-16 first:mt-0",
    heading:
      "display-title text-3xl uppercase tracking-tight text-[var(--color-primary)]",
    body: "mt-4 whitespace-pre-line text-lg leading-9 text-[var(--color-ink)]",
    heroWrap:
      "overflow-hidden rounded-[22px] bg-[var(--color-primary)] px-6 py-14 text-white sm:px-12 sm:py-20",
    heroHeading:
      "display-title text-4xl leading-[1.05] text-white sm:text-6xl",
    card: "rounded-[18px] border-2 border-[var(--color-primary)] bg-white p-6",
  },
};

function Hero({
  block,
  style,
}: {
  block: Extract<CourseLandingBlock, { kind: "hero" }>;
  style: TemplateStyle;
}) {
  return (
    <section className={`${style.section} relative`}>
      <div className={`${style.heroWrap} relative`}>
        {block.imageUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={block.imageUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
            <span
              className="absolute inset-0 bg-[rgba(10,24,43,0.62)]"
              aria-hidden="true"
            />
          </>
        ) : null}
        <div className="relative">
          <h1 className={block.imageUrl ? `${style.heroHeading} text-white` : style.heroHeading}>
            {block.heading}
          </h1>
          {block.subheading ? (
            <p
              className={`mt-4 max-w-2xl text-lg leading-8 ${
                block.imageUrl ? "text-white/80" : "text-[var(--color-ink-soft)]"
              }`}
            >
              {block.subheading}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Prose({
  heading,
  body,
  imageUrl,
  style,
}: {
  heading: string;
  body: string;
  imageUrl?: string | null;
  style: TemplateStyle;
}) {
  return (
    <section className={style.section}>
      {heading ? <h2 className={style.heading}>{heading}</h2> : null}
      <div className={imageUrl ? "mt-4 grid gap-6 sm:grid-cols-[180px_1fr]" : ""}>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            className="h-44 w-44 rounded-[14px] object-cover"
          />
        ) : null}
        {body ? <p className={style.body}>{body}</p> : null}
      </div>
    </section>
  );
}

export function CourseLandingBlocks({
  blocks,
  template,
  priceLabel,
  onEnrol,
}: {
  blocks: ReadonlyArray<CourseLandingBlock>;
  template: CourseLandingTemplate;
  /** Already resolved by the page from offers + coupons. Never recomputed here. */
  priceLabel?: string;
  onEnrol?: () => void;
}) {
  // Renders nothing at all when there is no page, so a course without one keeps
  // exactly the layout it has today.
  if (blocks.length === 0) return null;

  const style = templates[template] ?? templates.classic;

  return (
    <div className="mt-10">
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;

        switch (block.kind) {
          case "hero":
            return <Hero key={key} block={block} style={style} />;

          case "about":
            return (
              <Prose
                key={key}
                heading={block.heading}
                body={block.body}
                imageUrl={block.imageUrl}
                style={style}
              />
            );

          case "method":
            return (
              <Prose key={key} heading={block.heading} body={block.body} style={style} />
            );

          case "steps":
            return (
              <section key={key} className={style.section}>
                {block.heading ? <h2 className={style.heading}>{block.heading}</h2> : null}
                {/* An ordered list because the order is the information — this is
                    the one place a numbered marker is not decoration. */}
                <ol className="mt-5 grid gap-4">
                  {block.steps.map((step, stepIndex) => (
                    <li key={stepIndex} className={`${style.card} flex gap-4`}>
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--color-primary)] text-sm font-bold text-white">
                        {stepIndex + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-semibold text-[var(--color-ink)]">
                          {step.title}
                        </span>
                        {step.body ? (
                          <span className="mt-1 block whitespace-pre-line text-sm leading-7 text-[var(--color-ink-soft)]">
                            {step.body}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            );

          case "testimonials":
            return (
              <section key={key} className={style.section}>
                {block.heading ? <h2 className={style.heading}>{block.heading}</h2> : null}
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  {block.quotes.map((quote, quoteIndex) => (
                    <figure key={quoteIndex} className={style.card}>
                      <blockquote className="whitespace-pre-line text-base leading-8 text-[var(--color-ink)]">
                        {quote.quote}
                      </blockquote>
                      {quote.author ? (
                        <figcaption className="mt-3 text-sm font-semibold text-[var(--color-ink-soft)]">
                          {quote.author}
                        </figcaption>
                      ) : null}
                    </figure>
                  ))}
                </div>
              </section>
            );

          case "faq":
            return (
              <section key={key} className={style.section}>
                {block.heading ? <h2 className={style.heading}>{block.heading}</h2> : null}
                <div className="mt-5 grid gap-3">
                  {block.items.map((item, itemIndex) => (
                    <details key={itemIndex} className={style.card}>
                      <summary className="cursor-pointer font-semibold text-[var(--color-ink)]">
                        {item.question}
                      </summary>
                      {item.answer ? (
                        <p className="mt-3 whitespace-pre-line text-sm leading-7 text-[var(--color-ink-soft)]">
                          {item.answer}
                        </p>
                      ) : null}
                    </details>
                  ))}
                </div>
              </section>
            );

          case "cta":
            return (
              <section key={key} className={style.section}>
                <div className={`${style.card} text-center`}>
                  <h2 className={style.heading}>{block.heading}</h2>
                  {block.body ? <p className={style.body}>{block.body}</p> : null}
                  {priceLabel ? (
                    <p className="mt-4 text-lg font-bold text-[var(--color-primary)]">
                      {priceLabel}
                    </p>
                  ) : null}
                  {onEnrol ? (
                    <button
                      type="button"
                      onClick={onEnrol}
                      className="mt-5 inline-flex items-center rounded-[12px] bg-[var(--color-primary)] px-6 py-3 text-sm font-bold text-white"
                    >
                      {block.buttonLabel}
                    </button>
                  ) : null}
                </div>
              </section>
            );
        }
      })}
    </div>
  );
}
