"use client";

import { postPaymentRoute } from "@/lib/payments/client-fetch";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export async function startCourseCheckout(
  courseId: string,
  options?: { couponCode?: string; affiliateRef?: string },
) {
  // Capture affiliate ref from URL (?ref= / ?affiliate=) when not passed explicitly.
  let affiliateRef = options?.affiliateRef?.trim() || "";
  if (!affiliateRef && typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    affiliateRef =
      params.get("ref")?.trim()
      || params.get("affiliate")?.trim()
      || params.get("aff")?.trim()
      || "";
  }

  const { url } = await postPaymentRoute<{ url: string }>(
    "/api/payments/checkout",
    {
      courseId,
      ...(options?.couponCode ? { couponCode: options.couponCode } : {}),
      ...(affiliateRef ? { affiliateRef } : {}),
    },
  );

  if (!url) {
    throw new Error("Checkout URL missing.");
  }

  window.location.assign(url);
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
