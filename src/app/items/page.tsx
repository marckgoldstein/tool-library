import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { ItemCard } from "@/components/item-card";
import { listCategories, searchItems } from "@/server/items/service";

export const metadata: Metadata = { title: "Browse items" };
export const dynamic = "force-dynamic";

/** S9: search the group's items by keyword and category. GET form, so results can be bookmarked and shared. */
export default async function BrowsePage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; result?: string }> }) {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const { q = "", category = "", result } = await searchParams;
  const [categories, results] = await Promise.all([listCategories(), searchItems(user.id, { q, categoryId: category || undefined })]);
  const searching = !!(q.trim() || category);

  return (
    <>
      <h1>Browse items</h1>
      {result === "admin_delisted" && (
        <p className="notice success" role="status" data-testid="browse-result">
          Listing taken down. The owner has been emailed your note.
        </p>
      )}
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
      {results.length === 0 &&
        (searching ? (
          <p className="actions">
            <Link className="button" href="/items">
              Clear search
            </Link>
            <span className="muted">
              Can&apos;t find it? <Link href="/invite">Suggest someone</Link> who might lend it.
            </span>
          </p>
        ) : (
          <p>
            <Link className="button" href="/items/new">
              List the first item
            </Link>
          </p>
        ))}
      <ul className="item-grid" data-testid="results">
        {results.map((r) => (
          <ItemCard key={r.id} item={r} />
        ))}
      </ul>
    </>
  );
}
