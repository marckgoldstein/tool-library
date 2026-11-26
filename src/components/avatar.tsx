import { photoUrl } from "@/server/storage/photos";

/** A member's photo, or their initials when they haven't added one. Decorative next to their name. */
export function Avatar({ name, photoKey, size = 48 }: { name: string; photoKey: string | null; size?: number }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?";
  const style = { width: size, height: size, fontSize: size * 0.38 };
  if (photoKey) {
    // eslint-disable-next-line @next/next/no-img-element -- member photos are served by our own /media route
    return <img className="avatar" src={photoUrl(photoKey)} alt="" width={size} height={size} style={style} />;
  }
  return (
    <span className="avatar initials" aria-hidden="true" style={style}>
      {initials}
    </span>
  );
}
