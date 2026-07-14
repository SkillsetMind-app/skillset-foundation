import type { Enrollment } from "@/domain/enrollment";

export type CertificateStatus = "in_progress" | "eligible" | "issued" | "revoked";

export type Certificate = {
  id: string;
  enrollmentId: string;
  userId: string;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  courseCategory: string;
  authorityLabel: "SkillsetMind Verified";
  status: Extract<CertificateStatus, "issued" | "revoked">;
  verificationCode: string;
  /** Locked at issuance — the learner's full name printed on the credential. */
  studentFullName?: string | null;
  /** Snapshot of the course owner's display name at issuance. */
  teacherName?: string | null;
  /** Snapshot of the teacher's uploaded signature image at issuance, if any. */
  teacherSignatureUrl?: string | null;
  /** Optional partner/sponsor mark; null until a co-brand asset is provided. */
  sponsorLogoUrl?: string | null;
  issuedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type CredentialCandidate = {
  enrollmentId: string;
  userId: string;
  courseSlug: string;
  courseTitle: string;
  courseCategory: string;
  progressPercent: number;
  status: CertificateStatus;
  authorityLabel: "SkillsetMind Verified";
  certificateId?: string | null;
  verificationCode?: string | null;
};

export function getCredentialCandidate(
  enrollment: Enrollment,
  certificate?: Certificate | null,
): CredentialCandidate {
  const isComplete =
    enrollment.status === "completed" || enrollment.progressPercent >= 100;

  return {
    enrollmentId: enrollment.id,
    userId: enrollment.userId,
    courseSlug: enrollment.courseSlug,
    courseTitle: enrollment.courseTitle,
    courseCategory: enrollment.courseCategory,
    progressPercent: enrollment.progressPercent,
    status: certificate?.status === "issued"
      ? "issued"
      : isComplete
        ? "eligible"
        : "in_progress",
    authorityLabel: "SkillsetMind Verified",
    certificateId: certificate?.id ?? null,
    verificationCode: certificate?.verificationCode ?? null,
  };
}

export function getCertificateStatusLabel(status: CertificateStatus): string {
  const labels: Record<CertificateStatus, string> = {
    in_progress: "In progress",
    eligible: "Ready for review",
    issued: "Issued",
    revoked: "Revoked",
  };

  return labels[status];
}
