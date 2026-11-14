// Liga as ferramentas de IA do professor no estúdio. Desligada, nada aparece; a
// rota continua exigindo dono do curso e devolve 503 sem OPENAI_API_KEY.
// Mesmo padrão de NEXT_PUBLIC_TEACHER_ADVISOR_ENABLED (src/lib/advisor/config.ts).
export const isTeacherAiEnabled = process.env.NEXT_PUBLIC_TEACHER_AI_ENABLED === "true";
