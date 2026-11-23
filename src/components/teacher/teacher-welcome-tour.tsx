"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useLegalGateWaiting } from "@/components/auth/legal-gate-state";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { SpotArt, type SpotArtScene } from "@/components/ui/spot-art";
import { useModalFocus } from "@/lib/a11y/use-modal-focus";
import { useWelcomeTour } from "@/lib/ui/use-welcome-tour";

type TourStep = {
  // A faixa de gravura do passo (no lugar do iconezinho redondo).
  scene: SpotArtScene;
  title: string;
  body: string;
};

function buildSteps(firstName: string, t: (key: string) => string): TourStep[] {
  const welcomeTitle = firstName
    ? t("teach.tour.welcomeNamed").replace("{name}", () => firstName)
    : t("teach.tour.welcome");

  // Dois passos: "Publicar e vender" e "Ganhos e ajuda" saíram, porque a lista
  // de próximos passos do estúdio já leva a eles. A Ajuda ficou no passo 2.
  return [
    {
      scene: "firstProduct",
      title: welcomeTitle,
      body: t("teach.tour.step1Body"),
    },
    {
      scene: "firstLesson",
      title: t("teach.tour.step2Title"),
      body: t("teach.tour.step2Body"),
    },
  ];
}

type TeacherWelcomeTourProps = {
  userId: string;
  firstName: string;
  hasProducts?: boolean;
};

// A janela dos termos vem antes (o mesmo do tour do aluno): enquanto ela está
// na tela, ou ainda não se sabe, o tour nem monta e não marca "visto".
export function TeacherWelcomeTour(props: TeacherWelcomeTourProps) {
  return useLegalGateWaiting() ? null : <TeacherWelcomeTourDialog {...props} />;
}

function TeacherWelcomeTourDialog({
  userId,
  firstName,
  hasProducts = false,
}: TeacherWelcomeTourProps) {
  const { t } = useTranslation();
  const { open, dismiss } = useWelcomeTour(userId, "teacher");
  const [stepIndex, setStepIndex] = useState(0);
  // O mesmo do tour do aluno (learn/welcome-tour.tsx): só depois da primeira
  // troca de passo o texto e a cena entram subindo. Na abertura a janela já
  // entra pelo .modal-panel; os dois juntos davam a animação duas vezes.
  const [stepChanged, setStepChanged] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const steps = buildSteps(firstName, t);

  useModalFocus(dialogRef, open);

  function goToStep(next: number) {
    setStepChanged(true);
    setStepIndex(Math.max(0, Math.min(steps.length - 1, next)));
  }

  // Trocou de passo: o foco vai para o título novo. Voltar ao passo 1 tira o
  // "Back" da tela com o foco nele, e o foco caía atrás da janela.
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
  const isLast = stepIndex === steps.length - 1;

  return (
    <div
      className="dialog-backdrop fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={dismiss}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="teacher-welcome-tour-title"
        className="dialog-panel modal-panel modal-panel-scroll overflow-hidden outline-none"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* Faixa estreita de gravura com a cena do passo (altura fixa, h-20).
            key: trocar de passo remonta a cena e ela entra de novo. Um
            controle de pular só, o "Skip" do rodapé (e o Esc): o X do topo
            ("Skip the tour") fazia a mesma coisa. */}
        <div className="border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] px-6 py-3">
          <SpotArt key={step.scene} scene={step.scene} className={`mx-auto h-20 w-auto ${stepChanged ? "spot-art-in" : ""}`} />
        </div>

        {/* Os passos na mesma célula da grade: a caixa tem a altura do
            passo mais longo, então trocar de passo não mexe nos botões de
            baixo. Só o atual aparece (e existe para o leitor de tela). */}
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
                  id={current ? "teacher-welcome-tour-title" : undefined}
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

        {/* Traços de largura fixa: só a cor do atual muda (antes o ativo
            crescia de 6 para 24px e refazia o layout). */}
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

        {/* O rodapé da casa (filete, respiro), mas sem empilhar no celular:
            o Back só aparece do 2º passo, e empilhado ele mudaria a altura
            da janela entre os passos. O Skip fica à esquerda. */}
        <div className="dialog-footer flex-row flex-wrap items-center justify-between">
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
            {/* O tour so descrevia e terminava em "Open your studio", que so
                fechava. Sem produto ainda, a ultima pagina leva a acao que ele
                descreveu: criar o primeiro produto. */}
            {isLast && !hasProducts ? (
              <Link
                href="/teach/builder?newCourse=1&format=course"
                onClick={dismiss}
                className="button-solid shrink-0 px-4 py-2 text-sm"
              >
                {t("creatorPanel.home.products.firstCta")}
              </Link>
            ) : isLast ? (
              <button type="button" onClick={dismiss} className="button-solid shrink-0 px-4 py-2 text-sm">
                {t("teach.tour.openStudio")}
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
