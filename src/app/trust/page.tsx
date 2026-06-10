import {
  Award,
  FileSearch,
  Flag,
  Receipt,
  RefreshCcw,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { PublicPage } from "@/components/site/public-page";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export const metadata = buildPageMetadata({
  title: "Trust and safety",
  description:
    "Skillset is built around controlled course publication, protected student access, transparent payments, moderation, and verifiable learning outcomes.",
  path: "/trust",
});

type TrustLayer = {
  title: string;
  detail: string;
  Icon: LucideIcon;
};

const trustLayers: ReadonlyArray<TrustLayer> = [
  {
    title: "Course review",
    detail: "Skillset reviews every submitted course — lessons, descriptions, pricing, and claims. Review runs without blocking publication.",
    Icon: FileSearch,
  },
  {
    title: "Protected access",
    detail: "Learning workspaces open only after enrollment — no public links bypass paid access.",
    Icon: ShieldCheck,
  },
  {
    title: "Refund controls",
    detail: "7-day refund window plus progress + certificate checks. Predictable rules for both sides.",
    Icon: RefreshCcw,
  },
  {
    title: "Community moderation",
    detail: "Course communities ship with reporting, moderation queue, and admin escalation.",
    Icon: Flag,
  },
  {
    title: "Verifiable credentials",
    detail: "Skillset Verified certificates carry a public verification URL employers can check.",
    Icon: Award,
  },
  {
    title: "Audit-ready payments",
    detail: "Orders, payments, refunds, payout ledger, and Stripe transfers are tracked as distinct records.",
    Icon: Receipt,
  },
];

export default function TrustPage() {
  return (
    <PublicPage
      eyebrow="Trust and safety"
      title="A marketplace needs rules before scale."
      description="Skillset is built around controlled course publication, protected student access, transparent payments, moderation, and verifiable learning outcomes."
    >
      <section className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {trustLayers.map((layer) => {
          const { Icon } = layer;
          return (
            <article
              key={layer.title}
              className="group rounded-[16px] border fine-rule bg-white p-5 shadow-[var(--shadow-soft)] transition duration-[180ms] ease-out hover:-translate-y-0.5 hover:border-[rgba(26,54,93,0.18)] hover:shadow-[0_18px_36px_rgba(15,39,68,0.10)]"
            >
              <span
                className="grid size-11 place-items-center rounded-[10px] bg-[var(--color-surface-soft)] text-[var(--color-primary)] transition-colors group-hover:bg-[var(--color-primary)] group-hover:text-white"
                aria-hidden="true"
              >
                <Icon size={20} strokeWidth={1.7} />
              </span>
              <p className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                {layer.title}
              </p>
              <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
                {layer.detail}
              </p>
            </article>
          );
        })}
      </section>
    </PublicPage>
  );
}
