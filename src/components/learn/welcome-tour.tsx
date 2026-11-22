"use client";

import { Award, GraduationCap, LifeBuoy, PlayCircle, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { useModalFocus } from "@/lib/a11y/use-modal-focus";
import { useWelcomeTour } from "@/lib/ui/use-welcome-tour";

type TourStep = {
  icon: LucideIcon;
  title: string;
  body: string;
};

function buildSteps(
  firstName: string,
  t: (key: string) => string,
): TourStep[] {
  // Every locale's welcomeNamed ends with ", {name}", so a nameless user just
  // gets the greeting with that suffix stripped instead of "Welcome, ".
  const welcomeTitle = firstName
    ? t("learn.tour.welcomeNamed").replace("{name}", () => firstName)
    : t("learn.tour.welcomeNamed").replace(", {name}", "");

  return [
    {
      icon: GraduationCap,
      title: welcomeTitle,
      body: t("learn.tour.step1Body"),
    },
    {
      icon: PlayCircle,
      title: t("learn.tour.step2Title"),
      body: t("learn.tour.step2Body"),
    },
    {
      icon: Award,
      title: t("learn.tour.step3Title"),
      body: t("learn.tour.step3Body"),
    },
    {
      icon: LifeBuoy,
      title: t("learn.tour.step4Title"),
      body: t("learn.tour.step4Body"),
    },
  ];
}

export function WelcomeTour({ userId, firstName }: { userId: string; firstName: string }) {
  const { t } = useTranslation();
  const { open, dismiss } = useWelcomeTour(userId, "student");
  const [stepIndex, setStepIndex] = useState(0);
  // true depois da primeira troca de passo. Na abertura a própria janela já
  // entra com motion-panel-in (.modal-panel); o texto subir junto dava a
  // mesma animação duas vezes.
  const [stepChanged, setStepChanged] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const steps = buildSteps(firstName, t);

  useModalFocus(dialogRef, open);

  function goToStep(next: number) {
    setStepChanged(true);
    setStepIndex(Math.max(0, Math.min(steps.length - 1, next)));
  }

  // Trocou de passo: o foco vai para o título novo. Sem isso, voltar ao passo
  // 1 tirava o "Back" da tela com o foco nele, e o foco caía no corpo da
  // página, atrás da janela. Na abertura quem foca é o useModalFocus.
  useEffect(() => {
    if (stepChanged) titleRef.current?.focus();
  }, [stepIndex, stepChanged]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        dismiss();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  if (!open) {
    return null;
  }

  const step = steps[stepIndex];
  const Icon = step.icon;
  const isLast = stepIndex === steps.length - 1;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(15,31,58,0.45)] p-4"
      role="presentation"
      onMouseDown={dismiss}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-tour-title"
        className="modal-panel modal-panel-scroll w-full max-w-md overflow-hidden rounded-xl border border-[var(--color-line)] bg-white shadow-[0_24px_60px_rgba(15,31,58,0.28)] outline-none"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* Um controle de pular só, o "Skip" do rodapé (e o Esc). O X do
            topo ("Skip the tour") fazia a mesma coisa. */}
        <div className="px-6 pt-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
        </div>

        {/* Os quatro passos empilhados na mesma célula da grade: a caixa tem
            a altura do passo mais longo, então trocar de passo não muda a
            altura da janela nem tira os botões de baixo do mouse. Só o passo
            atual aparece (e existe para o leitor de tela); a partir da
            primeira troca ele entra subindo 8px (motion-panel-in, só com
            movimento liberado). */}
        <div className="grid px-6 pb-2 pt-4">
          {steps.map((item, index) => {
            const current = index === stepIndex;
            return (
              <div
                key={item.title}
                aria-hidden={current ? undefined : true}
                className={`[grid-area:1/1] ${current ? (stepChanged ? "motion-panel-in" : "") : "invisible"}`}
              >
                <h2
                  id={current ? "welcome-tour-title" : undefined}
                  ref={current ? titleRef : undefined}
                  tabIndex={current ? -1 : undefined}
                  className="display-title text-3xl leading-tight text-[var(--color-primary)] outline-none"
                >
                  {item.title}
                </h2>
                <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">{item.body}</p>
              </div>
            );
          })}
        </div>

        {/* Traços de largura fixa: só a cor do atual muda. Antes o ativo
            crescia de 6 para 24px (transition-all, refazia o layout). */}
        <div className="flex items-center gap-2 px-6 py-3" aria-hidden="true">
          {steps.map((item, index) => (
            <span
              key={item.title}
              className={[
                "h-1.5 w-6 rounded-full transition-colors duration-[var(--duration-base)]",
                index === stepIndex ? "bg-[var(--color-primary)]" : "bg-[var(--color-line)]",
              ].join(" ")}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] px-6 py-4">
          <button
            type="button"
            onClick={dismiss}
            className="-ml-3 inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
          >
            {t("learn.tour.skip")}
          </button>
          <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
            {stepIndex > 0 ? (
              <button
                type="button"
                onClick={() => goToStep(stepIndex - 1)}
                className="button-outline shrink-0 px-4 py-2 text-sm"
              >
                {t("learn.tour.back")}
              </button>
            ) : null}
            {isLast ? (
              <button type="button" onClick={dismiss} className="button-solid shrink-0 px-4 py-2 text-sm">
                {t("learn.tour.startLearning")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => goToStep(stepIndex + 1)}
                className="button-solid shrink-0 px-4 py-2 text-sm"
              >
                {t("learn.tour.next")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
