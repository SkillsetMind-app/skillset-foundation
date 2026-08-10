// The teacher studio AI advisor renders only when explicitly enabled. The route
// (/api/teach/advisor) calls Moonshot Kimi directly — no n8n hop — so what this
// flag really waits on is the server env: KIMI_API_KEY and, for the knowledge
// grounding, ADVISOR_KNOWLEDGE_DOC_URL. Flip
// NEXT_PUBLIC_TEACHER_ADVISOR_ENABLED=true (Vercel env + redeploy) once both are
// set in production, or every teacher gets a sidebar that 503s on first message.
// Mirrors the isGoogleAuthEnabled gate so a half-wired feature never ships.
export const isAdvisorEnabled =
  process.env.NEXT_PUBLIC_TEACHER_ADVISOR_ENABLED === "true";
