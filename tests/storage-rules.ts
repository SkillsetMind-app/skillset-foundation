import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import type firebase from "firebase/compat/app";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  it,
} from "vitest";

let testEnv: RulesTestEnvironment;

const projectId = "demo-skillset-rules-test";
const bucketUrl = `gs://${projectId}.appspot.com`;
const courseId = "course-paid";
const teacherId = "teacher-1";
const enrolledStudentId = "student-1";
const otherStudentId = "student-2";
const assetPath = `courses/${courseId}/assets/${teacherId}/asset-1/lesson.mp4`;
const draftCourseId = "course-draft";
const coverPath = `courses/${draftCourseId}/assets/${teacherId}/cover-1/cover.png`;

const verifiedAuth = {
  email: "learner@example.com",
  email_verified: true,
};

const draftCourseSeed = {
  ownerId: teacherId,
  title: "Draft Course",
  summary: "A draft course being built in the studio.",
  category: "Design",
  status: "draft",
  modules: [],
  lessonCount: 0,
  priceAmountMinor: 0,
  currency: "USD",
  platformFeeBps: 800,
  dripStrategy: "instant",
  dripIntervalDays: 1,
  freePreviewLessonId: null,
  coverImageUrl: null,
  reviewNote: null,
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
};

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(resolve("firestore.rules"), "utf8"),
    },
    storage: {
      rules: readFileSync(resolve("storage.rules"), "utf8"),
    },
  });
}, 30000);

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
  await seedCourseAccessData();
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe("Storage course asset rules", () => {
  it("allows a course owner to upload protected lesson video assets", async () => {
    const storage = testEnv.authenticatedContext(teacherId, verifiedAuth).storage(bucketUrl);

    await assertSucceeds(uploadVideoAsset(storage.ref(assetPath)));
  });

  it("blocks a non-owner teacher from uploading into another teacher course", async () => {
    await seedUser("teacher-2", ["student", "teacher"]);
    const storage = testEnv.authenticatedContext("teacher-2", verifiedAuth).storage(bucketUrl);

    await assertFails(uploadVideoAsset(storage.ref(assetPath)));
  });

  it("allows a course owner to upload an image/png cover to a draft course", async () => {
    const storage = testEnv.authenticatedContext(teacherId, verifiedAuth).storage(bucketUrl);

    await assertSucceeds(uploadImageAsset(storage.ref(coverPath)));
  });

  it("blocks cover uploads once the course is locked in review", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `courses/${draftCourseId}`), {
        ...draftCourseSeed,
        status: "in_review",
      });
    });
    const storage = testEnv.authenticatedContext(teacherId, verifiedAuth).storage(bucketUrl);

    await assertFails(uploadImageAsset(storage.ref(coverPath)));
  });

  it("blocks SVG uploads for protected course assets", async () => {
    const storage = testEnv.authenticatedContext(teacherId, verifiedAuth).storage(bucketUrl);

    await assertFails(uploadSvgAsset(storage.ref(
      `courses/${courseId}/assets/${teacherId}/asset-svg/payload.svg`,
    )));
  });

  it("blocks SVG uploads for profile avatars", async () => {
    const storage = testEnv.authenticatedContext(teacherId, verifiedAuth).storage(bucketUrl);

    await assertFails(uploadSvgAsset(storage.ref(
      `users/${teacherId}/avatar/payload.svg`,
    )));
  });

  it("blocks text/html uploads for protected course assets", async () => {
    const storage = testEnv.authenticatedContext(teacherId, verifiedAuth).storage(bucketUrl);

    await assertFails(uploadHtmlAsset(storage.ref(
      `courses/${courseId}/assets/${teacherId}/asset-html/payload.html`,
    )));
  });

  it("still allows plain-text lesson materials (html block is not over-broad)", async () => {
    const storage = testEnv.authenticatedContext(teacherId, verifiedAuth).storage(bucketUrl);

    await assertSucceeds(uploadTextAsset(storage.ref(
      `courses/${courseId}/assets/${teacherId}/asset-notes/notes.txt`,
    )));
  });

  it("allows an enrolled learner to read protected lesson video assets", async () => {
    await seedProtectedAsset();
    const storage = testEnv
      .authenticatedContext(enrolledStudentId, verifiedAuth)
      .storage(bucketUrl);

    await assertSucceeds(storage.ref(assetPath).getMetadata());
  });

  it("blocks a non-enrolled learner from reading protected lesson video assets", async () => {
    await seedProtectedAsset();
    const storage = testEnv
      .authenticatedContext(otherStudentId, verifiedAuth)
      .storage(bucketUrl);

    await assertFails(storage.ref(assetPath).getMetadata());
  });
});

