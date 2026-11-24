import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Bunny Stream server helpers. All secrets (API key, token-auth key) are read
// here and never leave the server: the browser uploads bytes straight to Bunny
// using a short-lived signature we mint, and plays back through a signed embed
// URL. Import only from Route Handlers (Node runtime) — the non-public env vars
// are undefined in the browser, so an accidental client import throws at call.

const BUNNY_TUS_ENDPOINT = "https://video.bunnycdn.com/tusupload";
const BUNNY_API_BASE = "https://video.bunnycdn.com";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function getLibraryId(): string {
  return requireEnv("NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID");
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// course_assets is client-writable. This receipt proves which course/owner the
// server created the video for; a copied GUID must not become a new entitlement.
// ponytail: receipts reuse the Bunny key. Rotation requires controlled receipt
// renewal; never re-sign untrusted asset rows without verifying their old proof.
export function signBunnyAssetPath(courseId: string, ownerId: string, videoId: string): string {
  const receipt = createHmac("sha256", requireEnv("BUNNY_STREAM_API_KEY"))
    .update(JSON.stringify(["skillsetmind:bunny-asset:v1", courseId, ownerId, videoId]))
    .digest("hex");
  return `bunny/${videoId}/${receipt}`;
}

export function hasValidBunnyAssetPath(
  courseId: string, ownerId: string, videoId: string, storagePath: string | null,
): boolean {
  const expected = signBunnyAssetPath(courseId, ownerId, videoId);
  return typeof storagePath === "string" && storagePath.length === expected.length
    && Buffer.byteLength(storagePath) === Buffer.byteLength(expected)
    && timingSafeEqual(Buffer.from(storagePath), Buffer.from(expected));
}

// Create an empty video object in the library; the browser then streams the
// bytes into it via TUS. Returns the Bunny video guid.
export async function createBunnyVideo(title: string): Promise<string> {
  const libraryId = getLibraryId();
  const apiKey = requireEnv("BUNNY_STREAM_API_KEY");

  const res = await fetch(`${BUNNY_API_BASE}/library/${libraryId}/videos`, {
    method: "POST",
    headers: {
      AccessKey: apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ title }),
  });

  if (!res.ok) {
    throw new Error(`Bunny create video failed: ${res.status}`);
  }

  const data = (await res.json()) as { guid?: string };
  if (!data.guid) {
    throw new Error("Bunny create video returned no guid");
  }
  return data.guid;
}

// The video no longer exists on Bunny (deleted there). Permanent: the status
// route answers 404 and the studio stops asking.
export class BunnyVideoNotFoundError extends Error {
  constructor() {
    super("Bunny video not found");
    this.name = "BunnyVideoNotFoundError";
  }
}

export type BunnyVideoStatus = {
  status: number | null;
  encodeProgress: number | null;
  lengthSeconds: number | null;
};

// Bunny "Get Video". The full response and the key stay here; each export
// below returns only the fields its caller needs.
async function getBunnyVideo(videoId: string): Promise<Record<string, unknown>> {
  const libraryId = getLibraryId();
  const apiKey = requireEnv("BUNNY_STREAM_API_KEY");

  const res = await fetch(`${BUNNY_API_BASE}/library/${libraryId}/videos/${encodeURIComponent(videoId)}`, {
    headers: { AccessKey: apiKey, Accept: "application/json" },
    cache: "no-store",
    // A hung upstream call turns into the route's 503, and the studio retries.
    signal: AbortSignal.timeout(8000),
  });

  if (res.status === 404) {
    throw new BunnyVideoNotFoundError();
  }
  if (!res.ok) {
    throw new Error(`Bunny get video failed: ${res.status}`);
  }

  return (await res.json()) as Record<string, unknown>;
}

// Processing state of one video: the three fields the lesson studio shows.
export async function getBunnyVideoStatus(videoId: string): Promise<BunnyVideoStatus> {
  const data = await getBunnyVideo(videoId);
  const asNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return {
    status: asNumber(data.status),
    encodeProgress: asNumber(data.encodeProgress),
    lengthSeconds: asNumber(data.length),
  };
}

// Idiomas que ja tem legenda no video, inclusive as enviadas fora do estudio.
export async function getBunnyCaptionLanguages(videoId: string): Promise<string[]> {
  const { captions } = await getBunnyVideo(videoId);
  if (!Array.isArray(captions)) return [];
  return captions
    .map((caption) => (caption as { srclang?: unknown } | null)?.srclang)
    .filter((language): language is string => typeof language === "string")
    .map((language) => language.toLowerCase());
}

