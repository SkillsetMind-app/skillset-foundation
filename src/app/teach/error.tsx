"use client";

import { RouteError, type RouteErrorProps } from "@/components/shared/route-error";

// Error inside the teacher's studio: "Go home" goes back to the studio, not to the
// public site.
export default function TeachError(props: RouteErrorProps) {
  return <RouteError {...props} homeHref="/teach" boundary="teach" />;
}
