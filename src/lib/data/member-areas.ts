"use client";

import { isAllowedAvatarFile } from "@/lib/data/profile-media";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Área de membros por criador: uma por criador, juntando os produtos dele.
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

/** `/learn/areas/@usuario`, ou o uid quando o criador não tem @. */
export function memberAreaPath(area: Pick<MemberArea, "username" | "ownerId">): string {
  return area.username
    ? `/learn/areas/@${encodeURIComponent(area.username)}`
    : `/learn/areas/${encodeURIComponent(area.ownerId)}`;
}

/** `ref` = "@usuario" ou uid. null: o criador não existe ou quem pede não é aluno nem dono. */
export async function getMemberAreaHome(ref: string): Promise<MemberAreaHome | null> {
  const { data, error } = await getSupabaseBrowserClient().rpc("get_member_area_home", { p_area_ref: ref });
  if (error) throw error;
  return parseMemberAreaHome(data);
}

/** Salva a área de quem chama. Vazio ou null volta ao padrão. */
export async function saveMyMemberArea(settings: MemberAreaSettings): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("save_my_member_area", {
    p_name: settings.name ?? "",
    p_theme: settings.theme,
    p_cover_path: settings.coverPath ?? "",
    p_welcome_text: settings.welcomeText ?? "",
  });
  if (error) throw error;
}

/** Troca a lista inteira, na ordem dada. O banco recusa tudo se um produto não for de quem chama. */
export async function saveMyMemberAreaProducts(choices: readonly MemberAreaProductChoice[]): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc("save_my_member_area_products", {
    p_items: choices.map((choice) => ({ course_id: choice.courseId, visible: choice.visible })),
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Tela do criador (/teach/member-area)
// ---------------------------------------------------------------------------

const publicMediaBucket = "public-media";

/** O que o criador já salvou. `settings` null = área virtual (nunca salvou). */
export type MyMemberAreaEditor = {
  settings: Required<MemberAreaSettings> | null;
  choices: Map<string, { position: number; visible: boolean }>;
};

/** Lê a própria área pela RLS (só o dono enxerga as linhas). */
export async function getMyMemberAreaEditor(uid: string): Promise<MyMemberAreaEditor> {
  const supabase = getSupabaseBrowserClient();
  const { data: area, error } = await supabase
    .from("member_areas")
    .select("id, name, theme, cover_path, welcome_text")
    .eq("owner_id", uid)
    .maybeSingle();
  if (error) throw error;
  if (!area) return { settings: null, choices: new Map() };

  const { data: products, error: productsError } = await supabase
    .from("member_area_products")
    .select("course_id, position, visible")
    .eq("area_id", area.id);
  if (productsError) throw productsError;

  return {
    settings: {
      name: area.name,
      theme: area.theme === "dark" ? "dark" : "light",
      coverPath: area.cover_path,
      welcomeText: area.welcome_text,
    },
    choices: new Map((products ?? []).map((row) => [row.course_id, { position: row.position, visible: row.visible }])),
  };
}

/**
 * A mesma ordem do banco (member_area_product_order): primeiro a lista salva,
 * depois o que ficou fora dela, do mais novo para o mais antigo.
 */
export function orderMemberAreaProducts<T extends { id: string; createdAt?: unknown }>(
  courses: readonly T[],
  choices: MyMemberAreaEditor["choices"],
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
