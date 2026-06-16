"use client";

import { Download } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn";

type ExportCell = string | number | boolean | null | undefined;
type ExportRow = Record<string, ExportCell>;

type ExportTableButtonProps = {
  rows: ExportRow[];
  filename: string;
  className?: string;
  disabled?: boolean;
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
  const escapedText = text.replace(/"/g, '""');

  return /[",\n\r]/.test(escapedText) ? `"${escapedText}"` : escapedText;
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
}: ExportTableButtonProps) {
  const [open, setOpen] = useState(false);
  const isDisabled = disabled || rows.length === 0;

  function handleExport(format: "csv" | "json") {
    setOpen(false);

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
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={isDisabled}
        className="button-outline inline-flex items-center gap-2 px-3.5 py-2 text-xs disabled:opacity-50"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Download aria-hidden="true" size={14} strokeWidth={1.9} />
        Export
      </button>

      {open && !isDisabled ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-[50] w-44 rounded-[12px] border border-[var(--color-line)] bg-white p-1.5 shadow-[var(--shadow-strong)]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => handleExport("csv")}
            className="w-full rounded-[8px] px-3 py-2 text-left text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
          >
            Export as CSV
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => handleExport("json")}
            className="w-full rounded-[8px] px-3 py-2 text-left text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
          >
            Export as JSON
          </button>
        </div>
      ) : null}
    </div>
  );
}
