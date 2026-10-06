"use client";

import { Moon, Sun } from "lucide-react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { useTheme } from "@/lib/theme/theme-provider";

export function ThemeToggle() {
  const { resolvedTheme, toggleMode } = useTheme();
  const { t } = useTranslation();
  const isDark = resolvedTheme === "dark";
  const label = isDark
    ? t("platform.switchToLightMode")
    : t("platform.switchToDarkMode");

  return (
    <button
      type="button"
      onClick={toggleMode}
      className="relative grid size-10 place-items-center overflow-hidden rounded-full border border-[var(--color-line)] bg-[var(--color-surface-soft)] text-[var(--color-ink)] transition-[background-color,transform] duration-[180ms] ease-out hover:bg-[var(--color-surface-strong)] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--color-primary)]"
      aria-label={label}
      title={label}
    >
      <Sun
        aria-hidden="true"
        size={18}
        strokeWidth={1.9}
        className={`absolute transition-all duration-300 ease-out motion-reduce:transition-none ${
          isDark
            ? "rotate-0 scale-100 opacity-100"
            : "-rotate-90 scale-50 opacity-0"
        }`}
      />
      <Moon
        aria-hidden="true"
        size={18}
        strokeWidth={1.9}
        className={`absolute transition-all duration-300 ease-out motion-reduce:transition-none ${
          isDark
            ? "rotate-90 scale-50 opacity-0"
            : "rotate-0 scale-100 opacity-100"
        }`}
      />
    </button>
  );
}
