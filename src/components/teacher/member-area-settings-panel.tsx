"use client";

import { ExternalLink, Eye, EyeOff, Plus, Trash2, UploadCloud, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { Button, Card, Field, InlineAlert, buttonClasses } from "@/components/ui";
import type { PlanId } from "@/data/plans";
import { planEntitlements } from "@/domain/entitlements";
import type { TeacherCourse } from "@/domain/teacher-course";
import {
  createMyMemberArea,
  deleteMyMemberArea,
  getMyMemberAreas,
  isValidMemberAreaSlug,
  memberAreaCoverUrl,
  memberAreaPath,
  memberAreaProductsOf,
  orderMemberAreaProducts,
  removeMemberAreaCover,
  saveMyMemberArea,
  saveMyMemberAreaProducts,
  setMyMemberAreaCommunity,
  uploadMemberAreaCover,
  type CreateMemberAreaError,
  type MemberAreaTheme,
  type MyMemberAreaEditorArea,
  type MyMemberAreas,
} from "@/lib/data/member-areas";
import { allowedAvatarTypes, isAllowedAvatarFile } from "@/lib/data/profile-media";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";
import { getUserProfile } from "@/lib/data/user-profiles";

const maxName = 80;
const maxWelcome = 2000;
/** Teto de save_my_member_area_products: o resto segue a ordem padrão, visível. */
const maxProducts = 500;
/** A principal não tem id enquanto é virtual: esta é a chave dela na tela. */
const mainKey = "main";

type LoadState = "loading" | "ready" | "error";
type Creator = { name: string; username: string | null };

const fieldClass =
  "w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]";
const smallButtonClass =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md border border-[var(--color-line)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-ink-soft)] disabled:opacity-40";

const areaKey = (area: MyMemberAreaEditorArea) => (area.slug === null ? mainKey : (area.id ?? mainKey));

/**
 * /teach/member-area: as áreas do criador. A principal junta todos os
 * produtos; no Pro há até 2 extras, cada uma só com os produtos postos nela.
 */
