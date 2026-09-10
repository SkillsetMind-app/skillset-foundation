"use client";

import type {
  CreatorVerificationCase,
  SubmitCreatorVerificationInput,
} from "@/domain/creator-verification";
import { isPlatformFlagOn } from "@/domain/platform-settings";
import { validateProfessionalEvidence } from "@/domain/creator-verification";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

const casesTable = "creator_verification_cases";

type CaseRow = Database["public"]["Tables"]["creator_verification_cases"]["Row"];

function rowToCase(row: CaseRow): CreatorVerificationCase {
  return {
    id: row.id,
    verificationKind: row.verification_kind as CreatorVerificationCase["verificationKind"],
    documentPath: row.document_path ?? undefined,
    creatorId: row.creator_id,
    status: row.status as CreatorVerificationCase["status"],
    profession: row.profession,
    registrationType: row.registration_type,
    registrationId: row.registration_id,
    registrationRegion: row.registration_region,
    evidenceLinks: Array.isArray(row.evidence_links)
      ? row.evidence_links.filter(
          (link): link is string => typeof link === "string",
        )
      : [],
    note: row.note ?? undefined,
    reviewNote: row.review_note ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// The RPC validates role, proof ownership and profession-specific requirements;
// submission only requests review, never grants a verified badge.
export async function submitCreatorVerification(
  input: SubmitCreatorVerificationInput,
) {
  validateProfessionalEvidence(input);
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc("submit_professional_badge", {
    p_kind: input.verificationKind,
    p_profession: input.profession.trim(),
    p_registration_id: input.registrationId?.trim() || undefined,
    p_registration_region: input.registrationRegion?.trim() || undefined,
    p_document_path: input.documentPath,
    p_evidence_links: input.evidenceLinks,
    p_note: input.note?.trim() || undefined,
  });

  if (error) {
    throw new Error("Could not submit your badge request. Check your evidence and try again.");
  }
}

const verificationBucket = "verification-evidence";
const evidenceExtensions: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf",
};

export async function uploadVerificationEvidence(file: File): Promise<string> {
  const extension = evidenceExtensions[file.type];
  if (!extension || file.size === 0 || file.size > 10 * 1024 * 1024) {
    throw new Error("Choose a JPG, PNG, WebP or PDF file up to 10 MB.");
  }
  const supabase = getSupabaseBrowserClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) throw new Error("Sign in again before uploading evidence.");
  const path = `${data.user.id}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(verificationBucket).upload(path, file, {
    contentType: file.type, upsert: false,
  });
  if (error) throw new Error("Could not upload the document. Try again.");
  return path;
}

export async function getVerificationEvidenceDownload(path: string): Promise<string> {
  // Storage RLS checks the caller; never generate a public URL for documents.
  const { data, error } = await getSupabaseBrowserClient().storage
    .from(verificationBucket).createSignedUrl(path, 60, { download: true });
  if (error || !data?.signedUrl) throw new Error("Could not open the document. Try again.");
  return data.signedUrl;
}

export async function removeVerificationEvidence(path: string): Promise<void> {
  const { data, error } = await getSupabaseBrowserClient().storage.from(verificationBucket).remove([path]);
  if (error || data?.length !== 1) throw new Error("Could not remove the uploaded document. Try again.");
}

/**
 * Ops/admin review decision → review_creator_verification RPC. The RPC
 * enforces the ops/admin check, requires a note (≥12 chars) for non-approve
 * decisions, and syncs users.creator_verification_status.
 */
export async function reviewCreatorVerification(
  caseId: string,
  status: Extract<
    CreatorVerificationCase["status"],
    "approved" | "needs_changes" | "rejected"
  >,
  reviewNote: string | null = null,
) {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc("review_creator_verification", {
    p_case_id: caseId,
    p_status: status,
    p_review_note: reviewNote?.trim() || undefined,
  });

  if (error) {
    throw error;
  }
}

/** Reads the admission flag; false means the gate is dormant (default). */
export async function fetchRequireCreatorVerification(): Promise<boolean> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "require_creator_verification")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return isPlatformFlagOn(data?.value);
}

/**
 * Answers "is THIS signed-in creator blocked by the activation fee right now?"
 *
 * Calls the same SECURITY DEFINER predicate the courses trigger and
 * assertCreatorActivated() use, instead of reading require_activation_fee and
 * pairing it with a profile field in the component. The flag alone is not the
 * answer: the predicate also folds in the admin exemption and the paid check.
 * Reading the raw flag here would paywall an admin the server lets straight
 * through — UI saying "pay" while the API says "you're fine".
 */
export async function fetchCreatorActivationBlocked(): Promise<boolean> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("creator_activation_blocked");

  if (error) {
    throw error;
  }

  // creator_activation_blocked returns a plain boolean, not a flag row: reading
  // data?.value here yields undefined and silently unblocks every creator.
  if (typeof data !== "boolean") throw new Error("Activation status unavailable.");
  return data;
}

export function subscribeToMyVerificationCase(
  creatorId: string,
  callback: (verificationCase: CreatorVerificationCase | null) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from(casesTable)
      .select("*")
      .eq("creator_id", creatorId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback(data ? rowToCase(data) : null);
  };

  void load();

  const channel = supabase
    .channel(`creator_verification:${creatorId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: casesTable,
        filter: `creator_id=eq.${creatorId}`,
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

export function subscribeToVerificationQueue(
  callback: (cases: CreatorVerificationCase[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();
  let active = true;
  let generation = 0;

  const load = async () => {
    if (!active) return;
    const currentGeneration = ++generation;
    const { data, error } = await supabase
      .from(casesTable)
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (!active || currentGeneration !== generation) return;
    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    const rows = data ?? [];
    const creatorIds = [...new Set(rows.map((row) => row.creator_id))];
    let applicants: Record<string, { name?: string; email?: string }> = {};
    if (creatorIds.length > 0) {
      const { data: users, error: usersError } = await supabase
        .from("users")
        .select("uid, display_name, email")
        .in("uid", creatorIds);

      // An approval refresh may finish while this older lookup is pending.
      if (!active || currentGeneration !== generation) return;
      if (usersError) {
        onError(
          usersError instanceof Error
            ? usersError
            : new Error(String(usersError)),
        );
        return;
      }

      applicants = Object.fromEntries(
        (users ?? []).map((user) => [
          user.uid,
          {
            name: user.display_name ?? undefined,
            email: user.email ?? undefined,
          },
        ]),
      );
    }

    callback(
      rows.map((row) => ({
        ...rowToCase(row),
        applicantName: applicants[row.creator_id]?.name,
        applicantEmail: applicants[row.creator_id]?.email,
      })),
    );
  };

  void load();

  // Listen beyond pending rows: a review must refresh every subscriber when
  // the new status leaves the queue. The read above still selects only pending.
  const channel = supabase
    .channel("creator_verification:pending")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: casesTable,
      },
      () => {
        void load();
      },
    )
    .subscribe();

  return () => {
    active = false;
    void supabase.removeChannel(channel);
  };
}
