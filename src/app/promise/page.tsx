import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import Link from "next/link";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

const promises = [
  {
    number: "01",
    title: "Fee-lock for 24 months",
    body: "The commission rate of the plan you sign up on is the rate you keep for the next 24 months — even if SkillsetMind raises plan pricing later. If SkillsetMind ever needs to change it, you get 90 days notice and the right to export everything and leave with no friction.",
    practice:
      "If a creator joins on Free at 8%, that creator does not wake up to a surprise commission increase after building a business here.",
  },
  {
    number: "02",
    title: "Feature parity across all plans",
    body: "No add-ons. No premium tier locking certificates, drip content, or community. Every SkillsetMind feature is on every plan. The plan you pick only changes the commission rate SkillsetMind takes per sale — never what you can build.",
    practice:
      "A creator on Free and a creator on Plus get the same product surface. SkillsetMind does not tax growth with feature paywalls.",
  },
  {
    number: "03",
    title: "Data portability, one click",
    body: "At any moment you can export your full business: courses with all videos and materials, your student list with progress, your sales history, your community posts, your event records. ZIP file. No calls. No retention attempts. No questions asked.",
    practice:
      "SkillsetMind can host your business, but SkillsetMind does not own the business you built.",
  },
  {
    number: "04",
    title: "Cancellation in one click",
    body: "Delete your account in one click. Your existing students keep access for the time they paid for, but no new enrollments will go through. SkillsetMind will not chain you in email loops, hide the cancel button, or send 12 different agents. SkillsetMind will simply do it.",
    practice:
      "Leaving should be a product action, not a negotiation.",
  },
  {
    number: "05",
    title: "Funds protection by contract",
    body: "Chargebacks below 1.5% rolling 90 days will never auto-suspend your account. Holds above that threshold trigger human review with a 72h SLA, not a black box. Disputes go to documented arbitration. SkillsetMind will not freeze your money to protect itself first.",
    practice:
      "Creators need abuse protection. Students need refund protection. The policy must protect both sides without a black box.",
  },
  {
    number: "06",
    title: "Human support SLA",
    body: "Financial questions — refunds, payouts, holds, chargebacks — get a human reply within 24 hours. No chatbot wall. No escalation maze. A real person, by email, with the authority to fix it.",
    practice:
      "Money issues do not belong behind a bot maze.",
  },
];

export const metadata = buildPageMetadata({
  title: "The SkillsetMind Promise",
  description:
    "SkillsetMind commitments to creators and learners: reviewed quality, fair payouts, refund protection, and verifiable credentials.",
  path: "/promise",
});

export default function PromisePage() {
  return (
    <div className="page-shell">
      <SiteNav />
      <main>
        <section className="relative overflow-hidden bg-[var(--color-primary)] text-white">
          <div className="absolute inset-0 bg-gradient-to-br from-[#07172a] via-[#102944] to-[#1a365d]" />
          <div
            className="absolute inset-0 opacity-[0.1]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 18% 28%, rgba(255,255,255,0.45), transparent 32%), radial-gradient(circle at 86% 64%, rgba(178,34,52,0.46), transparent 34%)",
            }}
          />
          {/* Engraved-editorial security texture — the same certificate/banknote
              line-work as the home hero and auth panel. mix-blend-screen lifts
              only the light engraving over the navy, filling the open right side
              beside the left-aligned copy and tying the three hero moments
              (home, auth, promise) into one brand system. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[url(/brand/hero-engraving-mobile.webp)] bg-cover bg-center bg-no-repeat opacity-[0.5] mix-blend-screen lg:bg-[url(/brand/hero-engraving-desktop.webp)]"
          />
          <div className="relative z-10 mx-auto w-full max-w-7xl px-6 py-16 sm:px-8 lg:py-24">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/78">
              The SkillsetMind Creator Promise
            </p>
            <h1 className="display-title mt-5 max-w-4xl text-5xl leading-none text-white sm:text-7xl">
              Six commitments. In writing. Public.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-white/78 sm:text-lg">
              These promises are contractual product rules for creators building
              on SkillsetMind: fee-locked, portable, cancellable, protected, and
              supported by humans when money is involved.
            </p>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-[var(--color-accent)]" />
        </section>

        <section className="mx-auto grid w-full max-w-5xl gap-5 px-6 py-14 sm:px-8 lg:py-20">
          {promises.map((promise) => (
            <article
              key={promise.number}
              className="rounded-[18px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)] sm:p-8"
            >
              <div className="grid gap-5 lg:grid-cols-[120px_1fr]">
                <p className="display-title text-7xl leading-none text-[var(--color-accent-soft)]">
                  {promise.number}
                </p>
                <div>
                  <h2 className="display-title text-4xl leading-tight text-[var(--color-primary)]">
                    {promise.title}
                  </h2>
                  <p className="mt-4 text-sm leading-8 text-[var(--color-ink-soft)]">
                    {promise.body}
                  </p>
                  <div className="mt-5 rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                      What this means in practice
                    </p>
                    <p className="mt-2 text-sm leading-7 text-[var(--color-ink-soft)]">
                      {promise.practice}
                    </p>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </section>

        <section className="mx-auto w-full max-w-5xl px-6 pb-16 sm:px-8">
          <div className="rounded-[18px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-6 shadow-[var(--shadow-soft)] sm:p-8">
            <p className="text-sm leading-7 text-[var(--color-ink-soft)]">
              These are not aspirations. They are the rules SkillsetMind holds itself
              to. The next page lists every change ever made to them, including
              the date and reason.
            </p>
            <Link href="/promise/changelog" className="button-solid mt-5 px-4 py-2.5 text-sm">
              Read the changelog
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
