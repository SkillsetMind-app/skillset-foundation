"use client";

import type {
  CreatorVerificationCase,
  SubmitCreatorVerificationInput,
} from "@/domain/creator-verification";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

const casesTable = "creator_verification_cases";

type CaseRow = Database["public"]["Tables"]["creator_verification_cases"]["Row"];

function rowToCase(row: CaseRow): CreatorVerificationCase {
  return {
    id: row.id,
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

// submitCreatorVerification → submit_creator_verification RPC (SECURITY
// DEFINER): validates field lengths and https-only evidence links server-side,
// reuses an open needs_changes case when one exists, and mirrors the pending
// status onto users.creator_verification_status through the trusted-write flag.
export async function submitCreatorVerification(
  input: SubmitCreatorVerificationInput,
) {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc("submit_creator_verification", {
    p_profession: input.profession.trim(),
    p_registration_type: input.registrationType.trim(),
    p_registration_id: input.registrationId.trim(),
    p_registration_region: input.registrationRegion.trim(),
    p_evidence_links: input.evidenceLinks,
    p_note: input.note?.trim() || undefined,
  });

  if (error) {
    throw error;
  }
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

  return data?.value === true;
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

  const load = async () => {
    const { data, error } = await supabase
      .from(casesTable)
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true });

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

  // A review UPDATE moves the row out of the pending filter, so the change
  // event may not fire for this channel — the queue UI also removes reviewed
  // rows locally after a successful decision.
  const channel = supabase
    .channel("creator_verification:pending")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: casesTable,
        filter: "status=eq.pending",
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
