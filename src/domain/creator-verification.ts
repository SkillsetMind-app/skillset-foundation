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
