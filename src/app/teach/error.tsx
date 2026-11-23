"use client";

import { RouteError, type RouteErrorProps } from "@/components/shared/route-error";

// Erro dentro do estúdio do professor: o "Go home" volta ao estúdio, não ao
// site público.
export default function TeachError(props: RouteErrorProps) {
  return <RouteError {...props} homeHref="/teach" boundary="teach" />;
}
