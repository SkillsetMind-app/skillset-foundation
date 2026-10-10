import Image from "next/image";
import Link from "next/link";

import { brand } from "@/data/brand";

type LogoWordmarkProps = {
  href?: string;
  /** "full" = official wordmark lockup. "mark" = compact symbol only. */
  variant?: "full" | "mark";
  /** "auto" follows the app theme; fixed tones support permanently dark surfaces. */
  tone?: "auto" | "light" | "dark";
  compact?: boolean;
  nav?: boolean;
  /** false: sem pré-carga (lazy). Para a marca que o CSS esconde em algumas telas. */
  priority?: boolean;
  className?: string;
};

// Largest box the CSS below draws each asset in: the lockup is at most h-10
// (40px tall, 5:1 → 200px wide), the mark at most size-12 (48px). Without
// `sizes`, next/image picks from the intrinsic width (1600/512) and a phone
// downloaded the 3840px and 1080px renditions of a logo shown ~200px wide.
const FULL_SIZES = "200px";
const MARK_SIZES = "48px";

function fullSizeClass(nav: boolean, compact: boolean): string {
  if (nav) return "h-8";
  if (compact) return "h-9";
  return "h-10";
}

function markSizeClass(nav: boolean, compact: boolean): string {
  if (nav) return "size-10";
  if (compact) return "size-11";
  return "size-12";
}

export function LogoWordmark({
  href = "/",
  variant = "full",
  tone = "auto",
  compact = false,
  nav = false,
  priority = true,
  className,
}: LogoWordmarkProps) {
  const inner =
    variant === "mark" ? (
      <span
        className={`logo-wordmark__themed logo-wordmark__mark logo-wordmark__themed--${tone}`}
      >
        <Image
          src={brand.logoMarkLight}
          alt=""
          width={brand.logoMarkSize.width}
          height={brand.logoMarkSize.height}
          sizes={MARK_SIZES}
          priority={priority}
          className={`logo-wordmark__asset logo-wordmark__asset--light ${markSizeClass(nav, compact)} w-auto object-contain`}
        />
        <Image
          src={brand.logoMarkDark}
          alt=""
          width={brand.logoMarkSize.width}
          height={brand.logoMarkSize.height}
          sizes={MARK_SIZES}
          priority={priority}
          className={`logo-wordmark__asset logo-wordmark__asset--dark ${markSizeClass(nav, compact)} w-auto object-contain`}
        />
      </span>
    ) : (
      <span
        className={`logo-wordmark__themed logo-wordmark__full logo-wordmark__themed--${tone}`}
      >
        <Image
          src={brand.logoFullLight}
          alt=""
          width={brand.logoFullLightSize.width}
          height={brand.logoFullLightSize.height}
          sizes={FULL_SIZES}
          priority={priority}
          className={`logo-wordmark__asset logo-wordmark__asset--light ${fullSizeClass(nav, compact)} w-auto object-contain`}
        />
        <Image
          src={brand.logoFullDark}
          alt=""
          width={brand.logoFullDarkSize.width}
          height={brand.logoFullDarkSize.height}
          sizes={FULL_SIZES}
          priority={priority}
          className={`logo-wordmark__asset logo-wordmark__asset--dark ${fullSizeClass(nav, compact)} w-auto object-contain`}
        />
      </span>
    );

  // Alvo de toque de 44px: a marca no topo mede 40 (mark) ou 32 (wordmark).
  return (
    <Link
      href={href}
      aria-label={brand.name}
      className={["inline-flex min-h-11 min-w-11 shrink-0 items-center", className]
        .filter(Boolean)
        .join(" ")}
    >
      {inner}
      <span className="sr-only">{brand.name}</span>
    </Link>
  );
}
