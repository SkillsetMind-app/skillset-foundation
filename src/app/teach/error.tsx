"use client";

import { RouteError } from "@/components/shared/route-error";

// Erro dentro do estúdio do professor: o "Go home" volta ao estúdio, não ao
// site público.
export default function TeachError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} homeHref="/teach" boundary="teach" />;
}
