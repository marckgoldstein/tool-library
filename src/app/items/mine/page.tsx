import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { loanLine } from "@/components/loan-line";
import { activeMembership, cleanTimezone } from "@/server/invitations/service";
import { listOwnItems } from "@/server/items/service";
import { photoUrl } from "@/server/storage/photos";

export const metadata: Metadata = { title: "Your items" };
export const dynamic = "force-dynamic";

const STATUS_LABEL = { available: "Available", on_loan: "On loan", paused: "Paused", delisted: "Delisted" } as const;

/** The owner's listings, including paused ones that search hides, and who has each one right now. */
export default async function MyItemsPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const { result } = await searchParams;
  const [mine, me] = await Promise.all([listOwnItems(user.id), activeMembership(user.id)]);
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: cleanTimezone(me?.timezone) });
  return (
    <>
      <h1>Your items</h1>
      {result === "delisted" && (
        <p className="notice success" role="status" data-testid="mine-result">
          Delisted. It no longer shows in search.
        </p>
      )}
      {mine.length === 0 ? (
        <>
          <p>
            You haven&apos;t listed anything yet. Lending one or two things you rarely use is how the group gets going,
            and you approve every loan.
          </p>
          <p>
            <Link className="button" href="/items/new">
              List your first item
            </Link>
          </p>
        </>
      ) : (
        <>
          <p>
            <Link className="button" href="/items/new">
              List an item
            </Link>
          </p>
          <ul className="rows owned" data-testid="my-items">
            {mine.map((i) => (
              <li key={i.id}>
                {i.photoKey ? (
                  // eslint-disable-next-line @next/next/no-img-element -- served by our /media route
                  <img className="thumb" src={photoUrl(i.photoKey)} alt="" width={56} height={56} loading="lazy" />
                ) : (
                  <span className="thumb" aria-hidden="true" />
                )}
                <span className="owned-main">
                  <Link href={`/items/${i.id}`}>{i.title}</Link>
                  <span className="muted">
                    {i.lockingLoan ? (
                      <Link href={`/loans/${i.lockingLoan.id}`} data-testid="loan-line">
                        {loanLine(i.lockingLoan, fmt)}
                      </Link>
                    ) : (
                      i.categoryName
                    )}
                  </span>
                </span>
                <span className="status" data-status={i.status}>
                  {STATUS_LABEL[i.status]}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
