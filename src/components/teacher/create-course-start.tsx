"use client";

import Link from "next/link";
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
import { useEffect, useRef, useState, type FormEvent } from "react";

import { CourseCategorySelect } from "@/components/teacher/course-category-select";
import { InlineHelp } from "@/components/shared/inline-help";
import {
  ACTIVATION_REQUIRED_MESSAGE,
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

const creationSteps = [
  ["01", "Product format", "Choose the delivery model that matches the offer"],
  ["02", "Basic information", "Title, promise, and categories"],
  ["03", "Pricing and content", "Continue in the product builder"],
] as const;

export function CreateCourseStart({ ownerId, initialFormat = "course" }: CreateCourseStartProps) {
  const router = useRouter();
  const [step, setStep] = useState<"format" | "basics">("format");
  const [productFormat, setProductFormat] = useState<TeacherCourseProductFormat>(initialFormat);
  const [subscriptionInterval, setSubscriptionInterval] =
    useState<TeacherCourseSubscriptionInterval>("monthly");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStepRef = useRef(step);
  // As três condições que travam o envio, cada uma com o texto que diz o que
  // fazer. Antes isto era um booleano só: o botão ficava cinza e não havia nada
  // na tela dizendo se faltava título, resumo ou categoria — e os mínimos (3 e
  // 20 caracteres) não aparecem em lugar nenhum. Quem escrevia um resumo de 15
  // caracteres via um botão morto sem motivo.
  const submitBlockers = [
    title.trim().length >= 3 ? null : "Give the course a title (3+ characters).",
    summary.trim().length >= 20
      ? null
      : "Write a summary with at least 20 characters.",
    selectedCategories.length > 0 ? null : "Choose a marketplace category.",
  ].filter((item): item is string => item !== null);
  const canSubmit = submitBlockers.length === 0 && !isSaving;
  const courseType: NonNullable<CreateTeacherCourseInput["paymentType"]> =
    resolveTeacherCoursePaymentType(productFormat, subscriptionInterval);
  const nextBuilderTab = productFormat === "free" ? "content" : "pricing";
  const submitLabel =
    productFormat === "event"
      ? "Create and schedule event"
      : productFormat === "free"
        ? "Create and add content"
        : "Create and set pricing";
  const activeStep = step === "format" ? 0 : 1;

  useEffect(() => {
    if (previousStepRef.current !== step) {
      previousStepRef.current = step;
      stepHeadingRef.current?.focus();
    }
  }, [step]);

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
        setError("Choose at least one marketplace category.");
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
          ? "A course with this title already exists. Choose a more specific name."
          : // The activation trigger fires on INSERT, so this is the very first
            // wall a brand-new creator hits — before it was answered with
            // "Please try again", which is advice that can never work.
            isActivationRequiredError(message)
            ? ACTIVATION_REQUIRED_MESSAGE
            : message.toLowerCase().includes("permission")
              ? "Course creation is blocked until creator setup is complete. Verify your email and accept Teacher Terms first."
              : message.toLowerCase().includes("summary")
                ? "Add a course summary with at least 20 characters."
                : "We could not create this course. Please try again."
      );
      setIsSaving(false);
    }
  }

  return (
    <section className="create-course-screen">
      <aside className="create-course-screen__intro">
        <Link href="/teach/builder" className="create-course-screen__back">
          <ArrowLeft aria-hidden="true" size={15} strokeWidth={1.9} />
          My products
        </Link>

        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-accent)]">
          New product
        </p>
        <h1 className="display-title mt-3 text-3xl leading-[1.08] text-white sm:text-4xl">
          Build the product foundation.
        </h1>
        <p className="create-course-screen__intro-copy mt-4 max-w-md text-sm leading-6">
          Start with the access model and essential information. Pricing, curriculum, members area,
          and publication follow in the builder.
        </p>

        <ol
          className="create-course-screen__progress mt-8 grid gap-2"
          aria-label="Product creation progress"
        >
          {creationSteps.map(([number, label, detail], index) => {
            const complete = index < activeStep;
            const current = index === activeStep;

            return (
              <li
                key={label}
                className={`create-course-step ${current ? "is-current" : ""}`}
                aria-current={current ? "step" : undefined}
              >
                <span>
                  {complete ? <Check aria-hidden="true" size={14} strokeWidth={2.4} /> : number}
                </span>
                <div>
                  <strong>{label}</strong>
                  <small>{detail}</small>
                </div>
              </li>
            );
          })}
        </ol>
      </aside>

      <form onSubmit={handleSubmit} className="create-course-screen__form">
        {step === "format" ? (
          <>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-accent-fg)]">
                Step 1 of 2
              </p>
              <h2
                ref={stepHeadingRef}
                tabIndex={-1}
                className="mt-2 text-3xl font-semibold leading-tight text-[var(--color-primary)]"
              >
                Choose a product format
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
                The format defines how learners receive access. Commercial terms remain editable in
                Pricing and offers.
              </p>
            </div>

            <fieldset className="mt-6">
              <legend className="sr-only">Product format</legend>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <PaymentChoice
                  active={productFormat === "course"}
                  detail="One-time purchase with permanent or managed access."
                  icon="course"
                  label="Online course"
                  onClick={() => setProductFormat("course")}
                />
                <PaymentChoice
                  active={productFormat === "program"}
                  detail="A sequenced pathway combining learning, practice, and optional live touchpoints."
                  icon="program"
                  label="Guided program"
                  onClick={() => setProductFormat("program")}
                />
                <PaymentChoice
                  active={productFormat === "event"}
                  detail="Live workshops, cohorts, and scheduled group sessions."
                  icon="event"
                  label="Online event"
                  onClick={() => setProductFormat("event")}
                />
                <PaymentChoice
                  active={productFormat === "subscription"}
                  detail="Ongoing access billed on a recurring schedule."
                  icon="subscription"
                  label="Subscription"
                  onClick={() => setProductFormat("subscription")}
                />
                <PaymentChoice
                  active={productFormat === "community"}
                  detail="A recurring members space built for posts and peer exchange."
                  icon="community"
                  label="Community"
                  onClick={() => setProductFormat("community")}
                />
                <PaymentChoice
                  active={productFormat === "free"}
                  detail="Open enrollment with no checkout or payment."
                  icon="free"
                  label="Free program"
                  onClick={() => setProductFormat("free")}
                />
              </div>
            </fieldset>

            {productFormat === "subscription" || productFormat === "community" ? (
              <fieldset className="mt-5">
                <legend className="text-sm font-semibold text-[var(--color-ink)]">
                  Initial billing interval
                </legend>
                <div className="mt-2 grid grid-cols-2 gap-1 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-1">
                  {(["monthly", "yearly"] as const).map((interval) => (
                    <button
                      key={interval}
                      type="button"
                      aria-pressed={subscriptionInterval === interval}
                      onClick={() => setSubscriptionInterval(interval)}
                      className={`min-h-10 rounded-[6px] px-3 py-2 text-sm font-semibold transition-colors ${
                        subscriptionInterval === interval
                          ? "bg-[var(--color-primary)] text-[var(--color-base)]"
                          : "text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
                      }`}
                    >
                      {interval === "monthly" ? "Monthly" : "Yearly"}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <div className="mt-7 flex justify-end border-t border-[var(--color-line)] pt-5">
              <button
                type="button"
                onClick={() => setStep("basics")}
                className="button-solid px-4 text-sm"
              >
                Continue
                <ArrowRight aria-hidden="true" size={15} strokeWidth={1.9} />
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-accent-fg)]">
                Step 2 of 2
              </p>
              <h2
                ref={stepHeadingRef}
                tabIndex={-1}
                className="mt-2 text-3xl font-semibold leading-tight text-[var(--color-primary)]"
              >
                Add the essential information
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
                This creates a private draft. Nothing becomes visible or sellable before
                professional verification and publication.
              </p>
            </div>

            <div className="mt-6 grid gap-5">
              <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                Product title
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  minLength={3}
                  maxLength={120}
                  placeholder="e.g. Peak Performance Foundations"
                  className="min-h-11 rounded-[8px] border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] focus:ring-2 focus:ring-[rgba(66,102,145,0.18)]"
                />
              </label>

              <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                Product promise
                <textarea
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  minLength={20}
                  maxLength={1200}
                  rows={4}
                  placeholder="Describe the practical outcome learners can expect."
                  className="resize-none rounded-[8px] border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-sm font-normal leading-6 outline-none focus:border-[var(--color-primary-light)] focus:ring-2 focus:ring-[rgba(66,102,145,0.18)]"
                />
                <span className="text-xs font-normal text-[var(--color-ink-muted)]">
                  {summary.trim().length}/1200 characters. Minimum 20.
                </span>
              </label>

              <div className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                <span className="flex items-center gap-2">
                  Categories
                  <InlineHelp topic="Course categories" href="/help#course-categories">
                    Categories determine where buyers discover the product and how SkillsetMind
                    groups related expertise. Choose the most specific fit first; that first
                    selection becomes the primary marketplace category.
                  </InlineHelp>
                </span>
                <CourseCategorySelect
                  options={skillsetCourseCategories}
                  selected={selectedCategories}
                  onToggle={toggleCategory}
                  disabled={isSaving}
                />
                <span className="text-xs font-normal text-[var(--color-ink-muted)]">
                  The first selection is the primary marketplace category.
                </span>
              </div>
            </div>

            {error ? (
              <div
                role="alert"
                className="mt-5 rounded-[8px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]"
              >
                <p>{error}</p>
                {error === ACTIVATION_REQUIRED_MESSAGE ? (
                  <Link
                    href="/teach/activate"
                    className="button-solid mt-3 inline-flex px-4 py-2 text-xs"
                  >
                    Activate storefront
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
                  Before you continue:
                </span>{" "}
                {submitBlockers.join(" ")}
              </p>
            ) : null}

            <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] pt-5">
              <button
                type="button"
                onClick={() => setStep("format")}
                disabled={isSaving}
                className="button-outline px-4 text-sm"
              >
                <ArrowLeft aria-hidden="true" size={15} strokeWidth={1.9} />
                Back
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                aria-describedby={
                  submitBlockers.length > 0 ? "create-course-blockers" : undefined
                }
                className="button-solid px-4 text-sm disabled:opacity-60"
              >
                {isSaving ? "Creating..." : submitLabel}
                <ArrowRight aria-hidden="true" size={15} strokeWidth={1.9} />
              </button>
            </div>
          </>
        )}
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
