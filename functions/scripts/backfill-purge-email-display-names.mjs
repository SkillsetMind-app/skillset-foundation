#!/usr/bin/env node
/**
 * One-time backfill: scrub raw email addresses that were stored as public
 * DISPLAY-NAME fields.
 *
 * WHY
 *   Several writers used `displayName || email || "<label>"` as the persisted,
 *   broadly-rendered author label. When a learner never set a displayName the
 *   chain fell through to their raw email, which then rendered to every
 *   co-enrolled member (community posts/comments, lesson comments, event RSVPs)
 *   or to moderators (reports) — a PII leak. The client writers were fixed to
 *   drop the email fallback; this backfill scrubs the addresses already stored.
 *   The dedicated email fields (reporterEmail, attendeeEmail) are intentionally
 *   NOT touched — only the *name* fields that should never have held an email.
 *
 * WHAT
 *   For each affected (collection-group, field) pair, finds docs whose value is
 *   exactly an email address and replaces ONLY that field with a neutral label.
 *   Nothing else is touched. Idempotent — safe to run repeatedly.
 *
 *   surface                         field          neutral label
 *   ------------------------------- -------------- ------------------
 *   communityPosts                  authorName     "Skillset member"
 *   comments (community, group)     authorName     "Skillset member"
 *   communityReports                reporterName   "Skillset member"
 *   lessonComments (group)          authorName     "Skillset learner"
 *   rsvps (course events, group)    attendeeName   "Skillset learner"
 *   memberStats                     displayName    "Member"
 *
 * AUTH  (same as backfill-purge-review-userid.mjs)
 *   gcloud auth application-default login
 *   or: export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * RUN  (from the repo's functions/ directory so firebase-admin resolves)
 *   Dry run (counts only, writes nothing — DEFAULT):
 *     node scripts/backfill-purge-email-display-names.mjs
 *   Apply for real:
 *     node scripts/backfill-purge-email-display-names.mjs --apply
 *
 *   Override project (defaults to skillsetusaofficial):
 *     FIREBASE_PROJECT_ID=my-project node scripts/backfill-purge-email-display-names.mjs --apply
 */

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GCLOUD_PROJECT ||
  "skillsetusaofficial";
const BATCH_SIZE = 400;

// Exact-match: the stored value IS an email (not "Jane <jane@x.com>").
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// { group: collectionGroup id, field, label, topLevelOnly? }
// topLevelOnly uses .collection() (a root collection); otherwise
// .collectionGroup() also catches subcollection docs of the same id.
const TARGETS = [
  { group: "communityPosts", field: "authorName", label: "Skillset member", topLevelOnly: true },
  { group: "comments", field: "authorName", label: "Skillset member" },
  { group: "communityReports", field: "reporterName", label: "Skillset member", topLevelOnly: true },
  { group: "lessonComments", field: "authorName", label: "Skillset learner" },
  { group: "rsvps", field: "attendeeName", label: "Skillset learner" },
  { group: "memberStats", field: "displayName", label: "Member", topLevelOnly: true },
];

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();

async function scrubTarget(target) {
  const ref = target.topLevelOnly
    ? db.collection(target.group)
    : db.collectionGroup(target.group);
  const snapshot = await ref.get();

  let scanned = 0;
  let leaking = 0;
  let scrubbed = 0;
  let batch = db.batch();
  let pending = 0;

  for (const docSnap of snapshot.docs) {
    scanned += 1;
    const value = docSnap.get(target.field);
    if (typeof value !== "string" || !EMAIL_RE.test(value)) {
      continue;
    }
    leaking += 1;
    if (!APPLY) {
      continue;
    }
    batch.update(docSnap.ref, { [target.field]: target.label });
    pending += 1;
    if (pending >= BATCH_SIZE) {
      await batch.commit();
      scrubbed += pending;
      batch = db.batch();
      pending = 0;
    }
  }

  if (APPLY && pending > 0) {
    await batch.commit();
    scrubbed += pending;
  }

  return { scanned, leaking, scrubbed };
}

async function main() {
  console.log(
    `[backfill] project=${PROJECT_ID} mode=${APPLY ? "APPLY" : "DRY-RUN"}`,
  );

  let totalLeaking = 0;
  let totalScrubbed = 0;

  for (const target of TARGETS) {
    const { scanned, leaking, scrubbed } = await scrubTarget(target);
    totalLeaking += leaking;
    totalScrubbed += scrubbed;
    const tail = APPLY ? `scrubbed=${scrubbed}` : "(dry run)";
    console.log(
      `  ${target.group}.${target.field}: scanned=${scanned} email-valued=${leaking} ${tail}`,
    );
  }

  console.log("[backfill] done.");
  if (APPLY) {
    console.log(`  total fields scrubbed: ${totalScrubbed}`);
  } else {
    console.log(
      `  (dry run — re-run with --apply to scrub the ${totalLeaking} email-valued name field(s))`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[backfill] FAILED:", error);
    process.exit(1);
  });
