import { NextResponse } from "next/server";

import { captionLanguageName, isCaptionLanguage } from "@/domain/caption-languages";
import { AudioExtractError } from "@/lib/ai/audio";
import { transcribeLessonVideo, translateVtt } from "@/lib/ai/captions";
import { cleanQuiz, generateQuiz, suggestTitleAndDescription } from "@/lib/ai/lesson-text";
import { OpenAIConfigError, OpenAIError } from "@/lib/ai/openai";
import { MAX_VTT_CHARS, buildVtt, parseVtt, vttToText } from "@/lib/ai/vtt";
import {
  BunnyVideoNotFoundError,
  bunnyLowestMp4Url,
  deleteBunnyCaption,
  getBunnyVideoStatus,
  hasValidBunnyAssetPath,
  putBunnyCaption,
} from "@/lib/bunny/server";
import { assertCreatorActivated, enforceRateLimit, paymentErrorResponse } from "@/lib/payments/server/auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// /api/teach/ai — ferramentas de IA do estúdio da aula (só o dono do curso).
//   GET  ?courseId&lessonId[&assetId]  legendas e quiz da aula + uso do mês
//   POST { action, courseId, lessonId, ... }
//     transcribe      gera a legenda (rascunho) a partir do vídeo da Bunny
//     saveCaption     grava o texto revisado pelo professor
//     publishCaption  sobe a legenda para a Bunny (o aluno vê no player)
//     removeCaption   tira da Bunny e apaga
//     translate       traduz uma legenda existente para outro idioma (rascunho)
//     generateQuiz    quiz a partir da transcrição (rascunho)
//     saveQuiz        grava o quiz editado; publish=true mostra ao aluno
//     removeQuiz      apaga o quiz
//     suggest         3 títulos e 3 descrições para a aula ou o módulo (nada é gravado)
//
// Ordem dos portões, a mesma do conselheiro: sessão, papel de professor,
// ativação, limite de pedidos, dono do curso. Tudo antes de gastar IA.
// As tabelas novas só aceitam service_role: a rota confere o dono e grava.

export const runtime = "nodejs";
// A transcrição de uma aula longa leva ~1 a 2 minutos (ffmpeg + Whisper em
// paralelo). O teto da plataforma fica alto e o nosso prazo decide antes.
export const maxDuration = 300;
const WORK_DEADLINE_MS = 270_000;

// Aula mais longa que a ferramenta aceita. Também é o teto por linha em ai_usage.
const MAX_LESSON_SECONDS = 2 * 60 * 60;
// Bunny "Finished": o MP4 de 240p só existe depois da codificação.
const BUNNY_FINISHED = 4;
// A CDN da biblioteca recusa pedido sem Referer.
const CDN_REFERER = "https://skillsetmind.com/";

type CaptionRow = {
  language: string;
  vtt: string;
  video_id: string;
  updated_at: string;
  published_at: string | null;
};

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function fail(status: number, code: string, error: string, extra?: Record<string, unknown>) {
  return reply({ error, code, ...extra }, status);
}

function lessonExists(modules: unknown, lessonId: string): boolean {
  if (!Array.isArray(modules)) return false;
  return modules.some((module) =>
    Array.isArray((module as { lessons?: unknown })?.lessons)
    && (module as { lessons: { id?: unknown }[] }).lessons.some((lesson) => lesson?.id === lessonId),
  );
}

function captionView(row: CaptionRow, currentVideoId: string | null) {
  return {
    language: row.language,
    vtt: row.vtt,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    // Feita para outro vídeo (o professor trocou o vídeo da aula).
    stale: currentVideoId !== null && row.video_id !== currentVideoId,
  };
}

async function usageOf(uid: string) {
  const { data, error } = await getSupabaseAdminClient().rpc("ai_video_usage", { p_uid: uid });
  if (error || !data?.[0]) throw new Error("usage_unavailable");
  return { usedSeconds: data[0].used_seconds, limitSeconds: data[0].limit_seconds };
}

type Gate = {
  uid: string;
  courseId: string;
  lessonId: string;
  modules: unknown;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
};

