"use client";

import type {
  CourseCommerceSettings,
  CourseCoproducer,
  CourseCoupon,
  CreateCourseCouponInput,
  InviteCourseCoproducerInput,
  TaxRegion,
  UpsertCourseCommerceSettingsInput,
} from "@/domain/course-commerce";
import { TAX_REGIONS } from "@/domain/course-commerce";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

const settingsTable = "course_commerce_settings";
const couponsTable = "course_coupons";
const coproducersTable = "course_coproducers";

type SettingsRow = Database["public"]["Tables"]["course_commerce_settings"]["Row"];
type CouponRow = Database["public"]["Tables"]["course_coupons"]["Row"];
type CoproducerRow = Database["public"]["Tables"]["course_coproducers"]["Row"];

function rowToSettings(row: SettingsRow): CourseCommerceSettings {
  return {
    courseId: row.course_id,
    ownerId: row.owner_id,
    affiliateEnabled: row.affiliate_enabled,
    affiliateCommissionPct: row.affiliate_commission_pct,
    affiliateApproval:
      row.affiliate_approval as CourseCommerceSettings["affiliateApproval"],
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

function rowToCoproducer(row: CoproducerRow): CourseCoproducer {
  return {
    id: row.id,
    courseId: row.course_id,
    ownerId: row.owner_id,
    inviteeEmail: row.invitee_email,
    revenueSharePct: row.revenue_share_pct,
    status: row.status as CourseCoproducer["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// All writes go through owner-checked SECURITY DEFINER RPCs. Activation
// actions (affiliate enable, coupon activate) are additionally gated on the
// require_creator_verification platform flag server-side.
export async function upsertCourseCommerceSettings(
  input: UpsertCourseCommerceSettingsInput,
) {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc("upsert_course_commerce_settings", {
    p_course_id: input.courseId,
    p_affiliate_enabled: input.affiliateEnabled,
    p_affiliate_commission_pct: input.affiliateCommissionPct,
    p_affiliate_approval: input.affiliateApproval,
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

export async function inviteCourseCoproducer(
  input: InviteCourseCoproducerInput,
) {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc("invite_course_coproducer", {
    p_course_id: input.courseId,
    p_email: input.email.trim(),
    p_share_pct: input.sharePct,
  });

  if (error) {
    throw error;
  }
}

export async function revokeCourseCoproducer(coproducerId: string) {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc("revoke_course_coproducer", {
    p_coproducer_id: coproducerId,
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

export function subscribeToCourseCoproducers(
  courseId: string,
  callback: (coproducers: CourseCoproducer[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    // Revoked invitations stay in the table for audit; the panel only shows
    // live ones. Filtered client-side so realtime UPDATEs (invited → revoked)
    // still reach this channel.
    const { data, error } = await supabase
      .from(coproducersTable)
      .select("*")
      .eq("course_id", courseId)
      .order("created_at", { ascending: true });

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback(
      (data ?? [])
        .map(rowToCoproducer)
        .filter((coproducer) => coproducer.status !== "revoked"),
    );
  };

  void load();

  const channel = supabase
    .channel(`course_coproducers:${courseId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: coproducersTable,
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
