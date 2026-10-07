"use client";

import Link from "next/link";
import { useTranslation } from "@/components/i18n/i18n-provider";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  Check,
  FileDown,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { CourseCategorySelect } from "@/components/teacher/course-category-select";
import { InlineHelp } from "@/components/shared/inline-help";
import { Button } from "@/components/ui";
import { isValidExternalEventUrl } from "@/domain/course-event";
import {
  isActivationRequiredError,
} from "@/domain/creator-verification";
import {
  defaultPaymentTypeForProductFormat,
  normalizeCourseCategories,
  skillsetCourseCategories,
  teacherCourseProductFormats,
  type TeacherCourseProductFormat,
} from "@/domain/teacher-course";
import { createCourseEvent } from "@/lib/data/course-events";
import { createTeacherCourse } from "@/lib/data/teacher-courses";
import { track } from "@/lib/posthog/events";

type CreateCourseStartProps = {
  ownerId: string;
  initialFormat?: TeacherCourseProductFormat;
};

// Os cinco estagios do fluxo inteiro. Formato e basico acontecem nesta tela,
// em duas etapas; o resto continua no construtor, e o rail diz isso.
const creationStages = [
  { id: "format", label: "courseCreation.format", detail: "courseCreation.formatDetail", where: "here" },
  { id: "basics", label: "courseCreation.basics", detail: "courseCreation.basicsDetail", where: "here" },
  { id: "pricing", label: "courseCreation.pricing", detail: "courseCreation.pricingDetail", where: "builder" },
  { id: "lessons", label: "courseCreation.lessons", detail: "courseCreation.lessonsDetail", where: "builder" },
  { id: "publish", label: "courseCreation.publish", detail: "courseCreation.publishDetail", where: "builder" },
] as const;

const formatIcons: Record<TeacherCourseProductFormat, LucideIcon> = {
  course: BookOpenCheck,
  community: UsersRound,
  live_event: CalendarDays,
  ebook: FileDown,
};

