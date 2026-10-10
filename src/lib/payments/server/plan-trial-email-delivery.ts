import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";

// Local RPC types keep this migration isolated from the concurrently edited
// generated schema. No untyped access to the other billing tables.
type DeliveryDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      claim_plan_trial_email: { Args: { p_key: string; p_payload?: string }; Returns: Json };
      finish_plan_trial_email: {
        Args: { p_key: string; p_token: string; p_outcome: string }; Returns: boolean;
      };
    };
  };
};

export async function deliverPlanTrialEmail(
  admin: SupabaseClient<Database>,
  idempotencyKey: string,
  preparePayload: () => Promise<string>,
): Promise<void> {
  const db = admin as unknown as SupabaseClient<DeliveryDatabase>;
  async function claim(payload?: string) {
    const { data, error } = await db.rpc("claim_plan_trial_email", {
      p_key: idempotencyKey, ...(payload === undefined ? {} : { p_payload: payload }),
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Could not claim trial email delivery.");
    }
    return data;
  }

  let delivery = await claim();
  if (delivery.action === "missing") delivery = await claim(await preparePayload());
  if (delivery.action === "done") return;
  if (delivery.action === "manual") {
    throw new Error("Trial email delivery uncertain beyond the retry window; manual reconciliation required.");
  }
  if (delivery.action === "busy") throw new Error("Trial email delivery is already in progress; retry later.");
  if (delivery.action !== "send" || typeof delivery.payload !== "string"
    || typeof delivery.token !== "string" || typeof delivery.send_before !== "string"
    || !Number.isFinite(Date.parse(delivery.send_before))) {
    throw new Error("Invalid trial email delivery claim.");
  }

  let outcome: "accepted" | "rejected" | "uncertain" = "rejected";
  const apiKey = process.env.RESEND_API_KEY;
  if (Date.now() >= Date.parse(delivery.send_before)) {
    outcome = "uncertain";
  } else if (apiKey) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: delivery.payload,
        signal: AbortSignal.timeout(10_000),
      });
      // Never read/log the provider body. 409, 5xx and transport failures do
      // not prove non-delivery; later rejections cannot erase that uncertainty.
      outcome = response.ok ? "accepted"
        : [400, 401, 403, 404, 405, 422, 429].includes(response.status) ? "rejected" : "uncertain";
    } catch {
      outcome = "uncertain";
    }
  }
  const { data: finished, error } = await db.rpc("finish_plan_trial_email", {
    p_key: idempotencyKey, p_token: delivery.token, p_outcome: outcome,
  });
  if (error || finished !== true) throw new Error("Could not record trial email delivery outcome.");
  if (outcome !== "accepted") throw new Error(`Trial email delivery ${outcome}; retry or reconcile the stored delivery.`);
}
