import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { listCategories, searchItems } from "@/server/items/service";
import { photoUrl } from "@/server/storage/photos";

export const metadata: Metadata = { title: "Browse items" };
export const dynamic = "force-dynamic";

/** S9: search the group's items by keyword and category. GET form, so results can be bookmarked and shared. */
export default async function BrowsePage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const { q = "", category = "" } = await searchParams;
  const [categories, results] = await Promise.all([listCategories(), searchItems(user.id, { q, categoryId: category || undefined })]);
  const searching = !!(q.trim() || category);

  return (
    <>
      <h1>Browse items</h1>
      <search>
        <form method="get" action="/items" className="search-form" aria-label="Search items">
          <div className="field">
            <label htmlFor="q">Search</label>
            <input id="q" name="q" type="search" defaultValue={q} maxLength={200} enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </div>
          <div className="field">
            <label htmlFor="category">Category</label>
            <select id="category" name="category" defaultValue={category}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  <option value={c.id}>All {c.name.toLowerCase()}</option>
                  {c.children.map((child) => (
                    <option key={child.id} value={child.id}>
                      {child.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <button type="submit">Search</button>
        </form>
      </search>

      <p role="status" className="muted" data-testid="result-count">
        {results.length === 0
          ? searching
            ? "Nothing matches. Try fewer words or another category."
            : "No items listed yet."
          : `${results.length} ${results.length === 1 ? "item" : "items"}${searching ? " found" : ""}`}
      </p>
      {results.length === 0 && (
        <p>
          <Link className="button" href="/items/new">
            List an item
          </Link>
        </p>
      )}
      <ul className="item-grid" data-testid="results">
        {results.map((r) => (
          <li key={r.id} className="item-card">
            <Link href={`/items/${r.id}`}>
              {r.photoKey ? (
                // eslint-disable-next-line @next/next/no-img-element -- served by our /media route
                <img src={photoUrl(r.photoKey)} alt="" loading="lazy" width={320} height={240} />
              ) : (
                <span className="no-photo" aria-hidden="true">
                  No photo
                </span>
              )}
              <span className="item-title">{r.title}</span>
            </Link>
            <span className="muted">
              {r.categoryName}
              {r.ownerArea ? ` · ${r.ownerArea}` : ""}
            </span>
            <span className="tags">
              {r.status === "on_loan" && (
                <span className="status" data-status="on_loan">
                  On loan
                </span>
              )}
              {r.isOwn && <span className="status">Yours</span>}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
