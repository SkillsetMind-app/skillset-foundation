import { NextResponse } from "next/server";

import { deleteBunnyVideo, hasValidBunnyAssetPath } from "@/lib/bunny/server";
import { isCronRequest } from "@/lib/cron/authorized";
import { sendOpsAlert } from "@/lib/ops/alert";
import type { Database, Json } from "@/lib/supabase/database.types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

// GET /api/cron/course-cleanup — deletes the files (Storage) and videos
// (Bunny) of a deleted product. The queue (course_deletions) only gets a row
// once the course's DELETE has committed (trigger on courses, migration
// 20261008030000); this route only reads the queue.
//
// DRY RUN by default: without COURSE_CLEANUP_LIVE=1 nothing is deleted and
// nothing changes in the database; the response and the log say how many files
// and videos WOULD be deleted, with `due` (a day has already passed). The dry
// run looks from newest to oldest: the test product that was just deleted
// shows up even with a full queue. The same variable is the off switch.
//
// Safeguards, in this order:
//   - only `pending` requests older than one day (Bunny has no backup; the day
//     is the margin for the staff to cancel an "I deleted the wrong product");
//   - files: the database lists only `courses/<id>/` (trailing slash included)
//     from the two buckets, only what was created while the course existed,
//     rejects a dangerous or reused id, and marks `in_use` whatever another
//     live row cites (those stay); here the folder tally is redone before each
//     remove;
//   - video: only with a valid receipt for this course and this owner (HMAC in
//     src/lib/bunny/server.ts), and the database confirms RIGHT BEFORE each
//     DELETE that the queue is still pending, that the id did not come back and
//     that nobody cites the video;
//   - time: about 40 s per run. If it runs out in the middle of a product, what
//     was already deleted stays saved (a deleted video leaves the queue) and
//     the next hour continues, without spending an attempt. Three runs in a row
//     that delete nothing = 1 attempt;
//   - failure: counts an attempt and tries again next hour; on the 5th it
//     becomes `failed` and an alert goes to the staff (src/lib/ops/alert.ts). An
//     alert that did not arrive = 500, and GitHub Actions turns red.
// The log and the response carry counts and course ids, never a key or a file name.
//
// Called every hour by .github/workflows/stripe-attention.yml (the Vercel plan
// only schedules once a day).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const GRACE_MS = 24 * 60 * 60 * 1000; // ponytail: fixed window; env only if the staff asks
const MAX_JOBS = 5;
const MAX_ATTEMPTS = 5;
const STALLED_RUNS_PER_ATTEMPT = 3;
// Below Vercel's 60 s with room for the last call (8 s at Bunny).
const BUDGET_MS = 40_000;
const CHUNK = 100;
const BUCKETS = ["public-media", "course-content"] as const;
// Each RPC has its own timeout: the 40 s budget is only checked BETWEEN calls,
// and a slow query would run past Vercel's 60 s without counting an attempt or alerting.
const RPC_TIMEOUT_MS = 15_000;

type Admin = ReturnType<typeof getSupabaseAdminClient>;
type QueuePatch = Database["public"]["Tables"]["course_deletions"]["Update"];
type Job = {
  course_id: string;
  bunny_assets: Json;
  attempts: number;
  stalled_runs: number;
  requested_at: string;
};
type Counts = {
  objects: number;
  keptFiles: number;
  videos: number;
  skippedNoReceipt: number;
  inUseVideos: number;
};
type JobReport = Partial<Counts> & {
  courseId: string;
  due: boolean;
  done?: boolean;
  error?: string;
};

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const live = process.env.COURSE_CLEANUP_LIVE === "1";

  let admin: Admin;
  try {
    admin = getSupabaseAdminClient();
  } catch {
    return NextResponse.json({ ok: false, reason: "service_role_missing" }, { status: 500 });
  }

  const now = Date.now();
  const outOfTime = () => Date.now() - now > BUDGET_MS;
  const cutoff = new Date(now - GRACE_MS).toISOString();
  let query = admin
    .from("course_deletions")
    .select("course_id, bunny_assets, attempts, stalled_runs, requested_at")
    .eq("status", "pending");
  if (live) {
    query = query.lt("requested_at", cutoff);
  }
  // Live, the oldest first; in the dry run, the newest (see the top).
  const { data: jobs, error } = await query.order("requested_at", { ascending: live }).limit(MAX_JOBS);
  if (error) {
    console.error("Course cleanup could not read the queue", error.message);
    return NextResponse.json({ ok: false, reason: "read_failed" }, { status: 500 });
  }

  const report: JobReport[] = [];
  let alertLost = false;
  for (const job of (jobs ?? []) as Job[]) {
    if (outOfTime()) break;
    const due = Date.parse(job.requested_at) < now - GRACE_MS;
    try {
      const { counts, done, progressed } = await cleanJob(admin, job, live, outOfTime);
      report.push({ courseId: job.course_id, due, ...counts, done });
      console.info("Course cleanup", live ? (done ? "done" : "paused") : "dry run", job.course_id, { due, ...counts });
      if (live && !done && (await recordPause(admin, job, progressed))) alertLost = true;
    } catch (failure) {
      const message = (failure instanceof Error ? failure.message : String(failure)).slice(0, 300);
      console.error("Course cleanup failed", job.course_id, message);
      report.push({ courseId: job.course_id, due, error: message });
      if (live && (await countAttempt(admin, job, message))) alertLost = true;
    }
  }

  return NextResponse.json(
    { ok: !alertLost, live, jobs: report },
    { status: alertLost ? 500 : 200 },
  );
}