async function seedProtectedAsset() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await uploadVideoAsset(context.storage(bucketUrl).ref(assetPath));
  });
}

function uploadVideoAsset(reference: firebase.storage.Reference): Promise<unknown> {
  return new Promise((resolve, reject) => {
    reference.put(new Uint8Array([1, 2, 3]), {
      contentType: "video/mp4",
    }).then(resolve, reject);
  });
}

function uploadSvgAsset(reference: firebase.storage.Reference): Promise<unknown> {
  return new Promise((resolve, reject) => {
    reference.put(new Uint8Array([60, 115, 118, 103, 62]), {
      contentType: "image/svg+xml",
    }).then(resolve, reject);
  });
}

function uploadHtmlAsset(reference: firebase.storage.Reference): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // "<h1>" bytes; the rule must reject purely on the text/html contentType,
    // regardless of payload.
    reference.put(new Uint8Array([60, 104, 49, 62]), {
      contentType: "text/html",
    }).then(resolve, reject);
  });
}

function uploadTextAsset(reference: firebase.storage.Reference): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // "hi" bytes as a plain-text lesson note.
    reference.put(new Uint8Array([104, 105]), {
      contentType: "text/plain",
    }).then(resolve, reject);
  });
}

function uploadImageAsset(reference: firebase.storage.Reference): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // PNG magic bytes (\x89PNG) so the payload is a non-empty, valid image.
    reference.put(new Uint8Array([137, 80, 78, 71]), {
      contentType: "image/png",
    }).then(resolve, reject);
  });
}

async function seedCourseAccessData() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();

    await setDoc(doc(adminDb, `users/${teacherId}`), createUser(teacherId, [
      "student",
      "teacher",
    ]));
    await setDoc(doc(adminDb, `users/${enrolledStudentId}`), createUser(enrolledStudentId, [
      "student",
    ]));
    await setDoc(doc(adminDb, `users/${otherStudentId}`), createUser(otherStudentId, [
      "student",
    ]));
    await setDoc(doc(adminDb, `courses/${courseId}`), {
      ownerId: teacherId,
      title: "Protected Course",
      summary: "A paid course with protected lesson assets.",
      category: "Leadership",
      status: "published",
      modules: [],
      lessonCount: 1,
      priceAmountMinor: 19900,
      currency: "USD",
      platformFeeBps: 800,
      dripStrategy: "instant",
      dripIntervalDays: 1,
      freePreviewLessonId: null,
      coverImageUrl: null,
      reviewNote: null,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await setDoc(doc(adminDb, `courses/${draftCourseId}`), draftCourseSeed);
    await setDoc(doc(adminDb, `enrollments/${enrolledStudentId}__${courseId}`), {
      id: `${enrolledStudentId}__${courseId}`,
      userId: enrolledStudentId,
      courseId,
      courseSlug: courseId,
      courseTitle: "Protected Course",
      courseCategory: "Leadership",
      courseImage: "/brand/logo-mark.png",
      status: "active",
      source: "payment",
      progressPercent: 0,
      lastLessonId: null,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  });
}

async function seedUser(uid: string, roles: string[]) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `users/${uid}`), createUser(uid, roles));
  });
}

function createUser(uid: string, roles: string[]) {
  return {
    uid,
    email: `${uid}@example.com`,
    displayName: "Seed User",
    roles,
    onboardingCompleted: true,
    termsAcceptedAt: Timestamp.now(),
    termsVersion: "2026-05-10",
    privacyAcceptedAt: Timestamp.now(),
    privacyVersion: "2026-05-10",
    marketingConsent: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    lastLoginAt: Timestamp.now(),
  };
}
