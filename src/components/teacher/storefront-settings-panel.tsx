"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import {
  Button,
  Card,
  Field,
  InlineAlert,
  SectionHeader,
  buttonClasses,
} from "@/components/ui";
import type {
  StorefrontConfig,
  StorefrontThemePreset,
} from "@/domain/user-profile";
import {
  instructorPagePath,
  isStorefrontHexColor,
  maxStorefrontTaglineLength,
  storefrontThemePresets,
} from "@/domain/user-profile";
import type { TeacherCourse } from "@/domain/teacher-course";
import {
  allowedAvatarTypes,
  isAllowedAvatarFile,
  removeUserStorefrontImage,
  uploadUserStorefrontImage,
  type StorefrontImageKind,
  type UploadAvatarProgress,
} from "@/lib/data/profile-media";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";
import { getUserProfile, updateUserStorefront } from "@/lib/data/user-profiles";
import { SavedNote } from "@/components/teacher/save-status-line";
import { BusyLabel } from "@/components/ui/busy-label";
import { ImageUploadField } from "@/components/teacher/image-upload-field";

type StorefrontImageError = "" | "invalid" | "upload";
type StorefrontError = "" | "load" | "signIn" | "accent" | "tagline" | "cleanup" | "save";
type StorefrontSuccess = "" | "logoUploaded" | "heroUploaded" | "removalPending" | "saved";

const defaultAccentColor = "#183a5e";

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

