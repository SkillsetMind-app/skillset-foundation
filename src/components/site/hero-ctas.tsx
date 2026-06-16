"use client";

import { ArrowRight, LayoutDashboard } from "lucide-react";
import Link from "next/link";

import { useAuth } from "@/components/auth/auth-provider";
import { getPrimaryWorkspaceHref } from "@/lib/auth/routing";

// Client island inside the (server-rendered) marketing hero. Guests and
// still-loading sessions see the conversion CTAs; a signed-in visitor instead
// gets a direct path to their workspace so they're never stranded on the home
// page.
export function HeroCtas() {
  const { status, user } = useAuth();

  if (status === "authenticated" && user) {
    return (
      <div className="flex flex-wrap justify-center gap-3 lg:justify-start">
        <Link
          href={getPrimaryWorkspaceHref(user)}
          className="button-solid-light"
        >
          <LayoutDashboard aria-hidden="true" size={16} strokeWidth={1.9} />
          Go to your dashboard
        </Link>
        <Link href="/courses" className="button-outline-light">
          Browse courses
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap justify-center gap-3 lg:justify-start">
      <Link
        href="/auth?mode=signup&path=teacher"
        className="button-solid-light group"
      >
        Start teaching free
        <ArrowRight
          aria-hidden="true"
          size={16}
          strokeWidth={2}
          className="transition-transform duration-200 group-hover:translate-x-0.5"
        />
      </Link>
      <Link href="/pricing" className="button-outline-light">
        See how you get paid
      </Link>
    </div>
  );
}
