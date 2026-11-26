import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { communities, memberships } from "@/db/schema";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user) {
    return (
      <>
        <h1>Borrow what your friends already own</h1>
        <p>
          The Tool Library is a private, invite-only group for lending tools and gear to each other. No fees, no
          deposits; owners approve every loan.
        </p>
        <p>
          <Link className="button" href="/sign-in">
            Sign in
          </Link>
        </p>
      </>
    );
  }

  const groups = await db
    .select({ id: communities.id, name: communities.name })
    .from(memberships)
    .innerJoin(communities, eq(communities.id, memberships.communityId))
    .where(and(eq(memberships.userId, session.user.id), isNull(memberships.removedAt)));

  return (
    <>
      <h1>Welcome back{session.user.name ? `, ${session.user.name}` : ""}</h1>
      <p>Your groups:</p>
      <ul>
        {groups.map((g) => (
          <li key={g.id}>{g.name}</li>
        ))}
      </ul>
      <p className="actions">
        <Link className="button" href="/items">
          Browse items
        </Link>
        <Link className="button secondary" href="/items/new">
          List an item
        </Link>
      </p>
      <p>
        Questions about something? Open it and ask the owner; replies land in <Link href="/threads">Messages</Link>.
      </p>
    </>
  );
}
