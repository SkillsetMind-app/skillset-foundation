import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  it,
} from "vitest";

let testEnv: RulesTestEnvironment;

// The admin handle from context.firestore() is the compat Firestore the
// rules-unit-testing SDK returns; type helper params against it (not the modular
// `Firestore`) so seed helpers accept exactly what context.firestore() yields.
type AdminFirestore = ReturnType<RulesTestContext["firestore"]>;

const verifiedAuth = {
  email: "learner@example.com",
  email_verified: true,
};

const unverifiedAuth = {
  email: "learner@example.com",
  email_verified: false,
};

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-skillset-rules-test",
    firestore: {
      rules: readFileSync(resolve("firestore.rules"), "utf8"),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe("Firestore user role rules", () => {
  it("allows a verified user to create a student profile only", async () => {
    const db = testEnv.authenticatedContext("student-1", verifiedAuth).firestore();
    const profileRef = doc(db, "users/student-1");

    await assertSucceeds(
      setDoc(profileRef, {
        uid: "student-1",
        email: "learner@example.com",
        displayName: "Learner One",
        roles: ["student"],
        onboardingCompleted: false,
        termsAcceptedAt: Timestamp.now(),
        termsVersion: "2026-05-10",
        privacyAcceptedAt: Timestamp.now(),
        privacyVersion: "2026-05-10",
        marketingConsent: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        lastLoginAt: Timestamp.now(),
      }),
    );
  });

  it("blocks client self-assignment of protected platform roles", async () => {
    const db = testEnv.authenticatedContext("bad-actor", verifiedAuth).firestore();

    await assertFails(
      setDoc(doc(db, "users/bad-actor"), {
        uid: "bad-actor",
        email: "bad@example.com",
        displayName: "Bad Actor",
        roles: ["student", "admin"],
        onboardingCompleted: true,
        termsAcceptedAt: Timestamp.now(),
        termsVersion: "2026-05-10",
        privacyAcceptedAt: Timestamp.now(),
        privacyVersion: "2026-05-10",
        marketingConsent: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        lastLoginAt: Timestamp.now(),
      }),
    );
  });

  it("allows an admin to update their own profile without changing roles", async () => {
    await seedUser("admin-1", ["admin"]);

    const db = testEnv.authenticatedContext("admin-1", verifiedAuth).firestore();

    await assertSucceeds(
      updateDoc(doc(db, "users/admin-1"), {
        displayName: "Updated Admin",
        updatedAt: Timestamp.now(),
        lastLoginAt: Timestamp.now(),
      }),
    );
  });

  it("requires verified email and Teacher Terms before self-service teacher role", async () => {
    const unverifiedDb = testEnv
      .authenticatedContext("teacher-unverified", unverifiedAuth)
      .firestore();
    const verifiedDb = testEnv
      .authenticatedContext("teacher-verified", verifiedAuth)
      .firestore();

    await assertFails(
      setDoc(doc(unverifiedDb, "users/teacher-unverified"), {
        uid: "teacher-unverified",
        email: "teacher@example.com",
        displayName: "Teacher Unverified",
        roles: ["student", "teacher"],
        onboardingCompleted: true,
        teacherTermsAcceptedAt: Timestamp.now(),
        teacherTermsVersion: "2026-05-10",
        termsAcceptedAt: Timestamp.now(),
        termsVersion: "2026-05-10",
        privacyAcceptedAt: Timestamp.now(),
        privacyVersion: "2026-05-10",
        marketingConsent: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        lastLoginAt: Timestamp.now(),
      }),
    );

    await assertFails(
      setDoc(doc(verifiedDb, "users/teacher-verified"), {
        uid: "teacher-verified",
        email: "teacher@example.com",
        displayName: "Teacher Verified",
        roles: ["student", "teacher"],
        onboardingCompleted: true,
        termsAcceptedAt: Timestamp.now(),
        termsVersion: "2026-05-10",
        privacyAcceptedAt: Timestamp.now(),
        privacyVersion: "2026-05-10",
        marketingConsent: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        lastLoginAt: Timestamp.now(),
      }),
    );

    await assertSucceeds(
      setDoc(doc(verifiedDb, "users/teacher-verified"), {
        uid: "teacher-verified",
        email: "teacher@example.com",
        displayName: "Teacher Verified",
        roles: ["student", "teacher"],
        onboardingCompleted: true,
        teacherTermsAcceptedAt: Timestamp.now(),
        teacherTermsVersion: "2026-05-10",
        termsAcceptedAt: Timestamp.now(),
        termsVersion: "2026-05-10",
        privacyAcceptedAt: Timestamp.now(),
        privacyVersion: "2026-05-10",
        marketingConsent: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        lastLoginAt: Timestamp.now(),
      }),
    );
  });
});

describe("Firestore storefront write rules", () => {
  const validStorefront = {
    branding: {
      accentColor: "#183a5e",
      logoUrl: "https://cdn.example.com/logo.png",
      heroImageUrl: "https://cdn.example.com/hero.jpg",
      themePreset: "warm",
    },
    showcase: {
      tagline: "Sales coaching that compounds.",
      orderedCourseIds: ["course-a", "course-b"],
      featuredCourseId: "course-a",
    },
  };

  it("allows an owner to save a valid storefront", async () => {
    await seedUser("teacher-store", ["student", "teacher"]);
    const db = testEnv
      .authenticatedContext("teacher-store", verifiedAuth)
      .firestore();

    await assertSucceeds(
      updateDoc(doc(db, "users/teacher-store"), {
        storefront: validStorefront,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("rejects a non-https logo URL projected to the public profile", async () => {
    await seedUser("teacher-badlogo", ["student", "teacher"]);
    const db = testEnv
      .authenticatedContext("teacher-badlogo", verifiedAuth)
      .firestore();

    await assertFails(
      updateDoc(doc(db, "users/teacher-badlogo"), {
        storefront: { branding: { logoUrl: "http://cdn.example.com/logo.png" } },
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("rejects a non-hex accent color (CSS injection guard)", async () => {
    await seedUser("teacher-badhex", ["student", "teacher"]);
    const db = testEnv
      .authenticatedContext("teacher-badhex", verifiedAuth)
      .firestore();

    await assertFails(
      updateDoc(doc(db, "users/teacher-badhex"), {
        storefront: {
          branding: { accentColor: "red;background:url(javascript:alert(1))" },
        },
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("rejects an unknown theme preset", async () => {
    await seedUser("teacher-badpreset", ["student", "teacher"]);
    const db = testEnv
      .authenticatedContext("teacher-badpreset", verifiedAuth)
      .firestore();

    await assertFails(
      updateDoc(doc(db, "users/teacher-badpreset"), {
        storefront: { branding: { themePreset: "neon" } },
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("rejects an unknown storefront key", async () => {
    await seedUser("teacher-badkey", ["student", "teacher"]);
    const db = testEnv
      .authenticatedContext("teacher-badkey", verifiedAuth)
      .firestore();

    await assertFails(
      updateDoc(doc(db, "users/teacher-badkey"), {
        storefront: {
          branding: { logoUrl: "https://cdn.example.com/logo.png" },
          sidebar: true,
        },
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("forbids writing another user's storefront", async () => {
    await seedUser("teacher-victim", ["student", "teacher"]);
    const db = testEnv
      .authenticatedContext("teacher-attacker", verifiedAuth)
      .firestore();

    await assertFails(
      updateDoc(doc(db, "users/teacher-victim"), {
        storefront: validStorefront,
        updatedAt: Timestamp.now(),
      }),
    );
  });
});

describe("Firestore course publishing rules", () => {
  it("allows teacher draft creation but blocks direct publication", async () => {
    await seedTeacher("teacher-1");

    const db = testEnv.authenticatedContext("teacher-1", verifiedAuth).firestore();

    await assertSucceeds(
      setDoc(doc(db, "courses/course-draft"), createCourse("teacher-1", "draft")),
    );

    await assertFails(
      setDoc(
        doc(db, "courses/course-published"),
        createCourse("teacher-1", "published"),
      ),
    );
  });

  it("allows teacher submit-for-review but blocks teacher self-publish", async () => {
    await seedTeacher("teacher-1");

    const db = testEnv.authenticatedContext("teacher-1", verifiedAuth).firestore();
    const courseRef = doc(db, "courses/course-review");

    await assertSucceeds(setDoc(courseRef, createCourse("teacher-1", "draft")));
    await assertSucceeds(updateDoc(courseRef, {
      status: "in_review",
      reviewNote: null,
      updatedAt: Timestamp.now(),
    }));
    await assertFails(updateDoc(courseRef, {
      status: "published",
      updatedAt: Timestamp.now(),
    }));
  });

  it("allows owner to set the cover image on a Cloud Functions-created draft", async () => {
    // Regression: the Cloud Functions write `learningOutcomes`, which was missing
    // from the course-key allowlist in firestore.rules. That drift made the
    // client-side cover-image updateDoc fail with permission-denied, blocking
    // teachers from uploading a course cover (the launch blocker). Seed the
    // course the way the Cloud Function does (admin context, with
    // learningOutcomes) and assert the owner can update only the cover fields.
    await seedTeacher("teacher-1");

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "courses/course-cover"),
        createCourse("teacher-1", "draft"),
      );
    });

    const db = testEnv.authenticatedContext("teacher-1", verifiedAuth).firestore();
    const courseRef = doc(db, "courses/course-cover");

    await assertSucceeds(
      updateDoc(courseRef, {
        coverImageUrl:
          "https://firebasestorage.googleapis.com/v0/b/skillsetusaofficial.firebasestorage.app/o/cover.png",
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("allows owner to create the course_cover asset doc (first half of cover upload)", async () => {
    // The cover upload writes the asset doc BEFORE the course cover update.
    // Both must pass; cover this first write too so the end-to-end flow is green.
    await seedTeacher("teacher-1");

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "courses/course-asset"),
        createCourse("teacher-1", "draft"),
      );
    });

    const db = testEnv.authenticatedContext("teacher-1", verifiedAuth).firestore();

    await assertSucceeds(
      setDoc(doc(db, "courses/course-asset/assets/asset-1"), {
        id: "asset-1",
        courseId: "course-asset",
        ownerId: "teacher-1",
        kind: "course_cover",
        fileName: "cover.png",
        contentType: "image/png",
        size: 204800,
        storagePath: "courses/course-asset/assets/teacher-1/asset-1/cover.png",
        downloadUrl:
          "https://firebasestorage.googleapis.com/v0/b/skillsetusaofficial.firebasestorage.app/o/cover.png",
        isPreview: false,
        lessonId: null,
        moduleId: null,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("allows owner to create the lesson_video asset doc (lesson video upload)", async () => {
    // Lesson videos write only the asset doc — no course update and no public
    // download URL (downloadUrl stays null). Prove the owner can create it so
    // the end-to-end video upload path is provably green.
    await seedTeacher("teacher-1");

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "courses/course-asset-vid"),
        createCourse("teacher-1", "draft"),
      );
    });

    const db = testEnv.authenticatedContext("teacher-1", verifiedAuth).firestore();

    await assertSucceeds(
      setDoc(doc(db, "courses/course-asset-vid/assets/asset-vid-1"), {
        id: "asset-vid-1",
        courseId: "course-asset-vid",
        ownerId: "teacher-1",
        kind: "lesson_video",
        fileName: "lesson.mp4",
        contentType: "video/mp4",
        size: 52_428_800,
        storagePath:
          "courses/course-asset-vid/assets/teacher-1/asset-vid-1/lesson.mp4",
        downloadUrl: null,
        isPreview: false,
        lessonId: "lesson-1",
        moduleId: "module-1",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
    );
  });
});

describe("Firestore gated lessonContent rules (B1)", () => {
  // courses/{id}/lessonContent/{lessonId} carries the paid lesson body + link
  // OUT of the world-readable course doc. Read gate == /assets (admin, owner,
  // enrolled) PLUS one public branch: the single free-preview lesson on a
  // published/in_review course. Write gate == owner/admin, shape-locked to
  // exactly {contentText, externalUrl} with the same size caps as inline.
  const courseId = "course-b1";
  const ownerUid = "teacher-b1";
  const previewLessonId = "lesson-preview";
  const gatedLessonId = "lesson-gated";

  async function seedB1(
    status: "published" | "draft" = "published",
    extra: (adminDb: AdminFirestore) => Promise<void> = async () => undefined,
  ) {
    await seedTeacher(ownerUid);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, `courses/${courseId}`), {
        ownerId: ownerUid,
        title: "B1 Course",
        summary: "A structured professional course with a clear learning outcome.",
        category: "Leadership",
        learningOutcomes: [],
        status,
        modules: [
          {
            id: "module-1",
            title: "Module 1",
            summary: null,
            coverAssetId: null,
            lessons: [
              { id: previewLessonId, title: "Preview", type: "text" },
              { id: gatedLessonId, title: "Gated", type: "text" },
            ],
          },
        ],
        lessonCount: 2,
        priceAmountMinor: 19900,
        currency: "USD",
        platformFeeBps: 1500,
        dripStrategy: "instant",
        dripIntervalDays: 1,
        freePreviewLessonId: previewLessonId,
        coverImageUrl: null,
        reviewNote: null,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      // The two gated content docs (admin seed bypasses rules — same shape as
      // the backfill writes).
      await setDoc(doc(adminDb, `courses/${courseId}/lessonContent/${previewLessonId}`), {
        contentText: "Preview body that marketing shows publicly.",
        externalUrl: null,
      });
      await setDoc(doc(adminDb, `courses/${courseId}/lessonContent/${gatedLessonId}`), {
        contentText: "Paid lesson body — must require enrollment.",
        externalUrl: "https://videos.example.com/gated.mp4",
      });
      await extra(adminDb);
    });
  }

  async function enroll(
    adminDb: AdminFirestore,
    uid: string,
    status: "active" | "completed",
  ) {
    await setDoc(doc(adminDb, `enrollments/${uid}__${courseId}`), {
      id: `${uid}__${courseId}`,
      userId: uid,
      courseId,
      courseSlug: courseId,
      courseTitle: "B1 Course",
      courseCategory: "Leadership",
      courseImage: "/brand/logo-mark.png",
      status,
      source: "admin",
      progressPercent: status === "completed" ? 100 : 0,
      lastLessonId: null,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }

  it("lets an enrolled (active) learner read gated lesson content", async () => {
    await seedUser("student-active", ["student"]);
    await seedB1("published", (adminDb) => enroll(adminDb, "student-active", "active"));

    const db = testEnv.authenticatedContext("student-active", verifiedAuth).firestore();
    await assertSucceeds(
      getDoc(doc(db, `courses/${courseId}/lessonContent/${gatedLessonId}`)),
    );
  });

  it("lets an enrolled (completed) learner read gated lesson content", async () => {
    await seedUser("student-done", ["student"]);
    await seedB1("published", (adminDb) => enroll(adminDb, "student-done", "completed"));

    const db = testEnv.authenticatedContext("student-done", verifiedAuth).firestore();
    await assertSucceeds(
      getDoc(doc(db, `courses/${courseId}/lessonContent/${gatedLessonId}`)),
    );
  });

  it("denies a signed-in but non-enrolled user from reading gated content", async () => {
    await seedUser("student-outsider", ["student"]);
    await seedB1("published");

    const db = testEnv.authenticatedContext("student-outsider", verifiedAuth).firestore();
    await assertFails(
      getDoc(doc(db, `courses/${courseId}/lessonContent/${gatedLessonId}`)),
    );
  });

  it("denies an anonymous visitor from reading a NON-preview gated lesson", async () => {
    await seedB1("published");

    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      getDoc(doc(anonDb, `courses/${courseId}/lessonContent/${gatedLessonId}`)),
    );
  });

  it("lets an anonymous visitor read the free-preview lesson on a published course", async () => {
    await seedB1("published");

    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(
      getDoc(doc(anonDb, `courses/${courseId}/lessonContent/${previewLessonId}`)),
    );
  });

  it("denies anonymous read of the free-preview lesson on a NON-published (draft) course", async () => {
    await seedB1("draft");

    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      getDoc(doc(anonDb, `courses/${courseId}/lessonContent/${previewLessonId}`)),
    );
  });

  it("lets the course owner read AND write gated lesson content (shape-locked)", async () => {
    await seedB1("published");

    const db = testEnv.authenticatedContext(ownerUid, verifiedAuth).firestore();
    await assertSucceeds(
      getDoc(doc(db, `courses/${courseId}/lessonContent/${gatedLessonId}`)),
    );
    await assertSucceeds(
      setDoc(doc(db, `courses/${courseId}/lessonContent/${gatedLessonId}`), {
        contentText: "Owner-edited body.",
        externalUrl: "https://videos.example.com/owner.mp4",
      }),
    );
  });

  it("lets an admin read gated lesson content", async () => {
    await seedUser("admin-b1", ["admin"]);
    await seedB1("published");

    const db = testEnv.authenticatedContext("admin-b1", verifiedAuth).firestore();
    await assertSucceeds(
      getDoc(doc(db, `courses/${courseId}/lessonContent/${gatedLessonId}`)),
    );
  });

  it("denies an owner write that exceeds the 20k contentText cap", async () => {
    await seedB1("published");

    const db = testEnv.authenticatedContext(ownerUid, verifiedAuth).firestore();
    await assertFails(
      setDoc(doc(db, `courses/${courseId}/lessonContent/${gatedLessonId}`), {
        contentText: "x".repeat(20001),
        externalUrl: null,
      }),
    );
  });

  it("denies an owner write carrying an unexpected key (shape lock)", async () => {
    await seedB1("published");

    const db = testEnv.authenticatedContext(ownerUid, verifiedAuth).firestore();
    await assertFails(
      setDoc(doc(db, `courses/${courseId}/lessonContent/${gatedLessonId}`), {
        contentText: "Body.",
        externalUrl: null,
        smuggled: "not allowed",
      }),
    );
  });

  it("denies a stranger from writing another owner's gated lesson content", async () => {
    await seedUser("stranger-b1", ["student", "teacher"], {
      teacherTermsAcceptedAt: Timestamp.now(),
      teacherTermsVersion: "2026-05-10",
    });
    await seedB1("published");

    const db = testEnv.authenticatedContext("stranger-b1", verifiedAuth).firestore();
    await assertFails(
      setDoc(doc(db, `courses/${courseId}/lessonContent/${gatedLessonId}`), {
        contentText: "Hijacked body.",
        externalUrl: null,
      }),
    );
  });
});

describe("Firestore course featured curation rules (C5)", () => {
  async function seedPublishedCourse(courseId: string, ownerId: string) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), `courses/${courseId}`),
        createCourse(ownerId, "published"),
      );
    });
  }

  it("lets ops feature and unfeature a published course", async () => {
    await seedTeacher("teacher-1");
    await seedUser("ops-1", ["student", "ops"]);
    await seedPublishedCourse("course-feat", "teacher-1");

    const opsDb = testEnv.authenticatedContext("ops-1", verifiedAuth).firestore();
    const courseRef = doc(opsDb, "courses/course-feat");

    await assertSucceeds(
      updateDoc(courseRef, {
        featured: true,
        featuredRank: 1,
        updatedAt: Timestamp.now(),
      }),
    );
    await assertSucceeds(
      updateDoc(courseRef, {
        featured: false,
        featuredRank: null,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("lets an admin feature a course", async () => {
    await seedTeacher("teacher-1");
    await seedUser("admin-1", ["student", "admin"]);
    await seedPublishedCourse("course-feat-admin", "teacher-1");

    const adminDb = testEnv.authenticatedContext("admin-1", verifiedAuth).firestore();

    await assertSucceeds(
      updateDoc(doc(adminDb, "courses/course-feat-admin"), {
        featured: true,
        featuredRank: 0,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("blocks a teacher from featuring their OWN course (self-promotion guard)", async () => {
    await seedTeacher("teacher-1");
    await seedPublishedCourse("course-feat-self", "teacher-1");

    const teacherDb = testEnv
      .authenticatedContext("teacher-1", verifiedAuth)
      .firestore();

    // `featured` is absent from teacherCanSaveOwnedCourse's courseChangedOnly
    // allowlist, so a teacher write that touches it fails the hasOnly() check.
    await assertFails(
      updateDoc(doc(teacherDb, "courses/course-feat-self"), {
        featured: true,
        featuredRank: 0,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("blocks a plain student from featuring any course", async () => {
    await seedTeacher("teacher-1");
    await seedUser("student-1", ["student"]);
    await seedPublishedCourse("course-feat-student", "teacher-1");

    const studentDb = testEnv
      .authenticatedContext("student-1", verifiedAuth)
      .firestore();

    await assertFails(
      updateDoc(doc(studentDb, "courses/course-feat-student"), {
        featured: true,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("blocks ops from smuggling other fields through the featured path", async () => {
    await seedTeacher("teacher-1");
    await seedUser("ops-1", ["student", "ops"]);
    await seedPublishedCourse("course-feat-smuggle", "teacher-1");

    const opsDb = testEnv.authenticatedContext("ops-1", verifiedAuth).firestore();

    // priceAmountMinor is outside courseChangedOnly(['featured','featuredRank',
    // 'updatedAt']); the scoped predicate must reject the whole write.
    await assertFails(
      updateDoc(doc(opsDb, "courses/course-feat-smuggle"), {
        featured: true,
        priceAmountMinor: 1,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("rejects a malformed featuredRank (wrong type / out of range)", async () => {
    await seedTeacher("teacher-1");
    await seedUser("ops-1", ["student", "ops"]);
    await seedPublishedCourse("course-feat-bad", "teacher-1");

    const opsDb = testEnv.authenticatedContext("ops-1", verifiedAuth).firestore();
    const courseRef = doc(opsDb, "courses/course-feat-bad");

    await assertFails(
      updateDoc(courseRef, {
        featured: true,
        featuredRank: "1",
        updatedAt: Timestamp.now(),
      }),
    );
    await assertFails(
      updateDoc(courseRef, {
        featured: true,
        featuredRank: -5,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("keeps trendingScore/enrollmentCount server-only (no teacher OR ops write)", async () => {
    await seedTeacher("teacher-1");
    await seedUser("ops-1", ["student", "ops"]);
    await seedPublishedCourse("course-trend", "teacher-1");

    const teacherDb = testEnv
      .authenticatedContext("teacher-1", verifiedAuth)
      .firestore();
    const opsDb = testEnv.authenticatedContext("ops-1", verifiedAuth).firestore();

    // Neither field is in any teacher courseChangedOnly list, nor in the
    // ops featured/status scoped lists -> only the Admin SDK (trigger + cron,
    // rules-bypass) can write them. A direct client write must fail.
    await assertFails(
      updateDoc(doc(teacherDb, "courses/course-trend"), {
        trendingScore: 999,
        updatedAt: Timestamp.now(),
      }),
    );
    await assertFails(
      updateDoc(doc(opsDb, "courses/course-trend"), {
        enrollmentCount: 999,
        updatedAt: Timestamp.now(),
      }),
    );
  });
});

describe("Firestore course review rules", () => {
  it("allows public reads for published course reviews but blocks client writes", async () => {
    await seedTeacher("teacher-1");
    await seedUser("student-1", ["student"]);

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();

      await setDoc(
        doc(adminDb, "courses/course-published"),
        createCourse("teacher-1", "published"),
      );
      await setDoc(doc(adminDb, "enrollments/student-1__course-published"), {
        id: "student-1__course-published",
        userId: "student-1",
        courseId: "course-published",
        courseSlug: "course-published",
        courseTitle: "Professional Course",
        courseCategory: "Leadership",
        courseImage: "/brand/logo-mark.png",
        status: "completed",
        source: "admin",
        progressPercent: 100,
        lastLessonId: "lesson-1",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      // NEW shape: the review doc carries NO `userId` field. The reviewer's
      // Auth UID was removed because this doc is world-readable for published
      // courses and the UID let an attacker harvest paying-customer ids.
      await setDoc(doc(adminDb, "courseReviews/course-published__student-1"), {
        id: "course-published__student-1",
        courseId: "course-published",
        authorName: "Seed User",
        rating: 5,
        body: "Clear and useful.",
        status: "published",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    });

    const publicDb = testEnv.unauthenticatedContext().firestore();
    const studentDb = testEnv
      .authenticatedContext("student-1", verifiedAuth)
      .firestore();

    const publicSnap = await assertSucceeds(
      getDoc(doc(publicDb, "courseReviews/course-published__student-1")),
    );
    // Regression guard: the world-readable review doc must never expose the
    // reviewer's Auth UID.
    expect((publicSnap.data() ?? {}).userId).toBeUndefined();
    await assertFails(
      setDoc(doc(studentDb, "courseReviews/course-published__student-1"), {
        id: "course-published__student-1",
        courseId: "course-published",
        userId: "student-1",
        authorName: "Seed User",
        rating: 1,
        body: "Client write should fail.",
        status: "published",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("identifies the review author by doc-id (no stored userId) and blocks non-authors on a non-published course", async () => {
    await seedTeacher("teacher-2");
    await seedUser("author-2", ["student"]);
    await seedUser("stranger-2", ["student"]);

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      // 'draft' => the world-readable published/in_review branch does NOT
      // apply, so reads fall through to the signed-in author/owner/enrolled
      // branch — exercising the doc-id reconstruction that replaced the
      // removed `userId` field.
      await setDoc(
        doc(adminDb, "courses/course-draft-2"),
        createCourse("teacher-2", "draft"),
      );
      // Review doc in the NEW shape: no `userId` field at all.
      await setDoc(doc(adminDb, "courseReviews/course-draft-2__author-2"), {
        id: "course-draft-2__author-2",
        courseId: "course-draft-2",
        authorName: "Author Two",
        rating: 4,
        body: "Solid material.",
        status: "published",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    });

    const authorDb = testEnv
      .authenticatedContext("author-2", verifiedAuth)
      .firestore();
    const strangerDb = testEnv
      .authenticatedContext("stranger-2", verifiedAuth)
      .firestore();
    const anonDb = testEnv.unauthenticatedContext().firestore();

    // Author is identified purely by reconstructing the doc id
    // (`${courseId}__${uid}`) — no stored userId needed.
    await assertSucceeds(
      getDoc(doc(authorDb, "courseReviews/course-draft-2__author-2")),
    );
    // A different signed-in user (not author, not owner, not enrolled) is
    // denied — the removed userId field cannot be impersonated.
    await assertFails(
      getDoc(doc(strangerDb, "courseReviews/course-draft-2__author-2")),
    );
    // Anonymous visitors cannot read reviews of a non-published course.
    await assertFails(
      getDoc(doc(anonDb, "courseReviews/course-draft-2__author-2")),
    );
  });
});

describe("Firestore /users/{uid} privilege-escalation guards (C1/C2)", () => {
  it("C1: blocks a user from self-setting currentPlanId on their own doc", async () => {
    await seedUser("attacker-c1", ["student"]);
    const db = testEnv.authenticatedContext("attacker-c1", verifiedAuth).firestore();

    // Attempt to zero the platform fee by self-promoting to "plus" plan.
    // Backend (Stripe webhook) is the ONLY trusted writer of currentPlanId.
    await assertFails(
      updateDoc(doc(db, "users/attacker-c1"), {
        currentPlanId: "plus",
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("C1 (variant): blocks self-setting planTier / planUpdatedAt", async () => {
    await seedUser("attacker-c1b", ["student"]);
    const db = testEnv.authenticatedContext("attacker-c1b", verifiedAuth).firestore();

    await assertFails(
      updateDoc(doc(db, "users/attacker-c1b"), {
        planTier: "plus",
        planUpdatedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("C2: blocks a user from self-setting stripeCustomerId on their own doc", async () => {
    await seedUser("attacker-c2", ["student"]);
    const db = testEnv.authenticatedContext("attacker-c2", verifiedAuth).firestore();

    // Attempt to hijack a victim's Stripe Billing Portal session.
    await assertFails(
      updateDoc(doc(db, "users/attacker-c2"), {
        stripeCustomerId: "cus_VICTIM_ACCOUNT_ID",
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("C2 (variant): blocks self-setting stripeSubscriptionId", async () => {
    await seedUser("attacker-c2b", ["student"]);
    const db = testEnv.authenticatedContext("attacker-c2b", verifiedAuth).firestore();

    await assertFails(
      updateDoc(doc(db, "users/attacker-c2b"), {
        stripeSubscriptionId: "sub_VICTIM",
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("blocks self-setting Stripe Connect status flags (charges/payouts enabled)", async () => {
    await seedUser("teacher-fakekyc", ["student", "teacher"], {
      teacherTermsAcceptedAt: Timestamp.now(),
      teacherTermsVersion: "2026-05-10",
    });
    const db = testEnv.authenticatedContext("teacher-fakekyc", verifiedAuth).firestore();

    await assertFails(
      updateDoc(doc(db, "users/teacher-fakekyc"), {
        stripeConnectedAccountId: "acct_FAKE",
        stripeConnectStatus: "active",
        stripeConnectChargesEnabled: true,
        stripeConnectPayoutsEnabled: true,
        stripeConnectUpdatedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("blocks self-setting platformFeeBps on user doc (defense-in-depth)", async () => {
    await seedUser("attacker-fee", ["student"]);
    const db = testEnv.authenticatedContext("attacker-fee", verifiedAuth).firestore();

    await assertFails(
      updateDoc(doc(db, "users/attacker-fee"), {
        platformFeeBps: 0,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("blocks self-setting privileged metadata (kycStatus, adminClaims, balance)", async () => {
    await seedUser("attacker-meta", ["student"]);
    const db = testEnv.authenticatedContext("attacker-meta", verifiedAuth).firestore();

    await assertFails(
      updateDoc(doc(db, "users/attacker-meta"), {
        kycStatus: "approved",
        updatedAt: Timestamp.now(),
      }),
    );
    await assertFails(
      updateDoc(doc(db, "users/attacker-meta"), {
        adminClaims: true,
        updatedAt: Timestamp.now(),
      }),
    );
    await assertFails(
      updateDoc(doc(db, "users/attacker-meta"), {
        balanceMinor: 9999999,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("still allows benign identity field updates (displayName, lastLoginAt)", async () => {
    await seedUser("benign-user", ["student"]);
    const db = testEnv.authenticatedContext("benign-user", verifiedAuth).firestore();

    await assertSucceeds(
      updateDoc(doc(db, "users/benign-user"), {
        displayName: "New Display Name",
        updatedAt: Timestamp.now(),
        lastLoginAt: Timestamp.now(),
      }),
    );
  });
});

describe("Firestore /users/{uid} profile-media field validation (photoURL / teacherSignatureUrl)", () => {
  // photoURL is mirrored into the world-readable publicProfiles doc, so the rule
  // bounds its type + length (the https scheme is enforced server-side in
  // projectPublicTeacherProfile). teacherSignatureUrl is self-owned only.
  it("allows a well-formed photoURL within the length cap", async () => {
    await seedUser("photo-ok", ["student"]);
    const db = testEnv.authenticatedContext("photo-ok", verifiedAuth).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "users/photo-ok"), {
        photoURL:
          "https://firebasestorage.googleapis.com/v0/b/x/o/users%2Fphoto-ok%2Favatar.png?alt=media",
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("allows clearing photoURL to null", async () => {
    await seedUser("photo-null", ["student"]);
    const db = testEnv.authenticatedContext("photo-null", verifiedAuth).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "users/photo-null"), {
        photoURL: null,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("blocks an oversized photoURL (> 1200 chars => document bloat)", async () => {
    await seedUser("photo-big", ["student"]);
    const db = testEnv.authenticatedContext("photo-big", verifiedAuth).firestore();
    await assertFails(
      updateDoc(doc(db, "users/photo-big"), {
        photoURL: "https://x/" + "a".repeat(1300),
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("blocks a non-string photoURL (type confusion)", async () => {
    await seedUser("photo-type", ["student"]);
    const db = testEnv.authenticatedContext("photo-type", verifiedAuth).firestore();
    await assertFails(
      updateDoc(doc(db, "users/photo-type"), {
        photoURL: { nested: "not-a-string" },
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("blocks an oversized teacherSignatureUrl (> 1200 chars)", async () => {
    await seedTeacher("sig-big");
    const db = testEnv.authenticatedContext("sig-big", verifiedAuth).firestore();
    await assertFails(
      updateDoc(doc(db, "users/sig-big"), {
        teacherSignatureUrl: "https://x/" + "a".repeat(1300),
        updatedAt: Timestamp.now(),
      }),
    );
  });
});

describe("Firestore teacher terms acceptance guard (C3)", () => {
  it("C3: blocks backdated teacherTermsAcceptedAt on create (timestamp from 1970)", async () => {
    const db = testEnv
      .authenticatedContext("teacher-backdate-create", verifiedAuth)
      .firestore();

    await assertFails(
      setDoc(doc(db, "users/teacher-backdate-create"), {
        uid: "teacher-backdate-create",
        email: "teacher@example.com",
        displayName: "Backdate Teacher",
        roles: ["student", "teacher"],
        onboardingCompleted: true,
        teacherTermsAcceptedAt: Timestamp.fromMillis(0), // 1970 — way outside the 10min window
        teacherTermsVersion: "2026-05-10",
        termsAcceptedAt: Timestamp.now(),
        termsVersion: "2026-05-10",
        privacyAcceptedAt: Timestamp.now(),
        privacyVersion: "2026-05-10",
        marketingConsent: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        lastLoginAt: Timestamp.now(),
      }),
    );
  });

  it("C3: blocks future teacherTermsAcceptedAt (e.g. year 3000)", async () => {
    const db = testEnv
      .authenticatedContext("teacher-future", verifiedAuth)
      .firestore();

    // Year 3000 in ms — way past request.time
    const farFuture = Timestamp.fromMillis(32503680000000);

    await assertFails(
      setDoc(doc(db, "users/teacher-future"), {
        uid: "teacher-future",
        email: "teacher@example.com",
        displayName: "Future Teacher",
        roles: ["student", "teacher"],
        onboardingCompleted: true,
        teacherTermsAcceptedAt: farFuture,
        teacherTermsVersion: "2026-05-10",
        termsAcceptedAt: Timestamp.now(),
        termsVersion: "2026-05-10",
        privacyAcceptedAt: Timestamp.now(),
        privacyVersion: "2026-05-10",
        marketingConsent: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        lastLoginAt: Timestamp.now(),
      }),
    );
  });

  it("C3: blocks rewriting teacherTermsAcceptedAt once it is set (write-once)", async () => {
    // Seed already-accepted teacher with a fixed timestamp ~5 min ago
    const acceptedAt = Timestamp.fromMillis(Date.now() - 5 * 60 * 1000);
    await seedUser("teacher-rewrite", ["student", "teacher"], {
      teacherTermsAcceptedAt: acceptedAt,
      teacherTermsVersion: "2026-05-10",
    });

    const db = testEnv
      .authenticatedContext("teacher-rewrite", verifiedAuth)
      .firestore();

    // Cannot overwrite to "now" — value must remain immutable
    await assertFails(
      updateDoc(doc(db, "users/teacher-rewrite"), {
        teacherTermsAcceptedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("C3: allows a first-time recent teacherTermsAcceptedAt (inside 10min window)", async () => {
    await seedUser("teacher-firsttime", ["student"]); // not yet teacher

    const db = testEnv
      .authenticatedContext("teacher-firsttime", verifiedAuth)
      .firestore();

    // Upgrade to teacher role with fresh terms acceptance
    await assertSucceeds(
      updateDoc(doc(db, "users/teacher-firsttime"), {
        roles: ["student", "teacher"],
        teacherTermsAcceptedAt: Timestamp.now(),
        teacherTermsVersion: "2026-05-10",
        updatedAt: Timestamp.now(),
      }),
    );
  });
});

async function seedTeacher(uid: string) {
  await seedUser(uid, ["student", "teacher"], {
    teacherTermsAcceptedAt: Timestamp.now(),
    teacherTermsVersion: "2026-05-10",
  });
}

async function seedUser(
  uid: string,
  roles: string[],
  extra: Record<string, unknown> = {},
) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `users/${uid}`), {
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
      ...extra,
    });
  });
}

function createCourse(ownerId: string, status: "draft" | "published" | "in_review") {
  return {
    ownerId,
    title: "Professional Course",
    summary: "A structured professional course with a clear learning outcome.",
    category: "Leadership",
    learningOutcomes: [],
    status,
    modules: [],
    lessonCount: 0,
    priceAmountMinor: 19900,
    currency: "USD",
    platformFeeBps: 1500,
    dripStrategy: "instant",
    dripIntervalDays: 1,
    freePreviewLessonId: null,
    coverImageUrl: null,
    reviewNote: null,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
}

describe("Firestore courseSubscriptions rules", () => {
  const subscriptionId = "sub_test_course";

  async function seedCourseSubscription(ownerUid: string) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `courseSubscriptions/${subscriptionId}`), {
        id: subscriptionId,
        userId: ownerUid,
        courseId: "course-1",
        teacherId: "teacher-1",
        stripeSubscriptionId: subscriptionId,
        stripeCustomerId: "cus_test",
        status: "active",
        interval: "month",
        currentPeriodEnd: new Date().toISOString(),
        cancelAtPeriodEnd: false,
        pastDue: false,
        latestInvoiceId: "in_test",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    });
  }

  it("lets the buyer read their own course subscription", async () => {
    await seedCourseSubscription("student-1");
    const db = testEnv.authenticatedContext("student-1", verifiedAuth).firestore();

    await assertSucceeds(getDoc(doc(db, `courseSubscriptions/${subscriptionId}`)));
  });

  it("blocks a different user from reading someone else's subscription", async () => {
    await seedCourseSubscription("student-1");
    const db = testEnv.authenticatedContext("student-2", verifiedAuth).firestore();

    await assertFails(getDoc(doc(db, `courseSubscriptions/${subscriptionId}`)));
  });

  it("blocks all client writes (Admin SDK / webhook only)", async () => {
    await seedCourseSubscription("student-1");
    const db = testEnv.authenticatedContext("student-1", verifiedAuth).firestore();

    // Even the owner cannot mutate their subscription from the client — cancel
    // flows go through the cancelCourseSubscription callable.
    await assertFails(
      updateDoc(doc(db, `courseSubscriptions/${subscriptionId}`), {
        cancelAtPeriodEnd: true,
      }),
    );
  });
});

describe("Firestore community gamification rules (C1)", () => {
  const courseSlug = "course-gamified";
  const postId = "post-1";

  async function seedPostAndEnrollments() {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      // Author and liker are both enrolled in the course.
      for (const uid of ["author-1", "liker-1"]) {
        await setDoc(doc(adminDb, `enrollments/${uid}__${courseSlug}`), {
          id: `${uid}__${courseSlug}`,
          userId: uid,
          courseId: courseSlug,
          courseSlug,
          courseTitle: "Gamified Course",
          courseCategory: "Leadership",
          courseImage: "/brand/logo-mark.png",
          status: "active",
          source: "admin",
          progressPercent: 0,
          lastLessonId: null,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
      }
      await setDoc(doc(adminDb, `communityPosts/${postId}`), {
        courseSlug,
        authorId: "author-1",
        authorName: "Author One",
        authorRole: "student",
        category: "discussion",
        body: "A thoughtful post that may earn likes.",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    });
  }

  const likeDoc = (likerId: string) => ({
    likerId,
    postId,
    createdAt: Timestamp.now(),
  });

  it("lets an enrolled member like a post (own like id) and unlike it", async () => {
    await seedPostAndEnrollments();
    const db = testEnv.authenticatedContext("liker-1", verifiedAuth).firestore();

    await assertSucceeds(
      setDoc(
        doc(db, `communityPosts/${postId}/likes/liker-1`),
        likeDoc("liker-1"),
      ),
    );
  });

  it("blocks liking on behalf of another user (like id != uid)", async () => {
    await seedPostAndEnrollments();
    const db = testEnv.authenticatedContext("liker-1", verifiedAuth).firestore();

    // Doc id is someone else's uid → cannot inflate another member's likes.
    await assertFails(
      setDoc(
        doc(db, `communityPosts/${postId}/likes/author-1`),
        likeDoc("author-1"),
      ),
    );
  });

  it("blocks a non-enrolled user from liking", async () => {
    await seedPostAndEnrollments();
    const db = testEnv.authenticatedContext("outsider-1", verifiedAuth).firestore();

    await assertFails(
      setDoc(
        doc(db, `communityPosts/${postId}/likes/outsider-1`),
        likeDoc("outsider-1"),
      ),
    );
  });

  it("blocks a like doc carrying an extra (score) field", async () => {
    await seedPostAndEnrollments();
    const db = testEnv.authenticatedContext("liker-1", verifiedAuth).firestore();

    await assertFails(
      setDoc(doc(db, `communityPosts/${postId}/likes/liker-1`), {
        ...likeDoc("liker-1"),
        points: 9999,
      }),
    );
  });

  it("blocks all client writes to memberStats (server-only)", async () => {
    await seedPostAndEnrollments();
    const db = testEnv.authenticatedContext("author-1", verifiedAuth).firestore();

    // Points/level are server-authoritative — a member cannot set their own.
    await assertFails(
      setDoc(doc(db, "memberStats/author-1"), {
        uid: "author-1",
        displayName: "Author One",
        points: 99999,
        level: 9,
        totalLikesReceived: 99999,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("lets a signed-in member read memberStats and leaderboards", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "memberStats/author-1"), {
        uid: "author-1",
        displayName: "Author One",
        points: 25,
        level: 3,
        totalLikesReceived: 25,
        updatedAt: Timestamp.now(),
      });
      await setDoc(doc(context.firestore(), "leaderboards/all-time"), {
        window: "all-time",
        entries: [],
        updatedAt: Timestamp.now(),
      });
    });
    const db = testEnv.authenticatedContext("liker-1", verifiedAuth).firestore();

    await assertSucceeds(getDoc(doc(db, "memberStats/author-1")));
    await assertSucceeds(getDoc(doc(db, "leaderboards/all-time")));
  });

  it("blocks reading the points ledger from a client", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "pointsEvents/evt-1"), {
        uid: "author-1",
        kind: "like_received",
        delta: 1,
        postId,
        likerId: "liker-1",
        createdAt: Timestamp.now(),
      });
    });
    const db = testEnv.authenticatedContext("author-1", verifiedAuth).firestore();

    await assertFails(getDoc(doc(db, "pointsEvents/evt-1")));
  });
});

describe("Firestore community pinned posts + nested replies rules (C8)", () => {
  const courseSlug = "course-c8";
  const postId = "post-c8";
  const teacherUid = "teacher-c8";

  async function seedC8() {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      // Course doc id === courseSlug; owned by the teacher.
      await setDoc(doc(adminDb, `courses/${courseSlug}`), {
        ownerId: teacherUid,
        title: "C8 Course",
        status: "published",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      // Author + a second learner are both enrolled. The teacher is NOT
      // enrolled — ownership alone must be enough to pin.
      for (const uid of ["author-c8", "member-c8"]) {
        await setDoc(doc(adminDb, `enrollments/${uid}__${courseSlug}`), {
          id: `${uid}__${courseSlug}`,
          userId: uid,
          courseId: courseSlug,
          courseSlug,
          courseTitle: "C8 Course",
          courseCategory: "Leadership",
          courseImage: "/brand/logo-mark.png",
          status: "active",
          source: "admin",
          progressPercent: 0,
          lastLessonId: null,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
      }
      await setDoc(doc(adminDb, `communityPosts/${postId}`), {
        courseSlug,
        authorId: "author-c8",
        authorName: "Author C8",
        authorRole: "student",
        category: "discussion",
        body: "A post that a teacher may decide to pin.",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    });
  }

  it("lets the course owner pin a post (pinned + updatedAt only)", async () => {
    await seedC8();
    const db = testEnv.authenticatedContext(teacherUid, verifiedAuth).firestore();
    await assertSucceeds(
      updateDoc(doc(db, `communityPosts/${postId}`), {
        pinned: true,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("blocks a non-owner enrolled member from pinning", async () => {
    await seedC8();
    const db = testEnv.authenticatedContext("member-c8", verifiedAuth).firestore();
    await assertFails(
      updateDoc(doc(db, `communityPosts/${postId}`), {
        pinned: true,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("blocks the author from self-pinning their own post", async () => {
    await seedC8();
    const db = testEnv.authenticatedContext("author-c8", verifiedAuth).firestore();
    await assertFails(
      updateDoc(doc(db, `communityPosts/${postId}`), {
        pinned: true,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("still lets the author edit their own post body (no pin change)", async () => {
    await seedC8();
    const db = testEnv.authenticatedContext("author-c8", verifiedAuth).firestore();
    await assertSucceeds(
      updateDoc(doc(db, `communityPosts/${postId}`), {
        body: "An edited body that is still long enough.",
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("blocks the author from re-stamping createdAt while editing (feed-order tamper)", async () => {
    await seedC8();
    const db = testEnv.authenticatedContext("author-c8", verifiedAuth).firestore();
    // An edit may touch body/updatedAt, but createdAt is frozen — rewriting it
    // would let an author reorder the feed or fake the post's age.
    await assertFails(
      updateDoc(doc(db, `communityPosts/${postId}`), {
        body: "An edited body that is still long enough.",
        createdAt: Timestamp.fromMillis(4102444800000),
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("blocks the owner from editing content while pinning (hasOnly clamp)", async () => {
    await seedC8();
    const db = testEnv.authenticatedContext(teacherUid, verifiedAuth).firestore();
    await assertFails(
      updateDoc(doc(db, `communityPosts/${postId}`), {
        pinned: true,
        body: "Owner sneaking a content edit while pinning.",
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("blocks creating a pre-pinned post", async () => {
    await seedC8();
    const db = testEnv.authenticatedContext("author-c8", verifiedAuth).firestore();
    await assertFails(
      setDoc(doc(db, "communityPosts/new-pinned-c8"), {
        courseSlug,
        authorId: "author-c8",
        authorName: "Author C8",
        authorRole: "student",
        category: "announcement",
        body: "Trying to create a post already pinned.",
        pinned: true,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
    );
  });

  const commentDoc = (authorUid: string, parentId: unknown) => ({
    postId,
    courseSlug,
    authorId: authorUid,
    authorName: "Commenter",
    authorRole: "student",
    body: "A reply that is long enough to pass.",
    parentId,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });

  it("lets an enrolled member post a top-level comment (parentId null)", async () => {
    await seedC8();
    const db = testEnv.authenticatedContext("member-c8", verifiedAuth).firestore();
    await assertSucceeds(
      setDoc(
        doc(db, `communityPosts/${postId}/comments/c-root`),
        commentDoc("member-c8", null),
      ),
    );
  });

  it("lets an enrolled member post a nested reply (parentId string)", async () => {
    await seedC8();
    const db = testEnv.authenticatedContext("member-c8", verifiedAuth).firestore();
    await assertSucceeds(
      setDoc(
        doc(db, `communityPosts/${postId}/comments/c-reply`),
        commentDoc("member-c8", "c-root"),
      ),
    );
  });

  it("blocks a comment whose parentId is the wrong type", async () => {
    await seedC8();
    const db = testEnv.authenticatedContext("member-c8", verifiedAuth).firestore();
    await assertFails(
      setDoc(
        doc(db, `communityPosts/${postId}/comments/c-bad`),
        commentDoc("member-c8", 123),
      ),
    );
  });
});

describe("Firestore lesson content (gated subcollection) rules", () => {
  // Pins B1: paid lesson bodies live in courses/{id}/lessonContent/{lessonId},
  // NOT inline in the public course doc, so the curriculum is not world-readable.
  // Read is gated to admin / owner / active|completed enrollee, with one public
  // branch for the course's single free-preview lesson. Writes are owner/admin
  // only, shape- and size-locked to contentText (<=20k) + externalUrl (<=2k).
  const courseId = "course-content";
  const teacherId = "teacher-content";

  async function seedLessonContent() {
    await seedTeacher(teacherId);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, `courses/${courseId}`), {
        ...createCourse(teacherId, "published"),
        freePreviewLessonId: "lesson-preview",
      });
      await setDoc(doc(adminDb, `courses/${courseId}/lessonContent/lesson-1`), {
        contentText: "Paid lesson body that must stay gated.",
        externalUrl: "https://videos.example.com/lesson-1",
      });
      await setDoc(
        doc(adminDb, `courses/${courseId}/lessonContent/lesson-preview`),
        {
          contentText: "Free preview body, public on purpose.",
          externalUrl: null,
        },
      );
    });
  }

  async function seedContentEnrollment(uid: string, status: string) {
    await seedUser(uid, ["student"]);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `enrollments/${uid}__${courseId}`), {
        id: `${uid}__${courseId}`,
        userId: uid,
        courseId,
        courseSlug: courseId,
        courseTitle: "Content Course",
        courseCategory: "Leadership",
        courseImage: "/brand/logo-mark.png",
        status,
        source: "payment",
        progressPercent: 0,
        lastLessonId: null,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    });
  }

  it("allows an active-status enrollee to read gated lesson content", async () => {
    await seedLessonContent();
    await seedContentEnrollment("student-active", "active");
    const db = testEnv
      .authenticatedContext("student-active", verifiedAuth)
      .firestore();
    await assertSucceeds(
      getDoc(doc(db, `courses/${courseId}/lessonContent/lesson-1`)),
    );
  });

  it("allows a completed-status enrollee to read gated lesson content", async () => {
    await seedLessonContent();
    await seedContentEnrollment("student-completed", "completed");
    const db = testEnv
      .authenticatedContext("student-completed", verifiedAuth)
      .firestore();
    await assertSucceeds(
      getDoc(doc(db, `courses/${courseId}/lessonContent/lesson-1`)),
    );
  });

  it("denies a refunded-status user from reading gated lesson content", async () => {
    await seedLessonContent();
    await seedContentEnrollment("student-refunded", "refunded");
    const db = testEnv
      .authenticatedContext("student-refunded", verifiedAuth)
      .firestore();
    await assertFails(
      getDoc(doc(db, `courses/${courseId}/lessonContent/lesson-1`)),
    );
  });

  it("denies a signed-in user with no enrollment from reading gated lesson content", async () => {
    await seedLessonContent();
    await seedUser("student-none", ["student"]);
    const db = testEnv
      .authenticatedContext("student-none", verifiedAuth)
      .firestore();
    await assertFails(
      getDoc(doc(db, `courses/${courseId}/lessonContent/lesson-1`)),
    );
  });

  it("denies an unauthenticated visitor from reading a non-preview lesson", async () => {
    await seedLessonContent();
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      getDoc(doc(db, `courses/${courseId}/lessonContent/lesson-1`)),
    );
  });

  it("allows anyone to read the free-preview lesson on a published course", async () => {
    await seedLessonContent();
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(
      getDoc(doc(db, `courses/${courseId}/lessonContent/lesson-preview`)),
    );
  });

  it("allows the course owner to read and write lesson content", async () => {
    await seedLessonContent();
    const db = testEnv
      .authenticatedContext(teacherId, verifiedAuth)
      .firestore();
    await assertSucceeds(
      getDoc(doc(db, `courses/${courseId}/lessonContent/lesson-1`)),
    );
    await assertSucceeds(
      setDoc(doc(db, `courses/${courseId}/lessonContent/lesson-2`), {
        contentText: "A new lesson body written by the owner.",
        externalUrl: null,
      }),
    );
  });

  it("denies the owner from writing an oversized contentText", async () => {
    await seedLessonContent();
    const db = testEnv
      .authenticatedContext(teacherId, verifiedAuth)
      .firestore();
    await assertFails(
      setDoc(doc(db, `courses/${courseId}/lessonContent/lesson-3`), {
        contentText: "x".repeat(20001),
        externalUrl: null,
      }),
    );
  });

  it("denies the owner from writing an unexpected field", async () => {
    await seedLessonContent();
    const db = testEnv
      .authenticatedContext(teacherId, verifiedAuth)
      .firestore();
    await assertFails(
      setDoc(doc(db, `courses/${courseId}/lessonContent/lesson-4`), {
        contentText: "Body",
        externalUrl: null,
        secret: "should not be allowed",
      }),
    );
  });

  it("denies a different teacher from writing another owner's lesson content", async () => {
    await seedLessonContent();
    await seedTeacher("teacher-stranger");
    const db = testEnv
      .authenticatedContext("teacher-stranger", verifiedAuth)
      .firestore();
    await assertFails(
      setDoc(doc(db, `courses/${courseId}/lessonContent/lesson-5`), {
        contentText: "Hijacked content body.",
        externalUrl: null,
      }),
    );
  });
});

describe("Firestore protected course content access (enrollment-status gate)", () => {
  // Pins the money-critical access gate: only an enrollment with status in
  // ['active','completed'] may read a course's protected assets / lesson
  // comments (firestore.rules:807-811, 1540-1567). Without these tests, a
  // future rules edit that drops hasEnrollmentForCourseSlug or admits
  // 'refunded'/'revoked' would let a refunded buyer keep accessing paid
  // content with zero test failures.
  const courseId = "course-protected";
  const teacherId = "teacher-protected";

  async function seedProtectedCourseContent() {
    await seedTeacher(teacherId);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(
        doc(adminDb, `courses/${courseId}`),
        createCourse(teacherId, "published"),
      );
      await setDoc(doc(adminDb, `courses/${courseId}/assets/asset-1`), {
        id: "asset-1",
        courseId,
        ownerId: teacherId,
        kind: "lesson_video",
        fileName: "lesson.mp4",
        contentType: "video/mp4",
        size: 52_428_800,
        storagePath: `courses/${courseId}/assets/${teacherId}/asset-1/lesson.mp4`,
        downloadUrl: null,
        isPreview: false,
        lessonId: "lesson-1",
        moduleId: "module-1",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      await setDoc(
        doc(adminDb, `courses/${courseId}/lessonComments/comment-1`),
        {
          courseId,
          lessonId: "lesson-1",
          authorId: teacherId,
          authorName: "Teacher",
          body: "Seeded lesson comment for read-gate tests.",
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      );
    });
  }

  async function seedEnrollment(uid: string, status: string) {
    await seedUser(uid, ["student"]);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), `enrollments/${uid}__${courseId}`),
        {
          id: `${uid}__${courseId}`,
          userId: uid,
          courseId,
          courseSlug: courseId,
          courseTitle: "Protected Course",
          courseCategory: "Leadership",
          courseImage: "/brand/logo-mark.png",
          status,
          source: "payment",
          progressPercent: 0,
          lastLessonId: null,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      );
    });
  }

  it("allows an active-status enrollee to read protected assets", async () => {
    await seedProtectedCourseContent();
    await seedEnrollment("student-active", "active");
    const db = testEnv
      .authenticatedContext("student-active", verifiedAuth)
      .firestore();
    await assertSucceeds(getDoc(doc(db, `courses/${courseId}/assets/asset-1`)));
  });

  it("allows a completed-status enrollee to read protected assets", async () => {
    await seedProtectedCourseContent();
    await seedEnrollment("student-completed", "completed");
    const db = testEnv
      .authenticatedContext("student-completed", verifiedAuth)
      .firestore();
    await assertSucceeds(getDoc(doc(db, `courses/${courseId}/assets/asset-1`)));
  });

  it("denies a refunded-status user from reading protected assets", async () => {
    await seedProtectedCourseContent();
    await seedEnrollment("student-refunded", "refunded");
    const db = testEnv
      .authenticatedContext("student-refunded", verifiedAuth)
      .firestore();
    await assertFails(getDoc(doc(db, `courses/${courseId}/assets/asset-1`)));
  });

  it("denies a revoked-status user from reading protected assets", async () => {
    await seedProtectedCourseContent();
    await seedEnrollment("student-revoked", "revoked");
    const db = testEnv
      .authenticatedContext("student-revoked", verifiedAuth)
      .firestore();
    await assertFails(getDoc(doc(db, `courses/${courseId}/assets/asset-1`)));
  });

  it("denies a user with no enrollment from reading protected assets", async () => {
    await seedProtectedCourseContent();
    await seedUser("student-none", ["student"]);
    const db = testEnv
      .authenticatedContext("student-none", verifiedAuth)
      .firestore();
    await assertFails(getDoc(doc(db, `courses/${courseId}/assets/asset-1`)));
  });

  it("denies a refunded-status user from reading lesson comments", async () => {
    await seedProtectedCourseContent();
    await seedEnrollment("student-refunded", "refunded");
    const db = testEnv
      .authenticatedContext("student-refunded", verifiedAuth)
      .firestore();
    await assertFails(
      getDoc(doc(db, `courses/${courseId}/lessonComments/comment-1`)),
    );
  });

  it("denies a user with no enrollment from reading lesson comments", async () => {
    await seedProtectedCourseContent();
    await seedUser("student-none", ["student"]);
    const db = testEnv
      .authenticatedContext("student-none", verifiedAuth)
      .firestore();
    await assertFails(
      getDoc(doc(db, `courses/${courseId}/lessonComments/comment-1`)),
    );
  });

  it("allows an active-status enrollee to create a lesson comment", async () => {
    await seedProtectedCourseContent();
    await seedEnrollment("student-active", "active");
    const db = testEnv
      .authenticatedContext("student-active", verifiedAuth)
      .firestore();
    await assertSucceeds(
      setDoc(doc(db, `courses/${courseId}/lessonComments/comment-active`), {
        courseId,
        lessonId: "lesson-1",
        authorId: "student-active",
        authorName: "Active Student",
        body: "A genuine comment from an enrolled student.",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("denies a refunded-status user from creating a lesson comment", async () => {
    await seedProtectedCourseContent();
    await seedEnrollment("student-refunded", "refunded");
    const db = testEnv
      .authenticatedContext("student-refunded", verifiedAuth)
      .firestore();
    await assertFails(
      setDoc(doc(db, `courses/${courseId}/lessonComments/comment-refunded`), {
        courseId,
        lessonId: "lesson-1",
        authorId: "student-refunded",
        authorName: "Refunded Student",
        body: "A refunded student must not be able to comment.",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
    );
  });
});

describe("Firestore gamification rules (memberStats / leaderboards)", () => {
  async function seedMemberStats(uid: string, points: number) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `memberStats/${uid}`), {
        // No `uid` field is stored — the doc id IS the uid; the client derives
        // it. The aggregate is server-written (the like trigger) only.
        displayName: "Seed Member",
        points,
        level: 1,
        totalLikesReceived: points,
        updatedAt: Timestamp.now(),
      });
    });
  }

  async function seedLeaderboard() {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "leaderboards/all-time"), {
        window: "all-time",
        // NEW shape: entries carry NO raw Auth UID (it leaked the global top
        // list's member identities). displayName/points/level/rank only.
        entries: [
          { displayName: "Top Member", points: 120, level: 5, rank: 1 },
        ],
        updatedAt: Timestamp.now(),
      });
    });
  }

  it("lets a signed-in member GET a single member's stats by known uid", async () => {
    await seedMemberStats("other-member", 30);
    // A non-enrolled signed-in account is the strongest subject: even it may
    // read ONE doc it already knows the uid for (badge use case), but must not
    // be able to enumerate (see the next test).
    const db = testEnv
      .authenticatedContext("reader-1", verifiedAuth)
      .firestore();
    await assertSucceeds(getDoc(doc(db, "memberStats/other-member")));
  });

  it("denies LISTing the memberStats collection (no roster enumeration)", async () => {
    await seedMemberStats("member-a", 10);
    await seedMemberStats("member-b", 20);
    // The core fix for Problem A: `allow list: if false` means no account —
    // enrolled or not — can stream the whole collection into a roster of every
    // member (raw uid -> displayName -> points).
    const db = testEnv
      .authenticatedContext("reader-1", verifiedAuth)
      .firestore();
    await assertFails(getDocs(collection(db, "memberStats")));
  });

  it("denies an unauthenticated read of member stats", async () => {
    await seedMemberStats("other-member", 30);
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "memberStats/other-member")));
  });

  it("lets a signed-in member read a leaderboard window with no uid leak", async () => {
    await seedLeaderboard();
    const db = testEnv
      .authenticatedContext("reader-1", verifiedAuth)
      .firestore();
    const snap = await assertSucceeds(getDoc(doc(db, "leaderboards/all-time")));
    // Regression guard for Problem B: no leaderboard entry may carry a raw uid.
    const entries = (snap.data() ?? {}).entries as Array<Record<string, unknown>>;
    for (const entry of entries) {
      expect(entry.uid).toBeUndefined();
    }
  });

  it("denies an unauthenticated read of the leaderboard", async () => {
    await seedLeaderboard();
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "leaderboards/all-time")));
  });
});

describe("Firestore user notifications inbox rules", () => {
  async function seedNotification(uid: string, id: string, read = false) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), `users/${uid}/notifications/${id}`),
        {
          type: "community_reply",
          title: "Someone replied to you",
          body: "A reply body for the inbox.",
          link: "/learn/community/course-x",
          actorName: "Member",
          read,
          createdAt: Timestamp.now(),
        },
      );
    });
  }

  it("lets the owner read their own notification", async () => {
    await seedNotification("owner-n", "n-1");
    const db = testEnv.authenticatedContext("owner-n", verifiedAuth).firestore();
    await assertSucceeds(getDoc(doc(db, "users/owner-n/notifications/n-1")));
  });

  it("blocks another user from reading someone else's notification", async () => {
    await seedNotification("owner-n", "n-1");
    const db = testEnv
      .authenticatedContext("stranger-n", verifiedAuth)
      .firestore();
    await assertFails(getDoc(doc(db, "users/owner-n/notifications/n-1")));
  });

  it("lets the owner mark a notification read (read flag only)", async () => {
    await seedNotification("owner-n", "n-1", false);
    const db = testEnv.authenticatedContext("owner-n", verifiedAuth).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "users/owner-n/notifications/n-1"), { read: true }),
    );
  });

  it("blocks editing any field other than read on the owner update path", async () => {
    await seedNotification("owner-n", "n-1", false);
    const db = testEnv.authenticatedContext("owner-n", verifiedAuth).firestore();
    // Smuggling another key alongside `read` must reject the whole write.
    await assertFails(
      updateDoc(doc(db, "users/owner-n/notifications/n-1"), {
        read: true,
        title: "forged title",
      }),
    );
    await assertFails(
      updateDoc(doc(db, "users/owner-n/notifications/n-1"), {
        title: "forged title",
      }),
    );
  });

  it("blocks a non-bool read value", async () => {
    await seedNotification("owner-n", "n-1", false);
    const db = testEnv.authenticatedContext("owner-n", verifiedAuth).firestore();
    await assertFails(
      updateDoc(doc(db, "users/owner-n/notifications/n-1"), { read: "yes" }),
    );
  });

  it("blocks the owner from creating or deleting a notification (server-only)", async () => {
    const db = testEnv.authenticatedContext("owner-n", verifiedAuth).firestore();
    await assertFails(
      setDoc(doc(db, "users/owner-n/notifications/n-forge"), {
        type: "enrollment",
        title: "Forged",
        body: "Should not be allowed.",
        link: null,
        actorName: null,
        read: false,
        createdAt: Timestamp.now(),
      }),
    );
    await seedNotification("owner-n", "n-del");
    await assertFails(deleteDoc(doc(db, "users/owner-n/notifications/n-del")));
  });
});
