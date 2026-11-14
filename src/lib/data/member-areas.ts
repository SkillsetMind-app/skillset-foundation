"use client";

import { isAllowedAvatarFile } from "@/lib/data/profile-media";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Área de membros por criador: a principal junta os produtos dele; no Pro há
 * até 2 extras (migration 20261113230000_tres_areas_no_pro), cada uma com os
 * produtos que o professor pôs nela e endereço próprio (slug).
 *
 * Tudo passa pelas funções do banco (migration 20261016030000_area_de_membros):
 * a leitura devolve null para quem não é aluno nem dono, e a vitrine ("mais
 * deste criador") só traz campos públicos. A área não libera aula nenhuma; o
 * acesso continua por curso.
 */

export type MemberAreaTheme = "light" | "dark";

export type MemberArea = {
  ownerId: string;
  username: string | null;
  /** null = a área principal; senão o endereço da extra. */
  slug: string | null;
  creatorName: string | null;
  creatorPhotoUrl: string | null;
  /** Já com o padrão aplicado: o nome do criador enquanto a área é virtual. */
  name: string | null;
  theme: MemberAreaTheme;
  /** Caminho no bucket public-media (`users/{uid}/member-area/...`). */
  coverPath: string | null;
  welcomeText: string | null;
  /** false = área virtual: o criador nunca salvou. */
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
  /** Chave da página de vendas: `/courses/{salesKey}`. */
  salesKey: string;
};

export type MemberAreaHome = {
  area: MemberArea;
  continueWatching: MemberAreaContinue | null;
  myProducts: MemberAreaOwnedProduct[];
  moreProducts: MemberAreaLockedProduct[];
};

/** A comunidade da área inteira: um produto community do professor. */
export type MemberAreaCommunity = { courseId: string; title: string; isOwner: boolean };

/** Os quatro de uma vez: salvar regrava todos, então nenhum é opcional. */
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

/** O JSON de get_member_area_home → tipos do app. Entrada torta vira null ou some da lista. */
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
 * `/learn/areas/@usuario` (ou o uid quando o criador não tem @), mais
 * `/{slug}` numa área extra.
 */
export function memberAreaPath(area: Pick<MemberArea, "username" | "ownerId"> & { slug?: string | null }): string {
  const base = area.username
    ? `/learn/areas/@${encodeURIComponent(area.username)}`
    : `/learn/areas/${encodeURIComponent(area.ownerId)}`;
  return area.slug ? `${base}/${encodeURIComponent(area.slug)}` : base;
}

/** A área na rota: `/learn/areas/{ref}` (o "@usuario" ou uid como veio na URL), mais `/{slug}` numa extra. */
export function memberAreaRoutePath(ref: string, slug: string | null = null): string {
  const base = `/learn/areas/${encodeURIComponent(ref)}`;
  return slug ? `${base}/${encodeURIComponent(slug)}` : base;
}

/** Endereço de área extra: minúsculas, números e hífen, até 40. Mesma regra do banco. */
export function isValidMemberAreaSlug(slug: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/.test(slug) && slug !== "community";
}

/** `areaId`/`slug` vazio = a área principal: o parâmetro nem vai, e o banco usa o padrão. */
const areaArg = (areaId: string | null | undefined) => (areaId ? { p_area_id: areaId } : {});
const slugArg = (slug: string | null | undefined) => (slug ? { p_slug: slug } : {});

/**
 * `ref` = "@usuario" ou uid; `slug` = área extra (null = principal). null: o
 * criador ou a área não existe, ou quem pede não é aluno da área nem dono.
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
 * A comunidade da área de `ref` ("@usuario" ou uid; `slug` = extra). null: a
 * área não tem comunidade escolhida, ou quem pede não é aluno nem dono.
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

/** Escolhe (ou tira, com null) a comunidade de uma área de quem chama. */
export async function setMyMemberAreaCommunity(courseId: string | null, areaId: string | null = null): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("set_my_member_area_community", {
    p_course_id: courseId ?? "",
    ...areaArg(areaId),
  });
  if (error) throw error;
}

/** Salva uma área de quem chama. Vazio ou null volta ao padrão. */
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
 * Troca a lista inteira de uma área, na ordem dada. Produto de outra área muda
 * para esta; o que sai da lista de uma extra volta para a principal. O banco
 * recusa tudo se um produto não for de quem chama.
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

/** O que a tela explica quando criar falha. */
export type CreateMemberAreaError = "limit" | "slugInvalid" | "slugTaken" | "other";

/** Cria uma área extra e devolve o id. O banco confere o plano (Pro: até 3 com a principal). */
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

/** Apaga uma área extra. Os produtos dela voltam para a principal. */
export async function deleteMyMemberArea(areaId: string): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("delete_my_member_area", { p_area_id: areaId });
  if (error) throw error;
}

/**
 * Quais destes produtos (comprados ou do próprio professor) moram numa área
 * extra: courseId -> { slug, nome }. Fora do mapa = área principal.
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
// Tela do criador (/teach/member-area)
// ---------------------------------------------------------------------------

const publicMediaBucket = "public-media";

/** Uma área do criador. `id` null = a principal ainda virtual (nunca salvou). */
export type MyMemberAreaEditorArea = {
  id: string | null;
  /** null = a principal. */
  slug: string | null;
  /** null = nunca salvou: valem os padrões. */
  settings: MemberAreaSettings | null;
  /** O produto community escolhido como comunidade desta área. */
  communityCourseId: string | null;
};

/** O que o criador já salvou: as áreas (a principal primeiro) e onde cada produto mora. */
export type MyMemberAreas = {
  areas: MyMemberAreaEditorArea[];
  /** Produto numa lista salva: área, posição e visibilidade. Fora do mapa = principal, no fim, visível. */
  placement: Map<string, { areaId: string; position: number; visible: boolean }>;
};

/** Posição e visibilidade dos produtos que a lista de uma área já tem. */
export type MemberAreaChoices = Map<string, { position: number; visible: boolean }>;

/** Lê as próprias áreas pela RLS (só o dono enxerga as linhas). */
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
 * Os produtos que moram numa área e o recorte salvo deles. Mesma regra do banco
 * (member_area_product_order): a principal tem a lista dela e tudo o que não
 * está na lista de uma extra; a extra, só a lista dela.
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
 * A mesma ordem do banco (member_area_product_order): primeiro a lista salva,
 * depois o que ficou fora dela, do mais novo para o mais antigo.
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
 * Sobe a capa para `users/{uid}/member-area/` e devolve o caminho. Nome novo a
 * cada envio: a URL pública muda junto e nenhum cache mostra a capa velha.
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

/** Apaga uma capa que deixou de ser usada. Falhar aqui só deixa um arquivo órfão. */
export async function removeMemberAreaCover(path: string): Promise<void> {
  const { error } = await getSupabaseBrowserClient().storage.from(publicMediaBucket).remove([path]);
  if (error) throw error;
}

export function memberAreaCoverUrl(path: string): string {
  return getSupabaseBrowserClient().storage.from(publicMediaBucket).getPublicUrl(path).data.publicUrl;
}