async function openGate(courseId: unknown, lessonId: unknown, rateKey: string): Promise<Gate | NextResponse> {
  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return fail(401, "unauthenticated", "You must be signed in.");
  const uid = auth.user.id;

  const { data: isTeacher, error: roleError } = await supabase.rpc("is_teacher");
  if (roleError || !isTeacher) return fail(403, "forbidden", "Teacher access is required.");

  try {
    await assertCreatorActivated();
    await enforceRateLimit(`${rateKey}_${uid}`, rateKey === "teach_ai_read" ? 600 : 120, 3_600_000);
  } catch (error) {
    return paymentErrorResponse(error);
  }

  if (typeof courseId !== "string" || !courseId || typeof lessonId !== "string" || !lessonId) {
    return fail(400, "bad_request", "Missing course or lesson.");
  }
  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("id, modules")
    .eq("id", courseId)
    .eq("owner_id", uid)
    .maybeSingle();
  if (courseError) return fail(503, "unavailable", "Could not load the course. Please try again.");
  if (!course) return fail(403, "forbidden", "You do not own this course.");
  if (!lessonExists(course.modules, lessonId)) return fail(404, "lesson_not_found", "Lesson not found.");

  return { uid, courseId, lessonId, modules: course.modules, supabase };
}

// O vídeo da Bunny da aula, só se o asset é desta aula e o recibo do servidor
// confere (course_assets é gravável pelo browser).
async function lessonVideoId(gate: Gate, assetId: unknown): Promise<string | null> {
  if (typeof assetId !== "string" || !assetId) return null;
  const { data: asset } = await gate.supabase
    .from("course_assets")
    .select("course_id, lesson_id, bunny_video_id, storage_path")
    .eq("id", assetId)
    .maybeSingle();
  if (!asset?.bunny_video_id || asset.course_id !== gate.courseId || asset.lesson_id !== gate.lessonId) return null;
  return hasValidBunnyAssetPath(gate.courseId, gate.uid, asset.bunny_video_id, asset.storage_path)
    ? asset.bunny_video_id
    : null;
}

async function loadCaption(gate: Gate, language: string): Promise<CaptionRow | null> {
  const { data, error } = await getSupabaseAdminClient()
    .from("lesson_captions")
    .select("language, vtt, video_id, updated_at, published_at")
    .eq("lesson_id", gate.lessonId)
    .eq("course_id", gate.courseId)
    .eq("language", language)
    .maybeSingle();
  if (error) throw new Error("caption_unavailable");
  return data;
}

// Texto que o professor mandou: normalizado pelo parser (o que vai para a
// Bunny é sempre um WebVTT limpo).
function normalizedVtt(vtt: unknown): string | null {
  if (typeof vtt !== "string" || vtt.length > MAX_VTT_CHARS) return null;
  try {
    const clean = buildVtt(parseVtt(vtt));
    return clean.length <= MAX_VTT_CHARS ? clean : null;
  } catch {
    return null;
  }
}

async function loadQuiz(gate: Gate) {
  const { data, error } = await getSupabaseAdminClient()
    .from("lesson_quizzes")
    .select("questions, status, updated_at")
    .eq("lesson_id", gate.lessonId)
    .eq("course_id", gate.courseId)
    .maybeSingle();
  if (error) throw new Error("quiz_unavailable");
  return data ? { questions: data.questions, status: data.status, updatedAt: data.updated_at } : null;
}

// Transcrição da aula: o texto da legenda do vídeo atual no idioma que o
// professor diz ser o falado (o seletor da tela); sem ela, qualquer uma.
async function lessonTranscript(gate: Gate, assetId: unknown, language: unknown): Promise<string | null> {
  const videoId = await lessonVideoId(gate, assetId);
  if (!videoId) return null;
  const { data, error } = await getSupabaseAdminClient()
    .from("lesson_captions")
    .select("language, vtt")
    .eq("lesson_id", gate.lessonId)
    .eq("course_id", gate.courseId)
    .eq("video_id", videoId)
    .order("language");
  if (error) throw new Error("caption_unavailable");
  const pick = data?.find((row) => row.language === language) ?? data?.[0];
  return pick ? vttToText(pick.vtt) : null;
}

