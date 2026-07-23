import { NextResponse, type NextRequest } from "next/server";

import { createServerClient } from "@supabase/ssr";

import { getSupabaseClientConfig } from "@/lib/supabase/config";

// Refreshes the Supabase auth session on every request (the token cookie is
// short-lived and would otherwise expire between renders), so Server Components
// and Route Handlers always read a valid session and auth.uid() drives RLS.
// This is the documented @supabase/ssr proxy pattern.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const config = getSupabaseClientConfig();
  if (!config) {
    // Supabase not configured yet — pass through untouched.
    return response;
  }

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Touch the session so an expiring token gets rotated into the response
  // cookies. Do NOT gate/redirect here — route-level guards own authorization.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
