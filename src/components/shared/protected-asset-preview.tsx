"use client";

import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { WatermarkedVideoPlayer } from "@/components/learn/watermarked-video-player";
import { getCourseAssetTitle, type CourseAsset } from "@/domain/course-asset";
import { getProtectedCourseAssetObjectUrl } from "@/lib/data/course-assets";
import type { LessonPositionRef } from "@/lib/learn/lesson-position";

type ProtectedAssetPreviewProps = {
  asset: CourseAsset;
  onEnded?: () => void;
  resume?: LessonPositionRef | null;
};

export function ProtectedAssetPreview(props: ProtectedAssetPreviewProps) {
  const { asset } = props;
  return (
    <ProtectedAssetPreviewContent
      key={JSON.stringify([asset.id, asset.storagePath, asset.kind, asset.contentType])}
      {...props}
    />
  );
}

function releaseObjectUrl(url: string) {
  // Storage currently returns signed HTTPS URLs. Only browser blob URLs have
  // local resources to revoke; never treat the signed URL as public media.
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}

function ProtectedAssetPreviewContent({
  asset,
  onEnded,
  resume = null,
}: {
  asset: CourseAsset;
  onEnded?: () => void;
  resume?: LessonPositionRef | null;
}) {
  const { t } = useTranslation();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let nextObjectUrl: string | null = null;

    // await + try/catch instead of .then/.catch: a helper that throws (or
    // returns nothing) before producing a promise lands in the same error
    // state instead of crashing the render.
    void (async () => {
      try {
        const url = await getProtectedCourseAssetObjectUrl(asset);
        nextObjectUrl = url;

        if (isMounted) {
          setObjectUrl(url);
        } else {
          releaseObjectUrl(url);
        }
      } catch {
        if (isMounted) {
          setHasError(true);
        }
      }
    })();

    return () => {
      isMounted = false;

      if (nextObjectUrl) {
        releaseObjectUrl(nextObjectUrl);
      }
    };
  }, [asset]);

  if (hasError) {
    return (
      <p className="mt-3 rounded-md border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-3 py-2 text-sm font-semibold text-[var(--color-danger-fg)]">
        {t("courseMedia.preview.assetError")}
      </p>
    );
  }

  if (!objectUrl) {
    return (
      <p className="mt-3 rounded-md bg-white px-3 py-2 text-sm text-[var(--color-ink-soft)]">
        {t("courseMedia.preview.preparingAsset")}
      </p>
    );
  }

  if (asset.contentType.startsWith("video/")) {
    return (
      <WatermarkedVideoPlayer
        fileName={getCourseAssetTitle(asset)}
        onEnded={onEnded}
        resume={resume}
        src={objectUrl}
      />
    );
  }

  if (asset.contentType.startsWith("image/")) {
    return (
      <div className="mt-3 grid gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={objectUrl}
          alt={getCourseAssetTitle(asset)}
          className="max-h-72 w-full rounded-md object-cover"
        />
        <ProtectedAssetActions asset={asset} objectUrl={objectUrl} />
      </div>
    );
  }

  if (asset.contentType === "application/pdf") {
    return (
      <div className="mt-3 grid gap-3">
        <iframe
          src={objectUrl}
          title={getCourseAssetTitle(asset)}
          className="h-80 w-full rounded-md border border-[var(--color-line)] bg-white"
        />
        <ProtectedAssetActions asset={asset} objectUrl={objectUrl} />
      </div>
    );
  }

  return <ProtectedAssetActions asset={asset} objectUrl={objectUrl} />;
}

function ProtectedAssetActions({
  asset,
  objectUrl,
}: {
  asset: CourseAsset;
  objectUrl: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <a
        href={objectUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="button-outline px-4 py-2 text-xs"
      >
        {t("courseMedia.preview.openFile")}
      </a>
      <ProtectedAssetDownload asset={asset} className="button-solid px-4 py-2 text-xs" />
    </div>
  );
}

/**
 * Botão que baixa de verdade. O link de abrir não serve: o `download` de um
 * <a> é ignorado para outro domínio, e o arquivo só abria numa aba. Este pede
 * um link assinado próprio, com o nome original do arquivo (1 hora, mesma RLS
 * de matrícula e aula liberada).
 *
 * O link é pedido NO CLIQUE: abrir a aba Materiais não faz um pedido por
 * arquivo, e um link pedido há mais de 1 hora (aba esquecida aberta) não
 * chega vencido ao aluno.
 */
export function ProtectedAssetDownload({
  asset,
  className,
  label,
}: {
  asset: CourseAsset;
  className: string;
  /** Nome acessível quando há vários botões na tela ("Download Apostila"). */
  label?: string;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const loading = state === "loading";

  async function download() {
    if (loading) return;
    setState("loading");
    try {
      const url = await getProtectedCourseAssetObjectUrl(asset, { download: true });
      // A resposta vem como anexo: o navegador baixa e a página fica onde está.
      const link = document.createElement("a");
      link.href = url;
      document.body.append(link);
      link.click();
      link.remove();
      setState("idle");
    } catch {
      setState("failed");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void download()}
        aria-label={label}
        aria-busy={loading}
        aria-disabled={loading}
        className={loading ? `${className} opacity-60` : className}
      >
        {loading ? (
          <Loader2 aria-hidden="true" size={16} className="animate-spin" />
        ) : (
          <Download aria-hidden="true" size={16} />
        )}
        {t("courseMedia.preview.download")}
      </button>
      {state === "failed" ? (
        <p role="alert" className="basis-full text-sm font-semibold text-[var(--color-danger-fg)]">
          {t("courseMedia.preview.assetError")}
        </p>
      ) : null}
    </>
  );
}
