"use client";

import { ChevronDown, LifeBuoy } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { useAdvisorAvailable } from "@/components/teacher/advisor-sidebar";
import { requestAdvisorOpen } from "@/lib/ui/floating-action";

// "Who do I talk to?" The learner had nine doors for asking for help (lesson comment,
// community, messages, bell, hidden /support...) and nothing said
// which one to use; the teacher had six. This button opens three choices written the
// way the person thinks about the problem. And it is ONE per screen: in the
// learner and teacher sidebar (on a phone, inside the drawer) and, in the classroom, which
// has no sidebar, at the top. The operations staff has no Help.

export type HelpSide = "student" | "teacher";

/** The classroom the person is in, when there is one: a question about the lesson
 *  goes to THIS course's community (or to the message to the teacher, if the
 *  community is turned off). */
export type HelpCourse = { href: string; communityEnabled: boolean };

export type HelpChoice = {
  id: string;
  labelKey: string;
  hintKey: string;
  href?: string;
  /** Opens the studio Advisor instead of navigating. */
  opensAdvisor?: boolean;
  /** After the assistant, the way to a person. */
  personHref?: string;
};

export function getHelpChoices(
  side: HelpSide,
  course: HelpCourse | null,
  advisorReady: boolean,
): HelpChoice[] {
  if (side === "teacher") {
    return [
      advisorReady
        ? { id: "howTo", labelKey: "helpMenu.teacher.howTo", hintKey: "helpMenu.teacher.howToAdvisor", opensAdvisor: true }
        : { id: "howTo", labelKey: "helpMenu.teacher.howTo", hintKey: "helpMenu.teacher.howToCenter", href: "/help" },
      { id: "students", labelKey: "helpMenu.teacher.students", hintKey: "helpMenu.teacher.studentsHint", href: "/teach/messages" },
      { id: "account", labelKey: "helpMenu.teacher.account", hintKey: "helpMenu.teacher.accountHint", href: "/support" },
    ];
  }

  const communityOn = course?.communityEnabled ?? true;
  return [
    {
      id: "lesson",
      labelKey: "helpMenu.student.lesson",
      hintKey: communityOn ? "helpMenu.student.lessonCommunity" : "helpMenu.student.lessonMessage",
      href: course ? `${course.href}/${communityOn ? "community" : "messages"}` : "/learn/community",
    },
    {
      id: "private",
      labelKey: "helpMenu.student.private",
      hintKey: "helpMenu.student.privateHint",
      href: course ? `${course.href}/messages` : "/learn/messages",
    },
    {
      id: "account",
      labelKey: "helpMenu.student.account",
      hintKey: "helpMenu.student.accountHint",
      // The help center opens with the assistant at the top.
      href: "/help",
      personHref: "/support",
    },
  ];
}

type HelpMenuProps = {
  side: HelpSide;
  course?: HelpCourse | null;
  /** nav: a sidebar item; bar: a button at the top of the classroom. */
  variant: "nav" | "bar";
  collapsed?: boolean;
  /** Controlled by the sidebar (the collapsed rail asks to open the sidebar). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Starts open and with focus inside: the collapsed rail opened the drawer
   *  straight to Help. */
  autoFocus?: boolean;
  /** Called on choosing. */
  onNavigate?: () => void;
  className?: string;
};

const triggerClass = {
  nav: "platform-nav-link group relative flex h-11 min-h-11 w-full shrink-0 items-center gap-2.5 rounded-md border border-transparent px-2.5 py-1.5 text-sm font-semibold text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface-strong)] hover:text-[var(--color-ink)]",
  bar: "help-menu-trigger",
};

const labelClass = {
  nav: "platform-sidebar-label min-w-0 truncate",
  bar: "help-menu-trigger__label",
};

// At rest, the page ink (as the phone drawer always showed on the
// links): the 12px hint of each choice (.help-menu-choice__hint, opacity 0.8)
// in ink-soft gave 4.02:1 on the white drawer. On the dark desktop sidebar the
// rule .platform-sidebar .platform-nav-link wins with !important.
const choiceClass = {
  nav: "platform-nav-link help-menu-choice-link flex min-h-11 w-full items-center rounded-md border border-transparent px-2.5 py-2 text-sm text-[var(--color-ink)] hover:bg-[var(--color-surface-strong)] hover:text-[var(--color-ink)]",
  bar: "account-menu-item help-menu-choice-link",
};

const choiceSelector = "a[href], button";

