#!/usr/bin/env node
// B1 migration tool — move inline lesson content into the gated subcollection
// courses/{courseId}/lessonContent/{lessonId} so the paid curriculum stops
// being world-readable in the public course doc.
//
// Lives in functions/ because firebase-admin is installed here. Run it FROM
// this directory so the bare `firebase-admin` import resolves:
//
//   cd functions
//   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/service-account.json \
//     node scripts/backfill-lesson-content.mjs --copy   --project skillsetusaofficial
//   node scripts/backfill-lesson-content.mjs --verify  --project skillsetusaofficial
//   node scripts/backfill-lesson-content.mjs --strip   --project skillsetusaofficial \
//     --i-understand-this-is-destructive
//
// Supervised sequencing (see .claude/PAYWALL-LESSON-CONTENT-MIGRATION-PLAN.md):
//   1. deploy rules (adds lessonContent) + app (dual-write + subcollection-first
//      read with inline fallback)
//   2. --copy   (non-destructive, idempotent)
//   3. --verify (must exit 0)
//   4. deploy app: write subcollection-only
//   5. --strip  (closes the leak; re-verifies each course right before it strips),
//      then --verify again
//
// EVERY mode mutates or reads PRODUCTION. Run only in a supervised window with
// the ability to watch prod and roll hosting back fast.

import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const projectId =
  opt("project") || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT;
if (!projectId) {
  console.error("Missing --project <id> (or GCLOUD_PROJECT / FIREBASE_PROJECT).");
  process.exit(2);
}

const mode = has("strip") ? "strip" : has("verify") ? "verify" : "copy";

if (mode === "strip" && !has("i-understand-this-is-destructive")) {
  console.error(
    "Refusing to --strip without --i-understand-this-is-destructive. " +
      "Run --copy then --verify (exit 0) first.",
  );
  process.exit(2);
}

initializeApp({ projectId, credential: applicationDefault() });
const db = getFirestore();

// Every lesson carrying inline content, flattened with its lessonId.
function lessonsWithContent(course) {
  const out = [];
  for (const mod of course?.modules ?? []) {
    for (const lesson of mod?.lessons ?? []) {
      const contentText = lesson?.contentText ?? null;
      const externalUrl = lesson?.externalUrl ?? null;
      if (contentText != null || externalUrl != null) {
        out.push({ lessonId: lesson.id, contentText, externalUrl });
      }
    }
  }
  return out;
}

function matches(doc, item) {
  if (!doc) return false;
  return (
    (doc.contentText ?? null) === item.contentText &&
    (doc.externalUrl ?? null) === item.externalUrl
  );
}

async function run() {
  const snap = await db.collection("courses").get();
  let courses = 0;
  let lessons = 0;
  let mismatches = 0;
  let stripped = 0;

  for (const docSnap of snap.docs) {
    const items = lessonsWithContent(docSnap.data());
    if (items.length === 0) continue;
    courses++;

    if (mode === "copy") {
      const batch = db.batch();
      for (const it of items) {
        batch.set(
          docSnap.ref.collection("lessonContent").doc(it.lessonId),
          { contentText: it.contentText, externalUrl: it.externalUrl },
          { merge: false },
        );
        lessons++;
      }
      await batch.commit();
      console.log(`copied ${items.length} lesson(s) -> course ${docSnap.id}`);
    } else if (mode === "verify") {
      for (const it of items) {
        const target = await docSnap.ref
          .collection("lessonContent")
          .doc(it.lessonId)
          .get();
        lessons++;
        if (!matches(target.exists ? target.data() : null, it)) {
          mismatches++;
          console.error(
            `MISMATCH course=${docSnap.id} lesson=${it.lessonId} ` +
              `(${target.exists ? "content differs" : "subcollection doc missing"})`,
          );
        }
      }
    } else if (mode === "strip") {
      // Re-read + re-verify THIS course immediately before stripping, so a
      // concurrent edit between --verify and --strip can't drop content that
      // was never copied. The subcollection copy is the only recovery backup.
      const fresh = await docSnap.ref.get();
      const freshCourse = fresh.data();
      const freshItems = lessonsWithContent(freshCourse);
      let safe = true;
      for (const it of freshItems) {
        const target = await docSnap.ref
          .collection("lessonContent")
          .doc(it.lessonId)
          .get();
        if (!matches(target.exists ? target.data() : null, it)) {
          safe = false;
          console.error(
            `REFUSING STRIP course=${docSnap.id} lesson=${it.lessonId}: ` +
              "subcollection copy missing/stale — re-run --copy then --verify",
          );
        }
      }
      if (!safe) {
        mismatches++;
        continue;
      }
      const modules = (freshCourse.modules ?? []).map((mod) => ({
        ...mod,
        lessons: (mod.lessons ?? []).map((lesson) => {
          // Drop the two gated fields; keep everything else verbatim.
          const rest = { ...lesson };
          delete rest.contentText;
          delete rest.externalUrl;
          return rest;
        }),
      }));
      await docSnap.ref.update({
        modules,
        updatedAt: FieldValue.serverTimestamp(),
      });
      stripped += freshItems.length;
      console.log(
        `stripped ${freshItems.length} inline lesson(s) <- course ${docSnap.id}`,
      );
    }
  }

  console.log(
    `\n[${mode}] courses=${courses} lessons=${lessons} ` +
      `mismatches=${mismatches} stripped=${stripped}`,
  );
  if ((mode === "verify" || mode === "strip") && mismatches > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
