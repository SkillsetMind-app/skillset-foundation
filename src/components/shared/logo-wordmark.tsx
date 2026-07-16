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
  className?: string;
};

function fullSizeClass(nav: boolean, compact: boolean): string {
  if (nav) return "h-12";
  if (compact) return "h-12";
  return "h-14";
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
  className,
}: LogoWordmarkProps) {
  const inner =
    variant === "mark" ? (
      <Image
        src={brand.logoMark}
        alt=""
        width={brand.logoMarkSize.width}
        height={brand.logoMarkSize.height}
        priority
        className={`${markSizeClass(nav, compact)} w-auto object-contain`}
      />
    ) : (
      <span className={`logo-wordmark__full logo-wordmark__full--${tone}`}>
        <Image
          src={brand.logoFullLight}
          alt=""
          width={brand.logoFullLightSize.width}
          height={brand.logoFullLightSize.height}
          priority
          className={`logo-wordmark__asset logo-wordmark__asset--light ${fullSizeClass(nav, compact)} w-auto object-contain`}
        />
        <Image
          src={brand.logoFullDark}
          alt=""
          width={brand.logoFullDarkSize.width}
          height={brand.logoFullDarkSize.height}
          priority
          className={`logo-wordmark__asset logo-wordmark__asset--dark ${fullSizeClass(nav, compact)} w-auto object-contain`}
        />
      </span>
    );

  return (
    <Link
      href={href}
      aria-label={brand.name}
      className={["inline-flex shrink-0 items-center", className]
        .filter(Boolean)
        .join(" ")}
    >
      {inner}
      <span className="sr-only">{brand.name}</span>
    </Link>
  );
}
