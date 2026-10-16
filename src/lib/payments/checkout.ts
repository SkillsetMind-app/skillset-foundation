"use client";

import { postPaymentRoute } from "@/lib/payments/client-fetch";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export async function startCourseCheckout(
  courseId: string,
  options?: {
    couponCode?: string;
    offerId?: string;
    offerCode?: string;
    priceId?: string;
  },
) {
  const { url } = await postPaymentRoute<{ url: string }>(
    "/api/payments/checkout",
    {
      courseId,
      ...(options?.couponCode ? { couponCode: options.couponCode } : {}),
      ...(options?.offerId ? { offerId: options.offerId } : {}),
      ...(options?.offerCode ? { offerCode: options.offerCode } : {}),
      ...(options?.priceId ? { priceId: options.priceId } : {}),
    },
  );

  if (!url) {
    throw new Error("Checkout URL missing.");
  }

  window.location.assign(url);
}

// Guest checkout (no session): goes to Stripe, or reports that the access link
// was e-mailed instead (/api/payments/guest-checkout).
export async function startGuestCourseCheckout(input: {
  courseId: string;
  name: string;
  email: string;
  captchaToken: string;
  offerId?: string;
  offerCode?: string;
  priceId?: string;
}): Promise<"redirected" | "access_link_sent"> {
  const { courseId, name, email, captchaToken, offerId, offerCode, priceId } = input;
  const { url, status } = await postPaymentRoute<{ url?: string; status?: string }>(
    "/api/payments/guest-checkout",
    {
      courseId,
      name,
      email,
      acceptTerms: true,
      captchaToken,
      ...(offerId ? { offerId } : {}),
      ...(offerCode ? { offerCode } : {}),
      ...(priceId ? { priceId } : {}),
    },
  );

  if (url) {
    window.location.assign(url);
    return "redirected";
  }
  if (status === "access_link_sent") return status;
  throw new Error("Checkout URL missing.");
}

export async function enrollInFreeCreatorCourse(courseId: string) {
  // Free enrollment is a trusted-write RPC (no Stripe), called directly.
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("create_free_course_enrollment", {
    p_course_id: courseId,
  });

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("Enrollment was not created.");
  }

  return data;
}
