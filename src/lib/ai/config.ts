// Turns on the teacher's AI tools in the studio. When off, nothing shows up; the
// route still requires the course owner and returns 503 without OPENAI_API_KEY.
// Same pattern as NEXT_PUBLIC_TEACHER_ADVISOR_ENABLED (src/lib/advisor/config.ts).
export const isTeacherAiEnabled = process.env.NEXT_PUBLIC_TEACHER_AI_ENABLED === "true";
