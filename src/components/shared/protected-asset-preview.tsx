"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { WatermarkedVideoPlayer } from "@/components/learn/watermarked-video-player";
import type { CourseAsset } from "@/domain/course-asset";
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

    getProtectedCourseAssetObjectUrl(asset)
      .then((url) => {
        nextObjectUrl = url;

        if (isMounted) {
          setObjectUrl(url);
        } else {
          releaseObjectUrl(url);
        }
      })
      .catch(() => {
        if (isMounted) {
          setHasError(true);
        }
      });

    return () => {
      isMounted = false;

      if (nextObjectUrl) {
        releaseObjectUrl(nextObjectUrl);
      }
    };
  }, [asset]);

  if (hasError) {
    return (
      <p className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-3 py-2 text-sm font-semibold text-[var(--color-danger-fg)]">
        {t("courseMedia.preview.assetError")}
      </p>
    );
  }

  if (!objectUrl) {
    return (
      <p className="mt-3 rounded-[10px] bg-white px-3 py-2 text-sm text-[var(--color-ink-soft)]">
        {t("courseMedia.preview.preparingAsset")}
      </p>
    );
  }

  if (asset.contentType.startsWith("video/")) {
    return (
      <WatermarkedVideoPlayer
        fileName={asset.fileName}
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
          alt={asset.fileName}
          className="max-h-72 w-full rounded-[10px] object-cover"
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
          title={asset.fileName}
          className="h-80 w-full rounded-[10px] border border-[var(--color-line)] bg-white"
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
      <a
        href={objectUrl}
        download={asset.fileName}
        className="button-solid px-4 py-2 text-xs"
      >
        {t("courseMedia.preview.download")}
      </a>
    </div>
  );
}
