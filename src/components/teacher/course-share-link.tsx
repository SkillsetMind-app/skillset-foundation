"use client";

import { useState } from "react";
import { SITE_URL } from "@/lib/seo/page-metadata";

export function CourseShareLink({ label, path }: { label: string; path: string }) {
  const url = `${SITE_URL}${path}`;
  const [result, setResult] = useState<"copied" | "error" | null>(null);

  async function copyLink() {
    setResult(null);
    try {
      await navigator.clipboard.writeText(url);
      setResult("copied");
    } catch {
      setResult("error");
    }
  }

  return (
    <div className="mt-4 min-w-0 rounded-[10px] border fine-rule bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">{label}</p>
      <p className="mt-1 break-all font-mono text-sm text-[var(--color-ink)]">{url}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void copyLink()} aria-label={`Copy ${label} link`} className="button-solid min-h-11 px-4 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          Copy link
        </button>
        <a href={url} aria-label={`Open ${label}`} className="button-outline inline-flex min-h-11 items-center px-4 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          Open page
        </a>
      </div>
      {result === "copied" ? <p role="status" className="mt-2 text-sm text-[var(--color-ink-soft)]">Link copied.</p> : null}
      {result === "error" ? <p role="alert" className="mt-2 text-sm text-[var(--color-danger-fg)]">Could not copy. Copy the link above manually.</p> : null}
    </div>
  );
}
