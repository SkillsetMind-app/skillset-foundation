export type TrustedLessonEmbed = {
  provider: "youtube" | "vimeo";
  embedUrl: string;
};

function cleanSegment(value: string | undefined) {
  return value?.trim().replace(/[^a-zA-Z0-9_-]/g, "") ?? "";
}

function youtubeEmbedId(url: URL) {
  const host = url.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    return cleanSegment(url.pathname.split("/").filter(Boolean)[0]);
  }

  if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "youtube-nocookie.com") {
    return "";
  }

  if (url.pathname === "/watch") {
    return cleanSegment(url.searchParams.get("v") ?? undefined);
  }

  const parts = url.pathname.split("/").filter(Boolean);

  if (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live") {
    return cleanSegment(parts[1]);
  }

  return "";
}

function vimeoEmbedId(url: URL) {
  const host = url.hostname.replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "vimeo.com") {
    return parts[0]?.match(/^[0-9]+$/) ? parts[0] : "";
  }

  if (host === "player.vimeo.com" && parts[0] === "video") {
    return parts[1]?.match(/^[0-9]+$/) ? parts[1] : "";
  }

  return "";
}

export function getTrustedLessonEmbed(value?: string | null): TrustedLessonEmbed | null {
  if (!value?.trim()) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  const youtubeId = youtubeEmbedId(url);

  if (youtubeId) {
    return {
      provider: "youtube",
      // enablejsapi=1 is what makes the iframe answer the postMessage
      // handshake the player uses to hear "video ended" (auto-advance). We do
      // NOT load YouTube's IFrame API script — script-src does not allow
      // youtube.com — so the listener is hand-rolled on the consumer side.
      //
      // ponytail: no &origin=. It can only be read from window at render time,
      // so the server and client would build different src attributes and
      // hydration would fail. The security property that matters is checking
      // event.origin on every inbound message, which the listener does.
      embedUrl: `https://www.youtube-nocookie.com/embed/${youtubeId}?enablejsapi=1`,
    };
  }

  const vimeoId = vimeoEmbedId(url);

  if (vimeoId) {
    return {
      provider: "vimeo",
      embedUrl: `https://player.vimeo.com/video/${vimeoId}`,
    };
  }

  return null;
}
