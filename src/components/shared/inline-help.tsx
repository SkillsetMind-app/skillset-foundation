"use client";

import { CircleHelp, X } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import {
  announceFloatingAction,
  onFloatingActionOpened,
} from "@/lib/ui/floating-action";

const CONTEXT_HELP_OPENED = "skillsetmind:context-help-opened";

type InlineHelpProps = {
  topic: string;
  children: ReactNode;
  href: string;
  className?: string;
};

export function InlineHelp({ topic, children, href, className }: InlineHelpProps) {
  const [open, setOpen] = useState(false);
  const instanceId = useId();
  const dialogId = `${instanceId}-dialog`;
  const titleId = `${instanceId}-title`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeHelp = useCallback(() => {
    if (!open) {
      return;
    }

    const dialog = dialogRef.current;
    if (dialog?.open) {
      dialog.close();
      return;
    }

    setOpen(false);
    triggerRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
    }
  }, [open]);

  useEffect(() => {
    function closeWhenAnotherHelpOpens(event: Event) {
      if ((event as CustomEvent<string>).detail !== instanceId) {
        closeHelp();
      }
    }

    window.addEventListener(CONTEXT_HELP_OPENED, closeWhenAnotherHelpOpens);
    return () =>
      window.removeEventListener(CONTEXT_HELP_OPENED, closeWhenAnotherHelpOpens);
  }, [closeHelp, instanceId]);

  useEffect(
    () =>
      onFloatingActionOpened((action) => {
        if (action !== "help") {
          closeHelp();
        }
      }),
    [closeHelp],
  );

  function openHelp() {
    announceFloatingAction("help");
    window.dispatchEvent(
      new CustomEvent<string>(CONTEXT_HELP_OPENED, { detail: instanceId }),
    );
    setOpen(true);
  }

  function closeFromBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    if (
      event.clientX < bounds.left
      || event.clientX > bounds.right
      || event.clientY < bounds.top
      || event.clientY > bounds.bottom
    ) {
      closeHelp();
    }
  }

  return (
    <span className={cn("inline-flex shrink-0 align-middle", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Help about ${topic}`}
        aria-haspopup="dialog"
        aria-controls={dialogId}
        aria-expanded={open}
        onClick={openHelp}
        className="grid size-6 place-items-center rounded-full text-[var(--color-primary)] transition-colors hover:bg-[var(--color-surface-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-light)]"
      >
        <CircleHelp aria-hidden="true" size={16} strokeWidth={1.9} />
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <dialog
              id={dialogId}
              ref={dialogRef}
              aria-labelledby={titleId}
              aria-modal="true"
              onClick={closeFromBackdrop}
              onClose={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className="contextual-help-dialog"
            >
              <section className="contextual-help-panel">
                <header className="flex items-start justify-between gap-4 border-b border-[var(--color-line)] px-5 py-5 sm:px-6">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
                      Contextual help
                    </p>
                    <h2
                      id={titleId}
                      className="mt-2 text-lg font-semibold text-[var(--color-primary)]"
                    >
                      {topic}
                    </h2>
                  </div>
                  <button
                    type="button"
                    autoFocus
                    onClick={closeHelp}
                    aria-label="Close contextual help"
                    className="grid size-9 shrink-0 place-items-center rounded-full text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-light)]"
                  >
                    <X aria-hidden="true" size={18} strokeWidth={1.9} />
                  </button>
                </header>
                <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-6">
                  <div className="text-sm leading-7 text-[var(--color-ink-soft)]">
                    {children}
                  </div>
                </div>
                <footer className="border-t border-[var(--color-line)] px-5 py-4 sm:px-6">
                  <Link
                    href={href}
                    onClick={closeHelp}
                    className="text-sm font-semibold text-[var(--color-primary)] underline underline-offset-4"
                  >
                    Open related help
                  </Link>
                </footer>
              </section>
            </dialog>,
            document.body,
          )
        : null}
    </span>
  );
}