// Material de um módulo: título e começo da transcrição de cada aula dele.
async function moduleMaterial(gate: Gate, moduleId: unknown): Promise<string | null> {
  const modules = Array.isArray(gate.modules)
    ? (gate.modules as { id?: unknown; lessons?: unknown }[])
    : [];
  const target = modules.find((module) => module?.id === moduleId);
  const lessons = Array.isArray(target?.lessons) ? (target.lessons as { id?: unknown; title?: unknown }[]) : [];
  const ids = lessons.map((lesson) => lesson?.id).filter((id): id is string => typeof id === "string");
  if (ids.length === 0) return null;
  const { data, error } = await getSupabaseAdminClient()
    .from("lesson_captions")
    .select("lesson_id, vtt")
    .eq("course_id", gate.courseId)
    .in("lesson_id", ids);
  if (error) throw new Error("caption_unavailable");
  const textOf = new Map<string, string>();
  for (const row of data ?? []) {
    if (textOf.has(row.lesson_id)) continue;
    try {
      textOf.set(row.lesson_id, vttToText(row.vtt).slice(0, 3000));
    } catch {
      // legenda ilegível: a aula entra só com o título
    }
  }
  if (textOf.size === 0) return null;
  return lessons
    .map((lesson) => `Lesson: ${typeof lesson?.title === "string" ? lesson.title : ""}\n${textOf.get(String(lesson?.id)) ?? ""}`)
    .join("\n\n");
}

