import { NextResponse } from "next/server";

import { deleteBunnyVideo, hasValidBunnyAssetPath } from "@/lib/bunny/server";
import { isCronRequest } from "@/lib/cron/authorized";
import { sendOpsAlert } from "@/lib/ops/alert";
import type { Json } from "@/lib/supabase/database.types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

// GET /api/cron/course-cleanup — apaga os arquivos (Storage) e os videos
// (Bunny) de produto apagado. A fila (course_deletions) so ganha linha quando
// o DELETE do curso fez commit (gatilho em courses, migration 20261008030000);
// esta rota so le a fila.
//
// ENSAIO por padrao: sem COURSE_CLEANUP_LIVE=1 nada e apagado e nada muda no
// banco; a resposta e o log dizem quantos arquivos e videos SERIAM apagados,
// com `due` (ja passou das 24 h). A mesma variavel e a chave de desligar.
//
// Travas, nesta ordem:
//   - so pedidos com mais de 24 h (Bunny nao tem backup; o dia da margem para
//     o suporte reagir a "apaguei o produto errado");
//   - arquivos: o banco lista so `courses/<id>/` (barra final inclusa) dos
//     dois baldes, e recusa id perigoso ou reaproveitado; aqui a mesma conta e
//     refeita antes de cada remove;
//   - video: so com recibo valido deste curso e deste dono (HMAC de
//     src/lib/bunny/server.ts) e que nenhuma linha viva de course_assets use;
//   - idempotente: remove de arquivo que nao existe nao falha, 404 da Bunny e
//     sucesso, e a linha so vira `done` depois de tudo;
//   - falhou: `failed`, tenta de novo na proxima hora; na 5a falha, um alerta
//     para a equipe (src/lib/ops/alert.ts). Alerta que nao chegou = 500, e o
//     GitHub Actions fica vermelho.
// Log e resposta levam contagens e ids de curso, nunca chave nem nome de arquivo.
//
// Chamado de hora em hora por .github/workflows/stripe-attention.yml (o plano
// da Vercel so agenda uma vez por dia).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const GRACE_MS = 24 * 60 * 60 * 1000; // ponytail: janela fixa; env so se o suporte pedir
const MAX_JOBS = 5;
const MAX_ATTEMPTS = 5;
// ponytail: o tempo so e conferido entre um produto e outro. Um produto com
// muitos videos que estoure os 60 s fica `pending` e continua na proxima hora.
const BUDGET_MS = 45_000;
const CHUNK = 100;
const BUCKETS = ["public-media", "course-content"] as const;

type Admin = ReturnType<typeof getSupabaseAdminClient>;
type Job = {
  course_id: string;
  bunny_assets: Json;
  attempts: number;
  requested_at: string;
};
type JobReport = {
  courseId: string;
  due: boolean;
  objects?: number;
  videos?: number;
  skippedVideos?: number;
  inUseVideos?: number;
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
  const cutoff = new Date(now - GRACE_MS).toISOString();
  let query = admin
    .from("course_deletions")
    .select("course_id, bunny_assets, attempts, requested_at")
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_ATTEMPTS);
  if (live) {
    query = query.lt("requested_at", cutoff);
  }
  const { data: jobs, error } = await query.order("requested_at", { ascending: true }).limit(MAX_JOBS);
  if (error) {
    console.error("Course cleanup could not read the queue", error.message);
    return NextResponse.json({ ok: false, reason: "read_failed" }, { status: 500 });
  }

  const report: JobReport[] = [];
  let alertLost = false;
  for (const job of (jobs ?? []) as Job[]) {
    if (Date.now() - now > BUDGET_MS) break;
    const due = Date.parse(job.requested_at) < now - GRACE_MS;
    try {
      const counts = await cleanJob(admin, job, live);
      report.push({ courseId: job.course_id, due, ...counts, done: live });
      console.info("Course cleanup", live ? "done" : "dry run", job.course_id, { due, ...counts });
    } catch (failure) {
      const message = (failure instanceof Error ? failure.message : String(failure)).slice(0, 300);
      console.error("Course cleanup failed", job.course_id, message);
      report.push({ courseId: job.course_id, due, error: message });
      if (!live) continue;

      const attempts = job.attempts + 1;
      const { error: markError } = await admin
        .from("course_deletions")
        .update({ status: "failed", attempts, last_error: message })
        .eq("course_id", job.course_id);
      if (markError) console.error("Course cleanup could not count the failure", job.course_id, markError.message);
      if (attempts >= MAX_ATTEMPTS) {
        const delivered = await sendOpsAlert({
          event: "course_cleanup_failed",
          severity: "warn",
          summary: `A deleted product's files and videos could not be removed after ${attempts} tries.`,
          context: { courseId: job.course_id, attempts },
        });
        if (!delivered) {
          console.error("Course cleanup alert did not reach anyone", job.course_id);
          alertLost = true;
        }
      }
    }
  }

  return NextResponse.json(
    { ok: !alertLost, live, jobs: report },
    { status: alertLost ? 500 : 200 },
  );
}

