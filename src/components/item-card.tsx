import Link from "next/link";
import type { SearchResult } from "@/server/items/service";
import { photoUrl } from "@/server/storage/photos";
import { Avatar } from "./avatar";

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * An item in a grid (Browse, a member's profile). Trust comes from who owns it,
 * so the owner's face and first name sit on every card, beside their general area.
 */
export function ItemCard({ item, showOwner = true }: { item: SearchResult; showOwner?: boolean }) {
  return (
    <li className="item-card">
      <Link href={`/items/${item.id}`}>
        {item.photoKey ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by our /media route
          <img src={photoUrl(item.photoKey)} alt="" loading="lazy" width={320} height={240} />
        ) : (
          <span className="no-photo" aria-hidden="true">
            No photo
          </span>
        )}
        <span className="item-title">{item.title}</span>
      </Link>
      {showOwner && (
        <span className="person muted" data-testid="card-owner">
          <Avatar name={item.ownerName} photoKey={item.ownerPhotoKey} size={24} />
          <span>
            {item.isOwn ? "You" : firstName(item.ownerName)}
            {item.ownerArea ? ` · ${item.ownerArea}` : ""}
          </span>
        </span>
      )}
      <span className="muted">{item.categoryName}</span>
      {(item.status === "on_loan" || item.isOwn) && (
        <span className="tags">
          {item.status === "on_loan" && (
            <span className="status" data-status="on_loan">
              On loan
            </span>
          )}
          {item.isOwn && <span className="status">Yours</span>}
        </span>
      )}
    </li>
  );
}
