/**
 * O banco recusa escrita em excesso com RAISE 'RATE_LIMIT' (enforce_rate_limit,
 * inclusive nos triggers de INSERT da comunidade e do suporte). O supabase-js
 * entrega isso como um erro com message "RATE_LIMIT"; a tela troca a mensagem
 * genérica, que manda tentar de novo na hora, por "espere um pouco".
 */
export function isRateLimitError(error: unknown): boolean {
  const message = error && typeof error === "object" && "message" in error ? error.message : null;
  return typeof message === "string" && message.startsWith("RATE_LIMIT");
}
