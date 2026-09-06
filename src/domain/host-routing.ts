/**
 * What a request arriving on a custom domain should become.
 *
 * Kept pure and separate from the proxy so the decision can be tested without a
 * request, a database or a running server. `src/proxy.ts` does the lookup and
 * then asks this module what to do with the answer.
 *
 * THE RULE THAT MATTERS MOST: a custom domain serves the teacher's public
 * surface and nothing else. Everything that involves an identity — sign-in,
 * sign-up, the studio, the account area — redirects back to the platform's own
 * hostname instead of being served under the teacher's.
 *
 * That is not tidiness, it is the security boundary of this whole feature. The
 * teacher controls the DNS for their domain, and one day some of them will let
 * it lapse. Whoever registers it next inherits a name that our certificate
 * answers for. If we had ever served the login form there, that person now has
 * a pixel-perfect credential harvester on infrastructure the victim has been
 * taught to trust. Refusing to render an auth surface on a hostname we do not
 * control removes the prize entirely.
 *
 * The second reason is duller and still real: cookies are per-origin, so a
 * session started on the teacher's domain is a different session from the one
 * on ours. Serving auth on both produces a user who is somehow logged in and
 * logged out at the same time.
 */

/** The platform's own hostname, used as the redirect target. */
export const PLATFORM_ORIGIN = "https://skillsetmind.com";

// Entry links use the existing session host; they never start a second login.
const PLATFORM_ENTRIES = new Map([
  ["app.skillsetmind.com", "/teach"],
  ["consumer.skillsetmind.com", "/learn"],
  ["pay.skillsetmind.com", "/courses"],
]);

export type HostRouteDecision =
  /** Not a custom domain, or nothing to do — hand the request on untouched. */
  | { kind: "pass" }
  /** Serve this internal path instead, without changing the visible URL. */
  | { kind: "rewrite"; path: string }
  /** Send the visitor to the platform's own hostname. */
  | { kind: "redirect"; url: string; status?: 307 | 308 }
  /** Entry aliases do not forward request bodies to another origin. */
  | { kind: "method-not-allowed" };

/**
 * Paths left untouched on platform and teacher hosts. Next internals and the API
 * both break in confusing ways if rewritten, and the API is already
 * origin-agnostic.
 */
const NEVER_TOUCH = [
  "/_next/",
  "/api/",
  "/__nextjs",
  "/favicon",
  "/icon",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
];

/**
 * The public surface a teacher's domain is allowed to serve. Everything outside
 * this list goes back to the platform — see the security note at the top.
 *
 * `/courses/` is here because the course sales page is the other thing a teacher
 * points a domain at, and it is public by definition: it exists to be found by
 * someone who is not logged in.
 */
const TEACHER_PUBLIC_PREFIXES = ["/courses/", "/instructors/"];

export function decideHostRoute(input: {
  /** Hostname normalized by normaliseHostHeader before classification/lookup. */
  hostname: string;
  pathname: string;
  search: string;
  method?: string;
  /** uid resolved from public_domains, or null when this host is not ours. */
  resolvedUid: string | null;
}): HostRouteDecision {
  const { hostname, pathname, search, resolvedUid, method = "GET" } = input;

  const entryPath = PLATFORM_ENTRIES.get(hostname);
  if (entryPath) {
    if (method !== "GET" && method !== "HEAD") return { kind: "method-not-allowed" };
    return {
      kind: "redirect",
      status: 307,
      url: `${PLATFORM_ORIGIN}${pathname === "/" || pathname === "" ? entryPath : pathname}${search}`,
    };
  }

  // Fora dos aliases de entrada, assets e API nunca são tocados: reescrever quebra o Next, e
  // a API já é agnóstica de origem. Vem antes de tudo porque um domínio não
  // resolvido ainda precisa servir os próprios assets enquanto o visitante é
  // mandado embora.
  if (NEVER_TOUCH.some((prefix) => pathname.startsWith(prefix))) {
    return { kind: "pass" };
  }

  // O host da plataforma segue normalmente.
  if (isPlatformHost(hostname)) {
    return { kind: "pass" };
  }

  // Chegou aqui: o host NÃO é nosso e não resolve para nenhum professor.
  //
  // O comentário antigo aqui dizia "pode ser o próprio host da plataforma, uma
  // URL de preview ou localhost — em qualquer caso a requisição já está onde
  // deveria" e devolvia `pass`. Essa premissa ficou falsa quando a feature de
  // domínio próprio entrou: isPlatformHost já passou pela guarda ACIMA,
  // então o que sobra aqui é justamente o caso perigoso —
  // um hostname anexado ao projeto da Vercel mas ainda NÃO verificado (a rota
  // anexa antes de provar posse), ou um cuja linha sumiu quando o professor
  // desanexou. Nos dois, servir `pass` publicava /login e /signup reais sob um
  // nome que a plataforma não controla, com certificado válido: exatamente o
  // coletor de credenciais que o cabeçalho deste arquivo existe para impedir.
  //
  // Falhar FECHADO. O visitante vai para a plataforma; nada de identidade é
  // renderizado sob um host de terceiro.
  if (!resolvedUid) {
    return { kind: "redirect", url: `${PLATFORM_ORIGIN}${pathname}${search}` };
  }

  // The root of a teacher's domain is their storefront. This is the whole point
  // of the feature.
  if (pathname === "/" || pathname === "") {
    return { kind: "rewrite", path: `/instructors/${resolvedUid}${search}` };
  }

  if (TEACHER_PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return { kind: "pass" };
  }

  // Everything else — /login, /signup, /account, /teach, /ops, and anything
  // added later that nobody remembered to consider here. Defaulting to redirect
  // rather than pass is deliberate: a new authenticated route added a year from
  // now is protected by this line without its author having to know this file
  // exists.
  return { kind: "redirect", url: `${PLATFORM_ORIGIN}${pathname}${search}` };
}

/**
 * Strips the port and one DNS root dot, then lowercases for host comparison.
 * `Example.COM.:3000` and `example.com` must select the same route before any
 * custom-domain lookup. Bracketed IPv6 follows its existing branch below.
 *
 * IPv6 literals arrive bracketed (`[::1]:3000`), so the port split has to happen
 * after the bracket, not at the first colon.
 */
export function normaliseHostHeader(header: string | null): string | null {
  if (!header) return null;
  const trimmed = header.trim().toLowerCase();
  if (!trimmed) return null;

  if (trimmed.startsWith("[")) {
    const close = trimmed.indexOf("]");
    return close === -1 ? trimmed : trimmed.slice(1, close);
  }

  const colon = trimmed.indexOf(":");
  const hostname = colon === -1 ? trimmed : trimmed.slice(0, colon);
  return hostname.replace(/\.$/, "");
}

/**
 * Hostnames the platform answers on itself. Checked before any database lookup
 * so that ordinary traffic — which is all of it, for now — never pays for a
 * query, and so that a stray row in `public_domains` claiming our own apex could
 * not hijack the platform even if one ever appeared.
 */
export function isPlatformHost(hostname: string): boolean {
  return (
    hostname === "skillsetmind.com" ||
    hostname.endsWith(".skillsetmind.com") ||
    hostname.endsWith(".vercel.app") ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}
