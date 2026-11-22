"use client";

import { RouteError } from "@/components/shared/route-error";

// Erro dentro da área do aluno: o "Go home" volta aos cursos do aluno, não ao
// site público.
export default function LearnError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} homeHref="/learn" boundary="learn" />;
}
