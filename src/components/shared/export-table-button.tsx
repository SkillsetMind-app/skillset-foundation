"use client";

import { Download } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { cn } from "@/lib/cn";

type ExportCell = string | number | boolean | null | undefined;
type ExportRow = Record<string, ExportCell>;

type ExportTableButtonProps = {
  rows: ExportRow[];
  filename: string;
  className?: string;
  disabled?: boolean;
  /** Why the caller disabled it (e.g. the read failed); without this, only the case
   *  the button knows about, zero rows, gets a reason. */
  disabledReason?: string;
};

function normalizeFilename(filename: string, extension: "csv" | "json") {
  const safeName =
    filename
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "skillset-export";

  return `${safeName}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

function escapeCsvCell(value: ExportCell) {
  const text = value === null || typeof value === "undefined" ? "" : String(value);
  // A quoted tab keeps formula-like user text literal in spreadsheet exports.
  // Typed numbers stay numeric; the JSON export preserves exact source values.
  const csvText = typeof value === "string" && /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@＝＋－＠]/u.test(text)
    ? `\t${text}`
    : text;
  const escapedText = csvText.replace(/"/g, '""');

  return /[",;\t\n\r]/.test(csvText) ? `"${escapedText}"` : escapedText;
}

function rowsToCsv(rows: ExportRow[]) {
  const headers = Array.from(
    rows.reduce((keys, row) => {
      Object.keys(row).forEach((key) => keys.add(key));
      return keys;
    }, new Set<string>()),
  );

  return [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(",")),
  ].join("\n");
}

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function ExportTableButton({
  rows,
  filename,
  className,
  disabled = false,
  disabledReason,
}: ExportTableButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const isDisabled = disabled || rows.length === 0;
  // Zero rows only says "nothing to export" when the caller did not disable it: a
  // read that failed also arrives with zero rows, and then the reason is another one.
  const reason = disabled
    ? disabledReason
    : rows.length === 0
      ? t("platform.ops.exportButton.nothingToExport")
      : undefined;
  const isMenuOpen = open && !isDisabled;

  useLayoutEffect(() => {
    if (!isMenuOpen) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    // Same measured positioning as Tooltip: the portal escapes clipping
    // ancestors, and both sides stay limited to the visible viewport.
    function position() {
      const viewport = window.visualViewport;
      const width = viewport?.width ?? (document.documentElement.clientWidth || window.innerWidth);
      const height = viewport?.height ?? window.innerHeight;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
      const topEdge = (viewport?.offsetTop ?? 0) + 8;
      const rightEdge = leftEdge + width - 16;
      const bottomEdge = topEdge + height - 16;
      menu!.style.maxWidth = `${Math.max(1, width - 16)}px`;
      menu!.style.maxHeight = `${Math.max(1, height - 16)}px`;
      const anchor = trigger!.getBoundingClientRect();
      const bounds = menu!.getBoundingClientRect();
      const below = bottomEdge - anchor.bottom - 8;
      const above = anchor.top - topEdge - 8;
      const top = bounds.height > below && above > below
        ? anchor.top - bounds.height - 8
        : anchor.bottom + 8;
      menu!.style.left = `${Math.max(leftEdge, Math.min(anchor.right - bounds.width, rightEdge - bounds.width))}px`;
      menu!.style.top = `${Math.max(topEdge, Math.min(top, bottomEdge - bounds.height))}px`;
      menu!.style.visibility = "visible";
    }
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !trigger!.contains(event.target) && !menu!.contains(event.target)) setOpen(false);
    }
    function dismissKey(event: KeyboardEvent) {
      if (!(event.target instanceof Node) || (!trigger!.contains(event.target) && !menu!.contains(event.target))) return;
      if (event.key !== "Escape" && event.key !== "Tab") return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
      setOpen(false);
      // Tab follows its native course from the trigger, without trapping focus in the
      // portal at the end of the body. Escape consumes only this menu, like LocaleSwitcher.
      trigger!.focus({ preventScroll: true });
    }
    position();
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    observer?.observe(trigger);
    observer?.observe(menu);
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissKey, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissKey, true);
    };
  }, [isMenuOpen]);

  function moveFocus(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const options = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const current = options.indexOf(event.currentTarget);
    const jump: Record<string, number | undefined> = {
      ArrowDown: current + 1,
      ArrowUp: current - 1,
      Home: 0,
      End: options.length - 1,
    };
    const next = jump[event.key];
    if (next === undefined) return;
    event.preventDefault();
    options[(next + options.length) % options.length]?.focus();
  }

  function handleExport(format: "csv" | "json") {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });

    if (format === "csv") {
      downloadBlob(
        rowsToCsv(rows),
        normalizeFilename(filename, "csv"),
        "text/csv;charset=utf-8",
      );
      return;
    }

    downloadBlob(
      JSON.stringify(rows, null, 2),
      normalizeFilename(filename, "json"),
      "application/json;charset=utf-8",
    );
  }

  return (
    // `contents`: the button and the reason go straight into the caller's row. The
    // reason goes on a line of its own, below the row (basis-full,
    // order-last): next to the button, it showed up in the middle of the search and made the
    // Sales and Reports filters wrap to a new line. The menu is a portal
    // with fixed position: it needs no surrounding box.
    <div className={cn("contents", className)}>
      <button
        ref={triggerRef}
        id={`${menuId}-trigger`}
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={isDisabled}
        className="button-outline inline-flex items-center gap-2 px-3.5 py-2 text-xs"
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        aria-controls={isMenuOpen ? menuId : undefined}
        aria-describedby={reason ? `${menuId}-reason` : undefined}
      >
        <Download aria-hidden="true" size={14} strokeWidth={1.9} />
        {t("platform.ops.exportButton.export")}
      </button>
      {/* T-15: the reason for being disabled was only a title and screen reader, and on
          touch it did not show. Now it is a visible line, tied to the button. */}
      {reason ? (
        <span id={`${menuId}-reason`} className="order-last basis-full text-xs leading-5 text-[var(--color-ink-soft)] sm:text-right">
          {reason}
        </span>
      ) : null}

      {isMenuOpen ? createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={`${menuId}-trigger`}
          style={{ position: "fixed", visibility: "hidden" }}
          className="motion-drop-in z-[50] w-44 overflow-y-auto rounded-lg border border-[var(--color-line)] bg-white p-1.5 shadow-[var(--shadow-strong)]"
        >
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => handleExport("csv")}
            onKeyDown={moveFocus}
            className="w-full rounded-md px-3 py-2 text-left text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
          >
            {t("platform.ops.exportButton.csv")}
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => handleExport("json")}
            onKeyDown={moveFocus}
            className="w-full rounded-md px-3 py-2 text-left text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
          >
            {t("platform.ops.exportButton.json")}
          </button>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
