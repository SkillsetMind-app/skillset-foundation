"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";

export type HelpItem = { id?: string; q: string; a: string };
export type HelpCategory = {
  id: string;
  label: string;
  items: ReadonlyArray<HelpItem>;
};

type HelpCenterProps = {
  categories: ReadonlyArray<HelpCategory>;
};

/**
 * Client-side help center. The FAQ data is defined server-side and passed in,
 * so the initial SSR render (empty query) emits every article for SEO; the
 * search then filters in-place. This replaces the old disabled "coming soon"
 * search box — the control is now live rather than a dead placeholder.
 */
export function HelpCenter({ categories }: HelpCenterProps) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();

  const filteredCategories = useMemo(() => {
    if (!normalized) {
      return categories;
    }

    return categories
      .map((category) => ({
        ...category,
        items: category.items.filter((item) =>
          `${item.q} ${item.a}`.toLowerCase().includes(normalized),
        ),
      }))
      .filter((category) => category.items.length > 0);
  }, [categories, normalized]);

  const isSearching = normalized.length > 0;
  const hasResults = filteredCategories.length > 0;

  return (
    <>
      <div className="mt-8 flex w-full items-center gap-3 rounded-[12px] border fine-rule bg-white p-3 shadow-[var(--shadow-soft)]">
        <Search
          aria-hidden="true"
          size={16}
          strokeWidth={1.8}
          className="text-[var(--color-ink-muted)]"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search help articles"
          className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--color-ink-muted)]"
          aria-label="Search help"
        />
      </div>

      {/* Category jump nav only makes sense for the full list — when a search
          is active the anchors could point at filtered-out sections. */}
      {!isSearching ? (
        <nav aria-label="Help categories" className="mt-5 flex flex-wrap gap-2">
          {categories.map((category) => (
            <a
              key={category.id}
              href={`#${category.id}`}
              className="rounded-full border fine-rule bg-white px-3.5 py-1.5 text-xs font-semibold text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-primary)]"
            >
              {category.label}
            </a>
          ))}
        </nav>
      ) : null}

      {hasResults ? (
        <div className="mt-10 space-y-12">
          {filteredCategories.map((category) => (
            <section
              key={category.id}
              id={category.id}
              className="scroll-mt-28"
              aria-labelledby={`${category.id}-heading`}
            >
              <h2
                id={`${category.id}-heading`}
                className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]"
              >
                {category.label}
              </h2>
              <div className="mt-4 grid gap-4">
                {category.items.map((item) => (
                  <article
                    key={item.q}
                    id={item.id}
                    className={`rounded-[16px] border fine-rule bg-white p-5 shadow-[var(--shadow-soft)] ${item.id ? "scroll-mt-28" : ""}`}
                  >
                    <h3 className="text-lg font-bold text-[var(--color-ink)]">
                      {item.q}
                    </h3>
                    <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
                      {item.a}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="mt-10 rounded-[16px] border fine-rule bg-white p-8 text-center shadow-[var(--shadow-soft)]">
          <p className="text-sm font-semibold text-[var(--color-ink)]">
            No help articles match &ldquo;{query.trim()}&rdquo;.
          </p>
          <p className="mt-2 text-sm leading-7 text-[var(--color-ink-soft)]">
            Try a different keyword, or contact support below — a real person
            reads every message.
          </p>
        </div>
      )}
    </>
  );
}
