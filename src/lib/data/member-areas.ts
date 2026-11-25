"use client";

import { isAllowedAvatarFile } from "@/lib/data/profile-media";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Members area per creator: the main one gathers the creator's products; on Pro
 * there are up to 2 extras (migration 20261113230000_tres_areas_no_pro), each
 * with the products the teacher put in it and its own address (slug).
 *
 * Everything goes through the database functions (migration
 * 20261016030000_area_de_membros): the read returns null for anyone who is not a
 * learner or the owner, and the storefront ("more from this creator") only
 * brings public fields. The area unlocks no lesson at all; access still goes
 * by course.
 */

export type MemberAreaTheme = "light" | "dark";

export type MemberArea = {
  ownerId: string;
  username: string | null;
  /** null = the main area; otherwise the address of the extra. */
  slug: string | null;
  creatorName: string | null;
  creatorPhotoUrl: string | null;
  /** With the default already applied: the creator's name while the area is virtual. */
  name: string | null;
  theme: MemberAreaTheme;
  /** Path in the bucket public-media (`users/{uid}/member-area/...`). */
  coverPath: string | null;
  welcomeText: string | null;
  /** false = virtual area: the creator never saved. */
  configured: boolean;
  isOwnerPreview: boolean;
};

export type MemberAreaContinue = {
  courseId: string;
  courseTitle: string;
  lessonId: string;
  lessonTitle: string;
  positionSeconds: number;
  lastSeenAt: string | null;
};

export type MemberAreaOwnedProduct = {
  courseId: string;
  title: string;
  coverImageUrl: string | null;
  productFormat: string | null;
  lessonCount: number;
  progressPercent: number;
  enrollmentStatus: string | null;
};

export type MemberAreaLockedProduct = {
  courseId: string;
  title: string;
  coverImageUrl: string | null;
  priceAmountMinor: number | null;
  currency: string | null;
  paymentType: string | null;
  /** Sales page key: `/courses/{salesKey}`. */
  salesKey: string;
};

export type MemberAreaHome = {
  area: MemberArea;
  continueWatching: MemberAreaContinue | null;
  myProducts: MemberAreaOwnedProduct[];
  moreProducts: MemberAreaLockedProduct[];
};

/** The community of the whole area: a community product of the teacher. */
export type MemberAreaCommunity = { courseId: string; title: string; isOwner: boolean };

/** All four at once: saving rewrites all of them, so none is optional. */
export type MemberAreaSettings = {
  name: string | null;
  theme: MemberAreaTheme;
  coverPath: string | null;
  welcomeText: string | null;
};

export type MemberAreaProductChoice = { courseId: string; visible: boolean };

type Row = Record<string, unknown>;

const asRow = (value: unknown): Row | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Row) : null;
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? value.map(asRow).filter((row): row is Row => row !== null) : [];

function parseArea(value: unknown): MemberArea | null {
  const row = asRow(value);
  const ownerId = text(row?.owner_id);
  if (!row || !ownerId) return null;
  return {
    ownerId,
    username: text(row.username),
    slug: text(row.slug),
    creatorName: text(row.creator_name),
    creatorPhotoUrl: text(row.creator_photo_url),
    name: text(row.name),
    theme: row.theme === "dark" ? "dark" : "light",
    coverPath: text(row.cover_path),
    welcomeText: text(row.welcome_text),
    configured: row.configured === true,
    isOwnerPreview: row.is_owner_preview === true,
  };
}

function parseContinue(value: unknown): MemberAreaContinue | null {
  const row = asRow(value);
  const courseId = text(row?.course_id);
  const lessonId = text(row?.lesson_id);
  if (!row || !courseId || !lessonId) return null;
  return {
    courseId,
    courseTitle: text(row.course_title) ?? "",
    lessonId,
    lessonTitle: text(row.lesson_title) ?? "",
    positionSeconds: count(row.position_seconds),
    lastSeenAt: text(row.last_seen_at),
  };
}

