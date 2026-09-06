import type { CourseAssetKind } from "@/domain/course-asset";

// Only the presentation changes. Storage and validation keep the original kind.
export function getCourseAssetKindLabel(kind: CourseAssetKind, t: (key: string) => string): string {
  return t(`courseMedia.assetKinds.${kind}`);
}
