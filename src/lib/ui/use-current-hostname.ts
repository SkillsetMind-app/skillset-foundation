"use client";

import { useSyncExternalStore } from "react";

const EMPTY_SUBSCRIBE = () => () => {};

/**
 * Hostname the page is being viewed on, safe for hydration: the server
 * snapshot is `null` (the server never knows which host it is rendering for),
 * the client reads `window.location`. No subscription — the hostname only
 * changes with a full navigation, which remounts everything anyway.
 *
 * Callers feed it to `entryUrl`, whose null case is "stay relative", so a
 * server render or a preview never emits a production short-host link.
 */
export function useCurrentHostname(): string | null {
  return useSyncExternalStore(
    EMPTY_SUBSCRIBE,
    () => window.location.hostname,
    () => null,
  );
}
