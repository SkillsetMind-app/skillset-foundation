"use client";

import Link from "next/link";
import { useTranslation } from "@/components/i18n/i18n-provider";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  Check,
  Gift,
  Route,
  Repeat2,
  UsersRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { CourseCategorySelect } from "@/components/teacher/course-category-select";
import { InlineHelp } from "@/components/shared/inline-help";
import {
  isActivationRequiredError,
} from "@/domain/creator-verification";
import {
  normalizeCourseCategories,
  resolveTeacherCoursePaymentType,
  skillsetCourseCategories,
  type CreateTeacherCourseInput,
  type TeacherCourseProductFormat,
  type TeacherCourseSubscriptionInterval,
} from "@/domain/teacher-course";
import { createTeacherCourse } from "@/lib/data/teacher-courses";
import { track } from "@/lib/posthog/events";

type CreateCourseStartProps = {
  ownerId: string;
  initialFormat?: TeacherCourseProductFormat;
};

// Os cinco estagios do fluxo inteiro. O rail prometia tres passos, o
// formulario dizia "passo 1 de 2" e o terceiro nunca acendia: a pessoa nao
// sabia se tinha terminado. Formato e basico acontecem nesta tela; o resto
// continua no construtor, e o rail diz isso em vez de fingir que acaba aqui.
const creationStages = [
  { id: "format", label: "courseCreation.format", detail: "courseCreation.formatDetail", where: "here" },
  { id: "basics", label: "courseCreation.basics", detail: "courseCreation.basicsDetail", where: "here" },
  { id: "pricing", label: "courseCreation.pricing", detail: "courseCreation.pricingDetail", where: "builder" },
  { id: "lessons", label: "courseCreation.lessons", detail: "courseCreation.lessonsDetail", where: "builder" },
  { id: "publish", label: "courseCreation.publish", detail: "courseCreation.publishDetail", where: "builder" },
] as const;

