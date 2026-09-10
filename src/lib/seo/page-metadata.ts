import type { Metadata } from "next";

import { brand } from "@/data/brand";

// `www` é o host canônico em produção: o apex responde com 301 para cá
// (verificado navegando até https://skillsetmind.com, que redireciona). Enquanto
// esta constante apontava para o apex, TODA página se declarava canônica num
// endereço que redireciona, e o sitemap inteiro listava URLs redirecionadas —
// buscador trata redirecionamento como sinal enfraquecido.
export const SITE_URL = "https://www.skillsetmind.com";

type PageMetadataInput = {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
  /**
   * Imagem do card de compartilhamento. Absoluta (capa de curso vem do Bunny/
   * Supabase) ou começando com "/" para um ativo local. Sem isto, todo card
   * saía com o logo da marca — o mesmo card para todo curso do catálogo.
   */
  image?: string | null;
};

/**
 * Builds consistent, per-page SEO metadata (title, description, canonical,
 * Open Graph, Twitter). Without this every public page inherited the single
 * root-layout title/description, which is bad for SEO and link sharing.
 */
export function buildPageMetadata({
  title,
  description,
  path,
  noindex = false,
  image = null,
}: PageMetadataInput): Metadata {
  const fullTitle = `${title} | ${brand.name}`;
  const url = `${SITE_URL}${path}`;
  // Aceita URL absoluta (capa hospedada) ou caminho local; cai no logo quando
  // a página não tem imagem própria.
  const ogImage = image
    ? image.startsWith("http")
      ? image
      : `${SITE_URL}${image}`
    : `${SITE_URL}${brand.logoUrl}`;

  return {
    title: fullTitle,
    description,
    alternates: { canonical: url },
    robots: noindex
      ? { index: false, follow: false }
      : { index: true, follow: true },
    openGraph: {
      type: "website",
      siteName: brand.name,
      title: fullTitle,
      description,
      url,
      images: [{ url: ogImage }],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [ogImage],
    },
  };
}
