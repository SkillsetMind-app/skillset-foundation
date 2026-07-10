import type { Metadata } from "next";

import { InstructorProfileView } from "@/components/instructors/instructor-profile-view";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

// Per-slug metadata so every instructor profile gets a correct canonical
// (/instructors/{slug}) instead of all collapsing onto /instructors, which told
// search engines the profiles were duplicates of the listing.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return buildPageMetadata({
    title: "Instructor",
    description:
      "An independent expert publishing reviewed professional courses on SkillsetMind.",
    path: `/instructors/${slug}`,
  });
}

// Public instructor profile. The route is dynamic (SSR): the public profile is
// read client-side from `publicProfiles/{uid}` (anonymously readable), which is
// projected from the teacher's private user doc by a Cloud Function. A uid with
// no public profile renders an honest "unavailable" state instead of fabricated
// data — so direct URLs never 404 to a dead end nor invent an instructor.
export default async function InstructorDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <div className="page-shell">
      <SiteNav />
      <main className="mx-auto w-full max-w-7xl px-6 py-12 sm:px-8 sm:py-16">
        <InstructorProfileView key={slug} uid={slug} />
      </main>
      <SiteFooter />
    </div>
  );
}