function StorefrontImageUpload({
  description,
  error,
  imageUrl,
  isUploading,
  kind,
  label,
  progress,
  onChange,
  onRemove,
}: {
  description: string;
  error: string;
  imageUrl: string;
  isUploading: boolean;
  kind: StorefrontImageKind;
  label: string;
  progress: UploadAvatarProgress | null;
  onChange: (file: File | null) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const uploadLabel = t(`teach.storefrontEditor.image.${kind === "logo" ? "uploadLogo" : "uploadHero"}`);
  const removeLabel = t(`teach.storefrontEditor.image.${kind === "logo" ? "removeLogo" : "removeHero"}`);

  // The single image shell (B-05), like the cover of the members area. The upload,
  // the types, the limit and what gets stored stay in the panel. The URLs come from the
  // app's Storage: the shell uses <img>, which accepts the cache-busting query.
  return (
    <ImageUploadField
      title={label}
      help={`${description} ${t("teach.storefrontEditor.image.requirements")}.`}
      // Same frames as before: logo 1:1 whole, with some padding; cover 16:7.
      preview={kind === "logo"
        ? { src: imageUrl, alt: "", frame: "aspect-square w-24", contain: true }
        : { src: imageUrl, alt: "", frame: "aspect-[16/7] w-full max-w-[200px]" }}
      // F-20: stable label; the progress stays only in the note below.
      triggerLabel={t(`teach.storefrontEditor.image.${imageUrl ? "replace" : "upload"}`)}
      input={{
        accept: allowedAvatarTypes.join(","),
        disabled: isUploading,
        "aria-label": uploadLabel,
        onChange: (event) => {
          const file = event.target.files?.[0] ?? null;
          // Reset the choice: the same file can be chosen again.
          event.target.value = "";
          onChange(file);
        },
      }}
      // Out of view during the whole upload: the progress only arrives after
      // the first upload notice, and until then the shell would still show Remove.
      remove={isUploading ? undefined : { label: removeLabel, onClick: onRemove }}
      progress={progress}
      // The error appears next to the button that triggered it, announced to the screen reader.
      error={error}
      className="border-t border-[var(--color-line)] pt-4"
    />
  );
}

export function StorefrontSettingsPanel() {
  const { user } = useAuth();
  const { t } = useTranslation();

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState<string | null>(null);
  const [accentColor, setAccentColor] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [heroImageUrl, setHeroImageUrl] = useState("");
  const [themePreset, setThemePreset] = useState<StorefrontThemePreset>("default");
  const [tagline, setTagline] = useState("");
  const [orderedCourseIds, setOrderedCourseIds] = useState<string[]>([]);
  const [featuredCourseId, setFeaturedCourseId] = useState<string | null>(null);

  const [publishedCourses, setPublishedCourses] = useState<TeacherCourse[]>([]);
  const [courseLoadState, setCourseLoadState] = useState<"loading" | "ready" | "error">("loading");
  const coursesSubscription = useRef<{ reload: () => Promise<void> } | null>(null);
  const coursesReady = courseLoadState === "ready";

  const [isLoading, setIsLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingImages, setUploadingImages] = useState<
    ReadonlySet<StorefrontImageKind>
  >(() => new Set());
  const [uploadProgress, setUploadProgress] = useState<
    Partial<Record<StorefrontImageKind, UploadAvatarProgress>>
  >({});
  // Why Save is disabled (besides "saving", which the label already says).
  const saveBlockedKey = uploadingImages.size > 0
    ? "saveWaitUpload"
    : !coursesReady
      ? "saveWaitCourses"
      : null;
  const [pendingImageRemovals, setPendingImageRemovals] = useState<
    ReadonlySet<StorefrontImageKind>
  >(() => new Set());
  // An image failure stays in its field; `error` is only for load/save.
  const [imageErrors, setImageErrors] = useState<
    Partial<Record<StorefrontImageKind, StorefrontImageError>>
  >({});
  const [error, setError] = useState<StorefrontError>("");
  const [success, setSuccess] = useState<StorefrontSuccess>("");
  // Any edit after saving removes the "Storefront saved." message: the sentence only
  // holds for what was saved. The neutral notices ("save to publish")
  // are still true and stay.
  const clearSaved = () => setSuccess((current) => (current === "saved" ? "" : current));

  function setImageError(kind: StorefrontImageKind, message: StorefrontImageError) {
    setImageErrors((current) => ({ ...current, [kind]: message }));
  }

  function imageErrorText(kind: StorefrontImageKind) {
    const code = imageErrors[kind];
    return code
      ? t(`teach.storefrontEditor.image.errors.${code}`)
          .replace("{requirements}", () => t("teach.storefrontEditor.image.requirements"))
      : "";
  }

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

        setDisplayName(profile?.displayName ?? "");
        setUsername(profile?.username ?? null);
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
          setError("load");
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
  }, [user, retryKey]);

  // Live list of this teacher's courses to drive the showcase ordering.
  useEffect(() => {
    if (!user) {
      return;
    }

    const current = subscribeToTeacherCourses(
      user.uid,
      (courses) => {
        setPublishedCourses(
          courses.filter((course) => course.status === "published"),
        );
        setCourseLoadState("ready");
      },
      () => {
        setCourseLoadState("error");
      },
    );
    coursesSubscription.current = current;

    return () => {
      coursesSubscription.current = null;
      current();
    };
  }, [user]);

  // "Try again" reads again through the same channel (reload), as on the other screens:
  // without the gap between leaving and rejoining Realtime and without a second
  // read for free.
  function retryCourses() {
    setCourseLoadState("loading");
    void coursesSubscription.current?.reload();
  }

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
    clearSaved();
  }

  async function handleStorefrontImageChange(
    kind: StorefrontImageKind,
    file: File | null,
  ) {
    if (!user || !file) {
      return;
    }

    if (!isAllowedAvatarFile(file)) {
      setImageError(kind, "invalid");
      return;
    }

    setImageError(kind, "");
    setSuccess("");
    setUploadProgress((current) => {
      const next = { ...current };
      delete next[kind];
      return next;
    });
    setUploadingImages((current) => new Set(current).add(kind));

    try {
      const uploadedUrl = await uploadUserStorefrontImage(
        user.uid,
        kind,
        file,
        (progress) =>
          setUploadProgress((current) => ({ ...current, [kind]: progress })),
      );

      if (kind === "logo") {
        setLogoUrl(uploadedUrl);
      } else {
        setHeroImageUrl(uploadedUrl);
      }
      setPendingImageRemovals((current) => {
        const next = new Set(current);
        next.delete(kind);
        return next;
      });
      setSuccess(kind === "logo" ? "logoUploaded" : "heroUploaded");
    } catch (uploadError) {
      console.error("Storefront image upload failed", { uid: user.uid, kind }, uploadError);
      setImageError(kind, "upload");
    } finally {
      setUploadingImages((current) => {
        const next = new Set(current);
        next.delete(kind);
        return next;
      });
      setUploadProgress((current) => {
        const next = { ...current };
        delete next[kind];
        return next;
      });
    }
  }

  function handleStorefrontImageRemove(kind: StorefrontImageKind) {
    if (kind === "logo") {
      setLogoUrl("");
    } else {
      setHeroImageUrl("");
    }
    setPendingImageRemovals((current) => new Set(current).add(kind));
    setImageError(kind, "");
    setSuccess("removalPending");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!coursesReady) {
      return;
    }

    if (!user) {
      setError("signIn");
      return;
    }

    const trimmedAccent = accentColor.trim();
    const trimmedLogo = logoUrl.trim();
    const trimmedHero = heroImageUrl.trim();
    const trimmedTagline = tagline.trim();

    const validationError: StorefrontError =
      (trimmedAccent && !isStorefrontHexColor(trimmedAccent)
        ? "accent"
        : "") ||
      (trimmedTagline.length > maxStorefrontTaglineLength
        ? "tagline"
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
      const removals = [...pendingImageRemovals];
      const results = await Promise.allSettled(
        removals.map((kind) => removeUserStorefrontImage(user.uid, kind)),
      );
      const removedKinds = removals.filter(
        (_, index) => results[index]?.status === "fulfilled",
      );
      const cleanupFailed = results.some(
        (result) => result.status === "rejected",
      );

      if (removedKinds.length > 0) {
        setPendingImageRemovals((current) => {
          const next = new Set(current);
          removedKinds.forEach((kind) => next.delete(kind));
          return next;
        });
      }

      setSuccess("saved");
      if (cleanupFailed) {
        setError("cleanup");
      }
    } catch {
      setError("save");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    // The shape of the screen (title, storefront preview, fields) in place of the loose
    // sentence, which later became the whole screen at once. The sentence is left for the
    // screen reader.
    const bone = "rounded-md bg-[var(--color-surface-strong)]";
    return (
      <section className="settings-section-card">
        <div role="status" data-skeleton="storefront">
          <span className="sr-only">{t("teach.storefrontEditor.loading")}</span>
          <div aria-hidden="true" className="grid animate-pulse gap-6">
            <div className="grid gap-2">
              <div className={`h-6 w-48 ${bone}`} />
              <div className={`h-4 w-full max-w-xl ${bone}`} />
            </div>
            <div className={`h-32 ${bone}`} />
            {/* The same two cards as the form (color, logo, cover, theme and
                sentence; then the course order) and the button. With only three fields,
                the skeleton was 531px against ~1,690px on a phone, and the
                "Your own domain" card right below jumped off the screen. */}
            <div className="grid gap-4 rounded-lg border border-[var(--color-line)] p-4">
              {["h-11", "h-28", "h-28", "h-11", "h-24"].map((height, item) => (
                <div key={item} className="grid gap-2">
                  <div className={`h-3 w-28 ${bone}`} />
                  <div className={`${height} ${bone}`} />
                </div>
              ))}
            </div>
            <div className="grid gap-2 rounded-lg border border-[var(--color-line)] p-4">
              <div className={`h-3 w-36 ${bone}`} />
              {/* The same 2 h-16 blocks that the card shows while the courses arrive. */}
              {[0, 1].map((item) => (
                <div key={item} className={`h-16 ${bone}`} />
              ))}
            </div>
            <div className={`h-11 w-36 ${bone}`} />
          </div>
        </div>
      </section>
    );
  }

  // A failed read is not an empty configuration the teacher can overwrite.
  if (error === "load") {
    return (
      <section className="settings-section-card">
        <InlineAlert tone="error">{t("teach.storefrontEditor.errors.load")}</InlineAlert>
        <Button
          variant="outline"
          className="mt-3"
          onClick={() => {
            setIsLoading(true);
            setError("");
            setRetryKey((current) => current + 1);
          }}
        >
          {t("authFlow.loading.retry")}
        </Button>
      </section>
    );
  }

  const previewAccent =
    accentColor.trim() && isStorefrontHexColor(accentColor.trim())
      ? accentColor.trim()
      : defaultAccentColor;

  // The storefront is only live when there is a published course in it — same rule as the
  // Home and Marketing cards. While there is none, the sentence about the later step
  // stays true; with a published course it would become a lie.
  const isPublished = publishedCourses.length > 0;
  const publicPath = user ? instructorPagePath(user.uid, username) : "";

  return (
    <section className="settings-section-card">
      {/* Card title, without repeating the page's "Teacher Studio" label. */}
      <SectionHeader
        size="card"
        title={t("teach.storefrontEditor.title")}
        description={`${t("teach.storefrontEditor.description")}${
          !coursesReady || isPublished ? "" : ` ${t("teach.storefrontPage.laterStep")}`
        }`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {coursesReady ? <span
              className={`status-chip ${isPublished ? "status-chip--success" : "status-chip--draft"}`}
            >
              <span className="status-chip__dot" aria-hidden="true" />
              {t(
                isPublished
                  ? "teach.storefrontPage.published"
                  : "teach.storefrontPage.notPublished",
              )}
            </span> : null}
            {publicPath ? (
              <Link
                href={publicPath}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses({ variant: "outline", size: "sm" }, "relative")}
              >
                {t("teach.storefrontPage.openPublicPage")}
                <ExternalLink aria-hidden="true" size={14} strokeWidth={1.9} />
                <span className="sr-only">{t("platform.opensInNewTab")}</span>
              </Link>
            ) : null}
          </div>
        }
      />

      {/* Live brand preview — how your storefront header reads at a glance.
          With an accessible name: it was an anonymous block, and anyone using a screen reader
          had no way to know that it was the storefront preview. */}
      <section
        aria-label={t("teach.storefrontPage.previewLabel")}
        className="mt-6 overflow-hidden rounded-lg border border-[var(--color-line)] shadow-[var(--shadow-soft)]"
      >
        <div className="relative flex min-h-32 items-center gap-4 overflow-hidden bg-[#102a43] px-5 py-6 sm:px-7">
          {heroImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={heroImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : null}
          <span className="absolute inset-0 bg-[rgba(10,24,43,0.66)]" aria-hidden="true" />
          <span className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-md bg-white/10 text-xl font-bold text-white ring-1 ring-white/20">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={t("teach.storefrontEditor.image.previewAlt")}
                className="h-full w-full object-contain p-1"
              />
            ) : (
              (displayName.trim()[0] ?? "S").toUpperCase()
            )}
          </span>
          <span className="relative min-w-0">
            <span className="block truncate text-base font-bold text-white">
              {displayName.trim() || t("teach.storefrontEditor.previewName")}
            </span>
            <span className="mt-1 block max-w-md truncate text-sm text-white/70">
              {tagline.trim() || t("teach.storefrontEditor.taglinePlaceholder")}
            </span>
            {/* The preview lied by omission: it showed the brand and none of the catalog,
                which is what the buyer actually sees on the storefront. */}
            {coursesReady ? <span className="mt-2 block max-w-md truncate text-xs text-white/60">
              {orderedCourses.length === 0
                ? t("teach.storefrontPage.previewNoCourse")
                : `${t(
                    orderedCourses.length === 1
                      ? "teach.storefrontPage.previewCoursesOne"
                      : "teach.storefrontPage.previewCoursesMany",
                   ).replace("{count}", () => String(orderedCourses.length))}: ${orderedCourses
                    .slice(0, 3)
                    .map((course) => course.title)
                    .join(", ")}`}
            </span> : null}
          </span>
        </div>
        <div className="h-1.5" style={{ background: previewAccent }} />
      </section>

      {/* onChange on the form: catches the change of any field (color, theme, sentence,
          image) without touching what each field saves. */}
      <form className="mt-6 grid gap-5" onSubmit={handleSubmit} onChange={clearSaved}>
        <Card tone="soft" padding="sm" shadow={false} className="grid gap-4">
          <p className="text-sm font-semibold text-[var(--color-ink)]">
            {t("teach.storefrontEditor.brand")}
          </p>

          <Field
            id="storefront-accent-color"
            label={t("teach.storefrontEditor.accentLabel")}
            hint={t("teach.storefrontEditor.accentHint")}
          >
            {(a11y) => (
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={previewAccent}
                  onChange={(event) => setAccentColor(event.target.value)}
                  aria-label={t("teach.storefrontEditor.accentPicker")}
                  className="h-11 w-14 shrink-0 cursor-pointer rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-1"
                />
                <input
                  {...a11y}
                  value={accentColor}
                  onChange={(event) => setAccentColor(event.target.value)}
                  placeholder="#183a5e"
                  spellCheck={false}
                  className="field-input min-w-0 flex-1"
                />
              </div>
            )}
          </Field>

          <StorefrontImageUpload
            kind="logo"
            label={t("teach.storefrontEditor.image.logoLabel")}
            description={t("teach.storefrontEditor.image.logoDescription")}
            imageUrl={logoUrl}
            error={imageErrorText("logo")}
            isUploading={uploadingImages.has("logo")}
            progress={uploadProgress.logo ?? null}
            onChange={(file) => void handleStorefrontImageChange("logo", file)}
            onRemove={() => handleStorefrontImageRemove("logo")}
          />

          <StorefrontImageUpload
            kind="hero"
            label={t("teach.storefrontEditor.image.heroLabel")}
            description={t("teach.storefrontEditor.image.heroDescription")}
            imageUrl={heroImageUrl}
            error={imageErrorText("hero")}
            isUploading={uploadingImages.has("hero")}
            progress={uploadProgress.hero ?? null}
            onChange={(file) => void handleStorefrontImageChange("hero", file)}
            onRemove={() => handleStorefrontImageRemove("hero")}
          />

          <Field id="storefront-theme-preset" label={t("teach.storefrontEditor.themeLabel")}>
            {(a11y) => (
              <select
                {...a11y}
                value={themePreset}
                onChange={(event) =>
                  setThemePreset(event.target.value as StorefrontThemePreset)
                }
                className="field-input"
              >
                {storefrontThemePresets.map((preset) => (
                  <option key={preset} value={preset}>
                    {t(`teach.storefrontEditor.presets.${preset}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field id="storefront-tagline" label={t("teach.storefrontEditor.taglineLabel")}>
            {(a11y) => (
              <>
                <textarea
                  {...a11y}
                  value={tagline}
                  onChange={(event) => setTagline(event.target.value)}
                  rows={2}
                  maxLength={maxStorefrontTaglineLength}
                  placeholder={t("teach.storefrontEditor.taglinePlaceholder")}
                  className="field-input resize-none"
                />
                <span className="text-xs font-normal text-[var(--color-ink-soft)]">
                  {t("teach.storefrontEditor.characters")
                    .replace("{count}", () => String(tagline.trim().length))
                    .replace("{max}", () => String(maxStorefrontTaglineLength))}
                </span>
              </>
            )}
          </Field>
        </Card>

        <Card tone="soft" padding="sm" shadow={false} className="grid gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-[var(--color-ink)]">
              {t("teach.storefrontEditor.courseOrder")}
            </p>
            <span className="text-xs font-normal text-[var(--color-ink-soft)]">
              {t("teach.storefrontEditor.publishedOnly")}
            </span>
          </div>

          {courseLoadState === "loading" ? (
            // Two lines in place of the course lines, instead of the loose sentence.
            <div role="status" className="grid gap-2">
              <span className="sr-only">{t("publicCourses.loadingCourses")}</span>
              {[0, 1].map((item) => (
                <div key={item} aria-hidden="true" className="h-16 animate-pulse rounded-md bg-[var(--color-surface-strong)]" />
              ))}
            </div>
          ) : courseLoadState === "error" ? (
            <div>
              <InlineAlert tone="error">{t("teach.storefrontEditor.errors.courses")}</InlineAlert>
              <Button
                variant="outline"
                className="mt-3"
                onClick={retryCourses}
              >
                {t("authFlow.loading.retry")}
              </Button>
            </div>
          ) : orderedCourses.length === 0 ? (
            <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
              {t("teach.storefrontEditor.noCourses")}
            </p>
          ) : (
            <ol className="grid grid-cols-1 gap-2">
              {orderedCourses.map((course, index) => {
                const isFeatured = featuredCourseId === course.id;
                return (
                  <li
                    key={course.id}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5"
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--color-surface-soft)] text-xs font-semibold text-[var(--color-ink-soft)]">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 basis-[calc(100%_-_2.25rem)] truncate text-sm font-semibold text-[var(--color-ink)] sm:basis-0">
                      {course.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setFeaturedCourseId(isFeatured ? null : course.id);
                        clearSaved();
                      }}
                      aria-pressed={isFeatured}
                      className={`min-h-11 shrink-0 rounded-md border px-2.5 py-1.5 text-xs font-semibold ${
                        isFeatured
                          ? "border-[var(--color-primary)] bg-[rgba(24,58,94,0.08)] text-[var(--color-primary)]"
                          : "border-[var(--color-line)] text-[var(--color-ink-soft)]"
                      }`}
                    >
                      {t(`teach.storefrontEditor.${isFeatured ? "featured" : "feature"}`)}
                    </button>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => reorder(index, -1)}
                        disabled={index === 0}
                        aria-label={t("teach.storefrontEditor.moveUp").replace("{title}", () => course.title)}
                        className="min-h-11 min-w-11 rounded-md border border-[var(--color-line)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-ink-soft)] disabled:opacity-60"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => reorder(index, 1)}
                        disabled={index === orderedCourses.length - 1}
                        aria-label={t("teach.storefrontEditor.moveDown").replace("{title}", () => course.title)}
                        className="min-h-11 min-w-11 rounded-md border border-[var(--color-line)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-ink-soft)] disabled:opacity-60"
                      >
                        ↓
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        {error ? (
          <InlineAlert tone="error">
            {t(`teach.storefrontEditor.errors.${error}`)
              .replace("{max}", () => String(maxStorefrontTaglineLength))}
          </InlineAlert>
        ) : null}

        {/* The blue box is kept only for the neutral notice ("image uploaded, save
            to publish"); the "saved" message goes next to the button, without pushing it. */}
        {success && success !== "saved" ? (
          <p className="info-notice">{t(`teach.storefrontEditor.feedback.${success}`)}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={isSaving || uploadingImages.size > 0 || !coursesReady}
            aria-describedby={saveBlockedKey && !isSaving ? "storefront-save-reason" : undefined}
          >
            <BusyLabel
              busy={isSaving}
              idle={t("teach.storefrontEditor.save")}
              busyText={t("teach.storefrontEditor.saving")}
            />
          </Button>
          {/* The button used to turn gray without saying why (image uploading, products
              still loading): now the reason sits next to it. */}
          {saveBlockedKey && !isSaving ? (
            <p id="storefront-save-reason" className="text-xs leading-5 text-[var(--color-ink-soft)]">
              {t(`teach.storefrontEditor.${saveBlockedKey}`)}
            </p>
          ) : null}
          {success === "saved" ? <SavedNote text={t("teach.storefrontEditor.feedback.saved")} /> : null}
        </div>
      </form>
    </section>
  );
}
