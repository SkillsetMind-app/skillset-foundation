import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InstructorProfileView } from "@/components/instructors/instructor-profile-view";
import { LogoWordmark } from "@/components/shared/logo-wordmark";
import { brand } from "@/data/brand";
import { instructorPagePath, publicProfileName, type PublicProfile } from "@/domain/user-profile";
import { getPublicProfileByRef, listCreatorCourses } from "@/lib/data/server/public-profile";
import { getServerTranslation } from "@/lib/i18n/server";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

// Perfil público do professor = o link da bio do Instagram. Atende
// `/instructors/{uid}` e `/@usuario` (rewrite do next.config para
// `/instructors/@usuario`). Tudo sai do SERVIDOR: cabeçalho, cursos e metadata,
// então o navegador do Instagram recebe a página pronta, sem esqueleto.

type Props = { params: Promise<{ slug: string }> };

/** O `@` pode chegar codificado (%40) conforme o cliente. */
function refFrom(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

function profileName(profile: PublicProfile, t: (key: string) => string): string {
  return publicProfileName(profile)
    ?? t("publicPages.profile.fallback_name").replace("{brand}", () => brand.name);
}

/** Primeiros ~155 caracteres da bio, cortados num espaço. */
function excerpt(text: string | null | undefined, max = 155): string | null {
  const clean = text?.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 80 ? cut.lastIndexOf(" ") : max).trimEnd()}…`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { t } = await getServerTranslation();

  // Leitura que falhou ou perfil que não existe: a página decide (erro ou 404);
  // aqui só não se inventa nada.
  const profile = await getPublicProfileByRef(refFrom(slug)).catch(() => null);
  if (!profile) {
    return buildPageMetadata({
      title: t("publicPages.profile.metadata_title"),
      description: t("publicPages.profile.metadata_description"),
      path: `/instructors/${slug}`,
      noindex: true,
    });
  }

  // Profissão ainda não está em public_profiles (só a tagline da vitrine).
  const tagline = profile.storefront?.showcase?.tagline?.trim();
  const who = `${profileName(profile, t)}${profile.username ? ` (@${profile.username})` : ""}`;
  return buildPageMetadata({
    title: tagline ? `${who} · ${tagline}` : who,
    description: tagline || excerpt(profile.bio) || t("publicPages.profile.metadata_description"),
    // `/@usuario` quando há @: o mesmo perfil por `/instructors/{uid}` aponta
    // para lá, e o buscador junta os dois endereços num só.
    path: instructorPagePath(profile.uid, profile.username),
    image: `/instructors/${profile.uid}/opengraph-image`,
  });
}

export default async function InstructorDetailPage({ params }: Props) {
  const { slug } = await params;
  // Antes de qualquer Suspense: @ ou uid inventado vira 404 de verdade (era
  // 200 com um cartão "indisponível").
  const profile = await getPublicProfileByRef(refFrom(slug));
  if (!profile) notFound();

  const [courses, { t }] = await Promise.all([listCreatorCourses(profile.uid), getServerTranslation()]);
  // Plano que tira a marca da plataforma (o banco decide): sem logo nosso e
  // sem "Feito com".
  const branding = profile.storefront?.branding;
  const hideBrand = branding?.hidePlatformBrand === true;

  return (
    <div className="page-shell flex flex-col">
      {/* Cabeçalho mínimo: sem o menu do site, que levava o visitante para
          longe do professor. */}
      <header className="mx-auto flex w-full max-w-[40rem] justify-center px-4 pt-5 sm:px-6">
        {hideBrand ? null : <LogoWordmark nav />}
      </header>
      <main id="conteudo" className="mx-auto w-full max-w-[40rem] flex-1 px-4 pb-12 pt-6 sm:px-6">
        <InstructorProfileView profile={profile} courses={courses} />
      </main>
      {hideBrand ? null : (
        <footer data-section="footer" className="pb-8 text-center">
          <Link
            href="/for-creators"
            className="inline-flex min-h-11 items-center text-xs font-semibold text-[var(--color-ink-muted)] underline-offset-4 hover:text-[var(--color-primary)] hover:underline"
          >
            {t("publicPages.profile.made_with").replace("{brand}", () => brand.name)}
          </Link>
        </footer>
      )}
    </div>
  );
}
