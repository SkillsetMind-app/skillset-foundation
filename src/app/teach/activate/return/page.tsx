import { Info } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PaymentReturnCard } from "@/components/account/payment-return-card";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { ActivationReturnLink } from "@/components/teacher/activation-return-link";
import { buttonClasses } from "@/components/ui/button";
import { getServerTranslation } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("activationCheckout.returnTitle");
}

/**
 * Post-checkout landing. Deliberately does NOT decide whether the fee is paid:
 * the Stripe webhook stamps `users.activation_fee_paid_at` and the SQL publish
 * gate reads that column, so reporting success from a return URL a creator can
 * type by hand would be a lie the database might not agree with.
 */
export default async function TeachActivateReturnPage() {
  // Same switch as /teach/activate: off (or paid, waived, admin, signed out),
  // there is no payment to confirm here.
  const supabase = await createSupabaseServerClient();
  const { data: blocked } = await supabase.rpc("creator_activation_blocked");
  if (blocked !== true) redirect("/teach");
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title={t("activationCheckout.returnTitle")} compact>
        {/* The same card as the plan return. The "Thanks" and the second
            serif go away: the screen's serif is the page title. */}
        <PaymentReturnCard
          icon={<Info aria-hidden="true" size={20} />}
          heading={t("activationCheckout.confirming")}
          body={t("activationCheckout.returnBody")}
          actions={
            <>
              {/* The course the creator was publishing, kept in this tab by the
                  checkout panel; /teach when there is none. */}
              <ActivationReturnLink className={buttonClasses({ variant: "solid" })}>
                {t("activationCheckout.backToCourseStudio")}
              </ActivationReturnLink>
              <Link href="/support" className={buttonClasses({ variant: "outline" })}>
                {t("activationCheckout.support")}
              </Link>
            </>
          }
        />
      </PlatformShell>
    </ProtectedSurface>
  );
}
