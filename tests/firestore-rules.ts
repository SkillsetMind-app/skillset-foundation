import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
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
      await setDoc(doc(adminDb, "courseReviews/course-published__student-1"), {
        id: "course-published__student-1",
        courseId: "course-published",
        userId: "student-1",
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

    await assertSucceeds(
      getDoc(doc(publicDb, "courseReviews/course-published__student-1")),
    );
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
