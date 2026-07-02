// The teacher studio AI advisor renders only when explicitly enabled. It fronts
// an n8n webhook (N8N_ADVISOR_WEBHOOK_URL, server-side) that orchestrates DeepSeek,
// which may not be wired yet. Flip NEXT_PUBLIC_TEACHER_ADVISOR_ENABLED=true
// (Vercel env + redeploy) once the n8n + DeepSeek flow is live. Mirrors the
// isGoogleAuthEnabled gate so a half-wired feature never ships to teachers.
export const isAdvisorEnabled =
  process.env.NEXT_PUBLIC_TEACHER_ADVISOR_ENABLED === "true";
