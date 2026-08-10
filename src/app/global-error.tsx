"use client";

import { useEffect } from "react";

import { captureException } from "@/lib/posthog/client";

// global-error.tsx replaces the root layout when an error escapes it, so global
// CSS and design tokens are NOT available here — styles must be inline. That
// also means data-theme is never set, so the crash page can't read the user's
// stored theme; it falls back to the OS preference via this self-contained
// block. Values mirror the platform palette (:root / [data-theme="dark"] in
// globals.css) so a crash still looks like the product.
const CRASH_THEME_CSS = `
:root {
  color-scheme: light;
  --ge-bg: #fafaf9;
  --ge-ink: #1c1917;
  --ge-muted: #57534e;
  --ge-line: #d6d3d1;
  --ge-danger: #b22234;
  --ge-on-danger: #ffffff;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --ge-bg: #0a0f1a;
    --ge-ink: #e8edf5;
    --ge-muted: #a4b3c8;
    --ge-line: rgba(255, 255, 255, 0.34);
    --ge-danger: #e8808c;
    --ge-on-danger: #0a0f1a;
  }
}
`;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error, { boundary: "global", digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          background: "var(--ge-bg)",
          color: "var(--ge-ink)",
        }}
      >
        <style>{CRASH_THEME_CSS}</style>
        <div style={{ maxWidth: 560, textAlign: "center" }}>
          <p
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              color: "var(--ge-danger)",
              margin: 0,
            }}
          >
            Something went wrong
          </p>
          <h1 style={{ marginTop: 16, fontSize: 32, fontWeight: 700, lineHeight: 1.2 }}>
            The app hit an unexpected error.
          </h1>
          <p style={{ marginTop: 16, fontSize: 14, lineHeight: 1.7, color: "var(--ge-muted)" }}>
            The issue has been logged. Try reloading, or head back to the homepage.
          </p>
          <div
            style={{
              marginTop: 32,
              display: "flex",
              gap: 12,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                padding: "10px 18px",
                fontSize: 14,
                fontWeight: 600,
                borderRadius: 10,
                border: "none",
                background: "var(--ge-danger)",
                color: "var(--ge-on-danger)",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- global-error renders outside the App Router provider tree; a plain <a> does a full reload that reliably recovers from a corrupted root, where next/link's client router may be unavailable. */}
            <a
              href="/"
              style={{
                padding: "10px 18px",
                fontSize: 14,
                fontWeight: 600,
                borderRadius: 10,
                border: "1px solid var(--ge-line)",
                color: "var(--ge-ink)",
                textDecoration: "none",
              }}
            >
              Go home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
