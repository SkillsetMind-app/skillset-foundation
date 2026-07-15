/**
 * Affiliate attribution for checkout (Hotmart-parity: track ref at purchase).
 * Settlement/transfer split can consume the same metadata later.
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