// Every write requires the row to still be pending: a `cancelled` set by the
// staff in the middle of a run is never undone here.
async function saveRow(admin: Admin, courseId: string, patch: QueuePatch) {
  const { error } = await admin
    .from("course_deletions")
    .update(patch)
    .eq("course_id", courseId)
    .eq("status", "pending");
  return error;
}

// One more attempt. On the 5th: `failed` and an alert. Returns true if the
// alert did not reach anyone.
async function countAttempt(admin: Admin, job: Job, message: string): Promise<boolean> {
  const attempts = job.attempts + 1;
  const gaveUp = attempts >= MAX_ATTEMPTS;
  const error = await saveRow(admin, job.course_id, {
    status: gaveUp ? "failed" : "pending",
    attempts,
    stalled_runs: 0,
    last_error: message,
  });
  if (error) console.error("Course cleanup could not count the failure", job.course_id, error.message);
  if (!gaveUp) return false;

  const delivered = await sendOpsAlert({
    event: "course_cleanup_failed",
    severity: "warn",
    summary: `A deleted product's files and videos could not be removed after ${attempts} tries.`,
    context: { courseId: job.course_id, attempts },
  });
  if (!delivered) console.error("Course cleanup alert did not reach anyone", job.course_id);
  return !delivered;
}

// Time ran out in the middle of the product: that is not a failure. With
// progress, only the hour passes; without progress, it counts the stalled run,
// and 3 in a row become one attempt.
async function recordPause(admin: Admin, job: Job, progressed: boolean): Promise<boolean> {
  const stalled = progressed ? 0 : job.stalled_runs + 1;
  if (stalled >= STALLED_RUNS_PER_ATTEMPT) {
    return countAttempt(admin, job, `no progress in ${stalled} runs`);
  }
  const error = await saveRow(
    admin,
    job.course_id,
    progressed ? { stalled_runs: 0, last_progress_at: new Date().toISOString() } : { stalled_runs: stalled },
  );
  if (error) console.error("Course cleanup could not save its progress", job.course_id, error.message);
  return false;
}

// Lists the files in the course folder through the database, and redoes the
// folder tally here: a row outside `courses/<id>/` or from another bucket never
// reaches remove. A file that another live row cites (`in_use`) stays.
async function listObjects(admin: Admin, courseId: string) {
  const { data, error } = await admin
    .rpc("course_storage_objects_for_cleanup", { p_course_id: courseId })
    .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS));
  if (error) throw new Error(`list files: ${error.message}`);
  const prefix = `courses/${courseId}/`;
  const byBucket = new Map<string, string[]>();
  let count = 0;
  let kept = 0;
  for (const row of data ?? []) {
    const bucket = BUCKETS.find((name) => name === row.object_bucket);
    if (!bucket || !row.object_name.startsWith(prefix)) continue;
    if (row.in_use) {
      kept += 1;
      continue;
    }
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), row.object_name]);
    count += 1;
  }
  return { byBucket, count, kept };
}

