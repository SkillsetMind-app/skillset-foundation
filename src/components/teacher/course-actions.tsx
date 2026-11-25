"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { BusyLabel } from "@/components/ui/busy-label";
import { InlineAlert } from "@/components/ui/inline-alert";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import { moveFocusByKey } from "@/lib/a11y/menu-keys";
import { useModalFocus } from "@/lib/a11y/use-modal-focus";
import {
  deleteOrArchiveCourse,
  getCourseAudience,
  type DeleteOrArchiveOutcome,
} from "@/lib/data/teacher-courses";

// The two pieces that the product list and the course hub share. Before, each
// screen had (or did not have) its own: the ⋮ menu only existed in the list, the hub had
// no action at all, and deleting was a draft-only privilege. One action, in the
// same place as Hotmart, needs only one component.

// Menu width (w-56). Fixed on purpose: measuring the DOM after opening
// would cost a second render just to find a number that does not change.
const MENU_WIDTH_PX = 224;
// Minimum gap between the menu and the edge of the window.
const MENU_MARGIN_PX = 8;
const MENU_ITEM = '[role="menuitem"]';

/**
 * Shell of the actions menu: icon-only trigger, closes on Escape and on an outside click,
 * returns focus to the trigger. The ITEMS come from the caller — the list offers
 * edit/view as learner/delete, the hub offers new product/view as
 * learner/delete.
 */