function aiFailure(error: unknown) {
  if (error instanceof OpenAIConfigError || (error instanceof OpenAIError && error.code === "no_credit")) {
    // Sem chave ou sem saldo é problema nosso, não do professor.
    console.error("teacher_ai_unavailable", error instanceof OpenAIError ? error.code : "not_configured");
    return fail(503, "ai_unavailable", "AI tools are temporarily unavailable. Please try again later.");
  }
  if (error instanceof AudioExtractError) {
    console.error("teacher_ai_audio_failed", error.message);
    return fail(502, "audio_unavailable", "We couldn't read this video's audio. Try again in a few minutes.");
  }
  if ((error as Error)?.message === "vtt_empty") {
    return fail(422, "no_speech", "We couldn't hear any speech in this video.");
  }
  if ((error as Error)?.message === "quiz_empty" || (error as Error)?.message === "suggest_empty") {
    return fail(422, "nothing_usable", "The AI didn't write anything usable this time. Try again, or write your own.");
  }
  console.error("teacher_ai_failed", (error as Error)?.message?.slice(0, 200));
  return fail(502, "ai_failed", "The AI could not finish. Please try again.");
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const gate = await openGate(params.get("courseId"), params.get("lessonId"), "teach_ai_read");
  if (gate instanceof NextResponse) return gate;

  try {
    const [videoId, captions, quiz, usage] = await Promise.all([
      lessonVideoId(gate, params.get("assetId")),
      getSupabaseAdminClient()
        .from("lesson_captions")
        .select("language, vtt, video_id, updated_at, published_at")
        .eq("lesson_id", gate.lessonId)
        .eq("course_id", gate.courseId)
        .order("language"),
      loadQuiz(gate),
      usageOf(gate.uid),
    ]);
    if (captions.error) throw new Error("caption_unavailable");
    return reply({ captions: (captions.data ?? []).map((row) => captionView(row, videoId)), quiz, usage });
  } catch {
    return fail(503, "unavailable", "Could not load AI tools. Please try again.");
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return fail(400, "bad_request", "Invalid request body.");
  }
  const action = body.action;
  const gate = await openGate(body.courseId, body.lessonId, "teach_ai");
  if (gate instanceof NextResponse) return gate;
  const admin = getSupabaseAdminClient();

  if (action === "transcribe") {
    if (!isCaptionLanguage(body.language)) return fail(400, "bad_language", "Choose the language spoken in the video.");
    const language = body.language;
    const videoId = await lessonVideoId(gate, body.assetId);
    if (!videoId) return fail(404, "no_video", "This lesson has no uploaded video.");

    let seconds: number;
    try {
      const status = await getBunnyVideoStatus(videoId);
      if (status.status !== BUNNY_FINISHED || !status.lengthSeconds) {
        return fail(409, "video_processing", "The video is still processing. Try again when it's ready.");
      }
      seconds = Math.ceil(status.lengthSeconds);
    } catch (error) {
      if (error instanceof BunnyVideoNotFoundError) return fail(404, "no_video", "This lesson has no uploaded video.");
      return fail(503, "unavailable", "Video host unavailable. Please try again.");
    }
    if (seconds > MAX_LESSON_SECONDS) {
      return fail(422, "too_long", "Captions work on videos up to 2 hours long.");
    }

    const { data: claim, error: claimError } = await admin.rpc("claim_ai_video_seconds", {
      p_uid: gate.uid,
      p_course_id: gate.courseId,
      p_lesson_id: gate.lessonId,
      p_seconds: seconds,
    });
    if (claimError || !claim?.[0]) return fail(503, "unavailable", "Could not check your AI hours. Please try again.");
    const { usage_id: usageId, used_seconds: usedSeconds, limit_seconds: limitSeconds } = claim[0];
    if (usageId === null) {
      return fail(429, "monthly_limit", "This video needs more AI hours than your plan has left this month.", {
        usage: { usedSeconds, limitSeconds },
        neededSeconds: seconds,
      });
    }

    try {
      // Legenda publicada para OUTRO vídeo não vale para este (a Bunny guarda
      // legenda por vídeo): volta a ser rascunho. Mesmo vídeo: a publicada
      // continua no player até o professor publicar a nova.
      const previous = await loadCaption(gate, language);
      const vtt = await transcribeLessonVideo({
        videoUrl: bunnyLowestMp4Url(videoId),
        referer: CDN_REFERER,
        language,
        deadline: AbortSignal.timeout(WORK_DEADLINE_MS),
      });
      const now = new Date().toISOString();
      const { data: saved, error: saveError } = await admin
        .from("lesson_captions")
        .upsert({
          lesson_id: gate.lessonId,
          language,
          course_id: gate.courseId,
          owner_id: gate.uid,
          video_id: videoId,
          vtt,
          updated_at: now,
          ...(previous && previous.video_id !== videoId ? { published_at: null } : {}),
        })
        .select("language, vtt, video_id, updated_at, published_at")
        .single();
      if (saveError || !saved) throw new Error("caption_save_failed");
      return reply({ caption: captionView(saved, videoId), usage: { usedSeconds, limitSeconds } });
    } catch (error) {
      // Não saiu legenda: o tempo volta para o saldo do mês.
      await admin.from("ai_usage").delete().eq("id", usageId);
      return aiFailure(error);
    }
  }

  if (action === "saveCaption") {
    if (!isCaptionLanguage(body.language)) return fail(400, "bad_language", "Unknown language.");
    const vtt = normalizedVtt(body.vtt);
    if (!vtt) return fail(422, "bad_vtt", "The captions have a formatting error. Check the timing lines and try again.");
    const { data, error } = await admin
      .from("lesson_captions")
      .update({ vtt, updated_at: new Date().toISOString() })
      .eq("lesson_id", gate.lessonId)
      .eq("course_id", gate.courseId)
      .eq("language", body.language)
      .select("language, vtt, video_id, updated_at, published_at")
      .maybeSingle();
    if (error) return fail(503, "unavailable", "Could not save. Please try again.");
    if (!data) return fail(404, "no_caption", "These captions no longer exist.");
    return reply({ caption: captionView(data, null) });
  }

  if (action === "publishCaption" || action === "removeCaption") {
    if (!isCaptionLanguage(body.language)) return fail(400, "bad_language", "Unknown language.");
    const language = body.language;
    let caption: CaptionRow | null;
    try {
      caption = await loadCaption(gate, language);
    } catch {
      return fail(503, "unavailable", "Could not load the captions. Please try again.");
    }
    if (!caption) return fail(404, "no_caption", "These captions no longer exist.");

    if (action === "removeCaption") {
      try {
        if (caption.published_at) await deleteBunnyCaption(caption.video_id, language);
      } catch {
        return fail(503, "unavailable", "Video host unavailable. Please try again.");
      }
      await admin.from("lesson_captions").delete()
        .eq("lesson_id", gate.lessonId).eq("course_id", gate.courseId).eq("language", language);
      return reply({ removed: language });
    }

    const videoId = await lessonVideoId(gate, body.assetId);
    if (!videoId || videoId !== caption.video_id) {
      return fail(409, "stale_caption", "These captions were made for a different video. Generate them again.");
    }
    try {
      await putBunnyCaption(videoId, language, captionLanguageName(language), caption.vtt);
    } catch {
      return fail(503, "unavailable", "Video host unavailable. Please try again.");
    }
    const { data, error } = await admin
      .from("lesson_captions")
      .update({ published_at: new Date().toISOString() })
      .eq("lesson_id", gate.lessonId)
      .eq("course_id", gate.courseId)
      .eq("language", language)
      .select("language, vtt, video_id, updated_at, published_at")
      .maybeSingle();
    if (error || !data) return fail(503, "unavailable", "Published, but could not record it. Refresh to check.");
    return reply({ caption: captionView(data, videoId) });
  }

  if (action === "translate") {
    if (!isCaptionLanguage(body.from) || !isCaptionLanguage(body.to) || body.from === body.to) {
      return fail(400, "bad_language", "Choose a different language to translate to.");
    }
    const { from, to } = body;
    try {
      // Teto diário de pedidos de texto: cada um depende de uma legenda que já
      // gastou do teto mensal, então isto só segura repetição em laço.
      await enforceRateLimit(`teach_ai_text_daily_${gate.uid}`, 40, 86_400_000);
    } catch (error) {
      return paymentErrorResponse(error);
    }
    let source: CaptionRow | null;
    try {
      source = await loadCaption(gate, from);
    } catch {
      return fail(503, "unavailable", "Could not load the captions. Please try again.");
    }
    if (!source) return fail(404, "no_caption", "Generate the captions first.");
    // Traduzir legenda de um vídeo que já saiu da aula gastaria IA à toa: a
    // tradução nasceria velha e não poderia ser publicada.
    if (source.video_id !== (await lessonVideoId(gate, body.assetId))) {
      return fail(409, "stale_caption", "These captions were made for a different video. Generate them again.");
    }

    try {
      const previous = await loadCaption(gate, to);
      const vtt = await translateVtt({ vtt: source.vtt, from, to, deadline: AbortSignal.timeout(WORK_DEADLINE_MS) });
      const { data, error } = await admin
        .from("lesson_captions")
        .upsert({
          lesson_id: gate.lessonId,
          language: to,
          course_id: gate.courseId,
          owner_id: gate.uid,
          video_id: source.video_id,
          vtt,
          updated_at: new Date().toISOString(),
          ...(previous && previous.video_id !== source.video_id ? { published_at: null } : {}),
        })
        .select("language, vtt, video_id, updated_at, published_at")
        .single();
      if (error || !data) throw new Error("caption_save_failed");
      return reply({ caption: captionView(data, null) });
    } catch (error) {
      return aiFailure(error);
    }
  }

  if (action === "generateQuiz" || action === "suggest") {
    try {
      await enforceRateLimit(`teach_ai_text_daily_${gate.uid}`, 40, 86_400_000);
    } catch (error) {
      return paymentErrorResponse(error);
    }
    const forModule = action === "suggest" && body.target === "module";
    let material: string | null;
    try {
      material = forModule
        ? await moduleMaterial(gate, body.moduleId)
        : await lessonTranscript(gate, body.assetId, body.language);
    } catch {
      return fail(503, "unavailable", "Could not load the lesson. Please try again.");
    }
    if (!material?.trim()) {
      return fail(404, "no_transcript", forModule
        ? "Generate captions for this module's lessons first."
        : "Generate captions for this lesson first.");
    }

    try {
      const deadline = AbortSignal.timeout(WORK_DEADLINE_MS);
      if (action === "suggest") {
        return reply({ suggestions: await suggestTitleAndDescription(forModule ? "module" : "lesson", material, deadline) });
      }
      const questions = await generateQuiz(material, deadline);
      const { data, error } = await admin
        .from("lesson_quizzes")
        .upsert({
          lesson_id: gate.lessonId,
          course_id: gate.courseId,
          owner_id: gate.uid,
          questions,
          status: "draft",
          updated_at: new Date().toISOString(),
        })
        .select("questions, status, updated_at")
        .single();
      if (error || !data) throw new Error("quiz_save_failed");
      return reply({ quiz: { questions: data.questions, status: data.status, updatedAt: data.updated_at } });
    } catch (error) {
      return aiFailure(error);
    }
  }

  if (action === "saveQuiz") {
    let questions;
    try {
      questions = cleanQuiz(body.questions);
    } catch {
      return fail(422, "bad_quiz", "Each question needs text, 2 to 5 different options, one correct answer and an explanation.");
    }
    const { data, error } = await admin
      .from("lesson_quizzes")
      .upsert({
        lesson_id: gate.lessonId,
        course_id: gate.courseId,
        owner_id: gate.uid,
        questions,
        status: body.publish === true ? "published" : "draft",
        updated_at: new Date().toISOString(),
      })
      .select("questions, status, updated_at")
      .single();
    if (error || !data) return fail(503, "unavailable", "Could not save. Please try again.");
    return reply({ quiz: { questions: data.questions, status: data.status, updatedAt: data.updated_at } });
  }

  if (action === "removeQuiz") {
    const { error } = await admin.from("lesson_quizzes").delete()
      .eq("lesson_id", gate.lessonId).eq("course_id", gate.courseId);
    if (error) return fail(503, "unavailable", "Could not remove. Please try again.");
    return reply({ quiz: null });
  }

  return fail(400, "bad_action", "Unknown action.");
}
