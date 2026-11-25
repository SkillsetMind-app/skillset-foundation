// Server-only at runtime: it reads next/headers, so importing it from a client
// component throws (same as lib/i18n/server).
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";

import type { AuthSession, SkillsetUser } from "@/domain/auth";
import type { UserProfile } from "@/domain/user-profile";
import { mapSupabaseUser } from "@/lib/auth/map-user";
import { SESSION_CHECKED_HEADER } from "@/lib/auth/session-checked";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { rowToUserProfile } from "@/lib/supabase/user-mappers";

export type ServerAccount = { user: SkillsetUser; profile: UserProfile };

// The page must never wait on this: past it, the browser resolves the session
// the way it always did.
const TIMEOUT_MS = 2000;

async function readAccount(): Promise<ServerAccount | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) {
    return null;
  }

  // The browser claims pending course grants before it reports "signed in",
  // so the first enrollment read already sees them. Same order here. A failed
  // claim asserts no access and must not hold the page back.
  const [, row] = await Promise.all([
    supabase.rpc("claim_my_course_grants").then(() => null, () => null),
    supabase.from("users").select("*").eq("uid", user.id).maybeSingle(),
  ]);
  // No row yet: the browser path repairs it (a write), so it decides.
  if (row.error || !row.data) {
    return null;
  }

  const profile = rowToUserProfile(row.data);
  return { user: mapSupabaseUser(user, profile), profile };
}

/**
 * Who is signed in, resolved on the server: the user and their profile row.
 * Once per request (cache), so the root layout and a page can both ask.
 *
 * Returns null unless the answer is a definite "signed in": the proxy did not
 * verify a session for this request (nobody signed in, or a request it let
 * through untouched), second factor still owed, blocked account, no profile
 * row yet, an error, or no answer within two seconds. Null is not "signed
 * out". It means the browser decides, exactly as before, so this can only ever
 * speed a page up, never open or close one.
 *
 * The verdict is the same one the routes use: createSupabaseServerClient
 * answers getUser() with no user for a session that is not strong.
 */
export const getServerAccount = cache(async (): Promise<ServerAccount | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Only after the proxy verified this session (and refreshed its token if
    // it had to): see lib/auth/session-checked. Everyone else, anonymous
    // visitors included, leaves here with no network call.
    if ((await headers()).get(SESSION_CHECKED_HEADER) !== "1") {
      return null;
    }

    return await Promise.race([
      readAccount(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    // Next signals "this route is dynamic" by throwing from headers(): that
    // one is not ours to swallow.
    unstable_rethrow(error);
    return null;
  } finally {
    clearTimeout(timer);
  }
});

/**
 * The signed-in session for the first HTML, so it already is the signed-in
 * page.
 *
 * Without it every protected page shipped a skeleton and the browser resolved
 * the session after hydration: three round trips to Supabase in a row
 * (session_is_strong, claim_my_course_grants, the profile), each behind its own
 * CORS preflight, before any content could paint. Here the same three run next
 * to the database, and the grant claim and the profile run together.
 */
export async function getServerAuthSession(): Promise<AuthSession | null> {
  // The provider is already mounted when the layout renders again inside the
  // app (router.refresh on a language change): it ignores what it is handed,
  // so resolving the session there would be three round trips for nothing.
  if (!(await isDocumentRequest())) {
    return null;
  }
  const account = await getServerAccount();
  return account ? { status: "authenticated", user: account.user } : null;
}

/**
 * True for the request that loads a whole page, as opposed to an in-app
 * navigation or refresh. What the server resolves "for the first HTML" is only
 * worth resolving here: inside the app the browser already has the session,
 * and waiting on the server would hold the navigation back.
 *
 * Browsers say so themselves (Sec-Fetch-Dest). One that does not gets false,
 * which only means the browser reads the data as it always did.
 */
export async function isDocumentRequest(): Promise<boolean> {
  return (await headers()).get("sec-fetch-dest") === "document";
}
