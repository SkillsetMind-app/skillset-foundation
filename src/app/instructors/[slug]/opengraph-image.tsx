import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { brand } from "@/data/brand";
import { publicProfileName } from "@/domain/user-profile";
import { getPublicProfileByRef, listCreatorCourses } from "@/lib/data/server/public-profile";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

// Cartão de compartilhamento do professor (1200×630): foto, nome, @ e número
// de cursos. Antes todo perfil colado no WhatsApp/Instagram saía com o mesmo
// cartão genérico da plataforma. Em inglês, como o cartão padrão: quem busca a
// imagem é o robô da rede, sem cookie de idioma.
export const alt = brand.name;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// O renderizador só desenha PNG e JPEG com segurança. Foto em outro formato,
// fora do ar ou lenta: o cartão sai com a inicial, nunca quebra.
async function photoDataUri(url: string | null): Promise<string | null> {
  if (!url?.startsWith("https://")) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    const type = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!response.ok || !["image/png", "image/jpeg"].includes(type)) return null;
    return `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
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
    size,
  );
}
