"use client";

import { ExternalLink, Eye, EyeOff, Trash2, UploadCloud } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { Button, Card, Field, InlineAlert, buttonClasses } from "@/components/ui";
import type { TeacherCourse } from "@/domain/teacher-course";
import {
  getMyMemberAreaEditor,
  memberAreaCoverUrl,
  memberAreaPath,
  orderMemberAreaProducts,
  removeMemberAreaCover,
  saveMyMemberArea,
  saveMyMemberAreaProducts,
  uploadMemberAreaCover,
  type MemberAreaTheme,
  type MyMemberAreaEditor,
} from "@/lib/data/member-areas";
import { allowedAvatarTypes, isAllowedAvatarFile } from "@/lib/data/profile-media";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";
import { getUserProfile } from "@/lib/data/user-profiles";

const maxName = 80;
const maxWelcome = 2000;
/** Teto de save_my_member_area_products: o resto segue a ordem padrão, visível. */
const maxProducts = 500;

type LoadState = "loading" | "ready" | "error";

const fieldClass =
  "w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]";
const smallButtonClass =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md border border-[var(--color-line)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-ink-soft)] disabled:opacity-40";

/** /teach/member-area: a área que junta todos os produtos do criador. */
export function MemberAreaSettingsPanel() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const uid = user?.uid ?? null;

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [retryKey, setRetryKey] = useState(0);
  const [configured, setConfigured] = useState(false);
  const [creator, setCreator] = useState<{ name: string; username: string | null }>({ name: "", username: null });
  const [name, setName] = useState("");
  const [theme, setTheme] = useState<MemberAreaTheme>("light");
  const [coverPath, setCoverPath] = useState<string | null>(null);
  const [savedCoverPath, setSavedCoverPath] = useState<string | null>(null);
  const [welcome, setWelcome] = useState("");
  const [choices, setChoices] = useState<MyMemberAreaEditor["choices"]>(new Map());
  const [courses, setCourses] = useState<TeacherCourse[] | null>(null);
  const [coursesFailed, setCoursesFailed] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [coverError, setCoverError] = useState<"" | "invalid" | "upload">("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<"" | "saved" | "saveError" | "productsError">("");

  useEffect(() => {
    if (!uid) return;
    let mounted = true;
    Promise.all([getMyMemberAreaEditor(uid), getUserProfile(uid)])
      .then(([editor, profile]) => {
        if (!mounted) return;
        setCreator({ name: profile?.displayName ?? "", username: profile?.username ?? null });
        setConfigured(editor.settings !== null);
        setName(editor.settings?.name ?? "");
        setTheme(editor.settings?.theme ?? "light");
        setCoverPath(editor.settings?.coverPath ?? null);
        setSavedCoverPath(editor.settings?.coverPath ?? null);
        setWelcome(editor.settings?.welcomeText ?? "");
        setChoices(editor.choices);
        setHidden(new Set([...editor.choices].filter(([, choice]) => !choice.visible).map(([id]) => id)));
        setLoadState("ready");
      })
      .catch(() => {
        if (mounted) setLoadState("error");
      });
    return () => {
      mounted = false;
    };
  }, [uid, retryKey]);

  useEffect(() => {
    if (!uid) return;
    return subscribeToTeacherCourses(
      uid,
      (next) => {
        setCourses(next);
        setCoursesFailed(false);
      },
      () => setCoursesFailed(true),
    );
  }, [uid, retryKey]);

  // A ordem salva (ou a padrão); o que o criador mexer aqui vence, e produto
  // novo entra no fim sem desfazer a ordem já arrumada.
  const orderedCourses = useMemo(() => {
    const base = orderMemberAreaProducts(courses ?? [], choices);
    if (order.length === 0) return base;
    const rank = new Map(order.map((id, index) => [id, index]));
    return [...base].sort((a, b) => (rank.get(a.id) ?? order.length) - (rank.get(b.id) ?? order.length));
  }, [courses, choices, order]);

  function move(index: number, direction: -1 | 1) {
    const ids = orderedCourses.map((course) => course.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setOrder(ids);
    setFeedback("");
  }

  function toggleVisible(courseId: string) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
    setFeedback("");
  }

  async function handleCover(file: File | null) {
    if (!uid || !file) return;
    if (!isAllowedAvatarFile(file)) {
      setCoverError("invalid");
      return;
    }
    setCoverError("");
    setUploading(true);
    try {
      // ponytail: capa enviada e trocada antes de salvar fica órfã no bucket.
      // Apagar aqui arriscava apagar a que o banco ainda usa; limpar órfãs é outro trabalho.
      const path = await uploadMemberAreaCover(uid, file);
      setCoverPath(path);
      setFeedback("");
    } catch {
      setCoverError("upload");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!uid) return;
    setSaving(true);
    setFeedback("");
    const previousCover = savedCoverPath;
    try {
      await saveMyMemberArea({ name, theme, coverPath, welcomeText: welcome });
    } catch {
      setFeedback("saveError");
      setSaving(false);
      return;
    }
    // O banco já aponta para a capa nova: a anterior pode sair, mesmo que a
    // lista de produtos falhe logo abaixo.
    setSavedCoverPath(coverPath);
    setConfigured(true);
    if (previousCover && previousCover !== coverPath) {
      void removeMemberAreaCover(previousCover).catch(() => undefined);
    }
    try {
      await saveMyMemberAreaProducts(
        orderedCourses.slice(0, maxProducts).map((course) => ({ courseId: course.id, visible: !hidden.has(course.id) })),
      );
      setFeedback("saved");
    } catch {
      setFeedback("productsError");
    } finally {
      setSaving(false);
    }
  }

  if (loadState === "loading" || !uid) {
    return <p role="status" className="text-sm text-[var(--color-ink-soft)]">{t("teach.memberAreaEditor.loading")}</p>;
  }

  if (loadState === "error") {
    return (
      <div>
        <InlineAlert tone="error">{t("teach.memberAreaEditor.errors.load")}</InlineAlert>
        <Button
          variant="outline"
          className="mt-3"
          onClick={() => {
            setLoadState("loading");
            setRetryKey((current) => current + 1);
          }}
        >
          {t("authFlow.loading.retry")}
        </Button>
      </div>
    );
  }

  const coverUrl = coverPath ? memberAreaCoverUrl(coverPath) : "";

  return (
    <form onSubmit={handleSubmit} className="grid gap-5">
      {/* Travado enquanto salva: sem trocar capa nem texto no meio do envio. */}
      <fieldset disabled={saving} className="grid min-w-0 gap-5">
      {!configured ? <p className="info-notice">{t("teach.memberAreaEditor.virtualNote")}</p> : null}

      <Card padding="sm" shadow={false} className="grid gap-4">
        <Field
          id="member-area-name"
          label={t("teach.memberAreaEditor.name")}
          hint={t("teach.memberAreaEditor.nameHelp").replace("{length}", () => String(name.length))}
        >
          {(a11y) => (
            <input
              {...a11y}
              value={name}
              maxLength={maxName}
              placeholder={creator.name}
              onChange={(event) => {
                setName(event.target.value);
                setFeedback("");
              }}
              className={fieldClass}
            />
          )}
        </Field>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-semibold text-[var(--color-ink)]">{t("teach.memberAreaEditor.theme")}</legend>
          <div className="flex flex-wrap gap-2">
            {(["light", "dark"] as const).map((option) => (
              <label
                key={option}
                className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${
                  theme === option
                    ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                    : "border-[var(--color-line)] text-[var(--color-ink-soft)]"
                }`}
              >
                <input
                  type="radio"
                  name="member-area-theme"
                  value={option}
                  checked={theme === option}
                  onChange={() => {
                    setTheme(option);
                    setFeedback("");
                  }}
                />
                {t(`teach.memberAreaEditor.${option}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:items-center">
          <div className="relative grid aspect-video w-full overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-surface)]">
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <UploadCloud aria-hidden="true" size={22} className="m-auto text-[var(--color-ink-muted)]" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--color-ink)]">{t("teach.memberAreaEditor.cover")}</p>
            <p className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">{t("teach.memberAreaEditor.coverHelp")}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label
                className={`relative inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm font-semibold text-[var(--color-primary)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-primary)] ${
                  uploading ? "pointer-events-none opacity-60" : ""
                }`}
              >
                <UploadCloud aria-hidden="true" size={16} />
                {t(`teach.memberAreaEditor.${uploading ? "uploading" : coverUrl ? "replaceCover" : "uploadCover"}`)}
                <input
                  type="file"
                  accept={allowedAvatarTypes.join(",")}
                  disabled={uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    event.target.value = "";
                    void handleCover(file);
                  }}
                  className="sr-only"
                />
              </label>
              {coverUrl ? (
                <button
                  type="button"
                  onClick={() => {
                    setCoverPath(null);
                    setFeedback("");
                  }}
                  className={smallButtonClass}
                >
                  <Trash2 aria-hidden="true" size={15} />
                  {t("teach.memberAreaEditor.removeCover")}
                </button>
              ) : null}
            </div>
            {coverError ? (
              <p role="alert" className="mt-2 text-xs text-[var(--color-danger-fg)]">
                {t(`teach.memberAreaEditor.errors.${coverError === "invalid" ? "coverInvalid" : "coverUpload"}`)}
              </p>
            ) : null}
          </div>
        </div>

        <Field
          id="member-area-welcome"
          label={t("teach.memberAreaEditor.welcome")}
          hint={t("teach.memberAreaEditor.welcomeHelp").replace("{length}", () => String(welcome.length))}
        >
          {(a11y) => (
            <textarea
              {...a11y}
              value={welcome}
              rows={4}
              maxLength={maxWelcome}
              placeholder={t("teach.memberAreaEditor.welcomePlaceholder")}
              onChange={(event) => {
                setWelcome(event.target.value);
                setFeedback("");
              }}
              className={fieldClass}
            />
          )}
        </Field>
      </Card>

      <Card tone="soft" padding="sm" shadow={false} className="grid gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--color-ink)]">{t("teach.memberAreaEditor.products")}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">{t("teach.memberAreaEditor.productsHelp")}</p>
          {orderedCourses.length > maxProducts ? (
            <p className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">
              {t("teach.memberAreaEditor.tooManyProducts").replace("{max}", () => String(maxProducts))}
            </p>
          ) : null}
        </div>
        {coursesFailed ? (
          <InlineAlert tone="error">{t("teach.memberAreaEditor.errors.courses")}</InlineAlert>
        ) : courses === null ? (
          <p role="status" className="text-xs text-[var(--color-ink-soft)]">{t("teach.memberAreaEditor.loading")}</p>
        ) : orderedCourses.length === 0 ? (
          <p className="text-xs text-[var(--color-ink-soft)]">{t("teach.memberAreaEditor.noProducts")}</p>
        ) : (
          <ol className="grid grid-cols-1 gap-2">
            {orderedCourses.map((course, index) => {
              const visible = !hidden.has(course.id);
              const label = course.title.trim() || t("teacherMembers.untitled");
              const title = () => label;
              return (
                <li
                  key={course.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5"
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--color-surface-soft)] text-xs font-semibold text-[var(--color-ink-soft)]">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 basis-[calc(100%_-_2.25rem)] sm:basis-0">
                    <span className={`block truncate text-sm font-semibold ${visible ? "text-[var(--color-ink)]" : "text-[var(--color-ink-muted)]"}`}>
                      {label}
                    </span>
                    {course.status !== "published" ? (
                      <span className="block text-xs text-[var(--color-ink-soft)]">{t("teach.memberAreaEditor.notPublished")}</span>
                    ) : null}
                  </span>
                  <label className={`${smallButtonClass} cursor-pointer`}>
                    <input
                      type="checkbox"
                      checked={visible}
                      onChange={() => toggleVisible(course.id)}
                      className="size-4 accent-[var(--color-primary)]"
                    />
                    {visible ? <Eye aria-hidden="true" size={15} /> : <EyeOff aria-hidden="true" size={15} />}
                    {t("teach.memberAreaEditor.visible")}
                    <span className="sr-only">: {title()}</span>
                  </label>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label={t("teach.memberAreaEditor.moveUp").replace("{title}", title)}
                      className={smallButtonClass}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === orderedCourses.length - 1}
                      aria-label={t("teach.memberAreaEditor.moveDown").replace("{title}", title)}
                      className={smallButtonClass}
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

      </fieldset>

      {feedback === "saveError" || feedback === "productsError" ? (
        <InlineAlert tone="error">
          {t(`teach.memberAreaEditor.errors.${feedback === "saveError" ? "save" : "saveProducts"}`)}
        </InlineAlert>
      ) : null}
      {feedback === "saved" ? <p role="status" className="info-notice">{t("teach.memberAreaEditor.saved")}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={saving || uploading || courses === null || coursesFailed}>
          {t(`teach.memberAreaEditor.${saving ? "saving" : "save"}`)}
        </Button>
        <Link
          href={memberAreaPath({ username: creator.username, ownerId: uid })}
          target="_blank"
          rel="noopener"
          className={buttonClasses({ variant: "outline" })}
        >
          <ExternalLink aria-hidden="true" size={15} />
          {t("teach.memberAreaEditor.previewAsStudent")}
        </Link>
      </div>
      <p className="text-xs text-[var(--color-ink-soft)]">{t("teach.memberAreaEditor.previewHelp")}</p>
    </form>
  );
}
