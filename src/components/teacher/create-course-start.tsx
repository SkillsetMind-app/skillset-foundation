"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, CreditCard, Gift, Layers3 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  normalizeCourseCategories,
  skillsetCourseCategories,
  type CreateTeacherCourseInput,
} from "@/domain/teacher-course";
import { createTeacherCourse } from "@/lib/data/teacher-courses";

type CreateCourseStartProps = {
  ownerId: string;
};

const creationSteps = [
  ["01", "Course basics", "Title, promise, category"],
  ["02", "Course shell", "Draft saved automatically"],
  ["03", "Builder", "Modules, lessons, uploads"],
] as const;

export function CreateCourseStart({ ownerId }: CreateCourseStartProps) {
  const router = useRouter();
  const [courseType, setCourseType] =
    useState<NonNullable<CreateTeacherCourseInput["paymentType"]>>("one_time");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const canSubmit =
    title.trim().length >= 3 && summary.trim().length >= 20 && !isSaving;

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
      const primaryCategory = categories[0] ?? "Other";
      const courseId = await createTeacherCourse({
        ownerId,
        title,
        summary,
        category: primaryCategory,
        categories,
        paymentType: courseType,
      });

      router.push(`/teach/builder?courseId=${courseId}`);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "";
      setError(
        message.toLowerCase().includes("already")
          ? "A course with this title already exists. Choose a more specific name."
          : message.toLowerCase().includes("permission")
          ? "Course creation is blocked until creator setup is complete. Verify your email and accept Teacher Terms first."
          : message.toLowerCase().includes("summary")
          ? "Add a course summary with at least 20 characters."
          : "We could not create this course. Please try again.",
      );
      setIsSaving(false);
    }
  }

  return (
    <section className="create-course-screen">
      <div className="create-course-screen__intro">
        <Link href="/teach/builder" className="create-course-screen__back">
          <ArrowLeft aria-hidden="true" size={14} strokeWidth={1.9} />
          Back to courses
        </Link>

        <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--color-accent-fg)]">
          New course
        </p>
        <h2 className="display-title mt-3 text-4xl leading-[1.02] text-[var(--color-primary)] sm:text-5xl">
          Start with the course shell.
        </h2>
        <p className="mt-4 max-w-xl text-sm leading-7 text-[var(--color-ink-soft)]">
          Create the draft first. Then Skillset opens the full builder for cover,
          modules, lessons, uploads, pricing, preview, and review.
        </p>

        <div className="mt-8 grid gap-3">
          {creationSteps.map(([number, label, detail], index) => (
            <div key={label} className="create-course-step">
              <span>{number}</span>
              <div>
                <strong>{label}</strong>
                <small>{detail}</small>
              </div>
              {index === 0 ? (
                <CheckCircle2 aria-hidden="true" size={16} strokeWidth={2} />
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="create-course-screen__form">
        <div className="grid gap-2">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Course setup
          </p>
          <h3 className="display-title text-3xl leading-tight text-[var(--color-primary)]">
            Define the first version.
          </h3>
        </div>

        <div className="mt-6 grid gap-4">
          <div className="grid gap-3 text-sm font-semibold text-[var(--color-ink)]">
            Payment model
            <div className="grid gap-3 sm:grid-cols-2">
              <PaymentChoice
                active={courseType === "one_time"}
                detail="Paid course with checkout and payout tracking."
                icon="paid"
                label="One-time payment"
                onClick={() => setCourseType("one_time")}
              />
              <PaymentChoice
                active={courseType === "free"}
                detail="Open enrollment without checkout."
                icon="free"
                label="Free course"
                onClick={() => setCourseType("free")}
              />
            </div>
          </div>

          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            Course title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              minLength={3}
              maxLength={120}
              placeholder="e.g. Advanced Product Design"
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
            />
          </label>

          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            Course promise
            <textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              minLength={20}
              maxLength={1200}
              rows={4}
              placeholder="Explain what learners will be able to do after completing this course."
              className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal leading-6 outline-none focus:border-[var(--color-primary-light)]"
            />
            <span className="text-[11px] font-normal text-[var(--color-ink-soft)]">
              Minimum 20 characters. This can be refined later.
            </span>
          </label>

          <div className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            Categories
            <p className="text-xs font-normal leading-5 text-[var(--color-ink-soft)]">
              Optional. Select up to five categories so learners can find the
              course in the right context.
            </p>
            <div className="grid max-h-52 gap-2 overflow-y-auto rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3 sm:grid-cols-2">
              {skillsetCourseCategories.map((category) => {
                const selected = selectedCategories.includes(category);

                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => toggleCategory(category)}
                    className={`rounded-[8px] border px-3 py-2 text-left text-xs font-semibold transition-colors ${
                      selected
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                        : "border-[var(--color-line)] bg-white text-[var(--color-ink)] hover:border-[var(--color-primary-light)]"
                    }`}
                    aria-pressed={selected}
                  >
                    {category}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {error ? (
          <p className="mt-4 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] pt-5">
          <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
            No popup. This creates a real draft and opens the full builder.
          </p>
          <button
            type="submit"
            disabled={!canSubmit}
            className="button-solid px-5 py-3 text-sm disabled:opacity-60"
          >
            {isSaving ? "Creating..." : "Create and open builder"}
            <ArrowRight aria-hidden="true" size={14} strokeWidth={1.9} />
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
  icon: "free" | "paid";
  label: string;
  onClick: () => void;
}) {
  const Icon = icon === "paid" ? CreditCard : Gift;

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
      <Layers3 aria-hidden="true" className="create-course-payment__watermark" size={44} />
    </button>
  );
}