export function HelpMenu({
  side,
  course = null,
  variant,
  collapsed = false,
  open: controlledOpen,
  onOpenChange,
  autoFocus = false,
  onNavigate,
  className,
}: HelpMenuProps) {
  const { t } = useTranslation();
  const advisorReady = useAdvisorAvailable();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const panelId = useId();
  const titleId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef(autoFocus);
  const choices = getHelpChoices(side, course, advisorReady);
  const label = t("helpMenu.trigger");

  function setOpen(next: boolean) {
    if (controlledOpen === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  }

  function close({ restoreFocus }: { restoreFocus: boolean }) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }

  function choose() {
    close({ restoreFocus: false });
    onNavigate?.();
  }

  // When opening via the button, focus goes to the first choice: someone using a keyboard
  // or screen reader lands inside the options and does not lose their place. In the collapsed
  // sidebar the panel only exists after it opens, so the focus request
  // waits for the panel to appear (hence `collapsed` in the dependencies). In the drawer
  // (autoFocus), the drawer focuses itself right after this effect — parents run
  // last —, so the choice receives focus in a microtask, after it.
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    const focusFirst = () => panel.querySelector<HTMLElement>(choiceSelector)?.focus();
    if (autoFocus) queueMicrotask(focusFirst);
    else focusFirst();
  }, [open, collapsed, autoFocus]);

  // Arrow keys move between the choices (and from the button to the first or the last).
  function moveFocus(step: 1 | -1) {
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(choiceSelector) ?? []);
    if (!items.length) return false;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = at === -1
      ? (step === 1 ? 0 : items.length - 1)
      : (at + step + items.length) % items.length;
    items[next].focus();
    return true;
  }

  // Only the top button floats over the page; clicking outside or leaving it with
  // Tab closes it. In the sidebar the list opens in place, like the other groups.
  useEffect(() => {
    if (!open || variant !== "bar") return;
    function dismiss(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOwnOpen(false);
        onOpenChange?.(false);
      }
    }
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [open, variant, onOpenChange]);

  return (
    <div
      ref={wrapperRef}
      className={["help-menu", variant === "bar" ? "relative" : "", className ?? ""].filter(Boolean).join(" ")}
      onKeyDown={(event) => {
        if (!open) return;
        if (event.key === "Escape") {
          event.stopPropagation();
          close({ restoreFocus: true });
        } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && moveFocus(event.key === "ArrowDown" ? 1 : -1)) {
          event.preventDefault();
        }
      }}
      onBlur={(event) => {
        // Tab out of the floating panel: it closes, and focus goes to wherever the
        // person went. Focus going to "nowhere" (a click on text) does not close it.
        const next = event.relatedTarget;
        if (variant === "bar" && open && next instanceof Node && !event.currentTarget.contains(next)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        aria-label={label}
        className={`${triggerClass[variant]}${collapsed ? " justify-center px-0" : ""}`}
        onClick={() => {
          focusOnOpen.current = !open;
          setOpen(!open);
        }}
      >
        {variant === "nav" && !collapsed ? (
          <span className="platform-nav-icon-chip">
            <LifeBuoy aria-hidden="true" size={18} strokeWidth={2} />
          </span>
        ) : (
          <LifeBuoy aria-hidden="true" size={18} strokeWidth={1.9} className="shrink-0" />
        )}
        <span className={labelClass[variant]}>{label}</span>
        {/* In the sidebar, Help opens a list in place like Sales and Promote:
            without the little arrow it looked like a link. */}
        {variant === "nav" && !collapsed ? (
          <ChevronDown
            aria-hidden="true"
            size={15}
            strokeWidth={2}
            className={`platform-nav-section-chevron ${open ? "is-open" : ""}`}
          />
        ) : null}
      </button>

      {open && !collapsed ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          className={
            variant === "bar"
              ? "help-menu-popover motion-drop-in"
              : "platform-nav-section-items help-menu-inline motion-panel-in"
          }
        >
          <p id={titleId} className="help-menu-title">
            {t("helpMenu.title")}
          </p>
          <ul className="grid gap-0.5">
            {choices.map((choice) => {
              const body = (
                <span className="help-menu-choice">
                  <span className="help-menu-choice__label">{t(choice.labelKey)}</span>
                  <span className="help-menu-choice__hint">{t(choice.hintKey)}</span>
                </span>
              );

              return (
                <li key={choice.id} data-choice={choice.id}>
                  {choice.opensAdvisor ? (
                    <button
                      type="button"
                      className={choiceClass[variant]}
                      onClick={() => {
                        choose();
                        requestAdvisorOpen();
                      }}
                    >
                      {body}
                    </button>
                  ) : (
                    <Link href={choice.href ?? "/help"} className={choiceClass[variant]} onClick={choose}>
                      {body}
                    </Link>
                  )}
                  {choice.personHref ? (
                    <Link href={choice.personHref} className="help-menu-person" onClick={choose}>
                      {t("helpMenu.person")}
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
