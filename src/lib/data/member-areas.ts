"use client";

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
