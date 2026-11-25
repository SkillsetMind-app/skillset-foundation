"use client";

import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { WatermarkedVideoPlayer } from "@/components/learn/watermarked-video-player";
import { InlineAlert } from "@/components/ui/inline-alert";
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
      <InlineAlert tone="error" className="mt-3 px-3 py-2">{t("courseMedia.preview.assetError")}</InlineAlert>
    );
  }

  if (!objectUrl) {
    // Video: the same 16:9 box as the classroom wait, with only the ring (the text stays
    // for the screen reader). It used to be a white pill inside the dark stage, which
    // later became the whole video. Outside the classroom (teacher preview) the box
    // brings its own dark background (globals.css, .protected-asset-loading).
    // Other files: one row with the ring, without a pill.
    if (asset.contentType.startsWith("video/")) {
      return (
        <div className="member-video-empty member-video-empty--loading protected-asset-loading" role="status">
          <Loader2 size={32} aria-hidden className="motion-safe:animate-spin" />
          <span className="sr-only">{t("courseMedia.preview.preparingAsset")}</span>
        </div>
      );
    }
    return (
      <p role="status" className="mt-3 inline-flex items-center gap-2 text-sm text-[var(--color-ink-soft)]">
        <Loader2 size={16} aria-hidden className="motion-safe:animate-spin" />
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
 * A button that really downloads. The open link will not do: the `download` of an
 * <a> is ignored for another domain, and the file only opened in a tab. This one asks for
 * its own signed link, with the file's original name (1 hour, same enrollment
 * and unlocked-lesson RLS).
 *
 * The link is requested ON CLICK: opening the Materials tab does not make a request per
 * file, and a link requested more than 1 hour ago (tab left open) does not
 * reach the learner expired.
 */
export function ProtectedAssetDownload({
  asset,
  className,
  label,
}: {
  asset: CourseAsset;
  className: string;
  /** Accessible name when there are several buttons on the screen ("Download Apostila"). */
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
      // The response comes as an attachment: the browser downloads and the page stays where it is.
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
          <Loader2 aria-hidden="true" size={16} className="motion-safe:animate-spin" />
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
