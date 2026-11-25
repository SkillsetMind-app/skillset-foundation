"use client";

import {
  createWishlistItem,
  getWishlistId,
  sortWishlistItems,
  type WishlistInput,
  type WishlistItem,
} from "@/domain/wishlist";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type WishlistRow = Database["public"]["Tables"]["wishlists"]["Row"];

function nowIso(): string {
  return new Date().toISOString();
}

function rowToWishlistItem(row: WishlistRow): WishlistItem {
  return {
    id: row.id,
    userId: row.user_id,
    courseId: row.course_id,
    courseSlug: row.course_slug,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function subscribeToUserWishlist(
  userId: string,
  callback: (items: WishlistItem[]) => void,
  onError: (error: Error) => void,
): (() => void) & { reload: () => Promise<void> } {
  const supabase = getSupabaseBrowserClient();
  // `reload()` (the "Try again") repeats this read without touching the channel. The usual
  // ones (the initial one and the channel's) deliver as before and only yield to a
  // newer reload; what the reload started does not deliver after turning off nor
  // over a newer read (it would bring the old list).
  let active = true;
  let latestLoad = 0;
  let latestReload = 0;

  const load = async (fromReload = false) => {
    const thisLoad = ++latestLoad;
    if (fromReload) latestReload = thisLoad;
    const { data, error } = await supabase
      .from("wishlists")
      .select("*")
      .eq("user_id", userId);

    if (fromReload ? !active || thisLoad !== latestLoad : thisLoad < latestReload) {
      return;
    }
    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback(sortWishlistItems((data ?? []).map(rowToWishlistItem)));
  };

  void load();

  const channel = supabase
    .channel(`wishlists:user:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "wishlists",
        filter: `user_id=eq.${userId}`,
      },
      () => {
        void load();
      },
    )
    .subscribe();

  // `reload()` reads again WITHOUT touching the channel (the "Try again" of the wishlist
  // and the catalog).
  return Object.assign(
    () => {
      active = false;
      void supabase.removeChannel(channel);
    },
    { reload: () => load(true) },
  );
}

export function subscribeToUserWishlistCourseIds(
  userId: string,
  callback: (courseIds: Set<string>) => void,
  onError: (error: Error) => void,
): (() => void) & { reload: () => Promise<void> } {
  return subscribeToUserWishlist(
    userId,
    (items) => callback(new Set(items.map((item) => item.courseId))),
    onError,
  );
}

export async function toggleWishlistCourse(input: WishlistInput) {
  const supabase = getSupabaseBrowserClient();
  const wishlistId = getWishlistId(input.userId, input.courseId);

  const { data: existing, error: readError } = await supabase
    .from("wishlists")
    .select("id")
    .eq("id", wishlistId)
    .maybeSingle();

  if (readError) {
    throw readError;
  }

  if (existing) {
    const { error } = await supabase
      .from("wishlists")
      .delete()
      .eq("id", wishlistId);

    if (error) {
      throw error;
    }

    return false;
  }

  const item = createWishlistItem(input);
  const timestamp = nowIso();

  const { error } = await supabase.from("wishlists").insert({
    id: item.id,
    user_id: item.userId,
    course_id: item.courseId,
    course_slug: item.courseSlug,
    created_at: timestamp,
    updated_at: timestamp,
  });

  if (error) {
    throw error;
  }

  return true;
}
