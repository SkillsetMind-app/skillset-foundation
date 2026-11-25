"use client";

import { RouteError, type RouteErrorProps } from "@/components/shared/route-error";

// Error inside the learner area: "Go home" goes back to the learner's courses,
// not to the public site.
export default function LearnError(props: RouteErrorProps) {
  return <RouteError {...props} homeHref="/learn" boundary="learn" />;
}
