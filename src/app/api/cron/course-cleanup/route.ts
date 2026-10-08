import { NextResponse } from "next/server";

import { deleteBunnyVideo, hasValidBunnyAssetPath } from "@/lib/bunny/server";
import { isCronRequest } from "@/lib/cron/authorized";
import { sendOpsAlert } from "@/lib/ops/alert";
import type { Database, Json } from "@/lib/supabase/database.types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

// GET /api/cron/course-cleanup — apaga os arquivos (Storage) e os videos
// (Bunny) de produto apagado. A fila (course_deletions) so ganha linha quando
// o DELETE do curso fez commit (gatilho em courses, migration 20261008030000);
// esta rota so le a fila.
//
// ENSAIO por padrao: sem COURSE_CLEANUP_LIVE=1 nada e apagado e nada muda no
// banco; a resposta e o log dizem quantos arquivos e videos SERIAM apagados,
// com `due` (ja passou um dia). O ensaio olha do mais novo para o mais antigo:
// o produto de teste que acabou de ser apagado aparece mesmo com fila cheia.
// A mesma variavel e a chave de desligar.
//
// Travas, nesta ordem:
//   - so pedidos `pending` com mais de um dia (Bunny nao tem backup; o dia da
//     margem para a equipe cancelar um "apaguei o produto errado");
//   - arquivos: o banco lista so `courses/<id>/` (barra final inclusa) dos
//     dois baldes, so o que nasceu enquanto o curso existia, recusa id
//     perigoso ou reaproveitado, e marca `in_use` o que outra linha viva cita
//     (esses ficam); aqui a conta da pasta e refeita antes de cada remove;
//   - video: so com recibo valido deste curso e deste dono (HMAC de
//     src/lib/bunny/server.ts), e o banco confirma LOGO ANTES de cada DELETE
//     que a fila segue pending, que o id nao voltou e que ninguem cita o video;
//   - tempo: cerca de 40 s por volta. Estourou no meio de um produto: o que ja
//     saiu fica salvo (video apagado sai da fila) e a proxima hora continua,
//     sem gastar tentativa. Tres voltas seguidas sem apagar nada = 1 tentativa;
//   - falhou: conta tentativa e tenta de novo na proxima hora; na 5a vira
//     `failed` e sai um alerta para a equipe (src/lib/ops/alert.ts). Alerta que
//     nao chegou = 500, e o GitHub Actions fica vermelho.
// Log e resposta levam contagens e ids de curso, nunca chave nem nome de arquivo.
//
// Chamado de hora em hora por .github/workflows/stripe-attention.yml (o plano
// da Vercel so agenda uma vez por dia).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const GRACE_MS = 24 * 60 * 60 * 1000; // ponytail: janela fixa; env so se a equipe pedir
const MAX_JOBS = 5;
const MAX_ATTEMPTS = 5;
const STALLED_RUNS_PER_ATTEMPT = 3;
// Abaixo dos 60 s da Vercel com folga para a ultima chamada (8 s na Bunny).
const BUDGET_MS = 40_000;
const CHUNK = 100;
const BUCKETS = ["public-media", "course-content"] as const;
// Cada RPC tem freio proprio: o de 40 s so e conferido ENTRE chamadas, e uma
// consulta lenta passaria dos 60 s da Vercel sem contar tentativa nem alertar.
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
  // Ao vivo, o mais antigo primeiro; no ensaio, o mais novo (ver o topo).
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

// Toda escrita exige a linha ainda pending: um `cancelled` da equipe no meio
// da volta nunca e desfeito por aqui.
async function saveRow(admin: Admin, courseId: string, patch: QueuePatch) {
  const { error } = await admin
    .from("course_deletions")
    .update(patch)
    .eq("course_id", courseId)
    .eq("status", "pending");
  return error;
}

// Uma tentativa a mais. Na 5a: `failed` e um alerta. Devolve true se o alerta
// nao chegou a ninguem.
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

// O tempo acabou no meio do produto: nao e falha. Com progresso, so a hora;
// sem progresso, conta a volta parada, e 3 seguidas viram uma tentativa.
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

// Lista os arquivos da pasta do curso pelo banco, e refaz a conta da pasta
// aqui: uma linha fora de `courses/<id>/` ou de outro balde nunca chega ao
// remove. Arquivo que outra linha viva cita (`in_use`) fica.
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
  // Videos: so com recibo deste curso e deste dono. Sem recibo nunca sai, e
  // fica listado no resultado da linha (nao some calado num `done`).
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
    // O PostgREST devolve no maximo ~1000 linhas por chamada: pasta grande sai
    // em varias voltas. Falha e so o arquivo que foi mandado apagar e continua
    // listado. Sobrou arquivo que nao estava no lote = progresso salvo, e a
    // proxima hora continua.
    // ponytail: se as ~1000 primeiras linhas forem todas in_use, a pasta vira
    // done com arquivos depois delas. Teto conhecido; paginar a RPC se aparecer.
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
    // Logo antes de CADA DELETE, nao uma vez no comeco: o id pode ter voltado,
    // a equipe pode ter cancelado, outra aula pode ter passado a usar o video.
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
    // Progresso salvo: o video sai da fila e a proxima volta nao o chama de novo.
    remaining = remaining.filter((asset) => (asset as { videoId?: unknown } | null)?.videoId !== videoId);
    const saveError = await saveRow(admin, job.course_id, {
      bunny_assets: remaining,
      last_progress_at: new Date().toISOString(),
    });
    if (saveError) throw new Error(`save progress: ${saveError.message}`);
  }
  if (!live) return { counts, done: false, progressed };

  // Fica so id e contagens: o nome do produto sai da linha.
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