export function CreateCourseStart({ ownerId, initialFormat = "course" }: CreateCourseStartProps) {
  const router = useRouter();
  const { t } = useTranslation();
  // Tela 1: o que vai entregar. Tela 2: o nome (e, no evento, quando e onde).
  const [step, setStep] = useState<1 | 2>(1);
  const [productFormat, setProductFormat] = useState<TeacherCourseProductFormat>(initialFormat);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [eventLink, setEventLink] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  // Trocar de etapa leva o foco ao titulo da etapa nova, como a Agenda faz:
  // quem usa leitor de tela ouve onde esta, e o Tab continua dali. Na
  // primeira pintura o foco fica onde a pagina deixou.
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const stepChanged = useRef(false);
  useEffect(() => {
    if (stepChanged.current) stepHeading.current?.focus();
  }, [step]);
  const isLiveEvent = productFormat === "live_event";
  const startsAt = eventDate && eventTime ? new Date(`${eventDate}T${eventTime}`) : null;
  const linkIsValid = !eventLink.trim() || isValidExternalEventUrl(eventLink.trim());
  // Cada condicao que trava o envio, com o texto que diz o que fazer.
  const submitBlockers = [
    title.trim().length >= 3 ? null : t("courseCreation.titleRequired"),
    summary.trim().length >= 20
      ? null
      : t("courseCreation.summaryRequired"),
    selectedCategories.length > 0 ? null : t("courseCreation.categoryRequired"),
    !isLiveEvent || (startsAt && Number.isFinite(startsAt.getTime())) ? null : t("courseCreation.whenRequired"),
    !isLiveEvent || linkIsValid ? null : t("courseCreation.linkInvalid"),
  ].filter((item): item is string => item !== null);
  const canSubmit = submitBlockers.length === 0 && !isSaving;
  const stageDone: Record<(typeof creationStages)[number]["id"], boolean> = {
    format: step === 2,
    basics: step === 2 && submitBlockers.length === 0,
    pricing: false,
    lessons: false,
    publish: false,
  };

  function goTo(nextStep: 1 | 2) {
    stepChanged.current = true;
    setError("");
    setStep(nextStep);
  }

  function toggleCategory(nextCategory: string) {
    setSelectedCategories((current) => {
      if (current.includes(nextCategory)) {
        return current.filter((category) => category !== nextCategory);
      }

      return normalizeCourseCategories([...current, nextCategory]);
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (step === 1) {
      goTo(2);
      return;
    }

    if (!canSubmit) {
      return;
    }

    setError("");
    setIsSaving(true);

    try {
      const categories = normalizeCourseCategories(selectedCategories);
      const primaryCategory = categories[0];
      if (!primaryCategory) {
        setError("courseCreation.categoryError");
        setIsSaving(false);
        return;
      }
      const courseId = await createTeacherCourse({
        ownerId,
        title,
        summary,
        category: primaryCategory,
        categories,
        paymentType: defaultPaymentTypeForProductFormat(productFormat),
        communityEnabled: productFormat === "community",
        productFormat,
        // Curso nasce com "Modulo 1, Aula 1"; o e-book com uma aula com o nome
        // do produto, que guarda o arquivo para baixar.
        moduleTitle: t(productFormat === "ebook" ? "courseCreation.ebookModule" : "courseCreation.starterModule"),
        lessonTitle: productFormat === "ebook" ? title.trim() : t("courseCreation.starterLesson"),
      });

      track.courseDraftCreated({ course_id: courseId, teacher_id: ownerId });

      if (isLiveEvent && startsAt) {
        // ponytail: se a sessao falhar, o produto ja existe; o construtor
        // mostra "Schedule the session" e a pessoa marca de novo de la.
        await createCourseEvent({
          courseId,
          courseSlug: courseId,
          courseTitle: title,
          ownerId,
          title,
          description: "",
          type: "live_class",
          startsAt: startsAt.toISOString(),
          externalUrl: eventLink.trim(),
        }).catch(() => null);
      }

      router.push(`/teach/builder?courseId=${encodeURIComponent(courseId)}&tab=content`);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "";
      setError(
        message.toLowerCase().includes("already")
          ? "courseCreation.duplicateError"
          : // The activation trigger fires on INSERT, so this is the very first
            // wall a brand-new creator hits — before it was answered with
            // "Please try again", which is advice that can never work.
            isActivationRequiredError(message)
            ? "courseCreation.activationError"
            : message.toLowerCase().includes("permission")
              ? "courseCreation.permissionError"
              : message.toLowerCase().includes("summary")
                ? "courseCreation.summaryError"
                : "courseCreation.createError"
      );
      setIsSaving(false);
    }
  }

  return (
    <section className="create-course-screen">
      <aside className="create-course-screen__intro">
        <Link href="/teach/builder" className="create-course-screen__back">
          <ArrowLeft aria-hidden="true" size={15} strokeWidth={1.9} />
          {t("courseCreation.products")}
        </Link>

        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-accent)]">
          {t("courseCreation.newProduct")}
        </p>
        <h1 className="display-title mt-3 text-3xl leading-[1.08] text-white sm:text-4xl">
          {t("courseCreation.title")}
        </h1>
        <p className="create-course-screen__intro-copy mt-4 max-w-md text-sm leading-6">
          {t("courseCreation.intro")}
        </p>

        <ol
          className="create-course-screen__progress mt-8 grid gap-2"
          aria-label={t("courseCreation.progress")}
        >
          {creationStages.map((stage, index) => {
            const done = stageDone[stage.id];
            const here = stage.where === "here";

            return (
              <li
                key={stage.id}
                className={`create-course-step ${here ? "is-current" : ""}`}
                aria-current={stage.id === (step === 1 ? "format" : "basics") ? "step" : undefined}
              >
                <span>
                  {done ? (
                    <Check aria-hidden="true" size={14} strokeWidth={2.4} />
                  ) : (
                    String(index + 1).padStart(2, "0")
                  )}
                </span>
                <div>
                  <strong>{t(stage.label)}</strong>
                  <small>{here ? t(stage.detail) : t("courseCreation.continues").replace("{detail}", () => t(stage.detail))}</small>
                </div>
              </li>
            );
          })}
        </ol>
      </aside>

      <form onSubmit={handleSubmit} className="create-course-screen__form">
        {step === 1 ? (
          <>
            <h2
              ref={stepHeading}
              tabIndex={-1}
              className="text-3xl font-semibold leading-tight text-[var(--color-primary)]"
            >
              {t("courseCreation.deliverTitle")}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
              {t("courseCreation.deliverHelp")}
            </p>

            <fieldset className="mt-6">
              <legend className="sr-only">{t("courseCreation.deliverTitle")}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {teacherCourseProductFormats.map((format) => (
                  <FormatCard
                    key={format}
                    active={productFormat === format}
                    detail={t(`courseCreation.types.${format}.help`)}
                    icon={formatIcons[format]}
                    label={t(`courseCreation.types.${format}.label`)}
                    // Clicar no cartao ja escolhe e avanca.
                    onClick={() => {
                      setProductFormat(format);
                      goTo(2);
                    }}
                  />
                ))}
              </div>
            </fieldset>

            <div className="mt-7 flex justify-end border-t border-[var(--color-line)] pt-5">
              <Button type="submit" size="lg" className="w-full sm:w-auto">
                {t("courseCreation.continue")}
                <ArrowRight aria-hidden="true" size={15} strokeWidth={1.9} />
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2
              ref={stepHeading}
              tabIndex={-1}
              className="text-3xl font-semibold leading-tight text-[var(--color-primary)]"
            >
              {t(`courseCreation.nameTitle.${productFormat}`)}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
              {t("courseCreation.privateDraft")}
            </p>

            <div className="mt-6 grid gap-5">
              <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                {t("courseCreation.productTitle")}
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  minLength={3}
                  maxLength={120}
                  placeholder={t("courseCreation.titlePlaceholder")}
                  className="min-h-11 rounded-md border border-[var(--color-field-border)] bg-white px-3.5 py-2.5 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
                />
              </label>

              {isLiveEvent ? (
                <div className="grid gap-5 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                    {t("courseCreation.eventDate")}
                    <input
                      type="date"
                      value={eventDate}
                      onChange={(event) => setEventDate(event.target.value)}
                      className="min-h-11 rounded-md border border-[var(--color-field-border)] bg-white px-3.5 py-2.5 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                    {t("courseCreation.eventTime")}
                    <input
                      type="time"
                      value={eventTime}
                      onChange={(event) => setEventTime(event.target.value)}
                      className="min-h-11 rounded-md border border-[var(--color-field-border)] bg-white px-3.5 py-2.5 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
                    />
                  </label>
                  <div className="grid gap-2 sm:col-span-2">
                    <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                      {t("courseCreation.eventLink")}
                      <input
                        type="url"
                        inputMode="url"
                        value={eventLink}
                        onChange={(event) => setEventLink(event.target.value)}
                        placeholder="https://"
                        aria-describedby="create-course-link-help"
                        className="min-h-11 rounded-md border border-[var(--color-field-border)] bg-white px-3.5 py-2.5 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
                      />
                    </label>
                    <span id="create-course-link-help" className="text-xs text-[var(--color-ink-muted)]">
                      {t("courseCreation.eventLinkHelp")}
                    </span>
                  </div>
                </div>
              ) : null}

              <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                {t("courseCreation.promise")}
                <textarea
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  minLength={20}
                  maxLength={1200}
                  rows={4}
                  placeholder={t("courseCreation.promisePlaceholder")}
                  className="resize-none rounded-md border border-[var(--color-field-border)] bg-white px-3.5 py-2.5 text-sm font-normal leading-6 outline-none focus:border-[var(--color-primary-light)]"
                />
                <span className="text-xs font-normal text-[var(--color-ink-muted)]">
                  {t("courseCreation.characterCount").replace("{count}", () => String(summary.trim().length))}
                </span>
              </label>

              <div className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                <span className="flex items-center gap-2">
                  {t("courseCreation.categories")}
                  <InlineHelp topic={t("courseCreation.categoryTopic")} href="/help#course-categories">
                    {t("courseCreation.categoryHelp")}
                  </InlineHelp>
                </span>
                <CourseCategorySelect
                  options={skillsetCourseCategories}
                  selected={selectedCategories}
                  onToggle={toggleCategory}
                  disabled={isSaving}
                />
                <span className="text-xs font-normal text-[var(--color-ink-muted)]">
                  {t("courseCreation.primaryCategory")}
                </span>
              </div>
            </div>

            {error ? (
              <div
                role="alert"
                className="mt-5 rounded-md border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]"
              >
                <p>{t(error)}</p>
                {error === "courseCreation.activationError" ? (
                  <Link
                    href="/teach/activate"
                    className="button-solid mt-3 inline-flex px-4 py-2 text-xs"
                  >
                    {t("courseCreation.activate")}
                  </Link>
                ) : null}
              </div>
            ) : null}

            {submitBlockers.length > 0 ? (
              <p
                id="create-course-blockers"
                className="mt-5 text-xs leading-5 text-[var(--color-ink-soft)]"
              >
                <span className="font-semibold text-[var(--color-ink)]">
                  {t("courseCreation.beforeContinue")}
                </span>{" "}
                {submitBlockers.join(" ")}
              </p>
            ) : null}

            <div className="mt-7 flex flex-col-reverse gap-3 border-t border-[var(--color-line)] pt-5 sm:flex-row sm:justify-between">
              <Button
                variant="outline"
                size="lg"
                onClick={() => goTo(1)}
                disabled={isSaving}
                className="w-full sm:w-auto"
              >
                <ArrowLeft aria-hidden="true" size={15} strokeWidth={1.9} />
                {t("courseCreation.back")}
              </Button>
              {/* Criar o produto é um dos dois marcos da jornada: latão, e o
                  "criando" acontece dentro do próprio botão. */}
              <Button
                type="submit"
                variant="accent"
                size="lg"
                loading={isSaving}
                disabled={!canSubmit}
                aria-describedby={
                  submitBlockers.length > 0 ? "create-course-blockers" : undefined
                }
                className="w-full disabled:opacity-60 sm:w-auto"
              >
                {isSaving ? t("courseCreation.creating") : t("courseCreation.create")}
                {isSaving ? null : <ArrowRight aria-hidden="true" size={15} strokeWidth={1.9} />}
              </Button>
            </div>
          </>
        )}
      </form>
    </section>
  );
}

function FormatCard({
  active,
  detail,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  detail: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`create-course-payment create-course-payment--large ${active ? "is-active" : ""}`}
      aria-pressed={active}
    >
      <span>
        <Icon aria-hidden="true" size={28} strokeWidth={1.6} />
      </span>
      <strong>{label}</strong>
      <small>{detail}</small>
      {active ? (
        <Check
          aria-hidden="true"
          className="create-course-payment__selected"
          size={15}
          strokeWidth={2.4}
        />
      ) : null}
    </button>
  );
}
