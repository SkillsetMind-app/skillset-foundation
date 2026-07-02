// The platform help assistant renders only when explicitly enabled. It fronts
// an n8n webhook (N8N_ASSISTANT_WEBHOOK_URL, server-side) that orchestrates
// DeepSeek, which may not be wired yet. Flip
// NEXT_PUBLIC_PLATFORM_ASSISTANT_ENABLED=true (Vercel env + redeploy) once the
// n8n flow is live. Mirrors the isAdvisorEnabled gate so a half-wired feature
// never ships to visitors.
export const isAssistantEnabled =
  process.env.NEXT_PUBLIC_PLATFORM_ASSISTANT_ENABLED === "true";
