import Image from "next/image";

// Uploaded covers live in our Supabase Storage, the one remote host the image
// optimizer is allowed to read (next.config.ts, images.remotePatterns).
const STORAGE_PREFIX = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/storage/v1/object/`;

type CoverThumbnailProps = {
  src: string;
  alt: string;
  /** The width the box really has on screen, e.g. "96px" or "(min-width: 640px) 45vw, 100vw". */
  sizes: string;
  /** Above the fold: load right away instead of when it nears the viewport. */
  eager?: boolean;
  /** The main image of the screen. At most one per page. */
  highPriority?: boolean;
};

/**
 * A cover that fills its box (the parent must be `relative`).
 *
 * Covers are stored as uploaded: 800 kB on average, up to 2.3 MB. Drawn with a
 * plain <img>, a 96 px thumbnail downloaded the whole original, and a studio
 * home with four products pulled about 3 MB of pictures. Through the optimizer
 * the browser gets a file sized for the box, in AVIF or WebP.
 *
 * An address outside our storage is shown as it always was: the optimizer
 * refuses hosts it does not know, and a refused image is a broken one.
 */
export function CoverThumbnail({ src, alt, sizes, eager = false, highPriority = false }: CoverThumbnailProps) {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && src.startsWith(STORAGE_PREFIX)) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        loading={eager || highPriority ? "eager" : "lazy"}
        fetchPriority={highPriority ? "high" : undefined}
        className="object-cover"
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className="h-full w-full object-cover" />
  );
}