export function MemberAreaSettingsPanel() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const uid = user?.uid ?? null;

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [retryKey, setRetryKey] = useState(0);
  const [editor, setEditor] = useState<MyMemberAreas | null>(null);
  const [creator, setCreator] = useState<Creator>({ name: "", username: null });
  const [planId, setPlanId] = useState<PlanId>("free");
  const [courses, setCourses] = useState<TeacherCourse[] | null>(null);
  const [coursesFailed, setCoursesFailed] = useState(false);
  const [selected, setSelected] = useState(mainKey);
  const [creating, setCreating] = useState(false);

  async function reload(nextSelected?: string) {
    if (!uid) return;
    try {
      setEditor(await getMyMemberAreas(uid));
      if (nextSelected) setSelected(nextSelected);
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    if (!uid) return;
    let mounted = true;
    Promise.all([getMyMemberAreas(uid), getUserProfile(uid)])
      .then(([next, profile]) => {
        if (!mounted) return;
        setCreator({ name: profile?.displayName ?? "", username: profile?.username ?? null });
        // Sem perfil, o plano mais apertado: a tela oferece menos do que o
        // banco aceita, nunca mais.
        setPlanId(profile?.currentPlanId ?? "free");
        setEditor(next);
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

  if (!uid || !editor) {
    return <p role="status" className="text-sm text-[var(--color-ink-soft)]">{t("teach.memberAreaEditor.loading")}</p>;
  }

  // A principal conta como 1. Extra além do limite (o plano caiu) fica no ar
  // para o aluno e travada aqui; o banco decide de verdade (member_area_editable).
  const limit = planEntitlements[planId].quotas.memberAreas ?? 1;
  const extras = editor.areas.slice(1);
  const lockedIds = new Set(extras.slice(Math.max(0, limit - 1)).map((area) => area.id));
  const area = editor.areas.find((candidate) => areaKey(candidate) === selected) ?? editor.areas[0];
  const atLimit = editor.areas.length >= limit;
  const areaLabel = (candidate: MyMemberAreaEditorArea) =>
    candidate.slug === null
      ? t("teach.memberAreaEditor.mainArea")
      : candidate.settings?.name?.trim() || candidate.slug;

  return (
    <div className="grid gap-5">
      <Card padding="sm" shadow={false} className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-[var(--color-ink)]">{t("teach.memberAreaEditor.areas")}</p>
          <p className="text-xs text-[var(--color-ink-soft)]">
            {t("teach.memberAreaEditor.areasUsage")
              .replace("{used}", () => String(editor.areas.length))
              .replace("{limit}", () => String(limit))}
          </p>
        </div>
        <div role="tablist" aria-label={t("teach.memberAreaEditor.areas")} className="flex flex-wrap gap-2">
          {editor.areas.map((candidate) => {
            const key = areaKey(candidate);
            const active = key === areaKey(area);
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setSelected(key);
                  setCreating(false);
                }}
                className={`inline-flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${
                  active
                    ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                    : "border-[var(--color-line)] text-[var(--color-ink-soft)]"
                }`}
              >
                {areaLabel(candidate)}
              </button>
            );
          })}
          {!atLimit ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-dashed border-[var(--color-line)] px-3 py-2 text-sm font-semibold text-[var(--color-primary)]"
            >
              <Plus aria-hidden="true" size={15} />
              {t("teach.memberAreaEditor.newArea")}
            </button>
          ) : null}
        </div>
        {atLimit ? (
          <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
            {limit > 1
              ? t("teach.memberAreaEditor.areasLimitPro")
              : t("teach.memberAreaEditor.areasLimit").replace("{limit}", () => String(limit))}
          </p>
        ) : null}
        {creating && !atLimit ? (
          <NewAreaForm
            basePath={memberAreaPath({ username: creator.username, ownerId: uid })}
            onCancel={() => setCreating(false)}
            onCreated={(id) => {
              setCreating(false);
              void reload(id);
            }}
          />
        ) : null}
      </Card>

      <MemberAreaForm
        key={areaKey(area)}
        uid={uid}
        area={area}
        editor={editor}
        courses={courses}
        coursesFailed={coursesFailed}
        creator={creator}
        locked={area.id !== null && lockedIds.has(area.id)}
        lockedIds={lockedIds}
        areaLabel={areaLabel}
        onSaved={() => reload()}
        onDeleted={() => void reload(mainKey)}
      />
    </div>
  );
}

function NewAreaForm({
  basePath,
  onCancel,
  onCreated,
}: {
  basePath: string;
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CreateMemberAreaError | "">("");

  async function handleCreate() {
    if (!isValidMemberAreaSlug(slug)) {
      setError("slugInvalid");
      return;
    }
    setBusy(true);
    setError("");
    try {
      onCreated(await createMyMemberArea(name, slug));
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : "";
      setError(reason === "limit" || reason === "slugInvalid" || reason === "slugTaken" ? reason : "other");
      setBusy(false);
    }
  }

  const errorKey = { limit: "createLimit", slugInvalid: "slugInvalid", slugTaken: "slugTaken", other: "create" } as const;

  return (
    <div className="grid gap-3 rounded-md border border-[var(--color-line)] p-3">
      <Field id="member-area-new-name" label={t("teach.memberAreaEditor.newAreaName")}>
        {(a11y) => (
          <input {...a11y} value={name} maxLength={maxName} onChange={(event) => setName(event.target.value)} className={fieldClass} />
        )}
      </Field>
      <Field
        id="member-area-new-slug"
        label={t("teach.memberAreaEditor.newAreaSlug")}
        hint={t("teach.memberAreaEditor.newAreaSlugHelp").replace("{path}", () => `${basePath}/${slug || "..."}`)}
      >
        {(a11y) => (
          <input
            {...a11y}
            value={slug}
            maxLength={40}
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => {
              setSlug(event.target.value.toLowerCase().replace(/\s+/g, "-"));
              setError("");
            }}
            className={fieldClass}
          />
        )}
      </Field>
      {error ? <InlineAlert tone="error">{t(`teach.memberAreaEditor.errors.${errorKey[error]}`)}</InlineAlert> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy || !slug} onClick={() => void handleCreate()}>
          {t(`teach.memberAreaEditor.${busy ? "creating" : "create"}`)}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          {t("teach.memberAreaEditor.cancel")}
        </Button>
      </div>
    </div>
  );
}

