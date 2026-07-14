"use client";

import type { SkillsetUser } from "@/domain/auth";
import type {
  CourseEvent,
  CourseEventRsvp,
  CourseEventRsvpStatus,
  CourseEventType,
  CreateCourseEventInput,
} from "@/domain/course-event";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type CourseEventRow = Database["public"]["Tables"]["course_events"]["Row"];
type CourseEventRsvpRow = Database["public"]["Tables"]["course_event_rsvps"]["Row"];

function nowIso(): string {
  return new Date().toISOString();
}

function rowToCourseEvent(row: CourseEventRow): CourseEvent {
  return {
    id: row.id,
    courseId: row.course_id,
    courseSlug: row.course_slug,
    courseTitle: row.course_title,
    ownerId: row.owner_id,
    title: row.title,
    description: row.description,
    type: row.type as CourseEventType,
    status: row.status as CourseEvent["status"],
    startsAt: row.starts_at,
    externalUrl: row.external_url,
    recordingAssetId: row.recording_asset_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCourseEventRsvp(row: CourseEventRsvpRow): CourseEventRsvp {
  return {
    // Firestore used the userId as the document ID; in Postgres the composite
    // PK is (event_id, uid) with no standalone id column — use uid as the id.
    id: row.uid,
    eventId: row.event_id,
    courseSlug: row.course_slug,
    userId: row.user_id,
    attendeeName: row.attendee_name,
    attendeeEmail: row.attendee_email,
    status: row.status as CourseEventRsvpStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createCourseEvent(input: CreateCourseEventInput) {
  const supabase = getSupabaseBrowserClient();
  const timestamp = nowIso();

  const { data, error } = await supabase
    .from("course_events")
    .insert({
      course_id: input.courseId,
      course_slug: input.courseSlug,
      course_title: input.courseTitle.trim(),
      owner_id: input.ownerId,
      title: input.title.trim(),
      description: input.description.trim(),
      type: input.type,
      status: "scheduled",
      starts_at: input.startsAt,
      external_url: input.externalUrl.trim(),
      recording_asset_id: null,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .select("id")
    .single();

  if (error) throw error;

  return data.id;
}

export type UpdateCourseEventInput = {
  title: string;
  description: string;
  type: CourseEventType;
  startsAt: string;
  externalUrl: string;
};

/**
 * Edit a scheduled event so a wrong date/link/topic is never stuck on a
 * learner's agenda. Owner only (Postgres RLS teacherCanUpdateOwnedCourseEvent
 * restricts the diff to these fields and keeps courseId/slug/title pinned).
 */
export async function updateCourseEvent(
  eventId: string,
  input: UpdateCourseEventInput,
) {
  const supabase = getSupabaseBrowserClient();

  const { error } = await supabase
    .from("course_events")
    .update({
      title: input.title.trim(),
      description: input.description.trim(),
      type: input.type,
      starts_at: input.startsAt,
      external_url: input.externalUrl.trim(),
      updated_at: nowIso(),
    })
    .eq("id", eventId);

  if (error) throw error;
}

/**
 * Cancel an event without deleting it, so learners who already RSVP'd see the
 * cancelled state. subscribeToCourseEvents filters to scheduled, so cancelled
 * events drop off the learner agenda automatically.
 */
export async function cancelCourseEvent(eventId: string) {
  const supabase = getSupabaseBrowserClient();

  const { error } = await supabase
    .from("course_events")
    .update({ status: "cancelled", updated_at: nowIso() })
    .eq("id", eventId);

  if (error) throw error;
}

/** Permanently remove an event (use for mistakes with no RSVPs). Owner only. */
export async function deleteCourseEvent(eventId: string) {
  const supabase = getSupabaseBrowserClient();

  const { error } = await supabase
    .from("course_events")
    .delete()
    .eq("id", eventId);

  if (error) throw error;
}

export function subscribeToTeacherCourseEvents(
  ownerId: string,
  callback: (events: CourseEvent[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from("course_events")
      .select("*")
      .eq("owner_id", ownerId);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback(
      (data ?? [])
        .map(rowToCourseEvent)
        .sort((left, right) => left.startsAt.localeCompare(right.startsAt)),
    );
  };

  void load();

  const channel = supabase
    .channel(`course_events:owner:${ownerId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "course_events",
        filter: `owner_id=eq.${ownerId}`,
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

export async function saveCourseEventRsvp(input: {
  eventId: string;
  courseSlug: string;
  status: CourseEventRsvpStatus;
  user: SkillsetUser;
}) {
  const supabase = getSupabaseBrowserClient();
  const timestamp = nowIso();

  const { data: existing, error: readError } = await supabase
    .from("course_event_rsvps")
    .select("created_at")
    .eq("event_id", input.eventId)
    .eq("uid", input.user.uid)
    .maybeSingle();

  if (readError) throw readError;

  const { error } = await supabase.from("course_event_rsvps").upsert(
    {
      event_id: input.eventId,
      uid: input.user.uid,
      course_slug: input.courseSlug,
      user_id: input.user.uid,
      // No email fallback for the display label — the real address is kept in
      // the dedicated attendee_email field (read by the event owner). Using it
      // as the name leaked the attendee's email into a rendered label.
      attendee_name: input.user.displayName?.trim() || "SkillsetMind learner",
      attendee_email: input.user.email,
      status: input.status,
      updated_at: timestamp,
      ...(existing ? {} : { created_at: timestamp }),
    },
    { onConflict: "event_id,uid" },
  );

  if (error) throw error;
}

export function subscribeToCourseEventRsvp(
  eventId: string,
  userId: string,
  callback: (rsvp: CourseEventRsvp | null) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from("course_event_rsvps")
      .select("*")
      .eq("event_id", eventId)
      .eq("uid", userId)
      .maybeSingle();

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback(data ? rowToCourseEventRsvp(data) : null);
  };

  void load();

  // Realtime server filters only support a single-column eq; filter on event_id
  // and re-run the full (event_id + uid) query on any change to that event's RSVPs.
  // The event-scoped filter also fires for OTHER users' RSVPs on this event, so we
  // must re-query (not trust payload.new, which is whichever row changed) to keep
  // this watch pinned to (event_id + uid).
  // ponytail: event-scoped fan-in; fine for single-event RSVP watch.
  const channel = supabase
    .channel(`course_event_rsvps:one:${eventId}:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "course_event_rsvps",
        filter: `event_id=eq.${eventId}`,
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

export function subscribeToCourseEventRsvps(
  eventId: string,
  callback: (rsvps: CourseEventRsvp[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from("course_event_rsvps")
      .select("*")
      .eq("event_id", eventId);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback(
      (data ?? [])
        .map(rowToCourseEventRsvp)
        .sort((left, right) => left.attendeeName.localeCompare(right.attendeeName)),
    );
  };

  void load();

  const channel = supabase
    .channel(`course_event_rsvps:event:${eventId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "course_event_rsvps",
        filter: `event_id=eq.${eventId}`,
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

export function subscribeToCourseEvents(
  courseSlug: string,
  callback: (events: CourseEvent[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from("course_events")
      .select("*")
      .eq("course_slug", courseSlug);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback(
      (data ?? [])
        .map(rowToCourseEvent)
        .filter((event) => event.status === "scheduled")
        .sort((left, right) => left.startsAt.localeCompare(right.startsAt)),
    );
  };

  void load();

  const channel = supabase
    .channel(`course_events:slug:${courseSlug}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "course_events",
        filter: `course_slug=eq.${courseSlug}`,
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
