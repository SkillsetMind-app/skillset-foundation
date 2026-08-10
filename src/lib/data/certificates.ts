"use client";

import type { Certificate } from "@/domain/certificate";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

const certificatesTable = "certificates";

type CertificateRow = Database["public"]["Tables"]["certificates"]["Row"];

// Postgres timestamptz comes back as an ISO string, not a Firestore Timestamp.
// The Certificate consumers coerce issuedAt via a Date-or-string helper.
function rowToCertificate(row: CertificateRow): Certificate {
  return {
    id: row.id,
    enrollmentId: row.enrollment_id,
    userId: row.user_id,
    courseId: row.course_id,
    courseSlug: row.course_slug,
    courseTitle: row.course_title,
    courseCategory: row.course_category,
    authorityLabel: "SkillsetMind Verified",
    status: row.status as Certificate["status"],
    verificationCode: row.verification_code,
    studentFullName: row.student_full_name,
    teacherName: row.teacher_name,
    teacherSignatureUrl: row.teacher_signature_url,
    sponsorLogoUrl: row.sponsor_logo_url,
    hidePlatformBrand: row.hide_platform_brand,
    issuedAt: row.issued_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function subscribeToUserCertificates(
  userId: string,
  callback: (certificates: Certificate[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from(certificatesTable)
      .select("*")
      .eq("user_id", userId);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback((data ?? []).map(rowToCertificate));
  };

  void load();

  const channel = supabase
    .channel(`certificates:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: certificatesTable,
        filter: `user_id=eq.${userId}`,
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

// issueSkillsetCertificate callable → issue_skillset_certificate RPC
// (SECURITY DEFINER): validates completion, snapshots the teacher identity, and
// writes the locked credential atomically. Returns the certificate id.
export async function issueSkillsetCertificate(
  enrollmentId: string,
  fullName: string,
) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("issue_skillset_certificate", {
    p_enrollment_id: enrollmentId,
    p_full_name: fullName,
  });

  if (error) {
    throw error;
  }

  return data as string;
}

/**
 * One-shot read of a single certificate by id (the id equals the enrollmentId).
 * RLS only returns it to the owning learner or an admin, so the printable
 * certificate page can trust the result.
 */
export async function getCertificate(
  certificateId: string,
): Promise<Certificate | null> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from(certificatesTable)
    .select("*")
    .eq("id", certificateId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? rowToCertificate(data) : null;
}

export type CertificateVerificationResult =
  | {
      valid: false;
    }
  | {
      valid: true;
      certificate: {
        courseTitle: string;
        courseCategory: string;
        authorityLabel: string;
        verificationCode: string;
        issuedAt: string | null;
      };
    };

// In-app verification path (authenticated or anon session). Public embedders
// use verifySkillsetCertificatePublic (Route Handler with CORS) instead.
export async function verifySkillsetCertificate(
  verificationCode: string,
): Promise<CertificateVerificationResult> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("verify_skillset_certificate", {
    p_code: verificationCode,
  });

  if (error) {
    throw error;
  }

  return data as unknown as CertificateVerificationResult;
}

export async function verifySkillsetCertificatePublic(
  verificationCode: string,
): Promise<CertificateVerificationResult> {
  const code = verificationCode.trim().toUpperCase();
  const response = await fetch(
    `/api/certificates/verify?code=${encodeURIComponent(code)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error("Certificate verification request failed.");
  }

  return (await response.json()) as CertificateVerificationResult;
}
