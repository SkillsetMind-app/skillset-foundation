"use client";

import { RouteError, type RouteErrorProps } from "@/components/shared/route-error";

// Erro dentro da área do aluno: o "Go home" volta aos cursos do aluno, não ao
// site público.
export default function LearnError(props: RouteErrorProps) {
  return <RouteError {...props} homeHref="/learn" boundary="learn" />;
}