/** The JSON from get_member_area_home → app types. Malformed input becomes null or drops out of the list. */
export function parseMemberAreaHome(value: unknown): MemberAreaHome | null {
  const row = asRow(value);
  const area = parseArea(row?.area);
  if (!row || !area) return null;
  return {
    area,
    continueWatching: parseContinue(row.continue),
    myProducts: rows(row.my_products).flatMap((product) => {
      const courseId = text(product.course_id);
      if (!courseId) return [];
      return [{
        courseId,
        title: text(product.title) ?? "",
        coverImageUrl: text(product.cover_image_url),
        productFormat: text(product.product_format),
        lessonCount: count(product.lesson_count),
        progressPercent: count(product.progress_percent),
        enrollmentStatus: text(product.enrollment_status),
      }];
    }),
    moreProducts: rows(row.more_products).flatMap((product) => {
      const courseId = text(product.course_id);
      if (!courseId) return [];
      return [{
        courseId,
        title: text(product.title) ?? "",
        coverImageUrl: text(product.cover_image_url),
        priceAmountMinor: typeof product.price_amount_minor === "number" ? product.price_amount_minor : null,
        currency: text(product.currency),
        paymentType: text(product.payment_type),
        salesKey: text(product.sales_key) ?? courseId,
      }];
    }),
  };
}

/**
 * `/learn/areas/@usuario` (or the uid when the creator has no @), plus
 * `/{slug}` in an extra area.
 */
export function memberAreaPath(area: Pick<MemberArea, "username" | "ownerId"> & { slug?: string | null }): string {
  const base = area.username
    ? `/learn/areas/@${encodeURIComponent(area.username)}`
    : `/learn/areas/${encodeURIComponent(area.ownerId)}`;
  return area.slug ? `${base}/${encodeURIComponent(area.slug)}` : base;
}

/** The area in the route: `/learn/areas/{ref}` (the "@usuario" or uid as it came in the URL), plus `/{slug}` in an extra. */
export function memberAreaRoutePath(ref: string, slug: string | null = null): string {
  const base = `/learn/areas/${encodeURIComponent(ref)}`;
  return slug ? `${base}/${encodeURIComponent(slug)}` : base;
}

// The area's theme only arrives with the read done in the browser: the table
// belongs to the owner, and the server does not read it on the learner's behalf.
// Saving the last theme seen lets the return to the area, and its community,
// paint in the right theme from the first frame, without a new database read.
// With nothing saved (first visit), the screen waits neutral instead of being
// born light and turning dark.
// ponytail: one value per area address; a theme changed by the teacher only
// shows up after the next time the area is opened (the read rewrites it).
const themeKey = (ref: string, slug: string | null) => `skillset:member-area-theme:${memberAreaRoutePath(ref, slug)}`;

/** The last theme seen for this area, or null when it was never opened in this browser. */
export function rememberedMemberAreaTheme(ref: string, slug: string | null = null): MemberAreaTheme | null {
  try {
    const value = window.localStorage.getItem(themeKey(ref, slug));
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}

export function rememberMemberAreaTheme(ref: string, slug: string | null, theme: MemberAreaTheme): void {
  try {
    window.localStorage.setItem(themeKey(ref, slug), theme);
  } catch {
    // Storage blocked (private tab): it only loses the first-frame shortcut.
  }
}

/** Extra area address: lowercase letters, numbers and hyphen, up to 40. Same rule as the database. */
export function isValidMemberAreaSlug(slug: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/.test(slug) && slug !== "community";
}

/** `areaId`/`slug` empty = the main area: the parameter is not even sent, and the database uses the default. */
const areaArg = (areaId: string | null | undefined) => (areaId ? { p_area_id: areaId } : {});
const slugArg = (slug: string | null | undefined) => (slug ? { p_slug: slug } : {});

/**
 * `ref` = "@usuario" or uid; `slug` = extra area (null = main). null: the
 * creator or the area does not exist, or the requester is neither a learner of the area nor the owner.
 */
export async function getMemberAreaHome(ref: string, slug: string | null = null): Promise<MemberAreaHome | null> {
  const { data, error } = await getSupabaseBrowserClient().rpc("get_member_area_home", {
    p_area_ref: ref,
    ...slugArg(slug),
  });
  if (error) throw error;
  return parseMemberAreaHome(data);
}

/**
 * The community of the area of `ref` ("@usuario" or uid; `slug` = extra). null: the
 * area has no community chosen, or the requester is neither a learner nor the owner.
 */
export async function getMemberAreaCommunity(ref: string, slug: string | null = null): Promise<MemberAreaCommunity | null> {
  const { data, error } = await getSupabaseBrowserClient().rpc("get_member_area_community", {
    p_area_ref: ref,
    ...slugArg(slug),
  });
  if (error) throw error;
  const row = asRow(data);
  const courseId = text(row?.course_id);
  if (!row || !courseId) return null;
  return { courseId, title: text(row.title) ?? "", isOwner: row.is_owner === true };
}

/** Chooses (or removes, with null) the community of one of the caller's areas. */
export async function setMyMemberAreaCommunity(courseId: string | null, areaId: string | null = null): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("set_my_member_area_community", {
    p_course_id: courseId ?? "",
    ...areaArg(areaId),
  });
  if (error) throw error;
}

