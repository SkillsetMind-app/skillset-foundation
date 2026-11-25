import Image from "next/image";

import { RevealSection } from "@/components/shared/reveal-section";
import { getServerTranslation } from "@/lib/i18n/server";

// "Who it is for": only the audience sentence the site already publishes (the one in the
// final band). The three photos are of people who
// do not exist, made by AI: no name, no sentence, nothing that looks like a testimonial
// or a customer. The alt text describes the scene, not the person.
const PORTRAITS = [
  { src: "/brand/home/home-who-coach.avif", alt: "home.who.coachAlt" },
  { src: "/brand/home/home-who-teacher.avif", alt: "home.who.teacherAlt" },
  { src: "/brand/home/home-who-educator.avif", alt: "home.who.educatorAlt" },
] as const;

// Server component, no state. On phones the portraits sit one below the
// other, cropped to 4:3 (the face stays in the frame); from md up, three
// columns at 4:5. The motion lives only in globals.css (desktop).
export async function HomeWhoFor() {
  const { t } = await getServerTranslation();

  return (
    <section
      aria-labelledby="home-who-title"
      className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:py-24"
    >
      <RevealSection className="home-heading max-w-4xl">
        <h2 className="display-title text-[clamp(2.25rem,4.2vw,3.25rem)] leading-[1.05] text-[var(--color-primary)]" id="home-who-title">
          {t("home.creators.eyebrow")}
        </h2>
      </RevealSection>
      <div className="mt-10 grid gap-5 sm:mt-12 md:grid-cols-3">
        {PORTRAITS.map(({ src, alt }) => (
          <div key={src} className="home-who__photo relative aspect-[4/3] overflow-hidden rounded-lg md:aspect-[4/5]">
            <Image
              src={src}
              alt={t(alt)}
              fill
              sizes="(min-width: 1280px) 392px, (min-width: 768px) 31vw, 100vw"
              className="object-cover object-[center_25%]"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
