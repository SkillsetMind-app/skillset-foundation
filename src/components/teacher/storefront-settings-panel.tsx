"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import type {
  StorefrontConfig,
  StorefrontThemePreset,
} from "@/domain/user-profile";
import {
  isStorefrontHexColor,
  maxStorefrontTaglineLength,
  maxStorefrontUrlLength,
  storefrontThemePresets,
} from "@/domain/user-profile";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";
import { getUserProfile, updateUserStorefront } from "@/lib/data/user-profiles";

const themePresetLabels: Record<StorefrontThemePreset, string> = {
  default: "Platform default",
  warm: "Warm",
  cool: "Cool",
  mono: "Monochrome",
};

const defaultAccentColor = "#183a5e";

function isValidStorefrontUrl(value: string): boolean {
  if (!value) {
    return true;
  }

  return value.startsWith("https://") && value.length <= maxStorefrontUrlLength;
}

/**
 * Reorder a list by moving the item at `from` one slot in `direction`.
 * Returns a new array; out-of-range moves are no-ops.
 */
function moveItem<T>(items: T[], from: number, direction: -1 | 1): T[] {
  const to = from + direction;
  if (to < 0 || to >= items.length) {
    return items;
  }

  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function StorefrontSettingsPanel() {
  const { user } = useAuth();

  const [accentColor, setAccentColor] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [heroImageUrl, setHeroImageUrl] = useState("");
  const [themePreset, setThemePreset] = useState<StorefrontThemePreset>("default");
  const [tagline, setTagline] = useState("");
  const [orderedCourseIds, setOrderedCourseIds] = useState<string[]>([]);
  const [featuredCourseId, setFeaturedCourseId] = useState<string | null>(null);

  const [publishedCourses, setPublishedCourses] = useState<TeacherCourse[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Load the saved storefront config.
  useEffect(() => {
    if (!user) {
      return;
    }

    let mounted = true;

    getUserProfile(user.uid)
      .then((profile) => {
        if (!mounted) {
          return;
        }

        const branding = profile?.storefront?.branding;
        const showcase = profile?.storefront?.showcase;

        setAccentColor(branding?.accentColor ?? "");
        setLogoUrl(branding?.logoUrl ?? "");
        setHeroImageUrl(branding?.heroImageUrl ?? "");
        setThemePreset(branding?.themePreset ?? "default");
        setTagline(showcase?.tagline ?? "");
        setOrderedCourseIds(showcase?.orderedCourseIds ?? []);
        setFeaturedCourseId(showcase?.featuredCourseId ?? null);
      })
      .catch(() => {
        if (mounted) {
          setError("We could not load your storefront settings.");
        }
      })
      .finally(() => {
        if (mounted) {
          setIsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [user]);

  // Live list of this teacher's courses to drive the showcase ordering.
  useEffect(() => {
    if (!user) {
      return;
    }

    const unsubscribe = subscribeToTeacherCourses(
      user.uid,
      (courses) => {
        setPublishedCourses(
          courses.filter((course) => course.status === "published"),
        );
      },
      () => {
        setPublishedCourses([]);
      },
    );

    return unsubscribe;
  }, [user]);

  // The showcase is an ordered VIEW over the teacher's published courses:
  // saved order first (dropping courses no longer published), then any newly
  // published course appended in its natural order.
  const orderedCourses = useMemo(() => {
    const byId = new Map(publishedCourses.map((course) => [course.id, course]));
    const seen = new Set<string>();
    const ordered: TeacherCourse[] = [];

    for (const id of orderedCourseIds) {
      const course = byId.get(id);
      if (course && !seen.has(id)) {
        ordered.push(course);
        seen.add(id);
      }
    }

    for (const course of publishedCourses) {
      if (!seen.has(course.id)) {
        ordered.push(course);
        seen.add(course.id);
      }
    }

    return ordered;
  }, [publishedCourses, orderedCourseIds]);

  function reorder(index: number, direction: -1 | 1) {
    const ids = orderedCourses.map((course) => course.id);
    setOrderedCourseIds(moveItem(ids, index, direction));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!user) {
      setError("Sign in again to update your storefront.");
      return;
    }

    const trimmedAccent = accentColor.trim();
    const trimmedLogo = logoUrl.trim();
    const trimmedHero = heroImageUrl.trim();
    const trimmedTagline = tagline.trim();

    const validationError =
      (trimmedAccent && !isStorefrontHexColor(trimmedAccent)
        ? "Accent color must be a 6-digit hex like #183a5e."
        : "") ||
      (!isValidStorefrontUrl(trimmedLogo)
        ? "Logo URL must be an https:// link."
        : "") ||
      (!isValidStorefrontUrl(trimmedHero)
        ? "Hero image URL must be an https:// link."
        : "") ||
      (trimmedTagline.length > maxStorefrontTaglineLength
        ? `Tagline must be ${maxStorefrontTaglineLength} characters or fewer.`
        : "");

    if (validationError) {
      setError(validationError);
      return;
    }

    const ids = orderedCourses.map((course) => course.id);
    const storefront: StorefrontConfig = {
      branding: {
        accentColor: trimmedAccent || null,
        logoUrl: trimmedLogo || null,
        heroImageUrl: trimmedHero || null,
        themePreset,
      },
      showcase: {
        tagline: trimmedTagline || null,
        orderedCourseIds: ids,
        featuredCourseId:
          featuredCourseId && ids.includes(featuredCourseId)
            ? featuredCourseId
            : null,
      },
    };

    setError("");
    setSuccess("");
    setIsSaving(true);

    try {
      await updateUserStorefront(user.uid, storefront);
      setSuccess("Storefront saved.");
    } catch {
      setError(
        "We could not save your storefront. Try again, and contact support if it keeps failing.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <section className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-sm text-[var(--color-ink-soft)]">
          Loading storefront settings...
        </p>
      </section>
    );
  }

  const previewAccent =
    accentColor.trim() && isStorefrontHexColor(accentColor.trim())
      ? accentColor.trim()
      : defaultAccentColor;

  return (
    <section className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-brand)]">
        Teacher Studio
      </p>
      <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
        Storefront branding
      </h3>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        Brand your public instructor page &mdash; logo, hero image, accent color,
        and the order your courses appear in. Saved here now; your public
        storefront goes live in a later step.
      </p>

      <form className="mt-6 grid gap-5" onSubmit={handleSubmit}>
        <div className="grid gap-4 rounded-[4px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4">
          <p className="text-sm font-semibold text-[var(--color-ink)]">
            Brand
          </p>

          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            Accent color
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={previewAccent}
                onChange={(event) => setAccentColor(event.target.value)}
                aria-label="Accent color picker"
                className="h-11 w-14 shrink-0 cursor-pointer rounded-[10px] border border-[var(--color-line)] bg-white p-1"
              />
              <input
                value={accentColor}
                onChange={(event) => setAccentColor(event.target.value)}
                placeholder="#183a5e"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
              />
            </div>
            <span className="text-xs font-normal text-[var(--color-ink-soft)]">
              6-digit hex. Leave blank to use the platform default.
            </span>
          </label>

          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            Logo URL
            <input
              value={logoUrl}
              onChange={(event) => setLogoUrl(event.target.value)}
              placeholder="https://..."
              spellCheck={false}
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
            />
          </label>

          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            Hero image URL
            <input
              value={heroImageUrl}
              onChange={(event) => setHeroImageUrl(event.target.value)}
              placeholder="https://..."
              spellCheck={false}
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
            />
            <span className="text-xs font-normal text-[var(--color-ink-soft)]">
              Must be an https:// link. Used as the banner on your instructor page.
            </span>
          </label>

          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            Theme preset
            <select
              value={themePreset}
              onChange={(event) =>
                setThemePreset(event.target.value as StorefrontThemePreset)
              }
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
            >
              {storefrontThemePresets.map((preset) => (
                <option key={preset} value={preset}>
                  {themePresetLabels[preset]}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            Tagline
            <textarea
              value={tagline}
              onChange={(event) => setTagline(event.target.value)}
              rows={2}
              maxLength={maxStorefrontTaglineLength}
              placeholder="One line that sums up what you teach."
              className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
            />
            <span className="text-xs font-normal text-[var(--color-ink-soft)]">
              {tagline.trim().length}/{maxStorefrontTaglineLength} characters
            </span>
          </label>
        </div>

        <div className="grid gap-3 rounded-[4px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-[var(--color-ink)]">
              Course showcase order
            </p>
            <span className="text-xs font-normal text-[var(--color-ink-soft)]">
              Published courses only
            </span>
          </div>

          {orderedCourses.length === 0 ? (
            <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
              You have no published courses yet. Once a course is published it
              shows up here for ordering.
            </p>
          ) : (
            <ol className="grid gap-2">
              {orderedCourses.map((course, index) => {
                const isFeatured = featuredCourseId === course.id;
                return (
                  <li
                    key={course.id}
                    className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-2.5"
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--color-surface-soft)] text-xs font-semibold text-[var(--color-ink-soft)]">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-ink)]">
                      {course.title}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setFeaturedCourseId(isFeatured ? null : course.id)
                      }
                      aria-pressed={isFeatured}
                      className={`shrink-0 rounded-[8px] border px-2.5 py-1.5 text-xs font-semibold ${
                        isFeatured
                          ? "border-[var(--color-primary)] bg-[rgba(24,58,94,0.08)] text-[var(--color-primary)]"
                          : "border-[var(--color-line)] text-[var(--color-ink-soft)]"
                      }`}
                    >
                      {isFeatured ? "Featured" : "Feature"}
                    </button>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => reorder(index, -1)}
                        disabled={index === 0}
                        aria-label={`Move ${course.title} up`}
                        className="rounded-[8px] border border-[var(--color-line)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-ink-soft)] disabled:opacity-40"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => reorder(index, 1)}
                        disabled={index === orderedCourses.length - 1}
                        aria-label={`Move ${course.title} down`}
                        className="rounded-[8px] border border-[var(--color-line)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-ink-soft)] disabled:opacity-40"
                      >
                        ↓
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {error ? (
          <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
            {error}
          </p>
        ) : null}

        {success ? <p className="info-notice">{success}</p> : null}

        <button
          type="submit"
          disabled={isSaving}
          className="button-solid justify-self-start px-4 py-2.5 text-sm disabled:opacity-60"
        >
          {isSaving ? "Saving..." : "Save storefront"}
        </button>
      </form>
    </section>
  );
}
