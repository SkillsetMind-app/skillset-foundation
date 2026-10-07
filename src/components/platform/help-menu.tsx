"use client";

import { LifeBuoy } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { useAdvisorAvailable } from "@/components/teacher/advisor-sidebar";
import { requestAdvisorOpen } from "@/lib/ui/floating-action";

// "Com quem eu falo?" O aluno tinha nove portas para pedir ajuda (comentario
// da aula, comunidade, mensagens, sino, /support escondido...) e nada dizia
// qual usar; o professor tinha seis. Este botao e o MESMO em todo lugar (barra
// lateral, menu do avatar, topo da sala de aula e do estudio) e abre tres
// escolhas escritas do jeito que a pessoa pensa no problema.

export type HelpSide = "student" | "teacher";

/** A sala de aula em que a pessoa esta, quando ha uma: a duvida sobre a aula
 *  vai para a comunidade DESTE curso (ou para a mensagem ao professor, se a
 *  comunidade estiver desligada). */
export type HelpCourse = { href: string; communityEnabled: boolean };

export type HelpChoice = {
  id: string;
  labelKey: string;
  hintKey: string;
  href?: string;
  /** Abre o Advisor do estudio em vez de navegar. */
  opensAdvisor?: boolean;
  /** Depois do assistente, o caminho para uma pessoa. */
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
      // A central de ajuda abre com o assistente no topo.
      href: "/help",
      personHref: "/support",
    },
  ];
}

type HelpMenuProps = {
  side: HelpSide;
  course?: HelpCourse | null;
  /** nav: item da barra lateral; menu: item do menu do avatar; bar: botao no topo. */
  variant: "nav" | "menu" | "bar";
  collapsed?: boolean;
  /** Controlado pela barra lateral (o rail recolhido pede para abrir a barra). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Chamado ao escolher: o menu do avatar fecha junto. */
  onNavigate?: () => void;
  className?: string;
};

const triggerClass = {
  nav: "platform-nav-link group relative flex h-11 min-h-11 w-full shrink-0 items-center gap-2.5 rounded-md border border-transparent px-2.5 py-1.5 text-sm font-semibold text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface-strong)] hover:text-[var(--color-ink)]",
  menu: "account-menu-item",
  bar: "help-menu-trigger",
};

const labelClass = {
  nav: "platform-sidebar-label min-w-0 truncate",
  menu: "min-w-0 flex-1 truncate",
  bar: "help-menu-trigger__label",
};

const choiceClass = {
  nav: "platform-nav-link help-menu-choice-link flex min-h-11 w-full items-center rounded-md border border-transparent px-2.5 py-2 text-sm text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-strong)] hover:text-[var(--color-ink)]",
  menu: "account-menu-item help-menu-choice-link",
  bar: "account-menu-item help-menu-choice-link",
};

export function HelpMenu({
  side,
  course = null,
  variant,
  collapsed = false,
  open: controlledOpen,
  onOpenChange,
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
  const focusOnOpen = useRef(false);
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

  // Ao abrir pelo botao, o foco vai para a primeira escolha: quem usa teclado
  // ou leitor de tela cai dentro das opcoes, nao perde o lugar.
  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    panelRef.current?.querySelector<HTMLElement>("a[href], button")?.focus();
  }, [open]);

  // So o botao do topo flutua por cima da pagina; clicar fora fecha. Na barra
  // e no menu do avatar a lista abre no lugar, como um grupo.
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
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        close({ restoreFocus: true });
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        aria-label={label}
        title={collapsed ? label : undefined}
        className={`${triggerClass[variant]}${collapsed ? " justify-center px-0" : ""}`}
        onClick={() => {
          focusOnOpen.current = !open;
          setOpen(!open);
        }}
      >
        {variant === "menu" ? (
          <span className="account-menu-icon">
            <LifeBuoy aria-hidden="true" size={14} strokeWidth={1.9} />
          </span>
        ) : variant === "nav" && !collapsed ? (
          <span className="platform-nav-icon-chip">
            <LifeBuoy aria-hidden="true" size={18} strokeWidth={2} />
          </span>
        ) : (
          <LifeBuoy aria-hidden="true" size={18} strokeWidth={1.9} className="shrink-0" />
        )}
        <span className={labelClass[variant]}>{label}</span>
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
              : variant === "nav"
                ? "platform-nav-section-items help-menu-inline motion-panel-in"
                : "help-menu-inline motion-panel-in"
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