export function CourseActionsMenu({
  courseTitle,
  icon: Icon,
  children,
}: {
  courseTitle: string;
  icon: ComponentType<{ "aria-hidden"?: boolean | "true"; size?: number; strokeWidth?: number }>;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // On phones and tablets the list becomes cards and the trigger sits against the
  // LEFT edge; a menu anchored to its right side was born with its left side
  // off screen (visual QA in production, Sep 8). On open, the menu is placed where it
  // fits: aligned to the right of the trigger when possible (desktop), otherwise pushed
  // into the window — from BOTH sides, because at 390 px with a long title
  // or in Spanish the trigger can land in the middle of the row (Codex review).
  const [menuLeftPx, setMenuLeftPx] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    // Menu open = focus on the 1st item; before, it stayed on the trigger and the arrows
    // had nowhere to act.
    menuRef.current?.querySelector<HTMLElement>(MENU_ITEM)?.focus({ preventScroll: true });

    function handlePointerDown(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={wrapperRef}
      // Tab out of the menu closes it: focus already starts inside it, and the open
      // menu used to stay on top of whatever received focus.
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (open && next instanceof Node && !event.currentTarget.contains(next)) {
          setOpen(false);
        }
      }}
      className="relative"
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("creatorPanel.products.actions.more").replace("{title}", () => courseTitle)}
        onClick={() => {
          const box = wrapperRef.current?.getBoundingClientRect();
          if (box) {
            const wanted = box.right - MENU_WIDTH_PX;
            const maxLeft = Math.max(
              MENU_MARGIN_PX,
              window.innerWidth - MENU_WIDTH_PX - MENU_MARGIN_PX,
            );
            setMenuLeftPx(Math.min(Math.max(wanted, MENU_MARGIN_PX), maxLeft) - box.left);
          }
          setOpen((current) => !current);
        }}
        className="grid min-h-11 min-w-11 place-items-center rounded-md border border-[var(--color-line-strong)] bg-white text-[var(--color-primary)] transition-colors hover:bg-[var(--color-surface-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
      >
        <Icon aria-hidden="true" size={19} strokeWidth={2} />
      </button>

      {open ? (
        // A click on ANY item closes the menu and returns focus to the trigger;
        // whoever opens a modal right after steals focus in the effect, after the
        // commit, so the order is still menu -> modal.
        <div
          ref={menuRef}
          role="menu"
          aria-label={t("creatorPanel.products.actions.menu").replace("{title}", () => courseTitle)}
          onKeyDown={(event) => moveFocusByKey(event, MENU_ITEM)}
          onClick={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }}
          style={menuLeftPx === null ? undefined : { left: menuLeftPx }}
          className={`motion-drop-in absolute top-[calc(100%+8px)] z-40 w-56 rounded-lg border border-[var(--color-line)] bg-white p-1.5 shadow-[var(--shadow-strong)] ${menuLeftPx === null ? "right-0" : ""}`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Confirmation for delete/archive. It asks the server how many buyers the
 * course has BEFORE showing the text, because the two answers are too different
 * to fit in a single sentence: with no buyer the course disappears; with a buyer
 * it leaves the storefront and whoever paid keeps access. The RPC is what
 * really decides the outcome — this component only needs not to lie about it.
 */
export function DeleteOrArchiveCourseDialog({
  courseId,
  courseTitle,
  onCancel,
  onDone,
}: {
  courseId: string;
  courseTitle: string;
  onCancel: () => void;
  onDone: (outcome: DeleteOrArchiveOutcome) => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [audience, setAudience] = useState<{ enrollments: number; orders: number; subscriptions: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // The count's "Try again": re-reads ONLY the count (getCourseAudience), never the delete.
  const [audienceAttempt, setAudienceAttempt] = useState(0);
  useModalFocus(dialogRef, true);

  useEffect(() => {
    let live = true;
    getCourseAudience(courseId)
      .then((next) => {
        if (live) setAudience(next);
      })
      .catch(() => {
        // Without the count the honest text cannot be chosen, and the modal must not
        // guess the most reassuring one: it closes and leaves the error on the caller's
        // screen, instead of promising archiving and deleting the course.
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [courseId, audienceAttempt]);

  // Back to the text's wait rows; the confirm button stays locked
  // (no count) until the count arrives, as on the first read.
  function retryAudience() {
    setFailed(false);
    setAudienceAttempt((attempt) => attempt + 1);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        onCancel();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel]);

  // The page behind does not scroll while the dialog is open. In the studio what
  // scrolls is .platform-content, not the body: locking the body held nothing.
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>(".platform-content") ?? document.body;
    const previousOverflow = scroller.style.overflow;
    scroller.style.overflow = "hidden";
    return () => {
      scroller.style.overflow = previousOverflow;
    };
  }, []);

  // A subscription is also a buyer: the server archives, so the text promises archiving.
  const hasAudience = audience !== null && audience.enrollments + audience.orders + audience.subscriptions > 0;
  const prefix = hasAudience ? "creatorPanel.products.archive" : "creatorPanel.products.delete";
  // Without the count, neither "delete" nor "archive": the modal opened in red
  // saying Delete and turned into blue Archive when the answer arrived.
  const known = audience !== null;

  async function handleConfirm() {
    setBusy(true);
    try {
      onDone(await deleteOrArchiveCourse(courseId));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="dialog-backdrop fixed inset-0 z-[70] grid place-items-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onCancel();
        }
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t("creatorPanel.products.delete.aria").replace("{title}", () => courseTitle)}
        className="dialog-panel modal-panel modal-panel-scroll relative outline-none"
      >
        {/* The X is the Cancel: it goes away while deleting or archiving, when
            Cancel is also locked. */}
        {busy ? null : (
          <button
            type="button"
            onClick={onCancel}
            aria-label={t("creatorPanel.products.delete.close")}
            className="button-icon absolute right-3 top-3"
          >
            <X aria-hidden="true" size={18} />
          </button>
        )}
        <div className="p-6">
        <p className={`pr-10 text-xs font-bold uppercase tracking-[0.2em] ${known ? "text-[var(--color-danger-fg)]" : "text-[var(--color-ink-muted)]"}`}>
          {known ? t(`${prefix}.eyebrow`) : t("creatorPanel.products.removeEyebrow")}
        </p>
        {/* Title in the design of the other dialogs (serif, 24px), as in
            ConfirmDialog; it was Manrope semibold only here and in 2FA. */}
        <h2 className="display-title mt-2 pr-10 text-2xl leading-tight text-[var(--color-primary)]">
          {known ? t(`${prefix}.title`).replace("{title}", () => courseTitle) : courseTitle}
        </h2>
        {/* Height of the longest text (the delete one, with the list and the files
            warning): the buttons do not jump when the count arrives. */}
        <div className="min-h-[27rem] sm:min-h-[21rem]">
        {known ? (
          <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t(`${prefix}.description`)}
          </p>
        ) : failed ? null : (
          <div aria-hidden="true" className="mt-4 grid gap-2 motion-safe:animate-pulse">
            <span className="h-3 w-full rounded bg-[var(--color-surface-strong)]" />
            <span className="h-3 w-11/12 rounded bg-[var(--color-surface-strong)]" />
            <span className="h-3 w-2/3 rounded bg-[var(--color-surface-strong)]" />
          </div>
        )}

        {hasAudience ? (
          // Hotmart's "Important": the sentence the teacher needs to read
          // before deciding cannot share weight with the rest of the text.
          // The warning icon now comes from InlineAlert itself (just one).
          <InlineAlert tone="warning" className="mt-4">
            {t("creatorPanel.products.archive.callout")}
          </InlineAlert>
        ) : audience !== null ? (
          // What goes away with it, said before the click: migration 20261008030000
          // deletes all of this, and the cleanup removes files and videos starting one
          // day later, hourly, in batches.
          <>
            <p className="mt-3 text-sm font-semibold text-[var(--color-ink)]">
              {t("creatorPanel.products.delete.consequences.lead")}
            </p>
            <ul className="mt-1 list-disc pl-5 text-sm leading-6 text-[var(--color-ink-soft)]">
              {(["content", "videos", "community", "events"] as const).map((item) => (
                <li key={item}>{t(`creatorPanel.products.delete.consequences.${item}`)}</li>
              ))}
            </ul>
            <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
              {t("creatorPanel.products.delete.filesNote")}
            </p>
          </>
        ) : null}

        {/* Without the count, confirm is locked: the failure can only be from the READ,
            and only it gets "Try again". The delete failure stays as it was. */}
        {failed && !known ? (
          <LoadErrorAlert className="mt-4" onRetry={retryAudience} focusRef={dialogRef}>
            {/* The count's own sentence: the delete one next to "Try again" made
                people think the button tried to delete again. */}
            {t("creatorPanel.products.audienceError")}
          </LoadErrorAlert>
        ) : failed ? (
          <InlineAlert tone="error" className="mt-4">
            {t("creatorPanel.products.deleteError")}
          </InlineAlert>
        ) : null}
        </div>
        </div>

        {/* The app's footer: a hairline on top and, below sm, it stacks with the
            action on top and Cancel below (before they sat side by side and
            wrapped loosely). From sm up it may wrap, as before. */}
        <div className="dialog-footer flex-wrap">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="button-outline px-4 text-sm"
          >
            {t("creatorPanel.products.delete.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={busy || !known}
            // Deleting is forever: solid red. Archiving can be undone: blue.
            // Before the count, a neutral outline: neither one nor the other.
            className={`${!known ? "button-outline" : hasAudience ? "button-solid" : "button-danger button-danger-solid"} px-4 text-sm`}
          >
            <BusyLabel
              busy={(known || failed) && busy}
              idle={!known && !failed ? t("creatorPanel.products.removeChecking") : t(`${prefix}.confirm`)}
              busyText={t(`${prefix}.busy`)}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
