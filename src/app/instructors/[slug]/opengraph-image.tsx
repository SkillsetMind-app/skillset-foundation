import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { brand } from "@/data/brand";
import { publicProfileName } from "@/domain/user-profile";
import { getPublicProfileByRef, listCreatorCourses } from "@/lib/data/server/public-profile";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import { getSupabaseClientConfig } from "@/lib/supabase/config";

// Cartão de compartilhamento do professor (1200×630): foto, nome, @ e número
// de cursos. Antes todo perfil colado no WhatsApp/Instagram saía com o mesmo
// cartão genérico da plataforma. Em inglês, como o cartão padrão: quem busca a
// imagem é o robô da rede, sem cookie de idioma.
export const alt = brand.name;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const MAX_PHOTO_BYTES = 2_000_000;
// Um PNG de 12000×12000 cabe em ~400 KB e custa ~1,3 GB para desenhar: o
// tamanho em pixels vem do cabeçalho, antes de qualquer decodificação.
const MAX_PHOTO_SIDE = 2048;

/**
 * O servidor só busca foto nos hosts que a plataforma já aceita para avatar
 * (os mesmos do remotePatterns do next.config): o Storage do nosso Supabase e
 * as fotos da conta Google. Sem esta trava, quem controla a URL da foto faria
 * o servidor buscar o endereço que quisesse (SSRF).
 */
function isAllowedPhotoUrl(url: string | null): url is string {
  if (!url) return false;
  try {
    const { protocol, hostname, port, pathname } = new URL(url);
    if (protocol !== "https:" || port !== "") return false;
    const supabase = getSupabaseClientConfig()?.url;
    const storageHost = supabase ? new URL(supabase).hostname : null;
    return (hostname === storageHost && pathname.startsWith("/storage/v1/object/"))
      || hostname === "lh3.googleusercontent.com";
  } catch {
    return false;
  }
}

/** Largura e altura lidas do cabeçalho PNG (IHDR) ou JPEG (SOFn); null se não der. */
function pixelSize(bytes: Buffer, type: string): { width: number; height: number } | null {
  if (type === "image/png") {
    const png = bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.toString("ascii", 12, 16) === "IHDR";
    return png ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : null;
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 <= bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1];
    // SOF0..SOF15, menos DHT (C4), JPG (C8) e DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    }
    if (marker === 0xda) return null; // começou a imagem sem SOF
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  return null;
}

// O renderizador só desenha PNG e JPEG com segurança. Foto em outro formato,
// grande, fora do ar ou lenta: o cartão sai com a inicial, nunca quebra.
// Sem seguir redirect: ele poderia levar para fora da lista acima.
async function photoDataUri(url: string | null): Promise<string | null> {
  if (!isAllowedPhotoUrl(url)) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000), redirect: "error" });
    const type = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!response.ok || !["image/png", "image/jpeg"].includes(type)) return null;
    if (Number(response.headers.get("content-length") ?? 0) > MAX_PHOTO_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_PHOTO_BYTES) return null;
    const pixels = pixelSize(bytes, type);
    if (!pixels || pixels.width > MAX_PHOTO_SIDE || pixels.height > MAX_PHOTO_SIDE) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function ProfileOpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let ref = slug;
  try {
    ref = decodeURIComponent(slug);
  } catch {}
  const profile = await getPublicProfileByRef(ref);
  if (!profile) return new Response(null, { status: 404 });

  const en = getDictionary("en");
  const [courses, photo, logo] = await Promise.all([
    listCreatorCourses(profile.uid),
    photoDataUri(profile.photoURL),
    readFile(join(process.cwd(), "public/brand/logo-full-dark-v2.png")),
  ]);
  const name = publicProfileName(profile) ?? translate(en, "publicPages.profile.fallback_name").replace("{brand}", brand.name);
  const count = courses?.length ?? 0;
  const coursesLine = count
    ? translate(en, count === 1 ? "publicPages.profile.og_courses_one" : "publicPages.profile.og_courses_many")
      .replace("{count}", String(count))
    : null;
  // Plano que tira a marca da plataforma: o cartão também sai sem o nosso logo.
  const hideBrand = profile.storefront?.branding?.hidePlatformBrand === true;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "72px 96px",
          background: "#102a43",
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", flex: 1, alignItems: "center" }}>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain <img>
            <img src={photo} width={220} height={220} alt="" style={{ borderRadius: 9999, objectFit: "cover" }} />
          ) : (
            <div
              style={{
                width: 220,
                height: 220,
                borderRadius: 9999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#315a7d",
                fontSize: 110,
              }}
            >
              {name.charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 56, maxWidth: 740 }}>
            <span style={{ fontSize: 68, lineHeight: 1.1 }}>{name}</span>
            {profile.username ? (
              <span style={{ marginTop: 12, fontSize: 36, color: "#cbd5e1" }}>@{profile.username}</span>
            ) : null}
            {coursesLine ? (
              <span style={{ marginTop: 28, fontSize: 36, color: "#c99a46" }}>{coursesLine}</span>
            ) : null}
          </div>
        </div>
        {hideBrand ? (
          <div style={{ display: "flex" }} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain <img>
          <img src={`data:image/png;base64,${logo.toString("base64")}`} width={300} height={60} alt="" />
        )}
      </div>
    ),
    {
      ...size,
      // A URL leva ?v=<updatedAt> (page.tsx): perfil novo, URL nova; o CDN
      // pode guardar cada versão.
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    },
  );
}
