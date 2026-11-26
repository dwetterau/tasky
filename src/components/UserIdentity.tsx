import Image from "next/image";

type UserIdentityProps = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  showEmail?: boolean;
  imageSize?: number;
  /** Tighter spacing, and the name only appears on wide screens. */
  compact?: boolean;
};

export function UserIdentity({
  name,
  email,
  image,
  showEmail = false,
  imageSize = 32,
  compact = false,
}: UserIdentityProps) {
  const label = name || email || "User";
  const initial = (label[0] ?? "U").toUpperCase();

  return (
    <div className={`flex items-center ${compact ? "gap-2" : "gap-3"}`}>
      {image ? (
        <Image
          src={image}
          alt={label}
          width={imageSize}
          height={imageSize}
          className="rounded-full border border-(--card-border)"
        />
      ) : (
        <div
          className="rounded-full border border-(--card-border) bg-(--card-border) text-xs font-semibold text-(--muted) flex items-center justify-center"
          style={{ width: imageSize, height: imageSize }}
          aria-label={label}
        >
          {initial}
        </div>
      )}
      <div className={`min-w-0 ${compact ? "hidden xl:block" : ""}`}>
        <p className={`${compact ? "text-[13px]" : "text-sm"} text-foreground truncate`}>{name || "Signed in user"}</p>
        {showEmail && email ? (
          <p className="text-xs text-(--muted) truncate">{email}</p>
        ) : null}
      </div>
    </div>
  );
}

