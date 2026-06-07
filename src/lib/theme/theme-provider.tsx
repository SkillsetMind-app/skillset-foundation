"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ThemeMode = "light" | "dark" | "system";

type ThemeContextValue = {
  mode: ThemeMode;
  resolvedTheme: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
};

const storageKey = "skillset_theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getStoredMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  const storedMode = window.localStorage.getItem(storageKey);

  return storedMode === "dark" || storedMode === "system" || storedMode === "light"
    ? storedMode
    : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(getStoredMode);
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(getSystemTheme);
  const resolvedTheme = mode === "system" ? systemTheme : mode;
  // Tracks the window timeout that removes the page-wide theme cross-fade
  // class, so rapid toggles cancel the previous removal instead of racing it.
  const themeTransitionTimeout = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setSystemTheme(getSystemTheme());

    mediaQuery.addEventListener("change", handleChange);

    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;

    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [resolvedTheme]);

  function setMode(nextMode: ThemeMode) {
    // The [data-theme] swap flips every CSS variable instantly, so without help
    // the whole page snaps between palettes while only the toggle icon animates.
    // Arm a short-lived cross-fade (see .theme-transitioning in globals.css)
    // before the resolvedTheme effect repaints. Added only on user action, so
    // the initial page load never flashes a transition; gated by reduced-motion
    // in CSS, not here.
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.classList.add("theme-transitioning");

      if (themeTransitionTimeout.current !== null) {
        window.clearTimeout(themeTransitionTimeout.current);
      }

      themeTransitionTimeout.current = window.setTimeout(() => {
        root.classList.remove("theme-transitioning");
        themeTransitionTimeout.current = null;
      }, 340);
    }

    setModeState(nextMode);
    window.localStorage.setItem(storageKey, nextMode);
  }

  const value = useMemo(
    () => ({
      mode,
      resolvedTheme,
      setMode,
      toggleMode: () => setMode(resolvedTheme === "dark" ? "light" : "dark"),
    }),
    [mode, resolvedTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }

  return context;
}