// MP4 de 240p de um vídeo (o "MP4 fallback", ligado na biblioteca desde o
// envio). É a menor versão com áudio: a transcrição lê só a voz dele. O host da
// CDN não sai da API da biblioteca com a chave que temos aqui, por isso vem de
// variável (BUNNY_STREAM_CDN_HOSTNAME, ex.: vz-xxxx.b-cdn.net).
//
// Assinado (token avançado da CDN): com a autenticação por token da CDN ligada
// na biblioteca, a CDN só serve link assinado, e sem ela o MP4 baixava com um
// Referer só. Pela documentação da Bunny, a mesma chave do player assina a CDN
// da biblioteca: "HS256-" + Base64URL(HMAC-SHA256(chave, caminho + expires)).
// Com a opção desligada, a CDN ignora os parâmetros. A leitura é um pedido só,
// então a validade curta basta.
export function bunnyLowestMp4Url(videoId: string, ttlSeconds = 300): string {
  const path = `/${encodeURIComponent(videoId)}/play_240p.mp4`;
  const url = `https://${requireEnv("BUNNY_STREAM_CDN_HOSTNAME")}${path}`;
  const signingKey = process.env.BUNNY_STREAM_TOKEN_KEY?.trim();
  if (!signingKey) return url;
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = createHmac("sha256", signingKey).update(`${path}${expires}`).digest("base64url");
  const query = new URLSearchParams();
  query.set("token", `HS256-${signature}`);
  query.set("expires", String(expires));
  return `${url}?${query.toString()}`;
}

// Publica (ou substitui) a legenda de um idioma no vídeo (Bunny "Add Caption").
// O player da Bunny passa a mostrar o botão CC com esse idioma.
export async function putBunnyCaption(videoId: string, language: string, label: string, vtt: string): Promise<void> {
  const libraryId = getLibraryId();
  const res = await fetch(
    `${BUNNY_API_BASE}/library/${libraryId}/videos/${encodeURIComponent(videoId)}/captions/${encodeURIComponent(language)}`,
    {
      method: "POST",
      headers: { AccessKey: requireEnv("BUNNY_STREAM_API_KEY"), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ srclang: language, label, captionsFile: Buffer.from(vtt, "utf8").toString("base64") }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!res.ok) throw new Error(`Bunny add caption failed: ${res.status}`);
}

// Tira a legenda de um idioma do vídeo. 404 = já não estava lá.
export async function deleteBunnyCaption(videoId: string, language: string): Promise<void> {
  const libraryId = getLibraryId();
  const res = await fetch(
    `${BUNNY_API_BASE}/library/${libraryId}/videos/${encodeURIComponent(videoId)}/captions/${encodeURIComponent(language)}`,
    {
      method: "DELETE",
      headers: { AccessKey: requireEnv("BUNNY_STREAM_API_KEY"), Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!res.ok && res.status !== 404) throw new Error(`Bunny delete caption failed: ${res.status}`);
}

// Deletes one video from the library (Bunny "Delete Video"). Final: Bunny has
// no backup. 404 = already gone, which is success for whoever is cleaning up.
export async function deleteBunnyVideo(videoId: string): Promise<void> {
  const libraryId = getLibraryId();
  const apiKey = requireEnv("BUNNY_STREAM_API_KEY");

  const res = await fetch(`${BUNNY_API_BASE}/library/${libraryId}/videos/${encodeURIComponent(videoId)}`, {
    method: "DELETE",
    headers: { AccessKey: apiKey, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok && res.status !== 404) {
    throw new Error(`Bunny delete video failed: ${res.status}`);
  }
}

// TUS upload authorization, per Bunny docs:
//   signature = SHA256(library_id + api_key + expiration + video_id)
// The browser sends {signature, expires, libraryId, videoId} as TUS headers.
export function signBunnyUpload(videoId: string, ttlSeconds = 3600) {
  const libraryId = getLibraryId();
  const apiKey = requireEnv("BUNNY_STREAM_API_KEY");
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = sha256Hex(`${libraryId}${apiKey}${expires}${videoId}`);
  return { libraryId, signature, expires, endpoint: BUNNY_TUS_ENDPOINT };
}

// Signed embed URL for protected playback, per Bunny token-auth docs:
//   token = SHA256(token_key + video_id + expiration)
// Token gates the embed page + HLS manifest load; a 1h TTL covers any lesson.
// ponytail: 1h TTL. If a single continuous view can exceed 1h and Bunny starts
// re-validating mid-stream, widen ttlSeconds or refresh the token on the client.
export function signBunnyEmbedUrl(videoId: string, ttlSeconds = 3600): string {
  const libraryId = getLibraryId();
  const tokenKey = requireEnv("BUNNY_STREAM_TOKEN_KEY");
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = sha256Hex(`${tokenKey}${videoId}${expires}`);
  return `https://iframe.mediadelivery.net/embed/${libraryId}/${videoId}?token=${token}&expires=${expires}&autoplay=false&preload=true`;
}
