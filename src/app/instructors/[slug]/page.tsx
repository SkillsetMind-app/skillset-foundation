import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InstructorProfileView } from "@/components/instructors/instructor-profile-view";
import { LogoWordmark } from "@/components/shared/logo-wordmark";
import { brand } from "@/data/brand";
import { instructorPagePath, publicProfileName, type PublicProfile } from "@/domain/user-profile";
import { getPublicProfileByRef, listCreatorCourses } from "@/lib/data/server/public-profile";
import { getServerTranslation } from "@/lib/i18n/server";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

// Public teacher profile = the Instagram bio link. Serves
// `/instructors/{uid}` and `/@usuario` (rewrite from next.config to
// `/instructors/@usuario`). Everything comes from the SERVER: header, courses and metadata,
// so the Instagram browser receives the finished page, with no skeleton.

type Props = { params: Promise<{ slug: string }> };

/** The `@` may arrive encoded (%40) depending on the client. */
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

/** First ~155 characters of the bio, cut at a space. */
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

  // A read that failed or a profile that does not exist: the page decides (error or 404);
  // here nothing is invented.
  const profile = await getPublicProfileByRef(refFrom(slug)).catch(() => null);
  if (!profile) {
    return buildPageMetadata({
      title: t("publicPages.profile.metadata_title"),
      description: t("publicPages.profile.metadata_description"),
      path: `/instructors/${slug}`,
      noindex: true,
    });
  }

  // Profession is not yet in public_profiles (only the storefront tagline).
  const tagline = profile.storefront?.showcase?.tagline?.trim();
  const who = `${profileName(profile, t)}${profile.username ? ` (@${profile.username})` : ""}`;
  const title = tagline ? `${who} · ${tagline}` : who;
  // ?v= changes when the profile changes: WhatsApp and Facebook keep the card by
  // URL, and without it the new photo never showed up.
  const version = profile.updatedAt ? `?v=${encodeURIComponent(String(profile.updatedAt))}` : "";
  const metadata = buildPageMetadata({
    title,
    description: tagline || excerpt(profile.bio) || t("publicPages.profile.metadata_description"),
    // `/@usuario` when there is an @: the same profile at `/instructors/{uid}` points
    // there, and the search engine merges the two addresses into one.
    path: instructorPagePath(profile.uid, profile.username),
    image: `/instructors/${profile.uid}/opengraph-image${version}`,
  });
  // With no published course the profile is a thin page: out of the index until the first
  // course, links followed. A read that failed (null) does not count as empty.
  // Same cached call that the page makes.
  const courses = await listCreatorCourses(profile.uid);
  if (courses?.length === 0) metadata.robots = { index: false, follow: true };
  // A plan that removes the platform brand: the tab does not end in "| SkillsetMind".
  if (profile.storefront?.branding?.hidePlatformBrand === true) metadata.title = title;
  return metadata;
}

export default async function InstructorDetailPage({ params }: Props) {
  const { slug } = await params;
  // Before any Suspense: an invented @ or uid becomes a real 404 (it was
  // 200 with an "unavailable" card).
  const profile = await getPublicProfileByRef(refFrom(slug));
  if (!profile) notFound();

  const [courses, { t }] = await Promise.all([listCreatorCourses(profile.uid), getServerTranslation()]);
  // The storefront logo (every plan with a storefront, Starter included: the projection only
  // brings `storefront` for those plans) goes in place of ours. A plan that
  // removes the platform brand (the database decides): no logo of ours and no
  // "Made with".
  const branding = profile.storefront?.branding;
  const hideBrand = branding?.hidePlatformBrand === true;

  return (
    <div className="page-shell flex flex-col">
      {/* Minimal header: without the site menu, which took the visitor away from
          the teacher. */}
      <header className="mx-auto flex w-full max-w-[40rem] justify-center px-4 pt-5 sm:px-6">
        {branding?.logoUrl ? (
          <Image
            src={branding.logoUrl}
            alt={profileName(profile, t)}
            width={160}
            height={40}
            className="h-10 w-auto object-contain"
            // The teacher's host, outside remotePatterns.
            unoptimized
          />
        ) : hideBrand ? null : (
          <LogoWordmark nav />
        )}
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