/** Saves one of the caller's areas. Empty or null goes back to the default. */
export async function saveMyMemberArea(settings: MemberAreaSettings, areaId: string | null = null): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("save_my_member_area", {
    p_name: settings.name ?? "",
    p_theme: settings.theme,
    p_cover_path: settings.coverPath ?? "",
    p_welcome_text: settings.welcomeText ?? "",
    ...areaArg(areaId),
  });
  if (error) throw error;
}

/**
 * Replaces an area's whole list, in the given order. A product from another area moves
 * to this one; what leaves an extra's list goes back to the main one. The database
 * refuses everything if a product does not belong to the caller.
 */
export async function saveMyMemberAreaProducts(
  choices: readonly MemberAreaProductChoice[],
  areaId: string | null = null,
): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("save_my_member_area_products", {
    p_items: choices.map((choice) => ({ course_id: choice.courseId, visible: choice.visible })),
    ...areaArg(areaId),
  });
  if (error) throw error;
}

/** What the screen explains when creating fails. */
export type CreateMemberAreaError = "limit" | "slugInvalid" | "slugTaken" | "other";

/** Creates an extra area and returns the id. The database checks the plan (Pro: up to 3 with the main one). */
export async function createMyMemberArea(name: string, slug: string): Promise<string> {
  const { data, error } = await getSupabaseBrowserClient().rpc("create_my_member_area", { p_name: name, p_slug: slug });
  if (error) {
    const message = error.message ?? "";
    const reason: CreateMemberAreaError = message.includes("MEMBER_AREA_LIMIT")
      ? "limit"
      : error.code === "23505"
        ? "slugTaken"
        : message.includes("MEMBER_AREA_SLUG_INVALID")
          ? "slugInvalid"
          : "other";
    throw new Error(reason);
  }
  return data;
}

/** Deletes an extra area. Its products go back to the main one. */
export async function deleteMyMemberArea(areaId: string): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("delete_my_member_area", { p_area_id: areaId });
  if (error) throw error;
}

/**
 * Which of these products (purchased or the teacher's own) live in an extra
 * area: courseId -> { slug, name }. Outside the map = main area.
 */
export async function getMemberAreaSlugs(
  courseIds: readonly string[],
): Promise<Map<string, { slug: string; name: string | null }>> {
  if (courseIds.length === 0) return new Map();
  const { data, error } = await getSupabaseBrowserClient().rpc("get_member_area_slugs", {
    p_course_ids: [...courseIds],
  });
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.course_id, { slug: row.slug, name: row.name }]));
}

// ---------------------------------------------------------------------------
// Creator screen (/teach/member-area)
// ---------------------------------------------------------------------------

const publicMediaBucket = "public-media";

/** One of the creator's areas. `id` null = the main one, still virtual (never saved). */
export type MyMemberAreaEditorArea = {
  id: string | null;
  /** null = the main one. */
  slug: string | null;
  /** null = never saved: the defaults apply. */
  settings: MemberAreaSettings | null;
  /** The community product chosen as this area's community. */
  communityCourseId: string | null;
};

/** What the creator has already saved: the areas (the main one first) and where each product lives. */
export type MyMemberAreas = {
  areas: MyMemberAreaEditorArea[];
  /** Product in a saved list: area, position and visibility. Outside the map = main, at the end, visible. */
  placement: Map<string, { areaId: string; position: number; visible: boolean }>;
};

/** Position and visibility of the products an area's list already has. */
export type MemberAreaChoices = Map<string, { position: number; visible: boolean }>;