/** O formulário de uma área. Montado de novo a cada troca de área (key). */
function MemberAreaForm({
  uid,
  area,
  editor,
  courses,
  coursesFailed,
  creator,
  locked,
  lockedIds,
  areaLabel,
  onSaved,
  onDeleted,
}: {
  uid: string;
  area: MyMemberAreaEditorArea;
  editor: MyMemberAreas;
  courses: TeacherCourse[] | null;
  coursesFailed: boolean;
  creator: Creator;
  locked: boolean;
  lockedIds: ReadonlySet<string | null>;
  areaLabel: (area: MyMemberAreaEditorArea) => string;
  /** Relê as áreas: o que entrou ou saiu desta lista mudou de área. */
  onSaved: () => Promise<void>;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const isExtra = area.slug !== null;

  const [name, setName] = useState(area.settings?.name ?? "");
  const [theme, setTheme] = useState<MemberAreaTheme>(area.settings?.theme ?? "light");
  const [coverPath, setCoverPath] = useState<string | null>(area.settings?.coverPath ?? null);
  const [savedCoverPath, setSavedCoverPath] = useState<string | null>(area.settings?.coverPath ?? null);
  const [welcome, setWelcome] = useState(area.settings?.welcomeText ?? "");
  const [order, setOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set([...editor.placement].filter(([, place]) => place.areaId === area.id && !place.visible).map(([id]) => id)),
  );
  // Só nas extras: o que entrou (veio de outra área) e o que saiu (volta para a principal).
  const [added, setAdded] = useState<string[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [coverError, setCoverError] = useState<"" | "invalid" | "upload">("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<"" | "saved" | "saveError" | "productsError" | "communityError">("");
  const [communityCourseId, setCommunityCourseId] = useState<string>(area.communityCourseId ?? "");
  const [savedOnce, setSavedOnce] = useState(false);
  const configured = area.settings !== null || savedOnce;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);

  const own = useMemo(() => memberAreaProductsOf(courses ?? [], editor, area), [courses, editor, area]);

  // A ordem salva (ou a padrão); o que o criador mexer aqui vence, e produto
  // novo entra no fim sem desfazer a ordem já arrumada.
  const orderedCourses = useMemo(() => {
    const addedCourses = (courses ?? []).filter((course) => added.includes(course.id) && !own.courses.includes(course));
    const base = [
      ...orderMemberAreaProducts(own.courses.filter((course) => !removed.has(course.id)), own.choices),
      ...added.flatMap((id) => addedCourses.filter((course) => course.id === id)),
    ];
    if (order.length === 0) return base;
    const rank = new Map(order.map((id, index) => [id, index]));
    return [...base].sort((a, b) => (rank.get(a.id) ?? order.length) - (rank.get(b.id) ?? order.length));
  }, [courses, own, added, removed, order]);

  // O que pode vir para esta extra: produto de outra área que não esteja travada.
  const addable = isExtra
    ? (courses ?? []).flatMap((course) => {
        if (orderedCourses.some((current) => current.id === course.id)) return [];
        const place = editor.placement.get(course.id);
        const home = editor.areas.find((candidate) => candidate.slug !== null && candidate.id === place?.areaId) ?? editor.areas[0];
        if (home.id !== null && lockedIds.has(home.id)) return [];
        return [{ course, home }];
      })
    : [];

  // Só produto community publicado e com a comunidade ligada. Uma escolha que
  // deixou de valer (despublicada, comunidade desligada) aparece e salva como nenhuma.
  const communityProducts = (courses ?? []).filter(
    (course) => course.productFormat === "community" && course.communityEnabled !== false && course.status === "published",
  );
  const chosenCommunity = communityProducts.some((course) => course.id === communityCourseId) ? communityCourseId : "";

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

  function removeFromArea(courseId: string) {
    setAdded((current) => current.filter((id) => id !== courseId));
    setRemoved((current) => new Set(current).add(courseId));
    setOrder((current) => current.filter((id) => id !== courseId));
    setFeedback("");
  }

  function addToArea(courseId: string) {
    if (!courseId) return;
    setRemoved((current) => {
      const next = new Set(current);
      next.delete(courseId);
      return next;
    });
    if (!own.courses.some((course) => course.id === courseId)) setAdded((current) => [...current, courseId]);
    setFeedback("");
  }

  async function handleCover(file: File | null) {
    if (!file) return;
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
    setSaving(true);
    setFeedback("");
    const previousCover = savedCoverPath;
    try {
      await saveMyMemberArea({ name, theme, coverPath, welcomeText: welcome }, area.id);
    } catch {
      setFeedback("saveError");
      setSaving(false);
      return;
    }
    // O banco já aponta para a capa nova: a anterior pode sair, mesmo que a
    // lista de produtos falhe logo abaixo.
    setSavedCoverPath(coverPath);
    setSavedOnce(true);
    if (previousCover && previousCover !== coverPath) {
      void removeMemberAreaCover(previousCover).catch(() => undefined);
    }
    try {
      await saveMyMemberAreaProducts(
        orderedCourses.slice(0, maxProducts).map((course) => ({ courseId: course.id, visible: !hidden.has(course.id) })),
        area.id,
      );
    } catch {
      setFeedback("productsError");
      setSaving(false);
      return;
    }
    let communityFailed = false;
    try {
      await setMyMemberAreaCommunity(chosenCommunity || null, area.id);
    } catch {
      communityFailed = true;
    }
    // Relê onde cada produto mora antes de largar o rascunho da lista.
    await onSaved();
    setAdded([]);
    setRemoved(new Set());
    setOrder([]);
    setFeedback(communityFailed ? "communityError" : "saved");
    setSaving(false);
  }

  async function handleDelete() {
    if (!area.id) return;
    setSaving(true);
    setDeleteFailed(false);
    try {
      await deleteMyMemberArea(area.id);
    } catch {
      setDeleteFailed(true);
      setSaving(false);
      return;
    }
    if (savedCoverPath) void removeMemberAreaCover(savedCoverPath).catch(() => undefined);
    onDeleted();
  }

  const coverUrl = coverPath ? memberAreaCoverUrl(coverPath) : "";

  return (
    <form onSubmit={handleSubmit} className="grid gap-5">
      {/* Travado enquanto salva, e de vez numa área que o plano não cobre mais. */}
      <fieldset disabled={saving || locked} className="grid min-w-0 gap-5">
      {locked ? <InlineAlert tone="error">{t("teach.memberAreaEditor.lockedNote")}</InlineAlert> : null}
      {!configured ? <p className="info-notice">{t("teach.memberAreaEditor.virtualNote")}</p> : null}
      {isExtra && !locked ? <p className="info-notice">{t("teach.memberAreaEditor.extraNote")}</p> : null}

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
          <p className="text-xs text-[var(--color-ink-soft)]">
            {t(isExtra ? "teach.memberAreaEditor.noProductsInArea" : "teach.memberAreaEditor.noProducts")}
          </p>
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
                    <span className="block text-xs text-[var(--color-ink-soft)]">
                      {t(`courseCreation.types.${course.productFormat ?? "course"}.label`)}
                      {course.status !== "published" ? ` · ${t("teach.memberAreaEditor.notPublished")}` : ""}
                    </span>
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
                    {isExtra ? (
                      <button
                        type="button"
                        onClick={() => removeFromArea(course.id)}
                        aria-label={t("teach.memberAreaEditor.removeFromArea").replace("{title}", title)}
                        className={smallButtonClass}
                      >
                        <X aria-hidden="true" size={15} />
                        {t("teach.memberAreaEditor.remove")}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {isExtra && courses !== null && addable.length > 0 ? (
          <Field
            id="member-area-add-product"
            label={t("teach.memberAreaEditor.addProduct")}
            hint={t("teach.memberAreaEditor.addProductHelp")}
          >
            {(a11y) => (
              <select {...a11y} value="" onChange={(event) => addToArea(event.target.value)} className={fieldClass}>
                <option value="">{t("teach.memberAreaEditor.addProductPick")}</option>
                {addable.map(({ course, home }) => (
                  <option key={course.id} value={course.id}>
                    {t("teach.memberAreaEditor.addProductOption")
                      .replace("{title}", () => course.title.trim() || t("teacherMembers.untitled"))
                      .replace("{area}", () => areaLabel(home))}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
      </Card>

      <Card padding="sm" shadow={false} className="grid gap-3">
        <Field
          id="member-area-community"
          label={t("teach.memberAreaEditor.community")}
          hint={t(communityProducts.length > 0 ? "teach.memberAreaEditor.communityHelp" : "teach.memberAreaEditor.communityEmpty")}
        >
          {(a11y) => (
            <select
              {...a11y}
              value={chosenCommunity}
              disabled={courses === null}
              onChange={(event) => {
                setCommunityCourseId(event.target.value);
                setFeedback("");
              }}
              className={fieldClass}
            >
              <option value="">{t("teach.memberAreaEditor.communityNone")}</option>
              {communityProducts.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title.trim() || t("teacherMembers.untitled")}
                </option>
              ))}
            </select>
          )}
        </Field>
      </Card>

      </fieldset>

      {feedback === "saveError" || feedback === "productsError" || feedback === "communityError" ? (
        <InlineAlert tone="error">
          {t(`teach.memberAreaEditor.errors.${
            feedback === "saveError" ? "save" : feedback === "productsError" ? "saveProducts" : "saveCommunity"
          }`)}
        </InlineAlert>
      ) : null}
      {feedback === "saved" ? <p role="status" className="info-notice">{t("teach.memberAreaEditor.saved")}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={locked || saving || uploading || courses === null || coursesFailed}>
          {t(`teach.memberAreaEditor.${saving ? "saving" : "save"}`)}
        </Button>
        <Link
          href={memberAreaPath({ username: creator.username, ownerId: uid, slug: area.slug })}
          target="_blank"
          rel="noopener"
          className={buttonClasses({ variant: "outline" })}
        >
          <ExternalLink aria-hidden="true" size={15} />
          {t("teach.memberAreaEditor.previewAsStudent")}
        </Link>
      </div>
      <p className="text-xs text-[var(--color-ink-soft)]">{t("teach.memberAreaEditor.previewHelp")}</p>

      {isExtra && area.id ? (
        <div className="grid justify-items-start gap-2 border-t border-[var(--color-line)] pt-4">
          <p className="text-xs text-[var(--color-ink-soft)]">{t("teach.memberAreaEditor.deleteAreaHelp")}</p>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => (confirmDelete ? void handleDelete() : setConfirmDelete(true))}
          >
            <Trash2 aria-hidden="true" size={15} />
            {t(`teach.memberAreaEditor.${confirmDelete ? "deleteAreaConfirm" : "deleteArea"}`)}
          </Button>
          {deleteFailed ? <InlineAlert tone="error">{t("teach.memberAreaEditor.errors.delete")}</InlineAlert> : null}
        </div>
      ) : null}
    </form>
  );
}