// Lista os arquivos da pasta do curso pelo banco, e refaz a conta da pasta
// aqui: uma linha fora de `courses/<id>/` ou de outro balde nunca chega ao remove.
async function listObjects(admin: Admin, courseId: string) {
  const { data, error } = await admin.rpc("course_storage_objects_for_cleanup", { p_course_id: courseId });
  if (error) throw new Error(`list files: ${error.message}`);
  const prefix = `courses/${courseId}/`;
  const byBucket = new Map<string, string[]>();
  let count = 0;
  for (const row of data ?? []) {
    const bucket = BUCKETS.find((name) => name === row.object_bucket);
    if (!bucket || !row.object_name.startsWith(prefix)) continue;
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), row.object_name]);
    count += 1;
  }
  return { byBucket, count };
}

async function cleanJob(admin: Admin, job: Job, live: boolean) {
  // Videos: recibo deste curso e deste dono, e nenhuma linha viva usando.
  const assets = Array.isArray(job.bunny_assets) ? job.bunny_assets : [];
  const proven = new Set<string>();
  let skippedVideos = 0;
  for (const asset of assets) {
    const { videoId, ownerId, receipt } = (asset ?? {}) as Record<string, unknown>;
    if (
      typeof videoId === "string" && typeof ownerId === "string" && typeof receipt === "string"
      && hasValidBunnyAssetPath(job.course_id, ownerId, videoId, receipt)
    ) {
      proven.add(videoId);
    } else {
      skippedVideos += 1;
    }
  }
  if (skippedVideos > 0) {
    console.warn("Course cleanup skipped videos without a valid receipt", job.course_id, skippedVideos);
  }

  let inUseVideos = 0;
  if (proven.size > 0) {
    const { data, error } = await admin
      .from("course_assets")
      .select("bunny_video_id")
      .in("bunny_video_id", [...proven]);
    if (error) throw new Error(`video in use check: ${error.message}`);
    for (const row of data ?? []) {
      if (row.bunny_video_id && proven.delete(row.bunny_video_id)) inUseVideos += 1;
    }
  }

  const files = await listObjects(admin, job.course_id);
  const counts = { objects: files.count, videos: proven.size, skippedVideos, inUseVideos };
  if (!live) return counts;

  for (const [bucket, names] of files.byBucket) {
    for (let start = 0; start < names.length; start += CHUNK) {
      const { error } = await admin.storage.from(bucket).remove(names.slice(start, start + CHUNK));
      if (error) throw new Error(`remove files from ${bucket}: ${error.message}`);
    }
  }
  // ponytail: o PostgREST devolve no maximo ~1000 linhas por chamada. Sobrou
  // arquivo = falha contada, e a proxima hora continua de onde parou (5 voltas
  // cobrem 5.000 arquivos; acima disso o alerta chama alguem).
  const left = await listObjects(admin, job.course_id);
  if (left.count > 0) throw new Error(`${left.count} file(s) still in storage after removal`);

  for (const videoId of proven) {
    await deleteBunnyVideo(videoId);
  }

  const { error } = await admin
    .from("course_deletions")
    .update({ status: "done", finished_at: new Date().toISOString(), last_error: null })
    .eq("course_id", job.course_id);
  if (error) throw new Error(`mark done: ${error.message}`);
  return counts;
}