export function CreateCourseStart({ ownerId, initialFormat = "course" }: CreateCourseStartProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const [productFormat, setProductFormat] = useState<TeacherCourseProductFormat>(initialFormat);
  const [subscriptionInterval, setSubscriptionInterval] =
    useState<TeacherCourseSubscriptionInterval>("monthly");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  // As três condições que travam o envio, cada uma com o texto que diz o que
  // fazer. Antes isto era um booleano só: o botão ficava cinza e não havia nada
  // na tela dizendo se faltava título, resumo ou categoria — e os mínimos (3 e
  // 20 caracteres) não aparecem em lugar nenhum. Quem escrevia um resumo de 15
  // caracteres via um botão morto sem motivo.
  const submitBlockers = [
    title.trim().length >= 3 ? null : t("courseCreation.titleRequired"),
    summary.trim().length >= 20
      ? null
      : t("courseCreation.summaryRequired"),
    selectedCategories.length > 0 ? null : t("courseCreation.categoryRequired"),
  ].filter((item): item is string => item !== null);
  const canSubmit = submitBlockers.length === 0 && !isSaving;
  const courseType: NonNullable<CreateTeacherCourseInput["paymentType"]> =
    resolveTeacherCoursePaymentType(productFormat, subscriptionInterval);
  const nextBuilderTab = productFormat === "free" ? "content" : "pricing";
  const submitLabel =
    productFormat === "event"
      ? t("courseCreation.createEvent")
      : productFormat === "free"
        ? t("courseCreation.createFree")
        : t("courseCreation.createPaid");
  // Um formato vem pre-selecionado, entao o estagio Format ja nasce feito;
  // Basics acende quando as tres condicoes acima estao satisfeitas.
  const stageDone: Record<(typeof creationStages)[number]["id"], boolean> = {
    format: true,
    basics: submitBlockers.length === 0,
    pricing: false,
    lessons: false,
    publish: false,
  };

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
        paymentType: courseType,
        communityEnabled: productFormat === "community",
      });

      track.courseDraftCreated({ course_id: courseId, teacher_id: ownerId });

      router.push(
        productFormat === "event"
          ? `/teach/events?courseId=${encodeURIComponent(courseId)}&newEvent=1`
          : `/teach/builder?courseId=${courseId}&tab=${nextBuilderTab}`
      );
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
                aria-current={stage.id === "basics" ? "step" : undefined}
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
        <div>
          <h2 className="text-3xl font-semibold leading-tight text-[var(--color-primary)]">
            {t("courseCreation.setup")}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("courseCreation.privateDraft")}
          </p>
        </div>

        <fieldset className="mt-6">
          <legend className="text-sm font-semibold text-[var(--color-ink)]">{t("courseCreation.productFormat")}</legend>
          <p className="mt-1 text-xs leading-5 text-[var(--color-ink-muted)]">
            {t("courseCreation.formatHelp")}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <PaymentChoice
              active={productFormat === "course"}
              detail={t("courseCreation.courseHelp")}
              icon="course"
              label={t("courseCreation.courseLabel")}
              onClick={() => setProductFormat("course")}
            />
            <PaymentChoice
              active={productFormat === "program"}
              detail={t("courseCreation.programHelp")}
              icon="program"
              label={t("courseCreation.programLabel")}
              onClick={() => setProductFormat("program")}
            />
            <PaymentChoice
              active={productFormat === "event"}
              detail={t("courseCreation.eventHelp")}
              icon="event"
              label={t("courseCreation.eventLabel")}
              onClick={() => setProductFormat("event")}
            />
            <PaymentChoice
              active={productFormat === "subscription"}
              detail={t("courseCreation.subscriptionHelp")}
              icon="subscription"
              label={t("courseCreation.subscriptionLabel")}
              onClick={() => setProductFormat("subscription")}
            />
            <PaymentChoice
              active={productFormat === "community"}
              detail={t("courseCreation.communityHelp")}
              icon="community"
              label={t("courseCreation.communityLabel")}
              onClick={() => setProductFormat("community")}
            />
            <PaymentChoice
              active={productFormat === "free"}
              detail={t("courseCreation.freeHelp")}
              icon="free"
              label={t("courseCreation.freeLabel")}
              onClick={() => setProductFormat("free")}
            />
          </div>
        </fieldset>

        {productFormat === "subscription" || productFormat === "community" ? (
          <fieldset className="mt-5">
            <legend className="text-sm font-semibold text-[var(--color-ink)]">
              {t("courseCreation.interval")}
            </legend>
            <div className="mt-2 grid grid-cols-2 gap-1 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-1">
              {(["monthly", "yearly"] as const).map((interval) => (
                <button
                  key={interval}
                  type="button"
                  aria-pressed={subscriptionInterval === interval}
                  onClick={() => setSubscriptionInterval(interval)}
                  className={`min-h-11 rounded-[6px] px-3 py-2 text-sm font-semibold transition-colors ${
                    subscriptionInterval === interval
                      ? "bg-[var(--color-primary)] text-[var(--color-base)]"
                      : "text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  {interval === "monthly" ? t("courseCreation.monthly") : t("courseCreation.yearly")}
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}

        <div className="mt-6 grid gap-5">
          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            {t("courseCreation.productTitle")}
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              minLength={3}
              maxLength={120}
              placeholder={t("courseCreation.titlePlaceholder")}
              className="min-h-11 rounded-[8px] border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] focus:ring-2 focus:ring-[rgba(66,102,145,0.18)]"
            />
          </label>

          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            {t("courseCreation.promise")}
            <textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              minLength={20}
              maxLength={1200}
              rows={4}
              placeholder={t("courseCreation.promisePlaceholder")}
              className="resize-none rounded-[8px] border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-sm font-normal leading-6 outline-none focus:border-[var(--color-primary-light)] focus:ring-2 focus:ring-[rgba(66,102,145,0.18)]"
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
            className="mt-5 rounded-[8px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]"
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

        <div className="mt-7 flex justify-end border-t border-[var(--color-line)] pt-5">
          <button
            type="submit"
            disabled={!canSubmit}
            aria-describedby={
              submitBlockers.length > 0 ? "create-course-blockers" : undefined
            }
            className="button-solid px-4 text-sm disabled:opacity-60"
          >
            {isSaving ? t("courseCreation.creating") : submitLabel}
            <ArrowRight aria-hidden="true" size={15} strokeWidth={1.9} />
          </button>
        </div>
      </form>
    </section>
  );
}

function PaymentChoice({
  active,
  detail,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  detail: string;
  icon: TeacherCourseProductFormat;
  label: string;
  onClick: () => void;
}) {
  const Icon =
    icon === "subscription"
      ? Repeat2
      : icon === "community"
        ? UsersRound
        : icon === "program"
          ? Route
        : icon === "event"
          ? CalendarDays
          : icon === "free"
            ? Gift
            : BookOpenCheck;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`create-course-payment ${active ? "is-active" : ""}`}
      aria-pressed={active}
    >
      <span>
        <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
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
