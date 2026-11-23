// As regras de página da PlatformShell, num lugar só. A casca de verdade
// (platform-shell.tsx) e a espera da guarda de login (protected-surface.tsx)
// leem daqui: a coluna da espera e a da página não têm como divergir. Sem
// "use client" de propósito: funções puras, servem ao servidor e ao cliente.

function under(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** As áreas logadas cujas páginas abrem dentro da PlatformShell. */
export const PLATFORM_SHELL_AREAS = ["/teach", "/learn", "/account", "/ops", "/support"] as const;

/**
 * Dentro dessas áreas, as telas com outra casca: a sala de aula e a área de
 * membros (MemberAreaShell), a prévia do curso no construtor (MemberAreaShell)
 * e o certificado para imprimir (sem casca). src/app/espera-pela-casca.test.ts
 * confere, página a página, que só estas ficam fora.
 */
export const OTHER_SHELL_PREFIXES = ["/learn/courses/", "/learn/areas/", "/learn/credentials/", "/teach/builder/"] as const;

/** A página abre dentro da PlatformShell? Fora da lista, não (na dúvida, não). */
export function opensInPlatformShell(pathname: string) {
  return PLATFORM_SHELL_AREAS.some((area) => under(pathname, area))
    && !OTHER_SHELL_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Estúdio, conta e listas do aluno: uma coluna de no máximo 1280px, centrada.
 * Num monitor de 1920px a lista de vendas tinha o título na borda esquerda e o
 * valor 1500px depois.
 */
export function isFramedPlatformRoute(pathname: string) {
  const teachRoute = under(pathname, "/teach");
  // O construtor usa a largura toda, decidido pelo endereco tambem: pela
  // classe do editor carregado, o esqueleto (e o erro, e a tela sem curso)
  // saia na coluna de 1280px e a pagina pulava para a largura toda depois.
  const builderRoute = under(pathname, "/teach/builder");
  // A mesma coluna na conta (Ganhos abre pela barra do professor) e nas listas
  // do aluno. Fora dela, de proposito: a sala de aula (largura toda por
  // desenho), a area de membros e as telas de pagar plano (checkout, volta do
  // checkout e a escolha do plano), que ficam como estavam.
  const learnListRoute = under(pathname, "/learn")
    && !pathname.startsWith("/learn/courses/") && !pathname.startsWith("/learn/areas/");
  const checkoutRoute = pathname.startsWith("/account/billing/upgrade")
    || pathname.startsWith("/account/billing/return")
    || pathname.startsWith("/account/plans");
  const accountRoute = under(pathname, "/account") && !checkoutRoute;
  return (teachRoute && !builderRoute) || accountRoute || learnListRoute;
}
