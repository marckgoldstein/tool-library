import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { listOwnItems } from "@/server/items/service";

export const metadata: Metadata = { title: "Your items" };
export const dynamic = "force-dynamic";

const STATUS_LABEL = { available: "Available", on_loan: "On loan", paused: "Paused", delisted: "Delisted" } as const;

/** The owner's listings, including paused ones that search hides. */
export default async function MyItemsPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const { result } = await searchParams;
  const mine = await listOwnItems(user.id);
  return (
    <>
      <h1>Your items</h1>
      {result === "delisted" && (
        <p className="notice success" role="status" data-testid="mine-result">
          Delisted. It no longer shows in search.
        </p>
      )}
      <p>
        <Link className="button" href="/items/new">
          List an item
        </Link>
      </p>
      {mine.length === 0 ? (
        <p>You haven&apos;t listed anything yet.</p>
      ) : (
        <ul className="rows" data-testid="my-items">
          {mine.map((i) => (
            <li key={i.id}>
              <Link href={`/items/${i.id}`}>{i.title}</Link>
              <span className="muted">{i.categoryName}</span>
              <span className="status" data-status={i.status}>
                {STATUS_LABEL[i.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
