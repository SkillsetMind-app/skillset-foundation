export type CreatorVerificationStatus =
  | "none"
  | "pending"
  | "needs_changes"
  | "approved"
  | "rejected";

export type CreatorVerificationCase = {
  verificationKind?: "legacy" | ProfessionalVerificationKind;
  documentPath?: string;
  id: string;
  creatorId: string;
  status: Exclude<CreatorVerificationStatus, "none">;
  profession: string;
  registrationType: string;
  registrationId: string;
  registrationRegion: string;
  evidenceLinks: string[];
  note?: string;
  reviewNote?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
  /** Joined from users in the ops queue; absent on the creator's own view. */
  applicantName?: string;
  applicantEmail?: string;
};

export type SubmitCreatorVerificationInput = {
  verificationKind: ProfessionalVerificationKind;
  profession: string;
  registrationId?: string;
  registrationRegion?: string;
  documentPath?: string;
  evidenceLinks: string[];
  note?: string;
};

export type ProfessionalVerificationKind = "psychologist" | "coach" | "holistic" | "other";

export function validateProfessionalEvidence(input: SubmitCreatorVerificationInput): void {
  if (!["psychologist", "coach", "holistic", "other"].includes(input.verificationKind)) {
    throw new Error("Choose your profession.");
  }
  if (input.profession.trim().length < 2 || input.profession.length > 120) {
    throw new Error("Describe your profession (2-120 characters).");
  }
  if (input.verificationKind === "psychologist"
      && (!(input.registrationId?.trim().length && input.registrationId.trim().length >= 2)
        || !(input.registrationRegion?.trim().length && input.registrationRegion.trim().length >= 2))) {
    throw new Error("Add your license number and issuing country or state.");
  }
  if ((input.registrationId?.length ?? 0) > 80 || (input.registrationRegion?.length ?? 0) > 80
      || (input.note?.length ?? 0) > 2000) {
    throw new Error("Shorten the registration details or note.");
  }
  if (!input.evidenceLinks.length && !input.documentPath) {
    throw new Error("Add a professional link or a certificate to request a badge.");
  }
  if (input.evidenceLinks.length > 6) throw new Error("Attach at most 6 evidence links.");
  for (const link of input.evidenceLinks) {
    let url: URL;
    try { url = new URL(link); } catch { throw new Error("Use a valid https:// professional link."); }
    if (link.length > 300 || url.protocol !== "https:" || !url.hostname || url.username || url.password) {
      throw new Error("Use a valid https:// professional link (max 300 characters).");
    }
  }
}

/**
 * The activation gate speaks through exceptions. The courses trigger raises
 * "Pay the one-time activation fee before creating or publishing courses." and
 * assertCreatorActivated throws a 402 carrying a similar sentence — so every
 * screen that can trip the gate catches a message it has to recognise.
 *
 * Recognising it is the whole point: a creator who sees "Please try again"
 * retries forever, because retrying is not what unblocks them. The sentence
 * and the match live here so a new screen gets both by importing, instead of
 * quietly falling through to the generic message.
 */
export const ACTIVATION_REQUIRED_MESSAGE =
  "Activate your storefront to unlock publishing — it is a one-time fee, charged once.";

export function isActivationRequiredError(message: string): boolean {
  return message.toLowerCase().includes("activation fee");
}
