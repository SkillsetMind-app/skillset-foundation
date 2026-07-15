/**
 * Affiliate attribution + settlement helpers (Hotmart-parity money path).
 * Checkout stamps metadata; webhook settles a payout_ledger row on payment success.
 */
export type AffiliateAttributionInput = {
  affiliateRef: string | null | undefined;
  buyerUserId: string;
  teacherUserId: string;
  affiliateEnabled: boolean;
  commissionPct: number;
  amountMinor: number;
};

export type AffiliateAttribution =
  | {
      ok: true;
      affiliateUserId: string;
      commissionPct: number;
      commissionMinor: number;
    }
  | { ok: false; reason: string };

export type AffiliateSettlementFromMetadata = {
  affiliateUserId: string;
  commissionPct: number;
  commissionMinor: number;
} | null;

export function normalizeAffiliateRef(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .slice(0, 160);
}

export function computeAffiliateCommissionMinor(
  amountMinor: number,
  commissionPct: number,
): number {
  const pct = Math.min(60, Math.max(0, Math.floor(commissionPct)));
  if (!Number.isFinite(amountMinor) || amountMinor <= 0 || pct <= 0) return 0;
  return Math.floor((amountMinor * pct) / 100);
}

/**
 * Resolve whether a checkout should attribute an affiliate.
 * `affiliateRef` is expected to be the affiliate's platform user id (uid).
 */
export function resolveAffiliateAttribution(
  input: AffiliateAttributionInput,
): AffiliateAttribution {
  const affiliateUserId = normalizeAffiliateRef(input.affiliateRef);
  if (!affiliateUserId) {
    return { ok: false, reason: "No affiliate ref." };
  }
  if (!input.affiliateEnabled) {
    return { ok: false, reason: "Affiliate program is disabled for this course." };
  }
  if (affiliateUserId === input.buyerUserId) {
    return { ok: false, reason: "Buyer cannot be their own affiliate." };
  }
  if (affiliateUserId === input.teacherUserId) {
    return { ok: false, reason: "Teacher cannot be their own affiliate." };
  }
  const commissionPct = Math.min(
    60,
    Math.max(0, Math.floor(Number(input.commissionPct) || 0)),
  );
  if (commissionPct < 5) {
    return { ok: false, reason: "Affiliate commission is not configured." };
  }
  const commissionMinor = computeAffiliateCommissionMinor(
    input.amountMinor,
    commissionPct,
  );
  if (commissionMinor <= 0) {
    return { ok: false, reason: "Commission would be zero." };
  }
  return {
    ok: true,
    affiliateUserId,
    commissionPct,
    commissionMinor,
  };
}

/**
 * Read affiliate settlement snapshot stamped on Stripe Checkout / Subscription metadata.
 * Prefers explicit commissionMinor; falls back to pct * grossAmountMinor.
 */
export function parseAffiliateSettlementFromMetadata(
  metadata: Record<string, string | undefined> | null | undefined,
  grossAmountMinor: number,
  opts?: { buyerUserId?: string | null; teacherUserId?: string | null },
): AffiliateSettlementFromMetadata {
  const affiliateUserId = normalizeAffiliateRef(metadata?.affiliateUserId);
  if (!affiliateUserId) return null;
  if (opts?.buyerUserId && affiliateUserId === opts.buyerUserId) return null;
  if (opts?.teacherUserId && affiliateUserId === opts.teacherUserId) return null;

  const pctRaw = Number(metadata?.affiliateCommissionPct ?? 0);
  const commissionPct = Math.min(60, Math.max(0, Math.floor(pctRaw || 0)));

  const stamped = Number(metadata?.affiliateCommissionMinor ?? NaN);
  let commissionMinor = Number.isFinite(stamped) && stamped > 0 ? Math.floor(stamped) : 0;
  if (commissionMinor <= 0 && commissionPct >= 5) {
    commissionMinor = computeAffiliateCommissionMinor(grossAmountMinor, commissionPct);
  }
  if (commissionMinor <= 0) return null;
  // Never pay more commission than the gross sale.
  commissionMinor = Math.min(commissionMinor, Math.max(0, Math.floor(grossAmountMinor)));
  return { affiliateUserId, commissionPct, commissionMinor };
}

/** Deterministic payout_ledger id for affiliate commission on a sale root id. */
export function affiliateCommissionLedgerId(saleRootId: string): string {
  return `${saleRootId}__aff`;
}

/**
 * Teacher net after affiliate take. Platform + Stripe fees already deducted upstream.
 */
export function teacherNetAfterAffiliate(
  teacherNetBeforeAffiliate: number,
  affiliateCommissionMinor: number,
): number {
  return Math.max(
    0,
    Math.floor(teacherNetBeforeAffiliate) - Math.max(0, Math.floor(affiliateCommissionMinor)),
  );
}
