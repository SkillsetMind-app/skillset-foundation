#!/usr/bin/env node
/**
 * One-time backfill: purge the leaked `userId` field from existing
 * `courseReviews` documents.
 *
 * WHY
 *   courseReviews docs are world-readable on the published-course read path
 *   (firestore.rules). They used to carry the reviewer's raw Firebase Auth
 *   UID, which let an attacker harvest the UIDs of confirmed paying customers
 *   and cross-reference them against other UID-keyed reads to deanonymize
 *   buyers. submitCourseReview no longer writes `userId` (and actively
 *   FieldValue.delete()s it on every re-submit), but reviews that are never
 *   re-submitted keep the stale field until this backfill removes it.
 *
 * WHAT
 *   Scans the entire courseReviews collection and, for every doc that still
 *   has a `userId` field, removes ONLY that field (FieldValue.delete()).
 *   Nothing else is touched. Idempotent — safe to run repeatedly.
 *
 * AUTH
 *   Uses Application Default Credentials. Authenticate one of these ways
 *   BEFORE running (the firebase CLI login token is NOT enough for the Admin
 *   SDK):
 *     gcloud auth application-default login
 *   or point at a service-account key:
 *     export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * RUN  (from the repo's functions/ directory so firebase-admin resolves)
 *   Dry run (counts only, writes nothing — DEFAULT):
 *     node scripts/backfill-purge-review-userid.mjs
 *   Apply for real:
 *     node scripts/backfill-purge-review-userid.mjs --apply
 *
 *   Override the target project (defaults to skillsetusaofficial):
 *     FIREBASE_PROJECT_ID=my-project node scripts/backfill-purge-review-userid.mjs --apply
 */

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GCLOUD_PROJECT ||
  "skillsetusaofficial";
const BATCH_SIZE = 400; // < 500 Firestore batch write limit, with headroom.

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();

async function main() {
  console.log(
    `[backfill] project=${PROJECT_ID} mode=${APPLY ? "APPLY" : "DRY-RUN"}`,
  );

  const snapshot = await db.collection("courseReviews").get();
  let scanned = 0;
  let withUserId = 0;
  let purged = 0;
  let batch = db.batch();
  let pending = 0;

  for (const docSnap of snapshot.docs) {
    scanned += 1;
    const data = docSnap.data();
    if (!("userId" in data)) {
      continue;
    }
    withUserId += 1;

    if (!APPLY) {
      continue;
    }

    batch.update(docSnap.ref, { userId: FieldValue.delete() });
    pending += 1;
    if (pending >= BATCH_SIZE) {
      await batch.commit();
      purged += pending;
      console.log(`[backfill] committed ${purged} so far...`);
      batch = db.batch();
      pending = 0;
    }
  }

  if (APPLY && pending > 0) {
    await batch.commit();
    purged += pending;
  }

  console.log("[backfill] done.");
  console.log(`  scanned docs:        ${scanned}`);
  console.log(`  with stale userId:   ${withUserId}`);
  if (APPLY) {
    console.log(`  fields purged:       ${purged}`);
  } else {
    console.log(
      `  (dry run — re-run with --apply to remove the ${withUserId} field(s))`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[backfill] FAILED:", error);
    process.exit(1);
  });
