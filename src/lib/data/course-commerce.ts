"use client";

import type {
  CourseCommerceSettings,
  CourseCoupon,
  CreateCourseCouponInput,
  TaxRegion,
  UpsertCourseCommerceSettingsInput,
} from "@/domain/course-commerce";
import { TAX_REGIONS } from "@/domain/course-commerce";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

const settingsTable = "course_commerce_settings";
const couponsTable = "course_coupons";

type SettingsRow = Database["public"]["Tables"]["course_commerce_settings"]["Row"];
type CouponRow = Database["public"]["Tables"]["course_coupons"]["Row"];

function rowToSettings(row: SettingsRow): CourseCommerceSettings {
  return {
    courseId: row.course_id,
    ownerId: row.owner_id,
    taxCollection: row.tax_collection,
    taxRegions: Array.isArray(row.tax_regions)
      ? row.tax_regions.filter((region): region is TaxRegion =>
          (TAX_REGIONS as readonly string[]).includes(region as string),
        )
      : [],
    taxRegistrationId: row.tax_registration_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCoupon(row: CouponRow): CourseCoupon {
  return {
    id: row.id,
    courseId: row.course_id,
    ownerId: row.owner_id,
    code: row.code,
    percentOff: row.percent_off,
    maxRedemptions: row.max_redemptions,
    redeemedCount: row.redeemed_count,
    expiresAt: row.expires_at ?? undefined,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// All writes go through owner-checked SECURITY DEFINER RPCs. Activation
// actions (coupon activate) are additionally gated on the
// require_creator_verification platform flag server-side.
export async function upsertCourseCommerceSettings(
  input: UpsertCourseCommerceSettingsInput,
) {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc("upsert_course_commerce_settings", {
    p_course_id: input.courseId,
    p_tax_collection: input.taxCollection,
    p_tax_regions: input.taxRegions,
    p_tax_registration_id: input.taxRegistrationId?.trim() || undefined,
  });

  if (error) {
    throw error;
  }
}

export async function createCourseCoupon(input: CreateCourseCouponInput) {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc("create_course_coupon", {
    p_course_id: input.courseId,
    p_code: input.code,
    p_percent_off: input.percentOff,
    p_max_redemptions: input.maxRedemptions,
    p_expires_at: input.expiresAt,
  });

  if (error) {
    throw error;
  }
}

export async function setCourseCouponActive(couponId: string, active: boolean) {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc("set_course_coupon_active", {
    p_coupon_id: couponId,
    p_active: active,
  });

  if (error) {
    throw error;
  }
}

export async function deleteCourseCoupon(couponId: string) {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc("delete_course_coupon", {
    p_coupon_id: couponId,
  });

  if (error) {
    throw error;
  }
}

export function subscribeToCourseCommerceSettings(
  courseId: string,
  callback: (settings: CourseCommerceSettings | null) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from(settingsTable)
      .select("*")
      .eq("course_id", courseId)
      .maybeSingle();

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback(data ? rowToSettings(data) : null);
  };

  void load();

  const channel = supabase
    .channel(`course_commerce_settings:${courseId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: settingsTable,
        filter: `course_id=eq.${courseId}`,
      },
      () => {
        void load();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToCourseCoupons(
  courseId: string,
  callback: (coupons: CourseCoupon[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from(couponsTable)
      .select("*")
      .eq("course_id", courseId)
      .order("created_at", { ascending: false });

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback((data ?? []).map(rowToCoupon));
  };

  void load();

  const channel = supabase
    .channel(`course_coupons:${courseId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: couponsTable,
        filter: `course_id=eq.${courseId}`,
      },
      () => {
        void load();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
