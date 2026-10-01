"use client";

import { Suspense, useEffect, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { captureEvent, initPostHog } from "@/lib/posthog/client";

export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    initPostHog();
  }, []);

  return (
    <>
      <Suspense fallback={null}>
        <PostHogPageviewTracker />
      </Suspense>
      {children}
    </>
  );
}

function PostHogPageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    const search = searchParams?.toString();
    const url = search ? `${pathname}?${search}` : pathname;
    captureEvent("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}
