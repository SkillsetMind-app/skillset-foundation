import type { MetadataRoute } from "next";

import { listPublishedCourses } from "@/lib/data/server/public-course";
import { SITE_URL } from "@/lib/seo/page-metadata";

// Era `force-static`, e por isso o sitemap não conseguia enumerar curso nenhum:
// a leitura precisa acontecer em tempo de requisição. Revalida de hora em hora —
// catálogo de curso não muda de minuto a minuto, e um sitemap que consulta o
// banco a cada acesso de crawler é desperdício.
export const revalidate = 3600;

// Public, indexable surfaces only. Authenticated app routes
// (/learn, /teach, /ops, /account) and auth/onboarding flow routes
// are intentionally excluded and disallowed in robots.ts.
const publicRoutes: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}> = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/courses", changeFrequency: "daily", priority: 0.9 },
  { path: "/for-creators", changeFrequency: "weekly", priority: 0.9 },
  { path: "/pricing", changeFrequency: "monthly", priority: 0.8 },
  { path: "/promise", changeFrequency: "monthly", priority: 0.8 },
  // Linked from the footer on every page (trust, fees-and-payouts) and from
  // /promise (changelog), public and not disallowed in robots.ts — they just
  // never made it into this array, so sitemap consumers had to discover them
  // by crawl. /fees-and-payouts carries the commission + refund policy.
  { path: "/fees-and-payouts", changeFrequency: "monthly", priority: 0.8 },
  { path: "/trust", changeFrequency: "monthly", priority: 0.7 },
  { path: "/promise/changelog", changeFrequency: "monthly", priority: 0.4 },
  { path: "/instructors", changeFrequency: "weekly", priority: 0.7 },
  { path: "/about", changeFrequency: "monthly", priority: 0.6 },
  { path: "/help", changeFrequency: "monthly", priority: 0.6 },
  { path: "/contact", changeFrequency: "yearly", priority: 0.4 },
  { path: "/verify", changeFrequency: "monthly", priority: 0.4 },
  { path: "/legal/terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/legal/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/legal/teacher-terms", changeFrequency: "yearly", priority: 0.3 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();

  const staticEntries = publicRoutes.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  // Cursos de criador PUBLICADOS, um por URL. Isto era impossível antes por dois
  // motivos que caíram hoje: o sitemap era `force-static` (não podia consultar o
  // banco) e a leitura anônima abortava com 42501.
  //
  // Os 6 cursos do catálogo de demonstração seguem FORA de propósito: ninguém
  // pode comprá-los, e listá-los fazia buscador indexar seis páginas de produto
  // fantasma. Aqui entram só cursos com linha em `courses` e status `published`
  // — os que existem para ser vendidos.
  //
  // Falha de leitura devolve lista vazia (ver public-course.ts): o sitemap perde
  // os cursos naquela revalidação em vez de derrubar a rota inteira.
  const courses = await listPublishedCourses();

  const courseEntries = courses.map((course) => ({
    url: `${SITE_URL}/courses/${course.urlSlug}`,
    lastModified: course.updatedAt ? new Date(course.updatedAt) : lastModified,
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  return [...staticEntries, ...courseEntries];
}
