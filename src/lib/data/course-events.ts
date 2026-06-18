"use client";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";

import type { SkillsetUser } from "@/domain/auth";
import type {
  CourseEvent,
  CourseEventRsvp,
  CourseEventRsvpStatus,
  CourseEventType,
  CreateCourseEventInput,
} from "@/domain/course-event";
import { getFirestoreDb } from "@/lib/firebase/client";

const courseEventsCollection = "courseEvents";

export async function createCourseEvent(input: CreateCourseEventInput) {
  const eventRef = await addDoc(collection(getFirestoreDb(), courseEventsCollection), {
    courseId: input.courseId,
    courseSlug: input.courseSlug,
    courseTitle: input.courseTitle.trim(),
    ownerId: input.ownerId,
    title: input.title.trim(),
    description: input.description.trim(),
    type: input.type,
    status: "scheduled",
    startsAt: input.startsAt,
    externalUrl: input.externalUrl.trim(),
    recordingAssetId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return eventRef.id;
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
 * learner's agenda. Owner only (firestore.rules teacherCanUpdateOwnedCourseEvent
 * restricts the diff to these fields and keeps courseId/slug/title pinned).
 */
export async function updateCourseEvent(
  eventId: string,
  input: UpdateCourseEventInput,
) {
  await updateDoc(doc(getFirestoreDb(), courseEventsCollection, eventId), {
    title: input.title.trim(),
    description: input.description.trim(),
    type: input.type,
    startsAt: input.startsAt,
    externalUrl: input.externalUrl.trim(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Cancel an event without deleting it, so learners who already RSVP'd see the
 * cancelled state. subscribeToCourseEvents filters to scheduled, so cancelled
 * events drop off the learner agenda automatically.
 */
export async function cancelCourseEvent(eventId: string) {
  await updateDoc(doc(getFirestoreDb(), courseEventsCollection, eventId), {
    status: "cancelled",
    updatedAt: serverTimestamp(),
  });
}

/** Permanently remove an event (use for mistakes with no RSVPs). Owner only. */
export async function deleteCourseEvent(eventId: string) {
  await deleteDoc(doc(getFirestoreDb(), courseEventsCollection, eventId));
}

export function subscribeToTeacherCourseEvents(
  ownerId: string,
  callback: (events: CourseEvent[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const eventsQuery = query(
    collection(getFirestoreDb(), courseEventsCollection),
    where("ownerId", "==", ownerId),
  );

  return onSnapshot(
    eventsQuery,
    (snapshot) => {
      callback(
        snapshot.docs
          .map((document) => ({
            id: document.id,
            ...(document.data() as Omit<CourseEvent, "id">),
          }))
          .sort((left, right) => left.startsAt.localeCompare(right.startsAt)),
      );
    },
    onError,
  );
}

export async function saveCourseEventRsvp(input: {
  eventId: string;
  courseSlug: string;
  status: CourseEventRsvpStatus;
  user: SkillsetUser;
}) {
  const rsvpRef = doc(
    getFirestoreDb(),
    courseEventsCollection,
    input.eventId,
    "rsvps",
    input.user.uid,
  );
  const existingRsvp = await getDoc(rsvpRef);

  await setDoc(
    rsvpRef,
    {
      eventId: input.eventId,
      courseSlug: input.courseSlug,
      userId: input.user.uid,
      // No email fallback for the display label — the real address is kept in
      // the dedicated attendeeEmail field (read by the event owner). Using it
      // as the name leaked the attendee's email into a rendered label.
      attendeeName: input.user.displayName?.trim() || "Skillset learner",
      attendeeEmail: input.user.email,
      status: input.status,
      updatedAt: serverTimestamp(),
      ...(existingRsvp.exists() ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true },
  );
}

export function subscribeToCourseEventRsvp(
  eventId: string,
  userId: string,
  callback: (rsvp: CourseEventRsvp | null) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(getFirestoreDb(), courseEventsCollection, eventId, "rsvps", userId),
    (snapshot) => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }

      callback({
        id: snapshot.id,
        ...(snapshot.data() as Omit<CourseEventRsvp, "id">),
      });
    },
    onError,
  );
}

export function subscribeToCourseEventRsvps(
  eventId: string,
  callback: (rsvps: CourseEventRsvp[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(getFirestoreDb(), courseEventsCollection, eventId, "rsvps"),
    (snapshot) => {
      callback(
        snapshot.docs
          .map((document) => ({
            id: document.id,
            ...(document.data() as Omit<CourseEventRsvp, "id">),
          }))
          .sort((left, right) => left.attendeeName.localeCompare(right.attendeeName)),
      );
    },
    onError,
  );
}

export function subscribeToCourseEvents(
  courseSlug: string,
  callback: (events: CourseEvent[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const eventsQuery = query(
    collection(getFirestoreDb(), courseEventsCollection),
    where("courseSlug", "==", courseSlug),
  );

  return onSnapshot(
    eventsQuery,
    (snapshot) => {
      callback(
        snapshot.docs
          .map((document) => ({
            id: document.id,
            ...(document.data() as Omit<CourseEvent, "id">),
          }))
          .filter((event) => event.status === "scheduled")
          .sort((left, right) => left.startsAt.localeCompare(right.startsAt)),
      );
    },
    onError,
  );
}
