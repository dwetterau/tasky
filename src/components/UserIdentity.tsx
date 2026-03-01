import Image from "next/image";

type UserIdentityProps = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  showEmail?: boolean;
  imageSize?: number;
};

export function UserIdentity({
  name,
  email,
  image,
  showEmail = false,
  imageSize = 32,
}: UserIdentityProps) {
  const label = name || email || "User";
  const initial = (label[0] ?? "U").toUpperCase();

  return (
    <div className="flex items-center gap-3">
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
      <div className="min-w-0">
        <p className="text-sm text-foreground truncate">{name || "Signed in user"}</p>
        {showEmail && email ? (
          <p className="text-xs text-(--muted) truncate">{email}</p>
        ) : null}
      </div>
    </div>
  );
}

