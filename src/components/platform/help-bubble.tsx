"use client";

import { BookOpen, LifeBuoy, Mail, MessageCircleQuestion } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const helpItems = [
  { href: "/help", label: "Browse Help Center", icon: BookOpen },
  { href: "/support", label: "Open a support ticket", icon: LifeBuoy },
  { href: "mailto:support@skillset.app", label: "Email support", icon: Mail },
];

export function HelpBubble() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-20 right-4 z-40 sm:bottom-6 sm:right-6">
      {open ? (
        <div className="absolute bottom-[calc(100%+12px)] right-0 w-[280px] rounded-[4px] border border-[var(--color-line)] bg-white p-2 shadow-[var(--shadow-strong)]">
          <div className="px-3 py-3">
            <p className="text-sm font-bold text-[var(--color-primary)]">
              Need help?
            </p>
          </div>
          {helpItems.map((item) => {
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-[8px] px-3 py-3 text-sm font-semibold text-[var(--color-ink-soft)] transition hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-primary)]"
              >
                <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
                {item.label}
              </Link>
            );
          })}
          <p className="px-3 py-2 text-[11px] leading-5 text-[var(--color-ink-muted)]">
            We aim to reply within 24 hours.
          </p>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Open help menu"
        className="grid size-12 place-items-center rounded-full bg-[var(--color-primary)] text-white shadow-[0_12px_28px_rgba(26,54,93,0.20)] transition duration-[220ms] hover:scale-105 sm:size-14"
      >
        <MessageCircleQuestion aria-hidden="true" size={22} strokeWidth={1.8} />
      </button>
    </div>
  );
}
