"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";

// Search lived INSIDE the sidebar and only existed with it expanded: whoever
// collapsed the rail to gain screen space lost search, and on the phone — where the bar
// becomes a drawer — it did not exist at any width. Searching is not menu
// navigation, it is a page action: it now lives in the top bar, which is present at
// every width (audit finding F26).

export function PlatformSearch({
  pathname,
  open = false,
  searchHref,
  onDismiss,
}: {
  pathname: string;
  /** On the phone the top bar has no room for the field; an icon opens it. */
  open?: boolean;
  /** A page with a query consumer can preserve its own scope and parameters. */
  searchHref?: string;
  /** Closes the phone strip: Esc (returns focus to the icon) or search submitted. */
  onDismiss?: (reason: "escape" | "submit") => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { t } = useTranslation();
  const placeholder = t(getSearchPlaceholderKey(pathname, searchHref));
  const shortcutLabel = useShortcutLabel();
  const savedQuery = new URLSearchParams(searchHref?.split("?")[1]).get("q") ?? "";

  useEffect(() => {
    if (searchHref !== undefined && inputRef.current) inputRef.current.value = savedQuery;
  }, [searchHref, savedQuery]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function submitSearch() {
    const query = inputRef.current?.value.trim();

    if (searchHref) {
      const [path, search] = searchHref.split("?");
      const params = new URLSearchParams(search);
      if (query) params.set("q", query);
      else params.delete("q");
      const suffix = params.toString();
      router.push(suffix ? `${path}?${suffix}` : path);
      return;
    }

    if (!query) {
      return;
    }

    // The teacher's search went to /teach?query=, which nobody reads: Enter
    // reloaded Home unchanged. The products list already filters by ?q=.
    const target = pathname.startsWith("/teach")
      ? `/teach/builder?q=${encodeURIComponent(query)}`
      : `/courses?q=${encodeURIComponent(query)}`;

    router.push(target);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      submitSearch();
      // On the phone the strip opens over the page title: it stayed open
      // over the results until the person found the icon again.
      onDismiss?.("submit");
    } else if (event.key === "Escape" && open) {
      // Without this the browser also clears the field text on the same Esc, and the
      // strip reopened empty over a list that was still filtered.
      event.preventDefault();
      onDismiss?.("escape");
    }
  }

  useEffect(() => {
    function focusSearch(event: globalThis.KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") {
        return;
      }

      event.preventDefault();
      inputRef.current?.focus();
    }

    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, []);

  return (
    <label className="platform-topbar-search" data-open={open ? "true" : "false"}>
      <Search aria-hidden="true" size={15} strokeWidth={2} />
      <input
        ref={inputRef}
        type="search"
        defaultValue={savedQuery}
        placeholder={placeholder}
        aria-label={placeholder}
        onKeyDown={handleKeyDown}
      />
      {/* A keyboard shortcut is not a hint for someone on touch. */}
      {shortcutLabel ? <span aria-hidden="true" className="pointer-coarse:hidden">{shortcutLabel}</span> : null}
    </label>
  );
}

const EMPTY_SUBSCRIBE = () => () => {};

/**
 * The hint said a fixed "Ctrl K", including on Mac, where the shortcut is ⌘K — and the
 * listener always accepted both keys. The server does not know what keyboard the
 * reader has, so the server snapshot is `null` and nothing is written;
 * the right label enters at hydration, with no mismatch. It is decorative
 * (aria-hidden), so appearing one frame later costs nobody anything.
 */
function useShortcutLabel() {
  return useSyncExternalStore(
    EMPTY_SUBSCRIBE,
    // ponytail: navigator.platform is deprecated but it is the only field that
    // every browser still fills in; the userAgent covers the rest.
    () =>
      /mac|iphone|ipad|ipod/i.test(`${navigator.platform} ${navigator.userAgent}`)
        ? "⌘K"
        : "Ctrl K",
    () => null,
  );
}

function getSearchPlaceholderKey(pathname: string, searchHref?: string) {
  if (pathname.startsWith("/teach")) {
    return "platform.searchTeachPlaceholder";
  }

  if (pathname.startsWith("/learn")) {
    return "platform.searchLearnPlaceholder";
  }

  if (pathname.startsWith("/ops")) {
    const tab = new URLSearchParams(searchHref?.split("?")[1]).get("tab");
    if (tab === "support") return "platform.ops.searchSupport";
    if (tab === "verification") return "platform.ops.searchVerification";
    return "platform.searchOpsPlaceholder";
  }

  return "platform.searchDefaultPlaceholder";
}
