import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { itemPhotos, items, memberships, users } from "@/db/schema";
import { readPhoto } from "@/server/storage/photos";

/** The group a stored photo belongs to: its item's group, or its member's group (profile photos). */
async function photoCommunity(key: string): Promise<string | null> {
  const [item] = await db
    .select({ communityId: items.communityId })
    .from(itemPhotos)
    .innerJoin(items, eq(items.id, itemPhotos.itemId))
    .where(eq(itemPhotos.storageKey, key))
    .limit(1);
  if (item) return item.communityId;
  const [member] = await db
    .select({ communityId: memberships.communityId })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(eq(users.image, key))
    .limit(1);
  return member?.communityId ?? null;
}

/**
 * Serves stored photos (local driver) to signed-in members of the photo's own
 * group only (T14: every read is group-scoped). Anything else is a 404.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Not found", { status: 404 });
  const { key: parts } = await ctx.params;
  const key = parts.join("/");
  const [viewer] = await db
    .select({ communityId: memberships.communityId })
    .from(memberships)
    .where(and(eq(memberships.userId, session.user.id), isNull(memberships.removedAt)));
  const owner = await photoCommunity(key);
  if (!viewer || !owner || viewer.communityId !== owner) return new Response("Not found", { status: 404 });
  const body = await readPhoto(key).catch(() => null);
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
}
