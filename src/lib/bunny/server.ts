import { createHash } from "node:crypto";

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
