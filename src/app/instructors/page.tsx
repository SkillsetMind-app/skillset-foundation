import { InstructorsDirectory } from "@/components/instructors/instructors-directory";
import { PublicPage } from "@/components/site/public-page";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export const metadata = buildPageMetadata({
  title: "Instructors",
  description:
    "Independent experts publishing reviewed professional courses on SkillsetMind.",
  path: "/instructors",
});

export default function InstructorsPage() {
  return (
    <PublicPage
      eyebrow="Instructors"
      title="Learn from reviewed experts."
      description="Meet independent creators whose public profiles are published after review. SkillsetMind shows real instructor identity instead of marketplace filler."
    >
      <InstructorsDirectory />
    </PublicPage>
  );
}
