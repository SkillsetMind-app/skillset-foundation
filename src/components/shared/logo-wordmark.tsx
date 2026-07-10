import Image from "next/image";
import Link from "next/link";

import { brand } from "@/data/brand";

type LogoWordmarkProps = {
  href?: string;
  /** "full" = wordmark (theme-aware). "mark" = round emblem only. */
  variant?: "full" | "mark";
  compact?: boolean;
  nav?: boolean;
  className?: string;
};

function textSizeClass(nav: boolean, compact: boolean): string {
  if (nav) return "text-[1.25rem]";
  if (compact) return "text-[1.35rem]";
  return "text-[1.5rem]";
}

function markSizeClass(nav: boolean, compact: boolean): string {
  if (nav) return "size-10";
  if (compact) return "size-11";
  return "size-12";
}

export function LogoWordmark({
  href = "/",
  variant = "full",
  compact = false,
  nav = false,
  className,
}: LogoWordmarkProps) {
  const inner =
    variant === "mark" ? (
      <Image
        src={brand.logoMark}
        alt={`${brand.name} emblem`}
        width={brand.logoMarkSize.width}
        height={brand.logoMarkSize.height}
        priority
        className={`${markSizeClass(nav, compact)} w-auto object-contain`}
      />
    ) : (
      <span className="logo-wordmark__full">
        <Image
          src={brand.logoMark}
          alt=""
          width={brand.logoMarkSize.width}
          height={brand.logoMarkSize.height}
          priority
          className={`${markSizeClass(nav, compact)} w-auto object-contain`}
        />
        <span className={`logo-wordmark__text ${textSizeClass(nav, compact)}`}>
          {brand.shortName}
        </span>
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
    </Link>
  );
}
