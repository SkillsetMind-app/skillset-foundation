// WhatsApp click-to-chat for the public contact routes. Off until
// NEXT_PUBLIC_WHATSAPP_NUMBER holds a real number: empty or malformed renders
// nothing at all, so shipping this changes no page today. The number is public
// by design (it is shown to every visitor), hence NEXT_PUBLIC_; like every
// NEXT_PUBLIC_ value it is read at build, so setting it needs a redeploy.

// wa.me wants the international number as digits only (E.164 without "+").
const WHATSAPP_DIGITS = /^\d{8,15}$/;

export function whatsAppHref(message: string): string | null {
  const digits = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "").replace(/\D/g, "");
  return WHATSAPP_DIGITS.test(digits) ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : null;
}

// No hooks: takes the caller's translator, so server pages pass their own t.
export function WhatsAppContact({ t, className = "" }: { t: (key: string) => string; className?: string }) {
  const href = whatsAppHref(t("whatsappContact.message"));
  if (!href) return null;
  return (
    <p className={`text-sm leading-7 text-[var(--color-ink-soft)] ${className}`}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center font-semibold text-[var(--color-primary)] hover:underline"
      >
        {t("whatsappContact.cta")} &rarr;
      </a>{" "}
      {t("whatsappContact.replyPromise")}
    </p>
  );
}
