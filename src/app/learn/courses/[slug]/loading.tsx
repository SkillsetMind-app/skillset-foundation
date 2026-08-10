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
 *
 * Colours are hardcoded dark literals, not --ma-* tokens: nothing above this
 * file carries data-members-theme yet, so the tokens would resolve to nothing
 * and the skeleton would paint light before flipping dark a beat later. The
 * literals are the same values as the dark palette in globals.css.
 */
export default function LoadingCourse() {
  return (
    <div className="flex min-h-screen items-start justify-center bg-[#0a0d12] px-4 py-16">
      <section className="w-full max-w-3xl rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[#141923] p-6">
        <p className="text-sm text-[#9aa6b6]">Loading course...</p>
      </section>
    </div>
  );
}
