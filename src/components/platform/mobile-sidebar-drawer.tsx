"use client";

import {
  GraduationCap,
  Home,
  MoreHorizontal,
  Presentation,
  ShoppingBag,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PlatformNav } from "@/components/platform/platform-nav";
import { SessionCard } from "@/components/platform/session-card";
import { LogoWordmark } from "@/components/shared/logo-wordmark";

type MobileSidebarDrawerProps = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
};

export function MobileSidebarDrawer({
  open,
  onOpen,
  onClose,
}: MobileSidebarDrawerProps) {
  const { user } = useAuth();
  const pathname = usePathname() ?? "";
  const touchStartX = useRef<number | null>(null);
  const workspaceItem = useMemo(() => {
    const isTeacher = user?.roles.includes("teacher");

    return isTeacher
      ? { href: "/teach", label: "Teach", icon: Presentation }
      : { href: "/learn", label: "Learn", icon: GraduationCap };
  }, [user?.roles]);
  const primaryItems = [
    { href: "/platform", label: "Home", icon: Home },
    { href: "/courses", label: "Market", icon: ShoppingBag },
    workspaceItem,
    { href: "/account", label: "Profile", icon: User },
  ];

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  return (
    <>
      <nav className="platform-mobile-nav" aria-label="Mobile platform navigation">
        {primaryItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "grid min-w-0 flex-1 place-items-center gap-1 px-2 py-2 text-[10px] font-bold text-[var(--color-ink-soft)]",
                active ? "text-[var(--color-primary)]" : "",
              ].join(" ")}
            >
              <Icon aria-hidden="true" size={21} strokeWidth={1.8} />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={onOpen}
          className="grid min-w-0 flex-1 place-items-center gap-1 px-2 py-2 text-[10px] font-bold text-[var(--color-ink-soft)]"
          aria-label="Open more navigation"
        >
          <MoreHorizontal aria-hidden="true" size={21} strokeWidth={1.8} />
          <span>More</span>
        </button>
      </nav>

      {open ? (
        <div className="fixed inset-0 z-[55] min-[921px]:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[rgba(15,39,68,0.45)]"
            aria-label="Close navigation"
            onClick={onClose}
          />
          <aside
            className="relative z-[60] flex h-screen w-[280px] flex-col bg-white shadow-[0_0_60px_rgba(15,39,68,0.25)]"
            onTouchStart={(event) => {
              touchStartX.current = event.touches[0]?.clientX ?? null;
            }}
            onTouchEnd={(event) => {
              const startX = touchStartX.current;
              const endX = event.changedTouches[0]?.clientX ?? null;

              if (startX !== null && endX !== null && startX - endX > 60) {
                onClose();
              }

              touchStartX.current = null;
            }}
          >
            <div className="flex items-center justify-between border-b border-[var(--color-line)] p-5">
              <div className="min-w-0">
                <LogoWordmark nav href="/" />
                <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-accent-fg)]">
                  Beta
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="grid size-9 place-items-center rounded-[10px] text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-primary)]"
                aria-label="Close navigation"
              >
                <X aria-hidden="true" size={18} strokeWidth={1.8} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <PlatformNav />
            </div>
            <div className="border-t border-[var(--color-line)] p-3">
              <SessionCard />
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
