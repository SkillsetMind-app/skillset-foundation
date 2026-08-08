import Image from "next/image";

type UserAvatarProps = {
  name?: string | null;
  photoURL?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizeClasses = {
  sm: "size-8",
  md: "size-9",
  lg: "size-20",
};

export function UserAvatar({
  name,
  photoURL,
  size = "md",
  className = "",
}: UserAvatarProps) {
  const label = name ? `${name}'s profile picture` : "Profile picture";

  return (
    <span
      aria-label={label}
      className={`avatar-fallback relative grid shrink-0 place-items-center overflow-hidden rounded-full text-[var(--color-primary)] ${sizeClasses[size]} ${className}`}
    >
      {photoURL ? (
        // unoptimized: photoURL is an arbitrary external avatar host (OAuth
        // provider or uploaded asset) and the Next image optimizer 400s on
        // some of them (fetch times out / rejects). Avatars are 40-80px so
        // bypassing the optimizer is free — the browser scales it down anyway.
        <Image
          src={photoURL}
          alt={label}
          fill
          sizes={size === "lg" ? "80px" : "40px"}
          className="object-cover"
          unoptimized
        />
      ) : (
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={size === "lg" ? "size-10" : "size-5"}
        >
          <path
            fill="currentColor"
            d="M12 12.25a4.25 4.25 0 1 0 0-8.5 4.25 4.25 0 0 0 0 8.5Zm0 2.1c-4.19 0-7.25 2.17-7.25 5.14 0 .47.38.86.86.86h12.78c.48 0 .86-.39.86-.86 0-2.97-3.06-5.14-7.25-5.14Z"
          />
        </svg>
      )}
    </span>
  );
}
