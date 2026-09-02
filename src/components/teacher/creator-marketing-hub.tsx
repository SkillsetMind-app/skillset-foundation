import Link from "next/link";
import {
  ArrowRight,
  BadgePercent,
  Image,
  MessageCircle,
  Plug,
  Store,
  type LucideIcon,
} from "lucide-react";

const marketingTools: Array<{
  title: string;
  description: string;
  href: string;
  action: string;
  icon: LucideIcon;
}> = [
  {
    title: "Storefront & product pages",
    description: "Manage your public practitioner profile and the pages buyers visit.",
    href: "/teach/storefront",
    action: "Open storefront",
    icon: Store,
  },
  {
    title: "Media library",
    description: "Keep course covers, lesson assets, and campaign media organized.",
    href: "/teach/media",
    action: "Open library",
    icon: Image,
  },
  {
    title: "Buyer messages",
    description: "Continue product and enrollment conversations from one inbox.",
    href: "/teach/messages",
    action: "Open messages",
    icon: MessageCircle,
  },
  {
    title: "Coupons & promotions",
    description: "Open a product to configure its discount codes and offer rules.",
    href: "/teach/coupons",
    action: "Manage promotions",
    icon: BadgePercent,
  },
  {
    title: "Integrations",
    // The destination is a roadmap page, so the card says so. Selling it in
    // the present tense ("Connect the services…" / "Manage integrations")
    // spent a click to deliver a disappointment.
    description: "Email tools, webhooks, and analytics destinations are on the roadmap.",
    href: "/teach/integrations",
    action: "See what's planned",
    icon: Plug,
  },
];

export function CreatorMarketingHub() {
  return (
    <div className="grid gap-7">
      <header className="border-b border-[var(--color-line)] pb-5">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-accent-fg)]">
          Marketing
        </p>
        <h1 className="mt-2 text-3xl font-semibold leading-tight text-[var(--color-primary)]">
          Grow each product from one workspace
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
          Prepare the public experience, organize campaign assets, and keep buyer conversations
          connected to the product being sold.
        </p>
      </header>

      <section aria-labelledby="marketing-tools-title">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="marketing-tools-title" className="text-lg font-semibold text-[var(--color-ink)]">
            Marketing workspace
          </h2>
          <span className="text-sm tabular-nums text-[var(--color-ink-muted)]">
            {marketingTools.length} tools
          </span>
        </div>

        <div className="mt-4 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
          {marketingTools.map((tool) => {
            const Icon = tool.icon;

            return (
              <article
                key={tool.href}
                className="grid gap-4 bg-white px-3 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:px-4"
              >
                <span className="grid size-10 place-items-center rounded-[7px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
                  <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-ink)]">{tool.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
                    {tool.description}
                  </p>
                </div>
                <Link href={tool.href} className="button-outline px-3 text-xs">
                  {tool.action}
                  <ArrowRight aria-hidden="true" size={14} strokeWidth={1.8} />
                </Link>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
