// The platform help assistant renders only when explicitly enabled
// (NEXT_PUBLIC_PLATFORM_ASSISTANT_ENABLED=true, Vercel env + redeploy). It calls
// Kimi server-side with KIMI_API_KEY (src/app/api/assistant/route.ts). Mirrors
// the isAdvisorEnabled gate so a half-wired feature never ships to visitors.
export const isAssistantEnabled =
  process.env.NEXT_PUBLIC_PLATFORM_ASSISTANT_ENABLED === "true";