/** Reads the caller's own areas through RLS (only the owner sees the rows). */
export async function getMyMemberAreas(uid: string): Promise<MyMemberAreas> {
  const supabase = getSupabaseBrowserClient();
  const { data: rows, error } = await supabase
    .from("member_areas")
    .select("id, slug, name, theme, cover_path, welcome_text, community_course_id")
    .eq("owner_id", uid)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;

  const areaIds = (rows ?? []).map((row) => row.id);
  let products: { area_id: string; course_id: string; position: number; visible: boolean }[] = [];
  if (areaIds.length > 0) {
    const { data, error: productsError } = await supabase
      .from("member_area_products")
      .select("area_id, course_id, position, visible")
      .in("area_id", areaIds);
    if (productsError) throw productsError;
    products = data ?? [];
  }

  const toArea = (row: NonNullable<typeof rows>[number]): MyMemberAreaEditorArea => ({
    id: row.id,
    slug: row.slug,
    settings: {
      name: row.name,
      theme: row.theme === "dark" ? "dark" : "light",
      coverPath: row.cover_path,
      welcomeText: row.welcome_text,
    },
    communityCourseId: row.community_course_id ?? null,
  });
  const main = (rows ?? []).find((row) => row.slug === null);
  return {
    areas: [
      main ? toArea(main) : { id: null, slug: null, settings: null, communityCourseId: null },
      ...(rows ?? []).filter((row) => row.slug !== null).map(toArea),
    ],
    placement: new Map(products.map((row) => [row.course_id, { areaId: row.area_id, position: row.position, visible: row.visible }])),
  };
}

/**
 * The products that live in an area and their saved slice. Same rule as the database
 * (member_area_product_order): the main one has its own list and everything that
 * is not in an extra's list; the extra has only its own list.
 */
export function memberAreaProductsOf<T extends { id: string }>(
  courses: readonly T[],
  editor: MyMemberAreas,
  area: Pick<MyMemberAreaEditorArea, "id" | "slug">,
): { courses: T[]; choices: MemberAreaChoices } {
  const extraIds = new Set(editor.areas.filter((other) => other.slug !== null).map((other) => other.id));
  const inArea = courses.filter((course) => {
    const place = editor.placement.get(course.id);
    return area.slug === null ? !place || !extraIds.has(place.areaId) : place?.areaId === area.id;
  });
  const choices: MemberAreaChoices = new Map();
  for (const course of inArea) {
    const place = editor.placement.get(course.id);
    if (place && (area.slug !== null || place.areaId === area.id)) {
      choices.set(course.id, { position: place.position, visible: place.visible });
    }
  }
  return { courses: inArea, choices };
}

/**
 * The same order as the database (member_area_product_order): first the saved list,
 * then what was left out of it, from newest to oldest.
 */
export function orderMemberAreaProducts<T extends { id: string; createdAt?: unknown }>(
  courses: readonly T[],
  choices: MemberAreaChoices,
): T[] {
  const createdAt = (course: T) => Date.parse(String(course.createdAt ?? "")) || 0;
  return [...courses].sort((a, b) =>
    (choices.get(a.id)?.position ?? 10000) - (choices.get(b.id)?.position ?? 10000)
    || createdAt(b) - createdAt(a)
    || a.id.localeCompare(b.id));
}

/**
 * Uploads the cover to `users/{uid}/member-area/` and returns the path. A new name on
 * every upload: the public URL changes with it and no cache shows the old cover.
 */
export async function uploadMemberAreaCover(uid: string, file: File): Promise<string> {
  if (!isAllowedAvatarFile(file)) throw new Error("MEMBER_AREA_COVER_INVALID");
  const path = `users/${uid}/member-area/cover-${Date.now()}`;
  const { error } = await getSupabaseBrowserClient().storage
    .from(publicMediaBucket)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}

/** Deletes a cover that is no longer used. Failing here only leaves an orphaned file. */
export async function removeMemberAreaCover(path: string): Promise<void> {
  const { error } = await getSupabaseBrowserClient().storage.from(publicMediaBucket).remove([path]);
  if (error) throw error;
}

export function memberAreaCoverUrl(path: string): string {
  return getSupabaseBrowserClient().storage.from(publicMediaBucket).getPublicUrl(path).data.publicUrl;
}
