export type CreatorVerificationStatus =
  | "none"
  | "pending"
  | "needs_changes"
  | "approved"
  | "rejected";

export type CreatorVerificationCase = {
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
  profession: string;
  registrationType: string;
  registrationId: string;
  registrationRegion: string;
  evidenceLinks: string[];
  note?: string;
};

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