function fileKeys(byBucket: Map<string, string[]>) {
  return [...byBucket].flatMap(([bucket, names]) => names.map((name) => `${bucket}/${name}`));
}

async function cleanJob(admin: Admin, job: Job, live: boolean, outOfTime: () => boolean) {
  // Videos: only with a receipt for this course and this owner. Without a
  // receipt it is never deleted, and it stays listed in the row's result (it
  // does not silently vanish into a `done`).
  const assets = Array.isArray(job.bunny_assets) ? job.bunny_assets : [];
  const proven: string[] = [];
  const noReceipt: string[] = [];
  for (const asset of assets) {
    const { videoId, ownerId, receipt } = (asset ?? {}) as Record<string, unknown>;
    if (
      typeof videoId === "string" && typeof ownerId === "string" && typeof receipt === "string"
      && hasValidBunnyAssetPath(job.course_id, ownerId, videoId, receipt)
    ) {
      proven.push(videoId);
    } else {
      noReceipt.push(typeof videoId === "string" ? videoId : "unknown");
    }
  }
  if (noReceipt.length > 0) {
    console.warn("Course cleanup skipped videos without a valid receipt", job.course_id, noReceipt.length);
  }

  const files = await listObjects(admin, job.course_id);
  if (files.kept > 0) {
    console.info("Course cleanup kept referenced files", job.course_id, files.kept);
  }
  const counts: Counts = {
    objects: files.count,
    keptFiles: files.kept,
    videos: 0,
    skippedNoReceipt: noReceipt.length,
    inUseVideos: 0,
  };
  let progressed = false;
  const paused = () => ({ counts, done: false, progressed });

  if (live) {
    for (const [bucket, names] of files.byBucket) {
      for (let start = 0; start < names.length; start += CHUNK) {
        if (outOfTime()) return paused();
        const { error } = await admin.storage.from(bucket).remove(names.slice(start, start + CHUNK));
        if (error) throw new Error(`remove files from ${bucket}: ${error.message}`);
        progressed = true;
      }
    }
    // PostgREST returns at most ~1000 rows per call: a large folder goes out in
    // several runs. A failure is only a file that was sent to be deleted and is
    // still listed. A file left over that was not in the batch = progress
    // saved, and the next hour continues.
    // ponytail: if the first ~1000 rows are all in_use, the folder becomes done
    // with files after them. Known ceiling; paginate the RPC if it shows up.
    const removed = new Set(fileKeys(files.byBucket));
    const left = await listObjects(admin, job.course_id);
    const stuck = fileKeys(left.byBucket).filter((key) => removed.has(key)).length;
    if (stuck > 0) throw new Error(`${stuck} file(s) still in storage after removal`);
    if (left.count > 0) return paused();
  }

  const inUse: string[] = [];
  let remaining = assets;
  for (const videoId of proven) {
    if (outOfTime()) return paused();
    // Right before EACH DELETE, not once at the start: the id may have come
    // back, the staff may have cancelled, another lesson may have started using the video.
    const { data: deletable, error } = await admin
      .rpc("course_cleanup_video_deletable", { p_course_id: job.course_id, p_video_id: videoId })
      .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS));
    if (error) throw new Error(`video check: ${error.message}`);
    if (!deletable) {
      inUse.push(videoId);
      counts.inUseVideos += 1;
      continue;
    }
    counts.videos += 1;
    if (!live) continue;

    await deleteBunnyVideo(videoId);
    progressed = true;
    // Progress saved: the video leaves the queue and the next run does not call it again.
    remaining = remaining.filter((asset) => (asset as { videoId?: unknown } | null)?.videoId !== videoId);
    const saveError = await saveRow(admin, job.course_id, {
      bunny_assets: remaining,
      last_progress_at: new Date().toISOString(),
    });
    if (saveError) throw new Error(`save progress: ${saveError.message}`);
  }
  if (!live) return { counts, done: false, progressed };

  // Only the id and counts remain: the product name is removed from the row.
  const error = await saveRow(admin, job.course_id, {
    status: "done",
    finished_at: new Date().toISOString(),
    last_error: null,
    stalled_runs: 0,
    title: "",
    result: { keptFiles: files.kept, skippedNoReceipt: noReceipt, inUseVideos: inUse },
  });
  if (error) throw new Error(`mark done: ${error.message}`);
  return { counts, done: true, progressed };
}
