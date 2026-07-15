import { NextResponse } from "next/server";

import {
  PaymentError,
  paymentErrorResponse,
  requireUserId,
} from "@/lib/payments/server/auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type Body = {
  courseId?: unknown;
  name?: unknown;
  amountMinor?: unknown;
  currency?: unknown;
  paymentType?: unknown;
  isDefault?: unknown;
  publicCode?: unknown;
};

/**
 * POST /api/teach/offers — create a product offer + price for multi-price checkout.
 * Owner-only. Dual-read checkout picks default active offer when present.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json().catch(() => ({}))) as Body;
    const courseId = String(body.courseId ?? "").trim();
    const name = String(body.name ?? "Offer").trim().slice(0, 80) || "Offer";
    const amountMinor = Number(body.amountMinor);
    const currency = String(body.currency ?? "USD").trim().toUpperCase() || "USD";
    const paymentType = String(body.paymentType ?? "one_time").trim();
    const isDefault = Boolean(body.isDefault);
    const publicCode = String(body.publicCode ?? "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "")
      .slice(0, 24);

    if (!courseId) {
      throw new PaymentError("courseId is required.");
    }
    if (!Number.isFinite(amountMinor) || amountMinor < 0) {
      throw new PaymentError("amountMinor must be a non-negative number.");
    }
    if (
      !["one_time", "subscription_monthly", "subscription_yearly", "free"].includes(
        paymentType,
      )
    ) {
      throw new PaymentError("Invalid paymentType.");
    }

    const admin = getSupabaseAdminClient();
    const { data: course, error: courseError } = await admin
      .from("courses")
      .select("id,owner_id")
      .eq("id", courseId)
      .maybeSingle();
    if (courseError) throw new Error(courseError.message);
    if (!course) throw new PaymentError("Course not found.", 404);
    if (course.owner_id !== userId) {
      throw new PaymentError("Only the course owner can manage offers.", 403);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;
    const offerId = crypto.randomUUID();
    const priceId = crypto.randomUUID();
    const now = new Date().toISOString();

    if (isDefault) {
      await db
        .from("product_offers")
        .update({ is_default: false, updated_at: now })
        .eq("course_id", courseId);
    }

    const { error: offerError } = await db.from("product_offers").insert({
      id: offerId,
      course_id: courseId,
      name,
      is_default: isDefault,
      active: true,
      public_code: publicCode || null,
      created_at: now,
      updated_at: now,
    });
    if (offerError) {
      throw new PaymentError(
        offerError.message?.includes("product_offers")
          ? "Offers table is not applied yet. Run migration 20260715_hotmart_parity_money_path.sql on Supabase."
          : offerError.message,
      );
    }

    const { error: priceError } = await db.from("product_prices").insert({
      id: priceId,
      offer_id: offerId,
      amount_minor: amountMinor,
      currency,
      payment_type: paymentType,
      stripe_price_id: null,
      active: true,
      created_at: now,
      updated_at: now,
    });
    if (priceError) {
      throw new Error(priceError.message);
    }

    // Keep legacy columns in sync when this is the default offer (compat adapter).
    if (isDefault && paymentType !== "free") {
      await admin
        .from("courses")
        .update({
          price_amount_minor: amountMinor,
          currency,
          payment_type: paymentType,
          updated_at: now,
        })
        .eq("id", courseId);
    }

    return NextResponse.json({
      offerId,
      priceId,
      name,
      amountMinor,
      currency,
      paymentType,
      isDefault,
      publicCode: publicCode || null,
    });
  } catch (error) {
    if (error instanceof PaymentError) {
      return paymentErrorResponse(error);
    }
    console.error("[teach/offers]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Offer create failed." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const courseId = new URL(request.url).searchParams.get("courseId")?.trim() || "";
    if (!courseId) {
      throw new PaymentError("courseId is required.");
    }
    const admin = getSupabaseAdminClient();
    const { data: course } = await admin
      .from("courses")
      .select("id,owner_id")
      .eq("id", courseId)
      .maybeSingle();
    if (!course) throw new PaymentError("Course not found.", 404);
    if (course.owner_id !== userId) {
      throw new PaymentError("Only the course owner can list offers.", 403);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;
    const { data: offers, error } = await db
      .from("product_offers")
      .select("id,course_id,name,is_default,active,public_code,created_at")
      .eq("course_id", courseId)
      .order("created_at", { ascending: false });
    if (error) {
      return NextResponse.json({ offers: [], warning: error.message });
    }

    const result = [];
    for (const offer of offers ?? []) {
      const { data: prices } = await db
        .from("product_prices")
        .select("id,amount_minor,currency,payment_type,stripe_price_id,active")
        .eq("offer_id", offer.id);
      result.push({
        id: offer.id,
        name: offer.name,
        isDefault: offer.is_default,
        active: offer.active,
        publicCode: offer.public_code,
        prices: (prices ?? []).map(
          (price: {
            id: string;
            amount_minor: number;
            currency: string;
            payment_type: string;
            stripe_price_id: string | null;
            active: boolean;
          }) => ({
            id: price.id,
            amountMinor: Number(price.amount_minor),
            currency: price.currency,
            paymentType: price.payment_type,
            stripePriceId: price.stripe_price_id,
            active: price.active,
          }),
        ),
      });
    }

    return NextResponse.json({ offers: result });
  } catch (error) {
    if (error instanceof PaymentError) {
      return paymentErrorResponse(error);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Offer list failed." },
      { status: 500 },
    );
  }
}
