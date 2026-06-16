import { BadgeCheck, Globe, PlayCircle, ShieldCheck, Wallet } from "lucide-react";

/**
 * Code-built product preview for the marketing hero's right column.
 *
 * The platform is pre-launch (no real screenshots exist yet), so this is an
 * illustrative product frame — it shows the *structure* and value props
 * (reviewed marketplace, payouts, verifiable certificates) rather than any
 * fabricated business metrics. Swap for real screenshots once courses ship.
 *
 * Colors are intentionally FIXED brand values, not theme tokens: the hero it
 * sits on is an always-navy section (hardcoded gradient, identical in light and
 * dark), so the mockup must read as the same bright product shot in both
 * themes. Theme tokens (--color-primary, --color-ink, --color-base) invert in
 * dark mode and would break contrast here (e.g. navy text → light blue on a
 * white card). Decorative only: hidden from a11y tree and from small screens.
 */
export function HeroProductPreview() {
  return (
    <div className="relative hidden lg:block" aria-hidden="true">
      {/* soft brand glow behind the frame for depth */}
      <div className="absolute -inset-8 rounded-[32px] bg-[radial-gradient(circle_at_70%_30%,rgba(178,34,52,0.22),transparent_60%),radial-gradient(circle_at_30%_80%,rgba(255,255,255,0.14),transparent_55%)] blur-2xl" />

      {/* app window */}
      <div className="relative rotate-[1.2deg] rounded-[20px] border border-white/15 bg-white/[0.06] p-2.5 shadow-[0_40px_90px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-transform duration-500 hover:rotate-0">
        {/* window chrome */}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="size-2.5 rounded-full bg-white/25" />
          <span className="size-2.5 rounded-full bg-white/25" />
          <span className="size-2.5 rounded-full bg-white/25" />
          <div className="ml-3 flex-1 truncate rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] text-white/55">
            skillset.app / marketplace
          </div>
        </div>

        {/* screen — fixed light palette (see file header) */}
        <div className="overflow-hidden rounded-[16px] bg-white text-[#163252]">
          {/* course cover */}
          <div className="relative h-28 bg-[linear-gradient(120deg,#0f2744,#1a365d_55%,#2c5282)]">
            <div className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#1a365d]">
              <ShieldCheck size={12} strokeWidth={2.4} />
              Reviewed by Skillset
            </div>
            <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-[#b22234] px-3 py-1.5 text-[11px] font-bold text-white">
              <PlayCircle size={13} strokeWidth={2.2} />
              Preview lesson
            </span>
          </div>

          {/* course body */}
          <div className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#b22234]">
              Professional course
            </p>
            <p className="mt-1 display-title text-[1.35rem] leading-tight text-[#1a365d]">
              Financial modeling, end to end.
            </p>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-[#4d6785]">
              <span className="size-5 rounded-full bg-[#e3eef9]" />
              <span className="font-semibold">Independent expert</span>
              <span aria-hidden>·</span>
              <span>12 modules</span>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-[rgba(26,54,93,0.12)] pt-3">
              <span className="display-title text-xl text-[#1a365d]">$149</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e4f3eb] px-2.5 py-1 text-[11px] font-semibold text-[#157049]">
                <Globe size={12} strokeWidth={2.2} />
                30+ currencies
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* floating value-prop chips for depth (fixed light palette) */}
      <div className="float-chip absolute -left-6 top-36 flex items-center gap-2.5 rounded-[12px] border border-white/40 bg-white/95 px-3.5 py-2.5 shadow-[0_18px_40px_rgba(0,0,0,0.28)]">
        <span className="grid size-8 place-items-center rounded-full bg-[#e4f3eb] text-[#157049]">
          <Wallet size={16} strokeWidth={2} />
        </span>
        <span>
          <span className="block text-[12px] font-bold leading-tight text-[#1a365d]">
            Payout cleared
          </span>
          <span className="block text-[10px] leading-tight text-[#5a6a81]">
            Direct to your bank
          </span>
        </span>
      </div>

      <div className="float-chip-delayed absolute -right-5 bottom-16 flex items-center gap-2.5 rounded-[12px] border border-white/40 bg-white/95 px-3.5 py-2.5 shadow-[0_18px_40px_rgba(0,0,0,0.28)]">
        <span className="grid size-8 place-items-center rounded-full bg-[#ebf3fb] text-[#2c5282]">
          <BadgeCheck size={16} strokeWidth={2} />
        </span>
        <span>
          <span className="block text-[12px] font-bold leading-tight text-[#1a365d]">
            Certificate verified
          </span>
          <span className="block text-[10px] leading-tight text-[#5a6a81]">
            Public verification URL
          </span>
        </span>
      </div>
    </div>
  );
}
