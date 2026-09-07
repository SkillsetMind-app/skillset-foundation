"use client";

import { useEffect, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { SITE_URL } from "@/lib/seo/page-metadata";

const actionClass =
  "inline-flex min-h-11 items-center px-4 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

export function CourseShareLink({
  label,
  path,
  title,
}: {
  label: string;
  path: string;
  /** Course title: the text that travels with the URL when shared. */
  title: string;
}) {
  const { t } = useTranslation();
  const url = `${SITE_URL}${path}`;
  const [result, setResult] = useState<"copied" | "error" | null>(null);
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef<HTMLButtonElement>(null);
  const forLabel = (key: string) => t(key).replace("{label}", () => label);

  // Same close rules as the product-list kebab (teacher-course-studio): Escape
  // closes and hands focus back, a press outside the button row closes.
  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (rowRef.current && !rowRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        shareRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  async function copyLink() {
    setResult(null);
    try {
      await navigator.clipboard.writeText(url);
      setResult("copied");
    } catch {
      setResult("error");
    }
  }

  // The shared message is the course title plus the URL; each network takes it
  // in the shape its intent URL expects. mailto hands off to the mail app, so
  // it is the one target that does not open a new tab.
  const message = encodeURIComponent(`${title} ${url}`);
  const encodedTitle = encodeURIComponent(title);
  const encodedUrl = encodeURIComponent(url);
  const targets = [
    { key: "whatsapp", href: `https://wa.me/?text=${message}` },
    { key: "x", href: `https://x.com/intent/post?text=${encodedTitle}&url=${encodedUrl}` },
    { key: "linkedin", href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}` },
    { key: "email", href: `mailto:?subject=${encodedTitle}&body=${message}` },
  ];

  return (
    <div className="mt-4 min-w-0 rounded-[10px] border fine-rule bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">{label}</p>
      <p className="mt-1 break-all font-mono text-sm text-[var(--color-ink)]">{url}</p>
      {/* `relative` on the row, not on the Share button: the menu then hangs
          from the row's left edge and never runs past the card on a phone. */}
      <div ref={rowRef} className="relative mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void copyLink()} aria-label={forLabel("creatorPanel.shareLink.copyAria")} className={`button-solid ${actionClass}`}>
          {t("creatorPanel.shareLink.copy")}
        </button>
        <a href={url} aria-label={forLabel("creatorPanel.shareLink.openAria")} className={`button-outline ${actionClass}`}>
          {t("creatorPanel.shareLink.open")}
        </a>
        <button
          ref={shareRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={forLabel("creatorPanel.shareLink.shareAria")}
          onClick={() => setOpen((current) => !current)}
          className={`button-outline ${actionClass}`}
        >
          {t("creatorPanel.shareLink.share")}
        </button>
        {open ? (
          <div
            role="menu"
            aria-label={forLabel("creatorPanel.shareLink.menuAria")}
            className="absolute left-0 top-[calc(100%+8px)] z-40 w-48 rounded-[8px] border border-[var(--color-line)] bg-white p-1.5 shadow-[var(--shadow-strong)]"
          >
            {targets.map(({ key, href }) => (
              <a
                key={key}
                href={href}
                role="menuitem"
                target={href.startsWith("mailto:") ? undefined : "_blank"}
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="flex min-h-11 items-center rounded-[6px] px-3 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
              >
                {t(`creatorPanel.shareLink.${key}`)}
              </a>
            ))}
          </div>
        ) : null}
      </div>
      {result === "copied" ? <p role="status" className="mt-2 text-sm text-[var(--color-ink-soft)]">{t("creatorPanel.shareLink.copied")}</p> : null}
      {result === "error" ? <p role="alert" className="mt-2 text-sm text-[var(--color-danger-fg)]">{t("creatorPanel.shareLink.copyError")}</p> : null}
    </div>
  );
}
