import { PublicPage } from "@/components/site/public-page";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export const metadata = buildPageMetadata({
  title: "About",
  description:
    "SkillsetMind is an international platform for serious online courses, built around reviewed quality, creator income, and verifiable learning.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <PublicPage
      eyebrow="About"
      title="SkillsetMind is a public home for learning, teaching, and trusted growth."
      description="SkillsetMind is where professional educators publish courses and learners earn SkillsetMind Verified certificates employers can check. We built it so the platform never sits on an educator's money: buyers are charged directly on the educator's own Stripe account, which means there is no balance here to hold and nothing for us to release."
    >
      <section className="mt-10 grid gap-4 sm:grid-cols-3">
        {["Professional programs", "Visible educators", "Educators are paid directly"].map((item) => (
          <div key={item} className="rounded-[14px] border border-[var(--color-line)] bg-white p-5">
            <p className="text-sm font-semibold text-[var(--color-primary)]">{item}</p>
          </div>
        ))}
      </section>
    </PublicPage>
  );
}
