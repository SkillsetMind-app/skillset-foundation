"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";
import { RotateCcw, X } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { cancelLessonUpload, dismissLessonUpload, getLessonUpload, getServerLessonUpload, lessonUploadIsBusy, retryLessonVideoConnection, setLessonUploadActor, startLessonUpload, subscribeLessonUpload, type LessonUpload } from "@/lib/data/lesson-upload";

type UploadContext = { actorId: string; job: LessonUpload | null };
const Context = createContext<UploadContext | null>(null);
export const useLessonUpload = () => useContext(Context);
export { startLessonUpload, cancelLessonUpload };

export function LessonUploadProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const actorId = user?.uid ?? null;
  const snapshot = useSyncExternalStore(subscribeLessonUpload, getLessonUpload, getServerLessonUpload);
  const job = snapshot?.actorId === actorId ? snapshot : null;
  useLayoutEffect(() => {
    setLessonUploadActor(actorId);
    return () => setLessonUploadActor(null);
  }, [actorId]);
  useEffect(() => {
    const { data } = getSupabaseBrowserClient().auth.onAuthStateChange((_event, session) => {
      setLessonUploadActor(session?.user.id ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!lessonUploadIsBusy(job)) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [job]);
  const href = job ? `/teach/builder?courseId=${encodeURIComponent(job.courseId)}&tab=content&module=${encodeURIComponent(job.moduleId)}&lesson=${encodeURIComponent(job.lessonId)}` : "";
  return (
    <Context.Provider value={actorId ? { actorId, job } : null}>
      {children}
      {job && (
        <aside aria-label={t("lessonUpload.title")} className="fixed bottom-4 left-4 z-[90] max-h-[calc(100svh-2rem)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4 text-[var(--color-ink)] shadow-lg">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-semibold">{job.fileName}</p>
              <p role={job.status === "error" ? "alert" : "status"} className="mt-1 text-sm">{t(`lessonUpload.${job.status}`)}</p>
            </div>
            {(!lessonUploadIsBusy(job) || (job.status === "uploading" && job.canCancel)) && (
              <button type="button" className="grid size-11 shrink-0 place-items-center" onClick={job.status === "uploading" ? cancelLessonUpload : dismissLessonUpload} aria-label={t(job.status === "uploading" ? "lessonUpload.cancel" : "lessonUpload.close")} title={t(job.status === "uploading" ? "lessonUpload.cancel" : "lessonUpload.close")}><X size={18} aria-hidden="true" /></button>
            )}
          </div>
          {job.status === "uploading" && <progress className="mt-2 w-full" max={100} value={job.progress?.percent ?? undefined} aria-label={t("lessonUpload.uploading")} />}
          <div className="mt-2 flex items-center justify-between gap-3">
            <Link className="inline-flex min-h-11 items-center text-sm underline" href={href}>{t("lessonUpload.open")}</Link>
            {job.status === "error" && job.assetId && <button type="button" className="inline-flex min-h-11 items-center gap-2 text-sm" onClick={() => void retryLessonVideoConnection()}><RotateCcw size={16} aria-hidden="true" />{t("lessonUpload.retry")}</button>}
          </div>
        </aside>
      )}
    </Context.Provider>
  );
}
