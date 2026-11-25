"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { entryUrl, type EntryKind } from "@/domain/host-routing";
import { moveFocusByKey } from "@/lib/a11y/menu-keys";
import { SITE_URL } from "@/lib/seo/page-metadata";
import { useCurrentHostname } from "@/lib/ui/use-current-hostname";

const MENU_ITEM = '[role="menuitem"]';
const actionClass =
  "inline-flex min-h-11 items-center px-4 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

export function CourseShareLink({
  label,
  path,
  title,
  entry,
  copyLabel,
  accent = false,
  focusCopy = false,
  copyDescribedBy,
  compact = false,
}: {
  label: string;
  path: string;
  /** Course title: the text that travels with the URL when shared. */
  title: string;
  /**
   * Short host that publishes this link ("pay" for checkout). Only takes
   * effect in production, where the short hosts resolve; a preview or
   * localhost keeps the link relative so nobody is sent to production from a
   * test environment. Omitted: the canonical www URL, as before.
   */
  entry?: EntryKind;
  /**
   * Visible text of the copy button ("Copy my page link"). With it, the accessible
   * name is the text itself, not the generic aria-label.
   */
  copyLabel?: string;
  /** Brass: only on the milestone ("Published!" panel), at most 1 per screen. */
  accent?: boolean;
  /** Takes focus to the copy button on mount (publish milestone). */
  focusCopy?: boolean;
  copyDescribedBy?: string;
  /**
   * Only the copy button, without the box (a row in a price list). The whole
   * box, with Open and Share, lives in Promo links.
   */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const hostname = useCurrentHostname();
  const url = entry ? entryUrl(entry, path, "", hostname) : `${SITE_URL}${path}`;
  const [result, setResult] = useState<"copied" | "error" | null>(null);
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef<HTMLButtonElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const forLabel = (key: string) => t(key).replace("{label}", () => label);
  const outlineClass = accent ? "button-outline button-lg" : `button-outline ${actionClass}`;

  useEffect(() => {
    const active = document.activeElement;
    if (focusCopy && (!active || active === document.body)) {
      copyRef.current?.focus();
    }
  }, [focusCopy]);

  // "Copied" lives on the button itself for 2s and goes away: before, a new line came in
  // below that never left, and the box grew.
  useEffect(() => {
    if (result !== "copied") return;
    const timer = window.setTimeout(() => setResult(null), 2000);
    return () => window.clearTimeout(timer);
  }, [result]);

  // Same close rules as the product-list kebab (teacher-course-studio): Escape
  // closes and hands focus back, a press outside the button row closes.
  useEffect(() => {
    if (!open) {
      return;
    }

    // Once open, focus goes to the 1st destination and the arrows move between them.
    menuRef.current?.querySelector<HTMLElement>(MENU_ITEM)?.focus({ preventScroll: true });

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

  const copied = result === "copied";
  const CopyIcon = copied ? Check : Copy;
  const copyButton = (
    <button
      ref={copyRef}
      type="button"
      onClick={() => void copyLink()}
      // The name follows the text: for 2s the button says "Link copied." and the name
      // is that same text (a fixed aria-label of "Copy ..." would contradict the screen).
      aria-label={copyLabel || copied ? undefined : forLabel("creatorPanel.shareLink.copyAria")}
      aria-describedby={copyDescribedBy}
      // The milestone goes out at the flow size (48px, 15px/600), not the row's 12px.
      // Outside it, copy is a secondary action: outline, never the full blue.
      className={accent ? "button-accent button-lg" : `button-outline gap-1.5 ${actionClass}`}
    >
      <CopyIcon aria-hidden="true" size={14} />
      {copied ? t("creatorPanel.shareLink.copied") : (copyLabel ?? t("creatorPanel.shareLink.copy"))}
    </button>
  );
  // Announced once, with no extra visible line (the button already shows it).
  const feedback = (
    <>
      {copied ? <p role="status" className="sr-only">{t("creatorPanel.shareLink.copied")}</p> : null}
      {result === "error" ? <p role="alert" className="mt-2 text-sm text-[var(--color-danger-fg)]">{t("creatorPanel.shareLink.copyError")}</p> : null}
    </>
  );

  if (compact) {
    return (
      <div className="mt-2 min-w-0">
        {copyButton}
        {feedback}
        {/* Without the box, the "copy the link above" needs a link to copy. */}
        {result === "error" ? <p className="mt-1 break-all font-mono text-xs text-[var(--color-ink)]">{url}</p> : null}
      </div>
    );
  }

  return (
    <div className="mt-4 min-w-0 rounded-md border fine-rule bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">{label}</p>
      <p className="mt-1 break-all font-mono text-sm text-[var(--color-ink)]">{url}</p>
      {/* `relative` on the row, not on the Share button: the menu then hangs
          from the row's left edge and never runs past the card on a phone. */}
      <div
        ref={rowRef}
        // Tab out of the menu closes it (focus starts inside it).
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (open && next instanceof Node && !event.currentTarget.contains(next)) {
            setOpen(false);
          }
        }}
        className="relative mt-3 flex flex-wrap gap-2"
      >
        {copyButton}
        <a href={url} aria-label={forLabel("creatorPanel.shareLink.openAria")} className={outlineClass}>
          {t("creatorPanel.shareLink.open")}
        </a>
        <button
          ref={shareRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={forLabel("creatorPanel.shareLink.shareAria")}
          onClick={() => setOpen((current) => !current)}
          className={outlineClass}
        >
          {t("creatorPanel.shareLink.share")}
        </button>
        {open ? (
          <div
            ref={menuRef}
            role="menu"
            aria-label={forLabel("creatorPanel.shareLink.menuAria")}
            onKeyDown={(event) => moveFocusByKey(event, MENU_ITEM)}
            className="motion-drop-in absolute left-0 top-[calc(100%+8px)] z-40 w-48 rounded-lg border border-[var(--color-line)] bg-white p-1.5 shadow-[var(--shadow-strong)]"
          >
            {targets.map(({ key, href }) => (
              <a
                key={key}
                href={href}
                role="menuitem"
                target={href.startsWith("mailto:") ? undefined : "_blank"}
                rel="noopener noreferrer"
                // Picking a destination returns focus to Share, instead of
                // letting it fall on the body.
                onClick={() => {
                  setOpen(false);
                  shareRef.current?.focus();
                }}
                className="flex min-h-11 items-center rounded-md px-3 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
              >
                {t(`creatorPanel.shareLink.${key}`)}
              </a>
            ))}
          </div>
        ) : null}
      </div>
      {feedback}
    </div>
  );
}
