import { NextResponse } from "next/server";

import {
  isSupportedStripeCurrency,
  supportedStripeCurrencies,
} from "@/lib/payments/currencies";
import {
  enforceRateLimit,
  PaymentError,
  paymentErrorResponse,
  requireUserId,
} from "@/lib/payments/server/auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

// Each POST creates a Stripe product + price, so it is billable work on our
// account: 30/hour is far above any real editing session. The GET is read-only
// but fans out one price query per offer, so it gets a looser per-minute cap.
const OFFER_WRITES_PER_HOUR = 30;
const OFFER_READS_PER_MINUTE = 60;

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
    await enforceRateLimit(`offer_write_${userId}`, OFFER_WRITES_PER_HOUR, 60 * 60 * 1000);
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
    // Integer, not just finite: a minor unit is the smallest amount that exists,
    // so 12.5 is not a price. isFinite accepted it and let a fraction of a cent
    // reach the price row, where every later conversion has to round it.
    if (!Number.isInteger(amountMinor) || amountMinor < 0) {
      throw new PaymentError("amountMinor must be a non-negative whole number.");
    }
    if (
      !["one_time", "subscription_monthly", "subscription_yearly", "free"].includes(
        paymentType,
      )
    ) {
      throw new PaymentError("Invalid paymentType.");
    }
    // A moeda era o único campo desta rota que entrava sem validação: qualquer
    // sigla de 3 letras passava. Downstream, normalizeSkillsetCurrency() troca o
    // que não reconhece por USD EM SILÊNCIO — então "SEK 990" vira "USD 990", um
    // preço quase 10x errado que ninguém vê acontecer. Recusar na entrada, como
    // a rota já faz com paymentType, em vez de deixar a normalização decidir.
    if (!isSupportedStripeCurrency(currency)) {
      throw new PaymentError(
        `Unsupported currency "${currency}". Supported: ${supportedStripeCurrencies.join(", ")}.`,
      );
    }
    if (paymentType === "free" && amountMinor !== 0) {
      throw new PaymentError("A free offer must have a zero price.");
    }
    if (paymentType !== "free" && amountMinor <= 0) {
      throw new PaymentError("A paid offer must have a positive price.");
    }
    if (paymentType === "free" && !isDefault) {
      throw new PaymentError(
        "Free access must be the default offer so enrollment rules stay consistent.",
      );
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

    const offerId = crypto.randomUUID();
    const priceId = crypto.randomUUID();
    const { data: createdOffer, error: createError } = await admin.rpc(
      "create_product_offer_atomic",
      {
        p_course_id: courseId,
        p_owner_id: userId,
        p_offer_id: offerId,
        p_price_id: priceId,
        p_name: name,
        p_amount_minor: amountMinor,
        p_currency: currency,
        p_payment_type: paymentType,
        p_is_default: isDefault,
        // Omitted rather than null: the function declares
        // `p_public_code text DEFAULT NULL`, so leaving it out applies that
        // default. The generated type renders defaulted args as optional and
        // non-nullable, so passing null would need a cast for no behavior gain.
        p_public_code: publicCode || undefined,
      },
    );
    if (createError) throw new Error(createError.message);

    return NextResponse.json(
      createdOffer ?? {
        offerId,
        priceId,
        name,
        amountMinor,
        currency,
        paymentType,
        isDefault,
        publicCode: publicCode || null,
      },
    );
  } catch (error) {
    return paymentErrorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    await enforceRateLimit(`offer_read_${userId}`, OFFER_READS_PER_MINUTE, 60_000);
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

    const { data: offers, error } = await admin
      .from("product_offers")
      .select("id,course_id,name,is_default,active,public_code,created_at")
      .eq("course_id", courseId)
      .order("created_at", { ascending: false });
    if (error) {
      // Raw Postgres messages name columns, constraints and policies — schema
      // recon for anyone who can reach this route. Log it, return a flag.
      console.error("Offer list query failed", error);
      return NextResponse.json({ offers: [], warning: "Offers are unavailable." });
    }

    const result = [];
    for (const offer of offers ?? []) {
      const { data: prices } = await admin
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
    // paymentErrorResponse already surfaces PaymentError verbatim and turns
    // everything else into a logged, opaque 500 — the hand-rolled branch below
    // it was leaking raw driver messages instead.
    return paymentErrorResponse(error);
  }
}
