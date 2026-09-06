"use client";

import { ChevronDown, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { getAuthRoute } from "@/lib/auth/routing";

export function PublicEntryMenu({ mobile = false }: { mobile?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function dismissOutside(event: MouseEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener("mousedown", dismissOutside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("mousedown", dismissOutside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  return (
    <div ref={wrapper} className="relative min-w-0">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={mobile ? "button-outline flex min-h-11 w-full items-center justify-center gap-2 px-4 py-2.5 text-sm" : "btn-signin flex min-h-11 items-center gap-2"}
      >
        {t("nav.signIn")}
        <ChevronDown aria-hidden size={14} />
      </button>
      {open ? (
        <div
          id={panelId}
          className={`${mobile ? "mt-2 w-full" : "absolute right-0 top-full z-[60] mt-2 w-64 max-w-[calc(100vw-2rem)]"} grid gap-1 rounded-[14px] border border-[var(--color-line)] bg-white p-2 shadow-[var(--shadow-soft)]`}
        >
          {([
            ["student", "nav.myCourses"],
            ["teacher", "nav.manageBusiness"],
          ] as const).map(([intent, label]) => (
            <Link
              key={intent}
              href={getAuthRoute("signin", intent)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 items-center justify-between gap-3 rounded-[10px] px-3 py-3 text-sm font-semibold text-[var(--color-primary)] hover:bg-[var(--color-surface-soft)] focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <span>{t(label)} <span className="sr-only">{t("account.opensNewTab")}</span></span>
              <ExternalLink aria-hidden size={14} className="shrink-0" />
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
