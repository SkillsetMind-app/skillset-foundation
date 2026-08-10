/**
 * Stripe's success_url lands here, and the page awaits two Supabase queries
 * before it returns anything. Without this file Next keeps the *previous*
 * page painted for that whole round trip, so a buyer who just paid stares at
 * the checkout page and assumes the purchase failed.
 *
 * No MemberAreaShell here on purpose: the shell renders a wordmark, and the
 * whitelabel brand is only known after the queries resolve. Framing this in
 * the shell would show the SkillsetMind mark and then blink it away — the
 * exact flash the page's server-side brand lookup exists to prevent.
 */
export default function LoadingCourse() {
  return (
    <div className="flex min-h-screen items-start justify-center bg-[var(--color-surface-soft)] px-4 py-16">
      <section className="w-full max-w-3xl rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
        <p className="text-sm text-[var(--color-ink-soft)]">Loading course...</p>
      </section>
    </div>
  );
}
