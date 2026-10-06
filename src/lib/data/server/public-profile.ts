import { cache } from "react";

import {
  INTERNAL_COURSE_ID_PREFIX,
  INTERNAL_COURSE_TITLE_PREFIX,
} from "@/domain/teacher-course";
import { isReservedHandle, type PublicProfile } from "@/domain/user-profile";
import { anonymousReadClient } from "@/lib/data/server/public-course";
import { rowToPublicProfile } from "@/lib/supabase/user-mappers";

// Server-only (segmento `/server/`). O perfil público do professor é montado
// no SERVIDOR: antes ele carregava no navegador, e o navegador do Instagram
// mostrava o esqueleto, um título igual para todo professor e uma prévia
// genérica. `public_profiles` e cursos publicados já são legíveis por anônimo.

/** Mesmo formato de users_username_format (migration 20260910040000). */
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;

// Uma tentativa, 3 s e 60 s de cache: o Instagram manda picos para a mesma
// página, e a edição do perfil aparece em até um minuto.
const client = () => anonymousReadClient({ timeoutMs: 3_000, revalidate: 60 });

/**
 * `ref` é o uid (`/instructors/{uid}`) ou `@usuario` (`/@usuario`, que o
 * next.config reescreve para `/instructors/@usuario`). O `@` decide a coluna,
 * então um uid nunca é confundido com um @ e vice-versa.
 *
 * - null: não existe (ou o @ nem tem o formato válido) → 404 de verdade;
 * - lança: a leitura falhou → a página de erro, nunca um 404 que tiraria do
 *   índice um perfil que existe.
 *
 * `cache` do React: metadata e página perguntam no mesmo pedido, o banco
 * responde uma vez.
 */
export const getPublicProfileByRef = cache(async (ref: string): Promise<PublicProfile | null> => {
  const handle = ref.startsWith("@") ? ref.slice(1).toLowerCase() : null;
  if (handle !== null && (!USERNAME.test(handle) || isReservedHandle(handle))) return null;

  const { data, error } = await client()
    .from("public_profiles")
    .select("uid, display_name, username, photo_url, bio, credentials, storefront, verified_professional, verification_kind, verified_at, updated_at")
    .eq(handle === null ? "uid" : "username", handle ?? ref)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToPublicProfile(data) : null;
});

/** Só o que a linha de curso do perfil mostra. */
export type CreatorCourse = {
  id: string;
  href: string;
  title: string;
  coverImageUrl: string | null;
  free: boolean;
  priceAmountMinor: number | null;
  currency: string;
  ratingAverage: number;
  ratingCount: number;
};

/**
 * Cursos publicados do professor, sem os internos de teste (mesmos prefixos do
 * predicado da loja). Falha vale null: o perfil continua no ar com o aviso de
 * que os cursos não carregaram.
 */
export const listCreatorCourses = cache(async (ownerId: string): Promise<CreatorCourse[] | null> => {
  try {
    const { data, error } = await client()
      .from("courses")
      .select("id, title, title_key, cover_image_url, payment_type, price_amount_minor, currency, rating_average, rating_count")
      .eq("owner_id", ownerId)
      .eq("status", "published")
      .not("id", "like", `${INTERNAL_COURSE_ID_PREFIX}%`)
      .not("title", "like", `${INTERNAL_COURSE_TITLE_PREFIX}%`)
      .order("title")
      .limit(48);
    if (error) throw error;

    return (data ?? []).map((row) => ({
      id: row.id,
      // Mesma regra de courseUrlSlug: title_key, senão o id. O `slug` legado
      // não serve: a página do curso só resolve id e title_key.
      href: `/courses/${row.title_key || row.id}`,
      title: row.title,
      coverImageUrl: row.cover_image_url,
      free: row.payment_type === "free",
      priceAmountMinor: row.price_amount_minor,
      currency: row.currency ?? "USD",
      ratingAverage: row.rating_average ?? 0,
      ratingCount: row.rating_count ?? 0,
    }));
  } catch (error) {
    console.error("[public-profile] listCreatorCourses failed", error);
    return null;
  }
});
